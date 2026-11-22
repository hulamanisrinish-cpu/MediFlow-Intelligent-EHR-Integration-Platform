import type { Bindings } from "../env";
import type {
  FhirOperationOutcome,
  FhirTransactionBundle,
} from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const MAX_RESPONSE_BYTES = 1_000_000;

export class FhirConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FhirConfigurationError";
  }
}

export class FhirRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "FhirRequestError";
  }
}

export interface FhirClientOptions {
  baseUrl: string;
  accessToken: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface FhirSendResult {
  resourceCount: number;
  response: unknown;
}

function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FhirConfigurationError("FHIR_BASE_URL is not a valid URL");
  }
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocal)) {
    throw new FhirConfigurationError(
      "FHIR_BASE_URL must use https (http is allowed only for localhost)",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function operationOutcomeMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as FhirOperationOutcome;
    if (parsed.resourceType !== "OperationOutcome") return null;
    const issue = parsed.issue?.[0];
    return issue?.diagnostics ?? issue?.code ?? null;
  } catch {
    return null;
  }
}

async function readBoundedText(response: Response): Promise<string> {
  const text = await response.text();
  return text.length > MAX_RESPONSE_BYTES
    ? `${text.slice(0, MAX_RESPONSE_BYTES)}…`
    : text;
}

export class FhirClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: FhirClientOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl);
    this.accessToken = options.accessToken;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryBaseDelayMs =
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async sendBundle(bundle: FhirTransactionBundle): Promise<FhirSendResult> {
    let lastError: FhirRequestError | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const response = await this.attempt(bundle);
        const body = await readBoundedText(response);
        if (response.ok) {
          return {
            resourceCount: bundle.entry.length,
            response: body ? safeJson(body) : null,
          };
        }

        const status = response.status;
        const retryable = status === 408 || status === 429 || status >= 500;
        const detail =
          operationOutcomeMessage(body) ?? `FHIR endpoint returned ${status}`;
        lastError = new FhirRequestError(detail, status, retryable);
        if (!retryable || attempt === this.maxRetries) break;

        const retryAfter = Number(response.headers.get("Retry-After"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10_000)
          : this.backoff(attempt);
        await this.sleep(delay);
      } catch (error) {
        if (error instanceof FhirRequestError) throw error;
        lastError = new FhirRequestError(
          "FHIR endpoint could not be reached",
          0,
          true,
        );
        if (attempt === this.maxRetries) break;
        await this.sleep(this.backoff(attempt));
      }
    }

    throw (
      lastError ??
      new FhirRequestError("FHIR request failed", 0, false)
    );
  }

  private async attempt(bundle: FhirTransactionBundle): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(this.baseUrl, {
        method: "POST",
        headers: {
          Accept: "application/fhir+json",
          "Content-Type": "application/fhir+json",
          Authorization: `Bearer ${this.accessToken}`,
        },
        body: JSON.stringify(bundle),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private backoff(attempt: number): number {
    return Math.min(this.retryBaseDelayMs * 2 ** attempt, 5_000);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createFhirClient(bindings: Bindings): FhirClient | null {
  const baseUrl = bindings.FHIR_BASE_URL?.trim();
  const accessToken = bindings.FHIR_ACCESS_TOKEN?.trim();
  if (!baseUrl || !accessToken) return null;
  return new FhirClient({ baseUrl, accessToken });
}

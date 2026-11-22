import type { Bindings } from "../env";
import { resolveGeminiApiKey, resolveGeminiModel } from "./api-key";

export interface LanguageModel {
  readonly provider: string;
  readonly model: string;
  generate(input: { system: string; prompt: string }): Promise<string>;
}

export interface GeminiLanguageModelOptions {
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LlmRequestError";
  }
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryable(error: unknown): boolean {
  return error instanceof LlmRequestError ? error.retryable : true;
}

export class GeminiLanguageModel implements LanguageModel {
  readonly provider = "google";
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    options: GeminiLanguageModelOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);
    this.sleep = options.sleep ?? defaultSleep;
  }

  async generate(input: { system: string; prompt: string }): Promise<string> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        return await this.generateOnce(input);
      } catch (error) {
        lastError = error;
        if (attempt >= this.maxAttempts || !isRetryable(error)) break;
        const retryAfterMs =
          error instanceof LlmRequestError ? error.retryAfterMs : undefined;
        const backoffMs = this.baseDelayMs * 2 ** (attempt - 1);
        await this.sleep(Math.min(5_000, retryAfterMs ?? backoffMs));
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Gemini generation failed");
  }

  private async generateOnce(input: {
    system: string;
    prompt: string;
  }): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": this.apiKey,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: input.system }] },
            contents: [{ role: "user", parts: [{ text: input.prompt }] }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 300,
            },
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        const retryAfterSeconds = Number(response.headers.get("Retry-After"));
        throw new LlmRequestError(
          `Gemini returned status ${response.status}`,
          response.status,
          retryable,
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1_000
            : undefined,
        );
      }

      let body: GeminiResponse;
      try {
        body = (await response.json()) as GeminiResponse;
      } catch {
        throw new LlmRequestError("Gemini returned invalid JSON", 502, true);
      }

      const text = body.candidates?.[0]?.content?.parts
        ?.map((part) => part.text?.trim() ?? "")
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!text) {
        throw new LlmRequestError("Gemini returned no text", 502, true);
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createLanguageModel(
  bindings: Bindings,
  fallbackApiKey?: string,
): LanguageModel | null {
  const apiKey = resolveGeminiApiKey(bindings, fallbackApiKey);
  if (!apiKey) return null;
  return new GeminiLanguageModel(apiKey, resolveGeminiModel(bindings));
}

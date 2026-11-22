import type { ApiError } from "@mediflow/shared";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnvironment } from "../types";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const DEFAULT_BODY_LIMIT_BYTES = 32 * 1024;

interface RateBucket {
  count: number;
  resetAt: number;
}

interface RateRule {
  max: number;
  windowMs: number;
}

const rateBuckets = new Map<string, RateBucket>();
let requestCounter = 0;

export function apiError(
  context: Context<AppEnvironment>,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500 | 502 | 503,
  code: string,
  message: string,
  headers?: Record<string, string>,
): Response {
  const body: ApiError = {
    error: {
      code,
      message,
      requestId: context.get("requestId"),
    },
  };
  if (headers) {
    for (const [name, value] of Object.entries(headers)) {
      context.header(name, value);
    }
  }
  return context.json(body, status);
}

export function requestContext(): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const supplied = context.req.header("X-Request-Id");
    const requestId =
      supplied && REQUEST_ID_PATTERN.test(supplied)
        ? supplied
        : crypto.randomUUID();
    context.set("requestId", requestId);
    context.set(
      "clientIp",
      context.req.header("CF-Connecting-IP") ??
        context.req.header("X-Real-IP") ??
        "unknown",
    );
    context.header("X-Request-Id", requestId);
    await next();
  };
}

export function securityHeaders(): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    await next();
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "no-referrer");
    context.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()",
    );
    context.header("Cross-Origin-Resource-Policy", "same-origin");
    context.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    );
    context.header("Cache-Control", "no-store");
    if (new URL(context.req.url).protocol === "https:") {
      context.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  };
}

export function requestLogger(): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const startedAt = Date.now();
    let failed = false;
    try {
      await next();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      const principal = context.get("principal");
      console.log(
        JSON.stringify({
          level: failed ? "error" : "info",
          event: "http_request",
          requestId: context.get("requestId"),
          method: context.req.method,
          path: new URL(context.req.url).pathname,
          status: context.res?.status ?? 500,
          durationMs: Date.now() - startedAt,
          userId: principal?.userId ?? null,
          authMode: principal?.mode ?? null,
        }),
      );
    }
  };
}

function allowedOrigins(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}

export function corsAllowlist(): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    const origin = context.req.header("Origin");
    const allowed = origin ? allowedOrigins(context.env.CORS_ORIGINS) : null;
    const isAllowed = Boolean(origin && allowed?.has(origin));

    if (origin) {
      context.header("Vary", "Origin");
      if (isAllowed) {
        context.header("Access-Control-Allow-Origin", origin);
        context.header(
          "Access-Control-Allow-Headers",
          "Authorization, Content-Type, X-Gemini-Api-Key, X-Request-Id",
        );
        context.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        context.header("Access-Control-Max-Age", "600");
      }
    }

    if (context.req.method === "OPTIONS") {
      return context.body(null, 204);
    }

    await next();
  };
}

export function jsonBodyLimit(
  maxSize = DEFAULT_BODY_LIMIT_BYTES,
): MiddlewareHandler<AppEnvironment> {
  return bodyLimit({
    maxSize,
    onError: (context) =>
      apiError(
        context as Context<AppEnvironment>,
        413,
        "PAYLOAD_TOO_LARGE",
        `Request body must be at most ${maxSize} bytes`,
      ),
  });
}

function ruleFor(path: string, method: string): { name: string; rule: RateRule } {
  if (path.endsWith("/auth/login")) {
    return { name: "auth", rule: { max: 10, windowMs: 15 * 60 * 1000 } };
  }
  if (path.endsWith("/simulation/reset")) {
    return { name: "reset", rule: { max: 5, windowMs: 60 * 1000 } };
  }
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    return { name: "mutation", rule: { max: 60, windowMs: 60 * 1000 } };
  }
  return { name: "read", rule: { max: 120, windowMs: 60 * 1000 } };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function rateLimit(): MiddlewareHandler<AppEnvironment> {
  return async (context, next) => {
    if (
      context.env.RATE_LIMIT_DISABLED === "true" ||
      context.req.method === "OPTIONS"
    ) {
      await next();
      return;
    }

    const path = new URL(context.req.url).pathname;
    const { name, rule } = ruleFor(path, context.req.method);
    const generalMax = positiveInteger(context.env.RATE_LIMIT_MAX, rule.max);
    const generalWindow = positiveInteger(
      context.env.RATE_LIMIT_WINDOW_MS,
      rule.windowMs,
    );
    const max = name === "read" || name === "mutation" ? generalMax : rule.max;
    const windowMs =
      name === "read" || name === "mutation" ? generalWindow : rule.windowMs;

    const now = Date.now();
    requestCounter += 1;
    if (requestCounter % 500 === 0 || rateBuckets.size > 10_000) {
      for (const [key, bucket] of rateBuckets) {
        if (bucket.resetAt <= now) rateBuckets.delete(key);
      }
    }

    const key = `${name}:${context.get("clientIp")}`;
    const existing = rateBuckets.get(key);
    const bucket =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : existing;
    bucket.count += 1;
    rateBuckets.set(key, bucket);

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return apiError(
        context,
        429,
        "RATE_LIMITED",
        "Too many requests; retry later",
        { "Retry-After": String(retryAfter) },
      );
    }

    await next();
  };
}

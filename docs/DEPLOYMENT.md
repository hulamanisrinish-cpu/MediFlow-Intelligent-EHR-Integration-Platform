# Deployment

## Prerequisites

- Node.js `>=20.19.0`, npm 11
- Cloudflare account (Workers + Pages), Turso database

## Local development

```bash
npm ci
cp backend/.dev.vars.example backend/.dev.vars   # fill TURSO_*, optional DEMO_RESET_TOKEN / GEMINI_*
npm run db:seed --workspace @mediflow/backend
npm run dev:api      # wrangler dev -> http://127.0.0.1:8787
npm run dev          # vite dev -> http://127.0.0.1:5173 (proxies /api)
```

## Environment variables (Worker)

| Variable | Required | Notes |
| --- | --- | --- |
| `TURSO_DATABASE_URL` | yes | `libsql://...` |
| `TURSO_AUTH_TOKEN` | yes | |
| `AUTH_MODE` | no | `session` (default) or `demo` (refused in production) |
| `ENVIRONMENT` | no | |
| `CORS_ORIGINS` | no | comma-separated exact origins; empty = same-origin |
| `GEMINI_API_KEY` | no | optional; fallback text used when absent |
| `GEMINI_MODEL` | no | default `gemini-3.1-flash-lite` |
| `DEMO_RESET_TOKEN` | no | enables protected demo reset |
| `FHIR_BASE_URL` / `FHIR_ACCESS_TOKEN` | no | optional FHIR R4 target |

## Deploy

```bash
npm run build
npx wrangler deploy --config backend/wrangler.jsonc
npx wrangler pages deploy frontend/dist --project-name <mediflow-pages>
```

Frontend/Worker origin mismatch: set `VITE_API_BASE_URL` before building the
frontend.

## Operations

- Health: `GET /api/v1/health/live`, `GET /api/v1/health/ready`
- Observability: structured JSON request logs with request IDs; audit log for
  sensitive actions.
- Monitoring: Cloudflare Workers observability enabled in `backend/wrangler.jsonc`.

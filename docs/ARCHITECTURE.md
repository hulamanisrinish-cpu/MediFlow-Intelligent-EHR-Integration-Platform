# Architecture

Refer to `context/architecture.md` for the living system context and
`docs/diagram/` for Mermaid sources.

## Layers

1. **Frontend** (`frontend/`) — React 19 + Vite + TypeScript + Tailwind/shadcn.
   Renders server-driven state via a single polling context; never computes
   scheduling decisions.
2. **API** (`backend/src/routes/`) — Hono on Cloudflare Workers; thin handlers.
3. **Engine** (`backend/src/engine/`) — pure deterministic scheduler, baseline,
   bottleneck logic.
4. **Simulation** (`backend/src/simulation/`) — clock, ticks, override.
5. **LLM** (`backend/src/llm/`) — provider adapter, prompts, validation, cache.
6. **Persistence** (`backend/src/db/`) — Turso/libSQL + Drizzle.
7. **FHIR** (`backend/src/fhir/`) — outbound R4 client/mapper.

See `context/architecture.md` for invariants and boundaries.

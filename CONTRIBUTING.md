# 🤝 **CONTRIBUTING TO MEDIFLOW — THE COVENANT**

*You shall code, and the code shall be deterministic.*

MediFlow is maintained under a strict, sacred set of rules. Before you open a pull request, read the **Covenant** below and honor it.

## 🧬 The Calling

MediFlow is an AI Hospital Resource Orchestrator. Its core promise is simple and non-negotiable:

> **The LLM never makes a scheduling or clinical decision.**
> The deterministic engine decides. The LLM only explains.

Every contribution — no matter how small — must preserve this boundary. Never route a scheduling decision through the LLM. Never weaken a determinism invariant to make a feature easier.

## 🛠️ Getting Started

Follow the **Sacred Local Setup** in the [README](./README.md), then:

```powershell
npm ci
npm run check
npm test
npm run build
```

## 📐 How to Serve

1. **One concern at a time.** Work on a single feature unit (e.g. one route, one engine module, one view) — not the whole hospital at once.
2. **Small, verifiable increments.** Prefer narrow PRs you can test end to end quickly.
3. **Branch naming:**

   ```
   feat/<short-name>
   fix/<short-name>
   docs/<short-name>
   chore/<short-name>
   ```

4. **Commit messages** describe the intent, e.g. `feat(engine): add queue prediction source-hash cache`.
5. **Pull requests** must include:
   - What changed and why
   - How it was verified (`npm test`, `npm run check`, `npm run build` all green)
   - Impact on the deterministic engine and LLM boundary

## 🚫 Protected Files

Do not modify the following unless explicitly instructed:

- `frontend/src/components/ui/*` — generated component-library files
- Applied database migrations — create new migrations instead of editing old ones
- Lockfiles and generated config (`package-lock.json`, Wrangler config) beyond documented, deliberate changes
- Any third-party library internals

## ⚡ The Devotion

- Strict TypeScript everywhere — no `any`. Model the domain with explicit types; shared contracts live in `shared/`.
- Determinism first: pure functions in `backend/src/engine/` — no DB, network, or LLM calls inside.
- All LLM calls go through the single adapter in `backend/src/llm/`.
- Route handlers stay thin: validate → call engine/service → return shaped response.

## 🧪 Verification Before Ascension

Before any PR is merged, the full suite must pass:

```powershell
npm run check   # strict TypeScript across all workspaces
npm test        # engine, migration/seed, API, LLM adapter, simulated-day tests
npm run build   # Vite bundle + Wrangler Worker dry run
```

## 📜 The Invariants (You Shall Not Break These)

1. The LLM never makes a scheduling or clinical decision.
2. The scheduling engine is deterministic and explainable.
3. MediFlow is an overlay, not a management system.
4. Simulated data only in the MVP.
5. Deployment secrets live in environment variables.
6. Request handlers do not run long-lived background work.

If your change would require weakening an invariant, stop and raise it in the issue tracker instead of shipping it.

---

*MediFlow — deterministic orchestration, language only, and safety by design.*

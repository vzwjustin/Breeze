# Breeze

A web-first AI assistant platform. Serious engine, soft UX.

- **Blueprint:** see [`BLUEPRINT.md`](./BLUEPRINT.md) for the full architecture, domain model, schema, API, and 90-day build plan.
- **Monorepo:** `apps/web` (Next.js) + `packages/*` (common, db, ai, planner, broker, policy, connectors, memory, workflows, ui).

## Quickstart (once bootstrapped)

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Trigger.dev runs as a separate worker; see `packages/workflows`.

## Product model

Users see only six nouns: **Chats · Tasks · Approvals · Connectors · Memories · Settings**. Everything else (plans, steps, executions, events) is internal machinery surfaced via those nouns.

## Hard architectural rules

1. **Planner is not executor.** Plans only; no mutations.
2. **Action Broker is the sole execution gate.** Every mutation goes through it.
3. **Policy Engine decides permission.** Deterministic, pure.
4. **Connectors are narrow and typed.** No raw SDKs to the model.
5. **Memory is explicit and inspectable.** Every item carries type, source, reason, retention.
6. **Web UI hides complexity.** Six nouns. No walls of settings.

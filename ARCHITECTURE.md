# Breeze — Simplified AI Automation Platform
## Architecture Specification v1.0

---

## 1. System Overview

Breeze is a web-first AI automation platform that connects your digital life through a natural language interface. Users describe what they want in plain language; Breeze plans, validates with policy, seeks approval when needed, and executes — across email, calendar, code, and files.

The core design principle: **users control what runs automatically and what needs their OK.**

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Browser (Next.js)                           │
│  Chat ─ Tasks ─ Approvals ─ Connectors ─ Memory ─ Settings          │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ HTTP / SSE
┌─────────────────────────────▼────────────────────────────────────────┐
│                       API Layer (Next.js)                            │
│  /api/chats  /api/approvals  /api/tasks  /api/recipes                │
│  /api/connectors  /api/me  /api/auth                                 │
└──────┬───────────────────┬──────────────────────────────────────────┘
       │                   │
┌──────▼──────┐   ┌────────▼─────────────────────────────────────────┐
│  Auth Layer │   │              Service Layer                        │
│  (NextAuth) │   │  ChatService · ApprovalService · RecipeService    │
└─────────────┘   │  MemoryService · ConnectorAccountService          │
                  └────────┬──────────────────────────────────────────┘
                           │
        ┌──────────────────┼───────────────────────────┐
        │                  │                           │
┌───────▼──────┐  ┌────────▼───────┐  ┌───────────────▼──────┐
│   Planner    │  │     Broker     │  │  Connector Registry   │
│  (LLM→Plan) │  │ (Policy→Exec) │  │  Gmail·GCal·GitHub·FS │
└───────┬──────┘  └────────┬───────┘  └───────────────┬──────┘
        │                  │                           │
┌───────▼──────────────────▼───────────────────────────▼──────┐
│                    Data Layer                                 │
│  PostgreSQL via Prisma ORM + AES-256-GCM token encryption    │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Package Responsibilities

| Package | Role | Side Effects |
|---------|------|-------------|
| `@breeze/common` | Types, schemas, errors, events, logger, templating | None |
| `@breeze/policy` | Pure decision engine: allow/require_approval/deny | None |
| `@breeze/planner` | LLM → structured Plan | LLM API call |
| `@breeze/broker` | Sole execution gate: validate → policy → execute | Connector APIs, DB writes |
| `@breeze/connectors` | Typed connector SDK (capabilities + triggers) | External APIs |
| `@breeze/ai` | Multi-provider LLM router | LLM API calls |
| `@breeze/db` | Prisma client singleton + crypto | PostgreSQL |
| `@breeze/memory` | Memory storage backend | PostgreSQL |
| `@breeze/workflows` | Background task runners | Trigger.dev |
| `@breeze/ui` | Design system (tokens + components) | None |

---

## 4. Data Flow — Chat Turn

```
User types message
        │
        ▼
POST /api/chats/:id/messages
        │
        ▼
ChatService.appendUserMessage()    ← persists to DB
        │
        ▼
ChatTurn.run()                     ← opens SSE stream
        │
        ├── event: turn.started
        │
        ▼
Planner.plan(context)              ← LLM produces Plan
        │
        ├── event: plan.created
        │
        ▼
For each step in plan:
        │
        ├── event: step.started
        │
        ▼
  if step.kind === "act":
        │
        ▼
  Broker.submit(ActionRequest)
        │
        ├── validate input schema
        ├── Policy.evaluate()
        │     ├── "allow"    ──────────────→ ConnectorCapability.execute()
        │     ├── "require_approval" ──────→ Approval created
        │     │                              event: approval.requested
        │     │                              turn paused
        │     └── "deny" ─────────────────→ step.failed, turn.failed
        │
        └── event: step.completed | approval.requested | step.failed
        │
        ▼
event: turn.completed
```

---

## 5. MVP Feature Prioritization

### Phase 1 — Core Chat (Weeks 1-2)
**Why first**: Every other feature depends on the ability to have a conversation and execute actions.

1. **Chat with AI** — Natural language → Plan → Execution via SSE streaming
2. **Approval Inbox** — Review and approve/deny pending actions
3. **Connector Status** — See which connectors are active, authorize them

### Phase 2 — Automation (Weeks 3-4)
**Why second**: Once the core loop works, automation multiplies value.

4. **Recipes (IFTTT)** — "When X happens, do Y" automation rules
5. **Tasks** — Recurring/scheduled execution of prompts

### Phase 3 — Control & Memory (Weeks 5-6)
**Why third**: Advanced users need customization; memory makes AI smarter.

6. **Policy Settings** — Choose/customize what runs automatically
7. **Memory Manager** — See and edit what Breeze remembers
8. **Model Settings** — Switch between AI providers

---

## 6. Simplification vs. OpenClaw

### What We Simplify

| Area | OpenClaw Complexity | Breeze v1 |
|------|---------------------|-----------|
| Connectors | Dozens of integrations | Gmail, GCal, GitHub, Files |
| Policy | Complex RBAC + team rules | 6 built-in profiles + simple customization |
| Scheduling | Complex cron + watch | Simple cron + poll triggers |
| Memory | Vector embeddings + RAG | Structured key-value with expiry |
| Auth | Multiple providers | Google OAuth only |
| Deployment | Complex infrastructure | Single Next.js app + PostgreSQL |

### What We Exclude in v1

- Team/org workspaces (single user only)
- Real-time collaboration
- Plugin marketplace
- Custom connector SDK for users
- Webhook endpoints (incoming)
- File uploads (local FS only)
- Mobile apps
- Complex approval chains (only single-step)

---

## 7. Database Schema — Key Design Decisions

### Token Encryption
All OAuth tokens are encrypted at rest using AES-256-GCM with a 32-byte key (`BREEZE_DATA_KEY`). Key versioning supports rotation without downtime.

### Soft Deletes
Chats and Tasks use `deletedAt` nullable timestamps. Data is never hard-deleted from the main tables; a separate pruning job can archive to cold storage.

### Idempotent Execution
`ActionExecution.idempotencyKey` ensures actions are never executed twice even if requests are retried. The broker checks this before policy evaluation.

### Event Outbox
Events are written to `EventOutbox` transactionally, then a dispatcher publishes them to audit logs and pub/sub. This prevents lost events on crash.

### Policy Profiles
`PolicyProfile.rules` is stored as JSON, allowing rule definitions to evolve without schema migrations. The policy engine is a pure function that reads from this JSON.

---

## 8. API Design

### REST Conventions
- `GET /api/{resource}` — list (user-scoped, paginated)
- `GET /api/{resource}/:id` — get single
- `POST /api/{resource}` — create
- `PATCH /api/{resource}/:id` — partial update
- `DELETE /api/{resource}/:id` — soft delete
- `POST /api/{resource}/:id/:action` — state transition (approve, deny, pause)

### Authentication
All API routes require a valid session cookie (NextAuth database sessions). The middleware at `apps/web/middleware.ts` rejects unauthenticated requests to `/api/*` (except `/api/auth`).

### Rate Limiting
Token bucket per user per operation tag. Limits:
- `chat.message`: 20 requests, refills at 0.1/sec (~1 per 10 sec)
- `approvals.*`: 60 requests, refills at 1/sec
- `connectors.health`: 10 requests, refills at 0.05/sec

### SSE Pattern
Chat turns use Server-Sent Events with:
- `id: <incrementing>` for last-event-id recovery
- `: keepalive` heartbeats every 15 seconds
- `event: error` on failure
- Explicit `close()` on completion

---

## 9. Security Boundaries

### What the User Controls
- Which connectors are authorized
- Which policy profile is active (or custom rules)
- Which actions require explicit approval

### Hard Limits (Cannot Be Overridden)
- Bulk safety: mutations affecting >10 targets always require approval
- Critical sensitivity actions: always require approval in all built-in profiles
- No cross-user data access: every query is scoped by `userId`
- Token encryption: OAuth tokens never stored in plaintext

### Defense in Depth
1. **Middleware**: Rejects unauthenticated API requests
2. **requireUser()**: Validates session in every route handler
3. **Service layer**: All queries include `userId` filter
4. **Broker**: Policy check before every mutation
5. **Rate limiting**: Prevents abuse of expensive operations
6. **Input validation**: Zod schemas on all API inputs and connector inputs
7. **SSRF prevention**: `allowedHosts` in HTTP helper for connector calls

---

## 10. Extension Points

### Adding a New Connector
1. Create `packages/connectors/src/{name}/index.ts` with capabilities
2. Create `packages/connectors/src/{name}/triggers.ts` with triggers
3. Import in `packages/connectors/src/index.ts` (side-effect registration)
4. Add OAuth env vars to `.env.example`

### Adding a New AI Provider
1. Implement `AIProvider` interface in `packages/ai/src/{name}.ts`
2. Export from `packages/ai/src/index.ts`
3. Add to `PROVIDERS` map in `apps/web/src/server/ai-instance.ts`
4. Add env vars

### Adding a New Policy Profile
1. Define `PolicyProfile` object in `packages/policy/src/profiles.ts`
2. Add to `BUILTIN_PROFILES` array
3. Profile appears in Settings → Policy

### Customizing a Policy
Users can clone a built-in profile and modify rules via the Settings UI.
Rules are stored as JSON in `PolicyProfile.rules`.

---

## 11. Deployment Architecture

```
┌──────────────────────────────────────────┐
│              Vercel / Railway             │
│         Next.js Application              │
│  (API routes + SSR + static assets)      │
└─────────────────────┬────────────────────┘
                      │
          ┌───────────┼───────────┐
          │           │           │
┌─────────▼──┐  ┌─────▼─────┐  ┌─▼────────────┐
│ PostgreSQL │  │  Trigger  │  │   (optional)  │
│ (Supabase) │  │    .dev   │  │  Redis pubsub │
└────────────┘  └───────────┘  └──────────────┘
```

**Minimum viable deployment**:
- 1x PostgreSQL instance (Supabase free tier works)
- 1x Next.js server (Vercel hobby or Railway starter)
- No Redis needed for v1 (in-memory rate limiting, no pubsub)
- No Trigger.dev needed for v1 (cron via Vercel cron jobs)

---

## 12. v1 Technical Debt Accepted

These are known simplifications in v1 that will need addressing before production scale:

1. **In-memory rate limiting** — Resets on server restart, doesn't work with multiple instances. Replace with Redis + Upstash in v2.
2. **No outbox dispatcher** — Events are emitted but not drained to audit logs. Add a cron job in v2.
3. **Memory backend** — Interface defined but no backend. Add Prisma-backed implementation in v2.
4. **Trigger.dev** — Workflows are pseudocode. Add real Trigger.dev integration in v2.
5. **Single Google OAuth** — No email/password or other providers. Add in v2 if needed.

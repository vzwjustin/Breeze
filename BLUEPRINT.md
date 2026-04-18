# Breeze — Architecture & Implementation Blueprint

> Web-first AI assistant platform. Serious engine, soft UX.
> Status: v1 blueprint, ready for engineering.

---

## 1. Executive Summary

Breeze is a **web-first AI assistant** that makes it trivial for a single user to connect Gmail, Calendar, GitHub, and Files, then chat with an agent that can **read**, **draft**, **act**, and **automate** — with explicit approvals and inspectable memory.

The architecture is a **single Next.js full-stack application** on top of a clearly-bounded internal service layer. The runtime is anchored by three hard-separated components:

1. **Planner** — interprets intent, produces plans. Cannot execute.
2. **Action Broker** — the sole execution gate. Calls connectors only after policy + approval.
3. **Policy Engine** — deterministic, pure function: `(user, capability, target, context) → allow | approve | deny`.

Connectors are narrow, typed capability sets (not raw SDKs). Memory is explicit, user-visible, and tiered (conversation / user / working). Background work (schedules, retries, approval waits, long jobs) runs on **Trigger.dev**. Data lives in **Postgres (via Prisma)**, with **Redis** for cache/rate-limit/coordination and **S3-compatible** object storage for artifacts.

The user sees only six nouns: **Chats, Tasks, Approvals, Connectors, Memories, Settings**. Everything else is invisible machinery.

This is not a distributed-systems playground. It is one Next.js app, a small set of internal services with clean boundaries, and one background worker. That is the right shape for v1.

---

## 2. Final Architecture Recommendation

**One deployable**: `apps/web` — a Next.js (App Router) app that serves:
- UI
- Route handlers (REST + Server Actions for UI mutations)
- Auth (Auth.js)
- Orchestration entrypoints (chat turn, task trigger)

**One worker runtime**: Trigger.dev tasks colocated in `packages/workflows`, deployed separately (Trigger.dev Cloud or self-hosted) but sharing types and Prisma client.

**Internal module boundaries** (monorepo packages, imported by `apps/web` and `packages/workflows`):
- `@breeze/db` — Prisma client, migrations, encryption helpers.
- `@breeze/common` — shared Zod schemas, event envelopes, errors, IDs.
- `@breeze/ai` — provider abstraction (OpenAI/Anthropic/Google/OpenRouter).
- `@breeze/planner` — planner service (LLM → typed `Plan`).
- `@breeze/policy` — pure policy engine.
- `@breeze/broker` — action broker (only place that mutates external systems).
- `@breeze/connectors` — typed connector registry + Gmail/Calendar/GitHub/Files.
- `@breeze/memory` — memory read/write/summarize.
- `@breeze/workflows` — Trigger.dev task definitions.
- `@breeze/ui` — shadcn/ui-based design system (Tailwind).

**Key decisions**
- **Prisma** over Drizzle. Justified below (§4).
- **No microservices** in v1. Packages are logical modules with enforced boundaries via TS project refs + lint rules.
- **Server Components + Route Handlers**. Server Actions only for low-risk UI mutations (e.g., renaming a chat). All mutating agent actions go through route handlers that call the **broker**.
- **No BullMQ**. Trigger.dev owns all scheduled/long/retrying work.
- **No vector DB in MVP**. Keyword + summary memory only. Pluggable for v2.

---

## 3. ASCII Architecture Diagram

```
                         ┌──────────────────────────────────────┐
                         │             Web Client               │
                         │  Next.js App Router · React · TW     │
                         │  shadcn/ui · TanStack Query · Zustand│
                         └──────────────┬───────────────────────┘
                                        │ HTTPS / RSC
                                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          App Server (Next.js)                        │
│  ┌────────────┐  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ Auth.js    │  │ Route       │  │ Server       │  │ Server      │  │
│  │ (sessions) │  │ Handlers    │  │ Actions      │  │ Components  │  │
│  └────────────┘  └──────┬──────┘  └──────┬───────┘  └─────────────┘  │
│                         │                │                            │
│                         ▼                ▼                            │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │                      Domain Services                            │  │
│  │  ChatService · TaskService · ApprovalService · MemoryService ·  │  │
│  │  ConnectorService · SettingsService · AuditService              │  │
│  └─────────┬────────────────────┬────────────────────┬─────────────┘  │
│            │                    │                    │                │
│   ┌────────▼─────────┐  ┌───────▼────────┐  ┌────────▼─────────┐      │
│   │     Planner      │  │   Policy       │  │  Action Broker   │      │
│   │ (no execution)   │  │   Engine       │  │ (sole gate)      │      │
│   │ LLM → Plan       │  │ pure fn        │  │ plan → result    │      │
│   └──────────────────┘  └────────────────┘  └────────┬─────────┘      │
│                                                      │                │
│                                      ┌───────────────▼──────────────┐ │
│                                      │     Connector Manager        │ │
│                                      │ Gmail · Calendar · GitHub ·  │ │
│                                      │ Files · (typed capabilities) │ │
│                                      └──────────────────────────────┘ │
└────────────┬─────────────────────────────┬───────────────────────────┘
             │                             │
             │ emits events                │ schedules / waits
             ▼                             ▼
      ┌──────────────┐            ┌──────────────────┐
      │ Event Bus    │            │   Trigger.dev    │
      │ (pg outbox)  │────────────│   Workflows      │
      └──────────────┘            │ schedules/retry  │
                                  │ approval waits   │
                                  └────────┬─────────┘
                                           │
       ┌───────────────────────────────────┼───────────────────────────┐
       │                    Data Plane                                 │
       │  Postgres (primary) · Redis (cache/locks/ratelimit) · S3      │
       │                         (artifacts)                           │
       └───────────────────────────────────────────────────────────────┘

External: OpenAI | Anthropic | Google | OpenRouter | Gmail | Gcal | GitHub | S3
```

---

## 4. Recommended Stack and Why

| Layer              | Choice                          | Why                                                                                              |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| Framework          | Next.js App Router              | Unified UI + server; streaming; RSC; fewer moving parts than API+SPA split.                      |
| UI lib             | React + TS + Tailwind + shadcn  | Fastest path to high-quality, calm, modern UI without design debt.                               |
| Client state       | TanStack Query + Zustand + Zod  | Server state via TanStack; small global UI state via Zustand; validation everywhere via Zod.     |
| Motion             | Framer Motion                   | Polished micro-interactions for approvals, timelines.                                            |
| Auth               | Auth.js (NextAuth v5)           | Multi-OAuth, works with Next.js, session cookies, DB adapter to Prisma.                          |
| DB                 | Postgres + **Prisma**           | Prisma chosen over Drizzle: better migration UX, richer client types for Auth.js, better Next.js DX. Drizzle wins on raw SQL control — but v1 schema is not exotic. |
| Cache/locks        | Redis                           | Rate limits, idempotency keys, connector token mutex, pub/sub for live updates.                  |
| Blob store         | S3-compatible (via abstraction) | Artifacts, file uploads, exported memory bundles. Abstract for self-host (MinIO).                |
| Jobs               | **Trigger.dev**                 | First-class schedules, retries, **approval waits** (`wait.forToken`), long tasks, observability. Avoids BullMQ plumbing. |
| AI providers       | OpenAI / Anthropic / Google / OpenRouter | Abstract behind `ModelProvider` interface; route choice by user setting + task profile.  |
| Observability      | Pino + OpenTelemetry + Sentry   | Logs, traces, errors. Trigger.dev supplies workflow traces.                                      |
| Schema validation  | Zod                             | Same schemas at API boundary, LLM output parsing, and DB input validation.                       |

### Why Prisma over Drizzle (concrete)
- Auth.js Prisma adapter is battle-tested; Drizzle adapter is newer.
- `prisma migrate` flow is simpler for a small team.
- Breeze's hot path is not SQL-heavy analytics; Prisma's performance overhead is irrelevant here.
- Rich relational types for nested reads (chat → messages → plan → steps) reduce boilerplate.
- We can still drop to raw SQL (`$queryRaw`) for the event outbox and audit queries.

---

## 5. Product Model

The user-visible world has exactly six nouns:

| Noun         | What the user thinks it is                                                 |
| ------------ | -------------------------------------------------------------------------- |
| **Chat**     | A conversation with Breeze. Contains messages, actions taken, artifacts.   |
| **Task**     | A saved recurring or scheduled job. Editable, pausable.                    |
| **Approval** | A pending request for the user to OK a risky action before Breeze does it. |
| **Connector**| A connected service (Gmail, Calendar, GitHub, Files) with its health.      |
| **Memory**   | A saved fact/preference/summary. Inspectable and editable.                 |
| **Settings** | Model choice, privacy, policy profile, notifications.                      |

**Everything else is internal.** Plans, plan steps, action requests, audit events, policy rules, artifacts, connector credentials, and task runs are surfaced via these nouns (e.g., a plan step appears as a line in the chat's execution timeline, not as a separate page).

### Product verbs
- Chat → Ask, Draft, Act, Automate
- Task → Create, Run now, Pause, Edit schedule, View history
- Approval → Approve, Edit & approve, Deny
- Connector → Connect, Reconnect, Disconnect
- Memory → View, Edit, Delete, Export

---

## 6. Frontend Architecture

### 6.1 Routing
App Router layout:

```
app/
  (marketing)/               // public landing (optional v1: minimal)
    page.tsx
  (app)/                     // authenticated shell
    layout.tsx               // sidebar, topbar, status
    page.tsx                 // dashboard
    chat/
      page.tsx               // chat list / new chat
      [id]/page.tsx          // conversation
    tasks/
      page.tsx
      [id]/page.tsx
    approvals/
      page.tsx
      [id]/page.tsx
    connectors/
      page.tsx
    memory/
      page.tsx
    settings/
      layout.tsx
      page.tsx
      models/page.tsx
      privacy/page.tsx
      policies/page.tsx
    admin/                   // gated by role=admin
      page.tsx
  api/
    chat/route.ts
    chat/[id]/messages/route.ts
    plans/[id]/route.ts
    approvals/route.ts
    approvals/[id]/route.ts
    tasks/route.ts
    tasks/[id]/route.ts
    tasks/[id]/runs/route.ts
    connectors/route.ts
    connectors/[id]/route.ts
    connectors/[id]/oauth/callback/route.ts
    memory/route.ts
    memory/[id]/route.ts
    events/stream/route.ts   // SSE timeline updates
    auth/[...nextauth]/route.ts
```

### 6.2 Component layers
- **Primitives**: `@breeze/ui` — shadcn components wrapped with project tokens.
- **Feature components**: `components/chat/*`, `components/approvals/*`, etc.
- **Hooks**: `hooks/useChat.ts`, `hooks/useApprovals.ts` — thin wrappers around TanStack Query.
- **Stores** (Zustand): `stores/ui.ts` (sidebar, command palette, toasts), `stores/chat-composer.ts` (draft state).

### 6.3 App shell

```
┌───────────────────────────────────────────────────────────────┐
│ [⌘K search]          Breeze              ● connected  [avatar]│
├────────┬──────────────────────────────────────────────────────┤
│ Home   │                                                      │
│ Chat   │                  (main route content)                │
│ Tasks  │                                                      │
│ Appr.● │                                                      │
│ Conns  │                                                      │
│ Memory │                                                      │
│ Settn. │                                                      │
└────────┴──────────────────────────────────────────────────────┘
```

- Mobile: sidebar collapses into drawer. Bottom sheet for approvals.
- Dark/light via `next-themes`; tokens driven by Tailwind + CSS vars.
- Global status indicator: derives from Trigger.dev runs + connector health + pending approvals.
- Command bar (⌘K): jump to chat, tasks, approvals, “new chat about…”.

### 6.4 Dashboard
Four cards + composer, all server components hydrated by TanStack Query:
1. **Today** — one-paragraph summary generated by the morning summary task.
2. **Pending approvals** (count + top 3).
3. **Active tasks** (next run time, last status).
4. **Connected services** (health badges).
5. **Quick composer** — starts a new chat with suggested prompts.

### 6.5 Chat page
- Conversation thread (streamed).
- **Execution timeline** (right rail, collapsible): plan → steps → actions → approvals, color-coded.
- **Artifacts panel**: drafts, summaries, files (tabs: Drafts | Evidence | Files).
- **Inline approval banners** when a step is waiting on the user.
- **Action summary chips** (“Sent reply to Alice”, “Archived 3 threads”).
- Affordances: Regenerate, Revise (edit last user turn), Approve, Deny, Cancel plan.

### 6.6 Tasks page
- Table: name, schedule, next run, last status, policy profile.
- Filters: active / paused / failed.
- Detail: schedule editor (cron UI), policy preview, run history, linked chat, Run now button.

### 6.7 Approvals page
- Tabbed: Pending / All.
- Each card: risk badge, target object (with icon), preview payload (diff-style when possible), expiration countdown, Approve / Edit / Deny.
- Edit opens a modal with the draft payload editable (e.g., rewrite email body).
- Bulk-select for same-kind approvals (e.g., archive 12 threads).

### 6.8 Connectors page
- Card per connector: icon, status, scopes, last sync, “Reconnect” on token failure.
- Click-through to capability list with sensitivity markers.

### 6.9 Memory page
- List grouped by type (User / Conversation / Working).
- Per item: why-saved, source link (chat/message/task), retention, edit/delete.

### 6.10 Settings
- **Models**: default provider + per-task override.
- **Privacy**: redact-before-LLM toggle, data export, delete account.
- **Policies**: choose profile + view the rules; per-connector overrides.
- **Notifications**: email vs in-app.
- **Advanced**: show raw plans/events (dev mode).

### 6.11 Visual direction
- Calm. Muted surfaces. One accent color (e.g., breeze-blue-500 `#4F7CFF`).
- Generous whitespace, Inter font, subtle shadows, 8px grid.
- Motion: 150–220ms easing, micro-scale on hover, page transitions via Framer.

---

## 7. Backend Architecture

### 7.1 Layers inside `apps/web`
```
src/
  server/
    auth/              // Auth.js config + helpers
    services/          // Domain services (ChatService, TaskService, ...)
    guards/            // authz middlewares
    events/            // outbox publisher, SSE subscriber
    ai/                // instantiates provider from user settings
    errors.ts
    ids.ts             // ulid/cuid helpers
```

### 7.2 Request lifecycle (chat turn)
1. `POST /api/chat/[id]/messages` — auth → create message → start **ChatTurn** orchestration.
2. `ChatService.runTurn(chatId, userMessage)`:
   a. Gather context: last N messages, relevant memory, active task (if any).
   b. Call `Planner.plan(context)` → `Plan` (persisted).
   c. For each `PlanStep`:
      - `retrieve` / `summarize` / `draft` steps: run inline via AI/connector read calls.
      - `act` steps: hand to `Broker.submit(actionRequest)`.
   d. Stream updates to the client via SSE.
3. Broker consults Policy → either executes or creates an `Approval` and suspends (delegating to Trigger.dev for long waits and retries).
4. Completed/failed steps emit events → timeline.

### 7.3 Orchestration boundary
- Short, synchronous chat turns run in the Next.js handler (edge of 60s-ish; streaming response is fine).
- Anything > ~20s, retrying, or awaiting human approval is **handed off** to Trigger.dev (`chatTurn.longrun`, `taskSchedule`, `approvalWait`). The handler returns immediately with a `runId`; UI subscribes via SSE.

### 7.4 Service layer contract
Every service exposes a pure function style interface; IO is injected (`prisma`, `redis`, `logger`, `events`). This makes unit testing and swapping implementations trivial.

### 7.5 Concurrency and idempotency
- Every mutating route accepts `Idempotency-Key` header; stored in Redis for 24h.
- Broker action requests carry `idempotencyKey = hash(userId, stepId, capability, targetHash)`.
- Connector token refresh guarded by Redis mutex `connector:{id}:refresh`.

---

## 8. Domain Model

All entities live in a single Postgres DB. IDs are ULIDs (`id text primary key`). Every table has `createdAt`, `updatedAt`. Soft delete (`deletedAt`) is used for user-facing nouns (Chat, Task, Memory, Approval, ConnectorAccount). Audit events are append-only.

| Entity               | Purpose                                   | Key fields                                                               | Relations                                         | Lifecycle / Retention                          |
| -------------------- | ----------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| User                 | Login identity                            | email, name, image, role, policyProfileId                                | → Sessions, ConnectorAccounts, Chats, Tasks       | Deleted on account close (hard delete + purge).|
| Session              | Auth.js session                           | userId, expires, sessionToken                                            | → User                                            | Session TTL.                                   |
| Chat                 | Conversation container                    | userId, title, summary, archivedAt                                       | → Messages, Plans, Artifacts                      | Soft delete; purge after 90d (user setting).   |
| Message              | Single chat message                       | chatId, role (user|assistant|system|tool), content, tokens               | → Plan (if assistant)                             | Follows Chat retention.                        |
| Plan                 | Planner output                            | chatId, messageId, intent, summaryText, riskLevel, status                | → PlanSteps                                       | Follows Chat retention. Audit copy kept 1y.    |
| PlanStep             | One executable/retrieval unit             | planId, index, kind, capability, input, expectedArtifactKind, riskLevel  | → ActionExecution (0..1), → Approval (0..1)       | Follows Plan.                                  |
| Task                 | Saved/recurring/scheduled job             | userId, name, description, schedule (cron/date), policyProfileId, status | → TaskRuns                                        | Soft delete.                                   |
| TaskRun              | Single execution of a Task                | taskId, triggerRunId, status, startedAt, endedAt, summary                | → Plan, → Approvals, → ActionExecutions           | Kept 90d; last N per task always.              |
| Approval             | Human-in-the-loop gate                    | userId, planStepId, actionRequest, preview, status, expiresAt            | → PlanStep                                        | Kept 180d for audit.                           |
| ConnectorDefinition  | Static definition (not per user)          | key, version, capabilities (json)                                        | —                                                 | Versioned. Append-only.                        |
| ConnectorAccount     | User’s connection to a provider           | userId, connectorKey, providerAccountId, scopes, status                  | → ConnectorCredential                             | Soft delete; revoked on disconnect.            |
| ConnectorCredential  | Encrypted tokens                          | accountId, accessTokenEnc, refreshTokenEnc, expiresAt                    | → ConnectorAccount                                | Hard delete on disconnect.                     |
| Memory               | Explicit, user-visible memory             | userId, type, scope, key, value, source, reason, visibility, expiresAt   | → sourceMessageId / sourceTaskId                  | TTL per type; user-deletable.                  |
| Artifact             | Structured drafts / summaries / files     | chatId, kind (draft_email/draft_comment/summary/file), payload, blobKey  | → Message / PlanStep                              | Follows Chat; blobs in S3.                     |
| AuditEvent           | Append-only security/action log           | userId, type, subject, data, correlationId, ts                           | —                                                 | 1 year min.                                    |
| PolicyProfile        | User-scoped policy bundle                 | userId, name, kind (builtin/custom), rulesJson                           | → PolicyRules (optional normalized)               | Follows user.                                  |
| PolicyRule           | Fine-grained override                     | profileId, connector, capability, decision, condition                    | → PolicyProfile                                   | Follows profile.                               |
| EventOutbox          | Reliable event publishing                 | id, type, payload, publishedAt                                           | —                                                 | Purged after publish+24h.                      |

### Indexing notes
- `Message(chatId, createdAt)`; `Plan(chatId)`; `PlanStep(planId, index)`.
- `Approval(userId, status, expiresAt)` — drives approvals page + expiry worker.
- `Task(userId, status)`; `TaskRun(taskId, startedAt desc)`.
- `Memory(userId, type, key)` unique partial index when `type='user'`.
- `AuditEvent(userId, ts desc)`; partition by month if volume grows.
- `ConnectorAccount(userId, connectorKey)` unique.
- `EventOutbox(publishedAt IS NULL)` partial index for dispatcher.

---

## 9. Database Schema (Prisma)

See `packages/db/prisma/schema.prisma` in the scaffold. Summary:

```prisma
// packages/db/prisma/schema.prisma  (excerpt; full file in repo)
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id              String   @id @default(cuid())
  email           String   @unique
  name            String?
  image           String?
  role            Role     @default(USER)
  policyProfileId String?
  policyProfile   PolicyProfile? @relation(fields: [policyProfileId], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  chats           Chat[]
  tasks           Task[]
  approvals       Approval[]
  connectors      ConnectorAccount[]
  memories        Memory[]
}

enum Role { USER ADMIN }

model Chat {
  id        String   @id @default(cuid())
  userId    String
  title     String
  summary   String?
  archivedAt DateTime?
  deletedAt DateTime?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id])
  messages  Message[]
  plans     Plan[]
  @@index([userId, updatedAt])
}

enum MessageRole { USER ASSISTANT SYSTEM TOOL }

model Message {
  id        String   @id @default(cuid())
  chatId    String
  role      MessageRole
  content   Json
  tokens    Int?
  createdAt DateTime @default(now())
  chat      Chat     @relation(fields: [chatId], references: [id])
  plan      Plan?
  @@index([chatId, createdAt])
}

model Plan {
  id          String     @id @default(cuid())
  chatId      String
  messageId   String     @unique
  intent      String
  summaryText String
  riskLevel   RiskLevel
  status      PlanStatus @default(RUNNING)
  createdAt   DateTime   @default(now())
  chat        Chat       @relation(fields: [chatId], references: [id])
  message     Message    @relation(fields: [messageId], references: [id])
  steps       PlanStep[]
  @@index([chatId])
}

enum PlanStatus { RUNNING COMPLETED FAILED CANCELED }
enum RiskLevel  { NONE LOW MEDIUM HIGH CRITICAL }
enum StepKind   { RETRIEVE SUMMARIZE DRAFT ACT WAIT }
enum StepStatus { PENDING RUNNING AWAITING_APPROVAL COMPLETED FAILED SKIPPED }

model PlanStep {
  id                 String   @id @default(cuid())
  planId             String
  index              Int
  kind               StepKind
  capability         String?       // e.g. "gmail.send_reply"
  input              Json
  expectedArtifact   String?
  riskLevel          RiskLevel
  status             StepStatus @default(PENDING)
  resultSummary      String?
  errorMessage       String?
  createdAt          DateTime @default(now())
  plan               Plan     @relation(fields: [planId], references: [id])
  approvals          Approval[]
  executions         ActionExecution[]
  @@index([planId, index])
}

model Task {
  id              String   @id @default(cuid())
  userId          String
  name            String
  description     String?
  schedule        Json      // { kind: "cron"|"once", value: "0 8 * * *"|ISO }
  prompt          String    // the "spec" — what Breeze should do
  policyProfileId String?
  status          TaskStatus @default(ACTIVE)
  lastRunAt       DateTime?
  nextRunAt       DateTime?
  triggerTaskId   String?   // Trigger.dev task id
  deletedAt       DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id])
  runs            TaskRun[]
  @@index([userId, status])
}

enum TaskStatus { ACTIVE PAUSED FAILED ARCHIVED }

model TaskRun {
  id            String   @id @default(cuid())
  taskId        String
  triggerRunId  String?  @unique
  status        RunStatus @default(RUNNING)
  startedAt     DateTime  @default(now())
  endedAt       DateTime?
  summary       String?
  planId        String?
  errorMessage  String?
  task          Task      @relation(fields: [taskId], references: [id])
  @@index([taskId, startedAt(sort: Desc)])
}

enum RunStatus { RUNNING COMPLETED FAILED CANCELED WAITING_APPROVAL }

model Approval {
  id             String          @id @default(cuid())
  userId         String
  planStepId     String
  actionRequest  Json
  preview        Json
  risk           RiskLevel
  status         ApprovalStatus  @default(PENDING)
  expiresAt      DateTime
  decidedAt      DateTime?
  decisionNote   String?
  waitToken      String?         @unique   // Trigger.dev wait token
  createdAt      DateTime        @default(now())
  user           User            @relation(fields: [userId], references: [id])
  planStep       PlanStep        @relation(fields: [planStepId], references: [id])
  @@index([userId, status, expiresAt])
}

enum ApprovalStatus { PENDING APPROVED DENIED EXPIRED SUPERSEDED CANCELED }

model ConnectorAccount {
  id                String   @id @default(cuid())
  userId            String
  connectorKey      String
  providerAccountId String
  scopes            String[]
  status            ConnectorStatus @default(ACTIVE)
  lastSyncAt        DateTime?
  lastErrorAt       DateTime?
  lastError         String?
  deletedAt         DateTime?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
  credential        ConnectorCredential?
  user              User     @relation(fields: [userId], references: [id])
  @@unique([userId, connectorKey])
}

enum ConnectorStatus { ACTIVE NEEDS_REAUTH DISCONNECTED ERROR }

model ConnectorCredential {
  id             String   @id @default(cuid())
  accountId      String   @unique
  accessTokenEnc Bytes
  refreshTokenEnc Bytes?
  expiresAt      DateTime?
  keyVersion     Int      @default(1)
  account        ConnectorAccount @relation(fields: [accountId], references: [id])
}

model Memory {
  id          String   @id @default(cuid())
  userId      String
  type        MemoryType
  scope       String?      // e.g. chatId or taskId for conversation/working
  key         String
  value       Json
  source      Json         // { kind: 'message'|'task'|'system', id }
  reason      String
  visibility  MemoryVisibility @default(USER_VISIBLE)
  expiresAt   DateTime?
  deletedAt   DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  user        User     @relation(fields: [userId], references: [id])
  @@index([userId, type])
}

enum MemoryType       { CONVERSATION USER WORKING }
enum MemoryVisibility { USER_VISIBLE INTERNAL }

model Artifact {
  id        String   @id @default(cuid())
  chatId    String?
  planStepId String?
  kind      String    // "draft_email" | "draft_comment" | "summary" | "file"
  payload   Json
  blobKey   String?
  createdAt DateTime  @default(now())
  @@index([chatId])
}

model ActionExecution {
  id             String   @id @default(cuid())
  planStepId     String
  capability     String
  connectorKey   String
  input          Json
  output         Json?
  errorMessage   String?
  idempotencyKey String   @unique
  startedAt      DateTime @default(now())
  endedAt        DateTime?
  planStep       PlanStep @relation(fields: [planStepId], references: [id])
}

model PolicyProfile {
  id        String   @id @default(cuid())
  userId    String?
  name      String
  kind      String   // "builtin" | "custom"
  rules     Json     // PolicyRule[] (see §12)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model AuditEvent {
  id            String   @id @default(cuid())
  userId        String?
  type          String
  subjectType   String?
  subjectId     String?
  correlationId String?
  data          Json
  createdAt     DateTime @default(now())
  @@index([userId, createdAt(sort: Desc)])
  @@index([correlationId])
}

model EventOutbox {
  id          String   @id @default(cuid())
  type        String
  payload     Json
  publishedAt DateTime?
  createdAt   DateTime @default(now())
  @@index([publishedAt])
}
```

**Encryption.** Tokens in `ConnectorCredential` are encrypted with AES-256-GCM using a key from `BREEZE_DATA_KEY` (KMS-backed in prod). `keyVersion` enables rotation.

---

## 10. Planner Contracts

The planner is a pure function: `plan(context) => Plan`. It calls the LLM with a strict schema, parses with Zod, and persists. It **never** calls connectors.

```ts
// packages/planner/src/types.ts
export type Intent =
  | "chat"        // pure conversation
  | "retrieve"    // read/gather/summarize
  | "draft"       // propose mutation (no side effects)
  | "act"         // mutate external state
  | "automate";   // create/edit a recurring Task

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";
export type StepKind  = "retrieve" | "summarize" | "draft" | "act" | "wait";

export interface IntentClassification {
  intent: Intent;
  confidence: number;       // 0..1
  reason: string;           // short natural-language rationale
}

export interface RequiredCapability {
  connector: "gmail" | "gcal" | "github" | "files" | "internal";
  capability: string;       // e.g., "gmail.list_threads"
}

export interface ExpectedArtifact {
  kind: "summary" | "draft_email" | "draft_comment" | "event" | "file" | "list";
  description: string;
}

export interface PlanStep {
  id: string;
  index: number;
  kind: StepKind;
  capability?: string;                // required for kind="act" and often for "retrieve"
  input: Record<string, unknown>;
  expectedArtifact?: ExpectedArtifact;
  riskLevel: RiskLevel;
  rationale: string;                  // why this step; user-visible
  dependsOn?: string[];               // ids of prerequisite steps
}

export interface Plan {
  id: string;
  chatId: string;
  messageId: string;
  intent: Intent;
  riskLevel: RiskLevel;               // max over steps
  summaryText: string;                // human-facing one-liner
  steps: PlanStep[];
  requires: RequiredCapability[];
  approvalLikelihood: "none" | "low" | "likely" | "certain";
  createdAt: string;
}
```

### Planner rules
- Output must validate against `PlanSchema` (Zod). If parse fails, the planner retries once with an error repair prompt, else falls back to `intent: "chat"`.
- If a step references a connector the user hasn't connected, the planner replaces that step with a friendly explainer and a `"connect_connector"` internal step.
- The planner gets a **capability catalog** from `@breeze/connectors` so it never invents capabilities.

---

## 11. Broker Contracts

The broker is the **only** path to mutation. Flow:

```
ActionRequest ─► Broker.submit
    ├─ Policy.evaluate  → allow | require_approval | deny
    ├─ if require_approval → create Approval, suspend (Trigger.dev wait token)
    ├─ if allow            → Connector.execute
    └─ record ActionExecution + emit audit + timeline events
```

```ts
// packages/broker/src/types.ts
export interface ActionRequest {
  idempotencyKey: string;           // hash(userId, stepId, capability, targetHash)
  userId: string;
  planStepId: string;
  connector: string;                // "gmail" | "gcal" | ...
  capability: string;               // "gmail.send_reply"
  input: Record<string, unknown>;   // connector-typed; validated by registry
  sensitivityHint?: RiskLevel;
  correlationId: string;            // chat.id or task.run.id
}

export interface ActionContext {
  userId: string;
  policyProfileId: string;
  originatingKind: "chat" | "task";
  taskId?: string;
  chatId?: string;
  connectorAccountId: string;
  traceId: string;
}

export type ActionOutcome =
  | { kind: "allowed"; result: ActionResult }
  | { kind: "approval_required"; approvalId: string }
  | { kind: "denied"; reason: string };

export interface ActionResult {
  ok: boolean;
  output?: Record<string, unknown>; // connector-typed
  artifactIds?: string[];
  errorMessage?: string;
  executionId: string;
}

export interface ActionExecutionRecord {
  id: string;
  planStepId: string;
  capability: string;
  connectorKey: string;
  input: unknown;
  output?: unknown;
  errorMessage?: string;
  idempotencyKey: string;
  startedAt: Date;
  endedAt?: Date;
}

export interface Broker {
  submit(req: ActionRequest): Promise<ActionOutcome>;
  resumeAfterApproval(approvalId: string): Promise<ActionOutcome>;
}
```

### Guardrails
- Input is validated against the connector's capability input schema before anything else.
- Idempotency: if an execution with the same `idempotencyKey` exists and succeeded, return its result.
- All external calls wrapped in circuit breaker + timeout + jittered retry (for safe/read actions only). Mutating actions are retried only if the connector declares `idempotent: true` or we can confirm no write occurred.

---

## 12. Policy Framework

The policy engine is **pure** (no IO except reading the user's profile, which the caller passes in). This makes it testable and cacheable.

```ts
// packages/policy/src/types.ts
export type Decision = "allow" | "require_approval" | "deny";

export interface PolicyInput {
  userId: string;
  profile: PolicyProfile;
  connector: string;
  capability: string;            // "gmail.send_reply"
  capabilityMeta: {
    sensitivity: RiskLevel;
    mutatesState: boolean;
    approvalHint: "never" | "sometimes" | "always";
  };
  context: {
    originatingKind: "chat" | "task";
    taskTrustLevel?: "low" | "normal" | "elevated";
    targetCount?: number;        // e.g. 50 emails
    targetExamples?: unknown[];
  };
}

export interface PolicyOutput {
  decision: Decision;
  reason: string;                // user-facing rationale
  rule: string;                  // which rule fired (for diagnostics)
  approvalTemplate?: "single" | "bulk";
}
```

### Built-in profiles

| Profile                | Default stance                     | Examples                                                                                            |
| ---------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| **Read Only**          | Block all mutations                | Allow list/read; deny send, delete, create, update.                                                 |
| **Ask Before Sending** | Approve outbound + destructive     | Allow drafts, reads, archive; require approval for send_reply, create_event, post_comment, delete_*|
| **Ask Before Mutating**| Approve any state change           | Allow all reads; require approval for any `mutatesState=true`.                                      |
| **Auto-run Safe Actions** (default) | Approve destructive + outbound to 3rd parties | Allow drafts, archive, label; approve send_reply, delete_thread, post_comment. |
| **Power User**         | Trust most, still gate critical    | Approve only `sensitivity=critical` (delete_file, mass archive, send-to-many).                      |
| **Paranoid**           | Approve everything except reads    | Allow only sensitivity=none reads; approve everything else.                                         |

### Deterministic evaluation order
1. Explicit deny rule in profile (connector+capability) → `deny`.
2. Explicit allow rule → `allow`.
3. Per-capability sensitivity vs profile threshold (e.g., Auto-run Safe Actions: threshold=`high`).
4. `mutatesState=true` + `targetCount > bulkThreshold` → always `require_approval` (safety net).
5. Task-scoped override (task can set `autoApproveSameScope=true` for repeated safe actions like daily summary archiving).
6. Default to `require_approval` on ambiguity. We err conservative.

### Rule shape
```ts
interface PolicyRule {
  connector?: string;
  capability?: string;        // wildcards: "gmail.*"
  when?: { mutatesState?: boolean; sensitivityAtLeast?: RiskLevel; bulkOver?: number };
  decision: Decision;
  reason: string;
}
```

---

## 13. Connector Framework

Connectors are narrow, typed, **no raw SDK exposure to the model**. The model only ever sees capability names and schemas published by the registry.

```ts
// packages/connectors/src/types.ts
export interface ConnectorMeta {
  key: string;                    // "gmail"
  displayName: string;
  description: string;
  version: string;
  icon: string;                   // /icons/gmail.svg
  oauth: {
    provider: "google" | "github" | "microsoft" | "local";
    scopes: string[];
    consentUrlFactory: (state: string) => string;
    exchangeCode: (code: string) => Promise<ConnectorTokens>;
    refresh?: (tokens: ConnectorTokens) => Promise<ConnectorTokens>;
  };
}

export interface ConnectorTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  raw: Record<string, unknown>;
}

export interface ConnectorCapability<I = unknown, O = unknown> {
  key: string;                    // "gmail.send_reply"
  displayName: string;
  description: string;
  sensitivity: RiskLevel;
  mutatesState: boolean;
  approvalHint: "never" | "sometimes" | "always";
  inputSchema: ZodSchema<I>;
  outputSchema: ZodSchema<O>;
  idempotent: boolean;            // true => broker may retry on timeout
  rateLimit?: { perMinute: number; perDay?: number };
  execute: (input: I, ctx: ConnectorExecutionContext) => Promise<O>;
}

export interface ConnectorExecutionContext {
  account: ConnectorAccount;
  tokens: ConnectorTokens;
  logger: Logger;
  signal: AbortSignal;
}

export interface Connector {
  meta: ConnectorMeta;
  healthCheck: (ctx: ConnectorExecutionContext) => Promise<{ ok: boolean; message?: string }>;
  capabilities: ConnectorCapability[];
}
```

### Capability sets (v1)

**Gmail**
| Capability           | Sensitivity | Mutates | Approval hint |
| -------------------- | ----------- | ------- | ------------- |
| `gmail.list_threads` | none        | no      | never         |
| `gmail.read_message` | low         | no      | never         |
| `gmail.draft_reply`  | low         | no*     | never         |
| `gmail.send_reply`   | high        | yes     | always        |
| `gmail.archive_thread` | medium    | yes     | sometimes     |
| `gmail.label_thread` | low         | yes     | never         |
| `gmail.delete_thread`| critical    | yes     | always        |

(*draft_reply writes a Gmail draft resource — sensitivity low because it's reversible and not visible to others.)

**Google Calendar**
- `gcal.list_events` (none/no/never)
- `gcal.create_event` (high/yes/always)
- `gcal.update_event` (high/yes/always)
- `gcal.delete_event` (critical/yes/always)
- `gcal.respond_invite` (medium/yes/sometimes)

**GitHub**
- `github.list_notifications` (none/no/never)
- `github.read_issue` (none/no/never)
- `github.draft_comment` (low/no/never)
- `github.post_comment` (high/yes/always)
- `github.list_pull_requests` (none/no/never)
- `github.watch_repo` (low/yes/never) — internal subscription for recurring tasks

**Files** (user-uploaded docs in S3 + optional Drive later)
- `files.list_files` (none/no/never)
- `files.read_file` (low/no/never)
- `files.summarize_file` (low/no/never)
- `files.move_file` (medium/yes/sometimes)
- `files.delete_file` (critical/yes/always)

### Error normalization
Every connector maps provider errors into a common taxonomy:
- `AuthError` — triggers reauth flow (account `status=NEEDS_REAUTH`).
- `RateLimitError` — broker backs off; Trigger.dev retries with delay.
- `NotFoundError`, `PermissionError`, `ConflictError`, `UpstreamError`, `UnknownError`.

### Registration pattern
```ts
// packages/connectors/src/registry.ts
export const ConnectorRegistry = new Map<string, Connector>();
export function registerConnector(c: Connector) { ConnectorRegistry.set(c.meta.key, c); }

// packages/connectors/src/gmail/index.ts
registerConnector({ meta: gmailMeta, healthCheck, capabilities: [listThreads, readMessage, ...] });
```
Registry is imported by both the app server and Trigger.dev workflows — single source of truth.

---

## 14. Memory Framework

Three kinds only. No vector store in MVP.

| Kind           | When written                                                          | Who reads                         | Retention                           | Editable? |
| -------------- | --------------------------------------------------------------------- | --------------------------------- | ----------------------------------- | --------- |
| **Conversation** | Summarized chat history (rolling), per chat                         | planner for that chat only        | Follows chat; rolled/pruned at 6k tokens | No (regen only) |
| **User**         | Stable facts/preferences, either user-declared or model-proposed → user-confirmed | planner across chats & tasks | Forever until user deletes          | Yes       |
| **Working**      | Task/session scratchpad (fetched object refs, pending context)      | current orchestration only        | 24h TTL, or end-of-task             | No (internal) |

### Shape
```ts
export interface MemoryRecord<V = unknown> {
  id: string;
  userId: string;
  type: "conversation" | "user" | "working";
  scope?: string;           // chatId for conversation, taskRunId for working
  key: string;              // machine-friendly key, e.g. "prefers.tone" or "chat.12.summary"
  value: V;
  source: { kind: "message" | "task" | "system" | "user_declared"; id?: string };
  reason: string;           // "You said you prefer short emails on 2026-04-10"
  visibility: "user_visible" | "internal";
  expiresAt?: Date;
}
```

### Read path
- Planner receives a **memory pack**: top-K user memories (keyword-matched by intent tags), plus the conversation memory for the current chat, plus any working memory scoped to the current task run.
- Matching is keyword + recency + type-priority. We add embeddings only if relevance becomes a measurable UX problem.

### Write path
- Writes originate only from:
  1. user explicit ("remember that I…"),
  2. planner proposal (creates a **candidate** memory with `visibility=internal`), which must be user-confirmed in the Memory page before `user_visible`. Confirmation is a one-click "Save" in a subtle toast.
- All writes produce a `memory.saved` event.

### UI rules
- Every memory shows *reason*, *source*, *retention*.
- Delete is hard delete + audit log.
- Export as JSON from Settings → Privacy.

### Why no vectors in MVP
- v1 memory volume is small (user preferences + chat summaries).
- Keyword + summary recall is plenty at this scale.
- Avoids pgvector ops surface and chunking UX choices.
- Add `pgvector` in v2 once relevance measurably hurts.

---

## 15. Approvals Framework

Approvals are how Breeze earns trust. They are **first-class, linked, expiring, and editable**.

```ts
export interface Approval {
  id: string;
  userId: string;
  planStepId: string;
  actionRequest: ActionRequest;
  preview: ApprovalPreview;           // rendered, human-readable
  risk: RiskLevel;
  status: "pending" | "approved" | "denied" | "expired" | "superseded" | "canceled";
  expiresAt: string;
  decidedAt?: string;
  decisionNote?: string;
  waitToken?: string;                 // Trigger.dev token to resume workflow
}

export interface ApprovalPreview {
  title: string;                      // "Send reply to Alice"
  serviceIcon: string;                // /icons/gmail.svg
  targetSummary: string;              // "Thread: 'Project X' (3 messages)"
  payloadDiff?: { before?: string; after: string };
  undoable: boolean;
  changedSincePlan?: string[];        // e.g. ["thread added 1 new message"]
  alternatives?: Array<{ label: string; actionRequest: ActionRequest }>;
}
```

### Lifecycle
```
pending ──approve──► approved ──► broker.resume → execute
      ──deny────► denied
      ──edit────► supersedes (new approval, old → superseded)
      ──expire──► expired (watchdog)
      ──cancel──► canceled (plan canceled)
```

### Rules
- Expiration default: 24h for mutating, 72h for drafts, 7d for task-scoped periodic actions.
- Watchdog task (Trigger.dev cron, every 5 min) expires `pending` past `expiresAt`, emits `approval.expired`, and sets plan step to `failed(expired)`.
- **Bulk approvals**: when a plan produces >1 action of the same `(connector, capability)` on similar targets (e.g., archive 12 threads), they are grouped; one approval row with `count` and `targets[]`. Approving approves all; denying denies all; edit-to-exclude-some is supported.
- **Task-level inheritance**: a Task can declare `approvalMode: "per_run" | "once_on_create" | "policy"`. `once_on_create` means the user approves a template; subsequent runs skip approval for matching actions within the same template bounds (and within bulk/scope limits).
- **Revision requests**: user clicks "Edit" → modifies preview payload (e.g., email body). Submits → creates a new Approval, supersedes the old, plan step updates input.
- **Changed since plan generation**: on approve, the broker re-reads the target and shows a diff if the underlying object changed (e.g., the thread got a new message). User must re-confirm.
- Approval actions all emit AuditEvents with full before/after.

---

## 16. Tasks & Workflows Framework

Built on Trigger.dev.

### Task model
```ts
export interface Task {
  id: string;
  userId: string;
  name: string;                       // "Morning email + calendar summary"
  description?: string;
  prompt: string;                     // the natural-language spec
  schedule: TaskSchedule;
  policyProfileId?: string;           // optional override
  approvalMode: "per_run" | "once_on_create" | "policy";
  status: "active" | "paused" | "failed" | "archived";
  lastRunAt?: string;
  nextRunAt?: string;
  triggerTaskId?: string;             // Trigger.dev identifier
}

export type TaskSchedule =
  | { kind: "cron"; cron: string; tz: string }
  | { kind: "once"; runAt: string }
  | { kind: "watch"; source: { connector: string; resource: string; pollSeconds: number } };

export interface TaskRun {
  id: string;
  taskId: string;
  status: "running" | "completed" | "failed" | "canceled" | "waiting_approval";
  startedAt: string;
  endedAt?: string;
  summary?: string;
  planId?: string;
  errorMessage?: string;
  logs: TaskRunLog[];
}

export interface TaskRunLog {
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
}
```

### Engine
- One Trigger.dev task per schedule kind:
  - `breeze.task.cron` (scheduled, per-user cron).
  - `breeze.task.watch` (polls a connector resource and fires `ChatTurn` when delta detected).
  - `breeze.task.longChatTurn` (used when a planner turn will take >20s or needs `wait.forToken`).
- Each run of a user task creates a `TaskRun`, spins up a Planner → Broker cycle with `originatingKind: "task"`.
- Approvals: broker creates Approval with a Trigger.dev wait token; the task pauses via `wait.forToken(token, expire)`. User decision hits our API, which calls Trigger.dev `tokens.complete` to resume.
- Cancellation: Task.cancelRun → Trigger.dev cancel; DB marks run canceled.
- Retry: safe retrieval/summarization steps retry via Trigger.dev's retry config. Mutating steps never auto-retry unless `idempotent=true`.
- Run-now button creates a one-off trigger with `triggerTaskId` but bypasses schedule.

### Use-case mapping
- "Every morning at 8 summarize unread emails and calendar" → `cron: "0 8 * * *"`, policy allows reads + draft summary, no approval.
- "Watch this repo weekly for releases" → `cron: "0 9 * * MON"`, GitHub read-only.
- "Check files for invoices every Friday" → cron, file reads + summarize, write invoice findings to Memory (user-visible).
- "Remind me when a new PR is merged" → `watch`, polls GitHub notifications every N minutes; sends in-app notification (+ email if enabled).

### Task-scoped memory
Each `TaskRun` has a working memory bucket keyed by `taskRunId`. It is available to the planner during the run and garbage-collected 24h after the run ends.

---

## 17. API Design

Next.js route handlers under `app/api/*`. Conventions:
- JSON in/out. Zod-validated.
- Auth via `auth()` helper (Auth.js); unauthenticated returns 401.
- Mutating routes accept `Idempotency-Key` header.
- Errors: `{ error: { code, message, details? } }`, HTTP status matches.
- SSE endpoint for live timeline updates.

### Auth
| Method | Path                          | Purpose                             | Auth  |
| ------ | ----------------------------- | ----------------------------------- | ----- |
| GET    | `/api/auth/session`           | Current session (Auth.js default)   | Any   |
| ALL    | `/api/auth/[...nextauth]`     | Auth.js handler                     | Any   |

### Chats
| GET  | `/api/chats`                      | List chats (paginated)                 | User |
| POST | `/api/chats`                      | Create chat `{ title? }`               | User |
| GET  | `/api/chats/:id`                  | Get chat + last N messages             | Owner|
| PATCH| `/api/chats/:id`                  | Rename/archive                         | Owner|
| DELETE | `/api/chats/:id`                | Soft-delete                            | Owner|
| GET  | `/api/chats/:id/messages`         | Paginated messages                     | Owner|
| POST | `/api/chats/:id/messages`         | Send user message → start turn (SSE)   | Owner|
| POST | `/api/chats/:id/cancel`           | Cancel current plan                    | Owner|

### Plans (read-only to users; internal to broker)
| GET  | `/api/plans/:id`                  | Get plan + steps + executions          | Owner|

### Approvals
| GET  | `/api/approvals`                  | List (status filter)                   | User |
| GET  | `/api/approvals/:id`              | Detail                                 | Owner|
| POST | `/api/approvals/:id/approve`      | Approve (+ optional edited payload)    | Owner|
| POST | `/api/approvals/:id/deny`         | Deny                                   | Owner|
| POST | `/api/approvals/:id/cancel`       | Cancel (supersede)                     | Owner|

### Tasks
| GET  | `/api/tasks`                      | List tasks                             | User |
| POST | `/api/tasks`                      | Create task                            | User |
| GET  | `/api/tasks/:id`                  | Detail                                 | Owner|
| PATCH| `/api/tasks/:id`                  | Update (schedule, prompt, policy)      | Owner|
| DELETE | `/api/tasks/:id`                | Archive                                | Owner|
| POST | `/api/tasks/:id/pause`            | Pause                                  | Owner|
| POST | `/api/tasks/:id/resume`           | Resume                                 | Owner|
| POST | `/api/tasks/:id/run`              | Run now                                | Owner|
| GET  | `/api/tasks/:id/runs`             | Run history                            | Owner|
| GET  | `/api/tasks/:id/runs/:runId`      | Run detail                             | Owner|

### Connectors
| GET  | `/api/connectors`                 | List installed + available             | User |
| POST | `/api/connectors/:key/connect`    | Start OAuth (returns consent URL)      | User |
| GET  | `/api/connectors/:key/oauth/callback` | OAuth finish                       | User |
| POST | `/api/connectors/:key/reconnect`  | Same as connect but keeps account id   | User |
| POST | `/api/connectors/:key/disconnect` | Revoke + delete credentials            | User |
| POST | `/api/connectors/:key/healthcheck`| Force healthcheck                      | User |

### Memory
| GET  | `/api/memory`                     | List (filter type)                     | User |
| POST | `/api/memory`                     | Create user memory                     | User |
| PATCH| `/api/memory/:id`                 | Edit value                             | Owner|
| DELETE | `/api/memory/:id`               | Delete                                 | Owner|
| GET  | `/api/memory/export`              | Export JSON                            | User |

### Settings
| GET  | `/api/settings`                   | Get (models, privacy, policy id, notifs)| User |
| PATCH| `/api/settings`                   | Update                                 | User |
| GET  | `/api/settings/policies`          | List policy profiles                   | User |
| POST | `/api/settings/policies/:id/select`| Select active profile                 | User |

### Admin (role=ADMIN)
| GET  | `/api/admin/users`                | List users                             | Admin|
| GET  | `/api/admin/runs`                 | Recent Trigger.dev runs                | Admin|
| GET  | `/api/admin/audit`                | Audit tail                             | Admin|

### Events
| GET  | `/api/events/stream?topic=chat:ID`| SSE stream of timeline events for subject | User |

### Schemas (exemplars)
```ts
// POST /api/chats/:id/messages request
const PostMessage = z.object({
  content: z.string().min(1).max(20_000),
  attachments: z.array(z.object({ blobKey: z.string(), name: z.string() })).optional(),
});
// Response: SSE stream of typed events:
//   turn.started, plan.created, step.started, step.progress, approval.requested,
//   step.completed, turn.completed, turn.error
```

---

## 18. Event Model

All significant state transitions publish an event via the **transactional outbox**. Events drive the UI timeline, audit log, and optional webhooks.

### Envelope
```ts
export interface EventEnvelope<T extends string = string, P = unknown> {
  id: string;
  type: T;                      // "chat.message_received"
  source: "app" | "worker";
  userId?: string;
  correlationId?: string;       // chatId or taskRunId
  causationId?: string;         // previous event id
  subject?: { type: string; id: string };
  payload: P;
  createdAt: string;
  traceId?: string;
}
```

### Topics
- `chat.message_received`, `chat.turn_started`, `chat.turn_completed`, `chat.turn_failed`
- `plan.created`, `plan.failed`, `plan.canceled`
- `step.started`, `step.completed`, `step.failed`
- `action.requested`, `action.started`, `action.completed`, `action.failed`
- `approval.requested`, `approval.approved`, `approval.denied`, `approval.expired`
- `task.created`, `task.updated`, `task.paused`, `task.resumed`, `task.run_started`, `task.run_completed`, `task.run_failed`
- `connector.connected`, `connector.reauth_required`, `connector.refresh_failed`, `connector.disconnected`
- `memory.saved`, `memory.updated`, `memory.deleted`
- `policy.decision` (diagnostics only, admin-visible)

### Storage
- Writes inside a DB transaction with the domain write (outbox row in same tx).
- A Trigger.dev cron (`event.dispatch`, every 5s) publishes to:
  - `AuditEvent` table (subset: auth, approvals, actions, connector changes, memory ops).
  - In-process pub/sub (Redis) for SSE fanout.
- User-facing timeline is built from `AuditEvent` filtered by `correlationId`.

### Mapping to UI timeline
Events are translated into a `TimelineItem` by a small rendering module (`components/timeline/render.ts`) so the UI shows plain English like *"Archived 3 threads in Gmail"*, not raw event JSON.

---

## 19. Security Model

### Auth / session
- Auth.js v5, JWT strategy with short-lived access token (15m) in httpOnly cookie + refresh via sliding session.
- CSRF: Auth.js built-in + SameSite=Lax cookies; mutating API routes verify origin.
- Logout invalidates refresh token server-side.

### Connector tokens
- AES-256-GCM encryption at rest. Key from `BREEZE_DATA_KEY` (env var in dev, KMS-managed secret in prod).
- Tokens never leave the server. Browser never sees access/refresh tokens.
- Token refresh guarded by Redis mutex `connector:{id}:refresh` (no thundering herd).

### Secrets
- `.env` for local dev; secret manager (AWS SSM / Doppler / Vault) in prod.
- No secrets in client bundles (enforced by `NEXT_PUBLIC_*` audit).

### Route authorization
- Every API handler goes through `requireUser()` → `{ user, session }`. Owner check for resource routes.
- Admin routes require `role=ADMIN`.
- Policy engine enforces action-level authorization; route handlers never call connectors directly.

### XSS / CSP
- Strict CSP: `default-src 'self'; script-src 'self' 'nonce-…'; connect-src 'self' https://api.openai.com …`.
- All user-generated content rendered as text or through a safe markdown renderer (no `dangerouslySetInnerHTML` on user data).

### Anti-abuse
- Rate limits via Redis (token bucket): 60 messages/hr/user, 10 connector connect attempts/hr, 5 password-protected operations/min.
- LLM cost ceilings per user per day (configurable); soft-block with clear UX.

### Approvals as hard gate
- Broker never executes a mutating action without `Policy.decision=allow` **or** an approved `Approval` linked to the exact `actionRequest.idempotencyKey`.
- Approval approval must be a human action (UI or email link with one-time token); no programmatic self-approval.

### File access containment
- User-uploaded files live in S3 under `users/{userId}/...`; signed URLs (short-lived) for reads.
- Files connector capabilities scope reads to user's namespace.
- No arbitrary filesystem access. No shell execution.

### Browser automation
- **Not in v1.** When added (v2+), runs in a sandboxed VM (Browserbase/Playwright worker) with strict egress rules; exposed only through narrow capabilities gated by Paranoid-mode approvals.

### Audit logging
- AuditEvents are append-only; admin read-only. Include actor, subject, action, diff when applicable.
- Retention ≥ 365 days.

### Hosted vs self-hosted trust
- Hosted: Breeze operator holds KMS key; user must trust the operator.
- Self-hosted: all secrets in user infra; docs explain env/KMS setup. Same code path.

### Least privilege
- OAuth scopes are the **minimum** per capability: Gmail `gmail.modify` (never `gmail.settings`), Calendar `calendar.events`, GitHub per-repo scope where possible (user selects), Files local-only.
- Admin role is distinct; no admin impersonation in v1.

---

## 20. Observability

### Logs
- **App logs** (Pino): structured JSON, `correlationId`, `userId?`, `route`, `latency`.
- **Worker logs** via Trigger.dev's built-in run logs + same Pino format, shipped.
- **Connector logs**: every connector call logs `{ connector, capability, inputHash, durationMs, outcome }`. No PII by default (`inputHash` only unless dev mode).

### Metrics (OTel → Grafana/Datadog)
- `breeze.chat.turn.latency` (histogram), labels: `intent`, `risk`.
- `breeze.plan.steps` (histogram).
- `breeze.broker.actions{connector,capability,outcome}` (counter).
- `breeze.approvals.pending` (gauge) / `breeze.approvals.resolved{decision}`.
- `breeze.connector.refresh{connector,outcome}`.
- `breeze.task.runs{status}`.

### Traces
- OpenTelemetry spans across: route handler → service → planner → broker → connector → external HTTP.
- `traceId` propagates into `EventEnvelope` and `AuditEvent`.

### Timeline (user-visible)
- Plain-English stream: *"Read 12 unread emails from Gmail", "Drafted reply to Alice", "Waiting for your approval to send"*.
- Generated from events via `renderTimelineItem(event)`.

### Diagnostics views (admin)
- Run inspector: plan + steps + executions + events for a given `chatId` or `taskRunId`.
- Policy trace: for a given action request, show the full `PolicyInput` and `PolicyOutput` with which rule fired.
- Connector failures: grouped by connector with reason + last 10 errors.

### Errors (Sentry)
- All uncaught server/client errors, Sentry tagged with `userId`, `route`, `correlationId`.

---

## 21. Onboarding

**Goal**: First meaningful output in under 2 minutes.

Flow (UI):

1. **Landing / sign-in** — single primary CTA *"Continue with Google"* (GitHub secondary). No account form. (Local/dev mode shows "Use local demo account".)
2. **Welcome card** — 3 lines: "Breeze reads your stuff, drafts actions, and only acts when you say ok."
3. **Pick AI provider** — cards: OpenAI / Anthropic / Google / OpenRouter. Default preselected based on availability; "You can change this anytime."
4. **Connect first service** — guided: "Which service do you use most?" → Gmail / Calendar / GitHub / Files. One click → OAuth → back to app.
5. **One-paragraph explainer of approvals** — a single dismissible card with an example screenshot of an approval. No docs.
6. **Ask for first useful goal** — chat composer seeded with suggestions like:
   - "Summarize today's important emails"
   - "What meetings do I have tomorrow?"
   - "Summarize the last 10 commits in my repo"
7. **First success** — streamed plan → retrieval → summary. No approval needed for read-only. UI highlights the timeline: *"Breeze read 37 emails in 8s and picked 5 that matter."*
8. **Nudge to set a Task** — after first success: "Want this every morning?" → one-click create from the last plan.

### Tone
- Second person. Short sentences. No jargon (no "agents", "tools", "RAG").
- Never say "sorry" unless actually sorry.

---

## 22. MVP Scope

### In MVP
- Web UI (dashboard, chat, tasks, approvals, connectors, memory, settings).
- Auth.js with Google + GitHub OAuth.
- Chat with streaming, planner, broker, policy.
- Connectors: Gmail, Google Calendar, GitHub (read + draft comment + notifications), Files (upload + read + summarize + move/delete).
- Approvals with edit-before-approve, bulk, expiration, audit.
- Tasks: cron + once; run-now, pause/resume; run history.
- Memory: conversation + user + working (no vectors).
- Policy profiles: all 6 built-ins; one custom profile editor (simple allow/approve/deny list).
- Audit timeline (user-visible) + admin run inspector.
- Observability: Pino logs + OTel + Sentry.
- Dark/light theme, mobile responsive.

### Explicitly out of MVP
- Mobile-native apps.
- Voice.
- Plugin marketplace / user-defined connectors.
- Shell execution.
- Generic browser automation.
- Enterprise org admin, SSO, SCIM, multi-user.
- Team collaboration features.
- Full vector memory; advanced semantic recall.
- Local models (abstraction ready, adapter not built).

---

## 23. Milestones (90-Day Build Plan, ordered by dependency, not calendar)

### Phase 0 — Foundation
- Goal: monorepo live; DB migrates; CI green.
- Workstreams: pnpm workspaces; Turbo pipelines; Next.js app boots; Prisma schema `User/Session/Chat/Message`; Auth.js wiring; CI on GitHub Actions; Dockerfile for `apps/web` + Trigger.dev dev loop; shadcn installed; design tokens.
- DoD: `pnpm dev` runs, signup works, you can create a chat and send a message that echoes.

### Phase 1 — App shell & auth
- Goal: product shell ready.
- Workstreams: sidebar + topbar + route group `(app)`; onboarding flow steps 1–3; settings skeleton; dashboard cards (stubs).
- Risks: design drift; lock tokens early.
- DoD: Navigable app shell with placeholders; dark/light; mobile drawer.

### Phase 2 — Chat & planner
- Goal: end-to-end chat with a typed plan.
- Workstreams: `@breeze/ai` provider abstraction; `@breeze/planner` with Zod-validated LLM output; SSE streaming; chat page with timeline + artifacts (no actions yet).
- Risks: plan parsing flakiness → mitigation: repair-retry + strict schema + golden tests.
- DoD: User asks "what's 2+2" → plan `intent: chat` → answer streams; "summarize this chat" works on local data.

### Phase 3 — Broker & policy
- Goal: broker is the only mutation gate; policy decides.
- Workstreams: `@breeze/broker` + `@breeze/policy`; built-in profiles; action execution records; idempotency; audit events.
- DoD: a test connector with `echo.allow` and `echo.destructive` capability; policy test suite green; broker refuses to run `act` without policy pass.

### Phase 4 — Connectors
- Goal: Gmail, Calendar, GitHub, Files live with typed capabilities.
- Workstreams: OAuth flows; token vault (encryption); health checks; per-capability tests against provider sandboxes.
- Risks: OAuth consent UX; token refresh races; mitigated by Redis mutex + reauth UX.
- DoD: connect Gmail → chat "list unread from Alice" returns real threads.

### Phase 5 — Approvals
- Goal: users can approve, edit, deny.
- Workstreams: approval creation in broker; Trigger.dev wait tokens; approvals UI with bulk + edit; expiration watchdog.
- DoD: "archive all from Alice" → approval preview → approve → action executes, audit logged.

### Phase 6 — Tasks & workflows
- Goal: scheduled + watch tasks.
- Workstreams: `@breeze/workflows`; cron scheduler; run history; run-now; pause/resume; task creation flow from UI + from chat ("save this as a daily task").
- DoD: "every morning summarize unread emails" ships a report at 8am and creates a `memory.user` entry with the day's summary.

### Phase 7 — Memory
- Goal: user-visible, editable memory.
- Workstreams: memory read-pack for planner; user memory UI; candidate memory proposals; retention cron.
- DoD: user edits a memory, next chat respects it.

### Phase 8 — Observability & admin
- Goal: diagnose any failed run fast.
- Workstreams: OTel wiring; admin run inspector; policy trace viewer; connector failure dashboard.
- DoD: given a failed chat id, admin can see the full event chain in one view.

### Phase 9 — Polish & beta hardening
- Goal: ready for external users.
- Workstreams: empty states; error boundaries; onboarding polish; rate limits; cost caps; security review; docs; pricing/plan gates (optional).
- DoD: 10 beta users, no P0 bugs for a week, SLO: p95 chat turn start < 1.5s.

---

## 24. Monorepo Structure

```
breeze/
├─ apps/
│  └─ web/                      # Next.js app (UI + route handlers + server actions)
│     ├─ app/
│     ├─ src/server/            # domain services, guards, events
│     ├─ src/components/
│     ├─ src/hooks/
│     ├─ src/stores/
│     └─ src/lib/
├─ packages/
│  ├─ ui/                       # shadcn-based design system
│  ├─ db/                       # Prisma schema + client + encryption
│  ├─ ai/                       # provider abstraction (OpenAI/Anthropic/Google/OpenRouter)
│  ├─ planner/                  # planner service + types + prompts
│  ├─ broker/                   # action broker
│  ├─ policy/                   # pure policy engine
│  ├─ connectors/               # registry + Gmail/Calendar/GitHub/Files
│  ├─ memory/                   # memory read/write/retention
│  ├─ workflows/                # Trigger.dev task definitions
│  └─ common/                   # Zod schemas, event envelope, ids, errors, utils
├─ infra/                       # Dockerfile, compose, migration scripts
├─ scripts/
├─ .github/workflows/           # CI
├─ turbo.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ package.json
└─ README.md
```

**Why these packages?**
- `ui` — prevents design drift; single source for primitives.
- `db` — single Prisma client; migrations; no N-way schema drift.
- `ai` — provider swapping; keeps model code out of feature files.
- `planner` — swappable prompt strategy; golden tests; no IO besides AI call.
- `broker` — the hard boundary for mutations; auditable.
- `policy` — pure; unit-tested like gold; used from app + worker.
- `connectors` — typed capability registry; shared with planner catalog + broker executor.
- `memory` — clear read/write paths; retention in one place.
- `workflows` — all Trigger.dev tasks colocated so we can version them together.
- `common` — stops drift of Zod schemas, event shapes, errors between app and worker.

---

## 25. TypeScript Starter Interfaces

(Shipped in `packages/common/src/types.ts` + per-package type files. Full code in the scaffold.)

```ts
// packages/common/src/types.ts
export type ID = string;
export type ISO = string;

export type RiskLevel = "none" | "low" | "medium" | "high" | "critical";
export type Intent    = "chat" | "retrieve" | "draft" | "act" | "automate";
export type StepKind  = "retrieve" | "summarize" | "draft" | "act" | "wait";

export interface Plan {
  id: ID;
  chatId: ID;
  messageId: ID;
  intent: Intent;
  riskLevel: RiskLevel;
  summaryText: string;
  steps: PlanStep[];
  approvalLikelihood: "none" | "low" | "likely" | "certain";
  createdAt: ISO;
}

export interface PlanStep {
  id: ID;
  index: number;
  kind: StepKind;
  capability?: string;
  input: Record<string, unknown>;
  expectedArtifact?: { kind: string; description: string };
  riskLevel: RiskLevel;
  rationale: string;
  dependsOn?: ID[];
}

export interface ActionRequest {
  idempotencyKey: string;
  userId: ID;
  planStepId: ID;
  connector: string;
  capability: string;
  input: Record<string, unknown>;
  sensitivityHint?: RiskLevel;
  correlationId: ID;
}

export interface ActionResult {
  ok: boolean;
  executionId: ID;
  output?: Record<string, unknown>;
  artifactIds?: ID[];
  errorMessage?: string;
}

export type Decision = "allow" | "require_approval" | "deny";

export interface PolicyDecision {
  decision: Decision;
  reason: string;
  rule: string;
  approvalTemplate?: "single" | "bulk";
}

export interface Approval {
  id: ID;
  userId: ID;
  planStepId: ID;
  actionRequest: ActionRequest;
  preview: {
    title: string;
    serviceIcon: string;
    targetSummary: string;
    payloadDiff?: { before?: string; after: string };
    undoable: boolean;
    changedSincePlan?: string[];
  };
  risk: RiskLevel;
  status: "pending" | "approved" | "denied" | "expired" | "superseded" | "canceled";
  expiresAt: ISO;
  waitToken?: string;
  decidedAt?: ISO;
  decisionNote?: string;
}

export interface Task {
  id: ID;
  userId: ID;
  name: string;
  description?: string;
  prompt: string;
  schedule:
    | { kind: "cron"; cron: string; tz: string }
    | { kind: "once"; runAt: ISO }
    | { kind: "watch"; source: { connector: string; resource: string; pollSeconds: number } };
  approvalMode: "per_run" | "once_on_create" | "policy";
  policyProfileId?: ID;
  status: "active" | "paused" | "failed" | "archived";
  lastRunAt?: ISO;
  nextRunAt?: ISO;
  triggerTaskId?: string;
}

export interface TaskRun {
  id: ID;
  taskId: ID;
  status: "running" | "completed" | "failed" | "canceled" | "waiting_approval";
  startedAt: ISO;
  endedAt?: ISO;
  summary?: string;
  planId?: ID;
  errorMessage?: string;
}

export interface MemoryRecord<V = unknown> {
  id: ID;
  userId: ID;
  type: "conversation" | "user" | "working";
  scope?: string;
  key: string;
  value: V;
  source: { kind: "message" | "task" | "system" | "user_declared"; id?: ID };
  reason: string;
  visibility: "user_visible" | "internal";
  expiresAt?: ISO;
  createdAt: ISO;
  updatedAt: ISO;
}

export interface ConnectorCapability<I = unknown, O = unknown> {
  key: string;
  displayName: string;
  description: string;
  sensitivity: RiskLevel;
  mutatesState: boolean;
  approvalHint: "never" | "sometimes" | "always";
  idempotent: boolean;
  inputSchema: unknown; // z.ZodSchema<I> in real code
  outputSchema: unknown;
  rateLimit?: { perMinute: number; perDay?: number };
}

export interface EventEnvelope<T extends string = string, P = unknown> {
  id: ID;
  type: T;
  source: "app" | "worker";
  userId?: ID;
  correlationId?: ID;
  causationId?: ID;
  subject?: { type: string; id: ID };
  payload: P;
  createdAt: ISO;
  traceId?: string;
}
```

---

## 26. Starter Pseudocode

### 26.1 Chat route handler
```ts
// apps/web/app/api/chats/[id]/messages/route.ts
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await requireUser(req);
  const body = await readJson(req, PostMessage);
  const chat = await ChatService.getOwned(params.id, user.id);

  const userMessage = await ChatService.appendUserMessage(chat.id, body);

  const stream = sse();
  runChatTurn({ chat, user, userMessage, stream }).catch((err) => stream.error(err));
  return stream.response(); // SSE
}

async function runChatTurn({ chat, user, userMessage, stream }) {
  stream.send({ type: "turn.started", chatId: chat.id });

  const ctx = await ChatService.buildContext(chat, user);                // history + memory pack
  const plan = await Planner.plan(ctx, userMessage);                     // typed Plan, persisted
  stream.send({ type: "plan.created", plan });

  for (const step of plan.steps) {
    stream.send({ type: "step.started", stepId: step.id });
    if (step.kind === "retrieve" || step.kind === "summarize" || step.kind === "draft") {
      const result = await Retriever.run(step, ctx);
      await ChatService.recordStepResult(step.id, result);
      stream.send({ type: "step.completed", stepId: step.id, artifacts: result.artifacts });
    } else if (step.kind === "act") {
      const actionReq = buildActionRequest(step, user, chat.id);
      const outcome = await Broker.submit(actionReq);
      if (outcome.kind === "approval_required") {
        stream.send({ type: "approval.requested", approvalId: outcome.approvalId, stepId: step.id });
        break; // plan pauses; resumes on approval via worker
      }
      stream.send({ type: "step.completed", stepId: step.id, result: outcome.result });
    }
  }

  stream.send({ type: "turn.completed" });
  stream.close();
}
```

### 26.2 Planner service
```ts
// packages/planner/src/index.ts
export async function plan(ctx: PlannerContext, message: Message): Promise<Plan> {
  const catalog = ConnectorRegistry.publicCatalog(ctx.userId);           // only connected + public meta
  const prompt  = buildPlannerPrompt({ ctx, message, catalog });
  const raw     = await AI.complete({ model: ctx.model, prompt, schema: PlanSchema });
  const plan    = PlanSchema.parse(raw);                                  // Zod
  return PlanRepo.persist(plan);
}
```

### 26.3 Broker service
```ts
// packages/broker/src/index.ts
export async function submit(req: ActionRequest): Promise<ActionOutcome> {
  // 1. idempotency short-circuit
  const existing = await ExecRepo.findByIdempotencyKey(req.idempotencyKey);
  if (existing?.output) return { kind: "allowed", result: toResult(existing) };

  // 2. validate input against connector capability
  const cap = ConnectorRegistry.requireCapability(req.connector, req.capability);
  cap.inputSchema.parse(req.input);

  // 3. policy
  const profile = await PolicyRepo.forUser(req.userId);
  const decision = Policy.evaluate({
    userId: req.userId,
    profile,
    connector: req.connector,
    capability: req.capability,
    capabilityMeta: cap,
    context: inferContext(req),
  });
  await Audit.emit("policy.decision", { req, decision });

  if (decision.decision === "deny") return { kind: "denied", reason: decision.reason };

  if (decision.decision === "require_approval") {
    const approval = await Approvals.create(req, cap, decision);
    return { kind: "approval_required", approvalId: approval.id };
  }

  // 4. execute
  return executeNow(req, cap);
}

export async function resumeAfterApproval(approvalId: string) {
  const approval = await Approvals.requireApproved(approvalId);
  const cap = ConnectorRegistry.requireCapability(
    approval.actionRequest.connector,
    approval.actionRequest.capability
  );
  return executeNow(approval.actionRequest, cap);
}

async function executeNow(req: ActionRequest, cap: ConnectorCapability) {
  const account = await Connectors.getAccount(req.userId, req.connector);
  const tokens  = await Connectors.getFreshTokens(account);
  const exec    = await ExecRepo.startExecution(req);
  try {
    const output = await cap.execute(req.input, { account, tokens, logger, signal: AbortSignal.timeout(30_000) });
    await ExecRepo.completeExecution(exec.id, output);
    await Audit.emit("action.completed", { req, output });
    return { kind: "allowed", result: { ok: true, executionId: exec.id, output } };
  } catch (err) {
    await ExecRepo.failExecution(exec.id, err);
    await Audit.emit("action.failed", { req, err: normalize(err) });
    return { kind: "allowed", result: { ok: false, executionId: exec.id, errorMessage: String(err) } };
  }
}
```

### 26.4 Policy evaluator
```ts
// packages/policy/src/index.ts
export function evaluate(input: PolicyInput): PolicyDecision {
  for (const rule of matchingDenyRules(input.profile, input)) {
    return { decision: "deny", reason: rule.reason, rule: rule.id };
  }
  for (const rule of matchingAllowRules(input.profile, input)) {
    if (!triggersBulkSafety(input)) return { decision: "allow", reason: rule.reason, rule: rule.id };
  }
  if (input.capabilityMeta.mutatesState && input.context.targetCount && input.context.targetCount > BULK_SAFETY_THRESHOLD) {
    return { decision: "require_approval", reason: "Bulk mutation safety", rule: "system.bulk_safety", approvalTemplate: "bulk" };
  }
  if (!input.capabilityMeta.mutatesState) return { decision: "allow", reason: "Read-only", rule: "system.read_only" };
  return { decision: "require_approval", reason: "Default conservative", rule: "system.default" };
}
```

### 26.5 Approval creation flow
```ts
// packages/broker/src/approvals.ts
export async function create(req: ActionRequest, cap: ConnectorCapability, decision: PolicyDecision) {
  const preview = await buildPreview(req, cap);
  const approval = await ApprovalRepo.create({
    userId: req.userId,
    planStepId: req.planStepId,
    actionRequest: req,
    preview,
    risk: cap.sensitivity,
    expiresAt: addHours(new Date(), cap.mutatesState ? 24 : 72),
  });

  const { token } = await trigger.tokens.create({ timeout: `${24}h` });    // Trigger.dev wait token
  await ApprovalRepo.attachWaitToken(approval.id, token);

  await Audit.emit("approval.requested", { approvalId: approval.id });
  return approval;
}

// API handler: POST /api/approvals/:id/approve
export async function approve(id: string, user: User, edit?: Partial<ActionRequest>) {
  const approval = await ApprovalRepo.requirePending(id, user.id);
  if (edit) await ApprovalRepo.superseedWithEdit(approval, edit);
  const approved = await ApprovalRepo.markApproved(id);
  await trigger.tokens.complete(approved.waitToken!, { approvalId: id });
  await Audit.emit("approval.approved", { approvalId: id });
  return approved;
}
```

### 26.6 Trigger.dev task runner
```ts
// packages/workflows/src/tasks/userTask.ts
import { task, wait } from "@trigger.dev/sdk/v3";

export const breezeUserTask = task({
  id: "breeze.task.run",
  run: async ({ taskId, triggerKind }: { taskId: string; triggerKind: "schedule" | "run_now" | "watch" }) => {
    const task = await Tasks.get(taskId);
    const run = await Tasks.startRun(task.id);
    try {
      const ctx = await Tasks.buildContext(task, run);
      const plan = await Planner.plan(ctx, { synthetic: true, prompt: task.prompt });
      for (const step of plan.steps) {
        if (step.kind === "act") {
          const outcome = await Broker.submit(buildActionRequest(step, task.userId, run.id));
          if (outcome.kind === "approval_required") {
            const result = await wait.forToken(outcome.waitToken!, { timeout: "24h" });
            if (result.ok && result.output.approvalId) {
              await Broker.resumeAfterApproval(result.output.approvalId);
            } else {
              await Tasks.markRunFailed(run.id, "approval expired or denied");
              return;
            }
          }
        } else {
          await Retriever.run(step, ctx);
        }
      }
      await Tasks.completeRun(run.id, plan);
    } catch (err) {
      await Tasks.failRun(run.id, err);
      throw err;
    }
  },
});
```

### 26.7 Approvals page loader (RSC)
```ts
// apps/web/app/(app)/approvals/page.tsx
export default async function Approvals() {
  const user = await requireUser();
  const pending = await ApprovalService.listPending(user.id);
  const decided = await ApprovalService.listRecentDecided(user.id);
  return (
    <ApprovalsView
      pending={pending}
      decided={decided}
    />
  );
}
```

### 26.8 Connector registration pattern
```ts
// packages/connectors/src/gmail/index.ts
import { registerConnector } from "../registry";
import { listThreads } from "./list_threads";
import { sendReply } from "./send_reply";
// ...

registerConnector({
  meta: {
    key: "gmail",
    displayName: "Gmail",
    description: "Read and manage your Gmail.",
    version: "1.0.0",
    icon: "/icons/gmail.svg",
    oauth: {
      provider: "google",
      scopes: ["https://www.googleapis.com/auth/gmail.modify"],
      consentUrlFactory: (state) => buildGoogleConsentUrl({ state, scopes: ["gmail.modify"] }),
      exchangeCode: exchangeGoogleCode,
      refresh: refreshGoogleTokens,
    },
  },
  healthCheck: async (ctx) => {
    const ok = await gmailPing(ctx.tokens.accessToken);
    return { ok };
  },
  capabilities: [listThreads, readMessage, draftReply, sendReply, archiveThread, labelThread, deleteThread],
});
```

---

## 27. Risks & Mitigations

| Risk                                                              | Impact  | Mitigation                                                                               |
| ----------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| Planner produces invalid/unsafe plans                             | High    | Strict Zod schema; repair-retry once; golden tests per intent; capability catalog is authoritative. |
| A bug in broker lets an unapproved action execute                 | Critical| Policy + approval check in a single transaction; property tests; fuzz against capability inputs; audit diffs. |
| Connector token leak                                              | Critical| AES-256-GCM at rest; never returned to client; strict CSP; secret scanning in CI.        |
| OAuth refresh thundering herd                                     | Medium  | Redis mutex per account; single-flight; cached until 60s before `expiresAt`.              |
| LLM hallucinates a capability                                     | Medium  | Planner is constrained to catalog; unknown capability → treated as retrieve + explainer. |
| Cost blowup from long chats/tasks                                 | Medium  | Per-user daily cost cap; per-task timeout; summarization of long histories.               |
| User overwhelmed by approvals                                     | High    | Bulk approvals; policy profiles; task-level once_on_create mode; sensible defaults (Auto-run Safe Actions). |
| Scope creep into enterprise org/permissions                       | Medium  | MVP explicitly single-user; architecture allows introducing `OrgId` later as nullable FK. |
| Trigger.dev outage                                                | Medium  | Local fallback: schedules backed up in DB; on outage, a lightweight in-process scheduler can run reads (no mutations). |
| Provider (OpenAI/Anthropic) outage                                | Medium  | `@breeze/ai` auto-falls-back to another configured provider for non-deterministic tasks. |
| Regulatory (user data export/delete)                              | Medium  | Hard delete path wired from day one; memory export from Settings; audit of deletion.      |
| Browser automation pressure from users                            | Medium  | Defer to v2; architecture already isolates execution behind Broker + Connector interface. |

---

## 28. What to Build First (Next Steps)

Do this in order, starting today:

1. **Scaffold the monorepo** (done in this PR).
2. **Prisma schema → migrations → seed**: User, Session, Chat, Message, ConnectorAccount, ConnectorCredential, Plan, PlanStep, Approval, Task, TaskRun, Memory, AuditEvent, EventOutbox, PolicyProfile.
3. **Auth.js wiring** with Google + GitHub providers; `requireUser()` server helper.
4. **App shell** (sidebar + topbar + dashboard stubs) using the UI package.
5. **`@breeze/ai`** with OpenAI + Anthropic adapters; configuration via Settings.
6. **Planner MVP** producing a typed `Plan` for `intent: chat` and `intent: retrieve`, validated by Zod.
7. **Broker MVP** with a local `echo` connector + `@breeze/policy` to prove the mutation gate end-to-end.
8. **Gmail connector** (read-only first: `list_threads`, `read_message`) → then `draft_reply`, then `send_reply` behind approvals.
9. **Approvals UI** + Trigger.dev wait tokens.
10. **First Task**: "morning summary" recurring job.

Ship behind a feature flag. Dogfood for a week before adding Calendar, GitHub, Files.

---

## Tradeoff Discussion (honest reasoning)

- **Why not gateway-first?** A gateway/router architecture shines when you have many independent services, polyglot runtimes, or multi-team ownership. Breeze v1 is a focused single-tenant web product owned by one team. A gateway adds latency, opex, and mental tax we don't need. Our "gateway" is the Broker — at the application layer, where it belongs.

- **Why web-first?** The product promise is "open the website and it works". Web-first eliminates the install friction, centralizes secrets server-side, and lets us stream timelines via SSE. A desktop or CLI would have forced us to ship a multi-surface permission model before we earned the right to. Web-first is also the shape that makes approvals a natural UI primitive.

- **Why planner/broker separation?** If the planner could execute, a prompt-injection or a bad output becomes a data-mutation event. Separation makes it provably impossible for the model to skip policy/approvals. It's the single most important boundary in the system.

- **Why approvals as core (not optional)?** Trust is product surface. If users have to find a setting to enable approvals, they won't, and the first bad action costs us the relationship. Approvals default-on, plus good defaults (Auto-run Safe Actions), gets us trust without nagging.

- **Why only six nouns?** Every extra product noun is an extra page, an extra choice, an extra failure mode. Chats/Tasks/Approvals/Connectors/Memories/Settings map to real user thoughts. Plans, steps, executions, events — those are *machinery*, surfaced as timeline items inside chats and runs, not as their own pages.

- **Why no vectors/microservices/plugins in v1?** Each is a forcing function for complexity with weak UX payoff at our scale. Keyword+summary memory is fine for one user's ~1000 memories. Microservices make sense at multi-team scale. Plugins are a marketplace problem before they're a code problem — and a nightmare for permissions. All three are easier to add in v2 once we have real usage data telling us *exactly* where we need them.

- **What to leave for v2?** Vector memory, more connectors (Notion, Slack, Drive), native mobile, voice input, browser automation (sandboxed), team workspaces, marketplace connectors, local models (Ollama adapter), multi-account per user, SSO.

---

*End of blueprint.*

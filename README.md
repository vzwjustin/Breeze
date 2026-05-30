## Breeze

A web-first AI assistant platform. Serious engine, soft UX.

Breeze chats, retrieves, drafts, and acts on your behalf across email,
calendar, code, and files — with a deterministic policy engine deciding
what runs automatically and what needs your OK. It also runs
**IFTTT-style recipes**: "when X happens, do Y."

- **Blueprint:** [`BLUEPRINT.md`](./BLUEPRINT.md) — architecture, domain
  model, schema, API, 90-day build plan.
- **Monorepo:** `apps/web` (Next.js) + `packages/*`.

## Quickstart

```bash
pnpm install
cp .env.example .env   # fill in the keys you need (see below)
pnpm db:generate
pnpm db:migrate
pnpm dev
```

Background jobs (recipes, scheduled tasks, approval expiry, event outbox) run via the built-in worker:

```bash
# Terminal 1 — web app
pnpm dev

# Terminal 2 — worker loop (set secret in .env)
BREEZE_CRON_SECRET=dev pnpm --filter @breeze/web worker

# Or trigger one tick via HTTP (production cron)
curl -X POST -H "Authorization: Bearer $BREEZE_CRON_SECRET" http://localhost:3000/api/internal/worker/tick
```

`packages/workflows` holds the engine-agnostic task runners; `apps/web/src/server/worker` wires them to Prisma and the broker.

## Product model

Users see only six nouns: **Chats · Tasks · Approvals · Connectors ·
Memories · Settings**. Everything else (plans, steps, executions,
events, recipes) is internal machinery surfaced via those nouns.

## Packages

| Package                  | Role                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `@breeze/common`         | Shared types, zod schemas, event taxonomy, ids, templating.          |
| `@breeze/db`             | Prisma schema + client singleton, AES-GCM token encryption.          |
| `@breeze/ai`             | Provider router: OpenAI, Anthropic, Google, OpenRouter.              |
| `@breeze/planner`        | LLM-backed plan producer — no side effects, repair-retry.            |
| `@breeze/broker`         | Sole execution gate: validate → policy → execute / approve.          |
| `@breeze/policy`         | Deterministic decision engine (allow / require_approval / deny).     |
| `@breeze/connectors`     | Typed connector SDK, OAuth, capability + trigger registries.         |
| `@breeze/memory`         | User-visible and internal memory store.                              |
| `@breeze/workflows`      | Trigger.dev tasks: user-task runner, approval watchdog, recipes.     |
| `@breeze/ui`             | Shared React components.                                             |
| `apps/web`               | Next.js app — SSE chat, approvals inbox, tasks, recipes, settings.   |

## AI providers

All four providers implement `completeJson` (structured output) and
`stream` (SSE chunking) over `fetch`. No provider SDKs are pulled in.

| Provider    | Env vars                                                                              |
| ----------- | ------------------------------------------------------------------------------------- |
| OpenAI      | `OPENAI_API_KEY`, `OPENAI_BASE_URL?`, `OPENAI_ORGANIZATION?`                          |
| Anthropic   | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL?`, `ANTHROPIC_VERSION?`, `ANTHROPIC_MAX_TOKENS?` |
| Google      | `GOOGLE_API_KEY` (or `GEMINI_API_KEY`), `GOOGLE_BASE_URL?`                            |
| OpenRouter  | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL?`, `OPENROUTER_SITE_URL?`, `OPENROUTER_APP_NAME?` |

The active provider for a user is resolved from `BREEZE_AI_PROVIDER`,
then falls through to whichever API key is present.

## Connectors

Each connector exposes **capabilities** (actions that run through the
broker) and **triggers** (polled read-only signals that feed recipes).
OAuth is handled with env-scoped client credentials — no third-party
SDKs.

| Connector | Capabilities                                                              | Triggers                    |
| --------- | ------------------------------------------------------------------------- | --------------------------- |
| Gmail     | list_threads, read_message, draft_reply, send_reply, archive/label/delete | `gmail.new_thread`          |
| Gcal      | list_events, create_event, update_event, delete_event, respond_invite     | `gcal.event_starting_in`    |
| GitHub    | list_notifications, read_issue, draft_comment, post_comment, list_prs     | `github.new_notification`   |
| Files     | list/read/summarize/move/delete, local fs scoped per userId               | `files.file_created`        |

OAuth env:
- Google (shared by Gmail + Gcal): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_OAUTH_PROMPT?`
- GitHub: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`, `GITHUB_OAUTH_SCOPES?`
- Files: local storage at `BREEZE_FILES_ROOT` (default `.breeze/storage/files`).

## Recipes (IFTTT)

A recipe pairs one trigger with one or more actions. The runner polls
the trigger, renders each action's `inputTemplate` against the emitted
item (with `{{item.path}}` substitution), and submits actions through
the broker. Idempotency keys are scoped to (recipe, item, action), so
re-polling the same window is safe.

Example: drop any new GitHub notification into a local journal file.

```json
{
  "name": "GH → journal",
  "trigger": { "key": "github.new_notification", "input": {}, "pollSeconds": 300 },
  "actions": [
    {
      "capability": "files.move_file",
      "inputTemplate": {
        "key": "inbox/gh-{{item.notificationId}}.md",
        "toKey": "journal/{{item.repo}}/{{item.notificationId}}.md"
      }
    }
  ]
}
```

Endpoints: `GET/POST /api/recipes`, `GET/PATCH /api/recipes/[id]`,
`GET /api/recipes/catalog`.

## Hard architectural rules

1. **Planner is not executor.** Plans only; no mutations.
2. **Action Broker is the sole execution gate.** Every mutation goes through it.
3. **Policy Engine decides permission.** Deterministic, pure.
4. **Connectors are narrow and typed.** No raw SDKs to the model.
5. **Memory is explicit and inspectable.** Every item carries type, source, reason, retention.
6. **Web UI hides complexity.** Six nouns. No walls of settings.

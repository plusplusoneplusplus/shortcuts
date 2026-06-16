# packages/coc

CoC CLI and integrated server. Consumes `@plusplusoneplusplus/coc-workflow`
directly for pure workflow compilation/execution, `@plusplusoneplusplus/forge`
for runtime/process/queue utilities, and `@plusplusoneplusplus/coc-agent-sdk`
for the provider-neutral LLM-tool contract (`Tool`, `defineTool`, etc.).

See the root `AGENTS.md` for cross-package conventions and **always load
`.github/skills/coc-knowledge/SKILL.md`** before working on this package —
detailed architecture lives in its `references/*.md` files.

## Where to Read Before Editing

| If you are touching… | Read first |
|----------------------|------------|
| CLI commands, source layout, executors, server startup, storage layout | [server-architecture.md](../../.github/skills/coc-knowledge/references/server-architecture.md) |
| Admin REST handler, editable config fields, admin UI | [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md) |
| `~/.copilot/mcp-config.json` + `.vscode/mcp.json` merge, allow-list | [mcp-settings.md](../../.github/skills/coc-knowledge/references/mcp-settings.md) |
| `src/server/endev/`, `EnDev-xDpu` skill visibility | [endev.md](../../.github/skills/coc-knowledge/references/endev.md) |
| Ralph sessions, iteration prompt, promote-to-ralph endpoint | [ralph.md](../../.github/skills/coc-knowledge/references/ralph.md) |
| `src/server/loops/`, loop tools, tick lifecycle | [loops.md](../../.github/skills/coc-knowledge/references/loops.md) |
| Process store / SQLite schema / FTS5 / pin / archive | [process-store.md](../../.github/skills/coc-knowledge/references/process-store.md) |
| Dashboard SPA (`src/server/spa/`) | [dashboard-spa.md](../../.github/skills/coc-knowledge/references/dashboard-spa.md) |
| REST endpoints | [rest-api.md](../../.github/skills/coc-knowledge/references/rest-api.md) |
| Notes sync engine (`src/server/sync/`) | [sync.md](../../.github/skills/coc-knowledge/references/sync.md) |
| SDK wrapper, Copilot/Codex providers, `ISDKService`, `SDKServiceRegistry` | [sdk-wrapper.md](../../.github/skills/coc-knowledge/references/sdk-wrapper.md) |

Other domains (memory, workflow engine, prompt autocomplete, wiki serving,
remote servers, task comments, llm-tools, sdk-wrapper, chat-prompt-history)
all have their own `references/*.md`.

## Local Invariants

- **Server Vitest tests** live under `packages/coc/test/server/`. Any
  server change should add or update tests there.
- **Codex skill mirroring** runs once at server startup (when
  `resolvedConfig.codex?.enabled === true`), not per-install. The
  `syncInstalledSkillsToCodex` function copies all globally installed bundled
  skills from `~/.coc/skills` to `~/.codex/skills` (`$CODEX_HOME/skills`).
- **Claude skill mirroring** runs once at server startup (when
  `resolvedConfig.claude?.enabled === true`). The `syncInstalledSkillsToClaude`
  function copies each skill's `SKILL.md` from `~/.coc/skills/<name>/SKILL.md`
  to `~/.claude/commands/<name>.md` (`$CLAUDE_HOME/commands/<name>.md`) so
  Claude Code discovers them as slash commands. A sidecar marker
  `.coc-<name>.json` tracks CoC-managed commands to distinguish them from
  user-authored ones.
- **Adding an admin-exposed config setting** is ONE definition entry in
  `src/config/admin-setting-definitions.ts` (value spec, default, runtime,
  optional `runtimeFlag` + Features-card `ui` metadata) plus the
  `CLIConfig`/`ResolvedCLIConfig`/`DEFAULT_CONFIG` declarations in
  `src/config.ts`. Admin validation, file schema, namespace merge/source
  tracking, runtime feature flags, the embedded SPA bootstrap, the Features
  card UI, and the generic contract tests
  (`test/config/admin-setting-definitions.test.ts`) all derive from the
  registry — do not hand-edit `admin-config-fields.ts`, `schema.ts` leaves,
  or `namespace-registry.ts` for admin settings. Reserve `admin-handler.ts`
  changes for cross-field validation shared with config-file loading (see
  [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md)).
- **Non-admin namespaced config fields** (queue, models, logging, monitoring,
  skills, memoryPromotion, …) keep hand-written descriptors in
  `src/config/namespace-registry.ts`; do not expand branch lists in `config.ts`.
- **MCP REST surface** must never expose secrets (`env`, headers, full `args`).
- **Ralph iteration prompts** must not hard-code implementation skill names
  or set `context.skills`; the `<work_intent>` block must stay generic.
- **Ralph final-check tasks** still run with autopilot capability, but
  `RalphExecutor` must use validation-only system instructions whenever
  `context.ralph.finalCheck` is present. Do not route final checks through the
  normal implementation-loop system prompt.
- **Ralph manual-only completion** treats explicit manual-verification-only
  `Remaining:` progress as complete autonomous work: do not queue another
  implementation iteration; enqueue final-check and preserve the manual
  verification-needed terminal status.
- **Loop ticks** must route completion through
  `ProcessLifecycleRunner → onLoopTickComplete → LoopExecutor.onTickComplete`;
  bookkeeping errors must never mask the follow-up's actual result.
- **Dreams analyzer/critic AI work** must run through
  `DreamInternalProcessExecutor`/`ProcessLifecycleRunner` so analyzer and critic
  prompts/responses are persisted as read-only internal processes. Do not add
  direct `aiService.sendMessage(...)` calls under `src/server/dreams/`.
- **Hierarchical parent/child task features** (For Each, Map Reduce, Ralph,
  Dreams, and anything future that schedules sub-tasks) must use the task-group
  framework instead of inventing new linkage: register/update the group through
  `src/server/task-groups/` (feature stores fire change hooks projected by
  `feature-sync.ts`), tag every child task with
  `payload.context.taskGroup = { groupId, groupType, role, itemKey?, workspaceId }`
  (mirrored to `metadata.taskGroup` by `ProcessLifecycleRunner`), and add a
  chat-list descriptor in
  `src/server/spa/client/react/features/chat/task-group-descriptors.ts`.
  Group statuses are normalized (`draft|running|completed|failed|cancelled`)
  with feature detail in `extra.detailStatus`; registry writes are best-effort
  and must never break orchestration.
- **Chat canvas** (`canvas.enabled`, default off) persists markdown, code, or
  extension artifacts (descriptor `type` + normalized `language`) under
  `~/.coc/repos/<wsId>/canvases/<canvasId>/` through
  `src/server/canvas/canvas-store.ts` with revision-checked updates. AI edits
  go through the `write_canvas`/`read_canvas`/`extension_canvas` LLM tools
  (which emit `canvas-updated` SSE events on the linked process); user saves
  go through the workspace canvases REST routes (409 + current record on a
  stale revision, `canvas-updated` WebSocket broadcast). Every persisted
  revision also writes a version snapshot (capped at 50) used by the panel's
  history stepper and restore-as-new-revision flow, and anchored comments
  (`comments.json`, open|sent|resolved) are delivered to the AI through the
  normal follow-up enqueue path — not a custom channel. Extension canvases
  store `extension/{manifest.json,ui.html,capabilities.js}`; both the AI
  (`extension_canvas` RUN mode) and the panel's sandboxed iframe (capability
  REST route) mutate shared state only through capabilities run as pure
  `(state, params) => nextState` transforms in `canvas-capability-runner.ts`
  (`node:vm`, no require/process, 1s timeout, 1 MB cap) — never execute
  extension scripts outside that runner. Do not write canvas files directly
  from other features.
- **Follow-up enqueue sites** must call `resolveFollowUpMode(...)` and set
  `payload.mode`. `FollowUpExecutor.executeFollowUp` fail-loud warns + defaults
  to `'ask'` if missing.
- **Copilot long-context tier** is automatic at the provider boundary: chat
  and follow-up executors derive `contextTier` only via
  `getCopilotContextTierForModel` (tiered billing metadata —
  `billing.tokenPrices.longContext.contextMax`). Never hardcode model
  allow-lists, never infer support from `max_context_window_tokens`, and never
  send `contextTier` for Codex/Claude or when the metadata is absent.
- **Pull Requests Team auto-classification** must stay gated by
  `pullRequests.enabled`, `pullRequests.autoClassifyTeam`, and
  `features.focusedDiff`; use the generic classify-diff enqueue helper with the
  per-trigger cap and low priority instead of adding client-side POST loops.
  Classification result/pending files are origin-scoped and queued
  `pr-classification` payloads must carry the resolved classification storage
  origin so the `saveClassification` tool writes the same state route polling
  reads. The Team toolbar status UI reads origin batch status and routes manual
  "Classify now" actions through origin APIs backed by the same bounded server
  helper, passing workspace/repo metadata only to select the concrete clone.
- **Pull Request review progress** for PR pop-out reviewed/visited file state is
  durable origin state. New callers must use
  `/api/origins/:originId/pull-requests/:prId/review-progress` or
  `client.pullRequests.*ReviewProgressForOrigin(...)`; workspace/repo metadata is
  for legacy migration only, not storage identity.
- **Native Copilot session reads** (`src/server/native-copilot-sessions/`)
  must stay strictly read-only against the native store: open
  `~/.copilot/session-store.db` with short-lived `readonly` SQLite connections,
  keep every user-provided filter parameterized (FTS terms literal-quoted), and
  return typed `db-missing`/`db-invalid` states instead of throwing. Never route
  native session IDs into CoC process/chat action handlers. Rich detail
  reconstruction reads the per-session log
  `~/.copilot/session-state/<id>/events.jsonl` via `session-state-parser.ts`
  (`parseNativeSessionState`), which maps the newline-delimited
  `{type,id,parentId,timestamp,data}` events (`user.message`,
  `assistant.message` with `content`/`reasoningText`/`model`,
  `tool.execution_start`/`_complete` correlated by `toolCallId`,
  `skill.invoked`) into `ReconstructedConversationTurn[]` and returns `null`
  (never throws) on a missing/malformed/empty log so callers fall back to the
  flat `session-store.db` turns. `getSession` populates
  `NativeCopilotSessionDetail.conversation` (always present) from the parser
  when it yields turns, else maps the flat DB turns into text-only
  user/assistant turns; the service accepts `sessionStateDir`/`parseSessionState`
  overrides for hermetic tests. The parser never writes to `~/.copilot` and
  rejects unsafe session ids (path traversal). The list route dedups
  against CoC processes by excluding native `sessions.id` values that match a
  workspace's `ProcessStore.getSdkSessionIds(workspaceId)` (the Copilot SDK/CLI
  session id equals the native store id) and hides automated background-job
  sessions whose first flat turn or stored summary matches
  `BACKGROUND_JOB_PROMPT_PREFIXES` (e.g. title summarization); the hidden counts
  are returned as `deduplicatedCount` and `backgroundJobCount`. The panel
  deep-links the selected session via
  `#repos/{wsId}/copilot-sessions/{sessionId}`. The read-only detail pane
  renders `NativeCopilotSessionDetail.conversation` as a rich transcript by
  reusing the existing chat `ConversationTurnBubble` (no fork): the SPA-local
  `nativeConversationTurns.ts` maps `ReconstructedConversationTurn[]` →
  `ClientConversationTurn[]`, folding assistant `thinking` into the content
  timeline as a markdown blockquote (the chat turn shape has no reasoning
  field). The metadata header is preserved and no follow-up/streaming/resume or
  per-turn (pin/archive/delete) actions are wired.
- **Work-item create/update side effects** (hierarchy `parentId` validation,
  GitHub/Azure Boards provider sync, response-cache invalidation, dashboard
  broadcasts, auto-execute) live in the shared command service
  `src/server/work-items/work-item-commands.ts`. Both the REST routes
  (`src/server/routes/work-item-routes.ts`) and the `create_update_work_item`
  LLM tool call it — do not re-implement hierarchy or provider logic in either
  caller.
- **Direct package builds** use `scripts/prebuild.mjs` to build
  `@plusplusoneplusplus/coc-client`, `@plusplusoneplusplus/coc-workflow`, and `@plusplusoneplusplus/coc-memory`
  before `tsc`, clean `dist` before emitting, and generate
  `src/server/core/build-info.ts`; keep this script cross-platform.

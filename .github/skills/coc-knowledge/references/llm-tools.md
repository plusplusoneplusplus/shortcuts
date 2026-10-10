# LLM Tools

AI tool factories injected into chat executor sessions. Each factory creates a stateful
tool + accessor **per invocation** so state never leaks across requests. All tools use
`defineTool()` and the `Tool` type imported directly from `@plusplusoneplusplus/coc-agent-sdk`
(the provider-neutral contract owner), not via the forge re-export.

## Tool Registry

`llm-tool-registry.ts` owns `LLM_TOOL_REGISTRY`, the list of user-toggleable tools. Each entry
has `name`, `label`, `description`, and `enabledByDefault`. Exports:
`DEFAULT_DISABLED_LLM_TOOLS`, `getEffectiveDefaultDisabledTools()`, `filterDisabledLlmTools()`.
The folder has no barrel `index.ts`; import each tool module directly.

### Gating

`getEffectiveLlmToolRegistry({ cronEnabled, canvasEnabled, kustoEnabled, llmToolSystemOneEnabled })`
filters `scheduleWakeup`, the canvas tools (`CANVAS_LLM_TOOL_NAMES`), `kusto_query`
(`KUSTO_LLM_TOOL_NAMES`), and `system_one` (`SYSTEM_ONE_LLM_TOOL_NAMES`) out of the settings
list when their flags are off.

`getEffectiveDefaultDisabledTools()` disables `tavily_web_search`, `save_memory`, and
`recall_memory` by default, independently of UI layout mode.

### Per-repo overrides

`PerRepoPreferences.disabledLlmTools` overrides defaults explicitly (empty array = enable all),
via `GET/PUT /api/workspaces/:id/llm-tools-config`. Responses also carry
`conversationRetrievalAvailable`, true only when the active `ProcessStore` supports
`searchConversations`; the SPA pairs it with the `get_conversation` toggle to decide whether
session-context attachments can be dropped into composers. Names in `REMOVED_LLM_TOOL_NAMES`
(`create_bug`, `get_work_item`, `create_update_work_item`) are filtered out of config responses
and out of preferences when those are rewritten. Work items are managed exclusively through
`work-item-routes.ts` and the dashboard; the shared `work-items/work-item-commands.ts` service
owns hierarchy validation, provider sync, cache invalidation, and broadcasts for that path.

## Tool Factories

| File | Tool Name | Description |
|------|-----------|-------------|
| `add-diff-comment-tool.ts` | `add_diff_comment` | Anchored review comments on commit diff lines. Pre-binds workspace/commit context. Persists via `DiffCommentsManager`, broadcasts via WebSocket. |
| `ask-user-tool.ts` | `ask_user` | Structured questions (select, multi-select, yes/no, confirm, text). Blocks until the user responds. Persists the pending payload on `AIProcess.pendingAskUser` and emits an SSE event. Results distinguish answers, skips, cancellations, `deferred: true` / `reason: "needs-context"` responses with optional notes, and `reason: "unavailable"` short-circuits on non-interactive turns. |
| `resolve-comment-tool.ts` | `resolve_comment` | Marks inline comments resolved; tracks resolved IDs in a per-invocation Map. |
| `save-classification-tool.ts` | `saveClassification` | Persists per-hunk diff classifications for PR/commit/branch-range review. Categories: `logic`, `mechanical`, `test`, `simple`, `generated`. New `test` hunks require `testFidelityComment`, `logic` hunks require `summaryComment`; critical metadata is validated rather than dropped. |
| `search-conversations-tool.ts` | `search_conversations` | FTS5 full-text search over past conversations. Requires a SQLite-backed `ProcessStore`. |
| `send-to-conversation-tool.ts` | `send_to_conversation` | Create/post dispatch and explicit local cancellation — see below. |
| `list-workspaces-tool.ts` | `list_workspaces` | Read-only local + remote repo/group discovery for `send_to_conversation` targets — see below. |
| `canvas-tools.ts` | `write_canvas`, `read_canvas`, `extension_canvas` | Chat canvas side-panel artifacts — see below. |
| `kusto-tools.ts` | `kusto_query` | Kusto/KQL against Azure Data Explorer — see below. |
| `system-one-tool.ts` | `system_one` | Quick yes/no, choice, or score judgments over refs to earlier tool results, files, or short text — see below. |
| `get-conversation-tool.ts` | `get_conversation` | Full transcript by processId, compacted to a token budget via 5 progressive levels. Supports `fromTurn`/`toTurn` paging. |
| `suggest-follow-ups-tool.ts` | `suggest_follow_ups` | Emits follow-up action suggestions after an AI response. |
| `create-pull-request-tool.ts` | `create_pull_request` | Opens a GitHub/ADO PR for the chat's own repo via the shared `git/create-pull-request-service.ts` (commits mode in a temp worktree, or current branch) and writes the chat ↔ PR binding. Autopilot/Ralph write turns only — ask mode and Ralph final-check never receive it (the one intentional ask/autopilot tool-block difference). |
| `tavily-web-search-tool.ts` | `tavily_web_search` | Live web search via Tavily. Key from `~/.coc/providers.json`. Disabled by default. |
| `sentinel-todos-tool.ts` | `sentinel_todos` | Sentinel chat to-do ledger bookkeeping — see below. |

### sentinel_todos

Offered only to Sentinel chats (first turn and follow-ups) while `features.sentinelTodoLedger`
is on: the route layer publishes `getSentinelTodos`, which returns the shared
`SentinelTodoService` or `undefined` when the flag is off. Not in `LLM_TOOL_REGISTRY`; flag-off
turns get no tool and no guidance. The owner is the invoking chat (`workspaceId`, `processId`),
never a tool argument, and the service re-proves Sentinel ownership on every call. Actions:
`list` (active items; `includeArchived` adds archived), `create` (normal items require `completionCondition`,
optional `idempotencyKey` replay), `update` (requires `itemId` + `expectedRevision`; conflicts
return `{ code: 'conflict', current }`). Creation accepts immutable `type: normal | manual` (default normal);
manual items require only a title, with optional Notes/Done when. `create`/`update` accept `priority` (`high`/`regular`,
default `regular`; ledger metadata only, independent of status). `done`/`needs_attention` require a `reason` (also enforced by the store for non-user actors); `done` stores
it as the reviewed outcome (`recordedBy: 'sentinel'`) unless `outcome` is given. Archive/restore
arguments are rejected by the tool; the store enforces user-only archive/restore for manual items.

The addon's `<sentinel_todo_ledger>` guidance tracks concrete intended outcomes
with final-deliverable completion conditions, reuses one item across grilling/implementation/review,
and records phase milestones/spec links in notes. Successful intermediate phases remain pending
(`todo` awaiting approval, `in_progress` during authorized work), not Done or failure.
Successful grilling returns feature work to `todo` awaiting implementation approval;
explicitly design-only/interview-only requests finish at their agreed artifact.
Tracking grants no implementation/retry authority; bookkeeping failures are reported, not repaired by relaunch.
Manual guidance requires clarification before execution and prohibits delegation, job links,
automatic result reviews, normal-item copies, conversion and handoff. AI may maintain manual
items; Done reasons explain available evidence against Done when, or title/notes if omitted.
`list` items carry `jobs[]` links with derived `execution`: live queue state, terminal
outcome with independent delivery and assessment, or `unavailable` for remote links.
Local verdict updates pass `reviewedJobs` with exact process/terminal-event identities,
`status` and a reason; the store atomically acknowledges only that evidence under the
item revision. Notes/priority edits and delivered parent turns never prove assessment.
User status/reason/outcome/archive decisions supersede already-linked jobs without
declaring their evidence reviewed; acknowledgment requires exact `reviewedJobs`. Reviewed markers
survive reload/replay. Delivery commits invalidate the linked ledger without changing its revision.

With the flag on, the Sentinel's `send_to_conversation` gains `todoItemId` (via the optional
`todoTracking` tool option): create mode rejects a missing, foreign, archived, or manual item with
`code: 'untracked'` before launching, then links the admitted local, Ralph (one whole-session
link), or remote job and returns `tracking: { status: 'tracked' | 'failed' }`. The store also
rejects direct manual job links; result recording and review lookup select normal items only. Linked parent
result reviews quote the item and select status from the overall outcome: `done` only
for the satisfied final condition, `todo` for pending steps/approval, `in_progress` for
continuing authorized work, `needs_attention` for failed/cancelled/blocked/incomplete final work.
Reviews re-read the item, preserve notes/manual user verdicts, and reconcile optimistic
revision conflicts. Remote evidence is inspected in its owning chat; routing/ownership stays unchanged.

### create_pull_request

The `submit-commits-as-pr` skill calls this tool with a nonempty exact commit SHA
array, oldest first, and explicit `autoMerge: true` unless the user disables it.
Invoking the skill authorizes that default; general tool calls still default to
false. Commit-mode submission uses an isolated worktree and aborts conflicts
without moving the active branch/HEAD. A successful result with `bound: false`
means the PR exists but its chat binding was not written. Auto-merge warnings do
not undo creation. Before retrying uncertain creation, inspect branches and PR
state in the owning workspace to avoid duplicate submissions.

`autoFix: true` arms a workspace-scoped `ci-failure` monitor after the PR binding
succeeds, using its canonical origin and the calling conversation. It requires
`triggers.enabled`; omitted/false leaves existing monitors unchanged. The shared
`triggers/create-trigger-service.ts` validates ownership, persists, schedules and
broadcasts creation for REST and tools. Tool retries reuse active monitors or resume
paused monitors without resetting CI history or retry limits. Results include
`autoFix: { requested, enabled, triggerId?, warning? }`; arming failures preserve PR
success and report a warning. `getTriggerInfra().createTrigger` reaches the tool
through the late-bound executor runtime.

### send_to_conversation

Omitted `action` or `action: "send"` selects ordinary create/post dispatch and requires
`content`. `{ action: "cancel", processId }` stops known local work without content or
a follow-up turn. Cancel rejects send-only fields and remote process/workspace routes.
Optional cancel `workspaceId` asserts the exact owning local workspace ID; it does not
default to the caller's workspace. Registration, repo tool preferences, and chat-mode
availability are shared with create/post dispatch.

The route layer binds `runtime.cancelConversation` to
`server/processes/cancel-conversation.ts`, shared with `POST /api/processes/:id/cancel`.
It resolves persisted IDs and `queue_<taskId>` tasks before process materialization,
serializes on canonical process admission, and uses `MultiRepoQueueRouter.cancelProcess`
to cancel linked queued/running tasks and abort the owning provider's in-flight turn.
Fork provenance never authorizes source-queue cancellation. Pending messages are removed
through the store; conversation history remains intact.

Cancel returns `{ processId, openLink, cancelled, status, workspaceId? }`.
Already-terminal work without admitted follow-ups returns `cancelled: false` and its
terminal status; the REST adapter retains its terminal `409`. Unknown IDs, owner
mismatches, unavailable cancellation, protected running operations, abort/persistence
errors, and the 30-second timeout surface errors rather than success. Failed aborts
retain `cancelling` until lifecycle settlement. First-turn registration rechecks
cancellation, and follow-up settlement preserves cancelled status on success/error.

Create mode omits `processId` and enqueues a brand-new visible chat through the same
in-process queue path as `POST /api/queue`. It defaults to the caller workspace and Ask mode
(Autopilot when the calling chat is a `sentinel` dispatcher; an explicit `mode` always wins),
can target another registered workspace, links spawned chats via
`payload.context.spawnedFromProcessId`, and accepts `provider: "auto"` or a concrete provider
(`copilot`, `codex`, `claude`,
`opencode`) plus optional `effortTier` (`very-low`…`high`). Create mode defaults to
`medium` when both model and tier are omitted, without inheriting parent model/effort;
an explicit model wins over tier selection. Post and cancel modes have no default tier.
Enabled Auto carries
`context.autoProviderRouting.requested` without a concrete provider or inherited model/effort;
the target server selects the provider at execution using its existing routing rules.

Explicit models survive queue validation; tiers expand against the selected provider, and
incompatible overrides fail before SDK execution. Auto uses a capability check before dispatch:
when routing is disabled or unavailable, local create mode validates and inherits the invoking
conversation's concrete provider. Omitted provider also inherits the local parent provider.
An explicit model without a provider override retains local parent reasoning-effort inheritance;
tier selection uses the destination provider's mapping.
Missing or unavailable parent providers fail. Enabled Auto never inherits parent AI settings;
quota, routing/runtime, explicit provider/model, and dispatch failures never trigger substitution.
Explicit concrete providers inherit no parent model/effort;
incompatible provider/model/tier combinations fail.

Optional create-mode `title` is
trimmed, must be non-empty and at most 80 characters, and travels through canonical task
validation as `displayName` and `payload.customTitle`. Queue SQLite serialization preserves
the payload, and queue API serializers project its custom title into the canonical top-level
list field while preferring a process-level custom title when present. `ProcessLifecycleRunner`
seeds `AIProcess.customTitle`, persisted in the existing process-store column. AI title
generation writes `title` while queue display-name sync prefers the current `customTitle`, so
supplied titles remain visible across turns and restarts. Omitting the title keeps automatic
naming.

The tool and Sentinel mode directive prefer Auto delegation unless the user requests a
particular provider/model. The tool description asks for short, task-specific create-mode titles.
The bundled `delegate` skill requires agents to include a title in its handoff calls.
The JSON schema requires `content` for send or explicit `action: "cancel"` plus `processId`
for cancellation; titles remain optional.

Create mode with `mode: "ralph"` launches a Ralph session straight into iteration 1 (no
grilling) through the late-bound `getLaunchRalph` runtime capability, which wraps
`launchRalphSession` (`src/server/ralph/ralph-launch-service.ts`) over the same
resolved-defaults bridge as `POST /api/ralph-launch`. `content` is the trimmed goal spec; the
workspace check, title, spawn link, and provider/model/effort resolution match ordinary create
mode. No worktree is requested and max iterations come from repo preferences. It returns
`{ processId, sessionId, openLink }`, is allowed from Ask and Autopilot callers, and is
rejected in post mode. `plan` stays unsupported. The custom title is the iteration-1
`customTitle`, which the SPA Ralph session row prefers over the goal-derived title.

Create-mode `workspaceId` accepts a local ID, a remote clone key `remote:<serverId>:<workspaceId>`,
or a repo name matched case-insensitively over the workspace directory (exact name first, then
`name@server` against the server display name). An ambiguous name errors with every candidate
`id (server)`; no match errors and points at `list_workspaces`. A remote target is started on
that server's own `POST /api/queue` (Ralph: `POST /api/ralph-launch`, which accepts `title`) at its
effective URL via `WorkspaceDirectory.startRemoteChat`, with no local fallback for offline or
unreachable servers. Enabled Auto becomes the remote queue routing marker
(Ralph: `autoProviderRouting: true`).
Remote Auto preflights `/api/config/runtime`; a disabled/missing routing flag or a 404
capability endpoint selects the local parent's concrete provider, validated through the remote's
`/api/agent-providers`. Other capability request failures abort. Only that fallback provider and
explicit provider/model/tier overrides travel; remote defaults own model/effort, and no local
spawn link, messaging origin, or parent configuration travels. Dispatch is attempted once. The
result's `openLink` is the dashboard clone route `#repos/<encoded clone key>/chats/<processId>`.
Successful remote queue and Ralph launches also return `resultDelivery: { status: 'unavailable',
reason }`: existing transport launches jobs but cannot return terminal results to the originating
Sentinel or its WhatsApp/Teams chat. Tool guidance directs the AI to inspect the link, avoid
promising automatic return, and avoid launching a duplicate job. Local responses omit this field.
Post mode with a `remote:` processId is rejected as not supported yet.

When the invoking turn came from WhatsApp/Teams, local create mode records the
turn's origin (`{ connector, chatKey, threadId? }`, from the per-turn `runtime.messagingOrigin` the
executor binds via the ask_user relay's `locateOrigin`) as `payload.context.messagingOrigin`
(→ `metadata.messagingOrigin`). Ordinary jobs call `runtime.trackMessagingJob` for completion
notices (see server-architecture "Messaging job completion notices"). Ralph passes the origin
through `RalphLaunchInput` into iteration 1 before delegation registration; only the delegated
whole-session result returns through the parent review outbox, with no iteration notice tracking.
Remote targets and dashboard turns record nothing.

### Delegated result persistence

`server/delegation/delegated-job-store.ts` provides `DelegatedJobStore`, a server-owned
ledger at `getRepoDataPath(dataDir, parentWorkspaceId, 'delegated-jobs.json')`. Rows
capture immutable parent/child workspace and process identities, optional remote server
and Ralph session IDs, a title, and the connector origin supplied by admission context. Explicit registration limits tracking to new
relationships. The first terminal result wins across event replay; outcome is
`completed | failed | cancelled | capped`, with bounded summary/reason and artifact links.

Terminal delivery moves conditionally from `pending` to `queued` (receipt ID) to
`delivered`, or to a diagnosable `failed` state. Settled rows cannot reopen. Atomic writes
and fresh reads keep disk failure from advancing state. Rejected queue admissions atomically
record their terminal result with delivery already `failed`, preventing restart reviews.
The snapshot registry clears these machine-local receipts on wipe and excludes them
from export/import to prevent portable backups from replaying delivery.

`server/delegation/sentinel-delegation-enqueue.ts` wraps the route-bound tool enqueue and
Ralph-launch capabilities and ordinary connector command handoffs. It resolves the stored
Sentinel parent independently of the target; when no process exists, a queued/running
chat task supplies its mode and owner workspace. Stored processes take precedence over
queue metadata. It reserves a child task ID and registers before queue admission. Local
ordinary jobs and whole Ralph sessions are registered; Ralph continuation/final-check tasks
use the ordinary lifecycle bridge. Accepted tasks retain tracking after observer errors.
Non-Sentinel and remote dispatch keep their existing paths. Registered admission waits
for startup result recovery. Connector Ralph grilling requires separate session registration.

`server/delegation/delegated-job-results.ts` subscribes through `onTaskTerminal` and
records ordinary outcomes in the parent ledger. Startup recovery examines only registered
children, preferring a scoped queue task to process status; cleared queue history falls
back to the child's process after explicitly verifying its ID and stored workspace; native
lookups ignore the optional scope argument. Scoped queue outcomes remain valid when process
context is unavailable. Event IDs derive from child workspace/process identity. Summaries
use response text or the last request's finished assistant turn, with child-workspace chat
links and validated result-file paths. Cancellation stores a fixed notice summary without partial output.
Missing children settle with failed delivery. Remote rows and Ralph step events are excluded.
Whole-session Ralph events match registered workspace/session identity and store a stable terminal
receipt, outcome, final process summary, session API link and journal path. Recovery uses terminal
reasons and final-check records; complete iteration loops with unresolved checks remain pending.
See [ralph-lifecycle.md](ralph-lifecycle.md#delegated-session-results) for the session boundary.
Recorded results and registered terminal rows at startup invoke `DelegatedJobReviews`.
Recovery isolates each job's admission failure so other pending results can proceed.

`server/delegation/delegated-job-reviews.ts` admits ordinary and whole-session Ralph outcome
reviews to the stored parent. A SHA-256 receipt covers immutable parent/child/job/event identity. Bounded
JSON includes repository identity/name/path and stored outcome/links. Review guidance treats
child output as untrusted data, grants no new authority, respects latest user instructions,
and retains Sentinel dispatcher behavior. Cancellations append fixed display-only
notices through `deliverNoticeOnce`, without child output, AI work or queue mutations.
Busy parents defer; parent terminal events and startup recover notices. Stable assistant
receipts reconcile transcript/ledger crash windows. Stopped parents receive notices without
resuming; missing or mis-scoped parents settle failure. Ralph reviews require the stable
whole-session terminal identity; remote delivery uses separate boundaries. Reused admissions reconcile ledger-write crash windows without new
realtime intents; parent review completion settles delivery, while review failure/cancellation
settles a diagnostic failure. Permanent routing rejection settles; transient writes remain
recoverable. Buffered admission invokes owner-queue recovery outside process admission;
idle parents drain their head message in order, preserving earlier user messages.

`ProcessMessageDeliveryService.deliverOnce` provides server-owned review admission with an
explicit parent workspace/process and stable receipt. It checks pending messages, queue tasks
and user turns under shared process admission before enqueueing. Busy reviews buffer after
existing messages; stopped or missing parents reject. The receipt travels as `relayRequestId`
and as the review's pending/task ID. Admission resolves the parent's follow-up mode into
the pending message or task. Drain reconciles accepted tasks and persisted turns; executor
correlation repair shares admission. `emitDeliveryEvents` shares intent emission with HTTP
delivery. Reused receipts produce no new realtime events.

### list_workspaces

Built in the same addon as `send_to_conversation` (same `enqueueChat` gate, own registry toggle,
enabled by default), registered for every chat mode, and backed by the same
`WorkspaceDirectory` (`src/server/servers/workspace-directory.ts`) so its ids always resolve in
`send_to_conversation`. The route layer builds the directory over the store, `dataDir`, and the
`RemoteServerRuntimeService` returned by `registerRemoteServerRoutes`, and publishes it as
`SendToConversationRuntimeOptions.workspaceDirectory` through the late-bound
`getSendToConversationRuntime` capability; without it the addon falls back to a local-only
directory. Each remote's `/api/workspaces` (plus `/api/repo-groups/:id` for group members) is
fetched at its effective URL with a 4s per-request timeout; a failure never fails the call —
the server reports its last-known entries (module-level `createCache` namespace) with
`online: false`, or zero entries when none are cached. Entries carry only `id`, `name`,
`type` (`repo` | `group` with `members: [{ id, name }]`), `server` (`local` for this server),
`serverKind`, and `online`; a `servers` array lists every consulted server. Optional `query` is a
case-insensitive substring over repo and server names; results cap at 50 with `total` and
`truncated`. The repo list never enters the system prompt.

Post mode supplies `processId`, ignores any `provider` argument so native session continuity
stays on the existing conversation's provider, expands `effortTier` against that provider, and
lets an explicit `model` override the tier. Create-only titles are ignored in post mode.
Post mode applies no mode default: an omitted `mode` keeps the conversation's current mode and an
explicit one switches it. The route-layer `processes/send-message-capability.ts` resolves it with
`resolveFollowUpMode` (terminal Sentinel mode still wins) before `ProcessMessageDeliveryService`.

### Canvas tools

Three consolidated tools, kept few to limit tool-schema context cost. Gated by the
`canvas.enabled` config flag (`buildCanvasToolsAddon` reads `<dataDir>/config.yaml`, with an
injectable test override); `CANVAS_LLM_TOOL_NAMES` lists all three for registry gating.

`write_canvas` creates (omit `canvasId`) or updates a `markdown`/`code` canvas. Mermaid blocks
render as diagrams, `code` takes a normalized `language`, and an optional free-form `purpose`
persisted on the descriptor at create time declares semantic intent (`purpose: 'plan'` surfaces
the "Implement this plan" card). `read_canvas` returns content/revision plus the manifest for
extensions.

`extension_canvas` authors and runs custom interactive `extension` canvases, dispatched by the
presence of `capability`. BUILD mode takes manifest + `capabilities[]` + `capabilitiesJs` +
**one of** `uiHtml` or `uiJsx`; RUN mode takes `canvasId` + `capability` + `params`. `uiJsx` is
compiled at BUILD time by `esbuild.transform` (`canvas-jsx.ts`, classic runtime →
`React.createElement`) into a stored `ui.js`, keeping the source as `ui.jsx` for history; a
syntax error is a tool error and nothing is saved. esbuild is loaded with `await import`
*inside* the transform, never at module scope, because this file sits on a static import chain
the server walks at boot — a top-level import turns a missing esbuild into a startup crash. It
must stay a production dependency of `@plusplusoneplusplus/coc` with `**/@esbuild/**` in the
desktop `asarUnpack`. `libraries` names vendored globals from the fixed allowlist in
`canvas-libraries.ts` (react, recharts, papaparse, tailwind — dependency-resolved, react
implied), loaded by the panel from `/canvas-vendor/*` as classic scripts.

Persistence goes through `CanvasStore` (`~/.coc/repos/<wsId>/canvases/`), a facade over
per-contract services (write queue, record/extension/comment repositories, file sandbox,
corruption diagnostics). Every mutation runs inside the per-canvas lock, and a revision's
descriptor/artifact/snapshot are staged and published together. The store links the canvas to
the creating process, applies revision-checked exact-match edits, and emits `canvas-updated`
SSE events on the process channel. Extension canvases store
`extension/{manifest.json,capabilities.js}` plus **either** `ui.html` **or** `ui.js` + `ui.jsx`;
`getExtension` returns null only when neither UI document exists, and `saveExtension` removes
documents it was not given so a stale `ui.js` cannot shadow a new `ui.html`.

RUN mode executes a capability and writes the result as a revision-checked update through the
per-canvas queue in `canvas-capability-queue.ts` — runs for one canvas never overlap, and each
re-reads the canvas inside its critical section so run N+1 sees N's output. A capability is by
default a pure `(state, params) => nextState` transform in a `node:vm` sandbox
(`canvas-capability-runner.ts`: no require/process, 1s timeout, 1 MB state cap). Declaring
`async: true` runs it instead in a `worker_threads` worker built from
`CAPABILITY_WORKER_SOURCE` (`canvas-capability-worker.ts`, started with `eval: true` so there
is no dist/source path to resolve) with a 30s whole-run budget; the worker is `terminate()`d on
every outcome including success, because a `vm` continuation cannot be killed and a capability
may resolve and keep spinning. At most 4 async runs execute process-wide at once.

An async capability receives a third argument `host` whose only method is
`await host.complete(prompt, { model? })` — the one-shot `createCLIAIInvoker` path
(`canvas-capability-completion.ts`, `resolveDefaultModel(..., 'quickAsk')`), capped at 3 calls
per run and logged with workspace/canvas/capability/process. There is deliberately no
`host.fetch` (CoC's own API is on unauthenticated loopback) and no `CanvasHost.complete()` in
the iframe. Async capabilities and `host.complete` are gated on `features.canvasHostApis` (off
by default): with the flag off an async capability 404s from the route and errors from the
tool, while sync capabilities are untouched.

`extension_canvas` also accepts `files: [{ path, content, encoding? }]` (max 20/call) — data
written into the canvas's read-only `files/` directory that the artifact reads back with
`CanvasHost.readFile`. Passing `canvasId` + `files` with no UI fields attaches data without
re-authoring the extension. That directory is the ONLY write path in: no upload route, no write
endpoint. Reads are served by `GET /canvases/:id/files[/<path>]` behind layered path safety in
`canvas-file-sandbox.ts` (shape → resolve → `isWithinDirectory` → `realpath` re-verify) with
1 MB text / 10 MB binary caps.

### kusto_query

Runs a KQL query server-side against Azure Data Explorer using the official
`azure-kusto-data` SDK + `AzureCliCredential` (no CLI shell-out) and persists the result into a
new or existing `type: 'kusto'` canvas rendered by `KustoView` (editable query, result table,
native charts). Omit `canvasId` to create (default title `Kusto Query`), or pass it to
re-run/update; an existing target must be `type: 'kusto'`. Returns column schema, a capped row
sample (`KUSTO_QUERY_ROW_SAMPLE`), total row count, truncation state, and a `canvas://<id>`
embed link. Shares the `runKustoCanvas` execute/truncate/persist path with
`POST /canvases/:id/run`. Gated by the `kusto.enabled` config flag.

### system_one

Exposes the Decision API to the chat model. Args are `sources` (1–8 refs) plus
`questions` (same shape as `DecisionRequest.questions`). Refs: `{ tool, nth?, turn? }`
(`nth` -1 = latest settled call, 1 = first; `turn: 'current' | 'any'`, default `any`),
`{ last: 1..5 }` (last N completed results), `{ file, lines? }` (workspace-root confined via
realpath), `{ text }` (≤ 4 KB). Tool names match case-insensitively with any `mcp__<server>__`
prefix dropped. `system-one/source-resolver.ts` resolves refs against a per-process
`ToolCallLedger` (`executors/tool-call-ledger.ts`: live `timelineBuffer` for the current turn +
stored turns, folded by `toolCall.id`, live wins, nested calls skipped, own call excluded via
`invocation.toolCallId`), trims each source head+tail to 64 KB, and joins labeled
`### [n] …` sections into `state` (200 KB cap). It then calls the shared `DecisionService` with
`backend: 'copilot'` and model `gpt-6-luna` whatever the chat provider. Returns compact JSON `{ answers, sources, model,
durationMs }`; errors return `{ error, message, source? }` (`SOURCE_NOT_FOUND`, `SOURCE_PENDING`,
`SOURCE_FAILED`, `SOURCE_OUTSIDE_WORKSPACE`, `SOURCE_UNSUPPORTED`, `STATE_TOO_LARGE`, or a
passed-through `DECISION_*` code) instead of throwing. Provider failures retain their
stable transport category in error `details`; decision readiness uses the explicit
transform capability. Direct transport policy lives in [SDK wrapper](sdk-wrapper.md). The server builds one `DecisionService`
in `server/index.ts` and shares it with the decision route and executors via
`runtime.getDecisionService`; `ChatBaseExecutor.buildSystemOneDeps` binds the ledger to the
process. Offered to all chat providers (ask, autopilot, Ralph, follow-ups) by
`buildSystemOneToolsAddon`, gated live by the `LLMToolSystemOne.enabled` admin flag
(default off); on by default per repo once the flag is on.

## Supporting Modules

| File | Description |
|------|-------------|
| `diff-line-mapper.ts` | Parses unified diff output and maps source-file line numbers to rendered diff-line indices. |
| `llm-tool-registry.ts` | Central user-toggleable tool list (above). |
| `index.ts` | Barrel re-exporting all factories, mapper, and registry. |

## Chat Tool Assembly

`chat-tool-builder.ts` assembles the common chat tool bundle: collect the factories applicable
to the current mode, apply `applyLlmToolPreferences()` from `prompt-builder.ts`, then filter by
the effective disabled-tools list.

Some addons emit a prompt `suffix` wrapped in a named XML-style tag via `tagGuidanceSuffix()`
from `prompt-tags.ts` (currently `<web_search_tool>` and the Memory V2 `<memory_tool>` block),
so the aggregated `toolGuidance` is self-delimiting. Most addons emit an empty suffix — the
follow-up, `ask_user`, and canvas guidance lives entirely in each tool's own `description` and
JSON schema rather than being duplicated as injected prose, keeping the system prompt smaller.
`tagGuidanceSuffix` includes the leading blank-line separator `applyLlmToolPreferences` relies
on; the standalone `tagBlock()` helper wraps non-suffix blocks such as the `<citing_rule>`
source-location directive. Disabling a tool drops its whole tagged block with it.

## Provider Parity (Copilot / Codex / Claude)

The assembled `Tool<any>[]` bundle is passed to every provider via `SendMessageOptions.tools`.
Copilot consumes it natively; Codex and Claude consume the **same already-filtered array**
through `coc-agent-sdk`'s provider-neutral MCP bridge (`CocToolRuntime` + `CocToolBridgeServer`
+ the `coc-llm-tools-mcp` stdio bridge). The runtime calls the same in-process handler
closures, so workspace/process context and `ask_user` blocking survive the bridge. Providers
opt in based on `options.tools`; no executor changes are needed. See
[sdk-wrapper.md](sdk-wrapper.md) → *CoC LLM Tools over MCP*.

## Memory Tools

`memory-v2-tools.ts` builds the two memory tools per invocation from `MemoryV2ToolDeps`:
`createMemoryStoreFactTool(deps)` → `save_memory` and `createMemoryRecallTool(deps)` →
`recall_memory`. They are wired by `buildMemoryV2Addon()` and gated per scope by
`memoryV2.enabled` (global and workspace preferences are independent). See
[memory-system.md](memory-system.md).

## Key Patterns

- **Per-invocation:** every AI call gets fresh tool instances — no shared state.
- **Pre-binding:** tools like `add_diff_comment` pre-bind workspace/commit context at creation.
- **Blocking tools:** `ask_user` returns a Promise resolved externally by the SPA. A
  needs-context response is not a skip — the result tells the AI to explain the missing context
  and re-ask if still needed.
- **Mode-invariant registration:** `ask_user` is registered for both `ask` and `autopilot`
  chats, gated only on the global `chat.askUser.enabled` config. The tool block is serialized
  before `system` and `messages`, so a per-mode difference would invalidate the whole
  conversation's prefix cache when the user toggles the mode pill on a follow-up (follow-ups
  resume the stored SDK session). `ChatBaseExecutor.buildAskUserWiring()` is the single
  construction point for ask, autopilot, and follow-up turns.
- **Interactivity, not mode:** `AskUserToolDeps.isInteractive` is evaluated at call time, so the
  schema stays constant. `FollowUpExecutor` allows human turns and handed-off jobs — a
  machine-triggered turn (cron / wakeup / trigger) without a messaging job origin has nobody
  to answer, so the handler resolves
  on the same tick with `{ skipped: true, reason: 'unavailable', guidance }` per question instead
  of blocking. There is no timer fallback; Codex pins the MCP tool timeout to 365 days.
  `ExecutorRegistry.getAskUserHandles()` searches the chat, follow-up, and autopilot executors.
- **Messaging question relay:** `emitQuestions(payloads, control)` receives an
  `AskUserEmitControl` (per-question `isPending`/`waitFor`/`answer`/`skip`/`resolveUnavailable`,
  `onCancelAll`). After the dashboard emit, `buildAskUserWiring` hands non-approval questions to
  the late-bound `getAskUserQuestionRelay` runtime capability when the turn supplies
  `questionRelayRequestId` — Ask/sentinel first turns (`payload.relayRequestId ?? task.id`) and
  Ask/sentinel follow-ups carrying `FollowUpTurnOptions.relayRequestId` — or the process has
  `metadata.messagingOrigin`. Handed-off jobs use that durable origin on every turn in every
  mode, with the question batch id as fallback request id. Teams origins include the original
  `threadId` when known. Disconnected job questions stay in the dashboard without reconnect
  re-posting. Dashboard jobs without an origin and approvals stay dashboard-only; registration
  never varies. Ordinary reply parsing and free-text fallback are owned by the
  [server messaging relay](server-architecture.md#messaging-ask_user-question-relay).
- **Ralph grill exception:** the grill terminal round strips `ask_user` from the already-built
  array to end the questioning phase. It is the one path that mutates the tool block mid-turn.
  Because it runs after the system message is assembled, the Codex discovery block below can
  outlive the tool for that single round.
- **Codex discovery block:** Codex models in `code_mode_only` (e.g. `gpt-5.6-sol`) see no bare
  top-level `ask_user`; CoC's MCP tools are deferred behind `functions.exec` under the
  `mcp__coc_llm_tools__` prefix. `buildCodexAskUserDiscoveryBlock()`
  (`chat-turn-system-message.ts`) appends a `<codex-ask-user-discovery>` block, after the tool
  guidance, mapping the bare name to `tools.mcp__coc_llm_tools__ask_user(...)` and separating it
  from the Codex built-in `request_user_input` (whose Plan-mode restriction does not apply).
  It is Codex-only and gated on `askUserAvailable`, derived from the *filtered* `ctx.tools` via
  `ChatBaseExecutor.askUserSurvivedFiltering()`, so a workspace that disabled the tool receives
  neither the tool nor the claim. It is discovery-only — behavior stays in the tool description.
- **Ask-user answer routing:** resolvers live in each bridge's own `ExecutorRegistry`, but
  `pendingAskUser` is persisted in the single shared `ProcessStore`, so a foreign repo's bridge
  sees a matching batch with absent handles. `MultiRepoQueueRouter` therefore addresses the
  owning bridge directly (root from `proc.workingDirectory`, else `metadata.workspaceId` →
  workspace `rootPath`; unresolvable → `false` → 404) instead of scanning, and
  `CLITaskExecutor.ownsProcess()` refuses a batch whose working directory is provably under a
  different root. A missing bridge root or missing `proc.workingDirectory` still claims;
  subdirectories of the bridge root count as owned.
- **WebSocket broadcasting:** side-effect tools broadcast events for real-time SPA updates.

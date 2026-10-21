# LLM Tools

AI tool factories injected into chat executor sessions. Each factory creates fresh
tools per invocation; conversation-level tool data is explicitly owner-qualified. All tools use
`defineTool()` and the `Tool` type imported directly from `@plusplusoneplusplus/coc-agent-sdk`
(the provider-neutral contract owner), not via the forge re-export.

## Tool Registry

`llm-tool-registry.ts` owns `LLM_TOOL_REGISTRY`, the list of user-toggleable tools. Each entry
has `name`, `label`, `description`, `enabledByDefault`, and optional `scriptable` (default true;
false for `ask_user`, `suggest_follow_ups`, `create_pull_request`, `send_to_conversation`,
`browser`). Exports: `DEFAULT_DISABLED_LLM_TOOLS`, `getEffectiveDefaultDisabledTools()`,
`filterDisabledLlmTools()`, `isScriptableLlmTool()` (unregistered tools are never scriptable).
The folder has no barrel `index.ts`; import each tool module directly.

### Gating

`getEffectiveLlmToolRegistry({ cronEnabled, canvasEnabled, kustoEnabled, llmToolSystemOneEnabled, browserControlEnabled, toolScriptingEnabled })`
filters `scheduleWakeup`, the canvas tools (`CANVAS_LLM_TOOL_NAMES`), `kusto_query`
(`KUSTO_LLM_TOOL_NAMES`), `system_one` (`SYSTEM_ONE_LLM_TOOL_NAMES`), and `run_tool_script`
(`TOOL_SCRIPTING_LLM_TOOL_NAMES`) out of the settings list when their flags are off. `browser` is filtered when `browserControlEnabled` is off.

`getEffectiveDefaultDisabledTools()` disables `tavily_web_search`, `save_memory`,
`recall_memory`, and `sentinel_jobs` by default, independently of UI layout mode.

### To-do Scrubber child chats

`getSentinelScrubber` is a late-bound executor capability published by route composition
and gated by `sentinelTodoScrubber`. Ask tasks carrying
`context.sentinelScrub` mark their run running and receive only `submit_scrub_findings`
from the CoC tool bundle. A missing capability rejects the turn. Ordinary chat tools,
ledger writers and `send_to_conversation` are excluded. Scrubber turns are unattended:
ask-user wiring is noninteractive and enabled dangerous-command guards omit approval
callbacks, preserving auto-deny with audit reporting. Findings remain pending until
queue completion; cancellation, failure and timeout apply nothing. Submission must
cover every snapshot item, including explicit unverified reasons when checks fail;
incomplete batches leave the submission slot available.

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
| `ask-user-tool.ts` | `ask_user` | Structured questions (select, multi-select, yes/no, confirm, text). Blocks until the user responds. Persists the pending payload on `AIProcess.pendingAskUser` and emits an SSE event. Results distinguish answers, skips, cancellations, `deferred: true` / `reason: "needs-context"` responses with optional notes, and `reason: "unavailable"` short-circuits on non-interactive turns. With `features.sensitiveInput` (default off, live) the schema adds a `sensitive-input` type with `sink` (`SENSITIVE_INPUT_SINKS`, v1 `browser.cookies`) and `sinkArgs` (`domain`, optional `viewId`); the flag is re-checked per call, and the payload carries sink/sinkArgs but never options, defaults or the secret. It answers only through `answerQuestions` with a strict `receipt` (`{ ok: true, count }` / `{ ok: false, reason: 'invalid-input' | 'import-failed' }`, checked by `parseSensitiveInputReceipt` in the route, live path and post-restart resume); the model gets `{ ok, sink, domain, count | reason }`, and single-answer paths (relay) are refused. `AskUserInline` keeps the paste in a masked field outside the draft store, calls the desktop preload `importCookies` (which returns `{ ok, count }`) through `sensitiveInputSink.ts`, then posts only the receipt; a dashboard without the bridge answers `{ skipped: true, reason: 'unavailable' }` (sensitive-only input), which resolves with the desktop guidance. Sensitive questions never reach the WhatsApp/Teams relay; on a connector-owned turn (`AskUserQuestionRelay.owns`) `buildAskUserWiring` resolves them `unavailable` and leaves them out of `pendingAskUser` and SSE. |
| `resolve-comment-tool.ts` | `resolve_comment` | Marks inline comments resolved; tracks resolved IDs in a per-invocation Map. |
| `save-classification-tool.ts` | `saveClassification` | Persists per-hunk diff classifications for PR/commit/branch-range review. Categories: `logic`, `mechanical`, `test`, `simple`, `generated`. New `test` hunks require `testFidelityComment`, `logic` hunks require `summaryComment`; critical metadata is validated rather than dropped. |
| `search-conversations-tool.ts` | `search_conversations` | FTS5 transcript search, recent metadata browsing, and workspace-scoped displayed-title lookup — see below. |
| `send-to-conversation-tool.ts` | `send_to_conversation` | Create/post dispatch and explicit local cancellation — see below. |
| `list-workspaces-tool.ts` | `list_workspaces` | Read-only local + remote repo/group discovery for `send_to_conversation` targets — see below. |
| `canvas-tools.ts` | `write_canvas`, `read_canvas`, `extension_canvas` | Chat canvas side-panel artifacts — see below. |
| `kusto-tools.ts` | `kusto_query` | Kusto/KQL against Azure Data Explorer — see below. |
| `browser-tools.ts` | `browser` | One validated 14-action desktop-browser tool with compact refs, deltas and saved screenshots with opt-in model viewing. |
| `system-one-tool.ts` | `system_one` | Quick yes/no, choice, or score judgments over refs to earlier tool results, files, or short text — see below. |
| `get-conversation-tool.ts` | `get_conversation` | Full transcript by processId, compacted to a token budget via 5 progressive levels. Supports `fromTurn`/`toTurn` paging. |
| `suggest-follow-ups-tool.ts` | `suggest_follow_ups` | Emits follow-up action suggestions after an AI response. |
| `create-pull-request-tool.ts` | `create_pull_request` | Opens a GitHub/ADO PR for the chat's own repo via the shared `git/create-pull-request-service.ts` (commits mode in a temp worktree, or current branch) and writes the chat ↔ PR binding. Autopilot/Ralph write turns only — ask mode and Ralph final-check never receive it (the one intentional ask/autopilot tool-block difference). |
| `tavily-web-search-tool.ts` | `tavily_web_search` | Live web search via Tavily. Key from `~/.coc/providers.json`. Disabled by default. |
| `submit-scrub-findings-tool.ts` | `submit_scrub_findings` | One structured findings batch from an owner-bound scrubber child chat. |
| `sentinel-todos-tool.ts` | `sentinel_todos` | Sentinel chat to-do ledger bookkeeping — see below. |
| `sentinel-jobs-tool.ts` | `sentinel_jobs` | A Sentinel's own custom to-do jobs and To-do Scrubber, on user instructions — see below. |

### query_pull_request

`features.queryPullRequestTool` gates the read-only, repository-bound query/get
service. The published `ids` schema accepts a positive integer or a non-empty
array of up to 20 positive integers; omitting it selects query mode.
Cursor parsing bounds offsets to the fixed 100-candidate page and accepts only
nonempty continuations; ADO continuations are canonical nonnegative safe integers.
Malformed positions fail before client creation, credentials or provider I/O.

GitHub search rollups with more than 100 contexts resolve CI through
head-pinned adapter reads. The adapter paginates check runs and combined statuses;
aggregation uses every returned check before get-mode detail rows are capped at
100 with `checksTruncated`. Provider failures cannot establish passing or empty CI.
GitHub reviews are paginated to completion before selecting each reviewer's latest
deciding vote; page failures expose unavailable reviews, never partial history.

ADO head-pinned checks read all latest-per-context commit statuses in 1000-row
pages before aggregation. Missing pages and transport errors discard partial
statuses; unpinned best-effort callers retain single-page reads.

Each invocation binds its abort signal to the provider client. Request checkpoints
cover adapter pagination, ADO API acquisition and identity transport loading;
late in-flight completions cannot dispatch further provider requests.

### suggest_follow_ups

Default-off live `features.sentinelNextSteps` selects optional 1–3 distinct actions,
best first, for Sentinel first turns and follow-ups. `getSentinelNextStepsEnabled()`
reads the queue's authoritative config; tool preferences still gate availability.
`buildFollowUpSuggestionsAddon` adds the compact `<sentinel_next_steps>` guidance only
when the tool survives filtering. Its mode-specific schema and handler preserve one
to three actions; ordinary modes retain exact-three guidance/schema. Suggestions grant
no execution authority. Click handling is covered in [chat-composer.md](spa/chat-composer.md).

### search_conversations

`title` selects literal case-insensitive displayed-title matching, scoped by explicit
or invoking `workspaceId`, and cannot combine with `query`. It scans chat summaries
in 200-row pages before matching-result pagination, excludes archived/current chats,
and returns server/workspace labels plus `ambiguous` across all matches.
Custom titles take precedence over generated titles and prompt previews. Ambiguous
results instruct the Sentinel to ask which chat to attach. Remote clone keys use
`WorkspaceDirectory.getRemoteChatSummaries` and the selected registered server's
current endpoint (`GET /api/processes/summaries`). Results retain the clone key,
connection alias, optional durable `serverIdentity` and raw workspace ID. Directory
rows/cache retain observed identity; a known replacement excludes cached rows. A
summary scan binds to the listing identity and one internal endpoint/identity target;
changes before or during any page reject the scan. Delayed workspace reads cannot
publish after destination changes. Only local searches exclude the invoking process
ID; remote IDs may collide. Unavailable or invalid remote pages discard partial
matches without local chat fallback. Title lookup reads no transcripts.

`source: dashboard` requires `title` and the exact `target: { serverIdentity,
workspaceId }` from dashboard workspace discovery; unknown identity is insufficient.
The invoking workspace's late-bound dashboard relay handles the read and tool abort
signal, including unregistered destinations. Results retain durable identities,
server/workspace labels, producer verification, and full counts for pagination and
ambiguity. This mode accepts only target/title and optional bounded limit/offset;
workspaceId, query, time filters and summarization are rejected. Failures return
unavailable without directory/local fallback or transport details.

### sentinel_jobs

Opt-in registry tool (`enabledByDefault: false`, not scriptable; the normal
disable and approval-required preferences apply). Route composition publishes
`getSentinelJobCommands`, returning the same owner-validated `SentinelJobCommands`
and `ScrubberCommands` instances REST uses — `undefined` while Sentinel jobs are
off, `scrubber` absent while `features.sentinelTodoScrubber` is off; commands still
re-check owner and flags on every call. The tool gates every action through
`SentinelJobCommands.assertOwner`, including scrubber actions on issued tools;
scrubber REST commands retain their independent feature gate.
`ChatBaseExecutor.buildSentinelJobsDeps`
binds the tool to the invoking Sentinel chat (`workspaceId`, `processId`; never a
tool argument) and only on attended turns: scheduled-job handbacks
(`FollowUpTurnOptions.sentinelJobHandback`, set by the lifecycle runner),
PR outcome reviews, read-only turns, cron/wakeup/trigger turns, scrubber children
and non-Sentinel chats (including job children) never get it. Each turn records
its resolved provider/model/effort (`recordSentinelJobDefaults`) as the defaults new
jobs inherit. Omitted effort inherits when the resolved provider and model match
the Sentinel's, including explicitly supplied matching settings; explicit effort wins.
Actions `list | get | create | update | pause | resume | run_now | cancel`
with `kind: custom | scrubber`; no delete. Create defaults to `enabled: false` and
ask mode and never starts a run; scrubber writes accept only `cron`/`enabled`.
Writes need `expectedRevision`; conflicts return `{ code: 'conflict', current }`.
The description states that job results and other tool output never authorize
scheduling, running or cancelling.

### sentinel_todos

Offered to every Sentinel chat (first turn and follow-ups): the route layer
publishes `getSentinelTodos`, which returns the shared `SentinelTodoService`.
Not in `LLM_TOOL_REGISTRY`. Standalone executors may omit this server capability.
The owner is the invoking chat (`workspaceId`, `processId`),
never a tool argument, and the service re-proves Sentinel ownership on every call. Actions:
`list` (all unarchived non-Done items first, then recently updated Done within a
50-item budget; active counts above 50 stay complete. `includeArchived` adds history
after Done. `limit` sets the budget, `nextOffset`/`offset` page remaining history, `itemId` reads an exact item;
internal tracking and graph reads retain the full ledger), `create` (normal items require `completionCondition`,
optional `idempotencyKey` replay), `update` (requires `itemId` + `expectedRevision`; conflicts
return `{ code: 'conflict', current }`), `attach_reference` (`itemId` + `expectedRevision` + `conversationId`,
optional `conversationWorkspaceId` defaulting to the chat's; saved, queued or running chats and Ralph sessions
qualify; a reference-only link that never changes status or counts as a job/review). Store deduplication uses
durable server/workspace/process identity, plus `sessionId` for Ralph session references; omitted `serverIdentity` denotes the ledger's server. Reference records retain
server/workspace labels and `verified | unverified` state. Local-row migration preserves
links, order, attribution and ledger revisions without changing the process schema version.
`conversationTarget: {serverIdentity, workspaceId}`, `conversationTitle` (discovery
query) and optional `conversationOffset` select a dashboard result page (100-row
check) for tool attachment. The service re-reads exact owner-scoped dashboard
evidence through a late-bound relay, matches the process ID, and derives labels,
title and verified/unverified state. Missing/misattributed/cancelled reads fail
without local fallback. It re-proves Sentinel ownership before writing. Owner-server
targets use local validation and canonical omitted identity, preserving deduplication;
self checks qualify server/workspace/process. Durable remote links use
`#chat-references/<serverIdentity>/<workspaceId>/<processId>` with encoded segments.
The REST attachment command remains local-only and rejects remote metadata.
Creation accepts immutable `type: normal | manual` (default normal);
manual items require only a title, with optional Notes/Done when. `create`/`update` accept `priority` (`high`/`regular`,
default `regular`; ledger metadata only, independent of status). `done`/`needs_attention` require a `reason` (also enforced by the store for non-user actors); `done` stores
it as the reviewed outcome (`recordedBy: 'sentinel'`) unless `outcome` is given. Archive/restore
arguments are rejected by the tool; the store enforces user-only archive/restore for manual items.

Default-off live `features.sentinelTodoExternalReferences` offers create/update
`externalReferences` with `{ kind: 'pr' | 'email' | 'link', url, title? }` entries.
An array replaces external links only, `[]` clears, and omission preserves.
Output `references` combines these entries with unchanged conversation attachments;
missing kind identifies a conversation. Safe URLs are validated and deduplicated.
Display references never bind PR outputs, monitor, fulfill dependencies, mark Done
or authorize work. Native PR verdict-only tools cannot edit them.

With default-off `features.sentinelTodoDependencies` enabled,
`set_dependencies` replaces all prerequisites using `itemId`, `expectedRevision`
and typed `dependsOn` edges. `bind_pr_output` explicitly selects one exact produced
PR with named output slot and tracked-job or owner-selection provenance/reason;
`accept_artifact` records an actor receipt for exact phase/reference/SHA-256 content.
`evaluate_dependencies` returns fresh conjunctive readiness, blockers and evidence
links. The owner stays bound to the invoking Sentinel and the service rechecks the
live gate. Ordinary create/update cannot author edges or evidence. These commands
preserve fulfillment and grant no authority; accepted designs remain pending coding
completion.

The tool reads `dependencyReadiness`. Normally user-authorized
`send_to_conversation` carries owner/item tracking into central enqueue and first
execution, which evaluate all prerequisites and retain durable duplicate guards.
Dispatch uses ordinary prompt/mode/provider/model selection. Readiness grants no
new permissions and never executes items automatically. Manual items remain
tracking-only; native cross-server admission rejects without local fallback.
Started work exposes durable review warnings without changing fulfillment.
Operational receipts and transport recovery are described in
[process-store.md](process-store.md#sentinel-dependency-operations).

The tool exposes `list_triggers`, `create_trigger`, `edit_trigger`, `pause_trigger`,
`resume_trigger`, `remove_trigger` and confirmed `run_trigger_now`, bound to the
invoking Sentinel through `getTriggerInfra().sentinelTodoTriggers`. Creation uses
`idempotencyKey`; mutations use rule `expectedRevision`. PR URLs arm one-shot
wakes. Independently gated event schemas accept date rules or
`{ type: 'script-condition', script, intervalMs? }`. Script guidance covers previous
state, silent baseline, repeating changes, unattended tool denial and paused Run now.
Shared service admission rechecks live flags; disabled scripts remain listable,
pausable and removable. Rules never launch jobs or change item status; manual
items and native verdict-only tools cannot author executable rules.

With default-off `features.sentinelTodoTags`, `list` includes the parent-owned
`tagLibrary`; `list_tags`, `create_tag`, `update_tag`, confirmed `delete_tag` and
`suggest_tags` share REST commands. Library writes compare `expectedRevision`;
assignment updates/re-suggest additionally compare `expectedTagRevision`.
Create/update accept `tagIds` and `matchMultiple`. Definitions are user-requested,
never invented by matching. Manual choices/clears stay authoritative; the assistant
cannot re-suggest over them. `tagMatch` exposes failures without discarding edits.
Native PR reviews cannot edit tags.

The addon's `<sentinel_todo_ledger>` guidance tracks concrete intended outcomes
with final-deliverable completion conditions, reuses one item across grilling/implementation/review,
and records phase milestones/spec links in notes. Successful intermediate phases remain pending
(`todo` awaiting approval, `in_progress` during authorized work), not Done or failure.
Successful grilling returns feature work to `todo` awaiting implementation approval;
only explicitly design-only/interview-only overall requests finish at an artifact;
Ask mode and phase-specific design handoffs never redefine coding completion conditions.
Result checks are shallow by default: job/repo, outcome and commit/artifact against the completion
condition, gaps noted; code-detail review or review delegation only when the user asks.
Tracking grants no implementation/retry authority; bookkeeping failures are reported, not repaired by relaunch.
Manual guidance requires clarification before execution and prohibits delegation, job links,
automatic result reviews, normal-item copies, conversion and handoff. AI may maintain manual
items; Done reasons explain available evidence against Done when, or title/notes if omitted.
`list` items carry `jobs[]` links with derived `execution`: live queue state, terminal
outcome with independent delivery and assessment, or `unavailable` for untracked remote links.
Tracked remote links qualify destination/request identity and expose pending/failed transfer.
Admitted remote follow-ups inherit one exact-target registered item; ambiguous, archived,
Done or user-superseded items remain untouched. Linking rechecks the item revision.
Verdict updates pass `reviewedJobs` with exact process/terminal-event identities,
`status` and a reason; the store atomically acknowledges only that evidence under the
item revision in native SQLite; see [process-store.md](process-store.md#sentinel-to-do-store).
Notes/priority edits and delivered parent turns never prove assessment.
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
PR-body guidance lives in the skill and tool's `body` schema.
Invoking the skill authorizes that default; general tool calls still default to
false. Commit-mode submission uses an isolated worktree and aborts conflicts
without moving the active branch/HEAD. A successful result with `bound: false`
means the PR exists but its chat binding was not written. Auto-merge warnings do
not undo creation. Before retrying uncertain creation, inspect branches and PR
state in the owning workspace to avoid duplicate submissions.

`autoFix: true` explicitly authorizes `ci-and-conflicts` repairs in the PR-bound
owner conversation, upgrading a matching CI-only monitor in place. Missing/`ci`
scope authorizes CI only; omitted/false tool arguments preserve existing authority.
The shared `triggers/create-trigger-service.ts` validates ownership and reuses
active/paused monitors without resetting repair history. Arming happens only for
explicit `autoFix: true`; failures preserve PR success with a warning. Results include
`autoFix: { requested, enabled, scope?, triggerId?, warning? }`.

With default-off `features.sentinelPrOutcomeWake`, the exact successful submission
also registers a native outcome watch for its tracked Sentinel-delegated item.
Registration resolves the original owner across local workspaces and is independent
of `autoFix`; failures preserve PR creation and surface a warning. Outcomes request
review only, never repairs, retries, deployment or new jobs. Untracked/history prose
does not establish ownership. See [server architecture](server-architecture.md#delegated-pr-outcome-reviews).

The same `ci-failure` monitor polls authoritative merge previews and current-head
checks. ADO head-pinned checks require successful iteration, PR-status and
commit-status reads and preserve transport errors for authentication/rate-limit
classification; unpinned checks use best-effort status reads.
Conflict identity includes provider/host/repository/PR and head/base SHAs;
unknown previews wait, policies remain blockers, and terminal PRs stop. Database
writer admission and durable owner-chat delivery serialize CI/conflict/manual
repairs. Repair execution uses high-priority FIFO behind existing pause markers,
conversation predecessors and scheduler gates; running jobs keep their slots.
Pending messages retain `queuePriority` and `respectQueueBarriers` through drain,
router promotion and recovery. Other triggers/reviews keep ordinary priority.
Delivery retries reuse receipts with backoff; ambiguous/exhausted outcomes require
human action. Conflict prompts require isolated existing-PR worktrees without
submission or policy bypasses.

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

The Sentinel directive and bundled `delegate` skill prefer relevant same-task, same-owner
follow-ups when reuse preserves tracking and authorization. Follow-ups retain their existing
provider; Auto preference applies to new chats unless the user requests a particular
provider/model. Tracked sends with `todoItemId` reject `processId`; agents report unsupported
reuse and preserve tracking through a fresh explicitly authorized tracked launch.
The tool description requests reuse of application-generated `openLink` unchanged.
`server/shared/chat-reference.ts` builds encoded `#chat-references/<serverIdentity>/<workspaceId>/<processId>`
links for local, remote and Ralph jobs. Server composition supplies installation identity;
post mode reads the existing process's exact workspace. Missing ownership fails before send.
Cancellation omits the link when its owner is unavailable. The SPA's
`shared/dashboard-discovery/chat-reference.ts` resolver verifies current ownership,
including same-server jobs opened from another dashboard, without local fallback.
Create-mode titles stay short and task-specific; existing-chat sends use `processId`.
The JSON schema requires `content` for send or explicit `action: "cancel"` plus `processId`
for cancellation; titles remain optional.

Create mode with `mode: "ralph"` uses the late-bound `getLaunchRalph` capability and shared
`launchRalphSession`. Omitted `entryPoint` and `entryPoint: "execute"` launch iteration 1 with
the existing `{ processId, sessionId, openLink }` contract. `entryPoint: "grill"` admits the
same native Ask/grill-me interview as the Ralph composer and additionally returns
`phase: "grilling"` and `owner: { workspaceId, serverId? }`. The target server owns identity, canonical
goal save/revision readiness and explicit Start approval. It uses disabled-by-default
`ralph.enabled`; no execution is admitted by interview completion. The workspace/title/spawn
link and existing provider/model/effort rules apply. `entryPoint` is create-only Ralph; posts,
cancel and other modes reject it. `plan` stays unsupported. See [ralph-launch.md](ralph-launch.md).

Create-mode `workspaceId` accepts a local ID, a remote clone key `remote:<serverId>:<workspaceId>`,
or a repo name matched case-insensitively over the workspace directory (exact name first, then
`name@server` against the server display name). An ambiguous name errors with every candidate
`id (server)`; no match errors and points at `list_workspaces`. A remote target is started on
that server's own `POST /api/queue` (Ralph: `POST /api/ralph-launch`, which accepts `title`) at its
effective URL via `WorkspaceDirectory.startRemoteChat`. Health reads bracket admission,
pin installation identity separately from the registry alias, and reject changed endpoints
or owners. Admission errors expose `dispatchState`: `not-started` before POST, `rejected`
for definitive 4xx rejection, or `uncertain` after timeouts, lost/invalid replies, HTTP 408/5xx,
or post-admission ownership changes. Uncertain admission requires reconciliation without
duplicate dispatch. Public POST errors include safe HTTP status, not private transport details.
Native grilling first verifies version-1
`/api/ralph-launch/capabilities`; unsupported targets fail before admission, and uncertain POST
acceptance reports inspection/recovery without duplicate dispatch. There is no local fallback for offline or
unreachable servers. Enabled Auto becomes the remote queue routing marker
(Ralph: `autoProviderRouting: true`).
Remote Auto preflights `/api/config/runtime`; a disabled/missing routing flag or a 404
capability endpoint selects the local parent's concrete provider, validated through the remote's
`/api/agent-providers`. Other capability request failures abort. Only that fallback provider and
explicit provider/model/tier overrides travel; remote defaults own model/effort, and no local
spawn link, messaging origin, or parent configuration travels. Dispatch is attempted once;
the returned owning identity qualifies `openLink`.
Remote Sentinel launches and follow-ups use default-off `features.sentinelRemoteResults`
and compatible authenticated destination admission for `resultDelivery: { status: 'tracked',
jobId, remote }`. Origin-only connector context stays outside execution intents. Other
dispatch returns `status: 'unavailable'` with a reason (`code: 'unsupported'` for incompatible
destinations); inspect its link without promising
automatic return or repeating work. See [receipt recovery](server-architecture.md#remote-delegation-admission).
Remote post mode uses the destination's exact raw `processId` and an explicit
`workspaceId: remote:<serverId>:<workspaceId>` clone key. `WorkspaceDirectory.postRemoteChat`
verifies health identity and exact chat/workspace metadata before one scoped
`POST /api/processes/:id/message?workspace=...`, then verifies the acknowledgment's owner.
Remote-prefixed process IDs are ambiguous and rejected; repo names are create-only.
The destination preserves its current provider and mode rules. Explicit effort tiers read
that active provider's remote `/api/agent-providers/:provider/effort-tiers` mapping;
explicit models win, and origin defaults/origins never travel. `steer` maps to `immediate`;
`enqueue` is the default. Buffered admission retains `turnIndex: -1`. Remote post responses
use the same tracked/unavailable result contract. Admission errors use the same dispatch
states and never retry a message after an uncertain response.

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
use response text or the last request's finished assistant turn, with canonical installation/workspace/process
links and validated result-file paths. Cancellation stores a fixed notice summary without partial output.
Missing children settle with failed delivery. Remote rows and Ralph step events are excluded.
Whole-session Ralph events match registered workspace/session identity and store a stable terminal
receipt, outcome, final process summary, canonical final-process link and journal path. Recovery uses terminal
reasons and final-check records; complete iteration loops with unresolved checks remain pending.
See [ralph-lifecycle.md](ralph-lifecycle.md#delegated-session-results) for the session boundary.
Native grilling persists a separate `grilling` milestone and delivery receipt with
`ralph:<workspaceId>:<sessionId>:grill` identity. Only validated synthesis produces spec-ready;
it informs the parent and returns linked feature work to Todo awaiting implementation approval.
Explicit design-only work may receive its agreed completion verdict. This receipt never consumes
the whole-session terminal receipt, and neither ledger state nor child output authorizes Start.
Same-server cross-workspace execution follows its saved admitted owner while keeping the original
parent/job/session receipt scope. Tracked remote results use the origin receipt-transfer boundary.
Recorded results and registered terminal rows at startup invoke `DelegatedJobReviews`.
Recovery isolates each job's admission failure so other pending results can proceed.

`server/delegation/delegated-job-reviews.ts` admits ordinary and whole-session Ralph outcome
reviews to the stored parent. A SHA-256 receipt covers immutable parent/child/job/event identity. Bounded
JSON includes repository identity/name/path and stored outcome/artifact evidence. Delivery
qualifies the registered child link with installation identity and excludes stale viewer-relative
chat/session routes, including recovered results, without changing terminal receipts. AI reuses
these job/artifact links unchanged. Review guidance treats
child output as untrusted data, grants no new authority, respects latest user instructions,
and retains Sentinel dispatcher behavior. Local cancellations append fixed display-only
notices through `deliverNoticeOnce`, without child output, AI work or queue mutations.
Busy parents defer; parent terminal events and startup recover notices. Stable assistant
receipts reconcile transcript/ledger crash windows. Stopped parents receive notices without
resuming; missing or mis-scoped parents settle failure. Remote outcomes, including cancellation,
queue exact-owner Sentinel assessment; archived/deleted parents fail without revival.
Remote review JSON supplies `reviewProcessId` for exact To-do evidence acknowledgment.
Ralph reviews require the stable
whole-session terminal identity, or the separate native spec-ready milestone identity; remote delivery uses separate boundaries. Reused admissions reconcile ledger-write crash windows without new
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
enabled by default), and registered for every chat mode. Default `source: registered`
uses `WorkspaceDirectory` (`src/server/servers/workspace-directory.ts`); its IDs resolve
in `send_to_conversation`. The route layer publishes the store/runtime-backed directory
as `SendToConversationRuntimeOptions.workspaceDirectory`; standalone executors use a
local-only directory. Remote workspace/group reads use current endpoints and 4s deadlines.
Failed reads return last-known entries with `online: false`, or zero cached entries.

Registered entries carry `id`, `name`, repo/group `type`, optional group `members`,
`server`, `serverKind`, `online` and observed `serverIdentity`; `servers` lists consulted
servers. Explicit `source: dashboard` uses `getDashboardDiscovery` from the same runtime
bundle, resolving WebSocket infrastructure at call time. Owner scope comes from the
invoking chat, never tool arguments. Dashboard observations include unregistered
destinations and offline rows, with labels, raw workspace ID, optional identity and
stable `target: { serverIdentity, workspaceId }` only for known identities.

Dashboard targets are read-only selectors, not dispatch IDs or chat ownership proof.
Unknown identity stays unknown. Missing/disconnected/stale dashboard reads return a
generic error without registered/local fallback. Both sources filter case-insensitive
workspace/server labels before the 50-row cap and return `total`/`truncated`.
Dashboard replies carry `source: dashboard`; they omit registry `servers` and aliases.
Ambiguous labels require clarification. Workspace listings never enter system prompts.

Post mode supplies `processId`, ignores any `provider` argument so native session continuity
stays on the existing conversation's provider, expands `effortTier` against that provider, and
lets an explicit `model` override the tier. Create-only titles are ignored in post mode.
Post mode applies no mode default: an omitted `mode` keeps the conversation's current mode and an
explicit one switches it. The route-layer `processes/send-message-capability.ts` resolves it with
`resolveFollowUpMode` (terminal Sentinel mode still wins) before `ProcessMessageDeliveryService`.
With live, default-off `features.sentinelFollowUpResults`, a local Sentinel's post into another
non-Sentinel queue-backed chat reserves a per-request delegated job (`request:<uuid>`,
`child.requestId`) before delivery and returns `resultDelivery: { status: 'tracked', jobId }`.
The request ID is the relay request, pending-message and queue task ID; a requested steer is
queued instead so the turn has its own result. Self-posts, Sentinel targets, non-Sentinel parents
and direct execution stay untracked. Rejected delivery settles the row as failed. That request's
terminal result returns as an ordinary delegated review; tracked posts still reject `todoItemId`.

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

### Browser control

`coc-client/browser-control` shares the closed action schema and validation with
the desktop boundary. Description plus schema is capped at 1600 characters.
`browser-tools.ts` limits snapshots to 6000 characters, deltas to 40 lines,
read pages to 8000 and serialized eval to 4000. Expanded snapshots carry a
full interactive baseline for correct deltas. Desktop read replies include
`textTotal` and already apply the requested offset; eval replies contain page-bounded
`valueJson`/`valueTruncated`, formatted without double serialization. Unpaged replies
are invalid.

`screenshot(ref?, format?: 'jpeg' | 'png', view?: boolean)` defaults to JPEG
quality 75; PNG omits quality. Capture width is capped at 1280 pixels. Screenshots are
saved atomically under
`getRepoDataPath(dataDir, workspaceId, 'browser-screenshots')/<process>/<yyyymmdd-hhmmss>-<seq>.(jpg|png)`.
Results contain a Markdown image link to the saved absolute path, with forward
slashes and an angle-bracket destination. Pixels stay out of model context by
default; `view: true` also includes `binaryResultsForLlm`.

Saved-image rendering uses the page-origin image proxy; remote-clone screenshot
paths are not resolved on their owning server.

`BrowserToolStateStore(dataDir)` owns screenshot directories and serializes plain
selection and snapshot data by workspace/process across turns; it holds no provider
sessions. Process deletion marks state deleted to prevent late writes and removes
its screenshot directory best effort, logging cleanup failures. The machine-local
snapshot domain wipes screenshots and excludes them from export/import.

Each tool factory owns a stable controlling-turn ID, independent of remembered
conversation selection. Targeted relay/main activity carries it through follow-ups
and terminal cleanup. Relay errors and malformed results remain visible failures.

Default-off `browserControl.framesEnabled` adds `frames(offset?)` and explicit
`frame` targeting for read/eval/text-wait/press/scroll. Ordinary snapshots include
bounded frame boundaries and committed origins; refs route input to their owning
frame/document. Snapshot baselines include document/frame scope. The server sends
frame policy separately from model arguments through the owning local/clone relay;
missing capabilities fail explicitly. Frame inventories and contexts are transient,
never browser preferences or process metadata. See desktop control in `spa/shell.md`.

`paste_html(ref, html, text, replaceClipboard?)` is gated by owning-server
`browserControl.richPasteEnabled` plus frame control, both default off. HTML and
plain text together are limited to 128000 characters. The desktop requires the
focused editable ref and its existing selection, writes both OS clipboard formats,
and sends trusted paste without DOM insertion. Nonempty clipboard replacement
requires explicit `replaceClipboard: true`; supplied content remains on the
clipboard, and old contents are never read or returned. Delivery acknowledgement
does not establish editor persistence. Unknown outcomes must not auto-retry.

Every browser action is limited to 60s across the desktop queue, view host and
server relay; `wait` and text-wait deadlines use the same bound. Default-off
`browserControl.backgroundEnabled` lets one desktop window keep serving each
workspace that has an active control turn after the window switches workspace.
Commands reach only that turn's retained owner/session-key scope and run on the
hidden tab without focus or selection changes. Actions that need the screen
(rich paste, Electron frame-session input) fail with `foreground-required:`; the SPA
relay shows a Switch back notice, sends `browser-command-waiting` so the server
pauses that call's 60s timer, and waits without timeout. See `spa/shell.md`.

### kusto_query

Runs a KQL query server-side against Azure Data Explorer using the official
`azure-kusto-data` SDK with the host-owned Rust Microsoft Azure CLI credential and persists the result into a
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
(default on; explicit `false` hides it) and per-repo `disabledLlmTools`.

### run_tool_script

The model writes the body of an async JavaScript function that calls CoC tools as
`await tools.<name>(args)`; only `{ result, logs, calls, callCount }` returns to context (a
throw returns `isError` with `{ error: { name, message, code? }, logs, calls, callCount }`).
`run-tool-script-tool.ts` adapts the provider-neutral engine `runToolScript()` in
`coc-agent-sdk/src/llm-tools/tool-script-runner.ts`: the script runs in a `worker_threads`
worker (eval'd source string, fresh `vm` context with `tools`, `console`, `ToolCallError`, no
`require`/`process`/`fetch`/timers, 256 MB heap cap). Each call is proxied to the parent, which
enforces 50 calls per script, 4 in flight (FIFO), and nesting depth 3 (`tools.run_tool_script`
starts a child runner with its own budget, counting 1 against the parent), then runs the call
through `CocToolRuntime.callTool` with the inner `toolCallId` and the run's abort signal.
Results are JSON-parsed when valid, otherwise strings; images are counted in `calls[].images`,
not passed in. Errors throw `ToolCallError` with `code` `TOOL_ERROR`, `UNKNOWN_TOOL`,
`CALL_LIMIT`, `DEPTH_LIMIT` or `ABORTED`; an unserializable return is `UNSERIALIZABLE_RESULT`.
There is no timeout or output cap: a run ends on return/throw or when the invocation signal or
the turn signal aborts, which terminates the worker, aborts in-flight inner calls and child
runners, and reports open inner calls as `tool-failed` `aborted`. The worker is always terminated.

Background callers can supply JSON `state` (parsed in the VM's realm) and opt into
`requireJsonResult`. Strict results are encoded before leaving the worker, rejecting
non-finite numbers, undefined values, sparse arrays, cycles, accessors and non-JSON
objects without invoking serialization hooks. Chat callers retain normal JSON conversion;
state and strict mode apply only to the run receiving those options.

The `allowNestedScripts` policy is inherited by child runners: false rejects synthetic
`run_tool_script` calls with `ToolCallError` before starting a child, even when the
runtime contains a handler for that name. Its SDK default is true for chat.
`runScriptCondition` defaults it to false; the owner-resolved background caller
may enable it only when `run_tool_script` is enabled and requires no approval.

Inner calls emit `ToolEvent`s with `parentToolCallId` = the script's call id through
`onNestedToolEvent`, bound to `BaseExecutor.buildNestedToolEventHandler(processId)`. That sink
feeds the normal tool-event handler; when the parent id is not on the timeline (Claude/Codex
bridge ids) it maps to the newest running `run_tool_script` row, once per script.
`ToolCallLedger` skips nested calls, so `system_one` refs see only the script call. The SPA
card shows `code` as a Script block and pretty-prints the JSON result. Gated live by
`features.toolScripting` (default on; explicit `false` turns it off), enabled by default per repo, and left out for
Codex chats (`includeToolScripting: false`; Codex code mode already has `functions.exec`),
browser-only bundles, scrubber turns and PR-outcome-review turns.

## Supporting Modules

| File | Description |
|------|-------------|
| `diff-line-mapper.ts` | Parses unified diff output and maps source-file line numbers to rendered diff-line indices. |
| `llm-tool-registry.ts` | Central user-toggleable tool list (above). |
| `index.ts` | Barrel re-exporting all factories, mapper, and registry. |

## Chat Tool Assembly

`chat-tool-builder.ts` assembles the common chat tool bundle: collect the factories applicable
to the current mode, apply `applyLlmToolPreferences()` from `prompt-builder.ts` (effective
disabled list plus context exclusions), then `applyLlmToolApprovalGate()`. `run_tool_script` is
built last over that final list filtered by `isScriptableLlmTool`, so scripts reach only tools
the turn already offers with the same approval policy; the script tool is itself gateable. Its
callable list excludes mode-specific tools such as `create_pull_request`, keeping the tool block
identical across ask, autopilot and follow-ups.

`ChatTurnContextInput.unattendedScript` propagates to the tool bundle, omits
ask-user construction and sets the approval gate's `denyApprovals` policy. Gated
handlers return a denied result before consulting interactive wiring or saved
session approvals. The script engine turns
that result into `ToolCallError`, including for gated tools called by nested scripts.
Ungated tools and workspace preferences retain their normal behavior. Ordinary
bundles retain their existing interactive and noninteractive approval policies.

Production routes through `MultiRepoQueueRouter.runScriptCondition`, the owning
`CLITaskExecutor` bridge and `ExecutorRegistry` to `ChatBaseExecutor.runScriptCondition`.
The executor validates the exact Sentinel owner, resolves workspace/working
directory and reuses shared helper dependencies for `runScriptConditionWithOwnerTools`.
The owner's current active provider (fallback: executor provider) controls Codex
nested-script omission. Startup readiness and lifecycle revocation belong to
[trigger infrastructure](server-architecture.md#sentinel-to-do-trigger-firing).

`runScriptConditionWithOwnerTools` builds the shared context, including Memory V2,
and creates a per-run runtime from the full resolved CoC tool list, not the
ordinary chat-scriptable subset. Background assembly omits `ask_user` and
attended-only `sentinel_jobs` and does not add write-only `create_pull_request`.
It opens no provider session and passes no provider approval callback. Synthetic
nesting requires an enabled, ungated owner script tool; children inherit this policy.
Context/memory and runtime disposal cover success, failure and cancellation;
the script runner retains its trigger-only 60-second abort deadline.

Provider-native/MCP shell handlers are outside the existing `CocToolRuntime`
contract. Calls to unavailable tools raise catchable `ToolCallError`; model calls
never emulate them. Callers recheck live flags and owner/item/rule eligibility
before and after execution, and abort assembly and running tools on revocation.

Some addons emit a prompt `suffix` wrapped in a named XML-style tag via `tagGuidanceSuffix()`
from `prompt-tags.ts`, so aggregated `toolGuidance` is self-delimiting. Most addons emit
an empty suffix: ordinary follow-up, `ask_user`, and canvas guidance lives in the tool's
`description` and JSON schema. Opted-in Sentinel suggestions add compact behavioral guidance.
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

- **Per-invocation:** every AI call gets fresh tools; browser selection/snapshot data is shared only within its workspace/process.
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

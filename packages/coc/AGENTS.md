# packages/coc

Follow [root instructions](../../AGENTS.md). Load
[coc-knowledge](../../.github/skills/coc-knowledge/SKILL.md) and the relevant
references before editing. Paths are package-relative.

## Where to Read Before Editing

| Domain | Read first |
|--------|------------|
| CLI, runtime, storage | [Server](../../.github/skills/coc-knowledge/references/server-architecture.md) |
| Settings | [Admin](../../.github/skills/coc-knowledge/references/admin-config.md) |
| Provider/session policy | [SDK wrapper](../../.github/skills/coc-knowledge/references/sdk-wrapper.md) |
| Processes | [Process store](../../.github/skills/coc-knowledge/references/process-store.md) |
| REST contracts | [REST API](../../.github/skills/coc-knowledge/references/rest-api.md) |
| SSE/WebSockets | [Streaming](../../.github/skills/coc-knowledge/references/streaming-architecture.md) |
| Dashboard routing | [Shell](../../.github/skills/coc-knowledge/references/spa/shell.md), [clones](../../.github/skills/coc-knowledge/references/spa/clone-routing.md) |
| Chat | [Conversation](../../.github/skills/coc-knowledge/references/spa/chat-conversation.md) |
| Git, PRs, work items | [Git/PRs](../../.github/skills/coc-knowledge/references/spa/git-and-prs.md), [work items](../../.github/skills/coc-knowledge/references/spa/work-items.md) |
| Notes | [Notes](../../.github/skills/coc-knowledge/references/spa/notes.md) |
| Canvas/Kusto | [Canvas](../../.github/skills/coc-knowledge/references/spa/canvas.md) |
| Ralph and worktrees | [Ralph](../../.github/skills/coc-knowledge/references/ralph.md) (launch/lifecycle links) |
| MCP, tools, cron, memory, workflows, LSP, remote hosts, sync | [Knowledge index](../../.github/skills/coc-knowledge/SKILL.md#architecture-index) |
| Messaging | [Connector](../coc-connector/AGENTS.md), `src/server/messaging/` |
| Native search/Notes I/O | [Native](../coc-native/AGENTS.md) |

## Scope and API Boundaries

- Support multiple workspaces/servers. Build paths with
  `getRepoDataPath(dataDir, workspaceId, filename)`; do not add top-level per-repo storage.
- Embedded web-page zoom uses desktop browser preference IPC and broadcasts, not
  workspace/server state or app zoom. Browser toolbar controls affect every URL guest;
  HTML previews, editors, terminals and external browser windows keep their own behavior.
- Separate **storage origin** from **execution workspace**. Work items, plans/versions,
  changes, bindings, PR provider state, classification, and review progress use
  `/api/origins/:originId/...` and `*ForOrigin` methods. Concrete `workspaceId` selects
  queue/filesystem/Git/provider execution and validation, not storage identity.
  Do not add repo-scoped PR-provider/origin-state aliases.
- Mutate work items through REST and `src/server/work-items/work-item-commands.ts`,
  not files/duplicated route logic. Invalidate/broadcast both scopes.
- Workspace/process REST, SSE, and WebSockets target their owner:
  use `getCocClientForWorkspace`, `useCocClient(ref)`, or the clone-routed helpers.
  Unresolved remote selections never fall through locally; admin stays page-origin.
  Reject late responses after scope changes.
- Exited-terminal Enter uses `TerminalView`'s manual restart lifecycle and synchronous
  per-tab admission guard. Only a plain keydown focused inside the active viewport
  triggers restart; pasted input and transport disconnection are not process exit.
- `list_workspaces`, `send_to_conversation` remote targets and messaging `list remotes` share one route-layer
  `src/server/servers/workspace-directory.ts` (clone keys, per-server timeouts, last-known
  offline entries). Remote create mode posts to the remote's own queue/Ralph API with no
  local fallback; output never carries paths, URLs, or credentials. Successful remote
  launches expose unavailable automatic parent result return through `resultDelivery`
  and retain the clone chat link for inspecting the outcome.
- `send_to_conversation` create mode defaults to Medium when model/tier are omitted;
  resolve tiers on the destination server after provider selection. Post/cancel have no default tier.
- Remote group selection uses a server-qualified clone key; decode the raw
  group id at the owning API. Groups are page/queue scope; Git uses a member.
  Names are not keys; refresh live membership and preserve search failure states.
- Previews carry resolved workspace/member and clone route through
  operations/caches. Probe group members in order; preview roots never authorize writes.
  Preserve WSL UNC prefixes/root containment.
- Implement on same-origin clones. Local file plans use paths; remote
  source/target plans and canvas plans embed content read from the source client.
  Persist state on the source; execute/own PR gates on the target.

## Runtime, Persistence, and Configuration

- Conversation compaction shares process admission and durable queue dependencies.
  Promote buffered turns before the boundary; later arrivals cannot steer across it.
  Cancel removes queued compaction only. Running compaction never retries after restart.
  Already-admitted messaging callbacks use `enqueueAdmitted` to avoid nested admission locks.

- Production `createProcessStore` uses native `SqliteProcessStore` and `processes.db`;
  `store.backend: file` is ignored; file stores are test fixtures only.
  Native failures fail startup, without JavaScript persistence/index fallbacks.
- Whole-repo search/listing requires Rust; directory listings and subtree walks use native `RepoFiles`. Notes
  search validates capability at composition and authorizes roots before search.
  Indexes/watchers key by `(workspaceId, rootId)`, not paths; failed refreshes retain
  complete snapshots and shutdown disposes watchers. One `RepoFiles` handle per
  workspace owns its file indexes/refresh; dispose it on root change, removal, or shutdown.
  Health `nativeFileIndex`/`nativeContentSearch` both report the full `RepoFiles` capability.
  `src/server/repos/types.ts` aliases native tree/search result types and coc-client
  contracts for metadata, HTTP options and the file-search envelope.
- Content search reads fresh bytes via `RepoFiles`; WSL runs Rust-prepared argv via forge.
  Test Git narrowing/native walks.
  Repo-group file/content search shares controls and ordered dispatch in
  `src/server/workspaces/repo-group-search.ts`.
  Repository metadata reads use forge’s `execGitAsync` for host/WSL routing.
  The fuzzy scorer reference lives in `test/support/fuzzy-file-score.ts` for native parity tests.
  QuickOpen uses server indices; reuse requires the current workspace root
  for each `showIgnored` variant. Payload caps never cap search candidates.
- Restore queues stopped. Activate only after
  wiring and HTTP listening, respecting auto-start policy; never substitute a delay.
- Late-bound capabilities belong only in
  `src/server/executors/executor-runtime-contracts.ts`. The queue bridge extends the
  runtime once, then forwards by identity through registry/chat layers.
  Narrow views exclude static config.
  `test/server/executors/executor-runtime-wiring.test.ts` guards every hop.
- PR tool `autoFix` uses late-bound `getTriggerInfra().createTrigger` and the shared
  `triggers/create-trigger-service.ts` creation path. Scope monitors to the calling
  workspace/conversation and canonical PR origin; arming failures preserve PR success.
- Use `QueueRuntimeConfig`, not `loadConfigFile()`/startup captures.
  CLI/tests inject fixed ports. Add admin settings once in
  `src/config/admin-setting-definitions.ts` plus config types/defaults; generated
  consumers stay derived. Non-admin leaves use `src/config/namespace-registry.ts`.
- `copilot.transformTransport` is an installation-wide Admin setting (Direct HTTP default, restart required).
  Direct one-shot requests use the Copilot CLI account; never persist its token in Admin config.
  System One, the shared Copilot decision backend, and titles use `gpt-6-luna`.
- Desktop Browser settings use installation-wide IPC, including the optional history
  recording control. Read committed recording state and refresh on history invalidation;
  pausing retains existing suggestions. Keep desktop settings out of server config.
- New experimental flags default off; gate server/tools and UI
  boundaries; preserve existing defaults and live/restart semantics.
- Use `src/server/cache/`, not new TTL Maps. Cache dashboard static config
  and invalidate on mutation; avoid per-conversation workspace/config refetches.
- Sentinel to-do ledgers (`src/server/sentinel-todos/`) are bookkeeping only: REST and AI
  tools share `SentinelTodoService`, which proves the parent Sentinel owner before every
  read/write and emits only after the atomic write commits. Item revisions reject stale
  writers (`409` with the current item); there is no hard delete. Never let ledger edits
  start, retry, or cancel jobs. Gate everything on `features.sentinelTodoLedger`. The
  `sentinel_todos` tool is bound to the invoking Sentinel chat via the late-bound
  `getSentinelTodos` runtime capability (undefined while the flag is off).
  With the flag on, Sentinel `send_to_conversation` create mode requires an unarchived
  `todoItemId` before launch and links the admitted job afterwards (link failures are
  reported, never repaired by relaunching). Linked items move to In progress; local
  terminal results reach the item through `createSentinelTodoDelegationHooks` (first result
  per link wins; failed/cancelled/capped → Needs attention unless a later user edit or a
  newer completed attempt supersedes it). Completion never marks Done: only an explicit
  Sentinel/user verdict does. Job execution status is derived on read, separate from item
  status; remote links are always `unavailable`.
  The SPA's To-do tab lives in the unified right panel (see its `AGENTS.md`): a hosted
  Sentinel `ChatDetail` publishes its ledger owner, and the flag hides stored tabs.
- Delegated job ledgers (`src/server/delegation/delegated-job-store.ts`) belong to the
  parent workspace. Preserve parent/child identities, first terminal result, and conditional
  delivery state transitions; child output cannot change routing. Operational receipts are
  wiped through the snapshot registry and excluded from export/import.
  Tool-bound local Sentinel admission and ordinary connector command handoffs reserve
  the child ID and persist the relationship before queue execution. A queued/running
  first Sentinel task supplies mode/workspace only when its process is absent; stored
  processes win over queue metadata. Ralph registration identifies the session at launch
  only. Tool Ralph carries the captured connector origin into iteration 1 before registration
  for parent session-result return, without tracking direct iteration notices; connector Ralph
  grilling requires separate session registration.
  Rejected admission settles delivery as failed; accepted observer errors retain tracking.
  `delegated-job-results.ts` records ordinary terminal events and recovers registered jobs
  from scoped queue/process records at startup. Verify child process ID and stored workspace
  explicitly before borrowing summary/error/artifact data; native reads ignore optional scope.
  Result chat links include the child workspace through `buildChatOpenLink`.
  Registered admission waits for recovery. Ordinary
  recording excludes Ralph steps and remote jobs; unavailable children settle with a diagnosable failed delivery.
  Whole-session Ralph events match registered workspace/session identity, preserving the first
  terminal outcome. Journal recovery prefers the durable session `completion` record, then
  terminal reasons or final-check evidence. Iteration caps/missing signals, rejected follow-on
  admission and final-check terminal publication persist this outcome before emitting. Replay
  cannot admit further work. The bridge persists failed/cancelled execution iterations and
  admitted check/repair tasks
  before returning: failure reviews use `iteration-failed` or `final-check-failed`; cancellation
  uses passive notices. Check identity must match the current queued/running record; failed
  repair follow-ups bypass result parsing. Step metadata is best effort after outcome persistence.
  Paused/stopped/newer sessions and ordinary follow-ups/submit/grilling keep their own lifecycle.
  Explicit resume clears the outcome before admission and restores it on
  rejection; the delegation ledger retains its first outcome. Complete
  iteration loops with pending checks remain silent. Caps do not assert goal completion.
  Queued iteration/check/repair cancellations persist `user-stopped` through the result recorder;
  startup scans scoped queue history. Only the next unfinished iteration or current admitted
  check qualifies; repairs require the persisted attempt and exact checker process. Complete
  iteration phases may await checks. Live admitted tasks win over cancellation history.
  Pauses, stale steps, grilling and submit retain their own lifecycle.
  `ProcessMessageDeliveryService.deliverOnce` admits server-owned reviews with a stable
  receipt in pending messages, queue tasks and user turns. It verifies the parent's workspace,
  preserves queue ordering, rejects stopped parents and never steers. Review pending IDs equal
  their request receipts; drain reuses those IDs and reconciles accepted tasks/turns before replay.
  Correlation repair and drain share process admission with follow-up delivery. Active tasks take
  precedence over history in process lookup. `delegated-job-reviews.ts` admits ordinary and
  whole-session Ralph outcome reviews on recording/startup, using a stable parent/job/event receipt and
  bounded untrusted result context. Resolve the parent's mode into pending/task payloads.
  Reconcile receipt admission before ledger acknowledgement; reuse emits no realtime intents.
  Review completion settles delivery; permanent routing rejection settles failure, while
  transient storage errors remain recoverable. Buffered admission invokes owner-queue recovery
  outside admission; idle completed/failed parents drain the head in order, reconciling terminal
  receipts first. Active queues, stopped parents and pending questions/answers block recovery.
  Cancellation uses `deliverNoticeOnce`: a stable display-only assistant receipt,
  serialized with process admission, without AI work or queue changes. Busy parents defer;
  parent terminal events/startup retry admission, and transcript receipts reconcile ledger
  write failures. Stopped parents can receive notices without resuming. Missing/mis-scoped
  parents settle delivery failure. Ralph uses session terminal receipts; remote delivery remains separate.
  Child completion grants no additional action authority. Connector origins are immutable
  delegation data captured before admission. Parent review answers and passive cancellation
  notices enter `MessagingJobNotices.queueResult` in the parent workspace before ledger
  acknowledgement. Extract only the receipt-correlated parent answer; connector output binds
  to the parent and uses its captured group/thread independently of topic selection. Existing
  notice persistence handles reconnect/restart and quarantines uncertain multipart sends.
- Register persisted families in `src/server/storage/snapshot/`; pass
  `test/server/snapshot-domain-contract.test.ts` for export/import/wipe consistency.

## Chat and Provider Safety

- Monaco selection attachments target a visible follow-up composer or seed the
  new-chat input in their workspace. Hidden or inert composers decline before
  changing state or focus. Attachment channels accept a destination identity
  separate from the payload workspace id; remote callers use concrete clone keys.
  File-selection payloads cap snippets at 4000 characters before routing and
  retain truncation through validation, chip creation and sent-message parsing.
  ChatDetail forwards its sourceSelectionId to both follow-up layouts; subscription
  ownership changes with that destination while validation keeps the raw workspace id.
  Chat pop-out URLs preserve sourceSelectionId through both header and Activity-row
  openers; their shell forwards it to ChatDetail and registers its concrete clone key.
  ConversationArea and normal/pinned turn bubbles preserve that source owner and
  optional endpoint through commit-strip and whisper-popover Git review openers.
  Sent paste cards and follow-up paste chips open full payload snapshots only in a
  matching chat panel, using its scope and the conversation's workspace/source
  selection as tab owner. Both ChatDetail composer layouts pass raw paste content;
  replacing or dismissing the chip preserves open snapshots.
  Working-tree untracked previews pass the concrete owner into PreviewPane for
  selection context and file I/O; local owners use an explicit null route.
  Fallback seeds retain that destination, and drains preserve other owners’ items.
  Activity NewChatArea opts into buffered seeds with newChatSeedDestinationId;
  pop-out commit/PR review composers opt in with their diff panel's owner.
  Shared notes and inline review composers leave it unset. Pending seeds retain their owner
  through capability resolution and are discarded when that owner changes.
- Copilot decisions use explicit `isTransformAvailable` readiness and a two-minute
  deadline per initial/repair attempt. Preserve cancellation, timeout overrides,
  provider error categories and known usage totals. Repair only successful malformed
  decision text; transport/model/usage failures never trigger another inference.
  Copilot direct transforms are opt-in, text-only, and never fall back to SDK.
  Keep agent/session and attachment paths on their established runtimes.
- First/follow-up turns share context/system/policy/runner/settlement helpers
  under `src/server/executors/`; lifecycle owns persistence.
  Mode directives/style belong in user turns, not the system prefix.
- Keep tools mode-invariant; gate call-time behavior and unattended `ask_user`.
  Preserve explicit PR-write/final-check/grill exceptions.
  Codex discovery uses filtered tools; Copilot context tier uses billing metadata.
- Fresh session objects per turn; never cache sessions or add `sendFollowUp`.
  Only supported provider client processes may stay warm.
  CoC send/prewarm/status paths share `warmKey: processId`; cwd is execution context.
- Resume the active provider only. Switches/unbound continuations
  use fresh sessions/bounded handoff via `src/server/executors/continuation-mode.ts`.
  Never pass session IDs across providers.
  Provider UI resolves `activeProviderSession` before original task metadata;
  live responses use turn attribution, never a queued or pending composer choice.
  Model: task/turn > repo mode default > repo default > provider/CLI.
- Stopped chats require `resumeSessionId`/`strictSessionResume: true`; failed resume
  marks `metadata.stoppedChatResume` non-resumable, without replacement/fresh fallback.
- Follow-up delivery/rewind share `src/server/processes/process-operation-admission.ts`.
  Re-read state under admission; contending switches fail `PROVIDER_SWITCH_REQUIRES_IDLE`.
  Rewind holds running/rewind state through mutation; restore terminal status and release
  admission on failure in `finally`.
- Delivery decisions belong in `process-message-delivery-service.ts`. Buffer via atomic
  `appendPendingMessage`, not metadata read-modify-write; draining owns deferred turns.
  Emit intents once; follow-up enqueue sites resolve mode via `resolveFollowUpMode(...)`
  (an omitted mode keeps the chat's mode; terminal Sentinel wins) — never default it to `'ask'`.
  Use `metadataPatch` for field updates.
- REST and `send_to_conversation` explicit `action: "cancel"` share
  `processes/cancel-conversation.ts`. Serialize canonical process admission, cancel linked
  queue tasks, and abort the owning provider; reject remote routes and surface failures.
  Preserve history and fork/source identity; recheck cancellation before registration.
- Tool-free lookups use `src/server/core/one-shot-ai.ts`: deny permissions/ambient MCP.
  Dreams analyzer/critic work uses persisted lifecycle processes, not direct SDK calls.

## Filesystem, Orchestration, and Tool Contracts

- Canonicalize live group roots; reject writable/read-only overlap.
  Pass both sets every turn; unsupported providers fail before session creation.
  See `src/server/workspaces/repo-group-access-policy.ts`.
- Notes root authority is `src/server/notes/notes-root-resolver.ts`, not client paths.
  Task roots are opaque/protected, never user-root config or counted against its limit.
  Native Notes I/O owns containment/symlinks, atomic writes, sidecars, and order.
  See `src/server/notes/notes-write-handler.ts` and native instructions.
- Protect the managed `Plans` root. Retarget Notes chats through the validated
  `/api/processes/:id/note` route and enforce bound-section containment.
  Keep Tiptap dependencies at one exact version and bump the entire set together.
- Canvas mutations use revision-checked `queue.runExclusive`, never direct writes.
  Preserve snapshot/artifact/descriptor order; use the capability runner and sanitize SVG.
  `src/server/canvas/canvas-file-sandbox.ts` checks encoded/decoded shape, resolved
  containment, and realpaths. Data stays canvas-scoped/read-only to consumers; no
  file-write endpoint/repo escape. Diagnostics omit content/absolute paths.
- Native CLI stores are read-only with parameterized filters/path-safe IDs.
  Only explicit import bridges to chats; unavailable stores return typed states.
  Descriptors/factories share one registry; file-backed providers
  read through `src/server/native-copilot-sessions/native-transcript-index.ts`.
- Child tasks use `src/server/task-groups/`/`context.taskGroup` and shared UI;
  best-effort projection must not break execution.
- Ralph uses path journals, `getRalphTaskKind`, and purpose-built check/submit prompts.
  Checks are validation-only; submit completion never queues iterations.
  Persist one repair attempt before requeue. Manual-only work proceeds
  to final-check without another iteration.
- Queue pause/delays/PR gates are repo-scoped; skip releases only the active delay.
  A PR gate admits only its chain and releases only for its matching merge/manual release.
  Schedule writes serialize per repo; runtime keys are `(repoId, scheduleId)`. Await
  writes/reloads; retain
  state on scan failure. Wakeups persist before arming.
- Sentinel chats are dispatchers: ask permissions plus the `<coc-sentinel-dispatcher>` block in
  the mode directive (`chat-mode-directive.ts`); `send_to_conversation` create mode from a
  sentinel defaults to `autopilot`. Delegation prefers explicit `provider: "auto"` unless the user
  requests a particular provider/model. Enabled Auto uses target routing without parent AI
  inheritance. Disabled/unavailable Auto uses the parent's concrete provider after target
  validation; local model/effort inherit normally, remote defaults stay destination-owned.
  Explicit override, quota/runtime, and dispatch failures never trigger substitution.
  Omitted provider keeps ordinary inheritance. No workspace ownership or scan cron; any number may coexist.
  Startup cancels retired Sentinel scan crons (`src/server/cron/legacy-sentinel-crons.ts`).
- Create PRs via `src/server/git/create-pull-request-service.ts` and injected runners.
  The `submit-commits-as-pr` skill uses only `create_pull_request` with nonempty exact
  commits and explicit auto-merge (on unless disabled); general tool defaults stay unchanged.
  Successful structured `create_pull_request` results use forge’s shared detector for
  composer display and completion binding; preserve origin/workspace scoping.
  Commit-mode conflicts abort; the active checkout/HEAD never moves. Worktree execution
  uses owning-server committed objects, fails before queueing, performs no implicit
  network/branch switch, and removes without force/branch deletion.
  Git-tab Fetch/Pull uses the exact current-branch upstream; patch metadata is untrusted.

## Messaging and Secrets

- `features.botManagedConversations` is live and default-off. Only trusted messaging
  admission writes persistent integration ownership; provider selection and human
  composers stay independent. Public REST/realtime projections expose safe gated
  provenance, never private control metadata. Release serializes with admission;
  releasing/released receipt tombstones retain deduplication but cannot relay answers
  or questions. Fork provenance never authorizes source-queue mutations.

- Separate normal messaging from container relays. Config is global; chat receipts
  are workspace-scoped. Admit eligible human/paired-account posts via explicit bindings;
  suppress own/history replay. Dispose polling/reconnect loops/listeners.
  Teams and WhatsApp topic list/select uses `src/server/messaging/chat-target.ts`
  for bounded (10), conversation-free process pages, not unbounded `getAllProcesses`.
  Shared workspace/topic lookup and terminal-task subscriptions belong there;
  both relays resolve request-correlated answers and safe failure notices
  through `src/server/messaging/relay-answer.ts`. Session/usage-limit notices
  include recognized UTC/GMT reset times; other failures use fixed text. Never
  relay raw exceptions or partial output, or borrow another request's error. Receipt files use
  `atomicWriteJsonUnique`; transport, reply wording and formatting stay per connector.
- `src/server/messaging/incoming-images.ts` prepares admitted image batches only
  after local workspace resolution. It reuses chat attachment processing, stores
  temporary files via `getRepoDataPath(..., 'attachments')`, and rejects an entire
  batch on failure. Limits are five images, 10 MB decoded total and 30 seconds total.
  Callers own temporary-directory cleanup until delivery transfers it to executors. Teams/WhatsApp
  image preparation runs inside durable binding admission; queue payloads
  carry SDK attachments, image history and the temporary directory together. Teams prepares
  initial, active and pending follow-ups inside relay receipts, including admission-only
  receipts when answer delivery and bot control are disabled. Image captions bypass
  question-answer consumption and reject control commands. Failed
  queue admission removes prepared files. Normal managers opt into `receiveImages`;
  connector defaults and container consumers remain text-only.
- `src/server/messaging/pending-images.ts` owns lazy captionless-image retention:
  five images per sender/conversation/thread, 30 minutes from the first arrival and
  256 contexts maximum. Workspace/topic changes reject consumption; explicit root
  selections discard their sender, shared Teams-thread selections discard all senders.
  Controls do not consume; following instructions bypass `ask_user` answers and merge
  pending/captioned images only within batch limits. Failed/expired instructional IDs
  stay deduplicated, never replaying as text-only turns. Dispose on disconnect;
  restart requires resend. WhatsApp forwards a connection signal through route
  initialization; Teams pins per-arrival signals through serialized dispatch. Native
  Copilot/Codex/Claude receive SDK files; unsupported image transports fail before SDK execution.
  Captionless Teams roots bind their instruction thread without creating an AI turn;
  grouped root references link to the admitted chat, including queued targets.
  WhatsApp image/prompt quotes retain captured routing and transfer `sourceMessageIds`
  to the durable receipt without changing answer-part ordering.
- Teams/WhatsApp command grammar is one spec table in
  `coc-connector/src/shared/commands.ts` (`parseMessagingCommand`,
  `formatMessagingHelp`, plain-text `MESSAGING_HELP_TEXT`). Help uses native WhatsApp
  bold or Teams Markdown converted to safe HTML by the manager; unknown `/word` or malformed list/select/create replies
  "Unknown command" + help, never the AI. `src/server/messaging/messaging-commands.ts`
  answers selection, help, quota and `compact [instructions]` for both routers via a
  `MessagingSelection` adapter. Quota replies share `formatQuotaReply` across WhatsApp
  and Teams channel/thread commands, report every finite snapshot with `5h`/`7d` window
  labels and `% left`, and preserve unknown values and limit-id prefixes.
  With no selected repo (or a removed one), plain messages
  and topic commands in both connectors use the built-in Global workspace via
  `resolveChatWorkspace` in `chat-target.ts` (fixed reply if Global is missing; the
  selection is not persisted). `select repo` (including re-selecting the current repo or
  Global) clears the selected topic (Teams also `lastActiveTopic`) so the next plain
  message starts a new chat; quote/thread replies, `select topic` and `[chatid]` still
  target their chat. WhatsApp `state.json` keeps its per-repo `topics` map. `compact` targets the quoted/bound-thread answer's
  chat, else the selected topic; it calls `processes/compact-process.ts` (shared with
  the compact route), never enqueues a turn or changes selection, and maps 400/409/422
  to fixed replies. `/ask`, `/autopilot`, `/ralph`, and `/sentinel` parse an explicit mode; plain text keeps
  the chat's mode (new chats run in `sentinel`, the dispatcher, whatever `sentinel.enabled` says)
  via `src/server/messaging/messaging-chat-mode.ts`, never a hard-coded default at the enqueue site.
  Sentinel follow-ups relay `ask_user` and keep the dangerous-command guard like Ask
  (`follow-up-executor.ts` keys both on the interactive agent mode).
  When the target (selected, quoted, `[chatid]`, or bound thread; persisted or still queued)
  is a sentinel, `/ask`, `/autopilot`, and `/ralph` skip the sentinel turn:
  `src/server/messaging/job-handoff.ts` (`createMessagingHandOff`, shared by both routers)
  enqueues a separate job in the sentinel's workspace with `spawnedFromProcessId` +
  `messagingOrigin` and tracks it in the notice ledger; selection is unchanged. WhatsApp
  reacts 👍 and records the inbound id against redelivery; Teams replies in the thread and
  dedupes text bound-thread replies like thread commands. Image handoffs reserve a job
  id and persist a workspace receipt before download; the job payload includes files,
  history and temporary-directory ownership. WhatsApp uses delivered notice receipts;
  Teams uses admission-only receipts with the sentinel as selectedProcessId/selectedTaskId.
  Rejected admission cleans files and permits retry; matching accepted tasks retain
  files/receipts after observer failures. An empty prefix replies
  "Send a message to start a chat."
  `list remotes` and `list topics <n.m|name@server>` browse remote servers read-only via
  `src/server/messaging/remote-browse.ts` over the shared `WorkspaceDirectory`
  (`listRemoteChats` → remote `GET /api/processes`, 10 cap). `n.m` numbering is kept in
  memory per WhatsApp group / Teams thread; remote repos are never selectable, and
  replies carry only server/repo names (failures logged server-side). Bare `list topics`
  stays local. Every topic list (local, remote, Teams thread) renders through
  `formatTopicList` (status emoji, ≤40-char escaped title, relative age; ids only with
  `-v`; no Markdown list syntax so Teams keeps the numbering). `listRecentTopics` sorts
  its bounded page by last activity and `resolveTopic` indexes that same order.
- Ask/sentinel turns started from WhatsApp/Teams and jobs carrying
  `metadata.messagingOrigin` (every turn, including autopilot) relay
  `ask_user` questions one at a time to the originating group/thread through
  `src/server/messaging/ask-user-relay.ts`, wired at emit time via the late-bound
  `getAskUserQuestionRelay` capability. A reply (or a plain message while exactly
  one is pending) answers. Job questions use the saved group/thread even after repo
  selection changes; Teams origins retain `threadId` when known. Disconnected job
  questions stay dashboard-only; failed posts resolve `unavailable`; turn end
  clears pending ones; approvals stay dashboard-only. Ordinary replies preserve
  recognized choice/boolean/array mappings and pass other non-empty text to the
  AI unchanged apart from trimming. Only exact `skip` skips; empty replies reject.
- Local ordinary connector handoffs carry `metadata.messagingOrigin` and use
  `messaging/job-notices.ts` for direct completion notices. Sentinel first-turn notices
  wait for matching parent delegation at the same connector/group/thread. Suppress only
  with durable parent result outbox coverage; failed parent delivery releases a safe child
  fallback. Review admission/settlement reconciles held notices. Later child turns and
  compaction retain direct notices. Receipt states persist per workspace; interrupted sends
  are quarantined. WhatsApp binds replies to the notice's chat; Teams uses the captured
  parent thread for results or binds a top-level child notice. Selection remains unchanged.
- Teams IC3 requires explicit `amer`/`emea`/`apac` and identity-pinned connection
  credentials. Missing region fails before credentials/network; automatic discovery
  is not implemented. Never guess, fail over, or replay IC3 writes.
  Region/account changes require reconnect. Eligible Likes start before routing but
  never block dispatch or subsequent reads; asynchronous failures are sanitized and logged.
- Normal Teams routes explicit ordinary direct sends through IC3, independently of connector
  self-send routing. The enabled, connected bridge's send-only
  `POST /api/messaging/teams/direct-message` requires an existing chat ID, intended recipient
  object ID, current status `connectionId`, and explicit text/HTML. MCP chat metadata/membership
  verifies the exact 1:1 before one bounded IC3 POST; missing access rejects without Graph
  chat consent. Channel bridge/inbound routing stays unchanged. No creation, group/channel DM,
  mentions/replies, fallback or replay; unknown outcomes require manual reconciliation.
- Normal Teams `outboundBackend` defaults to `graph`; explicit `mcp` remains supported. Graph routes channel
  sends/replies through stable v1.0; authoritative channel roots and paginated replies always use Graph beta
  (preview API subject to change),
  including omitted saved settings and explicit MCP writes. MCP owns discovery/create;
  IC3 Likes remain independent/default-off/nonblocking. Separate Azure CLI Graph read
  credentials require delegated `ChannelMessage.Read.All`; writes require `ChannelMessage.Send`.
  Existing broader grants are accepted, not requested. Both credentials pin to the
  configured MCP tenant/object identity. Reply reads use the live answer-relay gate,
  enabled by default; explicit `features.teamsAiAnswerRelay: false` opts out.
  Changes disconnect/reconnect; never fall back or replay ambiguous receipts.
- Normal Teams connection settings expose experimental `enableTrouter` (off by default)
  through the messaging config API and Connections card; changing it disconnects and
  requires reconnect. Notifications use separate, identity-pinned Azure CLI IC3 credentials
  without requiring a write region. Known-root wakes prioritize Graph replies without
  root scans; startup/gaps/fallback reconcile known threads through the shared ID/binding
  admission scanner. Fallback is completion-relative 60 seconds.
  Status exposes sanitized `notificationStatus` separately from reader connectivity;
  the Connections card displays notification degradation while fallback remains connected.
  Private Trouter is best-effort, not durable catch-up; container relay settings are separate.
- Teams setup uses scoped admin styles and native disclosures for advanced settings,
  routing help, and connection history. Keep status/errors visible outside disclosures
  and preserve separate endpoint/channel saves and unsaved-change connect gating.
- Delegated Teams sends use safe HTML with `CoC ·` assistant attribution in the first
  text block; the authenticated user's native sender identity stays unchanged.
  Markdown tables share a safe renderer for outbound messages and AI answers;
  bounded answer parts split at rows with repeated headers. Oversized rows retain
  their column labels as text. Chunk budgets include attribution and table markup.
  Persisted partial receipts resume only with identical chunk boundaries;
  changed boundaries require reconciliation.
  Receipts differ from final answers:
  accepted channel-thread follow-ups settle receipts without an acceptance post;
  new chats retain confirmations. Relay captured terminal turns by request ID
  to the original thread/workspace.
  Normal Teams AI answer relay defaults on for missing settings, independently of
  bridge connectivity, Trouter, Likes and observability. The Integrations toggle is
  live, without restart/reconnect; disabling stops relay and thread reply polling.
  The registry suppresses its experimental badge for the enabled default.
  Selection changes never redirect answers. Persist accepted multipart progress;
  never replay confirmed sends; reconcile unknown outcomes.
  Preserve thread cursors/own IDs on reconnect; WhatsApp shares the receipt rule.
- MCP APIs and connection history expose only allowlisted safe fields, never tokens,
  `env`, headers, full arguments, or provider error bodies. Credentials stay on their host.

## Monaco Selection Context

- `SHOW_DIFF_FILE_PICKER` defaults off. Diff header pickers use only the current
  comparison's changed files and existing viewer/host navigation, preserving the
  source workspace, review chat and Ctrl/Cmd+click source-file opening. Lazy file
  lists are keyed by workspace and diff source; comparison changes close pickers.
- Repository file previews opt into `MonacoSelectionAttachPill`; diff viewers use
  side-local `MonacoDiffSelectionAttachPill` portals and the existing diff-selection
  builder. Git hosts forward their concrete source clone through the detail pane
  to both file-diff and working-tree pills. Inline PR tabs forward the same owner
  through PullRequestsTab, PullRequestDetail and PrFilesPanel; group hosts derive the member clone
  key from the group server. Keep payloads scoped to the raw owner workspace,
  use repo-relative paths, and read live model text.
  Composer routing and context formatting are documented in the
  [composer reference](../../.github/skills/coc-knowledge/references/spa/chat-composer.md).

## Build and Validation

- Root `npm run build` builds workspaces; `npm run build -w packages/coc` runs package
  prebuild/clean emission. Keep scripts cross-platform; Node.js >=24.
- Target server changes with `npm run test:run -w packages/coc -- test/server/<test>.test.ts`;
  `test:run` is non-watch; `test` is Vitest watch mode.
  Use `test:e2e`/`lint` when relevant; docs need no build/tests.
- Docker/tenant changes keep `test/docker/` contracts green: loopback-only bind,
  no exposed/published CoC port, and `COC_BUILD_COMMIT` support without `.git`.
- Keep current safety rules here; details belong in existing domain references/source.

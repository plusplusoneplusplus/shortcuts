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
- Browser rich paste requires owning-server `browserControl.richPasteEnabled`
  and frame control. Relay the policy separately from model arguments and require
  desktop `richPasteSupported`; reject unsupported clients without fallback.
  Native clipboard contents stay desktop-local; results acknowledge delivery,
  not editor persistence, and never echo the payload.
- Separate **storage origin** from **execution workspace**. Work items, plans/versions,
  changes, bindings, PR provider state, classification, and review progress use
  `/api/origins/:originId/...` and `*ForOrigin` methods. Concrete `workspaceId` selects
  queue/filesystem/Git/provider execution and validation, not storage identity.
  Do not add repo-scoped PR-provider/origin-state aliases.
- Mutate work items through REST and `src/server/work-items/work-item-commands.ts`,
  not files/duplicated route logic. Invalidate/broadcast both scopes.
- Workspace/process REST, SSE, and WebSockets target their owner:
  use `getCocClientForWorkspace`, `useCocClient(ref)`, or the clone-routed helpers.
  Unresolved remote selections never fall through locally. Server-owned Admin code
  uses `useAdminServer()` (`admin/adminTarget.tsx`), never `getSpaCocClient()`, so
  the default-off Desktop machine switch can target a registered remote.
  ChatDetail owner WebSocket refreshes coalesce matching notifications per microtask
  batch; preserve later refreshes and discard scheduled work on effect cleanup.
  Dashboard discovery uses `ProcessWebSocketServer.dashboardDiscovery` for targeted,
  read-only topology and title-search requests. Capabilities bind a raw owner workspace and dashboard
  revision; scope/topology changes revoke pending reads. `ReposContext` publishes the
  visible topology to `shared/dashboard-discovery`; the designated local socket and
  remote owner sockets advertise only for the exact selected owner. Include cached
  offline rows, and keep identities/labels separate from private endpoints and aliases.
  Page-origin repo/group rows use only identity observed through the page-origin
  client's bounded health read on mount and each socket connection. Re-observation
  withdraws stale identity; failure/unidentified health leaves ownership unknown.
  Abort superseded/disposed reads and suppress late results, including ignored aborts.
  Title-search relay requests pin a durable server/workspace selector and bounded
  pagination; replies require matching identity, labels, verification, full match
  count and title-only rows. Reject malformed/partial results and cross-kind replies.
  The SPA title producer resolves only a visible durable destination, prefers online
  aliases, verifies live health identity before every summaries page and after scanning, and matches
  displayed titles before output pagination. Cancellation, topology changes and socket
  teardown abort I/O and suppress late publication. Completed verified scans persist
  title-only inventories in the browser under durable server/workspace identity.
  Offline visible targets search that exact cached inventory as unverified; unknown
  identities, malformed caches and failed online reads fail without local fallback.
  Topology observations are not ownership verification; discovery never broadcasts.
  Reject late responses after scope changes. Sidebar queue snapshots supersede
  stale queue reads, not independent history reads; reconcile admitted history
  against current active jobs and local process title/preview updates.
- Collapsed workspace-rail job previews share `RailHoverPreview`. Pinned rows come
  from the owning workspace's full pinned-process read, overlaid with the chat
  list's live pin/archive state and tab/type visibility; do not derive them from
  queue status arrays or aggregate member pins for a selected group. Preview unpin
  shares the list's owner-scoped pin action; discard stale reads/results and return
  focus to a surviving row or rail control without expanding. `RailJobMetadata`
  keeps status/type separate from execution-mode pills. Queue and pinned snapshots
  project owner-verified current process modes in a transcript-free batch; Ralph
  identity wins, unknown modes stay omitted, and mode changes refresh queue snapshots.
  Collapsed-rail Git tiles use the same previews, read only the
  owner's git-info/working tree (groups: per-member git-info, never a group branch).
  Sync previews lazily page the expanded Git outgoing prefix on that owner;
  commit routes retain page/member/clone ownership and already-read metadata.
  Never fetch or mutate Git on hover, or show unknown, no-upstream or detached
  state as clean or 0/0.
  Rail Admin/quota shortcuts (`features.railStatusActions`) are portals from the
  docked `StatusActions` footer; never give the rail its own quota hook or fetch.
- Terminal native paste is captured inside the focused `TerminalPanel`, consumes
  only `text/plain`, cancels parallel/default insertion, and uses xterm `paste()`.
  Clipboard shortcuts leave browser/Electron paste enabled without async reads;
  context-menu reads also use `paste()` for newline/bracketed-paste handling.
- Exited-terminal Enter uses `TerminalView`'s manual restart lifecycle and synchronous
  per-tab admission guard. Only a plain keydown focused inside the active viewport
  triggers restart; pasted input and transport disconnection are not process exit.
- `list_workspaces` defaults to registered dispatch targets; these, `send_to_conversation`
  remote targets and messaging `list remotes` share one route-layer
  `src/server/servers/workspace-directory.ts` (clone keys, per-server timeouts, last-known
  offline entries). Remote create mode posts to the remote's own queue/Ralph API with no
  local fallback; output never carries paths, URLs, or credentials. Successful remote
  launches expose unavailable automatic parent result return through `resultDelivery`
  and expose canonical `#chat-references/<serverIdentity>/<workspaceId>/<processId>`
  links with independently encoded segments for inspecting the outcome. Local tool
  replies and delegated-result evidence use the same identity-only builder in
  `src/server/shared/chat-reference.ts`. Server composition supplies installation identity;
  remote admission verifies the owning server through health reads around its single
  POST. Never substitute a transport alias, endpoint or viewer's server identity.
  AI reuses generated job/artifact links unchanged; the existing SPA resolver verifies
  visible ownership and fails unavailable without local fallback. Explicit `source: dashboard`
  reads the invoking workspace's dashboard relay through a late-bound runtime getter,
  including unregistered/offline destinations. Its stable server/workspace `target`
  is read-only, not a dispatch ID or ownership proof; unknown identities have no target.
  Relay failures never fall back to the registered directory.
- `search_conversations` title lookup scans workspace-scoped chat summaries before
  result pagination, uses displayed titles, and reports ambiguity with server/workspace
  labels. Remote clone keys use the shared workspace directory's index-only summary
  reader at the current endpoint, binding every page to one endpoint and durable server
  identity. Directory caches retain observed identity and reject known replacement owners;
  delayed reads cannot publish after destination changes. Keep connection aliases, durable
  server identity and raw workspace identity separate in results;
  exclude the invoking process only for local searches. Unavailable remote reads discard
  partial matches and never fall back to local chat reads. Explicit `source: dashboard`
  requires a displayed title and exact `target: { serverIdentity, workspaceId }` from
  dashboard workspace discovery. Use the invoking owner's late-bound relay, forward
  tool cancellation, and preserve full match counts, labels and verification. Reject
  bare workspace IDs and unsupported query/time/summarization filters in this mode;
  relay failure never retries against the directory or local store.
- `send_to_conversation` create mode defaults to Medium when model/tier are omitted;
  resolve tiers on the destination server after provider selection. Post/cancel have no default tier.
- Remote group selection uses a server-qualified clone key; decode the raw
  group id at the owning API. Groups are page/queue scope; Git uses a member.
  Names are not keys; refresh live membership and preserve search failure states.
- Previews carry resolved workspace/member and clone route through
  operations/caches. Probe group members in order; sibling-relative paths must land
  inside a live member and report that containing member as owner. Preview roots
  never authorize writes. Preserve WSL UNC prefixes/root containment.
- Implement on same-origin clones. Local file plans use paths; remote
  source/target plans and canvas plans embed content read from the source client.
  Persist state on the source; execute/own PR gates on the target.

## Runtime, Persistence, and Configuration

- Server composition provisions one UUID in `<dataDir>/server-identity.json` and
  exposes `serverIdentity` through `/api/health`. It identifies the installation
  across workspaces, transports and port changes. Preserve it on restart; invalid
  or unreadable identity files fail startup rather than silently replacing identity.
  Remote health/runtime/list contracts carry this identity separately from registry
  aliases. Managed entries refresh identity while online; endpoint changes require a
  new probe. Registry edits/removals and newer probes revoke delayed health results.
  Dashboard remote workspace sources/markers and their offline cache retain the
  identity observed with the workspace list. Cached rows keep that identity while
  disconnected; a known replacement identity excludes the old cached rows. Missing
  identity stays unknown and must never be replaced with a registry alias or URL.

- Admitted chat image files stay at their existing per-turn paths after success,
  error or cancellation so local delegated children can read them. This temporary
  policy preserves rejected/unadmitted and non-image cleanup, including mixed uploads.
  OS temp cleanup is environment-dependent, not guaranteed under disk pressure;
  remote paths and native delegated image forwarding remain unsupported.

- Memory V2 tools `save_memory` and `recall_memory` default off in `LLM_TOOL_REGISTRY`.
  Honor explicit workspace `disabledLlmTools` lists; keep memory scope gates and prompt context independent.

- Conversation compaction shares store-owned execution admission with queued turns;
  mutation admission stays short so messages and cancellation can enter during SDK work.
  Manual compaction follows admitted/buffered turns. Due auto-compaction reserves the
  persisted response boundary before draining: queue admission atomically inserts it
  ahead of queued successors, then promotes buffered messages in order behind it.
  Later arrivals cannot steer across the boundary. Cancel removes queued compaction
  only. Running compaction never retries after restart.
  Already-admitted messaging callbacks use `enqueueAdmitted` to avoid nested admission locks.
  `compact-process.ts` resolves one shared Sentinel instruction from `metadata.mode` for
  automatic and unfocused manual compaction; explicit manual focus overrides it verbatim.
  Ordinary chats retain provider defaults. Copilot and Claude accept the instruction;
  Codex ignores custom instructions and warns.
  Sentinel auto-compact (`processes/auto-compact.ts`) is opt-in per chat and server-side only:
  checks `currentTokens > thresholdTokens` after a persisted response, one attempt per
  response, always queued; model limits never rescale the absolute threshold. The default
  is OFF with a 700k input matching the mock design. Both context popovers use one switch/k
  input row, Enter/blur auto-save and one status line; owner-bound drafts survive failures.
  Unknown or at/above-limit thresholds warn without capping. It adds no deadline or abort
  to running compactions. Only its own endpoints write `metadata.autoCompact`.

- Production `createProcessStore` uses native `SqliteProcessStore` and `processes.db`;
  `store.backend: file` is ignored; file stores are test fixtures only.
  Native failures fail startup, without JavaScript persistence/index fallbacks.
- `DelegatedJobStore.recordPullRequest` stores each exact submitted PR's canonical
  provider identity and item receipt in the originating workspace's existing job ledger.
  Replays preserve the receipt. `SentinelPrOutcomeService` verifies tracked ownership
  and item eligibility before native monitoring under default-off
  `features.sentinelPrOutcomeWake`, independently of CI/conflict repair permission.
  Outcome reviews use dedicated read-only admission; stopped Sentinel reviews restore
  stop and never promote ordinary buffered work. Per-item pause retains terminal evidence.
- Sentinel To-do conversation references use durable server/workspace/process identity
  for storage and idempotent attachment. `SentinelTodoStore` migrates local rows
  transactionally without changing the shared process schema version; omitted
  `serverIdentity` means the ledger's server. Persist labels and verification as
  display metadata, never endpoints or registry aliases as durable identity.
  `sentinel_todos.attach_reference` uses an exact `conversationTarget`, discovery
  title and optional result-page offset for dashboard destinations. The service's
  late-bound owner-scoped relay rechecks the selected process and derives labels
  and verification, including unverified offline matches. Re-prove Sentinel
  ownership after I/O; abort/failure never falls back locally. Owner-server targets
  canonicalize to local references; qualify self checks by workspace and server.
  Remote links retain encoded durable segments under `#chat-references/`.
  `shared/dashboard-discovery/chat-reference.ts` parses and resolves these against
  current visible topology, preferring an online exact server/workspace alias.
  Health checks bracket a transcript-excluded exact-process metadata read; changed
  topology, ownership or cancellation rejects without fallback. The resolver returns
  a concrete clone chat route without changing selection; callers own read deadlines
  and immediate navigation. `dashboardRoutes` reserves durable reference hashes,
  including malformed links, without selection effects. Router holds them in
  `DashboardChatReferenceRoute` until exact verification succeeds, waiting up to
  ten seconds for topology/identity observations and offering explicit Retry on
  failure. Topology changes revoke pending reads; navigation, pagehide and unmount
  cancel them. Only verified current clone routes reach normal chat selection.
  REST attachment stays local-only.
- `storage/conversation-tool-inventory-store.ts` borrows the process database and
  retains one pending/captured inventory per process outside metadata, transcripts
  and SSE. Server composition shares it through `getToolInventoryStore`; initial
  and follow-up executors begin pending before runtime initialization and forward
  capture through `chat-turn-runner.ts`. Capture once under the opaque turn identity;
  cancelled, settled and stale callbacks cannot overwrite newer turns. Reads/writes
  verify the persisted process owner. Safe descriptor projection and byte limits
  apply on writes and lazy reads; persistence failures fail the turn.
  `GET /api/processes/:id/tool-inventory` requires the owning `workspace` and uses
  the composed store's `getForProcess` without transcript hydration or runtime probes.
  Missing/foreign processes return 404; owned chats without snapshots are unavailable.
  Use cancellable `processes.getToolInventory` on the owner-resolved client.
  `ChatDetail` binds inspection to its current hydrated owner client and persisted
  raw workspace/process; loading replacements and unresolved owners omit the target.
  `ChatHeaderMetadata.toolInventoryTarget` carries this identity and an owner-scoped
  refresh key through normal and Notes headers. Durable pending/capture writes emit
  descriptor-free `tool-inventory-changed` WebSocket invalidations; exact-owner
  observers refresh open readers at both boundaries and on reconnect. Remote pop-outs
  maintain their own owning-server event stream. A supplied target enables
  the metadata footer's Tools action beside Fork, including a Tools-only footer;
  metadata-only native sessions omit it. Opening `ConversationToolsDialog` closes the
  popover/mobile sheet and performs lazy storage retrieval only. Scope/turn changes
  clear stale results; pending captures poll while open. Preserve explicit completeness
  gaps and use `Dialog`'s focus trap with the surviving metadata trigger for focus return.
- Whole-repo search/listing requires Rust; directory listings and subtree walks use native `RepoFiles`. Notes
  search validates capability at composition and authorizes roots before search.
  Notes indexes key by `(workspaceId, rootId)`; failed refreshes retain complete
  snapshots. Filesystem consumers use the shared `NativeWatchService`: workspace-owned
  subscriptions share one native OS watch per real root. Rust owns debounce, filtering
  and recovery; full-rescan batches invalidate consumers. Workflow/template watchers
  share the workspace's `.vscode` root, never a recursive repository-root watch.
  Tests inject batches, not filesystem events. Server scopes isolate workspace
  removal/shutdown, including
  equal workspace IDs in different local servers; the final scope releases an idle
  native owner. One `RepoFiles` handle per
  workspace owns its file indexes/refresh; dispose it on root change, removal, or shutdown.
  Health `nativeFileIndex`/`nativeContentSearch` both report the full `RepoFiles` capability.
  `src/server/repos/types.ts` aliases native tree/search result types and coc-client
  contracts for metadata, HTTP options and the file-search envelope.
  Permanent Explorer deletion uses native `RepoFiles.deleteEntry` on a worker and
  requires a physical workspace plus the owning server's live, default-on
  `features.explorerDelete` flag. Preserve partial-error counts and refresh indexes
  after any mutation; never substitute a Node walker or success on failure.
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
  `triggers/create-trigger-service.ts` creation path. Explicit `ci-and-conflicts`
  scope authorizes CI/conflict repairs; missing/`ci` scope authorizes CI only.
  Validate the PR-bound owner/workspace, resolving owners through
  `processes/process-workspace-resolver.ts` (live queue task, then persisted process
  metadata, so completed owners survive restarts; trigger infra builds it from its
  own bridge/store, and routes/cron share it). Poll authoritative merge previews and
  current-head checks, and serialize automatic/manual repairs with the durable
  PR-qualified writer and `deliverPrRepairOnce`. Repair execution uses high-priority
  FIFO with `respectQueueBarriers`; pending messages retain scheduling metadata
  through drain/promotion/recovery. Running turns, conversation predecessors,
  pauses/delays/freezes and PR gates remain authoritative. Other triggers/reviews
  keep normal priority. Conflict retries include head/base identity, bounded
  delivery backoff and a cross-head budget; ambiguous/exhausted
  outcomes require human action. Repairs use isolated existing-PR worktrees, never
  submission workflows or policy bypasses. Arming failures preserve PR success.
  Sentinel To-do PR-merge firing reserves the shared database writer, rechecks the
  rule revision and owner-scoped item, and persists the terminal decision, immutable
  wake prompt and delivery identity before queue work. Wakes use shared
  `ProcessMessageDeliveryService.deliverOnce` admission and the existing trigger
  scheduler for receipt reconciliation/retries. Trigger code never writes item
  status or launches a job; external PR metadata is data, not instructions.
  `SentinelTodoTriggerService` owns rule authoring with expected revisions,
  eligibility and shared-cap checks. Trigger infrastructure is always wired;
  rules never expire and require no additional approval gate. Clearing rules hides their
  presentation while preserving delivery and keyed authoring receipts; retries
  must not duplicate wakes or revive removed rules.
  Sentinel tool actions use late-bound `getTriggerInfra().sentinelTodoTriggers`;
  the rule owner is the invoking chat, never a tool argument.
- Use `QueueRuntimeConfig`, not `loadConfigFile()`/startup captures.
  CLI/tests inject fixed ports. Add admin settings once in
  `src/config/admin-setting-definitions.ts` plus config types/defaults; generated
  consumers stay derived. Non-admin leaves use `src/config/namespace-registry.ts`.
- Browser-related Admin controls, including browser-specific UI toggles, live on
  Admin → Browser (`ui.tab: 'browser'`, or the desktop-bridge Desktop Preferences
  card for installation-wide engine/profile/history data). Other UI-only Admin
  controls (presentation, layout, navigation, editor UI and interface-only
  toggles) live on Configure → Appearance (`ui.tab: 'appearance'` or the
  Appearance card); functional, auth, transport, AI-behavior and
  response-style settings stay on their domain tab.
- Sentinel-specific Admin controls use registry `ui.tab: 'sentinel'` at
  `#admin/settings/sentinel`. Features search links to that tab; saves and cancels
  affect only its registry keys. Shared triggers and messaging settings keep their own tabs.
  `features.sentinelTodoJobs` is live, experimental and default-off in `sentinelTodos`;
  its Admin row depends on `sentinel.enabled` and publishes `sentinelTodoJobsEnabled`.
- Sentinel prompt jobs (`src/server/sentinel-jobs/`) require both live flags, prove
  the exact Sentinel owner and share the native ledger database. Definitions use
  expected revisions and a ten-job owner limit. A definition holds either an explicit
  model/effort or an `effortTier` resolved by the enqueue path at each run; neither overrides the other. The first run persists one ordinary
  Ask/Autopilot chat; later runs retain it, including after cancellation or failure.
  Snapshot paths stay repo-scoped and read-only. Runs and handbacks use the existing
  low-priority task queue; job metadata grants compaction, never Sentinel identity.
  Active runs and pending handbacks block edits/deletion, but schedule-only
  pause/resume remains available. Cron is future-only, local-time and at most hourly.
  Startup interrupts orphaned runs and reconciles handbacks by receipt; shutdown
  drains admission before disposal. Owner removal revokes work, while unexpected
  owner-read errors surface without cancelling it. Snapshot export/import excludes
  these machine-local definitions; ledger wipe clears tables and snapshot directories.
- `copilot.transformTransport` is an installation-wide Admin setting (Direct HTTP default, restart required).
  Direct one-shot requests use the Copilot CLI account; never persist its token in Admin config.
  System One, the shared Copilot decision backend, and titles use `gpt-6-luna`.
- Desktop Browser settings use installation-wide IPC, including the optional history
  recording control. Read committed recording state and refresh on history invalidation;
  pausing retains existing suggestions. Keep desktop settings out of server config.
- New experimental flags default off; gate server/tools and UI
  boundaries; preserve existing defaults and live/restart semantics.
- Explorer permanent deletion uses the owning server's default-on
  `features.explorerDelete` gate. File panes register owner-qualified dirty paths
  and saves in the window-local Explorer store; affected edits/saves block
  admission, and an admitted deletion makes affected panes read-only. Close
  affected clean file tabs only after success; failures retain buffers and refresh
  disk state. See `spa/client/react/features/repo-detail/AGENTS.md`.
- `browserControl.enabled` is a live, default-off tool/relay/UI gate. Publish
  `getBrowserControlRuntime` and the composition-owned `getBrowserToolState`
  through the shared executor runtime. Route registration precedes WebSocket
  creation: resolve the broker lazily and bind its guard after infrastructure
  initialization. Construct `BrowserToolStateStore` with `dataDir`; it owns
  workspace/process screenshot storage under `getRepoDataPath(..., 'browser-screenshots')`.
  Process removal marks owner-qualified state deleted to prevent late writes and
  removes screenshots best effort with logged failures. Keep screenshots machine-local:
  wipe through the snapshot registry and exclude from export/import.
  Never load browser config per turn.
  `browserControl.framesEnabled` is independently default-off and live. Carry
  its owning-server policy outside model arguments through the scoped relay;
  older/missing desktop frame capability fails explicitly. Frame boundaries and
  committed origins label bounded snapshots/reads; delta baselines include
  document/frame identity. Frame refs and contexts remain transient, never
  process metadata, profile settings or new storage.
  `/browser` persists prompt-only `metadata.browserMode`; tool execution does
  not require activation. Ask, Autopilot and follow-ups share registration,
  preferences and turn cancellation; create the turn AbortController before
  assembling tool bundles, and pass its signal into the browser factory.
  The desktop pill clears state through
  the existing owner-scoped metadata mutation API.
- Kusto uses only native Microsoft auth pinned to
  Azure CLI/auto refresh. Empty `kusto.azureCli` identity settings select the native
  active-account mode; complete settings pin account/tenant/subscription, and partial settings fail.
  Native active selection stays pinned for the provider lifetime; changes fail without replay.
  Server-owned clients are shared by Run/tools through
  `getKustoRuntime`; reconfiguration/shutdown disposes providers and closes clients.
  Let the Kusto SDK resolve the audience and native auth own token validation,
  caching and renewal. Surface native `AuthError` unchanged; never fall back or replay queries.
- ADO uses the shared Forge native Microsoft provider with explicit Azure CLI
  source and automatic renewal. Host data directories scope provider lifetimes;
  shutdown disposes the host provider. Account selection stays pinned until disposal.
  PRs and Azure Boards use this resolver without CLI fallback or bearer-token disk
  caching. Resolve ADO identity from the current token and organization, not Microsoft account IDs.
- Use `src/server/cache/`, not new TTL Maps. Cache dashboard static config
  and invalidate on mutation; avoid per-conversation workspace/config refetches.
  LLM-tool settings and chat retrieval checks share
  `configCacheKey.llmToolsConfig(workspaceId, baseUrl)` for reads, warm seeds and
  invalidation; identical workspace IDs on different servers stay isolated.
  SPA Git-info and queue readers share concurrent requests through
  `api/workspaceReads.ts`, keyed by routed client and workspace. Queue task
  hydration is distinct from stats-only placeholders; loaded empty queues are valid
  only for their recorded server/API source.
  SPA repo preferences use `api/repoPreferences.ts` for shared reads and writes,
  with a 30-second server/API-prefix/workspace cache. Successful preference and
  skill/tool mutations invalidate it; superseded reads cannot repopulate the cache.
- Sentinel to-do ledgers (`src/server/sentinel-todos/`) are bookkeeping only: REST and AI
  tools share `SentinelTodoService`, which proves the parent Sentinel owner before every
  read/write and emits only after the SQLite transaction commits. The store borrows
  the process store's native `processes.db` handle; ledger, item and job rows are scoped
  by workspace and parent chat. Mutations acquire the database writer before reading
  and compare revisions; stale item writers receive `409` with the current item.
  Recent REST/tool/panel lists include every unarchived non-Done item first, then
  recently updated Done items within a 50-item budget; active counts above 50 stay
  complete. Archived history follows Done. `nextOffset` pages the remaining history;
  item-ID lookup is exact. Saved fulfillment determines selection, not job execution.
  `SentinelTodoService.list` and store reads
  remain full-ledger; the 500-item storage capacity is independent of presentation.
  `list` projects every item from one ledger snapshot and one admission read; owner
  checks use the store's transcript-free `getProcessOwnerProjection` when available.
  REST `full=true` supplies complete authoring/projection snapshots.
  The internal `setDependencies` graph command replaces ordered, typed prerequisites
  in the same writer transaction as item/ledger revisions. Edges resolve only in the
  owning parent ledger, regardless of execution workspace; self/duplicate/foreign/
  archived references and cycles are invalid. Dependency edits preserve fulfillment
  and user-verdict bookkeeping. `features.sentinelTodoDependencies` defaults off and
  requires the ledger. Owner-validated `setDependencies`, PUT `.../dependencies`,
  the client resource and Sentinel `set_dependencies` share the graph command.
  `bindPrOutput` and `acceptArtifact` store revision-checked, actor-attributed
  receipts on the prerequisite, exposed as `evidence[]`. PR bindings require
  explicit output selection/provenance (tracked delegations must contain the
  selected canonical output link); only the canonical provider reader proves
  merge. Artifact acceptance pins phase/reference/SHA-256 bytes in the prerequisite's
  local target workspace (parent workspace when unset). Repo-relative references
  stay repo-relative; exact absolute references can also name that workspace's managed
  notes/tasks/outputs. Receipts pin the content workspace, and evidence links route
  to it on the ledger's owning server. Remote content and foreign roots fail explicitly;
  containment, realpaths and current content are checked.
  `evaluateDependencies` captures revisions before provider I/O and revalidates
  under the shared writer transaction, returning conjunctive readiness and
  blockers. Native evidence/evaluation tables are machine-local and wiped;
  diagnostic evaluations are not admission receipts. Re-evaluate before use.
  `SentinelDependencyActions` reserves immutable evidence and one wake per graph
  generation before `ProcessMessageDeliveryService.deliverOnce` transports it.
  Polling and transport recovery use the trigger scheduler; matching owner/item/PR
  merge rules can own transport without rule mutation. Wakes ask the owner Sentinel
  to decide under ordinary user authorization; readiness never launches work.
  Normally authorized dispatch rechecks all prerequisites under the native writer
  and reserves a durable launch receipt. Target validation materializes the concrete
  registered workspace's queue through the router without falling back to the parent.
  Manual items remain tracking-only. Preparation and SDK handoff repeat readiness
  checks; handoff durably marks the start. Native admission and Ralph step identities
  prevent duplicate execution across restart. Queue failures and uncertain acceptance
  never re-arm work. Ordinary task permissions and Ralph Start approval stay intact.
  Each graph replacement records an exact generation, including identical selectors
  and empty edge sets. Source/upstream revisions and known ancestor input proofs
  invalidate pending readiness/admissions atomically; invalidated pending wakes stop
  transport. Started admissions expose `dependencyReadiness.requiresReview` and
  errors without cancellation or fulfillment/user-verdict writes. Removing edges
  cannot erase duplicate guards. Started whole-session Ralph continuations retain
  their native session/step identities through the late-bound admission guard.
  Dependency authoring and artifact acceptance grant no execution permissions.
  Item `type` is immutable (`normal` or `manual`); creation defaults to normal.
  Type patches are invalid; items have no hard delete. Manual items permit AI maintenance,
  including evidence-based Done with a reason; Notes and Done when are optional.
  Archive/restore are user-only, enforced for manual items in the shared store.
  Manual items never authorize execution, delegation, job links, or automatic result
  reviews. Execution requests require clarification; never create a normal-item copy,
  convert, or hand off a manual item. Never let ledger edits
  start, retry, or cancel jobs. Every Sentinel chat has a persistent ledger.
  Sentinel Mode and To-do Scrubber are independently default-off. The
  `sentinel_todos` tool is bound to the invoking Sentinel chat via the late-bound
  `getSentinelTodos` runtime capability.
  Default-off `features.sentinelTodoTags` exposes parent-ledger tag definitions
  and metadata through the same service, REST client and tool. Target workspaces
  share their parent's library, never another parent's tags. Matching uses the
  existing decision backend, selects only existing definitions and surfaces failed
  or unavailable classification without losing edits. Manual assignments and clears
  survive content updates; tag writes never grant authority or change readiness.
  Sentinel `send_to_conversation` create mode requires an unarchived normal
  `todoItemId` before any local/remote/Ralph launch and links the admitted job afterwards (link failures are
  reported, never repaired by relaunching). Linked items move to In progress; local
  terminal results reach normal items through `createSentinelTodoDelegationHooks` (first result
  per link wins; failed/cancelled/capped → Needs attention unless a later user edit or a
  newer completed attempt supersedes it). Completion never marks Done: only an explicit
  Sentinel/user verdict does. Guidance tracks the intended final outcome on one item across
  grilling/implementation/review, with milestones/spec links in notes. Successful grilling
  returns feature work to Todo awaiting implementation approval; only explicitly
  design-only/interview-only overall requests finish at an artifact. Ask mode and
  phase-specific design handoffs never redefine coding completion conditions. Parent reviews
  are shallow by default (job/repo, outcome, commit/artifact; no code-detail review or review
  delegation unless the user asks), select overall-outcome status, re-read revisions, honor manual user verdicts, and require
  user authorization before implementation/retry. Local assessment is durable per terminal result:
  `reviewedJobs` names exact process/event evidence with a status verdict and reason in one
  revision-checked write. Unrelated edits and delivery completion never acknowledge results.
  Explicit user status/reason/outcome/archive decisions supersede already-linked work
  without claiming its evidence was assessed; acknowledgment requires exact `reviewedJobs`.
  Review updates cannot overwrite those verdicts or reopen archived/Done items.
  Conversation references (`attachReference`, REST `.../items/:itemId/references`, tool
  `attach_reference`) live in `sentinel_todo_references`, apart from job links: normal items
  only, and the target must exist in exactly the named local workspace — a saved chat, a live
  queued/running chat task (`queue_` ID, task `repoId` and payload workspace must match), or a
  Ralph session journal. Ralph iterations store the verified `sessionId` and open
  `#repos/<ws>/chats/ralph/<sessionId>`; any iteration of a referenced session is a duplicate.
  Duplicates are no-ops, and references never change status, create execution/review state,
  or message, start or retry the referenced chat.
  The `references` contract combines conversation entries (missing kind means conversation)
  with typed `pr`/`email`/`link` external entries. Default-off live
  `features.sentinelTodoExternalReferences` gates external reads and create/update
  `externalReferences`: omission preserves, an array replaces external entries only, and `[]`
  clears them without removing conversations. The additive item JSON column defaults to `[]`.
  Safe URLs are validated and deduplicated; external metadata never binds PR outputs,
  creates watches, fulfills prerequisites, changes status or grants authority.
  Job execution/delivery/assessment are derived on read with exact parent/child workspace,
  process and session identity; remote links are always `unavailable`. Job mode is a compact
  read-time projection: batch-read local process metadata from the shared database, validate
  the execution workspace, and use live first-turn queue mode only while the process is absent.
  Unknown/remote ordinary modes stay omitted; Ralph kind/session identity stays Ralph.
  Committed delivery and conversation-mode changes invalidate linked ledgers without advancing
  their revisions; badges never require per-job transcript reads or polling.
  The SPA's To-do tab lives in the unified right panel (see its `AGENTS.md`): a hosted
  Sentinel `ChatDetail` publishes its ledger owner; stored tabs remain visible.
  Scrubber REST commands live in `src/server/sentinel-scrubber/scrubber-routes.ts`;
  prove the Sentinel owner through `SentinelTodoService.assertOwner` before accessing
  scrubber state (never a full ledger list), and use the engine for revision-checked Accept/Undo. The shared
  `client.sentinelTodos.scrubber` resource uses the owning client transport for config,
  runs and finding actions; reads support abort signals and conflicts retain the current
  item in `CocApiError.body.current`. Route composition
  shares the native ledger database, publishes the live flag-gated `getSentinelScrubber`
  executor capability, and returns `scrubberReady`; server startup awaits recovery before
  activating restored queues. Scrubber ask turns are unattended; enabled shell guards
  auto-deny without offering user approval. Scrubber events carry workspace/process ownership and use
  workspace WebSocket filtering; ledger invalidations may omit `itemId` for a whole run.
  Runs persist a caller-supplied child task id before queue admission, so early
  execution/terminal events stay bound. Admission rechecks cancellation after snapshot
  writes and cancels a child admitted after its run terminates.
  Every non-skipped run queues one child, including an empty eligible snapshot.
  Findings must cover the whole snapshot before the submission is accepted.
  Bounded runs prioritize prior deferred items before oldest-first ordering;
  oversized ledgers remain eligible for scheduled assessment with unchanged inputs.
  `ScrubberScheduler` uses owner-keyed shared schedule timers and future cron ticks,
  rechecking owner/config/flags before admission. Config and run events refresh timers;
  failure pause and live flag changes disarm them. Shutdown disposes schedule timers,
  config subscriptions, queue subscriptions and timeout timers through the route
  composition's WhatsApp manager disposal hook. See the Cron knowledge reference.
  To-do composer context reuses pointer attachments and resolves the owning ledger
  on drop and explicit send (`spa/client/react/features/chat/sentinelTodoContext.ts`).
  Bind workspace, parent Sentinel and concrete server identity; remote selections
  never fall back locally. Serialize only user-facing tracking fields, not job links
  or internal audit metadata. Attaching is read-only and grants no execution authority;
  manual items remain tracking-only. See the composer knowledge reference for lifecycle rules.
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
  grilling requires separate session registration. Native delegated grilling uses create-only
  `entryPoint: "grill"` and the composer/server shared contract, gated by existing `ralph.enabled`.
  Initialize journal phase explicitly; readiness requires server-validated canonical ## Goal plus
  revision. `grilling.json` owns process, synthesis and Start admission. Separate milestone and
  terminal receipts; no completion/ledger state grants implementation authority. Same-owner Start
  reuses the session; cross-owner approval records the actual execution pointer and deduplicates
  target admission. Remote capability failures never fall back locally or forward source paths.
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

- Default-off `features.sentinelNextSteps` gates optional 1–3 Sentinel actions and
  click-to-send. Resolve the UI gate from the conversation owner. Keep clicks on
  the normal guarded follow-up path; suggestion display grants no authority and
  clicks request only the named scope. Ordinary modes retain their suggestion behavior.

- Pause and delay menus use body portals and `useAnchoredPanelPosition` with
  constrained height, viewport-bounded width, and contained vertical scrolling.
  Outside-click checks include the portal; Escape returns focus to the owning trigger.
  Collapsed-rail job previews use the same positioning with side placement and
  a pointer bridge. Counts and rows share `useRepoQueueJobs` and the selected
  workspace's source-checked queue, including groups; hidden follow-ups and
  history are excluded. Preserve icon click expansion and concrete clone routes.

- `AskUserInline` reply fields share batch submission with the button: Enter submits,
  Shift+Enter preserves multiline Need context notes, and IME/229 never submits.
  Keep optional deferred notes, required-answer validation, clone routing, synchronous
  in-flight/accepted duplicate guards, and retryable drafts intact.

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
- Tool-call response sizes use the shared render model and already-loaded owner data.
  Count available raw strings as UTF-8 bytes before display clipping, including empty
  responses; use B/KiB/MiB/GiB. Never infer tokens or omitted payload sizes or fetch
  additional responses for this display.
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
  Carry a stable request ID on drained turns and queued payloads. Lifecycle receipt
  reconciliation passes `userTurnPersisted` to prevent a second automated user turn.
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
  `features.repoGroupExclusiveWriter` defaults off. Owning-server group saves serialize
  admission and persistence. Omitted new defaults close read-only protection across
  overlapping roots; saved/explicit writers are never reassigned. New mixed overlapping
  policies return 409 `REPO_GROUP_ACCESS_POLICY_CONFLICT`; competing writers return 409
  with group links. Preserve saved conflicts and allow revocation, including retained
  stale members. Unresolved memberships cannot silently admit a new writer.
  `/api/repo-groups/access` shares admission identity and returns the owner's live flag,
  sharing state and every saved writer. Dialog/settings links qualify remote group IDs
  with the owning server ID. Dialog automatic choices remain omitted at save time;
  saved/user choices stay explicit. Saves are authoritative and rejected drafts stay intact.
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
  Inline `CanvasEmbed` disclosures keep hidden bodies and Kusto connection portals
  mounted/inert to preserve drafts. Sentinel mode defaults every inline kind to
  collapsed; ordinary defaults and dedicated panels retain their behavior. Pass the
  resolved conversation mode through pinned/normal bubbles and `ChatRenderContext`.
  Manual choices survive HTML portal remounts per owner-qualified occurrence;
  workspace/chat/canvas changes isolate state. Panel opening stays owner-routed.
- Kusto and markdown tables share `InteractiveTable`. Wide unwrapped results own
  horizontal scrolling; column hiding, resizing and wrapping are display-only.
  Cover actual column widths and overflow with the Kusto browser regression suite.
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
  the source-owned starting mode directive (`chat-mode-directive.ts`), which keeps coding
  tasks pending through planning/POCs until implementation meets the completion condition.
  The design-only completion boundary and shallow result-check rule are shared with ledger/tool guidance from
  `delegation/sentinel-job-review-instructions.ts`. Required review rules live in
  `delegation/sentinel-job-review-instructions.ts` and are appended by
  `chat-turn-system-message.ts` on every first/follow-up Sentinel request, including
  resumed, provider-switched and post-compaction sessions, independently of admin/repo
  prompts. Sentinel completion messages contain only the untrusted-result prefix and
  result JSON; non-Sentinel parents receive the shared rules inline.
  `features.sentinelResultCards` is a default-on, live presentation gate; explicit false
  opts out. Cards require server delivery correlation, the exact result envelope and
  matching parent identity;
  invalid messages keep ordinary rendering. Inert summary Markdown and exact raw JSON
  never change model payloads, assessment or authorization. Job links inherit the source owner.
  `send_to_conversation` create mode from a
  sentinel defaults to `autopilot`. Handoffs prefer relevant same-task, same-owner chats when
  tracking and reuse are supported; follow-ups retain their provider. New-chat delegation
  prefers explicit `provider: "auto"` unless the user
  requests a particular provider/model. Enabled Auto uses target routing without parent AI
  inheritance. Disabled/unavailable Auto uses the parent's concrete provider after target
  validation; local model/effort inherit normally, remote defaults stay destination-owned.
  Explicit override, quota/runtime, and dispatch failures never trigger substitution.
  Omitted provider keeps ordinary inheritance. No workspace ownership or scan cron; any number may coexist.
  Startup cancels retired Sentinel scan crons (`src/server/cron/legacy-sentinel-crons.ts`).
- Create PRs via `src/server/git/create-pull-request-service.ts`, with typed Forge
  `pullRequestGit` operations and a `gh`/`az`-only CLI runner. Forge owns host Rust
  and WSL dispatch, including repository discovery (`discoverGitRepoRoot`), raw
  blob reads and linked-worktree path translation. PR default resolution uses
  symbolic origin HEAD, a 15s noninteractive remote probe, then `main`; fetch/push
  use 600s with `GIT_TERMINAL_PROMPT=0`.
  The `submit-commits-as-pr` skill uses only `create_pull_request` with nonempty exact
  commits and explicit auto-merge (on unless disabled); general tool defaults stay unchanged.
  Successful structured `create_pull_request` results use forge’s shared detector for
  composer display and completion binding; preserve origin/workspace scoping.
  Commit-mode conflicts abort; the active checkout/HEAD never moves. Worktree execution
  uses owning-server committed objects, fails before queueing, performs no implicit
  network/branch switch, and removes without force/branch deletion.
  Git-tab Fetch/Pull uses the exact current-branch upstream; patch metadata is untrusted.
  Commit, branch-range, working-tree and combined/per-file PR patch routes share
  `withPatchRequest`; `createLocalPatchRoute` adapts local routes. Request abort or
  unfinished response close cancels only that read; normal GET-body close does not.
  Pass per-file display limits into Rust; use `git/git-response.ts` for patch response
  metadata and status-letter conversion. PR scope opening and supplied-read lifetimes
  use Forge `diff/remote-patch.ts`; routes own disposal, providers retain their scope.
  Retire listeners on every outcome and guard response delivery after awaits.
  Working-tree native-load errors return HTTP 500 with rebuild instructions.
  `repos/pr-patch.ts` supplies explicit workspace/root, provider host/repository and
  PR identity; transport and scope use the same provider config, including ADO's
  effective organization. Capture continuations before I/O and cancel on abandonment.
  Rootless selections use stateless Rust with pre/post-await signal checks.
  PR full-context patches use Forge `loadComparisonPatch`; TypeScript owns missing-commit
  fetch/retry and provider-hunk fallback through the selected clone. Authenticated I/O
  and shared commit fetches finish independently; abandoned reads cannot publish detail
  caches or start fallback/retry work. List refreshes map current provider bytes'
  Rust summaries to diffStats; only the list response cache retains enriched rows.
  PR snapshot fallback metadata uses Forge `parseFullDiffAsync` for decoded paths
  and file existence; full-text loading and its cache remain separate.

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
  relay raw exceptions or partial output, or borrow another request's error.
  WhatsApp inbound failure logs carry command type, failing stage and
  `messaging/safe-error-diagnostics.ts` fields only, never raw errors. Receipt files use
  `atomicWriteJsonUnique`; transport, reply wording and formatting stay per connector.
- `features.sentinelDesktopMirror` is live/default-off under Admin → Configure →
  Sentinel. Stage newly submitted dashboard messages before canonical admission;
  confirm buffered writes immediately and persist exact workspace/process/request
  correlation. Hydrate authoritative bindings first; pin their account/destination.
  Connector inputs, reviews, retries and stored history never create mirror intents.
  Persist immutable chunks, confirmed IDs and attempted prefixes; serialize current
  registered destination heads. Retry definite failures with durable backoff/Retry-After;
  quarantine unknown sends and publish fixed, deduplicated chat notices.
  Recheck ownership/cancellation before each part; preserve old tombstones during
  explicit resume. Echo guards verify self/account/scope and exact attempted content.
  Desktop delegation pins stay in private ledgers, not child/process provenance;
  results use the existing notice worker after original user/assistant confirmation.
  WhatsApp mirrors request-upload bytes only: PNG/JPEG/GIF/WebP images use native
  images; other valid MIME files, including audio/video, use documents. Limit batches
  to 10 attachments and 10 MiB decoded total. Snapshot bytes/integrity metadata in
  the owning outbox before admission, independent of executor temporary files.
  Send text first, then ordered filename captions through the same per-part receipts;
  discard acknowledged bytes and all remaining bytes on delivery/cancellation.
  Reject malformed/unsupported/oversize uploads before forwarding any part.
  Never read SDK paths, paste references, generated artifacts or another server's files.
  Teams and reference-only inputs retain path-free unsupported markers.
  The ledger lives in `processes.db` (requests/deliveries/receipts; answer state is
  separate from delivery state); legacy JSON ledgers import once and are never read
  again. Staged assistant recovery requires an accepted user with the same captured
  owner; uncertain progress quarantines and confirmed receipts remain intact.
  Scheduling reads payload-free headers and uses bounded, indexed per-workspace
  destination seeks. One timer covers actionable head retries; offline and blocked
  work waits for a relevant wake. At most four destinations run concurrently.
  Disabled workers do no reads or sends; captured-origin authority rechecks lifecycle
  after awaits, and notice transports check a synchronous gate before dispatch.
  The mirror only gets narrow relay projections, never
  full `getProcess`/`getConversationTurns`. Ledger rows are machine-local, excluded
  from export/import and cleared by wipe.
  See [server architecture](../../.github/skills/coc-knowledge/references/server-architecture.md#desktop-sentinel-mirror).
- `src/server/messaging/incoming-images.ts` prepares admitted image batches only
  after local workspace resolution. It reuses chat attachment processing, stores
  temporary files via `getRepoDataPath(..., 'attachments')`, and rejects an entire
  batch on failure. Limits are five images, 10 MB decoded total and 30 seconds total.
  Callers own rejected/unadmitted temporary-directory cleanup; accepted turns follow
  the chat image lifetime policy above. Teams/WhatsApp
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
  answers selection, help, quota, `git status` and `compact [instructions]` for both routers via a
  `MessagingSelection` adapter. Quota replies share `formatQuotaReply` across WhatsApp
  and Teams channel/thread commands, report every finite snapshot with `5h`/`7d` window
  labels and `% left`, and preserve unknown values and limit-id prefixes.
  `git status` uses `messaging/git-status.ts` to read every accessible registered local
  repo, expanding groups within the supplied registry and deduplicating roots; one row per
  repo (`name - clean`, else only nonzero change/conflict counts), plus `<N> ahead` when tracking
  metadata is reliable (no branch names, upstream labels or behind counts).
  Remote and other virtual workspaces are excluded. Preserve sender/thread admission;
  this command bypasses pending question answers and never changes selection or invokes AI.
  `list todos` (alias `todo[s]`, `messaging/messaging-todos.ts`; WhatsApp and CoC Teams) lists the
  non-archived items of the quoted binding's chat (Teams: the bound thread's chat), else the
  sender's selected topic in the selected repo, via `SentinelTodoService.list` (non-Sentinel → explicit reply; missing server infrastructure → unavailable reply;
  non-local workspace → unsupported reply). Status labels come from the client's
  dependency-free `sentinelTodoStatusModel.ts`; all active items are grouped by
  Normal/Manual tracking, followed by at most the 5 most recent Done (shared
  `sentinelTodoRecentPage` ordering). Only omitted Done history is counted; Teams escapes
  chat-supplied Markdown. Replies chunk via `chunkWhatsAppText` (Teams: 3000 chars). Read-only: no ledger
  write, enqueue, selection change or result acknowledgement.
  Git reads reuse native parsers and forge's WSL runner with optional locks disabled,
  without safe-directory writes or fetch. Replies report changes/conflicts, detached/unborn
  HEAD, missing upstream and per-repo failures; local tracking refs may be stale.
  Reuse lossless connector text chunking; never silently drop repositories.
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
  uses `local-topics.ts`: five chats created within 24 hours across registered local
  workspaces, ranked pinned, running, queued, then activity. Transcript-free saved
  pages merge owner-verified first-turn queue tasks; follow-ups and internal jobs
  never create extra topics. Numbering retains the last displayed owner/process
  refs; queue IDs survive startup. Queued selections use durable connector receipts
  and queue dependencies for follow-ups, including Teams threads. Remote lists read
  saved processes only. Every topic list (local, remote, Teams thread) renders through
  `formatTopicList` (status emoji, ≤40-char escaped title, relative age; ids only with
  `-v`; no Markdown list syntax so Teams keeps the numbering). `localTopicsReply`
  and `resolveLocalTopic` share owner-qualified selection refs; cancelled or missing
  queued targets reject selection and delivery.
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
  compaction retain direct notices. Automatic Sentinel compaction posts WhatsApp start
  (on execution) and outcome notices only to the triggering request's own receipt or
  enabled desktop-mirror capture (`auto-compaction-origins.ts`), after its answer is relayed.
  Outcomes report counts only, never summaries or errors. Receipt states persist per workspace; interrupted sends
  are quarantined. WhatsApp binds replies to the notice's chat; Teams uses the captured
  parent thread for results or binds a top-level child notice. Selection remains unchanged.
- Teams MCP production authentication uses the connector's host/resource-scoped
  `TeamsOAuthCredential`. Native browser sign-in verifies identity and MCP access;
  Rust owns OS refresh storage and demand renewal. TypeScript stores only verified
  account/configuration metadata. Sign-in, bridge, status and discovery share one
  owner, without Copilot-cache import or fallback. Native pending lifecycle is
  available independently of the default-off `mcpOauth.enabled` flag. Server
  startup passes its shared pending manager to chat executors only when generic
  OAuth is enabled; both initial and follow-up turns omit the generic callback
  otherwise. Managed Teams tokens remain available on either path. Cancellation
  reaches native work and host shutdown disposes all resource owners.
- Generic MCP OAuth completion accepts the exact server's live runtime connection,
  including broker sign-in with no browser URL or token JSON file. Pending flows
  poll bounded runtime status and shared-cache state; late results cannot overwrite
  a cancelled flow. Empty login responses alone never count as authenticated.
  Opt-in background maintenance keeps scheduling, scope policy and Copilot-cache
  persistence in Node; `coc-native.exchangeMicrosoftRefreshToken` owns the bounded
  Rust exchange. Native Teams resources are excluded. Only typed terminal
  rejections below HTTP 500 invalidate entries; diagnostics exclude provider bodies.
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
  bridge connectivity, Trouter, Likes and observability. The Connectors → Teams toggle is
  live, without restart/reconnect; disabling stops relay and thread reply polling.
  The registry suppresses its experimental badge for the enabled default.
  Selection changes never redirect answers. Persist accepted multipart progress;
  never replay confirmed sends; reconcile unknown outcomes.
  Preserve thread cursors/own IDs on reconnect; WhatsApp shares the receipt rule.
- MCP APIs and connection history expose only allowlisted safe fields, never tokens,
  `env`, headers, full arguments, or provider error bodies. Credentials stay on their host.

## Monaco Selection Context

- Live admin `features.diffFilePicker` (default on, read via
  `useDiffFilePickerEnabled`) gates diff header pickers; they use only the current
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

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
- `list_workspaces`, `send_to_conversation` remote targets and messaging `list remotes` share one route-layer
  `src/server/servers/workspace-directory.ts` (clone keys, per-server timeouts, last-known
  offline entries). Remote create mode posts to the remote's own queue/Ralph API with no
  local fallback; output never carries paths, URLs, or credentials.
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
- Use `QueueRuntimeConfig`, not `loadConfigFile()`/startup captures.
  CLI/tests inject fixed ports. Add admin settings once in
  `src/config/admin-setting-definitions.ts` plus config types/defaults; generated
  consumers stay derived. Non-admin leaves use `src/config/namespace-registry.ts`.
- New experimental flags default off; gate server/tools and UI
  boundaries; preserve existing defaults and live/restart semantics.
- Use `src/server/cache/`, not new TTL Maps. Cache dashboard static config
  and invalidate on mutation; avoid per-conversation workspace/config refetches.
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
  Working-tree untracked previews pass the concrete owner into PreviewPane for
  selection context and file I/O; local owners use an explicit null route.
  Fallback seeds retain that destination, and drains preserve other owners’ items.
  Activity NewChatArea opts into buffered seeds with newChatSeedDestinationId;
  pop-out commit/PR review composers opt in with their diff panel's owner.
  Shared notes and inline review composers leave it unset. Pending seeds retain their owner
  through capability resolution and are discarded when that owner changes.
- Copilot decisions use a two-minute deadline per initial/repair attempt.
  Preserve caller cancellation and explicit backend timeout overrides.
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
  requests a particular provider/model; Auto uses target routing without parent AI inheritance.
  Omitted provider keeps ordinary inheritance. No workspace ownership or scan cron; any number may coexist.
  Startup cancels retired Sentinel scan crons (`src/server/cron/legacy-sentinel-crons.ts`).
- Create PRs via `src/server/git/create-pull-request-service.ts` and injected runners.
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
- Teams/WhatsApp command grammar is one spec table in
  `coc-connector/src/shared/commands.ts` (`parseMessagingCommand`,
  `formatMessagingHelp`, plain-text `MESSAGING_HELP_TEXT`). Help uses native WhatsApp
  bold or Teams Markdown converted to safe HTML by the manager; unknown `/word` or malformed list/select/create replies
  "Unknown command" + help, never the AI. `src/server/messaging/messaging-commands.ts`
  answers selection, help, quota and `compact [instructions]` for both routers via a
  `MessagingSelection` adapter. With no selected repo (or a removed one), plain messages
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
  dedupes bound-thread replies like thread commands. An empty prefix replies
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
- Chats handed off by `send_to_conversation` create mode from a WhatsApp/Teams turn
  (origin via the ask_user relay's `locateOrigin`; local targets only, not Ralph) get
  `metadata.messagingOrigin` and a direct notice `<repo> · <title> · ✅/❌/⏹` per
  finished turn through `src/server/messaging/job-notices.ts` (per-repo
  `messaging-job-notices.json`: pending → sending → done per task; interrupted sends are
  never resent). WhatsApp binds the notice (`notice: true`) so a quote-reply follows up
  the job; Teams posts it top-level and binds it as a thread root. Neither changes the
  selected repo/topic; follow-up mode is kept.
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

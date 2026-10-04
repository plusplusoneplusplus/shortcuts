# Server Architecture

CoC (`packages/coc/`) is a Node.js CLI and HTTP server for AI chats, queued work,
and YAML workflows. The server serves the dashboard and owns runtime orchestration.
`coc-workflow` owns the pure workflow compiler/executor; `forge` supplies shared
process and queue utilities; `coc-agent-sdk` owns provider sessions; `coc-native`
supplies native SQLite and indexes. See [monorepo.md](monorepo.md) for package boundaries.

## CLI and Source Layout

### Entry points

`packages/coc/src/index.ts` enters Commander in `src/cli.ts`; `src/commands/` implements
workflow execution/validation, dashboard serving, queues, skills and data management.
Use `coc --help` and `coc <command> --help` for command and option contracts.

`src/config.ts` resolves configuration; `src/config/schema.ts` validates it.
`src/ai-invoker.ts` connects workflow AI nodes to provider services.
`src/server/index.ts` contains `createExecutionServer`, the composition root.
`src/` paths are CoC-package-relative; other module paths are server-relative;
bare executor filenames below resolve under `packages/coc/src/server/executors/`.

## Server Module Layout

### Navigation

Feature directories own domain behavior; infrastructure composes them and routes expose them.
This table locates boundaries, not individual implementation classes.

| Module | Responsibility / detailed reference |
|--------|-------------------------------------|
| `core/`, `shared/` | HTTP helpers and shared server contracts |
| `infrastructure/`, `routes/` | Bootstrap wiring and route registration |
| `admin/`, `config/`, `preferences/` | Runtime settings and scoped preferences; [admin config](admin-config.md) |
| `logging/`, `dashboard/` | Diagnostics and active-workspace state |
| `workspaces/`, `repos/` | Workspace registry, groups, repository access and per-workspace Rust `RepoFiles` handles (listings, blobs, replace, file indexes, fresh content search); a handle is reused only for the live root; metadata Git reads use forge’s host/WSL adapter |
| `processes/`, `task-groups/` | Conversation lifecycle and grouping; [process store](process-store.md) |
| `queue/`, `executors/` | Multi-repo scheduling, dispatch and turn execution |
| `schedule/`, `cron/`, `triggers/` | Scheduled work and event-driven execution; [cron](cron.md) |
| `tasks/`, `templates/` | Task/plan files, comments and reusable templates; [task comments](task-comments.md) |
| `workflows/` | Workflow files and server adapters; [workflow engine](workflow-engine.md) |
| `notes/`, `sync/` | Scoped notes and synchronization; [notes](spa/notes.md), [sync](sync.md) |
| `skills/`, `prompts/`, `llm-tools/` | Instructions, prompt resources and tools; [LLM tools](llm-tools.md) |
| `providers/`, `agent-providers/` | Provider selection, quota/status and model catalogs; [SDK](sdk-wrapper.md) |
| `mcp-oauth/` | Interactive MCP authorization; [MCP settings](mcp-settings.md) |
| `git/`, `worktree/`, `work-items/` | Git operations and origin-scoped work; [Git/PRs](spa/git-and-prs.md), [work items](spa/work-items.md) |
| `memory/` | Memory integration; [memory system](memory-system.md) |
| `ralph/`, `for-each/`, `map-reduce/`, `dreams/` | Iterative, sequential, parallel and background orchestration; [Ralph](ralph.md), [admin gates](admin-config.md) |
| `decisions/` | Shared structured-decision service for routes and tools |
| `wiki/` | Wiki manager and request adapters; [wiki serving](wiki-serving.md) |
| `canvas/`, `kusto/` | Canvas persistence and query execution; [canvas](spa/canvas.md) |
| `streaming/` | Process SSE and dashboard WebSockets; [streaming](streaming-architecture.md) |
| `terminal/`, `language-servers/` | PTY and language-server lifecycles; [language servers](language-servers.md) |
| `servers/`, `container-link/`, `container-sessions/` | Remote server/container connections; [remote servers](remote-servers.md) |
| `native-copilot-sessions/` | Read-only provider transcript adapters and explicit import |
| `messaging/` | Teams/WhatsApp routing and durable answer relays |
| `storage/` | Startup migrations, snapshots, import/export and wipe |
| `spa/` | Bundled React dashboard; [SPA shell](spa/shell.md), [clone routing](spa/clone-routing.md) |

Endpoint shapes belong in [rest-api.md](rest-api.md);
transport contracts belong in [streaming-architecture.md](streaming-architecture.md).

## Server Startup

### Composition and readiness

`createExecutionServer` wires stores, runtime configuration, queues, services, routes and transports.
Startup migrations reconcile workspace registration,
process history and workspace IDs. Model metadata warm-up runs before listening;
a failed catalog warm-up is logged without blocking the listener.

`infrastructure/queue-infrastructure.ts` restores SQLite queue state with execution
stopped. Restoring a repo can create its executor before late-bound services exist.
After wiring completes and HTTP is listening, `activateQueueProcessing()` starts existing
executors and enables auto-start for later lazy repo executors, subject to auto-start policy.
A timing delay is not a readiness boundary.

### Multi-repo execution

`MultiRepoQueueRouter` routes work to per-repo queues and exposes an aggregate
dashboard view. Pauses, task delays and implement-plan chain gates remain repo-scoped;
one repo's gate does not block another repo. Gate and queue-control changes persist
through queue events. `queue/queue-executor-bridge.ts` wires references before starting its executor.

## Executors

### Dispatch and shared turn flow

`executors/executor-registry.ts` dispatches task types to chat, workflow, shell and
specialized executors. `process-lifecycle-runner.ts` owns lifecycle and pending-message draining.
Chat modes are Ask, Autopilot and Ralph; incoming `mode: 'plan'` normalizes to Ask.

First turns (`ChatBaseExecutor.execute`) and follow-ups (`FollowUpExecutor.executeFollowUp`) share:

1. `chat-turn-context-builder.ts`: per-turn tools, memory and interactive handles.
2. `chat-turn-system-message.ts`: canonical system-message assembly.
3. `chat-turn-policy-resolver.ts`: provider-aware model, effort and context policy.
4. `chat-turn-runner.ts`: common `sendMessage` options and callbacks.
5. `chat-turn-settlement.ts`: token roll-up and turn-end side effects.

`ChatBaseExecutor` supplies prompt decoration and begin/finalize scaffolding to both
paths. First turns add attachments; follow-ups add continuation/session policy.
`BaseExecutor` and `ProcessSessionRegistry` own live streaming, serialized turn writes,
partial-turn capture and cleanup. Durable conversation state belongs to the process
store, not this execution registry.

### Runtime capability wiring

`executors/executor-runtime-contracts.ts` is the single declaration home for
`ExecutorRuntimeCapabilities` and narrow consumer views (`ChatExecutorRuntime`,
`LifecycleRuntime`, `DreamRuntime`). Late-bound services use getters so executors
observe them after composition. Static configuration stays outside this object.

The composed object reaches `MultiRepoQueueRouter` through `defaultOptions.runtime`.
Each `CLITaskExecutor` bridge extends it once with bridge-owned `inFlightTurns` and
`getDreamRunExecutor`, then forwards that resulting object **by identity** through
`ExecutorRegistryOptions.runtime` and `ChatModeExecutorOptions.runtime`.
Capabilities are not re-declared on layer option types or forwarded field by field.

The contract is checked by `packages/coc/test/server/executors/executor-runtime-wiring.test.ts`.
Live queue settings use the separate typed `QueueRuntimeConfig` port from the
authoritative runtime config service; see [admin-config.md](admin-config.md).

### Provider and session boundary

Provider selection resolves explicit requests or defaults/Auto routing before model/effort policy.
Model precedence is explicit task/turn model, repo mode default, repo general default,
then provider/CLI default.
Follow-ups retain the active provider unless a provider switch is requested.

`continuation-mode.ts` permits native resume only for the same provider's binding.
Cross-provider or unbound continuations create a fresh session using a bounded
handoff from CoC's transcript. A provider's session ID never reaches another provider.
The SDK creates/resumes a fresh session object per turn and never caches session objects
or adds `sendFollowUp`; supported providers may keep only their client process warm.
See [sdk-wrapper.md](sdk-wrapper.md) for provider mechanics.

## Configuration

### Ownership and precedence

Server configuration defaults to `~/.coc/config.yaml`; precedence is CLI > file > defaults.
`src/config/schema.ts` and `src/config/admin-setting-definitions.ts` define validation and settings.
`RuntimeConfigService` owns the resolved live server view.
See [admin-config.md](admin-config.md) for runtime semantics and gates; use help for CLI-only options.

## Storage Layout

### Global persistence

The data directory defaults to `~/.coc/`. Native SQLite `processes.db` stores
processes, workspaces, queue and scheduling state.
`createProcessStore()` selects `SqliteProcessStore`; `store.backend: file` warns and is ignored.
File stores are injected test fixtures.
Native-addon failure is a startup failure, not a JavaScript SQLite fallback.

Schema definitions, migrations and version live in `packages/forge/src/sqlite-schema.ts`.
Queue tasks, controls and paths live in `queue_tasks`, `queue_repo_state` and `queue_repo_paths`.
`queues.json` is handled by storage snapshot import/export, not live queue persistence.
See [process-store.md](process-store.md) for tables and read/write contracts.

Global files include `config.yaml`, `preferences.json`, `skills/`, and bounded system memory.
Memory V2 owns separate global/workspace databases; see [memory-system.md](memory-system.md).

### Workspace and origin scopes

Per-workspace data lives under `repos/<workspaceId>/`: preferences, tasks/outputs, schedule YAML,
memory, orchestration records, paste context and terminals. Use `getRepoDataPath(dataDir, workspaceId, filename)`
(re-exported by `packages/coc/src/server/paths.ts`) for path construction.
Workspace identity selects the checkout and execution queue.

Shared upstream state lives under `repos/<originId>/`: work items, PR review state,
classifications and related caches. `repos/origin-scope.ts` resolves canonical
origin identity across same-origin clones. Origin-scoped operations still select a
concrete workspace for filesystem/Git/provider execution; storage identity and
execution identity remain distinct. Repo groups are virtual workspaces whose
registered members supply execution roots and access policy.

## Messaging

### Routing and durable delivery

`messaging/` owns independent Teams and WhatsApp managers over `coc-connector`.
Account/connection settings are server-global; accepted requests and answer receipts
are workspace-scoped. Explicit repo/topic bindings determine chat routing.
Relays deliver the captured conversation's final answer to its original destination despite selection changes.
Receipts preserve progress; uncertain sends require reconciliation rather than automatic replay.
Accepted Teams channel-thread follow-ups acknowledge durable admission directly
without a confirmation post; new chats retain confirmations. Upstream Like admission
and request-correlated final-answer delivery remain independent of acceptance posts.

`messaging/chat-target.ts` shares workspace/topic lookup (`resolveWorkspace`,
bounded `listRecentTopics`, `resolveTopic`) and terminal queue subscriptions
(`onTaskTerminal`) across Teams and WhatsApp. `messaging/relay-answer.ts` locates
each request's user turn by `relayRequestId`, selects the last settled assistant
turn before the next user turn, and formats safe failure notices. Session/usage-limit
errors project only a fixed notice and a recognized UTC/GMT reset time from the last
persisted assistant error; only the latest request can fall back to the failed
process's error. Other failures, cancellations and empty answers use fixed text;
partial output and raw exceptions stay out of relay messages.
Receipt files use `atomicWriteJsonUnique`; transport and delivery formatting
remain connector-specific.

Teams and WhatsApp parse inbound text with the shared `parseMessagingCommand`
grammar from `coc-connector` (slash optional, `help`, `quota`,
`compact [instructions]`, `[chatid]`, `/autopilot`, `/ask`; unknown `/word` → "Unknown
command" + the generated `MESSAGING_HELP_TEXT`, never sent to the AI).
`messaging/messaging-commands.ts` answers repo/topic selection, help, quota (from
`AgentProvidersQuotaCache`) and compact for both routers via a `MessagingSelection`
adapter; routers keep platform state and transport. `compact` targets the quoted
WhatsApp answer's chat / the bound Teams thread's chat, else the selected topic,
and calls `processes/compact-process.ts` `compactProcess` (shared with
`POST /api/processes/:id/compact`); it never enqueues a turn or changes selection. `/autopilot <msg>` and `/ask <msg>` set the
turn's mode; plain text has none, so a follow-up keeps the chat's mode and a new chat runs in
Ask. `messaging/messaging-chat-mode.ts` resolves it via `resolveFollowUpMode` (a still-queued
first turn lends its queued mode) at every Teams/WhatsApp enqueue site.
`list remotes` (servers numbered `n`, their repos `n.m`, offline servers bare) and
`list topics <n.m|name@server> [-v]` (10 most recent remote chats, read-only footer) are
answered by `messaging/remote-browse.ts` over the route-layer `WorkspaceDirectory`
(`list()` + `listRemoteChats()` → the remote's `GET /api/processes?workspace=&limit=`).
The `n.m` numbering lives in a per-chat in-memory `RemoteRefMemory` (WhatsApp group,
Teams thread or channel+user); remote repos never become the selected repo.
Local, remote and Teams-thread topic lists share `formatTopicList` in `remote-browse.ts`
(`▶` current marker, status emoji, truncated escaped title, `now`/`Nm`/`Nh`/`Nd` age from
`lastEventAt ?? startTime`, ids only with `-v`, one next-step footer). `listRecentTopics`
re-sorts its bounded page by that activity time, so `select topic <n>` picks the listed item.

### Messaging ask_user question relay

`messaging/ask-user-relay.ts` (`AskUserQuestionRelayHub`) is the executor's
`getAskUserQuestionRelay` capability. Each connector registers a
`QuestionTransport` (`createWhatsAppQuestionTransport`,
`TeamsAnswerRelay.questionTransport()`) that locates the request receipt by
`(processId, relayRequestId | taskId)` and posts one question at a time
(WhatsApp: quoted under the request; Teams: thread reply, relay flag required),
formatted by `formatWhatsAppQuestion` / `formatTeamsQuestion`. `tryAnswer` runs
before command routing: a reply to the question answers it; a plain message
answers only when exactly one question is pending in that chat.
`parseQuestionReply` handles numbers/option text, `1,3`, yes/no, text and
`skip`. First answer wins through the tool's pending map; a failed post resolves
`unavailable`; turn `cancelAll` clears pending questions. Pending state is in
memory; question IDs persist in WhatsApp receipt `questionIds` and Teams root
receipt `sentMessageIds`. Approvals stay dashboard-only.

### Teams connection routing and consent

The normal Teams bridge uses MCP for discovery/create, Graph beta for authoritative channel
roots and paginated replies, and IC3 for supported channel Likes. Beta is a preview API
subject to change; Graph sends/replies and standalone Graph clients retain stable v1.0. The manager always
sets `mode: mcp, channelReadBackend: graph`, including omitted saved settings.
`pollChannelReplies` uses the live, default-on `features.teamsAiAnswerRelay` gate.
Missing relay settings resolve on; explicit false stops reply polling and answer relay
without restart/reconnect. Connectivity, Likes and Trouter require their own enablement.
The connector's standalone defaults remain independent.

`teams-messaging.json` persists `outboundBackend: mcp | graph` (default `graph`, including missing saved settings);
Graph fixes channel send/reply routes to `GraphOperations`; explicit MCP remains supported. Its separate Azure CLI
credentials require Graph audience/expiry, delegated `ChannelMessage.Send` or an existing
`Group.ReadWrite.All` grant, and the MCP
reader's tenant/object identity. Invalid credentials fail connection before writes.

Backend changes disconnect and require reconnect. Receipts retain original thread IDs;
definitive typed rejections use bounded relay retries respecting Retry-After, unknown outcomes stay quarantined,
and writes never fall back to MCP.

Delegated outbound messages carry `CoC ·` assistant attribution inside the first
text block of safe Teams HTML; body attribution does not change the native sender
name/avatar. Code-first replies keep attribution outside the code.
`messaging/teams-outbound-format.ts` shares safe GFM table rendering with
`teams-answer-format.ts`: semantic headers, padded bordered cells and column alignment.
Multipart answers split tables at row boundaries and repeat headers; oversized rows
retain labeled text, and oversized headers retain source text. Byte budgets include
table markup and attribution. Receipts persist the attribution format;
partial receipts without it resume only when their complete chunk boundaries match.
Changed boundaries require manual reconciliation, even with equal part counts.
Own-message admission uses durable outbound IDs and request markers, not the label.

`/me` access does not prove channel-write authorization. The Graph
[channel-post](https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0)
and [reply](https://learn.microsoft.com/en-us/graph/api/chatmessage-post-replies?view=graph-rest-1.0)
APIs accept existing delegated `Group.ReadWrite.All` for compatibility.
New Entra public clients should request least-privilege `ChannelMessage.Send` consent,
not the broader grant.

Normal CoC acquires Azure CLI client tokens; the outbound selector changes writes only,
not the client or reader. Connector consumers can inject separately authorized
`graphReadOptions.acquireToken` and `graphOutboundOptions.acquireToken`; normal CoC has
no custom-client auth setting. Read credentials separately require delegated
`ChannelMessage.Read.All` (least privilege); existing `Group.Read.All`/`Group.ReadWrite.All`
grants are accepted, not requested. Read/write credentials validate Graph audience/expiry
and pin to the configured MCP tenant/object identity on acquisition and refresh.
`GraphCredentialStore` owns cancellable acquisition for both readers and writers.
Connection initialization and shutdown guard their lifetime before publishing state.
Missing consent, account mismatch and denied channel access surface sanitized actionable
errors. Azure CLI sign-in alone does not grant consent; failed reads never fall back to MCP.

### Messaging job completion notices

`messaging/job-notices.ts` (`MessagingJobNotices`) posts a direct notice (no AI turn)
`<repo> · <title> · ✅|❌|⏹` to the originating group/channel each time a chat handed off
by `send_to_conversation` from a connector turn ends a turn (first turn and every follow-up,
matched by `onTaskTerminal` on the job's processId). Failures add `findRequestFailureText`
(fixed text or a recognized usage-limit reset). The executor's per-turn
`sendToConversationRuntimeFor(processId, relayRequestId | taskId)` resolves the origin through
`AskUserQuestionRelayHub.locateOrigin`; the tool then calls `track`. The ledger is
`repos/<workspaceId>/messaging-job-notices.json` (`atomicWriteJsonUnique`): terminal turns are
`pending` before send, `sending` during it (a restart there marks it done, never resent),
then `done` per queue task id. `restore()` at route setup also queues first turns that ended
while the server was down; connector reconnects call `reconcile(platform)`. Transports:
`createWhatsAppNoticeTransport` sends unquoted plain text and binds the notice as a
`WhatsAppBinding` with `notice: true`, so a quote-reply follows up the job (mode kept by the
follow-up resolver) without `selectTopic`; `TeamsAnswerRelay.noticeTransport()` posts a
top-level `CoC ·`-attributed safe-HTML message and saves a `teams-thread-roots` selection for it, so thread
replies route to the job by root (a reply inside the dispatcher's thread would route to the
dispatcher) and user selection is untouched.

### Teams IC3 connection contract

IC3 credentials, account identity and explicit `ic3Region` (`amer`, `emea`, `apac`)
are connection-scoped snapshots; region/account changes require reconnect.
An unset region rejects IC3 writes before credentials/network while MCP remains usable.
Automatic region discovery is not implemented; writes never guess a region, fail over or retry.
Identity-pinned credentials fail closed on mismatch.

The normal manager selects `operationRoutes.chatSend: ic3` for ordinary direct sends.
Its enabled, connected bridge's `/api/messaging/teams/direct-message` send-only endpoint
accepts `chatId`, intended `recipientId` (object ID), current status `connectionId`,
`content` and `contentType: text | html`. It uses `TeamsBot.sendMessage` and existing
IC3 operation/receipt helpers, adding delegated CoC attribution. Channel sends/reads,
Likes and inbound routing retain their existing routes.

Ordinary 1:1 writes verify fresh MCP `GetChat` and complete `ListChatMembers` metadata:
exact unchanged chat ID, `oneOnOne`, and distinct current-account/intended-recipient IDs.
Missing tools/access or identity fail before dispatch, without Graph chat consent.
Connection-scoped references reject stale/cross-connection sends; verification shares
the ten-second write deadline and cancels on stop/reconnect. Connector IC3 self sends
are always supported via `operationRoutes.selfSend: ic3`, mapped to `48:notes`;
default connector self routing uses MCP. Chat creation,
groups/channels, replies/mentions, an inbound DM bot and a dashboard DM composer
are unsupported. No retry/fallback; unknown delivery requires reconciliation.

Connector contracts live in [coc-connector/AGENTS.md](../../../../packages/coc-connector/AGENTS.md);
server settings and gates belong in [admin-config.md](admin-config.md).

### Teams notification inbound

Normal CoC persists experimental `enableTrouter` in `teams-messaging.json`, defaults
it off, and passes it to `TeamsBot` on reconnect. The connector pins separately acquired
IC3 credentials to the MCP reader account, handles private Trouter registration/renewal,
heartbeat/ACKs and reconnect, and accepts only selected-conversation wake hints.
Real activity source threads override synthetic streams; notifications never authorize
dispatch. Workspace/thread bindings remain owned by the existing messaging router.
Known-thread wakes read authoritative Graph replies directly; root discovery/backfill runs
on unknown/missing hints and reconciliation. Eligible IC3 Likes start before routing
without blocking dispatch or subsequent reads; failures are sanitized and logged.

`notificationStatus` exposes protocol state and sanitized typed errors independently
of reader connectivity through the messaging status API and Connections card.
Standalone `TrouterClient` exports credential-injected `start/getStatus/stop` lifecycle
for protocol-only smoke tests without inbound handlers. Per-session generations ignore
stale socket/registrar callbacks; a client is permanently disposed by stop.

The bounded single-flight scheduler syncs at startup, coalesces wakes, follows wakes
during reads and falls back 60 seconds after successful completion. Loss, disconnect
and mailbox overflow reconcile known threads; failed reads retry after two seconds,
retaining hints and honoring HTTP429 cooldown. Enabled hybrid reply reads scope ordinary
known-root wakes to hinted histories. Unknown/missing roots and fallback reconcile
known threads within a cancellable bounded scan.

Hybrid Graph and MCP share the ID/thread scanner, chronological admission and durable
own/known-ID callbacks. Hybrid ordinary polls also complete reply pagination; heads commit
only after admission. Collection-scoped Graph cursors, read cancellation and a single
identity-pinned 401 refresh protect every page. Root-head backfill and standalone Graph
timestamp polling remain best-effort: retention, unbound older threads and restarts lack
durable delta guarantees.
DM notification readers require explicit conversation targets without autodiscovery;
synthetic `48:notes` streams do not activate them. Ordinary sends/replies/Likes retain
their existing routes and admission.

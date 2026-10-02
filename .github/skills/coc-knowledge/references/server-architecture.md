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
| `workspaces/`, `repos/` | Workspace registry, groups, repository access and native indexes |
| `processes/`, `task-groups/` | Conversation lifecycle and grouping; [process store](process-store.md) |
| `queue/`, `executors/` | Multi-repo scheduling, dispatch and turn execution |
| `schedule/`, `cron/`, `triggers/` | Scheduled work and event-driven execution; [cron](cron.md) |
| `tasks/`, `templates/` | Task/plan files, comments and reusable templates; [task comments](task-comments.md) |
| `workflows/` | Workflow files and server adapters; [workflow engine](workflow-engine.md) |
| `notes/`, `sync/`, `sentinel/` | Scoped notes, synchronization and monitoring; [notes](spa/notes.md), [sync](sync.md) |
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

`messaging/chat-target.ts` shares workspace/topic lookup (`resolveWorkspace`,
bounded `listRecentTopics`, `resolveTopic`) and terminal queue subscriptions
(`onTaskTerminal`) across Teams and WhatsApp. `messaging/relay-answer.ts` locates
each request's user turn by `relayRequestId`, selects the last settled assistant
turn before the next user turn, and supplies shared failed/cancelled/empty texts.
Receipt files use `atomicWriteJsonUnique`; transport and delivery formatting
remain connector-specific.

Teams and WhatsApp parse inbound text with the shared `parseMessagingCommand`
grammar from `coc-connector` (slash optional, `help`, `quota`, `[chatid]`,
`/autopilot`; unknown `/word` → "Unknown command" + the generated
`MESSAGING_HELP_TEXT`, never sent to the AI). `messaging/messaging-commands.ts`
answers repo/topic selection, help and quota (from `AgentProvidersQuotaCache`)
for both routers via a `MessagingSelection` adapter; routers keep platform state
and transport. Chats run in Ask mode unless the message starts with `/autopilot`.

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

### Teams IC3 connection contract

The Teams bridge uses MCP for polling/routing and IC3 for supported channel Likes.
IC3 credentials, account identity and explicit `ic3Region` (`amer`, `emea`, `apac`)
are connection-scoped snapshots; region/account changes require reconnect.
An unset region rejects IC3 writes before credentials/network while MCP remains usable.
Automatic region discovery is not implemented; writes never guess a region, fail over or retry.
Identity-pinned credentials fail closed on mismatch.

Connector contracts live in [coc-connector/AGENTS.md](../../../../packages/coc-connector/AGENTS.md);
server settings and gates belong in [admin-config.md](admin-config.md).

### Teams notification inbound

Normal CoC persists experimental `enableTrouter` in `teams-messaging.json`, defaults
it off, and passes it to `TeamsBot` on reconnect. The connector pins separately acquired
IC3 credentials to the MCP reader account, handles private Trouter registration/renewal,
heartbeat/ACKs and reconnect, and accepts only selected-conversation wake hints.
Real activity source threads override synthetic streams; notifications never authorize
dispatch. Workspace/thread bindings remain owned by the existing messaging router.

`notificationStatus` exposes protocol state and sanitized typed errors independently
of reader connectivity through the messaging status API and Connections card.
Standalone `TrouterClient` exports credential-injected `start/getStatus/stop` lifecycle
for protocol-only smoke tests without inbound handlers. Per-session generations ignore
stale socket/registrar callbacks; a client is permanently disposed by stop.

The bounded single-flight scheduler syncs at startup, coalesces wakes, follows wakes
during reads and falls back 60 seconds after successful completion. Loss, disconnect
and mailbox overflow reconcile known threads; failed reads retry after two seconds,
retaining hints and honoring HTTP429 cooldown. Enabled MCP reply reads scope ordinary
known-root wakes to hinted histories. Unknown/missing roots and fallback reconcile
known threads within a cancellable bounded scan.

MCP root-head pagination and Graph timestamp pagination are best-effort: retention,
timestamp ties, unbound older threads and process restarts lack durable delta guarantees.
DM notification readers require explicit conversation targets without autodiscovery;
synthetic `48:notes` streams do not activate them. Ordinary sends/replies/Likes retain
their existing routes and admission.

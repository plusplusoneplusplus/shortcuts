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
| `workspaces/`, `repos/` | Workspace registry, groups, repository access and per-workspace Rust `RepoFiles` handles (listings, blobs, replace, guarded deletion, file indexes, fresh content search); a handle is reused only for the live root; metadata Git reads use forge’s host/WSL adapter. Deletion requires a physical workspace and live default-on `features.explorerDelete`; [native contract](../../../../packages/coc-native/AGENTS.md) covers guards, index refresh after partial failure and best-effort race revalidation |
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
Filesystem consumers share `shared/native-watch-service.ts`; watcher infrastructure
binds workspace subscriptions and removes them together. Server scopes isolate
equal workspace IDs and shutdown while sharing one process-wide native owner.
Rust shares canonical-root watches, debounces paths and signals full rescans.
Workflow/template consumers share a recursive `.vscode` subscription and filter
its relative paths; missing/replaced configuration roots recover through native
health checks. Repository-wide recursive subscriptions would force Windows UNC
polling to scan unrelated source/build trees before startup can complete.
Consumer tests inject batches.
See the [native watch contract](../../../../packages/coc-native/AGENTS.md#filesystem-watch-batching).
Startup migrations reconcile workspace registration,
process history and workspace IDs. Model metadata warm-up runs before listening;
a failed catalog warm-up is logged without blocking the listener.
Startup installs configured `skills.defaultSkills` into the global skills directory;
`DEFAULT_BUNDLED_SKILLS` in `src/config.ts` includes `propose-diff` for read-only
patch proposals that require explicit user approval before application. Bundled
payloads and their registry live in `packages/forge/resources/bundled-skills/`
and `packages/forge/src/skills/bundled-skills-registry.ts`.

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
`skill-config-resolver.ts` supplies host-filesystem skill directories to the native
provider runtime and selected-skill file references. WSL repository roots use
host-readable UNC paths on Windows; global/configured skill paths retain their
host namespace, independently of the repository's execution context.

## Executors

### Dispatch and shared turn flow

`executors/executor-registry.ts` dispatches task types to chat, workflow, shell and
specialized executors. `process-lifecycle-runner.ts` owns lifecycle and pending-message draining.
Delegated review admission also invokes `MultiRepoQueueRouter.recoverPendingMessages` on the
recorded parent workspace. The owning bridge serializes recovery with follow-up admission,
reconciles terminal head receipts and admits one live head task. Completed/failed parents can
recover; active tasks, stopped parents and pending questions/answers keep buffers untouched.
Later messages drain through the normal lifecycle, preserving user-before-review ordering.
Chat modes are Ask, Autopilot and Ralph; incoming `mode: 'plan'` normalizes to Ask.

First turns (`ChatBaseExecutor.execute`) and follow-ups (`FollowUpExecutor.executeFollowUp`) share:

1. `chat-turn-context-builder.ts`: per-turn tools, memory and interactive handles.
2. `chat-turn-system-message.ts`: canonical system-message assembly, including mandatory
   Sentinel job-review rules from `delegation/sentinel-job-review-instructions.ts`.
3. `chat-turn-policy-resolver.ts`: provider-aware model, effort and context policy.
4. `chat-turn-runner.ts`: common `sendMessage` options and callbacks.
5. `chat-turn-settlement.ts`: token roll-up and turn-end side effects.

`ChatBaseExecutor` supplies prompt decoration and begin/finalize scaffolding to both
paths. First turns add attachments; follow-ups add continuation/session policy.
`BaseExecutor` and `ProcessSessionRegistry` own live streaming, serialized turn writes,
partial-turn capture and cleanup. Durable conversation state belongs to the process
store, not this execution registry.

Sentinel result envelopes contain a short untrusted-JSON prefix and unchanged result data.
The central review contract is appended after configurable admin/repo prompts on every
Sentinel request, including existing/native-resumed, provider-switched and post-compaction
turns; it never depends on stored initial prompts, summaries or child output. Non-Sentinel
review recipients receive the same contract inline. Cancellation remains display-only.

`delegation/delegated-job-store.ts` owns `delegated-jobs.json` in the parent workspace.
Optional `remote` registration metadata binds originating/destination server identities,
request ID and launch/follow-up/Ralph kind. Follow-ups require the matching child request;
Ralph requires a whole-session child. Reads and registration reject foreign origins and
duplicate remote workspace/request or session identities independently of connection aliases.
Historical rows retain their existing tracking semantics; transport admission owns proof
of remote identity.

### Remote delegation admission

`delegation/remote-delegation-request-store.ts` provides origin-side admission
reservations in `repos/<parentWorkspaceId>/remote-delegation-requests.json`.
It captures the parent, destination identity and connection hint, request kind,
exact follow-up target, request digest, connector origin and private random receipt
secret (`proofToken`) before a child exists. The origin exposes no endpoint for it.
Atomic publication requests file mode `0600`.
A durable dispatch claim permits one execution attempt; claimed or uncertain requests
require receipt reconciliation. Verified acceptance persists before idempotent
delegated-job registration. Machine-local receipts are excluded from snapshots and
cleared with delegated jobs.

`delegation/remote-delegation-auth.ts` defines the sender-only trust model. Only the
origin makes network requests; the destination never registers, connects to or calls it,
so it works with zero destination remotes and an unreachable origin. Three concerns stay
separate. Transport authorization is reaching the destination API (loopback, SSH or
DevTunnel account access), the same boundary as ordinary remote `POST /api/queue`.
Origin attribution: `originServerIdentity` is a caller-claimed label that scopes receipt
keys and terminal event IDs, never authority. Receipt ownership: the first durable
destination claim binds a SHA-256 digest of the origin's per-request secret; replays and
receipt reads must present it (constant-time compare). The secret travels only in POST
bodies; receipts omit it. Claims must name this destination and a different origin.
The origin authenticates the destination through its registered connection, health
identity brackets and the `senderPolling` capability.

`delegation/remote-delegation-routes.ts` composes destination admission. Destination
follow-up admission accepts a strict scalar message body through the gateway.
`ProcessMessageDeliveryService.deliverRemoteFollowUpOnce` queues with the destination
execution ID, preserves active provider/strict session resumption, and rechecks exact
owner/visibility during queue routing. Sentinel/Ralph targets are excluded. No desktop
mirror or caller-selected connector/correlation fields enter this path.

`delegation/remote-delegation-launch.ts` admits ordinary Ask/Autopilot chats and native
Ralph interviews/execution through the shared queue preparation and Ralph launch services.
Strict bodies accept content/goal, AI selection and title/priority, excluding caller paths,
parent/connector context and worktrees. Registered destination workspaces supply execution
roots; queue pauses, provider/tier/Auto policy and `ralph.enabled` remain authoritative.
The destination execution ID owns the task and deterministic whole-session Ralph identity.
Workspace roots are rechecked after asynchronous policy resolution before queue admission.

`delegation/remote-delegation-admission.ts` provides the destination gateway.
It captures the exact versioned JSON execution envelope, hashes all keys
canonically and checks kind/workspace/target/digest; mismatches and invalid claims are
refused before any claim (HTTP 400, provably not admitted). A key already bound to another
secret returns 403. The domain adapter receives that captured body and a destination-local
execution ID.
Intent capture caps bytes, depth and node count; domain authorization remains separate.

`delegation/remote-delegation-admission-store.ts` persists destination-owned receipts in
`repos/<destinationWorkspaceId>/remote-delegation-admissions.json` with requested mode
`0600`. Keys qualify origin server, parent workspace and request; destination execution
IDs remain independent of colliding origin IDs. Durable `dispatching` claims admit one
adapter call. Duplicate/uncertain/crash-window claims only reconcile. Rows without a
secret digest are never readable or rebindable; owner reads cannot tell missing, foreign
and digestless rows apart. Immutable accepted children enforce
exact follow-up targets and whole Ralph sessions. Owner receipt reads repair
uncertain/dispatching acceptance from exact queue/process evidence for launches and
queue/pending/user-turn evidence for follow-ups, without enqueueing. Conflicting owners,
task kinds or Ralph sessions fail closed; prepared Ralph journals alone cannot prove admission.
Wire receipts exclude standalone execution bookkeeping and private tokens. Snapshot/wipe
policy matches origin reservations.

`delegation/remote-delegation-results.ts` projects accepted destination claims into
`DelegatedJobResults`, without local jobs or origin reviews. Launch/follow-up relay IDs
identify exact turns; Ralph uses whole-session evidence, not grilling milestones.
First bounded outcomes persist in admissions. Startup captures before queue activation;
SQLite retains needed terminal tasks independently of capped history.

`delegation/remote-delegation-return.ts` admits new Sentinel requests under default-off
`features.sentinelRemoteResults` and a destination advertising `senderPolling: true`; older
callback-verifying destinations report `unsupported` before any reservation. Origin
reservations precede execution. A 400 reply to the single claimed POST settles `rejected`
(nothing started); other failures stay uncertain. Receipt polling persists backoff and
verifies both identities, request digest and bounded owner-qualified links. Recovery ignores the admission flag and
never resends work. Transfer state is independent of parent review delivery and To-do assessment.
Existing review/connector receipts return assessed replies; missing/archived owners fail
without revival. Trusted review context survives buffering; drain and execution recheck
the visible Sentinel owner. SQLite retains unacknowledged remote review tasks across restart.

### Delegated PR receipts

The ledger retains produced-PR receipts. `recordPullRequest` requires a registered job
and records exact canonical provider/host/repository/number identity with an item ID
and immutable receipt. Repeated submissions reuse that receipt; each distinct PR
remains separate. `triggers/sentinel-pr-outcome-service.ts` verifies the original
Sentinel/item/job relationship and registers native one-shot watches under default-off
`features.sentinelPrOutcomeWake`, independently of execution-result delivery and repair
permission. New submission results are authoritative; prose and historical URLs do
not establish ownership. Ralph submissions resolve the original tracked session
through `ralph/ralph-execution-owner.ts`, including accepted grilling execution
pointers and later iteration/submit processes; a first-task process ID is not
the identity of the entire delegated session.

### Sentinel To-do trigger firing

`triggers/sentinel-overture-service.ts` owns authoring for normal eligible items,
using exact owner checks, optimistic revisions and owner-scoped creation receipts.
PR rules need no setting; date rules require default-off live
`features.sentinelTodoDateTimeTriggers`. Rules share the active cap and never expire.
PR authoring preflights canonical provider URLs. Date authoring validates future
UTC `firesAt`, IANA `timeZone` and matching `localTime` through coc-client's
`dateTimeCandidates`; gaps reject and overlaps require an explicit instant.
Only the absolute instant and display zone persist in the existing JSON event.

Owner-qualified capabilities return `dateTime`, which also selects the Sentinel
tool's date event schema.

`triggers/sentinel-overture-firer.ts` commits one-shot PR/date decisions using
the trigger and to-do stores' shared database writer. It checks the rule revision
and current owner-scoped item after asynchronous Sentinel lookup. Missing, manual,
Done or archived items stop as Skipped. Eligible fires persist the terminal outcome,
fixed delivery identity and immutable wake prompt before queue work; delivery errors
remain pending and visible. Date recovery rechecks item/owner eligibility and
removal before admission; missing owners fail without retargeting. Clearing retains
dedupe receipts. Owner lists also omit delivered fired wakes without touching the
stored receipt; a wake reopened to pending shows again. A date wake grants no new
authorization.

`QueueActionExecutor` sends bound wakes through `ProcessMessageDeliveryService.deliverOnce`,
which serializes owner checks and dedupe with human follow-ups and buffer draining.
The fixed delivery ID survives queue tasks, pending messages and durable turn attribution.
Trigger infrastructure reconciles pending deliveries after `armAll()`; retry/backoff
uses the same trigger manager and timer registry, independently of PR watching.
Date ticks recheck the absolute instant after bounded timers or clock changes.
Live gating disarms date timers without deleting rules; enabling restores overdue
catch-up once. Resuming an overdue paused rule requires `confirmed: true`.
Accepted busy-parent buffers recover through the existing owner-routed drain.
Trigger firing never writes item status, calls delegation admission or selects a remote target.

### Sentinel job gate runtime

Gate scripts on Sentinel Refrains run without a provider session before scheduled runs and Run now.
`sentinel-refrains/refrain-gate-result.ts` supplies canonical result encoding: object keys
sort lexically at every level, array order is significant and encoded UTF-8 JSON is
capped at 16 KiB. Non-JSON values reject without invoking serialization hooks.
Validation must precede any runner conversion that could silently drop fields or
normalize non-JSON values. `sentinel-refrains/refrain-gate-runner.ts` passes state and strict
JSON validation to `runToolScript` with a 60-second abort deadline. The engine
terminates workers and aborts in-flight tool calls on cancellation; the wrapper
preserves the cancellation reason and clears its deadline timer on every outcome.

Calls follow `MultiRepoQueueRouter.runRefrainGate` → owning `CLITaskExecutor` bridge →
`ExecutorRegistry` → `ChatBaseExecutor.runRefrainGate` with an exact
`{ workspaceId, processId, code, state, signal }` request. The executor validates the
exact Sentinel owner and resolves workspace/working directory; its shared helper
dependencies supply the owner-bound unattended runtime through
`runRefrainGateWithOwnerTools`, which disposes it after every outcome. Canvas
`host.runScript` follows the sibling `runOwnerScript` chain (any chat owner,
`allowTools`-narrowed tools, no nesting); see [LLM tools](llm-tools.md).
`SentinelRefrainService` is the caller: `routes/index.ts` injects `bridge.runRefrainGate` and
the live `features.toolScripting` flag. The service keeps one in-flight gate per
owner/job shared by both admission paths. Each prompt uses saved instructions and
its current nonempty gate JSON, with job-role framing. Gates may return
selected To-do data; Coda owns automatic To-do review inputs. Empty results save
state and record a skip with the original trigger; zero admits. A paused schedule
permits manual gate admission, while a paused gate blocks it. Manual gate errors
and overlapping evaluations return explicit errors. The service rechecks flags,
owner and job revision before saving any outcome, and
aborts the signal on `cancelGate` (edit/delete), `invalidate()` and `shutdown()`;
a cancelled gate never counts as a failure. `testGate` shares the evaluation path
with the saved state but never saves, counts or starts a run; the caller's signal,
`shutdown()` and the flag turning off cancel it. See
[tool assembly](llm-tools.md#chat-tool-assembly).

### Delegated PR outcome reviews

Outcome watches reuse the trigger store, manager, cadence and provider reader.
Their delegated-PR binding distinguishes them from ordinary merge rules: both merged
and closed-unmerged evidence settle once, with a durable delivery identity and immutable
review prompt. The Sentinel assesses the complete condition and latest user verdict;
the notification authorizes no job, retry, implementation or deployment. Missing,
manual, Done and archived items never receive automatic review.

`ProcessMessageDeliveryService.deliverSentinelPrOutcomeOnce` is the isolated
stopped-Sentinel exception. It queues a read-only, receipt-qualified review and buffers
busy turns. Stopped reviews restore cancelled status; owner-routed promotion, recovery
and drain select only PR review buffers, leaving ordinary stopped work parked. Ordinary
machine reviews and merge-rule wakes retain their stopped-parent rejection.

`sentinel-pr-outcome-controls.ts` persists owner/item notification preferences in the
shared native database. Pause suppresses delivery, not terminal evidence; Check outcome
refreshes evidence without bypassing pause, and Resume reconciles retained receipts.
The existing To-do detail surface reads owner-scoped outcome/delivery state through
`client.sentinelTodos`; native errors remain visible, without replacement chats or an
AI polling cron.

Requested receipts retain bounded registration errors when native insertion, arming
or capacity fails. Check and startup reconstruct only those exact intents; live
recovery shares the trigger manager's timer kernel and cadence. Dispatch/drain
rechecks live Pause, enablement and item eligibility before AI execution. Deferred
queue claims retain the original receipt for Resume, and validation writes use
revision checks rather than overwriting concurrent delivery state.

### Temporary chat image lifetime

Admitted initial and follow-up turns retain image files at their existing managed
per-turn paths on success, error and cancellation, including queued cancellation and
direct follow-up delivery. `chat-image-policy.ts` preserves images while cleaning
non-image uploads; rejected/unadmitted inputs still use immediate cleanup. This is a
temporary local-delegation workaround, without a sweeper or durable attachment IDs.
OS temp cleanup is environment-dependent and not guaranteed under disk pressure;
remote paths and native delegated image forwarding remain unsolved.

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
processes, workspaces, queue, scheduling state and workspace/chat-scoped Sentinel to-dos.
`createProcessStore()` selects `SqliteProcessStore`; `store.backend: file` warns and is ignored.
File stores are injected test fixtures.
Native-addon failure is a startup failure, not a JavaScript SQLite fallback.

The process schema definitions, migrations and version live in `packages/forge/src/sqlite-schema.ts`.
`sentinel-todos/sentinel-todo-store.ts` initializes its additive feature tables on the
shared native handle before queue activation; the store borrows its owner's lifecycle.
Its `sentinel_todo_category_sets` table stores one ordered, revisioned category set
per workspace, independently of chat ledgers. Store commands create, rename and
reorder/delete categories under the native writer lock; names are unique ignoring case
(up to 12 categories, 40 characters each). Repo groups own independent sets.
Deletion clears nullable item `category_id` assignments across the workspace and
advances affected item/ledger revisions atomically. Usage counts include all item
states and chat owners. Item `categoryId` persists in nullable `category_id`, with
ordinary item revisions: omission preserves, `null` clears, and writes require a
category in the owning workspace. Missing stored IDs project as Uncategorized.
Category-only edits preserve user-edit/verdict protection. The live gate hides
assignments and rejects explicit category writes; other edits preserve assignments.
Category sets follow the machine-local ledger export/wipe policy.
Creates without `categoryId` are saved, then auto-picked by the single-choice
`pickTodoCategory` decision (8s bound); `setPickedCategory` applies a match only if the
item and set revisions are unchanged, so a user move wins. No match, timeout or an
unavailable backend leave it Uncategorized; explicit choices and later edits never re-pick.
`SentinelTodoService` verifies a Sentinel chat in that workspace and the live default-off
`features.sentinelTodoCategories` gate for every category command. Owning-server REST
and `coc-client` use `/sentinel-todos/:processId/categories`; post-commit workspace
invalidations carry the set revision, and deletions also invalidate affected ledgers.
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
WhatsApp reserves recognized control-command IDs in its bounded own/known-message
guard before best-effort 👍 acknowledgement and command dispatch. Teams' enabled
channel Likes include commands and skip recorded thread-command IDs. Reaction
failures preserve command handling; acknowledgements use native reactions.
Unhandled WhatsApp inbound failures reply with fixed text and log only the parsed
command type, the failing stage (`command`, `send-reply`, `record-reply`,
`chat-routing`, `chat-admission`, …) and `messaging/safe-error-diagnostics.ts`
fields: class, custom name, symbolic/short numeric code, HTTP-like status and one
`cause` level (`WhatsAppBindingAdmissionError` carries the rejected enqueue as
`cause`). Messages, stacks, chat text, JIDs and paths are never logged.

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

### Desktop Sentinel mirror

`features.sentinelDesktopMirror` is live/default-off in Integrations. The
`messaging/sentinel-mirror-service.ts` worker captures explicit dashboard
single/bulk queue, follow-up and pending admissions, including buffered writes.
Server-owned request IDs persist through queue/pending/user records; restart
reconciles exact workspace/process/request proof. Connector inputs, reviews,
queue retries and historical transcripts never create intents.

Binding hydration precedes capture. Active receipts and opaque account pins fix
the destination; selection and rebinding cannot redirect it. WhatsApp
`admissionPending` excludes provisional bindings until exact admission proof promotes
them, retaining accepted work after write/observer failure. Deleted owners cannot
send; process-less admission requires an exact live request and canonical queued
initial owner. Dashboard transport routing keeps clone/group selection separate
from the loaded owning workspace.

`sentinel-mirror-outbox.ts` keeps the ledger in the shared `processes.db`
(schema V40, `workspace_id` on every row): `sentinel_mirror_requests` tracks one
admitted request until its answer is materialized or suppressed (answer state is
independent of user delivery state); `sentinel_mirror_deliveries` tracks physical
parts per role with attempt tokens, retry deadlines and captured binding;
`sentinel_mirror_receipts` keeps compact confirmed outbound IDs.

Scheduler listings
return typed headers without content, chunks, attachments or receipt hydration.
Partial indexes cover unfinished requests, per-workspace destination heads,
in-flight attempts, retries and unreported failures. Loose index seeks page physical
destinations and select one head per workspace; multipart admission seeks only that
destination. Additive indexes install idempotently on the existing table layout.
Every transition is one SQLite transaction with its precondition checked inside
it; failed writes never advance state.

Legacy `repos/<workspaceId>/sentinel-mirror-outbox.json` ledgers
import once per workspace (`sentinel_mirror_imports` marker) before scheduling:
unresolved sends become ambiguous, delivered users without answers stay active,
and staged assistants require a matching captured user. Indexed recovery batches
atomically admit their durable answer after user acceptance, retaining receipts and quarantining
attempt evidence. Corrupt files fail visibly and stay intact; JSON is never read
again. Downgrade to the JSON-only runtime is unsupported after import.
Ledger rows are machine-local:
excluded from export/import, cleared (with legacy files) by wipe.

Scheduling is event-driven, with no polling timer: admission, queue terminal events,
cancellation, connector readiness (`connectorReady`), runtime setting changes,
workspace removal and one timer for the earliest actionable head retry deadline.
Offline, quarantined and resume-blocked heads wait for a relevant wake; a due head
that cannot advance uses bounded backoff, never a zero-delay timer.

Wakes coalesce into a single-flight drain with a dirty marker. Each drain reconciles
active requests in batches of 32 (yielding between batches) and delivers up to
four physical destinations concurrently; parts within a destination stay serialized
and ordered across workspaces.

Disabled workers do nothing (no reads, timers or
sends) and leave work paused; an already issued send still persists its
acknowledgement. Captured-origin authorization checks enablement, disposal and
generation after asynchronous waits and before granting authority. Teams and
WhatsApp notice transports check the synchronous lifecycle gate immediately before
each physical dispatch.

Restore pages receipts into connector echo guards; a failed guard re-arms from the
index on the next drain. Definite failures use durable exponential
backoff/Retry-After; unknown or unrecorded sends quarantine. Fixed display-only
notices report known-owner failures once (`reported_failure`).

The mirror receives only the narrow `SentinelMirrorProcessStore` capabilities:
`getProcessOwnerProjection`, `hasRelayRequestAdmission`, `hasRelayReceiptTurn` and
`getRelayRequestProjection` (forge `relay-request-projection.ts`; SQLite answers them
with bounded indexed reads on `idx_turns_relay_request`/`idx_turns_process_role`
and never selects tool calls, timelines or unrelated turns). Full `getProcess` and
`getConversationTurns` are not reachable from the mirror. Stores without these
projections disable mirroring at composition.

`sentinel-mirror-adapters.ts` reuses Teams/WhatsApp formatting and own-ID guards.
Every part carries the full logical request ID, Desktop role and part number.
Inbound guards verify self/account/destination/thread/owner and exact attempted
content before commands/admission/reactions, including after cancellation/restart.
WhatsApp captures only raw request uploads via `sentinel-mirror-attachments.ts`,
never SDK paths, prompt references, paste cards or generated artifacts. PNG/JPEG/GIF/WebP
use native images; other valid MIME files, including audio/video, use documents.
Batches allow 10 attachments and 10 MiB decoded total; malformed, unsupported or
oversize uploads reject admission before any part sends. Teams/reference-only inputs
retain path-free unsupported markers.

Upload bytes, filenames, MIME, sizes and integrity hashes persist inside the existing
owning outbox's atomic receipt, independently of executor temporary files. Text parts
precede ordered media filename captions; every part shares stable identity, confirmation
and retry policy. Confirmed media discard their bytes; delivered/cancelled receipts
discard remaining bytes. Offline/ambiguous receipts retain unsent bytes for recovery
or explicit cancellation. Transport uncertainty is not exactly-once delivery and
never triggers automatic replay. Final answers are bounded by
their request; pending drain and stale parent terminal state cannot settle them.
Empty completions require the exact completed task; taskless failures require local evidence.

The question hub resolves connector origins first, then exact captured desktop
receipts. Private delegation/notice ledgers retain owner/request/binding pins;
queued child/process provenance strips them. Reviews use only the existing
`MessagingJobNotices.queueResult` worker, verifying authority before each part and
waiting for original user/initial assistant confirmation. Source settlement wakes
desktop result rows. Immutable result chunks and attempted receipt markers guard
lost-ID echoes; legacy origins and wording retain their existing policy.

Cancellation is request-scoped; consumed pending removals preserve active replies.
Release, process cancellation and explicit disconnect suppress future delivery;
graceful shutdown/reconnect retain receipts. Explicit resumes wait through stale
parent cancellation without reviving old tombstones. Enablement is described in
[admin config](admin-config.md).

`messaging/incoming-images.ts` prepares admitted images through `core/attachment-utils.ts`:
five images, 10 MB decoded total and 30 seconds per batch. SDK files/history use
`getRepoDataPath(dataDir, workspaceId, 'attachments')/incoming-*`; callers own cleanup
until executor delivery. Download/storage failures reject whole batches and remove partial writes.
`messaging/pending-images.ts` owns connection-scoped captionless descriptor retention:
five per sender/conversation/thread, 256 contexts, 30 minutes from first arrival.
Consumption is once-only and rejects expired or changed workspace/topic bindings.
Explicit selections discard the sender's root batch or every sender in a shared thread.
Controls do not consume; disconnect/restart requires resend. Consumption and failed/expired
instruction IDs are deduplicated; download still applies dispatch-time byte/deadline limits.

Teams/WhatsApp image preparation runs inside durable binding admission after
workspace/topic/mode resolution. Teams uses relay receipts for initial, active and
pending follow-ups; admission-only image receipts remain enabled when answer delivery
and bot control are off. `incomingImageTaskPayload` carries SDK files, image history
and temporary directories through queue payloads. Rejected admission cleans files;
accepted tasks retain ownership through observer failures. The shared lifecycle persists
follow-up image history before execution. Image captions bypass question-answer
consumption and reject control commands. Normal managers enable image reception. Following
instructions consume pending images in the same resolved context, with overflow preserving
the retained batch. WhatsApp forwards a connection signal through route initialization;
Teams pins per-arrival signals through serialized dispatch and receipt callbacks.
Unsupported image transports fail before SDK execution; admitted files follow the
[temporary chat image lifetime](#temporary-chat-image-lifetime) policy.
Captionless Teams roots seed an instruction thread without an AI task, retaining queued
targets and linking grouped roots to the admitted chat. WhatsApp image/prompt references
preserve captured routing and transfer `sourceMessageIds` into durable receipts;
answer-part ordering stays independent.

Teams and WhatsApp parse inbound text with the shared `parseMessagingCommand`
grammar from `coc-connector` (slash optional, `help`, `quota`, `git status`,
`compact [instructions]`, `[chatid]`, `/ask`, `/autopilot`, `/ralph`, `/sentinel`; unknown `/word` → "Unknown
command" + generated help, never sent to the AI). The CoC routers pass `platform: 'whatsapp'`
or `'teams'`, enabling read-only `list todos` (alias `todo[s]`): every active non-archived
Sentinel ledger item plus at most the 5 most recent Done of the quoted chat or bound Teams thread,
else the sender's selected topic (`messaging-todos.ts`).
`formatMessagingHelp` derives grouped help from the command/mode specs. Routers
use native WhatsApp bold or Teams Markdown rendered by the manager as safe HTML;
`MESSAGING_HELP_TEXT` is the plain-text fallback. Container Teams keeps its own
command grammar and renders its specs with `formatMessagingHelpCommands` as HTML.
`messaging/messaging-commands.ts` answers repo/topic selection, help, quota (from
`AgentProvidersQuotaCache`), Git status and compact for both routers via a `MessagingSelection`
adapter; routers keep platform state and transport. WhatsApp and Teams channel/thread
quota commands share `formatQuotaReply`: every finite normalized snapshot retains its
remaining percentage and reset date, with `5h`/`7d` labels and Codex limit-id prefixes;
unknown percentages stay unknown. Collection, cache freshness and provider-selection
thresholds belong to the quota cache and provider router. `compact` targets the quoted
WhatsApp answer's chat / the bound Teams thread's chat, else the selected topic,
and calls `processes/compact-process.ts` `compactProcess` (shared with
`POST /api/processes/:id/compact`). Busy compaction admits one durable queue operation
through conversation admission, promoting earlier buffered messages first; later arrivals
cannot steer across it. Idle compaction returns the provider result. Queued commands
acknowledge admission and use the per-workspace job-notice ledger for completion,
failure and cancellation at the captured destination; selection stays unchanged. `/ask`, `/autopilot`, `/ralph`, and `/sentinel` parse an explicit
mode; plain text has none, so a follow-up keeps the chat's mode and a new chat runs in
`sentinel` (the dispatcher) even when `sentinel.enabled` is off — that flag only gates the
dashboard picker. Older threads bound to Ask chats stay Ask. `messaging/messaging-chat-mode.ts` resolves it via `resolveFollowUpMode` (a still-queued
first turn lends its queued mode) at every Teams/WhatsApp enqueue site.
When the target is a sentinel (persisted or still queued), `/ask`, `/autopilot`, and `/ralph`
hand off instead: `messaging/job-handoff.ts` `createMessagingHandOff` (one instance in
`routes/index.ts`, passed to both routers) resolves the sentinel's workspace, enqueues a
separate job with `context.spawnedFromProcessId` + `context.messagingOrigin`, and calls
`MessagingJobNotices.track`, so it gets notices and `ask_user` relay like a model hand-off.
Ordinary `/ask` and `/autopilot` handoffs share `createSentinelDelegationEnqueue` with
model delegation: after startup recovery, the parent-owned relationship is durable before
queue admission. A queued/running first Sentinel task supplies parent identity when its
process does not exist. Connector `/ralph` grilling keeps separate session admission.
Image handoffs reserve a job id before workspace-scoped receipt admission and download.
WhatsApp keeps a delivered notice receipt; Teams keeps an admission-only receipt whose
selected target remains the sentinel (including its queued task id). Matching queue
payloads retain files and notice tracking after observer failures; rejected admission
cleans files and allows redelivery. No sentinel turn runs and selection is unchanged;
`/sentinel` or no prefix reaches the sentinel. An empty mode prefix replies "Send a message to start a chat.".
`list remotes` (servers numbered `n`, their repos `n.m`, offline servers bare) and
`list topics <n.m|name@server> [-v]` (10 most recent remote chats, read-only footer) are
answered by `messaging/remote-browse.ts` over the route-layer `WorkspaceDirectory`
(`list()` + `listRemoteChats()` → the remote's `GET /api/processes?workspace=&limit=`).
The `n.m` numbering lives in a per-chat in-memory `RemoteRefMemory` (WhatsApp group,
Teams thread or channel+user); remote repos never become the selected repo.
Local, remote and Teams-thread topic lists share `formatTopicList` in `remote-browse.ts`
(`▶` current marker, status emoji, truncated escaped title, `now`/`Nm`/`Nh`/`Nd` age from
`lastEventAt ?? startTime`, ids only with `-v`, one next-step footer). Local
`local-topics.ts` merges transcript-free saved pages with owner-verified first-turn
chat queue tasks across registered workspaces: five chats created within 24 hours,
ranked pinned, running, queued, then activity. Follow-ups and internal jobs do not
create rows. Queued rows carry a label and stable owner-qualified process ID.
Numeric selection retains the displayed refs and revalidates the owner and live
queue/process transition. Both connectors admit subsequent turns through existing
durable receipts and queue dependencies; Teams thread selections retain task IDs
until the process exists. Cancelled or missing queue targets reject selection and
delivery. Remote directory lists expose saved processes only.

### Messaging Git status

`messaging/git-status.ts` reads the admitted caller's local workspace registry, expands
registered groups only within that scope and deduplicates repository roots. Remote and
other virtual workspaces are excluded. `git status` bypasses pending question answers
without changing selections or invoking AI. Native branch/change parsers and forge's
WSL runner serve fixed status argv with optional locks disabled; safe-directory config,
Git state and network remain untouched. Per-repo errors remain visible alongside
successful summaries. Each repo is one row: `name - clean`, or only the nonzero
staged/unstaged/untracked/conflict counts, then `<N> ahead` only when the ahead count is
positive and tracking is reliable (`branch.ab` present, upstream set, not detached/unborn);
no branch names, upstream labels or behind counts. Replies use
lossless connector text chunking.

### IC3 own-command launcher

`messaging/teams-ic3-own-commands-runtime.ts` uses an account-pinned connector
Trouter listener to wake native Azure CLI reads of self/direct/group/meeting chats.
`TeamsMessagingManager` supplies the shared saved `ic3Region` and change
subscription; region changes cancel and restart the runtime independently of
the channel bridge connection. An unset region blocks reads.
A 64-chat mailbox coalesces hints and drains between scan reads; overflow,
loss and disconnect reconcile. Single-flight fallback scans read self first,
process discovery pages incrementally and remain due 60 seconds after completion.
Failed hints retry after cooldown; HTTP429 pauses all reads. Native `Unsupported`
discards unsupported non-self notification targets, without changing
read health or blocking other hints. Self-stream and discovered-chat failures
remain visible.

Native discovery and history share exact type checks: `chat` with `OneToOneChat`/`Chat`,
or `meeting` with `Meeting`. Channels and unknown thread types remain excluded.
Only the newest 30 messages per chat are inspected. Admission excludes pre-start
messages, edits, quotes, attachments and foreign senders. Own-user `@coc <prompt>`
messages share one Ask conversation per tenant/user, Teams chat and configured local
workspace or repo group. Group jobs run at the registered group root; normal chat
execution supplies member context and access policy on initial and follow-up turns.
Other virtual scopes and non-absolute roots reject without dashboard fallback.
A stable hashed first-task ID resolves queued or saved conversations
across restarts. First turns use medium effort and normal Auto provider resolution;
follow-ups retain conversation policy and use queue process ordering. Admission
serializes by conversation. Account/chat/message hashes, queue evidence and persisted
user-turn request IDs prevent duplicates. Mark attempts before admission; uncertain
outcomes never retry.

`teams-ic3-command-context.ts` enriches a mention inside a thread before marking
admission or attempting Eyes. The native `readThread` collection supplies the root
independently of reply pagination; account/session/chat/root-bound cursors keep
other threads out. At most five pages and 30 seconds select the root plus up to
20 strictly earlier replies, ordered oldest-first. JSON context is capped at
48 KiB, escapes envelope delimiters and labels omitted/deleted/truncated content.
It is untrusted reference data, separate from the user request and refreshed per
follow-up. Read failures prevent context-free jobs and leave admission retryable.

Each eligible mention, including follow-ups, attempts Eyes before admission.
`Ic3ReactionClient.acknowledgeSourceMessage` wraps account-pinned
`reactToSourceMessage` (Eyes/Checkmark/Crossmark), writing only the selected emotion.
Writes need no discovery/custom emoji, retain a ten-second deadline and never replay.
Transport success proves no task outcome; acknowledgment failures log safely without
discarding commands. Channel Likes remain independent.

Memory-only pending replies capture source identity, verified native chat kind,
original message ID/text and existing root before enqueue. Queue terminal events
consume them. Delivery serializes within each conversation; different
chats deliver independently. Shutdown drains all active reply chains; reconfiguration
revokes their authority without blocking the new generation. Shared answer extraction
returns only the matching request's answer; fixed notices replace raw failures.
`teams-ic3-own-command-reply.ts` threads direct/group answers using the existing
`rootMessageId` or the originating mention ID. The connector appends
`;messageid=<root>` only to the chatsvc request route, preserving the base source
identity in the envelope, access checks and compliance destination. Self/meeting
answers carry a native `schema.skype.com/Reply` blockquote whose `itemid` identifies
the mention. Its escaped preview is bounded to 200 code points; chunking reserves
its UTF-8 bytes within the 20,000-byte total. Compliance evaluates complete HTML.
Follow-ups and fixed notices share this policy; channel routing is independent.
`Ic3DirectMessageClient.sendToSourceChat` preserves exact
`48:notes`, `19:...@thread.v2` or `19:...@unq.gbl.spaces` IDs. Each part pins the
account and rechecks access through the captured native reader; Graph/MCP are excluded.
Source replies allow 70 seconds total for preparation and 10 seconds from dispatch;
ordinary sends/Likes retain their 10-second total deadline.

Failed chunks permit two retries only for definitive HTTP401/429, known transient
native preparation failures or pre-dispatch timeouts. Refresh credentials and
source access; wait 1s/2s or Retry-After, capped at 60s per wait. Longer cooldowns
stop delivery. Confirmed chunks, permanent failures and unknown outcomes never
replay. Reconfiguration/shutdown abort reads, admission preparation and replies;
an enqueue past the final caller check may finish. Stop ingress and drain pending
work. Restart does not recover pending replies. Further mentions continue the saved
conversation; interactive questions stay in the dashboard.

Read-only `GET /api/messaging/teams/ic3-own-commands/status` snapshots read health,
last-check/last-success timestamps and independent `trouter` health. Completed reads
publish immediately; history failures stay degraded through a scan while successes
advance last-connected. Outer poll failures are error. Expose only safe codes;
admission/reply failures do not affect read health. Status reads trigger no I/O
and prove no write access. `[IC3 commands] timing` info logs correlate hashed request
IDs across detection, acknowledgement, admission, completion and reply delivery/failure. Durations
separate message age at detection, history reads, admission, queue/execution when
queue timestamps exist, reply-chain wait and delivery. Logs exclude message bodies,
raw chat IDs and account identities. See [configuration](admin-config.md#ic3-own-command-configuration).

### Teams reaction job admission

`messaging/teams-reaction-evidence.ts` normalizes complete native `smilerobot`
membership (`users[].mri/time`) and raw `EventMessage.time`, never receipt time.
`teams-reaction-admission.ts` requires the pinned own user, timestamps newer than
registration and within 30 seconds, and ordered nonduplicate evidence. Malformed,
future, catch-up and ambiguous snapshots reject. Up to 4,096 fresh targets retain
replay protection; timestamp-distinct re-additions get stable account/source-qualified
request IDs. Live completeness and timestamp semantics require protocol verification.

`teams-reaction-launch.ts` creates separate first-turn Ask jobs with medium effort,
runtime-default timeout and normal queue/provider/pause policy. It checks local
repo or repo-group workspace/dispatcher bindings before and after preparation and verifies queued/saved
ownership before deduplicating. Prompts reference the exact skill path; JSON-encoded
Teams data cannot enable slash-command capabilities. Context caps at 512 KiB UTF-8;
questions stay dashboard-only and automatic merging is prohibited.

`teams-reaction-execution.ts` serializes each account/chat/message through actual
queue termination, independently of execution workspace; other sources remain
concurrent. One server-owned coordinator survives reconnects, coalesces duplicate
requests and closes fast-finish races with subscription-before-read. Limits are
256 pending requests and 4,096 retained sources. Proven non-admission permits retry;
uncertain admission or mismatched queue evidence blocks that source. Cancellation
revokes observers without releasing admitted-job locks; disposal prevents new work,
not existing execution.

`teams-reaction-context.ts` reads the exact source and up to 20 strictly earlier
messages through pinned backward history. Budgets: 100 pages, 5,000 records,
60 seconds, 8 MiB scanned and 512 KiB output. Missing/incomplete targets, cross-chat
or conflicting snapshots reject; partial coverage and excluded timestamps remain
explicit. Embedded quotes stay untrusted; attachments, linked quotes and other
chats are never fetched.

`teams-reaction-pickup.ts` sequences admission, dispatcher validation, context,
Eyes acknowledgment and execution. The connector acknowledgment has no operation
or post-dispatch deadline; native credential attempts retain thirty seconds.
Explicitly retryable, definite failures allow three attempts with fresh credentials
and one/two-second backoff honoring `Retry-After` through sixty seconds. Unknown
writes never replay. Binding changes or exhausted/uncertain failures prevent launch;
duplicates skip Eyes. Registration loss cancels preparation, acknowledgment and
backoff. Acknowledged work retains its account/config-scoped observer across
notification reconnects; account/config changes and shutdown revoke delivery.

### Teams reaction connection lifecycle

`routes/index.ts` owns one coordinator and live-configured
`messaging/teams-reaction-runtime.ts`, independent of own-command enablement.
Region/dispatcher validation precedes authentication; the account pins readers
and writers. Registration/loss boundaries reset admission cutoffs; disconnects
wait for registration without scanning history or replaying reactions. Configuration,
region and credential changes retire owned clients. Native connection retries wait
60 seconds; at most 256 pickups/results remain outstanding. Shutdown drains the
runtime and coordinator before queue teardown.

Info logs correlate pickup, rejection, terminal delivery and cancellation using
hashed source-event traces and elapsed time. Notification state/boundaries and
bounded error classifiers expose failures without content, identities or raw errors.

### Teams reaction result delivery

`messaging/teams-reaction-outcome.ts` validates process/workspace/request/Ask
ownership and reads the final complete assistant answer after the sole request-bound
user turn. Its trailing `teams-delegation-result` JSON has exactly requestId,
kind (task/approval) and outcome (done/rejected). Missing/malformed reports,
follow-ups, partial answers and failed/cancelled jobs reject; foreign ownership
and storage errors prevent delivery. Outcomes report dispatcher execution, not
independent provider proof.

The dispatcher owns policy and approval writes: recheck the revision and saved
approval; existing approval for that revision counts as done without another vote.
Missing evidence, blocked work, errors or cancellation require rejection with
findings. Queue completion alone never proves success.

`teams-reaction-reply.ts` captures source/outcome before awaits and validates targets
before credentials. Done adds only Checkmark after fresh account-pinned access
validation. Rejected sends an escaped source quote (120 Unicode code points) and
fixed sentence, then revalidates access before Crossmark. Notices cap at 4 KiB,
omit job links and leave findings in the dashboard. `sendTeamsReactionReply` is
notice-only; source sends reuse the IC3 definitive-failure retry policy. Unknown
writes and reaction failures never replay or trigger text fallback. No reply-parent
metadata is synthesized.

### Teams outbound text compliance boundary

`messaging/teams-outbound-compliance.ts` evaluates source-owned compliance context
through the shared Copilot `DecisionService`. `sendTeamsIc3SourceReply` snapshots
destination and all formatted chunks before evaluation; reaction-result source
capture preserves the context. A live policy getter supplies one snapshot per
logical message. Policy instructions stay separate from untrusted trigger evidence,
complete formatted text and chunk boundaries; absent native HTML is omitted from
the JSON request. No unrelated history is included.

`routes/index.ts` supplies the server-shared decision service to both native
runtimes. Each runtime attaches the original trigger, physical workspace/cwd and
a live owning-server policy getter to every text source. Reaction pickup retains
the exact target body separately from dispatcher history and verifies the terminal
job's workspace against its captured binding. Policy-only saves affect subsequent
logical sends without revoking active requests. Provider selection and chat-tool
flags do not participate in enforcement.

Enabled checks require complete context and a nonblank policy, enforce the
Decision API's 256 KiB UTF-8 request limit without truncation, and permit one
evaluation with output repair disabled. A structured block/allow choice resolves
ties to block without a confidence threshold. A two-minute deadline includes
backend readiness; cancellation and all failures prevent text dispatch.

Explicit block adds one account-pinned Crossmark to the captured original trigger
after fresh source-access verification, then throws `TeamsOutboundComplianceRejected`.
Its optional `rejectionReactionError` retains feedback failure without permitting
text, fallback, retry or ordinary outcome reactions. Decision failures add no reaction
and throw `TeamsOutboundComplianceFailed`, with a fixed safe reason/code and original
failure as `cause`. Both runtimes log correlated content-free outcomes and retain the
latest `{ state: blocked | failed, reason, checkedAt }` under `outboundCompliance`,
separate from read/connection health, including cancellation. The existing owning-server
Teams status card polls the uncached own-command and reaction status routes and shows
each trigger's latest failure and feedback error. Failures never emit delivery receipts.
Safe known-unsent transport retries retain the exact allowance. Disabled policy and
sources without compliance context retain ordinary delivery; ingress owners supply
context for gated sends.

### Messaging ask_user question relay

`messaging/ask-user-relay.ts` (`AskUserQuestionRelayHub`) is the executor's
`getAskUserQuestionRelay` capability. Connector `QuestionTransport`s locate
Ask/sentinel request receipts by `(processId, relayRequestId | taskId)`.
Handed-off jobs supply `metadata.messagingOrigin` on every turn, independent
of mode or receipt: WhatsApp posts to the saved group; Teams replies under
its saved `threadId`, or posts top-level when unknown. Selection changes do
not redirect job questions. Origins persist on the process and in the
per-repo completion-notice ledger.

Questions post one at a time using `formatWhatsAppQuestion` / `formatTeamsQuestion`.
`tryAnswer` runs before command routing: a question reply answers it; plain text
answers only when exactly one question is pending. Ambiguous thread-root replies
leave both questions pending and ask for a specific question or dashboard answer.
`parseQuestionReply` maps recognized numbers, option labels/values, `1,3`, and
yes/no to structured answers. Every other non-empty ordinary reply passes through
as trimmed text, including clarifications and out-of-range numbers; only exact
case-insensitive `skip` skips, and empty replies are rejected. Reply hints advertise
structured choices, free text, and skip. The tool's pending map lets
the first answer win; dashboard answers produce the existing already-answered
reply on the phone. Disconnected job questions remain dashboard-only without
re-posting; failed sends resolve `unavailable`; turn `cancelAll` clears pending
questions. Pending state is in memory, so restart requires dashboard resolution.
Direct request question IDs persist in WhatsApp receipt `questionIds` and Teams
root receipt `sentMessageIds`. Approvals stay dashboard-only.

### Teams connection routing and consent

The normal Teams bridge uses MCP for discovery/create, Graph beta for authoritative channel
roots and paginated replies, and IC3 for supported channel Likes. Beta is a preview API
subject to change; Graph sends/replies and standalone Graph clients retain stable v1.0. The manager always
sets `mode: mcp, channelReadBackend: graph`, including omitted saved settings.
`pollChannelReplies` uses the live, default-on `features.teamsAiAnswerRelay` gate.
Missing relay settings resolve on; explicit false stops reply polling and answer relay
without restart/reconnect. Connectivity, Likes and Trouter require their own enablement.
The connector's standalone defaults remain independent.

Graph channel deletion tombstones retain message IDs and pagination without
admitting text or images. Null body content requires a valid `deletedDateTime`;
malformed ordinary messages still fail the page. Deleted roots retain readable
surviving replies.

Connector `receiveImages` exposes lazy inline/file image descriptors on hybrid
Graph roots/replies. Scoped hosted content uses fixed v1.0 paths; HTTPS SharePoint
image references encode into fixed beta `/shares/u!…/driveItem/contentStream` paths.
Both use identity-pinned read credentials, one 401 refresh and no redirects.
File reads require delegated `Files.Read` (or documented higher read consent) and
SharePoint access; 403 yields safe permission feedback. MIME, raster signatures,
byte/deadline limits, ordinary admission and stop cancellation apply. Normal managers
opt in; standalone connector/container consumers retain their existing defaults.

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

`messaging/job-notices.ts` (`MessagingJobNotices`) tracks connector-originated jobs by
workspace/process and terminal task. Ordinary Sentinel first-turn notices wait for the
matching parent-owned delegation, with the same connector/group/thread. A persisted parent
result outbox receipt suppresses the child notice, including before ledger acknowledgement;
failed parent delivery releases one safe child fallback. Review admission and settlement
reconcile held notices. Later child turns and compaction retain direct notices. Non-Sentinel
jobs use direct notices immediately. Failures use fixed text or a recognized usage-limit reset.

The executor's per-turn `sendToConversationRuntimeFor` resolves the origin through
`AskUserQuestionRelayHub.locateOrigin`; the tool calls `track`. The ledger lives at
`repos/<workspaceId>/messaging-job-notices.json`: terminal turns persist as `pending`,
sends persist as `sending`, and sent/suppressed tasks become `done`. Interrupted sends are
quarantined. Restore recovers first-turn terminals; reconnect calls `reconcile(platform)`.
Transports:
`createWhatsAppNoticeTransport` sends unquoted plain text and binds the notice as a
`WhatsAppBinding` with `notice: true`, so a quote-reply follows up the job (mode kept by the
follow-up resolver) without `selectTopic`; `TeamsAnswerRelay.noticeTransport()` posts a
top-level `CoC ·`-attributed safe-HTML message and saves a `teams-thread-roots` selection for it, so thread
replies route to the job by root (a reply inside the dispatcher's thread would route to the
dispatcher) and user selection is untouched.

Automatic chat compaction notices (WhatsApp only) track `payload.trigger: 'auto'` tasks on
`taskAdded`. `messaging/auto-compaction-origins.ts` picks the destination from the request whose
response triggered it: that request's own WhatsApp receipt (current group, not released or
notice-only), else its desktop-mirror capture while the mirror is enabled. Nothing is sent
for unbound, manual, Refrain job or other-workspace cases. `taskStarted` records one
`<taskId>:start` notice only while the compaction record still names the task. The outcome
follows on the existing terminal path: fixed wording plus removed-message/freed-token counts,
never summaries, errors or history. Cancellation before start says it never ran. An unsent
start is dropped once the outcome is pending. Every part rechecks the captured binding:
released or moved bindings suppress, never retarget. Notices wait while the triggering answer
is undelivered, and the answer relay's `onSettled` wakes them. Mirror origins use
`authorizeCapturedOrigin(origin, owner)` instead.

Parent Sentinel results use `MessagingJobNotices.queueResult` with the stable review receipt
and the connector origin captured in `delegated-jobs.json` before admission. The owning
parent workspace persists the bounded review answer or fixed cancellation notice before
acknowledging result delivery. Completed review answers come from the matching parent user
turn, bounded by the next user turn; failed/cancelled reviews do not forward partial output.
Result rows replay on reconnect/restart and ignore unrelated parent terminal turns. WhatsApp
binds each outbound part to the parent; Teams uses the saved thread without changing its
selection, or binds a new top-level post to the parent. Multipart sends quarantine unknown
or partially sent outcomes under the existing notice rules.

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
heartbeat/ACKs and reconnect. Its target getter returns a conversation predicate
or `null` to suppress wakes.
Real activity source threads override synthetic streams; notifications never authorize
dispatch. Workspace/thread bindings remain owned by the existing messaging router.
Known-thread wakes read authoritative Graph replies directly; root discovery/backfill runs
on unknown/missing hints and reconciliation. Eligible IC3 Likes start before routing
without blocking dispatch or subsequent reads; failures are sanitized and logged.

`notificationStatus` exposes protocol state and sanitized typed errors independently
of reader connectivity through the messaging status API and Connections card.
Standalone `TrouterClient` exports credential-injected `start/getStatus/stop` lifecycle
for protocol-only smoke tests. `onMessageUpdate` exposes untrusted emotions separately
from message wakes for selected registered self/direct/group chats; owners enforce
reaction admission. Reconnect/loss never replays updates, generations reject stale
callbacks and stop permanently disposes the client.

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

# Server Architecture

Internals of `packages/coc/`: a Node.js CLI that executes YAML workflows and serves the AI Execution Dashboard. Published as `@plusplusoneplusplus/coc`; depends on `@plusplusoneplusplus/coc-workflow` (workflow compilation/execution) and `@plusplusoneplusplus/forge` (runtime/process/queue utilities). Package layout, build order, and release commands live in [monorepo.md](monorepo.md).

## CLI Commands

```bash
coc run <path>              # Execute a workflow
coc validate <path>         # Validate YAML without executing
coc list [dir]              # List workflow packages in a directory
coc serve                   # Start AI Execution Dashboard web server
coc queue submit [message]  # Submit a chat task to a running CoC server queue
coc queue list              # List active queued/running tasks, optionally filtered
coc queue cancel <taskId>   # Cancel a queued or running task
coc queue status <taskId>   # Show status/details for a single queue task
coc skills                  # Manage CoC skills (list, install-bundled, install, delete, check-updates)
coc wipe-data               # Clear all stored data
```

### `run` Options

| Flag | Description |
|------|-------------|
| `-m, --model <model>` | Override AI model |
| `-p, --parallel <n>` | Parallelism limit |
| `-o, --output <fmt>` | Output format: `table`, `json`, `csv`, `markdown` |
| `-f, --output-file <path>` | Write results to file |
| `-w, --workspace-root <path>` | Workspace root for skill resolution |
| `--param key=value` | Workflow parameters (repeatable) |
| `--dry-run` | Validate only, skip execution |
| `--approve-permissions` | Auto-approve AI permission requests |
| `-v, --verbose` | Per-item progress output |
| `--timeout <seconds>` | Execution timeout |

### `serve` Options

`-p/--port`, `-H/--host`, `-d/--data-dir`, and `--theme` override the corresponding `serve.*` config keys below; `--no-open` suppresses the browser launch.

## Source Layout

```
src/
├── index.ts              # Entry point (bin)
├── cli.ts                # Commander program setup
├── commands/             # One module per CLI command + options-resolver.ts
├── server/               # HTTP/WebSocket server (module layout below)
├── ai-invoker.ts         # AI invoker factory
├── logger.ts             # Console logger
├── output-formatter.ts   # Result formatting
├── config.ts             # Config resolution (~/.coc/config.yaml)
├── config/schema.ts      # Configuration JSON schema
└── validation/           # Pipeline YAML validation
```

## Server Module Layout

`src/server/` is grouped by feature domain; cross-cutting plumbing stays at the root.

| Directory | Purpose |
|-----------|---------|
| `core/` | api-handler, attachment-utils, image-utils, hostname-utils, build-info |
| `streaming/` | `ProcessWebSocketServer` and per-process SSE (see [streaming-architecture.md](streaming-architecture.md)) |
| `logging/` | pino-backed logger, in-memory ring buffer, /api/logs routes |
| `admin/` | admin-handler, db-browser (read-only SQLite), heap-monitor, stats |
| `workspaces/` | global-workspace, my-work, my-life, repo-group, workspace-summary. In `repo-group-workspace.ts` a group is a virtual workspace (`group-<slug>` ID, root `~/.coc/repos/<groupId>/`) whose `group.json` holds `{ name, members: [workspaceId...] }` naming registered non-virtual repo workspaces only; names/paths resolve from the registry at read time, and removed or missing-path members come back stale. `repo-group-handler.ts` serves `/api/repo-groups` CRUD, wired in `routes/index.ts` with a `getWsServer` topology broadcaster and an `onGroupRegistered` hook registering the group with the queue bridge and schedule manager. `resolveRepoGroupChatContext` (`repo-group-chat-context.ts`) returns a `<repo_group_context>` block of each live member's name + absolute path; `ChatBaseExecutor.execute` and `FollowUpExecutor.executeFollowUp` append it to the prompt unpersisted and pass the paths in `SendMessageOptions.additionalDirectories` |
| `processes/` | in-memory store, output-file-manager, stale-task-detector, pin/archive, seen-state, turn-actions, history, resume |
| `queue/` | queue-handler, executor-bridge, multi-repo-router, image-blob-store, partitioner |
| `schedule/` | cron-utils, schedule-handler/manager/executor, run-persistence, async yaml-persistence, repo-schedule-loader/overrides, plus pure `schedule-request-parser.ts` (REST body validation) and `schedule-task-builder.ts` (queue payload). User schedules are per-entry YAML under each repo data directory (`schedules.json` migrates at init); writes/deletes and async repo-schedule reload scans serialize per repo, and a failed scan keeps the previously loaded set. Run records stay `running` after enqueue and finalize from queue terminal events; scheduled Ralph runs finalize from the full `ralphSessionComplete` lifecycle. Overlapping fires record `missed` and rearm after the active run. Runtime state keys on `(repoId, scheduleId)` via `schedule-runtime-key.ts` because repo schedules derive deterministic `repo:<stem>` IDs that repeat across clones; `isAnyRepoRunning` is the only cross-repo lookup |
| `tasks/` | task-types, cache, watcher, migration, root-resolver, generation, read/write handlers, comments/ |
| `notes/` | read/write/comments/AI/file-preview/image/edits handlers, `git/` sub-module, workspace-scoped multi-root resolution. The roots API combines the managed root, user-configured Notes roots, and canonical task directories discovered from repo-scoped tasks, `.vscode/tasks`, and task `folderPaths`; task identities are opaque read-time-derived values, not Notes preferences. `notes-path-safety.ts` enforces lexical and canonical-symlink containment for every non-default-root file, folder, comment-sidecar, order, and image operation |
| `workflows/` | constants, utils, watcher, read/write handlers |
| `templates/` | template-watcher, CRUD handler, replicate-apply |
| `skills/` | skill-handler, route-handlers, global-skill-handler, instruction-handler. Manual global and per-repo extra folders are read-only containers probed base → `.github/skills` → `skills`; listing, file reads, runtime resolution, and effective-path diagnostics use the same candidate roots |
| `prompts/` | prompt-handler, prompt-utils |
| `servers/` | Remote CoC server registry, DevTunnel connector |
| `git/` | git-cache, git-info-cache, repo-utils, plus the operation kernel behind `api-git-branch-routes.ts`: `GitOperationRunner` (job-ID minting, already-running 409 guard, `GitOpsStore` create/settle, mutable-cache invalidation, `broadcastGitChanged`), `GitPatchTransferService` + `git-patch-transfer-metadata.ts` (patch export/apply, provenance sanitizing that strips POSIX/Windows/UNC local paths), `GitRebaseReorderService` (autopilot prompt, queue subscription, terminal handling), `git-request-validators.ts` (hash/field validation, 409 dirty/conflict mapper). All throw `APIError`s that `createRoute` renders. `GitRangeService.detectCommitRange` takes the `base=default-branch\|upstream` mode of the `/api/workspaces/:id/git/branch-range*` routes (see [rest-api.md](rest-api.md)); cache keys are `{wsId}:branch-range:{baseMode}` so the modes never serve each other's data, and `invalidateMutable(wsId)` clears both |
| `storage/` | storage-migration, startup migrations, directory-history-importer, export/import/wiper, and `snapshot/` (per-domain modules + declarative registry; `storage-snapshot-domains.ts` is a compatibility barrel) aligning admin backup/restore/wipe across processes, workspaces, wikis, queues, image blobs, preferences, schedules, and git-op cleanup. Schedule snapshots (YAML + `schedule_runs` rows) live in `schedule/schedule-snapshot-repository.ts` |
| `llm-tools/` | AI tool factories (see [llm-tools.md](llm-tools.md)) |
| `kusto/` | `kusto-exec.ts` runs KQL via `azure-kusto-data` + `AzureCliCredential`, caching the authenticated client per `clusterUrl` for the process lifetime (`createCachedClientFactory`; injected test factories bypass it). Case-insensitive `mock:` queries (`mock:<JSON {columns,rows}>`, `mock:error[: msg]`, `mock:big[: N]`) resolve inline without a cluster or `az login`, through the same coercion + truncation. `kusto-service.ts` holds `runKustoCanvas` (execute/truncate/persist), shared by `POST /canvases/:id/run` and the `kusto_query` tool; gated by `kusto.enabled` |
| `executors/` | AI chat execution layer (see Executors below) |
| `infrastructure/` | Server bootstrap (composition root) |
| `routes/` | Centralized route registration |
| `providers/` | Provider abstraction for AI/PRs |
| `repos/` | Repository management endpoints |
| `work-items/` | Work-items REST + executors and their command services: `work-item-commands.ts` (create/update), `work-item-execution-command.ts`, `work-item-pr-submission-command.ts`, `work-item-ai-review-command.ts`, `work-item-comment-resolution-command.ts`, `work-item-from-chat-command.ts`. `work-item-execution-settings.ts` parses provider/model/reasoning-effort/effort-tier/auto-routing/execution-mode; `work-item-execution-shared.ts` holds shared context, the explicit `storageRepoId` vs `commandRepoId` scope pair, git runner injection, and cache/broadcast settlement |
| `preferences/` | Schemas/types, repo-scoped and global JSON repositories, pure PATCH/import merge policy, sync/work-item live effects, route registration. `preferences-handler.ts` is a compatibility barrel |
| `dreams/` | Workspace-scoped card/run types, deterministic candidate prefiltering, eligible conversation source selection, process-lifecycle-backed read-only analyzer/critic validation, lifecycle storage with provider/model/timeout attribution and analyzer/critic process links, durable dedup/coverage history, queue-backed visible `dream-run` orchestration with quiet-window readiness checks, opt-in idle scheduling, Dreams REST routes |
| `wiki/` | Wiki integration (manager, data, routes, context-builder, conversation-sessions) |
| `terminal/` | WebSocket-based PTY (session-manager, routes, ws-server) |
| `memory/` | Memory config, bounded-memory REST, repo-memory, promote, background-review |
| `ralph/` | Iterative execution sessions and file-backed journal (see [ralph.md](ralph.md)) |
| `for-each/` | For Each run records, item-plan validation, file-backed repo-scoped draft/approval storage, sequential child-chat orchestration |
| `map-reduce/` | Plan generation, run records, map-plan validation, reduce-step state, per-run parallelism config, file-backed repo-scoped draft/approval/execution storage with parallel map claiming, and child-chat orchestration that auto-chains reduce after successful map |
| `native-copilot-sessions/` | Read-only native session services; CoC never writes to native CLI stores. Copilot reads `~/.copilot/session-store.db` over short-lived read-only connections, scoping by native `cwd`/`repository`, with parameterized FTS search and typed `db-missing`/`db-invalid` states. Codex and Claude filesystem providers scan `~/.codex/sessions` rollout JSONL and `~/.claude/projects/<dash-encoded-cwd>` transcript JSONL, scoping by transcript `cwd` (Claude requires every recorded `cwd` under the workspace root), collapsing duplicate native IDs to the newest transcript, with substring search and typed `store-missing`/`store-invalid` states. `NATIVE_CLI_PROVIDER_DESCRIPTORS` (in `@plusplusoneplusplus/coc-client`) is the single source of provider identity, labels, store hints, search strategy, and `available`/`planned` status; `native-cli-provider-registry.ts` builds the served map from it and throws at startup when an `available` descriptor lacks a factory or contradicts its search strategy, so dashboard tabs and the server registry cannot drift. `native-transcript-index.ts` holds an LRU stat-keyed (path + mtime + size) metadata cache so warm lists only stat. Parsers sit per provider under `parsers/` (`claude-transcript-parser.ts`, `codex-rollout-parser.ts`) over `transcript-parser-core.ts`, re-exported by `cli-session-parsers.ts` |
| `models/` | Model registry endpoints |
| `agent-providers/` | Quota cache, provider status routes, SDK install helpers, and the pure Auto router evaluating configured priority, availability, quota thresholds, weekly guards, fallback, and selection warnings before callers expand effort tiers. Queue/fresh-terminal defaults, explicit SPA Auto requests (`context.autoProviderRouting.requested`), Ralph, For Each, and work-item enqueue share the quota cache, refreshing only when missing or stale |
| `messaging/` | Teams bot integration: manager, command router, per-user state |
| `spa/` | Dashboard SPA (HTML template, React client) |
| `dashboard/` | Server-side dashboard state helpers: recent active-workspace tracking and interval-based proactive refresh of warm active-workspace caches |

## Executors

| File | Purpose |
|------|---------|
| `base-executor.ts` | Abstract base: streaming, throttling, tool-event capture |
| `chat-base-executor.ts` | Abstract chat executor: AI call lifecycle, memory/options helpers |
| `chat-executor.ts`, `autopilot-executor.ts`, `follow-up-executor.ts` | Ask-mode (interactive), Autopilot-mode, and follow-up message executors |
| `note-chat-executor.ts`, `note-create-executor.ts`, `commit-chat-executor.ts`, `workflow-executor.ts`, `shell-executor.ts` | Note chat, note create, commit chat, workflow, and shell-script executors |
| `classification-executor.ts` | Diff classification executor; runs with interactive Ask-mode semantics and injects `saveClassification` for persisted hunk results |
| `process-lifecycle-runner.ts` | Full process lifecycle + pending-message draining |
| `prompt-builder.ts` | System message, memory context, skill injection |
| `chat-tool-builder.ts` | Common chat tool bundle assembly |
| `chat-turn-context-builder.ts` | Per-turn tools, memory, ask-user handles, tool guidance |
| `chat-turn-system-message.ts` | Canonical chat-turn system-message block order |
| `chat-turn-policy-resolver.ts` | Per-turn model / reasoning effort / Copilot context tier |
| `chat-turn-runner.ts` | Shared SDK callbacks (MCP OAuth dispatch) |
| `chat-turn-settlement.ts` | Turn completion: cumulative tokens, token-usage event, note snapshots |
| `memory-v2-addon.ts` | Wires Memory V2 facts/recall and the memory tools into chat executors |

### Modes and classification

Chat tasks run in Ask, Autopilot, or Ralph mode. Payloads carrying `mode='plan'` normalize to Ask before dispatch, metadata persistence, schedule execution, and follow-up execution; there is no Plan executor. Copilot and Claude chat-system prompts carry a source-location formatting directive so cited code locations render as Markdown file links with line/range suffixes; Codex omits it.

Diff classification is queued as a first-class `pr-classification` task or a classify-diff chat task; `ClassificationExecutor` runs both with Ask-mode semantics and the `saveClassification` side effect, and `process-lifecycle-runner` persists `mode: 'ask'` in `pr-classification` metadata so mode-less records are not mislabelled Autopilot. PR classify-diff trigger/poll routes are origin-scoped (`/api/origins/:originId/classify-diff`) and need a concrete workspace for enqueue/provider context; repo-scoped classify-diff serves commit and branch-range classifications. Team auto-classification reuses the same enqueue path as low-priority background work (see [spa/git-and-prs.md](spa/git-and-prs.md)).

### Shared turn pipeline

First turns (`ChatBaseExecutor.execute`) and continuations (`FollowUpExecutor.executeFollowUp`) share one pipeline. `buildChatTurnSystemMessage` fixes block order (mode → global prompt → For Each/Map Reduce → repo instructions → chat style → source-location → memory → tool guidance → auto-folder → note file); callers only pass `undefined` to skip a block.

`resolveChatTurnPolicy` owns model resolution (explicit → per-repo default for the turn's slot → provider default), reasoning-effort precedence (per-turn → provider-scoped persisted → Copilot-only global → SDK default), and the Copilot-only long-context tier derived from tiered billing metadata. On an unsupported effort a first turn fails while a follow-up drops only the per-turn override and continues; persisted/default effort validation stays strict. Follow-ups resolve provider/session/default model before applying per-turn effort.

`chat-turn-settlement.ts` owns cumulative token roll-up (counters accumulate, session gauges take the latest reading, cost/duration stay undefined until reported), the turn-end `token-usage` event, and note-edit snapshots.

`BaseExecutor` holds process-local execution state in `ProcessSessionRegistry` plus the shared streaming-chunk handler and `capturePartialTurn()`, which both chat paths use to persist an interrupted assistant turn. The registry separates streaming buffers/throttle/finalization, serialized turn writes, pending follow-up suggestions, live ask-user handles, and cross-turn Ralph grill state; `cleanupSession()` clears all but the Ralph grill state. Follow-up cleanup also clears persisted `pendingAskUser` records.

`createQueueExecutorBridge()` builds the `QueueExecutor` with `autoStart: false`, wires both queue manager and queue executor references, then calls `executor.start()` only if the caller asked for auto-start. Queue-control methods needing a fully wired runtime fail fast when the bridge has a queue manager but no queue executor reference.

## Configuration

Configuration file: `~/.coc/config.yaml` (fallback `~/.coc.yaml`). Precedence: CLI flags > config file > defaults. Admin-editable settings, the `features.*` flag table, `dreams.*`, `pullRequests.*`, `forEach`/`mapReduce`, and the `agentProviderRouting.auto` profile are documented in [admin-config.md](admin-config.md).

```yaml
model: gpt-4
parallel: 5
output: table
approvePermissions: false
mcpConfig: ~/.copilot/mcp-config.json  # global MCP; repo .vscode/mcp.json is also loaded per workspace
timeout: 1800
defaultProvider: copilot  # concrete default when payload.provider is omitted and Auto is not requested

serve:
  port: 4000
  host: localhost
  dataDir: ~/.coc
  theme: auto

monitoring:
  heap:
    enabled: true
    interval: 60000
    threshold: 0.85

store:
  backend: sqlite    # or 'file'

terminal:
  enabled: true

workflows:
  enabled: true

triggers:
  enabled: true

codex:
  enabled: false

claude:
  enabled: false
```

Exit codes: 0=success, 1=error, 2=config, 3=AI unavailable, 130=SIGINT.

## Server Startup

1. The model metadata store warms before listening so executors can resolve reasoning effort; chat/follow-up executors initialize it on demand if a task starts first.
2. Auto-migrations run: workspace registry JSON → SQLite, file-based process history → SQLite, and physical `ws-*` workspace IDs → raw-hostname-scoped `ws-v2-*` IDs, moving repo data directories when conflict-free.
3. Variant models with a `capabilities.family` base keep the variant in process metadata but reach the SDK as base model + reasoning effort.
4. The Copilot long-context tier resolves at the provider boundary: executors pass `contextTier: "long_context"` only when the resolved Copilot model's catalog metadata advertises `billing.tokenPrices.longContext.contextMax` (`getCopilotContextTierForModel`), never for Codex/Claude. Static fallback models carry no such metadata, so a failed catalog fetch disables long context for that run.
5. Provider selection: `defaultProvider` is the concrete fallback while Auto routing is off; with `features.autoAgentProviderRouting` true, omitted-provider paths route through `agentProviderRouting.auto`. `payload.provider` overrides both, explicit Auto requests carry `context.autoProviderRouting.requested`, and follow-ups reuse the provider on the original process.
6. Effort-tier expansion is provider-specific, so an Auto chat task defers it. `resolveEffortTierConfig` (enqueue) records the launched tier on `config.afterEffortTier` but seeds no `config.model`/`config.reasoningEffort` when Auto is requested with no concrete provider; `applyEffortTierForProvider` (`process-lifecycle-runner`) resolves the tier once `resolveExecutionProvider` picks one, before `resolveModelForProvider` validates it. Explicit-provider tasks (dream-runs resolve Auto eagerly at enqueue) and caller-supplied `config.model` are seeded at enqueue. Admin tier config reaches the executor via `LifecycleRunnerOptions.getEffortTiersForProvider`, wired by `bridge.setEffortTiersForProvider`; without it the hardcoded defaults apply.

## Storage Layout

**Global (`~/.coc/`):** `config.yaml` (server configuration), `processes.db` (SQLite process store, schema v8), `preferences.json` (global UI preferences), `memory/system/MEMORY.md` (system-level bounded memory), `skills/` (global skill definitions).

**Per-repo (`~/.coc/repos/<workspaceId>/`) and per-origin (`~/.coc/repos/<originId>/`):**
- `queues.json`, `schedules/<scheduleId>.yaml` (`schedules.json` is a migration source), `git-ops.json`, `preferences.json`
- Under canonical origin directories, shared by same-origin clones: `recent-opened-pull-requests/index.json`, `pr-coworker-roster/index.json` (Team roster), `review-progress/<prId>.json`, `classifications/<prId>_<headSha>.json(.pending)` (focused-diff classification result/pending state), `pr-review-history.json`, `pr-suggestions-cache.json` (AI-ranked suggestions), and `work-items/` (Work Item JSON, index, counter, plan versions). Workspace/repo-scoped equivalents migrate into the origin directory on first access.
- `tasks/` — task and plan files
- `outputs/` — AI conversation output markdown
- `memory/MEMORY.md` — per-repo bounded memory
- `dreams/cards.json`, `dreams/runs.json` — reviewable cards, hidden candidate/terminal history, completed-run source coverage, analyzer/critic process links
- `ralph-sessions/<sessionId>/` — `session.json` metadata and `progress.md` journal
- `for-each-runs/<runId>/` — `run.json` metadata and `items.json` reviewed item plan/state
- `map-reduce-runs/<runId>/` — `run.json` metadata, `items.json` map item plan/state, `reduce-step.json`
- `paste-context/` — temp files for large pasted content

Use `getRepoDataPath(dataDir, workspaceId, filename)` for all per-repo path construction.

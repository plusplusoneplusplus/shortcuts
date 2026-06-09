# REST API

CoC server exposes HTTP endpoints organized by domain. All routes are registered via `registerAllRoutes()` in `src/server/routes/index.ts`.

## Global Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/config` | Server configuration |
| GET | `/api/config/runtime` | Runtime dashboard feature flags and config revision, including provider feature flags, `defaultProvider`, `autoAgentProviderRoutingEnabled`, Pull Requests flags such as `pullRequestsAutoClassifyTeamEnabled`, and Work Items flags such as `workItemsWorkflowEnabled` |
| GET | `/api/preferences` | Global UI preferences |
| PUT | `/api/preferences` | Update global preferences |
| GET | `/api/logs` | Server log ring buffer |
| GET | `/api/stats` | Token usage + cost stats |
| GET | `/api/agent-providers` | Copilot/Codex/Claude enabled + SDK availability status. Codex auth is handled by the Codex SDK/CLI, not CoC routes |
| GET | `/api/agent-providers/quota` | Cached provider quota snapshots where supported; `?force=1` refreshes live provider data and updates the cache |

## Agent Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-providers/:provider/models` | Provider model catalog |
| GET | `/api/agent-providers/:provider/models/enabled` | Enabled models for provider |
| PUT | `/api/agent-providers/:provider/models/enabled` | Set enabled models for provider |
| GET | `/api/agent-providers/:provider/models/reasoning-efforts` | Reasoning effort overrides |
| PUT | `/api/agent-providers/:provider/models/reasoning-efforts` | Set reasoning effort for model |
| POST | `/api/agent-providers/:provider/models/query` | Test prompt against provider model |

## Workspace Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces` | List registered workspaces |
| POST | `/api/workspaces` | Register a workspace |
| GET | `/api/workspaces/active` | Inspect dashboard clients' recent active workspace reports; response includes `activeWorkspaceIds` and per-client `lastSeenAt` records |
| POST | `/api/workspaces/active` | Report a dashboard client's currently selected workspace. Body `{ clientId, workspaceId }`, where `workspaceId: null` clears that client |
| DELETE | `/api/workspaces/:id` | Unregister workspace |
| GET | `/api/workspaces/:id/preferences` | Per-repo preferences |
| PATCH | `/api/workspaces/:id/preferences` | Update per-repo preferences |
| GET | `/api/workspaces/:id/instructions` | List custom instruction files for active modes: base, Ask, and Autopilot |
| GET/PUT/DELETE | `/api/workspaces/:id/instructions/:mode` | Read, update, or delete one custom instruction file. Active modes are `base`, `ask`, and `autopilot`; legacy `plan` route inputs are accepted as an Ask alias. |
| GET/PUT | `/api/workspaces/:id/llm-tools-config` | List/update per-workspace disabled LLM tools. Response includes `conversationRetrievalAvailable`, derived from the active process store's conversation search support. Removed tool names such as `create_bug` are filtered from responses and from rewritten preferences. |
| GET | `/api/workspaces/:id/summary` | Aggregated workspace summary |
| GET | `/api/workspaces/:id/endev/status` | Cached EnDev xDPU eligibility status; `?refresh=true` revalidates |
| POST | `/api/workspaces/:id/endev/revalidate` | Force EnDev xDPU eligibility revalidation |

## Filesystem

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fs/browse` | Browse local directories for repo path selection |
| GET | `/api/fs/browse-helper` | Same-origin helper page for container-mode directory browsing |
| GET | `/api/fs/blob?path=<absolute>` | Read a single file when the absolute path is under CoC trusted data directories (`~/.copilot`, the server data dir, or the OS temp dir) or inside any registered workspace/repo root; rejects arbitrary filesystem paths |

## Git

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/git/clone` | Clone an arbitrary git URL into a parent directory using the server process's git credentials; returns `clonedPath` on success and `{ error }` on clone failure |
| POST | `/api/workspaces/:id/git/cherry-pick` | Cherry-pick commit(s) in a workspace. Body accepts `{ hash }` for the existing single-commit current-HEAD behavior, or `{ hash, hashes, targetBranch }` to apply multiple commits in caller-provided order onto a local target branch; cross-branch picks require a clean working tree and return `409 { dirty: true }` when blocked |
| POST | `/api/workspaces/:id/git/patch/export` | Export one commit from a registered workspace as a format-patch payload for cross-clone cherry-pick flows. Body `{ hash }`; response includes source workspace metadata, source commit metadata, normalized source remote URL, and `{ format: 'format-patch', body }` without source root paths or raw remote credentials |
| POST | `/api/workspaces/:id/git/patch/apply` | Apply a format-patch payload to the target workspace with `git am --3way`. Body `{ patch: { format: 'format-patch', body }, stashAndContinue?, sourceServer?, sourceWorkspace?, sourceCommit?, normalizedSourceRemoteUrl? }`; dirty targets return `409 { dirty: true }` unless `stashAndContinue` is explicitly true, conflicts return `409 { conflicts: true }`, and clean applies return the target branch, new target HEAD/commit hash, and a target-scoped `cherry-pick-transfer` git-op record with sanitized source/target metadata |

## Processes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes` | List processes (with search/filter) |
| GET | `/api/processes/:id` | Process detail |
| DELETE | `/api/processes/:id` | Delete process |
| POST | `/api/processes/:id/message` | Follow-up message. Body accepts `content`, optional `mode` (`ask` or `autopilot`; legacy `plan` is accepted as Ask), `deliveryMode`, `images`, `skillNames`, `model`, and `reasoningEffort` (`'low'\|'medium'\|'high'\|'xhigh'`) for a per-turn override. |
| POST | `/api/processes/:id/ask-user-response` | Resolve the active ask-user batch. Body `{ batchId, answers }`; each answer has `questionId` plus either `answer`, `skipped: true`, or `deferred: true` with `reason: "needs-context"` and optional `note`. |
| POST | `/api/processes/:id/cancel` | Cancel running process |
| POST | `/api/processes/:id/promote-to-ralph` | Promote completed ask-mode chat to Ralph session (see [ralph.md](ralph.md)) |
| PATCH | `/api/processes/:id/pin` | Pin/unpin process |
| PATCH | `/api/processes/:id/archive` | Archive/unarchive |
| GET | `/api/processes/:id/turns/pinned` | Get pinned turns |
| DELETE | `/api/processes/:id/turns/:idx` | Soft-delete turn |
| PATCH | `/api/processes/:id/turns/:idx/restore` | Restore deleted turn |
| PATCH | `/api/processes/:id/turns/:idx/pin` | Pin a turn |
| PATCH | `/api/processes/:id/turns/:idx/archive` | Archive a turn |
| GET | `/api/workspaces/:id/group-pins` | List workspace-scoped parent-row group pins for Ralph session groups, For Each run groups, and Map Reduce run groups, sorted newest pin first |
| PATCH | `/api/workspaces/:id/group-pins/:type/:groupId` | Pin/unpin a parent group row. `type` is `ralph-session`, `for-each-run`, or `map-reduce-run`; body `{ pinned: boolean }`. This updates only the group pin record and does not mutate child process pin/archive metadata |

## Queue

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queue` | List queue tasks |
| GET | `/api/queue/models` | List model IDs for the resolved concrete default provider; when `features.autoAgentProviderRouting` is enabled, this uses the same Auto provider routing resolver as enqueue and includes `autoProviderRouting` metadata with the selected provider, fallback state, warnings, and decision reasons. |
| GET | `/api/queue/:id` | Get a single queue task, falling back to reconstructed process history for completed/historical chat tasks when available |
| POST | `/api/queue` | Enqueue a task. Chat payloads use `mode='ask'`, `mode='autopilot'`, or internal Ralph routing; legacy `mode='plan'` is accepted and normalized to Ask. For Each item-plan generation is represented as a normal Ask-mode chat with `payload.context.forEach.kind='generation'`; the UI-only `for-each` mode value is still rejected by the generic queue validator. Body `config.effortTier` accepts `very-low`, `low`, `medium`, or `high`; the server resolves Auto defaults to a concrete provider before expanding the tier to `config.model` and `config.reasoningEffort` from that provider's stored/default tier map, while explicit `config.model` and `config.reasoningEffort` take precedence and `effortTier` is not stored. |
| POST | `/api/workspaces/:id/queue/generate` | Enqueue a Generate Plan chat task using Ask semantics. Body accepts optional `provider`, `model`, and `reasoningEffort` overrides, which are validated through the shared chat queue validation path. |
| POST | `/api/queue/:id/retry` | Re-run a failed or cancelled task by enqueueing a fresh copy from its preserved payload/config (recovery for when a chat's first message failed before any resumable session existed). Accepts a bare task id or `queue_<taskId>` process id; strips `processId`/temp-attachment fields so the retry starts a new conversation. Returns `201 { task }`; `404` if not found, `409` if the task is not in a failed/cancelled state. |
| DELETE | `/api/queue/:id` | Cancel a queued or running task |
| PATCH | `/api/queue/pause` | Pause/resume queue |

## Ralph Sessions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/processes/:id/ralph-start` | Start Ralph execution after grilling. Body accepts optional `provider`, `config.model`, `config.reasoningEffort`, `config.effortTier`, and `autoProviderRouting` overrides for the first execution task; omitted provider resolves through Auto when `features.autoAgentProviderRouting` is enabled. |
| POST | `/api/ralph-launch` | Direct Ralph launch (skip grilling). Body accepts optional `folderPath` as goal source context and optional `workingDirectory` as an explicit execution directory; omitted `workingDirectory` is resolved from `workspaceId` by the multi-repo queue router. Also accepts optional `provider`, `config.model`, `config.reasoningEffort`, `config.effortTier`, and `autoProviderRouting` overrides for the first execution task; omitted provider resolves through Auto when `features.autoAgentProviderRouting` is enabled. |
| GET | `/api/workspaces/:wsId/ralph-sessions/:sessionId` | Read session journal (`record`, parsed progress `sections`, alphabetically ordered raw session `files`, and optional transient `resumeDefaults` recovered from the latest iteration process for stuck-session Resume UI) |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/continue` | Extend completed session (CAP_REACHED or NO_SIGNAL) by N iterations, preserving the prior concrete provider/model when recoverable and accepting optional `provider`, `config.model`, `config.reasoningEffort`, `config.effortTier`, and `autoProviderRouting` overrides for the continued iteration; an explicit `config.effortTier` suppresses recovered model/reasoning-effort unless those fields are also explicit |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/new-loop` | New goal loop after RALPH_COMPLETE, preserving the prior concrete provider/model when recoverable |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/resume` | Resume stuck executing session (no in-flight task), preserving prior provider/model/reasoning-effort when recoverable and accepting optional `provider`, `config.model`, `config.reasoningEffort`, `config.effortTier`, and `autoProviderRouting` overrides for the resumed iteration; an explicit `config.effortTier` suppresses recovered model/reasoning-effort unless those fields are also explicit |

## For Each Runs

All For Each routes are workspace-scoped and gated by `forEach.enabled` (default `false`); disabled routes return unavailable/not-found behavior. Parent run state is stored under `~/.coc/repos/<workspaceId>/for-each-runs/<runId>/` as `run.json` plus `items.json`, never as a Ralph session. `@plusplusoneplusplus/coc-client` exposes these routes through `client.forEach`, and the dashboard uses that domain for reviewed parent-run persistence, approval, and For Each detail pane actions. Visible item-plan generation chats are normal queue/process records whose metadata links to the eventual parent run; reviewed chat-backed plans use the non-AI create endpoint so approval persists exactly what the user reviewed. Omitted For Each providers resolve through Auto when `features.autoAgentProviderRouting` is enabled, and the resolved concrete provider is stored on the run for child orchestration.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/for-each-runs` | List For Each runs for a workspace with item status counts |
| POST | `/api/workspaces/:id/for-each-runs` | Create a draft For Each run from an already-reviewed item plan without invoking AI generation. Body requires `originalRequest`, `childMode`, and `items`, and accepts `sharedInstructions`, `provider`, `config.model` / `config.reasoningEffort`, `generationProcessId`, and `generationId` |
| POST | `/api/workspaces/:id/for-each-runs/generate` | Generate a structured JSON draft item plan and persist a draft run. Body requires `prompt` and `childMode` (`ask` or `autopilot`) and accepts `sharedInstructions`, `provider`, and `config.model` / `config.reasoningEffort` |
| GET | `/api/workspaces/:id/for-each-runs/:runId` | Read a For Each run with reviewed item plan/state |
| PUT | `/api/workspaces/:id/for-each-runs/:runId/plan` | Replace the reviewed draft item plan and optional shared instructions / child mode before approval |
| POST | `/api/workspaces/:id/for-each-runs/:runId/approve` | Mark a reviewed draft plan approved. Approval does not enqueue child chats; child execution routes are separate from the draft/review API |
| POST | `/api/workspaces/:id/for-each-runs/:runId/start` | Start an approved run by enqueueing the next runnable item as a normal Ask/Autopilot child chat |
| POST | `/api/workspaces/:id/for-each-runs/:runId/continue` | Explicitly resume/continue pending work without auto-resuming on server startup |
| POST | `/api/workspaces/:id/for-each-runs/:runId/items/:itemId/retry` | Retry a failed item as a new child chat and overwrite that item's active child task/process link |
| POST | `/api/workspaces/:id/for-each-runs/:runId/items/:itemId/skip` | Mark a failed or pending item skipped and continue with the next runnable item |
| POST | `/api/workspaces/:id/for-each-runs/:runId/cancel` | Cancel remaining work, mark pending/running items skipped, and cancel the active child task when available |

## Map Reduce Runs

All Map Reduce routes are workspace-scoped and gated by `mapReduce.enabled` (default `false`); disabled routes return unavailable/not-found behavior. Parent run state is stored under `~/.coc/repos/<workspaceId>/map-reduce-runs/<runId>/` as `run.json`, `items.json`, and `reduce-step.json`. Map items run as normal Ask/Autopilot child chats in parallel up to `maxParallel`, and the reduce step runs as a single child chat after all map items are completed or skipped. Omitted providers resolve through Auto when `features.autoAgentProviderRouting` is enabled, and the resolved concrete provider is stored on the run for map and reduce child orchestration. `@plusplusoneplusplus/coc-client` exposes these routes through `client.mapReduce`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/map-reduce-runs` | List Map Reduce runs for a workspace with map item status counts and reduce status |
| POST | `/api/workspaces/:id/map-reduce-runs` | Create a draft Map Reduce run from an already-reviewed map plan without invoking AI generation. Body requires `originalRequest`, `childMode`, `reduceInstructions`, and `items`, and accepts `sharedInstructions`, `maxParallel`, `provider`, `config.model` / `config.reasoningEffort`, `generationProcessId`, and `generationId` |
| POST | `/api/workspaces/:id/map-reduce-runs/generate` | Generate a structured JSON map plan plus reduce instructions and persist a draft run. Body requires `prompt` and `childMode` (`ask` or `autopilot`) and accepts `sharedInstructions`, `provider`, and `config.model` / `config.reasoningEffort` |
| GET | `/api/workspaces/:id/map-reduce-runs/:runId` | Read a Map Reduce run with reviewed map plan/state and reduce-step state |
| PUT | `/api/workspaces/:id/map-reduce-runs/:runId/plan` | Replace the reviewed draft map plan and optional shared instructions, reduce instructions, `maxParallel`, or child mode before approval |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/approve` | Mark a reviewed draft plan approved. Approval does not enqueue child chats; child execution routes are separate from the draft/review API |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/start` | Start an approved run by enqueueing up to `maxParallel` runnable map items as normal Ask/Autopilot child chats |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/continue` | Explicitly resume/continue pending map work or the pending reduce step without auto-resuming on server startup |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/items/:itemId/retry` | Retry a failed map item as a new child chat and overwrite that item's active child task/process link |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/items/:itemId/skip` | Mark a failed or pending map item skipped and continue with the next runnable map item or reduce step |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/reduce/retry` | Retry a failed reduce step as a new child chat |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/cancel` | Cancel remaining work, mark pending/running map items skipped, cancel a pending/running/failed reduce step, and cancel active child tasks when available |

## Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/schedules` | List schedules |
| POST | `/api/schedules` | Create schedule |
| PUT | `/api/schedules/:id` | Update schedule |
| DELETE | `/api/schedules/:id` | Delete schedule |
| POST | `/api/schedules/:id/run` | Trigger immediate run |
| GET | `/api/schedules/:id/runs` | Run history |

Prompt schedules expose Ask and Autopilot modes. Stored or incoming schedule entries with `mode='plan'` are read as Ask at runtime; no schedule data migration is required.

## Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/tasks` | List tasks |
| POST | `/api/workspaces/:id/tasks` | Create task file |
| GET | `/api/workspaces/:id/tasks/:path` | Read task content |
| PUT | `/api/workspaces/:id/tasks/:path` | Update task |
| DELETE | `/api/workspaces/:id/tasks/:path` | Delete task |
| GET | `/api/workspaces/:id/tasks/:path/comments` | Task comments |
| POST | `/api/workspaces/:id/tasks/:path/comments` | Add comment |

## Notes

All read/write/comment/search/image endpoints accept an optional `root` query or body param to scope operations to a specific notes root. Omit `root` for the default managed root.
Page create and rename operations normalize page filenames by appending `.md` when the requested page path has no `.md` suffix; mutation responses return the effective path.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/notes` | Note tree (`?root=` optional) |
| POST | `/api/workspaces/:id/notes` | Create note (body `root` optional) |
| GET | `/api/workspaces/:id/notes/:path` | Read note (`?root=` optional) |
| PUT | `/api/workspaces/:id/notes/:path` | Update note (body `root` optional) |
| DELETE | `/api/workspaces/:id/notes/:path` | Delete note (`?root=` optional) |
| GET | `/api/workspaces/:id/notes-git/status` | Git status (default root only) |
| POST | `/api/workspaces/:id/notes-git/commit` | Git commit (default root only) |
| GET | `/api/workspaces/:id/notes/roots` | List configured roots |
| POST | `/api/workspaces/:id/notes/roots` | Add a repo-folder root |
| DELETE | `/api/workspaces/:id/notes/roots` | Remove a repo-folder root |

### Multi-Root Notes

Users can add up to **10** additional notes roots per workspace — subfolders inside the workspace git repo. The default managed root (`~/.coc/repos/<workspaceId>/notes/`) is always present.

- **Root resolution:** default root via `getRepoDataPath(dataDir, workspaceId, 'notes')`; repo-folder roots via `<workspace-git-root>/<relative-path>`.
- **Git ops** apply only to the default root; repo-folder roots inherit the workspace repo's git.
- **Comment sidecar** for repo-folder roots is stored at `~/.coc/repos/<workspaceId>/notes-comments/<encoded-root-path>/`.
- **Images** for repo-folder roots are co-located in `<root>/.images/`; default root uses `.attachments/`.
- **System folders** (e.g., Plans) are auto-created only in the default root.
- Configured roots are persisted in `PerRepoPreferences.additionalNotesRoots`.

## Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/workflows` | List workflows |
| POST | `/api/workspaces/:id/workflows` | Create workflow |
| GET | `/api/workspaces/:id/workflows/:name` | Read workflow |
| PUT | `/api/workspaces/:id/workflows/:name` | Update workflow |
| DELETE | `/api/workspaces/:id/workflows/:name` | Delete workflow |

## Skills

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/skills` | List skills |
| POST | `/api/workspaces/:id/skills/install` | Install skill |
| GET | `/api/workspaces/:id/skills/:name/file?path=<rel>` | Read a file inside a skill folder |
| DELETE | `/api/workspaces/:id/skills/:name` | Delete skill |
| GET | `/api/skills` | Global skills |
| POST | `/api/skills/install` | Install global skill |

## Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/memory/config` | Memory configuration |
| PUT | `/api/memory/config` | Update config |
| GET | `/api/memory/bounded/:level` | Read bounded memory |
| PUT | `/api/memory/bounded/:level` | Write bounded memory |
| DELETE | `/api/repos/:repoId/memory` | Wipe repo memory |
| GET | `/api/repos/:repoId/memory/entries` | List memory entries |
| GET | `/api/workspaces/:id/memory/v2/facts` | List/search Memory V2 facts (`q`, repeated `status`, `limit`) |
| POST | `/api/workspaces/:id/memory/v2/facts` | Create an explicit Memory V2 fact |
| PATCH | `/api/workspaces/:id/memory/v2/facts/:factId` | Update fact content, importance, tags, or status |
| DELETE | `/api/workspaces/:id/memory/v2/facts/:factId` | Delete a Memory V2 fact |
| GET | `/api/workspaces/:id/memory/v2/review` | List facts pending review |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/approve` | Approve a review fact; body may include edited `content` |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/reject` | Reject a review fact |
| GET | `/api/workspaces/:id/memory/v2/episodes` | List Memory V2 episodes (`limit`) |
| GET | `/api/workspaces/:id/memory/v2/export` | Export active-scope Memory V2 facts and episodes |
| DELETE | `/api/workspaces/:id/memory/v2/wipe` | Wipe active-scope Memory V2 facts and episodes; body requires `{ "confirm": true }` |

## Pull Requests

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos/:repoId/pull-requests` | List pull requests; accepts optional `workspaceId` for workspace-scoped Team roster behavior, rows are enriched with `diffStats` (`additions`, `deletions`, `changedFiles`) when the provider exposes PR diffs, include `fetchedAt`, and can be served from the active-workspace background-warmed server cache unless `force=true` is supplied. When Pull Requests, focused diff, and `pullRequests.autoClassifyTeam` are enabled, loaded open Team PRs with `headSha` opportunistically enqueue missing low-priority diff classifications using the existing classify-diff pipeline. |
| GET | `/api/repos/:repoId/pull-requests/:prId` | Fetch and cache PR detail, including provider SHA fields (`baseSha`, `headSha`) when available |
| GET | `/api/repos/:repoId/pull-requests/:prId/diff` | Fetch and cache the provider unified diff for a PR |
| GET | `/api/repos/:repoId/pull-requests/:prId/diff/files/:path` | Return the hunk diff for one PR file; with `fullContext=true`, the server uses cached or freshly fetched PR detail and attempts to fetch missing PR commits into the requested repo checkout before falling back to the hunk diff with `fullContextUnavailable: true` |
| GET | `/api/repos/:repoId/pull-requests/recent-opened` | List recently opened PR entries for a workspace/repo (`workspaceId` query, defaults to `repoId`) |
| POST | `/api/repos/:repoId/pull-requests/recent-opened` | Record a recently opened PR entry after successful validation/open; body includes `workspaceId`, `number`, `title`, optional `webUrl` |
| DELETE | `/api/repos/:repoId/pull-requests/recent-opened/:prNumber` | Remove a stale recently opened PR entry for a workspace/repo (`workspaceId` query, defaults to `repoId`) |
| GET | `/api/repos/:repoId/pull-requests/coworker-roster` | List persisted Team roster coworkers for a workspace/repo (`workspaceId` query, defaults to `repoId`) |
| POST | `/api/repos/:repoId/pull-requests/coworker-roster` | Add or update a Team roster coworker for a workspace/repo; body includes `workspaceId`, `displayName`, optional `id`, `email`, `avatarUrl` |
| DELETE | `/api/repos/:repoId/pull-requests/coworker-roster/:coworkerKey` | Remove a Team roster coworker by provider id or displayName fallback key (`workspaceId` query, defaults to `repoId`) |
| POST | `/api/repos/:repoId/pull-requests/team-auto-classification` | Manually trigger the same bounded Team PR auto-classification helper used by PR list/background warm paths. Requires the live Team auto-classification gate; body includes `workspaceId` and loaded PR list items. Returns counts for eligible/considered/skipped/ready/running/started/notFound/errors, uses low priority, and caps each call at 10 new enqueues. |
| GET | `/api/repos/:repoId/pull-requests/review-history` | Read cached PR review history |
| POST | `/api/repos/:repoId/pull-requests/review-history/refresh` | Fetch and cache PR review history |
| GET | `/api/repos/:repoId/pull-requests/suggestions` | Read cached AI-ranked PR suggestions |
| POST | `/api/repos/:repoId/pull-requests/suggestions/refresh` | Rank open PRs using cached review history |

## Diff Classification

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/repos/:repoId/classify-diff` | Trigger AI hunk classification. Body: `{ type: 'pr'\|'commit'\|'branch-range', identifier, workspaceId?, model?, provider? }`. Returns `{ status: 'started'\|'ready'\|'running', … }`. |
| GET | `/api/repos/:repoId/classify-diff` | Poll for a single classification result. Query: `type`, `identifier`, `workspaceId?`. Returns `{ status: 'none'\|'ready'\|'running', result? }`. |
| GET | `/api/repos/:repoId/classify-diff/batch-status` | Batch-check whether multiple identifiers have a stored result. Query: `type`, `identifiers` (comma-separated, max 200), `workspaceId?`. Returns `{ statuses: { [identifier]: 'none'\|'ready'\|'running' } }`. Read-only — never triggers a new classification task. |

## Loops

See [loops.md](loops.md) for the full subsystem. Gated by `loops.enabled` (default `false`).

### Workspace-scoped

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/loops` | List loops for workspace |
| GET | `/api/workspaces/:id/loops/:loopId` | Get single loop |
| PATCH | `/api/workspaces/:id/loops/:loopId` | Update loop fields (description, prompt, intervalMs, model) |
| DELETE | `/api/workspaces/:id/loops/:loopId` | Cancel & soft-delete loop |
| POST | `/api/workspaces/:id/loops/:loopId/pause` | Pause loop (body: `{ reason? }`) |
| POST | `/api/workspaces/:id/loops/:loopId/resume` | Resume paused loop |

### Server-wide

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loops` | List all loops server-wide |
| GET | `/api/loops/:loopId` | Get a loop by ID |

## MCP Settings

See [mcp-settings.md](mcp-settings.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/mcp-config` | Effective + source-separated MCP servers. `?forceReload=true` bypasses cache |
| PUT | `/api/workspaces/:id/mcp-config` | Store name-based `enabledMcpServers` allow-list |

## Work Items

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/work-items` | List work items. Supports standard field filters plus `tracker=local-only\|github-backed\|azure-boards-backed`, which filters by inherited Epic-rooted tracker identity. Matching active-workspace warmed responses can be served from the server cache unless `force=true` is supplied. |
| GET | `/api/workspaces/:id/work-items/grouped` | List work items grouped by status with per-group pagination. The default active-workspace response is proactively warmed and can be bypassed with `force=true`. |
| POST | `/api/workspaces/:id/work-items` | Create work item. Root Epic payloads may include `tracker` metadata; absent tracker metadata is treated as `local-only`. Creating a child under a GitHub-backed Epic tree creates the GitHub issue first, encodes the parent via hidden body metadata, then stores `githubMirror` metadata on the local item. Creating a child under an Azure Boards-backed Epic tree creates the Azure work item and native parent relation first, then stores `azureBoardsMirror` metadata locally. Legacy `syncLinks` payloads are rejected. |
| GET | `/api/workspaces/:id/work-items/:itemId` | Read work item |
| PATCH | `/api/workspaces/:id/work-items/:itemId` | Update work item. `tracker` metadata is accepted only on root Epic items. Core field edits on GitHub- and Azure Boards-backed mirror items push provider-owned fields before local storage; stale provider snapshots return a typed sync conflict unless the request includes a matching reviewed `syncConflictResolution`. Legacy `syncLinks` payloads are rejected. |
| DELETE | `/api/workspaces/:id/work-items/:itemId` | Delete work item |
| GET | `/api/workspaces/:id/work-items/:itemId/plan/versions/compare?base=N&target=M` | Compare two immutable plan/content versions for a local-only `work-item` or `goal`. Requires `workItems.workflow.enabled`. |
| POST | `/api/workspaces/:id/work-items/:itemId/plan/versions/:version/restore` | Restore an older plan/content version for a local-only `work-item` or `goal` by creating a new current version. Requires `workItems.workflow.enabled`; body accepts optional `summary` and `reason`. |
| POST | `/api/workspaces/:id/work-items/:itemId/execute` | Enqueue a work-item implementation run. Body accepts optional `executionMode` (`one-shot` or `ralph`), `skillNames`, `provider`, `model`, `reasoningEffort`, `effortTier`, and `autoProviderRouting`. One-shot uses the existing single queued implementation task and remains the default for Work Items. When `workItems.workflow.enabled` is true, local-only Goals default to Ralph execution; Ralph mode is accepted only for local-only `work-item` and `goal` items and returns `ralphSessionId` alongside `taskId`. |
| POST | `/api/workspaces/:id/work-items/:itemId/submit-pr` | Explicitly submit the latest eligible Review-state local-only `work-item`/`goal` change with commits as a pull request. Requires `workItems.workflow.enabled`, a clean workspace, a registered workspace root, `gh` authentication, and no existing PR metadata on the target change. Body accepts optional `changeId`, `title`, `body`, `baseBranch`, and `branchName`; success records branch/PR metadata on the change, links the PR URL on the execution, and marks the item Done. |
| POST | `/api/workspaces/:id/work-items/:itemId/convert-to-github` | Convert a local-only root Epic tree to GitHub-backed tracking by creating GitHub issues for the root and each descendant in the workspace-configured repo, encoding parent links in hidden body metadata, and storing mirror metadata locally. |
| POST | `/api/workspaces/:id/work-items/:itemId/convert-to-local` | Detach a GitHub-backed root Epic tree into local-only tracking by removing GitHub mirror metadata from the root and descendants while preserving local lifecycle status, plans, execution history, runs, and commits. |
| GET | `/api/workspaces/:id/work-items/tree` | Read the hierarchy tree. Supports `tracker=local-only\|github-backed\|azure-boards-backed`; descendants inherit the tracker identity of their root Epic. Active-workspace Local and detected Remote tree responses can be served from the warmed server cache unless `force=true` is supplied. |
| POST | `/api/workspaces/:id/work-items/import-from-github` | Import an existing GitHub Epic issue from the workspace-configured repository. Body accepts either `issueNumber` or `issueUrl`; URL owner/repo must match the workspace-configured repo. The server pulls the root issue plus descendants discovered from hidden `coc-work-item-sync` parent metadata into a local read mirror and returns the root Epic work item. |
| POST | `/api/workspaces/:id/work-items/import-from-azure-boards` | Import an existing Azure Boards Epic-rooted work item tree from the workspace-configured Azure Boards project. Body accepts either `workItemId` or `workItemUrl`; URL organization/project must match workspace configuration. The server pulls descendants through native Azure Boards hierarchy relations and returns the root Epic work item. |
| GET | `/api/workspaces/:id/work-items/sync/status` | Work-item sync provider status for GitHub and Azure Boards. Returns disabled reasons unless both `workItems.hierarchy.enabled` and `workItems.sync.enabled` are true. Without a `provider` query it derives `remoteProvider` from the workspace repo remote URL and reports only that provider; missing or unsupported remotes return no provider statuses. Provider credentials remain external and sanitized. Enabled status responses can be served from the warmed server cache unless `force=true` is supplied. |

### Work Item chat bindings

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/workspaces/:id/work-item-chat-bindings` | List remembered Work Item → chat task bindings for a workspace |
| GET | `/api/workspaces/:id/work-item-chat-bindings/:workItemId` | Read one binding; returns 404 when none exists |
| POST | `/api/workspaces/:id/work-item-chat-bindings` | Create or replace a binding. Body: `{ workItemId, taskId }` |
| DELETE | `/api/workspaces/:id/work-item-chat-bindings/:workItemId` | Remove a binding. Missing bindings are treated as a no-op |

Work items use Epic-rooted tracker identity. A root Epic may carry `tracker: { kind: 'local-only' }`, `tracker: { kind: 'github-backed', provider: 'github', github: { issueId?, issueNumber?, issueUrl?, lastPulledAt? } }`, or `tracker: { kind: 'azure-boards-backed', provider: 'azure-boards', azureBoards: { workItemId?, workItemUrl?, revision?, updatedAt?, lastPulledAt? } }`; descendants inherit the root identity for listing and tree filtering. Tracker metadata is not valid on non-root items. GitHub-backed mirror items carry `githubMirror: { issueId?, issueNumber, issueUrl?, state?, updatedAt?, lastPulledAt? }` so each local item can be matched to its GitHub issue while sync ownership remains rooted at the Epic. Azure Boards-backed mirror items carry `azureBoardsMirror: { workItemId, workItemUrl?, revision?, workItemType?, state?, updatedAt?, lastPulledAt? }` so each local item can be matched to its Azure Boards work item without storing credentials; the public work-item contract does not expose per-item `syncLinks`. Local-only root Epics can be converted to GitHub-backed trees, which creates one GitHub issue per local item using the workspace-configured repo and hidden body metadata for parent links; GitHub-backed roots can be converted back to local-only by dropping mirror metadata locally without deleting remote issues. GitHub-owned mirror fields are title, description, type, parent, tags, and issue open/closed state; CoC lifecycle status, plans, execution history, runs, and commits remain local. Azure Boards import/sync mirrors title, description, status/state, priority, tags, type, parent relation, revision, URL, and updated metadata from native Azure Boards fields/relations; local edits to mirrored Azure items push the same core editable fields back to Azure and update mirror revision/URL/update metadata from the returned work item. Azure-backed child creation creates the Azure work item with the default type mapping and native parent relation before local persistence. `workItems.sync.enabled` is the disabled-by-default global gate for remote provider integration: when disabled, local work-item saves still persist locally but no GitHub/Azure PATCH transport calls or background provider polling timers run. Provider-backed save requests compare stored mirror metadata with the live provider before pushing and fail with `WORK_ITEM_SYNC_CONFLICT` when the remote item changed; retrying the same PATCH may include `syncConflictResolution: { provider: 'github', acknowledgedRemoteUpdatedAt }` or `{ provider: 'azure-boards', acknowledgedRemoteRevision }` after the user reviews the typed conflict, and the save proceeds only if the live provider snapshot still matches the acknowledgement. No Azure custom fields or hidden HTML metadata are required. Legacy persisted `syncLinks` are migrated on read when they can be rooted at a GitHub-backed Epic: the root link becomes Epic tracker metadata, item links become `githubMirror`, and `syncLinks` are removed from stored detail/index data. GitHub issue mapping owns only `coc:` labels (`coc:type:*`, `coc:status:*`, `coc:priority:*`) and the hidden `<!-- coc-work-item-sync {json} -->` metadata block; non-`coc:` issue labels remain user labels/tags. GitHub-backed and Azure Boards-backed Epic roots are pulled by background pollers when remote provider integration is enabled. Per-workspace preferences under `workItems.sync.github` support `owner`, `repo`, `pollingEnabled` (default `true`), and `pollIntervalMinutes` (default `5`, range `1..1440`); Azure Boards polling preferences live under `workItems.sync.azureBoards` with `project`, `pollingEnabled` (default `true`), and `pollIntervalMinutes` (default `5`, range `1..1440`). Polling scans only workspaces with imported provider-backed Epic roots, stays workspace-scoped, updates local mirrors from provider state, prunes missing mirrored descendants, deletes mirrored root trees when the provider root is gone, and surfaces remote-wins warnings when local unsynced provider-owned edits are overwritten. Azure Boards status uses the global Azure DevOps organization URL from `/api/providers/config` (`providers.ado.orgUrl`) plus the workspace-scoped `workItems.sync.azureBoards.project` preference; it authenticates externally with Azure CLI and does not store Azure Boards PATs or bearer values. Azure Boards field mapping is deterministic without custom fields: Epic/Feature/Bug map natively, PBI prefers Product Backlog Item then User Story, Work Item and Goal map to Task, Goal identity is represented with a CoC-owned Azure tag, common Azure states map to CoC statuses, and unknown Azure states/types/priorities are preserved as local status strings or metadata tags.

The sync route layer retains provider status for GitHub and Azure Boards availability checks while Epic-rooted operations use explicit import, pull, and conversion endpoints. GitHub Issues is registered by default and uses external authentication through `gh`/environment-backed GitHub auth without persisting tokens; its status adapter resolves workspace owner/repo and reports provider availability. Azure Boards is registered by default for status checks, reports missing org URL/project/Azure CLI auth explicitly, and returns only sanitized org/project metadata. Remote provider visibility is workspace-scoped and based on the workspace repo remote URL (`github.com` for GitHub, `dev.azure.com`, `ssh.dev.azure.com`, or `*.visualstudio.com` for Azure Boards); provider configuration does not make unsupported remote hosts visible.

`PATCH /api/workspaces/:id/work-items/:itemId` accepts work-item metadata fields and an optional `plan: { content, resolvedBy?, summary?, reason? }` object in the same request. `plan.content` must contain non-whitespace Markdown. When `plan.content` is present, the server creates the next immutable plan/content version, records source/author metadata (`user` or `ai`), stores the explicit current-version pointer on `plan.currentVersion` and `currentContentVersion`, opens the corresponding change record, broadcasts one `work-item-updated` event, and returns the updated work item. The dedicated `PUT /api/workspaces/:id/work-items/:itemId/plan` endpoint remains available for plan-only workflows and uses the same non-empty content requirement. Execution records and queued task payloads include the selected `planVersion` so runs can be traced back to the exact version that was executed.

Work-Item-bound Goal grilling is queue-driven rather than a dedicated REST endpoint: when a completed chat task carries `context.workItemGoalGrilling` and `workItems.workflow.enabled` is true, the server extracts the final assistant `## Goal` block and saves it to the addressed local-only `goal` as the next AI-authored immutable content version.

### AI Authoring (gated by `workItems.aiAuthoring` flag, default `false`)

The `ai-draft` generation endpoints are ephemeral — no data is persisted until
the caller explicitly applies the generated content. The workflow
`ai-draft/apply` endpoint is the direct apply path for saved local-only
`work-item` shells and stores an immutable AI-authored plan/content version after
checking the caller's base snapshot.

Response shape: `{ kind: 'clarification', questions: string[], clarificationCount: number }` or `{ kind: 'draft', workItem: {...}, goal?: string, childTasks?: [...] }`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workspaces/:id/work-items/ai-draft` | Generate a draft for a **new** work item from a prompt. Body: `{ prompt, type?, parentId?, clarificationAnswers?, clarificationCount? }`. Returns clarification (up to 3 rounds) or a draft. |
| POST | `/api/workspaces/:id/work-items/:itemId/ai-draft` | Generate an **improvement** draft for an existing work item. Body: `{ prompt, targets?: ['fields','goal','childTasks'], clarificationAnswers?, clarificationCount? }`. Returns clarification or a draft. |
| POST | `/api/workspaces/:id/work-items/:itemId/ai-draft/apply` | Explicitly generate and apply an AI draft to a saved local-only `work-item`, creating the next immutable plan/content version. Requires both `workItems.aiAuthoring.enabled` and `workItems.workflow.enabled`; body requires `{ prompt, baseUpdatedAt, baseContentVersion?, targets?, clarificationAnswers?, clarificationCount?, summary?, reason? }`. The server checks the base snapshot before and after AI generation and returns `409 WORK_ITEM_AI_DRAFT_STALE` instead of overwriting newer edits. |

## Seen State

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/seen-state` | Get seen state |
| PATCH | `/api/workspaces/:id/seen-state` | Update seen state |
| DELETE | `/api/workspaces/:id/seen-state/:processId` | Clear process seen state |
| GET | `/api/workspaces/:id/seen-state/count` | Unseen count |

## LLM Tools

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/llm-tools-config` | Get tool config |
| PUT | `/api/workspaces/:id/llm-tools-config` | Update tool config |

## Wiki

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/wiki` | List registered wikis |
| POST | `/api/wiki/ask` | Ask wiki question |
| POST | `/api/wiki/explore` | Explore wiki topic |
| POST | `/api/wiki/generate` | Generate wiki |

## Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/config` | Full server config |
| GET | `/api/admin/system-prompts` | System prompt templates |
| POST | `/api/admin/storage/scan-directory` | Scan for importable history |
| POST | `/api/admin/storage/import-directory` | Import (SSE streaming) |
| GET | `/api/admin/db/tables` | SQLite table list |
| GET | `/api/admin/db/tables/:name` | Query table data |

## Real-Time

| Protocol | Path | Description |
|----------|------|-------------|
| WebSocket | `/ws` | Process events (workspace-scoped, file subscriptions) |
| WebSocket | `/ws/terminal` | Terminal PTY sessions |
| SSE | `/api/processes/:id/stream` | Per-process event streaming |

## Remote Servers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/servers` | List remote servers |
| POST | `/api/servers` | Register server |
| DELETE | `/api/servers/:id` | Remove server |
| POST | `/api/servers/:id/test` | Test connection |
| POST | `/api/servers/:id/connect` | Connect (DevTunnel) |
| POST | `/api/servers/:id/disconnect` | Disconnect |
| POST | `/api/servers/cherry-pick-transfer` | Orchestrate a patch-transfer cherry-pick through the initiating CoC server. Body `{ source: { serverId?, workspaceId, commitHash }, target: { serverId?, workspaceId, stashAndContinue? } }`; omitted/`local` `serverId` means the current CoC, otherwise the id must be an online registered remote server. The route composes the existing workspace git patch export/apply endpoints, propagates dirty/conflict response fields, and returns source/target server/workspace metadata without effective URLs or local paths. |

## Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/status` | Sync status (enabled, inProgress, lastSyncTime, lastError) |
| POST | `/api/sync/trigger` | Force immediate notes sync |

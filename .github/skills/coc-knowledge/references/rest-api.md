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

## Canvases

Chat canvas side panel (gated by `canvas.enabled`, default off). Markdown or code artifacts (`type` + optional `language` on the descriptor) the AI and the user co-edit; AI edits go through the canvas LLM tools, these routes serve the dashboard panel.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/canvases` | List canvas descriptors (no content), newest first; `?processId=` filters to canvases linked to one chat process |
| GET | `/api/workspaces/:id/canvases/:canvasId` | Full canvas record (descriptor + markdown content) |
| PUT | `/api/workspaces/:id/canvases/:canvasId` | User save. Body `{ content?, edits?, expectedRevision?, title? }`; a stale `expectedRevision` returns 409 with `{ error: 'revision-conflict', currentRevision, canvas }`. Successful saves broadcast a `canvas-updated` WebSocket event |
| GET | `/api/workspaces/:id/canvases/:canvasId/versions` | Version snapshot metadata (revision, editor, updatedAt), newest first; snapshots are written on every persisted revision and capped at the 50 most recent |
| GET | `/api/workspaces/:id/canvases/:canvasId/versions/:rev` | One full version snapshot (metadata + content) |
| GET | `/api/workspaces/:id/canvases/:canvasId/comments` | Anchored comments; `?status=open\|sent\|resolved` filters |
| POST | `/api/workspaces/:id/canvases/:canvasId/comments` | Add a comment. Body `{ anchorText, body }` (anchor capped at 500 chars, body at 4000) |
| PATCH | `/api/workspaces/:id/canvases/:canvasId/comments/:cid` | Set comment status (`open`/`sent`/`resolved`) |
| DELETE | `/api/workspaces/:id/canvases/:canvasId/comments/:cid` | Delete a comment |
| GET | `/api/workspaces/:id/canvases/:canvasId/extension` | Extension documents (`manifest`, `uiHtml`, `capabilitiesJs`) for an `extension`-type canvas |
| POST | `/api/workspaces/:id/canvases/:canvasId/capabilities/:name` | Invoke a declared capability against the canvas JSON state (vm-sandboxed pure transform); revision-checked write, `canvas-updated` broadcast. 422 on capability error, 409 on concurrent edit |

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
| GET/POST | `/api/workspaces/:id/commit-chat-bindings` | List or create workspace-scoped commit hash → chat task bindings |
| GET/DELETE | `/api/workspaces/:id/commit-chat-bindings/:commitHash` | Read or remove one workspace-scoped commit chat binding |
| POST | `/api/workspaces/:id/commit-chat-bindings/:commitHash/fresh` | Archive the currently bound commit chat process and clear the binding so the same workspace/commit target starts from an empty chat on the next send; stale bindings whose process is already missing are cleared and return `archivedTaskId: null` |

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
| PATCH | `/api/workspaces/:id/group-pins/:type/:groupId` | Pin/unpin a parent group row. `type` is an open string: legacy names `ralph-session`, `for-each-run`, `map-reduce-run` plus any registered task-group type; body `{ pinned: boolean }`. This updates only the group pin record and does not mutate child process pin/archive metadata |

## Task Groups

Generic parent/child task relationship registry shared by For Each, Map Reduce, Ralph, Dreams, and future hierarchical features. Always registered (no feature flag).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/task-groups` | List visible task-group summaries (group record + child links with roles). Query: `type=` filters by group type; `includeHidden=true` includes linkage-only groups (Dream runs) |
| GET | `/api/workspaces/:id/task-groups/:groupId` | Get one task-group summary; 404 when unknown |

## Queue

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queue` | List queue tasks. `dream-run` queue summaries include provider, model, reasoning effort, and timeout metadata when resolved so Activity and Admin AI Provider surfaces can attribute active Dreams work |
| GET | `/api/queue/models` | List model IDs for the resolved concrete default provider; when `features.autoAgentProviderRouting` is enabled, this uses the same Auto provider routing resolver as enqueue and includes `autoProviderRouting` metadata with the selected provider, fallback state, warnings, and decision reasons. |
| GET | `/api/queue/:id` | Get a single queue task, falling back to reconstructed process history for completed/historical tasks when available. Reconstructed `dream-run` tasks include analyzer/critic process IDs under `payload.processes` when the run created them |
| GET | `/api/queue/history` | List in-memory queue history merged with durable process history after restart. Store-backed `dream-run` entries include provider/model/reasoning/timeout metadata plus analyzer/critic process IDs under `payload.processes` when available |
| POST | `/api/queue` | Enqueue a task. Chat payloads use `mode='ask'`, `mode='autopilot'`, or internal Ralph routing; legacy `mode='plan'` is accepted and normalized to Ask. For Each item-plan generation is represented as a normal Ask-mode chat with `payload.context.forEach.kind='generation'`; the UI-only `for-each` mode value is still rejected by the generic queue validator. Body `config.effortTier` accepts `very-low`, `low`, `medium`, or `high`; the server resolves Auto defaults to a concrete provider before expanding the tier to `config.model` and `config.reasoningEffort` from that provider's stored/default tier map, while explicit `config.model` and `config.reasoningEffort` take precedence and `effortTier` is not stored. Notes chat edits can include `payload.context.lensChat = { inherited: true, source: 'features.commitChatLens' }` when the shared Lens Chat flag is active; the marker is copied to process metadata and is omitted for non-Lens behavior. |
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

## Native Copilot Sessions

Read-only compatibility views over the server user's native GitHub Copilot CLI session store (`~/.copilot/session-store.db`). These legacy routes share the disabled-by-default `features.nativeCliSessions` live guard with the unified CLI Sessions API, so there is one operational switch for native Copilot/Codex/Claude session browsing. CoC opens the native SQLite store read-only with short-lived per-request connections, never writes to it, and never imports native sessions into CoC process history. Disabled and unavailable states return HTTP 200 with typed payloads: `{ enabled: false, reason: 'feature-disabled' }` when the flag is off, and `{ enabled: true, available: false, reason: 'db-missing' | 'db-invalid' }` when the store is absent or unreadable. Workspace scoping matches native `sessions.cwd` against the registered workspace root (equal or descendant path) or native `sessions.repository` against the workspace's origin-remote `owner/repo` (case-insensitive). `@plusplusoneplusplus/coc-client` keeps exposing these compatibility routes through `client.nativeCopilotSessions`; new UI code uses `client.nativeCliSessions`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/native-copilot-sessions` | List workspace-matching native sessions sorted by newest `updated_at`. Query: `q` (text search via the native `search_index` FTS table with match snippets; parameterized literal-quoted terms), `sessionId` (exact or partial), `branch`, `from`/`to` ISO bounds on updated time, `limit` (default 50, max 200), `offset`. Response includes `items` with summary preview and turn counts, `total`, `searchIndexAvailable` (false when the native FTS table is absent — text queries then return no hits non-fatally), `deduplicatedCount` (native sessions hidden because their `sessions.id` matches a CoC process `sdk_session_id` for the workspace), and `backgroundJobCount` (automated background-job sessions hidden by first-turn or stored-summary prompt match, e.g. title summarization) |
| GET | `/api/workspaces/:id/native-copilot-sessions/:sessionId` | Read one workspace-matching native session: metadata, full stored summary, and turns ordered by `turn_index` with per-turn char counts and search-index diagnostics (`searchIndexSourceId`/`searchIndexChars`, null when not indexed). Also returns `conversation` (always present): a reconstructed `ReconstructedConversationTurn[]` transcript for rich chat rendering, built from the per-session `session-state/<id>/events.jsonl` log when available, else mapped from the flat DB turns as text-only user/assistant turns. Sessions outside the workspace or unknown IDs return 404 |

## Native CLI Sessions

Unified read-only, workspace-scoped views over native Copilot (`~/.copilot/session-store.db`), Codex (`~/.codex/sessions`), and Claude Code (`~/.claude/projects`) CLI stores. Gated by the disabled-by-default live `features.nativeCliSessions` flag and exposed through `@plusplusoneplusplus/coc-client` as `client.nativeCliSessions`. Query parameter `provider=copilot|codex|claude` selects the backing provider; omitted provider defaults to `copilot`. Disabled and unavailable states return HTTP 200 typed payloads using `{ enabled: false, reason: 'feature-disabled' }` or `{ enabled: true, available: false, reason: 'store-missing' | 'store-invalid' }`. The route deduplicates against `ProcessStore.getSdkSessionIds(workspaceId)`. Codex and Claude text search is on-demand substring search over JSONL files and reports `searchIndexAvailable: false`; Copilot delegates to the native SQLite provider and reports its native search-index availability.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/native-cli-sessions?provider=copilot|codex|claude` | List workspace-matching native CLI sessions. Query also accepts `q`, `sessionId`, `branch`, `from`/`to`, `limit`, and `offset`. Response includes provider-tagged `items`, `total`, `searchIndexAvailable`, `deduplicatedCount`, `backgroundJobCount`, `limit`, and `offset`. |
| GET | `/api/workspaces/:id/native-cli-sessions/:sessionId?provider=copilot|codex|claude` | Read one workspace-matching native CLI session, returning provider-tagged metadata, store path, and reconstructed `conversation: ReconstructedConversationTurn[]`. Unknown or out-of-workspace sessions return 404. |

## Dreams

All Dreams routes are workspace-scoped and gated by `dreams.enabled` (default `false`). Dream generation also requires the target workspace's `preferences.dreams.enabled` opt-in. Cards are review records only: approval records user intent, conversion records an explicit resulting artifact link, and no route mutates skills, prompts, notes, memory, work items, or code directly.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/dreams/cards` | List visible dream cards by default. Query `includeHidden=true` includes candidate/approved/dismissed/converted/superseded history; `status=visible,approved` filters by card status |
| GET | `/api/workspaces/:id/dreams/cards/:cardId` | Read a dream card detail, including source ranges, confidence, fingerprint, and dedup rationale |
| POST | `/api/workspaces/:id/dreams/run` | Enqueue a visible queue-backed `dream-run` task for a manual read-only Dream pass in the workspace. Body accepts optional `provider`, `config.model`, `config.reasoningEffort`, `confidenceThreshold`, `maxCandidates`, `conversationLimit`, and `timeoutMs`; response is `202 { task }`. Dream run records persist the resolved provider/model/reasoning/timeout metadata, source coverage, and analyzer/critic process IDs. The outer `dream-run` process result and metadata also include those internal process IDs so `/api/processes/:id`, `/api/queue/:id`, and `/api/queue/history` can be used after restart to find analyzer/critic prompts and responses |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/approve` | Mark a visible card approved; this records intent only and does not perform a next action |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/dismiss` | Dismiss a visible card, optionally recording `dedupRationale` |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/convert` | Mark a visible or approved card converted with `{ artifactType, artifactId, artifactUrl? }` after an explicit external next action completes |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/supersede` | Mark a candidate or visible card superseded with required `dedupRationale` and optional `supersededByCardId` |

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
| POST | `/api/workspaces/:id/notes/ai-create` | Enqueue AI note creation. Body: `prompt`, optional `chatTaskId`, and optional inherited `lensChat` marker when Lens Chat mode is active. |
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
| GET | `/api/origins/:originId/pull-requests` | List pull requests through an explicit concrete clone. Requires `workspaceId` query metadata and accepts optional `repoId`; the selected workspace/repo must resolve to `originId`. Rows are enriched with `diffStats` (`additions`, `deletions`, `changedFiles`) when the provider exposes PR diffs, include `fetchedAt`, and can be served from the active-workspace background-warmed in-memory server cache for 60 minutes unless `force=true` is supplied. List rows and diff stats are cached in memory by canonical origin, status/scope, PR id, and `headSha` when present; no diff contents are durably stored for stats. When Pull Requests, focused diff, and `pullRequests.autoClassifyTeam` are enabled, loaded open Team PRs with `headSha` opportunistically enqueue missing low-priority diff classifications using the existing classify-diff pipeline and the origin-scoped Team roster. |
| GET | `/api/origins/:originId/pull-requests/:prId` | Fetch and cache PR detail through an explicit concrete clone. Requires `workspaceId` query metadata and accepts optional `repoId`; the selected workspace/repo must resolve to `originId`. Details are cached in memory for 10 minutes by canonical origin and PR id, including provider SHA fields (`baseSha`, `headSha`) when available. `force=true` refreshes only this PR for the resolved origin and invalidates its detail, subresource, provider combined diff, and diff-stats cache entries. |
| GET | `/api/origins/:originId/pull-requests/:prId/threads` | Fetch comment threads through an explicit concrete clone. Requires `workspaceId` query metadata and accepts optional `repoId`; results are cached in memory for 10 minutes by canonical origin/PR. |
| GET | `/api/origins/:originId/pull-requests/:prId/reviewers` | Fetch reviewers through an explicit concrete clone. Requires `workspaceId` query metadata and accepts optional `repoId`; results are cached in memory for 30 minutes by canonical origin/PR. |
| GET | `/api/origins/:originId/pull-requests/:prId/commits` | Fetch PR commits through an explicit concrete clone. Requires `workspaceId` query metadata and accepts optional `repoId`; results are cached in memory for 30 minutes by canonical origin/PR. |
| GET | `/api/origins/:originId/pull-requests/:prId/checks` | Fetch CI/check statuses through an explicit concrete clone. Requires `workspaceId` query metadata and accepts optional `repoId`; results are cached in memory for 10 minutes by canonical origin/PR. |
| GET | `/api/origins/:originId/pull-requests/:prId/diff` | Return a plain-text provider unified diff through an explicit concrete clone. Requires `workspaceId` query metadata and accepts optional `repoId`; the provider combined diff is cached in memory with no TTL by canonical origin, PR id, and resolved PR `headSha` when available. |
| GET | `/api/origins/:originId/pull-requests/:prId/diff/files/:path` | Return JSON `{ diff }` by extracting one file from the origin-scoped provider combined diff cache. Requires `workspaceId` query metadata and accepts optional `repoId`; with `fullContext=true`, the server attempts full-file local git context in the selected checkout and falls back with `fullContextUnavailable` metadata. |
| GET | `/api/repos/:repoId/pull-requests` | Workspace/repo-compatible PR list route that stores/caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/repos/:repoId/pull-requests/:prId` | Workspace/repo-compatible PR detail route that stores/caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/repos/:repoId/pull-requests/:prId/threads` | Workspace/repo-compatible comment-thread route that caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/repos/:repoId/pull-requests/:prId/reviewers` | Workspace/repo-compatible reviewers route that caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/repos/:repoId/pull-requests/:prId/commits` | Workspace/repo-compatible commits route that caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/repos/:repoId/pull-requests/:prId/checks` | Workspace/repo-compatible checks route that caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/repos/:repoId/pull-requests/:prId/diff` | Workspace/repo-compatible provider unified diff route that caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/repos/:repoId/pull-requests/:prId/diff/files/:path` | Workspace/repo-compatible per-file diff route that caches under the resolved canonical origin. New SPA and `coc-client` callers use the origin route directly. |
| GET | `/api/origins/:originId/pull-requests/recent-opened` | List recently opened PR entries for the canonical origin. Optional `workspaceId`/`repoId` query metadata migrates matching legacy workspace/repo files into the origin list on access; the route never resolves `repoId` as a workspace fallback. |
| POST | `/api/origins/:originId/pull-requests/recent-opened` | Record a recently opened PR entry under the canonical origin after successful validation/open; body includes `number`, `title`, optional `webUrl`, and optional `workspaceId`/`repoId` metadata for legacy migration/display only. |
| DELETE | `/api/origins/:originId/pull-requests/recent-opened/:prNumber` | Remove a stale recently opened PR entry from the canonical origin. Optional `workspaceId`/`repoId` query metadata is used only for legacy migration. |
| GET | `/api/origins/:originId/pull-requests/coworker-roster` | List persisted Team roster coworkers for the canonical origin. Optional `workspaceId`/`repoId` query metadata migrates matching legacy workspace/repo files into the origin roster on access. |
| POST | `/api/origins/:originId/pull-requests/coworker-roster` | Add or update a Team roster coworker under the canonical origin; body includes `displayName`, optional `id`, `email`, `avatarUrl`, and optional `workspaceId`/`repoId` metadata. |
| DELETE | `/api/origins/:originId/pull-requests/coworker-roster/:coworkerKey` | Remove a Team roster coworker by provider id or displayName fallback key from the canonical origin. Optional `workspaceId`/`repoId` query metadata is used only for legacy migration. |
| POST | `/api/origins/:originId/pull-requests/team-auto-classification` | Manually trigger the same bounded Team PR auto-classification helper used by PR list/background warm paths. Requires the live Team auto-classification gate plus an explicit `workspaceId` (and optional `repoId`) selecting a concrete clone that resolves to `originId`; body includes loaded PR list items. Returns counts for eligible/considered/skipped/ready/running/started/notFound/errors, reads/writes classification result and pending state under `originId`, uses low priority, and caps each call at 10 new enqueues. |
| GET | `/api/origins/:originId/pull-requests/review-history` | Read cached PR review history from the canonical origin. Optional `workspaceId`/`repoId` query metadata migrates matching legacy workspace/repo cache files into the origin file on access. |
| POST | `/api/origins/:originId/pull-requests/review-history/refresh` | Fetch provider review history through an explicit `workspaceId` (and optional `repoId`) that resolves to `originId`, then cache it under the canonical origin. |
| GET | `/api/origins/:originId/pull-requests/suggestions` | Read cached AI-ranked PR suggestions from the canonical origin. Optional `workspaceId`/`repoId` query metadata migrates matching legacy workspace/repo cache files into the origin file on access. |
| POST | `/api/origins/:originId/pull-requests/suggestions/refresh` | Rank open PRs through an explicit `workspaceId` (and optional `repoId`) that resolves to `originId`, using origin-scoped cached review history and persisting suggestions under the same origin. |
| GET/PUT | `/api/origins/:originId/pull-requests/:prId/review-progress` | Read or save PR pop-out reviewer progress under the canonical origin; `headSha` is required, and optional `workspaceId`/`repoId` metadata selects legacy migration scopes without resolving `repoId` as a workspace fallback. Legacy workspace/repo progress files migrate into the origin file on access. |
| GET/PUT | `/api/repos/:repoId/pull-requests/:prId/review-progress` | Workspace/repo-compatible reviewer progress route that stores under the resolved canonical origin; `workspaceId` selects the concrete workspace and `headSha` is required. New SPA and `coc-client` callers use the origin route directly. |
| GET/POST | `/api/origins/:originId/pull-request-chat-bindings` | List or create origin-scoped pull request → chat task bindings. Workspace-scoped callers resolve to their canonical origin and migrate legacy workspace rows on access. |
| GET/DELETE | `/api/origins/:originId/pull-request-chat-bindings/:prId` | Read or remove one origin-scoped PR chat binding |
| POST | `/api/origins/:originId/pull-request-chat-bindings/:prId/fresh` | Archive the currently bound PR chat process and clear the binding so the same origin/PR target starts from an empty chat on the next send. Requires `workspaceId` query parameter to select a concrete clone and rejects workspaces that resolve to a different origin; stale bindings whose process is already missing are cleared and return `archivedTaskId: null` |

## Diff Classification

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/repos/:repoId/classify-diff` | Trigger AI hunk classification. Body: `{ type: 'pr'\|'commit'\|'branch-range', identifier, workspaceId?, model?, provider? }`. Returns `{ status: 'started'\|'ready'\|'running', … }`; result and pending marker files live under the resolved canonical origin, and legacy workspace/repo classification files migrate into that origin on access. |
| GET | `/api/repos/:repoId/classify-diff` | Poll for a single classification result under the resolved canonical origin. Query: `type`, `identifier`, `workspaceId?`. Returns `{ status: 'none'\|'ready'\|'running', result? }`. |
| GET | `/api/repos/:repoId/classify-diff/batch-status` | Batch-check whether multiple identifiers have a stored result under the resolved canonical origin. Query: `type`, `identifiers` (comma-separated, max 200), `workspaceId?`. Returns `{ statuses: { [identifier]: 'none'\|'ready'\|'running' } }`. Read-only — never triggers a new classification task. |
| GET | `/api/origins/:originId/classify-diff/batch-status` | Batch-check PR classification identifiers under a canonical origin. Query: `type=pr`, `identifiers` (comma-separated, max 200), optional `workspaceId`/`repoId` metadata for legacy migration. Returns `{ statuses: { [identifier]: 'none'\|'ready'\|'running' } }`. Read-only — never triggers a new classification task. |

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

Core Work Item CRUD/listing routes are origin-scoped under `/api/origins/:originId/...`; `@plusplusoneplusplus/coc-client` exposes these as `workItems.*ForOrigin(...)` methods. Workspace-scoped URLs are accepted during the migration and resolve to the workspace's canonical origin for storage/cache reads; origin-scoped writes that need provider or filesystem semantics may pass `workspaceId` (query or body) and the server rejects it when that workspace resolves to a different origin.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/origins/:originId/work-items` | List work items. Supports standard field filters plus `tracker=local-only\|github-backed\|azure-boards-backed`, which filters by inherited Epic-rooted tracker identity. Matching origin-warmed responses can be served from the server cache unless `force=true` is supplied. |
| GET | `/api/origins/:originId/work-items/grouped` | List work items grouped by status with per-group pagination. The default active-origin response is proactively warmed and can be bypassed with `force=true`. |
| GET | `/api/origins/:originId/work-items/tree` | Read the hierarchy tree under the canonical origin. Supports `tracker=local-only\|github-backed\|azure-boards-backed`, content/status/type filters, `includeArchived`, and `includeDone`; descendants inherit the tracker identity of their root Epic. Optional `workspaceId` metadata validates that the selected clone resolves to `originId`. Active-origin Local and detected Remote tree responses can be served from the warmed server cache unless `force=true` is supplied. |
| POST | `/api/origins/:originId/work-items` | Create work item. Root Epic payloads may include `tracker` metadata; absent tracker metadata is treated as `local-only`. Creating a child under a GitHub-backed Epic tree creates the GitHub issue first, encodes the parent via hidden body metadata, then stores `githubMirror` metadata on the local item. Creating a child under an Azure Boards-backed Epic tree creates the Azure work item and native parent relation first, then stores `azureBoardsMirror` metadata locally. Legacy `syncLinks` payloads are rejected. Create and update logic lives in the shared command service (`work-items/work-item-commands.ts`), which the `create_update_work_item` AI tool also calls, so hierarchy validation, provider sync, cache invalidation, and broadcasts behave identically for REST and AI-tool callers. |
| GET | `/api/origins/:originId/work-items/:itemId` | Read work item |
| PATCH | `/api/origins/:originId/work-items/:itemId` | Update work item. `tracker` metadata is accepted only on root Epic items. Core field edits on GitHub- and Azure Boards-backed mirror items push provider-owned fields before local storage; stale provider snapshots return a typed sync conflict unless the request includes a matching reviewed `syncConflictResolution`. Legacy `syncLinks` payloads are rejected. |
| DELETE | `/api/origins/:originId/work-items/:itemId` | Delete work item |
| GET | `/api/workspaces/:id/work-items/:itemId/plan/versions/compare?base=N&target=M` | Compare two immutable plan/content versions for a local-only `work-item` or `goal`. Requires `workItems.workflow.enabled`. |
| POST | `/api/workspaces/:id/work-items/:itemId/plan/versions/:version/restore` | Restore an older plan/content version for a local-only `work-item` or `goal` by creating a new current version. Requires `workItems.workflow.enabled`; body accepts optional `summary` and `reason`. |
| POST | `/api/workspaces/:id/work-items/:itemId/execute` | Enqueue a work-item implementation run. Body accepts optional `executionMode` (`one-shot` or `ralph`), `skillNames`, `provider`, `model`, `reasoningEffort`, `effortTier`, and `autoProviderRouting`. One-shot uses the existing single queued implementation task and remains the default for Work Items. When `workItems.workflow.enabled` is true, local-only Goals default to Ralph execution; Ralph mode is accepted only for local-only `work-item` and `goal` items and returns `ralphSessionId` alongside `taskId`. |
| POST | `/api/workspaces/:id/work-items/:itemId/ai-review` | Explicitly start an optional AI review for a Review-state local-only `work-item`/`goal`. Requires `workItems.workflow.enabled`; enqueues an Ask-mode `code-review` chat, records a non-mutating `work-item-ai-review` execution-history entry, and leaves the item in Review even if the review fails. |
| POST | `/api/workspaces/:id/work-items/:itemId/submit-pr` | Explicitly submit the latest eligible Review-state local-only `work-item`/`goal` change with commits as a pull request. Requires `workItems.workflow.enabled`, a clean workspace, a registered workspace root, `gh` authentication, and no existing PR metadata on the target change. Body accepts optional `changeId`, `title`, `body`, `baseBranch`, and `branchName`; success records branch/PR metadata on the change, links the PR URL on the execution, and marks the item Done. |
| POST | `/api/workspaces/:id/work-items/:itemId/convert-to-github` | Convert a local-only root Epic tree to GitHub-backed tracking by creating GitHub issues for the root and each descendant in the workspace-configured repo, encoding parent links in hidden body metadata, and storing mirror metadata locally. |
| POST | `/api/workspaces/:id/work-items/:itemId/convert-to-local` | Detach a GitHub-backed root Epic tree into local-only tracking by removing GitHub mirror metadata from the root and descendants while preserving local lifecycle status, plans, execution history, runs, and commits. |
| GET | `/api/workspaces/:id/work-items/tree` | Workspace-compatible hierarchy tree route that resolves to the workspace's canonical origin for storage/cache reads. New SPA and `coc-client` callers use the origin route directly. |
| POST | `/api/workspaces/:id/work-items/import-from-github` | Import an existing GitHub Epic issue from the workspace-configured repository. Body accepts either `issueNumber` or `issueUrl`; URL owner/repo must match the workspace-configured repo. The server pulls the root issue plus descendants discovered from hidden `coc-work-item-sync` parent metadata into a local read mirror and returns the root Epic work item. |
| POST | `/api/workspaces/:id/work-items/import-from-azure-boards` | Import an existing Azure Boards Epic-rooted work item tree from the workspace-configured Azure Boards project. Body accepts either `workItemId` or `workItemUrl`; URL organization/project must match workspace configuration. The server pulls descendants through native Azure Boards hierarchy relations and returns the root Epic work item. |
| GET | `/api/workspaces/:id/work-items/sync/status` | Work-item sync provider status for GitHub and Azure Boards. Returns disabled reasons unless both `workItems.hierarchy.enabled` and `workItems.sync.enabled` are true. Without a `provider` query it derives `remoteProvider` from the workspace repo remote URL and reports only that provider; missing or unsupported remotes return no provider statuses. Provider credentials remain external and sanitized. Enabled status responses can be served from the warmed server cache unless `force=true` is supplied. |

### Work Item chat bindings

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/origins/:originId/work-item-chat-bindings` | List remembered Work Item → chat task bindings for a canonical origin. Workspace-scoped callers resolve to their origin and migrate legacy workspace rows on access. |
| GET | `/api/origins/:originId/work-item-chat-bindings/:workItemId` | Read one origin-scoped binding; returns 404 when none exists |
| POST | `/api/origins/:originId/work-item-chat-bindings` | Create or replace an origin-scoped binding. Body: `{ workItemId, taskId }`; optional `workspaceId` validates legacy metadata against the origin. |
| DELETE | `/api/origins/:originId/work-item-chat-bindings/:workItemId` | Remove an origin-scoped binding. Missing bindings are treated as a no-op |
| POST | `/api/origins/:originId/work-item-chat-bindings/:workItemId/fresh` | Archive the currently bound Work Item chat process and clear the binding so the same origin/Work Item target starts from an empty chat on the next send. Requires `workspaceId` query metadata to select a concrete clone and rejects workspaces that resolve to a different origin; stale bindings whose process is already missing are cleared and return `archivedTaskId: null` |

Work items use Epic-rooted tracker identity. A root Epic may carry `tracker: { kind: 'local-only' }`, `tracker: { kind: 'github-backed', provider: 'github', github: { issueId?, issueNumber?, issueUrl?, lastPulledAt? } }`, or `tracker: { kind: 'azure-boards-backed', provider: 'azure-boards', azureBoards: { workItemId?, workItemUrl?, revision?, updatedAt?, lastPulledAt? } }`; descendants inherit the root identity for listing and tree filtering. Tracker metadata is not valid on non-root items. GitHub-backed mirror items carry `githubMirror: { issueId?, issueNumber, issueUrl?, state?, updatedAt?, lastPulledAt? }` so each local item can be matched to its GitHub issue while sync ownership remains rooted at the Epic. Azure Boards-backed mirror items carry `azureBoardsMirror: { workItemId, workItemUrl?, revision?, workItemType?, state?, updatedAt?, lastPulledAt? }` so each local item can be matched to its Azure Boards work item without storing credentials; the public work-item contract does not expose per-item `syncLinks`. Local-only root Epics can be converted to GitHub-backed trees, which creates one GitHub issue per local item using the workspace-configured repo and hidden body metadata for parent links; GitHub-backed roots can be converted back to local-only by dropping mirror metadata locally without deleting remote issues. GitHub-owned mirror fields are title, description, type, parent, tags, and issue open/closed state; CoC lifecycle status, plans, execution history, runs, and commits remain local. Azure Boards import/sync mirrors title, description, status/state, priority, tags, type, parent relation, revision, URL, and updated metadata from native Azure Boards fields/relations; local edits to mirrored Azure items push the same core editable fields back to Azure and update mirror revision/URL/update metadata from the returned work item. Azure-backed child creation creates the Azure work item with the default type mapping and native parent relation before local persistence. `workItems.sync.enabled` is the disabled-by-default global gate for remote provider integration: when disabled, local work-item saves still persist locally but no GitHub/Azure PATCH transport calls or background provider polling timers run. Provider-backed save requests compare stored mirror metadata with the live provider before pushing and fail with `WORK_ITEM_SYNC_CONFLICT` when the remote item changed; retrying the same PATCH may include `syncConflictResolution: { provider: 'github', acknowledgedRemoteUpdatedAt }` or `{ provider: 'azure-boards', acknowledgedRemoteRevision }` after the user reviews the typed conflict, and the save proceeds only if the live provider snapshot still matches the acknowledgement. No Azure custom fields or hidden HTML metadata are required. Legacy persisted `syncLinks` are migrated on read when they can be rooted at a GitHub-backed Epic: the root link becomes Epic tracker metadata, item links become `githubMirror`, and `syncLinks` are removed from stored detail/index data. GitHub issue mapping owns only `coc:` labels (`coc:type:*`, `coc:status:*`, `coc:priority:*`) and the hidden `<!-- coc-work-item-sync {json} -->` metadata block; non-`coc:` issue labels remain user labels/tags. GitHub-backed and Azure Boards-backed Epic roots are pulled by background pollers when remote provider integration is enabled. Per-workspace preferences under `workItems.sync.github` support `owner`, `repo`, `pollingEnabled` (default `true`), and `pollIntervalMinutes` (default `5`, range `1..1440`); Azure Boards polling preferences live under `workItems.sync.azureBoards` with `project`, `pollingEnabled` (default `true`), and `pollIntervalMinutes` (default `5`, range `1..1440`). Polling scans only workspaces with imported provider-backed Epic roots, stays workspace-scoped, updates local mirrors from provider state, prunes missing mirrored descendants, deletes mirrored root trees when the provider root is gone, and surfaces remote-wins warnings when local unsynced provider-owned edits are overwritten. Azure Boards status uses the global Azure DevOps organization URL from `/api/providers/config` (`providers.ado.orgUrl`) plus the workspace-scoped `workItems.sync.azureBoards.project` preference; it authenticates externally with Azure CLI and does not store Azure Boards PATs or bearer values. Azure Boards field mapping is deterministic without custom fields: Epic/Feature/Bug map natively, PBI prefers Product Backlog Item then User Story, Work Item and Goal map to Task, Goal identity is represented with a CoC-owned Azure tag, common Azure states map to CoC statuses, and unknown Azure states/types/priorities are preserved as local status strings or metadata tags.

The sync route layer retains provider status for GitHub and Azure Boards availability checks while Epic-rooted operations use explicit import, pull, and conversion endpoints. GitHub Issues is registered by default and uses external authentication through `gh`/environment-backed GitHub auth without persisting tokens; its status adapter resolves workspace owner/repo and reports provider availability. Azure Boards is registered by default for status checks, reports missing org URL/project/Azure CLI auth explicitly, and returns only sanitized org/project metadata. Remote provider visibility is workspace-scoped and based on the workspace repo remote URL (`github.com` for GitHub, `dev.azure.com`, `ssh.dev.azure.com`, or `*.visualstudio.com` for Azure Boards); provider configuration does not make unsupported remote hosts visible.

`PATCH /api/origins/:originId/work-items/:itemId` accepts work-item metadata fields and an optional `plan: { content, resolvedBy?, summary?, reason? }` object in the same request; origin-scoped callers pass `workspaceId` when provider/filesystem semantics are needed. `plan.content` must contain non-whitespace Markdown. When `plan.content` is present, the server creates the next immutable plan/content version, records source/author metadata (`user` or `ai`), stores the explicit current-version pointer on `plan.currentVersion` and `currentContentVersion`, opens the corresponding change record, broadcasts one `work-item-updated` event, and returns the updated work item. The dedicated `PUT /api/workspaces/:id/work-items/:itemId/plan` endpoint remains available for plan-only workflows and uses the same non-empty content requirement. Execution records and queued task payloads include the selected `planVersion` so runs can be traced back to the exact version that was executed.

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

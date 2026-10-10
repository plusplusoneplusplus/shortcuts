# REST API

Single-file endpoint lookup catalog. Route registration: `packages/coc/src/server/routes/index.ts`; typed clients: `packages/coc-client/src/`.

## Conventions

Rows state endpoint-specific behavior. `/api/workspaces/:id` selects a registered workspace; `/api/repos/:repoId` uses the route's repo resolver; `/api/origins/:originId` shares persisted data across same-origin clones. Unscoped settings are server-global. Repo-owned runtime files belong under `~/.coc/repos/<workspaceId>/`. Never edit Work Item storage files directly.

### Provider overrides

Chat launches accept `provider`, `config.model`, `config.reasoningEffort`, `config.effortTier` (`very-low`\|`low`\|`medium`\|`high`), and `autoProviderRouting`. Auto routing resolves omitted providers when enabled; records store the concrete provider. Explicit model/effort overrides the expanded, unpersisted tier. Modes: `ask` or `autopilot`; `plan` aliases Ask. See [sdk-wrapper.md](sdk-wrapper.md).

Chat styles: `default`, `human`, `direct`, `terse`, `structured`; invalid style → `400`. Omitted style uses `features.defaultChatStyle`.

### Origin scoping

Canonical-origin routes distinguish execution from shared files:

- **Clone-dependent PR/provider and execution routes** require query/body `workspaceId` where noted, selecting a concrete same-origin clone; PR routes also accept `repoId`. Unknown or different-origin selections are rejected.
- **Origin-file routes** accept optional clone metadata for validation/migration: recent-opened, roster, cached history/suggestions, progress, bindings, classification polling. Fresh-chat resets require a concrete workspace.

Caches use canonical origin plus item/PR identity and `headSha` where noted; `force=true` refreshes supported reads.

### Chat bindings

Commit/PR/Work Item collections list/create bindings; keyed routes read/remove them (missing removal is a no-op). `POST /:key/fresh` archives the chat and clears its binding; an absent process yields `archivedTaskId: null`.

### Feature gates

Flag-gated domains return unavailable/not-found behavior when the flag is off; specific codes are noted per section.

### Worktree opt-in

Execution routes (`/execute`, `/api/ralph-launch`, `/api/processes/:id/ralph-start`) accept `worktree: { enabled: true, baseRef? }` when `features.gitWorktreeExecution` is on. Omitting it keeps in-place execution; a malformed value returns `400`. See [Git Worktrees](#git-worktrees).

## Global Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health, uptime, process count, and native file/Notes index availability |
| GET | `/api/config` | Server configuration |
| GET | `/api/config/runtime` | Runtime feature/provider flags and config revision; remote worktree capability via `gitWorktreeExecutionEnabled` |
| GET/PUT | `/api/preferences` | Read/update global UI preferences |
| GET | `/api/logs` | Server log ring buffer |
| GET | `/api/stats` | Token usage + cost stats |
| GET | `/api/agent-providers` | Copilot/Codex/Claude enabled + SDK availability. Codex auth is owned by the Codex SDK/CLI |
| GET | `/api/agent-providers/quota` | Cached provider quota snapshots where supported; `?force=1` refreshes live and updates the cache |

## Agent Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-providers/:provider/models` | Provider model catalog |
| GET/PUT | `/api/agent-providers/:provider/models/enabled` | Read/set enabled models |
| GET/PUT | `/api/agent-providers/:provider/models/reasoning-efforts` | Read/set per-model reasoning effort overrides |
| POST | `/api/agent-providers/:provider/models/query` | Test prompt against a provider model |

## Workspace Management

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/workspaces` | List / register workspaces |
| GET | `/api/workspaces/active` | Recent active-workspace reports by dashboard client |
| POST | `/api/workspaces/active` | Report selected workspace by `clientId`; `workspaceId: null` clears it |
| DELETE | `/api/workspaces/:id` | Unregister workspace |
| PATCH | `/api/workspaces/:id` | Update metadata; workspace mutations broadcast `workspace-topology-changed` |
| GET | `/api/workspaces/:id/git-info` | Cached branch, dirty state, upstream divergence and remote metadata |
| POST | `/api/git-info/batch` | Batched cached metadata for physical workspaces |
| GET/PATCH | `/api/workspaces/:id/preferences` | Read/update per-repo preferences |
| GET | `/api/workspaces/:id/instructions` | List custom instruction files for modes `base`, `ask`, `autopilot` |
| GET/PUT/DELETE | `/api/workspaces/:id/instructions/:mode` | Read/update/delete one instruction file (`base`\|`ask`\|`autopilot`; `plan` is an Ask alias) |
| GET/PUT/PATCH | `/api/workspaces/:id/language-servers` | Read/replace/merge config and sanitized runtime status. PUT defaults omitted fields; PATCH preserves them; invalid definitions → `400`, no write |
| POST | `/api/workspaces/:id/language-servers/retry` | Rediscover/retry opaque `sessionId`; unknown or cross-workspace session → `404`. See [language-servers.md](language-servers.md) |
| GET/PUT | `/api/workspaces/:id/llm-tools-config` | Disabled tools + `conversationRetrievalAvailable`; unknown tool names filtered |
| GET | `/api/workspaces/:id/summary` | Aggregated workspace summary |
| GET | `/api/workspaces/:id/endev/status` | Cached EnDev xDPU eligibility; `?refresh=true` revalidates |
| POST | `/api/workspaces/:id/endev/revalidate` | Force EnDev xDPU revalidation |
| POST | `/api/repo-groups` | Create virtual group; members must be registered non-virtual repos, description/read-only keys must be members |
| GET | `/api/repo-groups/:id` | Resolved membership and description/read-only metadata; missing members marked stale |
| GET | `/api/repo-groups/:id/search` | Search live member indexes by `q`; ranked cross-repo results and completeness status, `limit` 1–200 |
| PATCH | `/api/repo-groups/:id` | Rename/replace members; partially patch descriptions/read-only flags, pruning removed members |
| DELETE | `/api/repo-groups/:id` | Deregister group, retain its data |

## Canvases

Gated by `canvas.enabled` (default on). Mutations emit `canvas-updated` on WebSocket and owning-process SSE. See [spa/canvas.md](spa/canvas.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/canvases` | Descriptors only, newest first; `?processId=` filters to one chat process |
| GET | `/api/workspaces/:id/canvases/:canvasId` | Full record (descriptor + content) |
| PUT | `/api/workspaces/:id/canvases/:canvasId` | Save content/edits/title with optional `expectedRevision`; stale revision → `409 revision-conflict` with current canvas/revision |
| GET | `/api/workspaces/:id/canvases/:canvasId/versions` | Snapshot metadata (revision, editor, updatedAt) newest first; written per persisted revision, capped at 50 |
| GET | `/api/workspaces/:id/canvases/:canvasId/versions/:rev` | One full snapshot (metadata + content) |
| GET | `/api/workspaces/:id/canvases/:canvasId/comments` | Anchored comments; `?status=open\|sent\|resolved` |
| POST | `/api/workspaces/:id/canvases/:canvasId/comments` | Add anchored comment (anchor ≤500 chars, body ≤4000) |
| PATCH | `/api/workspaces/:id/canvases/:canvasId/comments/:cid` | Set status (`open`/`sent`/`resolved`) |
| DELETE | `/api/workspaces/:id/canvases/:canvasId/comments/:cid` | Delete comment |
| GET | `/api/workspaces/:id/canvases/:canvasId/extension` | Extension documents (`manifest`, `uiHtml`, `capabilitiesJs`) for an `extension`-type canvas |
| GET | `/api/workspaces/:id/canvases/:canvasId/files` | Read-only file metadata, ≤2000 entries; symlinks omitted |
| GET | `/api/workspaces/:id/canvases/:canvasId/files/<path>` | Text/base64 content; optional `encoding=base64`. Canonical containment rejects traversal/absolute/backslash/NUL/symlink escapes (`400`); missing → `404`; over 1 MB text/10 MB binary → `413` |
| POST | `/api/workspaces/:id/canvases/:canvasId/capabilities/:name` | Serialized, revision-checked state transform; sync 1s sandbox, async 30s terminable worker with `host.complete` gated by `features.canvasHostApis` (`404` off). Capability error → `422`; save race → `409` |

## Filesystem

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fs/browse` | Browse local directories for repo path selection |
| GET | `/api/fs/browse-helper` | Same-origin helper page for container-mode directory browsing |
| GET | `/api/fs/blob?path=<absolute>` | Read one file under CoC trusted data dirs (`~/.copilot`, server data dir, OS temp) or any registered workspace/repo root; arbitrary paths rejected |
| GET | `/api/workspaces/:id/files/preview?path=<path>` | Bounded preview; groups probe live members and return `resolvedWorkspaceId`. `resolve=true` returns file/folder metadata without content; `download=true` streams regular-file bytes with attachment headers. Both modes validate realpath containment; writes remain workspace-scoped |
| GET | `/api/workspaces/:id/files/html?path=<path>` | Serve a sandboxed HTML preview from the workspace, its repo output data, OS temp, `~/.copilot`, `~/.codex`, or `~/.claude`; canonical-path checks reject symlink escapes |
| GET | `/api/workspaces/:id/files/html/resolve?path=<path>` | Validate the same HTML allowlist and return `{ path }` with the canonical absolute path for a local desktop HTML tab |

## Repository browsing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos/:repoId/search/content` | Bounded content search with text/regex/glob filters. `fileScope=tracked` includes ignored tracked files; `includeUntracked` adds non-ignored files. Non-Git tracked search → `409 TRACKED_CONTENT_SEARCH_UNAVAILABLE` |

## Git

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/git/clone` | Clone a git URL into a parent directory with the server process's credentials; returns `clonedPath`, or `{ error }` on failure |
| GET | `/api/workspaces/:id/git/commits/:hash/files/*/diff-content` | First-parent/commit text snapshots (empty base for root); rename-aware, binary/submodule/symlink/10 MB guards. Missing → `404`; invalid hash → `400` |
| GET | `/api/workspaces/:id/git/branch-range/files/*/diff-content` | Merge-base/HEAD snapshots, `base=default-branch\|upstream`; same content guards. `modifiedMatchesWorkingCopy` rechecks clean HEAD and exact disk bytes, including cache hits |
| POST | `/api/workspaces/:id/git/fetch` | Fetch all or selected remote; `currentBranchOnly` fetches one validated upstream ref without tags, rejecting detached/missing/ambiguous upstream before network access |
| POST | `/api/workspaces/:id/git/pull` | Async pull, optional rebase; `currentBranchOnly` uses fetch's exact-upstream rules |
| POST | `/api/workspaces/:id/git/cherry-pick` | Pick `hash` or ordered `hashes` onto optional local `targetBranch`; cross-branch dirty tree → `409` |
| POST | `/api/workspaces/:id/git/patch/export` | Export `hash`/oldest-first `hashes` as one format-patch mailbox; sanitized source metadata, no root paths/credentials |
| POST | `/api/workspaces/:id/git/patch/apply` | One `git am --3way`; dirty → `409` unless `stashAndContinue`, conflict → `409` with `appliedCount`, leaving am paused |
| POST | `/api/workspaces/:id/git/rebase-reorder` | Enqueue Autopilot reorder of oldest-first commits; `202` task/job IDs, `409` unavailable/busy |
| GET | `/api/workspaces/:id/git/ops/latest` | Most recent git-op job, optional `?op=` filter; `null` when none |
| GET | `/api/workspaces/:id/git/ops/:jobId` | One git-op job scoped to the workspace; `404` when unknown |
| GET/POST | `/api/workspaces/:id/commit-chat-bindings` | List/create commit hash → chat task bindings (see [Chat bindings](#chat-bindings)) |
| GET/DELETE | `/api/workspaces/:id/commit-chat-bindings/:commitHash` | Read/remove one binding |
| POST | `/api/workspaces/:id/commit-chat-bindings/rebind` | Move `oldHash` → `newHash` and update process metadata; failed process update rolls binding back |
| POST | `/api/workspaces/:id/commit-chat-bindings/:commitHash/fresh` | Archive + clear the bound commit chat |

## Git Worktrees

Disabled-by-default `features.gitWorktreeExecution`. The target server creates isolated per-run worktrees from committed objects under workspace data: no network Git operations or source-branch switch; dirty source changes are excluded with a warning. See [ralph-launch.md](ralph-launch.md) and [spa/git-and-prs.md](spa/git-and-prs.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:workspaceId/worktrees` | Newest-first run worktree records; empty when flag off or data dir unavailable |
| POST | `/api/workspaces/:workspaceId/worktrees/:id/cleanup` | Idempotent non-force removal; retain branch. Flag off → `400`, unknown → `404`, active run/dirty Git refusal → `409`, record retained |

## Processes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes` | List processes (search/filter) |
| GET | `/api/processes/:id` | Detail; queued `queue_<taskId>` returns a synthetic process with launch metadata |
| PATCH | `/api/processes/:id` | Partial update. `metadata` replaces the stored object; `metadataPatch: { set?: object, unset?: string[] }` merges into current metadata. The two are mutually exclusive |
| DELETE | `/api/processes/:id` | Delete process |
| POST | `/api/processes/:id/message` | Follow-up with delivery/AI/style overrides. Style changes buffer a new turn, never steer in-flight output. Provider switch requires idle (`409 PROVIDER_SWITCH_REQUIRES_IDLE`); cancelled chats require strict resumable SDK binding (`409 SESSION_NOT_RESUMABLE`), never fresh fallback |
| POST | `/api/processes/:id/compact` | Idle provider result or durable `{ state: "queued" | "running", taskId }`; repeated pending requests retain the original instructions; execution validates the latest provider/session |
| DELETE | `/api/processes/:id/compact` | Cancel queued compaction only; `409 COMPACTION_NOT_QUEUED` after execution starts; later messages continue |
| PUT | `/api/processes/:id/auto-compact` | Sentinel chats only (`422 AUTO_COMPACT_SENTINEL_ONLY`); body `{ enabled, thresholdPercent }` (50–95, step 5); returns `{ autoCompact }`. A change clears pause and failure streak; never compacts by itself. `metadataPatch`/`metadata` cannot write `autoCompact` |
| POST | `/api/processes/:id/auto-compact/resume` | Clear a paused auto-compact state (`409 AUTO_COMPACT_NOT_CONFIGURED` when unset); the next response re-evaluates |
| POST | `/api/processes/:id/turns/:turnIndex/rewind` | Native-anchor rewind in active provider segment, serialized with admission. Earlier segment → `409 CROSS_PROVIDER_REWIND_UNAVAILABLE`; non-idle → `409 CONVERSATION_NOT_IDLE` |
| POST | `/api/processes/:id/note` | Retarget Notes chat; normalized relative path must remain in workspace notes root and bound section (`400` otherwise). See [spa/notes.md](spa/notes.md) |
| POST | `/api/processes/:id/ask-user-response` | Resolve batch with answered, skipped or needs-context-deferred answers |
| POST | `/api/processes/:id/cancel` | Cancel running process |
| POST | `/api/processes/:id/promote-to-ralph` | Promote a completed ask-mode chat to a Ralph session ([ralph.md](ralph.md)) |
| PATCH | `/api/processes/:id/pin` | Pin/unpin process |
| PATCH | `/api/processes/:id/archive` | Archive/unarchive |
| GET | `/api/processes/:id/turns/pinned` | Pinned turns |
| DELETE | `/api/processes/:id/turns/:idx` | Soft-delete turn |
| PATCH | `/api/processes/:id/turns/:idx/restore` | Restore deleted turn |
| PATCH | `/api/processes/:id/turns/:idx/pin` | Pin a turn |
| PATCH | `/api/processes/:id/turns/:idx/archive` | Archive a turn |
| GET | `/api/workspaces/:id/group-pins` | Parent-group pins, newest first |
| PATCH | `/api/workspaces/:id/group-pins/:type/:groupId` | Pin/unpin group only; child metadata untouched |
| PUT | `/api/workspaces/:id/pin-order` | Reorder already-pinned chats/groups in this workspace; 1–500 unique entries, others skipped |
| GET | `/api/workspaces/:id/chat-folders` | Folders in manual order |
| POST | `/api/workspaces/:id/chat-folders` | Create at top; validate name/color |
| PATCH | `/api/workspaces/:id/chat-folders/:folderId` | Rename/recolor/reorder folder; run-group IDs → `404` |
| DELETE | `/api/workspaces/:id/chat-folders/:folderId` | Delete folder and unfile chats, retaining conversations |
| PATCH | `/api/processes/:id/folder` | File one process into a folder, or unfile with `folderId: null`. One folder per process. `400` when the folder belongs to another workspace |
| POST | `/api/processes/folder` | Batch file/unfile. Body `{ ids, folderId }`; ids that no longer exist are skipped and omitted from `updated` |

## Quick Ask Side-notes

Repo-scoped annotations outside conversation history; all routes take `?workspace=<id>`. `features.quickAskSidenotes` defaults on (`404` off); threads cap at 10 turns. See [spa/chat-conversation.md](spa/chat-conversation.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes/:processId/sidenotes?workspace=<id>` | List side-notes → `{ sidenotes }` |
| POST | `/api/processes/:processId/sidenotes?workspace=<id>` | Ask about selected turn text; persist annotation (`201`); AI failure/unavailable → `502`/`503` |
| POST | `/api/processes/:processId/sidenotes/:id/follow-up?workspace=<id>` | Append grounded answer to stored thread; empty → `400`, missing → `404`, cap → `409`, AI failure → `502`/`503` |
| DELETE | `/api/processes/:processId/sidenotes/:id?workspace=<id>` | Delete one side-note (`204`; `404` when missing) |

## Sentinel To-do Ledger

Bookkeeping per Sentinel chat in the parent workspace's `sentinel-todos.json` (partitioned by parent process ID; wiped with server data, never exported). `features.sentinelTodoLedger` defaults off (`404` off). `:workspaceId` is the parent chat's repo or group on the owning server; non-Sentinel or mismatched owners → `404`. Writes never start, retry, or cancel jobs. Change commits broadcast `sentinel-todos-changed` (`workspaceId`, `processId`, `ledgerRevision`, `itemId`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:workspaceId/sentinel-todos/:processId` | Ledger → `{ revision, items }`; each item's `jobs[]` link carries a derived `execution` (remote → `unavailable`) |
| POST | `/api/workspaces/:workspaceId/sentinel-todos/:processId/items` | Create (`201`), optional immutable `type: 'normal' \| 'manual'` defaults to normal; untyped stored items read as normal without rewriting; a repeated `idempotencyKey` returns the original (`200`) |
| PATCH | `/api/workspaces/:workspaceId/sentinel-todos/:processId/items/:itemId` | Edit with required `expectedRevision`; `type` patches → `400 invalid`; `null` clears `targetRepo`/`statusReason`/`outcome`; stale → `409 { code: 'conflict', current }`; failed write → `500` with no event |

REST writes are always actor `user` (no caller-supplied actor; unknown keys → `400`). A person may set `done` without a reason; newly marking Done without `outcome` drops the earlier outcome. Non-user actors (Sentinel tool) setting `done`/`needs_attention` without `statusReason` → `invalid`. Manual archive/restore are user-only in the shared store; direct manual job links reject, and result recording/review lookup select normal items only.

Items carry `priority: 'high' | 'regular'` (create defaults to `regular`; items stored without it read as `regular` with no rewrite or revision bump). It is ledger metadata only — independent of status, never job queue priority or list order. A priority-only `PATCH` leaves status, reason and outcome unchanged and does not count as a user edit that supersedes a linked job's result; other values → `400 invalid`.

`coc-client` exposes these as `client.sentinelTodos.get/create/update` (contracts in `contracts/sentinel-todos.ts`); a conflict surfaces as `CocApiError` with `code: 'conflict'` and `body.current`.

## Task Groups

Generic parent/child task registry shared by For Each, Map Reduce, Ralph, and Dreams. Always registered (no feature flag).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/task-groups` | Visible task-group summaries (group record + child links with roles). `type=` filters by group type; `includeHidden=true` includes linkage-only groups (Dream runs) |
| GET | `/api/workspaces/:id/task-groups/:groupId` | One summary; `404` when unknown |

## Queue

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queue` | Queued/running tasks and pause markers |
| GET | `/api/queue/models` | Resolved default-provider model IDs and Auto routing diagnostics when enabled |
| GET | `/api/queue/:id` | Task or durable process-history reconstruction |
| GET | `/api/queue/history` | Live + durable history; Dream records retain analyzer/critic process IDs |
| POST | `/api/queue` | Enqueue with [Provider overrides](#provider-overrides); Ask/Autopilot or internal Ralph routing, not UI-only `for-each`. `chatStyle` persists; omitted uses server default, explicit `default` injects nothing. `config.prGate.autoMerge` starts a persisted PR chain |
| POST | `/api/workspaces/:id/queue/generate` | Enqueue a Generate Plan chat task with Ask semantics. Accepts `provider`, `model`, `reasoningEffort` through the shared chat validation path |
| POST | `/api/queue/:id/retry` | Fresh-chat restart of failed/cancelled Ask/Autopilot, preserving images/workspace. Optional provider resets AI defaults/routing. `201` task; unsupported non-chat/orchestrated runs or non-failed source → `409` |
| POST | `/api/queue/pause` | Pause queue processing globally or per repo (`workspace`/`repoId` query). Body: empty for indefinite, `{ durationHours }` (number in `(0, 24]`), or `{ until }` timestamp |
| POST | `/api/queue/resume` | Resume queue processing globally or per repo |
| POST | `/api/queue/repo-gate/release` | Release the active implement-plan PR gate for the required `workspace`/`repoId` query and resume that repo. Returns `409` when the repo has no active gate |
| POST | `/api/queue/pause-autopilot` | Pause automatic autopilot admission globally or per repo; same timed-pause body as `/api/queue/pause` |
| POST | `/api/queue/resume-autopilot` | Resume automatic autopilot admission globally or per repo |
| POST | `/api/queue/task-delay` | Global/per-repo cooldown for `all`/`autopilot`: 1–1440 integer minutes, null clears |
| POST | `/api/queue/task-delay/skip` | Release active cooldown, retain configuration; global/per-repo |
| POST | `/api/queue/pause-marker` | Insert after queue index, optional repo and `(0,24]` hours; timer starts on consumption, omitted duration needs manual resume |
| DELETE | `/api/queue/pause-marker/:markerId` | Remove a queued pause marker before the executor reaches it |
| DELETE | `/api/queue/:id` | Cancel a queued or running task |

## Ralph Sessions

All launch/continue/resume bodies take [Provider overrides](#provider-overrides); an explicit `config.effortTier` suppresses recovered model/reasoning-effort unless those fields are also explicit.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/processes/:id/ralph-start` | Start after grilling; optional worktree created before queue admission, reused for iterations/resume/final-check |
| POST | `/api/ralph-launch` | Direct launch; optional goal `folderPath`, execution `workingDirectory` (defaults via `workspaceId`), custom `title` (trimmed, 80 chars), target-server worktree opt-in |
| GET | `/api/workspaces/:wsId/ralph-sessions/attention` | Awaiting-input count, independent of seen-state |
| GET | `/api/workspaces/:wsId/ralph-sessions/:sessionId` | Journal, progress, files and recovered resume defaults |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/continue` | Extend a completed session (CAP_REACHED or NO_SIGNAL) by N iterations, preserving the prior concrete provider/model when recoverable |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/new-cron` | New goal cron after RALPH_COMPLETE, preserving prior provider/model when recoverable |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/resume` | Resume a stuck executing session (no in-flight task), preserving prior provider/model/reasoning-effort when recoverable |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/input` | Submit index-aligned answers and enqueue next iteration; wrong phase/duplicate → `409` |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/stop` | Stop awaiting-input as `USER_STOPPED`; retain Submit PR |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/submit-pr` | Submit completed-session commits through Autopilot using workspace defaults; incomplete/in-flight/duplicate submit → `409` |

## For Each Runs

Workspace-scoped, `forEach.enabled` default off; `client.forEach`. Reviewed plans use non-AI create; approval and execution are separate. [Provider overrides](#provider-overrides) apply.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/for-each-runs` | List runs with item status counts |
| POST | `/api/workspaces/:id/for-each-runs` | Create reviewed draft from `originalRequest`, `childMode`, `items`; no AI |
| POST | `/api/workspaces/:id/for-each-runs/generate` | AI-generate/persist draft from `prompt`, `childMode` |
| GET | `/api/workspaces/:id/for-each-runs/:runId` | Read run with reviewed item plan/state |
| PUT | `/api/workspaces/:id/for-each-runs/:runId/plan` | Replace the draft plan and optional shared instructions / child mode before approval |
| POST | `/api/workspaces/:id/for-each-runs/:runId/approve` | Mark the draft approved; approval does not enqueue child chats |
| POST | `/api/workspaces/:id/for-each-runs/:runId/start` | Start an approved run by enqueueing the next runnable item as a normal Ask/Autopilot child chat |
| POST | `/api/workspaces/:id/for-each-runs/:runId/continue` | Explicitly resume pending work (no auto-resume on server startup) |
| POST | `/api/workspaces/:id/for-each-runs/:runId/items/:itemId/retry` | Retry a failed item as a new child chat, overwriting that item's active child task/process link |
| POST | `/api/workspaces/:id/for-each-runs/:runId/items/:itemId/skip` | Mark a failed/pending item skipped and continue with the next runnable item |
| POST | `/api/workspaces/:id/for-each-runs/:runId/cancel` | Cancel remaining work, mark pending/running items skipped, cancel the active child task when available |

## Map Reduce Runs

Workspace-scoped, `mapReduce.enabled` default off; `client.mapReduce`. Map chats run up to `maxParallel`; reduce follows completed/skipped maps. [Provider overrides](#provider-overrides) apply.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/map-reduce-runs` | List runs with map item status counts and reduce status |
| POST | `/api/workspaces/:id/map-reduce-runs` | Create reviewed draft from request, child mode, reduce instructions and items; no AI |
| POST | `/api/workspaces/:id/map-reduce-runs/generate` | AI-generate/persist map/reduce draft from prompt and child mode |
| GET | `/api/workspaces/:id/map-reduce-runs/:runId` | Read run with reviewed map plan/state and reduce-step state |
| PUT | `/api/workspaces/:id/map-reduce-runs/:runId/plan` | Replace the draft map plan and optional shared instructions, reduce instructions, `maxParallel`, or child mode before approval |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/approve` | Mark the draft approved; approval does not enqueue child chats |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/start` | Start an approved run by enqueueing up to `maxParallel` runnable map items as child chats |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/continue` | Explicitly resume pending map work or the pending reduce step (no auto-resume on startup) |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/items/:itemId/retry` | Retry a failed map item as a new child chat, overwriting its active child link |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/items/:itemId/skip` | Mark a failed/pending map item skipped and continue with the next runnable item or the reduce step |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/reduce/retry` | Retry a failed reduce step as a new child chat |
| POST | `/api/workspaces/:id/map-reduce-runs/:runId/cancel` | Cancel remaining work, mark pending/running map items skipped, cancel a pending/running/failed reduce step and active child tasks |

## Native Copilot Sessions

Read-only server-local CLI store; `features.nativeCliSessions` defaults off. No native-store writes; explicit import alone adds CoC history. HTTP `200` reports `feature-disabled` or `db-missing`/`db-invalid`. Workspace scope matches cwd root/descendants or case-insensitive origin repository. `client.nativeCopilotSessions`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/native-copilot-sessions` | Newest-first list with text/session/branch/date filters, limit 50/max 200, offset. `scope=all` import picker bypasses workspace/dedup hiding and tags existing imports; absent FTS yields no text hits, not failure |
| GET | `/api/workspaces/:id/native-copilot-sessions/:sessionId` | Metadata, turns and reconstructed conversation (JSONL, else text-only DB fallback); unknown/out-of-workspace → `404` |
| POST | `/api/workspaces/:id/native-copilot-sessions/:sessionId/import` | Import any native session as resumable completed chat in selected workspace; `201` new, `200` existing, disabled/unknown → `404`, unreadable DB → `503` |

## Native CLI Sessions

Unified read-only Copilot/Codex/Claude views, same live gate; `client.nativeCliSessions`. Provider defaults to Copilot. HTTP `200` reports `feature-disabled` or `store-missing`/`store-invalid`; workspace SDK IDs are deduplicated. Copilot uses SQLite search; Codex/Claude scan JSONL (`searchIndexAvailable: false`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/native-cli-sessions?provider=copilot\|codex\|claude` | Filtered/paginated workspace list, provider/search strategy/counts; unknown/planned provider → `400` |
| GET | `/api/workspaces/:id/native-cli-sessions/:sessionId?provider=copilot\|codex\|claude` | Provider-tagged metadata and reconstructed conversation; invalid provider → `400`, unknown/out-of-workspace → `404` |

## Dreams

Workspace-scoped; `dreams.enabled` defaults off and generation needs workspace opt-in. Cards record review intent/artifact links, never mutate other domains. See [spa/routes.md](spa/routes.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/dreams/cards` | Visible cards by default. `includeHidden=true` adds candidate/approved/dismissed/converted/superseded history; `status=visible,approved` filters |
| GET | `/api/workspaces/:id/dreams/cards/:cardId` | Card detail: source ranges, confidence, fingerprint, dedup rationale |
| POST | `/api/workspaces/:id/dreams/run` | Enqueue read-only `dream-run` (`202`); AI/threshold/limit/timeout controls; persist analyzer/critic links |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/approve` | Mark a visible card approved (intent only, no next action) |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/dismiss` | Dismiss a visible card, optionally recording `dedupRationale` |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/convert` | Mark a visible/approved card converted with `{ artifactType, artifactId, artifactUrl? }` |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/supersede` | Mark a candidate/visible card superseded with required `dedupRationale` and optional `supersededByCardId` |

## Decisions

Always registered; evaluates caller-supplied state without repository reads, independently of chat-provider defaults.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/workspaces/:id/decisions/evaluate` | Noul/Choice/Score evaluation; isolated fixed-model Copilot, no MCP/tools/permissions, 120s timeout per initial/repair attempt and disconnect abort. ≤256 KiB/64 questions, unsafe keys rejected; `typesafe` → `501`, failure/unavailable/timeout → `502`/`503`/`504` |

## Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/schedules` | List / create schedule |
| PUT/DELETE | `/api/schedules/:id` | Update / delete schedule |
| POST | `/api/schedules/:id/run` | Trigger immediate run |
| GET | `/api/schedules/:id/runs` | Run history |
| POST | `/api/schedules/refine` | AI-refine prompt-routine instructions (`{ instructions, hint?, model? }` → `{ refined, raw }`) |

Prompt schedules use Ask/Autopilot (`plan` aliases Ask). Optional provider persists into queued runs; empty uses server default. Invalid provider → `400` on create, ignored in repo YAML.

## Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/workspaces/:id/tasks` | List tasks / create task file |
| GET/PUT/DELETE | `/api/workspaces/:id/tasks/:path` | Read / update / delete task |
| GET/POST | `/api/workspaces/:id/tasks/:path/comments` | List / add task comments |

## Notes

Read/write/comment/search/image endpoints accept an optional `root` query or body param scoping to a specific notes root; omit it for the default managed root. Page create and rename normalize filenames by appending `.md` when absent; mutation responses return the effective path.

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/workspaces/:id/notes` | Note tree / create note |
| POST | `/api/workspaces/:id/notes/ai-create` | Enqueue AI note creation. Body: `prompt`, optional `chatTaskId`, optional inherited `lensChat` marker when Lens Chat mode is active |
| GET/PUT/DELETE | `/api/workspaces/:id/notes/:path` | Read / update / delete note |
| GET | `/api/workspaces/:id/notes-git/status` | Default-root Git status/divergence, no fetch. `hasUpstream` is a local ref check; push/sync additionally require configured `notesGit.remoteUrl` |
| POST | `/api/workspaces/:id/notes-git/commit` | Git commit (default root only) |
| GET/POST/DELETE | `/api/workspaces/:id/notes/roots` | List configured + task-derived roots; add / remove a repo-folder root |
| POST/GET | `/api/workspaces/:id/notes/image` | Upload/serve images ≤10 MB or PDFs ≤50 MB; serve cached paper PDFs, never text extraction sidecars |
| GET | `/api/workspaces/:id/notes/chat-bindings` | Bindings keyed by note or section folder |
| GET/PUT/DELETE | `/api/workspaces/:id/notes/chat-bindings/by-path?path=` | Read/remove binding; PUT widens existing chat to section scope, without enqueue |
| POST | `/api/workspaces/:id/notes/paper-ingest` | Cache arXiv PDF/text in selected root; UI auto-interception flag does not gate this route |

### Multi-Root Notes

Default managed root plus ≤10 configured workspace-repo subfolders and protected task-derived roots. Opaque task IDs resolve server-side per workspace; client paths are not authority. Non-default operations reject absolute/drive/UNC/parent paths and canonical symlink escapes; scans omit symlinks. Task roots do not consume the limit or modify settings. Git routes use only the default root; sidecars for workspace files stay in workspace data. See [spa/notes.md](spa/notes.md).

## Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/workspaces/:id/workflows` | List / create workflow |
| GET/PUT/DELETE | `/api/workspaces/:id/workflows/:name` | Read / update / delete workflow |

## Skills

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/skills` | Priority-merged workspace/global/configured/auto-detected skills; earlier source wins |
| GET | `/api/workspaces/:id/skills/:name` | Skill detail from any merged source, same folder settings and precedence as the list route |
| POST | `/api/workspaces/:id/skills/install` | Install skill |
| GET | `/api/workspaces/:id/skills/:name/file?path=<rel>` | Read a file inside a skill folder |
| DELETE | `/api/workspaces/:id/skills/:name` | Delete skill |
| GET | `/api/skills` | List global skills |
| POST | `/api/skills/install` | Install global skill |
| GET | `/api/skills/config` | Disabled skills, managed directory and global folder-source settings |
| PUT | `/api/skills/config` | Save disabled skills and optional extra folders/auto-detection; invalidate source caches |
| GET | `/api/skills/effective-paths` | Read-only search-order diagnostics; optional known `workspaceId` adds repo sources, unknown falls back to global-only |

Only managed install sources are writable; extra/auto-detected folders are read-only. Resolution/settings: [admin-config.md](admin-config.md).

## Memory

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/memory/config` | Read/update memory configuration |
| GET/PUT | `/api/memory/bounded/:level` | Read/write bounded memory |
| DELETE | `/api/repos/:repoId/memory` | Wipe repo memory |
| GET | `/api/repos/:repoId/memory/entries` | List memory entries |
| GET | `/api/workspaces/:id/memory/v2/facts` | List/search Memory V2 facts (`q`, repeated `status`, `limit`) |
| POST | `/api/workspaces/:id/memory/v2/facts` | Create an explicit fact |
| PATCH | `/api/workspaces/:id/memory/v2/facts/:factId` | Update content, importance, tags, or status |
| DELETE | `/api/workspaces/:id/memory/v2/facts/:factId` | Delete a fact |
| GET | `/api/workspaces/:id/memory/v2/review` | Facts pending review |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/approve` | Approve a review fact; body may include edited `content` |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/reject` | Reject a review fact |
| GET | `/api/workspaces/:id/memory/v2/episodes` | List episodes (`limit`) |
| GET | `/api/workspaces/:id/memory/v2/export` | Export active-scope facts and episodes |
| DELETE | `/api/workspaces/:id/memory/v2/wipe` | Wipe active-scope facts and episodes; body requires `{ "confirm": true }` |

## Pull Requests

Follows [Origin scoping](#origin-scoping). Detail and subresource TTLs are per origin/PR; patch requests fetch current bytes through the selected clone. See [spa/git-and-prs.md](spa/git-and-prs.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/origins/:originId/pull-requests` | Clone-backed list/diff stats; warmed 60-min cache. `scope=team` filters origin roster before pagination; gated Team auto-classification may enqueue missing results |
| GET | `/api/origins/:originId/pull-requests/:prId` | Detail/base/head SHAs, 10-min cache; force refresh invalidates this PR's cached subresources |
| GET | `/api/origins/:originId/pull-requests/:prId/threads` | Comment threads; cached 10 min |
| GET | `/api/origins/:originId/pull-requests/:prId/reviewers` | Reviewers; cached 30 min unless `force=true` |
| GET | `/api/origins/:originId/pull-requests/:prId/commits` | PR commits; cached 30 min |
| GET | `/api/origins/:originId/pull-requests/:prId/checks` | CI/check statuses; cached 10 min |
| GET | `/api/origins/:originId/pull-requests/:prId/diff` | Plain-text unified diff; current authenticated provider bytes through selected clone |
| GET | `/api/origins/:originId/pull-requests/:prId/diff/files/:path` | Rust-selected provider chunk; `fullContext=true` tries selected checkout, reports current-hunk fallback |
| GET | `/api/origins/:originId/pull-requests/:prId/files/:path/content` | Base/head text from same-origin clone then authenticated provider fallback; rename-aware, binary/symlink/10 MB guards; typed unavailable → `502` |
| GET | `/api/origins/:originId/pull-requests/recent-opened` | Recently opened PR entries for the origin |
| POST | `/api/origins/:originId/pull-requests/recent-opened` | Record validated PR entry |
| DELETE | `/api/origins/:originId/pull-requests/recent-opened/:prNumber` | Remove entry |
| GET | `/api/origins/:originId/pull-requests/coworker-candidates` | Bounded clone-backed author search; `query` ≥2 chars, 2-min cache |
| GET | `/api/origins/:originId/pull-requests/coworker-roster` | Persisted Team roster coworkers |
| POST | `/api/origins/:originId/pull-requests/coworker-roster` | Add/update roster entry |
| DELETE | `/api/origins/:originId/pull-requests/coworker-roster/:coworkerKey` | Remove a coworker by provider id or displayName fallback key |
| POST | `/api/origins/:originId/pull-requests/team-auto-classification` | Gated low-priority classification of loaded Team PRs; concrete workspace required, ≤10 new enqueues, origin results |
| GET | `/api/origins/:originId/pull-requests/review-history` | Cached PR review history |
| POST | `/api/origins/:originId/pull-requests/review-history/refresh` | Clone-backed refresh of origin review history |
| GET | `/api/origins/:originId/pull-requests/suggestions` | Cached AI-ranked PR suggestions |
| POST | `/api/origins/:originId/pull-requests/suggestions/refresh` | Clone-backed AI ranking using origin review history |
| GET/PUT | `/api/origins/:originId/pull-requests/:prId/review-progress` | Read/save PR pop-out reviewer progress; `headSha` is required |
| GET/POST | `/api/origins/:originId/pull-request-chat-bindings` | List/create origin PR chat bindings |
| GET/DELETE | `/api/origins/:originId/pull-request-chat-bindings/:prId` | Read/remove one PR chat binding |
| POST | `/api/origins/:originId/pull-request-chat-bindings/:prId/fresh` | Archive/clear PR chat; concrete same-origin workspace required |

## Diff Classification

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/origins/:originId/classify-diff` | PR classification: `type=pr`, `identifier=<prId>:<headSha>`, concrete workspace; origin result/pending state |
| GET | `/api/origins/:originId/classify-diff` | Poll PR identifier: none/ready/running, optional result |
| POST | `/api/repos/:repoId/classify-diff` | Classify commit/branch-range; PR type rejected |
| GET | `/api/repos/:repoId/classify-diff` | Poll commit/branch-range result under resolved origin; PR type rejected |
| GET | `/api/repos/:repoId/classify-diff/batch-status` | Read-only status for ≤200 commit/branch-range identifiers; PR type rejected |
| GET | `/api/origins/:originId/classify-diff/batch-status` | Read-only status for ≤200 PR identifiers |

## Crons

See [cron.md](cron.md). Gated by `cron.enabled` (default `false`).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/crons` | List crons for workspace |
| GET | `/api/workspaces/:id/crons/:cronId` | Get single cron |
| PATCH | `/api/workspaces/:id/crons/:cronId` | Update `description`, `prompt`, `intervalMs`, `model` |
| DELETE | `/api/workspaces/:id/crons/:cronId` | Cancel + soft-delete cron |
| POST | `/api/workspaces/:id/crons/:cronId/pause` | Pause cron (body `{ reason? }`) |
| POST | `/api/workspaces/:id/crons/:cronId/resume` | Resume paused cron |
| GET | `/api/crons` | List all crons server-wide |
| GET | `/api/crons/:cronId` | Get a cron by ID |

## MCP Settings

See [mcp-settings.md](mcp-settings.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/mcp-config` | Effective + source-separated MCP servers. `?forceReload=true` bypasses cache |
| PUT | `/api/workspaces/:id/mcp-config` | Partial patch of the MCP policy: `enabledMcpServers` and/or `enabledMcpTools`, applied by property presence. Returns the canonical resulting policy |

## Messaging

Server-global connection settings. IC3 direct operations require an explicit region; null/unconfigured makes them unavailable before network access, with no inferred/default region.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/messaging/teams/status` | Server-global bridge/MCP/OAuth status, fixed `channelReadBackend: graph`, `outboundBackend` (`graph` default / `mcp`), current `connectionId` (null while disconnected), and observability flag; `ic3Region: null` means unconfigured. Live answer-relay opt-out is `features.teamsAiAnswerRelay` in admin config (default on, runtime flag `teamsAiAnswerRelayEnabled`); it does not enable/connect the bridge |
| GET | `/api/messaging/teams/attempts` | Flag-gated (`features.teamsBridgeObservability`) newest-first safe connection summaries; `?offset=0&limit=20` (limit 1–100) returns `{attempts,total,nextOffset}`. Disabled → 404; invalid pagination → 400 |
| GET | `/api/messaging/teams/attempts/:id` | Flag-gated safe attempt detail: phases, bounded non-routine events, aggregate totals and poll/send health. Unknown UUID → 404; invalid ID → 400 |
| POST | `/api/messaging/teams/server` | Register or update the global `Microsoft Teams` HTTP MCP endpoint; body `{url}` (HTTPS) |
| POST | `/api/messaging/teams/config` | Save bridge settings; optional `outboundBackend: mcp \| graph` selects channel writes only, default Graph; roots/enabled replies always read via Graph. Optional `ic3Region: amer/emea/apac`, null clears, omitted preserves. Invalid → `400`; backend/region changes disconnect/require reconnect; disable stops polling |
| POST | `/api/messaging/teams/direct-message` | Explicit send-only IC3 operation; body `{chatId,recipientId,connectionId,content,contentType: text \| html}`. Requires enabled connected bridge, explicit region/account, current connection and fresh MCP `GetChat`/`ListChatMembers` proof of exact existing 1:1/current-account/intended-recipient membership. Accepted → `201` typed receipt; invalid/options → `400`, unavailable/rejected → `409`, unknown delivery → `502` with `outcome: unknown`. CoC attribution; no mentions/replies, creation, group/channel send, fallback/retry or inbound DM bot; no Graph chat consent |
| POST | `/api/messaging/teams/reconnect` | Connect the enabled bridge with cached MCP discovery OAuth and separately scoped, identity-pinned Graph read/write credentials; validates delegated read consent (`ChannelMessage.Read.All`) and reports sanitized actionable failures without MCP read fallback |
| GET | `/api/messaging/whatsapp/status` | Default-off WhatsApp manager status `{enabled,status,qr,error,groupJid,groupName,deviceName}` |
| POST | `/api/messaging/whatsapp/config` | Save `{enabled?,deviceName?,groupJid?,groupName?}`; enabling connects, disabling disconnects; returns `{ok:true}` |
| POST | `/api/messaging/whatsapp/reconnect` | Reconnect the enabled bot with optional `{repair:true}` to clear auth and return to QR; disabled → 409 |
| GET | `/api/messaging/whatsapp/groups` | Participating groups `{groups:[{jid,name}]}`; disabled → 409, disconnected → 503 |
| POST | `/api/messaging/whatsapp/groups` | Create/bind a group by `{name}`; disabled → 409, disconnected → 503 |

## Work Items

Core storage/cache is canonical-origin scoped; workspace aliases select the concrete clone. Mutations invalidate caches and broadcast both scopes when different. `syncLinks` input is rejected. Use REST/client commands, never direct storage writes. See [spa/work-items.md](spa/work-items.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/origins/:originId/work-items` | Filtered list, including inherited Epic `tracker`; warmed cache unless force |
| GET | `/api/origins/:originId/work-items/grouped` | Grouped by status, per-group pagination; warmed cache unless `force=true` |
| GET | `/api/origins/:originId/work-items/tree` | Tracker/content/status/type-filtered hierarchy, archive/done controls; warmed cache unless force |
| POST | `/api/origins/:originId/work-items` | Create; root Epic tracker defaults local-only. Provider-backed children create remote item/parent link before local mirror |
| GET | `/api/origins/:originId/work-items/:itemId` | Read work item |
| PATCH | `/api/origins/:originId/work-items/:itemId` | Update fields + optional [plan](#plan-versioning-on-patch); tracker only on root Epics. Provider edits precede local save; stale snapshot needs reviewed sync resolution |
| DELETE | `/api/origins/:originId/work-items/:itemId` | Delete work item |
| GET/PUT | `/api/origins/:originId/work-items/:itemId/plan` | Read/replace current plan; PUT creates immutable non-empty version, optional workspace |
| GET | `/api/origins/:originId/work-items/:itemId/plan/versions` | List immutable plan/content versions |
| GET | `/api/origins/:originId/work-items/:itemId/plan/versions/:version` | Read one version |
| GET | `/api/origins/:originId/work-items/:itemId/plan/versions/compare?base=N&target=M` | Compare two versions for a local-only `work-item`/`goal`. Requires `workItems.workflow.enabled` |
| POST | `/api/origins/:originId/work-items/:itemId/plan/versions/:version/restore` | Restore as new version; local-only work-item/goal, workflow gate required |
| POST | `/api/origins/:originId/work-items/:itemId/plan/refine` | AI-assisted current-plan refinement when a refinement invoker is configured |
| POST | `/api/origins/:originId/work-items/:itemId/execute` | Concrete workspace run, one-shot default; workflow local Goals default Ralph (local work-item/goal only). AI/skill overrides; worktree creation fails before enqueue |
| POST | `/api/origins/:originId/work-items/:itemId/ai-review` | Workflow-gated Review-state local work-item/goal; Ask code review leaves state unchanged |
| POST | `/api/origins/:originId/work-items/:itemId/submit-pr` | Workflow-gated Review-state local change with commits; clean registered clone, `gh` auth, no prior PR required. Success links PR and marks Done |
| POST | `/api/origins/:originId/work-items/:itemId/resolve-comments` | Resolve plan/commit comments through selected clone |
| GET | `/api/origins/:originId/work-items/:itemId/changes` | List plan-version/commit change records; optional `workspaceId` validates the clone. No workspace alias |
| POST | `/api/origins/:originId/work-items/:itemId/changes` | Create open change linked to plan version/task/base HEAD |
| PATCH | `/api/origins/:originId/work-items/:itemId/changes/:changeId` | Update change commits/status/completion/task/base HEAD |
| GET | `/api/origins/:originId/work-items/sync/status?workspaceId=:workspaceId` | Clone provider status; hierarchy + sync gates required. Omitted provider derives from remote; unsupported host reports none |
| POST | `/api/origins/:originId/work-items/import-from-github` | Clone-backed Epic issue/tree import; issue URL must match configured repository |
| POST | `/api/origins/:originId/work-items/import-from-azure-boards` | Clone-backed Epic/tree import; remote org/project precedes config, supplied URL must match |
| POST | `/api/origins/:originId/work-items/:itemId/convert-to-github?workspaceId=:workspaceId` | Publish local root Epic tree as linked GitHub issues |
| POST | `/api/origins/:originId/work-items/:itemId/convert-to-local?workspaceId=:workspaceId` | Detach GitHub mirrors; retain local history/plans/runs, leave remote issues untouched |
| POST | `/api/origins/:originId/work-items/:itemId/request-changes` | Incorporate review comments into plan and transition to ready-to-execute |
| PATCH | `/api/origins/:originId/work-items/:itemId/pin` | Pin/unpin item |
| PATCH | `/api/origins/:originId/work-items/:itemId/archive` | Archive/unarchive item |
| GET | `/api/workspaces/:id/work-items/tree` | Workspace-compatible tree route resolving to the canonical origin |
| GET/POST | `/api/workspaces/:id/work-items` | List/create at workspace's origin |
| GET | `/api/workspaces/:id/work-items/grouped` | Grouped list at workspace's origin |
| GET/PATCH/DELETE | `/api/workspaces/:id/work-items/:itemId` | Read/update/delete at workspace's origin |
| POST | `/api/workspaces/:id/work-items/:itemId/request-changes` | Review-comment plan update |
| PATCH | `/api/workspaces/:id/work-items/:itemId/pin` | Pin/unpin |
| PATCH | `/api/workspaces/:id/work-items/:itemId/archive` | Archive/unarchive |
| GET/PUT | `/api/workspaces/:id/work-items/:itemId/plan` | Read/replace immutable plan |
| GET | `/api/workspaces/:id/work-items/:itemId/plan/versions` | List versions |
| GET | `/api/workspaces/:id/work-items/:itemId/plan/versions/:version` | Read version |
| GET | `/api/workspaces/:id/work-items/:itemId/plan/versions/compare?base=N&target=M` | Workflow-gated version compare |
| POST | `/api/workspaces/:id/work-items/:itemId/plan/versions/:version/restore` | Workflow-gated restore as new version |
| POST | `/api/workspaces/:id/work-items/:itemId/plan/refine` | AI plan refinement |
| POST | `/api/workspaces/:id/work-items/:itemId/execute` | Run through this concrete workspace |
| POST | `/api/workspaces/:id/work-items/:itemId/ai-review` | Workflow-gated AI review |
| POST | `/api/workspaces/:id/work-items/:itemId/submit-pr` | Workflow-gated PR submission |
| POST | `/api/workspaces/:id/work-items/:itemId/resolve-comments` | Resolve comments in this clone |
| GET | `/api/workspaces/:id/work-items/sync/status` | Remote-derived provider status |
| POST | `/api/workspaces/:id/work-items/import-from-github` | Import GitHub Epic tree |
| POST | `/api/workspaces/:id/work-items/import-from-azure-boards` | Import Azure Boards Epic tree |
| POST | `/api/workspaces/:id/work-items/:itemId/convert-to-github` | Publish local Epic tree |
| POST | `/api/workspaces/:id/work-items/:itemId/convert-to-local` | Detach GitHub mirror |
| POST | `/api/workspaces/:id/work-items/from-chat` | Create item from chat |

### Work Item chat bindings

Shape per [Chat bindings](#chat-bindings); workspace-scoped callers resolve to their origin and migrate workspace rows on access.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/origins/:originId/work-item-chat-bindings` | List bindings for the origin |
| GET | `/api/origins/:originId/work-item-chat-bindings/:workItemId` | Read one; `404` when none |
| POST | `/api/origins/:originId/work-item-chat-bindings` | Create/replace; optional workspace validated against origin |
| DELETE | `/api/origins/:originId/work-item-chat-bindings/:workItemId` | Remove (missing is a no-op) |
| POST | `/api/origins/:originId/work-item-chat-bindings/:workItemId/fresh` | Archive/clear chat; concrete same-origin workspace required |
| GET/POST | `/api/workspaces/:id/work-item-chat-bindings` | List/create origin bindings through workspace |
| GET/DELETE | `/api/workspaces/:id/work-item-chat-bindings/:workItemId` | Read/remove binding |
| POST | `/api/workspaces/:id/work-item-chat-bindings/:workItemId/fresh` | Archive/clear chat through workspace |

### Tracker identity

Root Epics own `tracker.kind`: `local-only`, `github-backed`, or `azure-boards-backed`. Descendants inherit identity; individual mirrors retain provider IDs/revisions, never credentials. Tracker edits on non-root items and public `syncLinks` are invalid.

### Provider sync

`workItems.sync.enabled` defaults off: local saves persist, provider writes/pollers stop. A changed live snapshot yields `WORK_ITEM_SYNC_CONFLICT`; reviewed retry supplies GitHub `acknowledgedRemoteUpdatedAt` or Azure `acknowledgedRemoteRevision`, which must still match. Provider-owned fields sync; plans/history/runs/commits stay local. Pollers act only on imported workspace roots and may prune deleted remote trees.

### Provider registration and mapping

GitHub/Azure visibility derives from the workspace remote host, not configuration alone. Auth uses external `gh`/Azure CLI, without stored tokens/PATs. Azure remote org/project precedes configured fallback; conflicting values produce mismatch status. Operations use explicit imports/conversions and background polling, not a manual pull endpoint.

### Plan versioning on PATCH

PATCH accepts fields plus `plan.content` (non-whitespace Markdown), creating the next immutable version/change and updating current-version pointers. PUT plan uses the same requirement; restore creates a new version. Runs carry the exact `planVersion`.

### Execution routes

Origin `/execute`, `/submit-pr`, `/ai-review`, `/resolve-comments` require same-origin `workspaceId` in body/query. Queue, Git, task/comment files use that clone; history/changes/cache/events use origin. Workspace aliases supply the clone through `:id`; changes and AI authoring remain origin-only. Workflow Goal grilling is queue-driven, not a separate endpoint.

### AI Authoring

`workItems.aiAuthoring.enabled` defaults off. Origin-only routes require body `workspaceId` for concrete clone context. Draft generation is ephemeral (clarification or draft); explicit apply persists with revision gates.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/origins/:originId/work-items/ai-draft` | Draft new item from prompt; ≤3 clarification rounds |
| POST | `/api/origins/:originId/work-items/:itemId/ai-draft` | Draft improvement to fields/goal/child tasks |
| POST | `/api/origins/:originId/work-items/:itemId/ai-draft/apply` | Generate/apply local work-item version; AI authoring + workflow gates. `baseUpdatedAt`/optional `baseContentVersion` checked before and after generation; stale → `409 WORK_ITEM_AI_DRAFT_STALE` |

## Seen State

| Method | Path | Description |
|--------|------|-------------|
| GET/PATCH | `/api/workspaces/:id/seen-state` | Get / update seen state |
| DELETE | `/api/workspaces/:id/seen-state/:processId` | Clear process seen state |
| GET | `/api/workspaces/:id/seen-state/count` | Unseen count |

## LLM Tools

| Method | Path | Description |
|--------|------|-------------|
| GET/PUT | `/api/workspaces/:id/llm-tools-config` | Get / update tool config |

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
| SSE | `/api/processes/:id/stream` | GET named JSON events; initial conversation snapshot, live output, heartbeat, terminal status + `done`. `?warm=1` sends only warm status/heartbeats, stays open across terminal status |

Streams belong to the owning server/clone. SSE framing preserves split UTF-8 and multiline data; native CLI session endpoints are JSON transcript views, not live streams. REST CORS reflects only loopback origins; WebSocket rejects non-loopback browser origins. See [streaming-architecture.md](streaming-architecture.md).

## Remote Servers

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/servers` | List / register remote servers |
| DELETE | `/api/servers/:id` | Remove server |
| POST | `/api/servers/:id/test` | Test connection |
| POST | `/api/servers/:id/connect` | Connect (DevTunnel) |
| POST | `/api/servers/:id/disconnect` | Disconnect |
| POST | `/api/servers/cherry-pick-transfer` | Export/apply oldest-first commit(s) across selected server/workspace pair; omitted/local server means current, remote must be online/registered. Propagate dirty/conflict/counts; omit effective URLs/local paths |

## Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/status` | Sync status (`enabled`, `inProgress`, `lastSyncTime`, `lastError`) |
| POST | `/api/sync/trigger` | Force immediate notes sync |

# REST API

CoC server exposes HTTP endpoints organized by domain. All routes are registered via `registerAllRoutes()` in `src/server/routes/index.ts`.

## Conventions

These rules apply across the catalog; rows below state only what is specific to them.

### Provider overrides

Chat-launching bodies accept optional `provider`, `config.model`, `config.reasoningEffort`, `config.effortTier` (`very-low`\|`low`\|`medium`\|`high`), and `autoProviderRouting`. An omitted provider resolves through Auto when `features.autoAgentProviderRouting` is enabled, and the resolved concrete provider is stored on the owning record. Explicit `config.model` / `config.reasoningEffort` take precedence over `effortTier`, which is expanded from the provider's tier map and not stored. Chat modes are `ask` and `autopilot`; `plan` inputs are accepted as an Ask alias.

### Origin scoping

`/api/origins/:originId/*` routes are keyed by canonical origin. Two rules:

- **Provider-hitting routes** require a `workspaceId` query/body param naming the concrete clone the provider call runs through, and accept optional `repoId`; the selection must resolve to `originId` or the request is rejected.
- **Origin-file routes** (recent-opened, coworker-roster, review-history, suggestions, review-progress, chat bindings, classification files) take `workspaceId`/`repoId` as *optional* metadata, used only to migrate a matching workspace/repo-scoped file into the origin file on access.

Caches are keyed per canonical origin (plus PR/item id and `headSha` where noted); `force=true` bypasses and invalidates them.

### Chat bindings

Commit, PR, and Work Item binding families share one shape: `GET`/`POST` on the collection lists or creates a binding, `GET`/`DELETE` on `/:key` reads or removes one (removal of a missing binding is a no-op), and `POST /:key/fresh` archives the currently bound chat process and clears the binding so the next send starts an empty chat — a stale binding whose process is already gone is cleared and returns `archivedTaskId: null`.

### Feature gates

Flag-gated domains return unavailable/not-found behavior when the flag is off; specific codes are noted per section.

### Worktree opt-in

Execution routes (`/execute`, `/api/ralph-launch`, `/api/processes/:id/ralph-start`) accept `worktree: { enabled: true, baseRef? }` when `features.gitWorktreeExecution` is on. Omitting it keeps in-place execution; a malformed value returns `400`. See [Git Worktrees](#git-worktrees).

## Global Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | `{ status, uptime, processCount, nativeFileIndex, nativeNotesIndex }`; each native status is `{ loaded, binaryPath?, reason? }`. File indexing may use its JavaScript fallback; Notes content search requires its native capability at startup |
| GET | `/api/config` | Server configuration |
| GET | `/api/config/runtime` | Dashboard feature flags + config revision: provider flags, `defaultProvider`, `autoAgentProviderRoutingEnabled`, `pullRequestsAutoClassifyTeamEnabled`, `workItemsWorkflowEnabled`, `gitWorktreeExecutionEnabled` (also the remote-target UI's worktree-execution capability signal) |
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
| GET | `/api/workspaces/active` | Dashboard clients' recent active-workspace reports: `activeWorkspaceIds` + per-client `lastSeenAt` |
| POST | `/api/workspaces/active` | Report a client's selected workspace. Body `{ clientId, workspaceId }`; `workspaceId: null` clears that client |
| DELETE | `/api/workspaces/:id` | Unregister workspace |
| PATCH | `/api/workspaces/:id` | Update metadata. Register/update/unregister broadcast `workspace-topology-changed`, decoupled from process activity |
| GET | `/api/workspaces/:id/git-info` | Cached branch, dirty, upstream divergence, repository, persisted remote metadata. Live reads use one porcelain-v2 status; failures use bounded cache backoff |
| POST | `/api/git-info/batch` | Cached Git metadata for multiple physical workspaces, bounded concurrency. Optional `trigger` appears only in privacy-safe diagnostics (counts, cache outcomes, Git process count, duration) |
| GET/PATCH | `/api/workspaces/:id/preferences` | Read/update per-repo preferences |
| GET | `/api/workspaces/:id/instructions` | List custom instruction files for modes `base`, `ask`, `autopilot` |
| GET/PUT/DELETE | `/api/workspaces/:id/instructions/:mode` | Read/update/delete one instruction file (`base`\|`ask`\|`autopilot`; `plan` is an Ask alias) |
| GET/PUT | `/api/workspaces/:id/llm-tools-config` | Read/update per-workspace disabled LLM tools. Response adds `conversationRetrievalAvailable`, derived from the process store's conversation-search support. Unknown tool names such as `create_bug` are filtered from responses and from rewritten preferences |
| GET | `/api/workspaces/:id/summary` | Aggregated workspace summary |
| GET | `/api/workspaces/:id/endev/status` | Cached EnDev xDPU eligibility; `?refresh=true` revalidates |
| POST | `/api/workspaces/:id/endev/revalidate` | Force EnDev xDPU revalidation |
| POST | `/api/repo-groups` | Create a repo-group virtual workspace. Body `{ name, members: [workspaceId...] }`; members must be registered non-virtual repo workspaces (`400` otherwise). Registers `group-<slug>` rooted at `~/.coc/repos/<groupId>/`, wires queue bridge + schedule manager, broadcasts `workspace-topology-changed` `added`. Returns `201 { workspace, members }` |
| GET | `/api/repo-groups/:id` | Membership file + registry-resolved members; unregistered or missing-path members come back `stale` with `staleReason` |
| PATCH | `/api/repo-groups/:id` | Rename and/or replace membership (same validation as create; rename syncs the workspace name). Broadcasts `updated` |
| DELETE | `/api/repo-groups/:id` | Deregister the group workspace (broadcasts `removed`); its data directory stays on disk |

## Canvases

Chat canvas side panel, gated by `canvas.enabled` (default on). Markdown or code artifacts (`type` + optional `language` on the descriptor) the AI and user co-edit; AI edits go through the canvas LLM tools, these routes serve the dashboard panel. Every mutation goes through `CanvasMutationService`, emitting one `canvas-updated` WebSocket event plus a ProcessStore/SSE update on the owning process.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/canvases` | Descriptors only, newest first; `?processId=` filters to one chat process |
| GET | `/api/workspaces/:id/canvases/:canvasId` | Full record (descriptor + content) |
| PUT | `/api/workspaces/:id/canvases/:canvasId` | User save. Body `{ content?, edits?, expectedRevision?, title? }`; stale revision → `409 { error: 'revision-conflict', currentRevision, canvas }` |
| GET | `/api/workspaces/:id/canvases/:canvasId/versions` | Snapshot metadata (revision, editor, updatedAt) newest first; written per persisted revision, capped at 50 |
| GET | `/api/workspaces/:id/canvases/:canvasId/versions/:rev` | One full snapshot (metadata + content) |
| GET | `/api/workspaces/:id/canvases/:canvasId/comments` | Anchored comments; `?status=open\|sent\|resolved` |
| POST | `/api/workspaces/:id/canvases/:canvasId/comments` | Add comment. Body `{ anchorText, body }` (anchor ≤500 chars, body ≤4000) |
| PATCH | `/api/workspaces/:id/canvases/:canvasId/comments/:cid` | Set status (`open`/`sent`/`resolved`) |
| DELETE | `/api/workspaces/:id/canvases/:canvasId/comments/:cid` | Delete comment |
| GET | `/api/workspaces/:id/canvases/:canvasId/extension` | Extension documents (`manifest`, `uiHtml`, `capabilitiesJs`) for an `extension`-type canvas |
| GET | `/api/workspaces/:id/canvases/:canvasId/files` | Read-only data files: `{ files: [{ path, size, encoding }] }`, sorted, recursive, symlinks omitted, ≤2000 entries; `404` for unknown canvas |
| GET | `/api/workspaces/:id/canvases/:canvasId/files/<path>` | `{ file: { path, size, encoding, content } }`; `encoding` is `utf-8` for text else `base64`, `?encoding=base64` forces bytes (other values `400`). Layered path safety (encoded-escape screen on the raw pathname → shape → resolve → `isWithinDirectory` → `realpath` re-verify): `400` for traversal, absolute paths, backslashes, NUL, escaping symlinks; `404` missing file/dir; `413` over 1 MB text / 10 MB binary |
| POST | `/api/workspaces/:id/canvases/:canvasId/capabilities/:name` | Invoke a declared capability against the canvas JSON state. Sync capabilities run as a vm-sandboxed pure transform (1s budget); `async: true` capabilities run in a terminable `worker_threads` worker (30s budget, `host.complete`) and `404` unless `features.canvasHostApis` is on. Runs are serialized per canvas and re-read the canvas inside the critical section, so concurrent invocations both land; revision-checked write. `422` on capability error, `409` on a concurrent user save |

## Filesystem

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/fs/browse` | Browse local directories for repo path selection |
| GET | `/api/fs/browse-helper` | Same-origin helper page for container-mode directory browsing |
| GET | `/api/fs/blob?path=<absolute>` | Read one file under CoC trusted data dirs (`~/.copilot`, server data dir, OS temp) or any registered workspace/repo root; arbitrary paths rejected |
| GET | `/api/workspaces/:id/files/preview?path=<path>` | Read a bounded text/image/directory preview with resolved absolute `path` and `resolvedWorkspaceId`. Regular relative paths anchor at the workspace root. A repo-group accepts absolute paths inside live registered member roots and probes a relative path under each live member root in membership order, selecting the first existing contained candidate; a miss lists attempted paths. Removed or missing-path members are skipped. Non-group scope and all write routes remain workspace-scoped |

## Git

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/git/clone` | Clone a git URL into a parent directory with the server process's credentials; returns `clonedPath`, or `{ error }` on failure |
| POST | `/api/workspaces/:id/git/fetch` | Fetch remote refs. `{ currentBranchOnly: true }` resolves the checked-out branch's configured upstream remote/merge ref at request time, validates one exact `refs/heads/...` source ref, and fetches only that branch with no automatic tags; detached HEAD or missing/multiple/malformed upstream refs fail without network access. Without the flag, omitted `remote` fetches all remotes and `{ remote }` fetches that remote's configured refs |
| POST | `/api/workspaces/:id/git/pull` | Start an async pull job. Body `{ rebase?, currentBranchOnly? }`; `currentBranchOnly` applies the same exact-upstream resolution and failure rules as fetch |
| POST | `/api/workspaces/:id/git/cherry-pick` | Body `{ hash }` picks one commit onto current HEAD; `{ hash, hashes, targetBranch }` applies multiple commits in caller order onto a local target branch. Cross-branch picks need a clean tree and return `409 { dirty: true }` otherwise |
| POST | `/api/workspaces/:id/git/patch/export` | Export commits as a format-patch payload for cross-clone picks. Body `{ hash }` or `{ hashes }` (oldest-first, concatenated into one `git am` mailbox; range responses add ordered `sourceCommits` and set `sourceCommit` to the first). Response carries source workspace/commit metadata, normalized source remote URL, and `{ format: 'format-patch', body }` — no source root paths or raw remote credentials |
| POST | `/api/workspaces/:id/git/patch/apply` | Apply a payload in one `git am --3way` session. Body `{ patch: { format: 'format-patch', body }, stashAndContinue?, sourceServer?, sourceWorkspace?, sourceCommit?, sourceCommits?, normalizedSourceRemoteUrl? }`. Dirty target → `409 { dirty: true }` unless `stashAndContinue` is true; conflict → `409 { conflicts: true, appliedCount }` with the target left paused in the `am`; success returns target branch, new HEAD/commit hash, `appliedCount`, and a target-scoped `cherry-pick-transfer` git-op record with sanitized source/target metadata |
| POST | `/api/workspaces/:id/git/rebase-reorder` | AI-driven interactive reorder. Body `{ commits }` (oldest-first); enqueues an autopilot chat task, returns `202 { taskId, jobId }`. `409` with no queue bridge or a reorder already running. The tracking job settles from queue events: completed → `success`, failed → `failed`, cancelled/removed → `interrupted` |
| GET | `/api/workspaces/:id/git/ops/latest` | Most recent git-op job, optional `?op=` filter; `null` when none |
| GET | `/api/workspaces/:id/git/ops/:jobId` | One git-op job scoped to the workspace; `404` when unknown |
| GET/POST | `/api/workspaces/:id/commit-chat-bindings` | List/create commit hash → chat task bindings (see [Chat bindings](#chat-bindings)) |
| GET/DELETE | `/api/workspaces/:id/commit-chat-bindings/:commitHash` | Read/remove one binding |
| POST | `/api/workspaces/:id/commit-chat-bindings/rebind` | Move a binding from `oldHash` to `newHash` after amend/rebase and update the bound process's `metadata.commitChat.commitHash` (keeping any saved commit message). Resolves bare and `queue_`-prefixed task IDs; a failed process update rolls the binding back and errors |
| POST | `/api/workspaces/:id/commit-chat-bindings/:commitHash/fresh` | Archive + clear the bound commit chat |

## Git Worktrees

Opt-in isolated-worktree execution for Work Item and Ralph runs, gated by the disabled-by-default `features.gitWorktreeExecution` flag (runtime flag `gitWorktreeExecutionEnabled`). The **target** server (owner of the workspace checkout) creates a per-run worktree under `~/.coc/repos/<workspaceId>/git-worktrees/<runId>/` on a fresh `coc/<slug>-<shortid>` branch based on committed objects only — no fetch/pull/push/rebase, no source-branch switch. Uncommitted source changes are excluded and a warning is surfaced. Records live in `git-worktrees/index.json` and are exposed by `@plusplusoneplusplus/coc-client` as `client.git.listWorktrees` / `client.git.cleanupWorktree`. See [ralph.md](ralph.md) and [spa/git-and-prs.md](spa/git-and-prs.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:workspaceId/worktrees` | CoC-created worktree records, newest first: `id`, `workspaceId`, `path`, `branch`, requested `baseRef`, resolved `baseSha`, `createdAt`, `sourceDirty` (+ optional `sourceDirtyWarning`), `processId`/`ralphSessionId`, `status` (`active`\|`cleaned`), `cleanedAt`. `{ worktrees: [] }` when the flag is off or no data dir is configured |
| POST | `/api/workspaces/:workspaceId/worktrees/:id/cleanup` | `git worktree remove` (never `--force`) + mark record `cleaned`; returns `{ worktree, alreadyCleaned }`. The generated branch is never deleted. `400` flag off, `404` unknown record, `200` idempotent when already cleaned, `409` while a linked task/session runs, `409` with the raw Git error (record intact) when Git refuses removal (e.g. dirty worktree). No force/discard path |

## Processes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes` | List processes (search/filter) |
| GET | `/api/processes/:id` | Process detail. A `queue_<taskId>` id whose task is still queued returns a synthetic process whose `metadata` mirrors `{ type, queueTaskId, mode, workspaceId, commitChat, chatStyle }` so the SPA can resolve mode and style before the executor starts (`chatStyle` omitted when absent or unknown) |
| PATCH | `/api/processes/:id` | Partial update. `metadata` replaces the stored object; `metadataPatch: { set?: object, unset?: string[] }` merges into current metadata. The two are mutually exclusive |
| DELETE | `/api/processes/:id` | Delete process |
| POST | `/api/processes/:id/message` | Follow-up message. Body: `content`, optional `mode` (`ask`\|`autopilot`, `plan` accepted as Ask), `deliveryMode`, `images`, `skillNames`, `model`, per-turn `reasoningEffort` (`low`\|`medium`\|`high`\|`xhigh`), and `chatStyle` (`default`\|`human`\|`direct`\|`structured`; omitted falls back to `features.defaultChatStyle`). An unknown `chatStyle` is rejected `400` (an unknown `reasoningEffort` is dropped). A style differing from `metadata.chatStyle` is never steered into an in-flight response — it is buffered as the next pending turn so that turn gets a freshly built system message — and becomes the conversation style thereafter. A `cancelled` process is accepted only with a saved `sdkSessionId`; the continuation binds to that session for strict resume, else `409 SESSION_NOT_RESUMABLE`. `metadata.stoppedChatResume.resumable === false` also returns `409 SESSION_NOT_RESUMABLE`, so a failed strict resume cannot be retried or converted to a fresh session |
| POST | `/api/processes/:id/note` | Retarget a Notes chat at another note. Body `{ notePath, noteTitle? }`; rewrites `metadata.notePath` / `metadata.noteTitle`, which is what follow-up turns read when they snapshot the note for the inline diff. `notePath` is normalized (no traversal, no absolute) and re-checked against the workspace's notes root; when `metadata.noteChatScope` is `per-section` it must also stay inside the bound folder. Anything else is `400` and the chat stays put. See [spa/notes.md](spa/notes.md) |
| POST | `/api/processes/:id/ask-user-response` | Resolve the active ask-user batch. Body `{ batchId, answers }`; each answer has `questionId` plus `answer`, `skipped: true`, or `deferred: true` with `reason: "needs-context"` and optional `note` |
| POST | `/api/processes/:id/cancel` | Cancel running process |
| POST | `/api/processes/:id/promote-to-ralph` | Promote a completed ask-mode chat to a Ralph session ([ralph.md](ralph.md)) |
| PATCH | `/api/processes/:id/pin` | Pin/unpin process |
| PATCH | `/api/processes/:id/archive` | Archive/unarchive |
| GET | `/api/processes/:id/turns/pinned` | Pinned turns |
| DELETE | `/api/processes/:id/turns/:idx` | Soft-delete turn |
| PATCH | `/api/processes/:id/turns/:idx/restore` | Restore deleted turn |
| PATCH | `/api/processes/:id/turns/:idx/pin` | Pin a turn |
| PATCH | `/api/processes/:id/turns/:idx/archive` | Archive a turn |
| GET | `/api/workspaces/:id/group-pins` | Workspace-scoped parent-row group pins (Ralph session, For Each run, Map Reduce run groups), newest pin first |
| PATCH | `/api/workspaces/:id/group-pins/:type/:groupId` | Pin/unpin a parent group row. `type` is an open string: `ralph-session`, `for-each-run`, `map-reduce-run`, or any registered task-group type; body `{ pinned: boolean }`. Updates only the group pin record, never child pin/archive metadata |
| GET | `/api/workspaces/:id/chat-folders` | User-created chat folders, in manual order (`sortIndex` asc, ties on `createdAt` desc) |
| POST | `/api/workspaces/:id/chat-folders` | Create a folder at the top (`sortIndex 0`; the rest shift down). Body `{ name, color? }`; `400` on an empty/over-60-char name or unknown color |
| PATCH | `/api/workspaces/:id/chat-folders/:folderId` | Rename / recolor / reorder. Body `{ name?, color?, sortIndex? }`. A non-folder group id is `404` — run groups are not mutable here |
| DELETE | `/api/workspaces/:id/chat-folders/:folderId` | Delete a folder; no conversations are deleted. Returns `{ deleted, unfiled }` — the process ids that became unfiled |
| PATCH | `/api/processes/:id/folder` | File one process into a folder, or unfile with `folderId: null`. One folder per process. `400` when the folder belongs to another workspace |
| POST | `/api/processes/folder` | Batch file/unfile. Body `{ ids, folderId }`; ids that no longer exist are skipped and omitted from `updated` |

## Quick Ask Side-notes

Per-process AI lookups on assistant chat turns: a text selection triggers a cheap grounded ask whose answer is stored as a repo-scoped annotation and never enters the conversation. A side-note can be followed up on, growing a persisted `turns` thread (turn 0 mirrors `question`/`answer`, capped at `MAX_TURNS_PER_SIDENOTE` = 10). Gated by the live admin flag `features.quickAskSidenotes` (default `true`); disabled → `404`. Storage: `{dataDir}/repos/<workspaceId>/chat-sidenotes/<sha256(processId)>.json`. All routes take `?workspace=<id>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes/:processId/sidenotes?workspace=<id>` | List side-notes → `{ sidenotes }` |
| POST | `/api/processes/:processId/sidenotes?workspace=<id>` | Body `{ turnIndex, selectedText, contextBefore?, contextAfter?, question? }`. Builds a compact grounded prompt, runs the one-shot invoker (model from `defaultModels.quickAsk` > `defaultModel`), persists, returns `201 { sidenote }`. `502`/`503` on AI failure/unavailability |
| POST | `/api/processes/:processId/sidenotes/:id/follow-up?workspace=<id>` | Body `{ question }`. Reads the note's thread from disk as grounding history (client sends only the new question), appends the answered turn, returns `200 { sidenote }`. `400` empty question, `404` unknown note, `409` at the turn cap, `502`/`503` on AI failure |
| DELETE | `/api/processes/:processId/sidenotes/:id?workspace=<id>` | Delete one side-note (`204`; `404` when missing) |

## Task Groups

Generic parent/child task registry shared by For Each, Map Reduce, Ralph, and Dreams. Always registered (no feature flag).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/task-groups` | Visible task-group summaries (group record + child links with roles). `type=` filters by group type; `includeHidden=true` includes linkage-only groups (Dream runs) |
| GET | `/api/workspaces/:id/task-groups/:groupId` | One summary; `404` when unknown |

## Queue

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queue` | Queued/running tasks. Pause markers appear with `kind: 'pause-marker'`, `id`, `createdAt`, optional `durationHours` (number in `(0, 24]`, floats allowed). `dream-run` summaries carry provider, model, reasoning effort, and timeout metadata when resolved |
| GET | `/api/queue/models` | Model IDs for the resolved concrete default provider; with `features.autoAgentProviderRouting` it uses the enqueue-time Auto routing resolver and adds `autoProviderRouting` metadata (selected provider, fallback state, warnings, decision reasons) |
| GET | `/api/queue/:id` | One queue task, falling back to reconstructed process history for completed/historical tasks. Reconstructed `dream-run` tasks include analyzer/critic process IDs under `payload.processes` |
| GET | `/api/queue/history` | In-memory queue history merged with durable process history after restart. Store-backed `dream-run` entries include provider/model/reasoning/timeout metadata plus `payload.processes` |
| POST | `/api/queue` | Enqueue a task. Chat payloads use `mode='ask'`, `mode='autopilot'`, or internal Ralph routing (`mode='plan'` normalizes to Ask). For Each item-plan generation is a normal Ask chat with `payload.context.forEach.kind='generation'`; the UI-only `for-each` mode value is rejected by the generic validator. Optional `payload.chatStyle` (`default`\|`human`\|`direct`\|`structured`) is rejected `400` when unknown and copied into `process.metadata.chatStyle` at execution start; omitting it entirely falls back to the server-wide `features.defaultChatStyle`, while an explicit `default` always injects nothing. `config.effortTier` follows [Provider overrides](#provider-overrides). Notes chat edits may carry `payload.context.lensChat = { inherited: true, source: 'features.commitChatLens' }` when the Lens Chat flag is active; the marker is copied to process metadata |
| POST | `/api/workspaces/:id/queue/generate` | Enqueue a Generate Plan chat task with Ask semantics. Accepts `provider`, `model`, `reasoningEffort` through the shared chat validation path |
| POST | `/api/queue/:id/retry` | Re-run a failed/cancelled task by enqueueing a fresh copy from its preserved payload/config (recovery when a chat's first message failed before any resumable session existed). Accepts a bare task id or `queue_<taskId>`; strips `processId`/temp-attachment fields so the retry starts a new conversation. `201 { task }`; `404` not found, `409` when not failed/cancelled |
| POST | `/api/queue/pause` | Pause queue processing globally or per repo (`workspace`/`repoId` query). Body: empty for indefinite, `{ durationHours }` (number in `(0, 24]`), or `{ until }` timestamp |
| POST | `/api/queue/resume` | Resume queue processing globally or per repo |
| POST | `/api/queue/pause-autopilot` | Pause automatic autopilot admission globally or per repo; same timed-pause body as `/api/queue/pause` |
| POST | `/api/queue/resume-autopilot` | Resume automatic autopilot admission globally or per repo |
| POST | `/api/queue/pause-marker` | Insert a pause marker between queued items. Body `{ afterIndex?, repoId?, durationHours? }` (`durationHours` in `(0, 24]`). Indefinite markers pause until manual resume; timed markers start counting when the executor consumes the marker. `201 { markerId, afterIndex, durationHours? }` |
| DELETE | `/api/queue/pause-marker/:markerId` | Remove a queued pause marker before the executor reaches it |
| DELETE | `/api/queue/:id` | Cancel a queued or running task |

## Ralph Sessions

All launch/continue/resume bodies take [Provider overrides](#provider-overrides); an explicit `config.effortTier` suppresses recovered model/reasoning-effort unless those fields are also explicit.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/processes/:id/ralph-start` | Start Ralph execution after grilling. Optional `worktree` opt-in (see [Worktree opt-in](#worktree-opt-in)); worktree creation is fail-before-queue and the resolved path is persisted on the session record so all iterations/resume/final-check run in it |
| POST | `/api/ralph-launch` | Direct launch (skip grilling). Optional `folderPath` as goal source context and `workingDirectory` as explicit execution directory; omitted `workingDirectory` resolves from `workspaceId` via the multi-repo queue router. Optional `worktree` opt-in on the target server |
| GET | `/api/workspaces/:wsId/ralph-sessions/:sessionId` | Session journal: `record`, parsed progress `sections`, alphabetically ordered raw session `files`, optional transient `resumeDefaults` recovered from the latest iteration process for stuck-session Resume UI |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/continue` | Extend a completed session (CAP_REACHED or NO_SIGNAL) by N iterations, preserving the prior concrete provider/model when recoverable |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/new-cron` | New goal cron after RALPH_COMPLETE, preserving prior provider/model when recoverable |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/resume` | Resume a stuck executing session (no in-flight task), preserving prior provider/model/reasoning-effort when recoverable |
| POST | `/api/workspaces/:wsId/ralph-sessions/:sessionId/submit-pr` | Submit all commits of a `phase === 'complete'` session (any `terminalReason`) as a GitHub PR via an attached autopilot job; no body (workspace default provider/model). `409` when not complete, a Ralph task is in flight, or a submit is queued/running. Returns `{ submitted: true, sessionId, taskId, submitIndex }` and appends a `submits[]` record. Client: `workspaces.submitRalphPr()` |

## For Each Runs

Workspace-scoped, gated by `forEach.enabled` (default `false`). Parent run state lives under `~/.coc/repos/<workspaceId>/for-each-runs/<runId>/` as `run.json` + `items.json`, never as a Ralph session. Exposed via `client.forEach`. Visible item-plan generation chats are normal queue/process records whose metadata links to the eventual parent run; reviewed chat-backed plans use the non-AI create endpoint so approval persists exactly what the user reviewed. [Provider overrides](#provider-overrides) apply.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/for-each-runs` | List runs with item status counts |
| POST | `/api/workspaces/:id/for-each-runs` | Create a draft run from an already-reviewed plan without AI generation. Requires `originalRequest`, `childMode`, `items`; accepts `sharedInstructions`, `provider`, `config.model`/`config.reasoningEffort`, `generationProcessId`, `generationId` |
| POST | `/api/workspaces/:id/for-each-runs/generate` | Generate a structured JSON draft item plan and persist a draft run. Requires `prompt`, `childMode` (`ask`\|`autopilot`); accepts `sharedInstructions`, `provider`, `config.model`/`config.reasoningEffort` |
| GET | `/api/workspaces/:id/for-each-runs/:runId` | Read run with reviewed item plan/state |
| PUT | `/api/workspaces/:id/for-each-runs/:runId/plan` | Replace the draft plan and optional shared instructions / child mode before approval |
| POST | `/api/workspaces/:id/for-each-runs/:runId/approve` | Mark the draft approved; approval does not enqueue child chats |
| POST | `/api/workspaces/:id/for-each-runs/:runId/start` | Start an approved run by enqueueing the next runnable item as a normal Ask/Autopilot child chat |
| POST | `/api/workspaces/:id/for-each-runs/:runId/continue` | Explicitly resume pending work (no auto-resume on server startup) |
| POST | `/api/workspaces/:id/for-each-runs/:runId/items/:itemId/retry` | Retry a failed item as a new child chat, overwriting that item's active child task/process link |
| POST | `/api/workspaces/:id/for-each-runs/:runId/items/:itemId/skip` | Mark a failed/pending item skipped and continue with the next runnable item |
| POST | `/api/workspaces/:id/for-each-runs/:runId/cancel` | Cancel remaining work, mark pending/running items skipped, cancel the active child task when available |

## Map Reduce Runs

Workspace-scoped, gated by `mapReduce.enabled` (default `false`). State lives under `~/.coc/repos/<workspaceId>/map-reduce-runs/<runId>/` as `run.json`, `items.json`, `reduce-step.json`. Map items run as normal Ask/Autopilot child chats in parallel up to `maxParallel`; the reduce step runs as one child chat after all map items complete or skip. Exposed via `client.mapReduce`. [Provider overrides](#provider-overrides) apply to map and reduce orchestration.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/map-reduce-runs` | List runs with map item status counts and reduce status |
| POST | `/api/workspaces/:id/map-reduce-runs` | Create a draft run from an already-reviewed map plan without AI generation. Requires `originalRequest`, `childMode`, `reduceInstructions`, `items`; accepts `sharedInstructions`, `maxParallel`, `provider`, `config.model`/`config.reasoningEffort`, `generationProcessId`, `generationId` |
| POST | `/api/workspaces/:id/map-reduce-runs/generate` | Generate a structured JSON map plan plus reduce instructions and persist a draft run. Requires `prompt`, `childMode`; accepts `sharedInstructions`, `provider`, `config.model`/`config.reasoningEffort` |
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

Read-only compatibility views over the server user's native GitHub Copilot CLI session store (`~/.copilot/session-store.db`). Share the disabled-by-default `features.nativeCliSessions` live guard with the unified CLI Sessions API, so one switch covers native Copilot/Codex/Claude browsing. CoC opens the SQLite store read-only with short-lived per-request connections, never writes to it, and never imports native sessions into CoC process history. Disabled/unavailable states return HTTP 200 typed payloads: `{ enabled: false, reason: 'feature-disabled' }`, or `{ enabled: true, available: false, reason: 'db-missing' | 'db-invalid' }`. Workspace scoping matches native `sessions.cwd` against the registered workspace root (equal or descendant) or native `sessions.repository` against the workspace's origin-remote `owner/repo` (case-insensitive). Exposed as `client.nativeCopilotSessions`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/native-copilot-sessions` | Workspace-matching sessions sorted by newest `updated_at`. Query: `q` (text search via the native `search_index` FTS table with match snippets; parameterized literal-quoted terms), `sessionId` (exact or partial), `branch`, `from`/`to` ISO bounds, `limit` (default 50, max 200), `offset`. Response: `items` (summary preview + turn counts), `total`, `searchIndexAvailable` (false when the FTS table is absent — text queries then return no hits non-fatally), `deduplicatedCount` (sessions hidden because `sessions.id` matches a CoC process `sdk_session_id`), `backgroundJobCount` (automated background-job sessions hidden by first-turn or stored-summary prompt match, e.g. title summarization) |
| GET | `/api/workspaces/:id/native-copilot-sessions/:sessionId` | One session: metadata, full stored summary, turns ordered by `turn_index` with per-turn char counts and search-index diagnostics (`searchIndexSourceId`/`searchIndexChars`, null when unindexed). Always returns `conversation`: a reconstructed `ReconstructedConversationTurn[]` built from `session-state/<id>/events.jsonl` when available, else mapped from flat DB turns as text-only user/assistant turns. Out-of-workspace or unknown IDs → `404` |

## Native CLI Sessions

Unified read-only, workspace-scoped views over native Copilot (`~/.copilot/session-store.db`), Codex (`~/.codex/sessions`), and Claude Code (`~/.claude/projects`) stores. Gated by the disabled-by-default live `features.nativeCliSessions` flag; exposed as `client.nativeCliSessions`. `provider=copilot|codex|claude` selects the backing store and defaults to `copilot`. Disabled/unavailable states return HTTP 200 typed payloads `{ enabled: false, reason: 'feature-disabled' }` or `{ enabled: true, available: false, reason: 'store-missing' | 'store-invalid' }`. Deduplicates against `ProcessStore.getSdkSessionIds(workspaceId)`. Codex and Claude text search is on-demand substring scanning over JSONL and reports `searchIndexAvailable: false`; Copilot delegates to the native SQLite provider.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/native-cli-sessions?provider=copilot\|codex\|claude` | List workspace-matching sessions. `provider` is validated against the shared descriptor registry: unknown id → `400` listing every known id; a provider staged as `planned` (currently `opencode`) → `400` with its descriptor note. Query also accepts `q`, `sessionId`, `branch`, `from`/`to`, `limit`, `offset`. Response: provider-tagged `items`, `total`, `searchStrategy` (`native-index`\|`on-demand-scan`\|`unavailable`), `searchIndexAvailable`, `deduplicatedCount`, `backgroundJobCount`, `limit`, `offset` |
| GET | `/api/workspaces/:id/native-cli-sessions/:sessionId?provider=copilot\|codex\|claude` | One session: provider-tagged metadata, `searchStrategy`, store path, reconstructed `conversation: ReconstructedConversationTurn[]`. Same provider validation; unknown or out-of-workspace → `404` |

## Dreams

Workspace-scoped, gated by `dreams.enabled` (default `false`); generation also requires the workspace's `preferences.dreams.enabled` opt-in. Cards are review records only: approval records user intent, conversion records an explicit artifact link, and no route mutates skills, prompts, notes, memory, work items, or code.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/dreams/cards` | Visible cards by default. `includeHidden=true` adds candidate/approved/dismissed/converted/superseded history; `status=visible,approved` filters |
| GET | `/api/workspaces/:id/dreams/cards/:cardId` | Card detail: source ranges, confidence, fingerprint, dedup rationale |
| POST | `/api/workspaces/:id/dreams/run` | Enqueue a visible queue-backed `dream-run` task for a manual read-only pass. Body accepts `provider`, `config.model`, `config.reasoningEffort`, `confidenceThreshold`, `maxCandidates`, `conversationLimit`, `timeoutMs`; returns `202 { task }`. Run records persist resolved provider/model/reasoning/timeout metadata, source coverage, and analyzer/critic process IDs; the outer process result and metadata carry those IDs so `/api/processes/:id`, `/api/queue/:id`, and `/api/queue/history` surface analyzer/critic prompts after restart |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/approve` | Mark a visible card approved (intent only, no next action) |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/dismiss` | Dismiss a visible card, optionally recording `dedupRationale` |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/convert` | Mark a visible/approved card converted with `{ artifactType, artifactId, artifactUrl? }` |
| POST | `/api/workspaces/:id/dreams/cards/:cardId/supersede` | Mark a candidate/visible card superseded with required `dedupRationale` and optional `supersededByCardId` |

## Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/schedules` | List / create schedule |
| PUT/DELETE | `/api/schedules/:id` | Update / delete schedule |
| POST | `/api/schedules/:id/run` | Trigger immediate run |
| GET | `/api/schedules/:id/runs` | Run history |
| POST | `/api/schedules/refine` | AI-refine prompt-routine instructions (`{ instructions, hint?, model? }` → `{ refined, raw }`) |

Prompt schedules expose Ask and Autopilot modes; stored or incoming entries with `mode='plan'` read as Ask at runtime, requiring no data migration. They also accept an optional `provider` override (`copilot`\|`codex`\|`claude`\|`opencode`); omitted/empty means the server default. It round-trips through create/update, `schedules.json`, and repo-defined `.github/schedules/*.yaml`, and is passed to the enqueued chat/Ralph payload so the run executes under that provider. Invalid values are rejected `400` on create and ignored when parsing repo YAML.

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
| GET | `/api/workspaces/:id/notes-git/status` | Git status (default root only): working-tree state plus `hasUpstream`, `ahead`, `behind` (local commits vs `origin/<branch>`, computed with no fetch; null without a tracking ref). `hasUpstream` reflects only a local `origin/<branch>` ref, which can outlive a cleared `notesGit.remoteUrl`, so consumers surfacing push state must also require a configured `notesGit.remoteUrl` — push/sync routes `400` without it |
| POST | `/api/workspaces/:id/notes-git/commit` | Git commit (default root only) |
| GET/POST/DELETE | `/api/workspaces/:id/notes/roots` | List configured + task-derived roots; add / remove a repo-folder root |
| POST/GET | `/api/workspaces/:id/notes/image` | Upload/serve note attachments (`notes-image-handler.ts`): images ≤10 MB plus `application/pdf` ≤50 MB. Repo-folder roots co-locate in `<root>/.images/`; the default root uses `.attachments/`. GET also serves `.papers/<id>.pdf` cached-paper artifacts from the selected root, never the adjacent `.papers/*.txt` extraction sidecars |
| GET | `/api/workspaces/:id/notes/chat-bindings` | List note-chat bindings for the workspace. Keys are note paths under `per-note` scope and **folder paths** under `per-section` scope; `useNotesChat` resolves as `perNoteMap[folder] ?? perNoteMap[notePath]` |
| GET/PUT/DELETE | `/api/workspaces/:id/notes/chat-bindings/by-path?path=` | Read / bind / remove one binding. `PUT` (body `{ taskId }`) exists for one case: widening an existing per-note chat to section scope, which re-keys the chat onto its folder with no new enqueue behind it. Bindings are otherwise created as a side effect of enqueue. See [spa/notes.md](spa/notes.md) |
| POST | `/api/workspaces/:id/notes/paper-ingest` | arXiv paper ingest. Body `{ url, root? }`; caches `.papers/<id>.pdf` plus a best-effort `.papers/<id>.txt` sidecar in the selected root. Available independently of UI feature flags — the disabled-by-default live `features.arxivPaperIngest` flag gates only automatic interception of a lone arXiv link pasted into the editor |

### Multi-Root Notes

Up to **10** additional notes roots per workspace — subfolders inside the workspace git repo. The default managed root (`~/.coc/repos/<workspaceId>/notes/`) is always present. Task directories are exposed as protected roots: the repo-scoped `tasks/` directory, `<workspace>/.vscode/tasks`, and relative or absolute paths from `tasks-settings.json#folderPaths`.

- **Root resolution:** default root via `getRepoDataPath(dataDir, workspaceId, 'notes')`; repo-folder roots via `<workspace-git-root>/<relative-path>`; task-derived roots via opaque `task:<sha256>` identities recomputed from the selected workspace's canonical directories per request. A client path or task identity is never filesystem authority. Non-default-root operations reject POSIX absolute, Windows drive/UNC, and parent-reference paths, treat both slash styles as separators, and check the canonical existing path prefix so symlinks cannot escape; tree and search scans omit symlink entries.
- **Task-root discovery:** missing task directories are omitted, canonical duplicates collapse with primary > legacy > configured label priority, and a task-derived protected entry hides an overlapping normal Notes root. Discovery writes neither `additionalNotesRoots` nor task settings and does not count toward the 10-root limit.
- **Git ops** apply only to the default root; repo-folder roots inherit the workspace repo's git.
- **Comment / paper-annotation sidecars** (`notes-sidecar-resolver.ts`) sit next to the note only when it lives under `~/.coc/repos/<workspaceId>/` or `~/.copilot`. Repo-folder roots, and default-root notes opened by absolute path inside the workspace git repo (chat scratchpad files), store sidecars at `~/.coc/repos/<workspaceId>/notes-comments/<encoded-bucket>/<note-path>` so the workspace repo stays clean. The access check runs on the *note* path (allowed: workspace data dir, `~/.copilot`, workspace git root).
- **PDFs** render inline in the notes editor via the `pdfBlock` Tiptap node.
- **System folders** (e.g. Plans) are auto-created only in the default root.
- User-configured roots persist in `PerRepoPreferences.additionalNotesRoots`; task-derived roots stay owned by task settings.

## Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/workspaces/:id/workflows` | List / create workflow |
| GET/PUT/DELETE | `/api/workspaces/:id/workflows/:name` | Read / update / delete workflow |

## Skills

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/skills` | Skills merged for the workspace, in priority order: repo-local `.github/skills` → managed global `~/.coc/skills` → configured global extra folders (`source: 'global-extra-folder'`, tagged `folderPath`) → per-repo extra/linked-repo folders → auto-detected OneDrive/CloudStorage folders. Every detected OneDrive root probes `.github/skills` before `skills`; name collisions resolve to the earlier source |
| GET | `/api/workspaces/:id/skills/:name` | Skill detail from any merged source, same folder settings and precedence as the list route |
| POST | `/api/workspaces/:id/skills/install` | Install skill |
| GET | `/api/workspaces/:id/skills/:name/file?path=<rel>` | Read a file inside a skill folder |
| DELETE | `/api/workspaces/:id/skills/:name` | Delete skill |
| GET/POST | `/api/skills`, `/api/skills/install` | List / install global skills |
| GET | `/api/skills/config` | `{ globalDisabledSkills, globalSkillsDir, globalExtraFolders, autoDetectDefaultFolders }`. `globalDisabledSkills` from `preferences.json`; `globalSkillsDir` is the managed install dir (`dataDir/skills`, normally `~/.coc/skills`); the last two come from the config file's `skills` namespace (defaulting to `[]` / `true` when absent or malformed) |
| PUT | `/api/skills/config` | Body `{ globalDisabledSkills, globalExtraFolders?, autoDetectDefaultFolders? }`. `globalDisabledSkills` persists to `preferences.json`; when present, `globalExtraFolders` (array of strings) and `autoDetectDefaultFolders` (boolean) merge into the config file's `skills` namespace via whole-file load-merge-write. Folder-source changes invalidate cached workspace skill lists. Returns the GET shape |
| GET | `/api/skills/effective-paths` | Read-only diagnostic of the agent's effective skill search order. Global-only by default; `?workspaceId=<id>` adds repo-local + per-repo extra folder paths and echoes the resolved `workspaceId` (unknown ids fall back to global-only with no echo). Returns `{ workspaceId?, paths: EffectiveSkillPath[] }`, each `{ source, scope, status, path, skillCount?, note? }`. Declared-but-missing sources are retained so the UI can explain them; every existing `.github/skills` or `skills` container under a detected OneDrive root is reported, a root with neither convention gets one `skipped` entry, and an absent root stays silent |

`/api/skills/config` and `/api/skills/effective-paths` are registered before the catch-all `/api/skills/:name` and reserved in `RESERVED_GLOBAL_SKILL_NAMES` so the detail route never swallows them. CoC installs/deletes only into the managed `globalSkillsDir`; configured global extra folders, auto-detected OneDrive/CloudStorage folders, and per-repo extra folders are read-only sources. Resolution order and the three consumers (execution, diagnostic, UI listing) are documented in [admin-config.md](admin-config.md).

`EffectiveSkillPath.source` ∈ `repo` \| `managed-global` \| `auto-detected` \| `configured` \| `repo-extra` \| `bundled`; `status` ∈ `available` \| `no-skills` \| `missing` \| `skipped`; `scope` ∈ `global` \| `workspace`.

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

Follows [Origin scoping](#origin-scoping). Cache TTLs below are per canonical origin and PR id.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/origins/:originId/pull-requests` | List PRs through the selected clone. Rows carry `diffStats` (`additions`, `deletions`, `changedFiles`) when the provider exposes diffs, plus `fetchedAt`; served from the active-workspace background-warmed in-memory cache for 60 min unless `force=true`. Rows and diff stats are cached by canonical origin, status/scope, PR id, and `headSha` when present; no diff contents are durably stored. `scope=team` fetches provider `scope=all`, supplements with best-effort per-roster-member queries (`login`, else provider id), filters by the origin-scoped Team roster before pagination, and reports the filtered total. With Pull Requests, focused diff, and `pullRequests.autoClassifyTeam` enabled, loaded open Team PRs with `headSha` opportunistically enqueue missing low-priority diff classifications |
| GET | `/api/origins/:originId/pull-requests/:prId` | PR detail, cached 10 min by origin + PR id, including provider `baseSha`/`headSha` when available. `force=true` refreshes only this PR and invalidates its detail, subresource, provider combined diff, and diff-stats entries |
| GET | `/api/origins/:originId/pull-requests/:prId/threads` | Comment threads; cached 10 min |
| GET | `/api/origins/:originId/pull-requests/:prId/reviewers` | Reviewers; cached 30 min unless `force=true` |
| GET | `/api/origins/:originId/pull-requests/:prId/commits` | PR commits; cached 30 min |
| GET | `/api/origins/:originId/pull-requests/:prId/checks` | CI/check statuses; cached 10 min |
| GET | `/api/origins/:originId/pull-requests/:prId/diff` | Plain-text provider unified diff; the combined diff is cached with no TTL by origin, PR id, and resolved `headSha` when available |
| GET | `/api/origins/:originId/pull-requests/:prId/diff/files/:path` | `{ diff }` extracted from the origin-scoped combined diff cache. `fullContext=true` attempts full-file local git context in the selected checkout and falls back with `fullContextUnavailable` metadata |
| GET | `/api/origins/:originId/pull-requests/recent-opened` | Recently opened PR entries for the origin |
| POST | `/api/origins/:originId/pull-requests/recent-opened` | Record an entry after successful validation/open; body includes `number`, `title`, optional `webUrl` |
| DELETE | `/api/origins/:originId/pull-requests/recent-opened/:prNumber` | Remove an entry (per-entry remove control and automatic stale cleanup on a confirmed 404) |
| GET | `/api/origins/:originId/pull-requests/coworker-candidates` | Search open PR authors for Team roster candidates through the selected clone. Requires `query` (min 2 chars); optional `status`, `scope`, `top`, `includeRoster`. Calls provider list pagination directly with a bounded page/result cap, skips diff-stat enrichment, caches provider-backed results 2 min per clone/query/status/scope, and returns de-duplicated candidates with `id`, `displayName`, optional `login`, `email`, `avatarUrl`, plus `prCount` and `isInRoster` |
| GET | `/api/origins/:originId/pull-requests/coworker-roster` | Persisted Team roster coworkers |
| POST | `/api/origins/:originId/pull-requests/coworker-roster` | Add/update a roster coworker; body includes `displayName`, optional `id`, `login`, `email`, `avatarUrl` |
| DELETE | `/api/origins/:originId/pull-requests/coworker-roster/:coworkerKey` | Remove a coworker by provider id or displayName fallback key |
| POST | `/api/origins/:originId/pull-requests/team-auto-classification` | Manually trigger the bounded Team PR auto-classification helper used by list/background-warm paths. Requires the live Team auto-classification gate plus explicit `workspaceId` (optional `repoId`); body includes loaded PR list items. Returns counts for eligible/considered/skipped/ready/running/started/notFound/errors, reads/writes classification result and pending state under `originId`, uses low priority, caps each call at 10 new enqueues |
| GET | `/api/origins/:originId/pull-requests/review-history` | Cached PR review history |
| POST | `/api/origins/:originId/pull-requests/review-history/refresh` | Fetch provider review history through an explicit `workspaceId` (optional `repoId`) and cache it under the origin |
| GET | `/api/origins/:originId/pull-requests/suggestions` | Cached AI-ranked PR suggestions |
| POST | `/api/origins/:originId/pull-requests/suggestions/refresh` | Rank open PRs through an explicit `workspaceId` (optional `repoId`) using origin-scoped cached review history, persisting suggestions under the same origin |
| GET/PUT | `/api/origins/:originId/pull-requests/:prId/review-progress` | Read/save PR pop-out reviewer progress; `headSha` is required |
| GET/POST | `/api/origins/:originId/pull-request-chat-bindings` | List/create origin-scoped PR → chat task bindings; workspace rows resolving to the same origin migrate on access |
| GET/DELETE | `/api/origins/:originId/pull-request-chat-bindings/:prId` | Read/remove one PR chat binding |
| POST | `/api/origins/:originId/pull-request-chat-bindings/:prId/fresh` | Archive + clear the bound PR chat. Requires `workspaceId` selecting a concrete clone; workspaces resolving to a different origin are rejected |

## Diff Classification

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/origins/:originId/classify-diff` | Trigger AI hunk classification for a PR. Body `{ type: 'pr', identifier: '<prId>:<headSha>', workspaceId, repoId?, model?, provider? }`; `workspaceId` supplies queue routing and provider context. Returns `{ status: 'started'\|'ready'\|'running', … }`; result and pending marker files live under `originId` |
| GET | `/api/origins/:originId/classify-diff` | Poll one PR result. Query `type=pr`, `identifier=<prId>:<headSha>`. Returns `{ status: 'none'\|'ready'\|'running', result? }` |
| POST | `/api/repos/:repoId/classify-diff` | Trigger classification for commit or branch-range diffs. Body `{ type: 'commit'\|'branch-range', identifier, workspaceId?, model?, provider? }`; `type: 'pr'` is rejected here and belongs on the origin route |
| GET | `/api/repos/:repoId/classify-diff` | Poll one commit/branch-range result under the resolved canonical origin. Query `type=commit\|branch-range`, `identifier`, `workspaceId?`; `type: 'pr'` rejected. Returns `{ status, result? }` |
| GET | `/api/repos/:repoId/classify-diff/batch-status` | Batch-check commit/branch-range identifiers under the resolved origin. Query `type=commit\|branch-range`, `identifiers` (comma-separated, max 200), `workspaceId?`; `type: 'pr'` rejected. Returns `{ statuses: { [identifier]: 'none'\|'ready'\|'running' } }`. Read-only — never triggers a new task |
| GET | `/api/origins/:originId/classify-diff/batch-status` | Batch-check PR identifiers. Query `type=pr`, `identifiers` (max 200). Same read-only `{ statuses }` shape |

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

## Work Items

Core CRUD/listing routes are origin-scoped (see [Origin scoping](#origin-scoping)) and exposed by `coc-client` as `workItems.*ForOrigin(...)`. Workspace-scoped URLs resolve to the workspace's canonical origin for storage/cache reads. Mutations clear cache entries and broadcast events for both the caller workspace id and the resolved origin id when those differ. `syncLinks` payloads are rejected. Create/update logic lives in the shared command service (`work-items/work-item-commands.ts`), so hierarchy validation, provider sync, cache invalidation, and broadcasts behave the same for every REST caller.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/origins/:originId/work-items` | List. Standard field filters plus `tracker=local-only\|github-backed\|azure-boards-backed` (inherited Epic-rooted identity). Warmed cache unless `force=true` |
| GET | `/api/origins/:originId/work-items/grouped` | Grouped by status, per-group pagination; warmed cache unless `force=true` |
| GET | `/api/origins/:originId/work-items/tree` | Hierarchy tree. `tracker=`, content/status/type filters, `includeArchived`, `includeDone`; descendants inherit the root Epic's identity. Active-origin Local and detected Remote trees come from the warmed cache unless `force=true` |
| POST | `/api/origins/:originId/work-items` | Create. Root Epic payloads may carry `tracker` metadata; absent means `local-only`. A child under a GitHub-backed Epic creates the issue first, encodes the parent via hidden body metadata, then stores `githubMirror`; under an Azure-backed Epic it creates the Azure item and native parent relation first, then stores `azureBoardsMirror` |
| GET | `/api/origins/:originId/work-items/:itemId` | Read work item |
| PATCH | `/api/origins/:originId/work-items/:itemId` | Update. `tracker` is valid only on root Epics. Core edits on mirror items push provider-owned fields before local storage; a stale provider snapshot returns a typed sync conflict unless a matching reviewed `syncConflictResolution` is included. Also accepts an optional `plan` object (see [Plan versioning](#plan-versioning-on-patch)) |
| DELETE | `/api/origins/:originId/work-items/:itemId` | Delete work item |
| GET/PUT | `/api/origins/:originId/work-items/:itemId/plan` | Read or replace the current plan. `PUT` creates the next immutable version (non-empty content required) and accepts optional `workspaceId` |
| GET | `/api/origins/:originId/work-items/:itemId/plan/versions` | List immutable plan/content versions |
| GET | `/api/origins/:originId/work-items/:itemId/plan/versions/:version` | Read one version |
| GET | `/api/origins/:originId/work-items/:itemId/plan/versions/compare?base=N&target=M` | Compare two versions for a local-only `work-item`/`goal`. Requires `workItems.workflow.enabled` |
| POST | `/api/origins/:originId/work-items/:itemId/plan/versions/:version/restore` | Restore an older version as a new current version. Requires `workItems.workflow.enabled`; body accepts `summary`, `reason`, `workspaceId` |
| POST | `/api/origins/:originId/work-items/:itemId/plan/refine` | AI-assisted current-plan refinement when a refinement invoker is configured |
| POST | `/api/origins/:originId/work-items/:itemId/execute` | Enqueue an implementation run. Requires `workspaceId`; accepts `executionMode` (`one-shot`\|`ralph`), `skillNames`, [Provider overrides](#provider-overrides). One-shot is the default; with `workItems.workflow.enabled` local-only Goals default to Ralph. Ralph is accepted only for local-only `work-item`/`goal` and returns `ralphSessionId` with `taskId`. Optional `worktree` opt-in (fail-before-enqueue) sets the task's `workingDirectory` to the worktree path and returns `worktree` plus optional `worktreeWarning` for a dirty source |
| POST | `/api/origins/:originId/work-items/:itemId/ai-review` | Optional AI review of a Review-state local-only `work-item`/`goal`. Requires `workspaceId` + `workItems.workflow.enabled`; enqueues an Ask-mode `code-review` chat, records a non-mutating `work-item-ai-review` history entry, and leaves the item in Review even on failure |
| POST | `/api/origins/:originId/work-items/:itemId/submit-pr` | Submit the latest eligible Review-state local-only change with commits as a PR. Requires `workspaceId`, `workItems.workflow.enabled`, clean workspace, registered workspace root, `gh` auth, and no existing PR metadata on the change. Body accepts `changeId`, `title`, `body`, `baseBranch`, `branchName`; success records branch/PR metadata, links the PR URL on the execution, and marks the item Done |
| POST | `/api/origins/:originId/work-items/:itemId/resolve-comments` | Resolve plan or commit review comments; `workspaceId` required so task/comment files and queue routing use the selected clone |
| GET | `/api/origins/:originId/work-items/:itemId/changes` | List plan-version/commit change records; optional `workspaceId` validates the clone. No workspace alias |
| POST | `/api/origins/:originId/work-items/:itemId/changes` | Create an open change record. Body: `planVersion`, `taskId`, `headBefore`, optional `workspaceId` |
| PATCH | `/api/origins/:originId/work-items/:itemId/changes/:changeId` | Update a change record's commits, status, completion timestamp, task id, or `headBefore` |
| GET | `/api/origins/:originId/work-items/sync/status?workspaceId=:workspaceId` | Sync provider status for the selected clone; returns disabled reasons unless both `workItems.hierarchy.enabled` and `workItems.sync.enabled` are true. Without a `provider` query it derives `remoteProvider` from the repo remote and reports only that one; unsupported remotes report none. Warmed cache unless `force=true` |
| POST | `/api/origins/:originId/work-items/import-from-github` | Import a GitHub Epic issue. Body: `workspaceId` plus `issueNumber` or `issueUrl` (URL owner/repo must match the workspace-configured repo). Pulls the root plus descendants found via hidden `coc-work-item-sync` parent metadata into a local read mirror; returns the root Epic |
| POST | `/api/origins/:originId/work-items/import-from-azure-boards` | Import an Azure Boards Epic-rooted tree. Body: `workspaceId` plus `workItemId` or `workItemUrl`; bare IDs use the workspace's Azure DevOps remote for org/project when available, else configured ADO org/project. URL org/project must match the resolved context. Pulls descendants via native hierarchy relations; returns the root Epic |
| POST | `/api/origins/:originId/work-items/:itemId/convert-to-github?workspaceId=:workspaceId` | Convert a local-only root Epic tree to GitHub-backed: create an issue per item in the workspace-configured repo, encode parent links in hidden body metadata, store mirror metadata locally |
| POST | `/api/origins/:originId/work-items/:itemId/convert-to-local?workspaceId=:workspaceId` | Detach a GitHub-backed root Epic tree to local-only by dropping mirror metadata from root and descendants; local status, plans, history, runs, and commits are preserved and remote issues untouched |
| GET | `/api/workspaces/:id/work-items/tree` | Workspace-compatible tree route resolving to the canonical origin |
| GET/POST | `/api/workspaces/:id/work-items/...` | Remaining workspace-compatible routes resolve to the canonical origin for storage/cache reads and writes while `:id` names the concrete workspace. Changes and AI authoring routes are origin-only |

### Work Item chat bindings

Shape per [Chat bindings](#chat-bindings); workspace-scoped callers resolve to their origin and migrate workspace rows on access.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/origins/:originId/work-item-chat-bindings` | List bindings for the origin |
| GET | `/api/origins/:originId/work-item-chat-bindings/:workItemId` | Read one; `404` when none |
| POST | `/api/origins/:originId/work-item-chat-bindings` | Create/replace. Body `{ workItemId, taskId }`; optional `workspaceId` validated against the origin |
| DELETE | `/api/origins/:originId/work-item-chat-bindings/:workItemId` | Remove (missing is a no-op) |
| POST | `/api/origins/:originId/work-item-chat-bindings/:workItemId/fresh` | Archive + clear the bound chat; requires `workspaceId`, rejects a different origin |

### Tracker identity

A root Epic carries `tracker: { kind: 'local-only' }`, `{ kind: 'github-backed', provider: 'github', github: { issueId?, issueNumber?, issueUrl?, lastPulledAt? } }`, or `{ kind: 'azure-boards-backed', provider: 'azure-boards', azureBoards: { workItemId?, workItemUrl?, revision?, updatedAt?, lastPulledAt? } }`. Descendants inherit it for listing and tree filtering; tracker metadata is invalid on non-root items.

Mirror metadata matches each local item to its remote counterpart while sync ownership stays at the Epic: `githubMirror: { issueId?, issueNumber, issueUrl?, state?, updatedAt?, lastPulledAt? }` and `azureBoardsMirror: { workItemId, workItemUrl?, revision?, workItemType?, state?, updatedAt?, lastPulledAt? }` (no credentials). The public contract exposes no per-item `syncLinks`; persisted ones migrate on read when rootable at a GitHub-backed Epic — root link becomes Epic tracker metadata, item links become `githubMirror`, `syncLinks` are dropped from stored detail/index data.

### Provider sync

`workItems.sync.enabled` is the disabled-by-default global gate: with it off, local saves persist but no GitHub/Azure PATCH transport calls or background polling timers run. Provider-backed saves compare stored mirror metadata against the live provider and fail with `WORK_ITEM_SYNC_CONFLICT` when the remote changed; a retry may include `syncConflictResolution: { provider: 'github', acknowledgedRemoteUpdatedAt }` or `{ provider: 'azure-boards', acknowledgedRemoteRevision }`, and the save proceeds only if the live snapshot still matches.

GitHub sync mirrors title, description, status, type, parent, tags, and issue open/closed state; parsed `coc:status:*` values apply only when they agree with the issue state, else `open` → `created` and `closed` → `done`. Issue mapping owns only `coc:` labels (`coc:type:*`, `coc:status:*`, `coc:priority:*`) and the hidden `<!-- coc-work-item-sync {json} -->` block; other labels stay user tags. Azure sync mirrors title, description, status/state, priority, tags, type, parent relation, revision, URL, and updated metadata from native fields/relations, and local edits push the same core editable fields back, refreshing mirror revision/URL/update metadata from the returned item. CoC plans, execution history, runs, and commits stay local.

Background pollers pull provider-backed Epic roots when remote integration is enabled. `workItems.sync.github` supports `owner`, `repo`, `pollingEnabled` (default `true`), `pollIntervalMinutes` (default `5`, range `1..1440`); `workItems.sync.azureBoards` supports `project` plus the same polling keys. Polling scans only workspaces with imported provider-backed roots, stays workspace-scoped, updates mirrors, prunes missing mirrored descendants, deletes mirrored root trees when the provider root is gone, and warns on remote-wins overwrites of local unsynced provider-owned edits.

### Provider registration and mapping

The sync route layer keeps provider status for GitHub and Azure Boards availability while Epic-rooted operations use the explicit import, pull, and conversion endpoints. GitHub Issues is registered by default, authenticates externally through `gh`/environment-backed auth without persisting tokens, and its status adapter resolves workspace owner/repo. Azure Boards is registered by default for status checks, authenticates externally with Azure CLI (no PATs or bearer values stored), reports missing remote / config project / CLI auth and config-vs-remote mismatches explicitly, and returns only sanitized org/project metadata. Provider visibility is workspace-scoped by remote host (`github.com`; `dev.azure.com`, `ssh.dev.azure.com`, `*.visualstudio.com`), and configuration cannot make an unsupported host visible.

Azure org/project resolution prefers the workspace Azure DevOps remote (including `visualstudio.com/<collection>/<project>/_git/<repo>`), then the global org URL from `/api/providers/config` (`providers.ado.orgUrl`) plus workspace-scoped `workItems.sync.azureBoards.project`, and reports a mismatch status when saved values conflict with the remote. Azure field mapping is deterministic without custom fields: Epic/Feature/Bug map natively, PBI prefers Product Backlog Item then User Story, Work Item and Goal map to Task, Goal identity uses a CoC-owned Azure tag, common Azure states map to CoC statuses, and unknown states/types/priorities are preserved as local status strings or metadata tags.

### Plan versioning on PATCH

`PATCH .../work-items/:itemId` accepts metadata fields and an optional `plan: { content, resolvedBy?, summary?, reason? }` in one request; `plan.content` must contain non-whitespace Markdown. When present the server creates the next immutable version, records source/author metadata (`user` or `ai`), stores the pointer on `plan.currentVersion` and `currentContentVersion`, opens the corresponding change record, broadcasts one `work-item-updated`, and returns the updated item. `PUT .../plan` is the plan-only path with the same content requirement. Execution records and queued task payloads carry the selected `planVersion` so runs trace to the exact version executed.

### Execution routes

`/execute`, `/submit-pr`, `/ai-review`, and `/resolve-comments` all require `workspaceId` in body or query, resolving to `originId`. Queue payloads, git/PR operations, task files, and comment resolution use that workspace; execution history, changes, cache invalidation, and `work-item-updated` broadcasts write to the origin scope. `coc-client` exposes `executeForOrigin`, `submitPullRequestForOrigin`, `startAiReviewForOrigin`, `resolveCommentsForOrigin`.

Work-Item-bound Goal grilling is queue-driven, not a REST endpoint: when a completed chat task carries `context.workItemGoalGrilling` and `workItems.workflow.enabled` is true, the server extracts the final assistant `## Goal` block and saves it to the addressed local-only `goal` as the next AI-authored immutable content version.

### AI Authoring

Gated by `workItems.aiAuthoring` (default `false`). The `ai-draft` generation endpoints are ephemeral — nothing persists until the caller applies the content. All routes are origin-scoped and require a concrete `workspaceId` in the body for generation context; workspace aliases are not registered. Response: `{ kind: 'clarification', questions: string[], clarificationCount: number }` or `{ kind: 'draft', workItem: {...}, goal?: string, childTasks?: [...] }`.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/origins/:originId/work-items/ai-draft` | Draft a **new** work item. Body: `workspaceId` plus `{ prompt, type?, parentId?, clarificationAnswers?, clarificationCount? }`. Returns clarification (up to 3 rounds) or a draft |
| POST | `/api/origins/:originId/work-items/:itemId/ai-draft` | Draft an **improvement** for an existing item. Body: `workspaceId` plus `{ prompt, targets?: ['fields','goal','childTasks'], clarificationAnswers?, clarificationCount? }` |
| POST | `/api/origins/:originId/work-items/:itemId/ai-draft/apply` | Generate and apply a draft to a saved local-only `work-item`, creating the next immutable version. Requires `workItems.aiAuthoring.enabled` + `workItems.workflow.enabled`; body: `workspaceId` plus `{ prompt, baseUpdatedAt, baseContentVersion?, targets?, clarificationAnswers?, clarificationCount?, summary?, reason? }`. The base snapshot is checked before and after generation, returning `409 WORK_ITEM_AI_DRAFT_STALE` rather than overwriting newer edits |

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
| SSE | `/api/processes/:id/stream` | Per-process event streaming |

## Remote Servers

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/servers` | List / register remote servers |
| DELETE | `/api/servers/:id` | Remove server |
| POST | `/api/servers/:id/test` | Test connection |
| POST | `/api/servers/:id/connect` | Connect (DevTunnel) |
| POST | `/api/servers/:id/disconnect` | Disconnect |
| POST | `/api/servers/cherry-pick-transfer` | Orchestrate a patch-transfer cherry-pick through the initiating server. Body `{ source: { serverId?, workspaceId, commitHash \| commitHashes }, target: { serverId?, workspaceId, stashAndContinue? } }` (`commitHashes` is oldest-first; either form normalizes to one export + one apply round-trip). Omitted/`local` `serverId` means the current CoC, otherwise the id must be an online registered remote. Composes the workspace git patch export/apply endpoints, propagates dirty/conflict fields (including `appliedCount`), and returns source/target server/workspace metadata (range transfers add source `commits`) without effective URLs or local paths |

## Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/status` | Sync status (`enabled`, `inProgress`, `lastSyncTime`, `lastError`) |
| POST | `/api/sync/trigger` | Force immediate notes sync |

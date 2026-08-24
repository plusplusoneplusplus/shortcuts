# packages/coc

CoC CLI and integrated server. Consumes `@plusplusoneplusplus/coc-workflow`
directly for pure workflow compilation/execution, `@plusplusoneplusplus/forge`
for runtime/process/queue utilities, and `@plusplusoneplusplus/coc-agent-sdk`
for the provider-neutral LLM-tool contract (`Tool`, `defineTool`, etc.).

See the root `AGENTS.md` for cross-package conventions and **always load
`.github/skills/coc-knowledge/SKILL.md`** before working on this package —
detailed architecture lives in its `references/*.md` files.

## Where to Read Before Editing

| If you are touching… | Read first |
|----------------------|------------|
| CLI commands, source layout, executors, server startup, storage layout | [server-architecture.md](../../.github/skills/coc-knowledge/references/server-architecture.md) |
| Admin REST handler, editable config fields, admin UI | [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md) |
| `~/.copilot/mcp-config.json` + `.vscode/mcp.json` merge, allow-list | [mcp-settings.md](../../.github/skills/coc-knowledge/references/mcp-settings.md) |
| `src/server/endev/`, `EnDev-xDpu` skill visibility | [endev.md](../../.github/skills/coc-knowledge/references/endev.md) |
| Ralph sessions, iteration prompt, promote-to-ralph endpoint | [ralph.md](../../.github/skills/coc-knowledge/references/ralph.md) |
| `src/server/cron/`, cron tools, tick lifecycle | [cron.md](../../.github/skills/coc-knowledge/references/cron.md) |
| Process store / SQLite schema / FTS5 / pin / archive | [process-store.md](../../.github/skills/coc-knowledge/references/process-store.md) |
| Dashboard SPA (`src/server/spa/`) | [dashboard-spa.md](../../.github/skills/coc-knowledge/references/dashboard-spa.md) |
| REST endpoints | [rest-api.md](../../.github/skills/coc-knowledge/references/rest-api.md) |
| Notes sync engine (`src/server/sync/`) | [sync.md](../../.github/skills/coc-knowledge/references/sync.md) |
| SDK wrapper, Copilot/Codex providers, `ISDKService`, `SDKServiceRegistry` | [sdk-wrapper.md](../../.github/skills/coc-knowledge/references/sdk-wrapper.md) |

Other domains (memory, workflow engine, prompt autocomplete, wiki serving,
remote servers, task comments, llm-tools, sdk-wrapper, chat-prompt-history)
all have their own `references/*.md`.

## Local Invariants

- **File search has two interchangeable backends.** `RepoTreeService` uses the
  Rust index from `@plusplusoneplusplus/coc-native` when a binary is available
  for the platform, and its ripgrep/directory-walk path otherwise; the choice is
  the `nativeFileIndex` constructor option (`null` forces the fallback) and
  `/api/health` plus a startup log line report which one is live. Both paths
  must produce identical responses —
  `test/server/repo-tree-service-native.test.ts` runs the behavioural tests
  twice and compares, and `test/server/repo-tree-service.test.ts` pins the
  fallback path by passing `nativeFileIndex: null` everywhere. The shared scorer
  in `src/server/shared/fuzzy-file-score.ts` is the reference implementation the
  Rust port must match; see
  [packages/coc-native/AGENTS.md](../coc-native/AGENTS.md) before changing
  either. `searchFiles` is uncapped under the native path (the list never leaves
  the process); `fileListMaxEntries` bounds only the `/files` response payload.
- **QuickOpen searches on the server.** The `Ctrl+P` dialog fetches nothing on
  open, debounces keystrokes, and highlights using the `indices` the server's
  scorer returned — never by re-deriving the match in the browser, which used to
  let highlight and ranking disagree.
- **Server Vitest tests** live under `packages/coc/test/server/`. Any
  server change should add or update tests there.
- **Docker image contract tests** live under `packages/coc/test/docker/`
  (root `Dockerfile`, `docker-compose.example.yml`, `deploy/tenant/*`,
  `docker/entrypoint.sh` run under `sh` with fake `coc`/`git`/`curl`). Any
  change to those files must keep them green; the loopback-only bind
  (`--host 127.0.0.1`, no `EXPOSE`, no published port for `coc`) is policy.
  `scripts/prebuild.mjs` honours `COC_BUILD_COMMIT` (the image build has no
  `.git`).
- **Admin export/import/wipe storage behavior** lives under
  `src/server/storage/snapshot/`: `types.ts` (the domain contract),
  `registry.ts` (`createSnapshotDomains()` plus the collect/restore/wipe
  orchestration), `snapshot-fs.ts` (shared filesystem helpers), and one module
  per storage family (`core-store-domain`, `queue-domain`, `image-blob-domain`,
  `preferences-domain`, `schedule-domain`, `git-ops-domain`).
  `storage/storage-snapshot-domains.ts` is a compatibility barrel for the
  public orchestration API. Schedule YAML + `schedule_runs` snapshot logic lives
  next to schedule persistence in
  `src/server/schedule/schedule-snapshot-repository.ts`. When adding a persisted
  storage family, add a domain module, register it in `registry.ts`, and make it
  pass the domain contract harness
  (`test/server/snapshot-domain-contract.test.ts`) so export counts, import
  merge/replace behavior, and wipe dry-run counts cannot drift.
- **Server preferences** live under `src/server/preferences/`: `schema.ts`
  owns Zod schemas and inferred types, `repository.ts` owns global and
  repo-scoped disk persistence, `merge-policy.ts` owns PATCH/import merge
  semantics, `live-effects.ts` owns sync and work-item runtime side effects,
  and `routes.ts` owns HTTP route registration. `preferences-handler.ts` is a
  compatibility barrel; new server code should import the specific preference
  module it needs.
- **Notes task collections** are discovered per request from existing canonical
  directories: the repo-scoped task root, `.vscode/tasks`, and task
  `folderPaths`. Their `task:<sha256>` root ids are opaque, protected, and
  workspace-scoped. Never persist them in `additionalNotesRoots`, count them
  toward the user-configured Notes-root limit, or accept a client path as root
  authority. Every non-default Notes file, folder, comment-sidecar, order, and
  image path must pass `notes/notes-path-safety.ts`; it treats both slash styles
  as separators, rejects absolute/drive/UNC/parent paths, and resolves existing
  symlinks before checking containment in the selected root. The SPA must keep
  task-derived rows out of Notes root removal selection, refresh discovery with
  the tree, clear the selected file when a root disappears or the workspace
  changes, and discard late root/tree responses from stale workspace scopes.
- **Notes sidecars** (comments, paper annotations) get their path and their
  access check from `notes/notes-sidecar-resolver.ts` — never from an ad-hoc
  check in a handler. It allows a note under the workspace data dir,
  `~/.copilot`, or the workspace git root, and co-locates the sidecar only for
  the first two; everything else (repo-folder roots, and chat-scratchpad files
  opened by absolute path inside the repo) lands under
  `~/.coc/repos/<workspaceId>/notes-comments/<encoded-bucket>/` so the user's
  repo stays clean. The `.` bucket is reserved for workspace-root files;
  `validateNotesRootPath` rejects `.` as a user root, so it cannot collide.
- **Notes attachments** upload and serve through the shared endpoint in
  `notes/notes-image-handler.ts` (`POST`/`GET /api/workspaces/:id/notes/image`).
  It accepts images plus `application/pdf` (images capped at 10 MB, PDFs at
  50 MB) and stores files under `.attachments/` (default root) or `.images/`
  (repo-folder roots). PDFs round-trip as
  `![label](.attachments/x.pdf)` markdown through the Tiptap `pdfBlock` node;
  a presentation attribute (`data-indent`, `data-pdf-height`, or
  `data-pdf-collapsed`) forces the raw `<div class="md-pdf-embed" …>` form so
  the flag survives the save. A collapsed embed unmounts its iframe and shows
  only the toolbar.
  `pdfBlockUrl.ts` permits an unsandboxed inline iframe only for same-origin,
  exact Notes `image`/`local-image` routes whose decoded `path` is a PDF;
  other HTTP(S) PDF URLs are link-only and unsafe values expose no active URL.
  `router.ts` maps `.pdf` to `application/pdf` for the browser-native viewer.
- **Tiptap** is pinned to one exact version across every `@tiptap/*` dep
  (currently `3.30.0`). Several of them declare exact peer deps on
  `@tiptap/core`/`@tiptap/pm`, so bumping a subset — or loosening one to a
  caret range — produces two resolved copies of `@tiptap/core`. ProseMirror
  plugins from different core instances do not share a schema, which fails at
  runtime, not at typecheck. Bump the whole set together and confirm with
  `npm ls @tiptap/core`.
- **Notes find & replace** is `@tiptap/extension-find-and-replace`, registered
  last in `RichEditorCore` so its match decorations paint above the comment and
  AI-edit ones, and driven from the panel behind the toolbar's 🔍 button. It
  binds no keyboard shortcut, so `Ctrl+F` stays native browser find over the
  whole page (sidebar, TOC, chat panel). It is rich-mode only — source mode is a
  separate raw-markdown editor — and the button and panel are part of the
  formatting group hidden by `hidden`. The bundled highlight styles are off
  (`injectCSS: false`) because their yellow fill collides with the Highlight
  mark colors; `noteEditor.css` outlines matches instead.
- **Notes links** show the destination URL plus the platform-specific
  modifier-click instruction in the native hover hint. The hint is attached to
  the live editor DOM and must not be serialized into note Markdown. The write
  must stay idempotent (skip when the title already matches): ProseMirror's
  DOMObserver redraws the link's children on every attribute mutation, and an
  unconditional write loops when the hovered child is an inline atom chip. The
  `filePathRef` marked extension skips inside link labels
  (`lexer.state.inLink`) so `[URL](URL)` never gains a `file-ref-link` chip.
- **In-memory caching** uses the one shared primitive at
  `src/server/cache/` (`createCache<T>({ namespace, ttlMs?, maxSize=500,
  immutable? })` → a handle with `get`/`set`/`getOrCompute`/`delete`/
  `invalidateWorkspace`/`clear`). It is a passive store — no background
  timers; stale-while-revalidate domains keep their own timer and call into a
  handle. `getOrCompute` is single-flight; entries can carry a `workspaceId`
  tag, and `invalidateWorkspaceForAll` clears one workspace across every
  namespace. Do NOT hand-roll a new `Map`-based TTL cache and do NOT add an
  npm cache dependency.
- **Dashboard Git-info refreshes** are independent of process lifecycle events.
  `ReposContext` derives card counts from the live `AppContext` process index;
  only topology events/reconnect/manual refresh run full discovery, while
  `git-changed` refreshes one clone-routed workspace. A live Git-info read uses
  Forge's single porcelain-v2 status command and the persisted workspace remote
  URL. Keep cache single-flight behavior, bounded error backoff, active-only
  safety refresh, and privacy-safe batch metrics intact.
- **Codex skill mirroring** runs once at server startup (when
  `resolvedConfig.codex?.enabled === true`), not per-install. The
  `syncInstalledSkillsToCodex` function copies all globally installed bundled
  skills from `~/.coc/skills` to `~/.codex/skills` (`$CODEX_HOME/skills`).
- **Claude skill mirroring** runs once at server startup (when
  `resolvedConfig.claude?.enabled === true`). The `syncInstalledSkillsToClaude`
  function copies each skill's `SKILL.md` from `~/.coc/skills/<name>/SKILL.md`
  to `~/.claude/commands/<name>.md` (`$CLAUDE_HOME/commands/<name>.md`) so
  Claude Code discovers them as slash commands. A sidecar marker
  `.coc-<name>.json` tracks CoC-managed commands to distinguish them from
  user-authored ones.
- **Skill-folder resolution order** is: repo-local `.github/skills` →
  managed global `~/.coc/skills` → configured global extra folders
  (`skills.globalExtraFolders`) → per-repo extra folders → auto-detected
  OneDrive/CloudStorage → bundled. Three consumers must keep this order identical:
  `resolveSkillConfig` (execution-time, existence-filtered — what the agent
  uses) and `resolveEffectiveSkillPaths` (read-only diagnostic behind
  `GET /api/skills/effective-paths`, keeps declared-but-missing sources) in
  `src/server/executors/skill-config-resolver.ts`, and `loadSkillsForWorkspace`
  (UI listing behind `GET /api/workspaces/:id/skills`, tags configured-folder
  skills `source: 'global-extra-folder'`) in `src/server/skills/skill-handler.ts`.
  Every configured global or per-repo extra folder is a possible container:
  probe the folder itself, then `<folder>/.github/skills`, then
  `<folder>/skills`. Keep this base-first candidate order for name precedence,
  filter missing candidates at runtime, and store the actual candidate root in
  each listed skill's `folderPath` so display and file reads match execution.
  Each detected OneDrive root is probed at `.github/skills` and then `skills`;
  Windows-style roots stay ahead of sorted macOS CloudStorage roots.
  Managed `~/.coc/skills` is the only install/delete target; extra/detected
  folders are read-only. `skills.globalExtraFolders` +
  `skills.autoDetectDefaultFolders` live in the config `skills` namespace, while
  `globalDisabledSkills` lives in `preferences.json`; `GET`/`PUT
  /api/skills/config` spans both (see
  [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md)).
- **Workspace Agent Skills UI state** lives in
  `react/features/skills/useWorkspaceSkillsController.ts`. Both
  `RepoSettingsTab` and `RepoCopilotTab` inject their workspace client resolver;
  visual skills components must not choose a default or clone-routed transport.
  Keep source grouping/filtering/resolution rows pure in `skills-ui-model.ts`,
  keep install requests typed through `useSkillInstallController`, and guard
  list/config/detail/file-preview/repo-probe/install responses so late work from
  an old workspace, source, card, or repo list cannot update the active view.
- **Diff-comment REST** all lives in `react/utils/diffCommentApi.ts` and is
  clone-routed through `getCocClientForWorkspace(wsId)` — reads
  (`listDiffCommentsForRange`) as well as writes. The list route only validates
  the id, so a local-origin read for a remote clone returns 200 with an EMPTY
  list rather than 404: a missed route here shows "no comments" instead of
  failing. Call the helper; do not call `getSpaCocClient().git.listDiffComments`
  or `fetchApi('/diff-comments/...')` from components.
- **Workflow (pipelines) REST** lives in `react/features/workflow/workflow-api.ts`
  and is clone-routed through `getCocClientForWorkspace(workspaceId)` for all
  eight calls; `WorkflowRunHistory` routes its `/queue/history` read the same way
  (that route returns 200 with an EMPTY list for an unknown `repoId`, so a missed
  route reads as "no runs"). `runWorkflow` enqueues on the SERVING host, so the
  returned process only exists there — `WorkflowDetailView` takes a `workspaceId`
  and uses it for both the process fetch and the SSE stream URL. Remote rows get
  their workflow list from the per-server `/summary` fetch in
  `remoteWorkspaceAggregation`; the local queue WebSocket stays local.
- **Shared dialogs that take a workspace id** (`ResolveContextDialog`,
  `ModalJobAiControls`, `MarkdownReviewDialog`) route through
  `getCocClientForWorkspace(wsId)` — or, for reveal-in-explorer, through
  `explorerApi`. Repo preferences (`/workspaces/:id/preferences`) only validate
  the id, so a missed route silently reads and writes the WRONG server's
  preference file instead of 404ing.
- **File-path hover previews** (`react/shared/file-path/file-path-preview.ts`)
  and `react/shared/FilePreview.tsx` use `resolveSourceCanvasTarget` over local
  plus remote workspaces and route through `getCocClientForWorkspace`. A hinted
  workspace loses to the longest root owner when it does not contain an absolute
  path; relative group refs keep the group id for ordered server probing. Preview
  cache keys include a workspace identity and path.
- **Source-canvas workspace routing** keeps an explicit workspace hint only when
  its root contains the resolved absolute path. If another known workspace owns
  the path by longest-prefix match, `source-canvas/resolve.ts` routes the preview
  and folder tree to that workspace; an unmatched path keeps the original hint.
  Relative group refs stay unanchored until the preview endpoint returns the
  absolute `path` and owning `resolvedWorkspaceId`. Content, header/copy/reveal,
  tree roots, lazy children, hover previews, and app-level Markdown link handling
  carry that member ownership forward. Group Markdown links stay read-only.
- **Repo-group file preview reads** may reach the virtual group root, existing
  trusted read-only roots, the group task root, and any live registered member
  root. A relative group request probes live member roots in `group.json` order
  and uses the first existing candidate; candidates must stay inside their
  member root, and a miss reports every attempted path. Successful previews
  return the resolved absolute `path` and `resolvedWorkspaceId`, using the
  owning member id for member files. `resolveRepoGroupReadRoots` in
  `server/tasks/tasks-handler-utils.ts` preserves membership order and omits
  members removed from the registry or missing on disk; non-group workspaces get
  no extra roots. This allowance is for
  `GET /workspaces/:id/files/preview` only and must not be reused by write routes.
- **WSL file links.** On a Windows host a WSL workspace has a
  `\\wsl$\<distro>\...` `rootPath`. `react/utils/path-resolution.ts` keeps that
  UNC prefix intact (`isAbsolutePath`, `resolveRelativePath`, `deriveHomeDir`),
  and `source-canvas/resolve.ts` re-roots the plain Linux paths WSL agents emit
  (`/home/u/repo/...`) onto the workspace's share, but only when the result
  lands inside that root. Server-side, `resolveRequestedFilePath` in
  `server/tasks/tasks-handler-utils.ts` does the same for
  `GET /workspaces/:id/files/preview`. Collapsing `//wsl$/...` to `/wsl$/...`
  is what makes previews fail with "path is outside workspace".
- **Workspace MCP inspector state** lives in
  `react/features/skills/useMcpServerInspectorController.ts`. Unlike the skills
  controller it resolves its own transport from the `workspaceId` it already
  receives — `getCocClientForWorkspace(workspaceId)` for the `mcp-config` REST
  calls and `cloneApiBase(startedWs)` for the raw `mcp-oauth/start` fetch plus
  its status poller — because those routes read the host machine's disk via
  `ws.rootPath` and store credentials on the owning server. `McpServersPanel`
  takes no client-resolver prop; do not add one.
- **Adding an admin-exposed config setting** is ONE definition entry in
  `src/config/admin-setting-definitions.ts` (value spec, default, runtime,
  optional `runtimeFlag` + Features-card `ui` metadata) plus the
  `CLIConfig`/`ResolvedCLIConfig`/`DEFAULT_CONFIG` declarations in
  `src/config.ts`. Admin validation, file schema, namespace merge/source
  tracking, runtime feature flags, the embedded SPA bootstrap, the Features
  card UI, and the generic contract tests
  (`test/config/admin-setting-definitions.test.ts`) all derive from the
  registry — do not hand-edit `admin-config-fields.ts`, `schema.ts` leaves,
  or `namespace-registry.ts` for admin settings. Reserve `admin-handler.ts`
  changes for cross-field validation shared with config-file loading (see
  [admin-config.md](../../.github/skills/coc-knowledge/references/admin-config.md)).
- **Admin Features save shortcut** is scoped to Admin -> Configure -> Features.
  Ctrl+S and Command+S prevent the browser save action there, submit only dirty
  feature values, and stay inactive in other admin sections.
- **Non-admin namespaced config fields** (queue, models, logging, monitoring,
  skills, memoryPromotion, …) keep hand-written descriptors in
  `src/config/namespace-registry.ts`; do not expand branch lists in `config.ts`.
- **MCP REST surface** must never expose secrets (`env`, headers, full `args`).
- **Ralph iteration prompts** must not hard-code implementation skill names
  or set `context.skills`; surface `progress.md`/`context.md` by path only,
  without injecting their contents.
- **Ralph final-check tasks** still run with autopilot capability, but
  `RalphExecutor` must use validation-only system instructions whenever
  `context.ralph.finalCheck` is present. Do not route final checks through the
  normal implementation-loop system prompt.
- **Ralph task kind** is derived only through `getRalphTaskKind(ctx)`
  (`src/server/ralph/task-kind.ts`), which returns
  `'iteration' | 'final-check' | 'submit'`. `RalphExecutor` rebuilds the user
  prompt from `buildRalphIterationPrompt` for `'iteration'` **only**; every
  other kind arrives with a purpose-built prompt that must reach the model
  verbatim. Adding a new kind means extending the helper, not adding another
  `ralphCtx.<marker>` check at a call site.
- **Ralph PR-submit tasks** (`context.ralph.submit` present) must never be
  routed through iteration orchestration: the bridge hands them to
  `orchestrateSubmitCompletion` (`src/server/ralph/orchestrate-submit.ts`),
  which parses the `RALPH_SUBMIT_RESULT` block and updates the persisted
  `submits[]` record only — a submit completion never enqueues further work
  and server code never switches git branches.
- **Ralph manual-only completion** treats explicit manual-verification-only
  `Remaining:` progress as complete autonomous work: do not queue another
  implementation iteration; enqueue final-check and preserve the manual
  verification-needed terminal status.
- **Ralph signal recovery** falls back to the journal when the response carries
  no inline `RALPH_*` token: `decideRalphIterationActions` recovers the signal
  from the current iteration's `progress.md` section (via `recentProgressSections`,
  which must include `iteration`). The inline token stays authoritative when
  present; `NO_SIGNAL` is terminal only when neither source carries a signal.
- **Git-tab Fetch/Pull** must stay current-branch scoped. `RepoGitTab` sends
  `currentBranchOnly: true`; the server delegates to the scoped `BranchService`
  methods, which resolve the checked-out branch's exact configured upstream
  remote + merge ref, require one valid `refs/heads/...` source ref, and use
  argv-based Git commands with no automatic tags. Never assume `origin` or a
  same-named remote branch, and never fetch sibling refs from these UI actions.
  The generic Forge `fetch`/`pull` methods retain their broad public behavior
  for non-Git-tab callers.
- **Git branch REST routes** (`src/server/routes/api-git-branch-routes.ts`) are a
  thin HTTP adapter over the operation kernel in `src/server/git/`. Add new git
  operations through the kernel, not inline in the route file:
  `GitOperationRunner.start()` for anything returning `202 { jobId }` (it owns
  job IDs, the already-running 409 guard, terminal status, cache invalidation,
  and the `broadcastGitChanged` reason), `git-request-validators.ts` for input
  validation and the 409 dirty/conflict payloads, `GitPatchTransferService` for
  patch export/apply, and `GitRebaseReorderService` for the queue-backed reorder.
  Validators and services throw `APIError`s; `createRoute` renders them, so
  handlers should not hand-roll early returns. Route declaration order is
  load-bearing — the `DELETE /branches/:name` catch-all must stay after the
  specific branch endpoints.
- **Patch-transfer metadata is untrusted** (it can originate on another CoC
  server) and is persisted plus rendered, so every field goes through
  `git-patch-transfer-metadata.ts`, which caps length, strips newlines, and
  rejects POSIX, Windows-drive, and UNC absolute paths. An explicit
  `normalizedSourceRemoteUrl: null` means "source has no remote" and is
  preserved; an absent value means "not reported" and is omitted.
- **Branch-range comparison base** is selectable: `?base=default-branch`
  (default, vs the detected default remote branch) or `?base=upstream` (vs
  `@{upstream}`, unpushed commits only) on all four
  `/git/branch-range*` routes; unknown values fall back to `default-branch`
  rather than erroring. `default-branch` must stay the default. Any cache
  holding branch-range data must include the mode in its key — server
  `{wsId}:branch-range:{baseMode}`, SPA `useBranchRangeCache`
  `{wsId}:{baseMode}`, and `createBranchRangeDiffSource`'s `cacheKey` — or one
  mode serves the other's diff. In `upstream` mode a zero-commit range is
  returned as an empty range rather than `null`, so the base toggle stays
  reachable when nothing is unpushed.
- **Git worktree execution** (opt-in, `features.gitWorktreeExecution`, default
  off) lives in `src/server/worktree/` (`GitWorktreeService` +
  `WorktreeMetadataStore`) with Ralph wiring in
  `src/server/ralph/ralph-worktree-launch.ts` and cleanup routes in
  `src/server/routes/worktree-routes.ts` (see
  [ralph.md](../../.github/skills/coc-knowledge/references/ralph.md) and
  [rest-api.md](../../.github/skills/coc-knowledge/references/rest-api.md#git-worktrees)).
  Invariants: all per-run data stays under
  `~/.coc/repos/<workspaceId>/git-worktrees/` (never a new top-level `~/.coc`
  dir); the target server only ever creates a worktree for its **own**
  workspace checkout; worktrees are created from committed objects only
  (`git worktree add -b <branch> <path> <baseSha>`) with **no** fetch/pull/push/
  rebase/merge and **no** source-branch switch (`git checkout`/`switch`/
  `reset --hard`); creation is fail-before-queue so an invalid ref/non-Git
  folder aborts before any task is enqueued or status transitions; cleanup uses
  `git worktree remove` **without** `--force`, never deletes the generated
  branch, and surfaces the raw Git error (leaving the record intact) rather than
  discarding a dirty worktree.
- **Cron ticks** must route completion through
  `ProcessLifecycleRunner → onCronTickComplete → CronExecutor.onTickComplete`;
  bookkeeping errors must never mask the follow-up's actual result.
- **Wakeups are durable and one-shot.** `scheduleWakeup` persists a `pending`
  `WakeupEntry` (absolute `firesAt`) in the `wakeups` table via
  `createEnqueueWakeup` **before** `WakeupExecutor.arm()` fires the one-shot
  timer, so restarts re-arm them (`wakeupExecutor.armAll()`, overdue ones fire
  immediately). Firing runs `executeFollowUp` directly (not via the queue) and
  marks the record terminally `fired`/`failed` — persisting `failure_reason` on
  error — never recurring. Wakeups keep their own store/executor and only share
  the `ScheduleTimerRegistry`/`processes.db` with crons.
- **Schedule persistence and reloads** are async. User schedules live as
  per-entry YAML files under `getRepoDataPath(dataDir, repoId, 'schedules')`;
  `ScheduleManager.restore`, `addSchedule`, `setSchedule`, `removeSchedule`,
  `registerWorkspacePath`, and `reloadRepoSchedules` must be awaited by
  startup, route handlers, and tests. User schedule writes/deletes serialize per
  repo, and repo schedule scan failures preserve the previous loaded repo
  schedules rather than replacing them with an empty set.
- **Schedule runtime state is keyed by `(repoId, scheduleId)`**, never by a bare
  schedule ID. Repo schedules derive deterministic IDs from their filename
  (`repo:<stem>`), so two clones shipping the same `.github/schedules/*.yaml`
  share an ID. Timers, in-flight runs, and run history all key through
  `scheduleRuntimeKey()` in `src/server/schedule/schedule-runtime-key.ts`, and
  `ScheduleManager.getRunHistory`/`isRunning` and the REST `serializeSchedule`
  all require `repoId`. `isAnyRepoRunning(scheduleId)` is the only cross-repo
  lookup and must not be used from workspace-scoped paths.
- **Schedule REST bodies and queue payloads have one home each.** POST/PATCH
  body validation and coercion live in
  `src/server/schedule/schedule-request-parser.ts` (error strings are the API
  contract); prompt/Ralph/script queue payload construction lives in
  `schedule-task-builder.ts` as pure functions. `ScheduleExecutor` only performs
  the side effects around them.
- **Dreams analyzer/critic AI work** must run through
  `DreamInternalProcessExecutor`/`ProcessLifecycleRunner` so analyzer and critic
  prompts/responses are persisted as read-only internal processes. Do not add
  direct `aiService.sendMessage(...)` calls under `src/server/dreams/`.
- **Hierarchical parent/child task features** (For Each, Map Reduce, Ralph,
  Dreams, and anything future that schedules sub-tasks) must use the task-group
  framework instead of inventing new linkage: register/update the group through
  `src/server/task-groups/` (feature stores fire change hooks projected by
  `feature-sync.ts`), tag every child task with
  `payload.context.taskGroup = { groupId, groupType, role, itemKey?, workspaceId }`
  (mirrored to `metadata.taskGroup` by `ProcessLifecycleRunner`), and add a
  chat-list descriptor in
  `src/server/spa/client/react/features/chat/task-group-descriptors.ts`.
  Group statuses are normalized (`draft|running|completed|failed|cancelled`)
  with feature detail in `extra.detailStatus`; registry writes are best-effort
  and must never break orchestration. On the SPA side, reuse the shared
  task-group UI family instead of forking components: `TaskGroupRunRow`
  (chat-list parent row; For Each/Map Reduce/Ralph rows are thin config
  wrappers), `TaskGroupRunPane` (run-detail pane), `TaskGroupPlanReviewCard`
  (plan review/approve card), `useTaskGroupExpansion`
  (workspace-scoped expand/collapse for all group kinds), and
  `task-group-copy-info.ts` (context-menu copy text) under
  `src/server/spa/client/react/features/chat/`.
- **Chat canvas** (`canvas.enabled`, default on) persists markdown, code,
  extension, excalidraw, or kusto artifacts (descriptor `type` + normalized
  `language`) under
  `~/.coc/repos/<wsId>/canvases/<canvasId>/` through
  `src/server/canvas/canvas-store.ts` with revision-checked updates. That file
  is a facade over one service per contract: `canvas-write-queue.ts` (one writer
  per canvas — a `.locks/<canvasId>.lock` directory with bounded waiting and
  stale-lock takeover, so a read-check-write is a real critical section across
  processes), `canvas-record-repository.ts` (descriptor + artifact + snapshot
  staged as `.tmp-*` files and published snapshot → artifact → descriptor, so a
  torn commit never leaves a revision ahead of its content),
  `canvas-extension-repository.ts`, `canvas-comment-repository.ts`,
  `canvas-file-sandbox.ts`, and `canvas-diagnostics.ts`. Route new canvas
  persistence through the matching service rather than back into the facade, and
  keep every mutation inside `queue.runExclusive`. AI edits
  go through the `write_canvas`/`read_canvas`/`extension_canvas` LLM tools
  (which emit `canvas-updated` SSE events on the linked process); user saves
  go through the workspace canvases REST routes (409 + current record on a
  stale revision, `canvas-updated` WebSocket broadcast). Every persisted
  revision also writes a version snapshot (capped at 50) used by the panel's
  history stepper and restore-as-new-revision flow, and anchored comments
  (`comments.json`, open|sent|resolved) are delivered to the AI through the
  normal follow-up enqueue path — not a custom channel. SVG code canvases
  (`language: svg`, or SVG-rooted `xml`/unset source) render sanitized output in
  an isolated ShadowRoot with Source/Rendered views, wheel zoom, drag pan, raw
  `.svg` export, and escaped-source fallback for malformed input; never mount
  raw SVG source in the DOM. Extension canvases
  store `extension/{manifest.json,ui.html,capabilities.js}`; both the AI
  (`extension_canvas` RUN mode) and the panel's sandboxed iframe (capability
  REST route) mutate shared state only through capabilities run as pure
  `(state, params) => nextState` transforms in `canvas-capability-runner.ts`
  (`node:vm`, no require/process, 1s timeout, 1 MB cap) — never execute
  extension scripts outside that runner. Do not write canvas files directly
  from other features. An extension canvas may also be given READ-ONLY data
  files under `canvases/<canvasId>/files/`, written only by the AI
  (`extension_canvas` `files: [{ path, content, encoding? }]`) and served by
  `GET /canvases/:id/files` + `GET /canvases/:id/files/<path>` for
  `CanvasHost.listFiles()` / `CanvasHost.readFile(path, opts)` in the iframe.
  Path safety is layered in `canvas-file-sandbox.ts` and must stay that way — shape
  (`isSafeCanvasFilePath`, plus `hasEncodedPathEscape` on the still-encoded URL
  form) → `path.resolve` → forge `isWithinDirectory` → `fs.realpathSync` on
  both target and root, re-verified, which is the only layer that catches a
  symlink inside `files/` pointing elsewhere. Caps: 1 MB text / 10 MB binary,
  2000 listed entries. There is deliberately NO write endpoint and no
  workspace-repo scope — canvas state is the write channel because it is
  revision-checked and snapshotted; do not add either. A corrupt descriptor,
  artifact, snapshot, extension document, or comments file is skipped AND
  reported through `reportCanvasCorruption` (workspace/canvas id, file role,
  bare name, error class/errno only — never canvas content or absolute paths);
  do not go back to a bare `catch {}`.
- **Chat style selector** (live admin flag `features.chatStyleSelector`, default
  on — `absentFallback: false`, so a legacy partial config that lacks the key
  still reads off — runtime flag `chatStyleSelectorEnabled`) adds a
  `Style: Default|Human|
  Direct|Analytical|Structured` chip beside Effort in the new-chat and follow-up
  composers. The style instruction is prepended to the **user message**, never
  injected into the system message. Style changes only how a response is
  written — never the provider, model, effort, tools, permission mode, or any
  structured output contract.
  - `ChatStyle`, `CHAT_STYLES`, `DEFAULT_CHAT_STYLE`, `CHAT_STYLE_LABELS`, and
    `isChatStyle()` are the single contract, exported from
    `@plusplusoneplusplus/coc-client`; reuse them instead of re-listing the five
    values. `'default'` is a real, first-class wire value — `isChatStyle
    ('default')` is true — so switching *to* Default is distinguishable from
    never having chosen. `validateAndParseTask()` and `normalizeFollowUpInput()`
    re-validate: unknown → 400, omitted → `'default'`.
  - Prompt text lives ONLY in `src/server/executors/chat-style-prompt.ts` and is
    asserted verbatim in `chat-style-prompt.test.ts` — treat wording edits as
    product changes. The block is exactly four lines — open tag,
    `Selected style: X.`, one focus line, close tag — followed by a blank line
    and then the user's text. There is no shared preamble. `Default` has no
    focus line and no block at all: the builder returns `undefined` and the
    prepend function returns the prompt byte-for-byte unchanged.
  - Injection rule, one rule for every turn: inject when the selected style
    differs from the style last recorded on `process.metadata.chatStyle` AND is
    not `'default'`. A brand-new conversation starts recorded as `'default'`, so
    turn 1 injects only when the user picked a real style. The recorded style is
    updated on **every** turn including no-block ones, so Default is a real
    state, not a gap. Switching to Default injects nothing and deliberately does
    not undo an earlier style; that tradeoff is a product decision, not
    something to work around.
  - Injection happens before persistence — new chats in
    `ProcessLifecycleRunner` (the only point upstream of the turn-0 write; NOT
    `chat-base-executor.effectivePrompt`, which is never persisted) and
    follow-ups in the `POST /api/processes/:id/message` route (the last point
    before `ProcessMessageDeliveryService` writes `displayContent`). The block is
    therefore stored and rendered verbatim in the user bubble — no stripping, no
    hidden prefix, no special renderer. Do not add stripping without revisiting
    that decision.
  - Scope is `chat-base` (Ask), `autopilot`, `note-chat`, `commit-chat`, and
    follow-ups only, enforced by `isChatStyleEligiblePayload`. Ralph,
    classification, task generation, note creation, resolve-comments, Dreams,
    and workflows never inject. The flag is enforced on both sides so an older
    client cannot force injection: the SPA hides the chip and omits `chatStyle`,
    and the server checks the live flag per turn.
  - Deliberately absent: no `PerRepoPreferences.lastChatStyle` seed (new chats
    always start on Default, there is no workspace-level style), and no
    style-change buffering special case in `ProcessMessageDeliveryService` — the
    style rides the user message, so no freshly built system message is needed.
  - The follow-up composer's style is *derived*, not synced: `ChatDetail` keeps
    only a `chatStyleOverride` (null until the user picks) and falls back to
    `processDetails.metadata.chatStyle`, so a late, partial, or re-fetched
    record converges on the right value while a user pick always wins.
    `queuedTaskToProcess` mirrors `payload.chatStyle` into the synthetic queued
    process for the same reason it mirrors `mode` — an invalid value is dropped.
- **Quick Ask side-notes** (live admin flag `features.quickAskSidenotes`
  default on, gating both the server endpoints and the SPA UI via
  `isQuickAskSidenotesEnabled()` / `useQuickAskSidenotesEnabled`) let a user
  select text in an assistant chat
  turn to run a cheap one-shot AI lookup, attached as a clickable 💡 bubble that
  never enters the conversation thread. Backend lives in
  `src/server/processes/chat-sidenotes/` (manager + prompt + one-shot invoker +
  `POST`/`GET`/`DELETE /api/processes/:processId/sidenotes` routes). The invoker
  is a thin adapter over `src/server/core/one-shot-ai.ts` — the shared helper for
  any stateless, tool-free, permissions-denied lookup. It routes text-only asks
  through the SDK `transform` primitive and falls back to `createCLIAIInvoker`
  with `loadMcpConfig: false` only when the ask carries attachments (the vision
  region-crop path), so neither branch starts ambient MCP servers. Use it for new
  one-shot call sites instead of wrapping `createCLIAIInvoker` directly, whose
  MCP default is tuned for agentic callers. Persistence
  is repo-scoped at `~/.coc/repos/<workspaceId>/chat-sidenotes/<sha256(processId)>.json`
  via `getRepoDataPath` (never a new top-level `~/.coc` dir). Model resolves
  `defaultModels.quickAsk` > `defaultModel` > CLI default. SPA components live in
  `.../react/features/chat/quick-ask/`; `useQuickAskSidenotes` issues all three
  calls via `requestForWorkspace(workspaceId, …)` so a remote clone's side-notes
  are stored on its own server — the routes only check the id shape, so a
  local-origin call would write the file under the LOCAL data dir. The selection
  pill (`QuickAskPill`) is a split pill: ✨ Ask AI plus, when `QuickAskTurnLayer`
  gets an `onAttachContext` prop, 📎 Attach, which files the selected text as
  chat context. Both actions ride this flag since the whole layer does; the
  right-click "Attach as context" item stays available when the flag is off.
- **Kusto query canvas** (`kusto.enabled`, default off) is a
  `type: 'kusto'` canvas branch on the generic canvas infrastructure. Its full
  state (KQL query, cluster/database, typed columns+rows capped at
  `MAX_KUSTO_ROWS`, chart config, last-run) serializes as JSON into the canvas
  `content` via `src/server/canvas/kusto-state.ts`. Queries execute server-side
  through `src/server/kusto/` (`kusto-exec.ts` = `azure-kusto-data` SDK +
  `AzureCliCredential`; `kusto-service.ts` = `runKustoCanvas` execute/truncate/
  persist), shared by the `POST /canvases/:id/run` route and the `kusto_query`
  LLM tool (`src/server/llm-tools/kusto-tools.ts`, gated by `buildKustoToolsAddon`
  reading `kusto.enabled`). Manual create is a `kusto`-only branch of the canvas
  create route, also gated on the flag. `executeKustoQuery` intercepts magic
  `mock:`-prefixed queries (case-insensitive) and serves inline data without a
  cluster or `az login`: `mock:<JSON {columns,rows}>` synthesizes that table,
  `mock:error[: msg]` throws (error state), `mock:big[: N]` emits N rows to
  exercise truncation — the synthetic response flows through the same coercion +
  cap as a real run, and any non-`mock:` query is byte-for-byte the SDK path.
  The SPA renders it with `KustoView`.
  `tsconfig.client.json` is a no-emit gate scoped to the Canvas/Kusto SPA surface
  and imported helpers. Keep the tool name exactly `kusto_query` and the
  serialized state keys stable.
- **Follow-up enqueue sites** must call `resolveFollowUpMode(...)` and set
  `payload.mode`. `FollowUpExecutor.executeFollowUp` fail-loud warns + defaults
  to `'ask'` if missing.
- **Stopped-chat follow-ups** (`cancelled` process with saved `sdkSessionId`)
  must carry `payload.resumeSessionId`; the follow-up executor sends
  `strictSessionResume: true` and must not persist or accept a replacement SDK
  session. If strict resume fails, persist
  `metadata.stoppedChatResume = { resumable: false, reason:
  'strict-resume-failed', ... }`; the REST API and SPA must treat that process
  as non-resumable and must not offer follow-up resume or a fresh-session
  fallback that continues the stopped chat. A terminal **failed** chat may still
  expose a "Retry task" button (`FollowUpInputArea` `onRetryTask` →
  `retry-task-button`, gated by `ChatDetail.canRetryFailedTask`) that re-runs the
  original task payload as a brand-new conversation via `client.queue.retry` —
  distinct from resuming the dead session.
- **Follow-up delivery decisions** (steer vs buffer vs enqueue) live in
  `src/server/processes/process-message-delivery-service.ts`, not the
  `POST /api/processes/:id/message` route. The route resolves the process,
  parses the body, processes attachments, normalizes scalar fields via
  `normalizeFollowUpInput(...)`, then calls `ProcessMessageDeliveryService.deliver`
  and emits the returned event intents exactly once. Buffered messages append
  through the store's atomic `ProcessStore.appendPendingMessage(...)` (read-append
  -persist under the store write lock) — never read-modify-write `pendingMessages`
  via `updateProcess`, which loses concurrent updates. Buffered delivery must not
  append a conversation turn (it is deferred to `drainPendingMessages`).
- **A commit chat's commit association** lives in two places on purpose:
  `commit_chat_bindings` routes the active chat for a hash, and
  `process.metadata.commitChat = { commitHash, commitMessage? }` is the durable
  per-conversation record (written by `ProcessLifecycleRunner` via
  `serializeCommitChatMetadata`, mirrored into the synthesized queued process and
  `buildMetadataProcess`, rebuilt into `payload.context` by
  `processToTaskDetail`, and rendered as the popover's Commit rows). Read it only
  through `readCommitChatContext`. Never derive the commit from `git rev-parse
  HEAD` or by parsing `fullPrompt`. A rebind must update both stores or roll back.
- **Process metadata field updates** from dashboard/server callers should use
  `client.processes.patchMetadata(...)` or API `metadataPatch` unless a full
  metadata replacement is intentional; full `metadata` on
  `PATCH /api/processes/:id` replaces the stored object.
- **Warm-client prewarming/status** is conversation-process scoped. Chat and
  follow-up send paths pass `warmKey: processId` whenever `keepWarm: true`;
  `/api/processes/:id/prewarm` and warm-only SSE status use that same process id.
  `workingDirectory` remains provider execution context only, not the warm key.
- **Per-conversation request budget** keeps opening a chat lean. A **warm**
  second open of a conversation (same SPA session, same workspace, provider
  already seen) must stay at **≤3** fetch round-trips — process detail,
  `canvases?processId=`, and `pull-request-chat-bindings?taskId=` — excluding the
  `stream?warm=1` SSE. Static provider/workspace config is cached client-side in
  the module-level singleton
  `src/server/spa/client/react/api/staticConfigCache.ts` (mirrors the AppContext
  `ConversationCacheEntry` 60-min-TTL pattern, **not** React-Query/SWR): `models`
  / `reasoning-efforts` / `effort-tiers` keyed by **provider**, `llm-tools-config`
  keyed by **workspace**; the provider/workspace config hooks read through
  `getOrFetchConfig` and seed from `peekConfig` (no loading flash), and every
  mutation site `invalidateConfig`s its own key (invalidate-on-mutate, no reload).
  Workspace-scoped data must not refetch per conversation: `useCrons` fetches
  keyed by `[workspaceId, cloneClient]` only (processId drives a `useMemo` view,
  never a round-trip) and the unseen `count` refresh fires only when a `markSeen`
  family call actually changes seen-state. The two remaining non-critical
  per-conversation fetches (`canvases.list`, `listChatBindingsForOrigin`) are
  deferred past first paint through `utils/runWhenIdle.ts` (requestIdleCallback
  with a timeout bound, setTimeout fallback for Safari/jsdom) so messages render
  first; synchronous panel/reset state stays immediate, and a generation/cancel
  guard drops a stale deferred fetch on an A→B switch. The four static-config GET
  routes also carry `Cache-Control: private, max-age=60` via
  `setStaticConfigCacheHeaders` in `src/server/shared/router.ts` (200-path only).
  Do not reintroduce a per-conversation refetch of cached config or
  workspace-scoped data, and do not add a new server aggregation/bootstrap
  endpoint — keep these as separate cached/deferred client calls.
- **Implement-plan target routing** (`ImplementPlanCard` + `implementTargets.ts`)
  keeps local runs path-based and remote runs content-embedded: a **local**
  target enqueues `Read and implement the plan file at <path>` + `context.files`
  on the current client, while a **remote** target reads the plan on the source
  client (`explorer.readTrustedBlob`), inlines it in the prompt, drops
  `context.files`, and enqueues on the target repo's routed `useCocClient`
  `CloneRef`. Targets come from `buildImplementTargets` (current repo + local +
  **online** remote clones only), scoped to the current repo's **canonical git
  origin** so only same-origin clones appear; the current origin is taken from
  the caller's `remoteUrl`, falling back to the current repo's own list entry
  (`gitInfo.remoteUrl ?? workspace.remoteUrl`, the same source candidates use) so
  the filter still engages for a remote-clone current workspace whose appState
  entry lacks a remote URL. The selector is gated on `isRemoteShellEnabled()`
  with no new flag. Implementation records (target identity + status) always
  persist on the **source** task via the source client. The card also surfaces
  for **canvas-backed plans**: `scanTurnsForPlanCanvas` (in `conversationScan.ts`)
  detects a `write_canvas` call with `purpose: 'plan'`, and `ChatDetail` passes
  the canvas id as `planCanvasId`. A canvas-backed plan has no on-disk path, so
  the card always reads the canvas content (`sourceClient.canvases.get`) and
  inlines it in the prompt for both local and remote targets. When the **source**
  workspace is itself a remote clone (`sourceIsRemote`/`sourceBaseUrl` props,
  derived in `ChatDetail` from the aggregated repo entry → `lookupCloneBaseUrl` →
  local workspace-list membership), the plan is always content-embedded and the
  source read / fallback enqueue route to the source server's baseUrl explicitly —
  never enqueue a remote machine's plan path as a path-reference (`context.files`)
  task, which the executor rewrites to `Follow the instruction <path>.` on the
  wrong server. `buildImplementTargets` carries the caller's
  `isRemote`/`baseUrl`/`serverLabel` when synthesizing the missing current repo
  instead of hardcoding a local target. Auto-detected conversations with multiple
  `.plan.md` files keep the full detected set in a shared banner/launch-panel
  selector even after the first path is persisted to metadata; explicit
  task-provided paths and canvas-backed plans remain single-plan. File-backed
  plan paths in the card are native controls that open the docked source canvas
  as `kind: 'note'` with the source workspace id, including remote workspaces;
  canvas-backed plan labels remain non-interactive because they have no file
  path.
- **Copilot long-context tier** is automatic at the provider boundary: chat
  and follow-up executors derive `contextTier` only via
  `getCopilotContextTierForModel` (tiered billing metadata —
  `billing.tokenPrices.longContext.contextMax`). Never hardcode model
  allow-lists, never infer support from `max_context_window_tokens`, and never
  send `contextTier` for Codex/Claude or when the metadata is absent.
- **Pull Requests Team auto-classification** must stay gated by
  `pullRequests.enabled`, `pullRequests.autoClassifyTeam`, and
  `features.focusedDiff`; use the generic classify-diff enqueue helper with the
  per-trigger cap and low priority instead of adding client-side POST loops.
  Classification result/pending files are origin-scoped and queued
  `pr-classification` payloads must carry the resolved classification storage
  origin so the `saveClassification` tool writes the same state route polling
  reads. The Team toolbar status UI reads origin batch status and routes manual
  "Classify now" actions through origin APIs backed by the same bounded server
  helper, passing workspace/repo metadata only to select the concrete clone.
- **Pull Request on-demand diff classification** must use
  `/api/origins/:originId/classify-diff` or
  `client.pullRequests.*Classification*ForOrigin(...)`, passing explicit
  workspace/repo metadata for queue routing and legacy migration. Repo-scoped
  `classify-diff` remains only for commit and branch-range classification.
- **Pull Request provider list/detail/subresource callers** must use
  `/api/origins/:originId/pull-requests...` or
  `client.pullRequests.*ForOrigin(...)`, passing `workspaceId` and optional
  `repoId` only to select the concrete clone for provider access. Do not add
  repo-scoped PR provider route aliases.
- **Pull Request review progress** for PR pop-out reviewed/visited file state is
  durable origin state. Callers must use
  `/api/origins/:originId/pull-requests/:prId/review-progress` or
  `client.pullRequests.*ReviewProgressForOrigin(...)`; workspace/repo metadata is
  for legacy migration only, not storage identity. Do not add repo-scoped route
  aliases for PR provider actions, recent-opened, Team roster, or
  review-progress state.
- **Native Copilot session reads** (`src/server/native-copilot-sessions/`)
  must stay strictly read-only against the native store: open
  `~/.copilot/session-store.db` with short-lived `readonly` SQLite connections,
  keep every user-provided filter parameterized (FTS terms literal-quoted), and
  return typed `db-missing`/`db-invalid` states instead of throwing. Never route
  native session IDs into CoC process/chat action handlers. Rich detail
  reconstruction reads the per-session log
  `~/.copilot/session-state/<id>/events.jsonl` via `session-state-parser.ts`
  (`parseNativeSessionState`), which maps the newline-delimited
  `{type,id,parentId,timestamp,data}` events (`user.message`,
  `assistant.message` with `content`/`reasoningText`/`model`,
  `tool.execution_start`/`_complete` correlated by `toolCallId`,
  `skill.invoked`) into `ReconstructedConversationTurn[]` and returns `null`
  (never throws) on a missing/malformed/empty log so callers fall back to the
  flat `session-store.db` turns. `getSession` populates
  `NativeCopilotSessionDetail.conversation` (always present) from the parser
  when it yields turns, else maps the flat DB turns into text-only
  user/assistant turns; the service accepts `sessionStateDir`/`parseSessionState`
  overrides for hermetic tests. The parser never writes to `~/.copilot` and
  rejects unsafe session ids (path traversal). The list route dedups
  against CoC processes by excluding native `sessions.id` values that match a
  workspace's `ProcessStore.getSdkSessionIds(workspaceId)` (the Copilot SDK/CLI
  session id equals the native store id) and hides automated background-job
  sessions whose first flat turn or stored summary matches
  `BACKGROUND_JOB_PROMPT_PREFIXES` (e.g. title summarization); the hidden counts
  are returned as `deduplicatedCount` and `backgroundJobCount`. The panel
  deep-links the selected session via
  `#repos/{wsId}/copilot-sessions/{sessionId}`. The read-only detail pane
  renders `NativeCopilotSessionDetail.conversation` as a rich transcript by
  reusing the existing chat `ConversationTurnBubble` (no fork): the SPA-local
  `nativeConversationTurns.ts` maps `ReconstructedConversationTurn[]` →
  `ClientConversationTurn[]`, folding assistant `thinking` into the content
  timeline as a markdown blockquote (the chat turn shape has no reasoning
  field). The metadata header is preserved and no follow-up/streaming/resume or
  per-turn (pin/archive/delete) actions are wired.
- **Native CLI session provider kernel** (`src/server/native-copilot-sessions/`)
  keeps provider identity in exactly one place. `NATIVE_CLI_PROVIDER_DESCRIPTORS`
  in `@plusplusoneplusplus/coc-client` declares each provider's id, label,
  external label, store hint, `searchStrategy`, and `available`/`planned`
  status. `native-cli-provider-registry.ts` (`createNativeCliSessionProviders`)
  builds the served provider map from the `available` descriptors and throws at
  server construction when one has no factory or reports a search strategy that
  disagrees with its descriptor. The route parser, the dashboard tab list, and
  `parseNativeCliSessionDeepLink` all gate on the same registry, so a provider
  can never be selectable in the UI without a server provider behind it. Add a
  provider by adding its descriptor plus a factory — never by widening a union
  or a hard-coded list. `opencode` is intentionally `planned`: it has no store
  reader, gets no tab, and its route requests return 400 with the descriptor's
  `plannedNote`.
- **File-backed transcript listing** goes through
  `native-transcript-index.ts`. The index caches parsed list metadata keyed by
  file path + `mtimeMs` + `size` (LRU-bounded, default 2000 files) so warm list
  requests only `stat`, and `beginPass()`/`readRaw()` ensure one request reads a
  transcript at most once even when metadata parsing and substring search both
  need it. Never read transcript bytes directly in a provider — go through the
  index so the caching and single-read guarantees hold.
- **Transcript parsers** live per provider under
  `native-copilot-sessions/parsers/` (`claude-transcript-parser.ts`,
  `codex-rollout-parser.ts`) over shared `transcript-parser-core.ts` helpers;
  `cli-session-parsers.ts` is a re-export barrel. Keep provider envelope
  handling inside its own module so a change to one CLI's format cannot regress
  another's reconstruction.
- **Native session route plumbing** (query parsing, workspace scope building,
  feature-disabled and store-unavailable envelopes) is shared by the unified
  `native-cli-session-routes.ts` and the legacy Copilot-only
  `native-copilot-session-routes.ts` aliases via
  `routes/native-session-route-utils.ts`. Fix behaviour there once rather than
  mirroring it across both controllers.
- **Work-item create/update side effects** (hierarchy `parentId` validation,
  GitHub/Azure Boards provider sync, response-cache invalidation, dashboard
  broadcasts, auto-execute) live in the shared command service
  `src/server/work-items/work-item-commands.ts`. Cache invalidation and
  broadcasts cover both the caller workspace id and the resolved origin/storage
  id when they differ, so workspace-compatible and origin-scoped views refresh
  together. The REST routes (`src/server/routes/work-item-routes.ts`) call the
  command service — do not re-implement hierarchy, provider logic, or mutation
  side effects in the route handlers. (There are no work-item LLM tools; work
  items are managed via REST and the dashboard only.)
- **Work-item hierarchy tree reads** are persistent origin state. New callers must
  use `/api/origins/:originId/work-items/tree` or
  `client.workItems.treeForOrigin(...)`; pass `workspaceId` only as clone
  metadata/validation.
- **Work-item chat bindings** are persistent origin state. New callers must use
  `/api/origins/:originId/work-item-chat-bindings...` or
  `client.workItems.*ChatBindingForOrigin(...)`; pass `workspaceId` only for
  fresh-chat archive/reset actions that need a concrete clone/process scope.
- **Work-item plan and plan-version reads/writes** are persistent origin state.
  New callers must use `/api/origins/:originId/work-items/:itemId/plan...` or
  `client.workItems.*Plan*ForOrigin(...)`; pass `workspaceId` only as clone
  metadata for origin validation.
- **Work-item change records** (plan-version/commit bundles) are persistent
  origin state. New callers must use
  `/api/origins/:originId/work-items/:itemId/changes...`; pass `workspaceId`
  only as clone metadata for origin validation.
- **Work-item sync/import/convert actions** are origin-scoped persistent state
  but require a concrete clone for provider configuration and transport. New
  callers must use `/api/origins/:originId/work-items/sync/status`,
  `/api/origins/:originId/work-items/import-from-*`, or
  `/api/origins/:originId/work-items/:itemId/convert-to-*` and always pass
  `workspaceId` so GitHub/Azure Boards access uses the selected workspace while
  imported/converted items write to the origin.
- **Work-item execution actions** are origin-scoped persistent state but require
  a concrete clone. New callers must use
  `/api/origins/:originId/work-items/:itemId/{execute,submit-pr,ai-review,resolve-comments}`
  or `client.workItems.*ForOrigin(...)`, always passing `workspaceId` so queue
  routing, git/PR operations, task files, and comment resolution use the
  selected workspace while execution history and broadcasts write to the origin.
- **Work-item AI authoring routes** are origin-scoped and require a concrete
  clone for generation context. New callers must use
  `/api/origins/:originId/work-items/ai-draft`,
  `/api/origins/:originId/work-items/:itemId/ai-draft`, or
  `/api/origins/:originId/work-items/:itemId/ai-draft/apply` through
  `client.workItems.*ForOrigin(...)`, always passing `workspaceId`; workspace
  AI-draft route aliases are not registered.
- **Direct package builds** use `scripts/prebuild.mjs` to build
  `@plusplusoneplusplus/coc-agent-sdk`, `@plusplusoneplusplus/coc-workflow`,
  `@plusplusoneplusplus/coc-memory`, `@plusplusoneplusplus/forge`,
  `@plusplusoneplusplus/coc-client`, and `@plusplusoneplusplus/coc-connector`
  before `tsc`, clean `dist` before emitting, and generate
  `src/server/core/build-info.ts` (commit hash plus the workspace **root**
  `package.json` version, which is what `GET /api/admin/version` and the admin
  page show); keep this script cross-platform.

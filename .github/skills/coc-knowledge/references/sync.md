# Notes Sync Subsystem

Git-backed synchronization of My Work and My Life notes across multiple machines. Uses a user-provided Git remote as the cloud hub with automatic periodic sync and AI-powered merge conflict resolution.

**Configuration:** Sync settings are per-workspace via `PerRepoPreferences.sync` (stored in `~/.coc/repos/<workspaceId>/preferences.json`). Sync is disabled when `sync.gitRemote` is absent or empty.

## Concepts

| Concept | Description |
|---------|-------------|
| **SyncEngine** | Core class that manages the sync lifecycle: clone/pull/push, conflict resolution, periodic scheduling, and status tracking. One instance per virtual workspace (my_work, my_life). |
| **Sync repo** | Per-workspace Git repos at `~/.coc/sync/my-work/` and `~/.coc/sync/my-life/`. Each maps to the root of its sync remote. |
| **Folder mapping** | `~/.coc/repos/my_work/notes/` ↔ `~/.coc/sync/my-work/` (repo root) and `~/.coc/repos/my_life/notes/` ↔ `~/.coc/sync/my-life/` (repo root). |
| **Lock file** | `~/.coc/sync/<subfolder>/.lock` prevents concurrent sync operations per workspace. Includes stale-lock detection via PID check. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Dashboard UI                                                        │
│  SyncSettingsSection (per-report RepoSettingsTab → Notes section)    │
│  Inline status pill, manual trigger, git remote / interval inputs    │
│  Polls GET /api/workspaces/:id/sync/status                          │
└──────────────┬───────────────────────────────────────────────────────┘
               │ REST
┌──────────────▼───────────────────────────────────────────────────────┐
│  sync-handler.ts                                                      │
│  GET  /api/workspaces/:workspaceId/sync/status  — current SyncStatus │
│  POST /api/workspaces/:workspaceId/sync/trigger — force immediate    │
└──────────────┬───────────────────────────────────────────────────────┘
               │ delegates (per-workspace engine from Map)
┌──────────────▼───────────────────────────────────────────────────────┐
│  SyncEngine (sync-engine.ts) — one per workspace                     │
│  start(gitRemote, intervalMinutes) → initial sync + periodic timer   │
│  triggerSync(remote) → one-off sync                                  │
│  performSync flow: copy local → commit → pull → resolve → push → copy│
└──────────────┬───────────────────────────────────────────────────────┘
               │ AI conflict resolution (optional)
┌──────────────▼───────────────────────────────────────────────────────┐
│  AIInvoker (from @plusplusoneplusplus/forge)                         │
│  Sends conflict prompt → receives resolved file content              │
│  Fallback: resolveConflictSimple (keep both sides, deduplicate)      │
└──────────────────────────────────────────────────────────────────────┘
```

## File Layout

| Path | Purpose |
|------|---------|
| `src/server/sync/sync-engine.ts` | `SyncEngine` class, `copyDirContents()`/`copyFileIfChanged()`, `nextSyncDelayMs()`, `resolveConflictSimple()`, `resolveConflictWithAI()`, `backupTagStamp()`, `SYNC_IGNORE_NAMES`; re-exports the interval constants. Also owns the private initial-reconcile phase — `reconcile()` and its helpers `readRemoteTree()`/`remoteDefaultBranch()`/`stageMergedTree()` — which runs git around the pure pieces in `sync-reconcile.ts`. **`reconcile()` exists but nothing calls it yet**; `performSync` is unchanged, so runtime behavior is still pre-reconcile. |
| `src/server/sync/sync-constants.ts` | Side-effect-free `DEFAULT_SYNC_INTERVAL_MINUTES` / `MAX_SYNC_BACKOFF_MINUTES` (no `child_process`/`fs`), so lightweight consumers avoid pulling in the engine |
| `src/server/sync/sync-reconcile.ts` | Detection, planning, and apply for the initial-reconcile phase. Detection: `ReconcileMarker`, `reconcileMarkerPath()`/`readReconcileMarker()`/`writeReconcileMarker()`, `isUnrelatedHistoriesError()`, `shouldReconcile()`, `isNotesTreeNonEmpty()`. Planning: `planUnionMerge()` plus `isDecodableText()`/`localVariantPath()`. Apply: `scanTreeToMap()` reads a tree into `Map<posix path, Buffer>`, `buildConflictBlob()` synthesizes the add/add blob the existing resolvers consume (local = ours, remote = theirs), `applyMergePlan()` writes the merged tree — materializing every entry, skipping unchanged bytes, deleting nothing. Reporting: `reconcileCommitMessage()` builds the squashed commit's subject + the body that enumerates every AI-combined and flagged path. A leaf of the import graph — the engine imports it, so the ignore set and the conflict resolver are passed in rather than imported back. Runs no git. |
| `src/server/sync/sync-handler.ts` | REST route registration (`registerSyncRoutes`) — workspace-scoped |
| `src/server/sync/index.ts` | Barrel exports |
| `src/server/spa/client/react/features/repo-settings/SyncSettingsSection.tsx` | Per-report sync config UI (git remote, interval, status, trigger) |

## Per-Workspace Configuration

Sync settings live in `PerRepoPreferences.sync` (in `preferences-handler.ts`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sync.gitRemote` | string | (absent) | Git remote URL. Sync disabled when empty/absent. |
| `sync.intervalMinutes` | number | `30` (`DEFAULT_SYNC_INTERVAL_MINUTES`) | Periodic sync interval in minutes. Schema floor is 1 (`.int().min(1)`); below-floor values are dropped and fall back to the default. The default is a single shared constant in the side-effect-free `sync-constants.ts` (re-exported by `sync-engine.ts`), used at both call sites (`index.ts` bootstrap, `preferences/live-effects.ts`). `live-effects.ts` imports it from `sync-constants.ts` so it never pulls the engine (and its `child_process`/`fs` deps) into handler-test import graphs. |

Server bootstrap creates two `SyncEngine` instances (`syncEngines: Map<string, SyncEngine>`) for `my_work` and `my_life`, reading preferences from `~/.coc/repos/<workspaceId>/preferences.json`. The `syncEngines` map is also passed to `registerPreferencesRoutes`; successful repo preference writes invoke the preferences live-effects coordinator, which starts or disables the matching live engine and logs reconfiguration errors without rolling back the saved preferences.

## Sync Flow (performSync)

1. **Ensure sync repo** — Clone from remote, or verify existing clone's remote URL matches.
2. **Copy local → repo** — Mirror workspace notes dir to sync repo root via `copyDirContents` with `ignore: SYNC_IGNORE_NAMES` (`.git`, `.lock`). Only changed files are rewritten (`copyFileIfChanged` skips a copy when size + content match and preserves mtime), so an unchanged tree costs stats/reads, not writes.
3. **Stage local changes** — `git add -A`, then `git diff --cached --quiet` to detect whether anything is actually staged. After the changed-only copy this is a cheap stat pass with nothing to re-hash on an idle tree.
4. **Idle short-circuit** — If nothing is staged **and** the remote has no new commits (`ls-remote origin HEAD` vs local `HEAD`), return early: no commit, pull, push, or copy-back. An idle tick writes nothing and issues no network mutation.
5. **Commit local changes** — Only when there are staged changes: `git commit` with hostname + timestamp message.
6. **Pull remote** — `git pull --no-rebase origin HEAD`. Detects conflicts via error output.
7. **Resolve conflicts** — If merge conflicts, iterate conflicted files:
   - **AI path**: Send file with conflict markers to `AIInvoker`, validate response (strip code fences, reject residual markers).
   - **Fallback**: `resolveConflictSimple()` keeps both sides, deduplicates identical content.
   - **Last resort**: `git checkout --theirs <file>`.
8. **Push to remote** — `git push -u origin HEAD`. Failure is non-fatal (retries next cycle).
9. **Copy repo → local** — Mirror resolved content back to local notes directory (changed files only; excludes `.git` and `.lock`).

## Initial Reconcile (SyncEngine.reconcile)

The one-time union merge for pointing an existing notebook at a remote that already
has content. **Not yet reachable at runtime** — the method is complete and tested,
but `performSync` does not branch into it yet, so the flow above is still what runs.

The flow above is wrong twice over on first contact: step 2 mirror-deletes every
remote note missing locally, and step 6's pull refuses to merge two histories with
no common commit. Reconcile replaces steps 2–9 for exactly one sync:

1. **Read both trees** — local from the notes dir (`scanTreeToMap`); remote from
   **git objects** at the fetched `FETCH_HEAD` (`ls-tree -r --name-only -z` +
   `git show <ref>:<path>` through a buffer-safe `gitBuffer()`, so binaries and
   trailing newlines survive). Reading the remote off disk would be wrong: on the
   unrelated-histories path the working tree holds the *local* mirror.
2. **Plan** — `planUnionMerge()` decides every path (see `sync-reconcile.ts`).
3. **Re-parent** — `symbolic-ref HEAD refs/heads/<remote default branch>` then
   `reset --mixed <remoteHead>`: moves HEAD onto the remote's branch and loads its
   tree into the index **without touching the working tree**. The merged tree is
   then just the diff staged on top, so the commit lands as a child of the remote's
   tip and the push fast-forwards. This is what gives later syncs the common
   ancestor a 3-way pull needs.
4. **Apply** — `applyMergePlan()` with the engine's private `resolveFileConflict`
   injected as the resolver (AI → `resolveConflictSimple` fallback, never throws).
5. **Backup, then push** — tag the remote's pre-merge tip `sync-backup/<stamp>`
   (`backupTagStamp()` flattens the ISO colons git rejects in ref names) and push
   **the tag before the branch**, so a half-done reconcile is still undoable.
   Staging excludes `SYNC_IGNORE_NAMES` so the live `.lock` stays out of the commit.
   The push is raw `git push` — deliberately *not* `pushToRemote()`, which swallows
   failures to retry later; here a failed push must abort before the marker.
6. **Copy back + retire** — `copyRepoToLocal()`, then `writeReconcileMarker()`.

Ordering is the correctness property: **marker only after a successful push**. If
anything fails, no marker is written and the next tick re-runs the merge, which is
safe because the union merge is idempotent (a re-run stages nothing and pushes
nothing). Both orderings are pinned by tests using a `pre-receive` hook that rejects
only branch updates.

## Scheduling & Backoff

The periodic timer is a self-rescheduling `setTimeout` chain (not a fixed `setInterval`) so the delay can adapt:

- On a **successful** tick the next delay resets to the base interval (`intervalMinutes`).
- On a **failed** tick the delay doubles, capped at `MAX_SYNC_BACKOFF_MINUTES` (30 min), so a broken remote backs off instead of hammering the disk every interval. The pure helper `nextSyncDelayMs()` computes the next delay.
- A generation counter guards the chain: `stop()` (and reconfiguring via `start()`) bumps the generation so an in-flight tick can't resurrect a stopped timer.

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces/:workspaceId/sync/status` | Returns `SyncStatus` JSON. 404 if workspace doesn't support sync. |
| `POST` | `/api/workspaces/:workspaceId/sync/trigger` | Force immediate sync. Returns updated `SyncStatus` on success, 400 if not configured, 500 on error. |

Only `my_work` and `my_life` workspace IDs are valid for sync routes.

## Invariants

- **Per-workspace engines**: Each workspace has its own SyncEngine, sync repo dir, and lock file.
- **Repo-scoped data**: Sync repos live at `~/.coc/sync/my-work/` and `~/.coc/sync/my-life/`.
- **No credential management**: Assumes SSH keys or Git credential helpers are pre-configured.
- **Scope limited to notes**: Only files in workspace note directories are synced.
- **Idle syncs are near-free**: An idle tick (no local edits, no remote commits) rewrites no files, re-hashes nothing, and issues no commit/pull/push/copy-back.
- **Changed-only copies**: Both copy directions rewrite only files whose content differs, keeping mtimes stable so `git add -A` doesn't re-hash the whole tree.
- **`.git`/`.lock` are protected**: `SYNC_IGNORE_NAMES` is applied to both the copy and mirror-delete passes in both directions, so the sync repo's own `.git` and `.lock` are never copied over or deleted (no re-init/re-clone loop).
- **Failure backoff**: Repeated failing syncs grow the next delay geometrically (cap 30 min); a success resets it to the base interval.
- **Non-blocking startup**: Initial sync is fire-and-forget — server startup never waits for sync to complete.
- **Error isolation**: Sync failures are logged and surfaced in status but never crash the server.
- **Locking**: Only one sync operation runs at a time per workspace, enforced by `.lock` with stale-PID detection.
- **Live reconfiguration**: Saving sync preferences through repo preferences calls `engine.start()` after the preferences file is written, activating or disabling the engine without a restart. Passing an empty `gitRemote` to `start()` disables the engine and stops its timer.

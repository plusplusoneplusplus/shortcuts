# Notes Sync Subsystem

Git-backed synchronization of My Work and My Life notes across machines. A user-provided Git remote is the hub; sync runs on a periodic timer with AI-assisted merge conflict resolution.

Configuration is per-workspace via `PerRepoPreferences.sync` in `~/.coc/repos/<workspaceId>/preferences.json`. Sync is disabled when `sync.gitRemote` is absent or empty.

## Concepts

| Concept | Description |
|---------|-------------|
| **SyncEngine** | Owns the sync lifecycle (clone/pull/push, conflict resolution, scheduling, status). One instance per virtual workspace (`my_work`, `my_life`). |
| **Sync repo** | Per-workspace mirrors at `~/.coc/sync/my-work/` and `~/.coc/sync/my-life/`, each mapped to its remote's root; the local side is `~/.coc/repos/<workspace>/notes/`. |
| **Lock file** | `~/.coc/sync/<subfolder>.lock` serializes sync per workspace, with stale-PID detection. It sits *beside* the mirror, never inside it: a lock in the working tree blocks `git clone .`, gets committed by `git add -A`, and is deleted by a rebuild out from under the tick holding it. |

## Architecture

```
SyncSettingsSection (RepoSettingsTab → Notes), polls status every 30s
   │ REST
sync-handler.ts — /api/workspaces/:workspaceId/sync/{status,trigger}
   │ delegates to the per-workspace engine in the `syncEngines` Map
SyncEngine — start(gitRemote, intervalMinutes) | triggerSync(remote)
   performSync: copy local → commit → pull → resolve → push → copy back
   │ conflict resolution (optional)
AIInvoker (@plusplusoneplusplus/forge); fallback resolveConflictSimple
```

## File Layout

| Path | Purpose |
|------|---------|
| `src/server/sync/sync-engine.ts` | `SyncEngine`, `copyDirContents()`/`copyFileIfChanged()`, `nextSyncDelayMs()`, `resolveConflictSimple()`, `resolveConflictWithAI()`, `backupTagStamp()`, `SYNC_IGNORE_NAMES`; re-exports the interval constants. Owns the git-running side of reconcile — private `reconcile()` with `readRemoteTree()`/`remoteDefaultBranch()`/`stageMergedTree()`, the two branches into it (`needsReconcile()`, the `isUnrelatedHistoriesError` catch around the pull), and `recordSyncBaseline()`. |
| `src/server/sync/sync-constants.ts` | Side-effect-free `DEFAULT_SYNC_INTERVAL_MINUTES` / `MAX_SYNC_BACKOFF_MINUTES` (no `child_process`/`fs`), so light consumers avoid importing the engine. |
| `src/server/sync/sync-reconcile.ts` | Pure detection/planning/apply for reconcile; runs no git. Detection: `ReconcileMarker`, `reconcileMarkerPath()`/`readReconcileMarker()`/`writeReconcileMarker()`, `isUnrelatedHistoriesError()`, `shouldReconcile()`, `isNotesTreeNonEmpty()`. Planning: `planUnionMerge()`, `isDecodableText()`, `localVariantPath()`. Apply: `scanTreeToMap()` (tree → `Map<posix path, Buffer>`), `buildConflictBlob()` (synthesizes the add/add blob the resolvers consume; local = ours, remote = theirs), `applyMergePlan()` (materializes every entry, skips unchanged bytes, deletes nothing). Reporting: `reconcileCommitMessage()`, `summarizeMergePlan()`, `reconcileReport()`. Steady-state audit: `SyncResolutionReport`/`ResolvedFile`/`ResolutionStrategy`, `resolutionMarkerPath()`/`readResolutionMarker()`/`writeResolutionMarker()` (`coc-last-resolution.json`), `resolutionCommitMessage()`, `resolutionStrategyLabel()`. A leaf of the import graph — the ignore set and the conflict resolver are injected by the engine. |
| `src/server/sync/sync-handler.ts` | `registerSyncRoutes` — workspace-scoped REST. |
| `src/server/sync/index.ts` | Barrel exports. |
| `src/server/spa/client/react/features/repo-settings/SyncSettingsSection.tsx` | Sync config UI, reconcile in-progress state and one-time report (`reconcileSummaryText()`), push-pending pill, steady-state `ResolutionReportRow`. |
| `packages/coc-client/src/domains/sync.ts` | Hand-maintained mirror of `SyncStatus` + report types — what the SPA compiles against. Rebuild its `dist` after a change. |

## Per-Workspace Configuration

`PerRepoPreferences.sync` (schema in `preferences-handler.ts`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sync.gitRemote` | string | (absent) | Remote URL. Sync disabled when empty/absent. |
| `sync.intervalMinutes` | number | `30` (`DEFAULT_SYNC_INTERVAL_MINUTES`) | Periodic interval. Schema floor is 1 (`.int().min(1)`); below-floor values are dropped and take the default. Both call sites (`index.ts` bootstrap, `preferences/live-effects.ts`) read the constant from `sync-constants.ts`, so `live-effects.ts` never pulls the engine's `child_process`/`fs` deps into handler-test import graphs. |

Server bootstrap creates two engines in `syncEngines: Map<string, SyncEngine>` from each workspace's preferences file. The map is also passed to `registerPreferencesRoutes`; a successful repo preference write invokes the preferences live-effects coordinator, which starts or disables the matching engine and logs reconfiguration errors without rolling back the saved preferences.

## Sync Flow (performSync)

1. **Ensure sync repo** — Reuse the mirror when `isUsableGitRepo()` passes, fixing up `origin` if the configured remote changed; otherwise clear the directory and `git clone <url> .`. `isUsableGitRepo()` is `rev-parse --is-inside-work-tree` **plus `for-each-ref`**: the first passes on a mirror whose branch names a missing object, which poisons every later fetch (git reports `did not send all necessary objects`, blaming the remote for local damage). `for-each-ref` resolves every ref to its object and stays quiet on a repo with no refs, so a clone of an empty remote (unborn HEAD) isn't mistaken for damage. There is no `git init` fallback — cloning an empty remote succeeds on its own, so every clone failure fails the tick and retries rather than manufacturing a history the remote has never seen.
1b. **Reconcile?** — `needsReconcile(baseline)` = `shouldReconcile({markerPresent, localTreeNonEmpty, remoteHasCommits})`. When true, run the reconcile phase and finish the tick; it pushes and copies back itself. Asked before step 2 because step 2 is the destructive one. The tick reads the marker once here and hands it to step 2 too — two reads could disagree on whether deleting the remote's notes is allowed.
2. **Copy local → repo** — Mirror the notes dir to the sync repo root via `copyDirContents` with `ignore: SYNC_IGNORE_NAMES` (`.git`, `.lock`). `copyFileIfChanged` skips a copy when size + content match and preserves mtime, so an unchanged tree costs stats/reads, not writes. **Mirror-delete is baseline-gated**: `copyLocalToRepo(hasBaseline)` passes `mirrorDeletes` through, so a path missing locally is pushed as a deletion only once a marker exists.
3. **Stage local changes** — `git add -A -- . :(exclude)<ignored>`, then `git diff --cached --quiet` to detect whether anything is staged. Exclusions match `stageMergedTree`. After the changed-only copy this is a cheap stat pass.
4. **Idle short-circuit** — If nothing is staged **and** the remote has no new commits (`ls-remote origin HEAD` vs local `HEAD`), skip commit/pull/push and finish after the copy-back. The copy-back is never skipped: the mirror can hold notes this device has never had on disk, and no other step puts them there. It writes nothing when the device already agrees.
5. **Commit local changes** — Only when staged changes exist: `git commit` with a hostname + timestamp message.
6. **Pull remote** — `git pull --no-rebase origin HEAD`. Conflicts are detected via `gitErrorText(err)`, which concatenates the exec error's `.message`, `.stdout`, and `.stderr`: git writes `CONFLICT`/`Automatic merge failed` to **stdout**, so a message-only check would miss every steady-state conflict and mislabel it a hard error. A pull failing `isUnrelatedHistoriesError` falls into reconcile and finishes the tick there — the self-healing path for a mirror with no shared history and no marker (e.g. a remote re-pointed after reconcile retired).
7. **Resolve conflicts** — Iterate conflicted files, recording each file's `ResolutionStrategy`:
   - `'ai'`: send the file with conflict markers to `AIInvoker`, validate the response (strip code fences, reject residual markers).
   - `'simple'`: `resolveConflictSimple()` keeps both sides and deduplicates identical content — also the path when no `AIInvoker` is configured or the AI call throws.
   - `'keptRemoteFallback'`: `git checkout --theirs <file>`, dropping this device's edit; recorded loudly because it is lossy.
   The resolution commit uses `resolutionCommitMessage()` (enumerating file + strategy); `recordResolution()` then sets `status.lastResolution` and writes `coc-last-resolution.json` beside the reconcile marker.
8. **Push to remote** — `git push -u origin HEAD`. Failure is non-fatal: `pushToRemote()` reports whether the push landed and on failure sets `status.pushPending = true` + `status.lastPushError`, cleared only by a later successful push. A repeat failure while already pending logs at `error` (stuck) rather than `warn`. This stays out of `lastError`: the local sync completed, only the push didn't land.
9. **Copy repo → local** — `copyRepoToLocal(hasBaseline, tickStartMs)` mirrors back to the notes dir (changed files only; excludes `.git`/`.lock`). It is a mirror, not an append: a note deleted on the remote must reach local, or step 2 re-pushes it next tick (resurrection). `mirrorDeletes: hasBaseline` gates it as in step 2. **Mid-tick creation guard**: `preserveNewerThanMs: tickStartMs` (stamped before any copy) spares any local entry whose mtime is at/after the cutoff — a note written after the clone was snapshotted is absent from the clone but is not a deletion; it syncs next tick. Reconcile passes `hasBaseline: false`.
10. **Record the baseline** — Only when the push landed and no marker exists: `recordSyncBaseline()` writes the same marker reconcile writes. A landed push means the sides now share history by the ordinary route (the remote was empty, so the first push *is* the shared history). Without it the next tick would see a remote that suddenly has commits and no marker, re-enter reconcile, and union-merge the notes with the copies it just pushed.

## Initial Reconcile (SyncEngine.reconcile)

The one-time union merge for pointing an existing notebook at a remote that already has content, reached from step 1b detection or the step-6 pull fallback. The normal flow can't handle first contact: it treats local as authoritative, step 6's pull refuses to merge histories with no common commit, and only this phase brings the remote's notes down. Reconcile replaces steps 2–10 for exactly one sync:

1. **Read both trees** — local from the notes dir (`scanTreeToMap`); remote from **git objects** at the fetched `FETCH_HEAD` (`ls-tree -r --name-only -z` + `git show <ref>:<path>` via a buffer-safe `gitBuffer()`, so binaries and trailing newlines survive). Reading the remote off disk would be wrong: on the unrelated-histories path the working tree holds the *local* mirror.
2. **Plan** — `planUnionMerge()` decides every path.
3. **Re-parent** — `symbolic-ref HEAD refs/heads/<remote default branch>` then `reset --mixed <remoteHead>`: moves HEAD onto the remote's branch and loads its tree into the index **without touching the working tree**. The merged tree is then just the diff staged on top, so the commit lands as a child of the remote's tip, the push fast-forwards, and later syncs have the common ancestor a 3-way pull needs.
4. **Apply** — `applyMergePlan()` with the engine's private `resolveFileConflict` injected as resolver (AI → `resolveConflictSimple` fallback, never throws).
5. **Backup, then push** — tag the remote's pre-merge tip `sync-backup/<stamp>` (`backupTagStamp()` flattens the ISO colons git rejects in ref names) and push **the tag before the branch**, so a half-done reconcile is undoable. Staging excludes `SYNC_IGNORE_NAMES`. The push is raw `git push`, not `pushToRemote()` — that swallows failures to retry later, but here a failed push must abort before the marker.
6. **Copy back + retire** — `copyRepoToLocal(false, …)`, then `writeReconcileMarker()` carrying the `ReconcileSummary` the report is served from.

Ordering is the correctness property: **marker only after a successful push**. If anything fails no marker is written and the next tick re-runs the merge, which is safe because the union merge is idempotent. Both orderings are pinned by tests using a `pre-receive` hook that rejects only branch updates.

The two entry points cover different states, and neither alone suffices:

| State | Caught by | Why the others can't |
|-------|-----------|----------------------|
| Local notes + remote with commits, no marker | 1b detection | A mirror cloned from the remote shares its history, so the pull succeeds and step 2's mirror-delete gets pushed. |
| Empty local + a mirror on an unrelated history | step-6 fallback | Detection needs local notes to contribute (`localTreeNonEmpty`). |
| Marker present, remote re-pointed to an unrelated repo | step-6 fallback | The marker retires detection. |
| Empty local + mirror cloned from the remote | **neither** — the step-2 baseline gate | Detection needs local notes; shared history means the pull can't fail. Nothing merges here and nothing needs to: suppressing the delete leaves the tick idle, the pull brings the notes down, and the landed push records the baseline. |

### The one-time reconcile report

The merge is unattended, so the only account the user gets is what `SyncStatus` carries:

- `reconcileInProgress` — true only while the merge runs. It reads both trees and may call the AI once per colliding note, so it far outlasts a normal tick and is its own state rather than plain "syncing".
- `reconcileReport` — `ReconcileSummary` (`counts` straight off `MergePlan.counts`, `total`, the `combined` list, `flagged` binaries with the path each local copy was parked at, `backupTag`) plus the `mergedCommit`/`reconciledAt` it landed at. `summarizeMergePlan()` derives it; `reconcileReport(marker)` reassembles it.

Two load-bearing lifetime rules: it is **persisted on the marker** (which already anchors that merge by SHA) and re-read by `start()`, so a restart doesn't erase it; and **nothing ever clears it** — it describes a one-time event, so it stops changing rather than expiring on a later tick. An ordinary first push to an *empty* remote records a baseline marker with **no** report, leaving `reconcileReport` null.

### The steady-state resolution report

The same audit pattern extends to every steady-state tick that auto-merges, so a two-device conflict isn't invisible once reconcile has retired:

- `SyncResolutionReport` (`resolvedAt`, `files: ResolvedFile[]`, `commit`) records one `{ path, strategy }` per file. `strategy` is `'ai'` | `'simple'` | `'keptRemoteFallback'`; the last is lossy and surfaced as such.
- It lives on `status.lastResolution`, is persisted to `.git/coc-last-resolution.json` (`readResolutionMarker()`/`writeResolutionMarker()`, a temp-file+rename write mirroring the reconcile marker), and is hydrated in `start()`. An idle tick never clears it — only a newer resolving tick replaces it.
- `resolutionCommitMessage()` enumerates the same files+strategies, so the record outlives the UI in git history.

### Push pending

`status.pushPending` / `status.lastPushError` are the third status axis: a failed push leaves the local sync consistent (merged tree committed) with the commit unpushed — a soft, self-retrying state distinct from `lastError` (a tick that didn't complete). The next tick retries because the local commit is ahead of the remote (`remoteHasNewCommits()` is true); a successful `pushToRemote()` clears both fields.

### Where the user reads it

`SyncSettingsSection.tsx` renders both reports off the `SyncStatus` its 30s poll fetches. `reconcileSummaryText()` states all four counts in one sentence, names every AI-combined note, lists where each flagged binary's local copy was parked, and names the backup tag so the undo is discoverable.

Status precedence: `reconcileInProgress` → `inProgress` → `lastError` → `pushPending` → OK → Disabled. `reconcileInProgress` outranks `inProgress` because both are true during the merge and the merge is the one long enough to look hung; a hard error still outranks `pushPending` because the tick didn't complete. The in-progress state **replaces** the report rather than joining it: on the self-healing path a marker and report already exist when the pull re-merges, so rendering both would present the last merge's summary as the running one's.

A report that can't be read back (corrupt/wrong-shaped) drops on its own and leaves the marker valid — losing it costs a summary, whereas dropping the marker would re-run the merge and unsuppress mirror-deletes.

`SyncStatus` is mirrored by hand in `packages/coc-client/src/domains/sync.ts` (`ReconcileReport`, `FlaggedBinary`, `MergeOutcome`, `ResolutionStrategy`/`ResolvedFile`/`SyncResolutionReport`, plus the `pushPending`/`lastPushError`/`lastResolution` fields). That copy is what the SPA compiles against, and `packages/coc` typechecks against coc-client's built `dist`, so a new field needs `npm run build` in coc-client to become visible.

## Scheduling & Backoff

The periodic timer is a self-rescheduling `setTimeout` chain (not `setInterval`) so the delay can adapt. A successful tick resets the delay to `intervalMinutes`; a failed tick doubles it, capped at `MAX_SYNC_BACKOFF_MINUTES` (30 min). The pure helper `nextSyncDelayMs()` computes it. A generation counter guards the chain: `stop()` and reconfiguration via `start()` bump the generation so an in-flight tick can't resurrect a stopped timer.

## REST Endpoints

Only `my_work` and `my_life` are valid workspace IDs for these routes.

- `GET /api/workspaces/:workspaceId/sync/status` — `SyncStatus` JSON; 404 if the workspace doesn't support sync.
- `POST /api/workspaces/:workspaceId/sync/trigger` — force immediate sync; returns updated `SyncStatus`, 400 if not configured, 500 on error.

## Invariants

- **Per-workspace engines**: each workspace has its own engine, sync repo dir, and lock file under `~/.coc/sync/`. Only files in workspace note directories sync.
- **No credential management**: SSH keys or Git credential helpers must be pre-configured.
- **Idle syncs are near-free**: an idle tick rewrites no files, re-hashes nothing, and issues no commit/pull/push. It still runs the copy-back, which writes nothing once the device holds the mirror's notes.
- **First contact merges, never mirrors**: the first sync against a remote that already has commits union-merges both sides and leaves a `sync-backup/<stamp>` tag on the pre-merge tip. Reconcile runs at most once per workspace; its marker is written only after the merge (or a normal first push) lands on the remote.
- **An automatic merge always explains itself**: every reconcile is auditable from the squashed commit body and the `reconcileReport` on the marker, both outliving the process. Neither is ever cleared, and no raw conflict marker reaches the user.
- **A deletion needs a baseline behind it**: the outbound copy propagates a deletion only when the workspace has a reconcile marker — the point at which both sides were proven to hold the same notes. Before it, "absent locally" may just mean this device was never told, so an empty or half-restored notes dir can't mirror-delete a remote it has never merged with (the one state neither route into reconcile catches). Past the baseline a real delete propagates normally: the guard is about first contact, not about making sync append-only.
- **Changed-only copies**: both directions rewrite only files whose content differs, keeping mtimes stable so `git add -A` doesn't re-hash the tree.
- **`.git`/`.lock` are protected**: `SYNC_IGNORE_NAMES` applies to the copy and mirror-delete passes in both directions, so the sync repo's `.git` is never copied over or deleted (no re-init/re-clone loop), and a remote carrying a committed `.lock` never copies it onto a device or stages it again.
- **Non-blocking startup**: initial sync is fire-and-forget; server startup never waits on it. Failures are logged and surfaced in status but never crash the server.
- **Live reconfiguration**: saving sync preferences calls `engine.start()` after the preferences file is written, activating or disabling the engine without a restart. An empty `gitRemote` disables the engine and stops its timer.

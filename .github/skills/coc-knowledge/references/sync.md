# Notes Sync Subsystem

Git-backed synchronization of My Work and My Life notes across multiple machines. Uses a user-provided Git remote as the cloud hub with automatic periodic sync and AI-powered merge conflict resolution.

**Configuration:** Sync settings are per-workspace via `PerRepoPreferences.sync` (stored in `~/.coc/repos/<workspaceId>/preferences.json`). Sync is disabled when `sync.gitRemote` is absent or empty.

## Concepts

| Concept | Description |
|---------|-------------|
| **SyncEngine** | Core class that manages the sync lifecycle: clone/pull/push, conflict resolution, periodic scheduling, and status tracking. One instance per virtual workspace (my_work, my_life). |
| **Sync repo** | Per-workspace Git repos at `~/.coc/sync/my-work/` and `~/.coc/sync/my-life/`. Each maps to the root of its sync remote. |
| **Folder mapping** | `~/.coc/repos/my_work/notes/` ↔ `~/.coc/sync/my-work/` (repo root) and `~/.coc/repos/my_life/notes/` ↔ `~/.coc/sync/my-life/` (repo root). |
| **Lock file** | `~/.coc/sync/<subfolder>.lock` prevents concurrent sync operations per workspace. Includes stale-lock detection via PID check. It sits *beside* the mirror, never inside it: a lock in the working tree is one `git clone .` refuses to clone into, `git add -A` commits into the user's notes, and a rebuild deletes out from under the tick holding it. |

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
| `src/server/sync/sync-engine.ts` | `SyncEngine` class, `copyDirContents()`/`copyFileIfChanged()`, `nextSyncDelayMs()`, `resolveConflictSimple()`, `resolveConflictWithAI()`, `backupTagStamp()`, `SYNC_IGNORE_NAMES`; re-exports the interval constants. Also owns the private initial-reconcile phase — `reconcile()` and its helpers `readRemoteTree()`/`remoteDefaultBranch()`/`stageMergedTree()` — which runs git around the pure pieces in `sync-reconcile.ts`, plus the two branches into it (`needsReconcile()`, the `isUnrelatedHistoriesError` catch around the pull) and `recordSyncBaseline()`. |
| `src/server/sync/sync-constants.ts` | Side-effect-free `DEFAULT_SYNC_INTERVAL_MINUTES` / `MAX_SYNC_BACKOFF_MINUTES` (no `child_process`/`fs`), so lightweight consumers avoid pulling in the engine |
| `src/server/sync/sync-reconcile.ts` | Detection, planning, and apply for the initial-reconcile phase. Detection: `ReconcileMarker`, `reconcileMarkerPath()`/`readReconcileMarker()`/`writeReconcileMarker()`, `isUnrelatedHistoriesError()`, `shouldReconcile()`, `isNotesTreeNonEmpty()`. Planning: `planUnionMerge()` plus `isDecodableText()`/`localVariantPath()`. Apply: `scanTreeToMap()` reads a tree into `Map<posix path, Buffer>`, `buildConflictBlob()` synthesizes the add/add blob the existing resolvers consume (local = ours, remote = theirs), `applyMergePlan()` writes the merged tree — materializing every entry, skipping unchanged bytes, deleting nothing. Reporting: `reconcileCommitMessage()` builds the squashed commit's subject + the body that enumerates every AI-combined and flagged path, and `summarizeMergePlan()`/`reconcileReport()` build the `SyncStatus` report the settings panel shows. A leaf of the import graph — the engine imports it, so the ignore set and the conflict resolver are passed in rather than imported back. Runs no git. |
| `src/server/sync/sync-handler.ts` | REST route registration (`registerSyncRoutes`) — workspace-scoped |
| `src/server/sync/index.ts` | Barrel exports |
| `src/server/spa/client/react/features/repo-settings/SyncSettingsSection.tsx` | Per-report sync config UI (git remote, interval, status, trigger) plus the initial merge's in-progress state and one-time report; `reconcileSummaryText()` is the summary wording |
| `packages/coc-client/src/domains/sync.ts` | Hand-maintained mirror of `SyncStatus` + the report types — what the SPA compiles against. Rebuild its `dist` after a change |

## Per-Workspace Configuration

Sync settings live in `PerRepoPreferences.sync` (in `preferences-handler.ts`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sync.gitRemote` | string | (absent) | Git remote URL. Sync disabled when empty/absent. |
| `sync.intervalMinutes` | number | `30` (`DEFAULT_SYNC_INTERVAL_MINUTES`) | Periodic sync interval in minutes. Schema floor is 1 (`.int().min(1)`); below-floor values are dropped and fall back to the default. The default is a single shared constant in the side-effect-free `sync-constants.ts` (re-exported by `sync-engine.ts`), used at both call sites (`index.ts` bootstrap, `preferences/live-effects.ts`). `live-effects.ts` imports it from `sync-constants.ts` so it never pulls the engine (and its `child_process`/`fs` deps) into handler-test import graphs. |

Server bootstrap creates two `SyncEngine` instances (`syncEngines: Map<string, SyncEngine>`) for `my_work` and `my_life`, reading preferences from `~/.coc/repos/<workspaceId>/preferences.json`. The `syncEngines` map is also passed to `registerPreferencesRoutes`; successful repo preference writes invoke the preferences live-effects coordinator, which starts or disables the matching live engine and logs reconfiguration errors without rolling back the saved preferences.

## Sync Flow (performSync)

1. **Ensure sync repo** — Reuse the mirror when `isUsableGitRepo()` says it is one, fixing up `origin` if the configured remote changed; otherwise clear the directory and `git clone <url> .` into it. `isUsableGitRepo()` is `rev-parse --is-inside-work-tree` **plus `for-each-ref`**: the first only proves a worktree exists and still passes on a mirror whose branch names a missing object, which poisons every later fetch (the connectivity check fails and git reports `did not send all necessary objects`, blaming the remote for local damage). `for-each-ref` resolves every ref through to its object, and stays quiet on a repo with no refs, so a clone of an empty remote (unborn HEAD) is not mistaken for damage. There is no `git init` fallback: cloning an empty remote succeeds on its own, so every way clone fails — unreachable host, rejected key, non-empty target — fails the tick and is retried rather than manufacturing a history the remote has never seen.
1b. **Reconcile?** — `needsReconcile(baseline)` = `shouldReconcile({markerPresent, localTreeNonEmpty, remoteHasCommits})`. When true, run the phase below and finish the tick; it pushes and copies back itself. Asked here, before step 2, because step 2 is the destructive step. The tick reads the marker once here and hands it to step 2 as well — two reads could disagree, and they'd disagree on whether deleting the remote's notes is allowed.
2. **Copy local → repo** — Mirror workspace notes dir to sync repo root via `copyDirContents` with `ignore: SYNC_IGNORE_NAMES` (`.git`, `.lock`). Only changed files are rewritten (`copyFileIfChanged` skips a copy when size + content match and preserves mtime), so an unchanged tree costs stats/reads, not writes. **The mirror-delete is gated on the baseline**: `copyLocalToRepo(hasBaseline)` passes `mirrorDeletes` through to `copyDirContents`, so a path missing locally is pushed as a deletion only once a marker exists. Without one, "absent locally" isn't yet known to mean "deleted" — see the invariant below.
3. **Stage local changes** — `git add -A -- . :(exclude)<ignored>`, then `git diff --cached --quiet` to detect whether anything is actually staged. The exclusions match `stageMergedTree`: the ignored names are the engine's own, not notes, and a remote written before the lock moved out of the working tree still carries a `.lock` that must not be staged again. After the changed-only copy this is a cheap stat pass with nothing to re-hash on an idle tree.
4. **Idle short-circuit** — If nothing is staged **and** the remote has no new commits (`ls-remote origin HEAD` vs local `HEAD`), skip the commit, pull and push, and finish the tick after the copy-back. The copy-back is not skipped: the mirror can hold notes this device has never had on disk (one cloned by an earlier tick, or a notes dir restored empty), and no other step puts them there. It is a stat pass over an unchanged tree and writes nothing when the device already agrees.
5. **Commit local changes** — Only when there are staged changes: `git commit` with hostname + timestamp message.
6. **Pull remote** — `git pull --no-rebase origin HEAD`. Detects conflicts via error output. A pull that fails with `isUnrelatedHistoriesError` falls back into reconcile and finishes the tick there — the self-healing path for a mirror with no shared history and no marker to detect it by (one left on its own history by an older version, or a remote re-pointed after reconcile already retired).
7. **Resolve conflicts** — If merge conflicts, iterate conflicted files:
   - **AI path**: Send file with conflict markers to `AIInvoker`, validate response (strip code fences, reject residual markers).
   - **Fallback**: `resolveConflictSimple()` keeps both sides, deduplicates identical content.
   - **Last resort**: `git checkout --theirs <file>`.
8. **Push to remote** — `git push -u origin HEAD`. Failure is non-fatal (retries next cycle) but is reported: `pushToRemote()` returns whether the push landed.
9. **Copy repo → local** — Mirror resolved content back to local notes directory (changed files only; excludes `.git` and `.lock`).
10. **Record the baseline** — Only when the push landed, and only if no marker exists: `recordSyncBaseline()` writes the same marker reconcile writes. A push that landed means the two sides now share history by the ordinary route (the remote was empty, so the first push *is* the shared history). Without it, the next tick would see a remote that suddenly has commits and no marker, re-enter reconcile, and union-merge the notes with the copies it just pushed.

## Initial Reconcile (SyncEngine.reconcile)

The one-time union merge for pointing an existing notebook at a remote that already
has content. Reached two ways, both of which finish the tick on it: the step-1b
detection branch, and the step-6 pull fallback.

The normal flow can't handle first contact: it treats local as authoritative, and
step 6's pull refuses to merge two histories with no common commit. Step 2's
mirror-delete would push away every remote note missing locally — the baseline gate
now suppresses that, but suppressing data loss is not the same as merging, and only
this phase brings the remote's notes down. Reconcile replaces steps 2–10 for exactly
one sync:

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
   Staging excludes `SYNC_IGNORE_NAMES`, so a `.lock` inherited from a remote an
   older version wrote stays out of the commit.
   The push is raw `git push` — deliberately *not* `pushToRemote()`, which swallows
   failures to retry later; here a failed push must abort before the marker.
6. **Copy back + retire** — `copyRepoToLocal()`, then `writeReconcileMarker()`,
   carrying the `ReconcileSummary` the report is served from.

Ordering is the correctness property: **marker only after a successful push**. If
anything fails, no marker is written and the next tick re-runs the merge, which is
safe because the union merge is idempotent (a re-run stages nothing and pushes
nothing). Both orderings are pinned by tests using a `pre-receive` hook that rejects
only branch updates.

The two entry points cover different states, and neither alone is enough:

| State | Caught by | Why the others can't |
|-------|-----------|----------------------|
| Local notes + remote with commits, no marker | 1b detection | A mirror cloned from the remote shares its history, so the pull succeeds and step 2's mirror-delete gets pushed. |
| Empty local + a mirror on an unrelated history | step-6 fallback | Detection needs local notes to contribute (`localTreeNonEmpty`). Step 1 no longer creates such a mirror, but one left by an older version still syncs through here. |
| Marker present, remote re-pointed to an unrelated repo | step-6 fallback | The marker retires detection. |
| Empty local + mirror cloned from the remote | **neither** — the step-2 baseline gate | Detection needs local notes; the shared history means the pull can't fail. Nothing merges here, and nothing needs to: suppressing the delete leaves the tick idle, the pull brings the notes down, and the landed push records the baseline. |

### The one-time report

The merge is automatic and unattended, so the only account the user gets of what
happened to their notes is what `SyncStatus` carries:

- `reconcileInProgress` — true only while the merge runs. It reads both trees and
  may call the AI once per colliding note, so it can far outlast a normal tick and
  is worth naming as its own state rather than showing the usual "syncing".
- `reconcileReport` — `ReconcileSummary` (`counts` straight off `MergePlan.counts`,
  `total`, the `combined` list, `flagged` binaries with the path each local copy
  was parked at, `backupTag`) plus the `mergedCommit`/`reconciledAt` it landed at.
  `summarizeMergePlan()` derives it; `reconcileReport(marker)` reassembles it.

Two rules about its lifetime, both load-bearing:

1. **It is persisted on the marker, not held in memory.** `start()` reads it back,
   so a server restart doesn't erase the summary. The marker is the natural home:
   the merge it describes is the one the marker already anchors by SHA.
2. **Nothing ever clears it.** Syncs run on a timer — clearing the report on the
   next tick would mean a user who stepped away for five minutes never learns
   which notes the AI combined. It describes a one-time event, so it stops
   changing rather than expiring.

An ordinary first push to an *empty* remote records a baseline marker with **no**
report: nothing was merged, so there is nothing to report. `reconcileReport` stays
null there.

### Where the user reads it

`SyncSettingsSection.tsx` renders the report under a "First Merge" row, off the
`SyncStatus` its 30s poll already fetches. `SyncStatus` is mirrored by hand in
`packages/coc-client/src/domains/sync.ts` (`ReconcileReport`, `FlaggedBinary`,
`MergeOutcome`) — that copy, not the engine's, is the type the SPA compiles
against, and `packages/coc` typechecks against coc-client's built `dist`, so a
field added there needs a `npm run build` in coc-client before it is visible.

- **While it runs**, the status pill says "Merging notes…" instead of "Syncing…"
  and the row explains that nothing is deleted on either side. The pill checks
  `reconcileInProgress` *before* `inProgress` — both are true during the merge,
  and the merge is the one long enough for a plain "Syncing…" to look hung.
- **Afterwards**, `reconcileSummaryText()` states the four counts in one sentence
  ("Merged 5 notes — 0 identical, 2 added from this device, 2 kept from remote,
  1 combined by AI (b.md). Review recommended."), naming every AI-combined note
  rather than only counting it, and keeping zero clauses so an omitted number
  never reads as a forgotten one. "Review recommended" appears only when
  something was combined or flagged. Flagged binaries list where the local copy
  was parked; the backup tag is named so the undo is discoverable without a git
  log.
- **Never both at once.** The in-progress row replaces the report rather than
  joining it: on the self-healing path a marker and its report already exist when
  the pull hits unrelated histories and re-merges, so rendering both would show
  last merge's summary as though it described the running one.

A report that can't be read back (corrupt/wrong-shaped) drops on its own and
leaves the marker valid — losing it costs a summary, whereas dropping the marker
would re-run the merge and unsuppress mirror-deletes.

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
- **Idle syncs are near-free**: An idle tick (no local edits, no remote commits) rewrites no files, re-hashes nothing, and issues no commit/pull/push. It still runs the copy-back, which writes nothing once the device already holds the mirror's notes.
- **First contact merges, never mirrors**: The first sync against a remote that already has commits union-merges the two sides (nothing deleted on either side) and leaves a `sync-backup/<stamp>` tag on the remote's pre-merge tip. Reconcile runs at most once per workspace; the marker that retires it is written only after the merge (or a normal first push) actually lands on the remote.
- **An automatic merge always explains itself**: Every reconcile is auditable from two places that outlive the process — the squashed commit's body, and the `reconcileReport` persisted on the marker. Neither is ever cleared, and no raw conflict marker reaches the user in either.
- **A deletion needs a baseline behind it**: The outbound copy propagates a deletion only when the workspace has a reconcile marker. The marker is the point at which both sides were proven to hold the same notes, so a note missing after it is the user's doing; before it, "absent locally" may just mean this device was never told. This is what stops an empty or half-restored notes dir from mirror-deleting a remote it has never merged with — the one state neither route into reconcile catches, since a mirror cloned from the remote pulls cleanly and an empty tree can't trip detection. Past the baseline, a real delete propagates normally: the guard is about first contact, not about making sync append-only.
- **Changed-only copies**: Both copy directions rewrite only files whose content differs, keeping mtimes stable so `git add -A` doesn't re-hash the whole tree.
- **`.git`/`.lock` are protected**: `SYNC_IGNORE_NAMES` is applied to both the copy and mirror-delete passes in both directions, so the sync repo's own `.git` is never copied over or deleted (no re-init/re-clone loop). `.lock` stays in the set for remotes written before the lock moved beside the mirror: those carry a committed `.lock`, which must not be copied onto a device or staged again.
- **Failure backoff**: Repeated failing syncs grow the next delay geometrically (cap 30 min); a success resets it to the base interval.
- **Non-blocking startup**: Initial sync is fire-and-forget — server startup never waits for sync to complete.
- **Error isolation**: Sync failures are logged and surfaced in status but never crash the server.
- **Locking**: Only one sync operation runs at a time per workspace, enforced by `.lock` with stale-PID detection.
- **Live reconfiguration**: Saving sync preferences through repo preferences calls `engine.start()` after the preferences file is written, activating or disabling the engine without a restart. Passing an empty `gitRemote` to `start()` disables the engine and stops its timer.

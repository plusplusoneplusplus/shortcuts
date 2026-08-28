# Notes Sync Engine

Git-backed sync for My Work / My Life notes. One `SyncEngine` per virtual
workspace (`my_work`, `my_life`) mirrors a user-configured Git remote against
the local notes dir:

```
~/.coc/repos/<workspaceId>/notes/  ↔  ~/.coc/sync/<sync-subfolder>/
```

This is a data-integrity feature: a small ordering change can delete remote
notes, retire the reconcile phase too early, lose a conflict audit, or write a
baseline for a push that never landed. Preserve step ordering when editing.

## Module layout

- `sync-engine.ts` — thin facade. Owns `SyncStatus`, wires the kernels, keeps the
  public API (`start` / `stop` / `triggerSync` / `getStatus`), and guards each
  tick with the in-progress flag + cross-process lock. Re-exports the kernel
  primitives so its historical import surface stays stable.
- `sync-types.ts` — shared `SyncStatus` / `SyncLogger` / `ReconcileResult` /
  `SyncEngineOptions` contracts + `DEFAULT_LOGGER` (dependency-free).
- `sync-git.ts` — `SyncGitRepository`: every Git command and every rule for
  interpreting Git output (usable-repo check, remote setup, remote-change probe,
  pull-conflict detection, tree reads, default-branch discovery, staging). The
  highest-risk external dependency, isolated for failure-mode testing. The
  commands run in the native addon through `execGitAsync`; the module starts no
  child process of its own. Two consequences to keep in mind when editing it:
  a conflicted pull is recognised by the unmerged entries git left in the index
  and *not* by the "CONFLICT"/"Automatic merge failed" text, which git prints on
  stdout and no runner keeps once a command has failed; and `readTree` reads
  each blob out of the object database (`gitFileBytesAtCommit`), because stdout
  loses a trailing line ending and an attached image is not text at all. Every
  `catch` here rethrows a `NativeAddonLoadError` rather than reading it as a
  sync outcome — `isUsable()` answering `false` deletes the mirror and re-clones
  it.
- `sync-mirror.ts` — `SyncMirrorCopier` + `copyDirContents`/`copyFileIfChanged`:
  change-only copy, baseline-gated mirror deletes, and `SYNC_IGNORE_NAMES`
  (`.git`, `.lock` — never copied or mirror-deleted). Both directions mirror:
  `copyLocalToRepo(hasBaseline)` outbound and `copyRepoToLocal(hasBaseline,
  tickStartMs)` inbound — a note deleted on the remote must reach local, not
  survive and get re-pushed. Inbound passes `preserveNewerThanMs: tickStartMs`
  so the delete pass spares a note written mid-tick (absent from the early clone
  snapshot but not a deletion); it syncs next tick.
- `sync-conflict.ts` — `SyncConflictResolver` + `resolveConflictSimple` /
  `resolveConflictWithAI`: steady-state conflict resolution (AI → simple →
  keep-remote fallback), the fallback audit trail, and the resolution marker.
- `sync-transaction.ts` — `SyncTransactionRunner`: the ordered steady-state tick
  and the one-time `reconcile` union-merge. Drives the kernels and mutates the
  shared status. `backupTagStamp` lives here.
- `sync-scheduler.ts` — `SyncScheduler` (self-rescheduling timer + failure
  backoff + generation guard) and the pure `nextSyncDelayMs`.
- `sync-lock.ts` — `acquireLock` / `releaseLock` PID-file lock (reclaims stale
  locks from dead PIDs).
- `sync-reconcile.ts` — union-merge planning, tree scans, markers, report
  shaping. `sync-constants.ts` — interval/backoff constants (side-effect-free).
- `sync-handler.ts` — `registerSyncRoutes` (manual-trigger + status REST).

## Ordering invariants (do not reorder)

- Baseline/reconcile check runs **before** the destructive `copyLocalToRepo`.
- Both mirror directions are baseline-gated: `copyLocalToRepo` and
  `copyRepoToLocal` only mirror-delete once a reconcile baseline exists. Reconcile
  (union merge) calls `copyRepoToLocal(false, …)` — it never deletes either side.
- Reconcile pushes the merged tree (and the backup tag first) **before** writing
  the reconcile marker; a failed push must leave no marker.
- Steady-state records a baseline only **after** a push actually lands.
- Push failures are surfaced as `pushPending`, never folded into `lastError`.

## Tests

- `test/server/sync-engine.test.ts` — engine + real-git integration (reconcile,
  push failure, unrelated-history heal, idle no-op). Reaches kernels via
  `(engine as any).transaction` / `.resolver`.
- `test/server/sync-kernels.test.ts` — mirror / conflict-resolver / lock units.
- `test/server/sync-reconcile.test.ts`, `sync-handler.test.ts`.
- `test/server/sync-git-native.test.ts` — `SyncGitRepository` against real
  repositories: byte-exact blob reads, conflicted-pull detection, clone into a
  directory that is not a repository yet.
- `test/server/sync-git-native-required.test.ts` — a broken addon stays loud
  instead of reading as an idle tick or an unusable mirror.

Run: `npx vitest run test/server/sync-engine.test.ts test/server/sync-kernels.test.ts test/server/sync-reconcile.test.ts test/server/sync-handler.test.ts test/server/sync-git-native.test.ts test/server/sync-git-native-required.test.ts`

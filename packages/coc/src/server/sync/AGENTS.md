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
  pull-conflict parsing, tree reads, default-branch discovery, staging). The
  highest-risk external dependency, isolated for failure-mode testing.
- `sync-mirror.ts` — `SyncMirrorCopier` + `copyDirContents`/`copyFileIfChanged`:
  change-only copy, baseline-gated mirror deletes, and `SYNC_IGNORE_NAMES`
  (`.git`, `.lock` — never copied or mirror-deleted).
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

Run: `npx vitest run test/server/sync-engine.test.ts test/server/sync-kernels.test.ts test/server/sync-reconcile.test.ts test/server/sync-handler.test.ts`

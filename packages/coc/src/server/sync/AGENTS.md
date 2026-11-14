# Notes Sync Engine

Git-backed sync for My Work and My Life. One `SyncEngine` per virtual workspace (`my_work`, `my_life`):

```
~/.coc/repos/<workspaceId>/notes/  ↔  ~/.coc/sync/<sync-subfolder>/
```

Ordering mistakes delete remote notes or record a baseline for a push that never landed. Preserve step order.

## Modules

- `sync-engine.ts` — facade: `start` / `stop` / `triggerSync` / `getStatus`, in-progress flag, cross-process lock. Re-exports kernel primitives.
- `sync-git.ts` — every Git command, via `execGitAsync`. No child process of its own. A conflicted pull is the unmerged index, not stdout text. `readTree` uses `gitFileBytesAtCommit` so bytes and trailing newlines survive. Rethrow `NativeAddonLoadError`. `isUsable() === false` deletes the mirror and re-clones.
- `sync-mirror.ts` — change-only copy. `SYNC_IGNORE_NAMES` is `.git` and `.lock`. Inbound `preserveNewerThanMs: tickStartMs` spares a note written mid-tick.
- `sync-conflict.ts` — AI, then simple, then keep-remote, plus the audit marker.
- `sync-transaction.ts` — steady-state tick and one-time reconcile. `backupTagStamp` lives here.
- `sync-scheduler.ts`, `sync-lock.ts` (PID file, reclaim dead PIDs), `sync-reconcile.ts`, `sync-constants.ts`, `sync-handler.ts`.

## Order

- Baseline check runs before destructive `copyLocalToRepo`.
- Mirror-delete only after a reconcile baseline exists. Reconcile calls `copyRepoToLocal(false, …)` and deletes neither side.
- Reconcile pushes the merged tree, backup tag first, before writing the marker. A failed push leaves no marker.
- Steady-state writes a baseline only after the push lands.
- Push failure is `pushPending`, never `lastError`.

## Tests

From `packages/coc`:

`npx vitest run test/server/sync-engine.test.ts test/server/sync-kernels.test.ts test/server/sync-reconcile.test.ts test/server/sync-handler.test.ts test/server/sync-git-native.test.ts test/server/sync-git-native-required.test.ts`

# Notes Sync Subsystem

Git-backed synchronization of My Work and My Life notes across multiple machines. Uses a user-provided Git remote as the cloud hub with automatic periodic sync and AI-powered merge conflict resolution.

**Feature flag:** Sync is disabled by default. Enabled only when `sync.gitRemote` is configured via the admin settings panel.

## Concepts

| Concept | Description |
|---------|-------------|
| **SyncEngine** | Core class that manages the sync lifecycle: clone/pull/push, conflict resolution, periodic scheduling, and status tracking. |
| **Sync repo** | A Git repository cloned to `~/.coc/sync/` that mirrors notes from My Work and My Life. Not per-repo data — shared across all workspaces. |
| **Folder mapping** | `~/.coc/repos/my_work/notes/` ↔ `sync-repo/my-work/` and `~/.coc/repos/my_life/notes/` ↔ `sync-repo/my-life/`. |
| **Lock file** | `~/.coc/sync/.lock` prevents concurrent sync operations. Includes stale-lock detection via PID check. |

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Dashboard UI                                                        │
│  AdminPanel (Integrations tab) — gitRemote + intervalMinutes fields  │
│  SyncStatusIndicator (TopBar pill) — status dot + manual trigger     │
│  useSyncStatus hook — polls GET /sync/status every 30s               │
└──────────────┬───────────────────────────────────────────────────────┘
               │ REST
┌──────────────▼───────────────────────────────────────────────────────┐
│  sync-handler.ts                                                      │
│  GET  /api/sync/status  — current SyncStatus                         │
│  POST /api/sync/trigger — force immediate sync                       │
└──────────────┬───────────────────────────────────────────────────────┘
               │ delegates
┌──────────────▼───────────────────────────────────────────────────────┐
│  SyncEngine (sync-engine.ts)                                         │
│  start() → initial sync (fire-and-forget) + periodic timer           │
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
| `src/server/sync/sync-engine.ts` | `SyncEngine` class, `isSyncEnabled()`, `resolveConflictSimple()`, `resolveConflictWithAI()` |
| `src/server/sync/sync-handler.ts` | REST route registration (`registerSyncRoutes`) |
| `src/server/sync/index.ts` | Barrel exports |
| `src/server/spa/client/react/layout/SyncStatusIndicator.tsx` | TopBar status pill (syncing/error/synced/never-synced states) |
| `src/server/spa/client/react/hooks/useSyncStatus.ts` | React hook polling sync status every 30s |

## Admin Config Fields

Two fields registered in `admin-config-fields.ts`:

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `sync.gitRemote` | string | `''` | Git remote URL (e.g. `git@github.com:user/my-coc-notes.git`). Empty = sync disabled. |
| `sync.intervalMinutes` | number | `5` | Periodic sync interval in minutes. Must be a positive integer. |

Both keys are also registered in `namespace-registry.ts` as `SYNC_SOURCE_KEYS`.

## Sync Flow (performSync)

1. **Ensure sync repo** — Clone from remote, or verify existing clone's remote URL matches.
2. **Copy local → repo** — Mirror `my_work/notes/` → `my-work/` and `my_life/notes/` → `my-life/` in sync repo.
3. **Commit local changes** — `git add -A && git commit` with hostname + timestamp message.
4. **Pull remote** — `git pull --no-rebase origin HEAD`. Detects conflicts via error output.
5. **Resolve conflicts** — If merge conflicts, iterate conflicted files:
   - **AI path**: Send file with conflict markers to `AIInvoker`, validate response (strip code fences, reject residual markers).
   - **Fallback**: `resolveConflictSimple()` keeps both sides, deduplicates identical content.
   - **Last resort**: `git checkout --theirs <file>`.
6. **Push to remote** — `git push -u origin HEAD`. Failure is non-fatal (retries next cycle).
7. **Copy repo → local** — Mirror resolved content back to local note directories.

## REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/sync/status` | Returns `SyncStatus` JSON (enabled, inProgress, lastSyncTime, lastError) |
| `POST` | `/api/sync/trigger` | Force immediate sync. Returns updated `SyncStatus` on success, 400 if not configured, 500 on error |

## Dashboard UI

- **Admin Panel** (Integrations sub-tab): Input fields for `sync.gitRemote` and `sync.intervalMinutes`, plus sync status display and manual trigger button.
- **TopBar indicator** (`SyncStatusIndicator`): Color-coded dot (green=synced, yellow=syncing, red=error, gray=never-synced). Hidden when sync is disabled. Clicking triggers a manual sync.

## Invariants

- **Not per-repo data**: Sync repo lives at `~/.coc/sync/`, a shared top-level directory. This does not violate the repo-scoped data invariant since My Work/My Life notes are global, not workspace-scoped.
- **No credential management**: Assumes SSH keys or Git credential helpers are pre-configured.
- **Scope limited to notes**: Only markdown files in My Work and My Life note directories are synced.
- **Non-blocking startup**: Initial sync is fire-and-forget — server startup never waits for sync to complete.
- **Error isolation**: Sync failures are logged and surfaced in status but never crash the server.
- **Locking**: Only one sync operation runs at a time, enforced by `~/.coc/sync/.lock` with stale-PID detection.

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
| `src/server/sync/sync-engine.ts` | `SyncEngine` class, `resolveConflictSimple()`, `resolveConflictWithAI()` |
| `src/server/sync/sync-handler.ts` | REST route registration (`registerSyncRoutes`) — workspace-scoped |
| `src/server/sync/index.ts` | Barrel exports |
| `src/server/spa/client/react/features/repo-settings/SyncSettingsSection.tsx` | Per-report sync config UI (git remote, interval, status, trigger) |

## Per-Workspace Configuration

Sync settings live in `PerRepoPreferences.sync` (in `preferences-handler.ts`):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `sync.gitRemote` | string | (absent) | Git remote URL. Sync disabled when empty/absent. |
| `sync.intervalMinutes` | number | `5` | Periodic sync interval in minutes. |

Server bootstrap creates two `SyncEngine` instances (`syncEngines: Map<string, SyncEngine>`) for `my_work` and `my_life`, reading preferences from `~/.coc/repos/<workspaceId>/preferences.json`. The `syncEngines` map is also passed to `registerPreferencesRoutes`; successful repo preference writes invoke the preferences live-effects coordinator, which starts or disables the matching live engine and logs reconfiguration errors without rolling back the saved preferences.

## Sync Flow (performSync)

1. **Ensure sync repo** — Clone from remote, or verify existing clone's remote URL matches.
2. **Copy local → repo** — Mirror workspace notes dir to sync repo root.
3. **Commit local changes** — `git add -A && git commit` with hostname + timestamp message.
4. **Pull remote** — `git pull --no-rebase origin HEAD`. Detects conflicts via error output.
5. **Resolve conflicts** — If merge conflicts, iterate conflicted files:
   - **AI path**: Send file with conflict markers to `AIInvoker`, validate response (strip code fences, reject residual markers).
   - **Fallback**: `resolveConflictSimple()` keeps both sides, deduplicates identical content.
   - **Last resort**: `git checkout --theirs <file>`.
6. **Push to remote** — `git push -u origin HEAD`. Failure is non-fatal (retries next cycle).
7. **Copy repo → local** — Mirror resolved content back to local notes directory (excludes `.git` and `.lock`).

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
- **Non-blocking startup**: Initial sync is fire-and-forget — server startup never waits for sync to complete.
- **Error isolation**: Sync failures are logged and surfaced in status but never crash the server.
- **Locking**: Only one sync operation runs at a time per workspace, enforced by `.lock` with stale-PID detection.
- **Live reconfiguration**: Saving sync preferences through repo preferences calls `engine.start()` after the preferences file is written, activating or disabling the engine without a restart. Passing an empty `gitRemote` to `start()` disables the engine and stops its timer.

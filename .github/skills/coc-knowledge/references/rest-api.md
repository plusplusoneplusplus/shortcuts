# REST API

CoC server exposes HTTP endpoints organized by domain. All routes are registered via `registerAllRoutes()` in `src/server/routes/index.ts`.

## Global Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/config` | Server configuration |
| GET | `/api/preferences` | Global UI preferences |
| PUT | `/api/preferences` | Update global preferences |
| GET | `/api/logs` | Server log ring buffer |
| GET | `/api/stats` | Token usage + cost stats |
| GET | `/api/agent-providers` | Copilot/Codex/Claude enabled + SDK availability status. Codex auth is handled by the Codex SDK/CLI, not CoC routes |
| GET | `/api/agent-providers/quota` | Provider quota snapshots where supported |

## Agent Providers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-providers/:provider/models` | Provider model catalog |
| GET | `/api/agent-providers/:provider/models/enabled` | Enabled models for provider |
| PUT | `/api/agent-providers/:provider/models/enabled` | Set enabled models for provider |
| GET | `/api/agent-providers/:provider/models/reasoning-efforts` | Reasoning effort overrides |
| PUT | `/api/agent-providers/:provider/models/reasoning-efforts` | Set reasoning effort for model |
| POST | `/api/agent-providers/:provider/models/query` | Test prompt against provider model |

## Workspace Management

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces` | List registered workspaces |
| POST | `/api/workspaces` | Register a workspace |
| DELETE | `/api/workspaces/:id` | Unregister workspace |
| GET | `/api/workspaces/:id/preferences` | Per-repo preferences |
| PATCH | `/api/workspaces/:id/preferences` | Update per-repo preferences |
| GET | `/api/workspaces/:id/summary` | Aggregated workspace summary |
| GET | `/api/workspaces/:id/endev/status` | Cached EnDev xDPU eligibility status; `?refresh=true` revalidates |
| POST | `/api/workspaces/:id/endev/revalidate` | Force EnDev xDPU eligibility revalidation |

## Processes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/processes` | List processes (with search/filter) |
| GET | `/api/processes/:id` | Process detail |
| DELETE | `/api/processes/:id` | Delete process |
| POST | `/api/processes/:id/message` | Follow-up message. Body accepts `content`, optional `mode`, `deliveryMode`, `images`, `skillNames`, `model`, and `reasoningEffort` (`'low'\|'medium'\|'high'\|'xhigh'`) for a per-turn override. |
| POST | `/api/processes/:id/cancel` | Cancel running process |
| POST | `/api/processes/:id/promote-to-ralph` | Promote completed ask-mode chat to Ralph session (see [ralph.md](ralph.md)) |
| PATCH | `/api/processes/:id/pin` | Pin/unpin process |
| PATCH | `/api/processes/:id/archive` | Archive/unarchive |
| GET | `/api/processes/:id/turns/pinned` | Get pinned turns |
| DELETE | `/api/processes/:id/turns/:idx` | Soft-delete turn |
| PATCH | `/api/processes/:id/turns/:idx/restore` | Restore deleted turn |
| PATCH | `/api/processes/:id/turns/:idx/pin` | Pin a turn |
| PATCH | `/api/processes/:id/turns/:idx/archive` | Archive a turn |

## Queue

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/queue` | List queue tasks |
| POST | `/api/queue` | Enqueue a task |
| DELETE | `/api/queue/:id` | Remove from queue |
| POST | `/api/queue/:id/cancel` | Cancel queued task |
| PATCH | `/api/queue/pause` | Pause/resume queue |

## Schedules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/schedules` | List schedules |
| POST | `/api/schedules` | Create schedule |
| PUT | `/api/schedules/:id` | Update schedule |
| DELETE | `/api/schedules/:id` | Delete schedule |
| POST | `/api/schedules/:id/run` | Trigger immediate run |
| GET | `/api/schedules/:id/runs` | Run history |

## Tasks

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/tasks` | List tasks |
| POST | `/api/workspaces/:id/tasks` | Create task file |
| GET | `/api/workspaces/:id/tasks/:path` | Read task content |
| PUT | `/api/workspaces/:id/tasks/:path` | Update task |
| DELETE | `/api/workspaces/:id/tasks/:path` | Delete task |
| GET | `/api/workspaces/:id/tasks/:path/comments` | Task comments |
| POST | `/api/workspaces/:id/tasks/:path/comments` | Add comment |

## Notes

All read/write/comment/search/image endpoints accept an optional `root` query or body param to scope operations to a specific notes root. Omit `root` for the default managed root.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/notes` | Note tree (`?root=` optional) |
| POST | `/api/workspaces/:id/notes` | Create note (body `root` optional) |
| GET | `/api/workspaces/:id/notes/:path` | Read note (`?root=` optional) |
| PUT | `/api/workspaces/:id/notes/:path` | Update note (body `root` optional) |
| DELETE | `/api/workspaces/:id/notes/:path` | Delete note (`?root=` optional) |
| GET | `/api/workspaces/:id/notes-git/status` | Git status (default root only) |
| POST | `/api/workspaces/:id/notes-git/commit` | Git commit (default root only) |
| GET | `/api/workspaces/:id/notes/roots` | List configured roots |
| POST | `/api/workspaces/:id/notes/roots` | Add a repo-folder root |
| DELETE | `/api/workspaces/:id/notes/roots` | Remove a repo-folder root |

### Multi-Root Notes

Users can add up to **10** additional notes roots per workspace — subfolders inside the workspace git repo. The default managed root (`~/.coc/repos/<workspaceId>/notes/`) is always present.

- **Root resolution:** default root via `getRepoDataPath(dataDir, workspaceId, 'notes')`; repo-folder roots via `<workspace-git-root>/<relative-path>`.
- **Git ops** apply only to the default root; repo-folder roots inherit the workspace repo's git.
- **Comment sidecar** for repo-folder roots is stored at `~/.coc/repos/<workspaceId>/notes-comments/<encoded-root-path>/`.
- **Images** for repo-folder roots are co-located in `<root>/.images/`; default root uses `.attachments/`.
- **System folders** (e.g., Plans) are auto-created only in the default root.
- Configured roots are persisted in `PerRepoPreferences.additionalNotesRoots`.

## Workflows

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/workflows` | List workflows |
| POST | `/api/workspaces/:id/workflows` | Create workflow |
| GET | `/api/workspaces/:id/workflows/:name` | Read workflow |
| PUT | `/api/workspaces/:id/workflows/:name` | Update workflow |
| DELETE | `/api/workspaces/:id/workflows/:name` | Delete workflow |

## Skills

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/skills` | List skills |
| POST | `/api/workspaces/:id/skills/install` | Install skill |
| GET | `/api/workspaces/:id/skills/:name/file?path=<rel>` | Read a file inside a skill folder |
| DELETE | `/api/workspaces/:id/skills/:name` | Delete skill |
| GET | `/api/skills` | Global skills |
| POST | `/api/skills/install` | Install global skill |

## Memory

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/memory/config` | Memory configuration |
| PUT | `/api/memory/config` | Update config |
| GET | `/api/memory/bounded/:level` | Read bounded memory |
| PUT | `/api/memory/bounded/:level` | Write bounded memory |
| DELETE | `/api/repos/:repoId/memory` | Wipe repo memory |
| GET | `/api/repos/:repoId/memory/entries` | List memory entries |
| GET | `/api/workspaces/:id/memory/v2/facts` | List/search Memory V2 facts (`q`, repeated `status`, `limit`) |
| POST | `/api/workspaces/:id/memory/v2/facts` | Create an explicit Memory V2 fact |
| PATCH | `/api/workspaces/:id/memory/v2/facts/:factId` | Update fact content, importance, tags, or status |
| DELETE | `/api/workspaces/:id/memory/v2/facts/:factId` | Delete a Memory V2 fact |
| GET | `/api/workspaces/:id/memory/v2/review` | List facts pending review |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/approve` | Approve a review fact; body may include edited `content` |
| POST | `/api/workspaces/:id/memory/v2/review/:factId/reject` | Reject a review fact |
| GET | `/api/workspaces/:id/memory/v2/episodes` | List Memory V2 episodes (`limit`) |
| GET | `/api/workspaces/:id/memory/v2/export` | Export active-scope Memory V2 facts and episodes |
| DELETE | `/api/workspaces/:id/memory/v2/wipe` | Wipe active-scope Memory V2 facts and episodes; body requires `{ "confirm": true }` |

## Pull Requests

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/repos/:repoId/pull-requests` | List pull requests |
| GET | `/api/repos/:repoId/pull-requests/review-history` | Read cached PR review history |
| POST | `/api/repos/:repoId/pull-requests/review-history/refresh` | Fetch and cache PR review history |
| GET | `/api/repos/:repoId/pull-requests/suggestions` | Read cached AI-ranked PR suggestions |
| POST | `/api/repos/:repoId/pull-requests/suggestions/refresh` | Rank open PRs using cached review history |

## Loops

See [loops.md](loops.md) for the full subsystem. Gated by `loops.enabled` (default `false`).

### Workspace-scoped

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/loops` | List loops for workspace |
| GET | `/api/workspaces/:id/loops/:loopId` | Get single loop |
| PATCH | `/api/workspaces/:id/loops/:loopId` | Update loop fields (description, prompt, intervalMs, model) |
| DELETE | `/api/workspaces/:id/loops/:loopId` | Cancel & soft-delete loop |
| POST | `/api/workspaces/:id/loops/:loopId/pause` | Pause loop (body: `{ reason? }`) |
| POST | `/api/workspaces/:id/loops/:loopId/resume` | Resume paused loop |

### Server-wide

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/loops` | List all loops server-wide |
| GET | `/api/loops/:loopId` | Get a loop by ID |

## MCP Settings

See [mcp-settings.md](mcp-settings.md).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/mcp-config` | Effective + source-separated MCP servers. `?forceReload=true` bypasses cache |
| PUT | `/api/workspaces/:id/mcp-config` | Store name-based `enabledMcpServers` allow-list |

## Work Items

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/work-items` | List work items |
| POST | `/api/workspaces/:id/work-items` | Create work item |
| GET | `/api/workspaces/:id/work-items/:itemId` | Read work item |
| PATCH | `/api/workspaces/:id/work-items/:itemId` | Update work item |
| DELETE | `/api/workspaces/:id/work-items/:itemId` | Delete work item |

## Seen State

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/seen-state` | Get seen state |
| PATCH | `/api/workspaces/:id/seen-state` | Update seen state |
| DELETE | `/api/workspaces/:id/seen-state/:processId` | Clear process seen state |
| GET | `/api/workspaces/:id/seen-state/count` | Unseen count |

## LLM Tools

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/workspaces/:id/llm-tools-config` | Get tool config |
| PUT | `/api/workspaces/:id/llm-tools-config` | Update tool config |

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
| GET | `/api/servers` | List remote servers |
| POST | `/api/servers` | Register server |
| DELETE | `/api/servers/:id` | Remove server |
| POST | `/api/servers/:id/test` | Test connection |
| POST | `/api/servers/:id/connect` | Connect (DevTunnel) |
| POST | `/api/servers/:id/disconnect` | Disconnect |

## Sync

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sync/status` | Sync status (enabled, inProgress, lastSyncTime, lastError) |
| POST | `/api/sync/trigger` | Force immediate notes sync |

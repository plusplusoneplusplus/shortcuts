# MCP Settings (Workspace-Scoped)

Workspace MCP servers in CoC are a merge of two sources: global servers from `~/.copilot/mcp-config.json` and workspace servers from `<repo>/.vscode/mcp.json`. Workspace entries override global entries with the same name. CoC's REST API surfaces both the effective merge and the source-separated views, persists a name-based allow-list per workspace, and provides full CRUD on MCP server entries.

## Config Files

- **Global**: `~/.copilot/mcp-config.json` — root key `mcpServers`
- **Workspace**: `<repo>/.vscode/mcp.json` — root key `servers`

Extra fields (`description`, `toolScope`) are stored directly on server entries in config files. VS Code ignores unknown keys; CoC reads and surfaces them.

## REST API

### `GET /api/workspaces/:id/mcp-config`

Returns both the effective `availableServers` list and source-separated `sources.global` / `sources.workspace` sections.

- Global servers come from `~/.copilot/mcp-config.json`.
- Workspace servers come from `<repo>/.vscode/mcp.json` via Forge MCP loader helpers.
- Workspace entries override global entries with the same name.
- Each entry in `availableServers` includes:
  - `status`: `"ok"` | `"auth"` | `"off"` | `"err"` (derived server-side from type + enabled state)
  - `description`: from config file, or empty string
- The endpoint only exposes safe row metadata (`name`, `type`, optional `url`/`command`, source/effective flags) and must **not** return secrets such as `env`, headers, or full argument arrays.
- `?forceReload=true` bypasses the path-keyed MCP config cache for manual dashboard refreshes; no file watcher is used.

### `GET /api/workspaces/:id/mcp-config/:server/detail`

Returns full server detail for the named server. Only accessible through this endpoint (not the list).

- `description`: from config file (or empty string)
- `envKeys`: list of env var key names — values masked
- `args`: full command arguments array
- `toolScope`: `"all"` | `"readonly"` | `"allowlist"`
- `source`: `"global"` | `"workspace"`
- `rawJson`: the actual JSON block for this server from its config file

### `PUT /api/workspaces/:id/mcp-config`

Stores the name-based `enabledMcpServers` allow-list and optionally `enabledMcpTools`.

- `enabledMcpServers`: array of server name strings or `null` (enable all)
- `enabledMcpTools`: `Record<string, string[]>` (server name → enabled tool names) stored in per-repo preferences JSON. When set for a server, only those tools are used at runtime.

### `PUT /api/workspaces/:id/mcp-config/:server`

Updates a server's config in its source file. Writes to the correct file (global or workspace) based on where the server is currently defined.

Can update: `description`, `args`, `env` (key-value pairs merged into existing), `toolScope`.

### `DELETE /api/workspaces/:id/mcp-config/:server`

Removes the server from its source config file only.

### `POST /api/workspaces/:id/mcp-config`

Adds a new server entry. Body: `{ name, type, command?, url?, args?, env?, description?, toolScope?, scope: "global"|"workspace" }`. No PATH validation — saves immediately.

### `POST /api/workspaces/:id/mcp-config/test`

Tests connectivity to an MCP server (does not need to be registered in config).

Body: `{ type, command?, url?, args?, env? }`

- **stdio**: spawns the process, sends JSON-RPC `initialize`, awaits response. 10-second timeout; process is always killed after.
- **http/sse**: sends an HTTP GET to the URL; any 2xx–4xx response counts as reachable.

Response: `{ success, message, protocolVersion?, serverName? }` with HTTP 200 on success, 422 on failure.

### `POST /api/workspaces/:id/mcp-config/:server/migrate`

Moves a server between global and workspace config. Body: `{ targetScope: "global"|"workspace" }`.

## OAuth Routes

`POST /api/mcp-oauth/start` is registered only when the active AI SDK service exposes SDK client creation (`createClient`). It starts an OAuth flow for configured HTTP/SSE MCP servers by resolving workspace config first, then global config. Pending OAuth lifecycle endpoints (`/api/mcp-oauth/pending...`) are always registered when the MCP OAuth manager is present.

## Invariants

- Never expose secrets (`env`, headers, full `args`) through the list endpoint. Only the detail endpoint exposes env keys (masked) and full args.
- Allow-list is name-only — the effective server set is always re-resolved at run time.
- File watching is intentionally avoided; clients drive cache invalidation via `?forceReload=true`.
- Multi-repo: all endpoints are workspace-scoped (`:id` param).
- `enabledMcpTools` is stored in per-repo preferences JSON at `~/.coc/repos/<workspaceId>/preferences.json`.

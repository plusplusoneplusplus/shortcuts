# MCP Settings (Workspace-Scoped)

Workspace MCP servers in CoC are a merge of two sources: global servers from `~/.copilot/mcp-config.json` and workspace servers from `<repo>/.vscode/mcp.json`. Workspace entries override global entries with the same name. CoC's REST API surfaces both the effective merge and the source-separated views, and persists a name-based allow-list per workspace.

## REST API

### `GET /api/workspaces/:id/mcp-config`

Returns both the effective `availableServers` list and source-separated `sources.global` / `sources.workspace` sections.

- Global servers come from `~/.copilot/mcp-config.json`.
- Workspace servers come from `<repo>/.vscode/mcp.json` via Forge MCP loader helpers.
- Workspace entries override global entries with the same name.
- The endpoint only exposes safe row metadata (`name`, `type`, optional `url`/`command`, source/effective flags) and must **not** return secrets such as `env`, headers, or full argument arrays.
- `?forceReload=true` bypasses the path-keyed MCP config cache for manual dashboard refreshes; no file watcher is used.

### `PUT /api/workspaces/:id/mcp-config`

Stores only the name-based `enabledMcpServers` allow-list. Workflow run filtering must resolve that list against the same effective global-plus-workspace MCP merge used at runtime.

## Invariants

- Never expose secrets (`env`, headers, full `args`) through the REST surface.
- Allow-list is name-only — the effective server set is always re-resolved at run time.
- File watching is intentionally avoided; clients drive cache invalidation via `?forceReload=true`.

# MCP Config Not Displayed in CoC Copilot Tab

## Description

The global MCP server configuration defined in `~/.copilot/mcp-config.json` is not being read or displayed in the CoC dashboard's **Copilot** tab. The tab shows "No MCP servers configured." even though a valid config exists with at least one SSE-based MCP server entry.

**Example config (`~/.copilot/mcp-config.json`):**
```json
{
  "mcpServers": {
    "mcp-server": {
      "type": "sse",
      "url": "http://0.0.0.0:8000/sse",
      "headers": {},
      "tools": ["*"]
    }
  }
}
```

**Observed behavior:** Copilot tab → MCP Servers section shows "No MCP servers configured."  
**Expected behavior:** The configured MCP servers from `~/.copilot/mcp-config.json` are listed in the Copilot tab.

## Acceptance Criteria

- [ ] The CoC dashboard Copilot tab reads `~/.copilot/mcp-config.json` on load and displays all configured MCP servers.
- [ ] Each MCP server entry shows its name, type (e.g., `sse`), and URL.
- [ ] If the file does not exist or has no servers, "No MCP servers configured." is still shown (current fallback is preserved).
- [ ] Changes to `~/.copilot/mcp-config.json` are reflected after a page refresh (or live if a file watcher is in place).
- [ ] The display works for all supported MCP server types (at minimum `sse`).

## Subtasks

### 1. Investigate how MCP config is loaded in coc-server
- Locate where `~/.copilot/mcp-config.json` is read in `packages/pipeline-core` or `packages/coc-server`.
- Determine whether the Copilot tab data is sourced from the same loading path or a separate API endpoint.

### 2. Expose MCP config via API endpoint (if missing)
- Add or extend a REST endpoint (e.g., `GET /api/mcp-config`) in `packages/coc-server` that returns the parsed contents of `~/.copilot/mcp-config.json`.
- Handle file-not-found and parse errors gracefully (return empty list).

### 3. Update Copilot tab UI to fetch and render MCP servers
- In the SPA dashboard (`packages/coc-server/src/`), update the Copilot tab component to call the MCP config endpoint on mount.
- Render a list of server entries showing: name, type, URL (mask or omit sensitive headers).
- Show the existing "No MCP servers configured." empty state when the list is empty.

### 4. Add/update tests
- Unit test for the MCP config loader (file exists / missing / malformed).
- Unit test for the new API endpoint.
- Integration or component test verifying the Copilot tab renders server entries correctly.

## Notes

- The global MCP config path is `~/.copilot/mcp-config.json`; this is distinct from per-repo MCP config.
- `pipeline-core` already loads this file for AI sessions (`loadDefaultMcpConfig`). The server-side API should reuse that loader rather than duplicating file-read logic.
- Be careful not to expose sensitive header values (tokens/keys) in the UI — consider redacting or omitting the `headers` field in the response.
- The `tools` field (`["*"]` means all tools) can be displayed as-is for transparency.

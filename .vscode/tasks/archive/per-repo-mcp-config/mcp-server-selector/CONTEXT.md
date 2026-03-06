# Context: Per-Repo MCP Server Selector

## User Story
Users want to control which MCP servers are active for AI tasks on a per-repository basis within the coc-server dashboard. Currently, all repositories share the default MCP configuration from `~/.copilot/mcp-config.json` with no per-workspace overrides.

## Goal
Enable workspace-scoped MCP server selection via a new "Copilot" tab in RepoDetail, storing preferences per workspace and applying filters during pipeline execution.

## Commit Sequence
1. Types — Workspace MCP Preferences + Pipeline Payload Extension
2. Backend — MCP Config API Endpoints + Workspace Preference Storage
3. Backend — Apply Per-Repo MCP Filter on Pipeline Execution
4. SPA — RepoCopilotTab Component with MCP Server Toggles
5. SPA — Wire Copilot Tab into RepoDetail

## Key Decisions
- `enabledMcpServers: null` = all enabled (default, backward compatible)
- `enabledMcpServers: []` = all disabled
- When filter is active: `loadDefaultMcpConfig: false` + filtered `mcpServers` object passed to SDK
- Configuration stored in `WorkspaceInfo` in process store (`~/.coc/`)
- Toggles save immediately (no explicit Save button)
- MCP servers sourced from `~/.copilot/mcp-config.json`

## Conventions
- Workspace preferences persisted atomically in process store
- Pipeline execution respects per-repo MCP filter before invoking Copilot SDK
- SPA communicates preference changes via API PATCH endpoint

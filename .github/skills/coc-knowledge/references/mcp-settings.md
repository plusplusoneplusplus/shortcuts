# MCP Settings (Workspace-Scoped)

Workspace MCP servers are a merge of two sources: global servers from `~/.copilot/mcp-config.json` (root key `mcpServers`) and workspace servers from `<repo>/.vscode/mcp.json` (root key `servers`, read via Forge MCP loader helpers). Workspace entries override global entries with the same name. Extra fields (`description`, `toolScope`) are stored directly on server entries in those files; consumers that ignore unknown keys keep working.

## REST API

All routes are workspace-scoped under `/api/workspaces/:id/mcp-config`.

### `GET /api/workspaces/:id/mcp-config`

Returns the effective `availableServers` list plus source-separated `sources.global` / `sources.workspace`. Each `availableServers` entry carries safe row metadata only — `name`, `type`, optional `url`/`command`, source/effective flags, `description` (from the config file, or empty string), and `status` (`"ok"` | `"auth"` | `"off"` | `"err"`, derived server-side from type + enabled state and overridden by the panel with live discovery failures). It must **not** return secrets such as `env`, headers, or full argument arrays. `?forceReload=true` bypasses the path-keyed MCP config cache.

### `GET /api/workspaces/:id/mcp-config/:server/detail`

Full detail for one server, available only here: `description`, `envKeys` (key names, values masked), `args` (full array), `toolScope` (`"all"` | `"readonly"` | `"allowlist"`), `source` (`"global"` | `"workspace"`), and `rawJson` (the server's JSON block from its config file).

### `PUT /api/workspaces/:id/mcp-config`

A **partial patch** of the workspace MCP policy. The two fields have separate persistence owners, so each is applied by property PRESENCE: an omitted field is left untouched, an explicit `null` clears it. At least one must be present (`MISSING_FIELDS` otherwise). A tools-only caller therefore never sends a server-list snapshot — sending a stale one is how an older write could revert a newer server toggle.

- `enabledMcpServers` — array of server names, or `null` to enable all. Stored on the workspace record.
- `enabledMcpTools` — `Record<string, string[]>`, server name → enabled tool names, or `null` to clear. When set for a server, only those tools are used at runtime. Stored in per-repo preferences JSON at `~/.coc/repos/<workspaceId>/preferences.json`.

Responds with `{ workspace, enabledMcpServers, enabledMcpTools }` — the canonical policy after the patch, including the field the request did not touch.

### `PUT /api/workspaces/:id/mcp-config/:server`

Updates `description`, `args`, `env` (key-value pairs merged into existing), and `toolScope` in the server's own source file (global or workspace, whichever currently defines it).

### `DELETE /api/workspaces/:id/mcp-config/:server`

Removes the server from its source config file only.

### `POST /api/workspaces/:id/mcp-config`

Adds a server entry. Body: `{ name, type, command?, url?, args?, env?, description?, toolScope?, scope: "global"|"workspace" }`. No PATH validation — saves immediately.

### `POST /api/workspaces/:id/mcp-config/test`

Tests connectivity to an MCP server that need not be registered. Body: `{ type, command?, url?, args?, env? }`. stdio spawns the process, sends JSON-RPC `initialize`, awaits the response with a 10-second timeout, and always kills the process. http/sse sends an HTTP GET; any 2xx–4xx counts as reachable. Response `{ success, message, protocolVersion?, serverName? }`, HTTP 200 on success and 422 on failure.

### `POST /api/workspaces/:id/mcp-config/:server/migrate`

Moves a server between scopes. Body: `{ targetScope: "global"|"workspace" }`.

## OAuth Routes

`POST /api/mcp-oauth/start` resolves configured HTTP/SSE MCP servers, with workspace
definitions overriding global entries. `Microsoft Teams` starts native sign-in;
other servers use the active AI SDK's `createClient` when generic MCP OAuth is
enabled. Generic `force: true` clears matching cache entries and selects
`forceReauth`; Teams reauthentication does not touch that cache. Pending-lifecycle
routes are available for native Teams independently of the generic OAuth flag.

The OAuth initiator waits for the SDK session's MCP server to finish loading before calling login and bounds that call to 30 seconds. Without an authorization URL, the exact server's live runtime `connected` state confirms completed broker sign-in; a valid shared-cache token also confirms authentication when no OAuth-required event exists. Empty login responses alone fail. Pending browser flows check runtime connection and cache state, with bounded status RPCs and cancellation-safe completion. OS-vault tokens do not require token JSON files.

The MCP server panel combines configured status with live tool discovery: a live failure overrides a configured `ok`, OAuth/401/token failures render as `auth`, and other initialization failures render as `err`. Every enabled HTTP/SSE server exposes an Authenticate/Re-authenticate action; explicit re-authentication sends `force: true` to start a fresh SDK OAuth flow.

### Teams channel connection

Normal CoC's Admin → Connections card registers the global `Microsoft Teams` HTTP
MCP endpoint in `~/.copilot/mcp-config.json`. Native `TeamsOAuthCredential` owns
browser sign-in, verified identity and token acquisition; the server returns its
authorization URL and records pending/completed/failed state. Successful sign-in
requires MCP `initialize` and `tools/list` verification. Rust stores refresh
credentials in the OS vault. TypeScript stores only account/configuration metadata
under the host data directory; it does not import Copilot cache credentials.

The card checks `teamsOAuthAvailable` and native `authStatus`. The manager shares
one host/resource credential owner with sign-in and chat callers. Every MCP HTTP
request acquires a native token, including demand renewal and explicit HTTP401
renewal. The configured endpoint requires a concrete tenant; sign-in requests
`openid`, `profile`, `offline_access` and the Teams resource scope.

Configuration is server-wide; inbound `TeamsCommandRouter` lets each sender select
a registered workspace. The container's self-chat relay shares its native owner
with its auth controller, uses server-side sign-in/status polling, and deletes
only its SDK credentials on logout. Native cancellation/disposal prevents late
sign-in, connection or request publication.

### Teams MCP in Copilot sessions

First and follow-up chat turns supply `onMcpAuthRequest` plus
`managedMcpAuthServers` (exact configured name/URL pairs) to `RequestRunner`.
Managed Teams requests acquire native access-token snapshots; runtime OAuth
login never runs for those servers. Host-injected tokens stay ephemeral,
independent of runtime OAuth storage. Unknown scopes require explicit consent
rather than source fallback. The callback and tokens are excluded from invocation logs.

The SDK hook is session-wide. Unmanaged requests are cancelled at the host
boundary, then explicitly delegated to the same session's runtime OAuth login;
initial sign-in and demand refresh retain runtime ownership. Readiness,
cancellation and deadlines are invocation-scoped. Partial name/URL matches
fail closed. `RequestRunner` omits `mcpOAuthTokenStorage`, retaining persistent
generic OAuth in normal `copilot-cli` mode and isolated in-memory OAuth in SDK
`empty` mode. Runtime regression fixtures verify restart reuse, refresh and
host-token isolation through the native store; token JSON files alone do not
prove vault state. Sessions without managed servers retain their provider-owned path.

## OAuth Auto-Refresh (Background)

When `mcpOauth.autoRefresh.enabled` is true (disabled by default, restart required; see [admin-config.md](admin-config.md)), a background loop runs every 5 minutes against `~/.copilot/mcp-oauth-config/`: it dedups the duplicate entries the SDK accumulates per `serverUrl` and refreshes AAD tokens within 10 minutes of expiry. The configured native Teams resource is excluded from both operations. Cached scopes pass through `sanitizeRequestScope`, which drops `<resource>/.default` when other scopes for the same resource exist (AAD rejects that combination with HTTP 400); `offline_access` is then appended so refresh tokens keep rolling.

Only `invalid_grant`, `interaction_required`, and `consent_required` delete the cache entry; every other 4xx (including `invalid_request`, `invalid_scope`) is treated as transient, so request-shape bugs do not force a re-auth. Failure response bodies are logged redacted and capped at 400 chars to keep AADSTS errors diagnosable. Interval and window are hardcoded. Implementation: `packages/coc/src/server/mcp-oauth/mcp-oauth-refresher.ts`.

## Invariants

- Never expose secrets (`env`, headers, full `args`) through the list endpoint; only the detail endpoint exposes env keys (masked) and full args.
- The allow-list is name-only — the effective server set is re-resolved at run time.
- File watching is intentionally avoided; clients drive cache invalidation with `?forceReload=true`.

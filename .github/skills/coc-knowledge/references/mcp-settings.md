# MCP Settings (Workspace-Scoped)

Workspace MCP servers are a merge of global servers from `~/.copilot/mcp-config.json` (root key `mcpServers`) and workspace servers from `<root>/.vscode/mcp.json` (root key `servers`, read via Forge MCP loader helpers). Workspace entries override global entries with the same name. Extra fields (`description`, `toolScope`) are stored directly on server entries in those files; consumers that ignore unknown keys keep working.

One resolver, `resolveWorkspaceMcp` (`packages/coc/src/server/workspaces/workspace-mcp-resolver.ts`), feeds the settings list/detail/mutation routes, live tool discovery, OAuth start and every chat turn (`resolveChatMcpServersForWorkspace`, first turns, follow-ups and tool scripting), so the page shows what chats run.

## Repo groups

A group resolves global < live members' `.vscode/mcp.json` (membership order) < the group root's own `.vscode/mcp.json`:

- A member contributes only servers its own `enabledMcpServers` allows; its `enabledMcpTools` entry narrows the tool list. The group's tool allow-list intersects member-sourced lists (never widens them); for global/group servers it replaces the list as in a repo.
- Member stdio servers are anchored to the member root: `cwd` (default the member root) resolves against it and relative command paths resolve against that `cwd`. Bare commands keep PATH lookup; `${workspaceFolder}`-style variables are not substituted. Discovery probes run stdio servers from the same execution directory as the runtime.
- Same-name member definitions are compared by an in-memory fingerprint of the full resolved connection (transport, command, args, cwd, env, url, headers, tools, timeout, enabled). Identical ones fold into one server with `sharedWith`; distinct ones resolve to the first member in group order and list the losers in `conflicts`. Different names stay separate servers, because policies are keyed by name.
- Stale members, unreadable member configs and an unreadable membership file are reported in `sources` and contribute nothing. Membership is re-read on every resolution; `forceReload` also bypasses member config caches.
- A group whose workspace record cannot be read resolves chat MCP to `{}` instead of an unfiltered default load.
- Group Settings → MCP (`McpServersPanel` `groupMode`) uses the compact rows with source pills (`global`, `group config`, member name with `+N` shared and `· conflict`; tooltip and Overview give the full sentence), lists Group config/member/global source rows with stale, load-failure and disabled-in-repo states, and hides definition edits; enablement and tool allow-lists stay on the group.

## REST API

All routes are workspace-scoped under `/api/workspaces/:id/mcp-config`.

### `GET /api/workspaces/:id/mcp-config`

Returns the effective `availableServers` list plus source-separated `sources.global` / `sources.workspace`; groups add `sources.members` (per member: config path/load state, `stale`/`staleReason`, `disabledByMember`, servers with effective/`overriddenBy`) and `sources.membersError`. Each `availableServers` entry carries safe row metadata only — `name`, `type`, optional `url`/`command`, `source` (`global` | `workspace` | `member`) with effective flags, `member`/`sharedWith`/`conflicts` member refs for groups, `description` (from the config file, or empty string), and `status` (`"ok"` | `"auth"` | `"off"` | `"err"`, derived server-side from type + enabled state and overridden by the panel with live discovery failures). It must **not** return secrets such as `env`, headers, or full argument arrays. `?forceReload=true` bypasses the path-keyed MCP config cache.

### `GET /api/workspaces/:id/mcp-config/:server/detail`

Full detail for one server, available only here: `description`, `envKeys` (key names, values masked), `args` (full array), `toolScope` (`"all"` | `"readonly"` | `"allowlist"`), `source` (`"global"` | `"workspace"`, or `"member"` plus `member` when a group server is defined by a member, read from that member's file), and `rawJson` (the server's JSON block from its config file).

### `PUT /api/workspaces/:id/mcp-config`

A **partial patch** of the workspace MCP policy. The two fields have separate persistence owners, so each is applied by property PRESENCE: an omitted field is left untouched, an explicit `null` clears it. At least one must be present (`MISSING_FIELDS` otherwise). A tools-only caller therefore never sends a server-list snapshot — sending a stale one is how an older write could revert a newer server toggle.

- `enabledMcpServers` — array of server names, or `null` to enable all. Stored on the workspace record.
- `enabledMcpTools` — `Record<string, string[]>`, server name → enabled tool names, or `null` to clear. When set for a server, only those tools are used at runtime. Stored in per-repo preferences JSON at `~/.coc/repos/<workspaceId>/preferences.json`.

Responds with `{ workspace, enabledMcpServers, enabledMcpTools }` — the canonical policy after the patch, including the field the request did not touch.

### `PUT /api/workspaces/:id/mcp-config/:server`

Updates `description`, `args`, `env` (key-value pairs merged into existing), and `toolScope` in the server's own source file (global or workspace, whichever currently defines it). On a group, a member-defined server returns 409 (edit it in that repo); this also applies to DELETE and migrate, so a group page never writes a member or a same-named global entry.

### `DELETE /api/workspaces/:id/mcp-config/:server`

Removes the server from its source config file only.

### `POST /api/workspaces/:id/mcp-config`

Adds a server entry. Body: `{ name, type, command?, url?, args?, env?, description?, toolScope?, scope: "global"|"workspace" }`. No PATH validation — saves immediately.

### `POST /api/workspaces/:id/mcp-config/test`

Tests connectivity to an MCP server that need not be registered. Body: `{ type, command?, url?, args?, env? }`. stdio spawns the process, sends JSON-RPC `initialize`, awaits the response with a 10-second timeout, and always kills the process. http/sse sends an HTTP GET; any 2xx–4xx counts as reachable. Response `{ success, message, protocolVersion?, serverName? }`, HTTP 200 on success and 422 on failure.

### `POST /api/workspaces/:id/mcp-config/:server/migrate`

Moves a server between scopes. Body: `{ targetScope: "global"|"workspace" }`.

## OAuth Routes

`POST /api/mcp-oauth/start` resolves configured HTTP/SSE MCP servers through the
workspace's effective resolution (workspace over global; group members included). `Microsoft Teams` starts native sign-in;
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

The SDK hook is session-wide. Startup passes the shared pending manager to chat
executors only when the default-off, restart-required `mcpOauth.enabled` setting is
true. Both initial and follow-up turns then provide the generic OAuth callback.
Without that callback, managed Teams token requests still work, while unmanaged
requests are cancelled without CoC-initiated runtime login or proactive probing.
When enabled, unmanaged requests are cancelled at the host boundary and delegated
to the same session's runtime OAuth login; initial sign-in and demand refresh retain
runtime ownership. Readiness, cancellation and deadlines are invocation-scoped.
Partial name/URL matches fail closed. `RequestRunner` omits `mcpOAuthTokenStorage`,
retaining persistent generic OAuth in normal `copilot-cli` mode and isolated
in-memory OAuth in SDK `empty` mode. Runtime regression fixtures verify restart
reuse, refresh and host-token isolation through the native store; token JSON files
alone do not prove vault state. Sessions without managed servers retain their
provider-owned path.

## OAuth Auto-Refresh (Background)

When `mcpOauth.autoRefresh.enabled` is true (disabled by default, restart required; see [admin-config.md](admin-config.md)), a background loop runs every 5 minutes against `~/.copilot/mcp-oauth-config/`: it dedups the duplicate entries the SDK accumulates per `serverUrl` and refreshes AAD tokens within 10 minutes of expiry. The configured native Teams resource is excluded from both operations. Cached scopes pass through `sanitizeRequestScope`, which drops `<resource>/.default` when other scopes for the same resource exist (AAD rejects that combination with HTTP 400); `offline_access` is then appended so refresh tokens keep rolling.

Node owns scheduling, scope policy, deduplication and Copilot-cache persistence. It calls `coc-native.exchangeMicrosoftRefreshToken` for the bounded Rust `auth-sdk` exchange, then writes access-token expiry, returned scopes and the rotated refresh token, retaining cached scopes/token when replacements are omitted. No native credential-store import is involved.

Only typed `invalid_grant`, `interaction_required`, and `consent_required` rejections with HTTP status below 500 delete the cache entry. Other failures, including request-shape errors, malformed responses and timeouts, retain it. Logs include safe error codes, HTTP status and rejection categories, never provider bodies or tokens. Interval and window are hardcoded. Implementation: `packages/coc/src/server/mcp-oauth/mcp-oauth-refresher.ts`.

## Invariants

- Never expose secrets (`env`, headers, full `args`) through the list endpoint; only the detail endpoint exposes env keys (masked) and full args.
- The allow-list is name-only — the effective server set is re-resolved at run time.
- File watching is intentionally avoided; clients drive cache invalidation with `?forceReload=true`.

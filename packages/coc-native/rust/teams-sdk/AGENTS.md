# teams-sdk

Unpublished Rust crate in the native Cargo workspace. No npm package, N-API, Node, CoC policy, or persistence. Default feature `graph`. MCP, IC3, and Trouter always compile.

Callers own credential-source policy. `azure_cli` adapts auth-sdk to the Teams token provider. A client is immutable config. A session owns account, generation, cancellation, and MCP state. `reconnect` revokes the session and its clones.

## Rules

- No backend fallback, URL override, write replay, or cross-region retry. Read HTTP 401 refreshes once for the same account. HTTP 403 never refreshes. Credential metadata comes from the trusted provider, not JWT parsing.
- Transient bodies and tokens have no Debug or Serialize impl and are never logged or cached.
- Graph reads use stable v1.0 and `include-unknown-enum-members`. Skip only known system events or the exact senderless HTML sentinel.
- MCP tools must be advertised. Initialization publishes session state only after initialize and every tool page. Dropped futures leave state uninitialized. List tools without paging reject incomplete results. SSE is RPC, not a subscription.
- IC3 ordinary writes require `send_to_existing_one_on_one`, an intended recipient, and a fresh complete `ChatVerifier`. Generic IC3 chat sends reject. Channels, groups, mentions, and replies are unsupported writes. Self send is explicit `48:notes`. History and detail verify exact native type pairs and preserve numeric `root_message_id`. Thread reads use `;messageid=<root>` and cannot cross roots. Roster reads are not write authorization.
- Notifications are bounded hints, not message authority. Endpoint: `wss://go.trouter.teams.microsoft.com/v4/c/`. Startup, reconnect, loss, and overflow require caller reconciliation. The WebSocket uses patched bundled WebPKI roots and rustls with an explicit ring provider, not the OS trust store.
- Production HTTP rejects redirects, caps bodies, does not retry transport errors, and sanitizes errors. Tests inject trusted transports.
- Cursors are opaque and session, backend, and collection scoped. Cursor paths compare decoded segments and reject traversal.
- `AzureCliCredentials` uses active-account `Refresh::Auto`. Usernames and JWT claims are not Teams identity. Init and acquisition each cap at 30s. No interactive login and no persistence. Protocol detail: [`auth-sdk/README.md`](../auth-sdk/README.md).

## Capability

| Capability | Graph | MCP | IC3 |
|---|---|---|---|
| Chat discovery | Paged | Bounded `ListChats` | Paged supported types |
| Teams/channels | Supported | Advertised tools | Unsupported |
| Chat history/detail | Supported | Supported | Exact type check; `48:notes` self stream |
| Channel history | Separate collections | Separate collections | Unsupported |
| Participants | Member pages | Advertised tools | Chat roster only |
| Self send | Unsupported | Advertised tool | `48:notes` |
| Ordinary chat send | Existing chat, no mentions | Advertised tool | Verified existing 1:1 only |
| Channel send/reply | Supported | Advertised tools | Unsupported |
| Channel Like | `setReaction` | Unsupported | Exact-id emotions route |
| Notifications | Unsupported | Unsupported | Trouter hints |

The SDK has no login, profile, chat-title, create, attachment, edit/delete, durable delta, or command admission.

## CLI

`../teams-cli/` is read-only: `list`, `view <chat-id>`, `watch --seconds <1-3600>`. Defaults: IC3, region `amer`, watch 60s. Graph rejects `--region`. Help and version exit 0 without auth. Bad args exit 2. Runtime failure exits 1. Output can contain message text and must not enter shared logs. Ctrl+C drops auth and Teams work before token publication.

Auth is one source: an explicit expiring token (`TEAMS_GRAPH_TOKEN` or `TEAMS_IC3_TOKEN` plus tenant, user, and expiry) or Azure CLI. `--tenant-id` overrides `TEAMS_TENANT_ID`. Explicit tokens cannot refresh. Invalid values do not fall back. These defaults are CLI-only.

From `packages/coc-native/rust/`: `cargo test --locked -p teams-sdk`, with and without default features, and the same for `teams-cli`. Install: `cargo install --locked --path teams-cli`.

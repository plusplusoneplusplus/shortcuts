# coc-connector

Consolidated messaging connectors behind one `MessagingConnector` contract. No CoC/forge dependencies.

## Layout

- `src/core/` — provider-neutral contract: `MessagingConnector`, `InboundMessage`, `ConnectorStatus`, `SendOptions`, `MessagingTarget`, `MessagingConnectorOptions`. Exported from the package root (`@plusplusoneplusplus/coc-connector`).
- `src/teams/` — `TeamsBot` (Graph send-only, MCP channel polling), transports, auth, clients. Exported from `@plusplusoneplusplus/coc-connector/teams`.
- `src/whatsapp/` — `WhatsAppBot` over Baileys (lazy `import()`). Exported from `@plusplusoneplusplus/coc-connector/whatsapp`.
- `teams/`, `whatsapp/` — proxy `package.json` redirects (`main`/`types` → `../dist/...`). They exist so consumers built with `moduleResolution: node10` (which ignores the `exports` map) can resolve the subpaths. Keep them in sync with the `exports` map.

## Conventions

- **Subpath exports, not a flat barrel.** Teams and WhatsApp both export a type named `BotStatus` with different unions; subpaths keep every exported name unchanged and collision-free.
- **`getStatus()` is normalized** to `ConnectorStatus`. Each bot keeps its native `_status` for internal logic and maps on the way out. WhatsApp maps `qr-pending → pairing`, `creating-group → busy`; use `WhatsAppBot.getNativeStatus()` when the native value is needed (e.g. REST status output).
- **`SendOptions.mentions` are keyed by `id`.** `TeamsBot.send` maps `id → aadId` before calling its transport.
- **MCP polling failures stay visible.** `TeamsBot` reports poll errors through `onError` and clears them after a successful poll; an unrecoverable token-refresh failure stops polling with error status until reconnect. Optional `onPoll` and `onInbound` observers receive only safe outcome/skip enums, and observer exceptions cannot interrupt polling or routing.
- **MCP HTTP sessions complete initialization.** `McpClient` sends `notifications/initialized` after negotiating the protocol version and carries the session id and version on later requests, including `tools/list`.
- **Channel thread polling is opt-in.** With `pollChannelReplies` enabled and `ListChannelMessageReplies` advertised by MCP, the transport fetches visible roots plus a rotating batch of up to five `channelThreadRoots` supplied by durable CoC bindings; the channel bot handles unseen IDs in order, skipping its own posts. Default channel and DM polling retain last-message behavior.
- **MCP sends escape content backslashes.** Channel posts, thread replies, and self-DMs double backslashes in tool content so Windows paths survive the Teams MCP parser. Channel tool results with `isError` or `Error:` text reject with `TeamsMcpSendRejectedError` so a caller can distinguish definite rejection from an unknown network outcome; send failures do not imply a lost connection.
- Baileys + qrcode-terminal are `optionalDependencies` — installed but only loaded by WhatsApp use.

## Build / test

- `npm run build -w packages/coc-connector` (tsc → `dist/{index,core,teams,whatsapp}`). Must build before `coc`/`coccontainer` compile or run tests that resolve via `dist`.
- `npm run test:run -w packages/coc-connector` (moved Teams/WhatsApp tests + `test/core` conformance).

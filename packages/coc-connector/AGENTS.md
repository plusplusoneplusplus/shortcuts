# coc-connector

Consolidated messaging connectors behind one `MessagingConnector` contract. No CoC/forge dependencies.

## Layout

- `src/core/` — provider-neutral contract: `MessagingConnector`, `InboundMessage`, `ConnectorStatus`, `SendOptions`, `MessagingTarget`, `MessagingConnectorOptions`. Exported from the package root (`@plusplusoneplusplus/coc-connector`).
- `src/teams/` — `TeamsBot` (opt-in Graph channel polling, MCP channel polling), transports, auth, clients. Exported from `@plusplusoneplusplus/coc-connector/teams`.
- `src/whatsapp/` — `WhatsAppBot` over Baileys (lazy `import()`). Exported from `@plusplusoneplusplus/coc-connector/whatsapp`.
- `teams/`, `whatsapp/` — proxy `package.json` redirects (`main`/`types` → `../dist/...`). They exist so consumers built with `moduleResolution: node10` (which ignores the `exports` map) can resolve the subpaths. Keep them in sync with the `exports` map.

## Conventions

- **Subpath exports, not a flat barrel.** Teams and WhatsApp both export a type named `BotStatus` with different unions; subpaths keep every exported name unchanged and collision-free.
- **`getStatus()` is normalized** to `ConnectorStatus`. Each bot keeps its native `_status` for internal logic and maps on the way out. WhatsApp maps `qr-pending → pairing`, `creating-group → busy`; use `WhatsAppBot.getNativeStatus()` when the native value is needed (e.g. REST status output).
- **`SendOptions.mentions` are keyed by `id`.** `TeamsBot.send` maps `id → aadId` before calling its transport.
- **MCP polling is adaptive.** `TeamsBot` polls every 12 seconds while active and every 30 seconds after a minute without new inbound messages. A whole-poll HTTP 429 honors `Retry-After` or uses jittered exponential backoff capped at five minutes; successful polling clears the cooldown. Poll errors reach `onError` and clear on recovery; an unrecoverable token-refresh failure stops polling until reconnect. Optional `onPoll` and `onInbound` observers receive only safe outcome/skip enums, and observer exceptions cannot interrupt polling or routing.
- **MCP HTTP sessions complete initialization and recover on expiry.** `McpClient` sends `notifications/initialized` after negotiating the protocol version and carries the session id and version on later requests, including `tools/list`. A 404 on an established session triggers one fresh initialization and one replay; a 404 without a session or after replay remains an error. HTTP errors expose status and `Retry-After` without exposing authorization headers.
- **Channel thread polling is opt-in.** With `pollChannelReplies` enabled and `ListChannelMessageReplies` advertised by MCP, the transport fetches visible roots plus a rotating batch of up to five `channelThreadRoots` supplied by durable CoC bindings, advancing one reply page per root per poll. Reply-list responses accept `replies` arrays (including empty arrays); malformed lists fail the poll. The channel bot admits unseen replies under bound roots on the first poll, consults durable known/own-ID callbacks on reconnect, and retries failed admissions; default channel and DM polling retain last-message behavior.
- **Channel reaction admission is upstream of routing.** Inbound messages retain Teams application authorship so CoC can skip bot-authored posts. Graph channel polling is live opt-in via `pollGraphChannel`; it establishes a new watermark on enable, and Graph DMs remain send-only. MCP admits unseen bound replies during its initial poll with `initializationReplay` so CoC can route them without reacting to history. Connector deduplication excludes own, empty, and unchanged posts before reaction admission; DMs do not react.
- **Native Like transport:** Graph uses channel `setReaction` (Unicode thumbs-up, HTTP 204); MCP invokes only an advertised schema-compatible channel reaction tool. Reaction calls abort after five seconds and rejected/unavailable operations throw without affecting message dispatch.
- **MCP sends escape content backslashes.** Channel posts, thread replies, and self-DMs double backslashes in tool content so Windows paths survive the Teams MCP parser. Channel tool results with `isError` or `Error:` text reject with `TeamsMcpSendRejectedError` so a caller can distinguish definite rejection from an unknown network outcome; send failures do not imply a lost connection.
- Baileys + qrcode-terminal are `optionalDependencies` — installed but only loaded by WhatsApp use.

## Build / test

- `npm run build -w packages/coc-connector` (tsc → `dist/{index,core,teams,whatsapp}`). Must build before `coc`/`coccontainer` compile or run tests that resolve via `dist`.
- `npm run test:run -w packages/coc-connector` (moved Teams/WhatsApp tests + `test/core` conformance).

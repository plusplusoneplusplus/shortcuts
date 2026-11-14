# coc-connector

One `MessagingConnector` contract. No CoC or forge dependencies. Teams OAuth and Azure CLI auth use `coc-native` auth-sdk.

## Layout

- `src/core/` — neutral contract, exported from `@plusplusoneplusplus/coc-connector`.
- `src/teams/` — `TeamsBot`, transports, auth. Hybrid `mode: mcp, channelReadBackend: graph` uses the ID/thread scanner, not standalone Graph timestamp admission. Public exports stay in `src/teams/index.ts`. Subpath: `@plusplusoneplusplus/coc-connector/teams`.
- `src/teams/graph/`, `ic3/`, `mcp/` — Graph (beta reads, stable v1.0 writes), IC3, MCP.
- `src/whatsapp/` — `WhatsAppBot` over lazy Baileys. Subpath: `@plusplusoneplusplus/coc-connector/whatsapp`.
- `teams/` and `whatsapp/` proxy `package.json` files exist for `moduleResolution: node10`. Keep them aligned with `exports`.

## Rules

- Subpath exports, not a flat barrel. Both packages export a different `BotStatus`.
- `getStatus()` returns `ConnectorStatus`. WhatsApp maps `qr-pending → pairing` and `creating-group → busy`. Use `getNativeStatus()` for the native value. `createGroup()` must not leave observers on `creating-group`.
- `SendOptions.mentions` are keyed by `id`. Teams maps `id → aadId`.
- MCP polls every 12s while active and every 30s after a quiet minute. HTTP 429 honors `Retry-After` or backs off to five minutes. Token-refresh failure stops polling until reconnect. Observer exceptions cannot interrupt polling.
- Trouter is default off. Real `sourceThreadId` beats synthetic `48:` streams. Unknown source is ignored. The scheduler coalesces 64 roots, reconciles on loss, disconnect, or overflow, and falls back 60s after completion. HTTP 429 also gates wakes. Notifications carry no admission authority. Reaction updates are a separate hook and enable no writes. `getNotificationStatus()` is independent of reader connectivity. Stop disposes a `TrouterClient` permanently.
- Notification reads page toward the last admitted root (`commitNotificationRead`). Caps: 5-minute deadline, 100 cursors, 5,000 replies per thread, 10,000 messages per scan. Incomplete reads are not committed. Hybrid Graph uses full reply pages in ordinary polls too.
- MCP sends `notifications/initialized` and recovers an expired session once on 404. Outbound operations do not replay sessions.
- `pollChannelReplies` is opt-in. `historicalSelectionReplay` is silent reconstruction, distinct from `initializationReplay` (Like suppression). Graph channel polling (`pollGraphChannel`) is opt-in, watermarks on enable, and reads at most 50 recent roots. Graph DMs are send-only. Dedup excludes own, empty, and unchanged posts before reaction admission.
- Only a discovered self-chat id is self. `getMirrorAccountKey()` is an opaque hash; missing identity fails closed. `isMirrorSender()` does not treat application authorship as self.
- `TeamsOAuthCredential` owns browser sign-in under `dataDir/teams-auth/<fingerprint>`. Each acquisition uses an isolated native provider. Refresh credentials stay in native secure storage. Requests include `openid`, `profile`, `offline_access`, and resource scopes. MCP initialize and tools-list precede account publication. No Azure CLI fallback for MCP. `getToken` renews and never starts sign-in.
- `TeamsAzureCliCredential` is one native provider per connection and resource, active-account, demand renewal. Cached reads still reach the SDK. Startup budget is 30s; ordinary writes keep a 10s deadline. CLI account names are not Teams object ids.
- Graph channel writes need `ChannelMessage.Send` or an existing `Group.ReadWrite.All`. Do not request the broader grant. Hybrid reads need `ChannelMessage.Read.All` or an existing read grant, pinned to the same MCP account. Failed reads never fall back. Beta next links must be collection-scoped. Null body is a tombstone only with `deletedDateTime`.
- `receiveImages` is opt-in on hybrid Graph channel roots and replies. Inline content uses fixed Graph v1.0 `$value` paths. SharePoint file refs use fixed beta content-stream paths. Never fetch supplied URLs or thumbnails. File access needs `Files.Read` or a higher file-read grant. Redirects stay off. 401 refreshes once.
- IC3 ordinary sends use `operationRoutes.chatSend: ic3` and `sendMessage({kind:'chat', chatId, recipientId, connectionId})` after a fresh MCP membership proof of the existing `oneOnOne`. Raw `send(target, text)` is not that entry point. Thread roots append `;messageid=<root>` only to the encoded route. Self-chat rejects thread routing. Self sends use `operationRoutes.selfSend: ic3` and `48:notes`. An unset region rejects before credentials or network. No endpoint override, region default, or cross-region replay. Ordinary verification, credentials, and write share 10s. Source replies allow 70s. Unknown delivery is never replayed.
- Graph channel Likes are Unicode thumbs-up (HTTP 204). IC3 reactions accept Eyes (`1f440_eyes`), Checkmark (`2714_heavycheckmark`), and Crossmark (`274c_crossmark`) on one exact key. `acknowledgeSourceMessage` retries only definite retryable failures, at most three times.
- `TeamsOperationError` carries `not-attempted` / `rejected` / `unknown` and `retryable` (default false). Routers never fail over. MCP and Graph may refresh once on typed HTTP 401.
- WhatsApp: stop cancels reconnect timers. `validateWhatsAppMedia` rejects bad MIME, path-like names, signature mismatches, and payloads over 10 MiB before dispatch. Image types are PNG/JPEG/GIF/WebP; other MIME types are documents. Sends have a 30s deadline and never replay. `receiveImages` is opt-in; download is lazy, signature-checked, 30s, and cancelled on shutdown.
- Command grammar lives in `shared/commands.ts`. CoC owns routing. `fixedTeamsChannel` suppresses repo, topic, and chat-id targeting only when callers opt in for both parse and help. Mode prefixes require a slash. Plain text leaves mode undefined.

## Build / test

`npm run build -w packages/coc-connector` before `coc` or `coccontainer` compile. `npm run test:run -w packages/coc-connector`.

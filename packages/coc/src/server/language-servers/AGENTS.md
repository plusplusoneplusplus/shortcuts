# Language Servers

Language-neutral contract for standard LSP servers. Nothing here is
TypeScript-specific; language details live inside a definition so shared editor
and transport code stays generic.

## Files

- `types.ts` — `LanguageServerDefinition` and validation result shapes.
- `definition-schema.ts` — zod validation returning field-level errors, plus
  list validation that reports duplicate ids by index.
- `file-match.ts` — POSIX path normalization and glob matching (`**`, `*`, `?`,
  `{a,b}`). Patterns match the workspace-relative path, so Windows separators
  are normalized before matching.
- `selection.ts` — deterministic server selection (priority, then pattern
  specificity, then id), LSP language-id resolution, and project-root discovery
  from root markers.
- `presets.ts` — built-in definitions and merging with workspace configuration.
- `adapters.ts` — `prepareDefinitionForRoot`, the one language-neutral hook the
  manager calls before starting a session.
- `typescript-adapter.ts` — TypeScript's answer to that hook: which
  `typescript-language-server` runs and which TypeScript library it drives.
- `client-requests.ts` — the client half of the protocol: built-in answers to
  the requests a server sends back, plus `DEFAULT_CLIENT_CAPABILITIES`.
- `routes.ts` — `GET`/`PUT`/`PATCH /api/workspaces/:id/language-servers`,
  registered from `src/server/routes/index.ts`.
- `repository.ts` — per-workspace persistence of `language-servers.json` under
  `getRepoDataPath`, plus `resolveLanguageServerDefinitions` for the definitions
  a workspace may actually start.

## Rules

- A definition's `command` is an executable and `args` is a vector. Validation
  rejects shell metacharacters and quotes so a command line can never be passed
  as a single executable.
- Ids must be slug-safe; they appear in log file names and status payloads.
- Built-in presets ship disabled. Language support is opt-in per workspace.
- A workspace definition sharing a preset id overrides that preset and keeps
  `builtIn: true`, so presets can be repointed but not deleted.
- Selection must not depend on input order.
- Only configuration is persisted. Buffers, diagnostics, and connections stay in
  memory.
- Responses expose `effective` (presets layered with overrides) and `startable`
  (what may actually run). Warning file paths and other host details stay out of
  browser payloads.
- A write validates everything first; one field-level error aborts the whole
  write so the last valid configuration stays on disk. A corrupt file on read
  falls back to disabled rather than starting an unconfigured server.

## Runtime transport

- `jsonrpc.ts` — LSP `Content-Length` framing. `encodeMessage` writes the header
  in ASCII and the body in UTF-8, declaring the byte length. `LspMessageReader`
  buffers *bytes*, not strings, so a multi-byte character split across chunks
  decodes correctly. It ignores unknown headers, tolerates header casing,
  resynchronizes past an unusable header block, and refuses a declared length
  above `maxMessageBytes` instead of buffering it.
- `connection.ts` — `LanguageServerConnection` takes any readable/writable pair,
  so the same class serves a spawned stdio process today and a container relay
  later. It owns request-id correlation, per-request timeouts, `$/cancelRequest`
  on timeout or `AbortSignal`, notification fan-out, and answering
  server-to-client requests (unhandled methods get `-32601`, a throwing handler
  gets `-32603`). A reply whose request already settled is dropped, which is how
  stale results from a superseded query never reach a caller. `dispose` rejects
  everything in flight with a `closed` failure and detaches every stream
  listener; the stream ending does the same.
- Failures arrive as `LanguageServerRequestError` with a `failure` of `timeout`,
  `cancelled`, `closed`, `server-error`, or `write-failed`.
- `session.ts` — `LanguageServerSession` owns one process: it spawns
  `definition.command` with `definition.args` and `shell: false` in the resolved
  `rootPath`, runs `initialize`/`initialized`/`shutdown`/`exit`, and wraps a
  `LanguageServerConnection`. `getState()` reports the concise status set —
  `disabled`, `unavailable`, `starting`, `ready`, `reconnecting`, `failed` —
  plus the server name, version, and negotiated capabilities. `disabled` covers
  both a config-disabled definition and one stopped because nothing needs it.
  A missing executable is `unavailable`, not `failed`.
- The state also carries `generation`, a count of successful handshakes. Every
  restart, crash recovery and config replacement produces a server that knows no
  documents, and the browser keeps its attachment across all of them, so this
  number is the only cue it has that the process behind an open file is a new
  one. It starts at 0 and only ever increases; a failed start leaves it alone.
- `attach()` returns a release function. The process stops
  `idleTimeoutMs` after the last reference releases; an unexpected exit while
  references remain restarts with doubling backoff up to `maxRestarts`, then
  settles on `failed` until `restart()` clears the budget. Process `exit` and
  `error` handlers are bound per child, so a previous process's late exit never
  disposes its successor's connection.
- `stop()` resolves only once the child is really gone: the `exit` notification
  first, then a signal, then SIGKILL `killGraceMs` after that (2 seconds by
  default), and it waits for the exit event throughout. A language server that
  traps SIGTERM or is stuck in a long request would otherwise outlive the CoC
  process that started it, and a shutdown that resolved early would report a
  teardown it had not finished. The escalation timers are the only ones in this
  module that are NOT `unref`ed — an event loop free to exit before the kill
  fires would orphan the process the kill exists to remove.
- `client-requests.ts` — `LanguageServerClientRequests` answers
  `workspace/configuration` (resolved from the definition's `settings` by dotted
  section path), `workspace/workspaceFolders`, `client/registerCapability`,
  `client/unregisterCapability`, and `window/workDoneProgress/create`. The
  session installs them on every connection before the caller's own handlers,
  so a caller's `onRequest` for the same method still wins, and any other
  method still gets `-32601`. Registrations are per connection: `reset()` runs
  before each handshake and on every stop, so a restarted server never inherits
  the previous process's registrations. They surface as
  `getDynamicRegistrations()` and in the state's `dynamicRegistrations`.
- `DEFAULT_CLIENT_CAPABILITIES` is what `initialize` advertises when a caller
  passes no `clientCapabilities`. It lists exactly what the runtime honors —
  the handlers above, document synchronization, and hover, definition,
  references, completion, signature help, and diagnostics. Do not advertise a
  capability nothing implements: a server will then send requests nobody
  answers.
- `onNotification`, `onRequest`, and `onReady` handlers are re-registered on
  every new connection, so a caller subscribes once and keeps receiving
  diagnostics across restarts. `onReady` is where the document layer replays
  open buffers before resuming queries. `sendRequest` starts the server on
  demand.
- `onStateChange` reports every transition of the user-facing state, in order.
  A status display needs it, because `starting`, `reconnecting`, `failed` and
  `disabled` have no handler of their own — only `ready` does. The `ready`
  transition fires here before `onReady`, with the connection already live, so
  a subscriber may send on it. A listener that throws is reported through
  `onError` and does not stop the others.
- `manager.ts` — `LanguageServerManager` owns every live session on this host.
  `acquire({ workspaceId, workspaceRoot, editingSessionId, relativePath })`
  resolves the definition with `selectDefinitionForFile`, the root with
  `resolveServerRoot`, and returns a handle carrying the session, the LSP
  language id, and a `release` function. A failure carries a reason of
  `disabled`, `no-definition`, or `capacity` so the editor can show a concise
  status instead of an error.
- Sessions are keyed on workspace, browser editing session, definition id, and
  resolved root. Two browser windows on the same file therefore get two
  processes and cannot see each other's buffers or diagnostics, and a monorepo
  gets one process per project root.
- `maxSessions` (default 12) bounds live sessions. Reaching it evicts the least
  recently used unreferenced session; when every session is still referenced the
  acquire fails with `capacity` rather than dropping a buffer someone owns.
- A config change replaces only the sessions whose definition changed or
  disappeared, compared by a fingerprint of command, args, initialization
  options, settings, and language ids. `onSessionClosed` reports every
  manager-initiated close (`config-changed`, `evicted`, `workspace-removed`,
  `shutdown`) so the document layer knows to replay into a fresh session.
- `disposeWorkspace`, `disposeEditingSession`, and `dispose` release processes,
  timers, and the config subscription. After `dispose` every `acquire` is
  refused. All three await the child processes, so when they resolve nothing
  the manager started is still running.
- `teardown.test.ts` is the evidence for that, and it is the one suite that
  watches real pids rather than session objects: the fixture writes its pid with
  `--pid-file <path>`, and `--stubborn` makes it ignore `exit`, a closed stdin
  and SIGTERM so the kill escalation is actually exercised. It covers the
  session, the manager, the bridge's heartbeat interval, and a composed
  `createExecutionServer` through workspace deletion and shutdown.

## Runtime preparation (`adapters.ts`, `typescript-adapter.ts`)

- The manager calls `prepareDefinitionForRoot(definition, rootPath, deps)` once
  per session it creates. An adapter may rewrite `command`, `args`, and
  `initializationOptions`, and returns a `runtimeLabel` plus a `commandLabel`.
  Nothing else in the runtime branches on a language.
- An adapter claims a definition only when it is a built-in preset that still
  points at its own command. Repointing a preset in workspace settings is an
  explicit choice, and preparation must not undo it.
- `typescript-adapter.ts` walks up from the project root for
  `node_modules/typescript-language-server/lib/cli.mjs`, then falls back to the
  copy packaged with CoC, then leaves the configured executable for `PATH`. The
  packaged copy is the `typescript-language-server` dependency of
  `packages/coc`, so TypeScript support works without a separate install. It is
  never imported — only `require.resolve`d — so it stays out of every bundle.
  Removing that dependency silently downgrades every project without its own
  copy to whatever is on `PATH`; `typescript-integration.test.ts` is what fails
  when that happens. The
  server is run as `node <cli.mjs> --stdio` rather than through a
  `node_modules/.bin` shim, because that shim is a shell script on POSIX and a
  `.cmd` file on Windows and the definition contract forbids a shell.
- TypeScript itself is resolved the same way: a workspace `typescript` at least
  `MIN_WORKSPACE_TYPESCRIPT_VERSION` wins and is passed as
  `initializationOptions.tsserver.path`; an older one is rejected with a note
  and the packaged version is used instead. A `tsserver.path` already in the
  configuration is never overwritten.
- Resolved paths are host paths. They go into the definition the session
  spawns, never into a browser payload. What the browser sees is
  `state.runtime` (`Server: workspace · TypeScript 5.9.3: workspace`), and
  `commandLabel` is what a missing-executable status names, so an absolute
  fallback path cannot leak through `Executable not found`.

## Browser bridge (`uri-mapping.ts`, `ws-bridge.ts`)

- `uri-mapping.ts` translates between browser and host document identity. The
  browser addresses a file as `coc-file://<workspaceId>/<relative/path>`; the
  bridge maps it to the owning host's `file://` URI and back. `toServerUri`
  refuses a URI with another scheme, another workspace, or a path that escapes
  the workspace root, so the mapping is also the access check. `toBrowserUri`
  leaves an out-of-workspace dependency or a non-`file:` scheme untouched, which
  is how the client can tell a live repo document from an external target.
  `translateUris` deep-copies a payload, rewriting only LSP URI keys (`uri`,
  `targetUri`, `newUri`, `oldUri`, `rootUri`, `documentUri`, `externalUri`), and
  rejects the whole payload when one URI cannot be mapped.
- `ws-bridge.ts` — `LanguageServerWebSocketServer(workspaces, manager)` serves
  `/ws/language-server`. `workspaceId` and `editingSessionId` come from the
  upgrade URL and are validated against the workspace list before any process is
  touched; the origin check is the shared one in
  `src/server/streaming/websocket.ts`, which routes the path to this server.
- Client messages: `lsp-attach`, `lsp-detach`, `lsp-request`, `lsp-cancel`,
  `lsp-notify`, `lsp-restart`, `ping`. Server messages: `lsp-welcome`, `lsp-attached`,
  `lsp-unavailable`, `lsp-response`, `lsp-notification`, `lsp-status`,
  `lsp-detached`, `lsp-error`, `pong`. This shape is the transport contract a
  container relay implements, so the editor client does not change when the
  server moves off this host.
- An attachment is one document on one socket; it holds one manager reference
  and its own in-flight request map, so `lsp-cancel` and a closed socket both
  abort cleanly. Server notifications are subscribed once per session key per
  socket (`textDocument/publishDiagnostics`, `window/showMessage`,
  `window/logMessage`, `$/progress`) and carry `sessionKey`, since diagnostics
  are session-wide rather than per attachment. A manager-initiated close detaches
  every affected attachment with the manager's reason, which is the client's cue
  to re-attach and replay its buffers.
- Attaching a document starts its session. That is what "lazy startup after an
  eligible file opens" means here: a notification cannot spawn a process, so
  without it the browser's opening `didOpen` would be dropped and the server
  would never learn about the file. `lsp-attached` is sent first so the browser
  never waits on a spawn and a handshake; success reaches it through the
  session's ready handler as an `lsp-status`, and a failed start is pushed as
  one too, since no ready handler will fire for it.
- The socket subscribes to `session.onStateChange` and forwards every
  transition as an `lsp-status`, so the browser's status display sees
  `starting`, `reconnecting` and `failed` rather than only `ready`.
- `lsp-restart` is the user's retry: it restarts the server behind one
  document without restarting CoC, and the attachment survives it — the same
  session comes back with a new process and a new `generation`, which is the
  browser's cue to replay. Restarts are coalesced per session, because one
  session serves every document under a project root and two panes pressing
  retry must not stop and start the process twice. Nothing is sent in reply;
  the session's own state transitions carry the outcome.
- Server-to-client requests such as `workspace/configuration` and
  `client/registerCapability` are still answered `-32601`; `tsserver` behaves
  better once they are handled.

## Composition

- `src/server/infrastructure/language-server-infrastructure.ts` —
  `createLanguageServerInfrastructure(store, dataDir)` builds the manager and
  the bridge and returns `dispose()`. `createExecutionServer` calls it before
  `createWebSocketInfrastructure`, which passes the bridge as the fourth
  argument of `attachWebSocketUpgradeHandler`, and the close handler awaits
  `dispose()` after the terminal teardown. It is composed unconditionally:
  nothing spawns until a browser attaches a document in a workspace whose
  configuration is enabled, and that configuration ships disabled.
- `dispose()` closes sockets first, then the manager, so a client cannot issue a
  request into a session that is going away.
- `active.ts` publishes the running manager for the few call sites outside the
  bridge. `DELETE /api/workspaces/:id` awaits
  `disposeLanguageServersForWorkspace(id)` before broadcasting the topology
  change, so a removed workspace never leaves a process rooted in its directory.
  The unregister returned by `setActiveLanguageServerManager` is identity
  checked — a late call from a disposed manager must not clear a newer one.

## Clients

- `packages/coc-client/src/domains/language-servers.ts` — `LanguageServersClient`
  (`get`/`replace`/`update`, exposed as `client.languageServers`) plus
  `parseLanguageServerRejection`, which unpacks a `400` into `errors[].field`
  and the echoed last-valid `config`. The contract mirror lives in
  `packages/coc-client/src/contracts/language-servers.ts`; `packages/coc`
  typechecks against coc-client's built `dist`, so a contract change needs
  `npm run build` in `packages/coc-client`.
- `src/server/spa/client/react/features/language-servers/languageServersApi.ts`
  — routes every call through `getCocClientForWorkspace`, so configuration is
  read and written on the host that owns the files.
- `src/server/spa/client/react/features/language-servers/languageServerClient.ts`
  keys clients by concrete clone route, workspace, and editing session. A direct
  remote clone key resolves the socket origin while the query keeps the owning
  host's workspace id. Clone-registry subscriptions replace a live or pending
  socket when an effective URL appears or changes; an unresolved concrete remote
  route settles as `remote-route-unavailable` and never opens on the page origin.
  `detectLanguageTransportBlock` is also the container gate: an explicitly local
  clone behind the agent proxy settles as `container-unsupported`, while a routed
  remote clone connects directly to its own CoC host.
- `src/server/spa/client/react/features/language-servers/LanguageServersPanel.tsx`
  — the repo Settings tab's `language-servers` section: master enable toggle,
  the `effective` list with a per-definition enable checkbox, and an editor for
  custom definitions. Enabling or editing a preset writes an override keyed on
  its id; only stored non-preset definitions can be removed. A rejected write
  keeps the editor open, attaches `errors[].field` messages to their inputs, and
  restores the echoed last-valid config.

## Tests

- `node scripts/run-vitest.mjs test/server/language-servers` from `packages/coc`.
  `test/server/language-servers/fixtures/echo-language-server.mjs` is a
  deterministic non-TypeScript server speaking real LSP framing over stdio.
  The connection and session suites spawn it, which proves the runtime carries
  no TypeScript-specific routing. It answers `getInit` with the received
  `initialize` params and its working directory, answers `ask` by sending an
  arbitrary server-to-client request and returning the client's reply or error,
  and dies on `crash` for restart-backoff tests. Add generic protocol coverage there, not against
  a real `tsserver`. `typescript-integration.test.ts` is the one suite that does
  run the real server: it builds a temporary project with a `tsconfig.json`, a
  path alias, a cross-file import and an installed dependency type, then asks
  each shipped feature a question only a working TypeScript service can answer,
  including one about a buffer that was never written to disk. Put TypeScript
  project-understanding coverage there and nothing else. That server sends no
  `serverInfo`, so `state.serverName` is undefined for it and the user is shown
  `displayName` and `runtime` instead. The bridge suite drives a real WebSocket against a real
  manager and that fixture, so it covers upgrade scoping, URI refusal, and
  cancellation end to end. `infrastructure.test.ts` starts a real
  `createExecutionServer` and checks the production wiring: the served
  `/ws/language-server` path, workspace deletion detaching documents, and
  shutdown unpublishing the manager.
- `node scripts/run-vitest.mjs --environment jsdom test/spa/react/language-servers`
  from `packages/coc`.
- `npm run test:run` from `packages/coc-client`.

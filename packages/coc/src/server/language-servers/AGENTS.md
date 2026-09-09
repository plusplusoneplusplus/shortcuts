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
- `attach()` returns a release function. The process stops
  `idleTimeoutMs` after the last reference releases; an unexpected exit while
  references remain restarts with doubling backoff up to `maxRestarts`, then
  settles on `failed` until `restart()` clears the budget. Process `exit` and
  `error` handlers are bound per child, so a previous process's late exit never
  disposes its successor's connection.
- `onNotification`, `onRequest`, and `onReady` handlers are re-registered on
  every new connection, so a caller subscribes once and keeps receiving
  diagnostics across restarts. `onReady` is where the document layer replays
  open buffers before resuming queries. `sendRequest` starts the server on
  demand.

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
  `initialize` params and its working directory, and dies on `crash` for
  restart-backoff tests. Add generic protocol coverage there, not against
  a real `tsserver`.
- `node scripts/run-vitest.mjs --environment jsdom test/spa/react/language-servers`
  from `packages/coc`.
- `npm run test:run` from `packages/coc-client`.

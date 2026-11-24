# Language Servers

Language-neutral LSP host. Language behavior stays inside a definition and its adapter.

## Surface

- `types.ts`, `definition-schema.ts`, `file-match.ts`, `file-identity.ts`, `selection.ts`, `presets.ts`, `detection.ts`, `prime-document.ts` — definition, globs, filesystem identity, ordering, presets, detection, priming search.
- `adapters.ts` plus `typescript-adapter.ts`, `rust-adapter.ts`, `python-adapter.ts`, `clangd-adapter.ts`, `symbols-adapter.ts` — the only language branches. Each may rewrite `command`, `args`, and `initializationOptions` and returns `runtimeLabel` plus `commandLabel`.
- `jsonrpc.ts`, `connection.ts`, `session.ts`, `manager.ts`, `client-requests.ts` — framing, stdio session, process manager, server-to-client answers.
- `routes.ts`, `repository.ts` — `GET`/`PUT`/`PATCH /api/workspaces/:id/language-servers`. Config is `language-servers.json` under `getRepoDataPath`.
- `search-paths.ts` — validates workspace `searchPaths` and builds the effective environment (`buildLanguageServerEnv`).
- `uri-mapping.ts`, `ws-bridge.ts`, `external-sources.ts` — browser `coc-file://` mapping, `/ws/language-server`, and `coc-lsp-external://` grants.
- SPA client: `features/language-servers/`. Settings UI: `LanguageServersPanel.tsx`. coc-client: `client.languageServers`.

## Rules

- Definitions have no enable flag. Reads strip saved enable fields. A preset override keeps `builtIn: true` and cannot delete the preset.
- `command` is an executable and `args` is a vector. Validation rejects shell metacharacters. Ids are slug-safe.
- `coc-symbols` shares clangd's C-family patterns at lower priority. Both attach. Clangd locations win. The index answers only when clangd is unavailable, fails, or returns nothing.
- Selection ignores input order. Only configuration is persisted. Responses expose `effective` and `startable` and omit host paths.
- One field error aborts the whole write. A corrupt file falls back to built-ins and is left on disk.
- Framing is byte-oriented `Content-Length`. Declared length above `maxMessageBytes` is refused. Spawn uses `shell: false`.
- Status: `disabled`, `unavailable`, `starting`, `indexing`, `ready`, `reconnecting`, `failed`. A missing executable is `unavailable`, with a path-free install hint. `generation` counts successful handshakes and only increases.
- `primeDocument` runs before `workspace/symbol` only while the editor has nothing open. TypeScript is the only language that supplies one.
- `attach()` returns a release. Idle stop is `idleTimeoutMs` after the last release. Crash restarts with backoff up to `maxRestarts`. `stop()` waits for exit, then signal, then SIGKILL after `killGraceMs` (2s). Those kill timers stay referenced. `start()` during `stop()` waits.
- Advertise only implemented capabilities (`DEFAULT_CLIENT_CAPABILITIES`). Dynamic registrations reset on every handshake. `$/progress` moves a session between `indexing` and `ready` and pauses ordinary request deadlines. `shutdown` and abort signals stay active.
- Sessions key on workspace, editing session, definition, and resolved root. A second editing session on the same path gets its own process. `maxSessions` defaults to 24 and `maxSessionsPerWorkspace` to 8. Caps evict the least recently used unreferenced session, or fail `capacity` when every session is referenced. Lowering a cap does not close live sessions.
- Config replacement fingerprints command, args, initialization options, settings, and language ids. `dispose` refuses later acquires and awaits children. Workspace delete awaits `disposeLanguageServersForWorkspace` first. `setActiveLanguageServerManager` unregister is identity-checked.
- `searchPaths` are absolute folders or `~` paths for the owning host, one per entry, validated with that platform's rules. They go before the inherited PATH (key spelling kept, missing PATH allowed) as `deps.env` for every adapter PATH lookup and `rustup which`, and as the spawn `env`, so child tools such as cargo resolve too. No paths means `env` stays undefined and the process inherits. Search paths are part of every session fingerprint, so saving them replaces the workspace's sessions. Env values never reach a browser payload.
- An adapter claims a preset only while it still points at its own command. Resolved paths go into the spawn definition, never a browser payload. TypeScript and Pyright run as `node <entry> --stdio`, never a `.bin` shim. Rust uses `rustup which rust-analyzer` from the project root. Clangd prefers PATH, then known LLVM prefixes. `coc-symbols-lsp` receives `--database` for this workspace's `symbol-index.sqlite`.
- Browser URI is `coc-file://<workspaceId>/<relative>`. `toServerUri` rejects another scheme, another workspace, and path escape. External targets become `coc-lsp-external://<capability>/<basename>` only for definition-family results that name a readable regular file. The browser sends the opaque id, never a path. Re-canonicalize before read. NUL means binary. Diagnostics for out-of-workspace `file:` URIs are dropped.
- Socket messages are `lsp-attach`, `lsp-attach-workspace`, `lsp-detach`, `lsp-request`, `lsp-cancel`, `lsp-notify`, `lsp-restart`, `lsp-external-source`, `lsp-external-semantic-tokens`, `ping`, and the matching server replies. Attaching a document starts its session. `lsp-attached` is sent before handshake. Restart is coalesced per session and keeps the attachment.
- Browser clients key by concrete clone route, workspace, and editing session. An unresolved remote route is `remote-route-unavailable` and never opens on the page origin. An explicitly local clone behind the agent proxy is `container-unsupported`.
- Contract changes in coc-client require `npm run build` in `packages/coc-client` before `packages/coc` typechecks.

## Tests

From `packages/coc`:

- `node scripts/run-vitest.mjs test/server/language-servers`
- `node scripts/run-vitest.mjs --environment jsdom test/spa/react/language-servers`
- `npm run test:e2e -- test/e2e/explorer-lsp.spec.ts`

`typescript-integration.test.ts`, `rust-integration.test.ts`, and `python-integration.test.ts` hard-fail when the real server is missing. `clangd-integration.test.ts` skips when clangd is absent. Generic protocol coverage uses `fixtures/echo-language-server.mjs`, not tsserver. `teardown.test.ts` watches real pids.

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
- `node scripts/run-vitest.mjs --environment jsdom test/spa/react/language-servers`
  from `packages/coc`.
- `npm run test:run` from `packages/coc-client`.

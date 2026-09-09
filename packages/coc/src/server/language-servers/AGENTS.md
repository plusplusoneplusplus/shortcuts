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
- A write validates everything first; one field-level error aborts the whole
  write so the last valid configuration stays on disk. A corrupt file on read
  falls back to disabled rather than starting an unconfigured server.

## Tests

`node scripts/run-vitest.mjs test/server/language-servers` from `packages/coc`.

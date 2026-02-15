---
status: pending
---

# 002: Extract Related-Items-Loader to Pipeline-Core

## Summary
Move the `related-items-loader.ts` module (YAML-based related-items CRUD for task folders) from the VS Code extension into `packages/pipeline-core/src/tasks/`, replacing the extension logger with pipeline-core's pluggable `getLogger()`, and re-export everything from the extension via a thin proxy.

## Motivation
`related-items-loader.ts` has zero VS Code dependencies — it only uses `fs`, `path`, `js-yaml`, and the extension logger. Extracting it to pipeline-core makes it available to the `coc` CLI, `deep-wiki`, and any other Node.js consumer. This is the natural second commit after the types extraction (001) because every function in this module operates on the `RelatedItem` / `RelatedItemsConfig` types extracted there.

## Changes

### Files to Create

- **`packages/pipeline-core/src/tasks/related-items-loader.ts`** — Near-verbatim copy of `src/shortcuts/tasks-viewer/related-items-loader.ts` with these adaptations:
  - Import `RelatedItem`, `RelatedItemsConfig` from `./types` (the pipeline-core types extracted in 001).
  - Replace `import { getExtensionLogger, LogCategory } from '../shared/extension-logger'` with `import { getLogger, LogCategory } from '../logger'`.
  - In the `loadRelatedItems` catch block, call `getLogger().error(LogCategory.GENERAL, ...)` instead of `getExtensionLogger().error(LogCategory.TASKS, ...)`. Use `LogCategory.GENERAL` (or add a new `TASKS` member to pipeline-core's `LogCategory` enum — see Implementation Notes).
  - The `error()` signature in pipeline-core's `Logger` is `error(category: string, message: string, error?: Error)` — it does **not** accept a trailing metadata object. Fold the `{ folderPath }` metadata into the message string (e.g., `` `Error loading related items from ${folderPath}` ``).
  - All eight exported symbols stay exported: `RELATED_ITEMS_FILENAME`, `loadRelatedItems`, `saveRelatedItems`, `hasRelatedItems`, `deleteRelatedItems`, `removeRelatedItem`, `mergeRelatedItems`, `getRelatedItemsPath`, `categorizeItem`.
  - The private helper `generateYamlContent` remains a non-exported function in this file.

- **`packages/pipeline-core/src/tasks/index.ts`** — Barrel file that re-exports everything from `./types` (commit 001) and `./related-items-loader`.

### Files to Modify

- **`packages/pipeline-core/src/logger.ts`** — Add `TASKS = 'Tasks'` to the `LogCategory` enum so task-related logging has a dedicated category (keeps parity with the extension's `LogCategory.TASKS`). This is a backward-compatible addition.

- **`packages/pipeline-core/src/index.ts`** — Add a new `// Tasks` section that re-exports all public symbols from `./tasks/index`:
  ```ts
  // ============================================================================
  // Tasks
  // ============================================================================
  export {
      // Types (from 001)
      RelatedItem,
      RelatedItemsConfig,
      RelatedItemCategory,
      RelatedItemType,
      // Related-items-loader
      RELATED_ITEMS_FILENAME,
      loadRelatedItems,
      saveRelatedItems,
      hasRelatedItems,
      deleteRelatedItems,
      removeRelatedItem,
      mergeRelatedItems,
      getRelatedItemsPath,
      categorizeItem,
  } from './tasks';
  ```

- **`src/shortcuts/tasks-viewer/related-items-loader.ts`** — Gut the implementation and replace with a thin re-export proxy:
  ```ts
  /**
   * Related Items Loader — re-exported from pipeline-core
   */
  export {
      RELATED_ITEMS_FILENAME,
      loadRelatedItems,
      saveRelatedItems,
      hasRelatedItems,
      deleteRelatedItems,
      removeRelatedItem,
      mergeRelatedItems,
      getRelatedItemsPath,
      categorizeItem,
  } from '@plusplusoneplusplus/pipeline-core';
  ```
  All existing extension consumers (`task-manager.ts`, `discovery-commands.ts`, `ai-task-commands.ts`, `discovery-preview-provider.ts`, `index.ts`, test files) continue to import from the same path — no changes needed in those files.

### Files to Delete
(none)

## Implementation Notes

1. **Logger signature mismatch** — The extension logger's `error()` accepts `(category, message, error, metadata)`, but pipeline-core's `Logger.error()` only accepts `(category, message, error?)`. Fold metadata into the message string rather than changing the `Logger` interface. Example:
   ```ts
   logger.error(LogCategory.TASKS, `Error loading related items from ${folderPath}`, error instanceof Error ? error : new Error(String(error)));
   ```

2. **LogCategory.TASKS** — Pipeline-core's `LogCategory` enum currently has: `AI`, `MAP_REDUCE`, `PIPELINE`, `UTILS`, `GENERAL`. Adding `TASKS = 'Tasks'` is non-breaking and keeps semantic parity with the extension. All existing `LogCategory` consumers are unaffected.

3. **`js-yaml` dependency** — Already present in pipeline-core's `package.json` (`"js-yaml": "^4.1.0"`), no dependency changes needed.

4. **Path module** — Use Node.js `path` and `fs` directly (same as current code). Pipeline-core is a pure Node.js package, so these are available.

5. **Re-export strategy** — The extension's `related-items-loader.ts` becomes a pure re-export barrel. This preserves all existing import paths in the extension codebase (6 consumers) without any changes to those files.

6. **`categorizeItem` function** — This is imported by `discovery-preview-provider.ts` outside the tasks-viewer directory. The re-export proxy ensures this continues to work.

## Tests

- **`packages/pipeline-core/test/tasks/related-items-loader.test.ts`** — New Vitest test file covering:
  - `loadRelatedItems`: returns undefined for missing file; parses valid YAML; returns undefined for invalid YAML; initializes empty items array when `items` is missing; logs error on read failure.
  - `saveRelatedItems`: writes YAML with header comment; sets `lastUpdated` timestamp; creates file in correct location.
  - `hasRelatedItems`: returns true when file exists; returns false when file absent.
  - `deleteRelatedItems`: removes file; no-ops when file doesn't exist.
  - `removeRelatedItem`: removes file-type item by path; removes commit-type item by hash; returns false when item not found; returns false when no config exists.
  - `mergeRelatedItems`: creates new config when none exists; deduplicates files by path; deduplicates commits by hash; updates description when provided; preserves existing items.
  - `getRelatedItemsPath`: returns correct joined path.
  - `categorizeItem`: classifies test files (`.test.`, `.spec.`, `_test.`, `/test/`, `/__tests__/`); classifies docs (`.md`, `.txt`, `/docs/`); classifies config files (`package.json`, `.eslintrc`, `.yaml`); defaults to `source`.
  - `generateYamlContent` (tested indirectly via `saveRelatedItems`): output starts with `# Auto-generated by AI Discovery` header.
  - All tests use a temp directory (`fs.mkdtempSync`) cleaned up in `afterEach`.

- **Existing extension tests** (`src/test/suite/tasks-related-items.test.ts`) — Must continue to pass unchanged, confirming the re-export proxy works correctly.

## Acceptance Criteria
- [ ] `packages/pipeline-core/src/tasks/related-items-loader.ts` exists with all 9 exported symbols
- [ ] `packages/pipeline-core/src/tasks/index.ts` barrel re-exports types (001) and related-items-loader
- [ ] `LogCategory.TASKS` added to pipeline-core's `LogCategory` enum
- [ ] `packages/pipeline-core/src/index.ts` re-exports all tasks symbols
- [ ] `src/shortcuts/tasks-viewer/related-items-loader.ts` is a thin re-export from `@plusplusoneplusplus/pipeline-core`
- [ ] No changes needed in any consumer file (task-manager, discovery-commands, ai-task-commands, discovery-preview-provider, tests)
- [ ] New Vitest tests pass: `cd packages/pipeline-core && npm run test:run`
- [ ] Existing extension tests pass: `npm run compile-tests` (the re-export proxy compiles cleanly)
- [ ] `npm run compile` succeeds (webpack build)

## Dependencies
- Depends on: 001 (types extraction — `RelatedItem`, `RelatedItemsConfig`, `RelatedItemCategory`, `RelatedItemType` must exist in `packages/pipeline-core/src/tasks/types.ts`)

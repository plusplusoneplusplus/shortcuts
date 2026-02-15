---
status: pending
---

# 001: Extract Task Types and Parsing Utilities to Pipeline-Core

## Summary

Extract the pure TypeScript types from `src/shortcuts/tasks-viewer/types.ts` and the standalone frontmatter/filename parsing functions from `src/shortcuts/tasks-viewer/task-manager.ts` into a new `packages/pipeline-core/src/tasks/` module, exposing them via a `"./tasks"` subpath export.

## Motivation

The task types (`Task`, `TaskDocument`, `TaskDocumentGroup`, `TaskFolder`, `TaskStatus`, etc.) and the parsing utilities (`parseTaskStatus`, `updateTaskStatus`, `parseFileName`, `sanitizeFileName`) have **zero VS Code dependencies**. They are pure TypeScript operating on filesystem paths and YAML frontmatter. Extracting them to `pipeline-core` allows the `coc` CLI and `deep-wiki` packages to consume task data without pulling in VS Code APIs. This commit is isolated so it can be reviewed and tested independently before the follow-up commit that re-exports from the extension.

## Changes

### Files to Create

- `packages/pipeline-core/src/tasks/index.ts` — Barrel file re-exporting all public types and functions from the module.

- `packages/pipeline-core/src/tasks/types.ts` — All 17 type/interface definitions copied verbatim from `src/shortcuts/tasks-viewer/types.ts`:
  - `Task`
  - `TaskDocument`
  - `TaskDocumentGroup`
  - `TaskSortBy`
  - `TaskStatus`
  - `TaskFolder`
  - `TasksViewerSettings`
  - `DiscoverySettings`
  - `DiscoveryDefaultScope`
  - `RelatedItemCategory`
  - `RelatedItemType`
  - `RelatedItem`
  - `RelatedItemsConfig`
  - `TaskCreationMode`
  - `TaskGenerationDepth`
  - `AITaskCreateOptions`
  - `AITaskFromFeatureOptions`
  - `AITaskCreationOptions`
  - `AITaskDialogResult`
  - `FeatureContext`
  - `ReviewStatus`
  - `ReviewStatusRecord`
  - `ReviewStatusStore`

- `packages/pipeline-core/src/tasks/task-parser.ts` — Four standalone functions extracted from `task-manager.ts`:
  1. `parseTaskStatus(filePath: string): TaskStatus | undefined` (lines 18–55) — Reads a markdown file synchronously, extracts YAML frontmatter, and returns the `status` field if it is a valid `TaskStatus`. Currently uses `fs.readFileSync` and `js-yaml`. Import `yaml` from `js-yaml` (already a `pipeline-core` dependency).
  2. `updateTaskStatus(filePath: string, status: TaskStatus): Promise<void>` (lines 63–98) — Reads a markdown file, updates or creates YAML frontmatter with the new status, and writes it back. Uses `fs.readFileSync`, `fs.promises.writeFile`, and `js-yaml`.
  3. `parseFileName(fileName: string): { baseName: string; docType?: string }` (lines 767–794) — Pure string parsing: strips `.md` extension, checks if the last dot-separated segment is a known doc-type suffix (plan, spec, test, notes, etc.), and returns `{ baseName, docType }`. No I/O, no dependencies.
  4. `sanitizeFileName(name: string): string` (lines 1197–1205) — Pure regex transformations: replaces invalid filename characters (`<>:"/\|?*`) and whitespace with hyphens, collapses consecutive hyphens, trims leading/trailing hyphens. No I/O, no dependencies.

  Additionally, export the `VALID_TASK_STATUSES` constant (`['pending', 'in-progress', 'done', 'future']`, line 11) and the `COMMON_DOC_TYPES` array (currently inline in `parseFileName`, lines 777–782) as named exports for downstream consumers.

### Files to Modify

- `packages/pipeline-core/src/index.ts` — Add a new `// Tasks` section at the bottom that re-exports all public symbols from `./tasks`:
  ```typescript
  // ============================================================================
  // Tasks
  // ============================================================================
  export {
      // Types
      Task, TaskDocument, TaskDocumentGroup, TaskSortBy, TaskStatus,
      TaskFolder, TasksViewerSettings, DiscoverySettings, DiscoveryDefaultScope,
      RelatedItemCategory, RelatedItemType, RelatedItem, RelatedItemsConfig,
      TaskCreationMode, TaskGenerationDepth,
      AITaskCreateOptions, AITaskFromFeatureOptions, AITaskCreationOptions,
      AITaskDialogResult, FeatureContext,
      ReviewStatus, ReviewStatusRecord, ReviewStatusStore,
      // Parser utilities
      VALID_TASK_STATUSES, COMMON_DOC_TYPES,
      parseTaskStatus, updateTaskStatus, parseFileName, sanitizeFileName,
  } from './tasks';
  ```

- `packages/pipeline-core/package.json` — Add subpath export entry:
  ```json
  "./tasks": "./dist/tasks/index.js"
  ```

### Files to Delete

(none)

## Implementation Notes

1. **js-yaml is already a dependency** of `pipeline-core` (`"js-yaml": "^4.1.0"` in `package.json`), so `parseTaskStatus` and `updateTaskStatus` can import it directly — no new dependency needed.

2. **Extract `COMMON_DOC_TYPES` as a constant.** In the source `task-manager.ts`, the doc-type list is an inline array inside `parseFileName`. Extract it to a module-level exported constant so both the parser and downstream consumers can reference it.

3. **Keep functions as free functions, not class methods.** In the source, `parseFileName` and `sanitizeFileName` are instance methods on `TaskManager` but they use no instance state (`this`). Extract them as plain exported functions with identical signatures.

4. **Follow existing pipeline-core conventions:**
   - `types.ts` for interfaces/type aliases (see `pipeline/types.ts`, `map-reduce/types.ts`)
   - Barrel `index.ts` re-exporting everything
   - Subpath export in `package.json` `"exports"` field
   - CommonJS module format (`"module": "commonjs"` in tsconfig)

5. **No VS Code imports.** Double-check that none of the extracted code references `vscode` — all four functions and all types are VS Code-free.

6. **`fs` usage is acceptable.** `pipeline-core` already uses Node.js `fs` in its utils module (`safeReadFile`, `safeWriteFile`, etc.). The `parseTaskStatus`/`updateTaskStatus` functions use raw `fs` calls which is consistent.

7. **Do NOT modify `src/shortcuts/tasks-viewer/` in this commit.** Re-pointing the extension imports to consume from `pipeline-core` is a separate follow-up commit to keep this one small and independently testable.

## Tests

- `packages/pipeline-core/test/tasks/task-parser.test.ts`:
  - **parseTaskStatus:** Test with valid frontmatter (`status: pending`, `status: in-progress`, `status: done`, `status: future`), missing frontmatter, malformed YAML, invalid status value, empty file, file without closing `---`, non-existent file path.
  - **updateTaskStatus:** Test updating existing frontmatter status, adding frontmatter to a file without it, preserving other frontmatter fields (e.g., `title`), preserving body content after frontmatter.
  - **parseFileName:** Test `"task1.md"` → `{ baseName: "task1" }`, `"task1.plan.md"` → `{ baseName: "task1", docType: "plan" }`, `"task1.test.spec.md"` → `{ baseName: "task1.test", docType: "spec" }`, version suffixes like `"task.v2.md"` → `{ baseName: "task", docType: "v2" }`, names with no doc type like `"my-feature.md"`.
  - **sanitizeFileName:** Test replacing `<>:"/\|?*` with hyphens, collapsing whitespace, collapsing consecutive hyphens, trimming leading/trailing hyphens, passthrough of clean names.

- `packages/pipeline-core/test/tasks/types.test.ts`:
  - Compile-time type assertion tests (e.g., `const s: TaskStatus = 'pending'` compiles, ensures type exports work).
  - Verify `VALID_TASK_STATUSES` and `COMMON_DOC_TYPES` arrays contain expected values.

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/tasks/types.ts` contains all 23 type/interface exports matching the source
- [ ] `packages/pipeline-core/src/tasks/task-parser.ts` exports `parseTaskStatus`, `updateTaskStatus`, `parseFileName`, `sanitizeFileName`, `VALID_TASK_STATUSES`, and `COMMON_DOC_TYPES`
- [ ] `packages/pipeline-core/src/tasks/index.ts` barrel re-exports all public symbols
- [ ] `packages/pipeline-core/package.json` has `"./tasks": "./dist/tasks/index.js"` in exports
- [ ] `packages/pipeline-core/src/index.ts` re-exports the tasks module
- [ ] `npm run build` in `packages/pipeline-core/` succeeds with no errors
- [ ] All new Vitest tests pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] Existing pipeline-core tests still pass (no regressions)
- [ ] No `vscode` import appears anywhere in `packages/pipeline-core/src/tasks/`
- [ ] Extension build (`npm run compile` at root) still succeeds (no changes to extension source in this commit)

## Dependencies

- Depends on: None (this is the first commit in the task-integration series)

---
status: pending
---

# 003: Extract Task Scanning and Grouping Logic to Pipeline-Core

## Summary

Extract the recursive directory scanning, document parsing, document grouping, and folder hierarchy construction logic from `TaskManager` into a standalone `task-scanner.ts` module in `pipeline-core`, producing pure Node.js functions with no VS Code dependencies.

## Motivation

The scanning/grouping logic is pure Node.js (fs + path) and represents the core algorithmic work of the tasks system — recursively walking directories, classifying markdown files via `parseFileName`, grouping documents by `baseName|archived|relativePath` key, and building a nested `TaskFolder` tree. Extracting it into `pipeline-core` enables reuse in the `coc` CLI and other non-VS-Code consumers, and keeps `TaskManager` focused on VS Code integration (settings, file watchers, commands).

## Changes

### Files to Create

- `packages/pipeline-core/src/tasks/task-scanner.ts` — Contains the following exported functions:
  - `scanTasksRecursively(dirPath: string, relativePath: string, isArchived: boolean): Task[]` — Recursively walks `dirPath`, skips `archive` folder when `!isArchived`, calls `safeReadDir`/`safeStats` from pipeline-core's own utils, calls `parseTaskStatus` (from commit 001) on each `.md` file, returns flat `Task[]` array. Port of `TaskManager.scanTasksRecursively`.
  - `scanDocumentsRecursively(dirPath: string, relativePath: string, isArchived: boolean): TaskDocument[]` — Same recursive walk but produces `TaskDocument[]` by additionally calling `parseFileName` (from commit 001) to extract `baseName` and `docType`. Port of `TaskManager.scanDocumentsRecursively`.
  - `scanFoldersRecursively(dirPath: string, relativePath: string, isArchived: boolean, folderMap: Map<string, TaskFolder>, parentFolder: TaskFolder): void` — Builds the directory tree into `folderMap` and `parentFolder.children`. Port of `TaskManager.scanFoldersRecursively`.
  - `groupTaskDocuments(documents: TaskDocument[]): { groups: TaskDocumentGroup[]; singles: TaskDocument[] }` — Groups documents by `baseName|archived|relativePath` composite key. Documents sharing a key with count > 1 become a `TaskDocumentGroup`; singletons go to `singles`. Port of the grouping logic in `TaskManager.getTaskDocumentGroups`.
  - `buildTaskFolderHierarchy(rootPath: string, documents: TaskDocument[], groups: TaskDocumentGroup[], singles: TaskDocument[], scanArchive: boolean, archivePath?: string): TaskFolder` — Constructs the root `TaskFolder`, calls `scanFoldersRecursively` for active and (optionally) archive directories, ensures intermediate folder nodes exist for every document's `relativePath`, then assigns groups and singles to their folders. Port of `TaskManager.getTaskFolderHierarchy` minus `loadRelatedItemsForFolders` (VS Code / discovery concern, stays in extension).

### Files to Modify

- `packages/pipeline-core/src/tasks/index.ts` (created in commit 001) — Add re-exports for all five new functions from `task-scanner.ts`.
- `packages/pipeline-core/src/index.ts` — Ensure `tasks` module barrel is already re-exported (should be done in commit 001; verify only).
- `src/shortcuts/tasks-viewer/task-manager.ts` — Replace the five private/public method bodies with thin wrappers that delegate to the extracted `pipeline-core` functions:
  - `scanTasksRecursively` → call `scanTasksRecursively` from pipeline-core.
  - `scanDocumentsRecursively` → call `scanDocumentsRecursively` from pipeline-core.
  - `scanFoldersRecursively` → call `scanFoldersRecursively` from pipeline-core.
  - `getTaskDocumentGroups` → call `getTaskDocuments()` then `groupTaskDocuments()` from pipeline-core.
  - `getTaskFolderHierarchy` → call `getTaskDocumentGroups()` then `buildTaskFolderHierarchy()` from pipeline-core, then append `loadRelatedItemsForFolders` call (discovery logic stays in extension).
  - Update import to pull functions from `@plusplusoneplusplus/pipeline-core`.
  - `parseFileName` method on `TaskManager` stays as a thin delegate to the pipeline-core `parseFileName` (already extracted in commit 001); no further change needed unless not yet delegating.

### Files to Delete

(none)

## Implementation Notes

1. **Dependencies on commit 001:** The scanner functions import `parseFileName` and `parseTaskStatus` from the sibling `task-parser.ts` module (created in commit 001). They also import `Task`, `TaskDocument`, `TaskDocumentGroup`, `TaskFolder`, `TaskStatus` types from `task-types.ts` (commit 001), and `safeReadDir`, `safeStats`, `safeExists` from pipeline-core's existing `utils` module.

2. **`archive` folder convention:** All three scan functions hardcode `const archiveFolderName = 'archive'` and skip it when `!isArchived`. Preserve this as-is; do not make it configurable in this commit.

3. **Path separator handling:** The original code uses `path.join` and `path.sep` for cross-platform support. The extracted functions must continue to use Node.js `path` module — no hardcoded `/` separators.

4. **No VS Code imports:** The new module must not import `vscode`. The `TaskManager` wrapper handles all VS Code specifics (settings via `getSettings()`, file watchers, `loadRelatedItemsForFolders`).

5. **`buildTaskFolderHierarchy` omits `relatedItems` loading:** The original `getTaskFolderHierarchy` calls `this.loadRelatedItemsForFolders(folderMap)` at the end. This depends on discovery settings and `loadRelatedItems` from the extension's `related-items-loader.ts`. That call stays in `TaskManager.getTaskFolderHierarchy` after the delegated `buildTaskFolderHierarchy` returns.

6. **Grouping key format:** The composite key `${baseName}|${isArchived ? 'archived' : 'active'}|${relativePath}` must be preserved exactly to maintain backward compatibility.

7. **`buildTaskFolderHierarchy` signature design:** Accept pre-computed `groups` and `singles` rather than raw documents to avoid duplicating the grouping call. The caller (`TaskManager`) calls `groupTaskDocuments` first, then passes both outputs. Alternatively, accept just `documents` and call `groupTaskDocuments` internally — prefer the latter for a cleaner API, with the function calling `groupTaskDocuments` itself.

8. **Return type of `buildTaskFolderHierarchy`:** Returns a `TaskFolder` (the root). The `folderMap` is internal. If callers need the map (e.g., for `loadRelatedItemsForFolders`), expose it via an optional output parameter or return `{ root: TaskFolder, folderMap: Map<string, TaskFolder> }`. Choose the tuple return to support the extension's post-processing.

## Tests

- **`packages/pipeline-core/test/tasks/task-scanner.test.ts`** — Vitest tests covering:
  - `scanTasksRecursively`: empty directory returns `[]`; flat directory with `.md` files; nested subdirectories; skips `archive` folder when `isArchived=false`; includes `archive` contents when `isArchived=true`; non-`.md` files are ignored; handles unreadable directories gracefully; sets `relativePath` correctly for nested files.
  - `scanDocumentsRecursively`: same directory scenarios as above; additionally verifies `baseName` and `docType` are set via `parseFileName`; verifies `status` is parsed from frontmatter.
  - `scanFoldersRecursively`: builds correct parent-child relationships; populates `folderMap`; skips archive when appropriate; handles empty directories; handles deeply nested folders (3+ levels).
  - `groupTaskDocuments`: single document returns as single; two documents with same baseName+relativePath+archived grouped; different relativePaths not grouped; different archive status not grouped; `latestModifiedTime` is the max across group members.
  - `buildTaskFolderHierarchy`: root folder has correct structure; documents placed in correct folders; intermediate folders auto-created; archive scanning optional; empty folders included from directory scan; returns usable `folderMap` for post-processing.

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/tasks/task-scanner.ts` exports all five functions with no `vscode` import
- [ ] All functions use `safeReadDir`, `safeStats`, `safeExists` from pipeline-core's utils (not from `fs` directly for error-safe operations)
- [ ] `parseFileName` and `parseTaskStatus` are imported from the sibling `task-parser.ts` (commit 001), not duplicated
- [ ] `groupTaskDocuments` uses the exact composite key format `${baseName}|${archived/active}|${relativePath}`
- [ ] `buildTaskFolderHierarchy` returns both root `TaskFolder` and `folderMap` so the extension can post-process (e.g., load related items)
- [ ] `TaskManager` methods delegate to pipeline-core functions; no logic duplication remains in the extension
- [ ] `TaskManager.getTaskFolderHierarchy` still calls `loadRelatedItemsForFolders` after delegation
- [ ] All existing extension tests (`npm test`) continue to pass
- [ ] New Vitest tests in `packages/pipeline-core/test/tasks/task-scanner.test.ts` pass with `npm run test:run`
- [ ] Cross-platform path handling preserved (no hardcoded `/` separators)

## Dependencies

- Depends on: 001 (types, `parseFileName`, `parseTaskStatus` must exist in pipeline-core first)

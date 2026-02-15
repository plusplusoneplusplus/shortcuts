---
status: pending
---

# 004: Extract Task CRUD Operations to Pipeline-Core

## Summary

Extract all pure-Node.js task CRUD operations (create, rename, delete, archive, unarchive, move, import) and helper methods from `TaskManager` in the VS Code extension into a standalone `task-operations.ts` module in `pipeline-core`, then re-wire `TaskManager` to delegate to the extracted functions.

## Motivation

`TaskManager` mixes VS Code–specific concerns (settings, file watchers, `vscode.Disposable`) with pure filesystem CRUD operations that have zero VS Code dependencies. Extracting the CRUD layer lets `coc` CLI and other Node.js consumers create, rename, move, archive, and delete tasks without pulling in VS Code APIs. This commit isolates the pure-logic layer so future commits can expose it through CLI commands and REST endpoints.

## Changes

### Files to Create

- **`packages/pipeline-core/src/tasks/task-operations.ts`** — Standalone module containing all extracted functions. Every function takes explicit path arguments (`tasksFolder`, `archiveFolder`, file paths) instead of relying on class state. Functions to export:

  **Create operations:**
  | Function | Signature | Source line(s) |
  |----------|-----------|----------------|
  | `createTask` | `(tasksFolder: string, name: string) => Promise<string>` | L221-236 |
  | `createFeature` | `(tasksFolder: string, name: string) => Promise<string>` | L242-259 |
  | `createSubfolder` | `(parentFolderPath: string, name: string) => Promise<string>` | L267-286 |

  **Rename operations:**
  | Function | Signature | Source line(s) |
  |----------|-----------|----------------|
  | `renameTask` | `(oldPath: string, newName: string) => Promise<string>` | L292-307 |
  | `renameFolder` | `(folderPath: string, newName: string) => Promise<string>` | L315-335 |
  | `renameDocumentGroup` | `(folderPath: string, oldBaseName: string, newBaseName: string) => Promise<string[]>` | L344-403 |
  | `renameDocument` | `(oldPath: string, newBaseName: string) => Promise<string>` | L412-433 |

  **Delete operations:**
  | Function | Signature | Source line(s) |
  |----------|-----------|----------------|
  | `deleteTask` | `(filePath: string) => Promise<void>` | L438-444 |
  | `deleteFolder` | `(folderPath: string) => Promise<void>` | L450-461 |

  **Archive / unarchive operations:**
  | Function | Signature | Source line(s) |
  |----------|-----------|----------------|
  | `archiveTask` | `(filePath: string, tasksFolder: string, archiveFolder: string, preserveStructure?: boolean) => Promise<string>` | L469-509 |
  | `unarchiveTask` | `(filePath: string, tasksFolder: string) => Promise<string>` | L515-533 |
  | `archiveDocument` | `(filePath: string, tasksFolder: string, archiveFolder: string, preserveStructure?: boolean) => Promise<string>` | L541-543 (delegates to `archiveTask`) |
  | `unarchiveDocument` | `(filePath: string, tasksFolder: string) => Promise<string>` | L549-551 (delegates to `unarchiveTask`) |
  | `archiveDocumentGroup` | `(filePaths: string[], tasksFolder: string, archiveFolder: string, preserveStructure?: boolean) => Promise<string[]>` | L559-566 |
  | `unarchiveDocumentGroup` | `(filePaths: string[], tasksFolder: string) => Promise<string[]>` | L573-580 |

  **Move / import operations:**
  | Function | Signature | Source line(s) |
  |----------|-----------|----------------|
  | `moveTask` | `(sourcePath: string, targetFolder: string) => Promise<string>` | L588-616 |
  | `moveFolder` | `(sourceFolderPath: string, targetParentFolder: string) => Promise<string>` | L626-671 |
  | `moveTaskGroup` | `(sourcePaths: string[], targetFolder: string) => Promise<string[]>` | L679-686 |
  | `importTask` | `(sourcePath: string, tasksFolder: string, newName?: string) => Promise<string>` | L1114-1133 |
  | `moveExternalTask` | `(sourcePath: string, tasksFolder: string, targetFolder?: string, newName?: string) => Promise<string>` | L1142-1170 |

  **Helper / query functions:**
  | Function | Signature | Source line(s) |
  |----------|-----------|----------------|
  | `taskExistsInFolder` | `(name: string, tasksFolder: string, folder?: string) => boolean` | L1177-1181 |
  | `taskExists` | `(name: string, tasksFolder: string) => boolean` | L1188-1192 |
  | `sanitizeFileName` | `(name: string) => string` | L1197-1205 |
  | `parseFileName` | `(fileName: string) => { baseName: string; docType?: string }` | L767-794 |

  All functions import only from `pipeline-core` utils (`ensureDirectoryExists`, `safeExists`, `safeRename`, `safeWriteFile`, `safeReadDir`, `safeStats`) plus Node.js built-ins (`fs`, `path`).

- **`packages/pipeline-core/src/tasks/index.ts`** — Barrel file re-exporting everything from `task-operations.ts`.

### Files to Modify

- **`packages/pipeline-core/src/index.ts`** — Add `export * from './tasks'` to expose the new module from the package public API.

- **`src/shortcuts/tasks-viewer/task-manager.ts`** — Replace the method bodies of all 22 extracted methods with one-line delegations to the corresponding imported functions from `@plusplusoneplusplus/pipeline-core`. The class methods remain to preserve the existing VS Code–facing API; they simply forward `this.getTasksFolder()` / `this.getArchiveFolder()` as arguments. The `parseFileName` and `sanitizeFileName` methods become thin wrappers around the imported pure functions.

  Specifically:
  1. Add import: `import { createTask, createFeature, ... } from '@plusplusoneplusplus/pipeline-core'`
  2. Each async method body becomes a one-liner, e.g.:
     ```typescript
     async createTask(name: string): Promise<string> {
         this.ensureFoldersExist();
         return createTask(this.getTasksFolder(), name);
     }
     ```
  3. Remove the now-duplicated logic from each method body.
  4. Keep all VS Code–specific methods (`getSettings`, `watchTasksFolder`, `dispose`, `debounceRefresh`, scan methods, hierarchy methods) untouched in this commit.

### Files to Delete

(none)

## Implementation Notes

1. **Signature design:** Every extracted function takes explicit `tasksFolder` and/or `archiveFolder` string arguments instead of accessing class state. This makes them pure, testable, and usable from `coc` CLI without constructing a `TaskManager` instance.

2. **`ensureFoldersExist` stays in TaskManager:** The `ensureFoldersExist()` call in `createTask`, `createFeature`, `importTask`, `moveExternalTask` is a pre-condition that depends on `getTasksFolder()` and `getArchiveFolder()`. The extracted functions should NOT call `ensureFoldersExist` internally — the caller (either `TaskManager` or `coc` CLI) is responsible for ensuring directories exist before calling. This avoids hidden side effects and keeps the functions composable.

3. **`renameDocumentGroup` needs `parseFileName`:** The extracted `renameDocumentGroup` function calls `parseFileName` internally. Since `parseFileName` is also extracted, there is no circular dependency — both live in the same module.

4. **Name collision with class methods:** The pipeline-core functions should be imported with the module namespace or aliased to avoid shadowing the class methods, e.g. `import * as taskOps from '@plusplusoneplusplus/pipeline-core'` and then `taskOps.createTask(...)`.

5. **`deleteTask` uses `fs.unlinkSync`:** Convert to `fs.promises.unlink` for consistency with the async signature, or add a `safeUnlink` to pipeline-core utils. Either approach is acceptable; prefer `fs.promises.unlink` wrapped in try/catch for consistency with existing safe* patterns.

6. **`deleteFolder` uses `fs.rmSync`:** Similarly, convert to `fs.promises.rm` or wrap in a `safeRmRecursive` utility. This is a minor decision — either inline `fs.promises.rm` or add to pipeline-core utils.

7. **`archiveDocument` / `unarchiveDocument` are trivial delegations:** They simply call `archiveTask` / `unarchiveTask`. In the extracted module, they can be kept as named re-exports or thin wrappers for API clarity.

8. **No VS Code types in pipeline-core:** The extracted module must NOT import `vscode`, `TasksViewerSettings`, `TaskDocument`, `TaskDocumentGroup`, or `TaskFolder` types. It only deals with file paths and names.

## Tests

- **`packages/pipeline-core/test/tasks/task-operations.test.ts`** — Vitest tests covering:
  - `createTask`: creates file with header, throws on duplicate
  - `createFeature`: creates directory + placeholder, throws on duplicate
  - `createSubfolder`: creates subdirectory + placeholder, throws if parent missing
  - `renameTask`: renames file, throws on missing source, throws on collision
  - `renameFolder`: renames directory, validates is-directory, throws on collision
  - `renameDocumentGroup`: renames all files with matching baseName, throws on no match
  - `renameDocument`: renames preserving docType suffix, throws on collision
  - `deleteTask`: removes file, throws on missing
  - `deleteFolder`: removes directory recursively, throws on missing/non-directory
  - `archiveTask`: moves to archive, handles collision with timestamp suffix, preserves structure
  - `unarchiveTask`: moves back to tasks root, handles collision
  - `archiveDocumentGroup` / `unarchiveDocumentGroup`: batch operations
  - `moveTask`: moves file, handles collision with counter suffix, no-op if same location
  - `moveFolder`: moves directory, prevents circular move, handles collision
  - `moveTaskGroup`: batch move
  - `importTask`: copies content (not moves), throws on collision
  - `moveExternalTask`: moves file, validates .md extension, throws on missing
  - `taskExists` / `taskExistsInFolder`: boolean checks
  - `sanitizeFileName`: strips invalid chars, collapses dashes
  - `parseFileName`: extracts baseName and docType from `name.doctype.md` patterns
  - All tests use a temp directory (via `os.tmpdir` + `fs.mkdtemp`) cleaned up in `afterEach`

## Acceptance Criteria

- [ ] `packages/pipeline-core/src/tasks/task-operations.ts` exports all 22 functions listed above
- [ ] `packages/pipeline-core/src/tasks/index.ts` barrel re-exports everything
- [ ] `packages/pipeline-core/src/index.ts` includes `export * from './tasks'`
- [ ] No `vscode` import appears anywhere in `packages/pipeline-core/`
- [ ] `TaskManager` method bodies are replaced with delegations to pipeline-core functions
- [ ] `TaskManager` public API (method names, signatures, return types) is unchanged
- [ ] All existing extension tests pass (`npm test` from root)
- [ ] All pipeline-core Vitest tests pass (`npm run test:run` in `packages/pipeline-core/`)
- [ ] New Vitest test file covers all 22 extracted functions with ≥ 2 cases each
- [ ] `npm run compile` succeeds from root with no type errors

## Dependencies

- Depends on: 001 (pipeline-core tasks directory and barrel setup), 003 (task type definitions in pipeline-core)

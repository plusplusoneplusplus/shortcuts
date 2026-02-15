---
status: pending
---

# 006: Refactor VS Code TaskManager as Thin Adapter

## Summary

Refactor `src/shortcuts/tasks-viewer/task-manager.ts` (1314 lines) into a thin VS Code adapter that delegates all pure file-system/logic operations to the shared `TaskManager` class from `@plusplusoneplusplus/pipeline-core`, keeping only VS Code-specific integration (settings, file watchers, `vscode.Disposable`).

## Motivation

The VS Code TaskManager currently contains ~95% platform-agnostic logic (directory scanning, CRUD, archive/unarchive, document grouping, file-name parsing, folder hierarchy building) alongside ~5% VS Code-specific code (settings via `vscode.workspace.getConfiguration`, file watching via `vscode.FileSystemWatcher`, `vscode.Disposable`). Extracting the pure logic into pipeline-core (done in commit 005) means this file can become a thin adapter, eliminating duplication and enabling the same task management logic to be reused by `coc` and `deep-wiki` packages. This must be a separate commit to isolate the risk — the refactored adapter must preserve the exact same public API so that all 6900+ Mocha tests continue to pass with zero changes to consumers.

## Changes

### Files to Create

(none — this is a pure refactor of existing code)

### Files to Modify

- **`src/shortcuts/tasks-viewer/task-manager.ts`** — The bulk of the change:
  - Import `TaskManager as CoreTaskManager` (or similar alias) from `@plusplusoneplusplus/pipeline-core`
  - Replace the class body: construct a `CoreTaskManager` instance in the constructor, delegate all pure methods to it
  - Keep VS Code-specific code inline:
    - `getSettings()` — reads from `vscode.workspace.getConfiguration('workspaceShortcuts.tasksViewer')` and `workspaceShortcuts.tasksViewer.discovery`; returns `TasksViewerSettings`. This method stays in the adapter because it depends on `vscode.workspace`.
    - `watchTasksFolder(callback)` — creates `vscode.FileSystemWatcher` instances (`vscode.workspace.createFileSystemWatcher`) for `**/*.md` and `**/related.yaml` patterns, plus archive folder watching. Stays in adapter.
    - `dispose()` — disposes watchers and clears debounce timer. Stays in adapter.
    - `disposeWatchers()` (private) — disposes individual `vscode.FileSystemWatcher` instances. Stays in adapter.
    - `debounceRefresh()` (private) — debounced callback invocation (uses `setTimeout`/`clearTimeout`). Stays in adapter (though technically pure, it's coupled to the watcher lifecycle).
  - Delegate the following methods to `CoreTaskManager`:
    - `getTasksFolder()` → `this.core.getTasksFolder(settings)`
    - `getArchiveFolder()` → `this.core.getArchiveFolder(settings)`
    - `ensureFoldersExist()` → `this.core.ensureFoldersExist(settings)`
    - `getTasks()` → `this.core.getTasks(settings)`
    - `createTask(name)` → `this.core.createTask(name, settings)`
    - `createFeature(name)` → `this.core.createFeature(name, settings)`
    - `createSubfolder(parentFolderPath, name)` → `this.core.createSubfolder(parentFolderPath, name)`
    - `renameTask(oldPath, newName)` → `this.core.renameTask(oldPath, newName)`
    - `renameFolder(folderPath, newName)` → `this.core.renameFolder(folderPath, newName)`
    - `renameDocumentGroup(folderPath, oldBaseName, newBaseName)` → `this.core.renameDocumentGroup(folderPath, oldBaseName, newBaseName)`
    - `renameDocument(oldPath, newBaseName)` → `this.core.renameDocument(oldPath, newBaseName)`
    - `deleteTask(filePath)` → `this.core.deleteTask(filePath)`
    - `deleteFolder(folderPath)` → `this.core.deleteFolder(folderPath)`
    - `archiveTask(filePath, preserveStructure?)` → `this.core.archiveTask(filePath, preserveStructure, settings)`
    - `unarchiveTask(filePath)` → `this.core.unarchiveTask(filePath, settings)`
    - `archiveDocument(filePath, preserveStructure?)` → delegates to `archiveTask`
    - `unarchiveDocument(filePath)` → delegates to `unarchiveTask`
    - `archiveDocumentGroup(filePaths, preserveStructure?)` → `this.core.archiveDocumentGroup(filePaths, preserveStructure, settings)`
    - `unarchiveDocumentGroup(filePaths)` → `this.core.unarchiveDocumentGroup(filePaths, settings)`
    - `moveTask(sourcePath, targetFolder)` → `this.core.moveTask(sourcePath, targetFolder)`
    - `moveFolder(sourceFolderPath, targetParentFolder)` → `this.core.moveFolder(sourceFolderPath, targetParentFolder)`
    - `moveTaskGroup(sourcePaths, targetFolder)` → `this.core.moveTaskGroup(sourcePaths, targetFolder)`
    - `getTaskDocuments()` → `this.core.getTaskDocuments(settings)`
    - `getTaskDocumentGroups()` → `this.core.getTaskDocumentGroups(settings)`
    - `getTaskFolderHierarchy()` → `this.core.getTaskFolderHierarchy(settings)`
    - `parseFileName(fileName)` → `this.core.parseFileName(fileName)`
    - `sanitizeFileName(name)` → `this.core.sanitizeFileName(name)`
    - `getWorkspaceRoot()` → `this.core.getWorkspaceRoot()`
    - `importTask(sourcePath, newName?)` → `this.core.importTask(sourcePath, newName, settings)`
    - `moveExternalTask(sourcePath, targetFolder?, newName?)` → `this.core.moveExternalTask(sourcePath, targetFolder, newName, settings)`
    - `taskExistsInFolder(name, folder?)` → `this.core.taskExistsInFolder(name, folder, settings)`
    - `taskExists(name)` → `this.core.taskExists(name, settings)`
    - `addRelatedItems(folderPath, items, description?)` → `this.core.addRelatedItems(folderPath, items, description)`
    - `getFeatureFolders()` → `this.core.getFeatureFolders(settings)`
  - The standalone `updateTaskStatus` function remains exported from this file, delegating to the core package's equivalent.
  - The standalone `parseTaskStatus` function (currently module-private) moves to core; adapter doesn't need it.

- **`src/shortcuts/tasks-viewer/types.ts`** — No changes expected. Types are already defined here and used by both sides. The core package will have its own copy or re-export from a shared location (handled in commit 005).

- **`src/shortcuts/tasks-viewer/index.ts`** — No changes expected. It re-exports from `task-manager` which still exports the same `TaskManager` class and `updateTaskStatus` function.

### Files to Delete

(none)

### Files with ZERO Changes Required (Consumers)

These files import `TaskManager` and call its methods. Because the adapter preserves the exact same public API (same class name, same method signatures, same return types), they require no modifications:

- `src/shortcuts/tasks-viewer/tree-data-provider.ts` — calls `getSettings()`, `getTasks()`, `getTaskFolderHierarchy()`, `getWorkspaceRoot()`
- `src/shortcuts/tasks-viewer/commands.ts` — calls `createTask()`, `createFeature()`, `createSubfolder()`, `renameTask()`, `renameFolder()`, `renameDocumentGroup()`, `renameDocument()`, `deleteTask()`, `deleteFolder()`, `archiveTask()`, `unarchiveTask()`, `archiveDocument()`, `unarchiveDocument()`, `archiveDocumentGroup()`, `unarchiveDocumentGroup()`, `getTasksFolder()`, `ensureFoldersExist()`; also imports standalone `updateTaskStatus`
- `src/shortcuts/tasks-viewer/tasks-drag-drop-controller.ts` — calls `getTasksFolder()`, `getArchiveFolder()`, `moveFolder()`, `archiveTask()`, `moveTask()`, `moveExternalTask()`, `taskExistsInFolder()`
- `src/shortcuts/tasks-viewer/discovery-commands.ts` — calls `getWorkspaceRoot()`, `getSettings()`
- `src/shortcuts/tasks-viewer/ai-task-commands.ts` — calls `ensureFoldersExist()`, `getWorkspaceRoot()`, `getTasksFolder()`, `getFeatureFolders()`, `sanitizeFileName()`
- `src/shortcuts/tasks-viewer/ai-task-dialog.ts` — calls `getWorkspaceRoot()`, `getFeatureFolders()`, `getTasksFolder()`
- `src/shortcuts/discovery/discovery-webview/discovery-preview-provider.ts` — calls `getWorkspaceRoot()`, `addRelatedItems()`, `getFeatureFolders()`

## Implementation Notes

### Settings Injection Pattern

The core `TaskManager` does not depend on `vscode.workspace.getConfiguration`. Instead, methods that need settings will either:

- **Option A (preferred):** Accept a settings object parameter — the VS Code adapter calls `this.getSettings()` and passes it to the core method. This keeps the core purely functional.
- **Option B:** The core stores a settings snapshot injected at construction time, with an `updateSettings()` method the adapter calls when VS Code configuration changes.

Option A is preferred because it avoids stale settings and matches how the current code already calls `getSettings()` at the point of use. However, many methods (e.g., `createTask`, `renameTask`, `deleteTask`) only need `workspaceRoot` and `folderPath` — both available at construction. Only `getTasks()`, `getTaskDocuments()`, `getTaskDocumentGroups()`, `getTaskFolderHierarchy()`, and archive methods need the full settings (for `showArchived`, `showFuture`, `discovery.enabled`). The core can accept `{ workspaceRoot, tasksFolder, archiveFolder }` as constructor params and take an optional settings argument for scan methods.

### Constructor Compatibility

Current constructor: `new TaskManager(workspaceRoot: string)`
New adapter constructor: same signature — internally creates `new CoreTaskManager(workspaceRoot)`.
No callers need to change.

### `updateTaskStatus` Standalone Function

Currently exported as a standalone function (not a class method). It uses `fs` and `js-yaml` to update frontmatter. The core package will export an equivalent `updateTaskStatus` function. The adapter file re-exports it:

```typescript
export { updateTaskStatus } from '@plusplusoneplusplus/pipeline-core';
```

### `parseTaskStatus` Module-Private Function

Currently used internally by `scanTasksRecursively` and `scanDocumentsRecursively`. Moves entirely into the core package. The adapter doesn't need it.

### Related Items Loading

The `loadRelatedItemsForFolders` private method calls `loadRelatedItems` from `./related-items-loader`. This loader module is filesystem-only (no VS Code dependencies) and should also move to pipeline-core in commit 005. The adapter would then delegate `getTaskFolderHierarchy()` entirely to core.

### File Watcher Lifecycle

The `watchTasksFolder(callback)` method creates VS Code `FileSystemWatcher` instances. This is inherently VS Code-specific and stays in the adapter. The pattern:

```typescript
watchTasksFolder(callback: () => void): void {
    this.refreshCallback = callback;
    this.disposeWatchers();
    const tasksFolder = this.core.getTasksFolder(this.getSettings());
    // ... create vscode.FileSystemWatcher instances as before
}
```

### Webpack Bundling

The `@plusplusoneplusplus/pipeline-core` package is already configured as a workspace dependency and handled by webpack. No webpack config changes needed.

## Tests

- **No new tests required** — this is a pure refactor with identical public API
- **All 6900+ existing Mocha extension tests must pass** — particularly:
  - `tasks-nested-directories.test.ts` (23 tests covering recursive scanning, folder hierarchy, document grouping)
  - `tasks-viewer.test.ts` (task CRUD operations)
  - `drag-drop.test.ts` (move operations via TaskManager)
  - `ai-task-dialog.test.ts` (uses TaskManager for folder listing)
- **Verification approach:**
  1. Run `npm run compile` to verify no TypeScript errors
  2. Run `npm run compile-tests` to verify test compilation
  3. Run `npm test` to verify all tests pass
  4. Manually verify no new imports of `vscode` appear in `@plusplusoneplusplus/pipeline-core`

## Acceptance Criteria

- [ ] `src/shortcuts/tasks-viewer/task-manager.ts` is reduced from ~1314 lines to ~200-250 lines (thin adapter with delegation + VS Code-specific methods)
- [ ] The `TaskManager` class still exports the exact same public API (same method names, same signatures, same return types)
- [ ] The standalone `updateTaskStatus` function is still exported from the same module path
- [ ] `parseFileName()` is still accessible as a public method on the adapter (delegates to core)
- [ ] `sanitizeFileName()` is still accessible as a public method on the adapter (delegates to core)
- [ ] Zero changes to any consumer file (tree-data-provider.ts, commands.ts, tasks-drag-drop-controller.ts, discovery-commands.ts, ai-task-commands.ts, ai-task-dialog.ts, discovery-preview-provider.ts)
- [ ] Zero changes to `src/shortcuts/tasks-viewer/index.ts` (re-exports still work)
- [ ] `npm run compile` succeeds with no errors
- [ ] All 6900+ Mocha tests pass (`npm test`)
- [ ] No `vscode` import exists in `@plusplusoneplusplus/pipeline-core`
- [ ] VS Code file watchers still trigger tree refresh on file create/change/delete in tasks folder

## Dependencies

- Depends on: 005 (pipeline-core exports shared `TaskManager` class with all pure logic extracted)

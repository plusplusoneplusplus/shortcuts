---
status: pending
---

# 005: Create Shared TaskManager Facade in Pipeline-Core

## Summary

Create a `TaskManager` class in `packages/pipeline-core/src/tasks/task-manager.ts` that composes the task-scanner (003), task-operations (004), types (001), frontmatter parser (002), and related-items-loader into a single facade with the same public API surface as the VS Code `TaskManager`, but free of all VS Code dependencies.

## Motivation

Commits 001–004 deliver granular, independently testable modules (types, parser, scanner, CRUD operations). Consumers—the VS Code extension and the CoC CLI—should not have to wire those modules together themselves. A facade class provides:

1. A single import for all task management functionality.
2. Constructor-injected settings instead of `vscode.workspace.getConfiguration()`.
3. An optional `onRefresh` callback instead of `vscode.FileSystemWatcher`.
4. A plain `dispose()` method instead of `vscode.Disposable`.

This keeps the VS Code wrapper trivially thin (delegate + file watchers) and lets CoC use the exact same logic with its own settings source.

## Changes

### Files to Create

- `packages/pipeline-core/src/tasks/task-manager.ts` — The `TaskManager` facade class. Constructor accepts `workspaceRoot: string` and `settings: TasksViewerSettings`. Composes scanner and operations modules. Exposes all ~30 public methods listed below.

- `packages/pipeline-core/test/tasks/task-manager.test.ts` — Comprehensive integration tests exercising the facade against a temporary directory tree.

### Files to Modify

- `packages/pipeline-core/src/tasks/index.ts` — Re-export `TaskManager` class and any helper types (e.g., `TaskManagerOptions`).

- `packages/pipeline-core/src/index.ts` — Ensure tasks barrel export includes `TaskManager`.

### Files to Delete

(none)

## Implementation Notes

### Constructor & Settings

```typescript
export interface TaskManagerOptions {
    workspaceRoot: string;
    settings: TasksViewerSettings;
    onRefresh?: () => void;
}

export class TaskManager {
    private readonly workspaceRoot: string;
    private readonly settings: TasksViewerSettings;
    private readonly onRefresh?: () => void;

    constructor(options: TaskManagerOptions);
}
```

- `settings` is a snapshot passed at construction time. The VS Code wrapper will re-create or update the manager when settings change. No live `getConfiguration()` calls.
- `onRefresh` is stored but **not** wired to any file-system watcher—that is the consumer's responsibility. The manager simply exposes it for internal operations (e.g., after a batch rename) if desired.

### Public Method Inventory

Derived from the VS Code TaskManager (1314 lines). Every method below must be present with the same signature (minus vscode types):

**Path helpers:**
1. `getTasksFolder(): string` — Resolves `settings.folderPath` against `workspaceRoot`.
2. `getArchiveFolder(): string` — `<tasksFolder>/archive`.
3. `ensureFoldersExist(): void` — Creates tasks + archive dirs.
4. `getWorkspaceRoot(): string` — Returns `workspaceRoot`.

**Scanning / querying:**
5. `getTasks(): Promise<Task[]>` — Recursive scan of tasks + optionally archive.
6. `getTaskDocuments(): Promise<TaskDocument[]>` — Recursive scan returning documents with parsed `baseName`/`docType`.
7. `getTaskDocumentGroups(): Promise<{ groups: TaskDocumentGroup[]; singles: TaskDocument[] }>` — Groups documents sharing the same baseName + relativePath.
8. `getTaskFolderHierarchy(): Promise<TaskFolder>` — Full hierarchical folder structure with groups, singles, and related items.
9. `getFeatureFolders(): Promise<Array<{ path: string; displayName: string; relativePath: string }>>` — Flat list of non-archive directories.

**CRUD — Create:**
10. `createTask(name: string): Promise<string>` — Creates `<sanitized>.md` with `# name` header.
11. `createFeature(name: string): Promise<string>` — Creates folder + `placeholder.md`.
12. `createSubfolder(parentFolderPath: string, name: string): Promise<string>` — Creates nested folder + placeholder.

**CRUD — Rename:**
13. `renameTask(oldPath: string, newName: string): Promise<string>`
14. `renameFolder(folderPath: string, newName: string): Promise<string>`
15. `renameDocumentGroup(folderPath: string, oldBaseName: string, newBaseName: string): Promise<string[]>`
16. `renameDocument(oldPath: string, newBaseName: string): Promise<string>`

**CRUD — Delete:**
17. `deleteTask(filePath: string): Promise<void>`
18. `deleteFolder(folderPath: string): Promise<void>`

**Archive / Unarchive:**
19. `archiveTask(filePath: string, preserveStructure?: boolean): Promise<string>`
20. `unarchiveTask(filePath: string): Promise<string>`
21. `archiveDocument(filePath: string, preserveStructure?: boolean): Promise<string>` — Delegates to `archiveTask`.
22. `unarchiveDocument(filePath: string): Promise<string>` — Delegates to `unarchiveTask`.
23. `archiveDocumentGroup(filePaths: string[], preserveStructure?: boolean): Promise<string[]>`
24. `unarchiveDocumentGroup(filePaths: string[]): Promise<string[]>`

**Move:**
25. `moveTask(sourcePath: string, targetFolder: string): Promise<string>`
26. `moveFolder(sourceFolderPath: string, targetParentFolder: string): Promise<string>`
27. `moveTaskGroup(sourcePaths: string[], targetFolder: string): Promise<string[]>`

**Import / External:**
28. `importTask(sourcePath: string, newName?: string): Promise<string>` — Copy semantics.
29. `moveExternalTask(sourcePath: string, targetFolder?: string, newName?: string): Promise<string>` — Move semantics.

**Query helpers:**
30. `taskExists(name: string): boolean`
31. `taskExistsInFolder(name: string, folder?: string): boolean`

**Filename utilities:**
32. `sanitizeFileName(name: string): string`
33. `parseFileName(fileName: string): { baseName: string; docType?: string }`

**Frontmatter:**
34. `updateTaskStatus(filePath: string, status: TaskStatus): Promise<void>` — Delegates to the standalone `updateTaskStatus` function from 002.

**Related items:**
35. `addRelatedItems(folderPath: string, items: RelatedItem[], description?: string): Promise<void>`

**Lifecycle:**
36. `dispose(): void` — Clears any internal timers. NOT `vscode.Disposable`.

### Composition Strategy

The class composes modules from commits 001–004:

```
TaskManager
  ├── imports types from 001 (Task, TaskDocument, TaskDocumentGroup, TaskFolder, etc.)
  ├── imports parseTaskStatus / updateTaskStatus from 002
  ├── imports scanTasksRecursively / scanDocumentsRecursively / scanFoldersRecursively from 003
  ├── imports CRUD functions from 004 (or inlines them if 004 exports a class)
  └── imports loadRelatedItems / mergeRelatedItems from related-items-loader
```

Methods that are pure pass-throughs (e.g., `archiveDocument` → `archiveTask`) should stay as thin delegations, matching the VS Code original.

### Key Differences from VS Code TaskManager

| Aspect | VS Code TaskManager | Shared TaskManager |
|---|---|---|
| Settings | `vscode.workspace.getConfiguration()` | `settings` parameter |
| File watching | `vscode.FileSystemWatcher` | External (optional `onRefresh` callback) |
| Disposable | `implements vscode.Disposable` | Plain `dispose()` method |
| Status update | Inline in class | Delegates to standalone function from 002 |
| Scanner | Private methods | Delegates to scanner module from 003 |
| Logger | `getExtensionLogger()` | Uses pipeline-core logger abstraction |

### Error Handling

- Preserve the same error messages and `throw new Error(...)` patterns from the VS Code original.
- Use `safeExists`, `safeReadDir`, `safeStats`, `safeWriteFile`, `safeRename`, `ensureDirectoryExists` from pipeline-core's utils (or re-export them in the tasks barrel).

### Path Resolution

- `getTasksFolder()` resolves `settings.folderPath` against `workspaceRoot` using `path.isAbsolute()` check, identical to the VS Code version.
- All methods that accept absolute paths continue to do so—no relative path resolution magic.

## Tests

Tests in `packages/pipeline-core/test/tasks/task-manager.test.ts`:

- **Constructor & path helpers:** Verify `getTasksFolder()` with relative and absolute `folderPath` settings; verify `getArchiveFolder()`; verify `getWorkspaceRoot()`.
- **ensureFoldersExist:** Creates tasks and archive directories.
- **getTasks:** Returns tasks from root, nested folders, and optionally archive.
- **getTaskDocuments:** Returns documents with correct `baseName`/`docType` parsing.
- **getTaskDocumentGroups:** Groups multi-doc tasks; separates singles.
- **getTaskFolderHierarchy:** Builds correct tree with children, documentGroups, singleDocuments.
- **createTask / createFeature / createSubfolder:** Creates files/folders; throws on duplicates.
- **renameTask / renameFolder / renameDocumentGroup / renameDocument:** Renames correctly; throws on collision.
- **deleteTask / deleteFolder:** Removes files/directories; throws if not found.
- **archiveTask / unarchiveTask:** Moves between active and archive; handles collisions with timestamp suffix; `preserveStructure` works.
- **archiveDocument / unarchiveDocument / archiveDocumentGroup / unarchiveDocumentGroup:** Delegation works correctly.
- **moveTask / moveFolder / moveTaskGroup:** Moves with collision handling; circular move prevention for folders.
- **importTask / moveExternalTask:** Copy vs. move semantics; `.md`-only guard for moveExternalTask.
- **taskExists / taskExistsInFolder:** Boolean checks.
- **sanitizeFileName:** Invalid characters replaced; whitespace collapsed.
- **parseFileName:** Correctly splits `task.plan.md` → `{baseName: "task", docType: "plan"}`.
- **updateTaskStatus:** Creates frontmatter if missing; updates existing frontmatter.
- **addRelatedItems:** Merges items, deduplicates.
- **getFeatureFolders:** Returns flat list excluding archive.
- **dispose:** No errors when called; clears any state.
- **Cross-platform:** Test with both `/` and `\` separators in relative paths.

## Acceptance Criteria

- [ ] `TaskManager` class exists at `packages/pipeline-core/src/tasks/task-manager.ts`
- [ ] Constructor accepts `TaskManagerOptions` with `workspaceRoot`, `settings`, and optional `onRefresh`
- [ ] No imports from `vscode` module anywhere in the file
- [ ] All 36 public methods from the inventory above are implemented
- [ ] Method signatures match the VS Code original (same parameter names, types, return types)
- [ ] Error messages match the VS Code original for consistency
- [ ] Class is exported from `packages/pipeline-core/src/tasks/index.ts` and `packages/pipeline-core/src/index.ts`
- [ ] All tests pass on Linux, macOS, and Windows (cross-platform path handling)
- [ ] `npm run test:run` in `packages/pipeline-core/` passes with no regressions
- [ ] `npm run build` at root succeeds

## Dependencies

- Depends on: 001 (types), 002 (frontmatter parser), 003 (task scanner), 004 (CRUD operations)

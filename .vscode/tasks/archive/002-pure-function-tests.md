---
status: done
---

# 002: Pure function unit tests

## Summary
Add comprehensive unit tests for all pure function exports from `useTaskTree.ts` and `TaskTree.tsx`. These replace the bundle string-scanning tests in `spa-tasks-context-file-filtering.test.ts` with real import-and-call tests.

## Motivation
The existing tests in `spa-tasks-context-file-filtering.test.ts` only scan the compiled bundle string for the presence of function names and string literals (e.g., `expect(script).toContain('isContextFile')`). They verify nothing about behavior. These pure functions — context file detection, git metadata filtering, path handling, column rebuilding — are the foundation of the SPA task tree logic and deserve real unit tests. They have zero dependencies on React, DOM, or network, making them the ideal first behavioral tests.

## Changes

### Files to Create
- `packages/coc/test/spa/react/pure-functions.test.ts` — unit tests for all pure exports from `useTaskTree.ts` and `TaskTree.tsx`

### Files to Modify
(none expected)

### Files to Delete
(none)

## Implementation Notes

### Source file details

**`useTaskTree.ts` exports under test:**
- `CONTEXT_FILES` — a `Set<string>` (not an array), contains 15 lowercase entries including `'readme'`, `'readme.md'`, `'claude.md'`, `'license'`, `'.gitignore'`, etc.
- `isContextFile(fileName: string): boolean` — calls `fileName.toLowerCase()` then checks `CONTEXT_FILES.has()`. Case-insensitive by design.
- `isGitMetadataFolder(folder: TaskFolder): boolean` — takes a full `TaskFolder` object (not just a string name). Returns `true` if `folder.name === '.git'` OR if any segment of `folder.relativePath` is `'.git'`. Uses non-exported `getPathSegments()` internally which splits on both `/` and `\`.
- `filterGitMetadataFolders(folder: TaskFolder): TaskFolder` — returns a shallow copy of the folder with `.children` recursively filtered to remove git metadata folders. Handles missing/non-array `.children` gracefully via `Array.isArray()` guard.
- `isTaskFolder(node)`, `isTaskDocumentGroup(node)`, `isTaskDocument(node)` — type guards based on property presence (`children`+`singleDocuments`, `documents`+`baseName`, `fileName`).
- `folderToNodes(folder: TaskFolder): TaskNode[]` — spreads `children`, `documentGroups`, `singleDocuments`, and `contextDocuments` (via `as any` cast). Used by `rebuildColumnsFromKeys`.
- `countMarkdownFilesInFolder(folder: TaskFolder): number` — recursive count of `.md` files across singles, groups, and child folders.

**`TaskTree.tsx` exports under test:**
- `getFolderKey(folder: TaskFolder): string` — returns `folder.relativePath || folder.name`. Simple fallback logic.
- `rebuildColumnsFromKeys(tree: TaskFolder, keys: (string | null)[]): TaskNode[][]` — builds miller column arrays by walking saved folder keys. Starts with root nodes, then for each key finds the matching folder via non-exported `findFolderByKey()` (recursive DFS on `tree.children`). Stops at the first `null` key or unresolvable key.

**Non-exported functions (tested indirectly):**
- `getPathSegments(relativePath)` — tested through `isGitMetadataFolder` with paths containing `/` and `\`
- `findFolderByKey(tree, key)` — tested through `rebuildColumnsFromKeys`

### Helper factory pattern
Create a minimal `TaskFolder` factory to reduce test boilerplate. A `makeFolder(overrides)` helper that fills in required fields (`name`, `relativePath`, `children: []`, `documentGroups: []`, `singleDocuments: []`) is essential since most tests only care about one or two fields.

### Import paths
Import directly from source files:
```ts
import { CONTEXT_FILES, isContextFile, isGitMetadataFolder, filterGitMetadataFolders, isTaskFolder, isTaskDocumentGroup, isTaskDocument, folderToNodes, countMarkdownFilesInFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';
import type { TaskFolder, TaskDocument, TaskDocumentGroup } from '../../../src/server/spa/client/react/hooks/useTaskTree';
import { getFolderKey, rebuildColumnsFromKeys } from '../../../src/server/spa/client/react/tasks/TaskTree';
```

### Environment
These tests need no DOM or jsdom — they are pure TypeScript logic. They can run in vitest's default node environment.

### `escapeHtml` exclusion
`escapeHtml` from `helpers.ts` is already thoroughly tested in `test/server/spa-helpers.test.ts` (6 tests covering all special chars, empty string, no-op, and combined escaping). No duplication needed.

## Tests

### `CONTEXT_FILES`
- Verify it is a `Set` instance
- Verify it has exactly 15 entries
- Verify it contains all expected lowercase values: `readme`, `readme.md`, `claude.md`, `license`, `license.md`, `changelog.md`, `contributing.md`, `code_of_conduct.md`, `security.md`, `index`, `index.md`, `context`, `context.md`, `.gitignore`, `.gitattributes`

### `isContextFile`
- Returns `true` for exact lowercase match: `isContextFile('readme.md')` → `true`
- Case-insensitive: `isContextFile('README.MD')` → `true`, `isContextFile('Claude.md')` → `true`
- Returns `false` for non-context files: `isContextFile('app.ts')` → `false`
- Returns `false` for partial matches: `isContextFile('my-readme.md')` → `false`
- Edge: empty string → `false`

### `isGitMetadataFolder`
- Returns `true` for folder with `name: '.git'`
- Returns `true` for nested `.git` in `relativePath` (e.g., `relativePath: 'modules/.git/objects'`)
- Returns `false` for regular folder (e.g., `name: 'src'`)
- Returns `false` for folder with `.git` as substring in name (e.g., `name: '.github'`)
- Handles backslash paths: `relativePath: 'a\\.git\\b'` → `true`
- Handles empty/missing `relativePath` gracefully

### `filterGitMetadataFolders`
- Removes direct `.git` child folders
- Preserves non-git children
- Recursively filters nested `.git` folders
- Returns folder with empty children if all children are git folders
- Handles folder with no children (empty array)
- Handles folder with `children: undefined` (the `Array.isArray` guard)

### `getFolderKey`
- Uses `relativePath` when present: `{ relativePath: 'src/components', name: 'components' }` → `'src/components'`
- Falls back to `name` when `relativePath` is empty string: `{ relativePath: '', name: 'root' }` → `'root'`
- Falls back to `name` when `relativePath` is falsy

### `rebuildColumnsFromKeys`
- Returns `[rootNodes]` when `keys` is empty
- Builds correct column chain for valid keys pointing to nested folders
- Stops at first `null` key
- Stops at first unresolvable key (key doesn't match any folder)
- Each column contains the result of `folderToNodes()` for that level

### Type guards (`isTaskFolder`, `isTaskDocumentGroup`, `isTaskDocument`)
- `isTaskFolder` returns `true` for objects with `children` + `singleDocuments`
- `isTaskDocumentGroup` returns `true` for objects with `documents` + `baseName` but no `children`
- `isTaskDocument` returns `true` for objects with `fileName` but no `documents`/`children`
- Each guard returns `false` for the other two node types

### `folderToNodes`
- Concatenates `children`, `documentGroups`, `singleDocuments` into flat array
- Includes `contextDocuments` if present (via `as any` cast)
- Returns empty array if all sub-arrays are empty

### `countMarkdownFilesInFolder`
- Counts `.md` files in `singleDocuments`
- Counts `.md` files inside `documentGroups`
- Recursively counts through child folders
- Case-insensitive `.md` check (`.MD` extension)
- Returns 0 for empty folder
- Ignores non-markdown files (e.g., `.txt`, `.ts`)

## Acceptance Criteria
- [ ] All pure function exports from `useTaskTree.ts` have thorough unit tests including edge cases
- [ ] All pure function exports from `TaskTree.tsx` (`getFolderKey`, `rebuildColumnsFromKeys`) have thorough unit tests
- [ ] Type guard functions are tested against all three node types
- [ ] Tests run in node environment (no DOM/jsdom needed)
- [ ] Tests import directly from source `.ts` files, not compiled bundles
- [ ] All tests pass via `npx vitest run packages/coc/test/spa/react/pure-functions.test.ts`
- [ ] No duplication with existing `spa-helpers.test.ts` (escapeHtml)

## Dependencies
- Depends on: 001

## Assumed Prior State
Vitest config supports `.ts` files in `test/spa/react/` with jsdom environment. Test setup registers jest-dom matchers. The `test/spa/react/` directory exists. Direct `.ts` imports from `src/` resolve correctly via vitest's TypeScript handling.

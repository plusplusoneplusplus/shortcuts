# Filter Archive Folders from AI Task-Creation Prompt

## Problem

When the AI auto-selects a target folder during task creation, the `Folder options:` line in the
generated prompt includes `archive` and all its sub-folders (e.g. `archive/coc`, `archive/coc-sdk`).
These are historical items and should never be offered as destinations for new tasks.

**Root cause:** `buildCreateTaskPromptWithName` in `task-prompt-builder.ts` receives an
`AutoFolderContext` whose `existingFolders` array may contain `archive` and `archive/*` entries.
The prompt builder forwards the list as-is; no filtering happens before the `Folder options:` line
is assembled.

```ts
// packages/pipeline-core/src/tasks/task-prompt-builder.ts ~line 140-144
const folderList = autoFolderContext.existingFolders.length > 0
    ? autoFolderContext.existingFolders.join(', ')   // archive/* leaks through here
    : '(none yet)';
```

## Acceptance Criteria

- [ ] `Folder options:` in the AI prompt never includes `archive` or any path starting with `archive/`.
- [ ] Non-archive nested folders (e.g. `coc/chat`, `coc/tasks`) still appear.
- [ ] Existing prompt-builder tests pass; new tests cover the archive-exclusion behaviour.

## Subtasks

### 1. Filter `archive` in `buildCreateTaskPromptWithName`

In `packages/pipeline-core/src/tasks/task-prompt-builder.ts`, inside the `autoFolderContext` branch,
filter the folders list before building `folderList`:

```ts
const filtered = autoFolderContext.existingFolders
    .filter(f => f !== 'archive' && !f.startsWith('archive/'));
const folderList = filtered.length > 0
    ? filtered.join(', ')
    : '(none yet)';
```

This is a single, self-contained change with no side-effects on callers — the `AutoFolderContext`
object is unchanged; only the prompt text is cleansed.

### 2. Add / Update Tests

- In `packages/pipeline-core/test/tasks/task-prompt-builder.test.ts`, add cases where
  `existingFolders` contains `'archive'` and `'archive/coc'` and assert that neither appears in the
  generated prompt.
- Verify all existing `task-prompt-builder` tests still pass.

## Notes

- No changes needed in `queue-executor-bridge.ts` or `task-generation-handler.ts`; the fix lives
  entirely in the prompt builder where the text is assembled.
- Keep the filter one-liner — only strip the `archive` folder by name; do not generalise to a
  configurable blocklist.

# Improve AI Task Creation Prompt

## Problem

The prompt injected by CoC's AI task creation feature is too long and cluttered, reducing instruction-following quality:

1. **Archive folders pollute the list** — `archive/*` entries (30+) dominate the folder list even though they should never be targets.
2. **Sub-folder explosion** — `coc/chat`, `coc/git`, `coc/wiki`, etc. are listed individually, making the list ~40 entries when ~8 top-level folders would suffice.
3. **Constraints buried at end** — The "where to save" instruction comes after the "what to create" content block; end-of-prompt constraints are less reliably followed.
4. **Redundant content scaffold** — The 4-bullet "Generate a comprehensive markdown task document with..." block adds length with no real benefit; capable models already know what a task doc contains.

## Proposed Approach

Two-file change: `task-generation-handler.ts` (folder list filtering) + `task-prompt-builder.ts` (prompt restructure).

---

## Changes

### 1. Filter archive folders — `task-generation-handler.ts`

In the `isAutoFolder` block (around line 122), filter out `archive` from both the top-level subfolders and deep nested folders:

```ts
// Before
const subfolders = entries.filter(e => e.isDirectory()).map(e => e.name);

// After
const subfolders = entries
  .filter(e => e.isDirectory() && e.name !== 'archive')
  .map(e => e.name);
```

Deep folders already derive from `subfolders`, so the `archive` filter cascades automatically — no change needed for the `deepFolders` loop.

### 2. Deduplicate to top-level folders — `task-generation-handler.ts`

The deep folder scan currently produces both `coc` and `coc/chat`, `coc/git`, etc. Replace the `existingFolders` value with a deduplicated top-level list:

```ts
// Only top-level; AI can create the right subfolder itself
autoFolderContext = {
  tasksRoot: tasksBase,
  existingFolders: subfolders,   // top-level only, archive excluded
};
```

Remove the entire `deepFolders` loop.

### 3. Restructure prompt — `task-prompt-builder.ts`

In `buildCreateTaskPromptWithName` (auto-folder branch, name absent):

**Before:**
```
Create a task document based on this description:
{description}

Generate a comprehensive markdown task document with:
- Clear title and description
- Acceptance criteria
- Subtasks (if applicable)
- Notes section

Choose an appropriate filename based on the task content.
The filename should be in kebab-case, descriptive, and end with .plan.md (e.g., "oauth2-authentication.plan.md").

**FOLDER SELECTION (Auto mode)**
Tasks root: {tasksRoot}
Existing feature folders: {folderList}
...
```

**After:**
```
Save location: {tasksRoot}/<chosen-folder>/<descriptive-name>.plan.md
Folder options: {folderList}
Rules: pick the most relevant folder or create a new one (kebab-case, ≤3 words); do not save to the tasks root directly.

Create a task plan document for: {description}
Include title, acceptance criteria, subtasks (if any), and notes.
```

Same restructure for the `name` branch (with-name variant): constraints first, then the creation ask.

---

## Acceptance Criteria

- [ ] `archive` folder never appears in the AI prompt's folder list
- [ ] Only top-level feature folders are listed (e.g., `coc`, `memory`, `per-repo-mcp-config`)
- [ ] Prompt length for auto-folder mode is ≤ 10 lines regardless of how many feature folders exist
- [ ] Save-location constraint appears before the content generation ask
- [ ] Existing tests for `buildCreateTaskPromptWithName` pass; update snapshots if present
- [ ] Manual smoke test: create a task via the CoC UI → file lands in the correct non-archive folder

## Notes

- The `deepFolders` removal is intentional: top-level folders give the AI enough signal to pick a home, and it can create a subfolder if needed. Re-adding depth later (with archive filtering) is easy if desired.
- No schema or API changes needed — `AutoFolderContext.existingFolders` type stays `string[]`.
- Tests live in `packages/pipeline-core/src/tasks/__tests__/task-prompt-builder.test.ts` — check for snapshot assertions before changing prompt text.

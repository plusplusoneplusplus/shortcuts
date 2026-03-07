# Follow-Prompt: Skip Inactive Tasks in Folder

## Problem

When running "Follow Prompt" on a folder (bulk mode), **all** `.md` task files in the folder are collected and queued — including tasks marked as `future` (and `done`). These inactive tasks should be skipped since there is no actionable work to do on them.

From the screenshot: the dialog shows "2 tasks will be queued" for `misc-everything-else`, but if any of those tasks have `status: future` in their YAML frontmatter, they should not be included.

## How It Works Today

- `BulkFollowPromptDialog.tsx` calls `collectMarkdownFiles(folder)` which recursively collects all `.md` files
- Each `TaskDocument` already has a `status?: string` field populated from YAML frontmatter (parsed by `task-parser.ts`)
- `TaskStatus` union: `'pending' | 'in-progress' | 'done' | 'future'`
- **No filtering by status** is applied in `collectMarkdownFiles` — all non-context `.md` files are included

## Proposed Fix

### File: `packages/coc/src/server/spa/client/react/shared/BulkFollowPromptDialog.tsx`

Update `collectMarkdownFiles` to skip documents whose `status` is `'future'` or `'done'`.

**Define inactive statuses** (constants at top of function or file):
```ts
const INACTIVE_STATUSES = new Set(['future', 'done']);
```

**Filter in the loop** — add `&& !INACTIVE_STATUSES.has(doc.status ?? '')` to each doc check:

```ts
function collectMarkdownFiles(folder: TaskFolder): TaskFile[] {
    const files: TaskFile[] = [];

    for (const doc of folder.singleDocuments) {
        if (
            doc.fileName.toLowerCase().endsWith('.md') &&
            !isContextFile(doc.fileName) &&
            !INACTIVE_STATUSES.has(doc.status ?? '')
        ) {
            const rel = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
            files.push({ fileName: doc.fileName, relativePath: rel });
        }
    }

    for (const group of folder.documentGroups) {
        for (const doc of group.documents) {
            if (
                doc.fileName.toLowerCase().endsWith('.md') &&
                !isContextFile(doc.fileName) &&
                !INACTIVE_STATUSES.has(doc.status ?? '')
            ) {
                const rel = doc.relativePath ? doc.relativePath + '/' + doc.fileName : doc.fileName;
                files.push({ fileName: doc.fileName, relativePath: rel });
            }
        }
    }

    for (const child of folder.children) {
        files.push(...collectMarkdownFiles(child));
    }

    return files;
}
```

> **Note:** Tasks with no status (undefined) are treated as active (included). Only explicitly marked `future` or `done` are excluded.

## Scope

- **In scope:** `BulkFollowPromptDialog.tsx` — the `collectMarkdownFiles` helper only
- **Out of scope:** Single-file `FollowPromptDialog.tsx` (already targets one explicit file), task tree visibility (`showFuture` setting), archive folder logic

## Todos

- [x] Update `collectMarkdownFiles` in `BulkFollowPromptDialog.tsx` to filter out `future` and `done` status tasks
- [x] Update the dialog header count (it auto-derives from `taskFiles.length` via `useMemo`, so this is free)
- [x] Add/update tests for `collectMarkdownFiles` filtering behavior

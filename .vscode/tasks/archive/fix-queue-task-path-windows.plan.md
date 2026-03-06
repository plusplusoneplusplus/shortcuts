# Fix: Invalid Path Rendering for Queue Task on Windows

## Problem

When a queue task references a Windows file path (e.g. `D:\projects\shortcuts\.vscode\tasks\coc\misc\hover-create-result.plan.md`), the path displayed in the "YOU" message bubble is corrupted:

**Actual render:** `D:/projects/shortcuts.vscode/tasks/coc/misc/hover-create-result.plan.md`  
**Expected render:** `D:/projects/shortcuts/.vscode/tasks/coc/misc/hover-create-result.plan.md`

The `/` separator before `.vscode` is missing, making the path invalid and unclickable/unresolvable.

## Root Cause

In `ConversationTurnBubble.tsx`, the rendering pipeline is:

```
chatMarkdownToHtml(content)
  → chatMarked.parse(content)   ← markdown runs FIRST
  → linkifyFilePaths(html)      ← linkify runs on already-modified HTML
```

The GFM/CommonMark spec treats `\` followed by ASCII punctuation as an **escape sequence**, silently dropping the backslash. The dot `.` is ASCII punctuation, so:

```
shortcuts\.vscode  →  (marked strips \)  →  shortcuts.vscode
```

Other backslashes in the path survive (`\p`, `\s`, `\t`, etc.) because letters are not punctuation. By the time `linkifyFilePaths` runs, the damage is done — `toForwardSlashes` then converts remaining backslashes to `/`, but the lost `/` before `.vscode` never comes back.

## Proposed Fix

**Normalize Windows-style paths to forward slashes in the raw content string before passing it to `marked.parse()`.**

Location: `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx`

### Approach

Add a pre-processing step in `chatMarkdownToHtml` (or the function that calls `marked.parse`) that converts Windows paths from backslash to forward-slash notation **before** markdown parsing. This prevents `marked` from ever seeing `\.` as an escape sequence.

```ts
// Before:
export function chatMarkdownToHtml(content: string): string {
    if (!content || !content.trim()) return '';
    const html = chatMarked.parse(content) as string;
    return linkifyFilePaths(html);
}

// After:
export function chatMarkdownToHtml(content: string): string {
    if (!content || !content.trim()) return '';
    const normalized = normalizeWindowsPathsInText(content);  // new step
    const html = chatMarked.parse(normalized) as string;
    return linkifyFilePaths(html);
}
```

The helper `normalizeWindowsPathsInText` should use the same `FILE_PATH_RE` regex (or a compatible one) to find Windows-style paths in the raw text and replace backslashes with forward slashes before `marked` sees them:

```ts
function normalizeWindowsPathsInText(text: string): string {
    // Match Windows absolute paths: C:\... or D:\...
    return text.replace(/[A-Za-z]:[\\\/][\w.\\/@-]+/g, (match) => toForwardSlashes(match));
}
```

### Why not linkify before markdown?

Linkifying before markdown would require converting raw text to HTML spans, which would then be double-processed by `marked` — producing malformed HTML. Pre-normalizing paths (backslash → forward-slash) is a safe, non-destructive transformation that doesn't change how `marked` interprets the rest of the content.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Add `normalizeWindowsPathsInText` helper and call it before `chatMarked.parse()` |

## Test Cases

- Path with `\.vscode` segment: `D:\projects\shortcuts\.vscode\tasks\coc\misc\foo.plan.md` → should render as `D:/projects/shortcuts/.vscode/tasks/coc/misc/foo.plan.md`
- Path with multiple dot-prefixed segments: `C:\Users\user\.config\.app\file.json` → should render as `C:/Users/user/.config/.app/file.json`
- Normal path (no dot segments): `D:\projects\shortcuts\src\index.ts` → should render unchanged as `D:/projects/shortcuts/src/index.ts`
- Non-path markdown content should be unaffected

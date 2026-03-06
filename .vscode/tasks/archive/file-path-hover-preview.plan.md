# File Path Hover-to-Preview & Click-to-Open Plan

## Problem

In the CoC dashboard SPA, file paths appear in multiple rendering contexts (tool call headers, tool call bodies, metadata rows, prompt previews). Currently, **only** file paths inside AI chat message bodies (conversation turn markdown) are linkified with hover-to-preview tooltips and click-to-open-in-dialog support. All other file path occurrences render as **plain text** with no interactivity.

The infrastructure already exists:
- `file-path-preview.ts` — global event delegation on `document.body` targeting `.file-path-link` spans for hover (tooltip with file preview) and click (opens `MarkdownReviewDialog`)
- `linkifyFilePaths()` — regex-based HTML transform that wraps detected paths in `<span class="file-path-link" data-full-path="...">`
- `/api/workspaces/{wsId}/files/preview` — backend endpoint returning file content or directory listings
- `MarkdownReviewDialog` — full-screen dialog for reviewing file content

## Approach

Extract a reusable `<FilePathLink>` React component that renders a `<span class="file-path-link" data-full-path="...">` element. Then replace all plain-text file path renderings with this component. The global delegation in `file-path-preview.ts` automatically provides hover-preview and click-to-open behavior for any DOM element with class `file-path-link` and `data-full-path` attribute — no per-component wiring needed.

## Files Affected

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/shared/FilePathLink.tsx` | **New** — Reusable `<FilePathLink path={fullPath} />` component |
| `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx` | Use `<FilePathLink>` in header summary + expanded body path displays |
| `packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx` | Use `<FilePathLink>` or `linkifyFilePaths` for prompt preview paths |
| `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx` | Replace inline `FilePathValue` with shared `<FilePathLink>`, add to `MetaRow` path fields |

## Tasks

### 1. ✅ Create `<FilePathLink>` shared component

**File:** `packages/coc/src/server/spa/client/react/shared/FilePathLink.tsx`

Create a small React component:
```tsx
interface FilePathLinkProps {
    path: string;
    className?: string;
    shorten?: boolean; // default true — use shortenPath() for display
}
```

Renders:
```tsx
<span
    className={`file-path-link break-all ${className ?? ''}`}
    data-full-path={normalizedPath}
    title={normalizedPath}
>
    {shorten ? shortenPath(path) : path}
</span>
```

This leverages the existing global delegation — no onClick/onMouseOver handlers needed. Import the `shortenPath` utility from wherever it's currently defined (likely `ToolCallView.tsx` or a utility file).

### 2. ✅ Wire `<FilePathLink>` into `ToolCallView.tsx` header summary

**File:** `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`

**Current (lines ~429–433):**
```tsx
<span className="text-[#848484] truncate min-w-0" title={summary}>
    {summary}
</span>
```

**Change:** For tool calls that operate on file paths (`create`, `edit`, `view`, `bash`, `powershell`, `glob`, `grep`), extract the file path from `toolCall.args` and render the summary using `<FilePathLink>` instead of a plain span. For tool calls where summary is not a path, keep as-is.

Specifically in `getToolSummary()` or at the render site, detect when the summary contains a file path (these tools always have `args.path`) and render it as a `<FilePathLink>`.

### 3. ✅ Wire `<FilePathLink>` into `ToolCallView.tsx` expanded body

**File:** `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`

The following sub-components render `📁 shortenPath(filePath)` as plain text:
- `EditToolView` (~line 199) — file path header in diff view
- `CreateToolView` (~line 235) — file path header in create view
- `ViewToolView` (~lines 288, 307) — file path header in view result

Replace each `📁 {shortenPath(filePath)}` plain text with `📁 <FilePathLink path={filePath} />`.

### 4. ✅ Wire `<FilePathLink>` into `QueueTaskDetail.tsx` metadata rows

**File:** `packages/coc/src/server/spa/client/react/queue/QueueTaskDetail.tsx`

**a) Replace existing `FilePathValue` component (lines ~815–826):**
The local `FilePathValue` already has `file-path-link` class and `data-full-path`. Replace it with the shared `<FilePathLink>` component for consistency. Used for Working Directory, Prompt File, and Plan File.

**b) Add `<FilePathLink>` to `MetaRow` file path values:**
- `payload.filePath` (~line 910) — currently plain `<span>` inside `MetaRow`
- `payload.targetFolder` (~line 951) — currently plain `<span>` inside `MetaRow`
- `payload.rulesFolder` (~line 976) — currently plain `<span>` inside `MetaRow`

For each, wrap the value with `<FilePathLink>` instead of rendering as plain text.

### 5. ✅ Apply `linkifyFilePaths` to `ProcessDetail.tsx` prompt preview

**File:** `packages/coc/src/server/spa/client/react/processes/ProcessDetail.tsx`

**Current (lines ~310–312):**
```tsx
<div className="text-sm text-[#1e1e1e] dark:text-[#cccccc] break-words">
    {process.fullPrompt || process.promptPreview || process.id}
</div>
```

**Change:** Run the prompt text through `linkifyFilePaths()` and render via `dangerouslySetInnerHTML`, or alternatively scan for paths and render a mixed text/`<FilePathLink>` component tree. The `dangerouslySetInnerHTML` + `linkifyFilePaths` approach is simpler and consistent with how conversation turns work.

### 6. ✅ Export `linkifyFilePaths` from a shared location

**File:** `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` (move function) → shared utility

Currently `linkifyFilePaths` and `FILE_PATH_RE` are defined locally in `ConversationTurnBubble.tsx`. Since they'll be needed by `ProcessDetail.tsx` and potentially other components, extract them to a shared utility (e.g., `packages/coc/src/server/spa/client/react/shared/file-path-utils.ts`) and import from there.

## Notes

- The `file-path-preview.ts` global delegation handles **all** hover/click behavior — the `<FilePathLink>` component is purely declarative (renders the right DOM attributes).
- No changes needed to `file-path-preview.ts`, `MarkdownReviewDialog`, or the backend API.
- `QueueTaskDetail.tsx`'s existing `FilePathValue` already works with the delegation (has the right class/attributes) — this plan replaces it with the shared component for DRY consistency.
- The `markdown-renderer.ts` (used for wiki/task preview) does NOT call `linkifyFilePaths` — extending it is out of scope unless needed.

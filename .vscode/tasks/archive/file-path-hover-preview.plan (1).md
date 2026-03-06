# File Path Hover Preview & Click-to-Open Dialog

## Problem

In the VS Code webview (markdown-comments editor), AI responses contain file paths that are already detected and wrapped in `<span class="file-path-link" data-full-path="...">` by the `applyMarkdownHighlighting()` pipeline from `pipeline-core/editor/rendering`. However, these spans have **no interactivity** — no hover preview and no click handler. Meanwhile, the CoC SPA dashboard has full hover-to-preview and click-to-open support via `packages/coc/src/server/spa/client/react/file-path-preview.ts`.

## Goal

Add two interactive behaviors for `.file-path-link` spans in the VS Code webview:

1. **Hover → Preview tooltip**: Show a floating tooltip with a preview of the file content (first N lines, syntax-highlighted) when hovering over a file path
2. **Click → Open in dialog**: Open the file in an inline dialog/modal within the webview (not navigate away), allowing the user to read the full content and optionally open it in the editor

## Current State

| Aspect | CoC SPA (React) | VS Code Webview |
|--------|-----------------|-----------------|
| File path detection | ✅ `linkifyFilePaths()` | ✅ `applyMarkdownHighlighting()` via `FILE_PATH_RE` |
| Hover preview | ✅ `file-path-preview.ts` (250ms delay, fetches `/workspaces/{id}/files/preview`) | ❌ Only native `title` attribute |
| Click to open | ✅ Fires `coc-open-markdown-review` custom event | ❌ No handler at all |
| `.md-link` click | N/A | ✅ Ctrl+Click → `openFile()` postMessage |

### Key Files (VS Code Webview)

- `src/shortcuts/markdown-comments/webview-scripts/render.ts` — renders markdown lines, calls `applyMarkdownHighlighting()`
- `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts` — all webview DOM event handlers (click, hover, etc.)
- `src/shortcuts/markdown-comments/webview-content.ts` — HTML shell with dialog definitions
- `src/shortcuts/markdown-comments/webview-scripts/vscode-bridge.ts` — `postMessage` wrappers to extension host
- `src/shortcuts/markdown-comments/editor-message-router.ts` — extension-side message handler
- `src/shortcuts/markdown-comments/file-path-utils.ts` — `resolveFilePath`, `parseLineFragment`
- `src/shortcuts/markdown-comments/vscode-editor-host.ts` — final VS Code API calls

### Key Files (CoC SPA — reference implementation)

- `packages/coc/src/server/spa/client/react/file-path-preview.ts` — 516 lines, full hover/click delegation
- `packages/coc/src/server/spa/client/react/shared/file-path-utils.ts` — `linkifyFilePaths()`, `FILE_PATH_RE`

## Approach

Port the hover-preview and click-to-dialog pattern from the CoC SPA to the VS Code webview, adapted for the webview architecture (postMessage-based file reading instead of HTTP fetch, VS Code theming instead of Tailwind).

## Tasks

### 1. Add extension-host message handler for file preview

**Files:** `editor-message-router.ts`, `vscode-editor-host.ts`

- Add a new message type `readFilePreview` that the webview can send via postMessage
- Handler reads the file content (first ~50 lines), resolves the path using existing `resolveFilePath()`, and sends back a response message `filePreviewResult` with `{ path, content, language, lineCount, isDirectory, error? }`
- For directories, return a listing (name + type) similar to the CoC SPA's approach
- Reuse `parseLineFragment()` for `#L100` anchor support

### 2. Add hover tooltip for `.file-path-link` in the webview

**Files:** `dom-handlers.ts` (or new `file-path-preview.ts` webview script)

- Register `mouseover`/`mouseleave` event delegation on `.file-path-link` spans
- On hover (250ms debounce), send `readFilePreview` postMessage to extension host
- On response, render a tooltip `<div class="file-preview-tooltip">` appended to `document.body` with:
  - File name header
  - Line-numbered content preview (use existing code block styling)
  - "Click to open" hint in footer
- Smart positioning: below target element, flip above if near viewport bottom
- Hide on mouseleave (200ms delay to allow moving into tooltip)
- Add LRU-style cache (Map with max ~30 entries, 5-min TTL) to avoid re-fetching

### 3. Add click-to-open dialog for `.file-path-link`

**Files:** `dom-handlers.ts`, `webview-content.ts` (or new files)

- On click of `.file-path-link`, open an inline modal dialog showing:
  - File path as title
  - Full file content with line numbers and syntax highlighting (use existing highlight.js integration)
  - "Open in Editor" button that calls existing `openFile()` → postMessage flow
  - Close button (×), Escape key, click-outside-to-close
- Add a new message type `readFileContent` (full file, not just preview) or reuse `readFilePreview` with a `full: true` param
- Follow the existing modal overlay pattern from `followPromptDialog` / `updateDocumentDialog`
- For very large files, cap at ~500 lines with a "Open in Editor to see full file" message

### 4. Add CSS styles for tooltip and dialog

**Files:** `src/shortcuts/markdown-comments/styles/` (appropriate CSS file)

- `.file-preview-tooltip` — floating tooltip with shadow, border, max dimensions, scrollable content area, VS Code theme variables for colors
- `.file-path-link` — cursor pointer, underline on hover, subtle highlight color
- `.file-preview-dialog` — modal overlay following existing dialog patterns
- Line numbers styling within preview (monospace, muted color, right-aligned)
- Ensure dark/light/high-contrast theme compatibility via VS Code CSS variables

### 5. Wire up postMessage round-trip

**Files:** `vscode-bridge.ts`, `editor-message-router.ts`

- Add `requestFilePreview(path: string, full?: boolean)` to vscode-bridge
- Add response listener pattern — since postMessage is async, use a callback map or event-based approach (check how existing request/response patterns work in the webview)
- Handle errors gracefully (file not found, permission denied, binary file)

### 6. Add `.file-path-link` click handler parallel to `.md-link`

**Files:** `dom-handlers.ts`

- Add click delegation for `.file-path-link` alongside the existing `.md-link` handler (~L2490)
- Default click → open preview dialog (task 3)
- Ctrl+Click → open directly in editor (reuse existing `openFile()` flow)
- Update the `title` attribute to hint at both behaviors: `"Click to preview • Ctrl+Click to open in editor"`

## Design Considerations

- **Performance**: Cache file previews to avoid repeated reads. The CoC SPA uses 5-min TTL + 50-entry LRU — similar approach works here.
- **Binary files**: Detect and show "Binary file — click to open in editor" instead of content.
- **Large files**: Cap preview at ~50 lines, dialog at ~500 lines.
- **Theme integration**: Use `var(--vscode-editor-background)`, `var(--vscode-editor-foreground)`, etc. for all colors.
- **Accessibility**: Tooltip should be dismissable via Escape; dialog should trap focus; file path spans should have `role="button"` and `tabindex="0"` for keyboard nav.
- **Scroll lock**: When tooltip is visible and user scrolls the main content, hide the tooltip (same pattern as CoC SPA's scroll guard).

## Out of Scope

- Modifying the file path detection regex (`FILE_PATH_RE`) — it already works well
- Adding file path support to non-markdown-comments webviews
- Inline editing of files within the preview dialog
- File watching / live-updating previews

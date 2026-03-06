# Hover Preview for `view` Tool Call

## Problem

In the CoC chat SPA, `view` tool call rows display file paths (e.g. `view D:\projects\shortcuts\.vscode\tasks\...`) but require expanding (clicking) to see the file content. The `task` tool already has hover-to-preview via `ToolResultPopover`, but `view` does not. Users want a quick hover preview — especially for `.md` files — without expanding the tool call card.

## Approach

Extend the hover popover system in `ToolCallView.tsx` to support `view` tool calls. For markdown files, render the popover content as formatted markdown; for other files, show a code preview with line numbers. The file content already exists in `toolCall.result`, so no API call is needed.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx` | Main tool call component; hover logic + `ViewToolView` |
| `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx` | Portal-based hover popover (currently `task`-only) |
| `packages/coc/src/server/spa/client/react/processes/MarkdownView.tsx` | Reusable markdown renderer with hljs |
| `packages/coc/src/server/spa/client/markdown-renderer.ts` | `renderMarkdownToHtml()` function |
| `packages/coc/src/server/spa/client/react/shared/FilePreview.tsx` | Existing React file hover preview (reference implementation) |

## Tasks

### 1. Extend hover eligibility in `ToolCallView.tsx`

- [x] Done

Currently (lines 359–360):
```ts
const isTaskTool = name === 'task';
const hasHoverResult = isTaskTool && !!resultText;
```

Change to also include `view`:
```ts
const hasHoverResult = (name === 'task' || name === 'view') && !!resultText;
```

### 2. Enhance `ToolResultPopover` for `view`-specific rendering

- [x] Done

The popover currently renders raw `<pre><code>` for all results. Add a new mode for `view` tool calls:

- Accept a new optional prop: `toolName?: string` and `args?: Record<string, any>`
- Detect markdown files by extension (`.md`, `.markdown`, `.mdx`) from `args.path`
- **Markdown files:** render with `renderMarkdownToHtml()` inside a `markdown-body` container + trigger `hljs` highlighting
- **Code files:** render with line-number gutter (reuse the pattern from `ViewToolView` lines 298–313, parsing `N. content` format)
- Keep existing raw-text behavior for `task` tool (no breaking change)

### 3. Pass `toolName` and `args` from `ToolCallView` to `ToolResultPopover`

- [x] Done

Update the popover invocation (line 518–524) to forward tool metadata:
```tsx
<ToolResultPopover
    result={resultText}
    toolName={name}
    args={argsObj}
    anchorRect={anchorRect}
    onMouseEnter={handlePopoverMouseEnter}
    onMouseLeave={handlePopoverMouseLeave}
/>
```

### 4. Add tests

- [x] Done

- Unit test that `view` tool calls with a `.md` result render the markdown popover
- Unit test that `view` tool calls with a `.ts` result render the code preview popover
- Unit test that `task` tool calls still render the existing raw-text popover (regression)
- Unit test hover eligibility: `view` and `task` show popover; `edit`, `grep` etc. do not

## Design Notes

- **No API call needed:** The `view` result is already in `toolCall.result`, unlike `FilePreview.tsx` which fetches from the workspace API. The popover renders from in-memory data.
- **Markdown detection:** Use `FilePreview.tsx`'s pattern — check file extension from `args.path` against `{md, markdown, mdx}`.
- **Popover size:** Keep the existing 600px × 300px popover. Markdown content gets `overflow-y: auto` scrolling.
- **Code preview line parsing:** Reuse `ViewToolView`'s `N. content` regex to extract line numbers from the result string.
- **No breaking changes:** The `task` tool popover behavior remains identical. New props are optional.

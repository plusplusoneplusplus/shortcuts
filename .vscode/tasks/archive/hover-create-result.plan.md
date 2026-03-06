# Plan: Hover Viewing for Create File Tool Results

## Problem

When the CoC dashboard displays a `create` tool call result (e.g. creating `pin-support.spec.md`), hovering over the tool call header does **not** trigger any popover. The `create` tool is excluded from the `hasHoverResult` check in `ToolResultPopover.tsx` and from the list of tools that activate the hover popover in `ToolCallView.tsx`. Users must click to expand to see the created file's content.

## Proposed Approach

Add a dedicated hover popover variant for `create` tool results, analogous to the existing `view` tool popover. On hover, show the created file's content (`args.file_text`) as a syntax-highlighted code block, with the file path as a header and language inferred from the file extension.

---

## Files to Modify

| File | Change |
|---|---|
| `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx` | Add `create` to `hasHoverResult` check; add `CreateResultPopoverContent` component |
| `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx` | Add `create` to the tools that wire up hover handlers on the summary header |

---

## Implementation Tasks

### 1. Add `CreateResultPopoverContent` in `ToolResultPopover.tsx`

- Add a new component `CreateResultPopoverContent({ args })` that renders:
  - Header row: file icon + full `args.path`
  - Code block: `args.file_text` content, language inferred from extension (e.g. `.ts` → `typescript`, `.md` → `markdown`)
  - Scrollable container with max-height (same style as `ViewToolView` popover)
- Dispatch to this component when `toolName === 'create'` inside the popover content switch/if-else.

### 2. Include `create` in `hasHoverResult` check in `ToolResultPopover.tsx`

- The current guard is: `name === 'task' || name === 'view' || name === 'bash' || name === 'glob' || name === 'grep'`
- Add `|| name === 'create'` so the popover is activated for create tool calls.

### 3. Wire hover handlers on the `create` summary header in `ToolCallView.tsx`

- The hover `mouseenter`/`mouseleave` handlers are only attached when the tool is in the hover-eligible list.
- Add `'create'` to that list so the 300 ms delay trigger is applied to the create header row.

### 4. Handle edge case: no `file_text`

- If `args.file_text` is missing or empty (e.g. binary create or server-side-only record), fall back to displaying the result string as a plain `<pre>` block, or show a "No preview available" message.

---

## Design Notes

- **Language detection:** parse the extension from `args.path` (e.g. `pin-support.spec.md` → `md`). Map common extensions to highlight language names. Reuse any existing `inferLanguage` helper if present, otherwise add a small local utility.
- **Scroll:** cap the popover code block at `max-height: 400px; overflow-y: auto` to match other popovers.
- **No backend changes needed** — `args.file_text` is already present on the `ClientToolCall` object that arrives via the existing SSE/WebSocket stream.

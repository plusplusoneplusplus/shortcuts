# Hover on Task Tool to View Final Result

## Problem

In the CoC chat UI, when an assistant message contains a `task` tool call (e.g., `task [explore] Explore generate task dialog 23.4s`), the only way to see the final result is to click and expand the tool call body. This requires extra clicks and disrupts the reading flow.

## Proposed Approach

Add a hover popover/tooltip on the `task` tool call header row that shows a preview of the task's final result text. This gives users a quick glance at what the sub-agent produced without needing to expand the full tool call.

## Design

- **Trigger**: Mouse hover on the task tool call header row (the line with status icon, "task", summary, duration)
- **Content**: The `toolCall.result` text, rendered as markdown (or plain text with a reasonable max height)
- **Max preview**: Truncate at ~2000 chars with a "… (hover to expand or click to see full)" indicator
- **Popover style**: Use a floating popover (not native `title` tooltip) so it can render rich content, scroll, and have adequate width
- **Delay**: ~300ms hover delay before showing (avoid flicker on casual mouse movement)
- **Dismiss**: Hide on mouse leave (with small grace period for moving into the popover)
- **Scope**: Only for `task` tool calls that have a non-empty `result` field
- **Fallback**: If `result` is empty/missing, no hover popover (keep existing behavior)

## Implementation Todos

### 1. Create `ToolResultPopover` component ✅
- New React component in `packages/coc/src/server/spa/client/react/processes/`
- Accepts `result: string`, `anchorRef`, `visible` state
- Renders result as markdown via existing `<MarkdownView>` or as a `<pre>` block
- Positioned above or below the anchor element (prefer below, flip if near bottom)
- Styled consistently with existing card theme (`bg-[#f8f8f8] dark:bg-[#1e1e1e]`, border, shadow)
- Max height ~300px with overflow-y scroll, max width ~600px
- Truncates result at ~2000 chars

### 2. Add hover state to `ToolCallView.tsx` ✅
- Add `onMouseEnter`/`onMouseLeave` handlers on the tool call header `<div>`
- Track hover state with `useState` + `useRef` for the delay timer
- Only activate for `task` tool calls with a non-empty `result`
- 300ms delay before showing; immediate hide on leave (with ~100ms grace for popover entry)
- Pass anchor ref to popover for positioning

### 3. Wire up popover rendering in `ToolCallView.tsx` ✅
- Render `<ToolResultPopover>` conditionally when hover is active
- Use React Portal to render at document body level (avoid clipping by parent overflow)
- Position relative to the header row bounding rect

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx` | **New** — popover component |
| `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx` | Add hover logic + render popover for `task` tools |

## Notes

- The `toolCall.result` field is already available in `ToolCallView` props — no data plumbing needed
- The existing `title={summary}` on the summary span can remain (it's a different tooltip for the description text)
- Consider reusing the popover pattern from `ConversationMetadataPopover.tsx` if it exists
- No backend changes required — this is purely a client-side UI enhancement

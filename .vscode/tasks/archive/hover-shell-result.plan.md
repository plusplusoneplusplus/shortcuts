# Plan: Add Hover to Preview Shell/PowerShell Results

## Problem

In the CoC dashboard, pipeline step rows for `bash`/shell tool calls show the command and timing but offer no hover preview of the execution output (stdout). The `task` and `view` tools already have hover popovers via `ToolResultPopover`, but `bash` is explicitly excluded.

## Approach

Extend the existing hover popover infrastructure to support `bash` tool calls, rendering stdout in a terminal-style preview.

## Key Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx` | Gates hover via `hasHoverResult`; hosts popover |
| `packages/coc/src/server/spa/client/react/processes/ToolResultPopover.tsx` | Renders the hover popover content |

## Tasks

### 1. Enable hover for `bash` tool calls
**File:** `ToolCallView.tsx` ~line 359  
**Change:** Add `name === 'bash'` to the `hasHoverResult` condition:
```ts
// Before
const hasHoverResult = (name === 'task' || name === 'view') && !!resultText;
// After
const hasHoverResult = (name === 'task' || name === 'view' || name === 'bash') && !!resultText;
```

### 2. Add terminal-style rendering for bash results in popover
**File:** `ToolResultPopover.tsx` → `renderBody()`  
**Change:** Add a `bash`-specific render branch before the raw `<pre>` fallback:
- Strip ANSI escape codes from the result text
- Render in a dark-background monospace block (terminal aesthetic)
- Show the command (`args.command`) as a `$ ...` header line above the output
- Respect the existing `MAX_PREVIEW_LENGTH` truncation

### 3. Test
- Build: `cd packages/coc && npm run build`
- Verify: run a pipeline with a bash/powershell step via `coc serve`, hover over the step row, confirm popover appears with stdout content

## Notes

- There is no distinct `powershell` tool type in the ToolCall model — PowerShell commands go through the `bash` tool with the shell set appropriately. So enabling `bash` covers both.
- The existing 300ms hover delay and mouse-grace-period logic apply automatically.
- No backend changes needed — `ToolCall.result` already contains stdout for bash calls.

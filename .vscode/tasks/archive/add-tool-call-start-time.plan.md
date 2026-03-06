# Plan: Add Tool Call Start Time to Tool Call Row

## Problem

In the chat ASSISTANT panel, each tool call row shows a duration (e.g. `66ms`) on the right side.
The area to the left of the duration (red box in the screenshot) is empty.
We want to display the **tool call start time** in that slot.

## Proposed Approach

Add a `formatStartTime` helper in `ToolCallView.tsx` that formats `toolCall.startTime` as a
human-readable time string. Render it between the summary and the duration, separated visually
so it doesn't crowd the tool name / args.

**Format decision:** UTC with `Z` suffix (per user request), e.g. `07:07:28Z`.

---

## File to Change

**`packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`**

This is the only file that needs to change.

---

## Implementation Steps

### 1. Add `formatStartTime` helper (near `formatDuration`)

```ts
function formatStartTime(startTime?: string): string {
    if (!startTime) return '';
    const d = new Date(startTime);
    if (isNaN(d.getTime())) return '';
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}Z`;
}
```

### 2. Compute `startTimeLabel` in the component body (near line 341)

```ts
const startTimeLabel = formatStartTime(toolCall.startTime);
```

### 3. Render `startTimeLabel` in the row header (between summary and duration)

Current layout in the `tool-call-header` div:
```
[status] [subtool toggle?] [name] [summary?]   [duration?] [expand arrow?]
```

After change:
```
[status] [subtool toggle?] [name] [summary?]   [startTime?] [duration?] [expand arrow?]
```

Insert before the `{duration && ...}` span:

```tsx
{startTimeLabel && (
    <span className="text-[#848484] ml-auto shrink-0">{startTimeLabel}</span>
)}
{duration && (
    <span className={cn('text-[#848484] shrink-0', !startTimeLabel && 'ml-auto')}>{duration}</span>
)}
```

> **Note:** `ml-auto` pushes the group to the right; only the first of the two spans should carry
> it. The `expand arrow` span already conditionally adds `ml-auto` when there is no duration — that
> condition should be updated to also check for `startTimeLabel`:
> ```tsx
> <span className={cn('text-[#848484]', !duration && !startTimeLabel && 'ml-auto')}>
>     {expanded ? '▼' : '▶'}
> </span>
> ```

---

## Acceptance Criteria

- A UTC timestamp like `07:07:28Z` appears to the left of the duration in every tool call row that
  has a `startTime`.
- Rows without a `startTime` render exactly as before (no empty gap).
- The duration and expand arrow continue to work correctly.
- No other files are modified.

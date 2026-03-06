# Better UI Render for the `view` Tool

## Problem

The `view` tool in the CoC SPA currently falls through to the **generic renderer** in `ToolCallView.tsx` (lines 360-383). This produces two issues:

1. **ARGUMENTS section** — Dumps raw JSON (`{path, view_range}`) which is redundant with the header summary that already shows the file path and line range.
2. **RESULT section** — Renders as plain `<pre>` text. Line numbers are baked into the content as `N. ` prefixes (e.g., `22. import {`), giving no visual gutter, no separation between line numbers and code, and no border/structure.

In contrast, the `edit` tool has a polished `EditToolView` with a file path badge, structured diff gutter, and color-coded lines. The `view` tool deserves the same treatment.

## Current State

| Item | Location | Status |
|------|----------|--------|
| Generic fallback renders `view` | `ToolCallView.tsx:360-383` | Raw JSON args + plain text result |
| `EditToolView` (reference) | `ToolCallView.tsx:185-223` | Specialized: path badge + diff gutter |
| `CreateToolView` (reference) | `ToolCallView.tsx:225-243` | Specialized: path badge + bordered code |
| Header summary already extracts path + range | `getToolSummary` L85-92 | Working — shows `file.ts L22-L47` |

## Approach

Add a `ViewToolView` component (same pattern as `EditToolView`) and wire it into the body renderer alongside the existing specialized views.

**Single-file change:** `packages/coc/src/server/spa/client/react/processes/ToolCallView.tsx`

## Todos

### 1. Add `ViewToolView` component

**File:** `ToolCallView.tsx`, insert after `CreateToolView` (after line ~243)

The component receives `args` and `result`:

```tsx
function ViewToolView({ args, result }: { args: Record<string, any>; result: string }) {
    const filePath = args.path || args.filePath || '';
    const viewRange = Array.isArray(args.view_range) ? args.view_range : null;
    const startLine = viewRange?.[0] ?? 1;

    // Parse result lines — strip the "N. " prefix the view tool prepends
    const lines = useMemo(() => {
        if (!result) return [];
        return result.split('\n').map((raw) => {
            const m = raw.match(/^(\d+)\.\s(.*)$/);   // "22. import {"
            return m
                ? { num: parseInt(m[1], 10), content: m[2] }
                : { num: null, content: raw };          // fallback (dir listing, images, etc.)
        });
    }, [result]);

    const hasLineNumbers = lines.length > 0 && lines[0].num !== null;

    // File extension for a subtle language label
    const ext = filePath.split('.').pop()?.toLowerCase() || '';

    return (
        <div className="space-y-1.5">
            {/* File path + optional range badge + language tag */}
            <div className="flex items-center gap-2 text-[10px] text-[#848484]">
                {filePath && <span className="uppercase">📁 {shortenPath(filePath)}</span>}
                {viewRange && (
                    <span className="bg-[#e0e0e0] dark:bg-[#3c3c3c] text-[#1e1e1e] dark:text-[#cccccc] px-1 rounded text-[9px]">
                        L{viewRange[0]}–{viewRange[1] === -1 ? 'EOF' : `L${viewRange[1]}`}
                    </span>
                )}
                {ext && (
                    <span className="ml-auto opacity-60 text-[9px] uppercase">{ext}</span>
                )}
            </div>

            {/* Code block with gutter */}
            <div className="rounded border border-[#e0e0e0] dark:border-[#3c3c3c] overflow-hidden font-mono text-[11px] leading-[1.55]">
                {hasLineNumbers ? (
                    /* Structured gutter + code */
                    lines.map((line, i) => (
                        <div key={i} className="flex hover:bg-black/[0.03] dark:hover:bg-white/[0.03]">
                            <span className="select-none text-right pr-2 pl-1 text-[#848484] bg-[#f0f0f0] dark:bg-[#252526] min-w-[3ch] shrink-0">
                                {line.num ?? ''}
                            </span>
                            <span className="px-2 whitespace-pre-wrap break-words overflow-x-auto">{line.content}</span>
                        </div>
                    ))
                ) : (
                    /* Plain fallback (directory listing, etc.) */
                    <pre className="overflow-x-auto text-[11px] whitespace-pre-wrap break-words p-2 text-[#1e1e1e] dark:text-[#cccccc]">
                        <code>{result}</code>
                    </pre>
                )}
            </div>
        </div>
    );
}
```

Key design decisions:
- **Gutter column** — fixed-width `min-w-[3ch]`, right-aligned, muted background (`#f0f0f0` / `#252526`), non-selectable. Matches typical editor line gutter.
- **Hover highlight** — per-line `hover:bg-black/[0.03]` for scanability.
- **Line range badge** — small pill next to path showing `L22–L47` (or `L10–EOF`).
- **Language tag** — auto-detected from file extension, top-right corner, very subtle.
- **Fallback** — when result doesn't have `N. ` prefixes (e.g., directory listings), renders as a plain bordered `<pre>` like `CreateToolView`.
- **No ARGUMENTS dump** — the path and range are shown structurally; raw JSON is omitted entirely.

### 2. Wire `ViewToolView` into the body renderer

**File:** `ToolCallView.tsx`, in the expanded body section (~line 354-367)

Add a `view` branch before the generic fallback, and also pass `resultText` so the view component handles it (skip the generic result block for `view`):

```tsx
{name === 'view' && argsObj && (
    <ViewToolView args={argsObj} result={resultText} />
)}
```

Update the generic args block (line 360) to also exclude `view`:
```tsx
{name !== 'bash' && name !== 'edit' && name !== 'create' && name !== 'view' && args && (
```

Update the generic result block (line 368) to also exclude `view`:
```tsx
{name !== 'view' && resultText && (
```

### 3. Handle image results (view of image files)

The `view` tool can return base64 image data for image files. The existing `isImageDataUrl` check (line 371) handles this in the generic path. Since we're skipping the generic result block for `view`, add the image check inside `ViewToolView`:

```tsx
// Inside ViewToolView, before the code block:
if (isImageDataUrl(result)) {
    return (
        <div className="space-y-1.5">
            {filePath && (
                <div className="text-[10px] uppercase text-[#848484] mb-0.5">
                    📁 {shortenPath(filePath)}
                </div>
            )}
            <img src={result} alt={shortenPath(filePath)} className="max-w-full max-h-64 rounded border border-[#e0e0e0] dark:border-[#3c3c3c]" />
        </div>
    );
}
```

### 4. Handle result truncation

The parent already computes `visibleResult` with truncation at 5000 chars. Pass `visibleResult` (not raw `resultText`) to `ViewToolView`, or replicate the truncation inside the component. Simplest: pass the already-truncated string and let the component parse it. The `... (output truncated)` suffix line will simply appear as a non-numbered line at the bottom (fallback path in the parser).

### 5. Test

- Build: `npm run build`
- Run tests: `cd packages/coc && npm run test:run`
- Manual: open the SPA dashboard, run a process that uses `view`, verify the new rendering

## Visual Comparison

**Before (generic):**
```
ARGUMENTS
{
  "path": "...",
  "view_range": [22, 47]
}

RESULT
22. import {
23.     QueueExecutor,
...
```

**After (ViewToolView):**
```
📁 packages/coc/src/server/queue-executor-bridge.ts   [L22–L47]   ts
┌────┬──────────────────────────────────────────────┐
│ 22 │ import {                                      │
│ 23 │     QueueExecutor,                            │
│ 24 │     createQueueExecutor,                      │
│ .. │     ...                                       │
└────┴──────────────────────────────────────────────┘
```

No raw JSON, proper gutter, structured metadata.

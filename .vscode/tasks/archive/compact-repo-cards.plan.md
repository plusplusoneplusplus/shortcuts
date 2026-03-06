# Compact Repo Cards (2-Line Layout)

## Problem
Each repository card in the CoC dashboard sidebar currently renders **3 rows**:
1. Name row (dot + name + branch badge when in group)
2. Path row
3. Stats row (branch/taskCount + Pipelines count + queue status + stat counts)

This makes the list tall and requires scrolling. The goal is to collapse each card to **at most 2 lines**.

## Acceptance Criteria
- Each repo card renders in exactly 2 lines (rows) of content
- No information is lost — all existing data remains visible
- Layout is readable at existing font sizes
- Light and dark mode both look correct
- Selected state (ring) still renders properly
- Existing tests still pass

## Proposed Layout

**Line 1 — identity:** `● name  [branch]`  
**Line 2 — stats:** `path (truncated) · Pipelines: N  ✓0 ✗0 ⏗0  [⏳N] [⏸N]`

The path moves to line 2, left-aligned and truncated, followed by pipeline/queue/stat counts on the same line (right-aligned via `ml-auto` on stat counts).

If branch is not in group, it stays in line 1. If `taskCount > 0`, show `· N` after the branch on line 1 to keep line 2 clean.

## File to Change
`packages/coc/src/server/spa/client/react/repos/RepoCard.tsx`

## Subtasks
1. **Merge path + stats into one row (line 2)**
   - Move `truncPath` into the stats `<div>` as the first flex child
   - Remove the standalone path `<div>` (lines 53-59)
   - Reduce `mt-1` on stats row to `mt-0.5` to tighten spacing
2. **Keep branch/taskCount on line 1**
   - When NOT in group, show branch badge (same style as in-group badge) on line 1
   - Show `· taskCount` on line 1 after name/badge if `taskCount > 0`
3. **Reduce vertical padding**
   - Change card padding from `p-2` to `p-1.5` for tighter feel
4. **Verify tests** — run `npm run test:run` in `packages/coc`

## Notes
- `truncatePath` currently caps at 30 chars; may need to reduce to ~24 to fit alongside stats on line 2
- Queue indicators (⏳⏸) are only shown when non-zero, so they won't clutter the common case
- Do NOT remove any data; compact via layout, not removal

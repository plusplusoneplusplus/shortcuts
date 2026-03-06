# Fix: tool-call-group-header--minimal CSS class name mismatch

## Problem

The compact tool-group box (grouping `glob`/`view`/`grep` into a single collapsible row) was added in two commits:
- `d332c28f` — `ToolCallGroupView.tsx` component
- `740d8b49` — CSS for Minimal mode added to `tailwind.css`

The two commits used **inconsistent class names**:

| File | Class name applied |
|---|---|
| `ToolCallGroupView.tsx:128` | `tool-call-group-header--minimal` |
| `tailwind.css:21,27,28,32` | `tool-group-header--minimal` ← wrong |

Additionally, `tool-call-group--minimal` (applied to the outer wrapper div in `ToolCallGroupView.tsx:114`) has **no CSS rule** at all — it was referenced but never defined.

## Impact

In **Minimal mode** (`toolCompactness === 2`):
1. The CSS hover/focus-within expand shortcut never fires (selector mismatch).
2. The outer container modifier class has no effect (missing rule).

In **Compact mode** (`toolCompactness === 1`), everything works correctly — collapsing/expanding via click is purely React state and unaffected.

## Fix

### 1. Rename selectors in `tailwind.css`

File: `packages/coc/src/server/spa/client/tailwind.css`

Rename all occurrences of `.tool-group-header--minimal` → `.tool-call-group-header--minimal`:

```css
/* Before */
.tool-group-header--minimal { ... }
.tool-group-header--minimal:hover, .tool-group-header--minimal:focus-within { ... }
.dark .tool-group-header--minimal { ... }

/* After */
.tool-call-group-header--minimal { ... }
.tool-call-group-header--minimal:hover, .tool-call-group-header--minimal:focus-within { ... }
.dark .tool-call-group-header--minimal { ... }
```

### 2. Add the missing outer-wrapper rule (optional but clean)

If the `tool-call-group--minimal` class on the wrapper `<div>` is intended for future use or scoped selectors, add a minimal no-op or useful rule. Otherwise, the class can be removed from `ToolCallGroupView.tsx:114`. The plan opts to **keep the class and add a scoped rule** so child selectors can use it later:

```css
.tool-call-group--minimal {
    /* Scope anchor for minimal-mode child selectors */
}
```

## Files to change

| File | Change |
|---|---|
| `packages/coc/src/server/spa/client/tailwind.css` | Rename 3 selectors + add outer wrapper rule |

No component TypeScript changes needed. No test changes needed (existing tests don't assert CSS class names on the header).

## Verification

After the fix:
1. Build: `npm run build` — no errors
2. Set `toolCompactness` to `2` (Minimal) in the Display settings panel
3. Trigger a conversation turn with multiple consecutive `glob`/`view` calls
4. The group box header should collapse to a single stripe; hovering over it should expand without clicking
5. Test `npm run test:run` in `packages/coc` — all existing tests should pass

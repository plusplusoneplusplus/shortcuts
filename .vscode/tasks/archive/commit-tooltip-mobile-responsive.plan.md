# Commit Tooltip Mobile Responsiveness Fix

## Problem

On mobile, tapping a commit row in the CoC Git tab causes the `CommitTooltip` to appear and **stay permanently visible**, overlaying the commit history list. Screenshot confirms the tooltip covers the first commit card with full author/date/hash/body detail.

**Root cause:** On iOS/touch browsers, `mouseleave` is not reliably fired after a tap. The flow is:
1. User taps a row → browser synthesizes `mouseenter` → 1000 ms timer starts.
2. `mouseleave` is **never fired** by iOS after the tap ends.
3. After 1000 ms the tooltip renders at `position: fixed`.
4. No subsequent event dismisses it.

**Secondary issue:** The tooltip is positioned to the right of the row (`left = anchorRect.right + 8`). On mobile the left panel is full-width, so `anchorRect.right ≈ viewportWidth`. The overflow-guard clamps it back to `viewportWidth - tooltipWidth - 8`, making the tooltip **overlap the commit list** rather than sit beside it.

## Relevant Files

| File | Role |
|------|------|
| `packages/coc/src/server/spa/client/react/repos/CommitTooltip.tsx` | Tooltip component — `position: fixed`, positioned to the right of anchor |
| `packages/coc/src/server/spa/client/react/repos/CommitList.tsx` | Renders tooltip; registers `mouseenter`/`mouseleave` on commit rows with 1000 ms delay |

## Acceptance Criteria

- [ ] On touch/mobile devices the hover tooltip **never appears** (no tap-triggered sticky tooltip).
- [ ] On desktop (pointer: fine / hover: hover) the tooltip behaviour is **unchanged**.
- [ ] No regression in CommitList click/selection/expand behaviour on any device.
- [ ] Existing CommitList and CommitTooltip tests continue to pass.

## Approach

Use the CSS `(hover: none)` media query (via `window.matchMedia`) to detect touch-only pointers and skip registering `mouseenter`/`mouseleave` on commit rows.

Specifically in `CommitList.tsx`:

```ts
// At module or component level
const isTouchOnly = () =>
    typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
```

Then guard the handlers:

```tsx
onMouseEnter={isTouchOnly() ? undefined : (e) => handleRowMouseEnter(commit, e)}
onMouseLeave={isTouchOnly() ? undefined : handleRowMouseLeave}
```

This is a one-line-per-handler surgical change. No new state, no new hooks, no behaviour change on desktop.

## Subtasks

1. **Investigate** — confirm the `(hover: none)` condition correctly identifies the affected mobile viewport in the CoC SPA (check any existing `useMediaQuery` hook or Tailwind breakpoint utilities already in the codebase).
2. **Implement** — add `isTouchOnly` guard to `onMouseEnter`/`onMouseLeave` in `CommitList.tsx`.
3. **Verify tooltip still dismissed** — ensure that if somehow a tooltip was shown (e.g. real mouse on a hybrid device switches to touch), it can still be closed. If needed, add a `touchstart` document listener that calls `setHoveredCommit(null)`.
4. **Test** — run `npm run test:run` in `packages/coc` and verify no regressions.

## Notes

- `(hover: none)` matches touch-only devices; `(hover: hover)` matches devices with a fine pointer (mouse, trackpad). Hybrid (pen + touch) devices with a mouse also match `hover: hover`, so the tooltip remains available for them.
- An alternative approach is checking `navigator.maxTouchPoints > 0`, but `(hover: none)` is more semantically correct and avoids issues with Windows hybrid laptops where touch is present but a mouse is primary.
- The `CommitTooltip` positioning logic (`anchorRect.right + 8`) is fine for desktop. No change needed there — once the tooltip is suppressed on mobile, the overflow-guard code becomes irrelevant for that case.
- Do **not** suppress the tooltip using CSS `display: none` at a breakpoint — the React state would still accumulate and the component would still mount/unmount unnecessarily.

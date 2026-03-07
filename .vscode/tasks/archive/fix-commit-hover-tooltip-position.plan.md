# Fix: Commit Hover Tooltip Should Float Over Right Panel

## Problem

Commit `531124c7` misinterpreted the requirement. The user wanted the **hover tooltip** (shown when hovering over a commit row in the left panel) to **appear floating over the right panel**, not to embed the commit metadata as a permanent header inside the right panel (`CommitDetail`).

Currently:
1. `CommitDetail` shows a metadata header (subject, author, date, hash, parents, body) at the top of the right panel — **this should be removed**.
2. `CommitTooltip` is positioned using `left: anchorRect.left`, placing it in the left panel area — **it should float over the right panel** instead.
3. The left panel was widened from 320px to 400px as part of the wrong change — **this should be reverted** to 320px.

## Goal

- Hovering a commit row in the left panel shows `CommitTooltip` **positioned over the right panel** (to the right of the left panel, aligned with the hovered row vertically).
- The right panel (`CommitDetail`) shows **only the diff** — no metadata header.

---

## Approach

### 1. Revert `CommitDetail.tsx` — Remove metadata header

Remove all additions from commit `531124c7`:
- Remove optional props: `subject`, `author`, `date`, `parentHashes`, `body` from `CommitDetailProps`.
- Remove the `{hasMetadata && (...)}` block rendering author, date, hash, parents, body.
- Remove related state: `copied`, `bodyExpanded`, `bodyLines`, `bodyNeedsCollapse`, `displayedBody`, `formattedDate`, `handleCopyHash`.
- Remove `copyToClipboard` import (if no longer used after removal).
- The component returns to its pre-531124c7 shape: just the file-path label + diff viewer.

### 2. Revert `RepoGitTab.tsx` — Stop passing metadata props to CommitDetail

In the `detailPanel` JSX, the `CommitDetail` for `type === 'commit'` currently passes:
```tsx
subject={...} author={...} date={...} parentHashes={...} body={...}
```
Remove these extra props. `CommitDetail` only needs `workspaceId`, `hash`, and optionally `filePath`.

Revert the left panel width from `lg:w-[400px]` back to `lg:w-[320px]`.

### 3. Update `CommitTooltip.tsx` — Reposition over the right panel

**Current positioning:**
```ts
let top = anchorRect.bottom + 4;
const left = anchorRect.left;         // ← left edge of commit row (inside left panel)
```

**New positioning — align with hovered row, appear to the RIGHT of the left panel:**
```ts
let top = anchorRect.top;             // align tooltip top with the hovered row
const left = anchorRect.right + 8;   // start just right of the left panel's edge
```

Add horizontal overflow guard so the tooltip doesn't go off-screen:
```ts
const viewportW = window.innerWidth;
const finalLeft = Math.min(left, viewportW - tooltipWidth - 8);
setPosition({ top: finalTop, left: finalLeft });
```

Vertical overflow guard should remain (flip upward if near viewport bottom).

Optionally increase tooltip width from 320px to 360-400px since it now floats over the right panel.

### 4. Update Tests

Files affected:
- `packages/coc/test/spa/react/CommitDetail.test.ts` — Remove tests for metadata header fields (`commit-info-header`, `commit-info-subject`, `commit-info-author`, `commit-info-date`, `commit-info-hash`, `commit-info-parents`, `commit-info-body`, `commit-info-body-toggle`).
- `packages/coc/test/spa/react/RepoGitTab.test.ts` — Remove tests that assert metadata props are passed to `CommitDetail`, revert panel width assertions.

---

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` | Remove metadata header section and associated props/state |
| `packages/coc/src/server/spa/client/react/repos/RepoGitTab.tsx` | Remove metadata props from CommitDetail call; revert panel width to 320px |
| `packages/coc/src/server/spa/client/react/repos/CommitTooltip.tsx` | Change positioning: `left = anchorRect.right + 8`, `top = anchorRect.top`; add viewport width guard |
| `packages/coc/test/spa/react/CommitDetail.test.ts` | Remove tests for metadata header |
| `packages/coc/test/spa/react/RepoGitTab.test.ts` | Remove tests for metadata props passed to CommitDetail |

---

## Notes

- `CommitTooltip` already uses `position: fixed` and `z-50`, so it correctly escapes parent `overflow` clipping — only the x/y anchor coordinates need changing.
- The tooltip content (subject, author, date, hash, copy button, body) is already fully implemented in `CommitTooltip.tsx` — no content changes needed there.
- The right panel diff-only view was the original design and must be restored.

# Plan: Remove Comment Category Symbols from Markdown Review Editor

## Problem

In the CoC markdown review editor (SPA), the comment UI exposes a category picker
(Bug 🐛 / Question ❓ / Suggestion 💡 / Praise 🌟 / Nitpick 🔍 / General 💬) in two places:

1. **Add-comment dialog** — a row of category selector buttons at the top of `InlineCommentPopup`.
2. **Comment sidebar** — a row of category filter chips and per-card category icons in `CommentSidebar` / `CommentCard`.

These are not needed and should be removed from the UI entirely.

## Approach

Remove the category UI from both surfaces. The underlying `TaskCommentCategory` data type and
`CATEGORY_INFO` definitions are kept intact (existing stored data retains its category field),
but nothing is shown or selectable by the user.

All changes are confined to the CoC SPA under
`packages/coc/src/server/spa/client/react/tasks/comments/`.

---

## Files to Change

### 1. `InlineCommentPopup.tsx`
- Remove the `category` state (`useState<TaskCommentCategory>('general')`).
- Remove the category selector `<div>` block (the `{ALL_CATEGORIES.map(...)}` section).
- Hard-code `'general'` as the category argument passed to `onSubmit` (the callback signature stays the same so no other files need to change).
- Remove the now-unused imports: `CATEGORY_INFO`, `ALL_CATEGORIES` (keep `TaskCommentCategory` if still referenced in the prop type).

### 2. `CommentSidebar.tsx`
- Remove the `categoryFilter` state and its `CategoryFilter` type.
- Remove the second `showFilters` block (the category icon filter chips, lines 169–203).
- Update the `filtered` memo to drop the `categoryFilter !== 'all'` condition so filtering is purely by status.
- Remove now-unused imports: `CATEGORY_INFO`, `ALL_CATEGORIES`, `getCommentCategory`.

### 3. `CommentCard.tsx`
- In the card header, remove the category icon `<span>` (`<span className="text-[10px]..." title={info.label}>{info.icon}</span>`).
- Remove the `info` variable and `category` variable if they are no longer referenced elsewhere in the component.
- Remove now-unused imports: `CATEGORY_INFO`, `getCommentCategory`, `TaskCommentCategory` (if no longer used).

---

## Notes

- The `onSubmit` prop signature of `InlineCommentPopup` (`(text, category) => void`) does **not** change — callers pass it through as-is; the popup simply always submits `'general'`.
- No backend/API changes are needed.
- Existing tests that assert category button presence (e.g., `data-testid="popup-category-*"`, `data-testid="category-filter-*"`) will need to be updated/removed.

---

## Test Files to Update

Search for and update any test files referencing:
- `popup-category-` testids in `InlineCommentPopup` tests
- `category-filter-` testids in `CommentSidebar` tests
- Category icon assertions in `CommentCard` tests

Location: `packages/coc/src/server/spa/client/react/tasks/comments/__tests__/` (or similar).

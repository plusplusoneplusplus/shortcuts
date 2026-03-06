# Section Copy Button in Assistant Response

## Problem

The assistant message bubble has a single "copy entire message" button that appears on hover.
When a response contains multiple H2/H3 sections (e.g. **Why `tool: undefined`?** and **Plan: 5 High-Impact E2E Regression Commits**), users cannot copy just one section.
Add a per-section copy button that appears on hover over each heading, mirroring the UX of the existing whole-message copy button.

## Acceptance Criteria

- [x] Each rendered H2 (and optionally H3) inside an assistant bubble shows a small copy icon on hover.
- [x] Clicking the icon copies the section's markdown text (from the heading line through the last line before the next same-or-higher-level heading) to the clipboard.
- [x] The icon shows a ✓ checkmark for ~1.5 s after a successful copy, then reverts.
- [x] The button is visually consistent with the existing `bubble-copy-btn` (same colour, opacity-0 → opacity-100 on hover, same icon `📋`/`✓`).
- [x] The button does **not** appear when the bubble is in "raw" view mode.
- [x] No regressions to the existing whole-message copy button.
- [x] Works in both light and dark themes.

## Approach

### Option A — CSS + JS injection in `MarkdownView` (preferred)
1. After `MarkdownView` renders its HTML into the DOM, inject copy buttons adjacent to each `<h2>` / `<h3>` element using a `useEffect`.
2. Extract per-section markdown by slicing `turn.content` based on heading positions.
3. Wire click handlers via React event delegation or refs.

### Option B — Pre-process HTML at render time
1. In `chatMarkdownToHtml`, wrap each section `<h2>…next-h2` block in a `<section>` with a `data-md-section` attribute containing the raw markdown slice.
2. `MarkdownView` renders a thin React wrapper that reads `data-md-section` and renders a `<CopySectionBtn>` per heading.

Option A is simpler but relies on DOM mutation. Option B is cleaner (pure React) but requires changes to the markdown pipeline.

**Recommendation:** Start with Option B for clean separation of concerns.

## Subtasks

1. **Extract section slices** — Write a utility `splitMarkdownSections(content: string): { heading: string; body: string }[]` in `packages/coc/src/server/spa/client/react/utils/format.ts`.
2. **Augment `chatMarkdownToHtml`** — Wrap each section in `<section data-section-md="...">` so the heading and its content are self-contained.
3. **Create `CopySectionBtn` component** — Small React component (in `processes/`) that reads `data-section-md` and handles copy + transient ✓ state.
4. **Update `MarkdownView`** — After `dangerouslySetInnerHTML`, post-process rendered headings to portal in `CopySectionBtn` nodes (or switch to a React-parsed approach).
5. **Styling** — Ensure the button is `position: absolute` relative to the heading container, right-aligned, opacity-0 → opacity-100 on hover.
6. **Tests** — Add Vitest unit tests for `splitMarkdownSections`.

## Files Likely Changed

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/utils/format.ts` | Add `splitMarkdownSections` |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Pass per-section data to `MarkdownView` |
| `packages/coc/src/server/spa/client/react/processes/MarkdownView.tsx` | Render section copy buttons |
| `packages/coc/src/server/spa/client/react/processes/CopySectionBtn.tsx` | New component |

## Notes

- The existing copy button copies `turn.content` (raw markdown). Section copy should also copy raw markdown, not the rendered HTML, so pasting into a chat preserves formatting.
- Heading detection should handle both `## Heading` and `### Sub-heading` (decide whether H3 also gets a button — default yes).
- For streaming turns, section boundaries shift as new text arrives; consider disabling section-level copy while `turn.streaming === true`.
- `copyToClipboard` utility already exists in `format.ts` — reuse it.

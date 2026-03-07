# Copy Button: Copy Entire Article Instead of Individual H2/H3 Section

## Problem

In `ConversationTurnBubble`, `MarkdownView` renders a 📋 copy button via `CopySectionBtn` portals — one per H2/H3 heading. These buttons are positioned `absolute right: 0, top: 50%` inside the heading element, which spans the full container width. As a result, the button on the **first** H2 heading appears at the **top-right of the content area** and looks like an "article copy" button. But it only copies that one section's markdown.

Users expect clicking this button to copy the **entire article**, not just a subsection.

## Proposed Approach

Replace the per-heading copy button scheme with a **single copy button** on the first H2/H3 heading (or at the top of the content), which copies the **full article markdown** (all sections concatenated). This matches user mental model: one button at the top-right → copies everything.

### Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/MarkdownView.tsx` | Add optional `fullMarkdown` prop. Only portal one `CopySectionBtn` (on the first heading), passing `fullMarkdown` (or all sections joined) instead of section-specific markdown. |
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Pass `fullMarkdown={turn.content ?? ''}` to `<MarkdownView>`. |
| `packages/coc/src/server/spa/client/react/processes/CopySectionBtn.tsx` | Update `title` attribute: "Copy to clipboard" (was "Copy section to clipboard"). Prop name can stay `sectionMarkdown` or be renamed to `markdown` — keep minimal. |

### MarkdownView Logic (new)

```tsx
// Old: portal per heading (copies that section only)
headings.forEach((headingEl, i) => {
    portals.push({ element: el, markdown: sec.heading + '\n' + sec.body });
});

// New: portal on FIRST heading only (copies full article)
if (headings.length > 0) {
    const firstEl = headings[0] as HTMLElement;
    firstEl.style.position = 'relative';
    firstEl.classList.add('group/section');
    const fullText = fullMarkdown ?? sectionsWithHeading
        .map(s => s.heading + (s.body ? '\n' + s.body : ''))
        .join('\n\n');
    portals.push({ element: firstEl, markdown: fullText, key: 'article-copy' });
}
```

## Tasks

- **t1** — `MarkdownView.tsx`: Add `fullMarkdown?: string` prop; change portal logic to single first-heading button using full content.
- **t2** (depends t1) — `ConversationTurnBubble.tsx`: Pass `fullMarkdown={turn.content ?? ''}` to `<MarkdownView>`.
- **t3** (depends t2) — Update tests: any assertions expecting per-section copy should now expect full-content copy.

## Out of Scope

- The `bubble-copy-btn` in the header row (already copies `turn.content`) — no change needed.
- `WikiComponent.tsx` — no copy buttons; no change.
- deep-wiki static site copy buttons on code blocks — unrelated.

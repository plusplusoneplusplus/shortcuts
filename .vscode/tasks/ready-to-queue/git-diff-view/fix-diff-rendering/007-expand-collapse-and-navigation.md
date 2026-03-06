---
status: pending
---

# 007: Expand/collapse interaction and navigation updates

## Summary

Add interactive expand/collapse behavior to the "Show N hidden lines" placeholders rendered by commits 005/006. Clicking a collapsed section expands the hidden context lines inline, with state tracking and correct split-view dual-pane synchronization. Navigation (`scrollToFirstChange`, prev/next) is verified and hardened for hunk-based rendering.

## Motivation

After commits 005/006, collapsed sections display "Show N hidden lines" placeholders with `data-hunk-index` attributes but no click handlers. Without this commit, hunk-based rendering is visually complete but non-interactive — users cannot reveal collapsed context, which defeats the purpose of the folding feature. This commit closes the interactivity gap and ensures all navigation paths work correctly with the new DOM structure.

## Changes

### Files to Create
- (none)

### Files to Modify
- `src/shortcuts/git-diff-comments/webview-scripts/state.ts` — add expanded-hunk state tracking
- `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` — store full aligned array, implement expand handler, harden `scrollToFirstChange`
- `src/shortcuts/git-diff-comments/webview-scripts/main.ts` — wire click event delegation for expand buttons

### Files to Delete
- (none)

## Implementation Notes

### 1. State tracking (`state.ts`)

**Add `expandedHunks` to `AppState`:**

```typescript
// In the AppState interface (after isInteracting, ~line 37):
/** Set of hunk indices that have been expanded by the user */
expandedHunks: Set<number>;
```

`Set<number>` is not spread-safe (the `updateState` spread `{ ...state, ...updates }` would overwrite the reference, which is fine). However, because `Set` is mutable and shared, dedicated accessor functions are cleaner than going through `updateState`.

**Add to `createInitialState()` return (~line 68–84):**

```typescript
expandedHunks: new Set<number>(),
```

**Add three exported helpers (after `endInteraction`, ~line 278):**

```typescript
export function isHunkExpanded(index: number): boolean {
    return state.expandedHunks.has(index);
}

export function toggleHunkExpanded(index: number): void {
    if (state.expandedHunks.has(index)) {
        state.expandedHunks.delete(index);
    } else {
        state.expandedHunks.add(index);
    }
}

export function resetExpandedHunks(): void {
    state.expandedHunks = new Set<number>();
}
```

`resetExpandedHunks()` is called on re-render (new content) so stale indices don't persist across file switches.

### 2. Store full aligned array (`diff-renderer.ts`)

**Add module-level storage (near `alignedDiffInfo`, ~line 25–31):**

```typescript
/** Full LCS-aligned lines for the current render — used by expand handler to retrieve hidden context */
let fullAlignedLines: AlignedLine[] = [];
```

**Populate in `renderSplitDiff()` (~line 396, after `backtrackLCS`):**

```typescript
const aligned = backtrackLCS(oldLines, newLines, dp, ignoreWhitespace);
fullAlignedLines = aligned; // store for expand handler
```

**Populate in `renderInlineDiff()` (~line 606, after `backtrackLCS`):**

```typescript
const aligned = backtrackLCS(oldLines, newLines, dp, ignoreWhitespace);
fullAlignedLines = aligned; // store for expand handler
```

Both renderers already compute `aligned` — this is a single assignment, no new computation.

### 3. Expand handler (`diff-renderer.ts`)

**New exported function `expandCollapsedSection(hunkIndex: number)`:**

```typescript
export function expandCollapsedSection(hunkIndex: number): void
```

Algorithm:

1. **Find the placeholder(s)** in DOM using `document.querySelectorAll(\`.collapsed-section[data-hunk-index="${hunkIndex}"]\`)`. In split view there are two (one in `#old-content`, one in `#new-content`); in inline view there is one in `#inline-content`.

2. **Determine the hidden line range.** The collapsed section sits between two hunks. The `data-hunk-index` attribute identifies which inter-hunk gap this placeholder represents. To find the corresponding `AlignedLine[]` range:
   - The hunk grouping logic (commit 003's `groupIntoHunks`) assigns sequential indices to collapsed gaps. The placeholder with `data-hunk-index=N` maps to the Nth collapsed gap in the original hunk array.
   - Alternative (more robust): store `data-start-aligned-index` and `data-end-aligned-index` on the placeholder in commits 005/006 (the DOM helpers in commit 004). These give exact offsets into `fullAlignedLines`. This is the **preferred approach** — it avoids re-deriving the hunk structure.
   - If those attributes exist, the hidden lines are `fullAlignedLines.slice(startIdx, endIdx + 1)`.

3. **Create DOM elements for each hidden line.** For split view, use `createLineElement()` (old side) and `createLineElement()` / `createEmptyLineElement()` (for alignment). For inline view, use `createInlineLineElement()`. Reuse `getHighlightedLines()` (cached) for syntax highlighting.

4. **Replace placeholder.** Create a `DocumentFragment`, append all new line elements, then `placeholder.replaceWith(fragment)`. In split view, do this for BOTH panes simultaneously — the old-pane placeholder and new-pane placeholder must be replaced in the same operation to maintain scroll-sync alignment.

5. **Mark expanded in state:** `toggleHunkExpanded(hunkIndex)`.

6. **Update comment indicators on newly visible lines:** call `updateCommentIndicators()` — it re-scans all visible lines, so newly inserted lines get indicators automatically.

**Split-view dual-pane expansion detail:**

In split view, the collapsed section placeholder exists in BOTH `#old-content` and `#new-content`. The expand handler must:
- Query both containers for matching `data-hunk-index`.
- Build old-side and new-side fragments in parallel (iterating the same `AlignedLine[]` slice).
- Replace both placeholders before any scroll event fires (use a single synchronous block — no `requestAnimationFrame` between the two replacements).

This ensures the two panes stay aligned. Since `setupScrollSync` listens for scroll events (not mutation events), inserting DOM nodes synchronously won't trigger mis-alignment.

**Collapse-back (re-collapse) — not in this commit:**

For simplicity, expanded sections stay expanded until the next re-render. `toggleHunkExpanded` supports toggling but no "re-collapse" UI button is added here. A follow-up commit could add a "Collapse" button to each expanded section header.

### 4. Harden `scrollToFirstChange()` (`diff-renderer.ts`, lines 756–785)

Current implementation queries DOM for `.line-added` / `.line-deleted`. With hunk-based rendering, the first change is always inside a hunk (never collapsed), so the query still finds it. However, add a fallback for edge cases where all changes happen to be in a collapsed section (unlikely but defensive):

```typescript
// After the existing querySelector for .line-added / .line-deleted:
// Fallback: if no change found in DOM (all collapsed?), scroll to first hunk header
if (!firstChange) {
    const firstHunkHeader = container.querySelector('.hunk-separator');
    if (firstHunkHeader) {
        (firstHunkHeader as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
```

Apply this pattern in both the inline and split branches of `scrollToFirstChange()`.

### 5. Event delegation (`main.ts`)

**Add a new setup function called from `initialize()`:**

```typescript
// In initialize(), after setupDiffNavigation() (~line 65):
setupExpandCollapseHandlers();
```

**New function `setupExpandCollapseHandlers()`:**

```typescript
function setupExpandCollapseHandlers(): void {
    // Use event delegation on the diff view container to handle expand clicks
    // This survives re-renders since we listen on the static parent
    const diffContainer = document.querySelector('.diff-view-container');
    if (!diffContainer) return;

    diffContainer.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;

        // Check if click is on the expand button or its parent collapsed-section
        const expandBtn = target.closest('.expand-btn');
        const collapsedSection = target.closest('.collapsed-section');

        const section = expandBtn?.closest('.collapsed-section') || collapsedSection;
        if (!section) return;

        const hunkIndex = (section as HTMLElement).dataset.hunkIndex;
        if (hunkIndex === undefined) return;

        e.preventDefault();
        e.stopPropagation();

        expandCollapsedSection(parseInt(hunkIndex, 10));
    });
}
```

Uses event delegation on the static `.diff-view-container` parent, so handlers survive DOM replacement during re-renders. The handler checks for clicks on `.expand-btn` or `.collapsed-section` and extracts `data-hunk-index`.

**Import `expandCollapsedSection` from `diff-renderer.ts`:**

```typescript
// Update the import at line 5:
import { ..., expandCollapsedSection } from './diff-renderer';
```

### 6. Navigation verification (`navigateToDiff` in `main.ts`, lines 835–986)

**Key insight: changes are never in collapsed sections.** The hunk grouping algorithm (commit 003) defines hunks as groups of consecutive change lines (additions/deletions) plus surrounding context lines. Only the context lines _between_ hunks are collapsed. Therefore:
- All `.line-added` / `.line-deleted` elements are always in the DOM (inside hunks).
- `navigateToDiff()` finds change blocks by querying DOM for change-class elements — this continues to work correctly.
- No changes needed to `navigateToDiff()`.

**Verification to perform during implementation:**
1. Render a diff with multiple hunks.
2. Confirm prev/next navigation (Shift+Up/Down and buttons) correctly cycles through all change blocks.
3. Confirm that collapsed sections are skipped during navigation (they contain no changes, so they're naturally skipped).

### 7. Reset on re-render

In `handleMessage` (main.ts, ~line 100–149), when content changes trigger a re-render:

```typescript
// Before renderDiff() call in the 'update' case (~line 121):
resetExpandedHunks();
```

Import `resetExpandedHunks` from state.ts. This ensures stale expanded-hunk indices don't persist when the file changes.

Also call `resetExpandedHunks()` at the start of both `renderSplitDiff()` and `renderInlineDiff()` in diff-renderer.ts — this is the belt-and-suspenders approach since `renderDiff()` may be called from multiple paths (view mode toggle, whitespace toggle, etc.).

### Data attribute contract (from commit 004/005/006)

The collapsed section placeholder created by `createCollapsedSectionElement(count, hunkIndex)` has:
- Class: `.collapsed-section`
- Attribute: `data-hunk-index` = sequential gap index
- Child: `.expand-btn` with text "Show N hidden lines"
- **To add (or confirm exists from 005/006):** `data-start-aligned-index` and `data-end-aligned-index` — exact offsets into `fullAlignedLines` for the hidden range

If commits 005/006 did NOT add the start/end aligned index attributes, the expand handler must instead re-derive the range by re-running hunk grouping on `fullAlignedLines` and finding the gap at the given `hunkIndex`. This is slightly more expensive but avoids coupling to DOM attributes. The preferred approach is to add the attributes in the `createCollapsedSectionElement()` call during rendering (a small addition to the 005/006 render loops).

## Tests

- **Expand inline view:** Click collapsed section placeholder → hidden context lines appear in DOM, placeholder is removed, lines have correct syntax highlighting and line numbers
- **Expand split view:** Click collapsed section in either pane → both `#old-content` and `#new-content` expand simultaneously, alignment is preserved
- **Comment indicators on expanded lines:** Expand a section containing lines with comments → comment indicators and highlight colors appear correctly
- **Re-render resets state:** Change content (simulate `update` message) → all sections return to collapsed state, `expandedHunks` is empty
- **`scrollToFirstChange` with hunks:** Full-file view opens → scrolls to first change (which is inside a hunk, always visible)
- **`scrollToFirstChange` fallback:** (Edge case) If somehow no change lines in DOM → scrolls to first `.hunk-separator` instead of doing nothing
- **Prev/next navigation with hunks:** Multiple hunks rendered → Shift+Down cycles forward through change blocks, Shift+Up cycles backward, wrapping works
- **Navigation skips collapsed sections:** Collapsed sections have no change lines → navigation naturally skips them, no errors
- **Double expand is no-op:** Click same collapsed section twice → already expanded (placeholder already removed), no error thrown

## Acceptance Criteria

- [ ] Clicking a `.collapsed-section` or `.expand-btn` expands the hidden context lines in place
- [ ] Split-view expansion replaces placeholders in both panes simultaneously, maintaining alignment
- [ ] Expanded lines have correct syntax highlighting (using cached `getHighlightedLines()`)
- [ ] Expanded lines show comment indicators if comments exist on those lines
- [ ] `expandedHunks` state resets on content change / re-render
- [ ] `scrollToFirstChange()` has hunk-header fallback and works correctly with hunk-based DOM
- [ ] Prev/next navigation works correctly — all change blocks reachable, collapsed sections skipped
- [ ] Event delegation on `.diff-view-container` survives re-renders without re-attaching handlers
- [ ] No console errors during expand/collapse, navigation, or re-render
- [ ] `npm run build` succeeds

## Dependencies
- Depends on: 005, 006

## Assumed Prior State
Both `renderSplitDiff()` and `renderInlineDiff()` use hunk-based rendering (commits 005, 006). Collapsed sections are rendered with `.collapsed-section` class and `data-hunk-index` attributes. DOM helpers (`createHunkHeaderElement`, `createCollapsedSectionElement`) and CSS (`.hunk-separator`, `.collapsed-section`, `.expand-btn`) exist from commit 004. The `Hunk` interface and `groupIntoHunks()` algorithm exist from commit 003. Neither `fullAlignedLines` module-level storage nor expand/collapse click handlers exist yet — this commit adds both.

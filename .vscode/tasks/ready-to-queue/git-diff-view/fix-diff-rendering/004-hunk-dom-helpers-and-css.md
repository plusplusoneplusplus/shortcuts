---
status: pending
---

# 004: Hunk header and collapsed section DOM helpers plus CSS

## Summary

Add two DOM factory functions (`createHunkHeaderElement`, `createCollapsedSectionElement`) to `diff-renderer.ts` and their accompanying CSS rules to `diff-webview.css`. These produce detached elements for hunk separator bars and "Show N hidden lines" placeholders that later commits (005/006) will append during rendering.

## Motivation

Isolating the new DOM elements and their styling from the rendering rewrite lets reviewers focus purely on structure and visual design. The functions return detached elements — no existing rendering logic is touched.

## Changes

### Files to Create
- (none)

### Files to Modify
- `src/shortcuts/git-diff-comments/webview-scripts/diff-renderer.ts` — add `createHunkHeaderElement()` and `createCollapsedSectionElement()` DOM factory functions
- `media/styles/diff-webview.css` — add CSS rules for `.hunk-separator`, `.hunk-header-text`, `.collapsed-section`, `.collapsed-section-text`, `.expand-btn`

### Files to Delete
- (none)

## Implementation Notes

### Where to add functions in `diff-renderer.ts`

Insert both functions **after `createEmptyLineElement()` (ends at line 245) and before `normalizeLineForComparison()` (starts at line 251)**. This groups all DOM creation helpers together (`createLineElement`, `createEmptyLineElement`, `createHunkHeaderElement`, `createCollapsedSectionElement`).

Both functions need the `Hunk` type from commit 003. Import or reference it from wherever 003 placed the interface (expected to be in the same file or a shared types module). If `Hunk` is defined in `diff-renderer.ts` itself (most likely given `AlignedLine` is defined there at line 297), no import is needed.

### DOM structure: `createHunkHeaderElement(hunk: Hunk, viewMode: 'split' | 'inline'): HTMLElement`

```html
<!-- Split view variant (viewMode === 'split') -->
<div class="hunk-separator hunk-separator-split">
  <div class="hunk-header-text" title="@@ -10,7 +10,9 @@">
    @@ -10,7 +10,9 @@
  </div>
</div>

<!-- Inline view variant (viewMode === 'inline') -->
<div class="hunk-separator hunk-separator-inline">
  <div class="hunk-header-text" title="@@ -10,7 +10,9 @@">
    @@ -10,7 +10,9 @@
  </div>
</div>
```

Implementation pseudocode:
```typescript
function createHunkHeaderElement(hunk: Hunk, viewMode: 'split' | 'inline'): HTMLElement {
    const container = document.createElement('div');
    container.className = `hunk-separator hunk-separator-${viewMode}`;

    const headerText = document.createElement('div');
    headerText.className = 'hunk-header-text';
    headerText.textContent = hunk.headerText;
    headerText.title = hunk.headerText;

    container.appendChild(headerText);
    return container;
}
```

Key decisions:
- The outer `div` uses `.hunk-separator` (shared styles) plus a modifier class `.hunk-separator-split` or `.hunk-separator-inline` for layout differences.
- `title` attribute shows the full hunk header on hover (useful if text is truncated).
- No gutter div — this element spans the full width, breaking out of the gutter+content pattern used by line elements.
- The function is **not exported** — it will be called only by rendering functions within the same file.

### DOM structure: `createCollapsedSectionElement(collapsedCount: number, hunkIndex: number): HTMLElement`

```html
<div class="collapsed-section" data-hunk-index="0">
  <span class="collapsed-section-text">
    <button class="expand-btn" type="button" title="Show hidden lines">⊞</button>
    Show 42 hidden lines
  </span>
</div>
```

Implementation pseudocode:
```typescript
function createCollapsedSectionElement(collapsedCount: number, hunkIndex: number): HTMLElement {
    const container = document.createElement('div');
    container.className = 'collapsed-section';
    container.dataset.hunkIndex = String(hunkIndex);

    const textSpan = document.createElement('span');
    textSpan.className = 'collapsed-section-text';

    const expandBtn = document.createElement('button');
    expandBtn.className = 'expand-btn';
    expandBtn.type = 'button';
    expandBtn.title = 'Show hidden lines';
    expandBtn.textContent = '⊞';

    textSpan.appendChild(expandBtn);
    textSpan.appendChild(document.createTextNode(` Show ${collapsedCount} hidden lines`));

    container.appendChild(textSpan);
    return container;
}
```

Key decisions:
- `data-hunk-index` attribute enables later expand/collapse wiring (commits 005/006 will add click listeners).
- The button is a semantic `<button>` for accessibility, not a `<span>` with a click handler.
- Text uses a simple `⊞` character; no codicon dependency. Can be swapped later.
- For `collapsedCount === 0`, the caller should **not** create this element; the function does not guard against it (caller's responsibility in 005/006).
- The function is **not exported**.

### Where to add CSS in `diff-webview.css`

Insert a new section **after the "Keyboard Navigation" section (ends at line 982, the last line)** — i.e., append at the end of the file. This is clean because the file already ends with the last section and there's no trailing content.

New section header: `/* ======================== */ /* Hunk Separator & Collapsed Sections */ /* ======================== */`

### CSS Rules

```css
/* ====================================== */
/* Hunk Separator & Collapsed Sections    */
/* ====================================== */

/* Shared hunk separator bar */
.hunk-separator {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 28px;
    padding: 2px 12px;
    background-color: var(--vscode-editorGroupHeader-tabsBackground, #252526);
    border-top: 1px solid var(--vscode-panel-border, #2d2d2d);
    border-bottom: 1px solid var(--vscode-panel-border, #2d2d2d);
    font-family: var(--vscode-editor-font-family, 'Consolas', 'Monaco', monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    user-select: none;
    -webkit-user-select: none;
}

/* Split view: spans both panes visually (caller appends to each pane) */
.hunk-separator-split {
    justify-content: flex-start;
}

/* Inline view: single column, centered */
.hunk-separator-inline {
    justify-content: flex-start;
}

/* The @@ ... @@ text */
.hunk-header-text {
    color: var(--vscode-descriptionForeground, #858585);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 4px;
}

/* Collapsed section placeholder between hunks */
.collapsed-section {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 24px;
    padding: 2px 12px;
    background-color: var(--vscode-editorGutter-background, transparent);
    border-top: 1px solid var(--vscode-panel-border, #2d2d2d);
    border-bottom: 1px solid var(--vscode-panel-border, #2d2d2d);
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    transition: background-color 0.15s;
}

.collapsed-section:hover {
    background-color: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.04));
}

/* Text inside collapsed section */
.collapsed-section-text {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--vscode-descriptionForeground, #858585);
    font-size: 12px;
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
}

/* Expand button */
.expand-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--vscode-textLink-foreground, #3794ff);
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
    line-height: 1;
    border-radius: 3px;
    transition: background-color 0.15s, color 0.15s;
}

.expand-btn:hover {
    background-color: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.1));
    color: var(--vscode-textLink-activeForeground, #3794ff);
}

.expand-btn:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 1px;
}
```

### Theme awareness

All CSS variables follow the existing pattern in the file:
- Primary: VS Code CSS variables (`var(--vscode-*)`)
- Fallback: hardcoded dark-theme values (matching the existing GitHub-style dark palette from commit 002)
- Light theme works automatically through VS Code variable resolution
- `--vscode-editorGroupHeader-tabsBackground` is already used by `.pane-header` (line 305), ensuring visual consistency between pane headers and hunk separators
- `--vscode-descriptionForeground` is already used for header text (line 56, 304), ensuring the muted gray/blue matches

## Tests

Tests should be added to the existing test infrastructure for `diff-renderer.ts`. Each test creates elements via the factory functions and asserts DOM structure:

1. **`createHunkHeaderElement` — split mode structure**: Call with a mock `Hunk` and `'split'`; assert the returned element has class `hunk-separator hunk-separator-split`, contains a child with class `hunk-header-text`, and the text content matches `hunk.headerText`.

2. **`createHunkHeaderElement` — inline mode structure**: Same as above but with `'inline'`; assert class includes `hunk-separator-inline`.

3. **`createHunkHeaderElement` — title attribute**: Assert `hunk-header-text` element has `title` attribute equal to `hunk.headerText`.

4. **`createCollapsedSectionElement` — structure**: Call with `collapsedCount=42, hunkIndex=3`; assert root has class `collapsed-section` and `data-hunk-index="3"`.

5. **`createCollapsedSectionElement` — text content**: Assert text content includes `"Show 42 hidden lines"`.

6. **`createCollapsedSectionElement` — expand button**: Assert a `button.expand-btn` child exists with `type="button"`.

7. **`createCollapsedSectionElement` — singular line count**: Call with `collapsedCount=1`; assert text reads `"Show 1 hidden lines"` (no special-casing for singular — keep it simple; can be refined later if needed).

**Note:** These are unit tests on detached DOM elements. No rendering integration tests yet — those come in commits 005/006. Since `diff-renderer.ts` runs in a webview context, tests may need jsdom or a similar DOM environment depending on the existing test setup.

## Acceptance Criteria

- [ ] `createHunkHeaderElement(hunk, 'split')` returns a `<div>` with classes `hunk-separator hunk-separator-split` containing a `.hunk-header-text` child with the hunk's `headerText`
- [ ] `createHunkHeaderElement(hunk, 'inline')` returns same structure with `hunk-separator-inline` modifier
- [ ] `createCollapsedSectionElement(N, idx)` returns a `<div.collapsed-section>` with `data-hunk-index` attribute and "Show N hidden lines" text
- [ ] Collapsed section contains a `<button.expand-btn>` element
- [ ] Both functions return detached elements (not appended to DOM)
- [ ] CSS `.hunk-separator` renders as a full-width bar with monospace font and gutter-matching background
- [ ] CSS `.collapsed-section` is centered, clickable, with hover highlight
- [ ] CSS `.expand-btn` has link-colored text with hover/focus styles
- [ ] All CSS uses VS Code variables with dark-theme fallbacks
- [ ] No existing rendering behavior is changed (functions are unused until 005/006)

## Dependencies
- Depends on: 003 (needs `Hunk` type and `AlignedLine` — both must exist before these helpers can reference `Hunk`)

## Assumed Prior State
`Hunk` interface exists in `diff-renderer.ts` (commit 003). CSS has GitHub-style diff colors (commit 002). Gutter/pane borders normalized (commit 001). No hunk-related DOM elements or CSS exist yet. The DOM helper functions `createLineElement` (line 132), `createEmptyLineElement` (line 227), and `createInlineLineElement` (line 476) establish the pattern for element creation.

---
status: pending
---

# 001: Remove gutter/pane borders and normalize line-prefix weight

## Summary

Remove `border-right` from `.line-gutter`, `.inline-line-gutter`, and `.diff-pane`, and change the `+`/`-` prefix characters from semi-bold to normal weight. This is a small, isolated CSS-only change that immediately improves visual clarity by aligning with GitHub/ADO diff conventions.

## Motivation

The `border-right` on gutters and panes creates visual noise that doesn't match standard diff viewers (GitHub, Azure DevOps). The bold prefix (`+`/`-`) is also non-standard — these characters should render at normal weight to match industry conventions. Removing these as a first commit provides an immediate visual improvement with zero functional risk.

## Changes

### Files to Create
- (none)

### Files to Modify
- `media/styles/diff-webview.css` — remove gutter/pane borders and normalize prefix font-weight

  **1. `.diff-pane` — line 291**
  - Remove: `border-right: 1px solid var(--vscode-panel-border);`
  - The `.diff-pane:last-child` override (line 294–296, `border-right: none;`) becomes a no-op but keep it as-is for defensive styling.
  - old → new:
    ```css
    /* line 286–292 */
    .diff-pane {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    -   border-right: 1px solid var(--vscode-panel-border);
    }
    ```

  **2. `.line-gutter` — line 359**
  - Remove: `border-right: 1px solid var(--vscode-panel-border);`
  - old → new:
    ```css
    /* line 353–370 */
    .line-gutter {
        min-width: 50px;
        padding: 0 4px;
        text-align: right;
        color: var(--vscode-editorLineNumber-foreground);
        background-color: var(--vscode-editorGutter-background);
    -   border-right: 1px solid var(--vscode-panel-border);
        user-select: none;
        user-select: none;
        flex-shrink: 0;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        gap: 2px;
        padding-top: 0;
        line-height: var(--vscode-editor-line-height, 1.5);
        position: relative;
    }
    ```

  **3. `.line-gutter .line-prefix` — line 384**
  - Change: `font-weight: 600` → `font-weight: normal`
  - old → new:
    ```css
    /* line 380–385 */
    .line-gutter .line-prefix {
        width: 12px;
        flex-shrink: 0;
        text-align: center;
    -   font-weight: 600;
    +   font-weight: normal;
    }
    ```

  **4. `.inline-line-gutter` — line 564**
  - Remove: `border-right: 1px solid var(--vscode-panel-border);`
  - old → new:
    ```css
    /* line 558–575 */
    .inline-line-gutter {
        min-width: 70px;
        padding: 0 4px;
        text-align: right;
        color: var(--vscode-editorLineNumber-foreground);
        background-color: var(--vscode-editorGutter-background);
    -   border-right: 1px solid var(--vscode-panel-border);
        user-select: none;
        user-select: none;
        flex-shrink: 0;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        gap: 2px;
        padding-top: 0;
        line-height: var(--vscode-editor-line-height, 1.5);
        position: relative;
    }
    ```

  **5. `.inline-line-gutter .line-prefix` — line 582**
  - Change: `font-weight: 600` → `font-weight: normal`
  - old → new:
    ```css
    /* line 578–583 */
    .inline-line-gutter .line-prefix {
        width: 12px;
        flex-shrink: 0;
        text-align: center;
    -   font-weight: 600;
    +   font-weight: normal;
    }
    ```

### Files to Delete
- (none)

## Implementation Notes
- The `.diff-pane:last-child { border-right: none; }` rule (lines 294–296) becomes a no-op after removing `border-right` from `.diff-pane`. Keep it for defensive styling — it causes no harm and protects against future regressions.
- The base `.line-prefix` rule (line 413) has no `font-weight` property, so only the two gutter-scoped selectors (`.line-gutter .line-prefix` and `.inline-line-gutter .line-prefix`) need updating.
- The `font-weight: 600` values at lines 301, 523 belong to `.pane-header` and `.inline-diff-pane .pane-header` respectively — those are header labels, not prefixes, and should remain unchanged.

## Tests
- Visual verification only — no functional tests to change.
- Build should pass (`npm run build`).
- Visually confirm: open a side-by-side diff and an inline diff in the extension, verify no vertical border lines appear between gutters/panes, and `+`/`-` characters render at normal weight.

## Acceptance Criteria
- [ ] No `border-right` on `.diff-pane` (line 291 removed)
- [ ] No `border-right` on `.line-gutter` (line 359 removed)
- [ ] No `border-right` on `.inline-line-gutter` (line 564 removed)
- [ ] `.line-gutter .line-prefix` uses `font-weight: normal` (line 384)
- [ ] `.inline-line-gutter .line-prefix` uses `font-weight: normal` (line 582)
- [ ] `.diff-pane:last-child` override kept as-is (defensive)
- [ ] `npm run build` succeeds

## Dependencies
- Depends on: None

## Assumed Prior State
None (first commit)

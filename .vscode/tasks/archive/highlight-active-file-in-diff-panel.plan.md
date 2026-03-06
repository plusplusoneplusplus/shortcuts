# Highlight Active File in Git Diff Panel

## Problem

In the Git view, when a user clicks a file from the commit history or working changes list, the diff for that file is shown in the right panel. There is currently no visual indicator in the file list showing which file is currently displayed — making it hard to track context when browsing multiple files.

## Goal

Apply a distinct background color to the file list entry that corresponds to the file currently displayed in the right diff panel.

## Acceptance Criteria

- [x] When a file entry in the git view left panel is clicked and its diff is shown in the right panel, that file entry receives a highlighted background color.
- [x] The highlight uses a theme-appropriate color (e.g., CSS variable from the design system or a subtle accent) and is visually distinguishable without being distracting.
- [x] Only one file entry is highlighted at a time — switching to another file moves the highlight.
- [x] The highlight persists correctly when the commit/section is expanded/collapsed and re-expanded.
- [x] On initial load (if a file is pre-selected), the correct entry is highlighted.

## Subtasks

1. **Identify state management** — Locate where the currently-selected/displayed file path is tracked in the Git view component (React state, Zustand store, or context).
2. **Propagate active file to file list** — Ensure the file list component receives or can derive the active file path.
3. **Apply CSS class to active entry** — Add an `active` or `selected` CSS class to the matching file entry element when its path matches the active file path.
4. **Style the active class** — Define a background color using a CSS variable or theme token (e.g., `var(--vscode-list-activeSelectionBackground)` or a neutral highlight).
5. **Handle edge cases** — Verify behavior when switching commits, collapsing sections, or navigating via keyboard.
6. **Test visually** — Confirm the highlight appears correctly across light and dark themes.

## Notes

- The right panel file path is shown in the breadcrumb at the top (e.g., `packages/coc/test/e2e/markdown-review-dialog.spec.ts`) — this can be used as the source of truth for which file is active.
- Avoid using `:active` CSS pseudo-class; use a JS-driven class so the highlight is stable after the click.
- Consider reusing any existing `selected` styling pattern already present in the file list for consistency.
- The git view lives in the CoC server SPA dashboard (`packages/coc-server/src/`).

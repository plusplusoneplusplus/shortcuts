---
status: pending
---

# 002: Extract getSpaStyles to spa/styles.ts

## Summary
Move the entire `getSpaStyles()` function (~1030 lines of CSS generation) from `spa-template.ts` into its own module at `spa/styles.ts`.

## Motivation
The CSS generation is the largest self-contained section in the monolith. It has a clean interface (`enableAI: boolean → string`) with a single external dependency (`getMermaidZoomStyles`). Extracting it first provides the biggest immediate size reduction (~1030 lines) with minimal risk.

## Changes

### Files to Create
- `packages/deep-wiki/src/server/spa/styles.ts` — Contains `getSpaStyles(enableAI: boolean): string`. Imports `getMermaidZoomStyles` from `../../rendering/mermaid-zoom`. Includes all CSS: root variables, dark theme, top bar, app layout, sidebar, main content, source files, TOC sidebar, markdown body, home view, mermaid zoom styles, dependency graph, deep dive, live reload, responsive media queries, ask AI widget (conditional on `enableAI`), and admin page styles.

### Files to Modify
- `packages/deep-wiki/src/server/spa-template.ts` — Remove `getSpaStyles()` function definition (lines ~198-1227). Add `import { getSpaStyles } from './spa/styles';`. The call site in `generateSpaHtml()` remains unchanged.

## Implementation Notes
- The function signature is `function getSpaStyles(enableAI: boolean): string` — keep it identical.
- The conditional `if (enableAI) { styles += ... }` block (line ~954) for the Ask AI widget CSS must be preserved exactly.
- The `getMermaidZoomStyles()` call at line ~809 injects shared CSS — update import path to `../../rendering/mermaid-zoom`.
- Export the function as a named export: `export function getSpaStyles(...)`.

## Tests
- No new tests needed — existing `spa-template.test.ts` tests verify CSS content in the generated HTML
- Run full test suite to verify no regression

## Acceptance Criteria
- [ ] `spa/styles.ts` exports `getSpaStyles` with identical signature
- [ ] `spa-template.ts` no longer contains any CSS string generation code
- [ ] `spa-template.ts` file shrinks by ~1030 lines
- [ ] Generated HTML output is byte-identical to before
- [ ] All existing tests pass unchanged

## Dependencies
- Depends on: 001 (uses `spa/` directory)

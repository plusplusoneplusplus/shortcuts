---
status: pending
---

# 004: Extract content, markdown, and TOC script modules

## Summary
Extract the content loading, markdown rendering, and table-of-contents sections into separate script modules.

## Motivation
These three sections form the "content pipeline" — loading modules from the API, rendering markdown, and building the TOC. They are tightly related but logically distinct. Extracting them as a group keeps the cross-references clear (content calls markdown/TOC functions).

## Changes

### Files to Create
- `packages/deep-wiki/src/server/spa/scripts/content.ts` — Exports `getContentScript(opts: { enableAI: boolean }): string`. Contains: `showHome()`, `loadModule()`, `renderModulePage()`, `toggleSourceFiles()`, `loadSpecialPage()`. Has conditional `opts.enableAI` guards for `updateAskSubject()` and `addDeepDiveButton()` calls. (Lines ~1567-1767)
- `packages/deep-wiki/src/server/spa/scripts/markdown.ts` — Exports `getMarkdownScript(): string`. Contains: `renderMarkdownContent()`, `processMarkdownContent()`, `findModuleIdBySlugClient()`, `addCopyButton()`, `initMermaid()`. Also includes the `getMermaidZoomScript()` injection. (Lines ~1769-1933)
- `packages/deep-wiki/src/server/spa/scripts/toc.ts` — Exports `getTocScript(): string`. Contains: `buildToc()`, `setupScrollSpy()`, `updateActiveToc()`. (Lines ~1935-1997)

### Files to Modify
- `packages/deep-wiki/src/server/spa-template.ts` — In `getSpaScript()`, replace the content/markdown/TOC inline sections with imports. Concatenation becomes: `getCoreScript(...) + getThemeScript() + getSidebarScript(...) + getContentScript({enableAI}) + getMarkdownScript() + getTocScript() + [remaining conditional sections]`.

## Implementation Notes
- **`getMarkdownScript()`** must import `getMermaidZoomScript` from `../../rendering/mermaid-zoom` and inject it via `${getMermaidZoomScript()}` in the returned string. This is the same pattern used in `styles.ts` for `getMermaidZoomStyles`.
- **Content → Markdown cross-calls**: `renderModulePage()` calls `renderMarkdownContent()`, `processMarkdownContent()`, `buildToc()` — these work because all scripts share the same global scope in the final output.
- **Content → AI cross-calls**: `showHome()` conditionally calls `updateAskSubject()` — wrapped in `opts.enableAI` conditional template injection.
- Preserve exact whitespace/indentation in generated JS strings.

## Tests
- No new tests needed — existing tests check for these JS function names in the HTML output
- Run full test suite

## Acceptance Criteria
- [ ] Three new files created in `spa/scripts/`
- [ ] `getMarkdownScript()` correctly includes `getMermaidZoomScript()` output
- [ ] Conditional `enableAI` blocks in content script preserved
- [ ] Generated HTML output is byte-identical to before
- [ ] All existing tests pass unchanged

## Dependencies
- Depends on: 003 (core/theme/sidebar already extracted; content calls functions from those)

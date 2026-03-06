# Plan: Code Syntax Highlight for File Diff View in CoC Git Panel

## Problem

The diff viewer (`UnifiedDiffViewer.tsx`) currently applies only diff-level coloring
(green for added lines, red for removed lines, blue for hunk headers). The actual code
content within each line is rendered as plain monospace text with no language-aware syntax
highlighting. The screenshot shows TypeScript code in the diff pane with no keyword/token
coloring, making it harder to read.

## Goal

Add language-aware syntax highlighting to code tokens inside `+`, `-`, and context diff
lines, while preserving the existing diff background colors (green/red/blue).

---

## Approach

### Library: `highlight.js` (selective imports)

- Mature, well-maintained, ~30 kB gzipped for the common-language subset
- Provides a `highlightAuto` fallback and per-language `highlight()` call
- Returns an `{ value: string }` with inline `<span class="hljs-*">` tokens
- Works purely on string input — no React wrapper needed
- Ship only the languages used in typical repos (ts, js, tsx, jsx, python, go, rust, java,
  c, cpp, cs, json, yaml, md, shell, css, html) to keep bundle size manageable

Alternative considered: `Prism.js` (similar size, slightly less auto-detection quality).
`shiki` was ruled out — it requires async WASM loading not suitable for the SPA's sync render.

---

## Implementation Steps

### 1. Install `highlight.js`

```
npm install highlight.js
```
in `packages/coc` (or wherever the SPA bundle is built).

### 2. Create `useSyntaxHighlight` hook

File: `packages/coc/src/server/spa/client/react/repos/useSyntaxHighlight.ts`

- Accepts `(code: string, language: string | null) => string`
- Calls `hljs.highlight(code, { language })` when language is known, falls back to
  `hljs.highlightAuto(code)` or returns `code` unchanged for unknown/binary files
- Memoized with `useMemo`

### 3. Infer language from diff header

In `UnifiedDiffViewer.tsx`, parse the diff header lines for the filename:
```
+++ b/packages/coc/src/server/spa/client/react/context/AppContext.tsx
```
Extract the extension (`.tsx` → `typescript`) using a small extension→language map.

Alternatively (cleaner): pass an optional `fileName?: string` prop from `CommitDetail`
and `BranchFileDiff`, which already know the selected file path. Both components display
a filename header, so the value is already in scope.

**Preferred**: add `fileName?: string` prop to `UnifiedDiffViewerProps` and derive language
from it. This avoids fragile header-line parsing.

### 4. Update `UnifiedDiffViewer` rendering

For `added`, `removed`, and `context` line types:
1. Strip the leading `+`/`-`/` ` prefix character
2. Apply `hljs.highlight(content, { language })` → get HTML string
3. Render: prefix character as plain text + rest as `<span dangerouslySetInnerHTML>` (or
   map hljs tokens to React spans)
4. Keep the existing `LINE_CLASSES` background on the wrapping `<div>`

For `meta` and `hunk-header` lines: no syntax highlighting (render as-is).

**Note on multi-line constructs**: highlight.js supports stateful continuation via
`hljs.highlight(code, { language, ignoreIllegals: true, continuation: prevState })`.
Use this to carry tokenizer state line-by-line so multi-line strings/comments render
correctly.

### 5. Add hljs theme CSS

Import a highlight.js theme that complements the existing light/dark palette.
Recommended: `github` for light, `github-dark` for dark (matching the existing GitHub-style
diff colors). Import via CSS or inject at the SPA entry point.

Apply theme classes only to code tokens — the diff background classes must not be
overridden. Use CSS specificity carefully or scope with a wrapper class.

### 6. Handle edge cases

- Binary diffs (`Binary files … differ`) — skip highlighting
- Very long lines — highlight.js handles them; no truncation needed
- Unknown extension — fall back to no highlighting (plain text, existing behavior)
- Empty diff — no change needed

### 7. Update `CommitDetail` and `BranchFileDiff`

Pass `fileName` prop to `<UnifiedDiffViewer>` where applicable:
- `CommitDetail`: already has the selected file name in state
- `BranchFileDiff`: file path is in the URL param or component props

### 8. Update tests

- Add unit tests for `useSyntaxHighlight` hook
- Add/update `UnifiedDiffViewer` snapshot tests to cover highlighted output
- Ensure existing diff-coloring tests still pass (background classes unchanged)

---

## File Changes Summary

| File | Change |
|------|--------|
| `packages/coc/package.json` | Add `highlight.js` dependency |
| `packages/coc/src/server/spa/client/react/repos/UnifiedDiffViewer.tsx` | Add `fileName` prop, per-line syntax highlighting with stateful hljs |
| `packages/coc/src/server/spa/client/react/repos/useSyntaxHighlight.ts` | New hook: language detection + hljs tokenization |
| `packages/coc/src/server/spa/client/react/repos/CommitDetail.tsx` | Pass `fileName` to `UnifiedDiffViewer` |
| `packages/coc/src/server/spa/client/react/repos/BranchFileDiff.tsx` | Pass `fileName` to `UnifiedDiffViewer` |
| `packages/coc/src/server/spa/client/react/index.css` (or entry) | Import hljs theme CSS |
| `packages/coc/test/spa/react/UnifiedDiffViewer.test.tsx` | Update/add tests |
| `packages/coc/test/spa/react/useSyntaxHighlight.test.ts` | New test file |

---

## Out of Scope

- Server-side highlighting
- Custom theme editor
- Highlighting inside the diff header/meta lines
- Inline character-level diff (showing which characters changed within a line)

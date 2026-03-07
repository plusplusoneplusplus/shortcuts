# Fix: No Syntax Highlighting in Code File View Dialog

## Problem

When clicking on a code file path (e.g. `.ts`, `.js`, `.py`) in the CoC dashboard, the `MarkdownReviewDialog` opens and shows the file content in the **Preview** tab without any syntax highlighting — just monospace plain text.

The root cause: `MarkdownReviewEditor` pipes all file content through `renderMarkdownToHtml()`, which is a Markdown renderer. For non-markdown code files it has no language context and renders each line as plain text.

Highlight.js is already bundled (`useSyntaxHighlight.ts`) and `renderCodeBlock()` already supports full syntax-highlighted fenced code blocks — we just need to route code files through it.

## Approach

In `MarkdownReviewEditor.tsx`, before passing content to `renderMarkdownToHtml()`, detect whether the file is a non-markdown code file. If so, wrap the raw content in a fenced markdown code block with the correct language tag:

```
```typescript
<file content>
```
```

This lets the existing `renderCodeBlock()` pipeline (with `highlightFn`) handle syntax highlighting, line numbers, copy button, etc. — zero new infrastructure needed.

**Key utilities already available:**
- `getLanguageFromFileName(fileName)` in `useSyntaxHighlight.ts` — maps extension → hljs language name
- `renderCodeBlock()` in `markdown-renderer.ts` — renders highlighted, numbered code blocks
- `EXT_TO_LANG` already covers `.ts`, `.tsx`, `.js`, `.py`, `.go`, `.rs`, `.json`, `.yaml`, etc.

## Files to Change

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx` | Detect non-markdown file; wrap content in fenced code block before rendering |
| `packages/coc/src/server/spa/client/react/useSyntaxHighlight.ts` | Export `getLanguageFromFileName` if not already exported (likely already exported) |

## Todos

1. **Investigate `html` computation** — Find exactly where `html` is derived in `MarkdownReviewEditor.tsx` (likely via `useMarkdownPreview` hook or inline `useMemo`).
2. **Check `getLanguageFromFileName` export** — Confirm it's exported from `useSyntaxHighlight.ts` for reuse.
3. **Add `isCodeFile` helper** — Use `getLanguageFromFileName` to check if the file has a recognized code extension (and is not `.md`/`.markdown`/`.mdx`).
4. **Wrap content before rendering** — In the `html` computation, if `isCodeFile`, prefix content with ` ```{lang}\n ` and suffix with ` \n``` `.
5. **Test** — Open a `.ts`, `.json`, `.py` file via the dialog and confirm syntax highlighting appears in Preview tab. Confirm `.md` files are unaffected.

## Out of Scope

- Syntax highlighting in the **Source** tab (plain textarea — deliberate for editing)
- `ToolResultPopover` inline hover preview (separate component; smaller scope)
- Files with unknown extensions (fall back to plain text, no change)

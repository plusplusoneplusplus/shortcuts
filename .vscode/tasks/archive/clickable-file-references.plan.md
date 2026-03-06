# Clickable File References in SPA Markdown Review Editor

## Problem

In the CoC SPA markdown review editor (Preview mode), markdown links like `[git-feature-gap-analysis.md](./git-feature-gap-analysis.md)` render as styled `<span class="md-link">` elements with hover underline and pointer cursor — but clicking them does **nothing**. Users expect to click these references and see the linked file content.

The VS Code extension already supports Ctrl+Click on `md-link` elements (in `src/shortcuts/markdown-comments/webview-scripts/dom-handlers.ts`), and the SPA already supports click-to-open for `.file-path-link` spans (in `file-path-preview.ts` → dispatches `coc-open-markdown-review` custom event → `MarkdownReviewDialog`). The gap is that `md-link` spans in the SPA have no click handler at all.

## Proposed Approach

Add a click handler for `.md-link` spans in the SPA's global event delegation (`file-path-preview.ts`), resolving the URL from the link's `md-link-url` child span. For relative paths, resolve against the current file's directory. Then dispatch the existing `coc-open-markdown-review` custom event to open `MarkdownReviewDialog`, which already renders `.md` files in the `MarkdownReviewEditor` and non-md files as plain text previews.

### Key Design Decisions

- **Click behavior**: Single click (not Ctrl+Click like VS Code) because the SPA has no "go to definition" conflict. The `md-link-url` portion already has `cursor: pointer` on hover.
- **Anchor links** (`#heading`): Already handled separately — skip these (they have `md-anchor-link` class).
- **External URLs** (`http://...`): Open in a new browser tab via `window.open()`.
- **Relative paths** (`./file.md`, `../other.md`): Resolve against the directory of the currently-viewed file. The event detail must carry the resolved absolute path.
- **Absolute paths** (`/some/file.md` or `C:\...`): Pass through directly.
- **Non-markdown files**: The `MarkdownReviewDialog` already delegates to `fetchMode: 'auto'` which uses the `files/preview` API — this returns syntax-highlighted source for any file type. No extra work needed.

## Todos

### ~~1. Add `md-link` click delegation in `file-path-preview.ts`~~ ✅

### ~~2. Resolve relative paths in the `coc-open-markdown-review` event handler~~ ✅

### ~~3. Pass source file context through `MarkdownReviewDialog`~~ ✅

### ~~4. Add `data-href` to `md-link` rendered HTML for easier URL extraction~~ ✅

### ~~5. Add unit tests~~ ✅

## Files to Modify

| File | Change |
|------|--------|
| `packages/pipeline-core/src/editor/rendering/markdown-renderer.ts` | Add `data-href` attribute to `md-link` spans |
| `packages/coc/src/server/spa/client/react/file-path-preview.ts` | Add click delegation for `.md-link` spans |
| `packages/coc/src/server/spa/client/react/App.tsx` | Handle relative path resolution in event handler |
| `packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx` | Add `data-source-file` attribute to preview container |
| `packages/pipeline-core/test/editor/rendering/markdown-renderer.test.ts` | Test `data-href` attribute |
| `packages/coc/test/server/spa/client/` | Test `md-link` click delegation |

## Out of Scope

- Hover preview tooltip on `md-link` spans (nice-to-have, can follow up)
- Breadcrumb navigation / back button in the dialog for nested file references
- Image preview for image links

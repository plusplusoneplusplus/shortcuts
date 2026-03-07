# Plan: Syntax Highlighting for Source Code in File Viewer

## Problem

When a user clicks a file path from a tool call result (e.g., a `view` tool call), a full-screen modal opens (`MarkdownReviewDialog` → `MarkdownReviewEditor`). Currently:

- **Markdown files** → "Preview" tab renders rich HTML; "Source" tab shows plain text.
- **Source code files** (`.tsx`, `.ts`, `.py`, `.json`, etc.) → both tabs show plain unformatted text in a `<textarea>` — **no syntax highlighting**.

The goal is to add syntax highlighting for non-markdown source code files in the viewer.

## Current Architecture

| Component | Role |
|-----------|------|
| `MarkdownReviewDialog.tsx` | Modal shell (95vw × 92vh) |
| `MarkdownReviewEditor.tsx` | Tab switcher (Preview / Source), file-type-aware rendering |
| `SourceEditor.tsx` | Plain `<textarea>` — edit or read-only source |
| `FilePreview.tsx` | Hover tooltip; already calls `hljs.highlightElement()` |
| `markdown-renderer.ts` | Renders markdown + code blocks using highlight.js |
| `useMarkdownPreview.ts` | Hook that invokes the renderer and runs `hljs` post-render |

**highlight.js is already loaded globally** via the HTML template CDN script — no new dependency needed.

## Proposed Approach

### Option A — Highlighted `<pre><code>` block in read-only Source view (recommended)

When `MarkdownReviewEditor` is opened in **read-only mode** (i.e., opened from a tool call, not editing), and the file is **not markdown**, replace the `<textarea>` with a `<pre><code>` element and run `hljs.highlightElement()` on it.

This reuses the exact same highlight.js path that already works for code blocks inside markdown previews.

### Option B — Monaco Editor (not recommended)

Monaco (~3 MB) is heavyweight and brings an editor UX that is unnecessary for a read-only viewer. Ruled out.

## Implementation Tasks

### 1. Add a `CodeViewer` component
- **File:** `packages/coc/src/server/spa/client/react/shared/CodeViewer.tsx` (new)
- Renders `<pre><code class="language-{lang}">…</code></pre>`
- Runs `hljs.highlightElement()` in a `useEffect` after mount / content change
- Accepts props: `content: string`, `language: string`, `className?: string`
- Line numbers via CSS counter (optional, low-effort enhancement)

### 2. Extend language detection utility
- **File:** `packages/coc/src/server/spa/client/react/shared/FilePreview.tsx` (already has `isMarkdownFile`)
- Extract or duplicate `getLanguageFromExtension(fileName: string): string` as a shared utility:
  - Map common extensions → hljs language aliases (`.ts`→`typescript`, `.py`→`python`, `.json`→`json`, `.sh`→`bash`, `.go`→`go`, `.rs`→`rust`, `.css`→`css`, `.html`→`xml`, etc.)
  - Return `'plaintext'` as fallback

### 3. Update `MarkdownReviewEditor` to use `CodeViewer` for source code
- **File:** `packages/coc/src/server/spa/client/react/shared/MarkdownReviewEditor.tsx`
- Detect whether the file is markdown (`isMarkdownFile`) or source code
- **Markdown files:** keep existing Preview / Source tab behavior unchanged
- **Source code files (read-only):**
  - Show only a single "Source" view (or keep tabs but both show highlighted code)
  - Render content via `<CodeViewer content={…} language={…} />`
  - The "Preview" tab for source code files can either be hidden or show the same highlighted view (simpler to hide)

### 4. Add CSS for the code viewer
- **File:** `packages/coc/src/server/spa/client/tailwind.css` (or a co-located `.css`)
- Style `.code-viewer` container: full width, overflow-x auto, monospace font matching existing `.source-editor-textarea` styles
- Optional: line-number gutter via CSS counter

### 5. Wire up existing `FilePreview.tsx` tooltip (if not already consistent)
- The hover tooltip in `FilePreview.tsx` already applies `hljs.highlightElement()` — verify it also benefits from the shared `getLanguageFromExtension` utility once extracted

## Files to Change

| File | Change |
|------|--------|
| `react/shared/CodeViewer.tsx` | **New** — syntax-highlighted read-only viewer |
| `react/shared/MarkdownReviewEditor.tsx` | Detect file type; use `CodeViewer` for non-md read-only |
| `react/shared/FilePreview.tsx` | Extract `getLanguageFromExtension` as shared util |
| `client/tailwind.css` | Add `.code-viewer` styles |

## Out of Scope

- Editable syntax-highlighted editing (no code editor replacement for the write path)
- Adding a new library (highlight.js is already present)
- Changing the markdown preview rendering pipeline

## Notes

- highlight.js is declared as a global (`window.hljs`) — usage pattern matches what `FilePreview.tsx` and `useMarkdownPreview.ts` already do.
- The `readOnly` prop on `MarkdownReviewEditor` distinguishes file-view (read-only) from edit mode; use it to decide when to swap in `CodeViewer`.
- Language detection should be resilient — fall back to `'plaintext'` so the viewer never breaks on unknown extensions.

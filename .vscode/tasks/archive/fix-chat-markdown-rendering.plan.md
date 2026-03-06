# Fix Chat Markdown Rendering in AI Execution Dashboard

## Problem

Assistant messages in the Chat tab (`coc serve` dashboard) render as raw markdown text — `**bold**`, `###`, backtick code, numbered lists all appear as plain text in a wall of unformatted content. See screenshot from `localhost:4000/#/repos/ws-kss6a7/chat/...`.

## Root Causes

### RC1: `HTML_LIKE_RE` bypass in `toContentHtml()` (Primary)
**File:** `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx:37-42`

```ts
const HTML_LIKE_RE = /<[a-z][\s\S]*>/i;
function toContentHtml(content: string): string {
    if (!content || !content.trim()) return '';
    return HTML_LIKE_RE.test(content) ? content : renderMarkdownToHtml(content);
}
```

The regex matches ANY `<lowercase...>` pattern across newlines. AI responses frequently contain angle brackets in code samples (`Array<string>`), XML references, or inline HTML. When triggered, the **entire content bypasses markdown rendering** and is injected as raw text via `dangerouslySetInnerHTML`.

### RC2: Line-by-line span renderer doesn't produce semantic HTML
**File:** `packages/coc/src/server/spa/client/markdown-renderer.ts`

The `renderMarkdownToHtml()` function uses pipeline-core's `applyMarkdownHighlighting()` which wraps each line in `<div class="md-line">` and uses span-based formatting (e.g., `<span class="md-bold"><span class="md-marker">**</span>text</span>`). This means:
- `**` markers remain visible in the DOM (hidden only via CSS `.md-marker` opacity)
- No semantic `<h3>`, `<strong>`, `<ul><li>`, `<p>` elements are produced
- Paragraph breaks (double newlines) produce empty `<div class="md-line">` with no guaranteed visual spacing

### RC3: No paragraph/line-break handling
Double newlines (`\n\n`) in the markdown are not converted to `<p>` or `<br>` — they just produce empty `md-line` divs. If CSS doesn't give those empty divs vertical spacing, the response collapses into a single block.

## Approach

Replace the span-based custom renderer with a proper markdown library (`marked` v12 is already a dependency in `packages/coc/package.json`) for chat message rendering. Keep the existing span-based renderer for other use cases (editor overlays, pipeline output) where it's appropriate.

## Todos

### 1. ✅ Replace `toContentHtml` with `marked`-based renderer
**File:** `ConversationTurnBubble.tsx`

- Remove the `HTML_LIKE_RE` bypass entirely
- Create a new `chatMarkdownToHtml(content: string)` function that uses `marked` to convert markdown → semantic HTML (`<h3>`, `<strong>`, `<p>`, `<ul>`, `<pre><code>`)
- Configure `marked` with:
  - `gfm: true` (GitHub-Flavored Markdown)
  - `breaks: true` (single newlines → `<br>`)
  - A custom renderer or highlight.js integration for code blocks (reuse existing `window.hljs`)
- Sanitize output with DOMPurify or marked's built-in sanitizer to prevent XSS from `dangerouslySetInnerHTML`

### 2. ✅ Add `marked` CSS styles for chat messages
**File:** `packages/coc/src/server/spa/client/tailwind.css`

- Add styles scoped to `.chat-message-content .markdown-body` for semantic HTML elements:
  - `h1, h2, h3` — sizes, weights, margins
  - `strong, em` — bold/italic
  - `ul, ol, li` — list styling with proper indentation
  - `p` — paragraph margins
  - `pre, code` — code block styling (can reuse existing `.md-code-block` styles)
  - `blockquote` — left border, indentation
  - `a` — link colors
  - `table, th, td` — table borders
- Ensure dark mode variants work

### 3. ✅ Update `MarkdownView` to handle `marked` output (no changes needed)
**File:** `MarkdownView.tsx`

- The component already does `dangerouslySetInnerHTML` and post-processes `<pre><code>` with hljs — this should work as-is with `marked` output
- Verify hljs highlighting still applies to `marked`-generated code blocks
- Consider adding a `sanitize` step if not done in step 1

### 4. ✅ Handle edge cases
- **Streaming content:** Ensure partial markdown (incomplete code fences, unclosed bold) renders gracefully during streaming. `marked` handles this reasonably but test with real streaming turns.
- **Task tool results that contain HTML:** Tool results go through `ToolCallView`, not `toContentHtml`, so they're unaffected. Verify this.
- **Existing pipeline output rendering:** The span-based `renderMarkdownToHtml` is used elsewhere (pipeline result viewer, editor overlays). Leave those untouched — only change the chat path.

### 5. ✅ Test scenarios
- Assistant response with headers (`###`), bold (`**`), lists, code blocks, inline code
- Response containing `Array<string>` or other angle-bracket patterns (previously triggered bypass)
- Streaming response (partial content)
- Dark mode rendering
- Code block syntax highlighting with hljs
- Long responses with multiple paragraphs

## Files to Modify

| File | Change |
|------|--------|
| `packages/coc/src/server/spa/client/react/processes/ConversationTurnBubble.tsx` | Replace `toContentHtml` with `marked`-based function |
| `packages/coc/src/server/spa/client/tailwind.css` | Add semantic HTML styles for chat messages |
| `packages/coc/src/server/spa/client/react/processes/MarkdownView.tsx` | Minor adjustments if needed |
| `packages/coc/src/server/spa/client/markdown-renderer.ts` | No changes (keep for non-chat use cases) |

## Notes

- `marked` v12 is already listed in `packages/coc/package.json` — no new dependency needed
- The SPA is bundled at build time; ensure `marked` is included in the client bundle (check webpack/esbuild config)
- The span-based renderer in `pipeline-core` is still valuable for editor overlays where you want syntax-highlighted markdown with visible markers — this change is chat-only

---
status: pending
---

# 008: Port AI Q&A Chat Widget to Wiki Tab

## Summary
Port the Ask AI floating chat widget from deep-wiki SPA into the CoC Wiki tab, including SSE streaming, multi-turn conversations, and deep-dive exploration buttons.

## Motivation
AI Q&A is the signature feature of the wiki experience. Users can ask questions about the codebase and get context-aware answers with TF-IDF retrieval. The widget must work against the CoC multi-wiki API (`/api/wikis/:wikiId/ask`) instead of the deep-wiki single-wiki endpoint (`/api/ask`).

## Changes

### Files to Create
- `packages/coc/src/server/spa/client/wiki-ask.ts` — Ask AI widget (ported from deep-wiki `ask-ai.ts`)
- `packages/coc/src/server/spa/client/wiki-ask.css` — Widget styles (ported from `ask-widget.css` + deep-dive styles from `styles.css`)

### Files to Modify
- `packages/coc/src/server/spa/client/wiki.ts` — Import and call `setupWikiAskListeners()` on wiki tab init; expose `addDeepDiveButton` on window
- `packages/coc/src/server/spa/client/index.ts` — Add `import './wiki-ask'` (or import via wiki.ts)
- SPA HTML template (`packages/coc/src/server/spa/html-template.ts`) — Add Ask AI widget HTML structure into wiki tab markup
- `packages/coc/src/server/spa/client/styles.css` — Import or inline `wiki-ask.css`

### Files to Delete
- (none)

## Implementation Notes

### Widget Structure (from `ask-ai.ts`)
The widget is a fixed-position floating panel with three sections:
1. **Header** (`#ask-widget-header`) — title "Ask AI", Clear button (resets session), Close button (×); hidden by default, shown on expand
2. **Messages area** (`#ask-messages`) — scrollable container for conversation bubbles; hidden by default, shown on expand
3. **Input area** (`#ask-widget-input`) — always visible; contains a label ("Ask AI about **<subject>**"), a `<textarea>` with auto-resize (max 120px), and a Send button (➤ arrow)

The widget has two visual states:
- **Collapsed**: only the input bar is visible (label + textarea + send button)
- **Expanded**: header + messages + input; label hidden, input area gets top border; box-shadow intensifies

State is managed via module-level variables:
- `askPanelOpen: boolean` — tracks expanded/collapsed
- `askStreaming: boolean` — locks send button during active stream
- `currentSessionId: string | null` — reused across turns for multi-turn conversation
- `conversationHistory: Array<{role, content}>` — local message log

### SSE Streaming Protocol (fetch + ReadableStream)
The widget does **NOT** use `EventSource`. It uses `fetch()` with `response.body.getReader()` and a `TextDecoder` to manually parse SSE lines:

1. POST request to `/api/ask` with JSON body: `{ question, sessionId?, conversationHistory? }`
2. Response is `text/event-stream` with lines formatted as `data: {JSON}\n\n`
3. Client reads chunks via `reader.read()` in a recursive `processChunk()` loop:
   - Accumulates raw bytes in a `buffer` string
   - Splits on `\n`, keeps last incomplete line in buffer
   - Parses each `data: ` prefixed line as JSON
4. SSE event types:
   - `{"type":"context","componentIds":["id1","id2"],"themeIds":["theme/slug"]}` — rendered as clickable context links (📦 component, 📋 theme); shown once before the response
   - `{"type":"chunk","content":"partial text"}` — appended to `fullResponse`; triggers `updateAskAssistantStreaming()` which re-renders the full accumulated markdown
   - `{"type":"done","fullResponse":"full text","sessionId":"..."}` — captures `sessionId` for reuse; calls `finishStreaming()`
   - `{"type":"error","message":"..."}` — renders error bubble; calls `finishStreaming()`
5. On stream end (`result.done`), any remaining buffer is flushed

### URL Adaptation for CoC Multi-Wiki
All endpoints must be scoped to a wiki ID:
| Deep-wiki endpoint | CoC endpoint |
|---|---|
| `POST /api/ask` | `POST /api/wikis/:wikiId/ask` |
| `DELETE /api/ask/session/:sessionId` | `DELETE /api/wikis/:wikiId/ask/session/:sessionId` |
| `POST /api/explore/:componentId` | `POST /api/wikis/:wikiId/explore/:componentId` |

The `wikiId` must be obtained from the wiki tab state (e.g., currently selected wiki). All fetch URLs in the ported module must interpolate `wikiId` dynamically.

### Session Management (Multi-Turn Conversations)
- First question: send `{ question, conversationHistory: [] }` (no `sessionId`)
- Server responds with `sessionId` in the `done` event
- Subsequent questions: send `{ question, sessionId }` — server reuses the SDK session for contextual follow-ups
- Clear button: sends `DELETE /api/wikis/:wikiId/ask/session/:sessionId`, resets `currentSessionId` to null, clears `conversationHistory` array, empties the messages DOM

### Message Rendering Helpers
- `appendAskMessage(role, content)` — creates a `div.ask-message` with child `div.ask-message-{role}`; user messages use `textContent` (plain text), positioned right with bubble styling
- `appendAskAssistantStreaming(content)` — creates assistant bubble with `div.markdown-body` inside; uses `marked.parse()` for markdown rendering (falls back to `escapeHtml()` if marked unavailable)
- `updateAskAssistantStreaming(el, content)` — re-renders the full accumulated response into the assistant bubble's `.markdown-body` div on each chunk; scrolls messages to bottom
- `appendAskContext(componentIds, themeIds)` — renders a context pill bar with clickable links; components call `loadComponent(id)`, themes call `loadThemeArticle(themeId, slug)`
- `appendAskTyping()` — shows "Thinking" with animated `...` ellipsis (CSS `@keyframes typing`); removed when first chunk arrives
- `appendAskError(message)` — red-bordered error bubble

### Deep-Dive (Explore Further) Button
- `addDeepDiveButton(componentId)` — inserts a "🔍 Explore Further" button at the top of `#content .markdown-body`
- Clicking toggles a `#deep-dive-section` with an input field ("Ask a specific question about this component...") and "Explore" submit button
- Submit POSTs to `/api/explore/:componentId` (→ `/api/wikis/:wikiId/explore/:componentId`) with `{ question?, depth: 'deep' }`
- SSE protocol is similar but uses `data.text` for chunks (not `data.content`) and `data.type === 'status'` for progress messages
- Result rendered in `#deep-dive-result` with markdown + syntax highlighting (`hljs.highlightElement`)
- Module-level `deepDiveStreaming` flag prevents concurrent requests

### Keyboard Shortcuts
- `Ctrl/Cmd+I` — toggle Ask widget (expand/collapse), focus textarea on expand
- `Escape` — collapse widget if open
- `Enter` (no Shift) in textarea — send question
- `Shift+Enter` in textarea — newline (default behavior)
- `Ctrl/Cmd+B` — toggle sidebar collapse (clicks `#sidebar-collapse` button)

### Textarea Auto-Resize
- On `input` event: reset height to `auto`, then set to `min(scrollHeight, 120)px`
- Keeps textarea compact for single-line, grows for multi-line up to max

### CSS Variables Required
The widget styles depend on these CSS custom properties (already defined in the deep-wiki theme system):
- `--ask-bar-bg`, `--ask-bar-border` — widget background/border
- `--content-bg`, `--content-text`, `--content-muted`, `--content-border` — text and borders
- `--code-bg` — code block and assistant bubble background
- `--sidebar-active-border` — accent color (user bubble bg, send button, focus ring)
- `--stat-bg` — context pill and deep-dive section background
- `--link-color` — context links and deep-dive button text
- `--badge-high-bg` — error text/border color

These must be defined in the CoC wiki tab theme or mapped to existing CoC theme variables.

### Responsive Behavior
- Widget max-width: `calc(100vw - 40px)`, base width 720px, centered with `left:50%; transform:translateX(-50%)`
- `@media (max-width: 768px)`: reduced bottom margin (12px), smaller border-radius (12px), smaller label font

## Tests
- Test widget HTML structure renders in wiki tab (header, messages, input area)
- Test `expandWidget()` / `collapseWidget()` toggle CSS classes and hidden states
- Test `askPanelSend()` prevents double-send when `askStreaming` is true
- Test question submission triggers fetch POST to `/api/wikis/:wikiId/ask` with correct body
- Test SSE `context` event renders component/theme links
- Test SSE `chunk` events accumulate into streaming assistant bubble with markdown
- Test SSE `done` event captures `sessionId` and pushes to `conversationHistory`
- Test SSE `error` event renders error bubble
- Test session ID persistence: second question sends `sessionId` instead of `conversationHistory`
- Test Clear button: DELETE request, resets session/history, clears DOM
- Test deep-dive button insertion and toggle behavior
- Test deep-dive SSE streaming with `status`/`chunk`/`done` events
- Test keyboard shortcuts (Ctrl+I toggle, Escape close, Enter send)
- Test textarea auto-resize on input
- Test error handling when fetch rejects (network error)

## Acceptance Criteria
- [ ] Ask AI widget appears in wiki tab with floating position
- [ ] Questions POST to `/api/wikis/:wikiId/ask` with SSE streaming response
- [ ] Streaming chunks render incrementally with markdown formatting
- [ ] Context event shows clickable component/theme links
- [ ] Multi-turn conversation with `sessionId` reuse across questions
- [ ] Clear button destroys server session and resets client state
- [ ] Deep-dive "Explore Further" button on component articles
- [ ] Deep-dive streams from `/api/wikis/:wikiId/explore/:componentId`
- [ ] Keyboard shortcuts: Ctrl+I toggle, Escape close, Enter send
- [ ] Error states handled gracefully (network errors, AI unavailable, malformed SSE)
- [ ] Widget hidden when admin page is shown (matching deep-wiki sidebar behavior)
- [ ] Responsive layout works on narrow viewports
- [ ] CoC build succeeds (`npm run build` in `packages/coc/`)

## Dependencies
- Depends on: 007 (content renderer for markdown in responses — `marked` library availability)

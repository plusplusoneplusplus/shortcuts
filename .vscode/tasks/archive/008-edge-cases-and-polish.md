---
status: pending
---

# 008: Handle Edge Cases, Session Expiry, and UI Polish

## Summary
Add robustness and polish to the conversational UI: session expiry error handling, scroll-to-bottom floating button, first-time hint, per-message copy button, and localStorage-backed user preferences for auto-scroll and enter-to-send behavior.

## Motivation
The chat UI from commits 006–007 handles the happy path but lacks edge-case handling that users expect from a production chat interface. Session expiry can produce cryptic errors; long conversations lose scroll context; new users don't know follow-ups are possible; and there's no way to copy individual messages. This commit fills those gaps without changing the core message flow.

## Changes

### Files to Create
- `packages/coc/test/server/spa/chat-edge-cases.test.ts` — Tests for session expiry display, scroll-to-bottom visibility, localStorage preference read/write, and copy-button functionality.

### Files to Modify

#### `packages/coc/src/server/spa/client/detail.ts`
Primary changes (all within the conversation/chat rendering area added in 006–007):

1. **Session expiry error handling**
   - In the SSE `chunk` or follow-up API response handler, detect session-expired errors. The follow-up API endpoint should return HTTP 410 Gone (or a JSON body with `{ error: 'session_expired' }`) when the underlying Copilot SDK session has ended.
   - On detection, append an inline error bubble to the conversation: `<div class="chat-error-bubble">⚠️ Session expired. Start a new task to continue.</div>`. Do not crash or leave the UI in a broken state.
   - Disable the input bar (set `disabled` on textarea + send button) so the user cannot send into a dead session.
   - The `queue-executor-bridge.ts` changes (below) produce the 410 status; the client just needs to handle it.

2. **Scroll-to-bottom button**
   - After rendering the conversation container (`.conversation-body` or the new chat bubble container from 006), attach a `scroll` event listener.
   - Track whether the user is "at bottom" (within 80px tolerance): `const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80`.
   - Show/hide a floating `<button class="scroll-to-bottom-btn">↓</button>` absolutely positioned at the bottom-right of the conversation container.
   - On click, call `el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })`.
   - During auto-scroll (streaming new chunks), keep the button hidden — only show when the user has manually scrolled up.
   - Add a module-level `userHasScrolledUp` flag, set to `true` on manual scroll-up, reset to `false` on click of the button or on conversation re-render.

3. **First-time hint**
   - On rendering a completed-task detail that has the chat input bar, check `localStorage.getItem('coc-chat-hint-dismissed')`.
   - If not dismissed, insert a hint element above the input bar: `<div class="chat-hint">💡 You can send follow-up messages to continue the conversation. <button class="chat-hint-dismiss">✕</button></div>`.
   - On first message send OR click of dismiss button: hide the hint and set `localStorage.setItem('coc-chat-hint-dismissed', '1')`.

4. **Per-message copy button**
   - Each chat bubble (user and assistant) rendered in 006 should include a `<button class="msg-copy-btn" title="Copy">📋</button>` positioned top-right of the bubble, visible on hover.
   - The button's `onclick` copies the bubble's **raw markdown source** (stored in a `data-raw` attribute on the bubble element, set during render) via `copyToClipboard()`.
   - After copy, briefly swap button text to "✓ Copied" for 1.5 seconds, then revert.

5. **localStorage preferences**
   - Read two keys on module init:
     - `coc-chat-enter-send` (default `'true'`): when `'true'`, Enter sends; when `'false'`, Ctrl+Enter sends and Enter inserts newline. Wire into the textarea `keydown` handler from 007.
     - `coc-chat-auto-scroll` (default `'true'`): when `'true'`, auto-scroll on new streaming chunks; when `'false'`, suppress `scrollConversationToBottom()` during streaming.
   - Follow the existing pattern from `theme.ts` which uses `localStorage.getItem`/`setItem` with the `ai-dash-` prefix convention. Use `coc-chat-` prefix for chat keys.
   - No settings UI in this commit — values are toggled via browser devtools or a future preferences panel.

6. **Long conversation handling**
   - After rendering > 20 message bubbles, append a subtle separator: `<div class="chat-long-hint">Showing all messages. <button class="scroll-to-bottom-btn">Jump to latest ↓</button></div>` before the 21st message.
   - Reuse the scroll-to-bottom logic from item 2.

7. **Concurrent viewer handling**
   - No code changes needed — the existing SSE architecture already broadcasts to all connected `EventSource` clients. Multiple browser tabs viewing the same process each open their own `/processes/:id/stream` SSE connection and receive identical chunk events.
   - For follow-up submission, the last writer wins: the follow-up API POST is stateless and serialized by the queue executor on the server side. Document this behavior in a code comment.

#### `packages/coc/src/server/queue-executor-bridge.ts`
- In the follow-up API handler (added in 007), detect when the Copilot SDK session has been destroyed or errored. The SDK service emits `session.error` events with `data.message` (see `copilot-sdk-service.ts:1175-1179`) and marks sessions for destruction after errors (`copilot-sdk-service.ts:466-481`).
- When a follow-up is attempted on a dead session, return HTTP 410 Gone with body `{ error: 'session_expired', message: 'The AI session has ended. Please start a new task.' }`.
- This is a small guard at the top of the follow-up handler — check session liveness before forwarding the prompt.

#### `packages/coc/src/server/spa/client/styles.css`
Add styles following existing conventions (`transition: 0.15s`, `var(--border-color)`, `var(--text-secondary)`, `border-radius: 6px`):

1. **`.scroll-to-bottom-btn`** — Floating circular button, `position: absolute; bottom: 16px; right: 16px;`, `width: 32px; height: 32px`, `border-radius: 50%`, `background: var(--bg-primary)`, `border: 1px solid var(--border-color)`, `cursor: pointer`, `opacity: 0; transition: opacity 0.15s;` when hidden, `opacity: 1` when `.visible`. `z-index: 10`. Hover: `background: var(--hover-bg)`.

2. **`.chat-error-bubble`** — Follows `.error-alert` pattern: `background: rgba(241,76,76,0.08)`, `border: 1px solid rgba(241,76,76,0.2)`, `border-radius: 8px`, `color: var(--status-failed)`, `padding: 8px 12px`, `font-size: 12px`, `margin: 8px 0`, `text-align: center`.

3. **`.chat-hint`** — Subtle hint bar: `background: rgba(78,154,241,0.08)`, `border: 1px solid rgba(78,154,241,0.15)`, `border-radius: 6px`, `padding: 6px 12px`, `font-size: 11px`, `color: var(--text-secondary)`, `margin-bottom: 8px`, `display: flex; align-items: center; justify-content: space-between`. Dismiss button: `background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 12px`.

4. **`.msg-copy-btn`** — Positioned `position: absolute; top: 4px; right: 4px;`, `opacity: 0; transition: opacity 0.15s;`. Parent bubble gets `position: relative`. On `.chat-bubble:hover .msg-copy-btn { opacity: 0.7; }`, on `.msg-copy-btn:hover { opacity: 1; }`. `background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 4px; padding: 2px 4px; font-size: 11px; cursor: pointer;`.

5. **`.chat-long-hint`** — `text-align: center; font-size: 11px; color: var(--text-secondary); padding: 8px; border-top: 1px solid var(--border-color); margin: 8px 0`.

### Files to Delete
None.

## Implementation Notes

- **Session expiry detection**: The Copilot SDK service destroys sessions after errors (`copilot-sdk-service.ts:466-481`) and emits `session.error` with a message string (`copilot-sdk-service.ts:1175-1179`). The bridge layer should catch the case where `session.send()` throws or the session is already null/destroyed, and map it to HTTP 410.
- **Scroll tracking**: Use a single `userHasScrolledUp` boolean flag per conversation view lifecycle. Reset on navigation away (`clearDetail`), on explicit scroll-to-bottom click, and on conversation re-render. The `updateConversationContent()` function already calls `scrollConversationToBottom()` — gate this behind the `coc-chat-auto-scroll` preference AND the `!userHasScrolledUp` check.
- **localStorage key naming**: Follow the existing `ai-dash-theme` convention from `theme.ts`. Use `coc-chat-` prefix to namespace chat-specific preferences and avoid collisions.
- **Per-message copy raw source**: During bubble rendering (006), store the raw markdown in `data-raw` attribute on each `.chat-bubble` element. The copy button reads `el.closest('.chat-bubble').getAttribute('data-raw')`. This avoids having to reverse-render HTML back to markdown.
- **Concurrent tabs**: No mutex or locking is needed. The queue executor bridge processes follow-ups sequentially (single-threaded Node.js). If two tabs submit simultaneously, one completes first and the other runs after. Both tabs see all SSE events. Document this as an intentional last-writer-wins design.
- **CSS variable reuse**: All new styles use existing CSS custom properties (`--bg-primary`, `--bg-secondary`, `--border-color`, `--text-secondary`, `--hover-bg`, `--accent`, `--status-failed`) so they automatically respect light/dark/auto themes.
- **No new dependencies**: All features use built-in browser APIs (`localStorage`, `IntersectionObserver` or scroll events, `navigator.clipboard`).

## Tests

### `packages/coc/test/server/spa/chat-edge-cases.test.ts`
- **Session expiry error display**: Mock follow-up API returning 410, verify `.chat-error-bubble` element is rendered with expected text, verify input bar is disabled.
- **Scroll-to-bottom visibility**: Simulate scroll events on a conversation container, verify `.scroll-to-bottom-btn` gains `.visible` class when scrolled up, loses it when at bottom.
- **localStorage preference read/write**: Verify `coc-chat-enter-send` and `coc-chat-auto-scroll` are read on init with correct defaults; verify writes persist.
- **Copy button functionality**: Render a chat bubble with `data-raw` attribute, simulate click on `.msg-copy-btn`, verify `navigator.clipboard.writeText` called with raw markdown.
- **First-time hint**: Verify hint appears when `coc-chat-hint-dismissed` is absent; verify it hides and sets localStorage on dismiss click.
- **Long conversation hint**: Render > 20 bubbles, verify `.chat-long-hint` separator appears.

## Acceptance Criteria
- [ ] Follow-up API returns 410 when session is expired/destroyed
- [ ] Client shows inline error bubble on session expiry (no crash, no unhandled rejection)
- [ ] Input bar is disabled after session expiry
- [ ] Scroll-to-bottom button appears when user scrolls up from bottom during streaming
- [ ] Scroll-to-bottom button hidden when at bottom or during auto-scroll
- [ ] First-time hint shows on first visit, dismisses on click or first send
- [ ] First-time hint dismissal persists in localStorage across page reloads
- [ ] Per-message copy button visible on hover for both user and assistant bubbles
- [ ] Copy button copies raw markdown source, not rendered HTML
- [ ] Brief "Copied" feedback shown after copy
- [ ] `coc-chat-enter-send` localStorage key controls Enter vs Ctrl+Enter behavior
- [ ] `coc-chat-auto-scroll` localStorage key controls streaming auto-scroll
- [ ] Conversations > 20 turns show "Jump to latest" separator
- [ ] Multiple browser tabs receive SSE updates for the same process
- [ ] All new tests pass on Linux, macOS, and Windows
- [ ] All existing tests in `packages/coc/test/` pass unchanged

## Dependencies
- Depends on: 006 (chat bubbles and conversation rendering), 007 (input bar, follow-up API, send flow)

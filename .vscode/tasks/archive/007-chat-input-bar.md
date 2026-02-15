---
status: pending
---

# 007: Add Chat Input Bar and Follow-Up Message Sending

## Summary

Add a chat input bar at the bottom of the queue task detail panel and wire it to send follow-up messages via `POST /api/processes/:id/message`. The input captures user text, optimistically renders chat bubbles, streams the assistant response via SSE, and disables itself during active streaming.

## Motivation

Commits 003 (API endpoint), 005 (CSS), and 006 (bubble rendering) established the backend message endpoint, the conversation styling, and the bubble DOM structure. This commit adds the interactive input surface — the textarea bar and its keyboard/send logic — turning the detail panel into a fully functional chat interface. Without this, users can only observe the initial task output but cannot continue the conversation.

## Changes

### 1. `packages/coc/src/server/spa/client/state.ts` — Add follow-up streaming state

Add two new fields to the `QueueState` interface (after `showHistory`, around line 45):

```typescript
export interface QueueState {
    // ... existing fields ...
    showHistory: boolean;
    isFollowUpStreaming: boolean;
    currentStreamingTurnIndex: number | null;
}
```

Initialize them in the `queueState` constant (after `showHistory: false`, around line 53):

```typescript
export const queueState: QueueState = {
    // ... existing fields ...
    showHistory: false,
    isFollowUpStreaming: false,
    currentStreamingTurnIndex: null,
};
```

These two fields track whether a follow-up SSE stream is active (`isFollowUpStreaming`) and which assistant bubble index to append chunks to (`currentStreamingTurnIndex`). They are separate from the initial task stream state (`activeQueueTaskStream`) so the two streaming modes don't interfere.

### 2. `packages/coc/src/server/spa/client/detail.ts` — Render input bar

#### 2a. Update `renderQueueTaskConversation()` — append input bar HTML

After the closing `</div></div>` of the conversation section (line 294) and before the action buttons `<div class="action-buttons">` (line 297), insert the chat input bar:

```typescript
// Chat input bar
const inputDisabled = (status === 'running' && queueState.isFollowUpStreaming) ||
    status === 'queued' || status === 'cancelled';
const placeholderText = getInputPlaceholder(status);

html += '<div class="chat-input-bar' + (inputDisabled ? ' disabled' : '') + '">' +
    '<textarea id="chat-input" rows="1" placeholder="' + escapeHtmlClient(placeholderText) + '"' +
    (inputDisabled ? ' disabled' : '') + '></textarea>' +
    '<button id="chat-send-btn" class="chat-send-btn" title="Send message"' +
    (inputDisabled ? ' disabled' : '') + '>\u27A4</button>' +
    '</div>';
```

The `chat-input-bar` class and its children are styled by commit 005. The bar appears at the bottom of every queue task detail view, disabled when the task is still queued, cancelled, or actively streaming a follow-up.

#### 2b. Call `initChatInputHandlers()` after rendering

At the end of `renderQueueTaskConversation()`, after `contentEl.innerHTML = html;` (line 304) and the existing auto-scroll block (lines 307-309), add:

```typescript
// Wire chat input handlers
initChatInputHandlers(processId);
```

This attaches keyboard and click listeners to the textarea and send button that were just rendered.

### 3. `packages/coc/src/server/spa/client/detail.ts` — New function `getInputPlaceholder()`

Add a helper that returns context-sensitive placeholder text:

```typescript
function getInputPlaceholder(status: string): string {
    if (queueState.isFollowUpStreaming) return 'Waiting for response...';
    if (status === 'completed') return 'Continue this conversation...';
    if (status === 'queued') return 'Follow-ups available once task starts...';
    if (status === 'failed') return 'Retry or ask a follow-up...';
    if (status === 'running') return 'Waiting for response...';
    if (status === 'cancelled') return 'Task was cancelled';
    return 'Send a message...';
}
```

### 4. `packages/coc/src/server/spa/client/detail.ts` — New function `initChatInputHandlers()`

Attaches event listeners to the chat input textarea and send button:

```typescript
function initChatInputHandlers(processId: string): void {
    const textarea = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
    if (!textarea || !sendBtn) return;

    // Auto-grow textarea (1–4 lines)
    textarea.addEventListener('input', function() {
        textarea.style.height = 'auto';
        const maxHeight = parseInt(getComputedStyle(textarea).lineHeight || '20', 10) * 4;
        textarea.style.height = Math.min(textarea.scrollHeight, maxHeight) + 'px';
    });

    // Enter sends, Shift+Enter inserts newline
    textarea.addEventListener('keydown', function(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            const content = textarea.value.trim();
            if (content && !textarea.disabled) {
                sendFollowUpMessage(processId, content);
                textarea.value = '';
                textarea.style.height = 'auto';
            }
        }
    });

    // Send button click
    sendBtn.addEventListener('click', function() {
        const content = textarea.value.trim();
        if (content && !textarea.disabled) {
            sendFollowUpMessage(processId, content);
            textarea.value = '';
            textarea.style.height = 'auto';
        }
    });
}
```

The `input` listener resets height to `auto` first, then clamps to 4× line-height. This produces the grow-from-1-to-4-lines effect without a scrollbar until the max is reached.

### 5. `packages/coc/src/server/spa/client/detail.ts` — New function `sendFollowUpMessage()`

Handles the full lifecycle of a follow-up: optimistic UI → POST → SSE → re-enable input.

```typescript
function sendFollowUpMessage(processId: string, content: string): void {
    if (!content.trim()) return;

    // Disable input bar
    setInputBarDisabled(true);
    queueState.isFollowUpStreaming = true;

    // Optimistic UI: append user bubble immediately
    const conversationEl = document.getElementById('queue-task-conversation');
    if (conversationEl) {
        const userBubble = document.createElement('div');
        userBubble.className = 'chat-bubble user';
        userBubble.innerHTML = renderMarkdown(content);
        conversationEl.appendChild(userBubble);

        // Append empty assistant bubble with streaming indicator
        const assistantBubble = document.createElement('div');
        assistantBubble.className = 'chat-bubble assistant streaming';
        assistantBubble.id = 'follow-up-assistant-bubble';
        assistantBubble.innerHTML = '<span class="streaming-indicator">\u25CF</span>';
        conversationEl.appendChild(assistantBubble);

        scrollConversationToBottom();
    }

    // POST the message
    fetch(getApiBase() + '/processes/' + encodeURIComponent(processId) + '/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: content }),
    }).then(function(res) {
        if (!res.ok) throw new Error('Failed to send message: ' + res.status);
        return res.json();
    }).then(function(data) {
        // Success — connect SSE for the streaming response
        const turnIndex = data && data.turnIndex != null ? data.turnIndex : null;
        queueState.currentStreamingTurnIndex = turnIndex;
        connectFollowUpSSE(processId);
    }).catch(function(err) {
        // Error — mark the user bubble with error state
        queueState.isFollowUpStreaming = false;
        queueState.currentStreamingTurnIndex = null;
        setInputBarDisabled(false);

        const bubble = document.getElementById('follow-up-assistant-bubble');
        if (bubble) {
            bubble.classList.remove('streaming');
            bubble.classList.add('error');
            bubble.innerHTML = '<div class="bubble-error">' +
                escapeHtmlClient(err.message || 'Failed to send message') +
                '<button class="retry-btn" onclick="sendFollowUpMessage(\'' +
                escapeHtmlClient(processId) + '\', ' +
                escapeHtmlClient(JSON.stringify(content)) + ')">Retry</button></div>';
        }
    });
}
```

The optimistic UI pattern ensures the user bubble appears instantly. If the POST fails, the assistant bubble shows the error with a retry button. The `streaming` class is styled by commit 005 to show a pulsing indicator.

### 6. `packages/coc/src/server/spa/client/detail.ts` — New function `connectFollowUpSSE()`

Streams the assistant response into the follow-up assistant bubble:

```typescript
function connectFollowUpSSE(processId: string): void {
    const sseUrl = getApiBase() + '/processes/' + encodeURIComponent(processId) + '/stream';
    const eventSource = new EventSource(sseUrl);
    let accumulatedContent = '';

    eventSource.addEventListener('chunk', function(e: MessageEvent) {
        try {
            const data = JSON.parse(e.data);
            if (data.content) {
                accumulatedContent += data.content;
                const bubble = document.getElementById('follow-up-assistant-bubble');
                if (bubble) {
                    bubble.classList.remove('streaming');
                    bubble.innerHTML = renderMarkdown(accumulatedContent);
                }
                scrollConversationToBottom();
            }
        } catch(err) {}
    });

    eventSource.addEventListener('done', function() {
        eventSource.close();
        queueState.isFollowUpStreaming = false;
        queueState.currentStreamingTurnIndex = null;
        setInputBarDisabled(false);

        // Remove the temporary id so future follow-ups get a fresh bubble
        const bubble = document.getElementById('follow-up-assistant-bubble');
        if (bubble) {
            bubble.removeAttribute('id');
        }

        // Update placeholder text
        const textarea = document.getElementById('chat-input') as HTMLTextAreaElement | null;
        if (textarea) {
            textarea.placeholder = getInputPlaceholder('completed');
            textarea.focus();
        }
    });

    eventSource.addEventListener('status', function(e: MessageEvent) {
        // Status change during follow-up — no full re-render needed,
        // the done event will finalize state
    });

    eventSource.addEventListener('heartbeat', function() {
        // Keep-alive — no action needed
    });

    eventSource.onerror = function() {
        eventSource.close();
        queueState.isFollowUpStreaming = false;
        queueState.currentStreamingTurnIndex = null;
        setInputBarDisabled(false);

        const bubble = document.getElementById('follow-up-assistant-bubble');
        if (bubble && !accumulatedContent) {
            bubble.classList.remove('streaming');
            bubble.classList.add('error');
            bubble.innerHTML = '<div class="bubble-error">Connection lost. ' +
                '<button class="retry-btn" onclick="connectFollowUpSSE(\'' +
                escapeHtmlClient(processId) + '\')">Reconnect</button></div>';
        } else if (bubble) {
            // Partial content received — keep what we have, remove streaming state
            bubble.classList.remove('streaming');
            bubble.removeAttribute('id');
        }
    };
}
```

Key differences from `connectQueueTaskSSE()`:
- Only updates the single `#follow-up-assistant-bubble` element, not the full conversation.
- Re-enables the input bar on completion or error.
- Removes the temporary `id` attribute on done so subsequent follow-ups each get their own bubble.
- Does not trigger a full re-render on `status` events.

### 7. `packages/coc/src/server/spa/client/detail.ts` — New helper `setInputBarDisabled()`

Toggles the disabled state of the input bar components:

```typescript
function setInputBarDisabled(disabled: boolean): void {
    const textarea = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    const sendBtn = document.getElementById('chat-send-btn') as HTMLButtonElement | null;
    const bar = textarea?.closest('.chat-input-bar');

    if (textarea) textarea.disabled = disabled;
    if (sendBtn) sendBtn.disabled = disabled;
    if (bar) {
        if (disabled) bar.classList.add('disabled');
        else bar.classList.remove('disabled');
    }

    // Update placeholder
    if (textarea) {
        const status = disabled ? 'running' : 'completed';
        textarea.placeholder = getInputPlaceholder(status);
    }
}
```

### 8. `packages/coc/src/server/spa/client/detail.ts` — Register globals

Add the new functions to the window exports (after the existing `(window as any)` assignments at the bottom of the file, around line 546):

```typescript
(window as any).sendFollowUpMessage = sendFollowUpMessage;
(window as any).connectFollowUpSSE = connectFollowUpSSE;
```

These are needed because the retry button `onclick` handlers reference them by name from inline HTML.

### 9. `packages/coc/src/server/spa/client/detail.ts` — Add import for `queueState`

At the top of the file (line 7), add `queueState` to the existing import from `./state`:

```typescript
import { appState, queueState } from './state';
```

This import already exists (line 6 currently imports both), so verify it includes `queueState`. If not, add it.

## Tests

All tests live in the existing CoC test infrastructure (`packages/coc/test/`).

### Input bar rendering tests
- Verify `renderQueueTaskConversation()` output contains `.chat-input-bar` with textarea and send button
- Verify textarea placeholder is `"Continue this conversation..."` when status is `completed`
- Verify textarea placeholder is `"Follow-ups available once task starts..."` when status is `queued`
- Verify textarea placeholder is `"Waiting for response..."` when status is `running`
- Verify textarea placeholder is `"Retry or ask a follow-up..."` when status is `failed`
- Verify textarea and button have `disabled` attribute when `isFollowUpStreaming` is true
- Verify textarea and button have `disabled` attribute when status is `queued`
- Verify textarea and button have `disabled` attribute when status is `cancelled`

### sendFollowUpMessage tests
- Verify POST is made to `/api/processes/:id/message` with `{ content }` body
- Verify user bubble (`div.chat-bubble.user`) is appended to conversation before POST resolves (optimistic UI)
- Verify empty assistant bubble (`div.chat-bubble.assistant.streaming`) is appended
- Verify input bar is disabled during send
- Verify on POST failure, assistant bubble shows error with retry button
- Verify on POST failure, input bar is re-enabled

### Input interaction tests
- Verify Enter key triggers send (calls `sendFollowUpMessage`)
- Verify Shift+Enter does not trigger send (allows newline)
- Verify empty content does not trigger send
- Verify textarea auto-grows up to 4 lines
- Verify input bar is disabled during streaming and re-enabled on done

### State tests
- Verify `queueState.isFollowUpStreaming` is set to `true` during send
- Verify `queueState.isFollowUpStreaming` is reset to `false` on SSE done
- Verify `queueState.currentStreamingTurnIndex` is set from POST response

Run: `cd packages/coc && npm run test:run`

## Acceptance Criteria

- [ ] Input bar visible at the bottom of every queue task detail view
- [ ] Enter sends the message; Shift+Enter inserts a newline
- [ ] Textarea auto-grows from 1 to 4 lines, then scrolls internally
- [ ] Placeholder text changes based on task status (`completed`, `queued`, `running`, `failed`, `cancelled`)
- [ ] Sending a follow-up immediately shows a user bubble (optimistic UI)
- [ ] An empty assistant bubble with streaming indicator appears while waiting
- [ ] SSE streaming populates the assistant bubble incrementally
- [ ] Input bar is disabled during active streaming (both initial and follow-up)
- [ ] Input bar re-enables and focuses textarea when streaming completes
- [ ] POST failure shows error message on the assistant bubble with a retry button
- [ ] SSE connection error with no content shows reconnect button
- [ ] SSE connection error with partial content keeps the partial content
- [ ] `queueState.isFollowUpStreaming` and `currentStreamingTurnIndex` are correctly managed
- [ ] All existing CoC tests continue to pass

## Dependencies

- Depends on: 003 (API endpoint for `/api/processes/:id/message`), 005 (CSS for `.chat-input-bar`, `.chat-bubble`, `.streaming-indicator`, `.bubble-error`, `.retry-btn`), 006 (bubble rendering structure)
- Depended on by: 008 (conversation history persistence), 009 (integration tests)

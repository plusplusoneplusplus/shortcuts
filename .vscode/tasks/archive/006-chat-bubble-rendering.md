---
status: pending
commit: 6 of 9
feature: ChatGPT-style Conversational UI for CoC Dashboard
package: coc
depends_on: 001-conversation-turn-type, 005-css-styles
---

# Commit 6: Convert Detail Panel to Render Chat Message Bubbles

## Goal

Transform the flat markdown output in `renderQueueTaskConversation()` into individual chat bubbles for each conversation turn. User prompts and assistant responses render as visually distinct bubbles with role labels, timestamps, and streaming indicators. No interactivity yet — this commit is purely visual conversion.

## Prerequisites

- Commit 1 merged: `ConversationTurn` type available (with `role`, `content`, `timestamp`, `streaming` fields).
- Commit 5 merged: CSS classes for chat bubbles (`.chat-bubble`, `.chat-bubble-user`, `.chat-bubble-assistant`, `.bubble-header`, `.streaming-indicator`, `.bubble-copy-btn`, etc.) are in the stylesheet.

## Files to Change

| File | What |
|------|------|
| `packages/coc/src/server/spa/client/state.ts` | Add `queueTaskConversationTurns` state variable |
| `packages/coc/src/server/spa/client/detail.ts` | New `renderChatMessage()`, update `renderQueueTaskConversation()`, `showQueueTaskDetail()`, `updateConversationContent()`, `connectQueueTaskSSE()`, collapsible metadata |

## Detailed Changes

### 1. `packages/coc/src/server/spa/client/state.ts` — Add conversation turns state

Add a module-level array to hold the parsed conversation turns for the currently-viewed queue task. Keep the existing `queueTaskStreamContent` (in `detail.ts`) for accumulating the active streaming chunk.

```typescript
// After the TaskPanelState block (line ~71):

// ================================================================
// Queue Task Conversation State
// ================================================================

/** Parsed conversation turns for the active queue task detail view */
export let queueTaskConversationTurns: ConversationTurn[] = [];

export function setQueueTaskConversationTurns(turns: ConversationTurn[]): void {
    queueTaskConversationTurns = turns;
}
```

Import `ConversationTurn` from the types defined in commit 1. Use a setter function so other modules can update the array without direct reassignment of the exported binding.

### 2. `packages/coc/src/server/spa/client/detail.ts`

#### 2a. New function `renderChatMessage(turn)` — Render a single chat bubble

Add after the existing `renderMarkdown` function (or near `renderQueueTaskConversation`):

```typescript
function renderChatMessage(turn: ConversationTurn): string {
    const isUser = turn.role === 'user';
    const roleLabel = isUser ? 'You' : 'Assistant';
    const roleIcon = isUser ? '👤' : '🤖';
    const bubbleClass = isUser ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-assistant';

    let html = '<div class="' + bubbleClass + '">';

    // Header: role label + icon + timestamp + optional streaming indicator
    html += '<div class="bubble-header">';
    html += '<span class="bubble-role">' + roleIcon + ' ' + roleLabel + '</span>';
    if (turn.timestamp) {
        html += '<span class="bubble-time">' + new Date(turn.timestamp).toLocaleTimeString() + '</span>';
    }
    if (turn.streaming) {
        html += '<span class="streaming-indicator">● Live</span>';
    }
    html += '</div>';

    // Content
    html += '<div class="bubble-content">' + renderMarkdown(turn.content || '') + '</div>';

    // Copy button (assistant messages only, shown on hover via CSS)
    if (!isUser && turn.content) {
        html += '<button class="bubble-copy-btn" onclick="copyToClipboard(' +
            escapeHtmlClient(JSON.stringify(turn.content)) +
            ')" title="Copy message">📋</button>';
    }

    html += '</div>';
    return html;
}
```

Key design decisions:
- Role icons are emoji to avoid extra asset dependencies.
- Copy button is rendered in the DOM but hidden by default; CSS from commit 5 shows it on `.chat-bubble:hover`.
- `turn.streaming` flag drives the "● Live" indicator (same style already used in the conversation header).
- The existing `renderMarkdown()` handles all content formatting.

#### 2b. Update `renderQueueTaskConversation()` — Iterate over turns instead of single block

Replace the conversation area rendering (lines 277-294) with turn-based logic:

```typescript
function renderQueueTaskConversation(processId: string, taskId: string, proc: any): void {
    const contentEl = document.getElementById('detail-content');
    if (!contentEl) return;

    // ... existing name/status/prompt/error extraction (lines 208-234) unchanged ...

    const isRunning = (status === 'running' || status === 'queued');
    const statusClass = status || 'running';

    // ... existing detail-header HTML (lines 239-247) unchanged ...

    // Metadata — collapsed by default
    html += '<details class="meta-section">';
    html += '<summary class="meta-summary">';
    html += escapeHtmlClient(processId);
    if (proc && proc.metadata && proc.metadata.model) {
        html += ' · ' + escapeHtmlClient(proc.metadata.model);
    }
    if (startTime) {
        html += ' · ' + startTime;
    }
    html += '</summary>';
    html += '<div class="meta-grid">';
    html += '<div class="meta-item"><label>Process ID</label><span>' + escapeHtmlClient(processId) + '</span></div>';
    if (proc && proc.metadata && proc.metadata.model) {
        html += '<div class="meta-item"><label>Model</label><span>' + escapeHtmlClient(proc.metadata.model) + '</span></div>';
    }
    if (proc && proc.workingDirectory) {
        html += '<div class="meta-item"><label>Working Directory</label><span class="meta-path">' + escapeHtmlClient(proc.workingDirectory) + '</span></div>';
    }
    if (startTime) {
        html += '<div class="meta-item"><label>Started</label><span>' + startTime + '</span></div>';
    }
    if (endTime) {
        html += '<div class="meta-item"><label>Ended</label><span>' + endTime + '</span></div>';
    }
    html += '</div>';
    html += '</details>';

    // Error
    if (error) {
        html += '<div class="error-alert">' + escapeHtmlClient(error) + '</div>';
    }

    // Prompt (collapsible) — keep as-is
    if (prompt) {
        html += '<details class="prompt-section"><summary>Prompt</summary>' +
            '<div class="prompt-body">' + escapeHtmlClient(prompt) + '</div></details>';
    }

    // Conversation area — chat bubbles
    html += '<div class="conversation-section">' +
        '<h2>Conversation</h2>' +
        '<div id="queue-task-conversation" class="conversation-body">';

    const turns = queueTaskConversationTurns;

    if (turns.length > 0) {
        // Render each turn as a chat bubble
        for (let i = 0; i < turns.length; i++) {
            html += renderChatMessage(turns[i]);
        }
    } else if (proc && proc.result && !isRunning) {
        // Backward compatibility: no conversationTurns, build synthetic bubbles
        if (proc.promptPreview) {
            html += renderChatMessage({
                role: 'user',
                content: proc.promptPreview,
                timestamp: proc.startTime || undefined,
            });
        }
        html += renderChatMessage({
            role: 'assistant',
            content: proc.result,
            timestamp: proc.endTime || undefined,
        });
    } else if (queueTaskStreamContent) {
        // Streaming in progress with no parsed turns — legacy path
        html += renderChatMessage({
            role: 'assistant',
            content: queueTaskStreamContent,
            streaming: true,
        });
    } else if (isRunning) {
        html += '<div class="conversation-waiting">Waiting for response...</div>';
    } else {
        html += '<div class="conversation-waiting">No conversation data available.</div>';
    }

    html += '</div></div>';

    // ... existing action buttons (lines 296-303) unchanged ...

    contentEl.innerHTML = html;

    if (isRunning) {
        scrollConversationToBottom();
    }
}
```

Key changes:
- The `<div class="meta-grid">` is wrapped inside a `<details class="meta-section">` element, collapsed by default. The `<summary>` shows a one-line overview (process ID, model, start time).
- The conversation body iterates `queueTaskConversationTurns` and calls `renderChatMessage()` per turn.
- The "● Live" indicator moves from the `<h2>` header into individual streaming bubbles (via `turn.streaming`).
- **Backward compatibility:** When `turns` is empty but `proc.result` exists, synthesize a user bubble from `promptPreview` and an assistant bubble from `result`.

#### 2c. Update `showQueueTaskDetail()` — Populate conversation turns state

```typescript
export function showQueueTaskDetail(taskId: string): void {
    const processId = 'queue-' + taskId;

    closeQueueTaskStream();

    const emptyEl = document.getElementById('detail-empty');
    const contentEl = document.getElementById('detail-content');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (!contentEl) return;
    contentEl.classList.remove('hidden');

    queueTaskStreamContent = '';
    queueTaskStreamProcessId = processId;

    // Reset conversation turns
    setQueueTaskConversationTurns([]);

    fetchApi('/processes/' + encodeURIComponent(processId)).then(function(data: any) {
        const proc = data && data.process ? data.process : null;

        // Populate conversation turns from process data
        if (proc && proc.conversationTurns && proc.conversationTurns.length > 0) {
            setQueueTaskConversationTurns(proc.conversationTurns);
        } else if (proc) {
            // Build synthetic turns from legacy fields
            const syntheticTurns: ConversationTurn[] = [];
            if (proc.promptPreview) {
                syntheticTurns.push({
                    role: 'user',
                    content: proc.promptPreview,
                    timestamp: proc.startTime || undefined,
                });
            }
            if (proc.result) {
                syntheticTurns.push({
                    role: 'assistant',
                    content: proc.result,
                    timestamp: proc.endTime || undefined,
                });
            }
            setQueueTaskConversationTurns(syntheticTurns);
        }

        renderQueueTaskConversation(processId, taskId, proc);
        connectQueueTaskSSE(processId, taskId, proc);
    }).catch(function() {
        renderQueueTaskConversation(processId, taskId, null);
        connectQueueTaskSSE(processId, taskId, null);
    });
}
```

Changes from current implementation (lines 175-202):
- Import and call `setQueueTaskConversationTurns([])` to reset state on each new detail view.
- After fetching process data, populate `queueTaskConversationTurns` from `proc.conversationTurns` if available, otherwise build synthetic turns from `promptPreview` + `result`.

#### 2d. Update `updateConversationContent()` — Target only the streaming bubble

Instead of replacing the entire `#queue-task-conversation` innerHTML (which re-renders all bubbles), target only the last assistant bubble:

```typescript
function updateConversationContent(): void {
    const container = document.getElementById('queue-task-conversation');
    if (!container) return;

    // Find the last chat bubble (the streaming one)
    const bubbles = container.querySelectorAll('.chat-bubble-assistant');
    const lastBubble = bubbles.length > 0 ? bubbles[bubbles.length - 1] : null;

    if (lastBubble) {
        // Update only the content div inside the last assistant bubble
        const contentDiv = lastBubble.querySelector('.bubble-content');
        if (contentDiv) {
            contentDiv.innerHTML = renderMarkdown(queueTaskStreamContent);
        }
    } else {
        // No assistant bubble yet — append one (streaming just started)
        const streamingTurn: ConversationTurn = {
            role: 'assistant',
            content: queueTaskStreamContent,
            streaming: true,
        };
        container.insertAdjacentHTML('beforeend', renderChatMessage(streamingTurn));
    }

    scrollConversationToBottom();
}
```

Key improvement over current implementation (lines 390-395):
- Current code replaces `el.innerHTML` on every chunk, causing all bubbles to be re-parsed.
- New code finds the last `.chat-bubble-assistant` and updates only its `.bubble-content` child.
- If no assistant bubble exists yet (first chunk), it appends one using `insertAdjacentHTML`.

#### 2e. Update `connectQueueTaskSSE()` — Accumulate into last turn

Update the `chunk` event listener (lines 322-334) to also maintain the turns array:

```typescript
eventSource.addEventListener('chunk', function(e: MessageEvent) {
    if (queueTaskStreamProcessId !== processId) {
        eventSource.close();
        return;
    }
    try {
        const data = JSON.parse(e.data);
        if (data.content) {
            queueTaskStreamContent += data.content;

            // Update the last assistant turn's content in state
            const turns = queueTaskConversationTurns;
            if (turns.length > 0 && turns[turns.length - 1].role === 'assistant') {
                turns[turns.length - 1].content = queueTaskStreamContent;
                turns[turns.length - 1].streaming = true;
            }

            updateConversationContent();
        }
    } catch(err) {}
});
```

Update the `status` event listener (lines 336-349): when the process completes, mark the last turn as no longer streaming:

```typescript
eventSource.addEventListener('status', function(e: MessageEvent) {
    if (queueTaskStreamProcessId !== processId) {
        eventSource.close();
        return;
    }
    try {
        const data = JSON.parse(e.data);
        // Mark streaming complete
        const turns = queueTaskConversationTurns;
        if (turns.length > 0 && turns[turns.length - 1].streaming) {
            turns[turns.length - 1].streaming = false;
        }
        // Refresh the full detail to show final state
        fetchApi('/processes/' + encodeURIComponent(processId)).then(function(result: any) {
            if (result && result.process) {
                if (result.process.conversationTurns && result.process.conversationTurns.length > 0) {
                    setQueueTaskConversationTurns(result.process.conversationTurns);
                }
                renderQueueTaskConversation(processId, taskId, result.process);
            }
        });
    } catch(err) {}
});
```

### 3. Collapsible Metadata

The metadata `<div class="meta-grid">` (lines 250-264) is replaced with a `<details>` element as shown in section 2b above. The CSS from commit 5 should already style `.meta-section` and `.meta-summary`. The summary line shows: process ID, model (if present), and start time — enough context without expanding.

## Data Flow Summary

```
showQueueTaskDetail(taskId)
  │
  ├─ setQueueTaskConversationTurns([])          -- reset state
  ├─ fetchApi('/processes/:id')                  -- get process data
  │     │
  │     ├─ proc.conversationTurns exists?
  │     │     YES → setQueueTaskConversationTurns(proc.conversationTurns)
  │     │     NO  → build synthetic turns from promptPreview + result
  │     │
  │     └─ renderQueueTaskConversation()
  │           │
  │           ├─ turns.length > 0 → iterate, renderChatMessage(turn) per turn
  │           └─ turns empty + proc.result → synthetic user+assistant bubbles
  │
  └─ connectQueueTaskSSE()
        │
        ├─ 'chunk' event → queueTaskStreamContent += chunk
        │     │              update last assistant turn in state
        │     └──────────→ updateConversationContent()
        │                    │
        │                    └─ find last .chat-bubble-assistant
        │                       update only .bubble-content innerHTML
        │
        └─ 'status' event → mark streaming=false
                             re-fetch process, update turns, full re-render
```

## Testing

### Unit tests to add (in the appropriate test file for `detail.ts`)

1. **`renderChatMessage` produces correct HTML for user turn** — call with `{ role: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00Z' }`, assert output contains `chat-bubble-user`, `👤`, `You`, rendered markdown of "Hello", and timestamp.

2. **`renderChatMessage` produces correct HTML for assistant turn** — call with `{ role: 'assistant', content: '**Bold**' }`, assert output contains `chat-bubble-assistant`, `🤖`, `Assistant`, `<strong>Bold</strong>`, and a copy button.

3. **`renderChatMessage` with streaming flag** — call with `{ role: 'assistant', content: 'partial', streaming: true }`, assert output contains `streaming-indicator` and `● Live`.

4. **`renderChatMessage` without timestamp** — call with no `timestamp` field, assert no `.bubble-time` span is rendered.

5. **`renderChatMessage` copy button only on assistant** — user turn should NOT contain `.bubble-copy-btn`; assistant turn should.

6. **Backward compatibility: no conversationTurns** — simulate `renderQueueTaskConversation` with `proc = { promptPreview: 'Q', result: 'A', status: 'completed' }` and empty `queueTaskConversationTurns`. Assert output contains one `chat-bubble-user` and one `chat-bubble-assistant`.

7. **Backward compatibility: no proc at all** — simulate with `proc = null`, `queueTaskConversationTurns = []`, `queueTaskStreamContent = ''`. Assert output contains `conversation-waiting`.

8. **Turns rendering** — set `queueTaskConversationTurns` to 3 turns (user, assistant, user), call render, assert 3 `.chat-bubble` elements in correct order.

9. **Streaming update targets correct bubble** — set up DOM with two assistant bubbles. Call `updateConversationContent()`. Assert only the last `.chat-bubble-assistant .bubble-content` is updated.

10. **Metadata collapsed by default** — assert rendered HTML contains `<details class="meta-section">` (not `<details class="meta-section" open>`).

## Acceptance Criteria

- [ ] `queueTaskConversationTurns` state variable exists in `state.ts` with getter/setter
- [ ] `renderChatMessage()` renders user and assistant bubbles with correct CSS classes
- [ ] Role labels show "You" (👤) for user, "Assistant" (🤖) for assistant
- [ ] Timestamps display in bubble headers when available
- [ ] "● Live" streaming indicator shows on bubbles with `streaming: true`
- [ ] Copy button renders on assistant bubbles (hidden by default, shown on hover)
- [ ] `renderQueueTaskConversation()` iterates `queueTaskConversationTurns` for bubble rendering
- [ ] Backward compatible: processes without `conversationTurns` render synthetic user+assistant bubbles from `promptPreview`/`result`
- [ ] `showQueueTaskDetail()` populates `queueTaskConversationTurns` from process data or builds synthetic turns
- [ ] `updateConversationContent()` updates only the last assistant bubble's content, not the entire conversation
- [ ] `connectQueueTaskSSE()` accumulates chunks into the last assistant turn's content in state
- [ ] Metadata grid is wrapped in a collapsed `<details>` with a one-line summary
- [ ] All existing tests pass (no regressions)
- [ ] New tests cover `renderChatMessage` HTML structure, backward compatibility, and streaming bubble targeting

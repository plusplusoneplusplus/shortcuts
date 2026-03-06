---
status: pending
---

# 004: Chat Sub-Tab E2E Tests

## Summary

End-to-end Playwright tests for the RepoChatTab and ChatSessionSidebar components, covering the full chat lifecycle: starting a chat, streaming responses, follow-up messages, session sidebar management (pin, archive, cancel), model selection, read-only mode, and copy-conversation — all using the existing `mockAI` fixture.

## Motivation

The Chat sub-tab is the primary interactive AI surface in the CoC dashboard — it handles multi-turn conversations, real-time SSE streaming, session management, and model selection. Despite this complexity, it has ZERO e2e test coverage. The queue-conversation tests cover the older process-detail conversation view (navigated via `#process/queue_<id>`), but they never exercise the chat sub-tab's split-panel layout, sidebar session list, new-chat flow (POST `/queue` with `type: 'chat'`), or sidebar operations (pin/archive/cancel). A single flawed deployment could break the entire chat UX with no safety net.

## Changes

### Files to Create

- `packages/coc/test/e2e/chat-subtab.spec.ts` — 8–10 test cases covering:
  1. Chat split panel renders with sidebar and start screen
  2. Starting a new chat triggers POST `/queue` and shows streaming response
  3. Follow-up messages via POST `/processes/{pid}/message`
  4. Model select dropdown populates from GET `/queue/models`
  5. Read-only toggle sets payload.readonly and shows badge
  6. Session sidebar: selecting sessions, new-chat split button dropdown
  7. Session sidebar: pin/unpin via context menu
  8. Session sidebar: archive/unarchive toggle
  9. Cancel queued chat via sidebar and inline button
  10. Copy conversation button

### Files to Modify

- None

### Files to Delete

- None

## Implementation Notes

### Navigation to Chat Sub-Tab

The chat sub-tab lives under the repos detail view. Navigate via deep-link hash:

```ts
// Seed a workspace, then navigate directly to chat sub-tab
import { seedWorkspace } from './fixtures/seed';

await seedWorkspace(serverUrl, 'ws-chat-1', 'ChatRepo', '/tmp/chat-repo');
await page.goto(`${serverUrl}/#repos/ws-chat-1/chat`);
await expect(page.locator('[data-testid="chat-split-panel"]')).toBeVisible({ timeout: 5000 });
```

Alternatively, click through the UI:

```ts
await page.click('[data-tab="repos"]');
await page.click('.repo-item');                                // first workspace
await page.click('.repo-sub-tab[data-subtab="chat"]');         // chat tab
await expect(page.locator('.repo-sub-tab[data-subtab="chat"]')).toHaveClass(/active/);
```

### Mocking the Models Endpoint

RepoChatTab fetches `GET /api/queue/models` on mount. Use `page.route()` to intercept:

```ts
await page.route('**/api/queue/models', route =>
    route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ models: ['gpt-4o', 'claude-sonnet-4', 'gemini-2.0-flash'] }),
    }),
);
```

### Mocking the Skills Endpoint

RepoChatTab fetches `GET /api/workspaces/{id}/skills` on mount. Mock it to provide slash command data:

```ts
await page.route('**/api/workspaces/*/skills', route =>
    route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ skills: [{ name: 'code-review', description: 'Review code' }] }),
    }),
);
```

### Starting a New Chat (First Message)

The start screen shows a textarea (no `id` — select via `[data-testid="chat-start-controls"]` parent), a model `<select>` (`[data-testid="chat-model-select"]`), a read-only checkbox (`[data-testid="chat-readonly-toggle"] input`), and a "Start Chat" button.

```ts
// Type a message in the start-screen textarea
const startTextarea = page.locator('[data-testid="chat-start-controls"]').locator('..').locator('textarea');
await startTextarea.fill('Explain the architecture');

// Optionally select model
await page.selectOption('[data-testid="chat-model-select"]', 'gpt-4o');

// Click Start Chat
await page.click('button:has-text("Start Chat")');
```

The click fires a `POST /api/queue` with `{ type: 'chat', workspaceId, prompt, ... }`. The mock AI default response (`success: true, response: 'AI response text', sessionId: 'session-123'`) will resolve the task. Poll or wait for the conversation bubbles:

```ts
await expect(page.locator('.chat-message.user')).toHaveCount(1, { timeout: 5000 });
await expect(page.locator('.chat-message.assistant')).toHaveCount(1, { timeout: 10000 });
```

### Simulating Streaming Responses

Use `mockAI.createStreamingResponse()` or `mockAI.mockSendMessage.mockImplementation()` exactly as in `queue-conversation.spec.ts`:

```ts
mockAI.mockSendMessage.mockImplementationOnce(
    mockAI.createStreamingResponse(
        ['Hello', ' from', ' streaming'],
        { delayMs: 50, sessionId: 'chat-stream-1' },
    ),
);
```

For gated (chunk-by-chunk) verification:

```ts
const { implementation, gate } = mockAI.createGatedStreamingResponse(
    ['First chunk', ' second chunk'],
    { sessionId: 'chat-gated-1' },
);
mockAI.mockSendMessage.mockImplementationOnce(implementation);
// ... start chat ...
await gate.releaseNext();
await expect(page.locator('.chat-message.assistant').last()).toContainText('First chunk');
gate.releaseAll();
```

### Verifying Conversation Bubbles

After the chat task completes:

```ts
const userBubble = page.locator('.chat-message.user');
const assistantBubble = page.locator('.chat-message.assistant');
await expect(userBubble).toHaveCount(1);
await expect(userBubble.locator('.chat-message-content')).toContainText('Explain the architecture');
await expect(assistantBubble).toHaveCount(1);
await expect(assistantBubble.locator('.chat-message-content')).toContainText('AI response text');
```

### Follow-Up Messages

Once a chat session is active (has `processId`), typing in the follow-up textarea and pressing Enter sends `POST /processes/{pid}/message`. The follow-up mock is separate:

```ts
mockAI.mockSendFollowUp.mockImplementationOnce(
    mockAI.createStreamingResponse(
        ['Follow-up answer'],
        { sessionId: 'chat-follow-1' },
    ),
);

// The follow-up input area uses a textarea (no id) inside the border-t input section
const followUpTextarea = page.locator('.border-t textarea');
await followUpTextarea.fill('What about testing?');
await followUpTextarea.press('Enter');

await expect(page.locator('.chat-message.user')).toHaveCount(2, { timeout: 5000 });
```

Note: `Ctrl+Enter` (or `Meta+Enter` on Mac) is the actual send keybinding for the follow-up textarea. Plain `Enter` may insert a newline. Check the `onKeyDown` handler — it uses `(e.ctrlKey || e.metaKey) && e.key === 'Enter'` for send. Use:

```ts
await followUpTextarea.press('Control+Enter');
```

### Session Sidebar Interactions

**Selecting a session:** Click a `[data-testid="chat-session-card"]`. It loads the session and highlights with `ring-2`.

**New Chat split button:** `[data-testid="new-chat-btn"]` for normal chat, `[data-testid="new-chat-dropdown-toggle"]` → `[data-testid="new-chat-option-readonly"]` for read-only.

```ts
// Open dropdown
await page.click('[data-testid="new-chat-dropdown-toggle"]');
await expect(page.locator('[data-testid="new-chat-dropdown-menu"]')).toBeVisible();
// Select read-only
await page.click('[data-testid="new-chat-option-readonly"]');
// Verify read-only checkbox is checked on start screen
await expect(page.locator('[data-testid="chat-readonly-toggle"] input')).toBeChecked();
```

**Pin/Unpin:** Right-click a session card to open context menu, click "Pin Chat":

```ts
await page.locator('[data-testid="chat-session-card"]').first().click({ button: 'right' });
// ContextMenu appears — click "Pin Chat"
await page.locator('text=Pin Chat').click();
await expect(page.locator('[data-testid="pinned-section-header"]')).toBeVisible();
await expect(page.locator('[data-testid="pin-icon-active"]')).toBeVisible();
```

**Archive/Unarchive:** Right-click → "Archive Chat", then toggle "Show Archived" checkbox:

```ts
await page.locator('[data-testid="chat-session-card"]').first().click({ button: 'right' });
await page.locator('text=Archive Chat').click();
// Card disappears from main list
await page.click('[data-testid="show-archived-checkbox"]');
await expect(page.locator('[data-testid="archived-separator"]')).toBeVisible();
```

**Cancel queued session:** A session with `status: 'queued'` shows `[data-testid="cancel-session-btn"]`. Click it to `DELETE /queue/{id}`.

**Refresh:** Click `[data-testid="chat-refresh-btn"]` to re-fetch sessions.

### Read-Only Badge in Conversation Header

When a chat is started with `readonly: true`, the conversation header shows `[data-testid="chat-readonly-badge"]` with text "Read-only":

```ts
await expect(page.locator('[data-testid="chat-readonly-badge"]')).toBeVisible();
await expect(page.locator('[data-testid="chat-readonly-badge"]')).toContainText('Read-only');
```

### Copy Conversation

The `[data-testid="copy-conversation-btn"]` in the conversation header copies all turns as text. It is disabled when `turns.length === 0` or during streaming:

```ts
const copyBtn = page.locator('[data-testid="copy-conversation-btn"]');
await expect(copyBtn).not.toBeDisabled();
await copyBtn.click();
// Verify the button changes to a checkmark (copied state) briefly
// The SVG switches from copy icon to check icon for 2 seconds
```

### SSE Handling in Tests

The RepoChatTab opens `EventSource` to `GET /processes/{pid}/stream` for both initial task execution and follow-up messages. The e2e server already supports SSE natively via the execution server. No extra mocking is needed — the mock AI's streaming chunks are relayed through the real SSE endpoint. Tests should use timeouts to wait for SSE propagation:

```ts
await expect(locator).toContainText('expected text', { timeout: 10000 });
```

### Helper Functions to Extract

```ts
/** Navigate to the chat sub-tab for a workspace. */
async function gotoChatTab(page: Page, serverUrl: string, workspaceId: string): Promise<void> {
    await page.goto(`${serverUrl}/#repos/${encodeURIComponent(workspaceId)}/chat`);
    await expect(page.locator('[data-testid="chat-split-panel"]')).toBeVisible({ timeout: 8000 });
}

/** Wait for a new chat task to complete via polling. */
async function waitForChatTaskCompletion(serverUrl: string, timeoutMs = 15000): Promise<void> {
    // Poll GET /api/queue until a chat task reaches completed/failed
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const tasks = json.tasks ?? json;
            const chatTask = tasks.find((t: any) => t.type === 'chat');
            if (chatTask && ['completed', 'failed'].includes(chatTask.status)) return;
        }
        await new Promise(r => setTimeout(r, 300));
    }
    throw new Error(`No chat task completed within ${timeoutMs}ms`);
}
```

## Tests

1. **`renders chat split panel with sidebar and start screen`** — Navigate to chat tab, verify `[data-testid="chat-split-panel"]` visible, sidebar `[data-testid="chat-session-sidebar"]` with `[data-testid="chat-empty-state"]` (no sessions), start screen with textarea and "Start Chat" button.

2. **`starts a new chat and shows streaming AI response`** — Mock models endpoint, fill textarea, click "Start Chat", verify user bubble appears, assistant bubble appears with default mock AI response, conversation header `[data-testid="chat-conversation-header"]` visible.

3. **`model select dropdown populates from /queue/models`** — Mock models endpoint with `['gpt-4o', 'claude-sonnet-4']`, verify `[data-testid="chat-model-select"]` has 3 options (Default + 2 models), select a model, start chat, verify `config.model` in the POST body via `page.route` intercept.

4. **`read-only toggle creates chat with readonly payload and shows badge`** — Check the `[data-testid="chat-readonly-toggle"] input` checkbox, start chat, verify POST body has `payload.readonly: true`, after completion verify `[data-testid="chat-readonly-badge"]` in header.

5. **`sends follow-up message and receives streamed response`** — Start a chat (wait for completion), mock `sendFollowUp` with streaming response, type in follow-up textarea, press `Ctrl+Enter`, verify second user bubble and second assistant bubble appear.

6. **`new-chat split button dropdown opens read-only chat`** — Create an initial chat session, click `[data-testid="new-chat-dropdown-toggle"]`, verify dropdown `[data-testid="new-chat-dropdown-menu"]` visible, click `[data-testid="new-chat-option-readonly"]`, verify read-only checkbox is checked on start screen.

7. **`session sidebar pin and unpin via context menu`** — Create 2 chat sessions, right-click first session card, click "Pin Chat", verify `[data-testid="pinned-section-header"]` and `[data-testid="pin-icon-active"]` appear, right-click again and "Unpin Chat", verify pinned section disappears.

8. **`session sidebar archive and show-archived toggle`** — Create a chat, right-click session card, click "Archive Chat", verify card removed from main list, check `[data-testid="show-archived-checkbox"]`, verify `[data-testid="archived-separator"]` and archived card reappear.

9. **`cancel queued chat from sidebar and inline button`** — Make AI hang with a never-resolving promise, start a chat (stays queued/running), verify `[data-testid="cancel-chat-inline-btn"]` or `[data-testid="cancel-chat-header-btn"]` visible, click cancel, verify session is removed or reset.

10. **`copy conversation button copies turns to clipboard`** — Start a chat (wait for completion), verify `[data-testid="copy-conversation-btn"]` is not disabled, click it, verify the button icon changes to checkmark (SVG path changes).

## Acceptance Criteria

- [ ] `chat-subtab.spec.ts` exists and imports from `./fixtures/server-fixture` and `./fixtures/seed`
- [ ] All tests use the `mockAI` fixture for AI responses (no real AI calls)
- [ ] Navigation uses `#repos/{workspaceId}/chat` deep-link or click-through
- [ ] At least 8 distinct test cases covering: start chat, streaming, follow-up, model select, read-only, sidebar pin/archive, cancel, copy
- [ ] Tests pass on Linux, macOS, and Windows (no platform-specific selectors or paths)
- [ ] No flaky timing — use Playwright's `toBeVisible({ timeout })` and `toContainText({ timeout })` instead of raw `setTimeout`
- [ ] Mock AI resets between tests automatically via the fixture's `afterEach` reset
- [ ] Tests do not depend on any other spec file or shared mutable state

## Dependencies

- Depends on: None (independent)

## Assumed Prior State

None — uses existing fixtures only. The `server-fixture.ts` provides `page`, `serverUrl`, and `mockAI`. The `seed.ts` provides `seedWorkspace`, `seedQueueTask`, and `request`.

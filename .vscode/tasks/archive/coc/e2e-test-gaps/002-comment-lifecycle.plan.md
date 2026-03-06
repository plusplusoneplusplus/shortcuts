---
status: done
---

# 002: Comment Lifecycle E2E Tests (Resolve, Edit, Delete, AI)

## Summary

End-to-end Playwright tests covering the full comment lifecycle within the task preview: resolve/reopen toggling, inline editing, two-step delete confirmation, CommentPopover interactions triggered from highlighted text, AICommandMenu command dispatch (clarify, go-deeper, custom), and the sidebar "Resolve All with AI" batch operation.

## Motivation

Commit 001 covers only the initial creation flow (text selection → toolbar → popup → submit). The lifecycle mutations — resolving, editing, deleting — exercise different API verbs (`PATCH`, `DELETE`) and different UI interaction patterns (action bar buttons, confirm/cancel pairs, inline textareas). The CommentPopover and AICommandMenu are entirely separate React components rendered as portals that 001 does not touch. These are high-value paths that currently have zero E2E coverage.

## Changes

### Files to Create

- **`packages/coc/test/e2e/comment-lifecycle.spec.ts`** — Main test file with 10 test cases covering:
  - Resolve a comment via sidebar action bar → verify status dot turns green + card gets `opacity-70`
  - Reopen a resolved comment → verify status dot reverts to blue
  - Edit a comment via sidebar action bar → verify updated text persists after reload
  - Delete a comment with two-step confirmation (also test cancelling the confirm)
  - CommentPopover opens when clicking `[data-comment-id]` highlighted span in rendered markdown
  - CommentPopover resolve/edit/delete mirrors sidebar behavior
  - AICommandMenu clarify command dispatches to `POST /api/comments/{wsId}/{taskPath}/{id}/ask-ai`
  - AICommandMenu custom question flow (input → Enter → AI response rendered)
  - "Resolve All with AI" button dispatches `POST /api/comments/{wsId}/{taskPath}/batch-resolve`
  - Sidebar comment count updates after resolve/delete operations

### Files to Modify

- **`packages/coc/test/e2e/fixtures/comment-fixtures.ts`** — Add these helpers (commit 001 creates this file with `seedComment`, `setupRepoWithComments`, `navigateToTaskPreview`, `waitForCommentSidebar`):
  - `seedCommentWithAIResponse(serverUrl, wsId, taskPath, overrides)` — seeds a comment then PATCHes `aiResponse` onto it, returning the full comment object. Needed for tests that assert AI response display.
  - `getCommentCard(page, commentId)` → `page.locator('[data-testid="comment-card-' + commentId + '"]')` — convenience wrapper used by most tests.
  - `getCommentById(serverUrl, wsId, taskPath, commentId)` — `GET /api/comments/{wsId}/{taskPath}/{id}`, returns parsed comment JSON. Used to verify server-side state after UI actions.

### Files to Delete

- None

## Implementation Notes

### Action bar interactions (CommentCard)

The action bar is **always visible** at the bottom of each CommentCard (not hidden behind hover). It's inside a `<div>` with `onClick={e => e.stopPropagation()}` so clicks don't bubble to the card's `onClick`.

**Resolve** (open → resolved):
```ts
const card = page.locator('[data-testid="comment-card-' + id + '"]');
await card.locator('button[aria-label="Resolve"]').click();
// Verify: status dot becomes green, card gets opacity-70 class
await expect(card.locator('span[title="Resolved"]')).toBeVisible();
await expect(card).toHaveCSS('opacity', '0.7');
// Verify: sidebar "Open" filter count decreases
await sidebar.locator('[data-testid="status-filter-open"]').click();
await expect(sidebar.locator('[data-testid^="comment-card-"]')).toHaveCount(expectedOpenCount);
```

**Reopen** (resolved → open):
```ts
await card.locator('button[aria-label="Reopen"]').click();
await expect(card.locator('span[title="Open"]')).toBeVisible();
```

**Edit**:
```ts
await card.locator('button[aria-label="Edit"]').click();
const textarea = card.locator('[data-testid="comment-edit-textarea"]');
await expect(textarea).toBeVisible();
await textarea.fill('Updated comment text');
await card.locator('button:has-text("Save")').click();
// Verify: card body shows updated text
await expect(card).toContainText('Updated comment text');
// Verify server-side via GET
const res = await request(`${serverUrl}/api/comments/${wsId}/${encodedPath}/${id}`);
const updated = JSON.parse(res.body).comment;
expect(updated.comment).toBe('Updated comment text');
```

**Edit cancel**:
```ts
await card.locator('button[aria-label="Edit"]').click();
await card.locator('[data-testid="comment-edit-textarea"]').fill('will discard');
await card.locator('button:has-text("Cancel")').click();
await expect(card.locator('[data-testid="comment-edit-textarea"]')).toHaveCount(0);
await expect(card).toContainText('original comment text');
```

**Delete (two-step confirm)**:
```ts
// Step 1: click delete → shows Confirm/Cancel buttons
await card.locator('button[aria-label="Delete"]').click();
await expect(card.locator('button:has-text("Confirm")')).toBeVisible();
await expect(card.locator('button:has-text("Cancel")')).toBeVisible();
// Step 2a: cancel — reverts to trash icon
await card.locator('button:has-text("Cancel")').click();
await expect(card.locator('button[aria-label="Delete"]')).toBeVisible();
// Step 2b: confirm — card disappears
await card.locator('button[aria-label="Delete"]').click();
await card.locator('button:has-text("Confirm")').click();
await expect(card).toHaveCount(0, { timeout: 5000 });
// Verify: DELETE returned 204
```

### CommentPopover interactions

The popover opens when clicking a `<span data-comment-id="{id}">` element inside the rendered markdown preview (`#task-preview-body`). The MarkdownReviewEditor's `handleHighlightClick` finds the comment by ID and calls `handleCommentClick`, which sets `activePopoverComment` state, rendering `<CommentPopover>` as a portal.

**Opening the popover**:
```ts
// Highlighted spans are injected into the rendered HTML by the editor's comment highlighting logic.
// Click the highlighted text span to open the popover:
const highlightSpan = page.locator('[data-comment-id="' + commentId + '"]');
await highlightSpan.click();
const popover = page.locator('[data-testid="comment-popover"]');
await expect(popover).toBeVisible({ timeout: 5000 });
await expect(popover.locator('[data-testid="popover-comment-body"]')).toContainText('expected text');
```

**Closing the popover**:
```ts
// Via close button:
await popover.locator('[data-testid="popover-close"]').click();
await expect(popover).toHaveCount(0);

// Via Escape key:
await page.keyboard.press('Escape');
await expect(popover).toHaveCount(0);
```

**Popover resolve/edit/delete**: Same aria-label buttons as CommentCard but actions pass comment ID explicitly. Delete in popover immediately closes it (no two-step confirm in popover — it calls `onDelete(id); onClose();` directly).

### AICommandMenu interactions

The menu trigger is `[data-testid="ai-menu-trigger"]` (in CommentCard) or `[data-testid="popover-ai-menu-trigger"]` (in CommentPopover, prefix = `"popover-ai"`).

**Clarify command (non-custom, dispatches immediately)**:
```ts
await card.locator('[data-testid="ai-menu-trigger"]').click();
const menu = page.locator('[data-testid="ai-command-menu"]');
await expect(menu).toBeVisible();
await menu.locator('[data-testid="ai-cmd-clarify"]').click();
// Menu closes, AI loading state shown, then AI response appears
await expect(card.locator('[data-testid="ai-response"]')).toBeVisible({ timeout: 15000 });
```

**Custom question flow**:
```ts
await card.locator('[data-testid="ai-menu-trigger"]').click();
const menu = page.locator('[data-testid="ai-command-menu"]');
await menu.locator('[data-testid="ai-cmd-custom"]').click();
// Custom input appears
const input = menu.locator('[data-testid="ai-custom-input"]');
await expect(input).toBeVisible();
await input.fill('What is the impact of this change?');
await input.press('Enter');
// Menu closes, AI processes, response appears
await expect(card.locator('[data-testid="ai-response"]')).toBeVisible({ timeout: 15000 });
```

**Mock AI setup**: The `mockAI` fixture from `server-fixture.ts` provides `mockSendMessage` which defaults to `{ success: true, response: 'AI response text', sessionId: 'session-123' }`. For ask-ai tests, the server internally calls `createCLIAIInvoker` which does NOT go through the mock AI service — it spawns a CLI process. To test AI in e2e, we need to either:
1. **Route intercept** the `POST /api/comments/{wsId}/{taskPath}/{id}/ask-ai` response via `page.route()`, OR
2. Accept that AI is unavailable in test (503) and assert the error banner `[data-testid="ai-error-banner"]` appears.

**Recommended approach**: Use `page.route()` to intercept and mock the ask-ai API response:
```ts
await page.route('**/api/comments/**/ask-ai', async route => {
    await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
            aiResponse: 'Mocked AI clarification response',
            reply: { id: 'reply-1', author: 'AI', text: 'Mocked AI clarification response', isAI: true },
        }),
    });
});
```

### Batch "Resolve All with AI"

The `[data-testid="resolve-all-ai-btn"]` button is only visible when `openCount > 0`. It calls `POST /api/comments/{wsId}/{taskPath}/batch-resolve` with `{ documentContent }`. The response is `202 { taskId }` — an async queue task.

**Test strategy**: Intercept the batch-resolve API to return a mock 202, then verify the button shows a loading spinner while resolving:
```ts
await page.route('**/api/comments/**/batch-resolve', async route => {
    await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ taskId: 'mock-task-1' }),
    });
});
await sidebar.locator('[data-testid="resolve-all-ai-btn"]').click();
// Button shows spinner (resolving=true disables all cards)
```

### API payloads reference

| Action | Method | Path | Body | Response |
|--------|--------|------|------|----------|
| Resolve | `PATCH` | `/api/comments/{wsId}/{taskPath}/{id}` | `{ "status": "resolved" }` | `200 { comment }` |
| Reopen | `PATCH` | `/api/comments/{wsId}/{taskPath}/{id}` | `{ "status": "open" }` | `200 { comment }` |
| Edit text | `PATCH` | `/api/comments/{wsId}/{taskPath}/{id}` | `{ "comment": "new text" }` | `200 { comment }` |
| Delete | `DELETE` | `/api/comments/{wsId}/{taskPath}/{id}` | — | `204` |
| Ask AI | `POST` | `/api/comments/{wsId}/{taskPath}/{id}/ask-ai` | `{ "commandId": "clarify" }` | `200 { aiResponse, reply }` |
| Ask AI custom | `POST` | `/api/comments/{wsId}/{taskPath}/{id}/ask-ai` | `{ "commandId": "custom", "customQuestion": "..." }` | `200 { aiResponse, reply }` |
| Batch resolve | `POST` | `/api/comments/{wsId}/{taskPath}/batch-resolve` | `{ "documentContent": "..." }` | `202 { taskId }` |

### Test setup pattern

Follow the same pattern as `comment-sidebar-layout.spec.ts`:
```ts
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace, request } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
// Plus helpers from commit 001:
import { seedComment, navigateToTaskPreview, waitForCommentSidebar } from './fixtures/comment-fixtures';

const WS_ID = 'ws-comment-lifecycle';

test.describe('Comment Lifecycle', () => {
    test('resolve and reopen a comment', async ({ page, serverUrl }) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lifecycle-'));
        try {
            const repoDir = createRepoFixture(tmpDir);
            createTasksFixture(repoDir);
            await seedWorkspace(serverUrl, WS_ID, 'lifecycle-repo', repoDir);
            const created = await seedComment(serverUrl, WS_ID, 'task-a.md', 'test comment');
            await navigateToTaskPreview(page, serverUrl, 'task-a');
            const sidebar = await waitForCommentSidebar(page);
            // ... test body
        } finally {
            safeRmSync(tmpDir);
        }
    });
});
```

## Tests

1. **`resolve toggles comment to resolved state`** — Seed 2 open comments, click ✅ on first card, verify green status dot + opacity-70. Verify API returned `status: 'resolved'` via `GET /api/comments/{wsId}/{path}/{id}`. Filter to "Open" tab → only 1 card visible.

2. **`reopen restores a resolved comment to open`** — Seed 1 resolved comment, click 🔓 Reopen button, verify blue status dot + full opacity. Verify API returned `status: 'open'`.

3. **`edit updates comment text inline`** — Seed 1 comment with text "original". Click ✏️ → textarea appears pre-filled with "original". Clear and type "updated". Click Save. Card body shows "updated". `GET` confirms server persisted the change.

4. **`edit cancel discards changes`** — Click ✏️, modify text, click Cancel. Textarea disappears, card still shows original text.

5. **`delete with two-step confirmation removes comment`** — Click 🗑️ → Confirm/Cancel appear. Click Cancel → reverts to trash icon. Click 🗑️ again → click Confirm → card removed from DOM. Sidebar count decremented. `GET /api/comments/{wsId}/{path}/{id}` returns 404.

6. **`clicking comment card opens CommentPopover`** — Seed a comment, click the CommentCard (not on action bar). Verify `[data-testid="comment-popover"]` appears with `[data-testid="popover-comment-body"]` containing the comment text. Press Escape → popover closes.

7. **`CommentPopover resolve and close`** — Open popover, click ✅ Resolve inside popover. Popover closes, sidebar card shows resolved state.

8. **`CommentPopover delete immediately closes`** — Open popover, click 🗑️ Delete. Popover closes, card removed from sidebar (no two-step confirm in popover).

9. **`AICommandMenu clarify command triggers AI response`** — Intercept `POST **/ask-ai` via `page.route()` to return mock AI response. Click 🤖 trigger → menu appears → click Clarify → menu closes → `[data-testid="ai-response"]` appears with mocked text.

10. **`AICommandMenu custom question flow`** — Intercept ask-ai. Click 🤖 → click Custom → input appears → type question → press Enter → AI response rendered. Verify intercepted request body contains `{ commandId: 'custom', customQuestion: '...' }`.

11. **`Resolve All with AI button triggers batch resolve`** — Seed 3 open comments. Intercept `POST **/batch-resolve` to return `202 { taskId }`. Click `[data-testid="resolve-all-ai-btn"]`. Verify the intercepted request was called. Button not visible after all comments resolved.

12. **`sidebar count updates after lifecycle operations`** — Seed 3 comments (2 open, 1 resolved). Header shows "Comments (3)". Delete one → "Comments (2)". Resolve one → filter to Open → 0 cards. Filter to Resolved → 2 cards.

## Acceptance Criteria

- [ ] All 12 test cases pass on Linux, macOS, and Windows
- [ ] Tests use `page.route()` to mock AI endpoints, not real AI invocations
- [ ] Each test is self-contained: creates its own tmpDir, seeds its own data, cleans up in `finally`
- [ ] No test depends on execution order; all can run in isolation
- [ ] Assertions verify both UI state (DOM) and server state (API GET) where applicable
- [ ] Test file follows existing e2e patterns: imports from `./fixtures/server-fixture`, uses `safeRmSync`
- [ ] CommentPopover tests verify both open (click card) and close (Escape / close button) flows
- [ ] AICommandMenu tests verify the command dropdown portal renders and dispatches correctly
- [ ] Batch-resolve test verifies the `resolve-all-ai-btn` button visibility is conditional on open comment count
- [ ] `comment-fixtures.ts` additions are minimal and reusable across future commits

## Dependencies

- Depends on: 001 (comment-fixtures.ts with seedComment, setupRepoWithComments, navigateToTaskPreview, waitForCommentSidebar)

## Assumed Prior State

`packages/coc/test/e2e/fixtures/comment-fixtures.ts` exists with:
- `seedComment(serverUrl, wsId, taskPath, comment, category?, status?)` — creates a comment via `POST /api/comments/{wsId}/{encodedPath}`
- `setupRepoWithComments(tmpDir, serverUrl)` — creates repo + tasks + workspace + seeds sample comments
- `navigateToTaskPreview(page, serverUrl, taskName?)` — navigates to repos tab → repo → tasks sub-tab → clicks task item
- `waitForCommentSidebar(page)` — waits for `[data-testid="comment-sidebar"]` to be visible, returns the locator

---
status: done
---

# 001: Comment E2E Fixtures & Inline Comment Creation Tests

## Summary
Add shared comment test fixtures (helpers for seeding comments via API, navigating to task preview with comment sidebar) and the first e2e spec covering the inline comment creation flow — the core interaction path of the v1.1.0 commenting system.

## Motivation
The task commenting system is the headline v1.1.0 feature with 7 rich React components and 50+ data-testid selectors, yet has zero interactive e2e tests. The existing `comment-sidebar-layout.spec.ts` only tests static layout/filter rendering with pre-seeded comments — it never exercises text selection, the context menu, InlineCommentPopup, or comment submission. This commit establishes the test infrastructure and covers the most critical user flow: creating a comment via text selection.

## Changes

### Files to Create

#### `packages/coc/test/e2e/fixtures/comment-fixtures.ts`

Shared comment test helpers extracted from the inline `seedComment` / `navigateToTask` in `comment-sidebar-layout.spec.ts`, plus new helpers for the interactive flow.

**Exports:**

```ts
import type { Page } from '@playwright/test';
import { request } from './seed';

/** Seed a comment via POST /api/comments/{wsId}/{encodedPath}. */
export async function seedComment(
    serverUrl: string,
    wsId: string,
    filePath: string,
    comment: string,
    category = 'general',
    status: 'open' | 'resolved' = 'open',
): Promise<Record<string, unknown>> {
    const body = JSON.stringify({
        filePath,
        selection: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
        selectedText: 'hello',
        comment,
        category,
        status,
    });
    const encodedPath = encodeURIComponent(filePath);
    const res = await request(
        `${serverUrl}/api/comments/${encodeURIComponent(wsId)}/${encodedPath}`,
        { method: 'POST', body },
    );
    return JSON.parse(res.body);
}
```

This mirrors the existing inline helper from `comment-sidebar-layout.spec.ts` (lines 18–40) so that spec can be refactored later.

```ts
/**
 * Navigate from the SPA root to a specific task file preview.
 * Steps: goto serverUrl → click repos tab → click first repo → click tasks sub-tab
 *        → click task-tree item → wait for #task-preview-body.
 */
export async function navigateToTask(
    page: Page,
    serverUrl: string,
    taskName: string,
): Promise<void> {
    await page.goto(serverUrl);
    await page.click('[data-tab="repos"]');
    await page.locator('.repo-item').first().click({ timeout: 10_000 });
    await page.locator('#repo-detail-content').waitFor({ state: 'visible' });

    await page.click('.repo-sub-tab[data-subtab="tasks"]');
    await page.locator('[data-testid="task-tree"]').waitFor({ state: 'visible', timeout: 10_000 });

    const taskItem = page.locator(`[data-testid="task-tree-item-${taskName}"]`);
    await taskItem.click({ timeout: 5_000 });
    await page.locator('#task-preview-body').waitFor({ state: 'visible', timeout: 10_000 });
}
```

```ts
/**
 * Simulate text selection inside #task-preview-body and trigger the right-click
 * context menu. Returns the context menu locator.
 *
 * How it works:
 *  1. Find the target text node inside #task-preview-body using page.evaluate()
 *     with TreeWalker + Range API
 *  2. Dispatch a 'mouseup' event so MarkdownReviewEditor's handleMouseUp
 *     calls setSavedSelection() (MIN_SELECTION_LENGTH = 3 chars, line 54)
 *  3. Right-click the selection to trigger handleContextMenu → setContextMenuVisible(true)
 *
 * The key constraint: MarkdownReviewEditor renders HTML via dangerouslySetInnerHTML
 * on a div#task-preview-body, so the text nodes are nested inside markdown-rendered
 * elements (p, h1, li, etc.) annotated with data-line attributes.
 */
export async function selectTextAndOpenContextMenu(
    page: Page,
    textToSelect: string,
): Promise<void> {
    // Step 1: Create a DOM selection over the target text
    await page.evaluate((text) => {
        const container = document.getElementById('task-preview-body');
        if (!container) throw new Error('task-preview-body not found');

        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        let node: Text | null;
        while ((node = walker.nextNode() as Text | null)) {
            const idx = node.textContent?.indexOf(text) ?? -1;
            if (idx >= 0) {
                const range = document.createRange();
                range.setStart(node, idx);
                range.setEnd(node, idx + text.length);
                const sel = window.getSelection()!;
                sel.removeAllRanges();
                sel.addRange(range);
                return;
            }
        }
        throw new Error(`Text "${text}" not found in task-preview-body`);
    }, textToSelect);

    // Step 2: Dispatch mouseup to trigger MarkdownReviewEditor's selection handler
    await page.dispatchEvent('#task-preview-body', 'mouseup');

    // Step 3: Right-click the selected text to open context menu
    // Use page.evaluate to get the selection bounding rect for precise click coords
    const rect = await page.evaluate(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return null;
        const r = sel.getRangeAt(0).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!rect) throw new Error('No selection bounding rect');

    await page.mouse.click(rect.x, rect.y, { button: 'right' });
}
```

```ts
/** Wait for the comment sidebar to be visible. */
export async function waitForCommentSidebar(page: Page): Promise<void> {
    await page.locator('[data-testid="comment-sidebar"]').waitFor({
        state: 'visible',
        timeout: 10_000,
    });
}

/** Get the count of visible comment cards in the sidebar. */
export async function getCommentCardCount(page: Page): Promise<number> {
    return page.locator('[data-testid="comment-sidebar"] [data-testid^="comment-card-"]').count();
}
```

#### `packages/coc/test/e2e/comment-inline-creation.spec.ts`

Test spec covering the inline comment creation flow and edge cases.

**Test structure:**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedWorkspace } from './fixtures/seed';
import { createRepoFixture, createTasksFixture } from './fixtures/repo-fixtures';
import {
    navigateToTask,
    selectTextAndOpenContextMenu,
    waitForCommentSidebar,
    getCommentCardCount,
} from './fixtures/comment-fixtures';

const WS_ID = 'ws-inline-comment';

test.describe('Inline Comment Creation', () => {
    // Each test creates its own tmpDir for isolation, following the pattern
    // from comment-sidebar-layout.spec.ts.

    // ... tests below ...
});
```

### Files to Modify
- None (all new files)

### Files to Delete
- None

## Implementation Notes

### Text Selection Simulation in Playwright

The MarkdownReviewEditor listens for `mouseup` on `document` (line 322 of MarkdownReviewEditor.tsx) and checks:
1. `window.getSelection()` is not collapsed
2. Selection text length >= `MIN_SELECTION_LENGTH` (3 chars, line 54)
3. `previewRef.current?.contains(sel.anchorNode)` — anchor must be inside `#task-preview-body`

Playwright's built-in `page.selectText()` only works on form elements. For arbitrary DOM text, we must use `page.evaluate()` to create a Range/Selection programmatically, then dispatch `mouseup` to notify the React handler.

**Critical detail:** The mouseup handler fires on `document`, not on `#task-preview-body`. However, it validates `previewRef.current?.contains(sel.anchorNode)`. So the selection must be physically inside that DOM node — which `page.evaluate` with `TreeWalker` ensures.

### Context Menu Flow (Desktop)

After selection + mouseup, the user right-clicks to trigger `handleContextMenu` (line 386). This:
1. Calls `e.preventDefault()` to suppress the browser context menu
2. Sets `contextMenuPos` and `contextMenuVisible = true`
3. Renders `<ContextMenu>` with `data-testid="context-menu"` (line 247 of ContextMenu.tsx)
4. First menu item is "Add comment" (`data-testid="context-menu-item-0"`, line 289) — its `onClick` calls `handleAddCommentFromMenu`

`handleAddCommentFromMenu` (line 397) then:
1. Gets bounding rect from `savedSelection.range`
2. Sets `popupPos`, `pendingSelection`, `popupVisible = true`
3. Renders `<InlineCommentPopup>` with `data-testid="inline-comment-popup"`

### InlineCommentPopup Interaction

- Textarea: `data-testid="comment-textarea"` — auto-focused via `useEffect` (line 59)
- Submit button: the `<Button>` child matching text "Submit" — disabled when `!text.trim()` (line 119)
- Cancel button: `<Button>` matching text "Cancel"
- Keyboard: `Escape` → `onCancel()`, `Ctrl+Enter` → `handleSubmit()` (lines 69–74)

### Comment API Payload

POST to `/api/comments/{wsId}/{encodedTaskPath}` with body:
```json
{
  "filePath": "task-a.md",
  "selection": { "startLine": 5, "startColumn": 1, "endLine": 5, "endColumn": 20 },
  "selectedText": "Root-level pending",
  "comment": "This needs clarification",
  "category": "general",
  "anchor": { "selectedText": "...", "contextBefore": "...", "contextAfter": "...", "originalLine": 5, "textHash": "..." }
}
```

Response: `201 { "comment": { "id": "uuid", "filePath": "task-a.md", ... } }`

After submission, `useTaskComments.addComment()` (line 186 of useTaskComments.ts) optimistically appends the new comment to `comments` state, which triggers CommentSidebar re-render with the new comment card.

### Sidebar Appearance After First Comment

When a task file has zero comments, CommentSidebar is not rendered (the `showCommentListPanel` flag in MarkdownReviewEditor is based on `comments.length > 0` or similar logic). After the first comment is created via `addComment()`, the sidebar should appear. Tests must wait for `[data-testid="comment-sidebar"]` to become visible after submission.

### Edge Cases to Cover

1. **Empty text submission blocked:** The Submit button has `disabled={!text.trim()}` (line 119 of InlineCommentPopup). Test should verify the button is disabled when textarea is empty or whitespace-only.
2. **Escape to cancel:** Pressing Escape calls `onCancel()` → `handlePopupCancel()` which sets `popupVisible = false` (line 453). The popup should disappear and no comment should be created.
3. **Ctrl+Enter shortcut:** Pressing Ctrl+Enter when textarea has text triggers `handleSubmit()` (line 71 of InlineCommentPopup). Should work identically to clicking Submit.
4. **Click outside to cancel:** Clicking outside the popup triggers the `mousedown` handler (line 82–95 of InlineCommentPopup) which calls `onCancel()`.

## Tests

### Test Cases for `comment-inline-creation.spec.ts`

1. **`select text → right-click → Add comment → type → Submit → comment appears in sidebar`**
   The happy-path flow. Navigate to task-a.md, select "Root-level pending" text (from the task-a.md fixture content "Root-level pending task."), right-click → context menu → click "Add comment" (`[data-testid="context-menu-item-0"]`) → InlineCommentPopup appears → type comment text in `[data-testid="comment-textarea"]` → click Submit → verify:
   - `[data-testid="inline-comment-popup"]` disappears
   - `[data-testid="comment-sidebar"]` becomes visible
   - Comment card with the submitted text appears inside `[data-testid="comment-list"]`

2. **`submit button is disabled when textarea is empty`**
   Open the InlineCommentPopup via the selection flow, verify the Submit button (`button:has-text("Submit")`) has `disabled` attribute before any text is typed. Type whitespace-only, verify still disabled.

3. **`Ctrl+Enter submits the comment`**
   Same setup as test 1, but instead of clicking Submit, press `Ctrl+Enter` via `page.keyboard.press('Control+Enter')`. Verify the comment appears in the sidebar.

4. **`Escape key cancels the popup without creating a comment`**
   Open InlineCommentPopup, type some text, press `Escape`. Verify the popup disappears (`[data-testid="inline-comment-popup"]` has count 0) and no comment was created (sidebar should not appear or remain empty if it was already showing).

5. **`Cancel button dismisses the popup`**
   Open InlineCommentPopup, type some text, click the "Cancel" button. Verify same outcome as Escape — popup gone, no comment created.

6. **`click outside the popup cancels it`**
   Open InlineCommentPopup, click somewhere on `#task-preview-body` outside the popup bounds. The `mousedown` outside handler (InlineCommentPopup line 82–95) should fire `onCancel()`. Verify popup disappears.

7. **`creating multiple comments increases sidebar count`**
   Create two comments on different text selections. Verify the sidebar header shows "Comments (2)" and two comment cards are rendered in `[data-testid="comment-list"]`.

8. **`context menu "Add comment" is disabled when no text is selected`**
   Right-click on `#task-preview-body` without selecting any text first. The "Add comment" menu item should have `disabled` styling (the `disabled: !savedSelection` prop at MarkdownReviewEditor line 791). Verify clicking it does nothing / popup does not appear.

## Acceptance Criteria
- [ ] `comment-fixtures.ts` provides reusable `seedComment`, `navigateToTask`, `selectTextAndOpenContextMenu`, `waitForCommentSidebar`, and `getCommentCardCount` helpers
- [ ] Inline comment creation flow works end-to-end: select text → context menu → "Add comment" → popup → type → submit → comment appears in sidebar
- [ ] Cancel/escape/click-outside paths verified — popup dismissed, no comment created
- [ ] Ctrl+Enter keyboard shortcut submits correctly
- [ ] Submit button correctly disabled for empty/whitespace input
- [ ] Multiple comment creation updates sidebar count
- [ ] All tests use `fs.mkdtempSync` + `safeRmSync` for isolation (matching existing pattern)
- [ ] All tests pass on Linux, macOS, Windows

## Dependencies
- Depends on: None (first commit)

## Assumed Prior State
None — this is the first commit. The existing `comment-sidebar-layout.spec.ts` is not modified (its inline `seedComment`/`navigateToTask` will be refactored to use the shared fixtures in a later commit).

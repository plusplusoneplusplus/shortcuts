# E2E Playwright Test: File Path Hover in Chat Messages

## Problem

Commit `a7cbc35c` replaced the custom pipeline-core markdown renderer with `marked` for chat messages in `ConversationTurnBubble.tsx`. This dropped file path linkification — paths in user messages no longer get wrapped in `<span class="file-path-link">`, so `file-path-preview.ts` hover tooltips stopped working.

A unit test was added to `chatMarkdownToHtml.test.ts` but there was no e2e coverage to catch the visual regression. We need a Playwright spec that asserts file paths in chat messages are interactive (linkified, hoverable).

## Approach

Add a focused Playwright spec `queue-file-path-hover.spec.ts` using the existing mock AI fixture infrastructure. The test seeds a queue task whose user prompt contains file paths, then asserts the DOM has `.file-path-link` spans and that hovering shows the tooltip.

No new fixture or mock infrastructure is needed — the existing `server-fixture.ts` + `mock-ai.ts` + `seed.ts` provide everything.

## Todos

### 1. `create-spec` — Create `queue-file-path-hover.spec.ts` ✅

**File:** `packages/coc/test/e2e/queue-file-path-hover.spec.ts`

Write a Playwright spec with these test groups:

#### Group A: File Path Linkification in User Messages

Pattern: seed a queue task with a prompt containing a file path → wait for completion → navigate to conversation → assert `.file-path-link` exists inside the user bubble.

- **Test 1: Windows path is linkified**
  - Seed task with prompt: `"Use the impl skill. D:\\projects\\shortcuts\\.vscode\\tasks\\plan.md"`
  - Assert `.chat-message.user .file-path-link` has count ≥ 1
  - Assert `data-full-path` attribute contains the normalized (forward-slash) path
  - Assert the displayed text is the shortened path (not the full path)

- **Test 2: Unix path is linkified**
  - Seed task with prompt: `"Edit /Users/alice/projects/foo/bar.ts please"`
  - Assert `.chat-message.user .file-path-link` exists
  - Assert `data-full-path` contains `/Users/alice/projects/foo/bar.ts`

- **Test 3: Path inside inline code is NOT linkified**
  - Seed task with prompt: `` "Run `C:\\tools\\build.exe` to compile" ``
  - Assert no `.file-path-link` inside the user bubble (path is inside backtick code)

#### Group B: Hover Tooltip Behavior

- **Test 4: Hovering a file-path-link shows the tooltip**
  - Seed a task with a Windows path in the prompt
  - Mock the workspace API (`/api/workspaces`) to return a workspace
  - Mock the file preview API or intercept via `page.route()` to return fixture data
  - Hover the `.file-path-link` element
  - Wait ~300ms (HOVER_DELAY_MS = 250 + buffer)
  - Assert `#file-path-tooltip` becomes visible

- **Test 5: Tooltip disappears on mouseout**
  - After showing tooltip, move mouse away
  - Assert `#file-path-tooltip` is removed or hidden

#### Group C: Assistant Message File Paths (if applicable)

- **Test 6: File paths in assistant response are also linkified**
  - Mock AI response containing a file path
  - Assert `.chat-message.assistant .file-path-link` exists

### 2. `verify-tests` — Run and verify all tests pass ✅

```bash
cd packages/coc && npx playwright test test/e2e/queue-file-path-hover.spec.ts
```

Ensure tests pass on the current code (which includes the `linkifyFilePaths` fix).

### 3. `verify-regression` — Confirm tests catch the original regression ✅

Temporarily revert the `linkifyFilePaths` call in `chatMarkdownToHtml`, run the spec, and confirm tests fail. Then restore the fix.

## Implementation Notes

### Test Patterns (follow existing conventions)

```typescript
import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, request } from './fixtures/seed';

test.describe('File Path Hover in Chat Messages', () => {
    test('Windows path is linkified in user bubble', async ({ serverUrl, mockAI, page }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true, response: 'Done.', sessionId: 'sess-fp-1',
        });
        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Use the impl skill. D:\\projects\\shortcuts\\.vscode\\tasks\\plan.md' },
        });
        await waitForTaskStatus(serverUrl, task.id, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id);
        await waitForBubbles(page, 1);

        const link = page.locator('.chat-message.user .file-path-link');
        await expect(link).toHaveCount(1);
        const fullPath = await link.getAttribute('data-full-path');
        expect(fullPath).toContain('D:/projects/shortcuts/.vscode/tasks/plan.md');
    });
});
```

### Hover Tooltip Mocking

The hover tooltip calls `GET /api/workspaces` and then `GET /api/workspaces/{id}/files/preview?path=...`. Use `page.route()` to intercept:

```typescript
await page.route('**/api/workspaces', route =>
    route.fulfill({ status: 200, body: JSON.stringify({ workspaces: [{ id: 'ws1', root: 'D:/projects/shortcuts' }] }), contentType: 'application/json' })
);
await page.route('**/api/workspaces/*/files/preview*', route =>
    route.fulfill({ status: 200, body: JSON.stringify({ type: 'file', lines: ['line1', 'line2'], totalLines: 2 }), contentType: 'application/json' })
);
```

### Dependencies

- Requires `npm run build` (for dist/ used by server-fixture)
- Requires Chromium installed (`npx playwright install chromium`)
- No new npm dependencies needed

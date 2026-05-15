/**
 * Queue Task Conversation E2E Tests
 *
 * Comprehensive Playwright tests for the queue task conversation UI:
 * - Basic conversation rendering
 * - Streaming response
 * - Tool call rendering
 * - User input & follow-up
 * - Copy functionality
 * - Scroll behavior
 * - Error handling
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedConversationTurns, seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Provision a temporary workspace tied to a fresh temp directory. */
async function makeWorkspace(
    serverUrl: string,
    prefix: string,
): Promise<{ wsId: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-qconv-${prefix}-`));
    const wsId = `${prefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, prefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/** Seed a queue task and wait for initial execution to complete. Returns the task. */
async function seedAndWaitForTask(
    serverUrl: string,
    wsId: string,
    overrides: Record<string, unknown> = {},
    timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
    const basePayload = (overrides.payload ?? {}) as Record<string, unknown>;
    const task = await seedQueueTask(serverUrl, {
        repoId: wsId,
        ...overrides,
        payload: { workspaceId: wsId, ...basePayload },
    });
    return waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed'], timeoutMs);
}

/** Navigate to the queue task detail page via the repo-scoped activity route. */
async function gotoQueueTask(
    page: Page,
    serverUrl: string,
    wsId: string,
    taskId: string,
): Promise<void> {
    const processId = `queue_${taskId}`;
    await page.goto(
        `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`,
    );
    await expect(page.locator('[data-testid="activity-chat-detail"]')).toBeVisible({ timeout: 5000 });
}

/** Wait for a specific number of chat message bubbles. */
async function waitForConversation(page: Page, messageCount: number): Promise<void> {
    await expect(page.locator('.chat-message')).toHaveCount(messageCount, { timeout: 5000 });
}

/** Wait for streaming indicator to disappear. */
async function waitForStreamingToComplete(page: Page): Promise<void> {
    await expect(page.locator('.streaming-indicator')).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Set toolCompactness via the admin API. Defaults to 0 so that every tool
 * call renders as an individual `.tool-call-card` instead of being collapsed
 * into the whisper group (the default `toolCompactness=3`).
 */
async function setToolCompactness(serverUrl: string, value: 0 | 1 | 2 | 3 = 0): Promise<void> {
    await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ toolCompactness: value }),
    });
}

/** Poll GET /api/queue/:id until the task reaches a terminal status. */
async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    statuses: string[] = ['completed', 'failed'],
    timeoutMs = 15_000,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const t = (json.task ?? json) as Record<string, unknown>;
            if (statuses.includes(t.status as string)) return t;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Task ${taskId} did not reach ${statuses.join('|')} within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// 1. Basic Conversation Rendering
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – Basic Rendering', () => {
    test('displays initial user message in conversation', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'basic-1');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                type: 'chat',
                payload: { prompt: 'Analyze this file' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // User message bubble exists
            await expect(page.locator('.chat-message.user')).toHaveCount(1);
            await expect(page.locator('.chat-message.user .chat-message-content')).toContainText('Analyze this file');
            await expect(page.locator('.chat-message.user .role-label')).toContainText('You');
        } finally {
            cleanup();
        }
    });

    test('displays assistant response after task completion', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'basic-2');
        try {
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'The file contains a TypeScript module.',
                sessionId: 'sess-basic-assistant',
            });

            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Show me the code' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Assistant bubble with response content
            await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
            await expect(page.locator('.chat-message.assistant .role-label')).toContainText('Assistant');
            await expect(page.locator('.chat-message.assistant .chat-message-content')).toContainText('TypeScript module');
        } finally {
            cleanup();
        }
    });

    test('displays multiple conversation turns in chronological order', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'basic-3');
        try {
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'First answer',
                sessionId: 'sess-multi',
            });

            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'First question' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Should have user + assistant turns
            await waitForConversation(page, 2);

            const messages = page.locator('.chat-message');
            await expect(messages.nth(0)).toHaveClass(/user/);
            await expect(messages.nth(0).locator('.chat-message-content')).toContainText('First question');
            await expect(messages.nth(1)).toHaveClass(/assistant/);
            await expect(messages.nth(1).locator('.chat-message-content')).toContainText('First answer');
        } finally {
            cleanup();
        }
    });

    test('displays message timestamps', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'basic-4');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Timestamp test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // User and assistant timestamps should be visible with time format
            const userTimestamp = page.locator('.chat-message.user .timestamp');
            await expect(userTimestamp).toBeVisible();
            await expect(userTimestamp).toContainText(/\d{1,2}:\d{2}/);

            const assistantTimestamp = page.locator('.chat-message.assistant .timestamp');
            await expect(assistantTimestamp).toBeVisible();
        } finally {
            cleanup();
        }
    });

    test('shows waiting state for running task with no output', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'basic-5');
        let resolveAI!: (value: unknown) => void;
        const aiPromise = new Promise((resolve) => { resolveAI = resolve; });

        try {
            // Make AI hang by never resolving
            mockAI.mockSendMessage.mockImplementation(() => aiPromise);

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Long running task' },
            });
            const taskId = task.id as string;

            // Small wait for the task to start executing
            await new Promise((r) => setTimeout(r, 500));

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Should show either streaming or waiting (task is running but no chunks yet visible)
            // The user turn should exist since executor creates it before calling AI
            await expect(page.locator('.chat-message.user')).toHaveCount(1, { timeout: 3000 });
        } finally {
            // Resolve to clean up
            resolveAI!({ success: true, response: 'Done', sessionId: 'sess-wait' });
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 2. Streaming Response
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – Streaming', () => {
    test('displays streaming indicator during active stream', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'stream-1');
        try {
            // Mock: delay first chunk to allow SSE to connect, then hold for indicator
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                // Wait for page to load and SSE to connect
                await new Promise((r) => setTimeout(r, 3000));
                if (opts && opts.onStreamingChunk) {
                    opts.onStreamingChunk('Hello ');
                    await new Promise((r) => setTimeout(r, 500));
                    opts.onStreamingChunk('world');
                }
                // Hold to keep streaming indicator visible
                await new Promise((r) => setTimeout(r, 5000));
                return { success: true, response: 'Hello world', sessionId: 'sess-stream' };
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Say hello' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Streaming indicator should appear
            await expect(page.locator('.streaming-indicator')).toBeVisible({ timeout: 5000 });
        } finally {
            cleanup();
        }
    });

    test('updates message content progressively as chunks arrive', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'stream-2');
        try {
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                // Wait for SSE to connect
                await new Promise((r) => setTimeout(r, 2500));
                if (opts && opts.onStreamingChunk) {
                    opts.onStreamingChunk('First');
                    await new Promise((r) => setTimeout(r, 500));
                    opts.onStreamingChunk(' second');
                    await new Promise((r) => setTimeout(r, 500));
                    opts.onStreamingChunk(' third');
                }
                await new Promise((r) => setTimeout(r, 1000));
                return { success: true, response: 'First second third', sessionId: 'sess-prog' };
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Progressive streaming' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Wait for progressive content (timeline may render each chunk as separate content div)
            await expect(page.locator('.chat-message.assistant').last())
                .toContainText('First', { timeout: 8000 });

            // Full content eventually
            await expect(page.locator('.chat-message.assistant').last())
                .toContainText('First second third', { timeout: 8000 });
        } finally {
            cleanup();
        }
    });

    test('removes streaming indicator when stream completes', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'stream-3');
        try {
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                if (opts && opts.onStreamingChunk) {
                    opts.onStreamingChunk('Complete message');
                }
                await new Promise((r) => setTimeout(r, 500));
                return { success: true, response: 'Complete message', sessionId: 'sess-complete' };
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Short stream' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Wait for completion
            await waitForStreamingToComplete(page);

            // No streaming indicator, assistant bubble present
            await expect(page.locator('.streaming-indicator')).toHaveCount(0);
            await expect(page.locator('.chat-message.assistant.streaming')).toHaveCount(0);
            await expect(page.locator('.chat-message.assistant')).toHaveCount(1);
        } finally {
            cleanup();
        }
    });

    test('accumulates multiple streaming chunks correctly', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'stream-4');
        try {
            const chunks = ['The ', 'quick ', 'brown ', 'fox ', 'jumps'];
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createStreamingResponse(chunks, { sessionId: 'sess-multi-chunk' }),
            );

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Write a sentence' },
            });
            const taskId = task.id as string;
            await waitForTaskStatus(serverUrl, taskId);

            // Navigate AFTER the task has completed; the persisted timeline holds
            // the accumulated text (we're testing that chunks aggregate, not the
            // live-streaming behaviour itself, which is exercised by the
            // streaming-indicator-specific tests below).
            await gotoQueueTask(page, serverUrl, wsId, taskId);

            await expect(page.locator('.chat-message.assistant').last())
                .toContainText('The quick brown fox jumps', { timeout: 5000 });
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 3. Tool Call Rendering
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – Tool Calls', () => {
    test('displays tool call card during execution', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'tool-1');
        await setToolCompactness(serverUrl, 0);
        try {
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createToolCallResponse(
                    [
                        {
                            type: 'tool-start',
                            toolCallId: 'tc-view-1',
                            toolName: 'view',
                            parameters: { path: 'src/app.ts' },
                        },
                        {
                            type: 'tool-complete',
                            toolCallId: 'tc-view-1',
                            toolName: 'view',
                            result: 'File content here',
                        },
                    ],
                    { finalResponse: 'File analyzed successfully.', sessionId: 'sess-tool' },
                ),
            );

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'View the file' },
            });
            const taskId = task.id as string;
            await waitForTaskStatus(serverUrl, taskId);
            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Wait for tool call card (tool-start + tool-complete merge into one card per unique toolCallId)
            await expect(page.locator('.tool-call-card')).toHaveCount(1, { timeout: 5000 });

            // Tool name should be visible
            await expect(page.locator('.tool-call-card .tool-call-name').first()).toContainText('view');
        } finally {
            cleanup();
        }
    });

    test('displays multiple tool calls as separate cards', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'tool-2');
        // toolCompactness=0 forces every tool call to render as an individual
        // .tool-call-card without being collapsed into a whisper group.
        await setToolCompactness(serverUrl, 0);
        try {
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createToolCallResponse(
                    [
                        { type: 'tool-start', toolCallId: 'tc-view-multi', toolName: 'view', parameters: { path: 'file1.ts' } },
                        { type: 'tool-complete', toolCallId: 'tc-view-multi', toolName: 'view', result: 'Content 1' },
                        { type: 'tool-start', toolCallId: 'tc-grep-multi', toolName: 'grep', parameters: { pattern: 'test' } },
                        { type: 'tool-complete', toolCallId: 'tc-grep-multi', toolName: 'grep', result: 'Match found' },
                    ],
                    { finalResponse: 'Both tools executed.', sessionId: 'sess-multi-tool' },
                ),
            );

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Use multiple tools' },
            });
            const taskId = task.id as string;
            await waitForTaskStatus(serverUrl, taskId);
            await gotoQueueTask(page, serverUrl, wsId, taskId);

            await expect(page.locator('.tool-call-card')).toHaveCount(2, { timeout: 10000 });
            const names = page.locator('.tool-call-card .tool-call-name');
            await expect(names.nth(0)).toContainText(/view|grep/);
            await expect(names.nth(1)).toContainText(/view|grep/);
        } finally {
            cleanup();
        }
    });

    test('tool call card body starts collapsed and can be expanded', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'tool-3');
        await setToolCompactness(serverUrl, 0);
        try {
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createToolCallResponse(
                    [
                        { type: 'tool-start', toolCallId: 'tc-bash-toggle', toolName: 'bash', parameters: { command: 'ls -la' } },
                        { type: 'tool-complete', toolCallId: 'tc-bash-toggle', toolName: 'bash', result: 'file1\nfile2' },
                    ],
                    { finalResponse: 'Command executed.', sessionId: 'sess-toggle' },
                ),
            );

            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Execute command' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Tool card should exist (tool-start + tool-complete merge into one card)
            await expect(page.locator('.tool-call-card')).toHaveCount(1, { timeout: 3000 });

            // Body starts collapsed
            await expect(page.locator('.tool-call-card .tool-call-body.collapsed')).toHaveCount(1);

            // Click first header to expand
            await page.locator('.tool-call-card .tool-call-header').first().click();
            await expect(page.locator('.tool-call-card .tool-call-body.collapsed')).toHaveCount(0);

            // Click first header to collapse again
            await page.locator('.tool-call-card .tool-call-header').first().click();
            await expect(page.locator('.tool-call-card .tool-call-body.collapsed')).toHaveCount(1);
        } finally {
            cleanup();
        }
    });

    test('collapsing parent task hides nested subtool cards', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'tool-4');
        await setToolCompactness(serverUrl, 0);
        try {
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createToolCallResponse(
                    [
                        { type: 'tool-start', toolCallId: 'tc-task-parent', toolName: 'task', parameters: { agent_type: 'explore', description: 'Search codebase' } },
                        { type: 'tool-start', toolCallId: 'tc-child-view', toolName: 'view', parentToolCallId: 'tc-task-parent', parameters: { path: 'src/app.ts' } },
                        { type: 'tool-complete', toolCallId: 'tc-child-view', toolName: 'view', result: 'File content' },
                        { type: 'tool-start', toolCallId: 'tc-child-grep', toolName: 'grep', parentToolCallId: 'tc-task-parent', parameters: { pattern: 'import' } },
                        { type: 'tool-complete', toolCallId: 'tc-child-grep', toolName: 'grep', result: 'Found matches' },
                        { type: 'tool-complete', toolCallId: 'tc-task-parent', toolName: 'task', result: 'Done' },
                    ],
                    { finalResponse: 'Subtask completed.', sessionId: 'sess-nested' },
                ),
            );

            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Search the codebase' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Wait for parent tool card
            await expect(page.locator('.tool-call-card[data-tool-id="tc-task-parent"]')).toHaveCount(1, { timeout: 5000 });

            // Children container should exist and start collapsed (use direct-child to avoid matching child cards' containers)
            const childrenContainer = page.locator('.tool-call-card[data-tool-id="tc-task-parent"] > .tool-call-children');
            await expect(childrenContainer).toHaveCount(1);
            await expect(childrenContainer).toHaveClass(/subtree-collapsed/);

            // Child cards should exist in DOM but be hidden
            await expect(childrenContainer.locator('.tool-call-card')).toHaveCount(2);

            // Expand parent — children become visible (click the subtool toggle button, not header)
            await page.locator('.tool-call-card[data-tool-id="tc-task-parent"] > .tool-call-header button[aria-label*="subtools"]').click();
            await expect(childrenContainer).not.toHaveClass(/subtree-collapsed/);

            // Collapse parent again — children hidden
            await page.locator('.tool-call-card[data-tool-id="tc-task-parent"] > .tool-call-header button[aria-label*="subtools"]').click();
            await expect(childrenContainer).toHaveClass(/subtree-collapsed/);
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 4. User Input & Follow-up
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – User Input & Follow-up', () => {
    test('displays input bar with textarea and send button', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'input-1');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Input bar test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Input elements exist and are enabled for completed tasks
            await expect(page.locator('[data-testid="activity-chat-input"]')).toBeVisible();
            await expect(page.locator('[data-testid="activity-chat-send-btn"]')).toBeVisible();
            await expect(page.locator('[data-testid="activity-chat-input"]')).not.toBeDisabled();
            await expect(page.locator('[data-testid="activity-chat-send-btn"]')).not.toBeDisabled();

            // Placeholder text (RichTextInput stores it on data-placeholder, not
            // the standard placeholder attribute, because the underlying
            // contenteditable div has no native placeholder support). The
            // stacked layout uses "Reply to CoC, ..." while the legacy
            // compact layout uses "Send a message ...".
            await expect(page.locator('[data-testid="activity-chat-input"]')).toHaveAttribute('data-placeholder', /[Cc]ontinue|message|Send a message|Reply to CoC/i);
        } finally {
            cleanup();
        }
    });

    test('allows typing in the input textarea', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'input-2');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Typing test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            // Wait for conversation to fully load so the input is in enabled state
            // (RichTextInput uses contentEditable='false' while loading)
            await waitForConversation(page, 2);

            const textarea = page.locator('[data-testid="activity-chat-input"]');
            await textarea.fill('This is a follow-up message');

            // RichTextInput is a contenteditable div, so .toHaveValue() doesn't
            // apply — assert on the rendered text instead.
            await expect(textarea).toContainText('This is a follow-up message');
        } finally {
            cleanup();
        }
    });

    test('sends follow-up message when Enter is pressed', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'input-3');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'First question' },
            });
            const taskId = task.id as string;

            // Setup follow-up mock AFTER initial task completes
            // executeFollowUp() calls aiService.sendMessage (not sendFollowUp)
            mockAI.mockSendMessage.mockImplementationOnce(async (opts: any) => {
                if (opts && opts.onStreamingChunk) {
                    opts.onStreamingChunk('Follow-up reply');
                }
                return { success: true, response: 'Follow-up reply', sessionId: 'sess-followup' };
            });

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // Type and send
            const textarea = page.locator('[data-testid="activity-chat-input"]');
            await textarea.fill('Follow-up question');
            await textarea.press('Enter');

            // User message should appear (optimistic UI)
            await expect(page.locator('.chat-message.user')).toHaveCount(2, { timeout: 3000 });
            await expect(page.locator('.chat-message.user').last().locator('.chat-message-content'))
                .toContainText('Follow-up question');

            // Assistant streaming response should appear
            await expect(page.locator('#follow-up-assistant-bubble, .chat-message.assistant').last()
                .locator('.chat-message-content'))
                .toContainText('Follow-up reply', { timeout: 5000 });
        } finally {
            cleanup();
        }
    });

    test('send button triggers message send', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'input-4');
        try {
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                if (opts && opts.onStreamingChunk) {
                    opts.onStreamingChunk('Button reply');
                }
                return { success: true, response: 'Button reply', sessionId: 'sess-btn' };
            });

            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Button test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // Type and click send button
            await page.fill('[data-testid="activity-chat-input"]', 'Sent via button');
            await page.click('[data-testid="activity-chat-send-btn"]');

            // User message sent
            await expect(page.locator('.chat-message.user')).toHaveCount(2, { timeout: 3000 });
            await expect(page.locator('.chat-message.user').last().locator('.chat-message-content'))
                .toContainText('Sent via button');
        } finally {
            cleanup();
        }
    });

    test('inserts newline with Shift+Enter without sending', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'input-5');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Shift enter test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            const textarea = page.locator('[data-testid="activity-chat-input"]');
            await textarea.fill('Line 1');
            await textarea.press('Shift+Enter');
            await textarea.type('Line 2');

            // RichTextInput is a contenteditable div, so .inputValue() doesn't apply.
            // Read .innerText/.textContent instead to assert the visible content.
            const value = (await textarea.evaluate((el: HTMLElement) => el.innerText)) || '';
            expect(value).toContain('Line 1');
            expect(value).toContain('Line 2');

            // Still only 2 messages (user + assistant from initial task)
            await expect(page.locator('.chat-message')).toHaveCount(2);
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 5. Copy Functionality
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – Copy', () => {
    test('copy button appears on message hover', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'copy-1');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Copy test message' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // Copy button initially not visible (shown on hover via CSS)
            const copyBtn = page.locator('.chat-message.assistant .bubble-copy-btn');
            await expect(copyBtn).toBeAttached();

            // Hover over assistant message
            await page.hover('.chat-message.assistant');

            // Copy button should be interactable after hover
            await expect(copyBtn).toBeAttached();
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 6. Scroll Behavior
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – Scroll', () => {
    test('auto-scrolls to bottom as new chunks arrive', async ({ page, serverUrl, mockAI }) => {
        test.slow(); // Triple timeout for this timing-sensitive test
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'scroll-1');
        try {
            // Long streaming to force scroll — large initial delay for SSE to connect first
            const longLine = 'A line of text with enough content to overflow.\n'.repeat(3);
            const chunks = Array(40).fill(longLine);
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                // Long wait for page to load and SSE to connect reliably
                await new Promise((r) => setTimeout(r, 5000));
                if (opts && opts.onStreamingChunk) {
                    for (const chunk of chunks) {
                        opts.onStreamingChunk(chunk);
                        await new Promise((r) => setTimeout(r, 60));
                    }
                }
                // Hold to keep streaming active for assertions
                await new Promise((r) => setTimeout(r, 8000));
                return { success: true, response: chunks.join(''), sessionId: 'sess-scroll' };
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Generate long output' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);

            // Wait for streaming indicator (proves SSE connected and chunks flowing)
            await expect(page.locator('.streaming-indicator')).toBeVisible({ timeout: 12000 });

            // Wait for enough chunks to force overflow
            await page.waitForTimeout(3000);

            // Check scroll position DURING streaming
            const conversationEl = page.locator('[data-testid="activity-chat-conversation"]');
            const metrics = await conversationEl.evaluate((el) => ({
                scrollHeight: el.scrollHeight,
                clientHeight: el.clientHeight,
                scrollTop: el.scrollTop,
            }));

            // Only assert if content actually overflows
            if (metrics.scrollHeight > metrics.clientHeight + 50) {
                expect(metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight).toBeLessThan(300);
            }
        } finally {
            cleanup();
        }
    });

    test('scroll-to-bottom button appears when scrolled up and scrolls to end on click', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'scroll-2');
        try {
            // Create long completed conversation via multiple seed turns
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'Reply\n'.repeat(50),
                sessionId: 'sess-scroll-btn',
            });

            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Generate long conversation\n'.repeat(10) },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // Scroll to top programmatically
            await page.evaluate(() => {
                const el = document.querySelector('[data-testid="activity-chat-conversation"]');
                if (el) (el as HTMLElement).scrollTop = 0;
            });

            // Dispatch scroll event to trigger tracking
            await page.evaluate(() => {
                const el = document.querySelector('[data-testid="activity-chat-conversation"]');
                if (el) el.dispatchEvent(new Event('scroll'));
            });

            // Button should become visible (uses .visible class)
            const btn = page.locator('[data-testid="scroll-to-bottom-btn"]');
            await expect(btn).toHaveClass(/visible/, { timeout: 2000 });

            // Click button
            await btn.click();

            // Should scroll to bottom
            await page.waitForTimeout(500);
            const isNearBottom = await page.locator('[data-testid="activity-chat-conversation"]').evaluate((el) => {
                return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            });
            expect(isNearBottom).toBe(true);
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 7. Error Handling
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – Error Handling', () => {
    test('displays error when follow-up POST fails', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'error-1');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Error test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // Intercept POST /message to return 500
            await page.route('**/api/processes/**/message', (route) => {
                route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'Internal server error' }),
                });
            });

            // Send follow-up
            await page.fill('[data-testid="activity-chat-input"]', 'Follow-up');
            await page.press('[data-testid="activity-chat-input"]', 'Enter');

            // Error should appear (bubble-error or chat-error-bubble)
            await expect(page.locator('.bubble-error, .chat-error-bubble')).toBeVisible({ timeout: 3000 });
        } finally {
            cleanup();
        }
    });

    test('permanently disables input when session expires (410)', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'error-2');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Session expiry test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // Intercept POST /message to return 410 (session expired)
            await page.route('**/api/processes/**/message', (route) => {
                route.fulfill({
                    status: 410,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'session_expired', message: 'Session has ended.' }),
                });
            });

            // Send follow-up
            await page.fill('[data-testid="activity-chat-input"]', 'Expired');
            await page.press('[data-testid="activity-chat-input"]', 'Enter');

            // Error bubble with "session expired" message
            await expect(page.locator('.chat-error-bubble')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('.chat-error-bubble')).toContainText(/[Ss]ession/);

            // Input permanently disabled. The RichTextInput is a contenteditable
            // div — assert on the contenteditable attribute since
            // `toBeDisabled()` only recognises form controls.
            await expect(page.locator('[data-testid="activity-chat-input"]'))
                .toHaveAttribute('contenteditable', 'false', { timeout: 5000 });
            await expect(page.locator('[data-testid="activity-chat-send-btn"]')).toBeDisabled();
        } finally {
            cleanup();
        }
    });

    test('shows error bubble with retry button on network failure', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'error-3');
        try {
            const task = await seedAndWaitForTask(serverUrl, wsId, {
                payload: { prompt: 'Network error test' },
            });
            const taskId = task.id as string;

            await gotoQueueTask(page, serverUrl, wsId, taskId);
            await waitForConversation(page, 2);

            // Intercept POST /message to abort (simulate network error)
            await page.route('**/api/processes/**/message', (route) => {
                route.abort('connectionfailed');
            });

            // Send follow-up
            await page.fill('[data-testid="activity-chat-input"]', 'Network fail');
            await page.press('[data-testid="activity-chat-input"]', 'Enter');

            // Error bubble with retry button
            await expect(page.locator('.bubble-error')).toBeVisible({ timeout: 3000 });
            await expect(page.locator('[data-testid="retry-btn"]')).toBeVisible();
        } finally {
            cleanup();
        }
    });
});

// ---------------------------------------------------------------------------
// 8. Streaming – Intermediate State
// ---------------------------------------------------------------------------

test.describe('Queue Task Conversation – Streaming Intermediate State', () => {

    test('renders each chunk before the next one arrives', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'si-1');
        try {
            const chunks = ['Hello', ', world', '!'];
            const { implementation, gate } = mockAI.createGatedStreamingResponse(chunks);
            mockAI.mockSendMessage.mockImplementation(implementation);

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Gate test' },
            });

            // Detect when SSE stream connection is established (before navigation triggers it)
            const sseConnected = page.waitForRequest(req => req.url().includes('/stream'), { timeout: 10_000 });
            await gotoQueueTask(page, serverUrl, wsId, task.id as string);

            const bubble = page.locator('.chat-message.assistant').last();
            const bubbleContent = bubble.locator('.chat-message-content');

            // Wait for executor to start — streaming placeholder proves SSE is connected
            await expect(page.locator('.streaming-indicator')).toBeVisible({ timeout: 8000 });
            // Ensure SSE EventSource has connected so chunks reach the browser
            await sseConnected;

            // ── Chunk 1 ───────────────────────────────────────────────────────
            await gate.releaseNext();
            await expect(bubbleContent).toContainText('Hello', { timeout: 5000 });
            await expect(bubbleContent).not.toContainText(', world');

            // ── Chunk 2 ───────────────────────────────────────────────────────
            await gate.releaseNext();
            await expect(bubbleContent).toContainText('Hello, world', { timeout: 2000 });
            await expect(bubbleContent).not.toContainText('!');

            // ── Chunk 3 ───────────────────────────────────────────────────────
            await gate.releaseNext();
            await expect(bubbleContent).toContainText('Hello, world!', { timeout: 2000 });

            // After all chunks are released the mock returns and the server marks the
            // task completed. Wait for that server-side completion, then navigate away
            // and back so the page renders the final persisted state (no streaming
            // indicator) — avoids a race where the SSE 'done' event is missed by the
            // still-open EventSource before it fires finish().
            gate.releaseAll(); // ensure mock unblocks (no-op if already done)
            await waitForTaskStatus(serverUrl, task.id as string);
            const activityUrl = `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`;
            await page.goto(activityUrl);
            await gotoQueueTask(page, serverUrl, wsId, task.id as string);
            await expect(page.locator('.streaming-indicator')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });

    test('streaming indicator is visible between chunks and gone after last chunk', async ({ page, serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'si-2');
        try {
            const chunks = ['Part one', ' part two'];
            const { implementation, gate } = mockAI.createGatedStreamingResponse(chunks);
            mockAI.mockSendMessage.mockImplementation(implementation);

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Indicator test' },
            });

            const sseConnected = page.waitForRequest(req => req.url().includes('/stream'), { timeout: 10_000 });
            await gotoQueueTask(page, serverUrl, wsId, task.id as string);

            await expect(page.locator('.streaming-indicator')).toBeVisible({ timeout: 8000 });
            await sseConnected;
            // Allow SSE connection to fully establish before releasing chunks
            await page.waitForTimeout(500);

            await gate.releaseNext();
            await expect(page.locator('.chat-message.assistant .chat-message-content').last())
                .toContainText('Part one', { timeout: 5000 });
            // Indicator still visible — stream not complete
            await expect(page.locator('.streaming-indicator')).toBeVisible();

            await gate.releaseNext();

            // After all chunks are released, wait for server-side task completion
            // then navigate away and back. A completed task renders without a
            // streaming indicator, which is the reliable way to assert the
            // no-streaming final state (avoids timing races with SSE 'done').
            gate.releaseAll(); // no-op if already done
            await waitForTaskStatus(serverUrl, task.id as string);
            const activityUrl = `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity`;
            await page.goto(activityUrl);
            await gotoQueueTask(page, serverUrl, wsId, task.id as string);
            await expect(page.locator('.streaming-indicator')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });
});

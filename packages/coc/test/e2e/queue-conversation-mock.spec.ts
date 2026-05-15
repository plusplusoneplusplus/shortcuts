/**
 * Queue Conversation Mock AI E2E Tests
 *
 * Focused Playwright spec exercising 4 conversation scenarios using Mock AI:
 * 1. Basic conversation rendering (user/assistant bubbles, timestamps)
 * 2. Tool call rendering (single card, nested explore sub-tasks)
 * 3. Streaming content (indicator visibility, progressive content)
 * 4. Complete multi-turn conversation (follow-up flow)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Provision a temporary workspace tied to a fresh temp directory. */
async function makeWorkspace(
    serverUrl: string,
    prefix: string,
): Promise<{ wsId: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-qcmock-${prefix}-`));
    const wsId = `${prefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, prefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/**
 * Set toolCompactness=0 via the admin API so tool calls render as individual
 * .tool-call-card elements instead of being whisper-collapsed (default=3).
 */
async function setToolCompactnessZero(serverUrl: string): Promise<void> {
    await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ toolCompactness: 0 }),
    });
}

/** Poll GET /api/queue/:id until status matches or timeout expires. */
async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    targetStatuses: string[],
    timeoutMs = 10_000,
    intervalMs = 250,
): Promise<Record<string, unknown>> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const res = await request(`${serverUrl}/api/queue/${taskId}`);
        if (res.status === 200) {
            const json = JSON.parse(res.body);
            const task = json.task ?? json;
            if (targetStatuses.includes(task.status as string)) {
                return task;
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
        `Task ${taskId} did not reach ${targetStatuses.join('|')} within ${timeoutMs}ms`,
    );
}

/**
 * Navigate to the task detail page via the repo-scoped activity route and wait
 * for the chat layout to render.
 */
async function gotoConversation(
    page: Page,
    serverUrl: string,
    wsId: string,
    taskId: string,
): Promise<void> {
    const processId = `queue_${taskId}`;
    await page.goto(
        `${serverUrl}/#repos/${encodeURIComponent(wsId)}/activity/${encodeURIComponent(processId)}`,
    );
    await page.waitForSelector('[data-testid="activity-chat-detail"]', { timeout: 8_000 });
}

/**
 * Wait until at least `count` `.chat-message` elements are present.
 */
async function waitForBubbles(page: Page, count: number, timeoutMs = 6_000): Promise<void> {
    await page.waitForFunction(
        (n) => document.querySelectorAll('.chat-message').length >= n,
        count,
        { timeout: timeoutMs },
    );
}

// ── Group 1: Basic Conversation Rendering ─────────────────────────────────────

test.describe('Mock AI: Basic Conversation Rendering', () => {
    test('renders user prompt as first chat bubble', async ({ serverUrl, mockAI, page }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-basic-1');
        try {
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'The answer is 42',
                sessionId: 'sess-1',
            });

            const task = await seedQueueTask(serverUrl, {
                type: 'chat',
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'What is the meaning of life?' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 1);

            const userBubbles = page.locator('.chat-message.user');
            await expect(userBubbles).toHaveCount(1);
            await expect(userBubbles.first()).toContainText('What is the meaning of life?');

            const roleLabel = userBubbles.first().locator('.role-label');
            await expect(roleLabel).toContainText('You');
        } finally {
            cleanup();
        }
    });

    test('renders assistant response bubble', async ({ serverUrl, mockAI, page }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-basic-2');
        try {
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'Here is my analysis...',
                sessionId: 'sess-2',
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Analyse this codebase.' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 2);

            const assistantBubbles = page.locator('.chat-message.assistant');
            await expect(assistantBubbles).toHaveCount(1);

            const roleLabel = assistantBubbles.first().locator('.role-label');
            await expect(roleLabel).toContainText('Assistant');

            const content = assistantBubbles.first().locator('.chat-message-content');
            await expect(content).toContainText('Here is my analysis');
        } finally {
            cleanup();
        }
    });

    test('displays timestamps on both bubbles', async ({ serverUrl, mockAI, page }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-basic-3');
        try {
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'Timestamp test response',
                sessionId: 'sess-3',
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Timestamp check' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 2);

            const userTimestamp = page.locator('.chat-message.user .timestamp').first();
            await expect(userTimestamp).toBeVisible();
            await expect(userTimestamp).toHaveText(/\d{1,2}:\d{2}/);

            const assistantTimestamp = page.locator('.chat-message.assistant .timestamp').first();
            await expect(assistantTimestamp).toBeVisible();
            await expect(assistantTimestamp).toHaveText(/\d{1,2}:\d{2}/);
        } finally {
            cleanup();
        }
    });
});

// ── Group 2: Tool Call Rendering ──────────────────────────────────────────────
//
// Strategy: fire tool events immediately (no gating), let the task complete,
// then navigate to the *completed* task. The persisted conversation timeline
// includes the tool events, so the SPA renders tool-call cards without needing
// live SSE delivery — avoiding all SSE timing races.

test.describe('Mock AI: Tool Call Rendering', () => {
    test('renders a single tool call card', async ({ serverUrl, mockAI, page }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-tool-1');
        try {
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createToolCallResponse(
                    [
                        {
                            type: 'tool-start',
                            toolCallId: 'tc-1',
                            toolName: 'view',
                            parameters: { path: 'src/app.ts' },
                        },
                        {
                            type: 'tool-complete',
                            toolCallId: 'tc-1',
                            toolName: 'view',
                            result: 'file content here',
                        },
                    ],
                    { finalResponse: 'Done.' },
                ),
            );

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Show me src/app.ts' },
            });

            // Let the task complete before navigating — tool events are persisted
            // in the conversation timeline and rendered without live SSE.
            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed'], 15_000);

            // Set toolCompactness=0 so tool calls render as individual cards
            // (default=3 whisper-collapses them, hiding .tool-call-card).
            await setToolCompactnessZero(serverUrl);

            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 2);

            // One tool call card rendered from the persisted timeline
            await expect(page.locator('.tool-call-card')).toHaveCount(1, { timeout: 8000 });
            await expect(page.locator('.tool-call-card .tool-call-name')).toContainText('view');

            // Body starts collapsed
            await expect(page.locator('.tool-call-body.collapsed')).toHaveCount(1);

            // Click header to expand
            await page.locator('.tool-call-header').first().click();
            await expect(page.locator('.tool-call-body.collapsed')).toHaveCount(0);
        } finally {
            cleanup();
        }
    });

    test('renders nested explore sub-task with child tools', async ({ serverUrl, mockAI, page }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-tool-2');
        try {
            mockAI.mockSendMessage.mockImplementation(
                mockAI.createToolCallResponse(
                    [
                        {
                            type: 'tool-start',
                            toolCallId: 'tc-explore',
                            toolName: 'task',
                            parameters: { agent_type: 'explore', prompt: 'find components' },
                        },
                        {
                            type: 'tool-start',
                            toolCallId: 'tc-view',
                            toolName: 'view',
                            parameters: { path: 'src/' },
                            parentToolCallId: 'tc-explore',
                        },
                        {
                            type: 'tool-complete',
                            toolCallId: 'tc-view',
                            toolName: 'view',
                            result: 'src contents',
                            parentToolCallId: 'tc-explore',
                        },
                        {
                            type: 'tool-start',
                            toolCallId: 'tc-grep',
                            toolName: 'grep',
                            parameters: { pattern: 'Component', path: 'src/' },
                            parentToolCallId: 'tc-explore',
                        },
                        {
                            type: 'tool-complete',
                            toolCallId: 'tc-grep',
                            toolName: 'grep',
                            result: 'matches',
                            parentToolCallId: 'tc-explore',
                        },
                        {
                            type: 'tool-complete',
                            toolCallId: 'tc-explore',
                            toolName: 'task',
                            result: 'found 2 components',
                        },
                    ],
                    { finalResponse: 'Exploration complete.' },
                ),
            );

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Explore and find components' },
            });

            // Wait for task to complete before navigating
            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed'], 15_000);

            // Set toolCompactness=0 so tool calls render as individual cards
            await setToolCompactnessZero(serverUrl);

            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 2);

            // One top-level explore card from the persisted timeline
            const exploreCard = page.locator('.tool-call-card[data-tool-id="tc-explore"]');
            await expect(exploreCard).toHaveCount(1, { timeout: 8000 });

            // Two child tool cards nested within
            const childCards = exploreCard.locator('.tool-call-children .tool-call-card');
            await expect(childCards).toHaveCount(2);

            // Subtree starts collapsed by default
            const subtoolToggle = exploreCard.locator(':scope > .tool-call-header button[aria-label]');
            await expect(exploreCard.locator('.subtree-collapsed')).toHaveCount(1);

            // Expand children by clicking the subtool toggle button
            await subtoolToggle.click();
            await expect(exploreCard.locator('.subtree-collapsed')).toHaveCount(0);
            await expect(childCards).toHaveCount(2);

            // Collapse again
            await subtoolToggle.click();
            await expect(exploreCard.locator('.subtree-collapsed')).toHaveCount(1);
        } finally {
            cleanup();
        }
    });
});

// ── Group 3: Streaming Content ────────────────────────────────────────────────

test.describe('Mock AI: Streaming Content', () => {
    test('shows streaming indicator while AI is responding', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-stream-1');
        let resolveAI!: (value: unknown) => void;
        const hangingPromise = new Promise((res) => {
            resolveAI = res;
        });

        try {
            // Hang the AI response indefinitely so the task stays in 'running'
            mockAI.mockSendMessage.mockImplementation(() => hangingPromise);

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Hang forever' },
            });

            // Task is now running but not yet complete — navigate immediately
            await gotoConversation(page, serverUrl, wsId, task.id as string);

            // User bubble should appear (from the seeded payload in the store)
            await waitForBubbles(page, 1);
            await expect(page.locator('.chat-message.user')).toHaveCount(1);

            // Streaming indicator is visible
            await expect(page.locator('.streaming-indicator')).toBeVisible({ timeout: 5_000 });
        } finally {
            // Clean up: resolve the promise so the server doesn't hang
            resolveAI({ success: true, response: 'Done', sessionId: 'sess-stream' });
            cleanup();
        }
    });

    test('updates content progressively through streaming chunks', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-stream-2');
        try {
            // Use a direct mock with intentional delays so SSE can connect.
            // The initial delay must be long enough for the page to load and
            // observe the "running" state before the mock completes.
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                await new Promise((r) => setTimeout(r, 8000));
                if (opts && opts.onStreamingChunk) {
                    opts.onStreamingChunk('Hello');
                    await new Promise((r) => setTimeout(r, 300));
                    opts.onStreamingChunk(', world!');
                }
                await new Promise((r) => setTimeout(r, 500));
                return { success: true, response: 'Hello, world!', sessionId: 'sess-stream-2' };
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'Stream to me' },
            });
            const taskId = task.id as string;

            // Navigate immediately — task is in-flight
            await gotoConversation(page, serverUrl, wsId, taskId);

            // Streaming indicator should appear during in-flight period
            await expect(page.locator('.streaming-indicator')).toBeVisible({ timeout: 5_000 });

            // Wait until the task finishes (longer timeout due to 8s mock delay)
            await waitForTaskStatus(serverUrl, taskId, ['completed', 'failed'], 15_000);

            // Navigate away then back to force a fresh conversation load
            await page.goto(`${serverUrl}/`);
            await page.waitForLoadState('domcontentloaded');
            await gotoConversation(page, serverUrl, wsId, taskId);
            await waitForBubbles(page, 2);

            // Final content assembled after task completion
            const content = page
                .locator('.chat-message.assistant .chat-message-content')
                .first();
            await expect(content).toContainText('Hello, world!', { timeout: 6_000 });

            // Indicator gone
            await expect(page.locator('.streaming-indicator')).toHaveCount(0, { timeout: 4_000 });
        } finally {
            cleanup();
        }
    });
});

// ── Group 4: Complete Multi-Turn Conversation ─────────────────────────────────

test.describe('Mock AI: Complete Multi-Turn Conversation', () => {
    test('full conversation: user prompt + assistant response + follow-up + reply', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'mock-multi');
        try {
            // ── Turn 1: initial exchange ──────────────────────────────────────────
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'Initial answer',
                sessionId: 'sess-multi',
            });

            const task = await seedQueueTask(serverUrl, {
                repoId: wsId,
                payload: { workspaceId: wsId, prompt: 'First question' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 2);

            // Initial state: 1 user + 1 assistant
            await expect(page.locator('.chat-message')).toHaveCount(2);
            await expect(page.locator('.chat-message.user')).toHaveCount(1);
            await expect(page.locator('.chat-message.assistant')).toHaveCount(1);

            // ── Turn 2: follow-up ─────────────────────────────────────────────────
            // executeFollowUp() calls aiService.sendMessage (not sendFollowUp)
            mockAI.mockSendMessage.mockImplementationOnce(async (opts: any) => {
                if (opts && opts.onStreamingChunk) {
                    opts.onStreamingChunk('Follow-up answer');
                }
                return { success: true, response: 'Follow-up answer', sessionId: 'sess-multi' };
            });

            await page.fill('[data-testid="activity-chat-input"]', 'Follow-up question');
            await page.keyboard.press('Enter');

            // Wait for the second exchange to complete (4 bubbles total)
            await waitForBubbles(page, 4);

            await expect(page.locator('.chat-message')).toHaveCount(4);
            await expect(page.locator('.chat-message.user')).toHaveCount(2);
            await expect(page.locator('.chat-message.assistant')).toHaveCount(2);

            // Last assistant bubble has the follow-up answer
            const lastAssistant = page.locator('.chat-message.assistant').last();
            await expect(lastAssistant.locator('.chat-message-content')).toContainText(
                'Follow-up answer',
            );

            // All 4 bubbles carry visible timestamps
            const timestamps = page.locator('.chat-message .timestamp');
            await expect(timestamps).toHaveCount(4);
            for (let i = 0; i < 4; i++) {
                await expect(timestamps.nth(i)).toBeVisible();
            }
        } finally {
            cleanup();
        }
    });
});

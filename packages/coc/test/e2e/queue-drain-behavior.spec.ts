/**
 * Queue Drain Behavior – E2E Tests
 *
 * Verifies the core queue drain behavior: multiple tasks enqueued while the AI
 * is slow are eventually picked up and completed in order (FIFO).
 *
 * Uses exclusive concurrency (autopilot-mode chat tasks) to ensure only one
 * task runs at a time, making drain ordering deterministic.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Provision a temporary workspace tied to a fresh temp directory. The standalone
 * `#processes` route and `#process/<id>` deep links were removed; queue tasks
 * must now be scoped to a workspace so they appear under
 * `#repos/<wsId>/activity/<processId>`.
 */
async function makeWorkspace(
    serverUrl: string,
    idPrefix: string,
): Promise<{ wsId: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-drain-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/** Poll GET /api/queue/:id until status matches or timeout. */
async function waitForTaskStatus(
    serverUrl: string,
    taskId: string,
    targetStatuses: string[],
    timeoutMs = 15_000,
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

/** Get the current task status without waiting. */
async function getTaskStatus(
    serverUrl: string,
    taskId: string,
): Promise<string | undefined> {
    const res = await request(`${serverUrl}/api/queue/${taskId}`);
    if (res.status === 200) {
        const json = JSON.parse(res.body);
        const task = json.task ?? json;
        return task.status as string;
    }
    return undefined;
}

/**
 * Seed an exclusive (autopilot-mode) chat task scoped to a workspace.
 * Autopilot mode routes through the exclusive queue (max 1 concurrent),
 * which is what makes drain-order testing deterministic. The task must
 * carry both `repoId` and `payload.workspaceId` so the multi-repo queue
 * router can resolve the workspace's root path.
 */
function seedExclusiveTask(
    serverUrl: string,
    wsId: string,
    prompt: string,
    overrides: Record<string, unknown> = {},
) {
    const basePayload = (overrides.payload ?? {}) as Record<string, unknown>;
    return seedQueueTask(serverUrl, {
        type: 'chat',
        repoId: wsId,
        ...overrides,
        payload: { workspaceId: wsId, prompt, mode: 'autopilot', ...basePayload },
    });
}

/**
 * Filter mock SDK call args down to "primary" user-prompt calls, ignoring
 * background AI calls (title generation, prewarm, etc.) so per-test
 * assertions stay focused on what the executor sent for the queued task.
 */
function isBackgroundPrompt(prompt: string | undefined): boolean {
    if (!prompt) return false;
    return (
        prompt.startsWith('Summarise the following conversation as a short title')
        || prompt.startsWith('Generate a title for:')
    );
}

function primarySendMessageCalls(
    mockAI: { mockSendMessage: { calls: unknown[][] } },
): unknown[][] {
    return mockAI.mockSendMessage.calls.filter((args) => {
        const opts = (args.length >= 3 ? args[2] : args[0]) as
            | { prompt?: string }
            | undefined;
        return !isBackgroundPrompt(opts?.prompt);
    });
}

/** Poll until the number of primary (non-background) AI calls reaches `count`. */
async function waitForAICalls(
    mockAI: { mockSendMessage: { calls: unknown[][] } },
    count: number,
    timeoutMs = 15_000,
): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (primarySendMessageCalls(mockAI).length >= count) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
        `Expected ${count} primary AI calls but got ${primarySendMessageCalls(mockAI).length} within ${timeoutMs}ms`,
    );
}

/** Navigate to a queue task's detail page under the per-repo Activity sub-tab. */
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
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

test.describe('Queue Drain Behavior', () => {
    test.describe.configure({ retries: 2 });
    test('multiple tasks drain in FIFO order', async ({ serverUrl, mockAI }) => {
        test.setTimeout(60_000);

        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'fifo');
        try {
            // Deferred promises give per-task timing control
            let resolve1!: (v: unknown) => void;
            let resolve2!: (v: unknown) => void;
            let resolve3!: (v: unknown) => void;

            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { resolve1 = r; }),
            );
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { resolve2 = r; }),
            );
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { resolve3 = r; }),
            );

            // Enqueue 3 exclusive tasks rapidly
            const t1 = await seedExclusiveTask(serverUrl, wsId, 'Task 1');
            const t2 = await seedExclusiveTask(serverUrl, wsId, 'Task 2');
            const t3 = await seedExclusiveTask(serverUrl, wsId, 'Task 3');

            // Task 1 should be running; tasks 2 + 3 should be queued
            await waitForTaskStatus(serverUrl, t1.id as string, ['running']);
            expect(await getTaskStatus(serverUrl, t2.id as string)).toBe('queued');
            expect(await getTaskStatus(serverUrl, t3.id as string)).toBe('queued');

            // Complete task 1 → task 2 picks up
            resolve1({ success: true, response: 'Response 1', sessionId: 'sess-1' });
            await waitForTaskStatus(serverUrl, t1.id as string, ['completed']);
            await waitForTaskStatus(serverUrl, t2.id as string, ['running']);
            expect(await getTaskStatus(serverUrl, t3.id as string)).toBe('queued');

            // Complete task 2 → task 3 picks up
            resolve2({ success: true, response: 'Response 2', sessionId: 'sess-2' });
            await waitForTaskStatus(serverUrl, t2.id as string, ['completed']);
            await waitForTaskStatus(serverUrl, t3.id as string, ['running']);

            // Complete task 3
            resolve3({ success: true, response: 'Response 3', sessionId: 'sess-3' });
            await waitForTaskStatus(serverUrl, t3.id as string, ['completed']);

            // All 3 primary AI calls were executed (background title-gen
            // calls are filtered out because they vary in count and timing).
            expect(primarySendMessageCalls(mockAI).length).toBe(3);
        } finally {
            cleanup();
        }
    });

    test('slow AI streaming does not break the drain loop', async ({ serverUrl, mockAI }) => {
        test.setTimeout(60_000);

        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'slow');
        try {
            mockAI.mockSendMessage.mockImplementationOnce(
                mockAI.createStreamingResponse(
                    ['Hello', ', ', 'world!'],
                    { delayMs: 300, sessionId: 'sess-slow-1' },
                ),
            );
            mockAI.mockSendMessage.mockImplementationOnce(
                mockAI.createStreamingResponse(
                    ['Second', ' task', ' done.'],
                    { delayMs: 200, sessionId: 'sess-slow-2' },
                ),
            );

            const t1 = await seedExclusiveTask(serverUrl, wsId, 'Slow task 1');
            const t2 = await seedExclusiveTask(serverUrl, wsId, 'Slow task 2');

            // Both should eventually complete despite slow streaming
            await waitForTaskStatus(serverUrl, t1.id as string, ['completed'], 20_000);
            await waitForTaskStatus(serverUrl, t2.id as string, ['completed'], 20_000);

            // Verify both tasks actually ran (filter background title-gen calls)
            expect(primarySendMessageCalls(mockAI).length).toBe(2);
        } finally {
            cleanup();
        }
    });

    test('follow-up message is buffered while running and routed after completion', async ({
        serverUrl,
        mockAI,
    }) => {
        test.setTimeout(60_000);

        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'fu');
        try {
            // Task 1 hangs until resolved
            let resolve1!: (v: unknown) => void;
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { resolve1 = r; }),
            );

            const t1 = await seedExclusiveTask(serverUrl, wsId, 'Initial task');
            await waitForTaskStatus(serverUrl, t1.id as string, ['running']);

            // Send a follow-up while task 1 is still running → should be buffered
            const processId = `queue_${t1.id}`;
            const followUpRes = await request(
                `${serverUrl}/api/processes/${processId}/message`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        content: 'Follow-up while running',
                        mode: 'autopilot',
                    }),
                },
            );
            expect(followUpRes.status).toBeLessThan(300);

            // Verify the follow-up is buffered as a pending message
            const procRes = await request(`${serverUrl}/api/processes/${processId}`);
            expect(procRes.status).toBe(200);
            const proc = JSON.parse(procRes.body);
            const p = proc.process ?? proc;
            expect((p.pendingMessages ?? []).length).toBeGreaterThanOrEqual(1);
            expect(p.pendingMessages[0].content).toBe('Follow-up while running');

            // Complete task 1
            resolve1({ success: true, response: 'First response', sessionId: 'sess-fu-1' });
            await waitForTaskStatus(serverUrl, t1.id as string, ['completed']);

            // Now send a follow-up to the completed task → terminal routing enqueues
            // a new task that reuses the same process
            const followUp2Res = await request(
                `${serverUrl}/api/processes/${processId}/message`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        content: 'Follow-up after completion',
                        mode: 'autopilot',
                    }),
                },
            );
            expect(followUp2Res.status).toBeLessThan(300);

            // The terminal follow-up should trigger a second AI execution
            await waitForAICalls(mockAI, 2, 15_000);
        } finally {
            cleanup();
        }
    });

    test('failed task does not block the queue', async ({ serverUrl, mockAI }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'fail');
        try {
            // Task 1: AI failure; task 2: uses default mock (success)
            mockAI.mockSendMessage.mockImplementationOnce(async () => ({
                success: false,
                error: 'AI service temporarily unavailable',
            }));

            const t1 = await seedExclusiveTask(serverUrl, wsId, 'Failing task');
            const t2 = await seedExclusiveTask(serverUrl, wsId, 'Should still run');

            // Task 1 should fail
            await waitForTaskStatus(serverUrl, t1.id as string, ['failed']);

            // Task 2 should still be picked up and complete
            await waitForTaskStatus(serverUrl, t2.id as string, ['completed'], 15_000);
        } finally {
            cleanup();
        }
    });

    test('UI updates when queued task starts running', async ({
        page,
        serverUrl,
        mockAI,
    }) => {
        test.setTimeout(60_000);

        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ui');
        try {
            // Hang task 1 so task 2 stays queued
            let resolve1!: (v: unknown) => void;
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { resolve1 = r; }),
            );
            // Task 2: immediate response
            mockAI.mockSendMessage.mockResolvedValueOnce({
                success: true,
                response: 'Task 2 completed successfully',
                sessionId: 'sess-ui-2',
            });

            const t1 = await seedExclusiveTask(serverUrl, wsId, 'Blocking task');
            const t2 = await seedExclusiveTask(serverUrl, wsId, 'Queued task');

            await waitForTaskStatus(serverUrl, t1.id as string, ['running']);
            expect(await getTaskStatus(serverUrl, t2.id as string)).toBe('queued');

            // Navigate to task 2's page → should show PendingTaskInfoPanel
            await gotoQueueTask(page, serverUrl, wsId, t2.id as string);
            await expect(page.locator('.pending-task-info')).toBeVisible({ timeout: 10_000 });

            // Resolve task 1 → task 2 transitions from queued → running → completed
            resolve1({ success: true, response: 'Task 1 done', sessionId: 'sess-ui-1' });

            // Wait for task 2's response to appear — this implies queued→running→completed
            await expect(
                page.locator('.chat-message').filter({ hasText: 'Task 2 completed successfully' }),
            ).toBeVisible({ timeout: 45_000 });

            // PendingTaskInfoPanel should be gone once the response is rendered
            await expect(page.locator('.pending-task-info')).not.toBeVisible({ timeout: 5_000 });
        } finally {
            cleanup();
        }
    });

    test('SSE delivers streaming chunks for queued-then-running task', async ({
        page,
        serverUrl,
        mockAI,
    }) => {
        test.setTimeout(60_000);

        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'sse');
        try {
            // Hang task 1; task 2 streams slowly with an initial delay for SSE to connect
            let resolve1!: (v: unknown) => void;
            mockAI.mockSendMessage.mockImplementationOnce(
                () => new Promise((r) => { resolve1 = r; }),
            );
            mockAI.mockSendMessage.mockImplementationOnce(async (...args: unknown[]) => {
                const opts = (args.length >= 3 ? args[2] : args[0]) as Record<
                    string,
                    unknown
                > | undefined;
                const onChunk = opts?.onStreamingChunk as
                    | ((chunk: string) => void)
                    | undefined;

                // Initial delay gives the page time to establish SSE connection
                await new Promise((r) => setTimeout(r, 1500));

                const chunks = ['Streaming:', ' chunk-1,', ' chunk-2,', ' chunk-3.'];
                for (const chunk of chunks) {
                    await new Promise((r) => setTimeout(r, 400));
                    onChunk?.(chunk);
                }

                return {
                    success: true,
                    response: 'Streaming: chunk-1, chunk-2, chunk-3.',
                    sessionId: 'sess-sse-2',
                };
            });

            const t1 = await seedExclusiveTask(serverUrl, wsId, 'Block for SSE');
            const t2 = await seedExclusiveTask(serverUrl, wsId, 'SSE task');

            await waitForTaskStatus(serverUrl, t1.id as string, ['running']);

            // Navigate to task 2's detail page — shows PendingTaskInfoPanel initially
            await gotoQueueTask(page, serverUrl, wsId, t2.id as string);
            await expect(page.locator('.pending-task-info')).toBeVisible({ timeout: 10_000 });

            // Resolve task 1 → task 2 starts running → SSE connects → chunks stream
            resolve1({ success: true, response: 'Done', sessionId: 'sess-sse-1' });

            // Wait for the streaming indicator (proves SSE connected and data flowing)
            await expect(page.locator('.streaming-indicator')).toBeVisible({ timeout: 30_000 });

            // Wait for the final response content to appear
            await expect(
                page.locator('.chat-message').filter({ hasText: 'chunk-3' }),
            ).toBeVisible({ timeout: 20_000 });

            // Task 2 should be completed
            await waitForTaskStatus(serverUrl, t2.id as string, ['completed']);
        } finally {
            cleanup();
        }
    });
});

/**
 * Queue Mock AI Integration – Smoke Tests
 *
 * Validates that the mock AI service is correctly wired into the E2E
 * test infrastructure and that queue tasks execute against the mock.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, request } from './fixtures/seed';

/** Poll GET /api/queue/:id until status matches or timeout. */
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
    throw new Error(`Task ${taskId} did not reach ${targetStatuses.join('|')} within ${timeoutMs}ms`);
}

test.describe('Queue Mock AI Integration', () => {
    test('mock AI executes queue task successfully', async ({ serverUrl, mockAI }) => {
        const task = await seedQueueTask(serverUrl, {
            type: 'chat',
            payload: { prompt: 'What is the meaning of life?' },
        });

        expect(task.id).toBeTruthy();

        const completed = await waitForTaskStatus(serverUrl, task.id as string, [
            'completed',
            'failed',
        ]);

        expect(completed.status).toBe('completed');
    });

    test('can customize mock AI response per test', async ({ serverUrl, mockAI }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: true,
            response: 'Custom test response',
            sessionId: 'test-session-123',
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Test custom response' },
        });

        const completed = await waitForTaskStatus(serverUrl, task.id as string, [
            'completed',
            'failed',
        ]);

        expect(completed.status).toBe('completed');
    });

    test('handles AI failure gracefully', async ({ serverUrl, mockAI }) => {
        mockAI.mockSendMessage.mockResolvedValueOnce({
            success: false,
            error: 'AI service temporarily unavailable',
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Test failure handling' },
        });

        const finished = await waitForTaskStatus(serverUrl, task.id as string, [
            'completed',
            'failed',
        ]);

        expect(finished.status).toBe('failed');
    });

    test('mockAI resets between tests', async ({ mockAI }) => {
        // After the previous test's auto-reset, call counts should be 0
        expect(mockAI.mockSendMessage.calls.length).toBe(0);
        expect(mockAI.mockIsAvailable.calls.length).toBe(0);
    });
});

/**
 * E2E Playwright tests for read_agent tool call rendering.
 *
 * Verifies that content streamed while read_agent is active renders
 * inside the read_agent card (not at the top level), and that parallel
 * read_agent calls each contain their own content.
 */

import { test, expect } from './fixtures/server-fixture';
import { seedQueueTask, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

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

async function gotoConversation(page: Page, serverUrl: string, taskId: string): Promise<void> {
    await page.goto(`${serverUrl}/#process/queue_${taskId}`);
    await page.waitForSelector('[data-testid="activity-chat-detail"]', { timeout: 8_000 });
}

async function waitForBubbles(page: Page, count: number, timeoutMs = 6_000): Promise<void> {
    await page.waitForFunction(
        (n) => document.querySelectorAll('.chat-message').length >= n,
        count,
        { timeout: timeoutMs },
    );
}

test.describe('read_agent content nesting', () => {
    test('content during read_agent renders inside its card, not at top level', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
            const onToolEvent = opts?.onToolEvent as ((e: any) => void) | undefined;
            const onChunk = opts?.onStreamingChunk as ((c: string) => void) | undefined;

            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-task',
                toolName: 'task',
                parameters: { agent_type: 'explore', description: 'Report current time' },
            });
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-task',
                toolName: 'task',
                result: 'Agent started in background with agent_id: agent-0',
            });

            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-ra',
                toolName: 'read_agent',
                parameters: { agent_id: 'agent-0', wait: true, timeout: 10 },
            });
            onChunk?.('The system time is unavailable from this agent.');
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-ra',
                toolName: 'read_agent',
                result: 'agent completed',
            });

            onChunk?.('Done reading agent results.');

            return {
                success: true,
                response: 'Done reading agent results.',
                sessionId: 'sess-ra-1',
            };
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Launch an agent and read its result' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const raCard = page.locator('.tool-call-card[data-tool-id="tc-ra"]');
        await expect(raCard).toHaveCount(1);

        await expect(raCard.locator('.tool-call-name')).toContainText('read_agent');

        const raChildren = raCard.locator('.tool-call-children');
        await expect(raChildren).toContainText('The system time is unavailable from this agent.');

        const topContent = page.locator('.chat-message.assistant .chat-message-content');
        await expect(topContent).toContainText('Done reading agent results.');
    });

    test('read_agent card shows agent ID summary in header', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
            const onToolEvent = opts?.onToolEvent as ((e: any) => void) | undefined;

            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-ra-summary',
                toolName: 'read_agent',
                parameters: { agent_id: 'agent-42', wait: true },
            });
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-ra-summary',
                toolName: 'read_agent',
                result: 'agent done',
            });

            return {
                success: true,
                response: 'Result received.',
                sessionId: 'sess-ra-summary',
            };
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Read agent summary test' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const raHeader = page.locator('.tool-call-card[data-tool-id="tc-ra-summary"] .tool-call-header');
        await expect(raHeader).toContainText('Agent agent-42');
        await expect(raHeader).toContainText('(wait)');
    });

    test('parallel read_agent calls each contain their own content', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
            const onToolEvent = opts?.onToolEvent as ((e: any) => void) | undefined;
            const onChunk = opts?.onStreamingChunk as ((c: string) => void) | undefined;

            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-task-a',
                toolName: 'task',
                parameters: { description: 'Task A' },
            });
            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-task-b',
                toolName: 'task',
                parameters: { description: 'Task B' },
            });
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-task-a',
                toolName: 'task',
                result: 'Agent started with agent_id: agent-a',
            });
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-task-b',
                toolName: 'task',
                result: 'Agent started with agent_id: agent-b',
            });

            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-ra-a',
                toolName: 'read_agent',
                parameters: { agent_id: 'agent-a', wait: true },
            });
            onChunk?.('Result from agent Alpha');
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-ra-a',
                toolName: 'read_agent',
                result: 'agent-a done',
            });

            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-ra-b',
                toolName: 'read_agent',
                parameters: { agent_id: 'agent-b', wait: true },
            });
            onChunk?.('Result from agent Bravo');
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-ra-b',
                toolName: 'read_agent',
                result: 'agent-b done',
            });

            onChunk?.('Both agents completed successfully.');

            return {
                success: true,
                response: 'Both agents completed successfully.',
                sessionId: 'sess-parallel',
            };
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Launch two parallel agents' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const raA = page.locator('.tool-call-card[data-tool-id="tc-ra-a"]');
        const raB = page.locator('.tool-call-card[data-tool-id="tc-ra-b"]');
        await expect(raA).toHaveCount(1);
        await expect(raB).toHaveCount(1);

        const childrenA = raA.locator('.tool-call-children');
        const childrenB = raB.locator('.tool-call-children');
        await expect(childrenA).toContainText('Result from agent Alpha');
        await expect(childrenB).toContainText('Result from agent Bravo');

        await expect(childrenA).not.toContainText('Result from agent Bravo');
        await expect(childrenB).not.toContainText('Result from agent Alpha');

        const topContent = page.locator('.chat-message.assistant .chat-message-content');
        await expect(topContent).toContainText('Both agents completed successfully.');
    });

    test('read_agent is not nested inside the task card', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
            const onToolEvent = opts?.onToolEvent as ((e: any) => void) | undefined;

            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-task-solo',
                toolName: 'task',
                parameters: { description: 'Solo task' },
            });
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-task-solo',
                toolName: 'task',
                result: 'Agent started with agent_id: agent-solo',
            });
            onToolEvent?.({
                type: 'tool-start',
                toolCallId: 'tc-ra-solo',
                toolName: 'read_agent',
                parameters: { agent_id: 'agent-solo', wait: true },
            });
            onToolEvent?.({
                type: 'tool-complete',
                toolCallId: 'tc-ra-solo',
                toolName: 'read_agent',
                result: 'solo agent done',
            });

            return {
                success: true,
                response: 'All done.',
                sessionId: 'sess-solo',
            };
        });

        const task = await seedQueueTask(serverUrl, {
            payload: { prompt: 'Solo task then read_agent' },
        });

        await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
        await gotoConversation(page, serverUrl, task.id as string);
        await waitForBubbles(page, 1);

        const taskCard = page.locator('.tool-call-card[data-tool-id="tc-task-solo"]');
        const raCard = page.locator('.tool-call-card[data-tool-id="tc-ra-solo"]');
        await expect(taskCard).toHaveCount(1);
        await expect(raCard).toHaveCount(1);

        const raInsideTask = taskCard.locator('.tool-call-card[data-tool-id="tc-ra-solo"]');
        await expect(raInsideTask).toHaveCount(0);
    });
});

/**
 * E2E Playwright tests for read_agent tool call rendering.
 *
 * Verifies that content streamed while read_agent is active renders
 * inside the read_agent card (not at the top level), and that parallel
 * read_agent calls each contain their own content.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    createSubAgentToolEvents,
    readAgentToolCallId,
} from '@plusplusoneplusplus/coc-agent-sdk/testing';
import { test, expect, safeRmSync } from './fixtures/server-fixture';
import { seedQueueTask, seedWorkspace, request } from './fixtures/seed';
import type { Page } from '@playwright/test';

/**
 * Set toolCompactness to 1 so tool-call cards render as visible `.tool-call-card`
 * elements rather than being collapsed into the whisper group (which is the
 * default behaviour at toolCompactness=3).
 */
async function setToolCompactness(serverUrl: string, value: 0 | 1 | 2 | 3 = 1): Promise<void> {
    await request(`${serverUrl}/api/admin/config`, {
        method: 'PUT',
        body: JSON.stringify({ toolCompactness: value }),
    });
}

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
 * Provision a temporary workspace tied to a fresh temp directory. Queue tasks
 * must now be associated with a workspace so the activity tab deep link
 * `#repos/<wsId>/activity/<processId>` resolves correctly.
 */
async function makeWorkspace(
    serverUrl: string,
    idPrefix: string,
): Promise<{ wsId: string; rootPath: string; cleanup: () => void }> {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), `e2e-readagent-${idPrefix}-`));
    const wsId = `${idPrefix}-${Date.now().toString(36)}`;
    await seedWorkspace(serverUrl, wsId, idPrefix, rootPath);
    return { wsId, rootPath, cleanup: () => safeRmSync(rootPath) };
}

/** Seed a workspace-scoped queue task. */
async function seedTaskInWorkspace(
    serverUrl: string,
    wsId: string,
    overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
    const basePayload = (overrides.payload ?? {}) as Record<string, unknown>;
    return seedQueueTask(serverUrl, {
        repoId: wsId,
        ...overrides,
        payload: { workspaceId: wsId, ...basePayload },
    });
}

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

async function waitForBubbles(page: Page, count: number, timeoutMs = 6_000): Promise<void> {
    await page.waitForFunction(
        (n) => document.querySelectorAll('.chat-message').length >= n,
        count,
        { timeout: timeoutMs },
    );
}

type ProducerToolEvent = ReturnType<typeof createSubAgentToolEvents>[number];

/**
 * Drive a sub-agent producer's `ToolEvent[]` through `onToolEvent`, optionally
 * streaming a chunk right after each `read_agent` `tool-start` — mirroring the
 * runtime, where a sub-agent's output streams while its `read_agent` call is the
 * active tool. `chunkFor(agentId)` returns the chunk text for that read_agent, or
 * `undefined` to stream nothing. Sourcing the events from the shared producer
 * keeps these specs free of hand-authored tool-event arrays; only the streamed
 * chunks (which are not producer output) remain inline.
 */
function emitSubAgentEvents(
    opts: { onToolEvent?: (e: ProducerToolEvent) => void; onStreamingChunk?: (c: string) => void },
    events: ProducerToolEvent[],
    chunkFor?: (agentId: string | undefined) => string | undefined,
): void {
    for (const event of events) {
        opts.onToolEvent?.(event);
        if (event.type === 'tool-start' && event.toolName === 'read_agent') {
            const agentId = (event.parameters as Record<string, unknown> | undefined)?.agent_id;
            const chunk = chunkFor?.(typeof agentId === 'string' ? agentId : undefined);
            if (chunk) {
                opts.onStreamingChunk?.(chunk);
            }
        }
    }
}

test.describe('read_agent content nesting', () => {
    test('content during read_agent renders inside its card, not at top level', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ra1');
        await setToolCompactness(serverUrl);
        try {
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                const onChunk = opts?.onStreamingChunk as ((c: string) => void) | undefined;

                const events = createSubAgentToolEvents([
                    {
                        id: 'tc-task',
                        kind: 'background',
                        agentType: 'explore',
                        description: 'Report current time',
                        agentId: 'agent-0',
                        result: 'The current time could not be determined.',
                    },
                ]);
                emitSubAgentEvents(opts, events, (agentId) =>
                    agentId === 'agent-0'
                        ? 'The system time is unavailable from this agent.'
                        : undefined,
                );

                onChunk?.('Done reading agent results.');

                return {
                    success: true,
                    response: 'Done reading agent results.',
                    sessionId: 'sess-ra-1',
                };
            });

            const task = await seedTaskInWorkspace(serverUrl, wsId, {
                payload: { prompt: 'Launch an agent and read its result' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 1);

            const raCard = page.locator(
                `.tool-call-card[data-tool-id="${readAgentToolCallId('tc-task')}"]`,
            );
            await expect(raCard).toHaveCount(1);

            await expect(raCard.locator('.tool-call-name')).toContainText('read_agent');

            const raChildren = raCard.locator('.tool-call-children');
            await expect(raChildren).toContainText('The system time is unavailable from this agent.');

            const topContent = page.locator('.chat-message.assistant .chat-message-content');
            await expect(topContent).toContainText('Done reading agent results.');
        } finally {
            cleanup();
        }
    });

    test('read_agent card shows agent ID summary in header', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ra2');
        await setToolCompactness(serverUrl);
        try {
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                const events = createSubAgentToolEvents([
                    {
                        id: 'tc-task-summary',
                        kind: 'background',
                        agentId: 'agent-42',
                        result: 'Result received.',
                    },
                ]);
                emitSubAgentEvents(opts, events);

                return {
                    success: true,
                    response: 'Result received.',
                    sessionId: 'sess-ra-summary',
                };
            });

            const task = await seedTaskInWorkspace(serverUrl, wsId, {
                payload: { prompt: 'Read agent summary test' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 1);

            const raHeader = page.locator(
                `.tool-call-card[data-tool-id="${readAgentToolCallId('tc-task-summary')}"] .tool-call-header`,
            );
            await expect(raHeader).toContainText('Agent agent-42');
            await expect(raHeader).toContainText('(wait)');
        } finally {
            cleanup();
        }
    });

    test('parallel read_agent calls each contain their own content', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ra3');
        await setToolCompactness(serverUrl);
        try {
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                const onChunk = opts?.onStreamingChunk as ((c: string) => void) | undefined;

                const events = createSubAgentToolEvents([
                    {
                        id: 'tc-task-a',
                        kind: 'background',
                        description: 'Task A',
                        agentId: 'agent-a',
                        result: 'Alpha final output',
                    },
                    {
                        id: 'tc-task-b',
                        kind: 'background',
                        description: 'Task B',
                        agentId: 'agent-b',
                        result: 'Bravo final output',
                    },
                ]);
                emitSubAgentEvents(opts, events, (agentId) => {
                    if (agentId === 'agent-a') return 'Result from agent Alpha';
                    if (agentId === 'agent-b') return 'Result from agent Bravo';
                    return undefined;
                });

                onChunk?.('Both agents completed successfully.');

                return {
                    success: true,
                    response: 'Both agents completed successfully.',
                    sessionId: 'sess-parallel',
                };
            });

            const task = await seedTaskInWorkspace(serverUrl, wsId, {
                payload: { prompt: 'Launch two parallel agents' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 1);

            const raA = page.locator(
                `.tool-call-card[data-tool-id="${readAgentToolCallId('tc-task-a')}"]`,
            );
            const raB = page.locator(
                `.tool-call-card[data-tool-id="${readAgentToolCallId('tc-task-b')}"]`,
            );
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
        } finally {
            cleanup();
        }
    });

    test('read_agent is not nested inside the task card', async ({
        serverUrl,
        mockAI,
        page,
    }) => {
        const { wsId, cleanup } = await makeWorkspace(serverUrl, 'ra4');
        await setToolCompactness(serverUrl);
        try {
            mockAI.mockSendMessage.mockImplementation(async (opts: any) => {
                const events = createSubAgentToolEvents([
                    {
                        id: 'tc-task-solo',
                        kind: 'background',
                        description: 'Solo task',
                        agentId: 'agent-solo',
                        result: 'Solo final output',
                    },
                ]);
                emitSubAgentEvents(opts, events);

                return {
                    success: true,
                    response: 'All done.',
                    sessionId: 'sess-solo',
                };
            });

            const task = await seedTaskInWorkspace(serverUrl, wsId, {
                payload: { prompt: 'Solo task then read_agent' },
            });

            await waitForTaskStatus(serverUrl, task.id as string, ['completed', 'failed']);
            await gotoConversation(page, serverUrl, wsId, task.id as string);
            await waitForBubbles(page, 1);

            const raSoloId = readAgentToolCallId('tc-task-solo');
            const taskCard = page.locator('.tool-call-card[data-tool-id="tc-task-solo"]');
            const raCard = page.locator(`.tool-call-card[data-tool-id="${raSoloId}"]`);
            await expect(taskCard).toHaveCount(1);
            await expect(raCard).toHaveCount(1);

            const raInsideTask = taskCard.locator(`.tool-call-card[data-tool-id="${raSoloId}"]`);
            await expect(raInsideTask).toHaveCount(0);
        } finally {
            cleanup();
        }
    });
});

/**
 * Sentinel post-mode result return: each tracked `send_to_conversation` post into an
 * existing chat reserves its own delegated job, and that request's terminal result
 * (not the chat's first or latest turn) is recorded for the parent's review.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskQueueManager, type AIProcess, type CreateTaskInput } from '@plusplusoneplusplus/forge';
import { createMockProcessStore, createProcessFixture } from '../../helpers/mock-process-store';
import { DelegatedJobStore } from '../../../src/server/delegation/delegated-job-store';
import { DelegatedJobResults } from '../../../src/server/delegation/delegated-job-results';
import { createSendToConversationTool } from '../../../src/server/llm-tools/send-to-conversation-tool';
import { createSendMessageCapability } from '../../../src/server/processes/send-message-capability';
import { pendingMessageTask } from '../../../src/server/processes/queued-pending-message';

const parentWorkspace = 'ws-parent';
const childWorkspace = 'ws-child';
const parentId = 'queue_sentinel';
const childId = 'chat-child';
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Sentinel post-mode per-request results', () => {
    let dataDir: string;
    let jobs: DelegatedJobStore;
    let queue: TaskQueueManager;
    let store: ReturnType<typeof createMockProcessStore>;
    let services: DelegatedJobResults[];
    let enabled: boolean;
    let running: { id: string; type: string; status: string } | undefined;
    let enqueue: ReturnType<typeof vi.fn>;
    let steerProcess: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delegated-requests-'));
        jobs = new DelegatedJobStore(dataDir);
        queue = new TaskQueueManager();
        store = createMockProcessStore();
        store.getWorkspaces = vi.fn().mockResolvedValue([{ id: parentWorkspace }, { id: childWorkspace }]);
        await store.addProcess(createProcessFixture({ id: parentId, metadata: { workspaceId: parentWorkspace, mode: 'sentinel' } }));
        await child();
        services = [];
        enabled = true;
        running = undefined;
        enqueue = vi.fn(async (input: CreateTaskInput) => queue.enqueue(input));
        steerProcess = vi.fn(async () => true);
    });

    afterEach(() => {
        services.forEach(service => service.dispose());
        fs.rmSync(dataDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    async function child(overrides: Partial<AIProcess> = {}) {
        await store.addProcess(createProcessFixture({
            id: childId, status: 'completed', conversationTurns: [],
            metadata: { workspaceId: childWorkspace, mode: 'autopilot', type: 'chat' }, ...overrides,
        }));
    }

    function results() {
        const service = new DelegatedJobResults({ jobs, store, queue });
        services.push(service);
        return service;
    }

    function tool(parentProcessId = parentId) {
        const bridge = {
            enqueue, steerProcess,
            findTaskByProcessId: vi.fn(() => running),
            getTask: (id: string) => queue.getTask(id),
        };
        const sendMessage = createSendMessageCapability(store as any, bridge as any, { jobs, enabled: () => enabled });
        return createSendToConversationTool({
            runtime: { serverIdentity: 'installation' }, store: store as any, workspaceId: parentWorkspace,
            enqueueChat: vi.fn(), sendMessage, parentProcessId,
        }).tool;
    }

    function rows() {
        return new DelegatedJobStore(dataDir).list(parentWorkspace);
    }

    it('reserves a request job, runs it as its own task and records that task result', async () => {
        results();
        const reply = await tool().handler({ processId: childId, content: 'Run the tests again' }) as any;
        expect(reply.error).toBeUndefined();
        const [row] = rows();
        expect(reply.resultDelivery).toEqual({ status: 'tracked', jobId: row.id });
        expect(row).toMatchObject({
            parent: { workspaceId: parentWorkspace, processId: parentId },
            child: { workspaceId: childWorkspace, processId: childId, requestId: expect.any(String) },
            title: 'Run the tests again',
        });
        const requestId = row.child.requestId!;
        expect(row.id).toBe(`request:${requestId}`);
        // The request ID is the queue task ID and the stored turn's correlation.
        const task = queue.getTask(requestId)!;
        expect(task.payload).toMatchObject({ processId: childId, relayRequestId: requestId });
        const proc = await store.getProcess(childId);
        expect(proc?.conversationTurns?.[0]).toMatchObject({ role: 'user', relayRequestId: requestId });

        queue.markStarted(requestId);
        queue.markCompleted(requestId, { response: 'All 42 tests pass.' });
        await flush();
        expect(rows()[0].terminal).toMatchObject({
            result: { outcome: 'completed', summary: 'All 42 tests pass.',
                terminalEventId: `request:${childWorkspace}:${childId}:${requestId}:terminal`,
                links: [`#chat-references/${jobs.serverIdentity}/${childWorkspace}/${childId}`] },
            delivery: { state: 'pending' },
        });
    });

    it('gives each buffered post its own result instead of the first or latest turn', async () => {
        results();
        running = { id: 'current', type: 'chat', status: 'running' };
        const send = tool();
        await send.handler({ processId: childId, content: 'First question' });
        await send.handler({ processId: childId, content: 'Second question' });
        expect(enqueue).not.toHaveBeenCalled();
        const [first, second] = rows();
        const proc = (await store.getProcess(childId))!;
        expect(proc.pendingMessages?.map(message => [message.id, message.relayRequestId]))
            .toEqual([[first.child.requestId, first.child.requestId], [second.child.requestId, second.child.requestId]]);

        // Drained buffered messages run as separate tasks that keep their correlation.
        for (const [message, answer] of [[proc.pendingMessages![0], 'Answer one'], [proc.pendingMessages![1], 'Answer two']] as const) {
            const id = queue.enqueue(pendingMessageTask(proc, message));
            queue.markStarted(id);
            queue.markCompleted(id, { response: answer });
        }
        await flush();
        expect(rows().map(row => row.terminal?.result.summary)).toEqual(['Answer one', 'Answer two']);
    });

    it('does not let a request task settle the chat-level create-mode job (regression)', async () => {
        results();
        jobs.register({
            id: childId, title: 'Original handoff',
            parent: { workspaceId: parentWorkspace, processId: parentId },
            child: { workspaceId: childWorkspace, processId: childId },
        });
        await tool().handler({ processId: childId, content: 'Follow-up' });
        const request = rows().find(row => row.child.requestId)!;
        queue.markStarted(request.child.requestId!);
        queue.markCompleted(request.child.requestId!, { response: 'Follow-up answer' });
        await flush();
        const [create, tracked] = rows();
        expect(create.terminal).toBeUndefined();
        expect(tracked.terminal?.result.summary).toBe('Follow-up answer');
    });

    it('downgrades a requested steer to a queued turn so the result is its own', async () => {
        running = { id: 'current', type: 'chat', status: 'running' };
        const reply = await tool().handler({ processId: childId, content: 'Also check lint', deliveryMode: 'steer' }) as any;
        expect(steerProcess).not.toHaveBeenCalled();
        expect(reply.resultDelivery).toMatchObject({ status: 'tracked', reason: expect.stringMatching(/queued, not steered/) });
        expect((await store.getProcess(childId))?.pendingMessages).toHaveLength(1);
    });

    it.each([
        ['the flag is off', async () => { enabled = false; }, parentId],
        ['the parent is not a Sentinel', async () => {
            await store.addProcess(createProcessFixture({ id: 'plain', metadata: { workspaceId: parentWorkspace, mode: 'ask' } }));
        }, 'plain'],
        ['the target is a Sentinel', async () => {
            await child({ metadata: { workspaceId: childWorkspace, mode: 'sentinel', type: 'chat' } });
        }, parentId],
        ['the Sentinel posts to itself', async () => {
            await store.addProcess(createProcessFixture({ id: childId, status: 'completed', conversationTurns: [],
                metadata: { workspaceId: parentWorkspace, mode: 'sentinel', type: 'chat' } }));
        }, childId],
    ])('keeps untracked behavior when %s', async (_name, arrange, parent) => {
        await arrange();
        running = { id: 'current', type: 'chat', status: 'running' };
        const reply = await tool(parent).handler({ processId: childId, content: 'Hi', deliveryMode: 'steer' }) as any;
        expect(reply.error).toBeUndefined();
        expect(reply.resultDelivery).toBeUndefined();
        expect(steerProcess).toHaveBeenCalled();
        expect(rows()).toEqual([]);
    });

    it('settles a rejected post as failed without a pending review', async () => {
        enqueue.mockRejectedValueOnce(new Error('queue closed'));
        const reply = await tool().handler({ processId: childId, content: 'Retry the build' }) as any;
        expect(reply.error).toMatch(/Failed to post message/);
        expect(rows()[0].terminal).toMatchObject({
            result: { outcome: 'failed', summary: 'The follow-up message was not delivered.' },
            delivery: { state: 'failed' },
        });
    });

    describe('startup recovery', () => {
        function register(requestId = 'req-1') {
            return jobs.register({
                id: `request:${requestId}`, title: 'Follow-up',
                parent: { workspaceId: parentWorkspace, processId: parentId },
                child: { workspaceId: childWorkspace, processId: childId, requestId },
            });
        }
        const turns = (...extra: any[]) => [
            { role: 'user', content: 'Earlier', turnIndex: 0, timeline: [] },
            { role: 'assistant', content: 'Earlier answer', turnIndex: 1, timeline: [] },
            { role: 'user', content: 'Follow-up', relayRequestId: 'req-1', turnIndex: 2, timeline: [] },
            ...extra,
        ];

        it('records the answer to that request even when later turns exist', async () => {
            register();
            await child({ status: 'completed', conversationTurns: turns(
                { role: 'assistant', content: 'Request answer', turnIndex: 3, timeline: [] },
                { role: 'user', content: 'Later', turnIndex: 4, timeline: [] },
                { role: 'assistant', content: 'Later answer', turnIndex: 5, timeline: [] },
            ) as any });
            await results().restore();
            expect(rows()[0].terminal?.result).toMatchObject({ outcome: 'completed', summary: 'Request answer' });
        });

        it('waits while the request is still buffered or still running', async () => {
            register();
            await child({ status: 'running', conversationTurns: [], pendingMessages: [
                { id: 'req-1', relayRequestId: 'req-1', content: 'Follow-up', createdAt: new Date().toISOString() },
            ] as any });
            await results().restore();
            expect(rows()[0].terminal).toBeUndefined();

            await child({ status: 'running', conversationTurns: turns() as any });
            await results().restore();
            expect(rows()[0].terminal).toBeUndefined();
        });

        it('settles a request whose turn and task are gone as unavailable', async () => {
            register();
            await child({ status: 'completed', conversationTurns: [] });
            await results().restore();
            expect(rows()[0].terminal).toMatchObject({
                result: { outcome: 'failed', summary: 'The follow-up request is unavailable after restart.' },
                delivery: { state: 'failed' },
            });
        });

        it('settles from a terminal history task carrying the request correlation', async () => {
            register();
            const id = queue.enqueue({ id: 'pending-x', processId: childId, type: 'chat', priority: 'normal', repoId: childWorkspace,
                payload: { kind: 'chat', processId: childId, workspaceId: childWorkspace, relayRequestId: 'req-1' } });
            queue.markStarted(id);
            queue.markFailed(id, new Error('provider down'));
            await results().restore();
            expect(rows()[0].terminal?.result).toMatchObject({ outcome: 'failed', reason: 'provider down' });
        });
    });
});

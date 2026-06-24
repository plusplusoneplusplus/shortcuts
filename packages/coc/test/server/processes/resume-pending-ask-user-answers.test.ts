/**
 * Startup re-enqueue for pending ask_user resumes (AC-04).
 *
 * Covers:
 * - reenqueuePendingAskUserResumes enqueues a resume task for a process that
 *   still carries a durable pendingAskUserAnswer and has no in-flight resume.
 * - Idempotency: running it twice (with a queue that reflects the first
 *   enqueue) does not stack a duplicate concurrent resume.
 * - A process whose resume task is already queued/running is skipped (e.g. the
 *   queue persistence layer restored it).
 * - A process without a durable pendingAskUserAnswer is left alone.
 * - buildAskUserResumeTaskInput / collectInFlightAskUserResumeProcessIds shape.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { AIProcess, CreateTaskInput, PendingAskUserAnswer, QueuedTask } from '@plusplusoneplusplus/forge';
import {
    buildAskUserResumeTaskInput,
    collectInFlightAskUserResumeProcessIds,
    reenqueuePendingAskUserResumes,
} from '../../../src/server/processes/resume-pending-ask-user-answers';
import { createMockProcessStore } from '../helpers/mock-process-store';

const durable: PendingAskUserAnswer = {
    batchId: 'batch-1',
    submittedAt: '2026-06-24T00:00:00.000Z',
    answers: [
        { questionId: 'q1', question: 'Which DB?', answer: 'postgres', skipped: false, deferred: false },
    ],
};

function seed(store: ReturnType<typeof createMockProcessStore>, overrides: Partial<AIProcess> & { id: string }): void {
    void store.addProcess({
        type: 'chat',
        status: 'failed', // orphan sweep marked it failed on restart
        startTime: new Date(),
        promptPreview: 'test',
        fullPrompt: 'test',
        metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-1' },
        ...overrides,
    } as AIProcess);
}

/** Minimal in-memory queue whose getQueued() reflects prior enqueues. */
function makeQueue() {
    const queued: QueuedTask[] = [];
    const running: QueuedTask[] = [];
    let n = 0;
    return {
        queued,
        running,
        getQueued: () => queued,
        getRunning: () => running,
        enqueue: (input: CreateTaskInput) => {
            const id = `task-${++n}`;
            queued.push({ ...input, id, status: 'queued', createdAt: 0, retryCount: 0 } as unknown as QueuedTask);
            return id;
        },
    };
}

/** A queued/running task that looks like an ask_user resume for `processId`. */
function resumeTask(processId: string): QueuedTask {
    return {
        id: `existing-${processId}`,
        status: 'queued',
        createdAt: 0,
        retryCount: 0,
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', processId, prompt: '', mode: 'ask', context: { askUserResume: true } },
        config: {},
    } as unknown as QueuedTask;
}

describe('buildAskUserResumeTaskInput', () => {
    it('builds a chat follow-up carrying askUserResume context, workingDirectory and workspaceId', () => {
        const input = buildAskUserResumeTaskInput({
            id: 'proc-1',
            workingDirectory: '/work',
            metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-9' },
        } as AIProcess);

        expect(input.processId).toBe('proc-1');
        expect(input.type).toBe('chat');
        const payload = input.payload as any;
        expect(payload.kind).toBe('chat');
        expect(payload.processId).toBe('proc-1');
        expect(payload.prompt).toBe('');
        expect(payload.mode).toBe('ask');
        expect(payload.context.askUserResume).toBe(true);
        expect(payload.workingDirectory).toBe('/work');
        expect(payload.workspaceId).toBe('ws-9');
    });

    it('omits workingDirectory/workspaceId when the process has none', () => {
        const input = buildAskUserResumeTaskInput({ id: 'proc-2' } as AIProcess);
        const payload = input.payload as any;
        expect('workingDirectory' in payload).toBe(false);
        expect('workspaceId' in payload).toBe(false);
    });
});

describe('collectInFlightAskUserResumeProcessIds', () => {
    it('collects only ask_user resume follow-up tasks', () => {
        const ids = collectInFlightAskUserResumeProcessIds([
            resumeTask('p1'),
            { payload: { kind: 'chat', processId: 'p2', context: {} } }, // plain follow-up
            { payload: { kind: 'chat', context: { askUserResume: true } } }, // no processId
            { payload: { kind: 'run-workflow', processId: 'p3', context: { askUserResume: true } } }, // not chat
            resumeTask('p4'),
        ]);
        expect([...ids].sort()).toEqual(['p1', 'p4']);
    });
});

describe('reenqueuePendingAskUserResumes (AC-04)', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
    });

    it('enqueues a resume for a process with a durable pendingAskUserAnswer and no in-flight resume', async () => {
        seed(store, { id: 'proc-pending', sdkSessionId: 'sess-1', workingDirectory: '/work', pendingAskUserAnswer: durable });
        const queue = makeQueue();

        const count = await reenqueuePendingAskUserResumes(store, queue);

        expect(count).toBe(1);
        expect(queue.queued).toHaveLength(1);
        const payload = queue.queued[0].payload as any;
        expect(payload.processId).toBe('proc-pending');
        expect(payload.context.askUserResume).toBe(true);
    });

    it('is idempotent: a second run does not stack a duplicate concurrent resume', async () => {
        seed(store, { id: 'proc-pending', sdkSessionId: 'sess-1', pendingAskUserAnswer: durable });
        const queue = makeQueue();

        const first = await reenqueuePendingAskUserResumes(store, queue);
        const second = await reenqueuePendingAskUserResumes(store, queue);

        expect(first).toBe(1);
        expect(second).toBe(0); // first enqueue is now in-flight → skipped
        expect(queue.queued).toHaveLength(1);
    });

    it('skips a process whose resume task was already restored (queued)', async () => {
        seed(store, { id: 'proc-restored', sdkSessionId: 'sess-1', pendingAskUserAnswer: durable });
        const queue = makeQueue();
        queue.queued.push(resumeTask('proc-restored'));

        const count = await reenqueuePendingAskUserResumes(store, queue);

        expect(count).toBe(0);
        expect(queue.queued).toHaveLength(1); // unchanged
    });

    it('skips a process whose resume task is already running', async () => {
        seed(store, { id: 'proc-running', sdkSessionId: 'sess-1', pendingAskUserAnswer: durable });
        const queue = makeQueue();
        queue.running.push(resumeTask('proc-running'));

        const count = await reenqueuePendingAskUserResumes(store, queue);

        expect(count).toBe(0);
        expect(queue.queued).toHaveLength(0);
    });

    it('ignores processes without a durable pendingAskUserAnswer', async () => {
        seed(store, { id: 'proc-clean', sdkSessionId: 'sess-1' });
        const queue = makeQueue();

        const count = await reenqueuePendingAskUserResumes(store, queue);

        expect(count).toBe(0);
        expect(queue.queued).toHaveLength(0);
    });

    it('re-enqueues for multiple pending processes, only the un-covered ones', async () => {
        seed(store, { id: 'proc-a', pendingAskUserAnswer: durable });
        seed(store, { id: 'proc-b', pendingAskUserAnswer: durable });
        seed(store, { id: 'proc-c' }); // no durable answer
        const queue = makeQueue();
        queue.running.push(resumeTask('proc-a')); // already in-flight

        const count = await reenqueuePendingAskUserResumes(store, queue);

        expect(count).toBe(1);
        const enqueuedFor = queue.queued.map(t => (t.payload as any).processId);
        expect(enqueuedFor).toEqual(['proc-b']);
    });

    it('returns 0 (best-effort) when the store read fails', async () => {
        (store.getAllProcesses as any).mockRejectedValueOnce(new Error('db down'));
        const queue = makeQueue();

        const count = await reenqueuePendingAskUserResumes(store, queue);

        expect(count).toBe(0);
        expect(queue.queued).toHaveLength(0);
    });
});

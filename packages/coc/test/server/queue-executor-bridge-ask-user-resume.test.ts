/**
 * Queue Executor Bridge — ask_user resume across restart.
 *
 * Covers:
 * - AC-01/AC-02 — a post-restart answer (live handles gone, persisted batch
 *   matches) succeeds, persists a durable pendingAskUserAnswer, clears
 *   pendingAskUser, and enqueues a resume task (no 404 dead-end).
 * - AC-07 — the live path still resolves the in-memory Promise and enqueues no
 *   resume task; a batchId mismatch still returns false (→ 404).
 * - AC-03 — resumePendingAskUser resumes the persisted sdkSessionId and delivers
 *   the synthesized answer message; status returns to running; the durable
 *   answer is cleared on success.
 * - AC-05 — a resume that can't proceed ends failed with the "couldn't resume"
 *   error and clears the durable answer (no re-enqueue loop).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return { ...actual, existsSync: vi.fn(actual.existsSync), readFileSync: vi.fn(actual.readFileSync), mkdirSync: vi.fn() };
});

import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { AIProcess, PendingAskUserAnswer, PendingAskUserQuestion } from '@plusplusoneplusplus/forge';
import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';
import { ASK_USER_RESUME_FAILED_MESSAGE } from '../../src/server/llm-tools/ask-user-resume';
import { createMockProcessStore } from './helpers/mock-process-store';
import { createMockSDKService } from '../helpers/mock-sdk-service';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return { ...actual, sdkServiceRegistry: { getOrThrow: () => sdkMocks.service } };
});

function pendingQuestion(overrides: Partial<PendingAskUserQuestion> & { questionId: string }): PendingAskUserQuestion {
    return {
        batchId: 'batch-1',
        questionId: overrides.questionId,
        question: overrides.question ?? `Question ${overrides.questionId}?`,
        type: overrides.type ?? 'text',
        turnIndex: 1,
        index: overrides.index ?? 0,
        batchSize: overrides.batchSize ?? 1,
        ...overrides,
    };
}

function seedProcess(store: ReturnType<typeof createMockProcessStore>, overrides: Partial<AIProcess> & { id: string }): void {
    void store.addProcess({
        type: 'chat',
        status: 'running',
        startTime: new Date(),
        promptPreview: 'test',
        fullPrompt: 'test',
        metadata: { type: 'chat', provider: 'copilot', workspaceId: 'ws-1' },
        ...overrides,
    });
}

// ===========================================================================
// AC-01 / AC-02 / AC-07 — answer-submit branch
// ===========================================================================

describe('answerAskUserQuestions — post-restart resume branch', () => {
    let store: ReturnType<typeof createMockProcessStore>;
    let qm: TaskQueueManager;
    let executor: CLITaskExecutor;

    function withHandles(resolve: boolean | undefined): void {
        // `undefined` simulates a torn-down executor (post-restart): no handles.
        (executor as any).executors = {
            getAskUserHandles: vi.fn(() => resolve === undefined ? undefined : {
                answerQuestion: vi.fn(() => false),
                skipQuestion: vi.fn(() => false),
                answerQuestions: vi.fn(() => resolve),
                cancelAll: vi.fn(),
                hasPending: vi.fn(() => true),
            }),
        };
    }

    beforeEach(() => {
        store = createMockProcessStore();
        qm = new TaskQueueManager();
        executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, followUpSuggestions: { enabled: false, count: 3 } });
        executor.setQueueManager(qm);
    });

    it('AC-01/02: succeeds, persists the durable answer, clears pending, enqueues resume', async () => {
        const id = 'proc-restart';
        seedProcess(store, {
            id,
            sdkSessionId: 'sess-1',
            workingDirectory: '/work',
            pendingAskUser: [
                pendingQuestion({ questionId: 'q1', question: 'Which DB?', index: 0, batchSize: 2 }),
                pendingQuestion({ questionId: 'q2', question: 'Why?', index: 1, batchSize: 2 }),
            ],
        });
        withHandles(undefined); // live handles gone (restart)

        const ok = await executor.answerAskUserQuestions(id, 'batch-1', [
            { questionId: 'q1', answer: 'postgres' },
            { questionId: 'q2', answer: 'durability' },
        ]);

        expect(ok).toBe(true);

        const proc = store.processes.get(id)!;
        // AC-02 — durable answer persisted, pending question cleared.
        expect(proc.pendingAskUser).toBeUndefined();
        const durable = proc.pendingAskUserAnswer as PendingAskUserAnswer;
        expect(durable.batchId).toBe('batch-1');
        expect(durable.answers.map(a => [a.questionId, a.answer])).toEqual([
            ['q1', 'postgres'],
            ['q2', 'durability'],
        ]);

        // AC-01 — a resume task was enqueued.
        const queued = qm.getQueued();
        expect(queued).toHaveLength(1);
        const payload = queued[0].payload as any;
        expect(payload.kind).toBe('chat');
        expect(payload.processId).toBe(id);
        expect(payload.context?.askUserResume).toBe(true);
        expect(payload.workspaceId).toBe('ws-1');
    });

    it('AC-02: a second submit of the same batch is rejected (no double-submit)', async () => {
        const id = 'proc-dup';
        seedProcess(store, { id, sdkSessionId: 'sess-1', pendingAskUser: [pendingQuestion({ questionId: 'q1' })] });
        withHandles(undefined);

        await executor.answerAskUserQuestions(id, 'batch-1', [{ questionId: 'q1', answer: 'a' }]);
        // pendingAskUser is now cleared → the batch no longer matches.
        const second = await executor.answerAskUserQuestions(id, 'batch-1', [{ questionId: 'q1', answer: 'a' }]);

        expect(second).toBe(false);
        expect(qm.getQueued()).toHaveLength(1); // only the first enqueued a resume
    });

    it('AC-01: a post-restart batchId mismatch returns false and enqueues nothing', async () => {
        const id = 'proc-mismatch';
        seedProcess(store, { id, pendingAskUser: [pendingQuestion({ questionId: 'q1' })] });
        withHandles(undefined);

        const ok = await executor.answerAskUserQuestions(id, 'wrong-batch', [{ questionId: 'q1', answer: 'a' }]);

        expect(ok).toBe(false);
        expect(store.processes.get(id)?.pendingAskUser).toBeDefined();
        expect(store.processes.get(id)?.pendingAskUserAnswer).toBeUndefined();
        expect(qm.getQueued()).toHaveLength(0);
    });

    it('AC-07: live path resolves the in-memory Promise and enqueues no resume', async () => {
        const id = 'proc-live';
        seedProcess(store, { id, pendingAskUser: [pendingQuestion({ questionId: 'q1' })] });
        withHandles(true); // handles present (no restart)

        const ok = await executor.answerAskUserQuestions(id, 'batch-1', [{ questionId: 'q1', answer: 'a' }]);

        expect(ok).toBe(true);
        expect(store.processes.get(id)?.pendingAskUser).toBeUndefined();
        expect(store.processes.get(id)?.pendingAskUserAnswer).toBeUndefined();
        expect(qm.getQueued()).toHaveLength(0); // fast path — no resume task
    });

    it('AC-07: live path batchId mismatch returns false (→ 404) with no resume', async () => {
        const id = 'proc-live-mismatch';
        seedProcess(store, { id, pendingAskUser: [pendingQuestion({ questionId: 'q1' })] });
        withHandles(true);

        const ok = await executor.answerAskUserQuestions(id, 'wrong-batch', [{ questionId: 'q1', answer: 'a' }]);

        expect(ok).toBe(false);
        expect(store.processes.get(id)?.pendingAskUser).toBeDefined();
        expect(qm.getQueued()).toHaveLength(0);
    });
});

// ===========================================================================
// AC-03 / AC-05 — resume executor
// ===========================================================================

describe('resumePendingAskUser — resume + deliver', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    const durable: PendingAskUserAnswer = {
        batchId: 'batch-1',
        submittedAt: '2026-06-24T00:00:00.000Z',
        answers: [
            { questionId: 'q1', question: 'Which DB?', answer: 'postgres', skipped: false, deferred: false },
            { questionId: 'q2', question: 'Confirm?', answer: 'Yes', skipped: false, deferred: false },
        ],
    };

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
        sdkMocks.mockIsAvailable.mockResolvedValue({ available: true });
    });

    it('AC-03: resumes the sdkSessionId, delivers every Q/A, returns to running, clears the answer', async () => {
        const id = 'proc-resume';
        let statusAtSend: string | undefined;
        let sentOptions: any;
        sdkMocks.mockSendMessage.mockImplementation(async (opts: any) => {
            statusAtSend = store.processes.get(id)?.status;
            sentOptions = opts;
            return { success: true, response: 'continued', sessionId: 'sess-1' };
        });

        seedProcess(store, {
            id,
            status: 'failed', // orphan sweep marked it failed on restart
            sdkSessionId: 'sess-1',
            workingDirectory: '/work',
            pendingAskUserAnswer: durable,
            conversationTurns: [
                { role: 'user', content: 'start', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, followUpSuggestions: { enabled: false, count: 3 } });
        await executor.resumePendingAskUser(id);

        // resumed the persisted session
        expect(sentOptions.sessionId).toBe('sess-1');
        // synthesized prompt carries every question and answer
        expect(sentOptions.prompt).toContain('Which DB?');
        expect(sentOptions.prompt).toContain('postgres');
        expect(sentOptions.prompt).toContain('Confirm?');
        // status was running again by the time the message was delivered
        expect(statusAtSend).toBe('running');

        const proc = store.processes.get(id)!;
        // durable answer consumed; turn completed
        expect(proc.pendingAskUserAnswer).toBeUndefined();
        expect(proc.status).toBe('completed');
        // synthesized answer appears as a user turn for conversation continuity
        const userTurns = (proc.conversationTurns ?? []).filter(t => t.role === 'user');
        expect(userTurns.some(t => t.content.includes('postgres'))).toBe(true);
    });

    it('AC-05: a provider rejection ends failed with the resume-failure error and clears the answer', async () => {
        const id = 'proc-resume-fail';
        sdkMocks.mockSendMessage.mockRejectedValue(new Error('session unresumable'));

        seedProcess(store, {
            id,
            status: 'failed',
            sdkSessionId: 'sess-gone',
            pendingAskUserAnswer: durable,
            conversationTurns: [
                { role: 'user', content: 'start', timestamp: new Date(), turnIndex: 0, timeline: [] },
            ],
        });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, followUpSuggestions: { enabled: false, count: 3 } });
        await executor.resumePendingAskUser(id);

        const proc = store.processes.get(id)!;
        expect(proc.status).toBe('failed');
        expect(proc.error).toBe(ASK_USER_RESUME_FAILED_MESSAGE);
        // durable answer cleared so a restart can't re-enqueue an endless loop
        expect(proc.pendingAskUserAnswer).toBeUndefined();
    });

    it('AC-04 guard: resuming with no durable answer is an idempotent no-op', async () => {
        const id = 'proc-noop';
        seedProcess(store, { id, status: 'completed', sdkSessionId: 'sess-1' });

        const executor = new CLITaskExecutor(store, { aiService: sdkMocks.service, followUpSuggestions: { enabled: false, count: 3 } });
        await executor.resumePendingAskUser(id);

        expect(sdkMocks.mockSendMessage).not.toHaveBeenCalled();
        expect(store.processes.get(id)?.status).toBe('completed');
    });
});

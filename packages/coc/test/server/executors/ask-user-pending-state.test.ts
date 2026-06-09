import { describe, it, expect, vi } from 'vitest';
import { CLITaskExecutor } from '../../../src/server/queue/queue-executor-bridge';
import { createMockProcessStore } from '../helpers/mock-process-store';
import { createMockSDKService } from '../../helpers/mock-sdk-service';

function makeExecutor(store: ReturnType<typeof createMockProcessStore>): CLITaskExecutor {
    return new CLITaskExecutor(store, {
        aiService: createMockSDKService().service as any,
        followUpSuggestions: { enabled: false, count: 3 },
    });
}

describe('CLITaskExecutor ask-user pending state', () => {
    it('clears persisted pendingAskUser after a successful answer', async () => {
        const store = createMockProcessStore();
        const processId = 'queue_answer';
        await store.addProcess({
            id: processId,
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'test',
            fullPrompt: 'test',
            pendingAskUser: [{
                batchId: 'b1',
                questionId: 'q1',
                question: 'Continue?',
                type: 'confirm',
                turnIndex: 1,
                index: 0,
                batchSize: 1,
            }],
        });

        const executor = makeExecutor(store);
        (executor as any).executors = {
            getAskUserHandles: vi.fn(() => ({
                answerQuestion: vi.fn(() => true),
                skipQuestion: vi.fn(() => false),
                answerQuestions: vi.fn(() => false),
                cancelAll: vi.fn(),
                hasPending: vi.fn(() => true),
            })),
        };

        await expect(executor.answerAskUserQuestion(processId, 'q1', true)).resolves.toBe(true);
        expect(store.processes.get(processId)?.pendingAskUser).toBeUndefined();
    });

    it('clears persisted pendingAskUser after a successful skip', async () => {
        const store = createMockProcessStore();
        const processId = 'queue_skip';
        await store.addProcess({
            id: processId,
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'test',
            fullPrompt: 'test',
            pendingAskUser: [{
                batchId: 'b2',
                questionId: 'q2',
                question: 'Provide details',
                type: 'text',
                turnIndex: 1,
                index: 0,
                batchSize: 1,
            }],
        });

        const executor = makeExecutor(store);
        (executor as any).executors = {
            getAskUserHandles: vi.fn(() => ({
                answerQuestion: vi.fn(() => false),
                skipQuestion: vi.fn(() => true),
                answerQuestions: vi.fn(() => false),
                cancelAll: vi.fn(),
                hasPending: vi.fn(() => true),
            })),
        };

        await expect(executor.skipAskUserQuestion(processId, 'q2')).resolves.toBe(true);
        expect(store.processes.get(processId)?.pendingAskUser).toBeUndefined();
    });

    it('keeps pendingAskUser when no live question handle resolves', async () => {
        const store = createMockProcessStore();
        const processId = 'queue_missing';
        const pendingAskUser = {
            batchId: 'b3',
            questionId: 'q3',
            question: 'Stale?',
            type: 'text' as const,
            turnIndex: 1,
            index: 0,
            batchSize: 1,
        };
        await store.addProcess({
            id: processId,
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'test',
            fullPrompt: 'test',
            pendingAskUser: [pendingAskUser],
        });

        const executor = makeExecutor(store);
        (executor as any).executors = {
            getAskUserHandles: vi.fn(() => ({
                answerQuestion: vi.fn(() => false),
                skipQuestion: vi.fn(() => false),
                answerQuestions: vi.fn(() => false),
                cancelAll: vi.fn(),
                hasPending: vi.fn(() => true),
            })),
        };

        await expect(executor.answerAskUserQuestion(processId, 'q3', 'answer')).resolves.toBe(false);
        expect(store.processes.get(processId)?.pendingAskUser).toEqual([pendingAskUser]);
    });

    it('clears persisted pendingAskUser after a successful batch answer', async () => {
        const store = createMockProcessStore();
        const processId = 'queue_batch';
        await store.addProcess({
            id: processId,
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            promptPreview: 'test',
            fullPrompt: 'test',
            pendingAskUser: [{
                batchId: 'batch-1',
                questionId: 'q1',
                question: 'Continue?',
                type: 'confirm',
                turnIndex: 1,
                index: 0,
                batchSize: 2,
            }, {
                batchId: 'batch-1',
                questionId: 'q2',
                question: 'Why?',
                type: 'text',
                turnIndex: 1,
                index: 1,
                batchSize: 2,
            }],
        });

        const answerQuestions = vi.fn(() => true);
        const executor = makeExecutor(store);
        (executor as any).executors = {
            getAskUserHandles: vi.fn(() => ({
                answerQuestion: vi.fn(() => false),
                skipQuestion: vi.fn(() => false),
                answerQuestions,
                cancelAll: vi.fn(),
                hasPending: vi.fn(() => true),
            })),
        };

        await expect(executor.answerAskUserQuestions(processId, 'batch-1', [
            { questionId: 'q1', answer: true },
            { questionId: 'q2', deferred: true, reason: 'needs-context', note: 'Need more details.' },
        ])).resolves.toBe(true);
        expect(answerQuestions).toHaveBeenCalledWith([
            { questionId: 'q1', answer: true },
            { questionId: 'q2', deferred: true, reason: 'needs-context', note: 'Need more details.' },
        ]);
        expect(store.processes.get(processId)?.pendingAskUser).toBeUndefined();
    });
});

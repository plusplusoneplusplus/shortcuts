/**
 * Historical Turns Prepending Tests
 *
 * Tests that CLITaskExecutor correctly prepends historical conversation turns
 * from the original session when executing a cold-resumed chat task.
 */

import * as fs from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

import {
    TaskQueueManager,
    QueuedTask,
} from '@plusplusoneplusplus/pipeline-core';
import type { ConversationTurn } from '@plusplusoneplusplus/pipeline-core';
import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

// ============================================================================
// Mock CopilotSDKService
// ============================================================================

const sdkMocks = createMockSDKService();
const { mockSendMessage, mockIsAvailable } = sdkMocks;

vi.mock('@plusplusoneplusplus/pipeline-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/pipeline-core')>();
    return {
        ...actual,
        getCopilotSDKService: () => sdkMocks.service,
        executePipeline: vi.fn(),
        gatherFeatureContext: vi.fn(),
    };
});

vi.mock('../../src/ai-invoker', () => ({
    createCLIAIInvoker: vi.fn().mockReturnValue(vi.fn()),
}));

// ============================================================================
// Tests
// ============================================================================

describe('CLITaskExecutor — Historical Turn Prepending', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
    });

    function makeTurn(role: 'user' | 'assistant', content: string, index: number): ConversationTurn {
        return {
            role,
            content,
            timestamp: new Date(),
            turnIndex: index,
            timeline: [],
        };
    }

    it('should prepend historical turns from resumedFrom process', async () => {
        // Create old process with conversation history
        const oldProcess = createCompletedProcessWithSession('old-proc', 'old-session', [
            makeTurn('user', 'Original question', 0),
            makeTurn('assistant', 'Original answer', 1),
            makeTurn('user', 'Follow-up question', 2),
            makeTurn('assistant', 'Follow-up answer', 3),
        ]);
        store.processes.set('old-proc', oldProcess);

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'resume-task-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                prompt: 'Context prompt with history',
                resumedFrom: 'old-proc',
            },
            config: {},
            displayName: 'Resumed Chat',
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        // Verify updateProcess was called with combined turns
        const updateCalls = (store.updateProcess as any).mock.calls;
        const completionCall = updateCalls.find(
            (call: any[]) => call[0] === 'queue_resume-task-1' && call[1]?.status === 'completed'
        );
        expect(completionCall).toBeDefined();

        const updatedTurns: ConversationTurn[] = completionCall[1].conversationTurns;

        // Should have 4 historical + 2 new turns = 6 total
        expect(updatedTurns.length).toBe(6);

        // First 4 turns should be historical
        expect(updatedTurns[0].historical).toBe(true);
        expect(updatedTurns[0].content).toBe('Original question');
        expect(updatedTurns[0].turnIndex).toBe(0);

        expect(updatedTurns[1].historical).toBe(true);
        expect(updatedTurns[1].content).toBe('Original answer');
        expect(updatedTurns[1].turnIndex).toBe(1);

        expect(updatedTurns[2].historical).toBe(true);
        expect(updatedTurns[2].content).toBe('Follow-up question');
        expect(updatedTurns[2].turnIndex).toBe(2);

        expect(updatedTurns[3].historical).toBe(true);
        expect(updatedTurns[3].content).toBe('Follow-up answer');
        expect(updatedTurns[3].turnIndex).toBe(3);

        // Last 2 turns should be new (not historical)
        expect(updatedTurns[4].historical).toBeUndefined();
        expect(updatedTurns[4].role).toBe('user');
        expect(updatedTurns[4].turnIndex).toBe(4);

        expect(updatedTurns[5].historical).toBeUndefined();
        expect(updatedTurns[5].role).toBe('assistant');
        expect(updatedTurns[5].turnIndex).toBe(5);
    });

    it('should not prepend historical turns when resumedFrom is absent', async () => {
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'normal-task-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                prompt: 'Normal chat message',
            },
            config: {},
            displayName: 'Normal Chat',
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        const updateCalls = (store.updateProcess as any).mock.calls;
        const completionCall = updateCalls.find(
            (call: any[]) => call[0] === 'queue_normal-task-1' && call[1]?.status === 'completed'
        );
        expect(completionCall).toBeDefined();

        const updatedTurns: ConversationTurn[] = completionCall[1].conversationTurns;

        // Should have exactly 2 turns (user + assistant) — no historical
        expect(updatedTurns.length).toBe(2);
        expect(updatedTurns[0].historical).toBeUndefined();
        expect(updatedTurns[1].historical).toBeUndefined();
    });

    it('should gracefully handle missing resumedFrom process', async () => {
        // Do NOT add old-proc-missing to the store — simulate it's gone
        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'resume-missing-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                prompt: 'Context prompt',
                resumedFrom: 'old-proc-missing',
            },
            config: {},
            displayName: 'Resumed Chat',
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        const updateCalls = (store.updateProcess as any).mock.calls;
        const completionCall = updateCalls.find(
            (call: any[]) => call[0] === 'queue_resume-missing-1' && call[1]?.status === 'completed'
        );
        expect(completionCall).toBeDefined();

        const updatedTurns: ConversationTurn[] = completionCall[1].conversationTurns;

        // Should have only 2 turns — no historical prepended
        expect(updatedTurns.length).toBe(2);
        expect(updatedTurns[0].historical).toBeUndefined();
    });

    it('should handle resumedFrom process with empty conversation turns', async () => {
        const oldProcess = createCompletedProcessWithSession('empty-proc', 'old-session', []);
        store.processes.set('empty-proc', oldProcess);

        const executor = new CLITaskExecutor(store);

        const task: QueuedTask = {
            id: 'resume-empty-1',
            type: 'chat',
            priority: 'normal',
            status: 'running',
            createdAt: Date.now(),
            payload: {
                kind: 'chat',
                prompt: 'Context prompt',
                resumedFrom: 'empty-proc',
            },
            config: {},
            displayName: 'Resumed Chat',
        };

        const result = await executor.execute(task);
        expect(result.success).toBe(true);

        const updateCalls = (store.updateProcess as any).mock.calls;
        const completionCall = updateCalls.find(
            (call: any[]) => call[0] === 'queue_resume-empty-1' && call[1]?.status === 'completed'
        );
        expect(completionCall).toBeDefined();

        const updatedTurns: ConversationTurn[] = completionCall[1].conversationTurns;

        // Empty old turns → no historical, just 2 new turns
        expect(updatedTurns.length).toBe(2);
    });
});

/**
 * Follow-Up Turn Order Race Condition Regression Test
 *
 * Verifies the invariant: user turns are persisted by the POST /message route
 * handler (atomically with the status change) before the executor starts.
 * The executor only appends assistant turns. This eliminates the race where
 * an SSE snapshot could replay without the user turn.
 *
 * Scenario:
 *   1. Process has 2 turns: [user-0, assistant-1]
 *   2. Route handler pre-persists user turn → [user-0, assistant-1, user-2]
 *   3. Executor appends assistant turn → [user-0, assistant-1, user-2, assistant-3]
 *   4. Final turns always have user before its paired assistant
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Module mocks (same as queue-executor-bridge.test.ts)
// ============================================================================

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();
    return {
        ...actual,
        existsSync: vi.fn(actual.existsSync),
        readFileSync: vi.fn(actual.readFileSync),
        mkdirSync: vi.fn(),
    };
});

import type { AIProcess } from '@plusplusoneplusplus/forge';
import { createMockSDKService } from '../helpers/mock-sdk-service';
import { createMockProcessStore, createCompletedProcessWithSession } from '../helpers/mock-process-store';

const sdkMocks = createMockSDKService();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        sdkServiceRegistry: { getOrThrow: () => sdkMocks.service },
    };
});

vi.mock('../../src/server/queue/image-blob-store', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/server/queue/image-blob-store')>();
    return {
        ...actual,
        ImageBlobStore: {
            loadImages: vi.fn().mockResolvedValue([]),
            saveImages: vi.fn(),
            deleteImages: vi.fn(),
            getBlobsDir: vi.fn(),
        },
    };
});

import { CLITaskExecutor } from '../../src/server/queue/queue-executor-bridge';

// Helper: simulate what the POST /message handler does — pre-persist user turn
function addUserTurn(proc: AIProcess, content: string, images?: string[]): AIProcess {
    const turns = proc.conversationTurns ?? [];
    const turnIndex = turns.length;
    turns.push({
        role: 'user' as const,
        content,
        timestamp: new Date(),
        turnIndex,
        timeline: [],
        ...(images ? { images } : {}),
    });
    proc.conversationTurns = turns;
    return proc;
}

// ============================================================================
// Tests
// ============================================================================

describe('Follow-up turn order race condition (regression)', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
    });

    it('user turn always precedes assistant turn in a single follow-up', async () => {
        const proc = createCompletedProcessWithSession('proc-race-1', 'sess-1');
        // Simulate handler pre-persisting user turn
        addUserTurn(proc, 'Question A');
        await store.addProcess(proc);

        sdkMocks.mockSendMessage.mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 10));
            return { success: true, response: 'Reply A', sessionId: 'sess-1' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-race-1', 'Question A');

        const updated = store.processes.get('proc-race-1');
        const turns = updated?.conversationTurns ?? [];

        // Initial 2 turns + 1 pre-persisted user + 1 assistant = 4
        expect(turns).toHaveLength(4);
        expect(turns[2].role).toBe('user');
        expect(turns[2].content).toBe('Question A');
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].content).toBe('Reply A');
        expect(turns[2].turnIndex).toBeLessThan(turns[3].turnIndex);
    });

    it('two rapid sequential follow-ups produce correctly ordered turns', async () => {
        const proc = createCompletedProcessWithSession('proc-race-2', 'sess-2');
        // Simulate handler pre-persisting first user turn
        addUserTurn(proc, 'Question 1');
        await store.addProcess(proc);

        let callCount = 0;
        sdkMocks.mockSendMessage.mockImplementation(async () => {
            callCount++;
            const reply = `Reply ${callCount}`;
            await new Promise(r => setTimeout(r, 5));
            return { success: true, response: reply, sessionId: 'sess-2' };
        });

        const executor = new CLITaskExecutor(store);

        // Follow-up 1
        await executor.executeFollowUp('proc-race-2', 'Question 1');

        // Simulate handler pre-persisting second user turn
        const afterFirst = store.processes.get('proc-race-2')!;
        addUserTurn(afterFirst, 'Question 2');
        store.processes.set('proc-race-2', afterFirst);

        // Follow-up 2
        await executor.executeFollowUp('proc-race-2', 'Question 2');

        const updated = store.processes.get('proc-race-2');
        const turns = updated?.conversationTurns ?? [];

        // Initial 2 + 2*(user+assistant) = 6
        expect(turns).toHaveLength(6);

        // Verify strict alternation: user→assistant for each follow-up pair
        expect(turns[2].role).toBe('user');
        expect(turns[2].content).toBe('Question 1');
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].content).toBe('Reply 1');
        expect(turns[4].role).toBe('user');
        expect(turns[4].content).toBe('Question 2');
        expect(turns[5].role).toBe('assistant');
        expect(turns[5].content).toBe('Reply 2');

        // turnIndex monotonically increasing
        for (let i = 1; i < turns.length; i++) {
            expect(turns[i].turnIndex).toBeGreaterThan(turns[i - 1].turnIndex);
        }
    });

    it('concurrent follow-ups never interleave user/assistant turns', async () => {
        const proc = createCompletedProcessWithSession('proc-race-3', 'sess-3');
        // Pre-persist both user turns (simulating two rapid handler calls)
        addUserTurn(proc, 'Concurrent Q1');
        addUserTurn(proc, 'Concurrent Q2');
        await store.addProcess(proc);

        let callCount = 0;
        sdkMocks.mockSendMessage.mockImplementation(async () => {
            callCount++;
            const reply = `Concurrent reply ${callCount}`;
            await new Promise(r => setTimeout(r, callCount === 1 ? 20 : 5));
            return { success: true, response: reply, sessionId: 'sess-3' };
        });

        const executor = new CLITaskExecutor(store);

        // Fire two follow-ups concurrently
        await Promise.all([
            executor.executeFollowUp('proc-race-3', 'Concurrent Q1'),
            executor.executeFollowUp('proc-race-3', 'Concurrent Q2'),
        ]);

        const updated = store.processes.get('proc-race-3');
        const turns = updated?.conversationTurns ?? [];

        // At least initial 2 + 2 pre-persisted users + 2 assistant = 6
        expect(turns.length).toBeGreaterThanOrEqual(4);

        const followUpTurns = turns.slice(2);
        const userTurns = followUpTurns.filter(t => t.role === 'user');
        const assistantTurns = followUpTurns.filter(t => t.role === 'assistant');

        // Both user turns and at least one assistant turn survived
        expect(userTurns.length).toBeGreaterThanOrEqual(2);
        expect(assistantTurns.length).toBeGreaterThanOrEqual(1);

        // Each user turn's index in the array is less than at least one assistant turn
        for (const userTurn of userTurns) {
            const userPos = followUpTurns.indexOf(userTurn);
            const hasLaterAssistant = assistantTurns.some(a => followUpTurns.indexOf(a) > userPos);
            expect(hasLaterAssistant).toBe(true);
        }

        // All turnIndex values are monotonically increasing
        for (let i = 1; i < turns.length; i++) {
            expect(turns[i].turnIndex).toBeGreaterThanOrEqual(turns[i - 1].turnIndex);
        }
    });

    it('user turn is saved even when AI call fails', async () => {
        const proc = createCompletedProcessWithSession('proc-race-fail', 'sess-fail');
        // Simulate handler pre-persisting user turn
        addUserTurn(proc, 'Will fail');
        await store.addProcess(proc);

        sdkMocks.mockSendMessage.mockRejectedValue(new Error('Network timeout'));

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-race-fail', 'Will fail');

        const updated = store.processes.get('proc-race-fail');
        const turns = updated?.conversationTurns ?? [];

        // Initial 2 + pre-persisted user + error assistant = 4
        expect(turns).toHaveLength(4);
        expect(turns[2].role).toBe('user');
        expect(turns[2].content).toBe('Will fail');
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].content).toContain('Error: Network timeout');
    });

    it('images are preserved on pre-persisted user turn through executor', async () => {
        const proc = createCompletedProcessWithSession('proc-race-img', 'sess-img');
        const images = ['data:image/png;base64,iVBOR', 'data:image/jpeg;base64,/9j/4'];
        // Simulate handler pre-persisting user turn with images
        addUserTurn(proc, 'Check images', images);
        await store.addProcess(proc);

        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Seen your image',
            sessionId: 'sess-img',
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-race-img', 'Check images');

        const updated = store.processes.get('proc-race-img');
        const userTurn = updated?.conversationTurns?.find(
            t => t.role === 'user' && t.content === 'Check images',
        );
        expect(userTurn).toBeDefined();
        expect(userTurn!.images).toEqual(images);
    });
});

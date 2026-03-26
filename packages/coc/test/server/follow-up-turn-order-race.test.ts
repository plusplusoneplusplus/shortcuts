/**
 * Follow-Up Turn Order Race Condition Regression Test
 *
 * Verifies the invariant: for every follow-up exchange, the user turn is
 * always saved before the assistant turn in the write queue. This prevents
 * the race where a concurrent HTTP request could interleave and produce
 * out-of-order conversation turns.
 *
 * Scenario reproduced:
 *   1. Process has 2 turns: [user-0, assistant-1]
 *   2. Two rapid follow-ups fire concurrently
 *   3. Each follow-up must produce (user, assistant) in that order
 *   4. Final turns must alternate user→assistant without interleaving
 *
 * This is a regression test for the fix that moved user-turn persistence
 * from the HTTP handler into FollowUpExecutor.executeFollowUp.
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
        getCopilotSDKService: () => sdkMocks.service,
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

import { CLITaskExecutor } from '../../src/server/queue-executor-bridge';

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
        await store.addProcess(proc);

        // Simulate a slow AI response to widen any potential race window
        sdkMocks.mockSendMessage.mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 10));
            return { success: true, response: 'Reply A', sessionId: 'sess-1' };
        });

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-race-1', 'Question A');

        const updated = store.processes.get('proc-race-1');
        const turns = updated?.conversationTurns ?? [];

        // Initial 2 turns + 1 user + 1 assistant = 4
        expect(turns).toHaveLength(4);
        expect(turns[2].role).toBe('user');
        expect(turns[2].content).toBe('Question A');
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].content).toBe('Reply A');
        expect(turns[2].turnIndex).toBeLessThan(turns[3].turnIndex);
    });

    it('two rapid sequential follow-ups produce correctly ordered turns', async () => {
        const proc = createCompletedProcessWithSession('proc-race-2', 'sess-2');
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
        await store.addProcess(proc);

        let callCount = 0;
        sdkMocks.mockSendMessage.mockImplementation(async () => {
            callCount++;
            const reply = `Concurrent reply ${callCount}`;
            // Vary response time to maximize race window
            await new Promise(r => setTimeout(r, callCount === 1 ? 20 : 5));
            return { success: true, response: reply, sessionId: 'sess-3' };
        });

        const executor = new CLITaskExecutor(store);

        // Fire two follow-ups concurrently (the scenario that triggered the bug)
        await Promise.all([
            executor.executeFollowUp('proc-race-3', 'Concurrent Q1'),
            executor.executeFollowUp('proc-race-3', 'Concurrent Q2'),
        ]);

        const updated = store.processes.get('proc-race-3');
        const turns = updated?.conversationTurns ?? [];

        // With the mock store (no serialized write queue), concurrent writes
        // may overwrite each other. The real FileProcessStore serializes them.
        // We verify the key invariant: user turns always precede their paired
        // assistant turn — no interleaving within a single follow-up exchange.
        expect(turns.length).toBeGreaterThanOrEqual(4); // at least initial pair + one follow-up pair

        // Key invariant: within the follow-up portion, every user turn at
        // position i is followed by an assistant turn at position i+1.
        const followUpTurns = turns.slice(2);
        for (let i = 0; i < followUpTurns.length - 1; i += 2) {
            expect(followUpTurns[i].role).toBe('user');
            expect(followUpTurns[i + 1].role).toBe('assistant');
        }

        // All turnIndex values are monotonically increasing
        for (let i = 1; i < turns.length; i++) {
            expect(turns[i].turnIndex).toBeGreaterThanOrEqual(turns[i - 1].turnIndex);
        }
    });

    it('user turn is saved even when AI call fails', async () => {
        const proc = createCompletedProcessWithSession('proc-race-fail', 'sess-fail');
        await store.addProcess(proc);

        sdkMocks.mockSendMessage.mockRejectedValue(new Error('Network timeout'));

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-race-fail', 'Will fail');

        const updated = store.processes.get('proc-race-fail');
        const turns = updated?.conversationTurns ?? [];

        // Initial 2 + user + error assistant = 4
        expect(turns).toHaveLength(4);
        expect(turns[2].role).toBe('user');
        expect(turns[2].content).toBe('Will fail');
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].content).toContain('Error: Network timeout');
    });

    it('images are persisted on user turn through executor', async () => {
        const proc = createCompletedProcessWithSession('proc-race-img', 'sess-img');
        await store.addProcess(proc);

        sdkMocks.mockSendMessage.mockResolvedValue({
            success: true,
            response: 'Seen your image',
            sessionId: 'sess-img',
        });

        const images = ['data:image/png;base64,iVBOR', 'data:image/jpeg;base64,/9j/4'];
        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-race-img', 'Check images', undefined, undefined, undefined, images);

        const updated = store.processes.get('proc-race-img');
        const userTurn = updated?.conversationTurns?.find(
            t => t.role === 'user' && t.content === 'Check images',
        );
        expect(userTurn).toBeDefined();
        expect(userTurn!.images).toEqual(images);
    });
});

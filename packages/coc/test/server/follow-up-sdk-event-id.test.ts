/**
 * Follow-up sdkEventId capture (AC-01)
 *
 * The copilot-sdk `user.message` event id captured during streaming is surfaced
 * on the SDK invocation result as `userMessageEventId`. These tests verify the
 * follow-up executor threads it back onto the user turn that produced the
 * exchange (the turn immediately preceding the assistant turn) — the durable
 * anchor used later to rewind/truncate the conversation. When the SDK result
 * carries no event id (e.g. non-copilot providers), the user turn's `sdkEventId`
 * stays undefined and no update is attempted.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================================
// Module mocks (same shape as follow-up-turn-order-race.test.ts)
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

// Helper: simulate what the POST /message handler does — pre-persist the user turn
function addUserTurn(proc: AIProcess, content: string): AIProcess {
    const turns = proc.conversationTurns ?? [];
    const turnIndex = turns.length;
    turns.push({
        role: 'user' as const,
        content,
        timestamp: new Date(),
        turnIndex,
        timeline: [],
    });
    proc.conversationTurns = turns;
    return proc;
}

// ============================================================================
// Tests
// ============================================================================

describe('Follow-up sdkEventId capture (AC-01)', () => {
    let store: ReturnType<typeof createMockProcessStore>;

    beforeEach(() => {
        store = createMockProcessStore();
        sdkMocks.resetAll();
    });

    it('persists userMessageEventId onto the preceding user turn', async () => {
        const proc = createCompletedProcessWithSession('proc-evt-1', 'sess-1');
        addUserTurn(proc, 'Question A');
        await store.addProcess(proc);

        sdkMocks.mockSendMessage.mockImplementation(async () => ({
            success: true,
            response: 'Reply A',
            sessionId: 'sess-1',
            userMessageEventId: 'evt_user_A',
        }));

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-evt-1', 'Question A');

        const turns = store.processes.get('proc-evt-1')?.conversationTurns ?? [];
        // Initial 2 turns + 1 pre-persisted user + 1 assistant = 4
        expect(turns).toHaveLength(4);
        expect(turns[2].role).toBe('user');
        expect(turns[2].sdkEventId).toBe('evt_user_A');
        // The assistant turn never carries an event id.
        expect(turns[3].role).toBe('assistant');
        expect(turns[3].sdkEventId).toBeUndefined();
        // The update targets the user turn (index 2 = assistant index 3 - 1).
        expect(store.updateTurnSdkEventId).toHaveBeenCalledWith('proc-evt-1', 2, 'evt_user_A');
    });

    it('leaves sdkEventId undefined when the SDK result carries no event id', async () => {
        const proc = createCompletedProcessWithSession('proc-evt-2', 'sess-2');
        addUserTurn(proc, 'Question B');
        await store.addProcess(proc);

        sdkMocks.mockSendMessage.mockImplementation(async () => ({
            success: true,
            response: 'Reply B',
            sessionId: 'sess-2',
        }));

        const executor = new CLITaskExecutor(store);
        await executor.executeFollowUp('proc-evt-2', 'Question B');

        const turns = store.processes.get('proc-evt-2')?.conversationTurns ?? [];
        expect(turns[2].role).toBe('user');
        expect(turns[2].sdkEventId).toBeUndefined();
        expect(store.updateTurnSdkEventId).not.toHaveBeenCalled();
    });
});

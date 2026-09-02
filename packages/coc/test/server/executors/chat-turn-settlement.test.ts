/**
 * Covers how a chat turn finishes:
 * - cumulative token usage accumulates counters but replaces session gauges
 * - optional counters (cost / actualUsdCost / duration) stay undefined until a
 *   provider reports them, rather than being pinned to 0
 * - session gauges fall back to the persisted value when a turn omits one
 * - the turn-end token-usage event carries cumulative usage and a cost estimate
 * - note-edit snapshots are written only on a real change, and are truncated
 *   past the size limit
 * - both side-effecting helpers are non-fatal
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockReadNoteContent = vi.hoisted(() => vi.fn());
const mockAppendNoteEditSnapshot = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockBuildLiveConversationCostEstimate = vi.hoisted(() => vi.fn().mockReturnValue({ totalUsd: 1.5 }));

vi.mock('../../../src/server/executors/note-chat-executor', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/executors/note-chat-executor')>();
    return {
        ...actual,
        readNoteContent: mockReadNoteContent,
        appendNoteEditSnapshot: mockAppendNoteEditSnapshot,
    };
});

vi.mock('../../../src/server/processes/process-metadata-read-model', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../src/server/processes/process-metadata-read-model')>();
    return { ...actual, buildLiveConversationCostEstimate: mockBuildLiveConversationCostEstimate };
});

import type { ProcessStore, TokenUsage } from '@plusplusoneplusplus/forge';
import { SNAPSHOT_SIZE_LIMIT } from '../../../src/server/executors/note-chat-executor';
import {
    buildCumulativeTokenUsage,
    buildSessionTokenUpdates,
    captureNoteEditSnapshot,
    emitTurnTokenUsage,
} from '../../../src/server/executors/chat-turn-settlement';

// ============================================================================
// Fixtures
// ============================================================================

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
    return {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 5,
        cacheWriteTokens: 3,
        totalTokens: 128,
        turnCount: 1,
        ...overrides,
    } as TokenUsage;
}

function fakeStore(overrides: Partial<ProcessStore> = {}): ProcessStore & {
    emitted: unknown[];
} {
    const emitted: unknown[] = [];
    return {
        emitted,
        emitProcessEvent: (_id: string, event: unknown) => { emitted.push(event); },
        getProcess: async () => ({ id: 'p1', cumulativeTokenUsage: usage({ totalTokens: 999 }) }),
        ...overrides,
    } as unknown as ProcessStore & { emitted: unknown[] };
}

beforeEach(() => {
    mockReadNoteContent.mockReset();
    mockAppendNoteEditSnapshot.mockReset().mockResolvedValue(undefined);
    mockBuildLiveConversationCostEstimate.mockReset().mockReturnValue({ totalUsd: 1.5 });
});

// ============================================================================
// Cumulative token usage
// ============================================================================

describe('buildCumulativeTokenUsage', () => {
    it('returns the previous total unchanged when the turn reported no usage', () => {
        const previous = usage({ totalTokens: 500 });
        expect(buildCumulativeTokenUsage(previous, undefined)).toBe(previous);
        expect(buildCumulativeTokenUsage(undefined, undefined)).toBeUndefined();
    });

    it('seeds the total from the first turn when there is no previous total', () => {
        const result = buildCumulativeTokenUsage(undefined, usage());

        expect(result).toMatchObject({
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 5,
            cacheWriteTokens: 3,
            totalTokens: 128,
            turnCount: 1,
        });
    });

    it('accumulates counters across turns', () => {
        const first = buildCumulativeTokenUsage(undefined, usage());
        const second = buildCumulativeTokenUsage(first, usage({ inputTokens: 50, totalTokens: 70, turnCount: 1 }));

        expect(second).toMatchObject({
            inputTokens: 150,
            totalTokens: 198,
            turnCount: 2,
        });
    });

    it('leaves cost undefined until a provider reports it, then accumulates', () => {
        const noCost = buildCumulativeTokenUsage(undefined, usage());
        expect(noCost?.cost).toBeUndefined();
        expect(noCost?.actualUsdCost).toBeUndefined();
        expect(noCost?.duration).toBeUndefined();

        const withCost = buildCumulativeTokenUsage(noCost, usage({ cost: 2, actualUsdCost: 0.5, duration: 1000 }));
        expect(withCost).toMatchObject({ cost: 2, actualUsdCost: 0.5, duration: 1000 });

        const more = buildCumulativeTokenUsage(withCost, usage({ cost: 3, actualUsdCost: 0.25, duration: 500 }));
        expect(more).toMatchObject({ cost: 5, actualUsdCost: 0.75, duration: 1500 });
    });

    it('preserves a previously-reported cost when a later turn omits it', () => {
        const withCost = buildCumulativeTokenUsage(undefined, usage({ cost: 4 }));
        const afterSilentTurn = buildCumulativeTokenUsage(withCost, usage());

        expect(afterSilentTurn?.cost).toBe(4);
    });

    it('replaces session gauges with the latest reading instead of summing them', () => {
        const first = buildCumulativeTokenUsage(undefined, usage({ tokenLimit: 200_000, currentTokens: 1_000 }));
        const second = buildCumulativeTokenUsage(first, usage({ tokenLimit: 200_000, currentTokens: 4_000 }));

        expect(second).toMatchObject({ tokenLimit: 200_000, currentTokens: 4_000 });
    });

    it('keeps the last known gauge when a turn omits it', () => {
        const first = buildCumulativeTokenUsage(undefined, usage({ currentTokens: 4_000, systemTokens: 900 }));
        const second = buildCumulativeTokenUsage(first, usage());

        expect(second).toMatchObject({ currentTokens: 4_000, systemTokens: 900 });
    });
});

// ============================================================================
// Session gauge updates
// ============================================================================

describe('buildSessionTokenUpdates', () => {
    it('takes this turn\'s gauges when reported', () => {
        const updates = buildSessionTokenUpdates(
            { tokenLimit: 100, currentTokens: 10 },
            usage({ tokenLimit: 200_000, currentTokens: 5_000, systemTokens: 800 }),
        );

        expect(updates).toEqual({ tokenLimit: 200_000, currentTokens: 5_000, systemTokens: 800 });
    });

    it('falls back to the persisted gauge so an omitted reading does not blank the meter', () => {
        const updates = buildSessionTokenUpdates(
            { tokenLimit: 200_000, currentTokens: 5_000 },
            usage(),
        );

        expect(updates).toEqual({ tokenLimit: 200_000, currentTokens: 5_000 });
    });

    it('omits gauges neither the turn nor the process knows about', () => {
        expect(buildSessionTokenUpdates({}, undefined)).toEqual({});
    });
});

// ============================================================================
// Turn-end token usage event
// ============================================================================

describe('emitTurnTokenUsage', () => {
    it('emits nothing when the turn reported no usage', async () => {
        const store = fakeStore();
        await emitTurnTokenUsage({
            store, processId: 'p1', turnIndex: 2, tokenUsage: undefined, allTurns: [], logLabel: '[Test]',
        });

        expect(store.emitted).toEqual([]);
    });

    it('emits cumulative usage, session gauges, and the live cost estimate', async () => {
        const store = fakeStore();
        await emitTurnTokenUsage({
            store,
            processId: 'p1',
            workspaceId: 'ws-1',
            turnIndex: 3,
            tokenUsage: usage({ tokenLimit: 200_000, currentTokens: 7_000, systemTokens: 800, conversationTokens: 6_000 }),
            allTurns: [],
            logLabel: '[Test]',
        });

        expect(store.emitted).toHaveLength(1);
        expect(store.emitted[0]).toMatchObject({
            type: 'token-usage',
            turnIndex: 3,
            sessionTokenLimit: 200_000,
            sessionCurrentTokens: 7_000,
            sessionSystemTokens: 800,
            sessionConversationTokens: 6_000,
            cumulativeTokenUsage: expect.objectContaining({ totalTokens: 999 }),
            conversationCostEstimate: { totalUsd: 1.5 },
        });
        // Omitted gauges are dropped rather than emitted as undefined.
        expect(store.emitted[0]).not.toHaveProperty('sessionToolTokens');
    });

    it('does not fail the turn when the store read throws', async () => {
        const store = fakeStore({ getProcess: async () => { throw new Error('store down'); } });

        await expect(emitTurnTokenUsage({
            store, processId: 'p1', turnIndex: 1, tokenUsage: usage(), allTurns: [], logLabel: '[Test]',
        })).resolves.toBeUndefined();
    });
});

// ============================================================================
// Note edit snapshot
// ============================================================================

describe('captureNoteEditSnapshot', () => {
    const base = {
        processId: 'p1',
        dataDir: '/data',
        workspaceId: 'ws-1',
        notePath: 'Notes/a.md',
        turnIndex: 4,
        logLabel: '[Test]',
    };

    it('writes a snapshot when the note changed', async () => {
        const store = fakeStore();
        mockReadNoteContent.mockResolvedValue('after');

        await captureNoteEditSnapshot({ ...base, store, preEditContent: 'before' });

        expect(mockAppendNoteEditSnapshot).toHaveBeenCalledTimes(1);
        expect(mockAppendNoteEditSnapshot.mock.calls[0][2]).toMatchObject({
            editId: 'p1-4',
            notePath: 'Notes/a.md',
            preEditContent: 'before',
            postEditContent: 'after',
            turnIndex: 4,
        });
        expect(mockAppendNoteEditSnapshot.mock.calls[0][2]).not.toHaveProperty('tooLarge');
    });

    it('writes nothing when the note is unchanged', async () => {
        mockReadNoteContent.mockResolvedValue('same');

        await captureNoteEditSnapshot({ ...base, store: fakeStore(), preEditContent: 'same' });

        expect(mockAppendNoteEditSnapshot).not.toHaveBeenCalled();
    });

    it('writes nothing when the note cannot be read back', async () => {
        mockReadNoteContent.mockResolvedValue(undefined);

        await captureNoteEditSnapshot({ ...base, store: fakeStore(), preEditContent: 'before' });

        expect(mockAppendNoteEditSnapshot).not.toHaveBeenCalled();
    });

    it('records an oversized diff as tooLarge with empty bodies so the record stays bounded', async () => {
        mockReadNoteContent.mockResolvedValue('x'.repeat(SNAPSHOT_SIZE_LIMIT + 1));

        await captureNoteEditSnapshot({ ...base, store: fakeStore(), preEditContent: 'before' });

        expect(mockAppendNoteEditSnapshot.mock.calls[0][2]).toMatchObject({
            tooLarge: true,
            preEditContent: '',
            postEditContent: '',
        });
    });

    it('does not fail the turn when the snapshot write throws', async () => {
        mockReadNoteContent.mockResolvedValue('after');
        mockAppendNoteEditSnapshot.mockRejectedValue(new Error('disk full'));

        await expect(captureNoteEditSnapshot({
            ...base, store: fakeStore(), preEditContent: 'before',
        })).resolves.toBeUndefined();
    });
});

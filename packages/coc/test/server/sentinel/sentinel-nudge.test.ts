import type { AIProcess } from '@plusplusoneplusplus/forge';
import { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { describe, expect, it, vi } from 'vitest';
import {
    applyApprovedSentinelNudges,
    buildSentinelNudgeDraft,
    createSentinelNudgeExecutor,
} from '../../../src/server/sentinel/sentinel-nudge';
import {
    createSentinelWatchlist,
    type SentinelWatchlistEntry,
} from '../../../src/server/sentinel/sentinel-watchlist';
import { createMockProcessStore } from '../../helpers/mock-process-store';

const NOW = new Date('2026-09-16T21:00:00.000Z');
const HOUR_MS = 60 * 60 * 1_000;

function makeProcess(id: string, overrides: Partial<AIProcess> = {}): AIProcess {
    return {
        id,
        type: 'chat',
        promptPreview: id,
        fullPrompt: id,
        status: 'completed',
        startTime: new Date('2026-09-16T19:00:00.000Z'),
        metadata: { type: 'chat', mode: 'ask', workspaceId: 'workspace-a' },
        ...overrides,
    };
}

function makeEntry(overrides: Partial<SentinelWatchlistEntry> = {}): SentinelWatchlistEntry {
    return {
        processId: 'chat-a',
        bucket: 'loose-ends',
        disposition: 'watching',
        reason: 'A promised follow-up remains.',
        nudgeCount: 0,
        addedAt: NOW.toISOString(),
        ...overrides,
    };
}

describe('Sentinel nudge policy', () => {
    it('stops drafting when the budget is exhausted', () => {
        expect(buildSentinelNudgeDraft(
            makeEntry({ nudgeCount: 3 }),
            makeProcess('chat-a'),
            { now: NOW, tickWindowMs: HOUR_MS, maxNudges: 3 },
        )).toBeUndefined();
    });

    it('does not draft twice inside one tick window', () => {
        expect(buildSentinelNudgeDraft(
            makeEntry({ lastNudgedAt: '2026-09-16T20:30:00.000Z' }),
            makeProcess('chat-a'),
            { now: NOW, tickWindowMs: HOUR_MS },
        )).toBeUndefined();
    });

    it('backs off exponentially after repeated nudges', () => {
        const entry = makeEntry({
            nudgeCount: 1,
            lastNudgedAt: '2026-09-16T19:30:00.000Z',
        });
        expect(buildSentinelNudgeDraft(
            entry,
            makeProcess('chat-a'),
            { now: NOW, tickWindowMs: HOUR_MS },
        )).toBeUndefined();
        expect(buildSentinelNudgeDraft(
            { ...entry, lastNudgedAt: '2026-09-16T19:00:00.000Z' },
            makeProcess('chat-a'),
            { now: NOW, tickWindowMs: HOUR_MS },
        )).toEqual(expect.objectContaining({ action: 'follow-up' }));
    });

    it('drafts a fresh chat past the resumability age cutoff', () => {
        expect(buildSentinelNudgeDraft(
            makeEntry(),
            makeProcess('chat-a', { lastEventAt: new Date('2026-08-01T00:00:00.000Z') }),
            { now: NOW, tickWindowMs: HOUR_MS, resumeMaxAgeMs: 30 * 24 * HOUR_MS },
        )).toEqual(expect.objectContaining({
            processId: 'chat-a',
            action: 'fresh-chat',
        }));
    });

    it('increments counters only after an approved nudge succeeds', async () => {
        const watchlist = {
            ...createSentinelWatchlist('sentinel-a', NOW),
            entries: [makeEntry()],
        };
        const execute = vi.fn().mockResolvedValue(undefined);

        const result = await applyApprovedSentinelNudges(
            watchlist,
            [makeProcess('chat-a')],
            new Set(['chat-a']),
            { now: NOW, tickWindowMs: HOUR_MS },
            execute,
        );

        expect(execute).toHaveBeenCalledOnce();
        expect(result.entries[0]).toEqual(expect.objectContaining({
            disposition: 'nudged',
            nudgeCount: 1,
            lastNudgedAt: NOW.toISOString(),
        }));
    });
});

describe('Sentinel nudge execution', () => {
    it('enqueues an approved follow-up into the target chat', async () => {
        const store = createMockProcessStore({
            initialProcesses: [makeProcess('chat-a')],
        });
        const queueManager = new TaskQueueManager();
        const execute = createSentinelNudgeExecutor({
            workspaceId: 'workspace-a',
            sentinelProcessId: 'sentinel-a',
            processStore: store,
            queueManager,
        });

        await execute({
            processId: 'chat-a',
            action: 'follow-up',
            message: 'Please continue.',
        });

        expect(queueManager.getQueued()).toEqual([
            expect.objectContaining({
                processId: 'chat-a',
                repoId: 'workspace-a',
                payload: expect.objectContaining({
                    processId: 'chat-a',
                    mode: 'ask',
                    prompt: 'Please continue.',
                }),
            }),
        ]);
    });

    it('starts an Ask chat referencing an old target', async () => {
        const store = createMockProcessStore({
            initialProcesses: [makeProcess('chat-old', { title: 'Old work' })],
        });
        const queueManager = new TaskQueueManager();
        const execute = createSentinelNudgeExecutor({
            workspaceId: 'workspace-a',
            sentinelProcessId: 'sentinel-a',
            processStore: store,
            queueManager,
        });

        await execute({
            processId: 'chat-old',
            action: 'fresh-chat',
            message: 'Please continue.',
        });

        expect(queueManager.getQueued()).toEqual([
            expect.objectContaining({
                repoId: 'workspace-a',
                payload: expect.objectContaining({
                    mode: 'ask',
                    prompt: expect.stringContaining('/activity/chat-old'),
                    context: { spawnedFromProcessId: 'sentinel-a' },
                }),
            }),
        ]);
    });

    it('buffers an approved nudge while the target has an active turn', async () => {
        const store = createMockProcessStore({
            initialProcesses: [makeProcess('chat-a', { status: 'running' })],
        });
        const queueManager = new TaskQueueManager();
        const execute = createSentinelNudgeExecutor({
            workspaceId: 'workspace-a',
            sentinelProcessId: 'sentinel-a',
            processStore: store,
            queueManager,
        });

        await execute({
            processId: 'chat-a',
            action: 'follow-up',
            message: 'Please continue.',
        });

        expect(queueManager.getQueued()).toEqual([]);
        await expect(store.getProcess('chat-a')).resolves.toEqual(expect.objectContaining({
            pendingMessages: [expect.objectContaining({
                content: 'Please continue.',
                mode: 'ask',
            })],
        }));
    });
});

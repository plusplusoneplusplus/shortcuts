import { describe, expect, it } from 'vitest';
import { rankMemoryCandidates } from '../../src/memory/memory-candidate-ranking';
import type { MemoryCandidate } from '../../src/memory/memory-candidate-types';

function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
    return {
        id: 'candidate-1',
        target: 'repo',
        content: 'User prefers durable memory gates',
        contentHash: 'hash-1',
        source: 'test',
        workspaceId: 'ws-test',
        processId: 'proc-1',
        turnIndex: 1,
        createdAt: '2026-05-01T00:00:00.000Z',
        lastSeenAt: '2026-05-01T00:00:00.000Z',
        signalCount: 3,
        totalScore: 3,
        maxScore: 1,
        uniqueProcessCount: 2,
        recallDays: ['2026-04-30', '2026-05-01'],
        conceptTags: ['preference', 'memory'],
        explicitMemoryIntent: false,
        status: 'pending',
        promotedAt: null,
        droppedAt: null,
        droppedReason: null,
        ...overrides,
    };
}

describe('rankMemoryCandidates with promotion gates', () => {
    it('requires the configured score, recall count, and unique-query gates', () => {
        const [ranked] = rankMemoryCandidates([makeCandidate()], {
            now: '2026-05-01T00:00:00.000Z',
            policy: {
                minScore: 0.75,
                minRecallCount: 3,
                minUniqueQueries: 2,
            },
        });

        expect(ranked.score).toBeGreaterThanOrEqual(0.75);
        expect(ranked.selected).toBe(true);
    });

    it('leaves otherwise high-score candidates unselected until recall and diversity gates are met', () => {
        const [ranked] = rankMemoryCandidates([
            makeCandidate({
                signalCount: 2,
                totalScore: 2,
                uniqueProcessCount: 1,
                recallDays: ['2026-05-01'],
            }),
        ], {
            now: '2026-05-01T00:00:00.000Z',
            policy: {
                minScore: 0.5,
                minRecallCount: 3,
                minUniqueQueries: 2,
            },
        });

        expect(ranked.score).toBeGreaterThanOrEqual(0.5);
        expect(ranked.selected).toBe(false);
    });

    it('keeps backward-compatible minSignalCount and minDiversity policy aliases', () => {
        const [ranked] = rankMemoryCandidates([makeCandidate()], {
            now: '2026-05-01T00:00:00.000Z',
            policy: {
                minScore: 0.75,
                minSignalCount: 3,
                minDiversity: 2,
            },
        });

        expect(ranked.selected).toBe(true);
    });
});

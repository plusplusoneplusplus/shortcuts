/**
 * Memory candidate ranking tests.
 *
 * Verifies that candidate promotion can be ranked and selected deterministically
 * from stored metadata without an AI call.
 */

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_MEMORY_CANDIDATE_SELECTION_POLICY,
    rankMemoryCandidates,
} from '../../src/memory/memory-candidate-ranking';
import type { MemoryCandidate } from '../../src/memory/memory-candidate-types';

function makeCandidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
    return {
        id: 'candidate-1',
        target: 'repo',
        content: 'User prefers dark mode',
        contentHash: 'hash-1',
        source: 'test',
        workspaceId: 'ws-test',
        processId: 'proc-1',
        turnIndex: 1,
        createdAt: '2026-05-01T00:00:00.000Z',
        lastSeenAt: '2026-05-01T00:00:00.000Z',
        signalCount: 1,
        totalScore: 1,
        maxScore: 1,
        uniqueProcessCount: 1,
        recallDays: ['2026-05-01'],
        conceptTags: [],
        explicitMemoryIntent: false,
        status: 'pending',
        promotedAt: null,
        droppedAt: null,
        droppedReason: null,
        ...overrides,
    };
}

describe('rankMemoryCandidates', () => {
    it('is deterministic for identical input', () => {
        const candidates = [
            makeCandidate({ id: 'b', content: 'B', signalCount: 2, totalScore: 1.4 }),
            makeCandidate({ id: 'a', content: 'A', signalCount: 2, totalScore: 1.4 }),
            makeCandidate({ id: 'c', content: 'C', signalCount: 1, totalScore: 1 }),
        ];

        const first = rankMemoryCandidates(candidates, { now: '2026-05-02T00:00:00.000Z' });
        const second = rankMemoryCandidates(candidates, { now: '2026-05-02T00:00:00.000Z' });

        expect(second).toEqual(first);
        expect(first.map(candidate => candidate.id)).toEqual(['c', 'a', 'b']);
    });

    it('orders exact score ties deterministically regardless of input order', () => {
        const alphaB = makeCandidate({ id: 'alpha-b', content: 'Alpha' });
        const beta = makeCandidate({ id: 'beta', content: 'Beta' });
        const alphaA = makeCandidate({ id: 'alpha-a', content: 'Alpha' });

        const options = { now: '2026-05-01T00:00:00.000Z' };
        const first = rankMemoryCandidates([alphaB, beta, alphaA], options);
        const second = rankMemoryCandidates([beta, alphaA, alphaB], options);
        const third = rankMemoryCandidates([alphaA, alphaB, beta], options);

        expect(first.map(candidate => candidate.id)).toEqual(['alpha-a', 'alpha-b', 'beta']);
        expect(second.map(candidate => candidate.id)).toEqual(first.map(candidate => candidate.id));
        expect(third.map(candidate => candidate.id)).toEqual(first.map(candidate => candidate.id));
        expect(new Set(first.map(candidate => candidate.score)).size).toBe(1);
    });

    it('increases score when repeated evidence strengthens a candidate', () => {
        const weak = makeCandidate({ id: 'weak', signalCount: 1, totalScore: 1 });
        const strong = makeCandidate({
            id: 'strong',
            signalCount: 4,
            totalScore: 4,
            uniqueProcessCount: 3,
            recallDays: ['2026-04-29', '2026-04-30', '2026-05-01'],
            conceptTags: ['preference', 'ui'],
        });

        const ranked = rankMemoryCandidates([weak, strong], { now: '2026-05-01T00:00:00.000Z' });

        expect(ranked[0].id).toBe('strong');
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    });

    it('leaves low-score single-signal candidates unselected', () => {
        const [ranked] = rankMemoryCandidates([
            makeCandidate({
                id: 'weak-single-signal',
                totalScore: 0.1,
                maxScore: 0.1,
                explicitMemoryIntent: false,
            }),
        ], { now: '2026-05-01T00:00:00.000Z' });

        expect(ranked.score).toBeLessThan(DEFAULT_MEMORY_CANDIDATE_SELECTION_POLICY.minScore);
        expect(ranked.selected).toBe(false);
    });

    it('decays older candidates when recency is enabled', () => {
        const fresh = makeCandidate({ id: 'fresh', lastSeenAt: '2026-05-01T00:00:00.000Z' });
        const old = makeCandidate({ id: 'old', lastSeenAt: '2026-04-03T00:00:00.000Z' });

        const ranked = rankMemoryCandidates([old, fresh], { now: '2026-05-01T00:00:00.000Z' });

        expect(ranked[0].id).toBe('fresh');
        expect(ranked[0].components.recency).toBe(1);
        expect(ranked[1].components.recency).toBe(0.25);
    });

    it('exposes the full component breakdown for every score', () => {
        const [ranked] = rankMemoryCandidates([
            makeCandidate({
                signalCount: 3,
                totalScore: 2.4,
                uniqueProcessCount: 2,
                recallDays: ['2026-04-30', '2026-05-01'],
                conceptTags: ['preference'],
            }),
        ]);

        expect(ranked.score).toBeGreaterThan(0);
        expect(ranked.components).toEqual({
            frequency: expect.any(Number),
            relevance: expect.any(Number),
            diversity: expect.any(Number),
            recency: expect.any(Number),
            consolidation: expect.any(Number),
            conceptual: expect.any(Number),
        });
    });

    it('selects explicit memory intent even when relevance is zero', () => {
        const explicit = makeCandidate({
            explicitMemoryIntent: true,
            signalCount: 1,
            totalScore: 0,
            maxScore: 0,
        });

        const [ranked] = rankMemoryCandidates([explicit], {
            now: '2026-05-01T00:00:00.000Z',
            policy: DEFAULT_MEMORY_CANDIDATE_SELECTION_POLICY,
        });

        expect(ranked.components.relevance).toBe(0);
        expect(ranked.score).toBeLessThan(DEFAULT_MEMORY_CANDIDATE_SELECTION_POLICY.minScore);
        expect(ranked.selected).toBe(true);
    });
});

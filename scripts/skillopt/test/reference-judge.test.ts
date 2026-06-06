/**
 * Tests: reference-based similarity (reference-judge.ts)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    computeF1,
    blendReferenceScore,
    parseMatchedCount,
    parseHolisticScore,
    buildMatchPrompt,
    buildHolisticPrompt,
    referenceSimilarity,
    DEFAULT_REFERENCE_WEIGHTS,
} from '../reference-judge';
import { StructuredOutput } from '../extract';

vi.mock('../cli-driver', () => ({
    runCopilotCli: vi.fn(),
}));
import { runCopilotCli } from '../cli-driver';

const cand: StructuredOutput = { points: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] };
const ideal: StructuredOutput = { points: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }] };

describe('computeF1', () => {
    it('perfect match yields F1 = 1', () => {
        const { precision, recall, f1 } = computeF1(2, 2, 2);
        expect(precision).toBe(1);
        expect(recall).toBe(1);
        expect(f1).toBe(1);
    });

    it('no match yields F1 = 0', () => {
        expect(computeF1(0, 3, 2).f1).toBe(0);
    });

    it('penalizes over-splitting (too many candidate points)', () => {
        // ideal=2, candidate=5, matched=2 → precision=0.4, recall=1 → F1≈0.571
        const { f1 } = computeF1(2, 5, 2);
        expect(f1).toBeCloseTo(0.5714, 3);
    });

    it('guards against zero counts', () => {
        expect(computeF1(0, 0, 0).f1).toBe(0);
    });
});

describe('blendReferenceScore', () => {
    it('blends with default 0.7/0.3 weights', () => {
        expect(blendReferenceScore(1, 0)).toBeCloseTo(0.7);
        expect(blendReferenceScore(0, 1)).toBeCloseTo(0.3);
    });

    it('normalises non-unit weights', () => {
        expect(blendReferenceScore(1, 0, { pointF1Weight: 3, holisticWeight: 1 })).toBeCloseTo(0.75);
    });

    it('returns 0 when both weights are 0', () => {
        expect(blendReferenceScore(1, 1, { pointF1Weight: 0, holisticWeight: 0 })).toBe(0);
    });
});

describe('parseMatchedCount', () => {
    it('reads matchedCount from a json block, clamped to max', () => {
        expect(parseMatchedCount('```json\n{ "matchedCount": 2 }\n```', 3)).toBe(2);
        expect(parseMatchedCount('{ "matchedCount": 9 }', 3)).toBe(3);
        expect(parseMatchedCount('{ "matchedCount": -1 }', 3)).toBe(0);
    });

    it('falls back to first integer when json is absent', () => {
        expect(parseMatchedCount('matched 2 points', 5)).toBe(2);
    });

    it('returns 0 when nothing parseable', () => {
        expect(parseMatchedCount('none', 5)).toBe(0);
    });
});

describe('parseHolisticScore', () => {
    it('parses a decimal', () => {
        expect(parseHolisticScore('0.8')).toBeCloseTo(0.8);
        expect(parseHolisticScore('The score is 1.0')).toBe(1);
    });

    it('clamps and defaults to 0.5 on parse failure', () => {
        expect(parseHolisticScore('no number')).toBe(0.5);
    });
});

describe('prompt builders', () => {
    it('match prompt includes both lists and requests matchedCount json', () => {
        const p = buildMatchPrompt(cand, ideal);
        expect(p).toContain('REFERENCE');
        expect(p).toContain('CANDIDATE');
        expect(p).toContain('matchedCount');
    });
    it('holistic prompt asks for a single decimal', () => {
        const p = buildHolisticPrompt(cand, ideal);
        expect(p.toLowerCase()).toContain('substance');
    });
});

describe('referenceSimilarity', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns perfect score when ideal and candidate fully match', async () => {
        vi.mocked(runCopilotCli)
            .mockResolvedValueOnce({ stdout: '{ "matchedCount": 2 }', exitCode: 0, diff: '' }) // match
            .mockResolvedValueOnce({ stdout: '1.0', exitCode: 0, diff: '' }); // holistic
        const res = await referenceSimilarity(cand, ideal, 'm', '/tmp');
        expect(res.matched).toBe(2);
        expect(res.pointF1).toBe(1);
        expect(res.holisticScore).toBe(1);
        expect(res.score).toBeCloseTo(1);
    });

    it('short-circuits to 0 when candidate has no points', async () => {
        const res = await referenceSimilarity({ points: [] }, ideal, 'm', '/tmp');
        expect(res.score).toBe(0);
        expect(runCopilotCli).not.toHaveBeenCalled();
    });

    it('returns 1 when both candidate and ideal are empty', async () => {
        const res = await referenceSimilarity({ points: [] }, { points: [] }, 'm', '/tmp');
        expect(res.score).toBe(1);
        expect(runCopilotCli).not.toHaveBeenCalled();
    });

    it('fails safe: match call throws → 0 matched, holistic still scored', async () => {
        vi.mocked(runCopilotCli)
            .mockRejectedValueOnce(new Error('boom')) // match
            .mockResolvedValueOnce({ stdout: '0.4', exitCode: 0, diff: '' }); // holistic
        const res = await referenceSimilarity(cand, ideal, 'm', '/tmp');
        expect(res.matched).toBe(0);
        expect(res.pointF1).toBe(0);
        expect(res.holisticScore).toBeCloseTo(0.4);
        expect(res.score).toBeCloseTo(blendReferenceScore(0, 0.4, DEFAULT_REFERENCE_WEIGHTS));
    });
});

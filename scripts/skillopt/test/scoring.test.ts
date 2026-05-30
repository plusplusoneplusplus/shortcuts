/**
 * AC-04 tests: Scoring
 */
import { describe, it, expect } from 'vitest';
import { blendScores, DEFAULT_WEIGHTS, ScoringWeights } from '../scoring';

describe('blendScores', () => {
    it('returns 1.0 when both components are 1.0', () => {
        expect(blendScores(1.0, 1.0)).toBe(1.0);
    });

    it('returns 0.0 when both components are 0.0', () => {
        expect(blendScores(0.0, 0.0)).toBe(0.0);
    });

    it('uses default weights 0.7 / 0.3', () => {
        // w1*h + w2*j / (w1+w2) = (0.7*1.0 + 0.3*0.0) / 1.0 = 0.7
        const result = blendScores(1.0, 0.0);
        expect(result).toBeCloseTo(0.7);
    });

    it('respects configurable weights', () => {
        const weights: ScoringWeights = { hiddenTestWeight: 1.0, llmJudgeWeight: 0.0 };
        expect(blendScores(0.8, 0.2, weights)).toBeCloseTo(0.8);
    });

    it('normalises weights so sum need not be 1', () => {
        const weights: ScoringWeights = { hiddenTestWeight: 0.7, llmJudgeWeight: 0.3 };
        const result = blendScores(1.0, 0.0, weights);
        expect(result).toBeCloseTo(0.7);
    });

    it('returns 0 when both weights are 0', () => {
        const weights: ScoringWeights = { hiddenTestWeight: 0, llmJudgeWeight: 0 };
        expect(blendScores(1.0, 1.0, weights)).toBe(0);
    });

    it('handles mid-range values correctly', () => {
        // (0.7 * 0.5 + 0.3 * 0.5) / 1.0 = 0.5
        expect(blendScores(0.5, 0.5)).toBeCloseTo(0.5);
    });

    it('DEFAULT_WEIGHTS are documented values', () => {
        expect(DEFAULT_WEIGHTS.hiddenTestWeight).toBe(0.7);
        expect(DEFAULT_WEIGHTS.llmJudgeWeight).toBe(0.3);
    });
});

describe('scoring — hidden tests isolation', () => {
    it('hiddenTestPassRate is NOT placed in the agent-visible prompt context', async () => {
        // Verify via buildTargetPrompt (from rollout.ts) that hiddenTests
        // commands are NEVER included in what the target agent sees.
        const { buildTargetPrompt } = await import('../rollout');

        const task = {
            id: 'score-isolation',
            prompt: 'do the thing',
            hiddenTests: 'super-secret-cmd',
            split: 'train' as const,
        };
        const prompt = buildTargetPrompt(task, '# Skill');
        expect(prompt).not.toContain('super-secret-cmd');
    });
});

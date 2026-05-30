/**
 * AC-06 tests: Held-out validation gate
 */
import { describe, it, expect } from 'vitest';
import { shouldAccept, evaluateGate } from '../gate';

describe('shouldAccept', () => {
    it('accepts when candidate strictly improves', () => {
        expect(shouldAccept(0.9, 0.8)).toBe(true);
    });

    it('rejects when candidate is equal to best', () => {
        expect(shouldAccept(0.8, 0.8)).toBe(false);
    });

    it('rejects when candidate is worse', () => {
        expect(shouldAccept(0.7, 0.8)).toBe(false);
    });

    it('accepts when best is 0.0 and candidate is minimal positive', () => {
        expect(shouldAccept(0.001, 0.0)).toBe(true);
    });

    it('rejects when both are 0.0', () => {
        expect(shouldAccept(0.0, 0.0)).toBe(false);
    });

    it('rejects when both are 1.0', () => {
        expect(shouldAccept(1.0, 1.0)).toBe(false);
    });
});

describe('evaluateGate', () => {
    it('returns accepted=true and records scores when improving', () => {
        const result = evaluateGate(0.9, 0.7);
        expect(result.accepted).toBe(true);
        expect(result.candidateScore).toBe(0.9);
        expect(result.bestScore).toBe(0.7);
        expect(result.note).toMatch(/accept/i);
    });

    it('returns accepted=false when equal', () => {
        const result = evaluateGate(0.7, 0.7);
        expect(result.accepted).toBe(false);
        expect(result.note).toMatch(/reject/i);
    });

    it('returns accepted=false when worse', () => {
        const result = evaluateGate(0.5, 0.7);
        expect(result.accepted).toBe(false);
    });

    it('note includes both scores', () => {
        const result = evaluateGate(0.85, 0.72);
        expect(result.note).toContain('0.8500');
        expect(result.note).toContain('0.7200');
    });
});

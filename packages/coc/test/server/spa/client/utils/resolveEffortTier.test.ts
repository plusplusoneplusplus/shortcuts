/**
 * Unit tests for resolveEffortTier and resolveEffectiveTier utilities.
 */
import { describe, it, expect } from 'vitest';
import { resolveEffortTier, resolveEffectiveTier } from '../../../../../src/server/spa/client/react/utils/resolveEffortTier';
import type { LocalEffortTiersMap } from '../../../../../src/server/spa/client/react/hooks/useProviderEffortTiers';

describe('resolveEffortTier', () => {
    it('returns null for an unconfigured tier', () => {
        const map: LocalEffortTiersMap = {};
        expect(resolveEffortTier('very-low', map)).toBeNull();
        expect(resolveEffortTier('low', map)).toBeNull();
        expect(resolveEffortTier('medium', map)).toBeNull();
        expect(resolveEffortTier('high', map)).toBeNull();
    });

    it('returns null when tier entry has no model', () => {
        const map: LocalEffortTiersMap = {
            medium: { model: '', reasoningEffort: '' },
        };
        expect(resolveEffortTier('medium', map)).toBeNull();
    });

    it('returns model and reasoningEffort for a fully configured tier', () => {
        const map: LocalEffortTiersMap = {
            medium: { model: 'gpt-4.1', reasoningEffort: 'medium' },
        };
        expect(resolveEffortTier('medium', map)).toEqual({
            model: 'gpt-4.1',
            reasoningEffort: 'medium',
        });
    });

    it('returns model and reasoningEffort for the very-low tier', () => {
        const map: LocalEffortTiersMap = {
            'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low' },
        };
        expect(resolveEffortTier('very-low', map)).toEqual({
            model: 'gpt-5.4-mini',
            reasoningEffort: 'low',
        });
    });

    it('maps empty reasoningEffort string to null', () => {
        const map: LocalEffortTiersMap = {
            low: { model: 'gpt-4.1-mini', reasoningEffort: '' },
        };
        expect(resolveEffortTier('low', map)).toEqual({
            model: 'gpt-4.1-mini',
            reasoningEffort: null,
        });
    });

    it('does not leak between tiers', () => {
        const map: LocalEffortTiersMap = {
            low: { model: 'model-a', reasoningEffort: 'low' },
            high: { model: 'model-c', reasoningEffort: 'high' },
        };
        expect(resolveEffortTier('low', map)).toEqual({ model: 'model-a', reasoningEffort: 'low' });
        expect(resolveEffortTier('medium', map)).toBeNull();
        expect(resolveEffortTier('high', map)).toEqual({ model: 'model-c', reasoningEffort: 'high' });
    });
});

describe('resolveEffectiveTier', () => {
    it('returns the desired tier when it is configured', () => {
        const map: LocalEffortTiersMap = {
            'very-low': { model: 'mini', reasoningEffort: 'low' },
            low: { model: 'fast', reasoningEffort: '' },
            medium: { model: 'balanced', reasoningEffort: '' },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        expect(resolveEffectiveTier('very-low', map)).toBe('very-low');
        expect(resolveEffectiveTier('low', map)).toBe('low');
        expect(resolveEffectiveTier('medium', map)).toBe('medium');
        expect(resolveEffectiveTier('high', map)).toBe('high');
    });

    it('falls back to medium when desired tier is unconfigured and medium is available', () => {
        const map: LocalEffortTiersMap = {
            medium: { model: 'balanced', reasoningEffort: '' },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        expect(resolveEffectiveTier('low', map)).toBe('medium');
    });

    it('falls back to low when desired (high) and medium are unconfigured', () => {
        const map: LocalEffortTiersMap = {
            low: { model: 'fast', reasoningEffort: '' },
        };
        expect(resolveEffectiveTier('high', map)).toBe('low');
    });

    it('falls back to very-low after medium and low when desired tier is unconfigured', () => {
        const map: LocalEffortTiersMap = {
            'very-low': { model: 'mini', reasoningEffort: 'low' },
            high: { model: 'deep', reasoningEffort: 'high' },
        };
        expect(resolveEffectiveTier('medium', map)).toBe('very-low');
    });

    it('returns the desired tier unchanged when nothing is configured (no valid fallback)', () => {
        const map: LocalEffortTiersMap = {};
        expect(resolveEffectiveTier('medium', map)).toBe('medium');
    });
});

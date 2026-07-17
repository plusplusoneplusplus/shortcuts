/**
 * Tests for hardcoded effort-tier defaults and the merge helper.
 *
 * Pins the exact per-provider default values the admin/UI relies on, and
 * verifies that stored config wins per-tier when merging.
 */
import { describe, it, expect } from 'vitest';
import {
    getDefaultEffortTiers,
    isEffortTierKey,
    mergeEffortTiersWithDefaults,
} from '../src/effort-tier-defaults';

describe('isEffortTierKey', () => {
    it('accepts every tier key', () => {
        for (const key of ['very-low', 'low', 'medium', 'high']) {
            expect(isEffortTierKey(key)).toBe(true);
        }
    });

    it('rejects inherited object members so callers cannot index a tier map with them', () => {
        for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
            expect(isEffortTierKey(key)).toBe(false);
        }
    });

    it('rejects non-tier values', () => {
        for (const value of ['', 'medium ', 'MEDIUM', 'xhigh', undefined, null, 0, {}, ['high']]) {
            expect(isEffortTierKey(value)).toBe(false);
        }
    });
});

describe('getDefaultEffortTiers', () => {
    it('returns the copilot defaults', () => {
        const defaults = getDefaultEffortTiers('copilot');
        expect(defaults).toEqual({
            'very-low': { model: 'gpt-5.6-luna',      reasoningEffort: 'xhigh' },
            low:    { model: 'gpt-5.6-terra',     reasoningEffort: 'xhigh' },
            medium: { model: 'claude-opus-4.8',   reasoningEffort: 'xhigh' },
            high:   { model: 'gpt-5.6-sol',       reasoningEffort: 'xhigh' },
        });
    });

    it('returns the codex defaults', () => {
        const defaults = getDefaultEffortTiers('codex');
        expect(defaults).toEqual({
            'very-low': { model: 'gpt-5.6-luna',  reasoningEffort: 'xhigh'  },
            low:    { model: 'gpt-5.6-terra', reasoningEffort: 'xhigh'  },
            medium: { model: 'gpt-5.6-sol',   reasoningEffort: 'medium' },
            high:   { model: 'gpt-5.6-sol',   reasoningEffort: 'xhigh'  },
        });
    });

    it('returns the claude defaults', () => {
        // Claude tiers must reference Claude CLI catalog aliases — ids the CLI
        // initialize response advertises — so executor-side effort validation
        // can resolve their metadata. Haiku supports no reasoning effort.
        const defaults = getDefaultEffortTiers('claude');
        expect(defaults).toEqual({
            'very-low': { model: 'haiku',  reasoningEffort: null     },
            low:    { model: 'sonnet', reasoningEffort: 'high'   },
            medium: { model: 'opus',   reasoningEffort: 'medium' },
            high:   { model: 'opus',   reasoningEffort: 'xhigh'  },
        });
    });

    it('returns the opencode defaults', () => {
        const defaults = getDefaultEffortTiers('opencode');
        expect(defaults).toEqual({
            'very-low': { model: 'anthropic/claude-haiku',    reasoningEffort: null    },
            low:    { model: 'anthropic/claude-sonnet',   reasoningEffort: null    },
            medium: { model: 'anthropic/claude-sonnet',   reasoningEffort: 'high'  },
            high:   { model: 'anthropic/claude-opus',     reasoningEffort: null    },
        });
    });

    it('returns null for unknown providers', () => {
        expect(getDefaultEffortTiers('unknown')).toBeNull();
        expect(getDefaultEffortTiers('')).toBeNull();
    });

    it('returns a fresh clone so callers cannot mutate the module-level constants', () => {
        const a = getDefaultEffortTiers('copilot')!;
        a['very-low'].model = 'mutated-very-low';
        a.low.model = 'mutated';
        const b = getDefaultEffortTiers('copilot')!;
        expect(b['very-low'].model).toBe('gpt-5.6-luna');
        expect(b.low.model).toBe('gpt-5.6-terra');
    });
});

describe('mergeEffortTiersWithDefaults', () => {
    it('returns all four tiers as defaults when stored config is empty', () => {
        const merged = mergeEffortTiersWithDefaults('copilot', {});
        expect(merged).toEqual({
            'very-low': { model: 'gpt-5.6-luna',      reasoningEffort: 'xhigh', source: 'default' },
            low:    { model: 'gpt-5.6-terra',     reasoningEffort: 'xhigh', source: 'default' },
            medium: { model: 'claude-opus-4.8',   reasoningEffort: 'xhigh', source: 'default' },
            high:   { model: 'gpt-5.6-sol',       reasoningEffort: 'xhigh', source: 'default' },
        });
    });

    it('returns all four tiers as defaults when stored config is null/undefined', () => {
        expect(mergeEffortTiersWithDefaults('codex', undefined)).toEqual({
            'very-low': { model: 'gpt-5.6-luna',  reasoningEffort: 'xhigh',  source: 'default' },
            low:    { model: 'gpt-5.6-terra', reasoningEffort: 'xhigh',  source: 'default' },
            medium: { model: 'gpt-5.6-sol',   reasoningEffort: 'medium', source: 'default' },
            high:   { model: 'gpt-5.6-sol',   reasoningEffort: 'xhigh',  source: 'default' },
        });
        expect(mergeEffortTiersWithDefaults('claude', null)).toMatchObject({
            'very-low': { source: 'default' },
            low:    { source: 'default' },
            medium: { source: 'default' },
            high:   { source: 'default' },
        });
    });

    it('stored entries win per-tier; missing tiers fall back to defaults', () => {
        const merged = mergeEffortTiersWithDefaults('copilot', {
            'very-low': { model: 'my-fast', reasoningEffort: 'low' },
            medium: { model: 'my-mid', reasoningEffort: 'low' },
        });
        expect(merged['very-low']).toEqual({ model: 'my-fast', reasoningEffort: 'low', source: 'config' });
        expect(merged.medium).toEqual({ model: 'my-mid', reasoningEffort: 'low', source: 'config' });
        expect(merged.low?.source).toBe('default');
        expect(merged.high?.source).toBe('default');
        expect(merged.low?.model).toBe('gpt-5.6-terra');
    });

    it('treats stored reasoningEffort=null as a valid explicit override (not a fallback trigger)', () => {
        const merged = mergeEffortTiersWithDefaults('copilot', {
            high: { model: 'my-high', reasoningEffort: null },
        });
        expect(merged.high).toEqual({ model: 'my-high', reasoningEffort: null, source: 'config' });
    });

    it('treats stored entries with empty model as missing (falls back to default)', () => {
        const merged = mergeEffortTiersWithDefaults('copilot', {
            low: { model: '', reasoningEffort: 'low' },
        });
        expect(merged.low?.source).toBe('default');
        expect(merged.low?.model).toBe('gpt-5.6-terra');
    });

    it('omits entirely for unknown providers when stored is empty', () => {
        expect(mergeEffortTiersWithDefaults('unknown', {})).toEqual({});
    });

    it('returns only stored entries for unknown providers', () => {
        const merged = mergeEffortTiersWithDefaults('unknown', {
            'very-low': { model: 'fast', reasoningEffort: 'low' },
            low: { model: 'something', reasoningEffort: 'high' },
        });
        expect(merged).toEqual({
            'very-low': { model: 'fast', reasoningEffort: 'low', source: 'config' },
            low: { model: 'something', reasoningEffort: 'high', source: 'config' },
        });
    });
});

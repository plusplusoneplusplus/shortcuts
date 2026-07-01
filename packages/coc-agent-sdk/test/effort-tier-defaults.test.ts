/**
 * Tests for hardcoded effort-tier defaults and the merge helper.
 *
 * Pins the exact per-provider default values the admin/UI relies on, and
 * verifies that stored config wins per-tier when merging.
 */
import { describe, it, expect } from 'vitest';
import {
    getDefaultEffortTiers,
    mergeEffortTiersWithDefaults,
} from '../src/effort-tier-defaults';

describe('getDefaultEffortTiers', () => {
    it('returns the copilot defaults', () => {
        const defaults = getDefaultEffortTiers('copilot');
        expect(defaults).toEqual({
            'very-low': { model: 'gpt-5.4-mini',      reasoningEffort: 'low'   },
            low:    { model: 'claude-sonnet-5',   reasoningEffort: 'high'  },
            medium: { model: 'claude-opus-4.8',   reasoningEffort: null    },
            high:   { model: 'gpt-5.5',           reasoningEffort: 'xhigh' },
        });
    });

    it('returns the codex defaults', () => {
        const defaults = getDefaultEffortTiers('codex');
        expect(defaults).toEqual({
            'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low'   },
            low:    { model: 'gpt-5.4-mini',  reasoningEffort: 'xhigh' },
            medium: { model: 'gpt-5.5',       reasoningEffort: 'high'  },
            high:   { model: 'gpt-5.5',       reasoningEffort: 'xhigh' },
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
        expect(b['very-low'].model).toBe('gpt-5.4-mini');
        expect(b.low.model).toBe('claude-sonnet-5');
    });
});

describe('mergeEffortTiersWithDefaults', () => {
    it('returns all four tiers as defaults when stored config is empty', () => {
        const merged = mergeEffortTiersWithDefaults('copilot', {});
        expect(merged).toEqual({
            'very-low': { model: 'gpt-5.4-mini',      reasoningEffort: 'low',   source: 'default' },
            low:    { model: 'claude-sonnet-5',   reasoningEffort: 'high',  source: 'default' },
            medium: { model: 'claude-opus-4.8',   reasoningEffort: null,    source: 'default' },
            high:   { model: 'gpt-5.5',           reasoningEffort: 'xhigh', source: 'default' },
        });
    });

    it('returns all four tiers as defaults when stored config is null/undefined', () => {
        expect(mergeEffortTiersWithDefaults('codex', undefined)).toEqual({
            'very-low': { model: 'gpt-5.4-mini', reasoningEffort: 'low',   source: 'default' },
            low:    { model: 'gpt-5.4-mini',  reasoningEffort: 'xhigh', source: 'default' },
            medium: { model: 'gpt-5.5',       reasoningEffort: 'high',  source: 'default' },
            high:   { model: 'gpt-5.5',       reasoningEffort: 'xhigh', source: 'default' },
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
        expect(merged.low?.model).toBe('claude-sonnet-5');
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
        expect(merged.low?.model).toBe('claude-sonnet-5');
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

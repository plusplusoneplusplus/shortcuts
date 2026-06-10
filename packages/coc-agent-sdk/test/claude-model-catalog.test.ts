/**
 * Tests for findClaudeCatalogModel — bridging configured Claude model ids
 * (CLI aliases, dotted marketing ids, dashed CLI ids, provider-default
 * sentinels) to Claude CLI catalog entries.
 */
import { describe, it, expect } from 'vitest';
import { findClaudeCatalogModel } from '../src/claude-model-catalog';

/** Mirror of the live Claude CLI initialize-response catalog shape. */
const LIVE_CATALOG = [
    {
        id: 'default',
        name: 'Default (recommended)',
        description: 'Sonnet 4.6 · Best for everyday tasks',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
    },
    {
        id: 'opus',
        name: 'Opus',
        description: 'Opus 4.8 · Most capable for complex work · ~2× usage vs Sonnet',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
    },
    {
        id: 'haiku',
        name: 'Haiku',
        description: 'Haiku 4.5 · Fastest for quick answers',
    },
];

/** Mirror of the curated fallback catalog used when CLI discovery fails. */
const FALLBACK_CATALOG = [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', supportedReasoningEfforts: ['low', 'medium', 'high'] },
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-provider-default', name: 'Claude Provider Default' },
];

describe('findClaudeCatalogModel', () => {
    // ── Exact alias ids (the tier defaults) ─────────────────────────────────
    it('matches catalog alias ids exactly', () => {
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'opus')?.id).toBe('opus');
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'haiku')?.id).toBe('haiku');
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'default')?.id).toBe('default');
    });

    it('matches ids case-insensitively and ignores surrounding whitespace', () => {
        expect(findClaudeCatalogModel(LIVE_CATALOG, '  Opus ')?.id).toBe('opus');
    });

    // ── Provider-default sentinels ──────────────────────────────────────────
    it('resolves undefined and provider-default sentinels to the default entry', () => {
        expect(findClaudeCatalogModel(LIVE_CATALOG, undefined)?.id).toBe('default');
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'provider-default')?.id).toBe('default');
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'claude-provider-default')?.id).toBe('default');
    });

    it('returns undefined for provider-default when the catalog has no default entry', () => {
        expect(findClaudeCatalogModel(FALLBACK_CATALOG, undefined)).toBeUndefined();
    });

    // ── Family alias bridging (tier defaults vs live catalog) ───────────────
    it("matches 'sonnet' to the default entry via its description", () => {
        const match = findClaudeCatalogModel(LIVE_CATALOG, 'sonnet');
        expect(match?.id).toBe('default');
        expect(match?.supportedReasoningEfforts).toEqual(['low', 'medium', 'high']);
    });

    it("matches 'sonnet' and 'opus' aliases against the fallback catalog by family", () => {
        expect(findClaudeCatalogModel(FALLBACK_CATALOG, 'sonnet')?.id).toBe('claude-sonnet-4-6');
        expect(findClaudeCatalogModel(FALLBACK_CATALOG, 'opus')?.id).toBe('claude-opus-4-7');
        expect(findClaudeCatalogModel(FALLBACK_CATALOG, 'haiku')?.id).toBe('claude-haiku-4-5');
    });

    // ── Legacy dashed/dotted ids (stored configs and process metadata) ──────
    it('matches legacy dashed CLI ids to the live catalog by family', () => {
        // Regression: the old high-tier default 'claude-opus-4-7' must resolve
        // to an opus entry so requesting xhigh validates instead of throwing
        // 'Supported efforts: unknown'.
        const match = findClaudeCatalogModel(LIVE_CATALOG, 'claude-opus-4-7');
        expect(match?.id).toBe('opus');
        expect(match?.supportedReasoningEfforts).toContain('xhigh');
    });

    it('matches dotted marketing ids via dashed normalization', () => {
        expect(findClaudeCatalogModel(FALLBACK_CATALOG, 'claude-sonnet-4.6')?.id).toBe('claude-sonnet-4-6');
    });

    it('matches dotted marketing ids to the live catalog by family', () => {
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'claude-sonnet-4.6')?.id).toBe('default');
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'claude-haiku-4.5')?.id).toBe('haiku');
    });

    // ── Family recognized but missing from the catalog ──────────────────────
    it('falls back to the default entry when the family has no catalog entry', () => {
        const opusOnlyMissing = LIVE_CATALOG.filter(m => m.id !== 'opus');
        // 'Opus 4.8' appears in no remaining haystack → default proxy.
        expect(findClaudeCatalogModel(opusOnlyMissing, 'claude-opus-5')?.id).toBe('default');
    });

    // ── Unknown ids ──────────────────────────────────────────────────────────
    it('returns undefined for ids with no recognizable family', () => {
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'gpt-5.5')).toBeUndefined();
        expect(findClaudeCatalogModel(LIVE_CATALOG, 'claude-banana-9')).toBeUndefined();
    });

    it('returns undefined on an empty catalog', () => {
        expect(findClaudeCatalogModel([], 'opus')).toBeUndefined();
        expect(findClaudeCatalogModel([], undefined)).toBeUndefined();
    });
});

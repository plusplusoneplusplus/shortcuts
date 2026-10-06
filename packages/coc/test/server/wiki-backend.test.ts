/**
 * Verifies that:
 * 1. WikiManager satisfies the WikiProvider interface structurally.
 * 2. createSingleWikiProvider produces a valid WikiProvider.
 */

import { describe, it, expect, vi } from 'vitest';
import type { WikiProvider, GenerateWiki } from '../../src/server/wiki/wiki-backend';
import { createSingleWikiProvider } from '../../src/server/wiki/wiki-backend';
import { WikiManager } from '../../src/server/wiki/wiki-manager';

// ============================================================================
// WikiProvider interface conformance
// ============================================================================

describe('WikiProvider interface', () => {
    it('WikiManager satisfies WikiProvider via structural typing', () => {
        const manager = new WikiManager({});

        // WikiManager.get() returns WikiRuntime | undefined, which is
        // assignable to GenerateWiki | undefined. This proves structural compatibility.
        const provider: WikiProvider = manager;
        expect(provider.get).toBeDefined();
        expect(typeof provider.get).toBe('function');
    });

    it('createSingleWikiProvider wraps a GenerateWiki correctly', () => {
        const mockWiki: GenerateWiki = {
            registration: {
                repoPath: '/repo',
                wikiDir: '/wiki',
            },
            wikiData: {
                graph: { components: [], categories: [], architectureNotes: '', project: { name: 'test', description: '', language: 'ts', buildSystem: '', entryPoints: [] } },
                reload: vi.fn(),
                getComponentDetail: vi.fn().mockReturnValue(null),
            },
        };

        const provider = createSingleWikiProvider(mockWiki);

        // Should return the same wiki for any wikiId
        expect(provider.get('any-id')).toBe(mockWiki);
        expect(provider.get('another-id')).toBe(mockWiki);
    });

    it('createSingleWikiProvider satisfies WikiProvider', () => {
        const mockWiki: GenerateWiki = {
            registration: { wikiDir: '/wiki' },
            wikiData: {
                graph: { components: [] },
                reload: vi.fn(),
                getComponentDetail: vi.fn(),
            },
        };

        const provider: WikiProvider = createSingleWikiProvider(mockWiki);
        expect(provider).toBeDefined();
    });
});


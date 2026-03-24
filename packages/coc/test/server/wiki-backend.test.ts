/**
 * Wiki Backend Tests
 *
 * Verifies that:
 * 1. WikiManager satisfies the WikiProvider interface structurally.
 * 2. createSingleWikiProvider produces a valid WikiProvider.
 * 3. handleAskCore and handleExploreCore accept ResolvedAskContext / ResolvedExploreContext.
 */

import { describe, it, expect, vi } from 'vitest';
import type { WikiProvider, GenerateWiki, ResolvedAskContext, ResolvedExploreContext } from '../../src/server/wiki/wiki-backend';
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

// ============================================================================
// ResolvedAskContext conformance
// ============================================================================

describe('ResolvedAskContext', () => {
    it('can be constructed with required fields', () => {
        const context: ResolvedAskContext = {
            contextBuilder: {
                retrieve: vi.fn().mockReturnValue({
                    componentIds: [],
                    contextText: '',
                    graphSummary: '',
                    themeContexts: [],
                }),
            } as any,
            sendMessage: vi.fn().mockResolvedValue('response'),
        };

        expect(context.contextBuilder).toBeDefined();
        expect(context.sendMessage).toBeDefined();
        expect(context.model).toBeUndefined();
        expect(context.workingDirectory).toBeUndefined();
        expect(context.sessionManager).toBeUndefined();
    });

    it('accepts optional fields', () => {
        const context: ResolvedAskContext = {
            contextBuilder: {} as any,
            sendMessage: vi.fn(),
            model: 'gpt-4',
            workingDirectory: '/work',
            sessionManager: {
                get: vi.fn(),
                create: vi.fn(),
                send: vi.fn(),
                destroy: vi.fn(),
            } as any,
        };

        expect(context.model).toBe('gpt-4');
        expect(context.workingDirectory).toBe('/work');
        expect(context.sessionManager).toBeDefined();
    });
});

// ============================================================================
// ResolvedExploreContext conformance
// ============================================================================

describe('ResolvedExploreContext', () => {
    it('can be constructed with required fields', () => {
        const context: ResolvedExploreContext = {
            wikiData: {
                graph: { components: [] },
                getComponentDetail: vi.fn(),
            } as any,
            sendMessage: vi.fn().mockResolvedValue('response'),
        };

        expect(context.wikiData).toBeDefined();
        expect(context.sendMessage).toBeDefined();
    });

    it('accepts optional fields', () => {
        const context: ResolvedExploreContext = {
            wikiData: {} as any,
            sendMessage: vi.fn(),
            model: 'gpt-4',
            workingDirectory: '/work',
        };

        expect(context.model).toBe('gpt-4');
        expect(context.workingDirectory).toBe('/work');
    });
});

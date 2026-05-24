/**
 * Tests for EmbeddingProviderRegistry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingProviderRegistry } from '../src/embedding-provider';
import type { EmbeddingProvider, EmbeddingVector } from '../src/embedding-provider';

// ---------------------------------------------------------------------------
// Stub provider
// ---------------------------------------------------------------------------

function makeProvider(name: string, dims = 384): EmbeddingProvider {
    return {
        name,
        dimensions: dims,
        isAvailable: async () => true,
        async embed(textOrTexts: string | string[]): Promise<EmbeddingVector | EmbeddingVector[]> {
            if (Array.isArray(textOrTexts)) {
                return textOrTexts.map(() => ({ values: new Array(dims).fill(0), dimensions: dims }));
            }
            return { values: new Array(dims).fill(0), dimensions: dims };
        },
    };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

describe('EmbeddingProviderRegistry', () => {
    let registry: EmbeddingProviderRegistry;

    beforeEach(() => {
        registry = new EmbeddingProviderRegistry();
    });

    it('starts with no providers', () => {
        expect(registry.list()).toHaveLength(0);
        expect(registry.getActive()).toBeNull();
    });

    it('registers and lists providers', () => {
        registry.register(makeProvider('provider-a'));
        registry.register(makeProvider('provider-b'));
        expect(registry.list()).toContain('provider-a');
        expect(registry.list()).toContain('provider-b');
    });

    it('activates a registered provider', () => {
        registry.register(makeProvider('provider-a'));
        registry.setActive('provider-a');
        expect(registry.getActive()?.name).toBe('provider-a');
    });

    it('throws when activating an unregistered provider', () => {
        expect(() => registry.setActive('nonexistent')).toThrow('EmbeddingProvider not registered: nonexistent');
    });

    it('returns null for getActive when no provider is active', () => {
        registry.register(makeProvider('provider-a'));
        expect(registry.getActive()).toBeNull();
    });

    it('retrieves a provider by name', () => {
        const p = makeProvider('provider-a', 512);
        registry.register(p);
        expect(registry.get('provider-a')).toBe(p);
    });

    it('returns null for an unregistered provider name', () => {
        expect(registry.get('missing')).toBeNull();
    });

    it('clearActive removes the active provider without unregistering it', () => {
        registry.register(makeProvider('provider-a'));
        registry.setActive('provider-a');
        registry.clearActive();
        expect(registry.getActive()).toBeNull();
        expect(registry.get('provider-a')).not.toBeNull();
    });

    it('stub provider embeds a single text', async () => {
        const provider = makeProvider('provider-a', 4);
        const vec = await provider.embed('hello') as EmbeddingVector;
        expect(vec.dimensions).toBe(4);
        expect(vec.values).toHaveLength(4);
    });

    it('stub provider embeds an array of texts', async () => {
        const provider = makeProvider('provider-a', 4);
        const vecs = await provider.embed(['hello', 'world']) as EmbeddingVector[];
        expect(vecs).toHaveLength(2);
    });
});

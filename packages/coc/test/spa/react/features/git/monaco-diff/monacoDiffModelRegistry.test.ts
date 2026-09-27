/**
 * Tests for monacoDiffModelRegistry — per-URI model sharing and exactly-once
 * disposal (AC-03).
 */

import { describe, it, expect } from 'vitest';
import { createModelRegistry } from '../../../../../../src/server/spa/client/react/features/git/diff/monacoDiffModelRegistry';

interface FakeModel { uri: string; text: string; language: string; disposed: number; getValue(): string; dispose(): void }

function host() {
    const live = new Map<string, FakeModel>();
    const created: FakeModel[] = [];
    return {
        live,
        created,
        getModel: (uri: string) => live.get(uri) ?? null,
        createModel(text: string, language: string, uri: string): FakeModel {
            if (live.has(uri)) throw new Error(`duplicate model ${uri}`);
            const model: FakeModel = {
                uri, text, language, disposed: 0,
                getValue: () => text,
                dispose: () => { model.disposed++; live.delete(uri); },
            };
            live.set(uri, model);
            created.push(model);
            return model;
        },
    };
}

describe('createModelRegistry', () => {
    it('creates one model per URI and disposes it on release', () => {
        const h = host();
        const registry = createModelRegistry(h);
        const lease = registry.acquire('coc-file://ws/a.ts', 'x', 'typescript');
        expect(lease.uri).toBe('coc-file://ws/a.ts');
        expect(lease.model.language).toBe('typescript');
        expect(registry.size()).toBe(1);
        lease.release();
        lease.release();
        expect(lease.model.disposed).toBe(1);
        expect(registry.size()).toBe(0);
    });

    it('shares a model between holders with the same text; disposes after the last release', () => {
        const h = host();
        const registry = createModelRegistry(h);
        const a = registry.acquire('u', 'same', 'plaintext');
        const b = registry.acquire('u', 'same', 'plaintext');
        expect(b.model).toBe(a.model);
        expect(h.created).toHaveLength(1);
        a.release();
        a.release(); // idempotent: must not drop b's reference
        expect(a.model.disposed).toBe(0);
        b.release();
        expect(a.model.disposed).toBe(1);
    });

    it('a URI held with different text gets a private variant instead of overwriting', () => {
        const h = host();
        const registry = createModelRegistry(h);
        const a = registry.acquire('u', 'one', 'plaintext');
        const b = registry.acquire('u', 'two', 'plaintext');
        expect(b.uri).not.toBe('u');
        expect(b.uri.startsWith('u#coc-diff-')).toBe(true);
        expect(a.model.getValue()).toBe('one');
        expect(b.model.getValue()).toBe('two');
        b.release();
        a.release();
        expect(h.live.size).toBe(0);
    });

    it('reuses a foreign model with equal text without ever disposing it', () => {
        const h = host();
        const foreign = h.createModel('text', 'typescript', 'u');
        const registry = createModelRegistry(h);
        const lease = registry.acquire('u', 'text', 'typescript');
        expect(lease.model).toBe(foreign);
        lease.release();
        expect(foreign.disposed).toBe(0);
        expect(registry.size()).toBe(0);
    });

    it('never touches a foreign model with different text', () => {
        const h = host();
        const foreign = h.createModel('theirs', 'typescript', 'u');
        const registry = createModelRegistry(h);
        const lease = registry.acquire('u', 'ours', 'typescript');
        expect(lease.model).not.toBe(foreign);
        lease.release();
        expect(foreign.disposed).toBe(0);
        expect(foreign.getValue()).toBe('theirs');
    });

    it('after the old holder releases, the real URI is available again', () => {
        const h = host();
        const registry = createModelRegistry(h);
        registry.acquire('u', 'v1', 'plaintext').release();
        const next = registry.acquire('u', 'v2', 'plaintext');
        expect(next.uri).toBe('u');
    });
});

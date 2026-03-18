/**
 * Tests for MemoryRetriever — prompt injection format.
 *
 * Section 4: MemoryRetriever — Prompt Injection Format
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryStore } from '../../src/memory/types';
import { MemoryRetriever } from '../../src/memory/memory-retriever';

describe('MemoryRetriever — prompt injection format', () => {
    let mockStore: MemoryStore;
    let retriever: MemoryRetriever;

    beforeEach(() => {
        mockStore = {
            readConsolidated: vi.fn().mockResolvedValue(null),
        } as unknown as MemoryStore;
        retriever = new MemoryRetriever(mockStore);
    });

    it('empty memory store → retrieve() returns null (not error)', async () => {
        vi.mocked(mockStore.readConsolidated).mockResolvedValue(null);
        const result = await retriever.retrieve('both', 'abc123');
        expect(result).toBeNull();
    });

    it('empty string content treated as null → retrieve() returns null', async () => {
        vi.mocked(mockStore.readConsolidated).mockResolvedValue('');
        const result = await retriever.retrieve('both', 'abc123');
        expect(result).toBeNull();
    });

    it('whitespace-only content treated as null', async () => {
        vi.mocked(mockStore.readConsolidated).mockResolvedValue('   \n   ');
        const result = await retriever.retrieve('system');
        expect(result).toBeNull();
    });

    it('one system entry → output starts with expected section header', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) =>
            level === 'system' ? '- Always use strict TypeScript' : null,
        );

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).not.toBeNull();
        expect(result).toMatch(/^## Context from Memory/);
    });

    it('one entry → entry content included in output block', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) =>
            level === 'system' ? '- use vitest for testing' : null,
        );

        const result = await retriever.retrieve('both');

        expect(result).toContain('use vitest for testing');
    });

    it('multiple facts in entry → all facts included, not truncated', async () => {
        const facts = Array.from({ length: 20 }, (_, i) => `- fact number ${i}`).join('\n');
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) =>
            level === 'system' ? facts : null,
        );

        const result = await retriever.retrieve('system');

        expect(result).not.toBeNull();
        for (let i = 0; i < 20; i++) {
            expect(result).toContain(`fact number ${i}`);
        }
    });

    it('system-level entries included in retrieval output', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) =>
            level === 'system' ? '- system fact' : null,
        );

        const result = await retriever.retrieve('system');
        expect(result).not.toBeNull();
        expect(result).toContain('system fact');
    });

    it('repo-level entries included in retrieval output', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) =>
            level === 'repo' ? '- repo fact' : null,
        );

        const result = await retriever.retrieve('repo', 'somehash');
        expect(result).not.toBeNull();
        expect(result).toContain('repo fact');
    });

    it('git-remote-level entries included when repoHash matches', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level, hash) =>
            level === 'git-remote' && hash === 'remotehash1' ? '- remote fact' : null,
        );

        const result = await retriever.retrieve('git-remote', 'remotehash1');
        expect(result).not.toBeNull();
        expect(result).toContain('remote fact');
    });

    it('git-remote-level entries NOT returned when repoHash does not match', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level, hash) =>
            level === 'git-remote' && hash === 'remotehash1' ? '- remote fact' : null,
        );

        // Different hash → no match
        const result = await retriever.retrieve('git-remote', 'otherhash');
        expect(result).toBeNull();
    });

    it('combined both output starts with ## Context from Memory header', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return 'repo content';
            if (level === 'system') return 'system content';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');
        expect(result).toMatch(/^## Context from Memory\n/);
    });

    it('combined both output contains ### Project-Specific and ### General Knowledge headers', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return 'repo data';
            if (level === 'system') return 'system data';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');
        expect(result).toContain('### Project-Specific');
        expect(result).toContain('### General Knowledge');
    });

    it('retrieval output is valid markdown — no unclosed code fences', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return '```ts\nconst x = 1;\n```';
            if (level === 'system') return 'some system info';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');
        expect(result).not.toBeNull();

        // Count backtick fence markers — must be even (all opened fences are closed)
        const fenceCount = (result!.match(/^```/gm) ?? []).length;
        expect(fenceCount % 2).toBe(0);
    });

    it('exact combined output format — snapshot', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return 'repo content';
            if (level === 'system') return 'system content';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).toMatchInlineSnapshot(`
"## Context from Memory

### Project-Specific

repo content

### General Knowledge

system content
"`);
    });
});

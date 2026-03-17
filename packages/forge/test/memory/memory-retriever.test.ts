import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryStore } from '../../src/memory/types';
import { MemoryRetriever } from '../../src/memory/memory-retriever';

describe('MemoryRetriever', () => {
    let mockStore: MemoryStore;
    let retriever: MemoryRetriever;

    beforeEach(() => {
        mockStore = {
            readConsolidated: vi.fn(),
        } as unknown as MemoryStore;
        retriever = new MemoryRetriever(mockStore);
    });

    it('returns null when no memory at any level', async () => {
        vi.mocked(mockStore.readConsolidated).mockResolvedValue(null);

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).toBeNull();
        expect(mockStore.readConsolidated).toHaveBeenCalledWith('repo', 'abc123');
        expect(mockStore.readConsolidated).toHaveBeenCalledWith('system', undefined);
    });

    it('returns repo-only when level is repo', async () => {
        vi.mocked(mockStore.readConsolidated).mockResolvedValue('repo facts here');

        const result = await retriever.retrieve('repo', 'abc123');

        expect(result).toBe('repo facts here');
        expect(mockStore.readConsolidated).toHaveBeenCalledWith('repo', 'abc123');
        expect(mockStore.readConsolidated).toHaveBeenCalledTimes(1);
    });

    it('returns system-only when level is system', async () => {
        vi.mocked(mockStore.readConsolidated).mockResolvedValue('system facts here');

        const result = await retriever.retrieve('system');

        expect(result).toBe('system facts here');
        expect(mockStore.readConsolidated).toHaveBeenCalledWith('system', undefined);
        expect(mockStore.readConsolidated).toHaveBeenCalledTimes(1);
    });

    it('returns combined block when level is both and both exist', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return 'repo content';
            if (level === 'system') return 'system content';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).toBe(
            '## Context from Memory\n\n' +
            '### Project-Specific\n\n' +
            'repo content\n\n' +
            '### General Knowledge\n\n' +
            'system content\n',
        );
    });

    it('returns only repo section when level is both but system is empty', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return 'repo content';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).toBe(
            '## Context from Memory\n\n' +
            '### Project-Specific\n\n' +
            'repo content\n',
        );
        expect(result).not.toContain('### General Knowledge');
    });

    it('returns only system section when level is both but repo is empty', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'system') return 'system content';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).toBe(
            '## Context from Memory\n\n' +
            '### General Knowledge\n\n' +
            'system content\n',
        );
        expect(result).not.toContain('### Project-Specific');
    });

    it('includes correct markdown headers in combined output', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return 'repo data';
            if (level === 'system') return 'system data';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).toContain('## Context from Memory');
        expect(result).toContain('### Project-Specific');
        expect(result).toContain('### General Knowledge');
    });

    it('treats empty-string content the same as null', async () => {
        vi.mocked(mockStore.readConsolidated).mockImplementation(async (level) => {
            if (level === 'repo') return '   ';
            if (level === 'system') return '';
            return null;
        });

        const result = await retriever.retrieve('both', 'abc123');

        expect(result).toBeNull();
    });
});

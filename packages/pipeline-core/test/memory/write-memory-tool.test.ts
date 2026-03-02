import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWriteMemoryTool, WriteMemoryToolOptions } from '../../src/memory/write-memory-tool';
import { MemoryStore } from '../../src/memory/types';
import { ToolInvocation } from '../../src/copilot-sdk-wrapper/types';

function createMockStore(): MemoryStore {
    return {
        writeRaw: vi.fn().mockResolvedValue('mock-filename.md'),
        listRaw: vi.fn().mockResolvedValue([]),
        readRaw: vi.fn().mockResolvedValue(undefined),
        deleteRaw: vi.fn().mockResolvedValue(false),
        readConsolidated: vi.fn().mockResolvedValue(null),
        writeConsolidated: vi.fn().mockResolvedValue(undefined),
        readIndex: vi.fn().mockResolvedValue({ lastAggregation: null, rawCount: 0, factCount: 0, categories: [] }),
        updateIndex: vi.fn().mockResolvedValue(undefined),
        getRepoInfo: vi.fn().mockResolvedValue(null),
        updateRepoInfo: vi.fn().mockResolvedValue(undefined),
        computeRepoHash: vi.fn().mockReturnValue('mock-hash'),
        clear: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockResolvedValue({ rawCount: 0, consolidatedExists: false, lastAggregation: null, factCount: 0 }),
        listRepos: vi.fn().mockResolvedValue([]),
        getSystemDir: vi.fn().mockReturnValue('/mock/system'),
        getRepoDir: vi.fn().mockReturnValue('/mock/repo'),
    };
}

const mockInvocation: ToolInvocation = {
    sessionId: 'test-session',
    toolCallId: 'test-call-1',
    toolName: 'write_memory',
    arguments: {},
};

describe('createWriteMemoryTool', () => {
    let mockStore: MemoryStore;

    beforeEach(() => {
        mockStore = createMockStore();
    });

    it('tool has correct name and description', () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test' });
        expect(tool.name).toBe('write_memory');
        expect(tool.description).toContain('Store a fact');
    });

    it('handler writes raw observation via store.writeRaw', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test' });
        await tool.handler({ fact: 'Use tabs' }, mockInvocation);
        expect(mockStore.writeRaw).toHaveBeenCalledOnce();
    });

    it('metadata includes source, timestamp, model, repo from options', async () => {
        const opts: WriteMemoryToolOptions = {
            source: 'code-review',
            model: 'gpt-5',
            repo: 'org/repo',
        };
        const { tool } = createWriteMemoryTool(mockStore, opts);
        await tool.handler({ fact: 'Use strict mode' }, mockInvocation);

        const metadata = (mockStore.writeRaw as ReturnType<typeof vi.fn>).mock.calls[0][2];
        expect(metadata.pipeline).toBe('code-review');
        expect(metadata.model).toBe('gpt-5');
        expect(metadata.repo).toBe('org/repo');
        expect(new Date(metadata.timestamp).toISOString()).toBe(metadata.timestamp);
    });

    it('fact content is written as observation body with category', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test' });
        await tool.handler({ fact: 'Always use strict mode', category: 'conventions' }, mockInvocation);

        const content = (mockStore.writeRaw as ReturnType<typeof vi.fn>).mock.calls[0][3];
        expect(content).toContain('Always use strict mode');
        expect(content).toContain('## conventions');
    });

    it('getWrittenFacts returns all facts written during session', async () => {
        const { tool, getWrittenFacts } = createWriteMemoryTool(mockStore, { source: 'test' });
        await tool.handler({ fact: 'Fact one' }, mockInvocation);
        await tool.handler({ fact: 'Fact two' }, mockInvocation);

        expect(getWrittenFacts()).toEqual(['Fact one', 'Fact two']);
    });

    it('handles level=both — writes with level both and repoHash', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test', level: 'both', repoHash: 'abc123' });
        await tool.handler({ fact: 'Some fact' }, mockInvocation);

        expect(mockStore.writeRaw).toHaveBeenCalledWith('both', 'abc123', expect.any(Object), expect.any(String));
    });

    it('handles level=repo — writes to repo only', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test', level: 'repo', repoHash: 'abc123' });
        await tool.handler({ fact: 'Repo fact' }, mockInvocation);

        expect(mockStore.writeRaw).toHaveBeenCalledWith('repo', 'abc123', expect.any(Object), expect.any(String));
    });

    it('handles level=system — writes to system only', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test', level: 'system' });
        await tool.handler({ fact: 'System fact' }, mockInvocation);

        expect(mockStore.writeRaw).toHaveBeenCalledWith('system', undefined, expect.any(Object), expect.any(String));
    });

    it('multiple tool calls accumulate facts', async () => {
        const { tool, getWrittenFacts } = createWriteMemoryTool(mockStore, { source: 'test' });
        await tool.handler({ fact: 'Fact A' }, mockInvocation);
        await tool.handler({ fact: 'Fact B' }, mockInvocation);
        await tool.handler({ fact: 'Fact C' }, mockInvocation);

        const facts = getWrittenFacts();
        expect(facts).toHaveLength(3);
        expect(facts).toEqual(['Fact A', 'Fact B', 'Fact C']);
    });

    it('handler returns { stored: true }', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test' });
        const result = await tool.handler({ fact: 'A fact' }, mockInvocation);
        expect(result).toEqual({ stored: true });
    });

    it('default level is both when not specified', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test', repoHash: 'hash1' });
        await tool.handler({ fact: 'Default level fact' }, mockInvocation);

        expect(mockStore.writeRaw).toHaveBeenCalledWith('both', 'hash1', expect.any(Object), expect.any(String));
    });

    it('fact without category is written as plain bullet', async () => {
        const { tool } = createWriteMemoryTool(mockStore, { source: 'test' });
        await tool.handler({ fact: 'Plain fact' }, mockInvocation);

        const content = (mockStore.writeRaw as ReturnType<typeof vi.fn>).mock.calls[0][3];
        expect(content).toBe('- Plain fact');
    });

    it('getWrittenFacts returns a copy — external mutation does not affect internal state', async () => {
        const { tool, getWrittenFacts } = createWriteMemoryTool(mockStore, { source: 'test' });
        await tool.handler({ fact: 'Fact 1' }, mockInvocation);

        const copy = getWrittenFacts();
        copy.push('injected');

        expect(getWrittenFacts()).toEqual(['Fact 1']);
    });
});

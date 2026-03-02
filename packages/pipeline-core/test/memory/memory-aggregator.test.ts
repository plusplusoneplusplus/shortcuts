import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryStore, RawObservation } from '../../src/memory/types';
import type { AIInvoker, AIInvokerResult } from '../../src/map-reduce/types';
import { MemoryAggregator, countFacts } from '../../src/memory/memory-aggregator';

function makeRawObservation(filename: string, content: string): RawObservation {
    return {
        metadata: { pipeline: 'test', timestamp: new Date().toISOString() },
        content,
        filename,
    };
}

function createMockStore(): MemoryStore {
    return {
        listRaw: vi.fn().mockResolvedValue([]),
        readRaw: vi.fn().mockResolvedValue(undefined),
        writeRaw: vi.fn().mockResolvedValue(''),
        deleteRaw: vi.fn().mockResolvedValue(true),
        readConsolidated: vi.fn().mockResolvedValue(null),
        writeConsolidated: vi.fn().mockResolvedValue(undefined),
        readIndex: vi.fn().mockResolvedValue({ lastAggregation: null, rawCount: 0, factCount: 0, categories: [] }),
        updateIndex: vi.fn().mockResolvedValue(undefined),
        getRepoInfo: vi.fn().mockResolvedValue(null),
        updateRepoInfo: vi.fn().mockResolvedValue(undefined),
        computeRepoHash: vi.fn().mockReturnValue('abc123'),
        clear: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockResolvedValue({ rawCount: 0, consolidatedExists: false, lastAggregation: null, factCount: 0 }),
        listRepos: vi.fn().mockResolvedValue([]),
        getSystemDir: vi.fn().mockReturnValue('/mock/system'),
        getRepoDir: vi.fn().mockReturnValue('/mock/repo'),
    } as unknown as MemoryStore;
}

function createMockAIInvoker(response: string = '- fact1\n- fact2\n- fact3'): AIInvoker {
    return vi.fn().mockResolvedValue({
        success: true,
        response,
    } as AIInvokerResult);
}

describe('MemoryAggregator', () => {
    let mockStore: MemoryStore;
    let mockAI: AIInvoker;
    let aggregator: MemoryAggregator;

    beforeEach(() => {
        mockStore = createMockStore();
        mockAI = createMockAIInvoker();
        aggregator = new MemoryAggregator(mockStore);
    });

    describe('aggregateIfNeeded', () => {
        it('returns false when raw count < threshold', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md', 'b.md', 'c.md']);

            const result = await aggregator.aggregateIfNeeded(mockAI, 'system');

            expect(result).toBe(false);
            expect(mockAI).not.toHaveBeenCalled();
        });

        it('returns true and runs aggregation when count >= threshold', async () => {
            const filenames = ['1.md', '2.md', '3.md', '4.md', '5.md'];
            vi.mocked(mockStore.listRaw).mockResolvedValue(filenames);
            filenames.forEach(f => {
                vi.mocked(mockStore.readRaw).mockResolvedValueOnce(
                    makeRawObservation(f, `content of ${f}`),
                );
            });

            const result = await aggregator.aggregateIfNeeded(mockAI, 'system');

            expect(result).toBe(true);
            expect(mockAI).toHaveBeenCalledTimes(1);
            expect(mockStore.writeConsolidated).toHaveBeenCalled();
            expect(mockStore.updateIndex).toHaveBeenCalled();
            expect(mockStore.deleteRaw).toHaveBeenCalledTimes(5);
        });

        it('custom batchThreshold respected', async () => {
            const customAggregator = new MemoryAggregator(mockStore, { batchThreshold: 2 });
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md', 'b.md']);
            vi.mocked(mockStore.readRaw)
                .mockResolvedValueOnce(makeRawObservation('a.md', 'a content'))
                .mockResolvedValueOnce(makeRawObservation('b.md', 'b content'));

            const result = await customAggregator.aggregateIfNeeded(mockAI, 'repo', 'hash1');

            expect(result).toBe(true);
            expect(mockAI).toHaveBeenCalledTimes(1);
        });
    });

    describe('aggregate', () => {
        it('reads all raw files and concatenates into prompt', async () => {
            const filenames = ['x.md', 'y.md'];
            vi.mocked(mockStore.listRaw).mockResolvedValue(filenames);
            vi.mocked(mockStore.readRaw)
                .mockResolvedValueOnce(makeRawObservation('x.md', 'obs X'))
                .mockResolvedValueOnce(makeRawObservation('y.md', 'obs Y'));

            await aggregator.aggregate(mockAI, 'system');

            expect(mockStore.readRaw).toHaveBeenCalledWith('system', undefined, 'x.md');
            expect(mockStore.readRaw).toHaveBeenCalledWith('system', undefined, 'y.md');
            const prompt = vi.mocked(mockAI).mock.calls[0][0];
            expect(prompt).toContain('obs X');
            expect(prompt).toContain('obs Y');
            expect(prompt).toContain('## New Observations (2 sessions)');
        });

        it('includes existing consolidated in prompt', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawObservation('a.md', 'new'));
            vi.mocked(mockStore.readConsolidated).mockResolvedValue('existing content here');

            await aggregator.aggregate(mockAI, 'system');

            const prompt = vi.mocked(mockAI).mock.calls[0][0];
            expect(prompt).toContain('## Existing Memory');
            expect(prompt).toContain('existing content here');
        });

        it('uses "No existing memory" when no consolidated exists', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawObservation('a.md', 'new'));
            vi.mocked(mockStore.readConsolidated).mockResolvedValue(null);

            await aggregator.aggregate(mockAI, 'system');

            const prompt = vi.mocked(mockAI).mock.calls[0][0];
            expect(prompt).toContain('No existing memory');
        });

        it('writes AI response as new consolidated', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawObservation('a.md', 'obs'));
            const aiResponse = '- consolidated fact 1\n- consolidated fact 2';
            mockAI = createMockAIInvoker(aiResponse);

            await aggregator.aggregate(mockAI, 'repo', 'hash1');

            expect(mockStore.writeConsolidated).toHaveBeenCalledWith('repo', aiResponse, 'hash1');
        });

        it('updates index with correct metadata', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawObservation('a.md', 'obs'));
            const aiResponse = '- fact one\n- fact two\nsome non-bullet line\n- fact three';
            mockAI = createMockAIInvoker(aiResponse);

            await aggregator.aggregate(mockAI, 'system');

            const updateCall = vi.mocked(mockStore.updateIndex).mock.calls[0];
            expect(updateCall[0]).toBe('system');
            expect(updateCall[1]).toBeUndefined();
            const updates = updateCall[2] as { lastAggregation: string; rawCount: number; factCount: number };
            expect(updates.rawCount).toBe(0);
            expect(updates.factCount).toBe(3);
            expect(updates.lastAggregation).toBeDefined();
            // Verify it's a valid ISO string
            expect(new Date(updates.lastAggregation).toISOString()).toBe(updates.lastAggregation);
        });

        it('deletes raw files after successful write', async () => {
            const filenames = ['a.md', 'b.md', 'c.md'];
            vi.mocked(mockStore.listRaw).mockResolvedValue(filenames);
            filenames.forEach(f => {
                vi.mocked(mockStore.readRaw).mockResolvedValueOnce(makeRawObservation(f, `content ${f}`));
            });

            await aggregator.aggregate(mockAI, 'system');

            expect(mockStore.deleteRaw).toHaveBeenCalledTimes(3);
            expect(mockStore.deleteRaw).toHaveBeenCalledWith('system', undefined, 'a.md');
            expect(mockStore.deleteRaw).toHaveBeenCalledWith('system', undefined, 'b.md');
            expect(mockStore.deleteRaw).toHaveBeenCalledWith('system', undefined, 'c.md');
        });

        it('does NOT delete raw files if AI call fails', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawObservation('a.md', 'obs'));
            const failingAI: AIInvoker = vi.fn().mockResolvedValue({
                success: false,
                error: 'AI service unavailable',
            });

            await expect(aggregator.aggregate(failingAI, 'system')).rejects.toThrow(
                'Aggregation AI call failed: AI service unavailable',
            );

            expect(mockStore.deleteRaw).not.toHaveBeenCalled();
            expect(mockStore.writeConsolidated).not.toHaveBeenCalled();
            expect(mockStore.updateIndex).not.toHaveBeenCalled();
        });

        it('empty raw list is a no-op', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue([]);

            await aggregator.aggregate(mockAI, 'system');

            expect(mockAI).not.toHaveBeenCalled();
            expect(mockStore.writeConsolidated).not.toHaveBeenCalled();
            expect(mockStore.deleteRaw).not.toHaveBeenCalled();
        });
    });

    describe('level=both', () => {
        it('runs aggregation at system and repo levels independently', async () => {
            const systemFiles = ['sys1.md', 'sys2.md'];
            const repoFiles = ['repo1.md', 'repo2.md'];

            vi.mocked(mockStore.listRaw).mockImplementation(async (level) => {
                if (level === 'system') return systemFiles;
                if (level === 'repo') return repoFiles;
                return [];
            });

            vi.mocked(mockStore.readRaw).mockImplementation(async (_level, _hash, filename) => {
                return makeRawObservation(filename!, `content of ${filename}`);
            });

            const systemResponse = '- system fact 1\n- system fact 2';
            const repoResponse = '- repo fact 1';
            let callCount = 0;
            mockAI = vi.fn().mockImplementation(async () => {
                callCount++;
                return {
                    success: true,
                    response: callCount === 1 ? systemResponse : repoResponse,
                };
            });

            await aggregator.aggregate(mockAI, 'both', 'hash1');

            // AI called once for system, once for repo
            expect(mockAI).toHaveBeenCalledTimes(2);

            // writeConsolidated called for both levels
            expect(mockStore.writeConsolidated).toHaveBeenCalledWith('system', systemResponse, undefined);
            expect(mockStore.writeConsolidated).toHaveBeenCalledWith('repo', repoResponse, 'hash1');

            // updateIndex called for both levels
            expect(mockStore.updateIndex).toHaveBeenCalledTimes(2);

            // deleteRaw called for all files
            expect(mockStore.deleteRaw).toHaveBeenCalledTimes(4);
        });
    });

    describe('countFacts', () => {
        it('counts bullet lines correctly', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.md']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawObservation('a.md', 'obs'));
            const aiResponse = '# Section\n- fact one\n- fact two\nsome text\n- fact three';
            mockAI = createMockAIInvoker(aiResponse);

            await aggregator.aggregate(mockAI, 'system');

            const updates = vi.mocked(mockStore.updateIndex).mock.calls[0][2] as { factCount: number };
            expect(updates.factCount).toBe(3);
        });

        it('returns zero for no bullets', () => {
            expect(countFacts('no bullets here\njust text')).toBe(0);
        });

        it('does not count nested bullets', () => {
            expect(countFacts('- top level\n  - nested\n    - deep nested\n- another top')).toBe(2);
        });

        it('counts empty content as zero', () => {
            expect(countFacts('')).toBe(0);
        });
    });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolCallCacheStore, ToolCallQAEntry, ConsolidatedToolCallEntry } from '../../src/memory/tool-call-cache-types';
import type { AIInvoker, AIInvokerResult } from '../../src/map-reduce/types';
import { ToolCallCacheAggregator } from '../../src/memory/tool-call-cache-aggregator';

function makeRawEntry(id: string, question: string, answer: string, toolName = 'grep'): ToolCallQAEntry {
    return {
        id,
        toolName,
        question,
        answer,
        args: {},
        gitHash: 'abc123',
        timestamp: new Date().toISOString(),
    };
}

function makeConsolidatedEntry(id: string, question: string, answer: string): ConsolidatedToolCallEntry {
    return {
        id,
        question,
        answer,
        topics: ['general'],
        gitHash: 'abc123',
        toolSources: ['grep'],
        createdAt: '2025-01-01T00:00:00Z',
        hitCount: 1,
    };
}

function createMockStore(): ToolCallCacheStore {
    return {
        listRaw: vi.fn().mockResolvedValue([]),
        readRaw: vi.fn().mockResolvedValue(undefined),
        writeRaw: vi.fn().mockResolvedValue(''),
        deleteRaw: vi.fn().mockResolvedValue(true),
        readConsolidated: vi.fn().mockResolvedValue([]),
        writeConsolidated: vi.fn().mockResolvedValue(undefined),
        readConsolidatedIndex: vi.fn().mockResolvedValue([]),
        readEntryAnswer: vi.fn().mockResolvedValue(undefined),
        writeConsolidatedEntry: vi.fn().mockResolvedValue(undefined),
        deleteConsolidatedEntry: vi.fn().mockResolvedValue(true),
        readIndex: vi.fn().mockResolvedValue({ lastAggregation: null, rawCount: 0, consolidatedCount: 0 }),
        updateIndex: vi.fn().mockResolvedValue(undefined),
        getStats: vi.fn().mockResolvedValue({ rawCount: 0, consolidatedExists: false, consolidatedCount: 0, lastAggregation: null }),
        clear: vi.fn().mockResolvedValue(undefined),
    } as unknown as ToolCallCacheStore;
}

function createMockAIInvoker(response?: string): AIInvoker {
    const defaultResponse = JSON.stringify([
        { id: 'test-1', question: 'How to X?', answer: 'Do Y.', topics: ['general'], gitHash: null, toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 },
    ]);
    return vi.fn().mockResolvedValue({ success: true, response: response ?? defaultResponse } as AIInvokerResult);
}

describe('ToolCallCacheAggregator', () => {
    let mockStore: ToolCallCacheStore;
    let mockAI: AIInvoker;
    let aggregator: ToolCallCacheAggregator;

    beforeEach(() => {
        mockStore = createMockStore();
        mockAI = createMockAIInvoker();
        aggregator = new ToolCallCacheAggregator(mockStore);
    });

    describe('aggregateIfNeeded', () => {
        it('skips when under threshold', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json', 'b.json', 'c.json']);

            const result = await aggregator.aggregateIfNeeded(mockAI);

            expect(result).toBe(false);
            expect(mockAI).not.toHaveBeenCalled();
        });

        it('triggers when at threshold', async () => {
            const filenames = ['1.json', '2.json', '3.json', '4.json', '5.json'];
            vi.mocked(mockStore.listRaw).mockResolvedValue(filenames);
            filenames.forEach((f, i) => {
                vi.mocked(mockStore.readRaw).mockResolvedValueOnce(
                    makeRawEntry(`id-${i}`, `question ${i}`, `answer ${i}`),
                );
            });

            const result = await aggregator.aggregateIfNeeded(mockAI);

            expect(result).toBe(true);
            expect(mockAI).toHaveBeenCalledTimes(1);
            expect(mockStore.writeConsolidated).toHaveBeenCalled();
            expect(mockStore.deleteRaw).toHaveBeenCalledTimes(5);
        });

        it('custom batchThreshold is respected', async () => {
            const customAggregator = new ToolCallCacheAggregator(mockStore, { batchThreshold: 2 });
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json', 'b.json']);
            vi.mocked(mockStore.readRaw)
                .mockResolvedValueOnce(makeRawEntry('a', 'q-a', 'ans-a'))
                .mockResolvedValueOnce(makeRawEntry('b', 'q-b', 'ans-b'));

            const result = await customAggregator.aggregateIfNeeded(mockAI);

            expect(result).toBe(true);
            expect(mockAI).toHaveBeenCalledTimes(1);
        });
    });

    describe('aggregate', () => {
        it('reads raw entries and calls AI', async () => {
            const filenames = ['x.json', 'y.json'];
            vi.mocked(mockStore.listRaw).mockResolvedValue(filenames);
            vi.mocked(mockStore.readRaw)
                .mockResolvedValueOnce(makeRawEntry('x', 'question X', 'answer X'))
                .mockResolvedValueOnce(makeRawEntry('y', 'question Y', 'answer Y'));

            await aggregator.aggregate(mockAI);

            expect(mockStore.readRaw).toHaveBeenCalledWith('x.json');
            expect(mockStore.readRaw).toHaveBeenCalledWith('y.json');
            const prompt = vi.mocked(mockAI).mock.calls[0][0];
            expect(prompt).toContain('question X');
            expect(prompt).toContain('question Y');
            expect(prompt).toContain('## New Raw Entries (2 entries)');
        });

        it('includes existing consolidated in prompt', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('a', 'q', 'a'));
            const existing = [makeConsolidatedEntry('existing-1', 'existing question', 'existing answer')];
            vi.mocked(mockStore.readConsolidated).mockResolvedValue(existing);

            await aggregator.aggregate(mockAI);

            const prompt = vi.mocked(mockAI).mock.calls[0][0];
            expect(prompt).toContain('## Existing Consolidated Entries');
            expect(prompt).toContain('existing question');
            expect(prompt).toContain('existing answer');
        });

        it('uses fallback text when no consolidated exists', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('a', 'q', 'a'));
            vi.mocked(mockStore.readConsolidated).mockResolvedValue([]);

            await aggregator.aggregate(mockAI);

            const prompt = vi.mocked(mockAI).mock.calls[0][0];
            expect(prompt).toContain('No existing consolidated entries');
        });

        it('writes parsed AI response as consolidated', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('a', 'q', 'a'));
            const aiEntries = [
                { id: 'c-1', question: 'consolidated q', answer: 'consolidated a', topics: ['test'], gitHash: null, toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 2 },
            ];
            mockAI = createMockAIInvoker(JSON.stringify(aiEntries));

            await aggregator.aggregate(mockAI);

            const written = vi.mocked(mockStore.writeConsolidated).mock.calls[0][0] as ConsolidatedToolCallEntry[];
            expect(written).toHaveLength(1);
            expect(written[0].id).toBe('c-1');
            expect(written[0].question).toBe('consolidated q');
            expect(written[0].hitCount).toBe(2);
        });

        it('handles AI response with markdown fences', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('a', 'q', 'a'));
            const entries = [{ id: 'fenced', question: 'q', answer: 'a', topics: [], toolSources: [], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 }];
            mockAI = createMockAIInvoker('```json\n' + JSON.stringify(entries) + '\n```');

            await aggregator.aggregate(mockAI);

            const written = vi.mocked(mockStore.writeConsolidated).mock.calls[0][0] as ConsolidatedToolCallEntry[];
            expect(written).toHaveLength(1);
            expect(written[0].id).toBe('fenced');
        });

        it('updates index with correct metadata', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('a', 'q', 'a'));
            const entries = [
                { id: 'e1', question: 'q1', answer: 'a1', topics: ['arch', 'testing'], toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 },
                { id: 'e2', question: 'q2', answer: 'a2', topics: ['testing', 'git'], toolSources: ['view'], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 },
            ];
            mockAI = createMockAIInvoker(JSON.stringify(entries));

            await aggregator.aggregate(mockAI);

            const updateArgs = vi.mocked(mockStore.updateIndex).mock.calls[0][0];
            expect(updateArgs.rawCount).toBe(0);
            expect(updateArgs.consolidatedCount).toBe(2);
            expect(updateArgs.lastAggregation).toBeDefined();
            expect(new Date(updateArgs.lastAggregation!).toISOString()).toBe(updateArgs.lastAggregation);
        });

        it('deletes raw entries AFTER successful write', async () => {
            const filenames = ['a.json', 'b.json', 'c.json'];
            vi.mocked(mockStore.listRaw).mockResolvedValue(filenames);
            filenames.forEach(f => {
                vi.mocked(mockStore.readRaw).mockResolvedValueOnce(makeRawEntry(f, `q-${f}`, `a-${f}`));
            });

            await aggregator.aggregate(mockAI);

            // Verify ordering: writeConsolidated must be called before any deleteRaw
            const writeOrder = vi.mocked(mockStore.writeConsolidated).mock.invocationCallOrder[0];
            const deleteOrders = vi.mocked(mockStore.deleteRaw).mock.invocationCallOrder;
            for (const deleteOrder of deleteOrders) {
                expect(writeOrder).toBeLessThan(deleteOrder);
            }
            expect(mockStore.deleteRaw).toHaveBeenCalledTimes(3);
            expect(mockStore.deleteRaw).toHaveBeenCalledWith('a.json');
            expect(mockStore.deleteRaw).toHaveBeenCalledWith('b.json');
            expect(mockStore.deleteRaw).toHaveBeenCalledWith('c.json');
        });

        it('preserves raw entries on AI failure', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('a', 'q', 'a'));
            const failingAI: AIInvoker = vi.fn().mockResolvedValue({
                success: false,
                error: 'AI service unavailable',
            });

            await expect(aggregator.aggregate(failingAI)).rejects.toThrow(
                'Tool call cache aggregation failed: AI service unavailable',
            );

            expect(mockStore.deleteRaw).not.toHaveBeenCalled();
            expect(mockStore.writeConsolidated).not.toHaveBeenCalled();
            expect(mockStore.updateIndex).not.toHaveBeenCalled();
        });

        it('preserves raw entries on JSON parse failure', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue(['a.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('a', 'q', 'a'));
            const badAI: AIInvoker = vi.fn().mockResolvedValue({
                success: true,
                response: 'not json at all',
            });

            await expect(aggregator.aggregate(badAI)).rejects.toThrow();

            expect(mockStore.deleteRaw).not.toHaveBeenCalled();
            expect(mockStore.writeConsolidated).not.toHaveBeenCalled();
        });

        it('merges with existing consolidated entries via AI', async () => {
            const existing = [
                makeConsolidatedEntry('old-1', 'old question 1', 'old answer 1'),
                makeConsolidatedEntry('old-2', 'old question 2', 'old answer 2'),
            ];
            vi.mocked(mockStore.readConsolidated).mockResolvedValue(existing);
            vi.mocked(mockStore.listRaw).mockResolvedValue(['new.json']);
            vi.mocked(mockStore.readRaw).mockResolvedValue(makeRawEntry('new', 'new question', 'new answer'));
            const merged = [
                { id: 'old-1', question: 'old question 1', answer: 'updated answer', topics: ['general'], toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 2 },
                { id: 'old-2', question: 'old question 2', answer: 'old answer 2', topics: ['general'], toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 },
                { id: 'new-1', question: 'new question', answer: 'new answer', topics: ['new-topic'], toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 },
            ];
            mockAI = createMockAIInvoker(JSON.stringify(merged));

            await aggregator.aggregate(mockAI);

            const written = vi.mocked(mockStore.writeConsolidated).mock.calls[0][0] as ConsolidatedToolCallEntry[];
            expect(written).toHaveLength(3);
            expect(written[0].hitCount).toBe(2);
        });

        it('empty raw list is a no-op', async () => {
            vi.mocked(mockStore.listRaw).mockResolvedValue([]);

            await aggregator.aggregate(mockAI);

            expect(mockAI).not.toHaveBeenCalled();
            expect(mockStore.writeConsolidated).not.toHaveBeenCalled();
            expect(mockStore.deleteRaw).not.toHaveBeenCalled();
        });
    });

    describe('parseConsolidatedResponse', () => {
        it('parses valid JSON array', () => {
            const input = JSON.stringify([
                { id: 'x', question: 'q', answer: 'a', topics: ['t'], toolSources: ['grep'], createdAt: '2025-01-01T00:00:00Z', hitCount: 3 },
            ]);
            const result = aggregator.parseConsolidatedResponse(input);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('x');
            expect(result[0].hitCount).toBe(3);
        });

        it('strips markdown code fences', () => {
            const inner = JSON.stringify([{ id: 'y', question: 'q', answer: 'a', topics: [], toolSources: [], createdAt: '2025-01-01T00:00:00Z', hitCount: 1 }]);
            const result = aggregator.parseConsolidatedResponse('```json\n' + inner + '\n```');
            expect(result).toHaveLength(1);
            expect(result[0].id).toBe('y');
        });

        it('coerces missing fields with defaults', () => {
            const input = JSON.stringify([{ question: 'only a question' }]);
            const result = aggregator.parseConsolidatedResponse(input);
            expect(result).toHaveLength(1);
            expect(result[0].id).toBeDefined();
            expect(result[0].answer).toBe('');
            expect(result[0].topics).toEqual([]);
            expect(result[0].toolSources).toEqual([]);
            expect(result[0].hitCount).toBe(1);
        });

        it('throws on non-array JSON', () => {
            expect(() => aggregator.parseConsolidatedResponse('{"not": "array"}')).toThrow(
                'AI response is not a JSON array',
            );
        });

        it('throws on non-JSON input', () => {
            expect(() => aggregator.parseConsolidatedResponse('totally not json')).toThrow();
        });
    });
});

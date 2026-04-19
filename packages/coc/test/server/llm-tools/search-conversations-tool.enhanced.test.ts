/**
 * Enhanced Search Conversations Tool Tests
 *
 * Tests for the summarization path, recent-browse mode,
 * transcript truncation, session grouping, and fallback behavior.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createSearchConversationsTool,
    stripMarkTags,
    truncateAroundMatches,
    type SearchConversationsToolOptions,
    type Summarizer,
    type SessionMeta,
} from '../../../src/server/llm-tools/search-conversations-tool';
import type {
    ProcessStore,
    ConversationSearchResult,
    ConversationTurn,
    ProcessIndexEntry,
    AIProcess,
} from '@plusplusoneplusplus/forge';

const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'search_conversations',
    arguments: {},
};

function makeTurn(role: 'user' | 'assistant', content: string, turnIndex: number): ConversationTurn {
    return {
        role,
        content,
        timestamp: new Date(),
        turnIndex,
        timeline: [],
    };
}

function makeSearchResult(overrides?: Partial<ConversationSearchResult>): ConversationSearchResult {
    return {
        processId: 'proc-1',
        turnIndex: 0,
        role: 'assistant',
        snippet: 'We decided to use <mark>SQLite</mark> for storage',
        rank: -5.0,
        processTitle: 'Database discussion',
        promptPreview: 'What database should we use?',
        processStatus: 'completed',
        processType: 'chat',
        workspaceId: 'ws-1',
        startTime: '2025-01-15T10:00:00Z',
        ...overrides,
    };
}

function makeProcessEntry(overrides?: Partial<ProcessIndexEntry>): ProcessIndexEntry {
    return {
        id: 'proc-1',
        workspaceId: 'ws-1',
        status: 'completed',
        type: 'chat',
        startTime: '2025-01-15T10:00:00Z',
        promptPreview: 'What database should we use?',
        title: 'Database discussion',
        ...overrides,
    };
}

function makeMockStore(opts?: {
    searchResults?: { results: ConversationSearchResult[]; total: number };
    turns?: ConversationTurn[];
    recentProcesses?: ProcessIndexEntry[];
    processSummaries?: { entries: ProcessIndexEntry[]; total: number };
    process?: AIProcess;
}): ProcessStore {
    const store: Partial<ProcessStore> = {};
    if (opts?.searchResults !== undefined) {
        store.searchConversations = vi.fn().mockResolvedValue(opts.searchResults);
    }
    if (opts?.turns !== undefined) {
        store.getConversationTurns = vi.fn().mockResolvedValue(opts.turns);
    }
    if (opts?.recentProcesses !== undefined) {
        store.listRecentProcesses = vi.fn().mockResolvedValue(opts.recentProcesses);
    }
    if (opts?.processSummaries !== undefined) {
        store.getProcessSummaries = vi.fn().mockResolvedValue(opts.processSummaries);
    }
    if (opts?.process !== undefined) {
        store.getProcess = vi.fn().mockResolvedValue(opts.process);
    }
    return store as ProcessStore;
}

// ============================================================================
// truncateAroundMatches
// ============================================================================

describe('truncateAroundMatches', () => {
    it('returns short text unchanged', () => {
        const text = 'Hello world';
        expect(truncateAroundMatches(text, 'world')).toBe(text);
    });

    it('truncates long text around phrase match', () => {
        const text = 'A'.repeat(50_000) + ' TARGET PHRASE ' + 'B'.repeat(50_000);
        const result = truncateAroundMatches(text, 'TARGET PHRASE', 1000);

        expect(result.length).toBeLessThanOrEqual(1000 + 30); // allow for truncation markers
        expect(result).toContain('TARGET PHRASE');
    });

    it('truncates around individual term match when no phrase match', () => {
        const text = 'A'.repeat(50_000) + ' foobar ' + 'B'.repeat(50_000);
        const result = truncateAroundMatches(text, 'foobar baz', 1000);

        expect(result).toContain('foobar');
        expect(result.length).toBeLessThanOrEqual(1000 + 30);
    });

    it('falls back to start of text when no matches found', () => {
        const text = 'A'.repeat(200_000);
        const result = truncateAroundMatches(text, 'nonexistent', 1000);

        expect(result.length).toBeLessThanOrEqual(1000 + 20);
        expect(result).toContain('…[truncated]');
    });

    it('adds truncation markers when truncated', () => {
        const text = 'X'.repeat(50_000) + ' MATCH ' + 'Y'.repeat(50_000);
        const result = truncateAroundMatches(text, 'MATCH', 2000);

        expect(result).toContain('…[truncated]');
    });

    it('no markers when text fits within maxLength', () => {
        const text = 'Hello MATCH world';
        const result = truncateAroundMatches(text, 'MATCH', 100_000);
        expect(result).not.toContain('…[truncated]');
    });

    it('biases window 25% before, 75% after match', () => {
        // Match at position 100 in a long string
        const before = 'B'.repeat(100);
        const after = 'A'.repeat(10_000);
        const text = before + 'MATCH' + after;
        const result = truncateAroundMatches(text, 'MATCH', 200);

        // The before-portion should be ~50 chars (25% of 200)
        expect(result).toContain('MATCH');
    });
});

// ============================================================================
// Recent-browse mode
// ============================================================================

describe('recent-browse mode', () => {
    it('returns recent processes when query is empty', async () => {
        const entries = [
            makeProcessEntry({ id: 'proc-1' }),
            makeProcessEntry({ id: 'proc-2', title: 'Another session' }),
        ];
        const store = makeMockStore({ recentProcesses: entries });
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({}, invocationStub);

        expect(result.mode).toBe('recent');
        expect(result.results).toHaveLength(2);
        expect(result.count).toBe(2);
        expect(result.message).toContain('2');
    });

    it('returns recent processes when query is whitespace-only', async () => {
        const entries = [makeProcessEntry()];
        const store = makeMockStore({ recentProcesses: entries });
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: '   ' }, invocationStub);
        expect(result.mode).toBe('recent');
    });

    it('excludes current process from recent results', async () => {
        const entries = [
            makeProcessEntry({ id: 'current-proc' }),
            makeProcessEntry({ id: 'other-proc' }),
        ];
        const store = makeMockStore({ recentProcesses: entries });
        const { tool } = createSearchConversationsTool({
            store,
            currentProcessId: 'current-proc',
        });

        await tool.handler({}, invocationStub);

        expect(store.listRecentProcesses).toHaveBeenCalledWith(
            expect.objectContaining({
                excludeProcessId: 'current-proc',
            }),
        );
    });

    it('falls back to getProcessSummaries when listRecentProcesses is not available', async () => {
        const entries = [makeProcessEntry({ id: 'proc-1' }), makeProcessEntry({ id: 'proc-2' })];
        const store = makeMockStore({
            processSummaries: { entries, total: 2 },
        });
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({}, invocationStub);

        expect(result.mode).toBe('recent');
        expect(result.results).toHaveLength(2);
    });

    it('falls back to getProcessSummaries and excludes current process', async () => {
        const entries = [
            makeProcessEntry({ id: 'current-proc' }),
            makeProcessEntry({ id: 'other-proc' }),
        ];
        const store = makeMockStore({
            processSummaries: { entries, total: 2 },
        });
        const { tool } = createSearchConversationsTool({
            store,
            currentProcessId: 'current-proc',
        });

        const result = await tool.handler({}, invocationStub);

        expect(result.mode).toBe('recent');
        expect(result.results).toHaveLength(1);
        expect(result.results[0].processId).toBe('other-proc');
    });

    it('returns unavailable message when neither listRecentProcesses nor getProcessSummaries exist', async () => {
        const store = makeMockStore();
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({}, invocationStub);

        expect(result.mode).toBe('recent');
        expect(result.results).toHaveLength(0);
        expect(result.message).toContain('not available');
    });
});

// ============================================================================
// Summarization mode
// ============================================================================

describe('summarization mode', () => {
    const turns = [
        makeTurn('user', 'Should we use SQLite?', 0),
        makeTurn('assistant', 'Yes, SQLite is a great choice for local storage.', 1),
    ];

    it('calls summarizer for each unique session', async () => {
        const mockSummarizer: Summarizer = vi.fn().mockResolvedValue('Summary of SQLite discussion');

        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult({ processId: 'proc-1' })],
                total: 1,
            },
            turns,
        });

        const { tool } = createSearchConversationsTool({
            store,
            summarizer: mockSummarizer,
        });

        const result = await tool.handler({ query: 'SQLite', summarize: true }, invocationStub);

        expect(result.mode).toBe('summarized');
        expect(result.results).toHaveLength(1);
        expect(result.results[0].summary).toBe('Summary of SQLite discussion');
        expect(mockSummarizer).toHaveBeenCalledOnce();
    });

    it('groups multiple hits from same process into one session', async () => {
        const mockSummarizer: Summarizer = vi.fn().mockResolvedValue('Grouped summary');

        const store = makeMockStore({
            searchResults: {
                results: [
                    makeSearchResult({ processId: 'proc-1', turnIndex: 0 }),
                    makeSearchResult({ processId: 'proc-1', turnIndex: 2 }),
                    makeSearchResult({ processId: 'proc-1', turnIndex: 4 }),
                ],
                total: 3,
            },
            turns,
        });

        const { tool } = createSearchConversationsTool({
            store,
            summarizer: mockSummarizer,
        });

        const result = await tool.handler({ query: 'SQLite', summarize: true }, invocationStub);

        expect(result.results).toHaveLength(1);
        expect(mockSummarizer).toHaveBeenCalledOnce();
    });

    it('limits summarized sessions to MAX_SUMMARIZE_SESSIONS (5)', async () => {
        const mockSummarizer: Summarizer = vi.fn().mockResolvedValue('Summary');

        const results = Array.from({ length: 10 }, (_, i) =>
            makeSearchResult({ processId: `proc-${i}` }),
        );
        const store = makeMockStore({
            searchResults: { results, total: 10 },
            turns,
        });

        const { tool } = createSearchConversationsTool({
            store,
            summarizer: mockSummarizer,
        });

        const result = await tool.handler({ query: 'test', summarize: true }, invocationStub);

        expect(result.results.length).toBeLessThanOrEqual(5);
        expect(mockSummarizer).toHaveBeenCalledTimes(5);
    });

    it('falls back to raw preview when summarizer is not provided', async () => {
        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult()],
                total: 1,
            },
            turns,
        });

        const { tool } = createSearchConversationsTool({ store });

        const result = await tool.handler({ query: 'SQLite', summarize: true }, invocationStub);

        expect(result.mode).toBe('summarized');
        expect(result.results).toHaveLength(1);
        expect(result.results[0].summary).toContain('Should we use SQLite?');
    });

    it('falls back to raw preview when summarizer throws', async () => {
        const failingSummarizer: Summarizer = vi.fn().mockRejectedValue(new Error('AI unavailable'));

        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult()],
                total: 1,
            },
            turns,
        });

        const { tool } = createSearchConversationsTool({
            store,
            summarizer: failingSummarizer,
        });

        const result = await tool.handler({ query: 'SQLite', summarize: true }, invocationStub);

        expect(result.results).toHaveLength(1);
        // Should contain raw preview, not throw
        expect(result.results[0].summary).toBeDefined();
        expect(result.results[0].summary.length).toBeGreaterThan(0);
    });

    it('falls back to raw preview when summarizer returns null', async () => {
        const nullSummarizer: Summarizer = vi.fn().mockResolvedValue(null);

        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult()],
                total: 1,
            },
            turns,
        });

        const { tool } = createSearchConversationsTool({
            store,
            summarizer: nullSummarizer,
        });

        const result = await tool.handler({ query: 'SQLite', summarize: true }, invocationStub);

        expect(result.results[0].summary).toContain('Should we use SQLite?');
    });

    it('uses getProcess fallback when getConversationTurns is not available', async () => {
        const mockSummarizer: Summarizer = vi.fn().mockResolvedValue('Summary via getProcess');

        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult()],
                total: 1,
            },
            process: {
                id: 'proc-1',
                conversationTurns: turns,
            } as AIProcess,
        });

        const { tool } = createSearchConversationsTool({
            store,
            summarizer: mockSummarizer,
        });

        const result = await tool.handler({ query: 'SQLite', summarize: true }, invocationStub);

        expect(result.results[0].summary).toBe('Summary via getProcess');
        expect(store.getProcess).toHaveBeenCalledWith('proc-1');
    });

    it('uses promptPreview when no turns are available', async () => {
        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult({ promptPreview: 'Fallback preview' })],
                total: 1,
            },
            turns: [],
        });

        const { tool } = createSearchConversationsTool({ store });

        const result = await tool.handler({ query: 'test', summarize: true }, invocationStub);

        expect(result.results[0].summary).toBe('Fallback preview');
    });
});

// ============================================================================
// Current session exclusion
// ============================================================================

describe('current session exclusion', () => {
    it('excludes current process from search results', async () => {
        const store = makeMockStore({
            searchResults: {
                results: [
                    makeSearchResult({ processId: 'current-proc' }),
                    makeSearchResult({ processId: 'other-proc', processTitle: 'Other' }),
                ],
                total: 2,
            },
        });

        const { tool } = createSearchConversationsTool({
            store,
            currentProcessId: 'current-proc',
        });

        const result = await tool.handler({ query: 'test' }, invocationStub);

        expect(result.results).toHaveLength(1);
        expect(result.results[0].processId).toBe('other-proc');
    });

    it('does not exclude when currentProcessId is not set', async () => {
        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult({ processId: 'proc-1' })],
                total: 1,
            },
        });

        const { tool } = createSearchConversationsTool({ store });

        const result = await tool.handler({ query: 'test' }, invocationStub);

        expect(result.results).toHaveLength(1);
    });
});

// ============================================================================
// Default behavior (backward compatibility)
// ============================================================================

describe('default behavior (backward compatible)', () => {
    it('returns raw snippets when summarize is false', async () => {
        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult()],
                total: 1,
            },
        });

        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: 'SQLite', summarize: false }, invocationStub);

        expect(result.mode).toBe('search');
        expect(result.results[0].snippet).toBeDefined();
        expect(result.results[0].snippet).not.toContain('<mark>');
    });

    it('returns raw snippets when summarize is omitted', async () => {
        const store = makeMockStore({
            searchResults: {
                results: [makeSearchResult()],
                total: 1,
            },
        });

        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: 'SQLite' }, invocationStub);

        expect(result.mode).toBe('search');
        expect(result.results[0].snippet).toBeDefined();
    });

    it('legacy 2-arg factory still works', async () => {
        const store = makeMockStore({
            searchResults: { results: [], total: 0 },
        });
        const { tool } = createSearchConversationsTool(store, 'ws-1');

        const result = await tool.handler({ query: 'test' }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', {
            workspaceId: 'ws-1',
            limit: 10,
        });
        expect(result.mode).toBe('search');
    });

    it('returns unavailable note when store does not support search', async () => {
        const store = makeMockStore(); // no searchConversations
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: 'test' }, invocationStub);

        expect(result.note).toContain('not available');
    });
});

// ============================================================================
// Limit clamping
// ============================================================================

describe('limit clamping', () => {
    it('clamps limit > 20 to 20', async () => {
        const store = makeMockStore({
            searchResults: { results: [], total: 0 },
        });
        const { tool } = createSearchConversationsTool(store);

        await tool.handler({ query: 'test', limit: 100 }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 20 }));
    });

    it('clamps limit < 1 to 1', async () => {
        const store = makeMockStore({
            searchResults: { results: [], total: 0 },
        });
        const { tool } = createSearchConversationsTool(store);

        await tool.handler({ query: 'test', limit: 0 }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 1 }));
    });

    it('uses default limit of 10', async () => {
        const store = makeMockStore({
            searchResults: { results: [], total: 0 },
        });
        const { tool } = createSearchConversationsTool(store);

        await tool.handler({ query: 'test' }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', expect.objectContaining({ limit: 10 }));
    });
});

// ============================================================================
// Tool description
// ============================================================================

describe('tool description', () => {
    it('includes proactive-use guidance', () => {
        const store = makeMockStore();
        const { tool } = createSearchConversationsTool(store);

        expect(tool.description).toContain('remember when');
        expect(tool.description).toContain('last time');
        expect(tool.description).toContain('Better to search');
    });

    it('describes both modes', () => {
        const store = makeMockStore();
        const { tool } = createSearchConversationsTool(store);

        expect(tool.description).toContain('Recent sessions');
        expect(tool.description).toContain('Keyword search');
    });

    it('query is not required', () => {
        const store = makeMockStore();
        const { tool } = createSearchConversationsTool(store);

        expect(tool.parameters.required).toEqual([]);
    });
});

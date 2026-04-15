/**
 * Search Conversations Tool Tests
 *
 * Unit tests for the createSearchConversationsTool factory and stripMarkTags helper.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    createSearchConversationsTool,
    stripMarkTags,
} from '../../../src/server/llm-tools/search-conversations-tool';
import type { ProcessStore, ConversationSearchResult } from '@plusplusoneplusplus/forge';

// Minimal invocation stub for handler calls
const invocationStub = {
    sessionId: 'session-1',
    toolCallId: 'call-1',
    toolName: 'search_conversations',
    arguments: {},
};

function makeMockStore(searchResults?: { results: ConversationSearchResult[]; total: number }): ProcessStore {
    const store: Partial<ProcessStore> = {};
    if (searchResults !== undefined) {
        store.searchConversations = vi.fn().mockResolvedValue(searchResults);
    }
    return store as ProcessStore;
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

describe('stripMarkTags', () => {
    it('strips <mark> and </mark> tags', () => {
        expect(stripMarkTags('Hello <mark>world</mark>!')).toBe('Hello world!');
    });

    it('handles multiple mark tags', () => {
        expect(stripMarkTags('<mark>a</mark> and <mark>b</mark>')).toBe('a and b');
    });

    it('returns unchanged text when no mark tags present', () => {
        expect(stripMarkTags('plain text')).toBe('plain text');
    });

    it('handles empty string', () => {
        expect(stripMarkTags('')).toBe('');
    });

    it('handles consecutive mark tags', () => {
        expect(stripMarkTags('<mark></mark><mark>test</mark>')).toBe('test');
    });
});

describe('createSearchConversationsTool', () => {
    it('returns a valid Tool shape', () => {
        const store = makeMockStore({ results: [], total: 0 });
        const { tool } = createSearchConversationsTool(store);

        expect(tool.name).toBe('search_conversations');
        expect(typeof tool.handler).toBe('function');
        expect(tool.description).toBeDefined();
        expect(tool.parameters).toEqual({
            type: 'object',
            properties: {
                query: { type: 'string', description: expect.any(String) },
                workspaceId: { type: 'string', description: expect.any(String) },
                limit: { type: 'number', description: expect.any(String) },
            },
            required: ['query'],
        });
    });

    it('returns empty results when store does not support searchConversations', async () => {
        const store = makeMockStore(); // no searchConversations method
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: 'test' }, invocationStub);

        expect(result).toEqual({
            results: [],
            total: 0,
            query: 'test',
            note: 'Conversation search is not available (requires SQLite backend)',
        });
    });

    it('returns search results with <mark> tags stripped', async () => {
        const searchResult = makeSearchResult();
        const store = makeMockStore({ results: [searchResult], total: 1 });
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: 'SQLite' }, invocationStub);

        expect(result.results).toHaveLength(1);
        expect(result.results[0].snippet).toBe('We decided to use SQLite for storage');
        expect(result.results[0].snippet).not.toContain('<mark>');
        expect(result.total).toBe(1);
        expect(result.query).toBe('SQLite');
    });

    it('uses processTitle when available, falls back to promptPreview', async () => {
        const withTitle = makeSearchResult({ processTitle: 'My Title', promptPreview: 'My Prompt' });
        const withoutTitle = makeSearchResult({ processTitle: undefined, promptPreview: 'Fallback Prompt' });
        const store = makeMockStore({ results: [withTitle, withoutTitle], total: 2 });
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: 'test' }, invocationStub);

        expect(result.results[0].title).toBe('My Title');
        expect(result.results[1].title).toBe('Fallback Prompt');
    });

    it('passes default workspaceId from factory to store', async () => {
        const store = makeMockStore({ results: [], total: 0 });
        const { tool } = createSearchConversationsTool(store, 'default-ws');

        await tool.handler({ query: 'test' }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', {
            workspaceId: 'default-ws',
            limit: 10,
        });
    });

    it('overrides default workspaceId when provided in args', async () => {
        const store = makeMockStore({ results: [], total: 0 });
        const { tool } = createSearchConversationsTool(store, 'default-ws');

        await tool.handler({ query: 'test', workspaceId: 'override-ws' }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', {
            workspaceId: 'override-ws',
            limit: 10,
        });
    });

    it('caps limit at 20', async () => {
        const store = makeMockStore({ results: [], total: 0 });
        const { tool } = createSearchConversationsTool(store);

        await tool.handler({ query: 'test', limit: 100 }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', {
            workspaceId: undefined,
            limit: 20,
        });
    });

    it('uses default limit of 10 when not specified', async () => {
        const store = makeMockStore({ results: [], total: 0 });
        const { tool } = createSearchConversationsTool(store);

        await tool.handler({ query: 'test' }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', {
            workspaceId: undefined,
            limit: 10,
        });
    });

    it('enforces minimum limit of 1', async () => {
        const store = makeMockStore({ results: [], total: 0 });
        const { tool } = createSearchConversationsTool(store);

        await tool.handler({ query: 'test', limit: 0 }, invocationStub);

        expect(store.searchConversations).toHaveBeenCalledWith('test', {
            workspaceId: undefined,
            limit: 1,
        });
    });

    it('returns only the token-efficient fields', async () => {
        const searchResult = makeSearchResult();
        const store = makeMockStore({ results: [searchResult], total: 1 });
        const { tool } = createSearchConversationsTool(store);

        const result = await tool.handler({ query: 'test' }, invocationStub);

        const item = result.results[0];
        expect(Object.keys(item).sort()).toEqual(['processId', 'snippet', 'startTime', 'status', 'title']);
    });

    it('separate factory invocations are isolated', async () => {
        const store1 = makeMockStore({ results: [], total: 0 });
        const store2 = makeMockStore({ results: [makeSearchResult()], total: 1 });

        const { tool: tool1 } = createSearchConversationsTool(store1, 'ws-1');
        const { tool: tool2 } = createSearchConversationsTool(store2, 'ws-2');

        const result1 = await tool1.handler({ query: 'test' }, invocationStub);
        const result2 = await tool2.handler({ query: 'test' }, invocationStub);

        expect(result1.total).toBe(0);
        expect(result2.total).toBe(1);
    });
});

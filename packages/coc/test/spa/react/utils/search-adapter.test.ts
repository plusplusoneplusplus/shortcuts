/**
 * Tests for search-adapter utility — adaptSearchResultToTask, adaptSearchResults,
 * and deduplicateSearchResults.
 */

import { describe, it, expect } from 'vitest';
import {
    adaptSearchResultToTask,
    adaptSearchResults,
    deduplicateSearchResults,
} from '../../../../src/server/spa/client/react/utils/search-adapter';
import type { ProcessSearchResult } from '../../../../src/server/spa/client/react/processes/hooks/useProcessSearch';

function makeSearchResult(overrides: Partial<ProcessSearchResult> = {}): ProcessSearchResult {
    return {
        processId: 'proc-1',
        turnIndex: 0,
        role: 'assistant',
        snippet: 'found <mark>query</mark> in response',
        rank: 1.5,
        processTitle: 'Test Process',
        promptPreview: 'some prompt preview',
        processStatus: 'completed',
        processType: 'chat',
        workspaceId: 'ws-1',
        startTime: '2026-01-15T10:00:00Z',
        ...overrides,
    };
}

describe('adaptSearchResultToTask', () => {
    it('maps all fields correctly', () => {
        const result = makeSearchResult();
        const task = adaptSearchResultToTask(result);

        expect(task.id).toBe('proc-1');
        expect(task.type).toBe('chat');
        expect(task.status).toBe('completed');
        expect(task.workspaceId).toBe('ws-1');
        expect(task.displayName).toBe('Test Process');
        expect(task.title).toBe('Test Process');
        expect(task.promptPreview).toBe('some prompt preview');
        expect(task.completedAt).toBe('2026-01-15T10:00:00Z');
        expect(task.endTime).toBe('2026-01-15T10:00:00Z');
        expect(task._searchSnippet).toBe('found <mark>query</mark> in response');
        expect(task._isSearchResult).toBe(true);
    });

    it('falls back to processId when processTitle is undefined', () => {
        const result = makeSearchResult({ processTitle: undefined });
        const task = adaptSearchResultToTask(result);

        expect(task.displayName).toBe('proc-1');
        expect(task.title).toBe('proc-1');
    });

    it('preserves failed status', () => {
        const result = makeSearchResult({ processStatus: 'failed' });
        const task = adaptSearchResultToTask(result);
        expect(task.status).toBe('failed');
    });

    it('preserves cancelled status', () => {
        const result = makeSearchResult({ processStatus: 'cancelled' });
        const task = adaptSearchResultToTask(result);
        expect(task.status).toBe('cancelled');
    });

    it('preserves different process types', () => {
        const result = makeSearchResult({ processType: 'run-workflow' });
        const task = adaptSearchResultToTask(result);
        expect(task.type).toBe('run-workflow');
    });
});

describe('deduplicateSearchResults', () => {
    it('returns unique results by processId', () => {
        const results = [
            makeSearchResult({ processId: 'p1', turnIndex: 0, rank: 2.0 }),
            makeSearchResult({ processId: 'p1', turnIndex: 1, rank: 1.0 }),
            makeSearchResult({ processId: 'p2', turnIndex: 0, rank: 3.0 }),
        ];
        const deduped = deduplicateSearchResults(results);

        expect(deduped).toHaveLength(2);
        expect(deduped.map(r => r.processId)).toEqual(['p1', 'p2']);
    });

    it('keeps the best rank (lowest) per processId', () => {
        const results = [
            makeSearchResult({ processId: 'p1', rank: 5.0, snippet: 'worse' }),
            makeSearchResult({ processId: 'p1', rank: 1.0, snippet: 'best' }),
            makeSearchResult({ processId: 'p1', rank: 3.0, snippet: 'medium' }),
        ];
        const deduped = deduplicateSearchResults(results);

        expect(deduped).toHaveLength(1);
        expect(deduped[0].rank).toBe(1.0);
        expect(deduped[0].snippet).toBe('best');
    });

    it('returns empty array for empty input', () => {
        expect(deduplicateSearchResults([])).toEqual([]);
    });

    it('returns single item unchanged', () => {
        const results = [makeSearchResult({ processId: 'only' })];
        const deduped = deduplicateSearchResults(results);
        expect(deduped).toHaveLength(1);
        expect(deduped[0].processId).toBe('only');
    });
});

describe('adaptSearchResults', () => {
    it('deduplicates and adapts in one step', () => {
        const results = [
            makeSearchResult({ processId: 'p1', turnIndex: 0, rank: 2.0 }),
            makeSearchResult({ processId: 'p1', turnIndex: 1, rank: 1.0 }),
            makeSearchResult({ processId: 'p2', turnIndex: 0, rank: 3.0 }),
        ];
        const tasks = adaptSearchResults(results);

        expect(tasks).toHaveLength(2);
        expect(tasks[0].id).toBe('p1');
        expect(tasks[0]._isSearchResult).toBe(true);
        expect(tasks[1].id).toBe('p2');
    });

    it('returns empty array for empty input', () => {
        expect(adaptSearchResults([])).toEqual([]);
    });
});

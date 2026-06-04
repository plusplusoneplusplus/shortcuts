/**
 * Adapts ProcessSearchResult from the FTS5 search API into task-like objects
 * compatible with ChatListPane's Card rendering.
 */

import type { ProcessSearchResult } from '../processes/hooks/useProcessSearch';

export interface SearchResultTask {
    id: string;
    type: string;
    status: string;
    workspaceId: string;
    displayName: string;
    title: string;
    promptPreview: string;
    completedAt: string;
    endTime: string;
    /** FTS5 snippet with <mark> highlights */
    _searchSnippet: string;
    /** Whether this item came from a search result */
    _isSearchResult: true;
}

/**
 * Deduplicate search results by processId, keeping only the highest-ranked
 * (lowest rank value) result per process.
 */
export function deduplicateSearchResults(results: ProcessSearchResult[]): ProcessSearchResult[] {
    const seen = new Map<string, ProcessSearchResult>();
    for (const r of results) {
        const existing = seen.get(r.processId);
        if (!existing || r.rank < existing.rank) {
            seen.set(r.processId, r);
        }
    }
    return Array.from(seen.values());
}

export function adaptSearchResultToTask(result: ProcessSearchResult): SearchResultTask {
    return {
        id: result.processId,
        type: result.processType,
        status: result.processStatus,
        workspaceId: result.workspaceId,
        displayName: result.processTitle || result.processId,
        title: result.processTitle || result.processId,
        promptPreview: result.promptPreview,
        completedAt: result.startTime,
        endTime: result.startTime,
        _searchSnippet: result.snippet,
        _isSearchResult: true,
    };
}

export function adaptSearchResults(results: ProcessSearchResult[]): SearchResultTask[] {
    return deduplicateSearchResults(results).map(adaptSearchResultToTask);
}

/**
 * memoryApi — typed wrappers over the repo-scoped memory REST endpoints.
 */

import { fetchApi } from '../../hooks/useApi';
import { getApiBase } from '../../utils/config';

// ── Shared types ────────────────────────────────────────────────────────────

export interface FeedItem {
    id: string;
    type: 'observation' | 'note';
    source: string;
    content: string;
    tags: string[];
    createdAt: string;
}

export interface MemoryStats {
    observationCount: number;
    noteCount: number;
    consolidatedAt: string | null;
}

export interface FeedResponse {
    items: FeedItem[];
    consolidatedAt: string | null;
    totalCount: number;
}

export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged';
    text: string;
}

// ── API helpers ─────────────────────────────────────────────────────────────

export const memoryApi = {
    getStats(repoId: string): Promise<MemoryStats> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/stats`);
    },

    getConsolidated(repoId: string): Promise<{ content: string }> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/consolidated`);
    },

    getFeed(repoId: string): Promise<FeedResponse> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/feed`);
    },

    addNote(repoId: string, content: string, tags: string[]): Promise<FeedItem> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, tags }),
        });
    },

    deleteFeedItem(repoId: string, id: string, type: string): Promise<void> {
        return fetchApi(
            `/repos/${encodeURIComponent(repoId)}/memory/feed/${encodeURIComponent(id)}?type=${encodeURIComponent(type)}`,
            { method: 'DELETE' },
        );
    },

    /** Returns an EventSource for SSE streaming from the aggregate endpoint. */
    aggregate(repoId: string, sources: string[], model: string): EventSource {
        const params = new URLSearchParams({ sources: sources.join(','), model });
        const url = `${getApiBase()}/repos/${encodeURIComponent(repoId)}/memory/aggregate?${params}`;
        return new EventSource(url);
    },

    acceptAggregate(repoId: string): Promise<void> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/aggregate/accept`, {
            method: 'POST',
        });
    },

    revertAggregate(repoId: string): Promise<void> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/aggregate/revert`, {
            method: 'POST',
        });
    },
};

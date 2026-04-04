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
    consolidationStatus?: 'idle' | 'queued' | 'running';
    consolidationTaskId?: string;
    consolidationProcessId?: string;
}

export interface MemoryOverviewResponse extends MemoryStats {
    items: FeedItem[];
    totalCount: number;
}

export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged';
    text: string;
}

// ── API helpers ─────────────────────────────────────────────────────────────

export const memoryApi = {
    getOverview(repoId: string): Promise<MemoryOverviewResponse> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/overview`);
    },

    getConsolidated(repoId: string): Promise<{ content: string }> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/consolidated`);
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

    /** Enqueue a memory-aggregate task. Returns { taskId, processId } or throws on 409. */
    async aggregate(repoId: string, sources: string[], model: string): Promise<{ taskId: string; processId: string; status?: string }> {
        const res = await fetch(`${getApiBase()}/repos/${encodeURIComponent(repoId)}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sources, model }),
        });
        const data = await res.json();
        if (res.status === 409) {
            return { taskId: data.taskId, processId: data.processId, status: 'already-running' };
        }
        if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
        return data;
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

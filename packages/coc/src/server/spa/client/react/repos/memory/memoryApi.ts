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
    charCount: number;
    charLimit: number;
    lastModified: string | null;
    pendingRawCount: number;
    claimedRawCount: number;
    consolidatedAt: string | null;
    consolidationStatus?: 'idle' | 'queued' | 'running';
    consolidationTaskId?: string;
    consolidationProcessId?: string;
    lastAggregatedAt?: string | null;
    lastAggregateError?: string | null;
}

export interface MemoryOverviewResponse extends MemoryStats {}

export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged';
    text: string;
}

export interface BoundedMemoryResponse {
    content: string;
    charCount: number;
    charLimit: number;
    lastModified: string | null;
}

export interface BoundedMemorySaveResponse {
    charCount: number;
    charLimit: number;
    lastModified: string;
}

// ── API helpers ─────────────────────────────────────────────────────────────

export const memoryApi = {
    getOverview(repoId: string): Promise<MemoryOverviewResponse> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/overview`);
    },

    /** Enqueue a memory-aggregate task. Returns { taskId, status } or 409 with already-queued/already-running. */
    async aggregate(repoId: string, model?: string, target?: string): Promise<{ taskId: string; processId: string | null; status: string }> {
        const res = await fetch(`${getApiBase()}/repos/${encodeURIComponent(repoId)}/memory/aggregate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: model || undefined, target: target || undefined }),
        });
        const data = await res.json();
        if (res.status === 409) {
            return { taskId: data.taskId, processId: data.processId, status: data.status };
        }
        if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
        return data;
    },

    /** Read the consolidated (bounded) MEMORY.md content for a workspace. */
    getConsolidated(repoId: string): Promise<{ content: string | null }> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/bounded`);
    },

    /** Read bounded MEMORY.md for a workspace. */
    getBounded(repoId: string): Promise<BoundedMemoryResponse> {
        return fetchApi(`/repos/${encodeURIComponent(repoId)}/memory/bounded`);
    },

    /** Write bounded MEMORY.md for a workspace. Runs security scan server-side. */
    async saveBounded(repoId: string, content: string): Promise<BoundedMemorySaveResponse> {
        const res = await fetch(`${getApiBase()}/repos/${encodeURIComponent(repoId)}/memory/bounded`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        const data = await res.json();
        if (!res.ok) {
            if (res.status === 422) {
                throw new Error(`Security violation: ${data.violations?.join(', ') ?? 'Content blocked'}`);
            }
            if (res.status === 413) {
                throw new Error(`Content exceeds limit: ${data.charCount}/${data.charLimit} chars`);
            }
            throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        return data;
    },
};

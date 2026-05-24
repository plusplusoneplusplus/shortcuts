/**
 * memoryV2Api — typed wrappers for the coc-memory v2 REST endpoints.
 *
 * All endpoints are workspace-scoped:
 *   /api/workspaces/:wsId/memory/v2/...
 *
 * Functions throw on HTTP error (4xx/5xx). Callers catch with try/catch.
 */

import { getSpaApiUrl } from '../../api/cocClient';

// ── Types (mirroring coc-memory package) ─────────────────────────────────────

export type MemoryScope = 'global' | 'workspace';

export type MemoryFactStatus = 'active' | 'review' | 'rejected' | 'archived';

export type MemoryFactSource = 'explicit' | 'auto-extracted' | 'imported';

export interface MemoryFact {
    id: string;
    scope: MemoryScope;
    workspaceId?: string;
    content: string;
    importance: number;
    confidence: number;
    status: MemoryFactStatus;
    tags: string[];
    source: MemoryFactSource;
    sourceProcessId?: string;
    sourceTurnIndex?: number;
    sourceRalphIteration?: number;
    createdAt: string;
    updatedAt: string;
    recalledCount: number;
    lastRecalledAt?: string;
}

export type MemoryEpisodeEventType = 'chat-turn' | 'ralph-iteration' | 'note-session' | 'commit-chat';

export interface MemoryEpisode {
    id: string;
    scope: MemoryScope;
    workspaceId?: string;
    processId: string;
    sessionId?: string;
    ralphId?: string;
    turnIndex?: number;
    iterationIndex?: number;
    summary: string;
    eventType: MemoryEpisodeEventType;
    createdAt: string;
    provenance: {
        createdBy: 'user' | 'ai' | 'system';
        extractedFrom?: string;
        model?: string;
        version: number;
    };
}

export interface MemoryV2ExportData {
    version: number;
    exportedAt: string;
    scope: MemoryScope;
    workspaceId?: string;
    facts: MemoryFact[];
    episodes: MemoryEpisode[];
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function request<T>(
    method: string,
    path: string,
    body?: unknown,
): Promise<T> {
    const url = getSpaApiUrl(path);
    const opts: RequestInit = { method };
    if (body !== undefined) {
        opts.body = JSON.stringify(body);
        opts.headers = { 'Content-Type': 'application/json' };
    }
    const res = await fetch(url, opts);
    const json = await res.json().catch(() => ({ error: res.statusText }));
    if (!res.ok) {
        throw new Error(json?.error ?? `HTTP ${res.status}`);
    }
    return json as T;
}

const base = (wsId: string) => `/api/workspaces/${encodeURIComponent(wsId)}/memory/v2`;

// ── API surface ───────────────────────────────────────────────────────────────

export interface ListFactsOptions {
    q?: string;
    status?: MemoryFactStatus | MemoryFactStatus[];
    limit?: number;
}

export const memoryV2Api = {
    /** List or search facts. Pass `q` for text search, `status` to filter by status. */
    async listFacts(wsId: string, opts: ListFactsOptions = {}): Promise<MemoryFact[]> {
        const params = new URLSearchParams();
        if (opts.q) params.set('q', opts.q);
        if (Array.isArray(opts.status)) {
            opts.status.forEach(s => params.append('status', s));
        } else if (opts.status) {
            params.set('status', opts.status);
        }
        if (opts.limit) params.set('limit', String(opts.limit));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const res = await request<{ facts: unknown[] }>('GET', `${base(wsId)}/facts${qs}`);
        return res.facts as MemoryFact[];
    },

    /** Create an explicit fact. */
    async createFact(
        wsId: string,
        content: string,
        opts: { importance?: number; tags?: string[]; sourceProcessId?: string } = {},
    ): Promise<MemoryFact> {
        const res = await request<{ fact: MemoryFact }>('POST', `${base(wsId)}/facts`, {
            content,
            importance: opts.importance,
            tags: opts.tags ?? [],
            sourceProcessId: opts.sourceProcessId,
        });
        return res.fact;
    },

    /** Partial-update a fact (content, importance, tags, status). */
    async updateFact(
        wsId: string,
        factId: string,
        updates: Partial<Pick<MemoryFact, 'content' | 'importance' | 'tags' | 'status'>>,
    ): Promise<MemoryFact> {
        const res = await request<{ fact: MemoryFact }>(
            'PATCH',
            `${base(wsId)}/facts/${encodeURIComponent(factId)}`,
            updates,
        );
        return res.fact;
    },

    /** Permanently delete a fact. */
    async deleteFact(wsId: string, factId: string): Promise<void> {
        await request<{ deleted: boolean }>(
            'DELETE',
            `${base(wsId)}/facts/${encodeURIComponent(factId)}`,
        );
    },

    /** Fetch all facts in the review queue. */
    async listReview(wsId: string): Promise<MemoryFact[]> {
        const res = await request<{ facts: MemoryFact[] }>('GET', `${base(wsId)}/review`);
        return res.facts;
    },

    /**
     * Approve a review fact, promoting it to 'active'.
     * Optionally pass `editedContent` for edit-and-approve.
     */
    async approveReview(wsId: string, factId: string, editedContent?: string): Promise<MemoryFact> {
        const body = editedContent !== undefined ? { content: editedContent } : {};
        const res = await request<{ fact: MemoryFact }>(
            'POST',
            `${base(wsId)}/review/${encodeURIComponent(factId)}/approve`,
            body,
        );
        return res.fact;
    },

    /** Reject a review fact, moving it to 'rejected'. */
    async rejectReview(wsId: string, factId: string): Promise<MemoryFact> {
        const res = await request<{ fact: MemoryFact }>(
            'POST',
            `${base(wsId)}/review/${encodeURIComponent(factId)}/reject`,
        );
        return res.fact;
    },

    /** List episodes for this workspace. */
    async listEpisodes(wsId: string, limit = 50): Promise<MemoryEpisode[]> {
        const res = await request<{ episodes: MemoryEpisode[] }>(
            'GET',
            `${base(wsId)}/episodes?limit=${limit}`,
        );
        return res.episodes;
    },

    /** Export all facts and episodes for this workspace's active scope. */
    async exportData(wsId: string): Promise<MemoryV2ExportData> {
        return request<MemoryV2ExportData>('GET', `${base(wsId)}/export`);
    },

    /**
     * Wipe all facts and episodes for this workspace's active scope.
     * Requires explicit confirmation.
     */
    async wipe(wsId: string): Promise<void> {
        await request<{ wiped: boolean }>('DELETE', `${base(wsId)}/wipe`, { confirm: true });
    },
};

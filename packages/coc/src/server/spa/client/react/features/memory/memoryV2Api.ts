/**
 * memoryV2Api - typed wrappers for the coc-memory v2 REST endpoints.
 *
 * All workspace-scoped endpoints use:
 *   /api/workspaces/:wsId/memory/v2/...
 *
 * Use wsId="global" to address the global memory scope via the same routes.
 *
 * The scope listing endpoint is at /api/memory/v2/scopes.
 *
 * Functions throw on HTTP error (4xx/5xx). Callers catch with try/catch.
 */

import type {
    ListFactsOptions,
    MemoryEpisode,
    MemoryEpisodeEventType,
    MemoryFact,
    MemoryScopeInfo,
    MemoryV2ExportData,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage } from '../../api/cocClient';

export type {
    ListFactsOptions,
    MemoryEpisode,
    MemoryEpisodeEventType,
    MemoryFact,
    MemoryFactSource,
    MemoryFactStatus,
    MemoryScope,
    MemoryScopeInfo,
    MemoryV2ExportData,
} from '@plusplusoneplusplus/coc-client';

async function runMemoryV2Request<T>(request: () => Promise<T>): Promise<T> {
    try {
        return await request();
    } catch (error) {
        throw new Error(getSpaCocClientErrorMessage(error, 'Memory v2 request failed'));
    }
}

// ── API surface ───────────────────────────────────────────────────────────────

export const memoryV2Api = {
    /** List all memory scopes (Global + registered workspaces). */
    async listScopes(): Promise<MemoryScopeInfo[]> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.listMemoryScopes());
    },

    /** Enable global memory scope. */
    async enableGlobalScope(): Promise<void> {
        await runMemoryV2Request(() =>
            getSpaCocClient().preferences.patchGlobal({ memoryV2: { enabled: true } } as any)
        );
    },

    /** Disable global memory scope. */
    async disableGlobalScope(): Promise<void> {
        await runMemoryV2Request(() =>
            getSpaCocClient().preferences.patchGlobal({ memoryV2: { enabled: false } } as any)
        );
    },

    /** Enable memory V2 for a workspace scope. */
    async enableWorkspaceScope(wsId: string): Promise<void> {
        await runMemoryV2Request(() =>
            getSpaCocClient().preferences.patchRepo(wsId, { memoryV2: { enabled: true } } as any)
        );
    },

    /** Disable memory V2 for a workspace scope. */
    async disableWorkspaceScope(wsId: string): Promise<void> {
        await runMemoryV2Request(() =>
            getSpaCocClient().preferences.patchRepo(wsId, { memoryV2: { enabled: false } } as any)
        );
    },

    /** List or search facts. Pass `q` for text search, `status` to filter by status. */
    async listFacts(wsId: string, opts: ListFactsOptions = {}): Promise<MemoryFact[]> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.listFacts(wsId, opts));
    },

    /** Create an explicit fact. */
    async createFact(
        wsId: string,
        content: string,
        opts: { importance?: number; tags?: string[]; sourceProcessId?: string } = {},
    ): Promise<MemoryFact> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.createFact(wsId, content, opts));
    },

    /** Partial-update a fact (content, importance, tags, status). */
    async updateFact(
        wsId: string,
        factId: string,
        updates: Partial<Pick<MemoryFact, 'content' | 'importance' | 'tags' | 'status'>>,
    ): Promise<MemoryFact> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.updateFact(wsId, factId, updates));
    },

    /** Permanently delete a fact. */
    async deleteFact(wsId: string, factId: string): Promise<void> {
        await runMemoryV2Request(() => getSpaCocClient().memoryV2.deleteFact(wsId, factId));
    },

    /** Fetch all facts in the review queue. */
    async listReview(wsId: string): Promise<MemoryFact[]> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.listReview(wsId));
    },

    /**
     * Approve a review fact, promoting it to 'active'.
     * Optionally pass `editedContent` for edit-and-approve.
     */
    async approveReview(wsId: string, factId: string, editedContent?: string): Promise<MemoryFact> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.approveReview(wsId, factId, editedContent));
    },

    /** Reject a review fact, moving it to 'rejected'. */
    async rejectReview(wsId: string, factId: string): Promise<MemoryFact> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.rejectReview(wsId, factId));
    },

    /** List episodes for this scope. */
    async listEpisodes(wsId: string, limit = 50): Promise<MemoryEpisode[]> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.listEpisodes(wsId, limit));
    },

    /** Export all facts and episodes for this scope. */
    async exportData(wsId: string): Promise<MemoryV2ExportData> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.exportData(wsId));
    },

    /**
     * Wipe all facts and episodes for this scope.
     * Requires explicit confirmation.
     */
    async wipe(wsId: string): Promise<void> {
        await runMemoryV2Request(() => getSpaCocClient().memoryV2.wipe(wsId));
    },
};

/**
 * memoryV2Api - typed wrappers for the coc-memory v2 REST endpoints.
 *
 * All endpoints are workspace-scoped:
 *   /api/workspaces/:wsId/memory/v2/...
 *
 * Functions throw on HTTP error (4xx/5xx). Callers catch with try/catch.
 */

import type {
    ListFactsOptions,
    MemoryEpisode,
    MemoryEpisodeEventType,
    MemoryFact,
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

    /** List episodes for this workspace. */
    async listEpisodes(wsId: string, limit = 50): Promise<MemoryEpisode[]> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.listEpisodes(wsId, limit));
    },

    /** Export all facts and episodes for this workspace's active scope. */
    async exportData(wsId: string): Promise<MemoryV2ExportData> {
        return runMemoryV2Request(() => getSpaCocClient().memoryV2.exportData(wsId));
    },

    /**
     * Wipe all facts and episodes for this workspace's active scope.
     * Requires explicit confirmation.
     */
    async wipe(wsId: string): Promise<void> {
        await runMemoryV2Request(() => getSpaCocClient().memoryV2.wipe(wsId));
    },
};

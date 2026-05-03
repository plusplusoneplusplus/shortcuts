/**
 * memoryApi — typed wrappers over the repo-scoped memory REST endpoints.
 */

import {
    CocApiError,
    type AggregateToolCallsResponse,
    type BoundedMemoryDeleteResponse,
    type BoundedMemoryLevelsOverview,
    type BoundedMemoryResponse,
    type BoundedMemorySaveResponse,
    type ConsolidatedEntryWithAnswer,
    type ExploreCacheConsolidatedListResponse,
    type ExploreCacheLevelsOverview,
    type ExploreCacheRawListResponse,
    type MemoryConfig,
    type MemoryLevel,
    type MemoryOverviewResponse,
    type MemoryStats,
    type DbBrowserColumn,
    type DbBrowserTableDataResponse,
    type DbBrowserTable,
    type ToolCallCacheStats,
    type ToolCallQAEntry,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../api/cocClient';

// ── Shared types ────────────────────────────────────────────────────────────

export interface FeedItem {
    id: string;
    type: 'observation' | 'note';
    source: string;
    content: string;
    tags: string[];
    createdAt: string;
}

export interface DiffLine {
    type: 'add' | 'remove' | 'unchanged';
    text: string;
}

export type {
    AggregateToolCallsResponse,
    BoundedMemoryDeleteResponse,
    BoundedMemoryLevelsOverview,
    BoundedMemoryResponse,
    BoundedMemorySaveResponse,
    ConsolidatedEntryWithAnswer,
    ExploreCacheConsolidatedListResponse,
    ExploreCacheLevelsOverview,
    ExploreCacheRawListResponse,
    MemoryConfig,
    MemoryLevel,
    MemoryOverviewResponse,
    MemoryStats,
    DbBrowserColumn as RawDbColumnInfo,
    DbBrowserTableDataResponse as RawDbTableData,
    DbBrowserTable as RawDbTableInfo,
    ToolCallCacheStats,
    ToolCallQAEntry,
} from '@plusplusoneplusplus/coc-client';

function remapBoundedSaveError(error: unknown): never {
    if (error instanceof CocApiError) {
        const body = error.body && typeof error.body === 'object' ? error.body as Record<string, unknown> : {};
        if (error.status === 422) {
            const violations = Array.isArray(body.violations) ? body.violations.join(', ') : undefined;
            throw new Error(`Security violation: ${violations ?? 'Content blocked'}`);
        }
        if (error.status === 413) {
            throw new Error(`Content exceeds limit: ${body.charCount}/${body.charLimit} chars`);
        }
        throw new Error(typeof body.error === 'string' ? body.error : error.message);
    }
    throw error;
}

// ── API helpers ─────────────────────────────────────────────────────────────

export const memoryApi = {
    getConfig(): Promise<MemoryConfig> {
        return getSpaCocClient().memory.getConfig();
    },

    saveConfig(config: MemoryConfig): Promise<MemoryConfig> {
        return getSpaCocClient().memory.replaceConfig(config);
    },

    getBoundedLevels(): Promise<BoundedMemoryLevelsOverview> {
        return getSpaCocClient().memory.getBoundedLevels();
    },

    getBoundedLevel(level: MemoryLevel, hash?: string): Promise<BoundedMemoryResponse> {
        return getSpaCocClient().memory.getBoundedLevel(level, { hash });
    },

    async saveBoundedLevel(level: MemoryLevel, content: string, hash?: string): Promise<BoundedMemorySaveResponse> {
        try {
            return await getSpaCocClient().memory.saveBoundedLevel(level, content, { hash });
        } catch (error) {
            remapBoundedSaveError(error);
        }
    },

    deleteBoundedLevel(level: MemoryLevel, token: string, hash?: string): Promise<BoundedMemoryDeleteResponse> {
        return getSpaCocClient().memory.deleteBoundedLevel(level, { hash, token });
    },

    getExploreCacheLevels(): Promise<ExploreCacheLevelsOverview> {
        return getSpaCocClient().memory.getExploreCacheLevels();
    },

    listExploreCacheRaw(level: MemoryLevel, hash?: string): Promise<ExploreCacheRawListResponse> {
        return getSpaCocClient().memory.listExploreCacheRaw(level, { hash });
    },

    getExploreCacheRaw(filename: string, level: MemoryLevel, hash?: string): Promise<ToolCallQAEntry> {
        return getSpaCocClient().memory.getExploreCacheRaw(filename, level, { hash });
    },

    listExploreCacheConsolidated(level: MemoryLevel, hash?: string): Promise<ExploreCacheConsolidatedListResponse> {
        return getSpaCocClient().memory.listExploreCacheConsolidated(level, { hash });
    },

    getExploreCacheConsolidated(id: string, level: MemoryLevel, hash?: string): Promise<ConsolidatedEntryWithAnswer> {
        return getSpaCocClient().memory.getExploreCacheConsolidated(id, level, { hash });
    },

    getToolCallCacheStats(): Promise<ToolCallCacheStats> {
        return getSpaCocClient().memory.getToolCallCacheStats();
    },

    aggregateToolCalls(): Promise<AggregateToolCallsResponse> {
        return getSpaCocClient().memory.aggregateToolCalls();
    },

    getOverview(repoId: string): Promise<MemoryOverviewResponse> {
        return getSpaCocClient().memory.getRepoOverview(repoId);
    },

    /** Enqueue a memory promotion task. Returns { taskId, status } or 409 with already-queued/already-running. */
    promote(repoId: string, model?: string, target?: string): Promise<{ taskId: string; processId: string | null; operation?: 'promotion'; status: string }> {
        return getSpaCocClient().memory.promoteRepo(repoId, { model, target });
    },

    /** Read the consolidated (bounded) MEMORY.md content for a workspace. */
    getConsolidated(repoId: string): Promise<{ content: string | null }> {
        return getSpaCocClient().memory.getRepoBounded(repoId);
    },

    /** Read bounded MEMORY.md for a workspace. */
    getBounded(repoId: string): Promise<BoundedMemoryResponse> {
        return getSpaCocClient().memory.getRepoBounded(repoId);
    },

    /** Write bounded MEMORY.md for a workspace. Runs security scan server-side. */
    async saveBounded(repoId: string, content: string): Promise<BoundedMemorySaveResponse> {
        try {
            return await getSpaCocClient().memory.saveRepoBounded(repoId, content);
        } catch (error) {
            remapBoundedSaveError(error);
        }
    },

    // ── Raw DB browser ───────────────────────────────────────────────────────

    /** List tables in the repo's memory candidate database with row counts. */
    getRawDbTables(repoId: string): Promise<{ tables: DbBrowserTable[] }> {
        return getSpaCocClient().dbBrowser.listTables('repo-raw-memory-db', { repoId });
    },

    /** Read paginated rows from a specific candidate database table. */
    getRawDbTable(
        repoId: string,
        tableName: string,
        page = 1,
        pageSize = 50,
        sort?: string,
        order?: 'asc' | 'desc',
    ): Promise<DbBrowserTableDataResponse> {
        return getSpaCocClient().dbBrowser.getTable('repo-raw-memory-db', tableName, { repoId, page, pageSize, sort, order });
    },
};

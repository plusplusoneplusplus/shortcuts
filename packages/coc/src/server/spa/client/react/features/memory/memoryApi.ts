/**
 * memoryApi — typed wrappers over the repo-scoped memory REST endpoints.
 */

import {
    type AggregateToolCallsResponse,
    type ConsolidatedEntryWithAnswer,
    type ExploreCacheConsolidatedListResponse,
    type ExploreCacheLevelsOverview,
    type ExploreCacheRawListResponse,
    type MemoryConfig,
    type MemoryLevel,
    type ToolCallCacheStats,
    type ToolCallQAEntry,
    type DbBrowserColumn,
    type DbBrowserTableDataResponse,
    type DbBrowserTable,
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
    ConsolidatedEntryWithAnswer,
    ExploreCacheConsolidatedListResponse,
    ExploreCacheLevelsOverview,
    ExploreCacheRawListResponse,
    MemoryConfig,
    MemoryLevel,
    ToolCallCacheStats,
    ToolCallQAEntry,
    DbBrowserColumn as RawDbColumnInfo,
    DbBrowserTableDataResponse as RawDbTableData,
    DbBrowserTable as RawDbTableInfo,
} from '@plusplusoneplusplus/coc-client';

// ── API helpers ─────────────────────────────────────────────────────────────

export const memoryApi = {
    getConfig(): Promise<MemoryConfig> {
        return getSpaCocClient().memory.getConfig();
    },

    saveConfig(config: MemoryConfig): Promise<MemoryConfig> {
        return getSpaCocClient().memory.replaceConfig(config);
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

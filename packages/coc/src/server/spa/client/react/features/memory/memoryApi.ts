/**
 * memoryApi — typed wrappers over the repo-scoped memory REST endpoints.
 */

import {
    type MemoryConfig,
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

export type {
    MemoryConfig,
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
};

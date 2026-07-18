/**
 * Pure helpers for AC-07 manual exploration creation.
 *
 * Kept out of the ExplorationView component tree so they can be unit-tested
 * without a DOM. `parseExplorationContent` (the tolerant JSON parser) lives in
 * ExplorationView and is reused here to read the prefill seed.
 */

import type { CanvasSummary, ExplorationState } from '@plusplusoneplusplus/coc-client';
import { parseExplorationContent } from './ExplorationView';

/** Cluster/database prefill copied from the workspace's most recent exploration. */
export interface ExplorationSeed {
    clusterUrl: string;
    database: string;
}

/**
 * Pick the workspace's most recent exploration for cluster/database prefill.
 * Returns null when there is no prior exploration. Ties on `updatedAt` are
 * broken by list order (the caller passes the API-ordered list).
 */
export function pickLatestExploration(canvases: CanvasSummary[]): CanvasSummary | null {
    let latest: CanvasSummary | null = null;
    for (const canvas of canvases) {
        if (canvas.type !== 'exploration') continue;
        if (!latest || canvas.updatedAt > latest.updatedAt) {
            latest = canvas;
        }
    }
    return latest;
}

/** Extract the cluster/database prefill seed from an exploration's content JSON. */
export function extractExplorationSeed(content: string | undefined | null): ExplorationSeed {
    const parsed = parseExplorationContent(content);
    return { clusterUrl: parsed.clusterUrl, database: parsed.database };
}

/**
 * Build the JSON content for a blank exploration, optionally seeded with the
 * cluster/database of a prior exploration. The shape matches the server's
 * `createEmptyExplorationState` so the round-trip parse is stable.
 */
export function buildBlankExplorationContent(seed?: Partial<ExplorationSeed>): string {
    const state: ExplorationState = {
        query: '',
        clusterUrl: seed?.clusterUrl ?? '',
        database: seed?.database ?? '',
        columns: [],
        rows: [],
        truncated: false,
    };
    return JSON.stringify(state);
}

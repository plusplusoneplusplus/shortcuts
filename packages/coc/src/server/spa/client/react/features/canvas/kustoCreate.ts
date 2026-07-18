/**
 * Pure helpers for AC-07 manual Kusto canvas creation.
 *
 * Kept out of the KustoView component tree so they can be unit-tested without a
 * DOM. `parseKustoContent` (the tolerant JSON parser) lives in KustoView and is
 * reused here to read the prefill seed.
 */

import type { CanvasSummary, KustoCanvasState } from '@plusplusoneplusplus/coc-client';
import { parseKustoContent } from './KustoView';

/** Cluster/database prefill copied from the workspace's most recent Kusto canvas. */
export interface KustoSeed {
    clusterUrl: string;
    database: string;
}

/**
 * Pick the workspace's most recent Kusto canvas for cluster/database prefill.
 * Returns null when there is no prior Kusto canvas. Ties on `updatedAt` are
 * broken by list order (the caller passes the API-ordered list).
 */
export function pickLatestKustoCanvas(canvases: CanvasSummary[]): CanvasSummary | null {
    let latest: CanvasSummary | null = null;
    for (const canvas of canvases) {
        if (canvas.type !== 'kusto') continue;
        if (!latest || canvas.updatedAt > latest.updatedAt) {
            latest = canvas;
        }
    }
    return latest;
}

/** Extract the cluster/database prefill seed from a Kusto canvas's content JSON. */
export function extractKustoSeed(content: string | undefined | null): KustoSeed {
    const parsed = parseKustoContent(content);
    return { clusterUrl: parsed.clusterUrl, database: parsed.database };
}

/**
 * Build the JSON content for a blank Kusto canvas, optionally seeded with the
 * cluster/database of a prior Kusto canvas. The shape matches the server's
 * `createEmptyKustoState` so the round-trip parse is stable.
 */
export function buildBlankKustoContent(seed?: Partial<KustoSeed>): string {
    const state: KustoCanvasState = {
        query: '',
        clusterUrl: seed?.clusterUrl ?? '',
        database: seed?.database ?? '',
        columns: [],
        rows: [],
        truncated: false,
    };
    return JSON.stringify(state);
}

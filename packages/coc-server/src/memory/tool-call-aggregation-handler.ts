/**
 * Tool Call Aggregation Handler
 *
 * Handles POST /api/memory/aggregate-tool-calls — manually-triggered
 * endpoint that runs AI-powered consolidation of raw explore-cache entries.
 *
 * No VS Code dependencies — pure Node.js.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as http from 'http';
import type { AIInvoker } from '@plusplusoneplusplus/pipeline-core';
import { FileToolCallCacheStore, ToolCallCacheAggregator } from '@plusplusoneplusplus/pipeline-core';
import { sendJson, send500 } from '../router';
import { readMemoryConfig } from './memory-config-handler';

/**
 * Handle POST /api/memory/aggregate-tool-calls
 *
 * Reads raw tool-call Q&A files from explore-cache/raw/, runs AI-powered
 * consolidation, writes consolidated.json, and deletes the raw files.
 * Returns 503 when no AIInvoker is configured.
 */
export async function handleAggregateToolCalls(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
    dataDir: string,
    aiInvoker?: AIInvoker,
): Promise<void> {
    if (!aiInvoker) {
        sendJson(res, { error: 'AI invoker not configured' }, 503);
        return;
    }

    try {
        const config = readMemoryConfig(dataDir);
        const store = new FileToolCallCacheStore({ dataDir: config.storageDir });
        const stats = await store.getStats();

        if (stats.rawCount === 0) {
            sendJson(res, { aggregated: false, reason: 'no raw entries' });
            return;
        }

        const rawCountBefore = stats.rawCount;
        const aggregator = new ToolCallCacheAggregator(store);
        await aggregator.aggregate(aiInvoker);

        const statsAfter = await store.getStats();
        sendJson(res, {
            aggregated: true,
            rawCount: rawCountBefore,
            consolidatedCount: statsAfter.consolidatedCount,
        });
    } catch (err) {
        send500(res, err instanceof Error ? err.message : String(err));
    }
}

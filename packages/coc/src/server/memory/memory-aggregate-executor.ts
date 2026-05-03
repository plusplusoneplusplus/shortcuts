/**
 * Memory Aggregate Executor
 *
 * Queued executor that drains raw memory records without rewriting bounded
 * MEMORY.md. Follows the same pattern as BackgroundReviewExecutor:
 *
 * 1. Resolve raw store and bounded memory paths for the target scope
 * 2. Claim pending raw records into a batch
 * 3. Drain the batch without rewriting bounded MEMORY.md
 * 4. On failure, release claimed rows for retry
 */

import * as path from 'path';
import type { CopilotSDKService, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import {
    RawMemoryRecordStore,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/forge';
import type { MemoryAggregatePayload } from '../tasks/task-types';
import {
    DEFAULT_AGGREGATE_CONFIG,
} from './memory-aggregate';
import type { MemoryAggregateConfig } from './memory-aggregate';
import { getRepoDataPath } from '../paths';

export class MemoryAggregateExecutor {
    constructor(
        _aiService: CopilotSDKService,
        private readonly dataDir: string,
        private readonly config: MemoryAggregateConfig = DEFAULT_AGGREGATE_CONFIG,
    ) {}

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();
        const payload = task.payload as unknown as MemoryAggregatePayload;
        const { workspaceId, target } = payload;

        // Resolve store paths based on target scope
        const { rawDbPath, boundedPath } = this.resolvePaths(workspaceId, target);

        let rawStore: RawMemoryRecordStore | undefined;
        let claimedBatchId: string | undefined;
        try {
            rawStore = new RawMemoryRecordStore({ dbPath: rawDbPath });

            // 1. Claim pending raw records
            const batch = await rawStore.claimPending(this.config.batchSize);
            if (!batch || batch.records.length === 0) {
                logger.debug(LogCategory.AI, `[MemoryAggregate] No pending records for ${target}@${workspaceId}`);
                return { success: true, result: 'No pending records', durationMs: Date.now() - startTime };
            }
            claimedBatchId = batch.batchId;

            logger.debug(LogCategory.AI, `[MemoryAggregate] Claimed ${batch.records.length} records (batch ${batch.batchId}) for ${target}@${workspaceId}`);

            // Full-list AI reconciliation is disabled because it can delete,
            // rewrite, or reorder trusted bounded memory. Drain claimed raw
            // candidates until append-only promotion is introduced.
            const dropped = await rawStore.markDropped(batch.batchId);

            logger.debug(
                LogCategory.AI,
                `[MemoryAggregate] Automatic full-list reconciliation disabled for batch ${batch.batchId}; ` +
                `dropped ${dropped} raw records without modifying ${boundedPath}`,
            );

            return {
                success: true,
                result: `Automatic memory aggregation disabled; dropped ${dropped} raw records`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            // Release claimed batch for retry on unexpected errors
            if (claimedBatchId && rawStore) {
                try { await rawStore.releaseClaim(claimedBatchId); } catch { /* best effort */ }
            }
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.debug(LogCategory.AI, `[MemoryAggregate] Executor error: ${errorMsg}`);
            return { success: false, error: error instanceof Error ? error : new Error(errorMsg), durationMs: Date.now() - startTime };
        } finally {
            try { rawStore?.close(); } catch { /* already closed */ }
        }
    }

    private resolvePaths(workspaceId: string, target: 'memory' | 'system'): { rawDbPath: string; boundedPath: string } {
        if (target === 'system') {
            return {
                rawDbPath: path.join(this.dataDir, 'memory', 'system', 'raw-memory.db'),
                boundedPath: path.join(this.dataDir, 'memory', 'system', 'MEMORY.md'),
            };
        }
        return {
            rawDbPath: getRepoDataPath(this.dataDir, workspaceId, 'memory/raw-memory.db'),
            boundedPath: getRepoDataPath(this.dataDir, workspaceId, 'memory/MEMORY.md'),
        };
    }
}

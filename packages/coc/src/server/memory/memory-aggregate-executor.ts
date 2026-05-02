/**
 * Memory Aggregate Executor
 *
 * Queued executor that reconciles raw memory records into bounded
 * MEMORY.md. Follows the same pattern as BackgroundReviewExecutor:
 *
 * 1. Resolve raw + bounded stores for the target scope
 * 2. Claim pending raw records into a batch
 * 3. Build reconciliation context and AI prompt
 * 4. Invoke AI through the queue-owned CopilotSDKService
 * 5. Validate the proposed entries
 * 6. Apply reconciliation to bounded store and finalize row statuses
 * 7. On failure, release claimed rows for retry
 */

import * as path from 'path';
import type { CopilotSDKService, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import {
    BoundedMemoryStore,
    RawMemoryRecordStore,
    prepareReconciliationContext,
    validateProposedEntries,
    buildApplyPlan,
    applyReconciliation,
    DEFAULT_CHAR_LIMIT,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/forge';
import type { MemoryAggregatePayload } from '../tasks/task-types';
import {
    buildAggregateSystemMessage,
    AGGREGATE_USER_PROMPT,
    DEFAULT_AGGREGATE_CONFIG,
} from './memory-aggregate';
import type { MemoryAggregateConfig } from './memory-aggregate';
import { getRepoDataPath } from '../paths';

export class MemoryAggregateExecutor {
    constructor(
        private readonly aiService: CopilotSDKService,
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

            // 2. Load current bounded memory
            const boundedStore = new BoundedMemoryStore({ filePath: boundedPath });
            await boundedStore.load();
            const currentEntries = boundedStore.read();
            const charLimit = DEFAULT_CHAR_LIMIT;

            // 3. Build reconciliation context
            const reconCtx = prepareReconciliationContext({
                currentEntries,
                claimedRecords: batch.records,
                charLimit,
                scope: target === 'memory' ? 'repo' : 'system',
                workspaceId,
            });

            // 4. Invoke AI for reconciliation
            const systemMessage = buildAggregateSystemMessage(reconCtx);
            const aiResult = await this.aiService.sendMessage({
                prompt: AGGREGATE_USER_PROMPT,
                model: payload.model ?? task.config.model ?? this.config.model,
                systemMessage: { mode: 'replace', content: systemMessage },
                tools: [],
                workingDirectory: undefined,
                timeoutMs: this.config.timeoutMs,
            });

            if (!aiResult.success || !aiResult.response) {
                // Release claims so the batch can be retried
                await rawStore.releaseClaim(batch.batchId);
                const errorMsg = aiResult.error || 'Empty AI response';
                logger.debug(LogCategory.AI, `[MemoryAggregate] AI call failed for batch ${batch.batchId}: ${errorMsg}`);
                return { success: false, error: new Error(errorMsg), durationMs: Date.now() - startTime };
            }

            // 5. Parse and validate AI output
            let proposed: unknown;
            try {
                proposed = JSON.parse(aiResult.response.trim());
            } catch {
                // Try extracting JSON array from markdown-fenced response
                const jsonMatch = aiResult.response.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    try {
                        proposed = JSON.parse(jsonMatch[0]);
                    } catch {
                        await rawStore.releaseClaim(batch.batchId);
                        logger.debug(LogCategory.AI, `[MemoryAggregate] Failed to parse AI response for batch ${batch.batchId}`);
                        return { success: false, error: new Error('Failed to parse AI response as JSON array'), durationMs: Date.now() - startTime };
                    }
                } else {
                    await rawStore.releaseClaim(batch.batchId);
                    return { success: false, error: new Error('Failed to parse AI response as JSON array'), durationMs: Date.now() - startTime };
                }
            }

            const validation = validateProposedEntries(proposed, charLimit);
            if (!validation.valid) {
                await rawStore.releaseClaim(batch.batchId);
                const reason = validation.errors.join('; ');
                logger.debug(LogCategory.AI, `[MemoryAggregate] Validation failed for batch ${batch.batchId}: ${reason}`);
                return { success: false, error: new Error(`Validation failed: ${reason}`), durationMs: Date.now() - startTime };
            }

            // 6. Build apply plan and execute
            const plan = buildApplyPlan(validation.validEntries, reconCtx);
            await applyReconciliation(boundedStore, plan.entries);

            // 7. Finalize raw record statuses
            if (plan.aggregatedRecordIds.length > 0) {
                await rawStore.markAggregated(batch.batchId);
            } else if (plan.droppedRecordIds.length > 0) {
                await rawStore.markDropped(batch.batchId);
            }

            logger.debug(
                LogCategory.AI,
                `[MemoryAggregate] Batch ${batch.batchId} complete: ` +
                `${plan.entries.length} entries, ` +
                `${plan.aggregatedRecordIds.length} aggregated, ` +
                `${plan.droppedRecordIds.length} dropped`,
            );

            return {
                success: true,
                result: `Reconciled ${batch.records.length} records into ${plan.entries.length} entries`,
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

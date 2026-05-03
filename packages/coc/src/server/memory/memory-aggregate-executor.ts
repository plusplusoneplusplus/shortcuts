/**
 * Memory Aggregate Executor
 *
 * Queued executor that promotes durable memory candidates without rewriting
 * bounded MEMORY.md. Follows the same pattern as BackgroundReviewExecutor:
 *
 * 1. Resolve the candidate store for the target scope
 * 2. List pending candidates deterministically
 * 3. Append selected candidates to bounded memory without changing existing entries
 */

import * as path from 'path';
import type { CopilotSDKService, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import {
    BoundedMemoryStore,
    MemoryCandidateStore,
    rankMemoryCandidates,
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

        const candidateDbPath = this.resolveCandidatePath(workspaceId, target);

        let candidateStore: MemoryCandidateStore | undefined;
        try {
            candidateStore = new MemoryCandidateStore({ dbPath: candidateDbPath });

            const candidates = await candidateStore.listPendingCandidates(this.config.batchSize);
            if (candidates.length === 0) {
                logger.debug(LogCategory.AI, `[MemoryAggregate] No pending candidates for ${target}@${workspaceId}`);
                return { success: true, result: 'No pending candidates', durationMs: Date.now() - startTime };
            }

            logger.debug(LogCategory.AI, `[MemoryAggregate] Found ${candidates.length} pending candidates for ${target}@${workspaceId}`);
            const ranked = rankMemoryCandidates(candidates);
            const selected = ranked.filter(candidate => candidate.selected);
            if (selected.length === 0) {
                return {
                    success: true,
                    result: `Memory promotion pending; ranked ${ranked.length} candidate(s), selected 0`,
                    durationMs: Date.now() - startTime,
                };
            }

            const memoryStore = new BoundedMemoryStore({ filePath: this.resolveMemoryPath(workspaceId, target) });
            await memoryStore.load();
            const existingEntries = new Set(memoryStore.read());
            const uniqueSelectedEntries = [...new Set(selected.map(candidate => candidate.content.trim()).filter(Boolean))];
            const newEntryCount = uniqueSelectedEntries.filter(entry => !existingEntries.has(entry)).length;
            const appendResult = await memoryStore.appendEntries(uniqueSelectedEntries);
            if (!appendResult.success) {
                return {
                    success: false,
                    error: new Error(appendResult.message),
                    durationMs: Date.now() - startTime,
                };
            }

            await candidateStore.markPromoted(selected.map(candidate => candidate.id));

            return {
                success: true,
                result: `Memory promotion completed; ranked ${ranked.length} candidate(s), promoted ${selected.length}, appended ${newEntryCount}`,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.debug(LogCategory.AI, `[MemoryAggregate] Executor error: ${errorMsg}`);
            return { success: false, error: error instanceof Error ? error : new Error(errorMsg), durationMs: Date.now() - startTime };
        } finally {
            try { candidateStore?.close(); } catch { /* already closed */ }
        }
    }

    private resolveCandidatePath(workspaceId: string, target: 'memory' | 'system'): string {
        if (target === 'system') {
            return path.join(this.dataDir, 'memory', 'system', 'raw-memory.db');
        }
        return getRepoDataPath(this.dataDir, workspaceId, 'memory/raw-memory.db');
    }

    private resolveMemoryPath(workspaceId: string, target: 'memory' | 'system'): string {
        if (target === 'system') {
            return path.join(this.dataDir, 'memory', 'system', 'MEMORY.md');
        }
        return getRepoDataPath(this.dataDir, workspaceId, 'memory/MEMORY.md');
    }
}

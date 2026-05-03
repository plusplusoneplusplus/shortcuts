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
    scanMemoryContent,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/forge';
import type { RankedMemoryCandidate } from '@plusplusoneplusplus/forge';
import type { MemoryAggregatePayload } from '../tasks/task-types';
import {
    DEFAULT_AGGREGATE_CONFIG,
} from './memory-aggregate';
import type { MemoryAggregateConfig } from './memory-aggregate';
import { getRepoDataPath } from '../paths';

interface MemoryAggregateCounts {
    ranked: number;
    promoted: number;
    dropped: number;
    ignored: number;
    pending: number;
}

interface MemoryAggregateResult {
    message: string;
    counts: MemoryAggregateCounts;
    appended: number;
    droppedReasons: Record<string, string>;
    ignoredReasons: Record<string, string>;
}

interface CandidatePromotion {
    id: string;
    entry: string;
}

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
                return {
                    success: true,
                    result: createAggregateResult('No pending candidates', {
                        ranked: 0,
                        promoted: 0,
                        dropped: 0,
                        ignored: 0,
                        pending: 0,
                    }),
                    durationMs: Date.now() - startTime,
                };
            }

            logger.debug(LogCategory.AI, `[MemoryAggregate] Found ${candidates.length} pending candidates for ${target}@${workspaceId}`);
            const ranked = rankMemoryCandidates(candidates);
            const selected = ranked.filter(candidate => candidate.selected);
            if (selected.length === 0) {
                return {
                    success: true,
                    result: createAggregateResult(
                        `Memory promotion pending; ranked ${ranked.length} candidate(s), selected 0`,
                        {
                            ranked: ranked.length,
                            promoted: 0,
                            dropped: 0,
                            ignored: 0,
                            pending: ranked.length,
                        },
                    ),
                    durationMs: Date.now() - startTime,
                };
            }

            const memoryStore = new BoundedMemoryStore({ filePath: this.resolveMemoryPath(workspaceId, target) });
            await memoryStore.load();
            const existingEntries = new Set(memoryStore.read().map(entry => entry.trim()).filter(Boolean));
            const plan = planCandidateFinalization(selected, existingEntries);

            let appendedEntries: string[] = [];
            if (plan.promotions.length > 0) {
                const appendResult = await memoryStore.appendEntries(plan.promotions.map(promotion => promotion.entry));
                if (!appendResult.success) {
                    logger.debug(
                        LogCategory.AI,
                        `[MemoryAggregate] Promotion append failed for ${target}@${workspaceId}: ${appendResult.message}`,
                    );
                    return {
                        success: false,
                        error: new Error(appendResult.message),
                        durationMs: Date.now() - startTime,
                    };
                }
                appendedEntries = appendResult.appendedEntries ?? plan.promotions.map(promotion => promotion.entry);
            }

            const appendedSet = new Set(appendedEntries.map(entry => entry.trim()).filter(Boolean));
            const promotedIds = plan.promotions
                .filter(promotion => appendedSet.has(promotion.entry))
                .map(promotion => promotion.id);
            for (const promotion of plan.promotions) {
                if (!appendedSet.has(promotion.entry)) {
                    plan.droppedReasons[promotion.id] = 'already covered by bounded memory';
                }
            }

            const promoted = await candidateStore.markPromoted(promotedIds);
            const dropped = await markDroppedByReason(candidateStore, plan.droppedReasons);
            const ignored = await markIgnoredByReason(candidateStore, plan.ignoredReasons);
            const counts: MemoryAggregateCounts = {
                ranked: ranked.length,
                promoted,
                dropped,
                ignored,
                pending: Math.max(0, ranked.length - promoted - dropped - ignored),
            };
            const result = createAggregateResult(
                `Memory promotion completed; ranked ${ranked.length} candidate(s), promoted ${promoted}, dropped ${dropped}, ignored ${ignored}, pending ${counts.pending}, appended ${appendedEntries.length}`,
                counts,
                appendedEntries.length,
                plan.droppedReasons,
                plan.ignoredReasons,
            );

            logger.debug(LogCategory.AI, `[MemoryAggregate] Finalized ${target}@${workspaceId}: ${JSON.stringify(counts)}`);

            return {
                success: true,
                result,
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

function planCandidateFinalization(
    selected: RankedMemoryCandidate[],
    existingEntries: Set<string>,
): {
    promotions: CandidatePromotion[];
    droppedReasons: Record<string, string>;
    ignoredReasons: Record<string, string>;
} {
    const promotions: CandidatePromotion[] = [];
    const droppedReasons: Record<string, string> = {};
    const ignoredReasons: Record<string, string> = {};
    const plannedEntries = new Set<string>();

    for (const candidate of selected) {
        const entry = candidate.content.trim();
        if (!entry) {
            droppedReasons[candidate.id] = 'empty candidate content';
            continue;
        }

        const scan = scanMemoryContent(entry);
        if (scan.blocked) {
            droppedReasons[candidate.id] = `blocked by security scanner: ${scan.reason ?? scan.patternId ?? 'unknown reason'}`;
            continue;
        }

        if (existingEntries.has(entry)) {
            droppedReasons[candidate.id] = 'already covered by bounded memory';
            continue;
        }

        if (plannedEntries.has(entry)) {
            ignoredReasons[candidate.id] = 'duplicate selected candidate';
            continue;
        }

        plannedEntries.add(entry);
        promotions.push({ id: candidate.id, entry });
    }

    return { promotions, droppedReasons, ignoredReasons };
}

async function markDroppedByReason(
    candidateStore: MemoryCandidateStore,
    droppedReasons: Record<string, string>,
): Promise<number> {
    let count = 0;
    for (const [reason, ids] of groupIdsByReason(droppedReasons)) {
        count += await candidateStore.markDropped(ids, reason);
    }
    return count;
}

async function markIgnoredByReason(
    candidateStore: MemoryCandidateStore,
    ignoredReasons: Record<string, string>,
): Promise<number> {
    let count = 0;
    for (const [reason, ids] of groupIdsByReason(ignoredReasons)) {
        count += await candidateStore.markIgnored(ids, reason);
    }
    return count;
}

function groupIdsByReason(reasonsById: Record<string, string>): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const [id, reason] of Object.entries(reasonsById)) {
        const ids = grouped.get(reason);
        if (ids) {
            ids.push(id);
        } else {
            grouped.set(reason, [id]);
        }
    }
    return grouped;
}

function createAggregateResult(
    message: string,
    counts: MemoryAggregateCounts,
    appended = 0,
    droppedReasons: Record<string, string> = {},
    ignoredReasons: Record<string, string> = {},
): MemoryAggregateResult {
    return {
        message,
        counts,
        appended,
        droppedReasons,
        ignoredReasons,
    };
}

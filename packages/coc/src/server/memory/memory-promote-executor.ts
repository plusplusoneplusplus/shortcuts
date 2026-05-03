/**
 * Memory Promote Executor
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
    hashMemoryCandidateContent,
    normalizeMemoryCandidateContent,
    rankMemoryCandidates,
    scanMemoryContent,
    getLogger,
    LogCategory,
} from '@plusplusoneplusplus/forge';
import type { RankedMemoryCandidate } from '@plusplusoneplusplus/forge';
import type { MemoryPromotePayload } from '../tasks/task-types';
import {
    DEFAULT_PROMOTE_CONFIG,
} from './memory-promote';
import type { MemoryPromoteConfig } from './memory-promote';
import { getRepoDataPath } from '../paths';

interface MemoryPromoteCounts {
    ranked: number;
    promoted: number;
    dropped: number;
    ignored: number;
    pending: number;
}

interface MemoryPromoteResult extends MemoryPromoteCounts {
    message: string;
    preservedExistingEntries: number;
    promotedCandidateIds: string[];
    droppedReasons: Record<string, string>;
    ignoredReasons: Record<string, string>;
}

interface CandidatePromotion {
    id: string;
    entry: string;
    contentHash: string;
}

export class MemoryPromoteExecutor {
    constructor(
        _aiService: CopilotSDKService,
        private readonly dataDir: string,
        private readonly config: MemoryPromoteConfig = DEFAULT_PROMOTE_CONFIG,
    ) {}

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();
        const payload = task.payload as unknown as MemoryPromotePayload;
        const { workspaceId, target } = payload;

        const candidateDbPath = this.resolveCandidatePath(workspaceId, target);

        let candidateStore: MemoryCandidateStore | undefined;
        try {
            candidateStore = new MemoryCandidateStore({ dbPath: candidateDbPath });

            const candidates = await candidateStore.listPendingCandidates(this.config.batchSize);
            if (candidates.length === 0) {
                logger.debug(LogCategory.AI, `[MemoryPromote] No pending candidates for ${target}@${workspaceId}`);
                const preservedExistingEntries = await this.readExistingEntryCount(workspaceId, target);
                return {
                    success: true,
                    result: createPromoteResult('No pending candidates', {
                        ranked: 0,
                        promoted: 0,
                        dropped: 0,
                        ignored: 0,
                        pending: 0,
                    }, preservedExistingEntries, []),
                    durationMs: Date.now() - startTime,
                };
            }

            logger.debug(LogCategory.AI, `[MemoryPromote] Found ${candidates.length} pending candidates for ${target}@${workspaceId}`);
            const ranked = rankMemoryCandidates(candidates);
            const selected = ranked.filter(candidate => candidate.selected);
            if (selected.length === 0) {
                const preservedExistingEntries = await this.readExistingEntryCount(workspaceId, target);
                return {
                    success: true,
                    result: createPromoteResult(
                        `Memory promotion pending; ranked ${ranked.length} candidate(s), selected 0`,
                        {
                            ranked: ranked.length,
                            promoted: 0,
                            dropped: 0,
                            ignored: 0,
                            pending: ranked.length,
                        },
                        preservedExistingEntries,
                        [],
                    ),
                    durationMs: Date.now() - startTime,
                };
            }

            const memoryStore = new BoundedMemoryStore({ filePath: this.resolveMemoryPath(workspaceId, target) });
            await memoryStore.load();
            const existingEntries = memoryStore.read();
            const existingContentHashes = toContentHashSet(existingEntries);
            const plan = planCandidateFinalization(selected, existingContentHashes);

            let appendedEntries: string[] = [];
            if (plan.promotions.length > 0) {
                const appendResult = await memoryStore.appendEntries(plan.promotions.map(promotion => promotion.entry));
                if (!appendResult.success) {
                    logger.debug(
                        LogCategory.AI,
                        `[MemoryPromote] Promotion append failed for ${target}@${workspaceId}: ${appendResult.message}`,
                    );
                    return {
                        success: false,
                        error: new Error(appendResult.message),
                        durationMs: Date.now() - startTime,
                    };
                }
                appendedEntries = appendResult.appendedEntries ?? plan.promotions.map(promotion => promotion.entry);
            }

            const appendedSet = toContentHashSet(appendedEntries);
            const promotedIds = plan.promotions
                .filter(promotion => appendedSet.has(promotion.contentHash))
                .map(promotion => promotion.id);
            for (const promotion of plan.promotions) {
                if (!appendedSet.has(promotion.contentHash)) {
                    plan.ignoredReasons[promotion.id] = 'already covered by bounded memory';
                }
            }

            const promoted = await candidateStore.markPromoted(promotedIds);
            const dropped = await markDroppedByReason(candidateStore, plan.droppedReasons);
            const ignored = await markIgnoredByReason(candidateStore, plan.ignoredReasons);
            const counts: MemoryPromoteCounts = {
                ranked: ranked.length,
                promoted,
                dropped,
                ignored,
                pending: Math.max(0, ranked.length - promoted - dropped - ignored),
            };
            const result = createPromoteResult(
                `Memory promotion completed; ranked ${ranked.length} candidate(s), promoted ${promoted}, dropped ${dropped}, ignored ${ignored}, pending ${counts.pending}, appended ${appendedEntries.length}`,
                counts,
                existingEntries.length,
                promotedIds,
                plan.droppedReasons,
                plan.ignoredReasons,
            );

            logger.debug(LogCategory.AI, `[MemoryPromote] Finalized ${target}@${workspaceId}: ${JSON.stringify(counts)}`);

            return {
                success: true,
                result,
                durationMs: Date.now() - startTime,
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.debug(LogCategory.AI, `[MemoryPromote] Executor error: ${errorMsg}`);
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

    private async readExistingEntryCount(workspaceId: string, target: 'memory' | 'system'): Promise<number> {
        const memoryStore = new BoundedMemoryStore({ filePath: this.resolveMemoryPath(workspaceId, target) });
        await memoryStore.load();
        return memoryStore.read().length;
    }
}

function planCandidateFinalization(
    selected: RankedMemoryCandidate[],
    existingContentHashes: Set<string>,
): {
    promotions: CandidatePromotion[];
    droppedReasons: Record<string, string>;
    ignoredReasons: Record<string, string>;
} {
    const promotions: CandidatePromotion[] = [];
    const droppedReasons: Record<string, string> = {};
    const ignoredReasons: Record<string, string> = {};
    const plannedEntries = new Set<string>();
    const plannedContentHashes = new Set<string>();

    for (const candidate of selected) {
        const entry = normalizeMemoryCandidateContent(candidate.content);
        if (!entry) {
            droppedReasons[candidate.id] = 'empty candidate content';
            continue;
        }
        const contentHash = candidate.candidate.contentHash || hashMemoryCandidateContent(entry);

        const scan = scanMemoryContent(entry);
        if (scan.blocked) {
            droppedReasons[candidate.id] = `blocked by security scanner: ${scan.reason ?? scan.patternId ?? 'unknown reason'}`;
            continue;
        }

        if (existingContentHashes.has(contentHash)) {
            ignoredReasons[candidate.id] = 'already covered by bounded memory';
            continue;
        }

        if (plannedEntries.has(entry) || plannedContentHashes.has(contentHash)) {
            ignoredReasons[candidate.id] = 'duplicate selected candidate';
            continue;
        }

        plannedEntries.add(entry);
        plannedContentHashes.add(contentHash);
        promotions.push({ id: candidate.id, entry, contentHash });
    }

    return { promotions, droppedReasons, ignoredReasons };
}

function toContentHashSet(entries: string[]): Set<string> {
    const hashes = new Set<string>();
    for (const entry of entries) {
        const normalized = normalizeMemoryCandidateContent(entry);
        if (normalized) {
            hashes.add(hashMemoryCandidateContent(normalized));
        }
    }
    return hashes;
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

function createPromoteResult(
    message: string,
    counts: MemoryPromoteCounts,
    preservedExistingEntries: number,
    promotedCandidateIds: string[],
    droppedReasons: Record<string, string> = {},
    ignoredReasons: Record<string, string> = {},
): MemoryPromoteResult {
    return {
        message,
        ...counts,
        preservedExistingEntries,
        promotedCandidateIds,
        droppedReasons,
        ignoredReasons,
    };
}

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
import type { ISDKService, QueuedTask, TaskExecutionResult } from '@plusplusoneplusplus/forge';
import {
    BoundedMemoryStore,
    MemoryCandidateStore,
    hashMemoryCandidateContent,
    normalizeMemoryCandidateContent,
    rankMemoryCandidates,
    LOOSE_MEMORY_CANDIDATE_SELECTION_POLICY,
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
import { acquireMemoryPromoteLock, type MemoryPromoteLockHandle } from './memory-promote-lock';
import { isAutoTrigger, resolveAutoPromoteGates, writeAutoPromoteState } from './auto-promote';
import type { ProcessWebSocketServer } from '../streaming/websocket';

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
    ids: string[];
    entry: string;
    contentHash: string;
}

interface CandidateNormalizationGroup {
    candidateIds: string[];
    entry: string;
}

interface CandidateNormalizationResult {
    groups: CandidateNormalizationGroup[];
    droppedReasons: Record<string, string>;
}

export class MemoryPromoteExecutor {
    constructor(
        private readonly aiService: ISDKService,
        private readonly dataDir: string,
        private readonly config: MemoryPromoteConfig = DEFAULT_PROMOTE_CONFIG,
        private readonly getWsServer?: () => ProcessWebSocketServer | undefined,
    ) {}

    async execute(task: QueuedTask): Promise<TaskExecutionResult> {
        const logger = getLogger();
        const startTime = Date.now();
        const payload = task.payload as unknown as MemoryPromotePayload;
        const { workspaceId, target } = payload;

        const candidateDbPath = this.resolveCandidatePath(workspaceId, target);
        let lock: MemoryPromoteLockHandle | undefined;

        let candidateStore: MemoryCandidateStore | undefined;
        try {
            lock = await acquireMemoryPromoteLock(this.resolveMemoryDir(workspaceId, target), this.config.lock ?? DEFAULT_PROMOTE_CONFIG.lock!);
            if (!lock.acquired) {
                const reason = lock.reason ?? 'lock-held';
                logger.debug(LogCategory.AI, `[MemoryPromote] Skipped ${target}@${workspaceId}: ${reason}`);
                writeAutoPromoteState(this.dataDir, workspaceId, {
                    lastRunAt: new Date().toISOString(),
                    lastRunTrigger: payload.trigger ?? 'manual',
                    lastSkipReason: reason,
                    ...(isAutoTrigger(payload.trigger) ? {
                        lastTrigger: payload.trigger,
                    } : {}),
                });
                this.getWsServer?.()?.broadcastProcessEvent({
                    type: 'memory-promote:skipped',
                    workspaceId,
                    reason,
                    details: { target, trigger: payload.trigger ?? 'manual' },
                    timestamp: Date.now(),
                });
                return {
                    success: true,
                    result: createPromoteResult(`Memory promotion skipped; ${reason}`, {
                        ranked: 0,
                        promoted: 0,
                        dropped: 0,
                        ignored: 0,
                        pending: 0,
                    }, 0, []),
                    durationMs: Date.now() - startTime,
                };
            }

            candidateStore = new MemoryCandidateStore({ dbPath: candidateDbPath });

            const candidates = await candidateStore.listPendingCandidates(this.config.batchSize);
            if (candidates.length === 0) {
                logger.debug(LogCategory.AI, `[MemoryPromote] No pending candidates for ${target}@${workspaceId}`);
                const preservedExistingEntries = await this.readExistingEntryCount(workspaceId, target);
                if (isAutoTrigger(payload.trigger)) {
                    this.recordAutoSkip(workspaceId, payload.trigger, 'no-pending-candidates', { target });
                } else {
                    writeAutoPromoteState(this.dataDir, workspaceId, {
                        lastRunAt: new Date().toISOString(),
                        lastRunTrigger: payload.trigger ?? 'manual',
                        lastSkipReason: 'no-pending-candidates',
                    });
                }
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
            const ranked = rankMemoryCandidates(candidates, {
                policy: isAutoTrigger(payload.trigger)
                    ? resolveAutoPromoteGates(payload.gates)
                    : LOOSE_MEMORY_CANDIDATE_SELECTION_POLICY,
            });
            const selected = ranked.filter(candidate => candidate.selected);
            if (selected.length === 0) {
                const preservedExistingEntries = await this.readExistingEntryCount(workspaceId, target);
                if (isAutoTrigger(payload.trigger)) {
                    this.recordAutoSkip(workspaceId, payload.trigger, 'no-qualifying-candidates', {
                        target,
                        ranked: ranked.length,
                    });
                } else {
                    writeAutoPromoteState(this.dataDir, workspaceId, {
                        lastRunAt: new Date().toISOString(),
                        lastRunTrigger: payload.trigger ?? 'manual',
                        lastSkipReason: 'no-qualifying-candidates',
                    });
                }
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
            const normalization = await normalizeSelectedCandidates(
                selected,
                this.aiService,
                this.config,
                task.config?.model,
                logger,
                { workspaceId, target },
            );
            const plan = planCandidateFinalization(
                selected,
                existingContentHashes,
                normalization,
            );

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
                .flatMap(promotion => promotion.ids);
            for (const promotion of plan.promotions) {
                if (!appendedSet.has(promotion.contentHash)) {
                    setReasonForIds(plan.ignoredReasons, promotion.ids, 'already covered by bounded memory');
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
            const now = new Date().toISOString();
            writeAutoPromoteState(this.dataDir, workspaceId, {
                lastRunAt: now,
                lastRunTrigger: payload.trigger ?? 'manual',
                ...(isAutoTrigger(payload.trigger) ? {
                    lastAutoRunAt: now,
                    lastTrigger: payload.trigger,
                    lastSkipReason: counts.promoted === 0 ? 'no-qualifying-candidates' : undefined,
                } : {}),
            });
            this.getWsServer?.()?.broadcastProcessEvent({
                type: 'memory-promote:completed',
                workspaceId,
                trigger: payload.trigger ?? 'manual',
                target,
                counts: { ...counts },
                timestamp: Date.now(),
            });

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
            try { lock?.release(); } catch { /* already released */ }
        }
    }

    private resolveMemoryDir(workspaceId: string, target: 'memory' | 'system'): string {
        return path.dirname(this.resolveMemoryPath(workspaceId, target));
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

    private recordAutoSkip(workspaceId: string, trigger: 'auto-threshold' | 'auto-cron', reason: string, details: Record<string, unknown>): void {
        const now = new Date().toISOString();
        writeAutoPromoteState(this.dataDir, workspaceId, {
            lastRunAt: now,
            lastRunTrigger: trigger,
            lastAutoRunAt: now,
            lastTrigger: trigger,
            lastSkipReason: reason,
        });
        this.getWsServer?.()?.broadcastProcessEvent({
            type: 'memory-promote:skipped',
            workspaceId,
            reason,
            details: { trigger, ...details },
            timestamp: Date.now(),
        });
    }
}

function planCandidateFinalization(
    selected: RankedMemoryCandidate[],
    existingContentHashes: Set<string>,
    normalization: CandidateNormalizationResult,
): {
    promotions: CandidatePromotion[];
    droppedReasons: Record<string, string>;
    ignoredReasons: Record<string, string>;
} {
    const promotions: CandidatePromotion[] = [];
    const droppedReasons: Record<string, string> = { ...normalization.droppedReasons };
    const ignoredReasons: Record<string, string> = {};
    const plannedEntries = new Set<string>();
    const plannedContentHashes = new Set<string>();
    const selectedIds = new Set(selected.map(candidate => candidate.id));
    const plannedCandidateIds = new Set<string>();

    for (const group of normalization.groups) {
        const candidateIds = group.candidateIds.filter(id => selectedIds.has(id) && !droppedReasons[id]);
        if (candidateIds.length === 0) {
            continue;
        }
        const entry = normalizeMemoryCandidateContent(group.entry);
        if (!entry) {
            setReasonForIds(droppedReasons, candidateIds, 'empty candidate content');
            continue;
        }
        const contentHash = hashMemoryCandidateContent(entry);

        const scan = scanMemoryContent(entry);
        if (scan.blocked) {
            setReasonForIds(
                droppedReasons,
                candidateIds,
                `blocked by security scanner: ${scan.reason ?? scan.patternId ?? 'unknown reason'}`,
            );
            continue;
        }

        if (existingContentHashes.has(contentHash)) {
            setReasonForIds(ignoredReasons, candidateIds, 'already covered by bounded memory');
            continue;
        }

        if (plannedEntries.has(entry) || plannedContentHashes.has(contentHash)) {
            setReasonForIds(ignoredReasons, candidateIds, 'duplicate selected candidate');
            continue;
        }

        plannedEntries.add(entry);
        plannedContentHashes.add(contentHash);
        for (const id of candidateIds) {
            plannedCandidateIds.add(id);
        }
        promotions.push({ ids: candidateIds, entry, contentHash });
    }

    for (const candidate of selected) {
        if (!plannedCandidateIds.has(candidate.id) && !droppedReasons[candidate.id] && !ignoredReasons[candidate.id]) {
            droppedReasons[candidate.id] = 'candidate was not covered by normalization output';
        }
    }

    return { promotions, droppedReasons, ignoredReasons };
}

async function normalizeSelectedCandidates(
    selected: RankedMemoryCandidate[],
    aiService: ISDKService,
    config: MemoryPromoteConfig,
    taskModel: string | undefined,
    logger: ReturnType<typeof getLogger>,
    context: { workspaceId: string; target: string },
): Promise<CandidateNormalizationResult> {
    const deterministic = createDeterministicNormalization(selected);
    if (!config.aiNormalization.enabled) {
        return deterministic;
    }

    try {
        const result = await aiService.sendMessage({
            prompt: buildNormalizationPrompt(selected),
            model: taskModel ?? config.aiNormalization.model ?? config.model,
            systemMessage: { mode: 'replace', content: NORMALIZATION_SYSTEM_PROMPT },
            workingDirectory: undefined,
            timeoutMs: config.aiNormalization.timeoutMs,
        });
        if (!result.success || !result.response) {
            logger.debug(
                LogCategory.AI,
                `[MemoryPromote] AI normalization produced no response for ${context.target}@${context.workspaceId}; using deterministic candidates`,
            );
            return deterministic;
        }

        return validateAiNormalizationOutput(parseJsonFromResponse(result.response), selected);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug(
            LogCategory.AI,
            `[MemoryPromote] AI normalization failed for ${context.target}@${context.workspaceId}: ${message}; using deterministic candidates`,
        );
        return deterministic;
    }
}

function createDeterministicNormalization(selected: RankedMemoryCandidate[]): CandidateNormalizationResult {
    return {
        groups: selected.map(candidate => ({
            candidateIds: [candidate.id],
            entry: normalizeMemoryCandidateContent(candidate.content),
        })),
        droppedReasons: {},
    };
}

const NORMALIZATION_SYSTEM_PROMPT = [
    'You are normalizing candidate memory entries.',
    'Return a JSON array of normalized candidate objects.',
    'Operate only on the provided candidate set.',
    'Do not include existing memory entries unless they are exact duplicate context.',
    'Do not propose deletes or replacements.',
    'Each object must have candidateIds, content, durable, and optional kind/reason fields.',
].join('\n');

function buildNormalizationPrompt(selected: RankedMemoryCandidate[]): string {
    const candidates = selected.map(candidate => ({
        id: candidate.id,
        content: candidate.content,
        score: candidate.score,
        signalCount: candidate.candidate.signalCount,
        explicitMemoryIntent: candidate.explicitMemoryIntent,
        conceptTags: candidate.candidate.conceptTags,
    }));
    return [
        'Normalize these candidate memory entries.',
        '',
        'Safe actions:',
        '1. Merge near-duplicate candidate facts.',
        '2. Rewrite candidate facts as concise self-contained memory entries.',
        '3. Classify candidate kind.',
        '4. Flag trivial or non-durable candidates with durable=false.',
        '',
        'Output JSON shape:',
        '[{"candidateIds":["candidate-id"],"content":"normalized memory entry","kind":"preference","durable":true,"reason":"optional"}]',
        '',
        '<candidates>',
        JSON.stringify(candidates, null, 2),
        '</candidates>',
    ].join('\n');
}

function parseJsonFromResponse(response: string): unknown {
    const fenceMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenceMatch ? fenceMatch[1].trim() : response.trim();
    try {
        return JSON.parse(candidate);
    } catch {
        const arrayMatch = candidate.match(/(\[[\s\S]*\])/);
        if (arrayMatch) {
            return JSON.parse(arrayMatch[1]);
        }
        throw new Error(`Cannot extract JSON array from AI normalization response: ${candidate.slice(0, 120)}`);
    }
}

function validateAiNormalizationOutput(
    raw: unknown,
    selected: RankedMemoryCandidate[],
): CandidateNormalizationResult {
    if (!Array.isArray(raw)) {
        throw new Error('AI normalization output must be a JSON array.');
    }

    const selectedById = new Map(selected.map(candidate => [candidate.id, candidate]));
    const claimedIds = new Set<string>();
    const groups: CandidateNormalizationGroup[] = [];
    const droppedReasons: Record<string, string> = {};

    for (const item of raw) {
        if (!isRecord(item) || !Array.isArray(item.candidateIds)) {
            continue;
        }
        const candidateIds = item.candidateIds.filter((id): id is string => typeof id === 'string');
        if (
            candidateIds.length === 0
            || candidateIds.length !== item.candidateIds.length
            || new Set(candidateIds).size !== candidateIds.length
            || candidateIds.some(id => !selectedById.has(id) || claimedIds.has(id))
        ) {
            continue;
        }

        if (item.durable === false) {
            const reason = typeof item.reason === 'string' && item.reason.trim()
                ? item.reason.trim()
                : 'AI normalization marked candidate non-durable';
            setReasonForIds(droppedReasons, candidateIds, reason);
            for (const id of candidateIds) {
                claimedIds.add(id);
            }
            continue;
        }

        if (item.durable !== true || typeof item.content !== 'string') {
            continue;
        }

        const entry = normalizeMemoryCandidateContent(item.content);
        if (!entry) {
            continue;
        }

        const scan = scanMemoryContent(entry);
        if (scan.blocked) {
            setReasonForIds(
                droppedReasons,
                candidateIds,
                `blocked by security scanner: ${scan.reason ?? scan.patternId ?? 'unknown reason'}`,
            );
            for (const id of candidateIds) {
                claimedIds.add(id);
            }
            continue;
        }

        groups.push({ candidateIds, entry });
        for (const id of candidateIds) {
            claimedIds.add(id);
        }
    }

    for (const candidate of selected) {
        if (!claimedIds.has(candidate.id)) {
            groups.push({
                candidateIds: [candidate.id],
                entry: normalizeMemoryCandidateContent(candidate.content),
            });
        }
    }

    return { groups, droppedReasons };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function setReasonForIds(target: Record<string, string>, ids: string[], reason: string): void {
    for (const id of ids) {
        target[id] = reason;
    }
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

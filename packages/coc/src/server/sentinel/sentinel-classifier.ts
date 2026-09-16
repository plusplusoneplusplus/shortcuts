import type { AIProcess, ConversationTurn, ProcessStore } from '@plusplusoneplusplus/forge';

const DAY_MS = 24 * 60 * 60 * 1_000;
const HOUR_MS = 60 * 60 * 1_000;

export const DEFAULT_SENTINEL_RECENCY_WINDOW_MS = 7 * DAY_MS;
export const DEFAULT_SENTINEL_QUEUED_THRESHOLD_MS = HOUR_MS;
export const DEFAULT_SENTINEL_LOOSE_END_CONFIDENCE = 0.7;
export const DEFAULT_SENTINEL_PINNED_LOOSE_END_CONFIDENCE = 0.55;
export const DEFAULT_SENTINEL_FINAL_TURN_COUNT = 4;

export type SentinelBucket =
    | 'blocked-on-you'
    | 'failed'
    | 'stuck-in-queue'
    | 'loose-ends'
    | 'done-unread';

export interface SentinelClassification {
    processId: string;
    bucket: SentinelBucket;
    reason: string;
}

export interface SentinelLooseEndCandidate {
    processId: string;
    title: string;
    pinned: boolean;
    finalTurns: Array<Pick<ConversationTurn, 'role' | 'content' | 'timestamp' | 'turnIndex'>>;
}

export interface SentinelLooseEndVerdict {
    processId: string;
    verdict: 'loose-end' | 'ignore';
    confidence: number;
    reason?: string;
}

export type SentinelLooseEndJudge = (
    candidates: SentinelLooseEndCandidate[],
) => Promise<SentinelLooseEndVerdict[]>;

export interface SentinelClassificationOptions {
    sentinelProcessId: string;
    now?: Date;
    recencyWindowMs?: number;
    queuedThresholdMs?: number;
    looseEndConfidence?: number;
    pinnedLooseEndConfidence?: number;
    finalTurnCount?: number;
}

export interface SentinelClassificationResult {
    excludedProcessIds: string[];
    entries: SentinelClassification[];
}

export interface SentinelSeenStateReader {
    getSeenMap(workspaceId: string): Record<string, string>;
}

export interface ScanSentinelWorkspaceOptions extends SentinelClassificationOptions {
    workspaceId: string;
    processStore: Pick<ProcessStore, 'getAllProcesses'>;
    seenStateReader?: SentinelSeenStateReader;
    judgeLooseEnds: SentinelLooseEndJudge;
}

const BUCKET_ORDER = new Map<SentinelBucket, number>([
    ['blocked-on-you', 0],
    ['failed', 1],
    ['stuck-in-queue', 2],
    ['loose-ends', 3],
    ['done-unread', 4],
]);

function isSentinel(process: AIProcess): boolean {
    return process.metadata?.mode === 'sentinel';
}

function activityTime(process: AIProcess): number {
    return (process.lastEventAt ?? process.endTime ?? process.startTime).getTime();
}

function processTitle(process: AIProcess): string {
    return process.customTitle ?? process.title ?? process.promptPreview;
}

function isInWorkspace(process: AIProcess, workspaceId: string): boolean {
    return process.metadata?.workspaceId === workspaceId;
}

export function resolveSentinelExclusionSet(
    processes: AIProcess[],
    sentinelProcessId: string,
): Set<string> {
    const excluded = new Set<string>([
        sentinelProcessId,
        ...processes.filter(isSentinel).map(process => process.id),
    ]);

    let changed = true;
    while (changed) {
        changed = false;
        for (const process of processes) {
            if (process.parentProcessId && excluded.has(process.parentProcessId) && !excluded.has(process.id)) {
                excluded.add(process.id);
                changed = true;
            }
        }
    }

    return excluded;
}

function deterministicClassification(
    process: AIProcess,
    now: Date,
    queuedThresholdMs: number,
): SentinelClassification | undefined {
    if (process.pendingAskUser && process.pendingAskUser.length > 0) {
        return {
            processId: process.id,
            bucket: 'blocked-on-you',
            reason: `Waiting for your answer: ${process.pendingAskUser[0].question}`,
        };
    }

    if (process.status === 'failed' || process.stale === true) {
        return {
            processId: process.id,
            bucket: 'failed',
            reason: process.stale === true
                ? 'The chat was marked stale.'
                : process.error ?? 'The chat failed.',
        };
    }

    const effectiveQueuedThreshold = process.pinnedAt ? queuedThresholdMs / 2 : queuedThresholdMs;
    if (process.status === 'queued'
        && now.getTime() - process.startTime.getTime() >= effectiveQueuedThreshold) {
        return {
            processId: process.id,
            bucket: 'stuck-in-queue',
            reason: 'The chat has remained queued longer than expected.',
        };
    }

    return undefined;
}

function sortClassifications(
    entries: SentinelClassification[],
    processesById: Map<string, AIProcess>,
): SentinelClassification[] {
    return entries.sort((left, right) => {
        const bucketDifference = BUCKET_ORDER.get(left.bucket)! - BUCKET_ORDER.get(right.bucket)!;
        if (bucketDifference !== 0) {
            return bucketDifference;
        }

        const leftProcess = processesById.get(left.processId)!;
        const rightProcess = processesById.get(right.processId)!;
        const pinDifference = Number(Boolean(rightProcess.pinnedAt)) - Number(Boolean(leftProcess.pinnedAt));
        if (pinDifference !== 0) {
            return pinDifference;
        }

        return activityTime(rightProcess) - activityTime(leftProcess)
            || left.processId.localeCompare(right.processId);
    });
}

export async function classifySentinelProcesses(
    processes: AIProcess[],
    seenAtByProcessId: Record<string, string>,
    judgeLooseEnds: SentinelLooseEndJudge,
    options: SentinelClassificationOptions,
): Promise<SentinelClassificationResult> {
    const now = options.now ?? new Date();
    const recencyWindowMs = options.recencyWindowMs ?? DEFAULT_SENTINEL_RECENCY_WINDOW_MS;
    const queuedThresholdMs = options.queuedThresholdMs ?? DEFAULT_SENTINEL_QUEUED_THRESHOLD_MS;
    const finalTurnCount = options.finalTurnCount ?? DEFAULT_SENTINEL_FINAL_TURN_COUNT;
    const excluded = resolveSentinelExclusionSet(processes, options.sentinelProcessId);
    const eligible = processes.filter(process =>
        !process.archived
        && !excluded.has(process.id)
        && now.getTime() - activityTime(process) >= 0
        && now.getTime() - activityTime(process) <= recencyWindowMs,
    );
    const processesById = new Map(eligible.map(process => [process.id, process]));
    const entries: SentinelClassification[] = [];
    const completedCandidates: AIProcess[] = [];

    for (const process of eligible) {
        const deterministic = deterministicClassification(process, now, queuedThresholdMs);
        if (deterministic) {
            entries.push(deterministic);
        } else if (process.status === 'completed') {
            completedCandidates.push(process);
        }
    }

    const candidates = completedCandidates.flatMap(process => {
        const finalTurns = process.conversationTurns?.slice(-finalTurnCount);
        return finalTurns && finalTurns.length > 0 ? [{
            processId: process.id,
            title: processTitle(process),
            pinned: Boolean(process.pinnedAt),
            finalTurns: finalTurns.map(turn => ({
                role: turn.role,
                content: turn.content,
                timestamp: turn.timestamp,
                turnIndex: turn.turnIndex,
            })),
        }] : [];
    });
    const verdicts = candidates.length > 0 ? await judgeLooseEnds(candidates) : [];
    const verdictByProcessId = new Map(verdicts.map(verdict => [verdict.processId, verdict]));

    for (const process of completedCandidates) {
        const verdict = verdictByProcessId.get(process.id);
        const confidenceThreshold = process.pinnedAt
            ? options.pinnedLooseEndConfidence ?? DEFAULT_SENTINEL_PINNED_LOOSE_END_CONFIDENCE
            : options.looseEndConfidence ?? DEFAULT_SENTINEL_LOOSE_END_CONFIDENCE;
        if (verdict?.verdict === 'loose-end'
            && Number.isFinite(verdict.confidence)
            && verdict.confidence >= confidenceThreshold) {
            entries.push({
                processId: process.id,
                bucket: 'loose-ends',
                reason: verdict.reason ?? 'The chat appears to have unfinished follow-up work.',
            });
        } else if (process.endTime && seenAtByProcessId[process.id] === undefined) {
            entries.push({
                processId: process.id,
                bucket: 'done-unread',
                reason: 'The completed chat has not been read.',
            });
        }
    }

    return {
        excludedProcessIds: [...excluded].sort(),
        entries: sortClassifications(entries, processesById),
    };
}

export async function scanSentinelWorkspace(
    options: ScanSentinelWorkspaceOptions,
): Promise<SentinelClassificationResult> {
    const processes = await options.processStore.getAllProcesses({
        workspaceId: options.workspaceId,
    });
    const workspaceProcesses = processes.filter(process => isInWorkspace(process, options.workspaceId));
    const seenAtByProcessId = options.seenStateReader?.getSeenMap(options.workspaceId) ?? {};
    return classifySentinelProcesses(
        workspaceProcesses,
        seenAtByProcessId,
        options.judgeLooseEnds,
        options,
    );
}

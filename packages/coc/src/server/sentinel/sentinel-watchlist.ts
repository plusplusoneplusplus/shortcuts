import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';
import type {
    SentinelBucket,
    SentinelClassificationResult,
} from './sentinel-classifier';
import {
    createSentinelBoardStorage,
    findNewlyApprovedSentinelNudges,
    foldSentinelBoardEdits,
    renderSentinelBoard,
    SENTINEL_BOARD_WRITE_ATTEMPTS,
    type SentinelBoardStorage,
} from './sentinel-board';
import {
    buildSentinelNudgeDraft,
    planApprovedSentinelNudges,
    type SentinelNudgeExecutor,
} from './sentinel-nudge';

const DAY_MS = 24 * 60 * 60 * 1_000;

export const SENTINEL_WATCHLIST_VERSION = 3;
export const SENTINEL_RESOLVED_RETENTION_MS = 30 * DAY_MS;

export type SentinelDisposition = 'watching' | 'nudged' | 'muted' | 'resolved';

export interface SentinelWatchlistEntry {
    processId: string;
    bucket: SentinelBucket;
    disposition: SentinelDisposition;
    reason: string;
    nudgeCount: number;
    lastNudgedAt?: string;
    snoozedUntil?: string;
    addedAt: string;
    resolvedAt?: string;
}

export interface SentinelWatchlist {
    version: number;
    sentinelProcessId: string;
    claimedAt: string;
    excludedProcessIds: string[];
    entries: SentinelWatchlistEntry[];
    lastRenderedBoard?: string;
}

export interface PersistSentinelClassificationOptions {
    dataDir: string;
    workspaceId: string;
    sentinelProcessId: string;
    processStore: Pick<ProcessStore, 'getAllProcesses'>;
    classification: SentinelClassificationResult;
    now?: Date;
    resolvedRetentionMs?: number;
    boardStorage?: SentinelBoardStorage;
    nudgeExecutor?: SentinelNudgeExecutor;
    tickWindowMs?: number;
    maxNudges?: number;
    resumeMaxAgeMs?: number;
    muteProcessIds?: string[];
}

const BUCKETS = new Set<SentinelBucket>([
    'blocked-on-you',
    'failed',
    'stuck-in-queue',
    'loose-ends',
    'done-unread',
]);
const DISPOSITIONS = new Set<SentinelDisposition>([
    'watching',
    'nudged',
    'muted',
    'resolved',
]);
const watchlistQueues = new Map<string, Promise<void>>();

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === code;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseEntry(value: unknown, fallbackAddedAt: string): SentinelWatchlistEntry | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.processId !== 'string' || candidate.processId.length === 0) {
        return undefined;
    }

    return {
        processId: candidate.processId,
        bucket: typeof candidate.bucket === 'string' && BUCKETS.has(candidate.bucket as SentinelBucket)
            ? candidate.bucket as SentinelBucket
            : 'loose-ends',
        disposition: typeof candidate.disposition === 'string'
            && DISPOSITIONS.has(candidate.disposition as SentinelDisposition)
            ? candidate.disposition as SentinelDisposition
            : 'watching',
        reason: typeof candidate.reason === 'string' ? candidate.reason : '',
        nudgeCount: typeof candidate.nudgeCount === 'number'
            && Number.isInteger(candidate.nudgeCount)
            && candidate.nudgeCount >= 0
            ? candidate.nudgeCount
            : 0,
        ...(optionalString(candidate.lastNudgedAt)
            ? { lastNudgedAt: optionalString(candidate.lastNudgedAt) }
            : {}),
        ...(optionalString(candidate.snoozedUntil)
            ? { snoozedUntil: optionalString(candidate.snoozedUntil) }
            : {}),
        addedAt: optionalString(candidate.addedAt) ?? fallbackAddedAt,
        ...(optionalString(candidate.resolvedAt)
            ? { resolvedAt: optionalString(candidate.resolvedAt) }
            : {}),
    };
}

function parseWatchlist(value: unknown): SentinelWatchlist | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.sentinelProcessId !== 'string' || candidate.sentinelProcessId.length === 0) {
        return undefined;
    }
    const claimedAt = typeof candidate.claimedAt === 'string' ? candidate.claimedAt : '';

    return {
        version: SENTINEL_WATCHLIST_VERSION,
        sentinelProcessId: candidate.sentinelProcessId,
        claimedAt,
        excludedProcessIds: [...new Set([
            candidate.sentinelProcessId,
            ...(Array.isArray(candidate.excludedProcessIds)
                ? candidate.excludedProcessIds.filter(
                    (id): id is string => typeof id === 'string' && id.length > 0,
                )
                : []),
        ])].sort(),
        entries: Array.isArray(candidate.entries)
            ? candidate.entries.flatMap(entry => {
                const parsed = parseEntry(entry, claimedAt);
                return parsed ? [parsed] : [];
            })
            : [],
        ...(typeof candidate.lastRenderedBoard === 'string'
            ? { lastRenderedBoard: candidate.lastRenderedBoard }
            : {}),
    };
}

export function getSentinelWatchlistPath(dataDir: string, workspaceId: string): string {
    return path.join(
        getRepoDataPath(dataDir, workspaceId, 'notes'),
        'Sentinel',
        '.watchlist.json',
    );
}

export function createSentinelWatchlist(processId: string, now: Date): SentinelWatchlist {
    return {
        version: SENTINEL_WATCHLIST_VERSION,
        sentinelProcessId: processId,
        claimedAt: now.toISOString(),
        excludedProcessIds: [processId],
        entries: [],
    };
}

export async function readSentinelWatchlist(
    dataDir: string,
    workspaceId: string,
): Promise<SentinelWatchlist | undefined> {
    return readSentinelWatchlistFile(getSentinelWatchlistPath(dataDir, workspaceId));
}

export async function readSentinelWatchlistFile(
    filePath: string,
): Promise<SentinelWatchlist | undefined> {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        if (content.trim().length === 0) return undefined;
        return parseWatchlist(JSON.parse(content));
    } catch (error) {
        if (isNodeError(error, 'ENOENT') || error instanceof SyntaxError) return undefined;
        throw error;
    }
}

export async function createSentinelWatchlistExclusive(
    filePath: string,
    watchlist: SentinelWatchlist,
): Promise<boolean> {
    try {
        await fs.promises.writeFile(filePath, `${JSON.stringify(watchlist, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
        });
        return true;
    } catch (error) {
        if (isNodeError(error, 'EEXIST')) return false;
        throw error;
    }
}

export async function writeSentinelWatchlist(
    dataDir: string,
    workspaceId: string,
    watchlist: SentinelWatchlist,
): Promise<void> {
    const filePath = getSentinelWatchlistPath(dataDir, workspaceId);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await withSentinelWatchlistLock(filePath, () => writeSentinelWatchlistFile(filePath, watchlist));
}

async function writeSentinelWatchlistFile(
    filePath: string,
    watchlist: SentinelWatchlist,
): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.promises.writeFile(
            temporaryPath,
            `${JSON.stringify({ ...watchlist, version: SENTINEL_WATCHLIST_VERSION }, null, 2)}\n`,
            { encoding: 'utf8', flag: 'wx' },
        );
        await fs.promises.rename(temporaryPath, filePath);
    } finally {
        try {
            await fs.promises.unlink(temporaryPath);
        } catch (error) {
            if (!isNodeError(error, 'ENOENT')) throw error;
        }
    }
}

export async function withSentinelWatchlistLock<T>(
    filePath: string,
    operation: () => Promise<T>,
): Promise<T> {
    const previous = watchlistQueues.get(filePath) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const current = previous.then(() => gate);
    watchlistQueues.set(filePath, current);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (watchlistQueues.get(filePath) === current) watchlistQueues.delete(filePath);
    }
}

export function reconcileSentinelWatchlist(
    watchlist: SentinelWatchlist,
    classification: SentinelClassificationResult,
    processes: AIProcess[],
    now: Date,
    resolvedRetentionMs = SENTINEL_RESOLVED_RETENTION_MS,
): SentinelWatchlist {
    const processById = new Map(processes.map(process => [process.id, process]));
    const retainedEntries = watchlist.entries.filter(entry => {
        const process = processById.get(entry.processId);
        if (!process || process.archived) return false;
        if (entry.disposition !== 'resolved') return true;

        const resolvedAt = Date.parse(entry.resolvedAt ?? entry.addedAt);
        return !Number.isFinite(resolvedAt)
            || now.getTime() - resolvedAt <= resolvedRetentionMs;
    });
    const entryByProcessId = new Map(retainedEntries.map(entry => [entry.processId, entry]));

    for (const classified of classification.entries) {
        const process = processById.get(classified.processId);
        if (!process || process.archived) continue;
        const existing = entryByProcessId.get(classified.processId);
        entryByProcessId.set(classified.processId, existing
            ? { ...existing, bucket: classified.bucket, reason: classified.reason }
            : {
                processId: classified.processId,
                bucket: classified.bucket,
                disposition: 'watching',
                reason: classified.reason,
                nudgeCount: 0,
                addedAt: now.toISOString(),
            });
    }

    return {
        ...watchlist,
        version: SENTINEL_WATCHLIST_VERSION,
        excludedProcessIds: [...new Set(classification.excludedProcessIds)].sort(),
        entries: [...entryByProcessId.values()].sort((left, right) =>
            left.processId.localeCompare(right.processId),
        ),
    };
}

export async function persistSentinelClassification(
    options: PersistSentinelClassificationOptions,
): Promise<SentinelWatchlist | undefined> {
    const filePath = getSentinelWatchlistPath(options.dataDir, options.workspaceId);
    return withSentinelWatchlistLock(filePath, async () => {
        const boardStorage = options.boardStorage
            ?? createSentinelBoardStorage(options.dataDir, options.workspaceId);
        await boardStorage.ensureConfig();

        for (let attempt = 0; attempt < SENTINEL_BOARD_WRITE_ATTEMPTS; attempt++) {
            const watchlist = await readSentinelWatchlistFile(filePath);
            if (!watchlist || watchlist.sentinelProcessId !== options.sentinelProcessId) {
                return undefined;
            }
            const board = await boardStorage.readBoard();
            const now = options.now ?? new Date();
            const withBoardEdits = foldSentinelBoardEdits(watchlist, board?.content ?? '', now);
            const configuredMuteIds = new Set(options.muteProcessIds ?? []);
            const withConfiguredMutes = configuredMuteIds.size === 0
                ? withBoardEdits
                : {
                    ...withBoardEdits,
                    entries: withBoardEdits.entries.map(entry =>
                        configuredMuteIds.has(entry.processId)
                            ? { ...entry, disposition: 'muted' as const }
                            : entry,
                    ),
                };
            const processes = (await options.processStore.getAllProcesses({
                workspaceId: options.workspaceId,
            })).filter(process => process.metadata?.workspaceId === options.workspaceId);
            const policy = {
                now,
                tickWindowMs: options.tickWindowMs ?? 60 * 60 * 1_000,
                maxNudges: options.maxNudges,
                resumeMaxAgeMs: options.resumeMaxAgeMs,
            };
            const approvals = findNewlyApprovedSentinelNudges(
                watchlist.lastRenderedBoard,
                board?.content ?? '',
            );
            const baseReconciled = reconcileSentinelWatchlist(
                withConfiguredMutes,
                options.classification,
                processes,
                now,
                options.resolvedRetentionMs,
            );
            const nudgePlan = approvals.size > 0
                ? planApprovedSentinelNudges(
                    baseReconciled,
                    processes,
                    approvals,
                    policy,
                )
                : { watchlist: baseReconciled, drafts: [] };
            const drafts = nudgePlan.watchlist.entries.flatMap(entry => {
                const process = processes.find(candidate => candidate.id === entry.processId);
                if (!process) {
                    return [];
                }
                const draft = buildSentinelNudgeDraft(entry, process, policy);
                return draft ? [draft] : [];
            });
            const renderedBoard = renderSentinelBoard(
                options.workspaceId,
                nudgePlan.watchlist,
                processes,
                drafts,
            );
            const nextWatchlist = { ...nudgePlan.watchlist, lastRenderedBoard: renderedBoard };
            const executeNudge = options.nudgeExecutor;
            if (nudgePlan.drafts.length > 0 && !executeNudge) {
                throw new Error('Sentinel nudge executor is unavailable');
            }

            if (board?.content !== renderedBoard) {
                const written = await boardStorage.writeBoard(renderedBoard, board?.mtimeMs);
                if (!written) {
                    continue;
                }
            }
            let persistedWatchlist = {
                ...baseReconciled,
                lastRenderedBoard: renderedBoard,
            };
            await writeSentinelWatchlistFile(filePath, persistedWatchlist);
            for (const draft of nudgePlan.drafts) {
                await executeNudge?.(draft);
                const plannedEntry = nextWatchlist.entries.find(
                    entry => entry.processId === draft.processId,
                );
                if (plannedEntry) {
                    persistedWatchlist = {
                        ...persistedWatchlist,
                        entries: persistedWatchlist.entries.map(entry =>
                            entry.processId === draft.processId ? plannedEntry : entry,
                        ),
                    };
                    await writeSentinelWatchlistFile(filePath, persistedWatchlist);
                }
            }
            return persistedWatchlist;
        }

        throw new Error(
            `Sentinel board changed during ${SENTINEL_BOARD_WRITE_ATTEMPTS} write attempts`,
        );
    });
}

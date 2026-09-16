import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import * as fs from 'fs';
import * as path from 'path';
import {
    createSentinelWatchlist,
    createSentinelWatchlistExclusive,
    getSentinelWatchlistPath,
    readSentinelWatchlistFile,
    SENTINEL_WATCHLIST_VERSION,
    type SentinelWatchlist,
    withSentinelWatchlistLock,
} from './sentinel-watchlist';

export { SENTINEL_WATCHLIST_VERSION };
export const SENTINEL_CLAIM_GRACE_MS = 60_000;

export type SentinelOwnershipRecord = SentinelWatchlist;

export type SentinelClaimResult =
    | { status: 'claimed'; replacedProcessId?: string }
    | { status: 'existing'; processId: string };

export interface SentinelClaimOptions {
    dataDir: string;
    workspaceId: string;
    processId: string;
    processStore: ProcessStore;
    replaceProcessId?: string;
    now?: () => Date;
    claimGraceMs?: number;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === code;
}

export async function resolveLiveSentinelOwner(
    dataDir: string,
    workspaceId: string,
    processStore: Pick<ProcessStore, 'getProcess'>,
): Promise<AIProcess | undefined> {
    const record = await readSentinelWatchlistFile(getSentinelWatchlistPath(dataDir, workspaceId));
    if (!record) return undefined;
    const process = await processStore.getProcess(record.sentinelProcessId, workspaceId);
    return isSentinelProcess(process, workspaceId) ? process : undefined;
}

function isSentinelProcess(process: AIProcess | undefined, workspaceId: string): boolean {
    return process !== undefined
        && process.archived !== true
        && process.metadata?.workspaceId === workspaceId
        && process.metadata?.mode === 'sentinel'
        && process.status !== 'failed'
        && process.status !== 'cancelled'
        && process.status !== 'cancelling';
}

function isRecentUnvalidatedClaim(
    record: SentinelOwnershipRecord,
    now: Date,
    claimGraceMs: number,
): boolean {
    const claimedAt = Date.parse(record.claimedAt);
    return Number.isFinite(claimedAt)
        && now.getTime() - claimedAt >= 0
        && now.getTime() - claimedAt < claimGraceMs;
}

/**
 * Atomically claims the workspace's Sentinel marker. Missing, corrupt, or stale
 * ownership is reclaimed; a live owner is returned for an open/replace choice.
 */
export async function claimSentinelOwnership(options: SentinelClaimOptions): Promise<SentinelClaimResult> {
    const filePath = getSentinelWatchlistPath(options.dataDir, options.workspaceId);
    const now = options.now ?? (() => new Date());
    const claimGraceMs = options.claimGraceMs ?? SENTINEL_CLAIM_GRACE_MS;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    return withSentinelWatchlistLock(filePath, async () => {
        const nextRecord = createSentinelWatchlist(options.processId, now());
        if (await createSentinelWatchlistExclusive(filePath, nextRecord)) return { status: 'claimed' };

        const current = await readSentinelWatchlistFile(filePath);
        if (current?.sentinelProcessId === options.processId) return { status: 'claimed' };

        if (current) {
            const owner = await options.processStore.getProcess(
                current.sentinelProcessId,
                options.workspaceId,
            );
            const ownerIsActive = isSentinelProcess(owner, options.workspaceId)
                || isRecentUnvalidatedClaim(current, now(), claimGraceMs);
            const confirmedReplacement = options.replaceProcessId === current.sentinelProcessId;
            if (ownerIsActive && !confirmedReplacement) {
                return { status: 'existing', processId: current.sentinelProcessId };
            }
        }

        try {
            await fs.promises.unlink(filePath);
        } catch (error) {
            if (!isNodeError(error, 'ENOENT')) throw error;
        }

        if (await createSentinelWatchlistExclusive(filePath, nextRecord)) {
            return {
                status: 'claimed',
                ...(current ? { replacedProcessId: current.sentinelProcessId } : {}),
            };
        }

        const winner = await readSentinelWatchlistFile(filePath);
        if (!winner) {
            throw new Error('Sentinel ownership changed without a readable watchlist owner');
        }
        return { status: 'existing', processId: winner.sentinelProcessId };
    });
}

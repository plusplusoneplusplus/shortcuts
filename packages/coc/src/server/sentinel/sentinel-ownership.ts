import type { AIProcess, ProcessStore } from '@plusplusoneplusplus/forge';
import * as fs from 'fs';
import * as path from 'path';
import { getRepoDataPath } from '../paths';

export const SENTINEL_WATCHLIST_VERSION = 1;
export const SENTINEL_CLAIM_GRACE_MS = 60_000;

export interface SentinelOwnershipRecord {
    version: number;
    sentinelProcessId: string;
    claimedAt: string;
    excludedProcessIds: string[];
    entries: unknown[];
}

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

const claimQueues = new Map<string, Promise<void>>();

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
    return error instanceof Error && 'code' in error && error.code === code;
}

function watchlistPath(dataDir: string, workspaceId: string): string {
    return path.join(
        getRepoDataPath(dataDir, workspaceId, 'notes'),
        'Sentinel',
        '.watchlist.json',
    );
}

export async function resolveLiveSentinelOwner(
    dataDir: string,
    workspaceId: string,
    processStore: Pick<ProcessStore, 'getProcess'>,
): Promise<AIProcess | undefined> {
    const record = await readRecord(watchlistPath(dataDir, workspaceId));
    if (!record) return undefined;
    const process = await processStore.getProcess(record.sentinelProcessId, workspaceId);
    return isSentinelProcess(process, workspaceId) ? process : undefined;
}

function createRecord(processId: string, now: Date): SentinelOwnershipRecord {
    return {
        version: SENTINEL_WATCHLIST_VERSION,
        sentinelProcessId: processId,
        claimedAt: now.toISOString(),
        excludedProcessIds: [processId],
        entries: [],
    };
}

function parseRecord(value: unknown): SentinelOwnershipRecord | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const candidate = value as Record<string, unknown>;
    if (typeof candidate.sentinelProcessId !== 'string' || candidate.sentinelProcessId.length === 0) {
        return undefined;
    }
    return {
        version: typeof candidate.version === 'number' ? candidate.version : SENTINEL_WATCHLIST_VERSION,
        sentinelProcessId: candidate.sentinelProcessId,
        claimedAt: typeof candidate.claimedAt === 'string' ? candidate.claimedAt : '',
        excludedProcessIds: Array.isArray(candidate.excludedProcessIds)
            ? candidate.excludedProcessIds.filter((id): id is string => typeof id === 'string')
            : [candidate.sentinelProcessId],
        entries: Array.isArray(candidate.entries) ? candidate.entries : [],
    };
}

async function readRecord(filePath: string): Promise<SentinelOwnershipRecord | undefined> {
    try {
        const content = await fs.promises.readFile(filePath, 'utf8');
        if (content.trim().length === 0) return undefined;
        return parseRecord(JSON.parse(content));
    } catch (error) {
        if (isNodeError(error, 'ENOENT') || error instanceof SyntaxError) return undefined;
        throw error;
    }
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

async function createExclusive(
    filePath: string,
    record: SentinelOwnershipRecord,
): Promise<boolean> {
    try {
        await fs.promises.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
        });
        return true;
    } catch (error) {
        if (isNodeError(error, 'EEXIST')) return false;
        throw error;
    }
}

async function withClaimQueue<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
    const previous = claimQueues.get(filePath) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const current = previous.then(() => gate);
    claimQueues.set(filePath, current);
    await previous;
    try {
        return await operation();
    } finally {
        release();
        if (claimQueues.get(filePath) === current) claimQueues.delete(filePath);
    }
}

/**
 * Atomically claims the workspace's Sentinel marker. Missing, corrupt, or stale
 * ownership is reclaimed; a live owner is returned for an open/replace choice.
 */
export async function claimSentinelOwnership(options: SentinelClaimOptions): Promise<SentinelClaimResult> {
    const filePath = watchlistPath(options.dataDir, options.workspaceId);
    const now = options.now ?? (() => new Date());
    const claimGraceMs = options.claimGraceMs ?? SENTINEL_CLAIM_GRACE_MS;
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    return withClaimQueue(filePath, async () => {
        const nextRecord = createRecord(options.processId, now());
        if (await createExclusive(filePath, nextRecord)) return { status: 'claimed' };

        const current = await readRecord(filePath);
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

        if (await createExclusive(filePath, nextRecord)) {
            return {
                status: 'claimed',
                ...(current ? { replacedProcessId: current.sentinelProcessId } : {}),
            };
        }

        const winner = await readRecord(filePath);
        if (!winner) {
            throw new Error('Sentinel ownership changed without a readable watchlist owner');
        }
        return { status: 'existing', processId: winner.sentinelProcessId };
    });
}

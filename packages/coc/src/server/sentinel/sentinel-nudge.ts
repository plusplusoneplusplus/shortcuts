import * as crypto from 'crypto';
import type {
    AIProcess,
    PendingMessage,
    ProcessStore,
    TaskQueueManager,
} from '@plusplusoneplusplus/forge';
import { resolveFollowUpMode } from '../executors/follow-up-mode';
import type {
    SentinelWatchlist,
    SentinelWatchlistEntry,
} from './sentinel-watchlist';

const DAY_MS = 24 * 60 * 60 * 1_000;

export const DEFAULT_SENTINEL_MAX_NUDGES = 3;
export const DEFAULT_SENTINEL_RESUME_MAX_AGE_MS = 30 * DAY_MS;

export type SentinelNudgeAction = 'follow-up' | 'fresh-chat';

export interface SentinelNudgeDraft {
    processId: string;
    action: SentinelNudgeAction;
    message: string;
}

export interface SentinelNudgePolicy {
    now: Date;
    tickWindowMs: number;
    maxNudges?: number;
    resumeMaxAgeMs?: number;
}

export type SentinelNudgeExecutor = (draft: SentinelNudgeDraft) => Promise<void>;

function processActivityTime(process: AIProcess): number {
    return (process.lastEventAt ?? process.endTime ?? process.startTime).getTime();
}

function draftMessage(entry: SentinelWatchlistEntry): string {
    switch (entry.bucket) {
        case 'blocked-on-you':
            return `Please restate what you need from me so we can continue. Context: ${entry.reason}`;
        case 'failed':
            return `Please review the failure and continue from the last safe point. Context: ${entry.reason}`;
        case 'stuck-in-queue':
            return `Please check why this chat is still queued and report the blocker. Context: ${entry.reason}`;
        case 'loose-ends':
            return `Please continue the unfinished follow-up work. Context: ${entry.reason}`;
        case 'done-unread':
            return `Please summarize the completed result and any action I need to take. Context: ${entry.reason}`;
    }
}

export function buildSentinelNudgeDraft(
    entry: SentinelWatchlistEntry,
    process: AIProcess,
    policy: SentinelNudgePolicy,
): SentinelNudgeDraft | undefined {
    if (entry.disposition === 'muted' || entry.disposition === 'resolved') {
        return undefined;
    }
    if (entry.nudgeCount >= (policy.maxNudges ?? DEFAULT_SENTINEL_MAX_NUDGES)) {
        return undefined;
    }
    const nowMs = policy.now.getTime();
    const snoozedUntil = Date.parse(entry.snoozedUntil ?? '');
    if (Number.isFinite(snoozedUntil) && snoozedUntil > nowMs) {
        return undefined;
    }
    const lastNudgedAt = Date.parse(entry.lastNudgedAt ?? '');
    const backoffMs = policy.tickWindowMs * Math.max(1, 2 ** entry.nudgeCount);
    if (Number.isFinite(lastNudgedAt) && nowMs - lastNudgedAt < backoffMs) {
        return undefined;
    }
    const resumeMaxAgeMs = policy.resumeMaxAgeMs ?? DEFAULT_SENTINEL_RESUME_MAX_AGE_MS;
    const action = nowMs - processActivityTime(process) > resumeMaxAgeMs
        ? 'fresh-chat'
        : 'follow-up';
    return {
        processId: entry.processId,
        action,
        message: draftMessage(entry),
    };
}

export function planApprovedSentinelNudges(
    watchlist: SentinelWatchlist,
    processes: AIProcess[],
    approvedProcessIds: Set<string>,
    policy: SentinelNudgePolicy,
): { watchlist: SentinelWatchlist; drafts: SentinelNudgeDraft[] } {
    const processById = new Map(processes.map(process => [process.id, process]));
    const entries = [...watchlist.entries];
    const drafts: SentinelNudgeDraft[] = [];
    let changed = false;

    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        if (!approvedProcessIds.has(entry.processId)) {
            continue;
        }
        const process = processById.get(entry.processId);
        if (!process || process.archived) {
            continue;
        }
        const draft = buildSentinelNudgeDraft(entry, process, policy);
        if (!draft) {
            continue;
        }
        drafts.push(draft);
        entries[index] = {
            ...entry,
            disposition: 'nudged',
            nudgeCount: entry.nudgeCount + 1,
            lastNudgedAt: policy.now.toISOString(),
        };
        changed = true;
    }

    return {
        watchlist: changed ? { ...watchlist, entries } : watchlist,
        drafts,
    };
}

export async function applyApprovedSentinelNudges(
    watchlist: SentinelWatchlist,
    processes: AIProcess[],
    approvedProcessIds: Set<string>,
    policy: SentinelNudgePolicy,
    execute: SentinelNudgeExecutor,
): Promise<SentinelWatchlist> {
    const planned = planApprovedSentinelNudges(
        watchlist,
        processes,
        approvedProcessIds,
        policy,
    );
    for (const draft of planned.drafts) {
        await execute(draft);
    }
    return planned.watchlist;
}

export interface CreateSentinelNudgeExecutorOptions {
    workspaceId: string;
    sentinelProcessId: string;
    processStore: ProcessStore;
    queueManager: TaskQueueManager;
}

export function createSentinelNudgeExecutor(
    options: CreateSentinelNudgeExecutorOptions,
): SentinelNudgeExecutor {
    return async draft => {
        const target = await options.processStore.getProcess(draft.processId);
        if (!target || target.archived || target.metadata?.workspaceId !== options.workspaceId) {
            throw new Error(`Cannot nudge unavailable process ${draft.processId}`);
        }

        if (draft.action === 'fresh-chat') {
            options.queueManager.enqueue({
                type: 'chat',
                priority: 'normal',
                repoId: options.workspaceId,
                payload: {
                    kind: 'chat',
                    mode: 'ask',
                    prompt: `Continue from [the earlier chat](#repos/${encodeURIComponent(options.workspaceId)}/activity/${encodeURIComponent(draft.processId)}).\n\n${draft.message}`,
                    context: { spawnedFromProcessId: options.sentinelProcessId },
                },
                config: {},
                displayName: `Sentinel follow-up for ${target.customTitle ?? target.title ?? target.promptPreview}`,
            });
            return;
        }

        if (target.status === 'queued' || target.status === 'running' || target.status === 'cancelling') {
            const pendingMessage: PendingMessage = {
                id: crypto.randomUUID(),
                content: draft.message,
                mode: await resolveFollowUpMode(options.processStore, draft.processId),
                createdAt: new Date().toISOString(),
            };
            await options.processStore.appendPendingMessage(draft.processId, pendingMessage);
            return;
        }

        const mode = await resolveFollowUpMode(options.processStore, draft.processId);
        options.queueManager.enqueue({
            processId: draft.processId,
            type: 'chat',
            priority: 'normal',
            repoId: options.workspaceId,
            payload: {
                kind: 'chat',
                mode,
                prompt: draft.message,
                processId: draft.processId,
            },
            config: {},
            displayName: `[Sentinel] ${draft.message.substring(0, 40)}`,
        });
    };
}

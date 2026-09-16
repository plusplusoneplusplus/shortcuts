import * as crypto from 'crypto';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { ProcessStore, QueuedTask, TaskQueueManager } from '@plusplusoneplusplus/forge';
import type { CronStore } from '../cron/cron-store';
import type { CronExecutor, CronEventEmit } from '../cron/cron-executor';
import type { CronChangeEvent, CronEntry } from '../cron/cron-types';
import { DEFAULT_CRON_TTL_MS } from '../cron/cron-types';
import { resolveLiveSentinelOwner } from './sentinel-ownership';

export const SENTINEL_TICK_INTERVAL_MS = 60 * 60 * 1000;
export const SENTINEL_CRON_DESCRIPTION = 'Sentinel workspace scan';
export const SENTINEL_TICK_PROMPT = 'Run the Sentinel workspace scan now.';

export interface SentinelCronProvisioningOptions {
    queueManager: Pick<TaskQueueManager, 'on' | 'off'>;
    store: CronStore;
    executor: Pick<CronExecutor, 'armTimer'>;
    emit?: CronEventEmit;
    now?: () => Date;
    createId?: () => string;
    onError: (error: unknown, task: QueuedTask) => void;
}

export interface SentinelCronCancellationOptions {
    store: Pick<CronStore, 'getByProcess' | 'update'>;
    executor: Pick<CronExecutor, 'disarmTimer'>;
    emit?: CronEventEmit;
}

export interface SentinelCheckNowOptions {
    dataDir: string;
    processStore: Pick<ProcessStore, 'getProcess'>;
    store: Pick<CronStore, 'getByProcess'>;
    executor: Pick<CronExecutor, 'isInflight' | 'triggerNow'>;
}

export type SentinelCheckNowResult =
    | { status: 'triggered'; processId: string; cronId: string }
    | { status: 'not-found' }
    | { status: 'not-ready'; processId: string }
    | { status: 'busy'; processId: string };

function isNewSentinelTask(task: QueuedTask): boolean {
    return task.type === 'chat'
        && task.payload.kind === 'chat'
        && task.payload.mode === 'sentinel'
        && typeof task.payload.processId !== 'string';
}

function safeEmit(emit: CronEventEmit | undefined, event: CronChangeEvent): void {
    if (!emit) return;
    try {
        emit(event);
    } catch {
        // The cron is durable even if a dashboard broadcast fails.
    }
}

export function ensureSentinelCron(
    task: QueuedTask,
    options: Omit<SentinelCronProvisioningOptions, 'queueManager' | 'onError'>,
): CronEntry | undefined {
    if (!isNewSentinelTask(task)) return undefined;

    const workspaceId = typeof task.payload.workspaceId === 'string'
        ? task.payload.workspaceId.trim()
        : '';
    if (!workspaceId) {
        throw new Error('Sentinel cron provisioning requires a workspaceId');
    }

    const processId = toQueueProcessId(task.id);
    const existing = options.store.getByProcess(processId)
        .find(cron => cron.description === SENTINEL_CRON_DESCRIPTION);
    if (existing) return existing;

    const now = (options.now ?? (() => new Date()))();
    const cron: CronEntry = {
        id: options.createId?.() ?? `cron_${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`,
        processId,
        description: SENTINEL_CRON_DESCRIPTION,
        intervalMs: SENTINEL_TICK_INTERVAL_MS,
        status: 'active',
        createdAt: now.toISOString(),
        lastTickAt: null,
        nextTickAt: new Date(now.getTime() + SENTINEL_TICK_INTERVAL_MS).toISOString(),
        tickCount: 0,
        consecutiveFailures: 0,
        expiresAt: new Date(now.getTime() + DEFAULT_CRON_TTL_MS).toISOString(),
        pausedReason: null,
        prompt: SENTINEL_TICK_PROMPT,
        model: null,
        workspaceId,
    };

    options.store.insert(cron);
    options.executor.armTimer(cron);
    safeEmit(options.emit, { type: 'cron-created', cron });
    return cron;
}

export function cancelSentinelCron(
    processId: string,
    options: SentinelCronCancellationOptions,
): number {
    const crons = options.store.getByProcess(processId)
        .filter(cron => cron.description === SENTINEL_CRON_DESCRIPTION
            && cron.status !== 'cancelled'
            && cron.status !== 'expired');
    for (const cron of crons) {
        options.executor.disarmTimer(cron.id);
        cron.status = 'cancelled';
        cron.nextTickAt = null;
        options.store.update(cron);
        safeEmit(options.emit, { type: 'cron-cancelled', cron });
    }
    return crons.length;
}

export async function checkSentinelNow(
    workspaceId: string,
    options: SentinelCheckNowOptions,
): Promise<SentinelCheckNowResult> {
    const owner = await resolveLiveSentinelOwner(
        options.dataDir,
        workspaceId,
        options.processStore,
    );
    if (!owner) return { status: 'not-found' };

    const processId = owner.id;
    if (owner.status === 'queued' || owner.status === 'running' || options.executor.isInflight(processId)) {
        return { status: 'busy', processId };
    }

    const cron = options.store.getByProcess(processId)
        .find(entry => entry.description === SENTINEL_CRON_DESCRIPTION && entry.status === 'active');
    if (!cron) return { status: 'not-ready', processId };

    await options.executor.triggerNow(cron.id);
    return { status: 'triggered', processId, cronId: cron.id };
}

export function registerSentinelCronProvisioning(options: SentinelCronProvisioningOptions): () => void {
    const onTaskAdded = (task: QueuedTask): void => {
        try {
            ensureSentinelCron(task, options);
        } catch (error) {
            options.onError(error, task);
        }
    };
    options.queueManager.on('taskAdded', onTaskAdded);
    return () => options.queueManager.off('taskAdded', onTaskAdded);
}

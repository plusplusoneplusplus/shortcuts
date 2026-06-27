import type { AgentProviderId, QueueListResponse, QueueHistoryResponse, QueueTaskSummary } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../api/cocClient';

const PROVIDER_IDS = new Set<AgentProviderId>(['copilot', 'codex', 'claude', 'opencode']);
const ACTIVE_STATUSES = new Set(['queued', 'running']);

export interface AgentProviderWorkActivity {
    id: string;
    processId?: string;
    provider: AgentProviderId;
    kind: 'dream-run';
    trigger?: string;
    status?: string;
    label: string;
    model?: string;
    reasoningEffort?: string;
    timeoutMs?: number;
    createdAt?: number;
    startedAt?: number;
    completedAt?: number;
    error?: string;
}

export function getTaskProvider(task: any): AgentProviderId | undefined {
    const raw = task?.provider ?? task?.payload?.provider ?? task?.metadata?.provider;
    return PROVIDER_IDS.has(raw) ? raw : undefined;
}

function isDreamRunTask(task: any): boolean {
    return task?.type === 'dream-run'
        || task?.payload?.kind === 'dream-run'
        || (task?.metadata?.dream && typeof task.metadata.dream === 'object');
}

function taskTimestamp(task: any): number {
    return Number(task?.startedAt ?? task?.completedAt ?? task?.createdAt ?? 0);
}

function activitySortKey(activity: AgentProviderWorkActivity): number {
    const activeBonus = activity.status && ACTIVE_STATUSES.has(activity.status) ? 10_000_000_000_000 : 0;
    return activeBonus + Number(activity.startedAt ?? activity.completedAt ?? activity.createdAt ?? 0);
}

function toDreamProviderActivity(task: QueueTaskSummary): AgentProviderWorkActivity | undefined {
    if (!isDreamRunTask(task)) return undefined;
    const provider = getTaskProvider(task);
    if (!provider) return undefined;
    const payload = task.payload as Record<string, unknown> | undefined;
    const trigger = typeof payload?.trigger === 'string' ? payload.trigger : undefined;
    const status = typeof task.status === 'string' ? task.status : undefined;
    const model = typeof task.model === 'string'
        ? task.model
        : typeof task.config?.model === 'string'
            ? task.config.model
            : typeof payload?.model === 'string'
                ? payload.model
                : undefined;
    const reasoningEffort = typeof task.reasoningEffort === 'string'
        ? task.reasoningEffort
        : typeof task.config?.reasoningEffort === 'string'
            ? task.config.reasoningEffort
            : typeof payload?.reasoningEffort === 'string'
                ? payload.reasoningEffort
                : undefined;
    const timeoutMs = typeof task.timeoutMs === 'number'
        ? task.timeoutMs
        : typeof task.config?.timeoutMs === 'number'
            ? task.config.timeoutMs
            : typeof payload?.timeoutMs === 'number'
                ? payload.timeoutMs
                : undefined;
    const displayName = typeof task.displayName === 'string' && task.displayName.trim()
        ? task.displayName.trim()
        : `Dream Run${trigger ? `: ${trigger === 'idle' ? 'Idle' : 'Manual'}` : ''}`;
    return {
        id: task.id,
        ...(typeof task.processId === 'string' ? { processId: task.processId } : {}),
        provider,
        kind: 'dream-run',
        ...(trigger ? { trigger } : {}),
        ...(status ? { status } : {}),
        label: displayName,
        ...(model ? { model } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(typeof task.createdAt === 'number' ? { createdAt: task.createdAt } : {}),
        ...(typeof task.startedAt === 'number' ? { startedAt: task.startedAt } : {}),
        ...(typeof task.completedAt === 'number' ? { completedAt: task.completedAt } : {}),
        ...(typeof task.error === 'string' ? { error: task.error } : {}),
    };
}

export function collectDreamProviderActivity(
    queueData: Pick<QueueListResponse, 'queued' | 'running'> | null | undefined,
    historyData: Pick<QueueHistoryResponse, 'history'> | null | undefined,
    limit = 5,
): AgentProviderWorkActivity[] {
    const activeTasks = [
        ...(queueData?.running ?? []),
        ...(queueData?.queued ?? []),
    ].filter((task): task is QueueTaskSummary => (task as any)?.kind !== 'pause-marker');
    const historyTasks = historyData?.history ?? [];
    const byId = new Map<string, AgentProviderWorkActivity>();
    for (const task of [...activeTasks, ...historyTasks].sort((a, b) => taskTimestamp(b) - taskTimestamp(a))) {
        const activity = toDreamProviderActivity(task);
        if (!activity || byId.has(activity.id)) continue;
        byId.set(activity.id, activity);
    }
    return [...byId.values()]
        .sort((a, b) => activitySortKey(b) - activitySortKey(a))
        .slice(0, Math.max(0, limit));
}

export async function loadDreamProviderActivity(limit = 5): Promise<AgentProviderWorkActivity[]> {
    const client = getSpaCocClient();
    const [queueData, historyData] = await Promise.all([
        client.queue.list({ type: 'dream-run' }),
        client.queue.history({ type: 'dream-run', limit }),
    ]);
    return collectDreamProviderActivity(queueData, historyData, limit);
}

export function formatProviderActivityTimeout(timeoutMs: number | undefined): string {
    if (timeoutMs === undefined || !Number.isFinite(timeoutMs)) return 'timeout not recorded';
    const totalMinutes = Math.round(timeoutMs / 60_000);
    if (totalMinutes >= 60 && totalMinutes % 60 === 0) {
        return `${totalMinutes / 60}h timeout`;
    }
    if (totalMinutes > 0) {
        return `${totalMinutes}m timeout`;
    }
    return `${timeoutMs}ms timeout`;
}

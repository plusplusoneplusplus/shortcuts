import * as fs from 'fs';
import * as path from 'path';
import type { MemoryCandidate, MemoryCandidateSelectionPolicy, QueuedTask, TaskQueueManager } from '@plusplusoneplusplus/forge';
import { MemoryCandidateStore } from '@plusplusoneplusplus/forge';
import { getRepoDataPath } from '../paths';
import { readRepoPreferences, onRepoPreferencesChanged, type PerRepoPreferences } from '../preferences-handler';
import type { ProcessWebSocketServer } from '../streaming/websocket';
import { TaskDefs, type MemoryPromotePayload } from '../tasks/task-types';
import type { ScheduleManager } from '../schedule/schedule-manager';
import { nextCronTime } from '../schedule/schedule-manager';

export type AutoPromoteMode = 'off' | 'threshold' | 'cron' | 'cron+threshold';
export type AutoPromoteTrigger = 'auto-threshold' | 'auto-cron';

export interface AutoPromoteGates {
    minScore?: number;
    minRecallCount?: number;
    minUniqueQueries?: number;
}

export interface BoundedMemoryAutoPromoteConfig {
    mode: AutoPromoteMode;
    cron?: string;
    timezone?: string;
    thresholdCount?: number;
    minIntervalMs?: number;
    gates?: AutoPromoteGates;
}

export interface MemoryAutoPromoteState {
    lastAutoRunAt?: string;
    lastTrigger?: AutoPromoteTrigger;
    lastSkipReason?: string;
    lastEnqueuedAt?: string;
    lastTaskId?: string;
}

export interface AutoPromoteStatus extends MemoryAutoPromoteState {
    mode: AutoPromoteMode;
    nextRunAt: string | null;
}

export const AUTO_PROMOTE_DEFAULT_CRON = '0 3 * * *';
export const AUTO_PROMOTE_DEFAULT_THRESHOLD_COUNT = 25;
export const AUTO_PROMOTE_DEFAULT_MIN_INTERVAL_MS = 30 * 60 * 1000;
export const DEFAULT_AUTO_PROMOTE_GATES: Required<AutoPromoteGates> = Object.freeze({
    minScore: 0.75,
    minRecallCount: 3,
    minUniqueQueries: 2,
});

const AUTO_PROMOTE_STATE_FILE = 'memory/auto-promote-state.json';
const AUTO_PROMOTE_SCHEDULE_PREFIX = 'auto-promote-';

export function getAutoPromoteScheduleId(workspaceId: string): string {
    return `${AUTO_PROMOTE_SCHEDULE_PREFIX}${workspaceId.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
}

export function normalizeAutoPromoteConfig(raw: unknown): BoundedMemoryAutoPromoteConfig {
    if (!isRecord(raw)) return { mode: 'off' };
    const mode = isAutoPromoteMode(raw.mode) ? raw.mode : 'off';
    const config: BoundedMemoryAutoPromoteConfig = { mode };
    if (typeof raw.cron === 'string' && raw.cron.trim()) config.cron = raw.cron.trim();
    if (typeof raw.timezone === 'string' && raw.timezone.trim()) config.timezone = raw.timezone.trim();
    if (typeof raw.thresholdCount === 'number' && Number.isInteger(raw.thresholdCount) && raw.thresholdCount > 0) {
        config.thresholdCount = raw.thresholdCount;
    }
    if (typeof raw.minIntervalMs === 'number' && Number.isInteger(raw.minIntervalMs) && raw.minIntervalMs >= 0) {
        config.minIntervalMs = raw.minIntervalMs;
    }
    if (isRecord(raw.gates)) {
        const gates: AutoPromoteGates = {};
        if (typeof raw.gates.minScore === 'number' && Number.isFinite(raw.gates.minScore) && raw.gates.minScore >= 0 && raw.gates.minScore <= 1) {
            gates.minScore = raw.gates.minScore;
        }
        if (typeof raw.gates.minRecallCount === 'number' && Number.isInteger(raw.gates.minRecallCount) && raw.gates.minRecallCount > 0) {
            gates.minRecallCount = raw.gates.minRecallCount;
        }
        if (typeof raw.gates.minUniqueQueries === 'number' && Number.isInteger(raw.gates.minUniqueQueries) && raw.gates.minUniqueQueries > 0) {
            gates.minUniqueQueries = raw.gates.minUniqueQueries;
        }
        if (Object.keys(gates).length > 0) config.gates = gates;
    }
    return config;
}

export function resolveAutoPromoteGates(gates?: AutoPromoteGates): Partial<MemoryCandidateSelectionPolicy> {
    return {
        minScore: gates?.minScore ?? DEFAULT_AUTO_PROMOTE_GATES.minScore,
        minRecallCount: gates?.minRecallCount ?? DEFAULT_AUTO_PROMOTE_GATES.minRecallCount,
        minUniqueQueries: gates?.minUniqueQueries ?? DEFAULT_AUTO_PROMOTE_GATES.minUniqueQueries,
    };
}

export function readAutoPromoteState(dataDir: string, workspaceId: string): MemoryAutoPromoteState {
    const filePath = getRepoDataPath(dataDir, workspaceId, AUTO_PROMOTE_STATE_FILE);
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return isRecord(parsed) ? {
            lastAutoRunAt: typeof parsed.lastAutoRunAt === 'string' ? parsed.lastAutoRunAt : undefined,
            lastTrigger: parsed.lastTrigger === 'auto-threshold' || parsed.lastTrigger === 'auto-cron' ? parsed.lastTrigger : undefined,
            lastSkipReason: typeof parsed.lastSkipReason === 'string' ? parsed.lastSkipReason : undefined,
            lastEnqueuedAt: typeof parsed.lastEnqueuedAt === 'string' ? parsed.lastEnqueuedAt : undefined,
            lastTaskId: typeof parsed.lastTaskId === 'string' ? parsed.lastTaskId : undefined,
        } : {};
    } catch {
        return {};
    }
}

export function writeAutoPromoteState(dataDir: string, workspaceId: string, patch: MemoryAutoPromoteState): MemoryAutoPromoteState {
    const next = { ...readAutoPromoteState(dataDir, workspaceId), ...patch };
    const filePath = getRepoDataPath(dataDir, workspaceId, AUTO_PROMOTE_STATE_FILE);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(`${filePath}.tmp`, JSON.stringify(next, null, 2), 'utf-8');
    fs.renameSync(`${filePath}.tmp`, filePath);
    return next;
}

export function getAutoPromoteStatus(
    dataDir: string,
    workspaceId: string,
    scheduleManager?: ScheduleManager,
): AutoPromoteStatus {
    const prefs = readRepoPreferences(dataDir, workspaceId);
    const autoPromote = prefs.boundedMemory?.autoPromote ?? { mode: 'off' };
    const schedule = scheduleManager?.getSchedule(workspaceId, getAutoPromoteScheduleId(workspaceId));
    const nextRun = schedule?.status === 'active' ? nextCronTime(schedule.cron, new Date()) : null;
    const nextRunAt = nextRun ? nextRun.toISOString() : null;
    return {
        mode: autoPromote.mode,
        nextRunAt,
        ...readAutoPromoteState(dataDir, workspaceId),
    };
}

export class AutoPromoteScheduler {
    private readonly unsubscribePreferenceChanges: () => void;
    private reconcileTimer: ReturnType<typeof setInterval> | undefined;

    constructor(
        private readonly options: {
            dataDir: string;
            queueManager: TaskQueueManager;
            scheduleManager: ScheduleManager;
            enabled: boolean;
            wsServer?: ProcessWebSocketServer;
            reconcileIntervalMs?: number;
        },
    ) {
        this.unsubscribePreferenceChanges = onRepoPreferencesChanged(({ workspaceId }) => {
            this.reconcileWorkspace(workspaceId);
        });
    }

    start(workspaceIds: string[]): void {
        for (const workspaceId of workspaceIds) {
            this.reconcileWorkspace(workspaceId);
        }
        const interval = this.options.reconcileIntervalMs ?? 60_000;
        this.reconcileTimer = setInterval(() => {
            this.reconcileAll();
        }, interval);
        this.reconcileTimer.unref?.();
    }

    dispose(): void {
        if (this.reconcileTimer) clearInterval(this.reconcileTimer);
        this.unsubscribePreferenceChanges();
    }

    async handleCandidateCaptured(event: { target: 'repo' | 'system'; candidate: MemoryCandidate }): Promise<void> {
        if (event.target !== 'repo') return;
        const workspaceId = event.candidate.workspaceId;
        const prefs = readRepoPreferences(this.options.dataDir, workspaceId);
        const autoPromote = this.getEnabledConfig(prefs);
        if (!autoPromote || !modeIncludes(autoPromote.mode, 'threshold')) return;

        const thresholdCount = autoPromote.thresholdCount ?? AUTO_PROMOTE_DEFAULT_THRESHOLD_COUNT;
        const candidateDbPath = getRepoDataPath(this.options.dataDir, workspaceId, 'memory/raw-memory.db');
        let candidateStore: MemoryCandidateStore | undefined;
        try {
            candidateStore = new MemoryCandidateStore({ dbPath: candidateDbPath });
            const stats = await candidateStore.getStats();
            if (stats.pending < thresholdCount) {
                this.recordSkip(workspaceId, 'threshold-not-met', {
                    pending: stats.pending,
                    thresholdCount,
                    trigger: 'auto-threshold',
                });
                return;
            }
        } finally {
            candidateStore?.close();
        }

        this.enqueueIfAllowed(workspaceId, 'auto-threshold', autoPromote);
    }

    reconcileWorkspace(workspaceId: string): void {
        const prefs = readRepoPreferences(this.options.dataDir, workspaceId);
        const autoPromote = this.getEnabledConfig(prefs);
        const scheduleId = getAutoPromoteScheduleId(workspaceId);
        if (!autoPromote || !modeIncludes(autoPromote.mode, 'cron')) {
            this.options.scheduleManager.removeSchedule(workspaceId, scheduleId);
            return;
        }

        this.options.scheduleManager.setSchedule(workspaceId, {
            id: scheduleId,
            name: 'Auto Memory Promotion',
            target: 'memory',
            targetType: 'memory-promote',
            cron: autoPromote.cron ?? AUTO_PROMOTE_DEFAULT_CRON,
            params: {
                trigger: 'auto-cron',
                target: 'memory',
                gates: JSON.stringify(autoPromote.gates ?? {}),
            },
            onFailure: 'notify',
            status: 'active',
            createdAt: new Date().toISOString(),
        });
    }

    enqueueCron(workspaceId: string, config?: BoundedMemoryAutoPromoteConfig): string | undefined {
        const prefs = readRepoPreferences(this.options.dataDir, workspaceId);
        const autoPromote = config ?? this.getEnabledConfig(prefs);
        if (!autoPromote) return undefined;
        return this.enqueueIfAllowed(workspaceId, 'auto-cron', autoPromote);
    }

    private reconcileAll(): void {
        const reposRoot = path.join(this.options.dataDir, 'repos');
        if (!fs.existsSync(reposRoot)) return;
        for (const entry of fs.readdirSync(reposRoot, { withFileTypes: true })) {
            if (entry.isDirectory()) this.reconcileWorkspace(entry.name);
        }
    }

    private getEnabledConfig(prefs: PerRepoPreferences): BoundedMemoryAutoPromoteConfig | undefined {
        if (!this.options.enabled || !prefs.boundedMemory?.enabled) return undefined;
        const config = prefs.boundedMemory.autoPromote ?? { mode: 'off' };
        return config.mode === 'off' ? undefined : config;
    }

    private enqueueIfAllowed(workspaceId: string, trigger: AutoPromoteTrigger, config: BoundedMemoryAutoPromoteConfig): string | undefined {
        const active = this.findActivePromotion(workspaceId);
        if (active) {
            this.recordSkip(workspaceId, 'promotion-already-active', { trigger, taskId: active.id, status: active.status });
            return active.id;
        }

        const lastCompleted = this.findLastCompletedAutoPromotion(workspaceId);
        const minIntervalMs = config.minIntervalMs ?? AUTO_PROMOTE_DEFAULT_MIN_INTERVAL_MS;
        if (lastCompleted?.completedAt && Date.now() - lastCompleted.completedAt < minIntervalMs) {
            this.recordSkip(workspaceId, 'min-interval-not-elapsed', { trigger, taskId: lastCompleted.id, minIntervalMs });
            return undefined;
        }

        const payload: MemoryPromotePayload = {
            kind: 'memory-promote',
            workspaceId,
            target: 'memory',
            trigger,
            gates: config.gates,
        };
        const taskId = this.options.queueManager.enqueue({
            type: TaskDefs.memoryPromote.kind,
            repoId: workspaceId,
            priority: 'low',
            payload: payload as unknown as Record<string, unknown>,
            config: {},
            displayName: `Auto memory promotion (${trigger === 'auto-cron' ? 'cron' : 'threshold'})`,
        });
        writeAutoPromoteState(this.options.dataDir, workspaceId, {
            lastEnqueuedAt: new Date().toISOString(),
            lastTrigger: trigger,
            lastTaskId: taskId,
            lastSkipReason: undefined,
        });
        this.options.wsServer?.broadcastProcessEvent({
            type: 'memory-promote:auto-enqueued',
            workspaceId,
            trigger,
            taskId,
            timestamp: Date.now(),
        });
        return taskId;
    }

    private findActivePromotion(workspaceId: string): QueuedTask | undefined {
        return this.options.queueManager.getAll().find(task =>
            task.type === TaskDefs.memoryPromote.kind
            && task.status !== 'completed'
            && task.status !== 'failed'
            && task.status !== 'cancelled'
            && (task.payload as Partial<MemoryPromotePayload>).workspaceId === workspaceId
            && (task.payload as Partial<MemoryPromotePayload>).target === 'memory'
        );
    }

    private findLastCompletedAutoPromotion(workspaceId: string): QueuedTask | undefined {
        return this.options.queueManager.getAll()
            .filter(task =>
                task.type === TaskDefs.memoryPromote.kind
                && task.status === 'completed'
                && (task.payload as Partial<MemoryPromotePayload>).workspaceId === workspaceId
                && (task.payload as Partial<MemoryPromotePayload>).target === 'memory'
                && isAutoTrigger((task.payload as Partial<MemoryPromotePayload>).trigger)
            )
            .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))[0];
    }

    private recordSkip(workspaceId: string, reason: string, details: Record<string, unknown>): void {
        writeAutoPromoteState(this.options.dataDir, workspaceId, {
            lastSkipReason: reason,
        });
        this.options.wsServer?.broadcastProcessEvent({
            type: 'memory-promote:skipped',
            workspaceId,
            reason,
            details,
            timestamp: Date.now(),
        });
    }
}

export function isAutoTrigger(trigger: unknown): trigger is AutoPromoteTrigger {
    return trigger === 'auto-threshold' || trigger === 'auto-cron';
}

function modeIncludes(mode: AutoPromoteMode, triggerType: 'threshold' | 'cron'): boolean {
    return mode === triggerType || mode === 'cron+threshold';
}

function isAutoPromoteMode(value: unknown): value is AutoPromoteMode {
    return value === 'off' || value === 'threshold' || value === 'cron' || value === 'cron+threshold';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

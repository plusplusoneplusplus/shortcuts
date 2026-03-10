/**
 * ScheduleManager
 *
 * In-memory schedule state with cron-based timer management.
 * Triggers pipeline/task runs via the queue manager.
 * Supports overlap skipping and missed-run detection.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import type { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import type { TargetType } from '@plusplusoneplusplus/coc-server';
import { SchedulePersistence } from './schedule-persistence';

// ============================================================================
// Types
// ============================================================================

export type ScheduleStatus = 'active' | 'paused' | 'stopped';
export type ScheduleOnFailure = 'notify' | 'stop';

export interface ScheduleEntry {
    id: string;
    name: string;
    target: string;
    cron: string;
    params: Record<string, string>;
    onFailure: ScheduleOnFailure;
    status: ScheduleStatus;
    createdAt: string;
    targetType?: TargetType;   // defaults to 'prompt' when absent
    outputFolder?: string;     // output folder path prepended to prompt for prompt-type schedules
}

export interface ScheduleRunRecord {
    id: string;
    scheduleId: string;
    repoId: string;
    startedAt: string;
    completedAt?: string;
    status: 'running' | 'completed' | 'failed' | 'missed';
    error?: string;
    durationMs?: number;
    processId?: string;
}

export interface ScheduleChangeEvent {
    type: 'schedule-added' | 'schedule-updated' | 'schedule-removed' | 'schedule-triggered' | 'schedule-run-complete';
    repoId: string;
    scheduleId: string;
    schedule?: ScheduleEntry;
    run?: ScheduleRunRecord;
}

// ============================================================================
// Cron Parser (5-field standard: min hour dom month dow)
// ============================================================================

interface CronFields {
    minutes: Set<number>;
    hours: Set<number>;
    daysOfMonth: Set<number>;
    months: Set<number>;
    daysOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
    const result = new Set<number>();
    for (const part of field.split(',')) {
        const stepMatch = part.match(/^(.+)\/(\d+)$/);
        let range: string;
        let step = 1;
        if (stepMatch) {
            range = stepMatch[1];
            step = parseInt(stepMatch[2], 10);
        } else {
            range = part;
        }

        if (range === '*') {
            for (let i = min; i <= max; i += step) result.add(i);
        } else {
            const dashMatch = range.match(/^(\d+)-(\d+)$/);
            if (dashMatch) {
                const start = parseInt(dashMatch[1], 10);
                const end = parseInt(dashMatch[2], 10);
                for (let i = start; i <= end; i += step) result.add(i);
            } else {
                result.add(parseInt(range, 10));
            }
        }
    }
    return result;
}

export function parseCron(expr: string): CronFields {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) {
        throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
    }
    return {
        minutes: parseField(parts[0], 0, 59),
        hours: parseField(parts[1], 0, 23),
        daysOfMonth: parseField(parts[2], 1, 31),
        months: parseField(parts[3], 1, 12),
        daysOfWeek: parseField(parts[4], 0, 6),
    };
}

/**
 * Compute the next occurrence of a cron expression after `after`.
 * Returns null if no valid time is found within 1 year.
 */
export function nextCronTime(expr: string, after: Date = new Date()): Date | null {
    const fields = parseCron(expr);
    const limit = new Date(after.getTime() + 366 * 24 * 60 * 60 * 1000);
    const candidate = new Date(after);
    candidate.setSeconds(0, 0);
    candidate.setMinutes(candidate.getMinutes() + 1);

    while (candidate < limit) {
        if (!fields.months.has(candidate.getMonth() + 1)) {
            candidate.setMonth(candidate.getMonth() + 1, 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }
        if (!fields.daysOfMonth.has(candidate.getDate()) || !fields.daysOfWeek.has(candidate.getDay())) {
            candidate.setDate(candidate.getDate() + 1);
            candidate.setHours(0, 0, 0, 0);
            continue;
        }
        if (!fields.hours.has(candidate.getHours())) {
            candidate.setHours(candidate.getHours() + 1, 0, 0, 0);
            continue;
        }
        if (!fields.minutes.has(candidate.getMinutes())) {
            candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
            continue;
        }
        return candidate;
    }
    return null;
}

/**
 * Convert a cron expression to a human-readable description.
 */
export function describeCron(expr: string): string {
    try {
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return expr;

        const [min, hour, dom, month, dow] = parts;

        if (min === '*' && hour === '*' && dom === '*' && month === '*' && dow === '*') {
            return 'Every minute';
        }

        const stepMatch = min.match(/^\*\/(\d+)$/);
        if (stepMatch && hour === '*' && dom === '*' && month === '*' && dow === '*') {
            return `Every ${stepMatch[1]} minutes`;
        }

        const hourStepMatch = hour.match(/^\*\/(\d+)$/);
        if (min === '0' && hourStepMatch && dom === '*' && month === '*' && dow === '*') {
            return `Every ${hourStepMatch[1]} hours`;
        }

        if (/^\d+$/.test(hour) && /^\d+$/.test(min) && dom === '*' && month === '*') {
            const pad = (n: string) => n.padStart(2, '0');
            const timeStr = `${pad(hour)}:${pad(min)}`;
            if (dow === '*') return `Every day at ${timeStr}`;
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dowNames = dow.split(',').map(d => days[parseInt(d, 10)] || d).join(', ');
            return `${dowNames} at ${timeStr}`;
        }

        const isCommaList = (s: string) => s.split(',').every(p => /^\d+$/.test(p));
        if (isCommaList(hour) && hour.includes(',') && /^\d+$/.test(min) && dom === '*' && month === '*') {
            const pad = (n: string) => n.padStart(2, '0');
            const times = hour
                .split(',')
                .map(Number)
                .sort((a, b) => a - b)
                .map(h => `${pad(String(h))}:${pad(min)}`)
                .join(', ');
            if (dow === '*') return `Every day at ${times}`;
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const dowNames = dow.split(',').map(d => days[parseInt(d, 10)] || d).join(', ');
            return `${dowNames} at ${times}`;
        }

        return expr;
    } catch {
        return expr;
    }
}

// ============================================================================
// ScheduleManager
// ============================================================================

const MAX_HISTORY_PER_SCHEDULE = 10;

export class ScheduleManager extends EventEmitter {
    // repoId → scheduleId → ScheduleEntry
    private readonly schedules = new Map<string, Map<string, ScheduleEntry>>();
    // scheduleId → timer handle
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    // scheduleId → currently running flag
    private readonly runningSchedules = new Set<string>();
    // scheduleId → run history (most recent first)
    private readonly runHistory = new Map<string, ScheduleRunRecord[]>();
    // Dependencies
    private readonly persistence: SchedulePersistence;
    private readonly queueManager: TaskQueueManager | null;
    private disposed = false;

    constructor(persistence: SchedulePersistence, queueManager: TaskQueueManager | null = null) {
        super();
        this.persistence = persistence;
        this.queueManager = queueManager;
    }

    /**
     * Restore schedules from persistence and start timers for active ones.
     */
    restore(): void {
        const allSchedules = this.persistence.loadAll();
        let total = 0;
        for (const [repoId, entries] of allSchedules) {
            const map = new Map<string, ScheduleEntry>();
            for (const entry of entries) {
                map.set(entry.id, entry);
                if (entry.status === 'active') {
                    this.scheduleNextRun(repoId, entry);
                }
                total++;
            }
            this.schedules.set(repoId, map);
        }
        if (total > 0) {
            process.stderr.write(`[ScheduleManager] Restored ${total} schedule(s)\n`);
        }
    }

    /**
     * Get all schedules for a repo.
     */
    getSchedules(repoId: string): ScheduleEntry[] {
        const map = this.schedules.get(repoId);
        return map ? Array.from(map.values()) : [];
    }

    /**
     * Get a single schedule.
     */
    getSchedule(repoId: string, scheduleId: string): ScheduleEntry | undefined {
        return this.schedules.get(repoId)?.get(scheduleId);
    }

    /**
     * Create a new schedule.
     */
    addSchedule(repoId: string, entry: Omit<ScheduleEntry, 'id' | 'createdAt'>): ScheduleEntry {
        // Validate cron
        parseCron(entry.cron);

        const schedule: ScheduleEntry = {
            ...entry,
            id: 'sch_' + crypto.randomBytes(6).toString('hex'),
            createdAt: new Date().toISOString(),
        };

        if (!this.schedules.has(repoId)) {
            this.schedules.set(repoId, new Map());
        }
        this.schedules.get(repoId)!.set(schedule.id, schedule);
        this.persist(repoId);

        if (schedule.status === 'active') {
            this.scheduleNextRun(repoId, schedule);
        }

        this.emit('change', {
            type: 'schedule-added',
            repoId,
            scheduleId: schedule.id,
            schedule,
        } as ScheduleChangeEvent);

        return schedule;
    }

    /**
     * Update an existing schedule.
     */
    updateSchedule(repoId: string, scheduleId: string, updates: Partial<Pick<ScheduleEntry, 'name' | 'target' | 'cron' | 'params' | 'onFailure' | 'status' | 'targetType' | 'outputFolder'>>): ScheduleEntry | undefined {
        const schedule = this.schedules.get(repoId)?.get(scheduleId);
        if (!schedule) return undefined;

        if (updates.cron && updates.cron !== schedule.cron) {
            parseCron(updates.cron);
        }

        const oldStatus = schedule.status;
        Object.assign(schedule, updates);

        // Reschedule timer if needed
        this.cancelTimer(scheduleId);
        if (schedule.status === 'active') {
            this.scheduleNextRun(repoId, schedule);
        }

        this.persist(repoId);

        this.emit('change', {
            type: 'schedule-updated',
            repoId,
            scheduleId,
            schedule,
        } as ScheduleChangeEvent);

        return schedule;
    }

    /**
     * Remove a schedule.
     */
    removeSchedule(repoId: string, scheduleId: string): boolean {
        const map = this.schedules.get(repoId);
        if (!map || !map.has(scheduleId)) return false;

        this.cancelTimer(scheduleId);
        map.delete(scheduleId);
        this.runHistory.delete(scheduleId);

        if (map.size === 0) {
            this.schedules.delete(repoId);
            this.persistence.deleteRepo(repoId);
        } else {
            this.persist(repoId);
        }

        this.emit('change', {
            type: 'schedule-removed',
            repoId,
            scheduleId,
        } as ScheduleChangeEvent);

        return true;
    }

    /**
     * Trigger a schedule run immediately.
     */
    async triggerRun(repoId: string, scheduleId: string): Promise<ScheduleRunRecord> {
        const schedule = this.schedules.get(repoId)?.get(scheduleId);
        if (!schedule) throw new Error('Schedule not found');

        return this.executeRun(repoId, schedule);
    }

    /**
     * Get run history for a schedule.
     */
    getRunHistory(scheduleId: string): ScheduleRunRecord[] {
        return this.runHistory.get(scheduleId) || [];
    }

    /**
     * Check if a schedule is currently running.
     */
    isRunning(scheduleId: string): boolean {
        return this.runningSchedules.has(scheduleId);
    }

    /**
     * Dispose all timers and clean up.
     */
    dispose(): void {
        this.disposed = true;
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.removeAllListeners();
    }

    // ========================================================================
    // Private — timer management
    // ========================================================================

    private scheduleNextRun(repoId: string, schedule: ScheduleEntry): void {
        if (this.disposed) return;

        const next = nextCronTime(schedule.cron);
        if (!next) return;

        const delayMs = next.getTime() - Date.now();
        if (delayMs < 0) return;

        // Cap setTimeout to prevent 32-bit overflow (max ~24.8 days)
        const MAX_TIMEOUT = 2147483647;
        const actualDelay = Math.min(delayMs, MAX_TIMEOUT);

        const timer = setTimeout(() => {
            this.timers.delete(schedule.id);

            if (this.disposed) return;
            const current = this.schedules.get(repoId)?.get(schedule.id);
            if (!current || current.status !== 'active') return;

            // If delay was capped, just reschedule — we haven't reached the target time yet
            if (actualDelay < delayMs) {
                this.scheduleNextRun(repoId, current);
                return;
            }

            // Skip if previous run still active
            if (this.runningSchedules.has(schedule.id)) {
                process.stderr.write(`[ScheduleManager] Skipped ${schedule.name}: previous run still active\n`);
                this.scheduleNextRun(repoId, current);
                return;
            }

            this.executeRun(repoId, current).then(() => {
                // Schedule next run after completion
                const latest = this.schedules.get(repoId)?.get(schedule.id);
                if (latest && latest.status === 'active') {
                    this.scheduleNextRun(repoId, latest);
                }
            }).catch(() => {
                // Still schedule next even on error
                const latest = this.schedules.get(repoId)?.get(schedule.id);
                if (latest && latest.status === 'active') {
                    this.scheduleNextRun(repoId, latest);
                }
            });
        }, actualDelay);

        this.timers.set(schedule.id, timer);
    }

    private cancelTimer(scheduleId: string): void {
        const timer = this.timers.get(scheduleId);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(scheduleId);
        }
    }

    private async executeRun(repoId: string, schedule: ScheduleEntry): Promise<ScheduleRunRecord> {
        const run: ScheduleRunRecord = {
            id: 'run_' + crypto.randomBytes(6).toString('hex'),
            scheduleId: schedule.id,
            repoId,
            startedAt: new Date().toISOString(),
            status: 'running',
        };

        this.runningSchedules.add(schedule.id);
        this.addRunRecord(schedule.id, run);

        this.emit('change', {
            type: 'schedule-triggered',
            repoId,
            scheduleId: schedule.id,
            schedule,
            run,
        } as ScheduleChangeEvent);

        try {
            // Enqueue a task if queueManager is available
            if (this.queueManager) {
                if (!schedule.targetType || schedule.targetType === 'prompt') {
                    const outputPrefix = schedule.outputFolder
                        ? `Output folder: ${schedule.outputFolder}\n\n`
                        : '';
                    const taskId = this.queueManager.enqueue({
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            mode: 'autopilot',
                            prompt: `${outputPrefix}Follow the instruction ${schedule.target}.`,
                            context: {
                                files: [schedule.target],
                                scheduleId: schedule.id,
                                scheduleParams: schedule.params,
                            },
                            workingDirectory: '',
                        },
                        config: {},
                        displayName: `[Schedule] ${schedule.name}`,
                        repoId,
                    });
                    run.processId = `queue_${taskId}`;
                } else if (schedule.targetType === 'script') {
                    const taskId = this.queueManager.enqueue({
                        type: 'run-script',
                        priority: 'normal',
                        payload: {
                            kind: 'run-script',
                            script: schedule.target,
                            workingDirectory: schedule.params?.workingDirectory ?? '',
                            scheduleId: schedule.id,
                        },
                        config: {},
                        displayName: `[Schedule:script] ${schedule.name}`,
                        repoId,
                    });
                    run.processId = `queue_${taskId}`;
                }
            }

            run.status = 'completed';
            run.completedAt = new Date().toISOString();
            run.durationMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
        } catch (err) {
            run.status = 'failed';
            run.completedAt = new Date().toISOString();
            run.error = err instanceof Error ? err.message : String(err);
            run.durationMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();

            if (schedule.onFailure === 'stop') {
                schedule.status = 'stopped';
                this.cancelTimer(schedule.id);
                this.persist(repoId);
            }
        } finally {
            this.runningSchedules.delete(schedule.id);
            this.updateRunRecord(schedule.id, run);
        }

        this.emit('change', {
            type: 'schedule-run-complete',
            repoId,
            scheduleId: schedule.id,
            schedule,
            run,
        } as ScheduleChangeEvent);

        return run;
    }

    private addRunRecord(scheduleId: string, run: ScheduleRunRecord): void {
        if (!this.runHistory.has(scheduleId)) {
            this.runHistory.set(scheduleId, []);
        }
        const history = this.runHistory.get(scheduleId)!;
        history.unshift(run);
        if (history.length > MAX_HISTORY_PER_SCHEDULE) {
            history.pop();
        }
    }

    private updateRunRecord(scheduleId: string, run: ScheduleRunRecord): void {
        const history = this.runHistory.get(scheduleId);
        if (!history) return;
        const idx = history.findIndex(r => r.id === run.id);
        if (idx >= 0) {
            history[idx] = run;
        }
    }

    private persist(repoId: string): void {
        const schedules = this.getSchedules(repoId);
        this.persistence.saveRepo(repoId, schedules);
    }
}

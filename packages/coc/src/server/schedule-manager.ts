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
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import type { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { toQueueProcessId } from '@plusplusoneplusplus/forge';
import type { TargetType, ChatMode } from './task-types';
import { getErrorMessage } from './shared/fs-utils';
import { ScheduleYamlPersistence } from './schedule-yaml-persistence';
import type { SqliteScheduleRunPersistence } from './sqlite-schedule-run-persistence';
import { loadRepoSchedules, getRepoScheduleDir } from './repo-schedule-loader';
import type { RepoScheduleOverrideStore } from './repo-schedule-overrides';
import { parseCron, nextCronTime, describeCron, slugifyName } from './cron-utils';

// Re-export cron utilities for backward compatibility
export { parseCron, nextCronTime, describeCron, slugifyName } from './cron-utils';
export type { CronFields } from './cron-utils';

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
    model?: string;            // optional model override for prompt-type schedules
    mode?: ChatMode;           // chat mode for prompt-type schedules; defaults to 'autopilot'
    /** 'user' = stored in schedules.json; 'repo' = loaded from .github/schedules/ */
    source?: 'user' | 'repo';
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
    taskId?: string;
}

export interface ScheduleChangeEvent {
    type: 'schedule-added' | 'schedule-updated' | 'schedule-removed' | 'schedule-triggered' | 'schedule-run-complete';
    repoId: string;
    scheduleId: string;
    schedule?: ScheduleEntry;
    run?: ScheduleRunRecord;
}

// ============================================================================
// ScheduleManager
// ============================================================================

const MAX_HISTORY_PER_SCHEDULE = 100;

/** Stamp completedAt, durationMs, and optionally error on a run record. */
function finaliseRun(
    run: ScheduleRunRecord,
    status: 'completed' | 'failed',
    error?: unknown,
): void {
    run.status = status;
    run.completedAt = new Date().toISOString();
    run.durationMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    if (error !== undefined) {
        run.error = getErrorMessage(error);
    }
}

export class ScheduleManager extends EventEmitter {
    // repoId → scheduleId → ScheduleEntry (user-managed)
    private readonly schedules = new Map<string, Map<string, ScheduleEntry>>();
    // repoId → scheduleId → ScheduleEntry (repo-managed, from .github/schedules/)
    private readonly repoSchedules = new Map<string, Map<string, ScheduleEntry>>();
    // repoId → workspace rootPath
    private readonly workspacePaths = new Map<string, string>();
    // scheduleId → timer handle
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    // scheduleId → currently running flag
    private readonly runningSchedules = new Set<string>();
    // scheduleId → run history (most recent first)
    private readonly runHistory = new Map<string, ScheduleRunRecord[]>();
    // file watchers: repoId → fs.FSWatcher
    private readonly repoWatchers = new Map<string, fs.FSWatcher>();
    // debounce timers for file watch events
    private readonly watchDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
    // Dependencies
    private readonly persistence: ScheduleYamlPersistence;
    private readonly queueManager: TaskQueueManager | null;
    private runPersistence: SqliteScheduleRunPersistence | null = null;
    private readonly overrideStore: RepoScheduleOverrideStore | null;
    private disposed = false;

    constructor(
        persistence: ScheduleYamlPersistence,
        queueManager: TaskQueueManager | null = null,
        overrideStore: RepoScheduleOverrideStore | null = null,
    ) {
        super();
        this.persistence = persistence;
        this.queueManager = queueManager;
        this.overrideStore = overrideStore;
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
     * Restore run history from persistence and inject into in-memory runHistory map.
     * Must be called after restore().
     */
    restoreRunHistory(persistence: SqliteScheduleRunPersistence): void {
        this.runPersistence = persistence;
        const restored = persistence.loadAll();
        for (const [scheduleId, runs] of restored) {
            this.runHistory.set(scheduleId, runs);
        }
        if (restored.size > 0) {
            process.stderr.write(`[ScheduleManager] Restored run history for ${restored.size} schedule(s)\n`);
        }
    }

    /**
     * Get all schedules for a repo (user + repo-defined merged).
     */
    getSchedules(repoId: string): ScheduleEntry[] {
        const result: ScheduleEntry[] = [];
        const userMap = this.schedules.get(repoId);
        if (userMap) result.push(...userMap.values());
        const repoMap = this.repoSchedules.get(repoId);
        if (repoMap) result.push(...repoMap.values());
        return result;
    }

    /**
     * Get a single schedule (checks user schedules first, then repo schedules).
     */
    getSchedule(repoId: string, scheduleId: string): ScheduleEntry | undefined {
        return this.schedules.get(repoId)?.get(scheduleId)
            ?? this.repoSchedules.get(repoId)?.get(scheduleId);
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
     * For repo-sourced schedules, field changes are written back to the YAML file.
     */
    updateSchedule(repoId: string, scheduleId: string, updates: Partial<Pick<ScheduleEntry, 'name' | 'target' | 'cron' | 'params' | 'onFailure' | 'status' | 'targetType' | 'outputFolder' | 'model' | 'mode'>>): ScheduleEntry | undefined {
        // Check repo schedules first
        const repoSchedule = this.repoSchedules.get(repoId)?.get(scheduleId);
        if (repoSchedule) {
            // Handle status changes via override store
            if (updates.status && updates.status !== repoSchedule.status) {
                repoSchedule.status = updates.status;
                this.overrideStore?.setStatus(repoId, scheduleId, updates.status);
            }

            // Apply non-status field updates and write back to YAML
            const { status, ...fieldUpdates } = updates;
            if (Object.keys(fieldUpdates).length > 0) {
                Object.assign(repoSchedule, fieldUpdates);
                const rootPath = this.workspacePaths.get(repoId);
                if (!rootPath) {
                    throw new Error(`No workspace path registered for repo ${repoId}`);
                }
                const stem = scheduleId.replace(/^repo:/, '');
                this.writeRepoScheduleYaml(rootPath, stem, repoSchedule, repoId);
            }

            // Reschedule timer
            this.cancelTimer(scheduleId);
            if (repoSchedule.status === 'active') {
                this.scheduleNextRun(repoId, repoSchedule);
            }

            this.emit('change', {
                type: 'schedule-updated',
                repoId,
                scheduleId,
                schedule: repoSchedule,
            } as ScheduleChangeEvent);

            return repoSchedule;
        }

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
     * Repo-sourced schedules cannot be removed via the API.
     */
    removeSchedule(repoId: string, scheduleId: string): boolean {
        // Block removal of repo schedules
        if (this.repoSchedules.get(repoId)?.has(scheduleId)) return false;

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
        const schedule = this.getSchedule(repoId, scheduleId);
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
        for (const timer of this.watchDebounceTimers.values()) {
            clearTimeout(timer);
        }
        this.watchDebounceTimers.clear();
        for (const watcher of this.repoWatchers.values()) {
            try { watcher.close(); } catch { /* non-fatal */ }
        }
        this.repoWatchers.clear();
        this.removeAllListeners();
    }

    // ========================================================================
    // Public — move schedule between user and repo sections
    // ========================================================================

    /**
     * Expose the workspace root path for a given repoId.
     */
    getWorkspacePath(repoId: string): string | undefined {
        return this.workspacePaths.get(repoId);
    }

    /**
     * Move a schedule between user and repo sections.
     *
     * user→repo: writes YAML to .github/schedules/<slug>.yaml, removes from user schedules.
     * repo→user: creates a user schedule via addSchedule, deletes the YAML file.
     */
    async moveSchedule(repoId: string, scheduleId: string, destination: 'user' | 'repo'): Promise<ScheduleEntry> {
        const rootPath = this.workspacePaths.get(repoId);
        if (!rootPath) {
            throw new Error('Workspace path not available for this repo');
        }

        const entry = this.getSchedule(repoId, scheduleId);
        if (!entry) {
            throw new Error('Schedule not found');
        }

        if (destination === 'repo') {
            if (entry.source === 'repo') {
                throw new Error('Schedule is already a repo schedule');
            }
            return this.moveUserToRepo(repoId, entry, rootPath);
        } else {
            if (entry.source !== 'repo') {
                throw new Error('Schedule is already a user schedule');
            }
            return this.moveRepoToUser(repoId, entry, rootPath);
        }
    }

    /** Write a schedule entry to `.github/schedules/<stem>.yaml`. */
    private writeRepoScheduleYaml(rootPath: string, stem: string, entry: ScheduleEntry, repoId: string): void {
        const scheduleDir = getRepoScheduleDir(rootPath);
        fs.mkdirSync(scheduleDir, { recursive: true });

        const yamlObj: Record<string, unknown> = {
            name: entry.name,
            cron: entry.cron,
            target: entry.target,
            params: entry.params,
            onFailure: entry.onFailure,
        };
        if (entry.targetType && entry.targetType !== 'prompt') yamlObj.targetType = entry.targetType;
        const defaultOutputFolder = `~/.coc/repos/${repoId}/tasks`;
        if (entry.outputFolder && entry.outputFolder !== defaultOutputFolder) yamlObj.outputFolder = entry.outputFolder;
        if (entry.model) yamlObj.model = entry.model;
        if (entry.mode && entry.mode !== 'autopilot') yamlObj.mode = entry.mode;

        const yamlContent = yaml.dump(yamlObj, { lineWidth: 120 });
        fs.writeFileSync(path.join(scheduleDir, `${stem}.yaml`), yamlContent, 'utf-8');
    }

    private moveUserToRepo(repoId: string, entry: ScheduleEntry, rootPath: string): ScheduleEntry {
        const slug = slugifyName(entry.name);
        const scheduleDir = getRepoScheduleDir(rootPath);

        // De-duplicate filename if it already exists
        let finalSlug = slug;
        let counter = 1;
        while (fs.existsSync(path.join(scheduleDir, `${finalSlug}.yaml`))) {
            finalSlug = `${slug}-${counter}`;
            counter++;
        }

        this.writeRepoScheduleYaml(rootPath, finalSlug, entry, repoId);

        // Remove from user schedules
        this.cancelTimer(entry.id);
        const map = this.schedules.get(repoId);
        if (map) {
            map.delete(entry.id);
            if (map.size === 0) {
                this.schedules.delete(repoId);
                this.persistence.deleteRepo(repoId);
            } else {
                this.persist(repoId);
            }
        }

        // Reload repo schedules so the new file is picked up
        this.reloadRepoSchedules(repoId);

        const newEntry = this.repoSchedules.get(repoId)?.get(`repo:${finalSlug}`);
        if (!newEntry) {
            throw new Error('Failed to load moved schedule from repo');
        }

        this.emit('change', {
            type: 'schedule-removed',
            repoId,
            scheduleId: entry.id,
        } as ScheduleChangeEvent);
        this.emit('change', {
            type: 'schedule-added',
            repoId,
            scheduleId: newEntry.id,
            schedule: newEntry,
        } as ScheduleChangeEvent);

        return newEntry;
    }

    private moveRepoToUser(repoId: string, entry: ScheduleEntry, rootPath: string): ScheduleEntry {
        // Create a new user schedule (addSchedule strips source)
        const newEntry = this.addSchedule(repoId, {
            name: entry.name,
            target: entry.target,
            cron: entry.cron,
            params: { ...entry.params },
            onFailure: entry.onFailure,
            status: entry.status,
            targetType: entry.targetType,
            outputFolder: entry.outputFolder,
            model: entry.model,
            mode: entry.mode,
        });

        // Delete the YAML file from .github/schedules/
        const stem = entry.id.replace(/^repo:/, '');
        const scheduleDir = getRepoScheduleDir(rootPath);
        for (const ext of ['.yaml', '.yml']) {
            const filePath = path.join(scheduleDir, `${stem}${ext}`);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            } catch { /* non-fatal */ }
        }

        // Cancel timer for old repo schedule and reload
        this.cancelTimer(entry.id);
        this.reloadRepoSchedules(repoId);

        return newEntry;
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
            const current = this.getSchedule(repoId, schedule.id);
            if (!current || current.status !== 'active') return;

            // If delay was capped, just reschedule — we haven't reached the target time yet
            if (actualDelay < delayMs) {
                this.scheduleNextRun(repoId, current);
                return;
            }

            // Timer may fire slightly early due to JS timer imprecision.
            // If we haven't reached the target time yet, reschedule.
            if (Date.now() < next.getTime()) {
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
                const latest = this.getSchedule(repoId, schedule.id);
                if (latest && latest.status === 'active') {
                    this.scheduleNextRun(repoId, latest);
                }
            }).catch(() => {
                // Still schedule next even on error
                const latest = this.getSchedule(repoId, schedule.id);
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
                    const effectiveOutputFolder = schedule.outputFolder || `~/.coc/repos/${repoId}/tasks`;
                    const outputPrefix = `Output folder: ${effectiveOutputFolder}\n\n`;
                    const taskId = this.queueManager.enqueue({
                        type: 'chat',
                        priority: 'normal',
                        payload: {
                            kind: 'chat',
                            mode: schedule.mode ?? 'autopilot',
                            prompt: `${outputPrefix}Follow the instruction ${schedule.target}.`,
                            context: {
                                files: [schedule.target],
                                scheduleId: schedule.id,
                                scheduleParams: schedule.params,
                            },
                            workingDirectory: '',
                        },
                        config: { model: schedule.model || undefined },
                        displayName: `[Schedule] ${schedule.name}`,
                        repoId,
                    });
                    run.taskId = taskId;
                    run.processId = toQueueProcessId(taskId);
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
                    run.taskId = taskId;
                    run.processId = `queue_${taskId}`;
                } else if (schedule.targetType === 'work-item') {
                    if (this.onCreateWorkItem) {
                        await this.onCreateWorkItem(schedule, repoId);
                    }
                }
            }

            finaliseRun(run, 'completed');
        } catch (err) {
            finaliseRun(run, 'failed', err);

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
        this.persistRun(run);
    }

    private updateRunRecord(scheduleId: string, run: ScheduleRunRecord): void {
        const history = this.runHistory.get(scheduleId);
        if (!history) return;
        const idx = history.findIndex(r => r.id === run.id);
        if (idx >= 0) {
            history[idx] = run;
        }
        this.persistRun(run);
    }

    private persistRun(run: ScheduleRunRecord): void {
        if (!this.runPersistence) return;
        this.runPersistence.upsert(run);
        this.runPersistence.trim(run.repoId);
    }

    private persist(repoId: string): void {
        // Only persist user-managed schedules (not repo-sourced ones)
        const map = this.schedules.get(repoId);
        const schedules = map ? Array.from(map.values()) : [];
        this.persistence.saveRepo(repoId, schedules);
    }

    // ========================================================================
    // Public — repo schedule management
    // ========================================================================

    /**
     * Register a workspace root path for a repo and load repo-defined schedules
     * from <rootPath>/.github/schedules/.  Sets up a file watcher for live reload.
     * Safe to call multiple times (idempotent — re-registers path and refreshes).
     */
    registerWorkspacePath(repoId: string, rootPath: string): void {
        this.workspacePaths.set(repoId, rootPath);
        this.reloadRepoSchedules(repoId);
        this.watchRepoScheduleDir(repoId, rootPath);
    }

    /**
     * Reload repo-defined schedules for a workspace from disk.
     * Called automatically by the file watcher.
     */
    reloadRepoSchedules(repoId: string): void {
        const rootPath = this.workspacePaths.get(repoId);
        if (!rootPath) return;

        const overrides = this.overrideStore?.load(repoId) ?? {};
        const entries = loadRepoSchedules(rootPath, overrides);
        const newMap = new Map<string, ScheduleEntry>();
        for (const entry of entries) {
            newMap.set(entry.id, entry);
        }

        // Cancel timers for schedules that were removed or are no longer active
        const oldMap = this.repoSchedules.get(repoId);
        if (oldMap) {
            for (const [id, old] of oldMap) {
                const updated = newMap.get(id);
                if (!updated || updated.status !== 'active') {
                    this.cancelTimer(id);
                } else if (updated.cron !== old.cron) {
                    // Cron changed — reschedule
                    this.cancelTimer(id);
                }
            }
        }

        if (newMap.size > 0) {
            this.repoSchedules.set(repoId, newMap);
        } else {
            this.repoSchedules.delete(repoId);
        }

        // Start timers for active repo schedules
        for (const entry of newMap.values()) {
            if (entry.status === 'active' && !this.timers.has(entry.id)) {
                this.scheduleNextRun(repoId, entry);
            }
        }
    }

    private watchRepoScheduleDir(repoId: string, rootPath: string): void {
        if (this.disposed) return;

        const scheduleDir = getRepoScheduleDir(rootPath);
        try {
            if (!fs.existsSync(scheduleDir)) return;
        } catch {
            return;
        }

        // Close existing watcher if re-registering
        const existing = this.repoWatchers.get(repoId);
        if (existing) {
            try { existing.close(); } catch { /* non-fatal */ }
            this.repoWatchers.delete(repoId);
        }

        try {
            const watcher = fs.watch(scheduleDir, () => {
                const prevTimer = this.watchDebounceTimers.get(repoId);
                if (prevTimer) clearTimeout(prevTimer);
                const timer = setTimeout(() => {
                    this.watchDebounceTimers.delete(repoId);
                    this.reloadRepoSchedules(repoId);
                }, 300);
                this.watchDebounceTimers.set(repoId, timer);
            });
            this.repoWatchers.set(repoId, watcher);
        } catch {
            // Non-fatal: file watching may not be available in all environments
        }
    }
}

/**
 * ScheduleManager
 *
 * Thin orchestrator over four focused collaborators:
 *
 *   - ScheduleTimerRegistry  — owns scheduleId → setTimeout handle map
 *   - ScheduleRunHistory     — owns runHistory map + SQLite persistence
 *   - RepoScheduleWatcher    — owns fs.FSWatcher + debounce timers
 *   - ScheduleExecutor       — owns executeRun, runningSchedules
 *
 * Manager itself handles user-schedule CRUD, repo-schedule loading,
 * schedule-move operations, and the EventEmitter bus.  All disk I/O on
 * `.github/schedules/` uses `fs.promises` (non-blocking).
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import type { TaskQueueManager } from '@plusplusoneplusplus/forge';
import { getErrorMessage } from '../shared/fs-utils';
import { getServerLogger } from '../logging/server-logger';
import { ScheduleYamlPersistence } from './schedule-yaml-persistence';
import type { SqliteScheduleRunPersistence } from './sqlite-schedule-run-persistence';
import { loadRepoSchedulesAsync, getRepoScheduleDir } from './repo-schedule-loader';
import type { RepoScheduleOverrideStore } from './repo-schedule-overrides';
import { parseCron, nextCronTime, slugifyName } from './cron-utils';
import { ScheduleTimerRegistry } from './schedule-timer-registry';
import { ScheduleRunHistory } from './schedule-run-history';
import { RepoScheduleWatcher } from './repo-schedule-watcher';
import { ScheduleExecutor } from './schedule-executor';
import { normalizeChatMode } from '../tasks/task-types';
import type {
    ScheduleEntry,
    ScheduleRunRecord,
    ScheduleChangeEvent,
} from './schedule-manager-types';

type ScheduleMutableFields = Pick<ScheduleEntry, 'name' | 'target' | 'cron' | 'params' | 'onFailure' | 'status' | 'targetType' | 'outputFolder' | 'model' | 'mode'>;
type ScheduleUpdates = Partial<ScheduleMutableFields>;
export interface RepoScheduleReloadResult {
    ok: boolean;
    loaded: number;
    error?: string;
}

function normalizeScheduleMode(mode: unknown): ScheduleEntry['mode'] {
    return normalizeChatMode(mode);
}

function normalizeScheduleUpdates(updates: ScheduleUpdates): ScheduleUpdates {
    if (!Object.prototype.hasOwnProperty.call(updates, 'mode')) {
        return updates;
    }
    return { ...updates, mode: normalizeScheduleMode(updates.mode) };
}

// Re-export cron utilities for backward compatibility
export { parseCron, nextCronTime, describeCron, slugifyName } from './cron-utils';
export type { CronFields } from './cron-utils';

// Re-export shared types for backward compatibility
export type {
    ScheduleEntry,
    ScheduleRunRecord,
    ScheduleChangeEvent,
    ScheduleStatus,
    ScheduleOnFailure,
} from './schedule-manager-types';

export class ScheduleManager extends EventEmitter {
    // repoId → scheduleId → ScheduleEntry (user-managed)
    private readonly schedules = new Map<string, Map<string, ScheduleEntry>>();
    // repoId → scheduleId → ScheduleEntry (repo-managed, from .github/schedules/)
    private readonly repoSchedules = new Map<string, Map<string, ScheduleEntry>>();
    // repoId → workspace rootPath
    private readonly workspacePaths = new Map<string, string>();
    // Collaborators
    private readonly timers = new ScheduleTimerRegistry();
    private readonly history = new ScheduleRunHistory();
    private readonly watcher = new RepoScheduleWatcher();
    private readonly executor: ScheduleExecutor;
    // Dependencies
    private readonly persistence: ScheduleYamlPersistence;
    private readonly overrideStore: RepoScheduleOverrideStore | null;
    private readonly repoReloadQueues = new Map<string, Promise<RepoScheduleReloadResult>>();
    private disposed = false;

    constructor(
        persistence: ScheduleYamlPersistence,
        queueManager: TaskQueueManager | null = null,
        overrideStore: RepoScheduleOverrideStore | null = null,
        dataDir?: string,
    ) {
        super();
        this.persistence = persistence;
        this.overrideStore = overrideStore;
        this.executor = new ScheduleExecutor(
            queueManager,
            this.history,
            (event) => this.emit('change', event as ScheduleChangeEvent),
            (repoId, scheduleId) => this.handleFailureStop(repoId, scheduleId),
            dataDir,
        );
    }

    /**
     * Restore schedules from persistence and start timers for active ones.
     */
    async restore(): Promise<void> {
        const allSchedules = await this.persistence.loadAll();
        let total = 0;
        for (const [repoId, entries] of allSchedules) {
            const map = new Map<string, ScheduleEntry>();
            for (const entry of entries) {
                // Purge orphan memory-promote schedules from V1 system
                if ((entry as any).targetType === 'memory-promote') continue;
                map.set(entry.id, entry);
                if (entry.status === 'active') {
                    this.scheduleNextRun(repoId, entry);
                }
                total++;
            }
            this.schedules.set(repoId, map);
        }
        if (total > 0) {
            getServerLogger().info({ count: total }, '[ScheduleManager] Restored schedules');
        }
    }

    /**
     * Restore run history from persistence and inject into in-memory runHistory map.
     * Must be called after restore().
     */
    restoreRunHistory(persistence: SqliteScheduleRunPersistence): void {
        const restoredCount = this.history.restore(persistence);
        if (restoredCount > 0) {
            getServerLogger().info({ count: restoredCount }, '[ScheduleManager] Restored run history');
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
    async addSchedule(repoId: string, entry: Omit<ScheduleEntry, 'id' | 'createdAt'>): Promise<ScheduleEntry> {
        // Validate cron
        parseCron(entry.cron);

        const schedule: ScheduleEntry = {
            ...entry,
            mode: normalizeScheduleMode(entry.mode),
            id: 'sch_' + crypto.randomBytes(6).toString('hex'),
            createdAt: new Date().toISOString(),
        };

        if (!this.schedules.has(repoId)) {
            this.schedules.set(repoId, new Map());
        }
        this.schedules.get(repoId)!.set(schedule.id, schedule);
        await this.persist(repoId);

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
     * Create or replace a deterministic user schedule.
     * Used for server-managed schedules whose IDs must survive restart.
     */
    async setSchedule(repoId: string, entry: ScheduleEntry): Promise<ScheduleEntry> {
        parseCron(entry.cron);

        const existing = this.schedules.get(repoId)?.get(entry.id);
        const schedule: ScheduleEntry = {
            ...entry,
            mode: normalizeScheduleMode(entry.mode),
            createdAt: existing?.createdAt ?? entry.createdAt ?? new Date().toISOString(),
        };

        if (!this.schedules.has(repoId)) {
            this.schedules.set(repoId, new Map());
        }
        this.schedules.get(repoId)!.set(schedule.id, schedule);

        this.timers.cancel(schedule.id);
        await this.persist(repoId);
        if (schedule.status === 'active') {
            this.scheduleNextRun(repoId, schedule);
        }

        this.emit('change', {
            type: existing ? 'schedule-updated' : 'schedule-added',
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
    async updateSchedule(repoId: string, scheduleId: string, updates: ScheduleUpdates): Promise<ScheduleEntry | undefined> {
        const normalizedUpdates = normalizeScheduleUpdates(updates);
        // Check repo schedules first
        const repoSchedule = this.repoSchedules.get(repoId)?.get(scheduleId);
        if (repoSchedule) {
            // Handle status changes via override store
            if (normalizedUpdates.status && normalizedUpdates.status !== repoSchedule.status) {
                repoSchedule.status = normalizedUpdates.status;
                this.overrideStore?.setStatus(repoId, scheduleId, normalizedUpdates.status);
            }

            // Apply non-status field updates and write back to YAML
            const { status: _status, ...fieldUpdates } = normalizedUpdates;
            if (Object.keys(fieldUpdates).length > 0) {
                Object.assign(repoSchedule, fieldUpdates);
                const rootPath = this.workspacePaths.get(repoId);
                if (!rootPath) {
                    throw new Error(`No workspace path registered for repo ${repoId}`);
                }
                const stem = scheduleId.replace(/^repo:/, '');
                await this.writeRepoScheduleYaml(rootPath, stem, repoSchedule, repoId);
            }

            // Reschedule timer
            this.timers.cancel(scheduleId);
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

        if (normalizedUpdates.cron && normalizedUpdates.cron !== schedule.cron) {
            parseCron(normalizedUpdates.cron);
        }

        Object.assign(schedule, normalizedUpdates);

        // Reschedule timer if needed
        this.timers.cancel(scheduleId);
        if (schedule.status === 'active') {
            this.scheduleNextRun(repoId, schedule);
        }

        await this.persist(repoId);

        this.emit('change', {
            type: 'schedule-updated',
            repoId,
            scheduleId,
            schedule,
        } as ScheduleChangeEvent);

        return schedule;
    }

    /**
     * Remove a user schedule.
     * For repo schedules, use removeRepoSchedule() instead.
     */
    async removeSchedule(repoId: string, scheduleId: string): Promise<boolean> {
        // Block removal of repo schedules — use removeRepoSchedule() instead
        if (this.repoSchedules.get(repoId)?.has(scheduleId)) return false;

        const map = this.schedules.get(repoId);
        if (!map || !map.has(scheduleId)) return false;

        this.timers.cancel(scheduleId);
        map.delete(scheduleId);
        this.history.delete(scheduleId);

        if (map.size === 0) {
            this.schedules.delete(repoId);
            await this.persistence.deleteRepo(repoId);
        } else {
            await this.persist(repoId);
        }

        this.emit('change', {
            type: 'schedule-removed',
            repoId,
            scheduleId,
        } as ScheduleChangeEvent);

        return true;
    }

    /**
     * Remove a repo schedule by deleting its backing YAML file from
     * .github/schedules/ and unregistering it from the in-memory map.
     *
     * @returns true if the file was deleted successfully.
     * @throws if the workspace path is not registered, the schedule is not a
     *   repo schedule, or the backing file does not exist.
     */
    async removeRepoSchedule(repoId: string, scheduleId: string): Promise<boolean> {
        const rootPath = this.workspacePaths.get(repoId);
        if (!rootPath) {
            throw new Error('Workspace path not available for this repo');
        }

        const repoMap = this.repoSchedules.get(repoId);
        if (!repoMap?.has(scheduleId)) {
            throw new Error('Repo schedule not found');
        }

        const stem = scheduleId.replace(/^repo:/, '');
        const scheduleDir = getRepoScheduleDir(rootPath);
        let deleted = false;

        for (const ext of ['.yaml', '.yml']) {
            const filePath = path.join(scheduleDir, `${stem}${ext}`);
            try {
                await fs.promises.unlink(filePath);
                deleted = true;
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
                throw new Error(`Failed to delete schedule file: ${getErrorMessage(err)}`);
            }
        }

        if (!deleted) {
            throw new Error(`Schedule file not found: ${stem}.yaml`);
        }

        // Unregister from in-memory map and cancel timer
        this.timers.cancel(scheduleId);
        this.history.delete(scheduleId);
        await this.reloadRepoSchedules(repoId);

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

        return this.executor.executeRun(repoId, schedule);
    }

    /**
     * Get run history for a schedule.
     */
    getRunHistory(scheduleId: string): ScheduleRunRecord[] {
        return this.history.get(scheduleId);
    }

    /**
     * Check if a schedule is currently running.
     */
    isRunning(scheduleId: string, repoId?: string): boolean {
        return this.executor.isRunning(scheduleId, repoId);
    }

    /**
     * Dispose all timers and clean up.
     */
    dispose(): void {
        this.disposed = true;
        this.timers.clear();
        this.watcher.dispose();
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
    private async writeRepoScheduleYaml(rootPath: string, stem: string, entry: ScheduleEntry, repoId: string): Promise<void> {
        const scheduleDir = getRepoScheduleDir(rootPath);
        await fs.promises.mkdir(scheduleDir, { recursive: true });

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
        await fs.promises.writeFile(path.join(scheduleDir, `${stem}.yaml`), yamlContent, 'utf-8');
    }

    private async moveUserToRepo(repoId: string, entry: ScheduleEntry, rootPath: string): Promise<ScheduleEntry> {
        const slug = slugifyName(entry.name);
        const scheduleDir = getRepoScheduleDir(rootPath);

        // De-duplicate filename if it already exists
        let finalSlug = slug;
        let counter = 1;
        while (await fileExists(path.join(scheduleDir, `${finalSlug}.yaml`))) {
            finalSlug = `${slug}-${counter}`;
            counter++;
        }

        await this.writeRepoScheduleYaml(rootPath, finalSlug, entry, repoId);

        // Remove from user schedules
        this.timers.cancel(entry.id);
        const map = this.schedules.get(repoId);
        if (map) {
            map.delete(entry.id);
            if (map.size === 0) {
                this.schedules.delete(repoId);
                await this.persistence.deleteRepo(repoId);
            } else {
                await this.persist(repoId);
            }
        }

        // Reload repo schedules so the new file is picked up
        await this.reloadRepoSchedules(repoId);

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

    private async moveRepoToUser(repoId: string, entry: ScheduleEntry, rootPath: string): Promise<ScheduleEntry> {
        // Create a new user schedule (addSchedule strips source)
        const newEntry = await this.addSchedule(repoId, {
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
                await fs.promises.unlink(filePath);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    getServerLogger().warn({ err, filePath }, 'ScheduleManager: failed to delete repo schedule file');
                }
            }
        }

        // Cancel timer for old repo schedule and reload
        this.timers.cancel(entry.id);
        await this.reloadRepoSchedules(repoId);

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

        const { wasCapped } = this.timers.set(schedule.id, () => {
            if (this.disposed) return;
            const current = this.getSchedule(repoId, schedule.id);
            if (!current || current.status !== 'active') return;

            // If delay was capped, just reschedule — we haven't reached the target time yet
            if (wasCapped) {
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
            if (this.executor.isRunning(schedule.id, repoId)) {
                const missedReason = 'Previous schedule run still active';
                this.executor.recordMissedRun(repoId, current, missedReason);
                getServerLogger().info(
                    { scheduleName: schedule.name, scheduleId: schedule.id },
                    '[ScheduleManager] Skipped run: previous run still active',
                );
                this.executor.whenIdle(schedule.id, repoId).then(() => {
                    const latest = this.getSchedule(repoId, schedule.id);
                    if (latest && latest.status === 'active') {
                        this.scheduleNextRun(repoId, latest);
                    }
                });
                return;
            }

            this.executor.executeRun(repoId, current).finally(() => {
                // Schedule next run after completion (success or failure)
                const latest = this.getSchedule(repoId, schedule.id);
                if (latest && latest.status === 'active') {
                    this.scheduleNextRun(repoId, latest);
                }
            });
        }, delayMs);
    }

    private handleFailureStop(repoId: string, scheduleId: string): void {
        const schedule = this.schedules.get(repoId)?.get(scheduleId);
        if (!schedule) return;
        schedule.status = 'stopped';
        this.timers.cancel(scheduleId);
        this.persist(repoId).catch(err => {
            getServerLogger().warn(
                { err, repoId, scheduleId },
                'ScheduleManager: failed to persist stopped schedule after failure',
            );
        });
    }

    private async persist(repoId: string): Promise<void> {
        // Only persist user-managed schedules (not repo-sourced ones)
        const map = this.schedules.get(repoId);
        const schedules = map ? Array.from(map.values()) : [];
        await this.persistence.saveRepo(repoId, schedules);
    }

    // ========================================================================
    // Public — repo schedule management
    // ========================================================================

    /**
     * Register a workspace root path for a repo and load repo-defined schedules
     * from <rootPath>/.github/schedules/.  Sets up a file watcher for live reload.
     * Safe to call multiple times (idempotent — re-registers path and refreshes).
     */
    async registerWorkspacePath(repoId: string, rootPath: string): Promise<RepoScheduleReloadResult> {
        this.workspacePaths.set(repoId, rootPath);
        const result = await this.reloadRepoSchedules(repoId);
        const scheduleDir = getRepoScheduleDir(rootPath);
        // Fire-and-forget: watch() handles missing dirs and unsupported platforms gracefully.
        this.watcher.watch(repoId, scheduleDir, async () => { await this.reloadRepoSchedules(repoId); }).catch(err => {
            getServerLogger().warn({ err, repoId }, 'ScheduleManager: failed to watch repo schedule dir');
        });
        return result;
    }

    /**
     * Reload repo-defined schedules for a workspace from disk.
     * Called automatically by the file watcher.
     */
    async reloadRepoSchedules(repoId: string): Promise<RepoScheduleReloadResult> {
        const previous = this.repoReloadQueues.get(repoId);
        const current = (previous ?? Promise.resolve({ ok: true, loaded: 0 }))
            .catch(() => ({ ok: false, loaded: this.repoSchedules.get(repoId)?.size ?? 0 }))
            .then(() => this.reloadRepoSchedulesNow(repoId));
        this.repoReloadQueues.set(repoId, current);
        void current.finally(() => {
            if (this.repoReloadQueues.get(repoId) === current) {
                this.repoReloadQueues.delete(repoId);
            }
        });
        return current;
    }

    private async reloadRepoSchedulesNow(repoId: string): Promise<RepoScheduleReloadResult> {
        const rootPath = this.workspacePaths.get(repoId);
        if (!rootPath) return { ok: true, loaded: 0 };

        const overrides = this.overrideStore?.load(repoId) ?? {};
        let entries: ScheduleEntry[];
        try {
            entries = await loadRepoSchedulesAsync(rootPath, overrides);
        } catch (err) {
            const loaded = this.repoSchedules.get(repoId)?.size ?? 0;
            const message = getErrorMessage(err, 'Failed to reload repo schedules');
            getServerLogger().warn(
                { err, repoId, rootPath, preserved: loaded },
                'ScheduleManager: failed to reload repo schedules; preserving previous schedules',
            );
            return { ok: false, loaded, error: message };
        }

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
                    this.timers.cancel(id);
                } else if (updated.cron !== old.cron) {
                    // Cron changed — reschedule
                    this.timers.cancel(id);
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

        return { ok: true, loaded: newMap.size };
    }
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await fs.promises.access(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * SchedulePersistence
 *
 * Stores schedule definitions per repository to disk.
 * Uses the same atomic-write + per-repo file pattern as QueuePersistence.
 *
 * Storage layout:
 *   ~/.coc/schedules/repo-<repoId>.json
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScheduleEntry, ScheduleRunRecord } from './schedule-manager';

// ============================================================================
// Types
// ============================================================================

export interface PersistedScheduleState {
    version: number;
    savedAt: string;
    repoId: string;
    schedules: ScheduleEntry[];
}

const CURRENT_VERSION = 2;

// ============================================================================
// Helpers
// ============================================================================

/** Get the per-repo schedule file path. */
export function getRepoScheduleFilePath(dataDir: string, repoId: string): string {
    return path.join(dataDir, 'schedules', `repo-${repoId}.json`);
}

// ============================================================================
// SchedulePersistence
// ============================================================================

export class SchedulePersistence {
    private readonly dataDir: string;
    private readonly schedulesDir: string;

    constructor(dataDir: string) {
        this.dataDir = dataDir;
        this.schedulesDir = path.join(dataDir, 'schedules');
        if (!fs.existsSync(this.schedulesDir)) {
            fs.mkdirSync(this.schedulesDir, { recursive: true });
        }
    }

    /**
     * Load all schedules from all per-repo files.
     * Returns a map of repoId → ScheduleEntry[].
     */
    loadAll(): Map<string, ScheduleEntry[]> {
        const result = new Map<string, ScheduleEntry[]>();
        if (!fs.existsSync(this.schedulesDir)) {
            return result;
        }

        const files = fs.readdirSync(this.schedulesDir)
            .filter(f => f.startsWith('repo-') && f.endsWith('.json'));

        for (const file of files) {
            const filePath = path.join(this.schedulesDir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const state: PersistedScheduleState = JSON.parse(raw);
                if (state.version === 1) {
                    // forward migration: all existing schedules were prompt-based
                    for (const s of state.schedules) {
                        if (!s.targetType) {
                            (s as ScheduleEntry).targetType = 'prompt';
                        }
                    }
                    // fall through — treat as current
                } else if (state.version !== CURRENT_VERSION) {
                    process.stderr.write(
                        `[SchedulePersistence] Unknown version ${state.version} in ${file} — skipping\n`
                    );
                    continue;
                }
                if (Array.isArray(state.schedules) && state.schedules.length > 0) {
                    result.set(state.repoId, state.schedules);
                }
            } catch (err) {
                process.stderr.write(
                    `[SchedulePersistence] Failed to read ${file}: ${err}\n`
                );
            }
        }

        return result;
    }

    /**
     * Save schedules for a specific repo.
     */
    saveRepo(repoId: string, schedules: ScheduleEntry[]): void {
        const state: PersistedScheduleState = {
            version: CURRENT_VERSION,
            savedAt: new Date().toISOString(),
            repoId,
            schedules,
        };
        const filePath = getRepoScheduleFilePath(this.dataDir, repoId);
        this.atomicWrite(filePath, state);
    }

    /**
     * Delete the schedule file for a repo (when all schedules removed).
     */
    deleteRepo(repoId: string): void {
        const filePath = getRepoScheduleFilePath(this.dataDir, repoId);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch {
            // Non-fatal
        }
    }

    // ========================================================================
    // Private — file operations
    // ========================================================================

    private atomicWrite(filePath: string, state: PersistedScheduleState): void {
        const tmpPath = filePath + '.tmp';
        try {
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
            fs.renameSync(tmpPath, filePath);
        } catch (err) {
            process.stderr.write(`[SchedulePersistence] Failed to write ${filePath}: ${err}\n`);
            try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
        }
    }
}

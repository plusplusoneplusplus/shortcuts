/**
 * SchedulePersistence
 *
 * Stores schedule definitions per repository to disk.
 * Uses the same atomic-write + per-repo file pattern as QueuePersistence.
 *
 * Storage layout:
 *   ~/.coc/repos/<repoId>/schedules.json
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson, getRepoDataPath } from '@plusplusoneplusplus/coc-server';
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

const CURRENT_VERSION = 3;

// ============================================================================
// Helpers
// ============================================================================

/** Get the per-repo schedule file path. */
export function getRepoScheduleFilePath(dataDir: string, repoId: string): string {
    return getRepoDataPath(dataDir, repoId, 'schedules.json');
}

// ============================================================================
// SchedulePersistence
// ============================================================================

export class SchedulePersistence {
    private readonly dataDir: string;

    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    /**
     * Load all schedules from all per-repo files.
     * Returns a map of repoId → ScheduleEntry[].
     */
    loadAll(): Map<string, ScheduleEntry[]> {
        const result = new Map<string, ScheduleEntry[]>();
        const reposRoot = path.join(this.dataDir, 'repos');
        if (!fs.existsSync(reposRoot)) return result;

        const repoDirs = fs.readdirSync(reposRoot, { withFileTypes: true })
            .filter(d => d.isDirectory());

        for (const dir of repoDirs) {
            const repoId = dir.name;
            const filePath = getRepoDataPath(this.dataDir, repoId, 'schedules.json');
            if (!fs.existsSync(filePath)) continue;
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
                    // fall through to v2→v3 migration
                }
                if (state.version === 1 || state.version === 2) {
                    // v2→v3: back-fill mode: 'autopilot' on all entries
                    for (const s of state.schedules) {
                        if (!s.mode) {
                            (s as ScheduleEntry).mode = 'autopilot';
                        }
                    }
                    // treat as current
                } else if (state.version !== CURRENT_VERSION) {
                    process.stderr.write(
                        `[SchedulePersistence] Unknown version ${state.version} in ${filePath} — skipping\n`
                    );
                    continue;
                }
                if (Array.isArray(state.schedules) && state.schedules.length > 0) {
                    result.set(state.repoId, state.schedules);
                }
            } catch (err) {
                process.stderr.write(
                    `[SchedulePersistence] Failed to read ${filePath}: ${err}\n`
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
        atomicWriteJson(filePath, state);
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
}

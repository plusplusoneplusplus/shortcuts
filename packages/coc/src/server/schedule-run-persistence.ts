/**
 * ScheduleRunPersistence
 *
 * Stores schedule run history per repository to disk.
 * Uses the same atomic-write + per-repo file pattern as ScheduleYamlPersistence.
 *
 * Storage layout:
 *   ~/.coc/repos/<repoId>/schedule-runs.json
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import { atomicWriteJson, getRepoDataPath } from '@plusplusoneplusplus/coc-server';
import type { ScheduleRunRecord } from './schedule-manager';

// ============================================================================
// Types
// ============================================================================

export interface PersistedRunHistory {
    version: 1;
    savedAt: string;
    repoId: string;
    runs: ScheduleRunRecord[];
}

const MAX_RUNS_DEFAULT = 100;

// ============================================================================
// ScheduleRunPersistence
// ============================================================================

export class ScheduleRunPersistence {
    private readonly dataDir: string;
    private readonly maxRuns: number;

    constructor(dataDir: string, maxRuns: number = MAX_RUNS_DEFAULT) {
        this.dataDir = dataDir;
        this.maxRuns = maxRuns;
    }

    /**
     * Save all runs for a repo. Trims to maxRuns, protecting running/missed entries.
     */
    save(repoId: string, allRuns: ScheduleRunRecord[]): void {
        let toSave = allRuns;
        if (toSave.length > this.maxRuns) {
            const terminal = toSave.filter(r => r.status === 'completed' || r.status === 'failed');
            const protected_ = toSave.filter(r => r.status === 'running' || r.status === 'missed');
            // Sort terminal newest-first, keep up to (maxRuns - protected count)
            const sorted = [...terminal].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
            const keep = sorted.slice(0, Math.max(0, this.maxRuns - protected_.length));
            toSave = [...protected_, ...keep];
        }

        const state: PersistedRunHistory = {
            version: 1,
            savedAt: new Date().toISOString(),
            repoId,
            runs: toSave,
        };
        const filePath = getRepoDataPath(this.dataDir, repoId, 'schedule-runs.json');
        atomicWriteJson(filePath, state);
    }

    /**
     * Load runs for a specific repo. Returns [] if missing or corrupt.
     */
    load(repoId: string): ScheduleRunRecord[] {
        const filePath = getRepoDataPath(this.dataDir, repoId, 'schedule-runs.json');
        if (!fs.existsSync(filePath)) return [];
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const state: PersistedRunHistory = JSON.parse(raw);
            if (!Array.isArray(state.runs)) return [];
            return state.runs;
        } catch (err) {
            process.stderr.write(`[ScheduleRunPersistence] Failed to read ${filePath}: ${err}\n`);
            return [];
        }
    }

    /**
     * Load all run history from all repos, grouped by scheduleId.
     * Returns Map<scheduleId, ScheduleRunRecord[]>.
     */
    loadAll(): Map<string, ScheduleRunRecord[]> {
        const result = new Map<string, ScheduleRunRecord[]>();
        const reposRoot = path.join(this.dataDir, 'repos');
        if (!fs.existsSync(reposRoot)) return result;

        const repoDirs = fs.readdirSync(reposRoot, { withFileTypes: true })
            .filter(d => d.isDirectory());

        for (const dir of repoDirs) {
            const repoId = dir.name;
            const filePath = getRepoDataPath(this.dataDir, repoId, 'schedule-runs.json');
            if (!fs.existsSync(filePath)) continue;
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const state: PersistedRunHistory = JSON.parse(raw);
                if (!Array.isArray(state.runs)) continue;
                for (const run of state.runs) {
                    if (!run.scheduleId) continue;
                    if (!result.has(run.scheduleId)) {
                        result.set(run.scheduleId, []);
                    }
                    result.get(run.scheduleId)!.push(run);
                }
            } catch (err) {
                process.stderr.write(`[ScheduleRunPersistence] Failed to read ${filePath}: ${err}\n`);
            }
        }

        return result;
    }

    /**
     * Delete the run history file for a repo.
     */
    deleteRepo(repoId: string): void {
        const filePath = getRepoDataPath(this.dataDir, repoId, 'schedule-runs.json');
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch {
            // Non-fatal
        }
    }
}

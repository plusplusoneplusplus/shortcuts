/**
 * ScheduleYamlPersistence
 *
 * Stores each user schedule as an individual YAML file under:
 *   ~/.coc/repos/<repoId>/schedules/<id>.yaml
 *
 * This provides the same loadAll / saveRepo / deleteRepo contract as
 * SchedulePersistence, plus fine-grained per-entry helpers.
 *
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { getRepoDataPath } from '../paths';
import type { ScheduleEntry } from './schedule-manager';
import { normalizeChatMode } from '../tasks/task-types';

/** Shape of the legacy JSON persistence file used by the old SchedulePersistence class. */
interface PersistedScheduleState {
    version: number;
    savedAt: string;
    repoId: string;
    schedules: ScheduleEntry[];
}

// ============================================================================
// Helpers
// ============================================================================

/** Returns the per-repo YAML directory: <dataDir>/repos/<repoId>/schedules */
export function getScheduleYamlDir(dataDir: string, repoId: string): string {
    return getRepoDataPath(dataDir, repoId, 'schedules');
}

/** Returns the path for a single schedule YAML file: <dir>/<scheduleId>.yaml */
export function getScheduleYamlPath(dataDir: string, repoId: string, scheduleId: string): string {
    return path.join(getScheduleYamlDir(dataDir, repoId), `${scheduleId}.yaml`);
}

/** Atomic tmp→rename write for YAML content. Creates directories as needed. */
function atomicWriteYaml(filePath: string, content: string): void {
    const tmpPath = filePath + '.tmp';
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// ScheduleYamlPersistence
// ============================================================================

export class ScheduleYamlPersistence {
    private readonly dataDir: string;

    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    /** Load all schedules across all repos. Returns repoId → ScheduleEntry[]. */
    loadAll(): Map<string, ScheduleEntry[]> {
        const result = new Map<string, ScheduleEntry[]>();
        const reposRoot = path.join(this.dataDir, 'repos');
        if (!fs.existsSync(reposRoot)) return result;

        const repoDirs = fs.readdirSync(reposRoot, { withFileTypes: true })
            .filter(d => d.isDirectory());

        for (const dir of repoDirs) {
            const repoId = dir.name;
            const schedules = this.loadRepoSchedules(repoId);
            if (schedules.length > 0) {
                result.set(repoId, schedules);
            }
        }

        return result;
    }

    /** Load schedules for a single repo from its YAML directory. */
    loadRepoSchedules(repoId: string): ScheduleEntry[] {
        const dir = getScheduleYamlDir(this.dataDir, repoId);
        if (!fs.existsSync(dir)) return [];

        const files = fs.readdirSync(dir)
            .filter(f => f.endsWith('.yaml'))
            .sort();

        const result: ScheduleEntry[] = [];
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const raw = fs.readFileSync(filePath, 'utf-8');
                const entry = yaml.load(raw) as ScheduleEntry;

                if (!entry || typeof entry.id !== 'string' || !entry.id ||
                    typeof entry.name !== 'string' || !entry.name ||
                    typeof entry.cron !== 'string' || !entry.cron) {
                    process.stderr.write(
                        `[ScheduleYamlPersistence] Skipping ${filePath}: missing required fields (id, name, cron)\n`
                    );
                    continue;
                }

                const stem = path.basename(file, '.yaml');
                if (entry.id !== stem) {
                    process.stderr.write(
                        `[ScheduleYamlPersistence] Skipping ${filePath}: id mismatch (file: ${stem}, entry.id: ${entry.id})\n`
                    );
                    continue;
                }

                result.push({
                    ...entry,
                    mode: normalizeChatMode(entry.mode) ?? entry.mode,
                });
            } catch (err) {
                process.stderr.write(
                    `[ScheduleYamlPersistence] Failed to read ${filePath}: ${err}\n`
                );
            }
        }

        return result;
    }

    /**
     * Persist the full schedule list for a repo.
     * Writes one <id>.yaml per entry and deletes any orphaned YAML files.
     */
    saveRepo(repoId: string, schedules: ScheduleEntry[]): void {
        if (schedules.length === 0) {
            this.deleteRepo(repoId);
            return;
        }

        for (const entry of schedules) {
            this.saveSchedule(repoId, entry);
        }

        // Delete orphaned files
        const dir = getScheduleYamlDir(this.dataDir, repoId);
        const existingFiles = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
        const newIds = new Set(schedules.map(s => s.id + '.yaml'));
        for (const file of existingFiles) {
            if (!newIds.has(file)) {
                try {
                    fs.unlinkSync(path.join(dir, file));
                } catch { /* non-fatal */ }
            }
        }
    }

    /** Write (or overwrite) a single schedule YAML file. Atomic tmp→rename. */
    saveSchedule(repoId: string, entry: ScheduleEntry): void {
        const filePath = getScheduleYamlPath(this.dataDir, repoId, entry.id);
        const content = yaml.dump(entry, { lineWidth: 120 });
        atomicWriteYaml(filePath, content);
    }

    /** Delete the YAML file for a single schedule. Non-fatal if absent. */
    deleteSchedule(repoId: string, id: string): void {
        const filePath = getScheduleYamlPath(this.dataDir, repoId, id);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch { /* non-fatal */ }
    }

    /** Delete all YAML files in the schedules directory for a repo. */
    deleteRepo(repoId: string): void {
        const dir = getScheduleYamlDir(this.dataDir, repoId);
        if (!fs.existsSync(dir)) return;

        const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));
        for (const file of files) {
            try {
                fs.unlinkSync(path.join(dir, file));
            } catch { /* non-fatal */ }
        }

        try {
            fs.rmdirSync(dir);
        } catch { /* non-fatal: directory may not be empty */ }
    }

    /**
     * Scans every repo directory under `dataDir/repos/` for a legacy
     * `schedules.json` file.  For each one found:
     *   1. Parse the JSON and apply the same v1/v2/v3 migrations that
     *   2. Write each schedule entry as a YAML file via saveSchedule().
     *   3. Only after all writes succeed, delete `schedules.json`.
     *
     * Safe to call more than once (idempotent).
     */
    migrateAllFromJson(): void {
        const reposRoot = path.join(this.dataDir, 'repos');
        if (!fs.existsSync(reposRoot)) return;

        const repoDirs = fs.readdirSync(reposRoot, { withFileTypes: true })
            .filter(d => d.isDirectory());

        for (const dir of repoDirs) {
            const repoId = dir.name;
            const jsonPath = path.join(reposRoot, repoId, 'schedules.json');
            if (!fs.existsSync(jsonPath)) continue;

            try {
                const raw = fs.readFileSync(jsonPath, 'utf-8');
                const state = JSON.parse(raw) as PersistedScheduleState;

                // Apply same forward-migrations as the legacy JSON persistence class
                const entries: ScheduleEntry[] = state.schedules ?? [];
                if (state.version === 1) {
                    for (const s of entries) {
                        if (!s.targetType) s.targetType = 'prompt';
                    }
                }
                if (state.version === 1 || state.version === 2) {
                    for (const s of entries) {
                        if (!s.mode) s.mode = 'autopilot';
                    }
                } else if (state.version !== 3) {
                    // Unknown future version — skip migration for this repo
                    process.stderr.write(
                        `[ScheduleYamlPersistence] Skipping migration for ${repoId}: ` +
                        `unknown version ${state.version}\n`
                    );
                    continue;
                }

                // Write each entry as YAML (idempotent — overwrite if already exists)
                for (const entry of entries) {
                    this.saveSchedule(repoId, entry);
                }

                // Only remove JSON after all YAML files written successfully
                fs.unlinkSync(jsonPath);
                process.stderr.write(
                    `[ScheduleYamlPersistence] Migrated ${entries.length} schedule(s) ` +
                    `for repo ${repoId} from JSON to YAML\n`
                );
            } catch (err) {
                // Non-fatal: leave schedules.json in place; next startup will retry
                process.stderr.write(
                    `[ScheduleYamlPersistence] Migration failed for repo ${repoId}: ${err}\n`
                );
            }
        }
    }
}

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
import { getServerLogger } from '../logging/server-logger';
import { getErrorMessage } from '../shared/fs-utils';

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

/** Atomic tmp-to-rename write for YAML content. Creates directories as needed. */
async function atomicWriteYaml(filePath: string, content: string): Promise<void> {
    const tmpPath = filePath + '.tmp';
    const dir = path.dirname(filePath);
    await fs.promises.mkdir(dir, { recursive: true });
    try {
        await fs.promises.writeFile(tmpPath, content, 'utf-8');
        await fs.promises.rename(tmpPath, filePath);
    } catch (err) {
        try { await fs.promises.unlink(tmpPath); } catch { /* non-fatal cleanup */ }
        throw err;
    }
}

// ============================================================================
// ScheduleYamlPersistence
// ============================================================================

export class ScheduleYamlPersistence {
    private readonly dataDir: string;
    private readonly repoWriteQueues = new Map<string, Promise<void>>();

    constructor(dataDir: string) {
        this.dataDir = dataDir;
    }

    /** Load all schedules across all repos. Returns repoId → ScheduleEntry[]. */
    async loadAll(): Promise<Map<string, ScheduleEntry[]>> {
        await this.waitForAllWrites();
        const result = new Map<string, ScheduleEntry[]>();
        const reposRoot = path.join(this.dataDir, 'repos');

        let repoDirs: fs.Dirent[];
        try {
            repoDirs = await fs.promises.readdir(reposRoot, { withFileTypes: true });
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return result;
            getServerLogger().warn({ err, reposRoot }, '[ScheduleYamlPersistence] Failed to scan repos directory');
            return result;
        }

        for (const dir of repoDirs.filter(d => d.isDirectory())) {
            const repoId = dir.name;
            const schedules = await this.loadRepoSchedules(repoId);
            if (schedules.length > 0) {
                result.set(repoId, schedules);
            }
        }

        return result;
    }

    /** Load schedules for a single repo from its YAML directory. */
    async loadRepoSchedules(repoId: string): Promise<ScheduleEntry[]> {
        await this.waitForRepoWrites(repoId);
        const dir = getScheduleYamlDir(this.dataDir, repoId);

        let files: string[];
        try {
            files = (await fs.promises.readdir(dir))
                .filter(f => f.endsWith('.yaml'))
                .sort();
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
            getServerLogger().warn({ err, repoId, dir }, '[ScheduleYamlPersistence] Failed to scan schedule directory');
            return [];
        }

        const result: ScheduleEntry[] = [];
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const raw = await fs.promises.readFile(filePath, 'utf-8');
                const entry = yaml.load(raw) as ScheduleEntry;

                if (!entry || typeof entry.id !== 'string' || !entry.id ||
                    typeof entry.name !== 'string' || !entry.name ||
                    typeof entry.cron !== 'string' || !entry.cron) {
                    getServerLogger().warn(
                        { filePath },
                        '[ScheduleYamlPersistence] Skipping schedule YAML with missing required fields',
                    );
                    continue;
                }

                const stem = path.basename(file, '.yaml');
                if (entry.id !== stem) {
                    getServerLogger().warn(
                        { filePath, stem, entryId: entry.id },
                        '[ScheduleYamlPersistence] Skipping schedule YAML with id mismatch',
                    );
                    continue;
                }

                result.push({
                    ...entry,
                    mode: normalizeChatMode(entry.mode) ?? entry.mode,
                });
            } catch (err) {
                getServerLogger().warn(
                    { err, filePath },
                    '[ScheduleYamlPersistence] Failed to read schedule YAML',
                );
            }
        }

        return result;
    }

    /**
     * Persist the full schedule list for a repo.
     * Writes one <id>.yaml per entry and deletes any orphaned YAML files.
     */
    async saveRepo(repoId: string, schedules: ScheduleEntry[]): Promise<void> {
        await this.enqueueRepoWrite(repoId, async () => {
            if (schedules.length === 0) {
                await this.deleteRepoFiles(repoId);
                return;
            }

            for (const entry of schedules) {
                await this.writeScheduleFile(repoId, entry);
            }

            const dir = getScheduleYamlDir(this.dataDir, repoId);
            const existingFiles = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.yaml'));
            const newIds = new Set(schedules.map(s => s.id + '.yaml'));
            for (const file of existingFiles) {
                if (newIds.has(file)) continue;
                try {
                    await fs.promises.unlink(path.join(dir, file));
                } catch (err) {
                    getServerLogger().warn(
                        { err, repoId, file },
                        '[ScheduleYamlPersistence] Failed to delete orphaned schedule YAML',
                    );
                    throw err;
                }
            }
        });
    }

    /** Write (or overwrite) a single schedule YAML file. Atomic tmp-to-rename. */
    async saveSchedule(repoId: string, entry: ScheduleEntry): Promise<void> {
        await this.enqueueRepoWrite(repoId, () => this.writeScheduleFile(repoId, entry));
    }

    private async writeScheduleFile(repoId: string, entry: ScheduleEntry): Promise<void> {
        const filePath = getScheduleYamlPath(this.dataDir, repoId, entry.id);
        const content = yaml.dump(entry, { lineWidth: 120 });
        await atomicWriteYaml(filePath, content);
    }

    /** Delete the YAML file for a single schedule. Non-fatal if absent. */
    async deleteSchedule(repoId: string, id: string): Promise<void> {
        await this.enqueueRepoWrite(repoId, async () => {
            const filePath = getScheduleYamlPath(this.dataDir, repoId, id);
            try {
                await fs.promises.unlink(filePath);
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
                getServerLogger().warn(
                    { err, repoId, scheduleId: id, filePath },
                    '[ScheduleYamlPersistence] Failed to delete schedule YAML',
                );
                throw err;
            }
        });
    }

    /** Delete all YAML files in the schedules directory for a repo. */
    async deleteRepo(repoId: string): Promise<void> {
        await this.enqueueRepoWrite(repoId, () => this.deleteRepoFiles(repoId));
    }

    private async deleteRepoFiles(repoId: string): Promise<void> {
        const dir = getScheduleYamlDir(this.dataDir, repoId);

        let files: string[];
        try {
            files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.yaml'));
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
            getServerLogger().warn({ err, repoId, dir }, '[ScheduleYamlPersistence] Failed to scan schedule directory for deletion');
            throw err;
        }

        for (const file of files) {
            try {
                await fs.promises.unlink(path.join(dir, file));
            } catch (err) {
                getServerLogger().warn(
                    { err, repoId, file },
                    '[ScheduleYamlPersistence] Failed to delete schedule YAML during repo cleanup',
                );
                throw err;
            }
        }

        try {
            await fs.promises.rmdir(dir);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && (err as NodeJS.ErrnoException).code !== 'ENOTEMPTY') {
                getServerLogger().warn(
                    { err, repoId, dir },
                    '[ScheduleYamlPersistence] Failed to remove empty schedule directory',
                );
                throw err;
            }
        }
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
    async migrateAllFromJson(): Promise<void> {
        const reposRoot = path.join(this.dataDir, 'repos');

        let repoDirs: fs.Dirent[];
        try {
            repoDirs = await fs.promises.readdir(reposRoot, { withFileTypes: true });
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
            getServerLogger().warn({ err, reposRoot }, '[ScheduleYamlPersistence] Failed to scan repos for JSON schedule migration');
            return;
        }

        for (const dir of repoDirs.filter(d => d.isDirectory())) {
            const repoId = dir.name;
            const jsonPath = path.join(reposRoot, repoId, 'schedules.json');

            try {
                let raw: string;
                try {
                    raw = await fs.promises.readFile(jsonPath, 'utf-8');
                } catch (err) {
                    if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
                    throw err;
                }
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
                    getServerLogger().warn(
                        { repoId, version: state.version },
                        '[ScheduleYamlPersistence] Skipping schedule JSON migration with unknown version',
                    );
                    continue;
                }

                // Write each entry as YAML (idempotent — overwrite if already exists)
                for (const entry of entries) {
                    await this.saveSchedule(repoId, entry);
                }

                // Only remove JSON after all YAML files written successfully
                await fs.promises.unlink(jsonPath);
                getServerLogger().info(
                    { repoId, count: entries.length },
                    '[ScheduleYamlPersistence] Migrated schedules from JSON to YAML',
                );
            } catch (err) {
                // Non-fatal: leave schedules.json in place; next startup will retry
                getServerLogger().warn(
                    { err, repoId, message: getErrorMessage(err) },
                    '[ScheduleYamlPersistence] Schedule JSON migration failed',
                );
            }
        }
    }

    private enqueueRepoWrite<T>(repoId: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.repoWriteQueues.get(repoId) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        const queueTail = current.then(() => undefined, () => undefined);
        this.repoWriteQueues.set(repoId, queueTail);
        void queueTail.finally(() => {
            if (this.repoWriteQueues.get(repoId) === queueTail) {
                this.repoWriteQueues.delete(repoId);
            }
        });
        return current;
    }

    private async waitForRepoWrites(repoId: string): Promise<void> {
        await (this.repoWriteQueues.get(repoId) ?? Promise.resolve());
    }

    private async waitForAllWrites(): Promise<void> {
        await Promise.all([...this.repoWriteQueues.values()]);
    }
}

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
import { getRepoDataPath } from '@plusplusoneplusplus/coc-server';
import type { ScheduleEntry } from './schedule-manager';

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

                result.push(entry);
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
}

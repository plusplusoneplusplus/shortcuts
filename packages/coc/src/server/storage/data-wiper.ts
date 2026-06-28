/**
 * Data Wiper
 *
 * Wipes all runtime/persistent data (processes, workspaces, wikis, queues,
 * preferences) while preserving system configuration files.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WikiInfo } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';

// ============================================================================
// Types
// ============================================================================

export interface WipeOptions {
    /** Whether to delete generated wiki output directories on disk. */
    includeWikis: boolean;
    /** Dry-run mode: compute summary without actually deleting data. */
    dryRun?: boolean;
}

export interface WipeResult {
    deletedProcesses: number;
    deletedWorkspaces: number;
    deletedWikis: number;
    deletedQueues: number;
    deletedSchedules: number;
    deletedGitOps: number;
    deletedRepoPreferences: number;
    deletedPreferences: boolean;
    deletedWikiDirs: string[];
    preservedFiles: string[];
    errors: string[];
}

// ============================================================================
// DataWiper
// ============================================================================

export class DataWiper {
    constructor(
        private readonly dataDir: string,
        private readonly store: ProcessStore,
    ) {}

    /**
     * Get a dry-run summary of what would be deleted.
     */
    async getDryRunSummary(options: Pick<WipeOptions, 'includeWikis'> = { includeWikis: false }): Promise<WipeResult> {
        return this.doWipe({ ...options, dryRun: true });
    }

    /**
     * Wipe all runtime data. Returns a summary of what was deleted.
     */
    async wipeData(options: WipeOptions): Promise<WipeResult> {
        return this.doWipe(options);
    }

    private async doWipe(options: WipeOptions & { dryRun?: boolean }): Promise<WipeResult> {
        const { includeWikis, dryRun = false } = options;
        const result: WipeResult = {
            deletedProcesses: 0,
            deletedWorkspaces: 0,
            deletedWikis: 0,
            deletedQueues: 0,
            deletedSchedules: 0,
            deletedGitOps: 0,
            deletedRepoPreferences: 0,
            deletedPreferences: false,
            deletedWikiDirs: [],
            preservedFiles: [],
            errors: [],
        };

        // 1. Count processes
        const stats = await this.store.getStorageStats();
        result.deletedProcesses = stats.totalProcesses;
        result.deletedWorkspaces = (await this.store.getWorkspaces()).length;
        result.deletedWikis = stats.totalWikis;

        // 2. Collect wiki directories if requested
        let wikiDirs: string[] = [];
        if (includeWikis) {
            const wikis = await this.store.getWikis();
            wikiDirs = wikis
                .map((w: WikiInfo) => w.wikiDir)
                .filter((dir: string) => dir && typeof dir === 'string');
            result.deletedWikiDirs = [...wikiDirs];
        }

        // 3. Scan repos/ directory for per-repo files
        const reposDir = path.join(this.dataDir, 'repos');
        const repoDirs = this.listRepoDirs(reposDir);

        const scheduleFiles: string[] = [];
        const scheduleDirs: string[] = [];
        const gitOpsFiles: string[] = [];
        const repoPrefsFiles: string[] = [];

        for (const repoDir of repoDirs) {
            // Collect individual schedule YAML files
            const schedulesDir = path.join(repoDir, 'schedules');
            if (fs.existsSync(schedulesDir) && fs.statSync(schedulesDir).isDirectory()) {
                const yamlFiles = fs.readdirSync(schedulesDir)
                    .filter(f => f.endsWith('.yaml'))
                    .map(f => path.join(schedulesDir, f));
                scheduleFiles.push(...yamlFiles);
                // Track the directory itself for later rmdir
                scheduleDirs.push(schedulesDir);
            }
            const gf = path.join(repoDir, 'git-ops.json');
            if (fs.existsSync(gf)) { gitOpsFiles.push(gf); }
            const pf = path.join(repoDir, 'preferences.json');
            if (fs.existsSync(pf)) { repoPrefsFiles.push(pf); }
        }

        // Count queue rows from SQLite
        result.deletedQueues = this.countQueueRows();
        result.deletedSchedules = scheduleFiles.length + this.countScheduleRunRows();
        result.deletedGitOps = gitOpsFiles.length;
        result.deletedRepoPreferences = repoPrefsFiles.length;

        // 3b. Count blob files
        const blobsDir = path.join(this.dataDir, 'blobs');
        const blobFiles = this.listBlobFiles(blobsDir);

        // 4. Check preferences
        const prefsPath = path.join(this.dataDir, 'preferences.json');
        result.deletedPreferences = fs.existsSync(prefsPath) || repoPrefsFiles.length > 0;

        // 5. Record preserved files
        const configYaml = path.join(this.dataDir, 'config.yaml');
        if (fs.existsSync(configYaml)) {
            result.preservedFiles.push(configYaml);
        }
        const skillsDir = path.join(this.dataDir, 'skills');
        if (fs.existsSync(skillsDir)) {
            result.preservedFiles.push(skillsDir);
        }

        if (dryRun) {
            return result;
        }

        // === Execute wipe ===

        // Clear processes
        try {
            await this.store.clearProcesses();
        } catch (err: any) {
            result.errors.push(`Failed to clear processes: ${err.message}`);
        }

        // Clear workspaces
        try {
            await this.store.clearAllWorkspaces();
        } catch (err: any) {
            result.errors.push(`Failed to clear workspaces: ${err.message}`);
        }

        // Clear wikis
        try {
            await this.store.clearAllWikis();
        } catch (err: any) {
            result.errors.push(`Failed to clear wikis: ${err.message}`);
        }

        // Clear queue rows from SQLite
        try {
            this.deleteQueueRows();
        } catch (err: any) {
            result.errors.push(`Failed to clear queue tables: ${err.message}`);
        }

        // Clear schedule run rows from SQLite
        try {
            this.deleteScheduleRunRows();
        } catch (err: any) {
            result.errors.push(`Failed to clear schedule_runs table: ${err.message}`);
        }

        // Delete per-repo files
        const allRepoFiles = [...scheduleFiles, ...gitOpsFiles, ...repoPrefsFiles];
        for (const filePath of allRepoFiles) {
            try {
                fs.unlinkSync(filePath);
            } catch (err: any) {
                result.errors.push(`Failed to delete ${filePath}: ${err.message}`);
            }
        }

        // Delete blob files
        for (const filePath of blobFiles) {
            try {
                fs.unlinkSync(filePath);
            } catch (err: any) {
                result.errors.push(`Failed to delete blob file ${filePath}: ${err.message}`);
            }
        }

        // Delete global preferences
        if (fs.existsSync(prefsPath)) {
            try {
                fs.unlinkSync(prefsPath);
            } catch (err: any) {
                result.errors.push(`Failed to delete preferences: ${err.message}`);
            }
        }

        // Remove now-empty schedules/ directories
        for (const dir of scheduleDirs) {
            try {
                if (fs.existsSync(dir)) {
                    fs.rmSync(dir, { recursive: true, force: true });
                }
            } catch (err: any) {
                result.errors.push(`Failed to delete schedules dir ${dir}: ${err.message}`);
            }
        }

        // Delete wiki directories if requested
        if (includeWikis) {
            for (const dir of wikiDirs) {
                try {
                    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
                        fs.rmSync(dir, { recursive: true, force: true });
                    }
                } catch (err: any) {
                    result.errors.push(`Failed to delete wiki directory ${dir}: ${err.message}`);
                }
            }
        }

        return result;
    }

    private listRepoDirs(reposDir: string): string[] {
        if (!fs.existsSync(reposDir) || !fs.statSync(reposDir).isDirectory()) {
            return [];
        }
        return fs.readdirSync(reposDir)
            .map(name => path.join(reposDir, name))
            .filter(p => fs.statSync(p).isDirectory());
    }

    private listBlobFiles(blobsDir: string): string[] {
        try {
            if (!fs.existsSync(blobsDir) || !fs.statSync(blobsDir).isDirectory()) {
                return [];
            }
            return fs.readdirSync(blobsDir)
                .filter(f => f.endsWith('.images.json'))
                .map(f => path.join(blobsDir, f));
        } catch {
            return [];
        }
    }

    /**
     * Count queue-related rows in SQLite. Returns 0 if the store is not SQLite
     * or the tables don't exist.
     */
    private countQueueRows(): number {
        if (!(this.store instanceof SqliteProcessStore)) return 0;
        const db = this.store.getDatabase();
        try {
            const taskCount = (db.prepare('SELECT COUNT(*) as cnt FROM queue_tasks').get() as { cnt: number }).cnt;
            const stateCount = (db.prepare('SELECT COUNT(*) as cnt FROM queue_repo_state').get() as { cnt: number }).cnt;
            return taskCount + stateCount;
        } catch {
            return 0;
        }
    }

    /**
     * Delete all queue-related rows from SQLite tables.
     */
    private deleteQueueRows(): void {
        if (!(this.store instanceof SqliteProcessStore)) return;
        const db = this.store.getDatabase();
        // queue_tasks and queue_repo_state are created by SqliteProcessStore.initializeDatabase().
        db.prepare('DELETE FROM queue_tasks').run();
        db.prepare('DELETE FROM queue_repo_state').run();
        // queue_repo_paths is created lazily by SqliteQueuePersistence — may not exist yet.
        try {
            db.prepare('DELETE FROM queue_repo_paths').run();
        } catch {
            // Table doesn't exist yet — nothing to clean.
        }
    }

    /**
     * Count schedule run rows in SQLite. Returns 0 if the store is not SQLite
     * or the table doesn't exist.
     */
    private countScheduleRunRows(): number {
        if (!(this.store instanceof SqliteProcessStore)) return 0;
        const db = this.store.getDatabase();
        try {
            return (db.prepare('SELECT COUNT(*) as cnt FROM schedule_runs').get() as { cnt: number }).cnt;
        } catch {
            return 0;
        }
    }

    /**
     * Delete all schedule run rows from SQLite.
     */
    private deleteScheduleRunRows(): void {
        if (!(this.store instanceof SqliteProcessStore)) return;
        const db = this.store.getDatabase();
        try {
            db.prepare('DELETE FROM schedule_runs').run();
        } catch {
            // Table doesn't exist yet — nothing to clean.
        }
    }

}

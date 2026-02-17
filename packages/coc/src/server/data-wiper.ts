/**
 * Data Wiper
 *
 * Wipes all runtime/persistent data (processes, workspaces, wikis, queues,
 * preferences) while preserving system configuration files.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, WikiInfo } from '@plusplusoneplusplus/pipeline-core';

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
            deletedPreferences: false,
            deletedWikiDirs: [],
            preservedFiles: [],
            errors: [],
        };

        // 1. Count processes
        const stats = await this.store.getStorageStats();
        result.deletedProcesses = stats.totalProcesses;
        result.deletedWorkspaces = stats.totalWorkspaces;
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

        // 3. Count queue files
        const queuesDir = path.join(this.dataDir, 'queues');
        const queueFiles = this.listQueueFiles(queuesDir);
        result.deletedQueues = queueFiles.length;

        // 4. Check preferences
        const prefsPath = path.join(this.dataDir, 'preferences.json');
        result.deletedPreferences = fs.existsSync(prefsPath);

        // 5. Record preserved files
        const configYaml = path.join(this.dataDir, 'config.yaml');
        if (fs.existsSync(configYaml)) {
            result.preservedFiles.push(configYaml);
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

        // Delete queue files
        for (const filePath of queueFiles) {
            try {
                fs.unlinkSync(filePath);
            } catch (err: any) {
                result.errors.push(`Failed to delete queue file ${filePath}: ${err.message}`);
            }
        }

        // Delete preferences
        if (result.deletedPreferences) {
            try {
                fs.unlinkSync(prefsPath);
            } catch (err: any) {
                result.errors.push(`Failed to delete preferences: ${err.message}`);
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

    private listQueueFiles(queuesDir: string): string[] {
        try {
            if (!fs.existsSync(queuesDir) || !fs.statSync(queuesDir).isDirectory()) {
                return [];
            }
            return fs.readdirSync(queuesDir)
                .filter(f => f.startsWith('repo-') && f.endsWith('.json'))
                .map(f => path.join(queuesDir, f));
        } catch {
            return [];
        }
    }
}

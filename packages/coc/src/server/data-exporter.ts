/**
 * Data Exporter
 *
 * Collects all CoC data (processes, workspaces, wikis, queue history,
 * preferences, server config) and produces a CoCExportPayload JSON object.
 *
 * No VS Code dependencies — uses only Node.js built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type {
    CoCExportPayload,
    ExportOptions,
    QueueSnapshot,
} from '@plusplusoneplusplus/coc-server';
import { EXPORT_SCHEMA_VERSION } from '@plusplusoneplusplus/coc-server';
import { readPreferences } from './preferences-handler';
import { loadConfigFile } from '../config';

// ============================================================================
// Public API
// ============================================================================

/**
 * Export all CoC data into a single {@link CoCExportPayload}.
 *
 * Reads from the process store, queue files on disk, preferences, and
 * server configuration. Corrupt queue files are skipped gracefully.
 */
export async function exportAllData(options: ExportOptions): Promise<CoCExportPayload> {
    const { store, dataDir, serverVersion } = options;

    // Gather data from store
    const [processes, workspaces, wikis] = await Promise.all([
        store.getAllProcesses(),
        store.getWorkspaces(),
        store.getWikis(),
    ]);

    // Gather queue history from disk
    const queueHistory = readQueueFiles(dataDir);

    // Gather preferences
    const preferences = readPreferences(dataDir);

    // Gather server config (optional)
    const configPath = path.join(dataDir, 'config.yaml');
    const serverConfig = fs.existsSync(configPath)
        ? loadConfigFile(configPath)
        : undefined;

    const payload: CoCExportPayload = {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        serverVersion,
        metadata: {
            processCount: processes.length,
            workspaceCount: workspaces.length,
            wikiCount: wikis.length,
            queueFileCount: queueHistory.length,
        },
        processes,
        workspaces,
        wikis,
        queueHistory,
        preferences,
        serverConfig,
    };

    return payload;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Read all per-repo queue JSON files from `dataDir/queues/`.
 * Corrupt or unparseable files are silently skipped.
 */
function readQueueFiles(dataDir: string): QueueSnapshot[] {
    const queuesDir = path.join(dataDir, 'queues');
    if (!fs.existsSync(queuesDir) || !fs.statSync(queuesDir).isDirectory()) {
        return [];
    }

    const files = fs.readdirSync(queuesDir)
        .filter(f => f.startsWith('repo-') && f.endsWith('.json'));

    const snapshots: QueueSnapshot[] = [];

    for (const file of files) {
        const filePath = path.join(queuesDir, file);
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);

            snapshots.push({
                repoRootPath: parsed.repoRootPath ?? '',
                repoId: parsed.repoId ?? '',
                pending: Array.isArray(parsed.pending) ? parsed.pending : [],
                history: Array.isArray(parsed.history) ? parsed.history : [],
                isPaused: parsed.isPaused === true ? true : undefined,
            });
        } catch {
            // Skip corrupt files
        }
    }

    return snapshots;
}

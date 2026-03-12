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
import type {
    CoCExportPayload,
    ExportOptions,
    ImageBlobEntry,
    QueueSnapshot,
} from './export-import-types';
import { EXPORT_SCHEMA_VERSION } from './export-import-types';
import { PREFERENCES_FILE_NAME } from './preferences-handler';

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
    const { store, dataDir, serverVersion, loadConfigFile } = options;

    // Gather data from store
    const [processes, workspaces, wikis] = await Promise.all([
        store.getAllProcesses(),
        store.getWorkspaces(),
        store.getWikis(),
    ]);

    // Gather queue history from disk
    const queueHistory = readQueueFiles(dataDir);

    // Gather image blobs from disk
    const imageBlobs = readBlobFiles(dataDir);

    // Gather preferences (raw JSON to preserve all fields regardless of schema)
    const prefFile = path.join(dataDir, PREFERENCES_FILE_NAME);
    const preferences = fs.existsSync(prefFile)
        ? JSON.parse(fs.readFileSync(prefFile, 'utf-8'))
        : {};

    // Gather server config (optional, injected from CLI layer)
    const configPath = path.join(dataDir, 'config.yaml');
    const serverConfig = loadConfigFile && fs.existsSync(configPath)
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
            blobFileCount: imageBlobs.length,
        },
        processes,
        workspaces,
        wikis,
        queueHistory,
        preferences,
        serverConfig,
        imageBlobs,
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

/**
 * Read all image blob files from `dataDir/blobs/`.
 * Corrupt or unparseable files are silently skipped.
 */
function readBlobFiles(dataDir: string): ImageBlobEntry[] {
    const blobsDir = path.join(dataDir, 'blobs');
    if (!fs.existsSync(blobsDir) || !fs.statSync(blobsDir).isDirectory()) {
        return [];
    }

    const files = fs.readdirSync(blobsDir)
        .filter(f => f.endsWith('.images.json'));

    const entries: ImageBlobEntry[] = [];

    for (const file of files) {
        const filePath = path.join(blobsDir, file);
        try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            const taskId = file.replace(/\.images\.json$/, '');
            entries.push({
                taskId,
                images: Array.isArray(parsed) ? parsed : [],
            });
        } catch {
            // Skip corrupt files
        }
    }

    return entries;
}

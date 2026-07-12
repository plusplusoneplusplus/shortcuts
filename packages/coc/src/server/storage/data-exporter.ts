/**
 * Data Exporter
 *
 * Collects all CoC data (processes, workspaces, wikis, queue history,
 * preferences, server config) and produces a CoCExportPayload JSON object.
 *
 * Pure Node.js; uses only built-in modules.
 * Cross-platform compatible (Linux/Mac/Windows).
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
    CoCExportPayload,
    ExportOptions,
} from './export-import-types';
import { EXPORT_SCHEMA_VERSION } from './export-import-types';
import { collectStorageSnapshot } from './storage-snapshot-domains';

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
    const snapshot = await collectStorageSnapshot({ store, dataDir });

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
            ...snapshot.metadata,
            ...(snapshot.warnings.length > 0 ? { warnings: snapshot.warnings } : {}),
        },
        processes: snapshot.processes,
        workspaces: snapshot.workspaces,
        wikis: snapshot.wikis,
        queueHistory: snapshot.queueHistory,
        preferences: snapshot.preferences,
        serverConfig,
        imageBlobs: snapshot.imageBlobs,
        repoPreferences: snapshot.repoPreferences,
        scheduleHistory: snapshot.scheduleHistory,
    };

    return payload;
}

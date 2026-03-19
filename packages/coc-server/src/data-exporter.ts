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
    RepoPreferencesSnapshot,
    ScheduleSnapshot,
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

    // Gather per-repo preferences
    const repoPreferences = readRepoPrefsFiles(dataDir);

    // Gather schedule data
    const scheduleHistory = readScheduleFiles(dataDir);

    // Gather global preferences (raw JSON to preserve all fields regardless of schema)
    const prefFile = path.join(dataDir, PREFERENCES_FILE_NAME);
    const globalPrefs = fs.existsSync(prefFile)
        ? JSON.parse(fs.readFileSync(prefFile, 'utf-8'))
        : {};

    const preferences = {
        ...(globalPrefs.global !== undefined ? { global: globalPrefs.global } : {}),
    };

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
            repoPreferenceCount: repoPreferences.length,
            scheduleFileCount: scheduleHistory.length,
        },
        processes,
        workspaces,
        wikis,
        queueHistory,
        preferences,
        serverConfig,
        imageBlobs,
        repoPreferences,
        scheduleHistory,
    };

    return payload;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Read all per-repo queue JSON files from `dataDir/repos/` subdirectories.
 * Corrupt or unparseable files are silently skipped.
 */
function readQueueFiles(dataDir: string): QueueSnapshot[] {
    const reposDir = path.join(dataDir, 'repos');
    const repoDirs = listRepoDirs(reposDir);
    const snapshots: QueueSnapshot[] = [];

    for (const repoDir of repoDirs) {
        const filePath = path.join(repoDir, 'queues.json');
        try {
            if (!fs.existsSync(filePath)) { continue; }
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
 * Read per-repo preferences from `dataDir/repos/` subdirectories.
 * Corrupt or missing files are silently skipped.
 */
function readRepoPrefsFiles(dataDir: string): RepoPreferencesSnapshot[] {
    const reposDir = path.join(dataDir, 'repos');
    const repoDirs = listRepoDirs(reposDir);
    const snapshots: RepoPreferencesSnapshot[] = [];

    for (const repoDir of repoDirs) {
        const filePath = path.join(repoDir, 'preferences.json');
        try {
            if (!fs.existsSync(filePath)) { continue; }
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            const repoId = path.basename(repoDir);

            // Try to extract repoRootPath from sibling queues.json
            let repoRootPath = '';
            const queueFile = path.join(repoDir, 'queues.json');
            try {
                if (fs.existsSync(queueFile)) {
                    const q = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
                    repoRootPath = q.repoRootPath ?? '';
                }
            } catch { /* ignore */ }

            snapshots.push({
                repoId,
                repoRootPath,
                preferences: typeof parsed === 'object' && parsed !== null ? parsed : {},
            });
        } catch {
            // Skip corrupt files
        }
    }

    return snapshots;
}

/**
 * Read per-repo schedule data from `dataDir/repos/` subdirectories.
 * Each repo may have `schedules.json` and/or `schedule-runs.json`.
 * Corrupt or missing files are silently skipped.
 */
function readScheduleFiles(dataDir: string): ScheduleSnapshot[] {
    const reposDir = path.join(dataDir, 'repos');
    const repoDirs = listRepoDirs(reposDir);
    const snapshots: ScheduleSnapshot[] = [];

    for (const repoDir of repoDirs) {
        const schedulesPath = path.join(repoDir, 'schedules.json');
        const runsPath = path.join(repoDir, 'schedule-runs.json');

        const hasSchedules = fs.existsSync(schedulesPath);
        const hasRuns = fs.existsSync(runsPath);
        if (!hasSchedules && !hasRuns) { continue; }

        const repoId = path.basename(repoDir);

        // Try to extract repoRootPath from sibling queues.json
        let repoRootPath = '';
        const queueFile = path.join(repoDir, 'queues.json');
        try {
            if (fs.existsSync(queueFile)) {
                const q = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
                repoRootPath = q.repoRootPath ?? '';
            }
        } catch { /* ignore */ }

        let schedules: unknown[] = [];
        let scheduleRuns: unknown[] = [];

        if (hasSchedules) {
            try {
                const raw = JSON.parse(fs.readFileSync(schedulesPath, 'utf-8'));
                schedules = Array.isArray(raw) ? raw : [];
            } catch { /* skip corrupt */ }
        }
        if (hasRuns) {
            try {
                const raw = JSON.parse(fs.readFileSync(runsPath, 'utf-8'));
                scheduleRuns = Array.isArray(raw) ? raw : [];
            } catch { /* skip corrupt */ }
        }

        snapshots.push({ repoId, repoRootPath, schedules, scheduleRuns });
    }

    return snapshots;
}

/**
 * List subdirectories under the given repos dir.
 */
function listRepoDirs(reposDir: string): string[] {
    if (!fs.existsSync(reposDir) || !fs.statSync(reposDir).isDirectory()) {
        return [];
    }
    return fs.readdirSync(reposDir)
        .map(name => path.join(reposDir, name))
        .filter(p => {
            try { return fs.statSync(p).isDirectory(); } catch { return false; }
        });
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

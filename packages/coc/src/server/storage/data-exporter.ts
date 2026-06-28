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
import * as yaml from 'js-yaml';
import type {
    CoCExportPayload,
    ExportOptions,
    ImageBlobEntry,
    QueueSnapshot,
    RepoPreferencesSnapshot,
    ScheduleSnapshot,
} from './export-import-types';
import { EXPORT_SCHEMA_VERSION } from './export-import-types';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
// TODO(coc-merge): redirect to ./preferences-handler once fully migrated
import { PREFERENCES_FILE_NAME } from '../preferences-handler';

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
    const scheduleHistory = readScheduleFiles(dataDir, store);

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
 * Read per-repo schedule data from `dataDir/repos/<id>/schedules/*.yaml`.
 * Schedule runs are read from the `schedule_runs` SQLite table.
 * Corrupt or missing files are silently skipped.
 */
function readScheduleFiles(dataDir: string, store: ProcessStore): ScheduleSnapshot[] {
    const reposDir = path.join(dataDir, 'repos');
    const repoDirs = listRepoDirs(reposDir);

    // Load schedule runs from SQLite, grouped by repo_id
    const runsByRepo = new Map<string, unknown[]>();
    if (store instanceof SqliteProcessStore) {
        try {
            const db = store.getDatabase();
            const rows = db.prepare('SELECT * FROM schedule_runs ORDER BY started_at DESC').all() as any[];
            for (const row of rows) {
                const repoId = row.repo_id;
                if (!runsByRepo.has(repoId)) {
                    runsByRepo.set(repoId, []);
                }
                runsByRepo.get(repoId)!.push({
                    id: row.id,
                    scheduleId: row.schedule_id,
                    repoId: row.repo_id,
                    startedAt: row.started_at,
                    completedAt: row.completed_at ?? undefined,
                    status: row.status,
                    error: row.error ?? undefined,
                    durationMs: row.duration_ms ?? undefined,
                    processId: row.process_id ?? undefined,
                    taskId: row.task_id ?? undefined,
                });
            }
        } catch { /* table may not exist yet */ }
    }

    const snapshots: ScheduleSnapshot[] = [];

    // Collect all repo IDs from both disk and SQLite
    const allRepoIds = new Set<string>();
    for (const repoDir of repoDirs) {
        allRepoIds.add(path.basename(repoDir));
    }
    for (const repoId of runsByRepo.keys()) {
        allRepoIds.add(repoId);
    }

    for (const repoId of allRepoIds) {
        const repoDir = path.join(reposDir, repoId);
        const schedulesDir = path.join(repoDir, 'schedules');

        const hasSchedulesDir =
            fs.existsSync(schedulesDir) && fs.statSync(schedulesDir).isDirectory();
        const scheduleRuns = runsByRepo.get(repoId) ?? [];
        if (!hasSchedulesDir && scheduleRuns.length === 0) { continue; }

        // Try to extract repoRootPath from sibling queues.json (unchanged)
        let repoRootPath = '';
        const queueFile = path.join(repoDir, 'queues.json');
        try {
            if (fs.existsSync(queueFile)) {
                const q = JSON.parse(fs.readFileSync(queueFile, 'utf-8'));
                repoRootPath = q.repoRootPath ?? '';
            }
        } catch { /* ignore */ }

        // Read schedule YAML files
        const schedules: unknown[] = [];
        if (hasSchedulesDir) {
            const yamlFiles = fs.readdirSync(schedulesDir)
                .filter(f => f.endsWith('.yaml'))
                .sort(); // deterministic order
            for (const file of yamlFiles) {
                try {
                    const raw = fs.readFileSync(path.join(schedulesDir, file), 'utf-8');
                    const parsed = yaml.load(raw);
                    if (parsed && typeof parsed === 'object') {
                        schedules.push(parsed);
                    }
                } catch { /* skip corrupt */ }
            }
        }

        // Only add snapshot if there is any data
        if (schedules.length > 0 || scheduleRuns.length > 0) {
            snapshots.push({ repoId, repoRootPath, schedules, scheduleRuns });
        }
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

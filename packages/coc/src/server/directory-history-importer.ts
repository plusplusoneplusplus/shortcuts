/**
 * Directory History Importer
 *
 * Reads file-based process history from a repos/ directory and imports
 * it into an existing SQLite database. Additive import — does not delete
 * source files or require a server restart.
 *
 * Reuses serialization helpers from storage-migration.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
    Database,
    getLogger,
} from '@plusplusoneplusplus/forge';
import type {
    ProcessIndexEntry,
    StoredProcessEntry,
    WorkspaceInfo,
} from '@plusplusoneplusplus/forge';
import {
    readJsonFile,
    serializeProcessToRow,
    serializeTurnToRow,
} from './storage-migration.js';

const logger = getLogger();

// ============================================================================
// Types
// ============================================================================

export interface ScannedWorkspace {
    workspaceId: string;
    activeCount: number;
    archivedCount: number;
    archivedBuckets: string[];
}

export interface ScanResult {
    reposDir: string;
    workspaces: ScannedWorkspace[];
}

export interface MatchedWorkspace extends ScannedWorkspace {
    registeredName: string;
    registeredRootPath: string;
}

export interface MatchResult {
    matched: MatchedWorkspace[];
    unmatched: ScannedWorkspace[];
    totalProcesses: number;
    totalMatchedProcesses: number;
}

export interface ImportProgress {
    phase: 'scanning' | 'matching' | 'importing' | 'done';
    message: string;
    progress?: { current: number; total: number };
    summary?: ImportSummary;
}

export interface WorkspaceImportDetail {
    workspaceId: string;
    name: string;
    imported: number;
    skipped: number;
}

export interface ImportSummary {
    imported: number;
    skipped: number;
    failed: number;
    perWorkspace: WorkspaceImportDetail[];
}

// ============================================================================
// DirectoryHistoryImporter
// ============================================================================

export class DirectoryHistoryImporter {
    /**
     * Scan a directory for workspace process history.
     * Accepts either a repos/ directory directly or a parent that contains repos/.
     */
    scan(dirPath: string): ScanResult {
        const resolved = path.resolve(dirPath);

        if (!fs.existsSync(resolved)) {
            throw new Error(`Directory does not exist: ${resolved}`);
        }

        const stat = fs.statSync(resolved);
        if (!stat.isDirectory()) {
            throw new Error(`Path is not a directory: ${resolved}`);
        }

        // Auto-detect: if the given path has a repos/ subdirectory, use that
        let reposDir = resolved;
        const reposSubDir = path.join(resolved, 'repos');
        if (fs.existsSync(reposSubDir) && fs.statSync(reposSubDir).isDirectory()) {
            reposDir = reposSubDir;
        }

        const workspaces: ScannedWorkspace[] = [];

        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(reposDir, { withFileTypes: true });
        } catch {
            throw new Error(`Cannot read directory: ${reposDir}`);
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const wsId = entry.name;
            const processesDir = path.join(reposDir, wsId, 'processes');
            if (!fs.existsSync(processesDir)) continue;

            let activeCount = 0;
            const indexPath = path.join(processesDir, 'index.json');
            const index = readJsonFile<ProcessIndexEntry[]>(indexPath);
            if (index && Array.isArray(index)) {
                for (const e of index) {
                    const filePath = path.join(processesDir, `${e.id}.json`);
                    const stored = readJsonFile<StoredProcessEntry>(filePath);
                    if (stored?.process) activeCount++;
                }
            }

            let archivedCount = 0;
            const archivedBuckets: string[] = [];
            const prunedRoot = path.join(processesDir, 'pruned');
            if (fs.existsSync(prunedRoot)) {
                const buckets = fs.readdirSync(prunedRoot, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name);

                for (const bucket of buckets) {
                    const bucketDir = path.join(prunedRoot, bucket);
                    const bucketIndex = readJsonFile<ProcessIndexEntry[]>(path.join(bucketDir, 'index.json'));
                    if (bucketIndex && Array.isArray(bucketIndex)) {
                        let bucketCount = 0;
                        for (const e of bucketIndex) {
                            const filePath = path.join(bucketDir, `${e.id}.json`);
                            const stored = readJsonFile<StoredProcessEntry>(filePath);
                            if (stored?.process) bucketCount++;
                        }
                        if (bucketCount > 0) {
                            archivedBuckets.push(bucket);
                            archivedCount += bucketCount;
                        }
                    }
                }
            }

            if (activeCount > 0 || archivedCount > 0) {
                workspaces.push({ workspaceId: wsId, activeCount, archivedCount, archivedBuckets });
            }
        }

        return { reposDir, workspaces };
    }

    /**
     * Match scanned workspaces against registered workspaces in the store.
     */
    matchWorkspaces(scanResult: ScanResult, registeredWorkspaces: WorkspaceInfo[]): MatchResult {
        const wsMap = new Map(registeredWorkspaces.map(ws => [ws.id, ws]));

        const matched: MatchedWorkspace[] = [];
        const unmatched: ScannedWorkspace[] = [];

        for (const scanned of scanResult.workspaces) {
            const registered = wsMap.get(scanned.workspaceId);
            if (registered) {
                matched.push({
                    ...scanned,
                    registeredName: registered.name,
                    registeredRootPath: registered.rootPath,
                });
            } else {
                unmatched.push(scanned);
            }
        }

        const totalProcesses = scanResult.workspaces.reduce(
            (sum, ws) => sum + ws.activeCount + ws.archivedCount, 0
        );
        const totalMatchedProcesses = matched.reduce(
            (sum, ws) => sum + ws.activeCount + ws.archivedCount, 0
        );

        return { matched, unmatched, totalProcesses, totalMatchedProcesses };
    }

    /**
     * Import processes from matched workspaces into an existing SQLite database.
     * Uses INSERT OR IGNORE to skip duplicate process IDs.
     */
    importProcesses(
        matchResult: MatchResult,
        reposDir: string,
        dbPath: string,
        onProgress?: (event: ImportProgress) => void,
    ): ImportSummary {
        const db = new Database(dbPath);
        const emit = (event: ImportProgress) => {
            try { onProgress?.(event); } catch { /* never let callback errors break import */ }
        };

        try {
            const insertProcess = db.prepare(`
                INSERT OR IGNORE INTO processes (
                    id, workspace_id, type, prompt_preview, full_prompt, status,
                    start_time, end_time, error, result, result_file_path,
                    raw_stdout_file_path, metadata, group_metadata, structured_result,
                    parent_process_id, sdk_session_id, backend, working_directory,
                    title, token_limit, current_tokens, cumulative_token_usage,
                    stale, data_file_path, archived
                ) VALUES (
                    @id, @workspace_id, @type, @prompt_preview, @full_prompt, @status,
                    @start_time, @end_time, @error, @result, @result_file_path,
                    @raw_stdout_file_path, @metadata, @group_metadata, @structured_result,
                    @parent_process_id, @sdk_session_id, @backend, @working_directory,
                    @title, @token_limit, @current_tokens, @cumulative_token_usage,
                    @stale, @data_file_path, @archived
                )
            `);

            const insertTurn = db.prepare(`
                INSERT OR IGNORE INTO conversation_turns (
                    process_id, turn_index, role, content, timestamp, streaming,
                    tool_calls, timeline, images, historical, suggestions,
                    token_usage, paste_externalized
                ) VALUES (
                    @process_id, @turn_index, @role, @content, @timestamp, @streaming,
                    @tool_calls, @timeline, @images, @historical, @suggestions,
                    @token_usage, @paste_externalized
                )
            `);

            const perWorkspace: WorkspaceImportDetail[] = [];
            let totalImported = 0;
            let totalSkipped = 0;
            let totalFailed = 0;

            for (let i = 0; i < matchResult.matched.length; i++) {
                const ws = matchResult.matched[i];
                emit({
                    phase: 'importing',
                    message: `Importing workspace: ${ws.registeredName}`,
                    progress: { current: i + 1, total: matchResult.matched.length },
                });

                let wsImported = 0;
                let wsSkipped = 0;

                const wsTransaction = db.transaction(() => {
                    const processesDir = path.join(reposDir, ws.workspaceId, 'processes');

                    // Active processes
                    const activeResult = this.importWorkspaceProcesses(
                        processesDir, ws.workspaceId, insertProcess, insertTurn, false
                    );
                    wsImported += activeResult.imported;
                    wsSkipped += activeResult.skipped;
                    totalFailed += activeResult.failed;

                    // Archived processes
                    const prunedRoot = path.join(processesDir, 'pruned');
                    if (fs.existsSync(prunedRoot)) {
                        for (const bucket of ws.archivedBuckets) {
                            const bucketDir = path.join(prunedRoot, bucket);
                            const archivedResult = this.importWorkspaceProcesses(
                                bucketDir, ws.workspaceId, insertProcess, insertTurn, true
                            );
                            wsImported += archivedResult.imported;
                            wsSkipped += archivedResult.skipped;
                            totalFailed += archivedResult.failed;
                        }
                    }
                });

                wsTransaction();

                totalImported += wsImported;
                totalSkipped += wsSkipped;

                perWorkspace.push({
                    workspaceId: ws.workspaceId,
                    name: ws.registeredName,
                    imported: wsImported,
                    skipped: wsSkipped,
                });
            }

            const summary: ImportSummary = { imported: totalImported, skipped: totalSkipped, failed: totalFailed, perWorkspace };
            emit({ phase: 'done', message: 'Import complete', summary });
            return summary;
        } finally {
            try { db.close(); } catch { /* ignore */ }
        }
    }

    private importWorkspaceProcesses(
        dir: string,
        workspaceId: string,
        insertProcess: { run: (params: Record<string, unknown>) => Database.RunResult },
        insertTurn: { run: (params: Record<string, unknown>) => Database.RunResult },
        archived: boolean
    ): { imported: number; skipped: number; failed: number } {
        const indexPath = path.join(dir, 'index.json');
        const index = readJsonFile<ProcessIndexEntry[]>(indexPath);
        if (!index || !Array.isArray(index)) return { imported: 0, skipped: 0, failed: 0 };

        let imported = 0;
        let skipped = 0;
        let failed = 0;

        for (const entry of index) {
            const processFilePath = path.join(dir, `${entry.id}.json`);
            const stored = readJsonFile<StoredProcessEntry>(processFilePath);
            if (!stored?.process) {
                logger.warn('directory-import', `Skipping unreadable process file: ${processFilePath}`);
                failed++;
                continue;
            }

            const proc = stored.process;

            try {
                const result = insertProcess.run(serializeProcessToRow(proc, workspaceId, archived));
                if (result.changes === 0) {
                    skipped++;
                    continue;
                }

                const turns = proc.conversationTurns ?? [];
                for (const turn of turns) {
                    insertTurn.run(serializeTurnToRow(turn, proc.id));
                }
                imported++;
            } catch (err) {
                logger.warn('directory-import', `Skipping corrupt process ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
                failed++;
            }
        }

        return { imported, skipped, failed };
    }
}

/**
 * Startup Process History Migration
 *
 * Automatically migrates file-based process histories from
 * ~/.coc/repos/<workspaceId>/processes/ into the SQLite process store
 * on server startup. Complements startup-workspace-migration.ts which
 * handles workspace/wiki registry entries.
 *
 * The migration is:
 * - Idempotent (INSERT OR IGNORE — already-imported processes are skipped)
 * - Non-destructive (renames processes/ to processes.migrated/, not deleted)
 * - A no-op for file-based backends or fresh installs (no repos/ directory)
 * - Transaction-per-workspace for performance and atomicity
 * - Graceful on errors (logs and continues to next workspace)
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ProcessStore, ProcessIndexEntry, StoredProcessEntry } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import {
    readJsonFile,
    serializeProcessToRow,
    serializeTurnToRow,
} from './storage-migration.js';

const PREFIX = '[ProcessMigration]';

/**
 * Build a mapping from processId → workItemId by scanning work-item JSON files
 * in the workspace's work-items directory. Each work item's executionHistory
 * entries contain taskId/processId that link back to process records.
 */
function buildWorkItemProcessMap(dataDir: string, workspaceId: string): Map<string, string> {
    const map = new Map<string, string>();
    const wiDir = path.join(dataDir, 'repos', workspaceId, 'work-items');
    if (!fs.existsSync(wiDir)) return map;

    let files: string[];
    try {
        files = fs.readdirSync(wiDir).filter(f => f.endsWith('.json'));
    } catch {
        return map;
    }

    for (const file of files) {
        try {
            const raw = fs.readFileSync(path.join(wiDir, file), 'utf-8');
            const wi = JSON.parse(raw);
            if (!wi?.id || !Array.isArray(wi.executionHistory)) continue;
            for (const exec of wi.executionHistory) {
                if (exec.processId) map.set(exec.processId, wi.id);
            }
        } catch { /* skip unreadable files */ }
    }

    return map;
}

export interface ProcessMigrationResult {
    migrated: boolean;
    workspaceCount: number;
    processCount: number;
    turnCount: number;
    errors: string[];
}

/**
 * Import processes from a single directory (active or pruned bucket)
 * into SQLite using prepared INSERT OR IGNORE statements.
 */
function importProcessesFromDir(
    dir: string,
    workspaceId: string,
    insertProcess: { run: (params: Record<string, unknown>) => { changes: number } },
    insertTurn: { run: (params: Record<string, unknown>) => { changes: number } },
    archived: boolean,
    workItemMap?: Map<string, string>,
): { imported: number; turns: number; errors: string[] } {
    const indexPath = path.join(dir, 'index.json');
    const index = readJsonFile<ProcessIndexEntry[]>(indexPath);
    if (!index || !Array.isArray(index)) return { imported: 0, turns: 0, errors: [] };

    let imported = 0;
    let turns = 0;
    const errors: string[] = [];

    for (const entry of index) {
        const processFilePath = path.join(dir, `${entry.id}.json`);
        const stored = readJsonFile<StoredProcessEntry>(processFilePath);
        if (!stored?.process) {
            errors.push(`Unreadable process file: ${entry.id}`);
            continue;
        }

        try {
            // Enrich work-item processes: set correct type and inject workItemId into metadata
            const workItemId = workItemMap?.get(stored.process.id);
            if (workItemId) {
                stored.process.type = 'run-workflow';
                if (!stored.process.metadata) {
                    stored.process.metadata = { type: 'run-workflow' };
                }
                (stored.process.metadata as Record<string, unknown>).workItemId = workItemId;
            }

            const result = insertProcess.run(serializeProcessToRow(stored.process, workspaceId, archived));
            if (result.changes === 0) {
                // Already exists — skip (INSERT OR IGNORE)
                continue;
            }

            const processTurns = stored.process.conversationTurns ?? [];
            for (const turn of processTurns) {
                insertTurn.run(serializeTurnToRow(turn, stored.process.id));
            }
            imported++;
            turns += processTurns.length;
        } catch (err) {
            errors.push(`Failed to import process ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return { imported, turns, errors };
}

/**
 * Detect and migrate file-based process histories into the SQLite
 * process store. Safe to call on every startup.
 *
 * Must be called AFTER migrateWorkspaceRegistryIfNeeded() so that
 * workspaces are already registered. Any workspace directory not
 * yet registered will be auto-registered with a minimal entry.
 */
export async function migrateProcessHistoryIfNeeded(
    dataDir: string,
    store: ProcessStore,
): Promise<ProcessMigrationResult> {
    const noOp: ProcessMigrationResult = {
        migrated: false, workspaceCount: 0, processCount: 0, turnCount: 0, errors: [],
    };

    // Only migrate when using SQLite backend
    if (!(store instanceof SqliteProcessStore)) {
        return noOp;
    }

    const reposDir = path.join(dataDir, 'repos');
    if (!fs.existsSync(reposDir)) {
        return noOp;
    }

    // Scan for workspace directories containing un-migrated processes/
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(reposDir, { withFileTypes: true });
    } catch {
        return noOp;
    }

    const workspaceDirs: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const processesDir = path.join(reposDir, entry.name, 'processes');
        if (fs.existsSync(processesDir) && fs.statSync(processesDir).isDirectory()) {
            workspaceDirs.push(entry.name);
        }
    }

    if (workspaceDirs.length === 0) {
        return noOp;
    }

    process.stderr.write(
        `${PREFIX} Detected ${workspaceDirs.length} workspace(s) with legacy process files — migrating to SQLite…\n`,
    );

    const db = store.getDatabase();
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

    let totalWorkspaces = 0;
    let totalProcesses = 0;
    let totalTurns = 0;
    const allErrors: string[] = [];

    for (const wsId of workspaceDirs) {
        const processesDir = path.join(reposDir, wsId, 'processes');

        try {
            // Ensure workspace is registered (auto-register if missing)
            const existingWorkspaces = await store.getWorkspaces();
            const isRegistered = existingWorkspaces.some(ws => ws.id === wsId);
            if (!isRegistered) {
                await store.registerWorkspace({ id: wsId, name: wsId, rootPath: '' });
                process.stderr.write(`${PREFIX} Auto-registered workspace: ${wsId}\n`);
            }

            let wsProcesses = 0;
            let wsTurns = 0;
            const wsErrors: string[] = [];

            // Build processId → workItemId map for enriching work-item processes
            const workItemMap = buildWorkItemProcessMap(dataDir, wsId);

            // Run all inserts for this workspace in a single transaction
            const wsTransaction = db.transaction(() => {
                // Active processes
                const activeResult = importProcessesFromDir(
                    processesDir, wsId, insertProcess, insertTurn, false, workItemMap,
                );
                wsProcesses += activeResult.imported;
                wsTurns += activeResult.turns;
                wsErrors.push(...activeResult.errors);

                // Pruned/archived processes
                const prunedRoot = path.join(processesDir, 'pruned');
                if (fs.existsSync(prunedRoot)) {
                    let buckets: fs.Dirent[];
                    try {
                        buckets = fs.readdirSync(prunedRoot, { withFileTypes: true });
                    } catch {
                        buckets = [];
                    }
                    for (const bucket of buckets) {
                        if (!bucket.isDirectory()) continue;
                        const bucketDir = path.join(prunedRoot, bucket.name);
                        const archivedResult = importProcessesFromDir(
                            bucketDir, wsId, insertProcess, insertTurn, true, workItemMap,
                        );
                        wsProcesses += archivedResult.imported;
                        wsTurns += archivedResult.turns;
                        wsErrors.push(...archivedResult.errors);
                    }
                }
            });

            wsTransaction();

            totalProcesses += wsProcesses;
            totalTurns += wsTurns;
            allErrors.push(...wsErrors);

            // Rename processes/ → processes.migrated/ on success
            const migratedDir = path.join(reposDir, wsId, 'processes.migrated');
            try {
                fs.renameSync(processesDir, migratedDir);
            } catch (err) {
                const msg = `Could not rename processes/ → processes.migrated/ for ${wsId}: ${(err as Error)?.message ?? err}`;
                process.stderr.write(`${PREFIX} Warning: ${msg}\n`);
                allErrors.push(msg);
            }

            totalWorkspaces++;
            process.stderr.write(
                `${PREFIX} Migrated workspace ${wsId}: ${wsProcesses} process(es), ${wsTurns} turn(s)\n`,
            );
        } catch (err) {
            const msg = `Failed to migrate workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`;
            process.stderr.write(`${PREFIX} Error: ${msg}\n`);
            allErrors.push(msg);
        }
    }

    process.stderr.write(
        `${PREFIX} Migration complete — ${totalWorkspaces} workspace(s), ${totalProcesses} process(es), ${totalTurns} turn(s)\n`,
    );

    return {
        migrated: true,
        workspaceCount: totalWorkspaces,
        processCount: totalProcesses,
        turnCount: totalTurns,
        errors: allErrors,
    };
}

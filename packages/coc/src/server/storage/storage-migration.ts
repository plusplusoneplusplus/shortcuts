/**
 * Storage Migration Engine
 *
 * 6-phase pipeline that reads existing JSON process/workspace/wiki files
 * from ~/.coc/repos/ and writes them into a new SQLite database.
 *
 * Phases:
 *   1. Backup source data to temp directory
 *   2. Schema creation
 *   3. Process migration (active + pruned)
 *   4. Metadata migration (workspaces + wikis)
 *   5. Validation
 *   6. Cleanup & config switch
 *
 * Supports progress reporting, cancellation (phases 1–3), and automatic
 * cleanup on failure. Independently testable — no server infrastructure needed.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    Database,
    initializeDatabase,
    SqliteProcessStore,
    getLogger,
} from '@plusplusoneplusplus/forge';
import type {
    ProcessIndexEntry,
    WorkspaceInfo,
    WikiInfo,
    StoredProcessEntry,
    SerializedAIProcess,
    SerializedConversationTurn,
} from '@plusplusoneplusplus/forge';
import { loadConfigFile, writeConfigFile } from '../../config.js';

const logger = getLogger();

// ============================================================================
// Public types
// ============================================================================

export interface MigrationProgress {
    phase: number;
    status: 'running' | 'complete' | 'error';
    message: string;
    progress?: { current: number; total: number };
    summary?: MigrationSummary;
}

export interface MigrationSummary {
    processes: number;
    archivedProcesses: number;
    workspaces: number;
    wikis: number;
    durationMs: number;
    backupPath: string;
    backupSizeBytes: number;
}

export interface StorageMigrationOptions {
    dataDir: string;
    dbPath: string;
    onProgress: (event: MigrationProgress) => void;
    signal?: AbortSignal;
    skipValidation?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

export function readJsonFile<T>(filePath: string): T | undefined {
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw) as T;
    } catch {
        return undefined;
    }
}

export function jsonStringify(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    return JSON.stringify(value);
}

/**
 * Build the metadata JSON envelope matching SqliteProcessStore's format.
 * Folds legacy metadata + pendingMessages into a single JSON blob.
 */
export function buildMetadataEnvelope(proc: SerializedAIProcess, workspaceId: string): string | null {
    const envelope: Record<string, unknown> = { ...(proc.metadata ?? {}), workspaceId };
    if (proc.codeReviewMetadata) {
        envelope.__codeReviewMetadata = proc.codeReviewMetadata;
    }
    if (proc.discoveryMetadata) {
        envelope.__discoveryMetadata = proc.discoveryMetadata;
    }
    if (proc.codeReviewGroupMetadata) {
        envelope.__codeReviewGroupMetadata = proc.codeReviewGroupMetadata;
    }
    if (proc.pendingMessages && proc.pendingMessages.length > 0) {
        envelope.__pendingMessages = proc.pendingMessages;
    }
    return JSON.stringify(envelope);
}

export function serializeProcessToRow(
    proc: SerializedAIProcess,
    workspaceId: string,
    archived: boolean
): Record<string, unknown> {
    return {
        id: proc.id,
        workspace_id: workspaceId,
        type: proc.type ?? null,
        prompt_preview: proc.promptPreview ?? null,
        full_prompt: proc.fullPrompt ?? null,
        status: proc.status,
        start_time: proc.startTime,
        end_time: proc.endTime ?? null,
        error: proc.error ?? null,
        result: proc.result ?? null,
        result_file_path: proc.resultFilePath ?? null,
        raw_stdout_file_path: proc.rawStdoutFilePath ?? null,
        metadata: buildMetadataEnvelope(proc, workspaceId),
        group_metadata: jsonStringify(proc.groupMetadata),
        structured_result: proc.structuredResult ?? null,
        parent_process_id: proc.parentProcessId ?? null,
        sdk_session_id: proc.sdkSessionId ?? null,
        backend: proc.backend ?? null,
        working_directory: proc.workingDirectory ?? null,
        title: proc.title ?? null,
        token_limit: proc.tokenLimit ?? null,
        current_tokens: proc.currentTokens ?? null,
        cumulative_token_usage: jsonStringify(proc.cumulativeTokenUsage),
        stale: 0,
        data_file_path: null,
        archived: archived ? 1 : 0,
    };
}

export function serializeTurnToRow(
    turn: SerializedConversationTurn,
    processId: string
): Record<string, unknown> {
    return {
        process_id: processId,
        turn_index: turn.turnIndex,
        role: turn.role,
        content: turn.content ?? null,
        timestamp: turn.timestamp,
        streaming: turn.streaming ? 1 : 0,
        tool_calls: turn.toolCalls ? JSON.stringify(turn.toolCalls) : null,
        timeline: JSON.stringify(turn.timeline ?? []),
        images: turn.images ? JSON.stringify(turn.images) : null,
        historical: turn.historical ? 1 : 0,
        suggestions: turn.suggestions ? JSON.stringify(turn.suggestions) : null,
        token_usage: jsonStringify(turn.tokenUsage),
        paste_externalized: turn.pasteExternalized ? 1 : 0,
        model: turn.model ?? null,
        mode: (turn as { mode?: string }).mode ?? null,
    };
}

// ============================================================================
// StorageMigrationEngine
// ============================================================================

export class StorageMigrationEngine {
    private db: Database.Database | null = null;
    private backupDir: string | null = null;

    constructor(private options: StorageMigrationOptions) {}

    async run(): Promise<MigrationSummary> {
        const startTime = Date.now();
        let processCount = 0;
        let archivedCount = 0;
        let workspaceCount = 0;
        let wikiCount = 0;

        try {
            // Phase 1: Backup
            this.checkAborted();
            this.emit({ phase: 1, status: 'running', message: 'Backing up source data...' });
            this.backupDir = path.join(os.tmpdir(), '.coc-backup');
            const { backupDir, sizeBytes } = this.backup();
            this.emit({ phase: 1, status: 'running', message: `Backup complete → ${backupDir}` });

            // Phase 2: Schema creation
            this.checkAborted();
            this.emit({ phase: 2, status: 'running', message: 'Creating database schema...' });
            this.db = this.createDatabase();
            this.emit({ phase: 2, status: 'running', message: 'Database schema created' });

            // Phase 3: Process migration
            this.checkAborted();
            const migrationResult = this.migrateProcesses();
            processCount = migrationResult.active;
            archivedCount = migrationResult.archived;

            // Phase 4: Metadata migration (cancellation disabled from here)
            this.emit({ phase: 4, status: 'running', message: 'Migrating workspaces and wikis...' });
            workspaceCount = this.migrateWorkspaces();
            wikiCount = this.migrateWikis();
            this.emit({ phase: 4, status: 'running', message: `Migrated ${workspaceCount} workspaces and ${wikiCount} wikis` });

            // Phase 5: Validation
            if (this.options.skipValidation) {
                this.emit({ phase: 5, status: 'running', message: '⚠️ Validation skipped by user request' });
            } else {
                await this.validate(processCount + archivedCount, workspaceCount, wikiCount);
            }

            // Phase 6: Cleanup & config switch
            this.cleanup();

            const summary: MigrationSummary = {
                processes: processCount,
                archivedProcesses: archivedCount,
                workspaces: workspaceCount,
                wikis: wikiCount,
                durationMs: Date.now() - startTime,
                backupPath: backupDir,
                backupSizeBytes: sizeBytes,
            };

            this.emit({ phase: 6, status: 'complete', message: 'Migration complete', summary });
            this.closeDb();
            return summary;
        } catch (err) {
            this.closeDb();

            if (err instanceof DOMException && err.name === 'AbortError') {
                this.deleteDbFile();
                this.deleteBackupDir();
                throw err;
            }

            // Failure recovery: delete .db, don't touch config or JSON.
            // Leave backup dir intact for manual recovery.
            this.deleteDbFile();

            const phase = this.inferPhase(err);
            const message = err instanceof Error ? err.message : String(err);
            const backupHint = this.backupDir ? ` (backup preserved at ${this.backupDir})` : '';
            this.emit({ phase, status: 'error', message: message + backupHint });
            throw new Error(`Migration failed in phase ${phase}: ${message}`);
        }
    }

    // ========================================================================
    // Phase 1: Backup
    // ========================================================================

    private backup(): { backupDir: string; sizeBytes: number } {
        const backupDir = path.join(os.tmpdir(), '.coc-backup');

        // Remove stale backup from previous attempt
        if (fs.existsSync(backupDir)) {
            fs.rmSync(backupDir, { recursive: true, force: true });
        }
        fs.mkdirSync(backupDir, { recursive: true });

        const filesToBackup = ['config.yaml', 'workspaces.json', 'wikis.json'];
        let totalBytes = 0;
        let current = 0;

        // Count total items (top-level files + workspace process dirs)
        const reposDir = path.join(this.options.dataDir, 'repos');
        const workspaceDirs = fs.existsSync(reposDir)
            ? fs.readdirSync(reposDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name)
            : [];
        const total = filesToBackup.length + workspaceDirs.length;

        // Copy top-level files
        for (const file of filesToBackup) {
            const src = path.join(this.options.dataDir, file);
            if (fs.existsSync(src)) {
                const dest = path.join(backupDir, file);
                fs.cpSync(src, dest);
                totalBytes += fs.statSync(dest).size;
            }
            current++;
            this.emit({
                phase: 1,
                status: 'running',
                message: `Backing up ${file}`,
                progress: { current, total },
            });
        }

        // Copy repos/*/processes/ subtrees
        for (const wsId of workspaceDirs) {
            this.checkAborted();
            const srcProcesses = path.join(reposDir, wsId, 'processes');
            if (fs.existsSync(srcProcesses)) {
                const destProcesses = path.join(backupDir, 'repos', wsId, 'processes');
                fs.cpSync(srcProcesses, destProcesses, { recursive: true });
                totalBytes += this.dirSize(destProcesses);
            }
            current++;
            this.emit({
                phase: 1,
                status: 'running',
                message: `Backing up workspace ${wsId}`,
                progress: { current, total },
            });
        }

        return { backupDir, sizeBytes: totalBytes };
    }

    private dirSize(dir: string): number {
        let total = 0;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                total += this.dirSize(full);
            } else {
                total += fs.statSync(full).size;
            }
        }
        return total;
    }

    private deleteBackupDir(): void {
        try {
            if (this.backupDir && fs.existsSync(this.backupDir)) {
                fs.rmSync(this.backupDir, { recursive: true, force: true });
            }
        } catch {
            // best-effort
        }
    }

    // ========================================================================
    // Phase 2: Schema creation
    // ========================================================================

    private createDatabase(): Database.Database {
        this.deleteDbFile();
        const db = new Database(this.options.dbPath);
        initializeDatabase(db);
        return db;
    }

    // ========================================================================
    // Phase 3: Process migration
    // ========================================================================

    private migrateProcesses(): { active: number; archived: number } {
        const reposDir = path.join(this.options.dataDir, 'repos');
        if (!fs.existsSync(reposDir)) {
            this.emit({ phase: 3, status: 'running', message: 'No repos directory found, skipping process migration' });
            return { active: 0, archived: 0 };
        }

        const workspaceDirs = fs.readdirSync(reposDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        let totalActive = 0;
        let totalArchived = 0;

        const insertProcess = this.db!.prepare(`
            INSERT INTO processes (
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

        const insertTurn = this.db!.prepare(`
            INSERT INTO conversation_turns (
                process_id, turn_index, role, content, timestamp, streaming,
                tool_calls, timeline, images, historical, suggestions,
                token_usage, paste_externalized, model, mode
            ) VALUES (
                @process_id, @turn_index, @role, @content, @timestamp, @streaming,
                @tool_calls, @timeline, @images, @historical, @suggestions,
                @token_usage, @paste_externalized, @model, @mode
            )
        `);

        for (let i = 0; i < workspaceDirs.length; i++) {
            this.checkAborted();

            const wsId = workspaceDirs[i];
            const processesDir = path.join(reposDir, wsId, 'processes');
            if (!fs.existsSync(processesDir)) continue;

            this.emit({
                phase: 3,
                status: 'running',
                message: `Migrating workspace ${wsId}`,
                progress: { current: i + 1, total: workspaceDirs.length },
            });

            // Wrap each workspace in a transaction for bulk-insert performance
            const wsTransaction = this.db!.transaction(() => {
                // Active processes
                const activeCount = this.migrateWorkspaceProcesses(
                    processesDir, wsId, insertProcess, insertTurn, false
                );
                totalActive += activeCount;

                // Pruned processes
                const prunedRoot = path.join(processesDir, 'pruned');
                if (fs.existsSync(prunedRoot)) {
                    const buckets = fs.readdirSync(prunedRoot, { withFileTypes: true })
                        .filter(d => d.isDirectory())
                        .map(d => d.name);

                    for (const bucket of buckets) {
                        const bucketDir = path.join(prunedRoot, bucket);
                        const archivedCount = this.migrateWorkspaceProcesses(
                            bucketDir, wsId, insertProcess, insertTurn, true
                        );
                        totalArchived += archivedCount;
                    }
                }
            });

            wsTransaction();
        }

        this.emit({
            phase: 3,
            status: 'running',
            message: `Migrated ${totalActive} active and ${totalArchived} archived processes`,
        });

        return { active: totalActive, archived: totalArchived };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private migrateWorkspaceProcesses(
        dir: string,
        workspaceId: string,
        insertProcess: { run: (params: Record<string, unknown>) => unknown },
        insertTurn: { run: (params: Record<string, unknown>) => unknown },
        archived: boolean
    ): number {
        const indexPath = path.join(dir, 'index.json');
        const index = readJsonFile<ProcessIndexEntry[]>(indexPath);
        if (!index || !Array.isArray(index)) return 0;

        let count = 0;
        for (const entry of index) {
            const processFilePath = path.join(dir, `${entry.id}.json`);
            const stored = readJsonFile<StoredProcessEntry>(processFilePath);
            if (!stored?.process) {
                logger.warn('storage-migration', `Skipping unreadable process file: ${processFilePath}`);
                continue;
            }

            const proc = stored.process;

            try {
                insertProcess.run(serializeProcessToRow(proc, workspaceId, archived));

                const turns = proc.conversationTurns ?? [];
                for (const turn of turns) {
                    insertTurn.run(serializeTurnToRow(turn, proc.id));
                }
                count++;
            } catch (err) {
                logger.warn('storage-migration', `Skipping corrupt process ${entry.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }

        return count;
    }

    // ========================================================================
    // Phase 4: Metadata migration
    // ========================================================================

    private migrateWorkspaces(): number {
        const filePath = path.join(this.options.dataDir, 'workspaces.json');
        const workspaces = readJsonFile<WorkspaceInfo[]>(filePath);
        if (!workspaces || !Array.isArray(workspaces)) return 0;

        const insert = this.db!.prepare(`
            INSERT OR REPLACE INTO workspaces (
                id, name, root_path, color, remote_url, description,
                enabled_mcp_servers, disabled_skills, extra_skill_folders, virtual
            ) VALUES (
                @id, @name, @root_path, @color, @remote_url, @description,
                @enabled_mcp_servers, @disabled_skills, @extra_skill_folders, @virtual
            )
        `);

        const txn = this.db!.transaction(() => {
            for (const ws of workspaces) {
                insert.run({
                    id: ws.id,
                    name: ws.name,
                    root_path: ws.rootPath,
                    color: ws.color ?? null,
                    remote_url: ws.remoteUrl ?? null,
                    description: ws.description ?? null,
                    enabled_mcp_servers: ws.enabledMcpServers === null ? null :
                        ws.enabledMcpServers !== undefined ? JSON.stringify(ws.enabledMcpServers) : null,
                    disabled_skills: jsonStringify(ws.disabledSkills),
                    extra_skill_folders: jsonStringify(ws.extraSkillFolders),
                    virtual: ws.virtual ? 1 : 0,
                });
            }
        });

        txn();
        return workspaces.length;
    }

    private migrateWikis(): number {
        const filePath = path.join(this.options.dataDir, 'wikis.json');
        const wikis = readJsonFile<WikiInfo[]>(filePath);
        if (!wikis || !Array.isArray(wikis)) return 0;

        const insert = this.db!.prepare(`
            INSERT OR REPLACE INTO wikis (
                id, name, wiki_dir, repo_path, color, ai_enabled, registered_at
            ) VALUES (
                @id, @name, @wiki_dir, @repo_path, @color, @ai_enabled, @registered_at
            )
        `);

        const txn = this.db!.transaction(() => {
            for (const wiki of wikis) {
                insert.run({
                    id: wiki.id,
                    name: wiki.name,
                    wiki_dir: wiki.wikiDir,
                    repo_path: wiki.repoPath ?? null,
                    color: wiki.color ?? null,
                    ai_enabled: wiki.aiEnabled ? 1 : 0,
                    registered_at: wiki.registeredAt,
                });
            }
        });

        txn();
        return wikis.length;
    }

    // ========================================================================
    // Phase 5: Validation
    // ========================================================================

    private async validate(expectedProcesses: number, expectedWorkspaces: number, expectedWikis: number): Promise<void> {
        this.emit({ phase: 5, status: 'running', message: 'Validating migrated data...' });

        // Validate total process count
        const actualProcesses = (this.db!.prepare('SELECT COUNT(*) AS cnt FROM processes').get() as { cnt: number }).cnt;
        if (actualProcesses < expectedProcesses) {
            throw this.validationError(
                `Process count mismatch: expected ${expectedProcesses}, got ${actualProcesses}`
            );
        }
        if (actualProcesses > expectedProcesses) {
            logger.warn('storage-migration', `Process count higher than expected: expected ${expectedProcesses}, got ${actualProcesses} — proceeding`);
        }

        // Validate workspace count
        const actualWorkspaces = (this.db!.prepare('SELECT COUNT(*) AS cnt FROM workspaces').get() as { cnt: number }).cnt;
        if (actualWorkspaces !== expectedWorkspaces) {
            throw this.validationError(
                `Workspace count mismatch: expected ${expectedWorkspaces}, got ${actualWorkspaces}`
            );
        }

        // Validate wiki count
        const actualWikis = (this.db!.prepare('SELECT COUNT(*) AS cnt FROM wikis').get() as { cnt: number }).cnt;
        if (actualWikis !== expectedWikis) {
            throw this.validationError(
                `Wiki count mismatch: expected ${expectedWikis}, got ${actualWikis}`
            );
        }

        // Per-workspace process count validation
        const reposDir = path.join(this.options.dataDir, 'repos');
        if (fs.existsSync(reposDir)) {
            const workspaceDirs = fs.readdirSync(reposDir, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const wsId of workspaceDirs) {
                const expectedCount = this.countJsonProcesses(wsId);
                const actualCount = (this.db!.prepare(
                    'SELECT COUNT(*) AS cnt FROM processes WHERE workspace_id = ?'
                ).get(wsId) as { cnt: number }).cnt;

                if (actualCount !== expectedCount) {
                    throw this.validationError(
                        `Workspace ${wsId} process count mismatch: expected ${expectedCount}, got ${actualCount}`
                    );
                }
            }
        }

        // Sample validation via SqliteProcessStore round-trip
        await this.validateSample();

        this.emit({ phase: 5, status: 'running', message: `Validated: ${actualProcesses} processes verified` });
    }

    private countJsonProcesses(workspaceId: string): number {
        let count = 0;
        const processesDir = path.join(this.options.dataDir, 'repos', workspaceId, 'processes');

        // Active
        const indexPath = path.join(processesDir, 'index.json');
        const index = readJsonFile<ProcessIndexEntry[]>(indexPath);
        if (index && Array.isArray(index)) {
            // Count only entries that have valid process files
            for (const entry of index) {
                const processFilePath = path.join(processesDir, `${entry.id}.json`);
                const stored = readJsonFile<StoredProcessEntry>(processFilePath);
                if (stored?.process) count++;
            }
        }

        // Pruned
        const prunedRoot = path.join(processesDir, 'pruned');
        if (fs.existsSync(prunedRoot)) {
            const buckets = fs.readdirSync(prunedRoot, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const bucket of buckets) {
                const bucketDir = path.join(prunedRoot, bucket);
                const bucketIndex = readJsonFile<ProcessIndexEntry[]>(path.join(bucketDir, 'index.json'));
                if (bucketIndex && Array.isArray(bucketIndex)) {
                    for (const entry of bucketIndex) {
                        const processFilePath = path.join(bucketDir, `${entry.id}.json`);
                        const stored = readJsonFile<StoredProcessEntry>(processFilePath);
                        if (stored?.process) count++;
                    }
                }
            }
        }

        return count;
    }

    private async validateSample(): Promise<void> {
        // Sample 10% of processes (min 5, max 50)
        const allIds = this.db!.prepare('SELECT id, workspace_id FROM processes').all() as Array<{ id: string; workspace_id: string }>;
        if (allIds.length === 0) return;

        const sampleSize = Math.min(50, Math.max(5, Math.ceil(allIds.length * 0.1)));
        const sampled = this.shuffle(allIds).slice(0, Math.min(sampleSize, allIds.length));

        // Use SqliteProcessStore for round-trip validation
        const store = new SqliteProcessStore({ dbPath: this.options.dbPath });
        try {
            for (const { id, workspace_id: wsId } of sampled) {
                const process = await store.getProcess(id);
                if (!process) {
                    throw this.validationError(`Process ${id} not found via SqliteProcessStore`);
                }

                // Compare with source JSON
                const sourceProcess = this.findSourceProcess(id, wsId);
                if (!sourceProcess) continue; // source may have been skipped

                if (process.id !== sourceProcess.id) {
                    throw this.validationError(`Process ${id}: id mismatch`);
                }
                if (process.status !== sourceProcess.status) {
                    throw this.validationError(`Process ${id}: status mismatch — expected ${sourceProcess.status}, got ${process.status}`);
                }
                if (process.promptPreview !== (sourceProcess.promptPreview ?? '')) {
                    throw this.validationError(`Process ${id}: promptPreview mismatch`);
                }
                if (process.startTime.toISOString() !== sourceProcess.startTime) {
                    throw this.validationError(`Process ${id}: startTime mismatch`);
                }

                const expectedTurns = sourceProcess.conversationTurns?.length ?? 0;
                const actualTurns = process.conversationTurns?.length ?? 0;
                if (actualTurns !== expectedTurns) {
                    throw this.validationError(
                        `Process ${id}: conversationTurns count mismatch — expected ${expectedTurns}, got ${actualTurns}`
                    );
                }

                // Verify turn content round-trips for the first turn with tool calls
                if (actualTurns > 0) {
                    const sourceTurns = sourceProcess.conversationTurns!;
                    for (let t = 0; t < sourceTurns.length; t++) {
                        const src = sourceTurns[t];
                        const dst = process.conversationTurns![t];
                        if (dst.role !== src.role) {
                            throw this.validationError(`Process ${id} turn ${t}: role mismatch`);
                        }
                        if (dst.content !== (src.content ?? '')) {
                            throw this.validationError(`Process ${id} turn ${t}: content mismatch`);
                        }
                        const expectedToolCalls = src.toolCalls?.length ?? 0;
                        const actualToolCalls = dst.toolCalls?.length ?? 0;
                        if (actualToolCalls !== expectedToolCalls) {
                            throw this.validationError(
                                `Process ${id} turn ${t}: toolCalls count mismatch — expected ${expectedToolCalls}, got ${actualToolCalls}`
                            );
                        }
                    }
                }
            }
        } finally {
            store.close();
        }
    }

    private findSourceProcess(id: string, workspaceId: string): SerializedAIProcess | undefined {
        const processesDir = path.join(this.options.dataDir, 'repos', workspaceId, 'processes');

        // Check active
        const activePath = path.join(processesDir, `${id}.json`);
        const active = readJsonFile<StoredProcessEntry>(activePath);
        if (active?.process) return active.process;

        // Check pruned buckets
        const prunedRoot = path.join(processesDir, 'pruned');
        if (fs.existsSync(prunedRoot)) {
            const buckets = fs.readdirSync(prunedRoot, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const bucket of buckets) {
                const prunedPath = path.join(prunedRoot, bucket, `${id}.json`);
                const pruned = readJsonFile<StoredProcessEntry>(prunedPath);
                if (pruned?.process) return pruned.process;
            }
        }

        return undefined;
    }

    private shuffle<T>(arr: T[]): T[] {
        const copy = [...arr];
        for (let i = copy.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [copy[i], copy[j]] = [copy[j], copy[i]];
        }
        return copy;
    }

    private validationError(message: string): Error {
        // On validation failure: close DB, delete .db file
        this.closeDb();
        this.deleteDbFile();
        return new Error(`Validation failed: ${message}`);
    }

    // ========================================================================
    // Phase 6: Cleanup & config switch
    // ========================================================================

    private cleanup(): void {
        this.emit({ phase: 6, status: 'running', message: 'Updating configuration and cleaning up...' });

        // Update config.yaml
        const configPath = path.join(this.options.dataDir, 'config.yaml');
        const existingConfig = loadConfigFile(configPath) ?? {};
        existingConfig.store = { ...existingConfig.store, backend: 'sqlite' };
        writeConfigFile(configPath, existingConfig);

        // Delete JSON process files
        const reposDir = path.join(this.options.dataDir, 'repos');
        if (!fs.existsSync(reposDir)) return;

        const workspaceDirs = fs.readdirSync(reposDir, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name);

        for (const wsId of workspaceDirs) {
            const processesDir = path.join(reposDir, wsId, 'processes');
            if (!fs.existsSync(processesDir)) continue;

            // Delete individual process JSON files and index.json
            const files = fs.readdirSync(processesDir, { withFileTypes: true });
            for (const file of files) {
                if (file.isFile() && file.name.endsWith('.json')) {
                    try {
                        fs.unlinkSync(path.join(processesDir, file.name));
                    } catch {
                        // best-effort cleanup
                    }
                }
            }

            // Delete pruned directory recursively
            const prunedRoot = path.join(processesDir, 'pruned');
            if (fs.existsSync(prunedRoot)) {
                try {
                    fs.rmSync(prunedRoot, { recursive: true, force: true });
                } catch {
                    // best-effort cleanup
                }
            }
        }
    }

    // ========================================================================
    // Utilities
    // ========================================================================

    private emit(event: MigrationProgress): void {
        try {
            this.options.onProgress(event);
        } catch {
            // never let callback errors break migration
        }
    }

    private checkAborted(): void {
        if (this.options.signal?.aborted) {
            const err = new DOMException('Migration aborted', 'AbortError');
            throw err;
        }
    }

    private closeDb(): void {
        try {
            this.db?.close();
        } catch {
            // ignore
        }
        this.db = null;
    }

    private deleteDbFile(): void {
        try {
            if (fs.existsSync(this.options.dbPath)) {
                fs.unlinkSync(this.options.dbPath);
            }
        } catch {
            // best-effort
        }
    }

    private inferPhase(err: unknown): number {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Validation failed')) return 5;
        if (msg.includes('Migration failed in phase')) {
            const match = msg.match(/phase (\d+)/);
            if (match) return parseInt(match[1], 10);
        }
        // Default to current DB state to infer
        if (!this.db) return 2;
        return 3;
    }
}

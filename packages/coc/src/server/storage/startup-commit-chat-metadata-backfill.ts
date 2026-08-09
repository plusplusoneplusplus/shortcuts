/**
 * Startup Commit-Chat Metadata Backfill
 *
 * Commit chats created before `metadata.commitChat` existed carry their commit
 * association only in the workspace-scoped `commit_chat_bindings` routing table,
 * so the conversation metadata popover has nothing to show. This repair joins
 * each binding to its process row and writes the hash into the process metadata.
 *
 * The repair is:
 * - Idempotent (a process that already has `metadata.commitChat` is untouched,
 *   so a newer rebased hash or a saved message is never overwritten)
 * - Workspace-scoped (a binding only ever updates a process in its own workspace)
 * - Tolerant of both bare and `queue_`-prefixed task IDs
 * - Hash-only: the binding table has no commit message, so none is invented
 * - A no-op for file-backed stores, which have no durable table to join
 */

import type Database from 'better-sqlite3';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';

const PREFIX = '[CommitChatBackfill]';

export interface CommitChatBackfillResult {
    /** Number of process rows that gained `metadata.commitChat`. */
    updated: number;
    /** Bindings skipped because the process was missing or already had the field. */
    skipped: number;
}

interface BindingRow {
    workspace_id: string;
    commit_hash: string;
    task_id: string;
}

interface ProcessRow {
    id: string;
    metadata: string | null;
}

/** Strip a `queue_` prefix, if present, to get the bare task ID. */
function toBareId(taskId: string): string {
    return taskId.startsWith('queue_') ? taskId.slice('queue_'.length) : taskId;
}

/**
 * Add `metadata.commitChat.commitHash` to bound commit-chat processes that lack
 * it. Safe to call on every startup; returns counts for logging and tests.
 */
export function backfillCommitChatMetadata(db: Database.Database): CommitChatBackfillResult {
    const result: CommitChatBackfillResult = { updated: 0, skipped: 0 };

    let bindings: BindingRow[];
    try {
        bindings = db
            .prepare('SELECT workspace_id, commit_hash, task_id FROM commit_chat_bindings')
            .all() as BindingRow[];
    } catch {
        // No bindings table (fresh or non-standard database) — nothing to repair.
        return result;
    }
    if (bindings.length === 0) return result;

    const selectProcess = db.prepare(
        'SELECT id, metadata FROM processes WHERE id IN (?, ?) AND workspace_id = ?',
    );
    const updateProcess = db.prepare('UPDATE processes SET metadata = ? WHERE id = ?');

    const run = db.transaction(() => {
        for (const binding of bindings) {
            const bareId = toBareId(binding.task_id);
            const row = selectProcess.get(bareId, `queue_${bareId}`, binding.workspace_id) as ProcessRow | undefined;
            if (!row) {
                result.skipped++;
                continue;
            }

            let metadata: Record<string, unknown>;
            try {
                const parsed = row.metadata ? JSON.parse(row.metadata) : {};
                metadata = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                    ? parsed as Record<string, unknown>
                    : {};
            } catch {
                result.skipped++;
                continue;
            }

            const existing = metadata.commitChat;
            if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
                // Already associated — may hold a rebased hash or a saved message.
                result.skipped++;
                continue;
            }

            metadata.commitChat = { commitHash: binding.commit_hash };
            updateProcess.run(JSON.stringify(metadata), row.id);
            result.updated++;
        }
    });
    run();

    return result;
}

/**
 * Startup entry point. Runs the backfill for SQLite-backed stores only; legacy
 * file-backed processes are left unchanged rather than guessing hashes from
 * prompt text (newly created file-backed processes still get metadata from the
 * task payload).
 */
export function backfillCommitChatMetadataIfNeeded(store: ProcessStore): CommitChatBackfillResult {
    if (!(store instanceof SqliteProcessStore)) {
        return { updated: 0, skipped: 0 };
    }
    try {
        const result = backfillCommitChatMetadata(store.getDatabase());
        if (result.updated > 0) {
            process.stderr.write(`${PREFIX} Added commit metadata to ${result.updated} process(es)\n`);
        }
        return result;
    } catch (error) {
        // Never block startup on a best-effort data repair.
        process.stderr.write(`${PREFIX} Skipped: ${error instanceof Error ? error.message : String(error)}\n`);
        return { updated: 0, skipped: 0 };
    }
}

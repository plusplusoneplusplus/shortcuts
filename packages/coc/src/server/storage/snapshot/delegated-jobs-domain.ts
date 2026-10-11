import * as fs from 'node:fs';
import * as path from 'node:path';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { DELEGATED_JOBS_FILE } from '../../delegation/delegated-job-store';
import { SENTINEL_MIRROR_OUTBOX_FILE } from '../../messaging/sentinel-mirror-outbox';
import { EMPTY_COLLECT_RESULT, type StorageSnapshotDomain } from './types';
import { getErrorMessage, listRepoFiles } from './snapshot-fs';

/** Operational delivery receipts stay machine-local and are cleared with server data. */
export function createDelegatedJobsDomain(): StorageSnapshotDomain<string[]> {
    return createMachineLocalRepoFileDomain('delegated-jobs', DELEGATED_JOBS_FILE);
}

/** Sentinel to-do ledgers are keyed by local chat IDs, so they follow the same policy. */
export function createSentinelTodosDomain(): StorageSnapshotDomain<string[]> {
    return {
        id: 'sentinel-todos',
        collect: () => EMPTY_COLLECT_RESULT,
        restoreReplace() { /* Machine-local bookkeeping is not portable conversation data. */ },
        restoreMerge() { /* Import cannot attach items to another server's chats. */ },
        planWipe() {
            return { plan: [], counts: {}, errors: [] };
        },
        executeWipe(ctx, _plan, result) {
            try {
                withLedgerDb(ctx, SENTINEL_TODO_TABLES, db => db.transaction(() => {
                    // References arrived later; a database no newer server opened lacks the table.
                    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sentinel_todo_references'").get()) {
                        db.prepare('DELETE FROM sentinel_todo_references').run();
                    }
                    for (const table of SENTINEL_TODO_TABLES) db.prepare(`DELETE FROM ${table}`).run();
                })());
            } catch (error) {
                result.errors.push(`Failed to clear Sentinel to-do ledger: ${getErrorMessage(error)}`);
            }
        },
    };
}

const SENTINEL_TODO_TABLES = [
    'sentinel_todo_jobs', 'sentinel_todo_items', 'sentinel_todo_ledgers',
] as const;

const SENTINEL_MIRROR_TABLES = [
    'sentinel_mirror_receipts', 'sentinel_mirror_deliveries', 'sentinel_mirror_requests', 'sentinel_mirror_imports',
] as const;

/**
 * Mirror requests, deliveries and receipts stay machine-local: never exported or
 * imported (a restore cannot replay or re-own deliveries). Wipe clears the SQLite
 * ledger tables together with any legacy JSON ledgers and import markers.
 */
export function createSentinelMirrorOutboxDomain(): StorageSnapshotDomain<string[]> {
    const files = createMachineLocalRepoFileDomain('sentinel-mirror-outbox', SENTINEL_MIRROR_OUTBOX_FILE);
    return {
        ...files,
        executeWipe(ctx, plan, result) {
            files.executeWipe(ctx, plan, result);
            try {
                withLedgerDb(ctx, SENTINEL_MIRROR_TABLES, db => db.transaction(() => {
                    for (const table of SENTINEL_MIRROR_TABLES) db.prepare(`DELETE FROM ${table}`).run();
                })());
            } catch (error) {
                result.errors.push(`Failed to clear Sentinel mirror ledger: ${getErrorMessage(error)}`);
            }
        },
    };
}

function withLedgerDb(ctx: { dataDir: string; store: unknown }, requiredTables: readonly string[],
    use: (db: NativeDatabase) => void): void {
    const useIfInitialized = (db: NativeDatabase) => {
        const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all<{ name: string }>()
            .map(row => row.name));
        const missing = requiredTables.filter(table => !tables.has(table));
        if (missing.length === requiredTables.length) return;
        if (missing.length) throw new Error(`Incomplete SQLite ledger schema: missing ${missing.join(', ')}`);
        use(db);
    };
    if (ctx.store instanceof SqliteProcessStore) return useIfInitialized(ctx.store.getDatabase());
    const file = path.join(ctx.dataDir, 'processes.db');
    if (!fs.existsSync(file)) return;
    const db = new NativeDatabase(file);
    try {
        useIfInitialized(db);
    } finally { db.close(); }
}

function createMachineLocalRepoFileDomain(id: string, filename: string): StorageSnapshotDomain<string[]> {
    return {
        id,
        collect: () => EMPTY_COLLECT_RESULT,
        restoreReplace() { /* Importing could attach records to unrelated chats. */ },
        restoreMerge() { /* Not portable conversation data. */ },
        planWipe(ctx) {
            return { plan: listRepoFiles(ctx.dataDir, filename), counts: {}, errors: [] };
        },
        executeWipe(_ctx, files, result) {
            for (const file of files ?? []) {
                try {
                    fs.unlinkSync(file);
                } catch (error) {
                    result.errors.push(`Failed to delete ${file}: ${getErrorMessage(error)}`);
                }
            }
        },
    };
}

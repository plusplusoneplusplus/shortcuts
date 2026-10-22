import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRepoDataPath } from '../../../src/server/paths';
import {
    MAX_TODO_ITEMS, MAX_TODO_JOB_LINKS, SentinelTodoError, SentinelTodoStore,
    type SentinelTodoActor, type SentinelTodoJobLinkInput, type SentinelTodoOwner,
} from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import { createSnapshotDomains } from '../../../src/server/storage/snapshot/registry';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const otherOwners = [
    { ...owner, processId: 'queue_other' },
    { workspaceId: 'ws-b', processId: owner.processId },
];
const job: SentinelTodoJobLinkInput = {
    processId: 'queue_child', workspaceId: 'ws-a', kind: 'local', openLink: '#repos/ws-a/chats/child',
};

function expectTodoError(fn: () => unknown, code: string): SentinelTodoError {
    try {
        fn();
    } catch (error) {
        expect(error).toBeInstanceOf(SentinelTodoError);
        expect((error as SentinelTodoError).code).toBe(code);
        return error as SentinelTodoError;
    }
    throw new Error('expected a SentinelTodoError');
}

let dataDir: string;
let db: NativeDatabase;
let store: SentinelTodoStore;
let handles: NativeDatabase[];

function openDatabase(): NativeDatabase {
    const handle = new NativeDatabase(path.join(dataDir, 'processes.db'));
    handles.push(handle);
    initializeDatabase(handle);
    handle.pragma('journal_mode = WAL');
    return handle;
}

function reopen(): SentinelTodoStore {
    return new SentinelTodoStore(openDatabase());
}

function linkedItem() {
    const { item } = store.create(owner, { title: 'Tracked' }, { actor: 'user' });
    return store.linkJob(owner, item.id, job).item;
}

function failWrites(table: 'sentinel_todo_ledgers' | 'sentinel_todo_items' | 'sentinel_todo_jobs',
    operation: 'INSERT' | 'UPDATE' = 'UPDATE'): void {
    db.exec(`CREATE TRIGGER reject_write BEFORE ${operation} ON ${table}
        BEGIN SELECT RAISE(ABORT, 'injected SQL failure'); END`);
}

beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(process.cwd(), '.sentinel-ledger-test-'));
    handles = [];
    db = openDatabase();
    store = new SentinelTodoStore(db);
});

afterEach(() => {
    for (const handle of handles) handle.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('SentinelTodoStore SQLite persistence', () => {

    function legacyStatusConstraint() {
        const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sentinel_todo_items'").get<{ sql: string }>()!.sql;
        const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = 'sentinel_todo_items' AND type IN ('index', 'trigger') AND sql IS NOT NULL").all<{ sql: string }>();
        db.pragma('foreign_keys = OFF');
        db.exec(sql.replace('sentinel_todo_items', 'legacy_todos').replace(", 'deferred'", ''));
        db.exec('INSERT INTO legacy_todos SELECT * FROM sentinel_todo_items');
        db.exec('DROP TABLE sentinel_todo_items');
        db.exec('ALTER TABLE legacy_todos RENAME TO sentinel_todo_items');
        for (const object of objects) db.exec(object.sql);
        db.pragma('foreign_keys = ON');
    }
    it('migrates the old status CHECK without losing child rows, custom objects or the process schema version', () => {
        let item = linkedItem();
        item = store.attachReference(owner, item.id, item.revision, {
            processId: 'ref', workspaceId: 'ws-a', openLink: '#repos/ws-a/chats/ref',
        }, 'user').item;
        store.create(otherOwners[0], { title: 'Other owner', type: 'manual' }, { actor: 'user' });
        db.exec('CREATE INDEX sentinel_todo_custom_title ON sentinel_todo_items(title)');
        db.exec("CREATE TRIGGER sentinel_todo_custom_guard BEFORE UPDATE ON sentinel_todo_items WHEN NEW.title = 'forbidden' BEGIN SELECT RAISE(ABORT, 'custom guard'); END");
        legacyStatusConstraint();
        const before = store.get(owner);
        const version = db.pragma('user_version', { simple: true });
        store = new SentinelTodoStore(db);
        expect(store.get(owner)).toEqual(before);
        expect(store.get(otherOwners[0]).items[0].title).toBe('Other owner');
        const next = store.update(owner, item.id, item.revision, { status: 'deferred' }, 'user').item;
        expect(reopen().get(owner).items[0]).toEqual(next);
        expect(db.pragma('user_version', { simple: true })).toBe(version);
        expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
        expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
        expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'sentinel_todo_custom_title'").get()).toBeTruthy();
        expect(() => store.update(owner, next.id, next.revision, { title: 'forbidden' }, 'user')).toThrow('custom guard');
    });
    it('rolls back a failed migration and restores foreign-key enforcement', () => {
        const item = linkedItem();
        legacyStatusConstraint();
        const before = store.get(owner);
        const execute = db.exec.bind(db);
        const spy = vi.spyOn(db, 'exec').mockImplementation(sql => {
            if (sql.startsWith('ALTER TABLE sentinel_todo_items_deferred')) throw new Error('migration failed');
            return execute(sql);
        });
        expect(() => new SentinelTodoStore(db)).toThrow('migration failed');
        expect(store.get(owner)).toEqual(before);
        expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
        spy.mockRestore();
        store = new SentinelTodoStore(db);
        expect(store.update(owner, item.id, item.revision, { status: 'deferred' }, 'user').item.status).toBe('deferred');
    });
    it.each(['normal', 'manual'] as const)('creates, persists and transitions Deferred for %s with revision and owner checks', type => {
        let row = store.create(owner, { title: 'Later', type, status: 'deferred' }, { actor: 'user' }).item;
        expect(row.userVerdictRevision).toBe(1);
        expect(reopen().get(owner).items[0].status).toBe('deferred');
        for (const status of ['todo', 'in_progress', 'deferred', 'needs_attention', 'done', 'deferred'] as const) {
            row = store.update(owner, row.id, row.revision, { status }, 'user').item;
            expect(reopen().get(owner).items[0].status).toBe(status);
        }
        expectTodoError(() => store.update(owner, row.id, 1, { status: 'todo' }, 'user'), 'conflict');
        expectTodoError(() => store.update(otherOwners[0], row.id, row.revision, { status: 'todo' }, 'user'), 'not_found');
        expectTodoError(() => store.update(owner, row.id, row.revision, { status: 'in_progress' }, 'sentinel'), 'invalid');
        expect(store.update(owner, row.id, row.revision, { notes: 'Evidence only' }, 'sentinel').item.status).toBe('deferred');
    });
    it('preserves Deferred through linking, failure receipts and spec-ready milestones', () => {
        let row = store.create(owner, { title: 'Later', status: 'deferred', statusReason: 'Next release' }, { actor: 'user' }).item;
        row = store.linkJob(owner, row.id, job).item;
        expect(row).toMatchObject({ status: 'deferred', statusReason: 'Next release' });
        store.recordJobResult(owner, job.processId, { terminalEventId: 'failed-later', outcome: 'failed' });
        row = store.get(owner).items[0];
        expect(row.status).toBe('deferred');
        expect(row.jobs[0].result?.outcome).toBe('failed');
        store.recordGrillingResult(owner, job.processId, 'spec-later', ['plan']);
        row = store.get(owner).items[0];
        expect(row).toMatchObject({ status: 'deferred', statusReason: 'Next release' });
        expectTodoError(() => store.recordScrubberDone(owner, row.id, row.revision, 'Merged'), 'invalid');
        expectTodoError(() => store.update(owner, row.id, row.revision, { status: 'done', statusReason: 'Stale result' }, 'sentinel'), 'invalid');
    });
    it('starts empty, initializes additively and leaves the process schema/version intact', () => {
        const shared = new NativeDatabase(path.join(dataDir, 'schema.db'));
        handles.push(shared);
        initializeDatabase(shared);
        const version = shared.pragma('user_version', { simple: true });
        shared.exec('CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES (\'preserved\')');
        const schema = shared.prepare(`SELECT name, sql FROM sqlite_master
            WHERE tbl_name NOT LIKE 'sentinel_todo_%' ORDER BY name`).all();
        const feature = new SentinelTodoStore(shared);
        expect(feature.get(owner)).toEqual({ revision: 0, items: [] });
        new SentinelTodoStore(shared);
        expect(shared.pragma('user_version', { simple: true })).toBe(version);
        expect(shared.prepare(`SELECT name, sql FROM sqlite_master
            WHERE tbl_name NOT LIKE 'sentinel_todo_%' ORDER BY name`).all()).toEqual(schema);
        expect(shared.prepare('SELECT value FROM unrelated').get()).toEqual({ value: 'preserved' });
    });

    it('persists ordered items, optional fields and jobs after every handle closes and reopens', () => {
        const created = store.create(owner, {
            title: 'Fix login', completionCondition: 'Login test passes',
            targetRepo: { workspaceId: 'ws-b', serverId: 'srv-b', label: 'web' },
        }, { actor: 'user' });
        store.create(owner, { title: 'Second' }, { actor: 'sentinel' });
        store.linkJob(owner, created.item.id, job);
        store.linkJob(owner, created.item.id, { ...job, processId: 'queue_remote', serverId: 'srv-b', kind: 'remote' });
        store.update(owner, created.item.id, 3, { notes: 'see PR', priority: 'high' }, 'user');
        const accepted = store.get(owner);
        handles.pop()!.close();
        const reloaded = reopen().get(owner);
        expect(reloaded).toEqual(accepted);
        expect(reloaded.revision).toBe(5);
        expect(reloaded.items.map(item => item.title)).toEqual(['Fix login', 'Second']);
        expect(reloaded.items[0]).toMatchObject({
            type: 'normal', notes: 'see PR', status: 'in_progress', revision: 4, priority: 'high',
            updatedBy: 'user', targetRepo: { workspaceId: 'ws-b', serverId: 'srv-b', label: 'web' },
        });
        expect(reloaded.items[0].jobs.map(link => link.processId)).toEqual(['queue_child', 'queue_remote']);
    });

    it('ignores stale and malformed sentinel-todos.json files without importing or modifying them', () => {
        const file = getRepoDataPath(dataDir, owner.workspaceId, 'sentinel-todos.json');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const stale = JSON.stringify({ version: 1, ledgers: { queue_parent: { revision: 99, items: [{ title: 'Stale' }] } } });
        fs.writeFileSync(file, stale);
        expect(reopen().get(owner)).toEqual({ revision: 0, items: [] });
        store.create(owner, { title: 'Fresh' }, { actor: 'user' });
        expect(fs.readFileSync(file, 'utf8')).toBe(stale);
        fs.writeFileSync(file, 'not JSON');
        expect(reopen().get(owner)).toMatchObject({ revision: 1, items: [{ title: 'Fresh' }] });
        expect(fs.readFileSync(file, 'utf8')).toBe('not JSON');
    });

    it('isolates owners for reads, writes, job results and idempotency', () => {
        const first = store.create(owner, { title: 'A' }, { actor: 'user', idempotencyKey: 'same' }).item;
        store.linkJob(owner, first.id, job);
        otherOwners.forEach((scope, index) => {
            const { item } = store.create(scope, { title: `Other ${index}` }, { actor: 'user', idempotencyKey: 'same' });
            expect(item.id).not.toBe(first.id);
            expectTodoError(() => store.update(scope, first.id, 2, { title: 'forged' }, 'user'), 'not_found');
            expectTodoError(() => store.linkJob(scope, first.id, job), 'not_found');
            expect(store.recordJobResult(scope, job.processId, { terminalEventId: 'e', outcome: 'failed' }, () => 'failed'))
                .toBeUndefined();
            expect(store.get(scope).items.map(entry => entry.title)).toEqual([`Other ${index}`]);
        });
        expect(store.get(owner).items.map(item => item.title)).toEqual(['A']);
        for (const scope of [{ ...owner, workspaceId: '' }, { ...owner, processId: '' }]) {
            expectTodoError(() => store.get(scope), 'invalid');
            expectTodoError(() => store.create(scope, { title: 'x' }, { actor: 'user' }), 'invalid');
        }
    });

    it('replays creation across independent handles without changing order or revisions', () => {
        const first = store.create(owner, { title: 'Ship it' }, { actor: 'sentinel', idempotencyKey: 'k1' });
        const retry = reopen().create(owner, { title: 'Ignored retry' }, { actor: 'user', idempotencyKey: 'k1' });
        expect(retry).toEqual({ ...first, created: false });
        expect(store.get(owner)).toEqual({ revision: 1, items: [first.item] });
        expectTodoError(() => store.create(owner, { title: 'x' }, { actor: 'user', idempotencyKey: '' }), 'invalid');
        expectTodoError(() => store.create(owner, { title: 'x' }, { actor: 'user', idempotencyKey: 'k'.repeat(201) }), 'invalid');
        expect(() => db.prepare(`INSERT INTO sentinel_todo_items
            SELECT workspace_id, parent_process_id, 'duplicate', 1, type, title, completion_condition,
                notes, target_repo, status, status_reason, priority, outcome, archived, revision,
                created_at, updated_at, created_by, updated_by, idempotency_key, user_edited_at, user_verdict_revision
            FROM sentinel_todo_items`).run()).toThrow();
    });

    it('rejects a stale revision from a second handle and returns the accepted item', () => {
        const second = reopen();
        const { item } = store.create(owner, { title: 'Draft' }, { actor: 'user' });
        expect(second.get(owner).items[0].revision).toBe(1);
        store.update(owner, item.id, 1, { title: 'User title' }, 'user');
        const error = expectTodoError(() => second.update(owner, item.id, 1, { title: 'Stale AI title' }, 'sentinel'), 'conflict');
        expect(error.current).toMatchObject({ title: 'User title', revision: 2 });
        expect(second.get(owner)).toEqual(store.get(owner));
        second.update(owner, item.id, 2, { notes: 'accepted' }, 'sentinel');
        expect(store.get(owner)).toMatchObject({ revision: 3, items: [{ title: 'User title', notes: 'accepted', revision: 3 }] });
    });

    it('caps items, including archived ones, while allowing idempotent replay at the limit', () => {
        const first = store.create(owner, { title: 'First' }, { actor: 'user', idempotencyKey: 'first' }).item;
        store.update(owner, first.id, 1, { archived: true }, 'user');
        for (let index = 1; index < MAX_TODO_ITEMS; index++) {
            store.create(owner, { title: `Item ${index}` }, { actor: 'user' });
        }
        const before = store.get(owner);
        expectTodoError(() => reopen().create(owner, { title: 'one more' }, { actor: 'user' }), 'limit');
        expect(store.create(owner, { title: 'retry' }, { actor: 'user', idempotencyKey: 'first' }).created).toBe(false);
        expect(store.get(owner)).toEqual(before);
        expect(store.create(otherOwners[0], { title: 'independent' }, { actor: 'user' }).created).toBe(true);
    });

    it.each(['sentinel_todo_items', 'sentinel_todo_ledgers'] as const)(
        'rolls back item creation and the new ledger when %s rejects a write', table => {
            failWrites(table, table === 'sentinel_todo_items' ? 'INSERT' : 'UPDATE');
            expect(() => store.create(owner, { title: 'New' }, { actor: 'user' })).toThrow('injected SQL failure');
            expect(store.get(owner)).toEqual({ revision: 0, items: [] });
            expect(db.prepare('SELECT * FROM sentinel_todo_ledgers').all()).toEqual([]);
            db.exec('DROP TRIGGER reject_write');
            expect(store.create(owner, { title: 'Retry' }, { actor: 'user' }).ledgerRevision).toBe(1);
        },
    );

    it('rolls back an item edit when the ledger CAS fails and remains usable', () => {
        const { item } = store.create(owner, { title: 'Before' }, { actor: 'user' });
        const before = store.get(owner);
        failWrites('sentinel_todo_ledgers');
        expect(() => store.update(owner, item.id, 1, { title: 'After' }, 'user')).toThrow('injected SQL failure');
        expect(reopen().get(owner)).toEqual(before);
        db.exec('DROP TRIGGER reject_write');
        expect(store.update(owner, item.id, 1, { title: 'Retry' }, 'user').ledgerRevision).toBe(2);
    });

    it.each(['sentinel_todo_items', 'sentinel_todo_ledgers'] as const)(
        'rejects a zero-row %s CAS and rolls back all related state', table => {
            const item = linkedItem();
            const before = store.get(owner);
            db.exec(`CREATE TRIGGER reject_cas BEFORE UPDATE ON ${table}
                BEGIN SELECT RAISE(IGNORE); END`);
            expectTodoError(() => store.recordJobResult(owner, job.processId, {
                terminalEventId: 'e', outcome: 'failed',
            }, () => 'failed'), 'conflict');
            expect(reopen().get(owner)).toEqual(before);
            db.exec('DROP TRIGGER reject_cas');
            expect(store.update(owner, item.id, item.revision, { notes: 'retry' }, 'user').item.revision).toBe(item.revision + 1);
        },
    );

    it('preserves a trigger-driven rollback error and accepts the next transaction', () => {
        const { item } = store.create(owner, { title: 'Before' }, { actor: 'user' });
        const before = store.get(owner);
        db.exec(`CREATE TRIGGER rollback_write BEFORE UPDATE ON sentinel_todo_ledgers
            BEGIN SELECT RAISE(ROLLBACK, 'trigger rollback'); END`);
        expect(() => store.update(owner, item.id, 1, { title: 'After' }, 'user')).toThrow('trigger rollback');
        expect(reopen().get(owner)).toEqual(before);
        db.exec('DROP TRIGGER rollback_write');
        expect(store.update(owner, item.id, 1, { title: 'Retry' }, 'user').ledgerRevision).toBe(2);
    });

    it('serializes genuinely simultaneous writers and detects stale edits across worker handles', async () => {
        const { item } = store.create(owner, { title: 'Before' }, { actor: 'user' });
        const moduleFile = path.join(dataDir, 'store.cjs');
        const { metafile } = await build({
            entryPoints: [fileURLToPath(new URL('../../../src/server/sentinel-todos/sentinel-todo-store.ts', import.meta.url))],
            outfile: moduleFile, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'es2022',
            alias: { '@plusplusoneplusplus/coc-client': fileURLToPath(new URL('../../../../coc-client/src/index.ts', import.meta.url)) },
            metafile: true,
        });
        expect(Object.values(metafile.outputs).flatMap(output => output.imports)).not.toContainEqual(
            expect.objectContaining({ path: '@plusplusoneplusplus/coc-client', external: true }),
        );
        const workers = [0, 1].map(index => new Worker(`
            const { parentPort, workerData } = require('node:worker_threads');
            const { NativeDatabase } = require('@plusplusoneplusplus/coc-native');
            const { SentinelTodoStore } = require(workerData.moduleFile);
            const db = new NativeDatabase(workerData.file);
            const store = new SentinelTodoStore(db);
            parentPort.postMessage('ready');
            parentPort.once('message', () => {
                try {
                    let edited = false;
                    try {
                        store.update(workerData.owner, workerData.itemId, 1, { notes: String(workerData.index) }, 'user');
                        edited = true;
                    } catch (error) { if (error.code !== 'conflict') throw error; }
                    for (let i = 0; i < 12; i++) {
                        store.create(workerData.owner, { title: 'worker-' + workerData.index + '-' + i }, { actor: 'user' });
                    }
                    const replay = store.create(workerData.owner, { title: 'once' }, { actor: 'user', idempotencyKey: 'shared' });
                    db.close();
                    parentPort.postMessage({ edited, created: replay.created });
                } catch (error) { parentPort.postMessage({ error: String(error) }); }
            });
        `, {
            eval: true, workerData: {
                file: path.join(dataDir, 'processes.db'), moduleFile, owner, itemId: item.id, index,
            },
        }));
        try {
            await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
                worker.once('message', () => resolve());
                worker.once('error', reject);
            })));
            const results = workers.map(worker => new Promise<{ edited: boolean; created: boolean; error?: string }>((resolve, reject) => {
                worker.once('message', resolve);
                worker.once('error', reject);
            }));
            workers.forEach(worker => worker.postMessage('go'));
            for (let index = 0; index < 30; index++) {
                const snapshot = store.get(owner);
                expect(snapshot.revision).toBe(snapshot.items.reduce((total, entry) => total + entry.revision, 0));
                await new Promise<void>(resolve => setImmediate(resolve));
            }
            const completed = await Promise.all(results);
            expect(completed.every(result => !result.error)).toBe(true);
            expect(completed.filter(result => result.edited)).toHaveLength(1);
            expect(completed.filter(result => result.created)).toHaveLength(1);
            const accepted = store.get(owner);
            expect(accepted.revision).toBe(27);
            expect(accepted.items).toHaveLength(26);
            expect(accepted.items[0].revision).toBe(2);
            expect(new Set(accepted.items.map(entry => entry.id)).size).toBe(26);
        } finally {
            await Promise.all(workers.map(worker => worker.terminate()));
        }
    }, 20_000);
});

describe('SentinelTodoStore validation and verdict semantics', () => {
    it('validates every caller actor, including idempotent retries', () => {
        const { item } = store.create(owner, { title: 'valid' }, { actor: 'user', idempotencyKey: 'key' });
        const before = store.get(owner);
        for (const actor of ['system', 'forged', undefined] as unknown as SentinelTodoActor[]) {
            expectTodoError(() => store.create(owner, { title: 'x' }, { actor }), 'invalid');
            expectTodoError(() => store.create(owner, { title: 'x' }, { actor, idempotencyKey: 'key' }), 'invalid');
            expectTodoError(() => store.update(owner, item.id, 1, { title: 'x' }, actor), 'invalid');
        }
        expect(store.get(owner)).toEqual(before);
    });

    it('validates inputs and unknown items without writes', () => {
        for (const input of [
            { title: '  ' }, { title: 'x', status: 'closed' }, { title: 'x', extra: 1 },
            { title: 'x', priority: 'urgent' }, { title: 'x', type: 'other' }, { title: 'x', type: null },
        ]) expectTodoError(() => store.create(owner, input as never, { actor: 'user' }), 'invalid');
        expectTodoError(() => store.update(owner, 'missing', 1, { title: 'y' }, 'user'), 'not_found');
        const { item } = store.create(owner, { title: 'x' }, { actor: 'user' });
        for (const patch of [{ archived: 'yes' }, { priority: 'low' }, { priority: null }, { type: 'manual' }]) {
            expectTodoError(() => store.update(owner, item.id, 1, patch as never, 'user'), 'invalid');
        }
        expect(store.get(owner)).toMatchObject({ revision: 1, items: [{ revision: 1 }] });
    });

    it('archives and restores without deleting notes or outcomes', () => {
        const { item } = store.create(owner, { title: 'T', notes: 'keep me' }, { actor: 'user' });
        const done = store.update(owner, item.id, 1, { status: 'done', statusReason: 'Tests pass', outcome: 'All green' }, 'sentinel');
        expect(done.item.outcome).toMatchObject({ summary: 'All green', recordedBy: 'sentinel' });
        store.update(owner, item.id, 2, { archived: true }, 'user');
        expect(reopen().get(owner).items[0]).toMatchObject({ archived: true, status: 'done', notes: 'keep me', statusReason: 'Tests pass' });
        expect(store.update(owner, item.id, 3, { archived: false }, 'user').item)
            .toMatchObject({ archived: false, notes: 'keep me', outcome: { summary: 'All green' } });
    });

    it('clears stale reasons and nullable fields, and drops an earlier outcome on a fresh Done', () => {
        const { item } = store.create(owner, {
            title: 'T', status: 'needs_attention', statusReason: 'Job failed', targetRepo: { workspaceId: 'ws-b' },
        }, { actor: 'sentinel' });
        const reopened = store.update(owner, item.id, 1, { status: 'in_progress', targetRepo: null }, 'user');
        expect(reopened.item.statusReason).toBeUndefined();
        expect(reopened.item.targetRepo).toBeUndefined();
        store.update(owner, item.id, 2, { status: 'done', statusReason: 'Old review', outcome: 'Old outcome' }, 'sentinel');
        store.update(owner, item.id, 3, { status: 'needs_attention', statusReason: 'Regressed' }, 'sentinel');
        const done = store.update(owner, item.id, 4, { status: 'done', statusReason: null }, 'user');
        expect(done.item.statusReason).toBeUndefined();
        expect(done.item.outcome).toBeUndefined();
        expect(done.item.userEditedAt).toBe(done.item.updatedAt);
        expect(done.item.userVerdictRevision).toBe(5);
        store.update(owner, item.id, 5, { outcome: 'Checked', statusReason: 'Checked' }, 'user');
        expect(reopen().get(owner).items[0].outcome).toMatchObject({ recordedBy: 'user', summary: 'Checked' });
        expect(store.update(owner, item.id, 6, { outcome: null, statusReason: null }, 'user').item.outcome).toBeUndefined();
    });

    it.each(['normal', 'manual'] as const)('requires sentinel evidence for %s Done/Needs attention but allows user Done', type => {
        const { item } = store.create(owner, { type, title: 'T' }, { actor: 'user' });
        for (const status of ['done', 'needs_attention'] as const) {
            for (const statusReason of [undefined, null, '  ']) {
                expectTodoError(() => store.update(owner, item.id, 1, { status, statusReason }, 'sentinel'), 'invalid');
            }
            expectTodoError(() => store.create(owner, { type, title: 'x', status }, { actor: 'sentinel' }), 'invalid');
        }
        expect(store.update(owner, item.id, 1, { status: 'done' }, 'user').item.status).toBe('done');
    });

    it('treats priority as metadata without changing status/review evidence or superseding linked work', () => {
        const item = linkedItem();
        expect(item.priority).toBe('regular');
        const raised = store.update(owner, item.id, item.revision, { priority: 'high' }, 'user');
        expect(raised.item.userEditedAt).toBeUndefined();
        expect(raised.item.userVerdictRevision).toBeUndefined();
        const failed = store.recordJobResult(owner, job.processId, { terminalEventId: 'e1', outcome: 'failed' }, () => 'failed')!;
        expect(failed.item).toMatchObject({ status: 'needs_attention', priority: 'high' });
        const reviewed = store.update(owner, item.id, failed.item.revision, {
            status: 'done', statusReason: 'Checked', outcome: 'All green',
        }, 'sentinel');
        const lowered = store.update(owner, item.id, reviewed.item.revision, { priority: 'regular' }, 'sentinel');
        expect(lowered.item).toMatchObject({
            status: 'done', statusReason: 'Checked', outcome: reviewed.item.outcome,
            createdAt: item.createdAt, createdBy: 'user', priority: 'regular',
        });
        expectTodoError(() => store.update(owner, item.id, reviewed.item.revision, { priority: 'high' }, 'user'), 'conflict');
    });
});

describe('SentinelTodoStore jobs and atomic reviews', () => {
    it('keys links by job process and server, preserves order and enforces the job limit', () => {
        const item = linkedItem();
        const before = store.get(owner);
        expect(store.linkJob(owner, item.id, { ...job, title: 'Ignored retry' }).changed).toBe(false);
        expect(store.get(owner)).toEqual(before);
        store.linkJob(owner, item.id, { ...job, serverId: 'remote-a', kind: 'remote' });
        store.linkJob(owner, item.id, { ...job, serverId: 'remote-b', kind: 'remote' });
        for (let index = 3; index < MAX_TODO_JOB_LINKS; index++) {
            store.linkJob(owner, item.id, { ...job, processId: `child-${index}` });
        }
        const capped = store.get(owner);
        expectTodoError(() => store.linkJob(owner, item.id, { ...job, processId: 'extra' }), 'limit');
        expect(store.linkJob(owner, item.id, job).changed).toBe(false);
        expect(reopen().get(owner)).toEqual(capped);
        expect(capped.items[0].jobs.slice(0, 3).map(link => link.serverId)).toEqual([undefined, 'remote-a', 'remote-b']);
    });

    it.each(['completed', 'failed', 'cancelled', 'capped'] as const)('records only the first %s terminal result and never auto-completes', outcome => {
        const item = linkedItem();
        const first = store.recordJobResult(owner, job.processId, { terminalEventId: 'e1', outcome, reason: 'detail' }, () => 'job ended')!;
        expect(first.item).toMatchObject({ status: outcome === 'completed' ? 'in_progress' : 'needs_attention', updatedBy: 'system' });
        expect(first.item.jobs[0].result).toMatchObject({ terminalEventId: 'e1', outcome, reason: 'detail' });
        const before = store.get(owner);
        expect(store.recordJobResult(owner, job.processId, { terminalEventId: 'e2', outcome: 'failed' }, () => 'again')).toBeUndefined();
        expect(store.recordJobResult(owner, 'unknown', { terminalEventId: 'e3', outcome }, () => 'unknown')).toBeUndefined();
        expect(reopen().get(owner)).toEqual(before);
        expect(first.item.revision).toBe(item.revision + 1);
    });

    it('ignores remote terminal results and preserves explicit user verdicts and later successful attempts', () => {
        const item = linkedItem();
        store.linkJob(owner, item.id, { ...job, processId: 'remote', serverId: 'srv-a', kind: 'remote' });
        expect(store.recordJobResult(owner, 'remote', { terminalEventId: 'e', outcome: 'failed' }, () => 'remote')).toBeUndefined();
        const latest = store.linkJob(owner, item.id, { ...job, processId: 'new-attempt' }).item;
        store.recordJobResult(owner, 'new-attempt', { terminalEventId: 'new', outcome: 'completed' }, () => 'done');
        const older = store.recordJobResult(owner, job.processId, { terminalEventId: 'old', outcome: 'failed' }, () => 'failed')!;
        expect(older.item.status).toBe('in_progress');
        const done = store.update(owner, item.id, older.item.revision, { status: 'done' }, 'user').item;
        expect(done.userVerdictRevision).toBeGreaterThan(latest.revision);
        expectTodoError(() => store.update(owner, item.id, done.revision, {
            status: 'needs_attention', statusReason: 'stale',
            reviewedJobs: [{ processId: job.processId, terminalEventId: 'old' }],
        }, 'sentinel'), 'invalid');
        expectTodoError(() => store.update(owner, item.id, done.revision, {
            status: 'needs_attention', statusReason: 'stale',
        }, 'sentinel'), 'invalid');
        expect(store.get(owner).items[0]).toEqual(done);
    });

    it.each(['archived', 'done', 'edited'] as const)('records failed evidence but preserves a user-%s item', change => {
        const item = linkedItem();
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date(Date.parse(item.updatedAt) + 1_000));
            const updated = store.update(owner, item.id, item.revision,
                change === 'archived' ? { archived: true } : change === 'done' ? { status: 'done' } : { notes: 'user change' }, 'user').item;
            const result = store.recordJobResult(owner, job.processId, { terminalEventId: 'e', outcome: 'failed' }, () => 'failed')!;
            expect(result.item.status).toBe(updated.status);
            expect(result.item.archived).toBe(updated.archived);
            expect(result.item.jobs[0].result?.outcome).toBe('failed');
        } finally { vi.useRealTimers(); }
    });

    it('requires exact local terminal evidence and an explicit reviewed verdict', () => {
        const item = linkedItem();
        const result = store.recordJobResult(owner, job.processId, { terminalEventId: 'e', outcome: 'completed' }, () => 'done')!;
        const evidence = [{ processId: job.processId, terminalEventId: 'e' }];
        const before = store.get(owner);
        for (const patch of [
            { reviewedJobs: evidence },
            { status: 'in_progress', reviewedJobs: evidence },
            { status: 'done', statusReason: 'checked', reviewedJobs: [{ processId: job.processId, terminalEventId: 'wrong' }] },
        ]) expectTodoError(() => store.update(owner, item.id, result.item.revision, patch as never, 'sentinel'), 'invalid');
        store.update(owner, item.id, result.item.revision, { notes: 'unrelated' }, 'sentinel');
        expect(store.get(owner).items[0].jobs[0].result?.reviewed).toBeUndefined();
        const accepted = store.update(owner, item.id, result.item.revision + 1, {
            status: 'done', statusReason: 'Tested', outcome: 'Verified', reviewedJobs: evidence,
        }, 'sentinel');
        expect(accepted.item.jobs[0].result?.reviewed).toMatchObject({ recordedBy: 'sentinel', recordedAt: accepted.item.updatedAt });
        expect(reopen().get(owner)).toEqual({ revision: before.revision + 2, items: [accepted.item] });
    });

    it('rolls back linked jobs, terminal results and review evidence together with item and ledger state', () => {
        const { item } = store.create(owner, { title: 'T' }, { actor: 'user' });
        const beforeLink = store.get(owner);
        failWrites('sentinel_todo_jobs', 'INSERT');
        expect(() => store.linkJob(owner, item.id, job)).toThrow('injected SQL failure');
        expect(reopen().get(owner)).toEqual(beforeLink);
        db.exec('DROP TRIGGER reject_write');
        const linked = store.linkJob(owner, item.id, job).item;
        const beforeResult = store.get(owner);
        failWrites('sentinel_todo_ledgers');
        expect(() => store.recordJobResult(owner, job.processId, { terminalEventId: 'e', outcome: 'failed' }, () => 'failed'))
            .toThrow('injected SQL failure');
        expect(reopen().get(owner)).toEqual(beforeResult);
        db.exec('DROP TRIGGER reject_write');
        const recorded = store.recordJobResult(owner, job.processId, { terminalEventId: 'e', outcome: 'failed' }, () => 'failed')!;
        expect(recorded.item.revision).toBe(linked.revision + 1);
        const beforeReview = store.get(owner);
        failWrites('sentinel_todo_jobs');
        expect(() => store.update(owner, item.id, recorded.item.revision, {
            status: 'done', statusReason: 'checked', reviewedJobs: [{ processId: job.processId, terminalEventId: 'e' }],
        }, 'sentinel')).toThrow('injected SQL failure');
        expect(reopen().get(owner)).toEqual(beforeReview);
        db.exec('DROP TRIGGER reject_write');
        expect(() => store.recordJobResult(owner, 'unknown', { terminalEventId: 'e2', outcome: 'failed' }, () => 'fail')).not.toThrow();
    });

    it('rolls back when describing or validating a terminal result fails', () => {
        linkedItem();
        const before = store.get(owner);
        expect(() => store.recordJobResult(owner, job.processId, { terminalEventId: 'e', outcome: 'failed' }, () => { throw new Error('description failed'); }))
            .toThrow('description failed');
        expectTodoError(() => store.recordJobResult(owner, job.processId, { terminalEventId: '', outcome: 'failed' }, () => 'failed'), 'invalid');
        expect(store.get(owner)).toEqual(before);
    });
});

describe('SentinelTodoStore manual invariants', () => {
    it('persists title-only manual defaults and rejects all type changes', () => {
        const { item } = store.create(owner, { type: 'manual', title: 'Check release' }, { actor: 'user' });
        expect(item).toMatchObject({
            type: 'manual', status: 'todo', priority: 'regular', completionCondition: '', notes: '',
            archived: false, jobs: [], revision: 1,
        });
        store.update(owner, item.id, 1, { notes: 'Read release notes', priority: 'high' }, 'user');
        expect(reopen().get(owner)).toMatchObject({ revision: 2, items: [{ type: 'manual', priority: 'high', revision: 2 }] });
        for (const type of ['manual', 'normal', null]) {
            expectTodoError(() => store.update(owner, item.id, 2, { type } as never, 'user'), 'invalid');
        }
    });

    it('allows only the user to archive/restore a manual item', () => {
        const { item } = store.create(owner, { type: 'manual', title: 'Check rollout' }, { actor: 'sentinel' });
        const before = store.get(owner);
        for (const archived of [true, false]) {
            expectTodoError(() => store.update(owner, item.id, 1, { archived, notes: 'forged' }, 'sentinel'), 'invalid');
        }
        expect(store.get(owner)).toEqual(before);
        const archived = store.update(owner, item.id, 1, { archived: true }, 'user').item;
        expectTodoError(() => store.update(owner, item.id, archived.revision, { archived: false }, 'sentinel'), 'invalid');
        expect(store.update(owner, item.id, archived.revision, { archived: false }, 'user').item)
            .toMatchObject({ type: 'manual', archived: false, revision: 3 });
    });

    it.each(['local', 'remote', 'ralph'] as const)('rejects %s jobs on manual items without any durable changes', kind => {
        const { item } = store.create(owner, { type: 'manual', title: 'Check rollout' }, { actor: 'user' });
        const before = store.get(owner);
        expectTodoError(() => store.linkJob(owner, item.id, {
            ...job, kind, ...(kind === 'remote' ? { serverId: 'srv-a' } : {}),
            ...(kind === 'ralph' ? { sessionId: 'ralph-a' } : {}),
        }), 'invalid');
        expect(store.recordJobResult(owner, job.processId, { terminalEventId: 'e', outcome: 'failed' }, () => 'failed')).toBeUndefined();
        expect(store.get(owner)).toEqual(before);
        expect(db.prepare('SELECT * FROM sentinel_todo_jobs').all()).toEqual([]);
    });
});

describe('Sentinel to-do snapshot policy', () => {
    it('borrows a real process store database without changing process data or its schema version', async () => {
        const processes = new SqliteProcessStore({ dbPath: path.join(dataDir, 'shared-processes.db') });
        try {
            await processes.addProcess({
                id: owner.processId, type: 'clarification', promptPreview: 'retained conversation',
                fullPrompt: 'retained conversation', status: 'completed', startTime: new Date(),
                metadata: { mode: 'sentinel', workspaceId: owner.workspaceId },
            });
            await processes.addProcess({
                id: 'unrelated-process', type: 'clarification', promptPreview: 'unrelated conversation',
                fullPrompt: 'unrelated conversation', status: 'completed', startTime: new Date(),
                metadata: { mode: 'ask', workspaceId: 'ws-b' },
            });
            const shared = processes.getDatabase();
            const version = shared.pragma('user_version', { simple: true });
            const rows = shared.prepare('SELECT * FROM processes ORDER BY id').all();
            const schema = shared.prepare(`SELECT name, sql FROM sqlite_master
                WHERE tbl_name NOT LIKE 'sentinel_todo_%' ORDER BY name`).all();
            const todos = new SentinelTodoStore(shared);
            const { item } = todos.create(owner, { title: 'Local ledger' }, { actor: 'user' });
            todos.linkJob(owner, item.id, job);
            const context = { dataDir, store: processes, includeWikis: false };
            const domain = createSentinelTodosDomain();
            const errors = { errors: [] as string[] };
            await domain.executeWipe(context, (await domain.planWipe(context)).plan, errors);
            expect(errors.errors).toEqual([]);
            expect(todos.get(owner)).toEqual({ revision: 0, items: [] });
            expect(shared.pragma('user_version', { simple: true })).toBe(version);
            expect(shared.prepare('SELECT * FROM processes ORDER BY id').all()).toEqual(rows);
            expect(shared.prepare(`SELECT name, sql FROM sqlite_master
                WHERE tbl_name NOT LIKE 'sentinel_todo_%' ORDER BY name`).all()).toEqual(schema);
            expect(await processes.getProcess(owner.processId)).toMatchObject({ fullPrompt: 'retained conversation' });
            expect(await processes.getProcess('unrelated-process')).toMatchObject({ fullPrompt: 'unrelated conversation' });
            expect(todos.create(owner, { title: 'After wipe' }, { actor: 'user' }).ledgerRevision).toBe(1);
        } finally { processes.close(); }
    });

    it('never exports/restores ledgers and wipes all three SQL tables with server data', async () => {
        const item = linkedItem();
        store.recordJobResult(owner, job.processId, { terminalEventId: 'e', outcome: 'failed' }, () => 'failed');
        store.create(otherOwners[0], { title: 'Other ledger' }, { actor: 'user' });
        expect(createSnapshotDomains().map(domain => domain.id)).toContain('sentinel-todos');
        const domain = createSentinelTodosDomain();
        const context = { dataDir, includeWikis: false } as StorageSnapshotContext & { includeWikis: boolean };
        expect(await domain.collect(context)).toEqual({ data: {}, metadata: {}, warnings: [] });
        const before = store.get(owner);
        const restoreResult = { errors: [] };
        await domain.restoreReplace({} as never, context, restoreResult as never);
        await domain.restoreMerge({} as never, context, restoreResult as never);
        expect(store.get(owner)).toEqual(before);
        const wipe = await domain.planWipe(context);
        expect(wipe.plan).toEqual([]);
        const errors = { errors: [] as string[] };
        const version = db.pragma('user_version', { simple: true });
        db.exec('CREATE TABLE retained_feature (value TEXT); INSERT INTO retained_feature VALUES (\'retained\')');
        await domain.executeWipe(context, wipe.plan, errors);
        expect(errors.errors).toEqual([]);
        for (const table of ['sentinel_todo_jobs', 'sentinel_todo_items', 'sentinel_todo_ledgers']) {
            expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
        }
        expect(reopen().get(owner)).toEqual({ revision: 0, items: [] });
        expect(store.get(otherOwners[0]).items).toEqual([]);
        expect(db.prepare('SELECT value FROM retained_feature').get()).toEqual({ value: 'retained' });
        expect(db.pragma('user_version', { simple: true })).toBe(version);
        expectTodoError(() => store.update(owner, item.id, 1, { notes: 'missing' }, 'user'), 'not_found');
    });
});

describe('SentinelTodoService', () => {
    const processes: Record<string, { mode: string; workspaceId: string }> = {
        queue_parent: { mode: 'sentinel', workspaceId: 'ws-a' },
        queue_ask: { mode: 'ask', workspaceId: 'ws-a' },
    };
    const makeService = (overrides: Partial<ConstructorParameters<typeof SentinelTodoService>[0]> = {}) => new SentinelTodoService({
        todos: store,
        store: { getProcess: async (id: string) => processes[id] ? { id, metadata: processes[id] } as never : undefined },
        ...overrides,
    });

    it('rejects non-Sentinel chats and forged parent workspaces', async () => {
        const service = makeService();
        await expect(service.list({ workspaceId: 'ws-a', processId: 'queue_ask' })).rejects.toMatchObject({ code: 'not_found' });
        const forged: SentinelTodoOwner = { workspaceId: 'ws-b', processId: 'queue_parent' };
        await expect(service.list(forged)).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.create(forged, { title: 'x' }, { actor: 'sentinel' })).rejects.toMatchObject({ code: 'not_found' });
        expect(store.get(forged).items).toEqual([]);
    });

    it('checks loaded processes without the owner projection and never treats metadata-free ones as queued', async () => {
        const getTask = vi.fn(() => ({ type: 'chat', status: 'queued', repoId: 'ws-a', payload: { kind: 'chat', mode: 'sentinel' } }) as never);
        const service = makeService({ getTask, store: { getProcess: async (id: string) => ({ id }) as never } });
        await expect(service.list({ workspaceId: 'ws-a', processId: 'queue_bare' })).rejects.toMatchObject({ code: 'not_found' });
        expect(getTask).not.toHaveBeenCalled();
        await expect(makeService().list(owner)).resolves.toMatchObject({ items: [] });
    });

    it('accepts a Sentinel whose first turn is still queued', async () => {
        const service = makeService({
            getTask: (taskId: string) => taskId === 'live' ? {
                type: 'chat', status: 'queued', repoId: 'ws-a', payload: { kind: 'chat', mode: 'sentinel' },
            } as never : undefined,
        });
        await expect(service.create({ workspaceId: 'ws-a', processId: 'queue_live' }, { title: 'x' }, { actor: 'user' }))
            .resolves.toMatchObject({ created: true });
    });

    it('emits changes only after committed writes, not replays, conflicts or SQL failures', async () => {
        const onChange = vi.fn();
        const service = makeService({ onChange });
        const first = await service.create(owner, { title: 'x' }, { actor: 'user', idempotencyKey: 'k' });
        await service.create(owner, { title: 'x' }, { actor: 'user', idempotencyKey: 'k' });
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenLastCalledWith({ owner, ledgerRevision: 1, item: first.item });
        await expect(service.update(owner, first.item.id, 99, { title: 'y' }, 'user')).rejects.toMatchObject({ code: 'conflict' });
        failWrites('sentinel_todo_ledgers');
        await expect(service.update(owner, first.item.id, 1, { title: 'y' }, 'user')).rejects.toThrow('injected SQL failure');
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(store.get(owner).items[0]).toEqual(first.item);
    });

    it('still reports success when the change notification throws', async () => {
        const service = makeService({ onChange: () => { throw new Error('ws down'); } });
        await expect(service.create(owner, { title: 'x' }, { actor: 'user' })).resolves.toMatchObject({ created: true });
    });
});


describe('linked job mode projection', () => {
    let processes: SqliteProcessStore;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let onChange: ReturnType<typeof vi.fn>;
    let queueMode: unknown;
    let queueWorkspace: string;
    let queueStatus: string;
    beforeEach(async () => {
        processes = new SqliteProcessStore({ dbPath: path.join(dataDir, 'mode-processes.db') });
        await processes.addProcess({ id: owner.processId, type: 'clarification', status: 'completed',
            startTime: new Date(), metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' } });
        todos = new SentinelTodoStore(processes.getDatabase());
        onChange = vi.fn(); queueMode = 'ask'; queueWorkspace = 'ws-child'; queueStatus = 'queued';
        service = new SentinelTodoService({ todos, store: processes, onChange,
            getTask: () => ({ type: 'chat', status: queueStatus, repoId: queueWorkspace,
                payload: { kind: 'chat', workspaceId: queueWorkspace, mode: queueMode } }) as never });
    });
    afterEach(() => processes.close());
    function link(overrides: Partial<SentinelTodoJobLinkInput> = {}) {
        const { item } = todos.create(owner, { title: 'Feature' }, { actor: 'user' });
        todos.linkJob(owner, item.id, { processId: 'queue_child', workspaceId: 'ws-child', kind: 'local',
            openLink: '#repos/ws-child/chats/child', ...overrides });
        return item.id;
    }
    async function addChild(mode: unknown, workspaceId = 'ws-child') {
        await processes.addProcess({ id: 'queue_child', type: 'clarification', status: 'completed',
            startTime: new Date(), metadata: { workspaceId, mode } });
    }
    async function read() { return (await service.list(owner)).items[0].jobs[0]; }

    it.each(['ask', 'autopilot', 'ralph', 'plan'] as const)('projects queued and completed %s without child hydration', async mode => {
        link(); queueMode = mode;
        expect(await read()).toMatchObject({ mode: mode === 'plan' ? 'ask' : mode, execution: { state: 'queued' } });
        await addChild(mode);
        const hydrate = vi.spyOn(processes, 'getProcess');
        expect((await read()).mode).toBe(mode === 'plan' ? 'ask' : mode);
        expect(hydrate).not.toHaveBeenCalled();
    });
    it('proves owners from the transcript-free projection without weakening rejection', async () => {
        const hydrate = vi.spyOn(processes, 'getProcess');
        const projection = vi.spyOn(processes, 'getProcessOwnerProjection');
        await expect(service.list(owner)).resolves.toMatchObject({ items: [] });
        await processes.addProcess({ id: 'queue_ask', type: 'clarification', status: 'completed',
            startTime: new Date(), metadata: { workspaceId: owner.workspaceId, mode: 'ask' } });
        queueMode = 'sentinel'; queueWorkspace = owner.workspaceId; queueStatus = 'running';
        // A stored non-Sentinel process wins over live queue metadata.
        await expect(service.list({ ...owner, processId: 'queue_ask' })).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.list({ ...owner, workspaceId: 'ws-forged' })).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.list({ ...owner, processId: 'queue_first' })).resolves.toMatchObject({ items: [] });
        queueStatus = 'completed';
        await expect(service.list({ ...owner, processId: 'queue_missing' })).rejects.toMatchObject({ code: 'not_found' });
        expect(projection).toHaveBeenCalledTimes(5);
        expect(hydrate).not.toHaveBeenCalled();
    });
    it('batch-projects different linked job modes with one query and no per-job hydration', async () => {
        const itemId = link(); await addChild('ask');
        await processes.addProcess({ id: 'queue_second', type: 'clarification', status: 'completed',
            startTime: new Date(), metadata: { workspaceId: 'ws-child', mode: 'autopilot' } });
        todos.linkJob(owner, itemId, { ...job, processId: 'queue_second', workspaceId: 'ws-child' });
        const projection = vi.spyOn(todos, 'getJobModeProjections');
        const hydration = vi.spyOn(processes, 'getProcess');
        expect((await service.list(owner)).items[0].jobs.map(job => job.mode)).toEqual(['ask', 'autopilot']);
        expect(projection).toHaveBeenCalledOnce();
        expect(hydration).not.toHaveBeenCalled();
    });
    it('uses persisted follow-up mode over original admission and preserves revisions after reload', async () => {
        const itemId = link(); await addChild('ask');
        expect((await read()).mode).toBe('ask');
        const { item: second } = todos.create(owner, { title: 'Same conversation' }, { actor: 'user' });
        todos.linkJob(owner, second.id, { ...job, workspaceId: 'ws-child' });
        const before = todos.get(owner);
        await processes.updateProcess('queue_child', { metadata: { workspaceId: 'ws-child', mode: 'autopilot' } });
        service.notifyJobModeChanged('queue_child', 'ws-child');
        expect(onChange).toHaveBeenCalledOnce();
        expect(onChange).toHaveBeenCalledWith({ owner, item: before.items[0], ledgerRevision: before.revision });
        expect((await read()).mode).toBe('autopilot');
        todos = new SentinelTodoStore(processes.getDatabase());
        service = new SentinelTodoService({ todos, store: processes });
        expect((await read()).mode).toBe('autopilot');
        expect(todos.get(owner)).toEqual(before);
        expect(todos.get(owner).items[0].id).toBe(itemId);
    });
    it.each([undefined, 'future-mode', 'sentinel'])('keeps persisted unknown/unsupported %s honest despite a known admission mode', async mode => {
        link(); queueMode = 'autopilot'; await addChild(mode);
        expect((await read()).mode).toBeUndefined();
    });
    it('rejects wrong workspace processes and queues, and ignores expired admission metadata', async () => {
        link(); queueWorkspace = 'wrong'; expect((await read()).mode).toBeUndefined();
        queueWorkspace = 'ws-child'; queueStatus = 'completed'; expect((await read()).mode).toBeUndefined();
        queueStatus = 'running'; queueMode = 'autopilot'; await addChild('ask', 'wrong');
        expect((await read()).mode).toBeUndefined();
        service.notifyJobModeChanged('queue_child', 'wrong'); expect(onChange).not.toHaveBeenCalled();
    });
    it('does not borrow local mode for a remote collision; Ralph session identity survives remote ownership', async () => {
        link({ kind: 'remote', serverId: 'srv-2' }); await addChild('autopilot');
        expect(await read()).toMatchObject({ execution: { state: 'unavailable' } });
        expect((await read()).mode).toBeUndefined();
        service.notifyJobModeChanged('queue_child', 'ws-child'); expect(onChange).not.toHaveBeenCalled();
        const { item } = todos.create(owner, { title: 'Ralph' }, { actor: 'user' });
        todos.linkJob(owner, item.id, { ...job, kind: 'remote', serverId: 'srv-2', sessionId: 'session-1' });
        expect((await service.list(owner)).items[1].jobs[0].mode).toBe('ralph');
    });
    it('supports group parents and member execution workspaces without inventing a manual item mode', async () => {
        const groupOwner = { workspaceId: 'group-a', processId: 'queue_group' };
        await processes.addProcess({ id: groupOwner.processId, type: 'clarification', status: 'completed',
            startTime: new Date(), metadata: { workspaceId: groupOwner.workspaceId, mode: 'sentinel' } });
        const { item } = todos.create(groupOwner, { title: 'Group feature' }, { actor: 'user' });
        todos.linkJob(groupOwner, item.id, { ...job, workspaceId: 'ws-child' });
        todos.create(groupOwner, { title: 'Manual', type: 'manual' }, { actor: 'user' });
        await addChild('autopilot');
        const ledger = await service.list(groupOwner);
        expect(ledger.items[0].jobs[0].mode).toBe('autopilot'); expect(ledger.items[1].jobs).toEqual([]);
        service.notifyJobModeChanged('queue_child', 'ws-child');
        expect(onChange.mock.calls[0][0].owner).toEqual(groupOwner);
    });
});

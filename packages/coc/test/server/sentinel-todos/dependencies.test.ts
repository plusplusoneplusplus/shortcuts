import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    MAX_TODO_DEPENDENCIES, SentinelTodoError, SentinelTodoStore,
    type SentinelTodoDependency,
} from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';
import { createTodoTestDatabase, failTodoWrites } from './test-db';

const owner = { workspaceId: 'ws-parent', processId: 'queue_parent' };
const done = (itemId: string): SentinelTodoDependency => ({ itemId, condition: { kind: 'done' } });

describe('Sentinel dependency graph storage', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let store: SentinelTodoStore;
    const create = (title: string, workspaceId = 'ws-a', type: 'normal' | 'manual' = 'normal') =>
        store.create(owner, { title, type, targetRepo: { workspaceId } }, { actor: 'user' }).item;
    const reject = (operation: () => unknown, code = 'invalid') => {
        try { operation(); } catch (error) {
            expect(error).toBeInstanceOf(SentinelTodoError);
            expect(error).toMatchObject({ code });
            return;
        }
        throw new Error('Expected graph mutation to fail');
    };

    beforeEach(() => {
        database = createTodoTestDatabase(fs.mkdtempSync(path.join(process.cwd(), '.sentinel-dependencies-test-')));
        database.db.pragma('journal_mode = WAL');
        store = new SentinelTodoStore(database.db);
    });
    afterEach(() => database.dispose());

    it('persists ordered typed edges across execution workspaces and reopen, without changing fulfillment', () => {
        const prerequisite = create('Code', 'ws-a');
        const design = create('Design', 'ws-b', 'manual');
        const initial = create('Ship', 'ws-b');
        const item = store.update(owner, initial.id, 1, {
            status: 'done', statusReason: 'User verdict', notes: 'Keep notes', outcome: 'Keep outcome',
        }, 'user').item;
        const edges: SentinelTodoDependency[] = [
            { itemId: prerequisite.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } },
            { itemId: design.id, condition: {
                kind: 'accepted_artifact', phase: 'design', reference: 'notes/design.md', version: 'sha256:version',
            } },
        ];
        const result = store.setDependencies(owner, item.id, item.revision, edges, 'sentinel');
        expect(result.item).toEqual({ ...item, dependsOn: edges, revision: item.revision + 1,
            updatedAt: expect.any(String), updatedBy: 'sentinel' });
        expect(result.ledgerRevision).toBe(5);
        database.close();
        const reopened = createTodoTestDatabase(database.dataDir);
        try {
            expect(new SentinelTodoStore(reopened.db).get(owner).items[2]).toEqual(result.item);
        } finally { reopened.close(); }
    });

    it('retains edges during ordinary edits and removes them only with the current revision', () => {
        const source = create('Source');
        const item = create('Dependent');
        store.setDependencies(owner, item.id, 1, [done(source.id)], 'user');
        const edited = store.update(owner, item.id, 2, { notes: 'Edited' }, 'user').item;
        expect(edited.dependsOn).toEqual([done(source.id)]);
        reject(() => store.setDependencies(owner, item.id, 2, [], 'user'), 'conflict');
        const removed = store.setDependencies(owner, item.id, 3, [], 'user').item;
        expect(removed.dependsOn).toEqual([]);
        expect(store.get(owner).items[1]).toEqual(removed);
        expect(removed.notes).toBe('Edited');
        expect(removed.userEditedAt).toBe(edited.userEditedAt);
        expect(removed.userVerdictRevision).toBe(edited.userVerdictRevision);
    });

    it('rejects self, duplicate, missing, archived and foreign-ledger edges atomically', () => {
        const item = create('Dependent');
        const source = create('Source');
        const archived = store.update(owner, source.id, 1, { archived: true }, 'user').item;
        const foreignOwners = [
            { ...owner, processId: 'queue_other' },
            { ...owner, workspaceId: 'ws-other' },
        ];
        const foreignIds = foreignOwners.map(scope =>
            store.create(scope, { title: 'Private' }, { actor: 'user' }).item.id);
        for (const edges of [
            [done(item.id)], [done(item.id), done(item.id)], [done('missing')],
            [done(archived.id)], ...foreignIds.map(id => [done(id)]),
        ]) {
            const before = store.get(owner);
            reject(() => store.setDependencies(owner, item.id, 1, edges, 'user'));
            expect(store.get(owner)).toEqual(before);
        }
        const active = create('Active');
        reject(() => store.setDependencies(owner, item.id, 1, [done(active.id), {
            itemId: active.id, condition: { kind: 'pr_merge', outputSlot: 'different-condition' },
        }], 'user'));
        reject(() => store.setDependencies(foreignOwners[0], item.id, 1, [], 'user'), 'not_found');
    });

    it('rejects direct and indirect cycles while permitting a shared prerequisite diamond', () => {
        const a = create('A');
        const b = create('B');
        const c = create('C');
        const d = create('D');
        store.setDependencies(owner, b.id, 1, [done(a.id)], 'user');
        store.setDependencies(owner, c.id, 1, [done(b.id)], 'user');
        store.setDependencies(owner, d.id, 1, [done(a.id), done(b.id)], 'user');
        const before = store.get(owner);
        reject(() => store.setDependencies(owner, a.id, 1, [done(b.id)], 'user'));
        reject(() => store.setDependencies(owner, a.id, 1, [done(c.id)], 'user'));
        reject(() => store.setDependencies(owner, a.id, 1, [done(d.id)], 'user'));
        expect(store.get(owner)).toEqual(before);
    });

    it('validates evidence selectors, rejects server/parent overrides and disallows ordinary patch bypasses', () => {
        const a = create('A');
        const b = create('B');
        for (const edge of [
            { ...done(a.id), serverId: 'remote' },
            { ...done(a.id), workspaceId: 'ws-other' },
            { ...done(a.id), processId: 'queue_other' },
            { itemId: a.id, condition: { kind: 'pr_merge', outputSlot: '' } },
            { itemId: a.id, condition: { kind: 'accepted_artifact', phase: 'design', reference: 'design.md' } },
            { itemId: a.id, condition: { kind: 'done', evidence: 'unverified' } },
            { itemId: a.id, condition: { kind: 'child_completed' } },
        ]) {
            reject(() => store.setDependencies(owner, b.id, 1, [edge] as never, 'user'));
        }
        reject(() => store.setDependencies(owner, b.id, 1, [], 'system'));
        reject(() => store.update(owner, b.id, 1, { dependsOn: [done(a.id)] } as never, 'user'));
        reject(() => store.create(owner, { title: 'Bypass', dependsOn: [done(a.id)] } as never, { actor: 'user' }));
        expect(store.get(owner).items[1].revision).toBe(1);
    });

    it('bounds dependencies and preserves manual tracking-only restrictions', () => {
        const manual = create('Manual dependent', 'ws-b', 'manual');
        const sources = Array.from({ length: MAX_TODO_DEPENDENCIES + 1 }, (_, index) => create(`Source ${index}`));
        store.setDependencies(owner, manual.id, 1, sources.slice(0, MAX_TODO_DEPENDENCIES).map(item => done(item.id)), 'user');
        const before = store.get(owner);
        reject(() => store.setDependencies(owner, manual.id, 2, sources.map(item => done(item.id)), 'user'));
        reject(() => store.linkJob(owner, manual.id, {
            processId: 'queue_child', workspaceId: 'ws-b', kind: 'local', openLink: '#child',
        }));
        expect(store.get(owner)).toEqual(before);
        expect(store.get(owner).items[0]).toMatchObject({ type: 'manual', status: 'todo', jobs: [] });
    });

    it('rolls back edge replacement together with item and ledger revision failures', () => {
        const a = create('A');
        const b = create('B');
        const c = create('C');
        store.setDependencies(owner, c.id, 1, [done(a.id)], 'user');
        const before = store.get(owner);
        const restore = failTodoWrites(database.db);
        expect(() => store.setDependencies(owner, c.id, 2, [done(b.id)], 'user')).toThrow('write failure');
        expect(store.get(owner)).toEqual(before);
        restore();
        database.db.exec(`CREATE TEMP TRIGGER reject_edge BEFORE INSERT ON sentinel_todo_dependencies
            BEGIN SELECT RAISE(ABORT, 'edge failure'); END`);
        expect(() => store.setDependencies(owner, c.id, 2, [done(b.id)], 'user')).toThrow('edge failure');
        expect(store.get(owner)).toEqual(before);
        database.db.exec('DROP TRIGGER reject_edge');
        database.db.exec(`CREATE TEMP TRIGGER reject_revision BEFORE UPDATE ON sentinel_todo_ledgers
            WHEN NEW.revision <> OLD.revision BEGIN SELECT RAISE(ABORT, 'revision failure'); END`);
        expect(() => store.setDependencies(owner, c.id, 2, [], 'user')).toThrow('revision failure');
        expect(store.get(owner)).toEqual(before);
    });

    it('reads records with no dependency rows as empty and includes graph tables in machine-local wipe', () => {
        const a = create('A');
        const b = create('B');
        expect(a.dependsOn).toEqual([]);
        database.db.exec('DROP TABLE sentinel_todo_dependencies');
        store = new SentinelTodoStore(database.db);
        expect(store.get(owner).items.map(item => item.dependsOn)).toEqual([[], []]);
        store.setDependencies(owner, b.id, 1, [done(a.id)], 'user');
        const domain = createSentinelTodosDomain();
        const context = { dataDir: database.dataDir, store: {} } as StorageSnapshotContext;
        const result = { domains: {}, counts: {}, errors: [] };
        domain.executeWipe(context, [], result);
        expect(result.errors).toEqual([]);
        expect(store.get(owner)).toEqual({ revision: 0, items: [] });
        expect(database.db.prepare('SELECT COUNT(*) AS count FROM sentinel_todo_dependencies').get()).toEqual({ count: 0 });
    });

    it('serializes simultaneous inverse edges so exactly one wins and no cycle is committed', async () => {
        const a = create('A');
        const b = create('B');
        const moduleFile = path.join(database.dataDir, 'store.cjs');
        const { metafile } = await build({
            entryPoints: [fileURLToPath(new URL('../../../src/server/sentinel-todos/sentinel-todo-store.ts', import.meta.url))],
            outfile: moduleFile, bundle: true, packages: 'external', platform: 'node', format: 'cjs', target: 'es2022',
            alias: { '@plusplusoneplusplus/coc-client': fileURLToPath(new URL('../../../../coc-client/src/index.ts', import.meta.url)) },
            metafile: true,
        });
        expect(Object.values(metafile.outputs).flatMap(output => output.imports)).not.toContainEqual(
            expect.objectContaining({ path: '@plusplusoneplusplus/coc-client', external: true }),
        );
        const workers = [a, b].map((item, index) => new Worker(`
            const { parentPort, workerData } = require('node:worker_threads');
            const { NativeDatabase } = require('@plusplusoneplusplus/coc-native');
            const { SentinelTodoStore } = require(workerData.moduleFile);
            const db = new NativeDatabase(workerData.file);
            const store = new SentinelTodoStore(db);
            parentPort.postMessage('ready');
            parentPort.once('message', () => {
                let result;
                try {
                    store.setDependencies(workerData.owner, workerData.itemId, 1,
                        [{ itemId: workerData.prerequisiteId, condition: { kind: 'done' } }], 'user');
                    result = { accepted: true };
                } catch (error) { result = { accepted: false, code: error.code, message: error.message }; }
                finally { db.close(); }
                parentPort.postMessage(result);
            });
        `, { eval: true, workerData: {
            moduleFile, file: path.join(database.dataDir, 'processes.db'), owner,
            itemId: item.id, prerequisiteId: [b, a][index].id,
        } }));
        try {
            await Promise.all(workers.map(worker => new Promise<void>((resolve, reject) => {
                worker.once('message', () => resolve());
                worker.once('error', reject);
            })));
            const pending = workers.map(worker => new Promise<{ accepted: boolean; code?: string }>((resolve, reject) => {
                worker.once('message', resolve);
                worker.once('error', reject);
            }));
            workers.forEach(worker => worker.postMessage('go'));
            const results = await Promise.all(pending);
            expect(results.filter(result => result.accepted)).toHaveLength(1);
            expect(results.filter(result => !result.accepted)).toEqual([{ accepted: false, code: 'invalid', message: expect.stringContaining('cycles') }]);
            const ledger = store.get(owner);
            expect(ledger.revision).toBe(3);
            expect(ledger.items.flatMap(item => item.dependsOn)).toHaveLength(1);
        } finally { await Promise.all(workers.map(worker => worker.terminate())); }
    });
});

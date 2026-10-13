/**
 * Every registered snapshot domain must pass the same lifecycle contract:
 * collect (export), restoreReplace + restoreMerge (import), planWipe (dry-run),
 * and executeWipe (destructive). This harness runs each domain through that
 * full cycle against a shared fixture, then adds focused per-domain assertions
 * for counts and side effects.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { SqliteProcessStore } from '@plusplusoneplusplus/forge';
import {
    EXPORT_SCHEMA_VERSION,
    type CoCExportPayload,
    type ImportResult,
} from '../../src/server/storage/export-import-types';
import { createSnapshotDomains } from '../../src/server/storage/snapshot/registry';
import { createCoreStoreDomain } from '../../src/server/storage/snapshot/core-store-domain';
import { createQueueDomain } from '../../src/server/storage/snapshot/queue-domain';
import { createImageBlobDomain } from '../../src/server/storage/snapshot/image-blob-domain';
import { createPreferencesDomain } from '../../src/server/storage/snapshot/preferences-domain';
import { createScheduleDomain } from '../../src/server/storage/snapshot/schedule-domain';
import { createGitOpsDomain } from '../../src/server/storage/snapshot/git-ops-domain';
import { createSentinelMirrorOutboxDomain, createSentinelTodosDomain } from '../../src/server/storage/snapshot/delegated-jobs-domain';
import { SENTINEL_MIRROR_OUTBOX_FILE, SentinelMirrorOutbox } from '../../src/server/messaging/sentinel-mirror-outbox';
import { SentinelTodoStore } from '../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelDependencyStore, type DependencyAdmissionRecord } from '../../src/server/sentinel-todos/sentinel-dependency-store';

// ============================================================================
// Helpers
// ============================================================================

function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-domain-contract-test-'));
}

function writeJSON(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function writeYaml(filePath: string, data: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, yaml.dump(data), 'utf-8');
}

function createImportResult(): ImportResult {
    return {
        importedProcesses: 0,
        importedWorkspaces: 0,
        importedWikis: 0,
        importedQueueFiles: 0,
        importedBlobFiles: 0,
        importedScheduleFiles: 0,
        importedRepoPreferenceFiles: 0,
        errors: [],
    };
}

function emptyPayload(overrides: Partial<CoCExportPayload> = {}): CoCExportPayload {
    return {
        version: EXPORT_SCHEMA_VERSION,
        exportedAt: '2024-01-01T00:00:00Z',
        metadata: { processCount: 0, workspaceCount: 0, wikiCount: 0, queueFileCount: 0 },
        processes: [],
        workspaces: [],
        wikis: [],
        queueHistory: [],
        preferences: {},
        ...overrides,
    };
}

/** Seed one representative artifact for every domain plus preserved files. */
async function seedFixture(dataDir: string, store: SqliteProcessStore, wikiDir: string): Promise<void> {
    // core-store
    await store.addProcess({
        id: 'p1', type: 'clarification', promptPreview: 'x', fullPrompt: 'x', status: 'completed', startTime: new Date(),
    });
    await store.registerWorkspace({ id: 'ws1', name: 'WS', rootPath: '/tmp/ws1' });
    fs.mkdirSync(wikiDir, { recursive: true });
    await store.registerWiki({ id: 'wiki1', name: 'Wiki', wikiDir, aiEnabled: false, registeredAt: new Date().toISOString() });

    // queue (file + SQLite rows)
    writeJSON(path.join(dataDir, 'repos', 'repo-1', 'queues.json'), {
        version: 3, repoRootPath: '/projects/repo-1', repoId: 'repo-1',
        pending: [{ id: 'task-a' }], history: [{ id: 'task-b' }],
    });
    const db = store.getDatabase();
    db.prepare('INSERT INTO queue_tasks (id, repo_id, type, status, priority, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('task-a', 'repo-1', 'chat', 'queued', 'normal', '{}', Date.now());
    db.prepare('INSERT INTO queue_repo_state (repo_id, is_paused) VALUES (?, ?)').run('repo-1', 0);

    // image blobs
    writeJSON(path.join(dataDir, 'blobs', 'task-1.images.json'), [{ url: 'x' }]);

    // preferences (global + per-repo)
    writeJSON(path.join(dataDir, 'preferences.json'), { global: { theme: 'dark' } });
    writeJSON(path.join(dataDir, 'repos', 'repo-1', 'preferences.json'), { defaultModel: 'gpt' });

    // schedules
    writeYaml(path.join(dataDir, 'repos', 'repo-1', 'schedules', 's1.yaml'), { id: 's1', cron: '* * * * *' });

    // git ops
    writeJSON(path.join(dataDir, 'repos', 'repo-1', 'git-ops.json'), { ops: [] });

    // preserved (never wiped)
    fs.writeFileSync(path.join(dataDir, 'config.yaml'), 'server: {}\n', 'utf-8');
    fs.mkdirSync(path.join(dataDir, 'skills'), { recursive: true });
}

// ============================================================================
// Generic lifecycle contract — every registered domain
// ============================================================================

describe('snapshot domain contract harness', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let wikiDir: string;

    beforeEach(async () => {
        dataDir = createTempDir();
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        wikiDir = path.join(dataDir, 'wiki-output');
        await seedFixture(dataDir, store, wikiDir);
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    for (const domain of createSnapshotDomains()) {
        describe(`domain: ${domain.id}`, () => {
            it('collect returns a well-formed CollectResult', async () => {
                const collected = await domain.collect({ dataDir, store });
                expect(collected).toBeTypeOf('object');
                expect(collected.data).toBeTypeOf('object');
                expect(collected.metadata).toBeTypeOf('object');
                expect(Array.isArray(collected.warnings)).toBe(true);
            });

            it('restoreReplace and restoreMerge accept an empty payload without throwing', async () => {
                const result = createImportResult();
                await domain.restoreReplace(emptyPayload(), { dataDir, store }, result);
                await domain.restoreMerge(emptyPayload(), { dataDir, store }, result);
                expect(result.errors).toEqual([]);
            });

            it('planWipe returns a well-formed plan and executeWipe consumes it', async () => {
                const planResult = await domain.planWipe({ dataDir, store, includeWikis: true });
                expect(planResult).toHaveProperty('plan');
                expect(planResult.counts).toBeTypeOf('object');
                expect(Array.isArray(planResult.errors)).toBe(true);

                const result = { errors: [] as string[] };
                await domain.executeWipe({ dataDir, store, includeWikis: true }, planResult.plan, result);
                expect(result.errors).toEqual([]);
            });
        });
    }
});

// ============================================================================
// Focused per-domain behavior
// ============================================================================

describe('snapshot domain behavior', () => {
    let dataDir: string;
    let store: SqliteProcessStore;
    let wikiDir: string;

    beforeEach(async () => {
        dataDir = createTempDir();
        store = new SqliteProcessStore({ dbPath: path.join(dataDir, 'processes.db') });
        wikiDir = path.join(dataDir, 'wiki-output');
        await seedFixture(dataDir, store, wikiDir);
    });

    afterEach(() => {
        store.close();
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    it('core-store: collects counts and executeWipe clears store and wiki dir', async () => {
        const domain = createCoreStoreDomain();
        const collected = await domain.collect({ dataDir, store });
        expect(collected.metadata.processCount).toBe(1);
        expect(collected.metadata.workspaceCount).toBe(1);
        expect(collected.metadata.wikiCount).toBe(1);

        const planResult = await domain.planWipe({ dataDir, store, includeWikis: true });
        expect(planResult.counts.deletedWikiDirs).toEqual([wikiDir]);

        const result = { errors: [] as string[] };
        await domain.executeWipe({ dataDir, store, includeWikis: true }, planResult.plan, result);
        expect(await store.getAllProcesses()).toHaveLength(0);
        expect(fs.existsSync(wikiDir)).toBe(false);
    });

    it('sentinel-todos: excludes items from import/export and wipes only its SQLite tables', async () => {
        const db = store.getDatabase();
        const version = db.pragma<number>('user_version', { simple: true });
        const todos = new SentinelTodoStore(db);
        const owner = { workspaceId: 'ws1', processId: 'p1' };
        const { item } = todos.create(owner, { title: 'Verify delivery' }, { actor: 'user' });
        todos.linkJob(owner, item.id, {
            processId: 'child', workspaceId: 'ws-child', kind: 'local', openLink: '#',
        });
        const source = todos.create(owner, { title: 'Prerequisite', status: 'done' }, { actor: 'user' }).item;
        todos.setDependencies(owner, item.id, todos.get(owner).items.find(candidate => candidate.id === item.id)!.revision,
            [{ itemId: source.id, condition: { kind: 'done' } }], 'user');
        const receipts = new SentinelDependencyStore(db, todos);
        const admission: DependencyAdmissionRecord = {
            itemRevision: todos.get(owner).items[0].revision, dependencies: '[]',
            taskId: 'native-task', mode: 'ralph', workspaceId: 'ws-child', sessionId: 'native-session',
        };
        receipts.reserveAdmission(owner, item.id, admission);
        receipts.startRalphStep(admission.taskId, 'iteration:1', admission.taskId);
        receipts.reserveWake(owner, { itemId: item.id, itemRevision: admission.itemRevision,
            ledgerRevision: todos.get(owner).revision, evaluatedAt: '2026-01-01T00:00:00.000Z', state: 'ready', edges: [] },
        'generation', () => 'Read the current readiness');
        receipts.persistPoll({ id: 'owner-poll', owner, nextTickAt: null });
        const operationalTables = ['sentinel_dependency_admissions',
            'sentinel_dependency_ralph_starts', 'sentinel_dependency_wakes', 'sentinel_dependency_polls',
            'sentinel_todo_dependency_generations'];
        for (const table of operationalTables) expect(db.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(1);
        const before = todos.get(owner);
        const domain = createSentinelTodosDomain();
        const ctx = { dataDir, store, includeWikis: false };
        expect(await domain.collect(ctx)).toEqual({ data: {}, metadata: {}, warnings: [] });
        const imported = createImportResult();
        await domain.restoreReplace(emptyPayload(), ctx, imported);
        await domain.restoreMerge(emptyPayload(), ctx, imported);
        expect(imported.errors).toEqual([]);
        expect(todos.get(owner)).toEqual(before);
        for (const table of operationalTables) expect(db.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(1);
        const plan = await domain.planWipe(ctx);
        expect(todos.get(owner)).toEqual(before);
        const result = { errors: [] as string[] };
        await domain.executeWipe(ctx, plan.plan, result);
        expect(result.errors).toEqual([]);
        expect(todos.get(owner)).toEqual({ revision: 0, items: [] });
        for (const table of operationalTables) expect(db.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(0);
        expect(await store.getProcess('p1')).toBeDefined();
        expect(db.prepare('SELECT id FROM queue_tasks').all()).toHaveLength(1);
        expect(db.pragma<number>('user_version', { simple: true })).toBe(version);
    });

    it('sentinel-todos: reports SQLite wipe failures and rolls back all item and job deletions', async () => {
        const db = store.getDatabase();
        const todos = new SentinelTodoStore(db);
        const owner = { workspaceId: 'ws1', processId: 'p1' };
        const { item } = todos.create(owner, { title: 'Keep evidence' }, { actor: 'user' });
        todos.linkJob(owner, item.id, {
            processId: 'child', workspaceId: 'ws-child', kind: 'local', openLink: '#',
        });
        const before = todos.get(owner);
        db.exec(`CREATE TEMP TRIGGER reject_todo_wipe BEFORE DELETE ON sentinel_todo_items
            BEGIN SELECT RAISE(ABORT, 'wipe failed'); END`);
        const domain = createSentinelTodosDomain();
        const ctx = { dataDir, store, includeWikis: false };
        const result = { errors: [] as string[] };
        await domain.executeWipe(ctx, (await domain.planWipe(ctx)).plan, result);
        expect(result.errors).toEqual([expect.stringContaining('wipe failed')]);
        expect(todos.get(owner)).toEqual(before);
    });

    it('sentinel-todos: surfaces an incomplete SQLite schema instead of reporting a successful wipe', async () => {
        const db = store.getDatabase();
        new SentinelTodoStore(db);
        db.exec('DROP TABLE sentinel_todo_jobs');
        const domain = createSentinelTodosDomain();
        const ctx = { dataDir, store, includeWikis: false };
        const result = { errors: [] as string[] };
        await domain.executeWipe(ctx, (await domain.planWipe(ctx)).plan, result);
        expect(result.errors).toEqual([expect.stringContaining('missing sentinel_todo_jobs')]);
    });

    it('sentinel-mirror-outbox: receipts stay machine-local and participate in explicit wipe', async () => {
        const domain = createSentinelMirrorOutboxDomain();
        const file = path.join(dataDir, 'repos', 'repo-1', SENTINEL_MIRROR_OUTBOX_FILE);
        writeJSON(file, [{ content: 'Private delivery intent' }]);
        const ctx = { dataDir, store, includeWikis: false };
        expect(await domain.collect(ctx)).toEqual({ data: {}, metadata: {}, warnings: [] });
        const imported = createImportResult();
        await domain.restoreReplace(emptyPayload(), ctx, imported);
        await domain.restoreMerge(emptyPayload(), ctx, imported);
        expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual([{ content: 'Private delivery intent' }]);
        const plan = await domain.planWipe(ctx);
        expect(plan.plan).toEqual([file]);
        expect(fs.existsSync(file)).toBe(true);
        const result = { errors: [] as string[] };
        await domain.executeWipe(ctx, plan.plan, result);
        expect(result.errors).toEqual([]);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('sentinel-mirror-outbox: SQLite ledger rows are never exported and are cleared by wipe', async () => {
        const domain = createSentinelMirrorOutboxDomain();
        const outbox = new SentinelMirrorOutbox(dataDir);
        try {
            const row = outbox.stage({
                workspaceId: 'repo-1', processId: 'sentinel', requestId: 'request', role: 'user', content: 'Private delivery intent',
                destination: { connector: 'whatsapp', chatKey: 'group', bindingId: 'binding' },
            });
            outbox.accept('repo-1', row.eventId);
            outbox.importLegacy('repo-1');
            const ctx = { dataDir, store, includeWikis: false };
            expect(await domain.collect(ctx)).toEqual({ data: {}, metadata: {}, warnings: [] });
            await domain.restoreReplace(emptyPayload(), ctx, createImportResult());
            expect(outbox.list('repo-1')).toHaveLength(1);
            const result = { errors: [] as string[] };
            await domain.executeWipe(ctx, (await domain.planWipe(ctx)).plan, result);
            expect(result.errors).toEqual([]);
            expect(outbox.list('repo-1')).toEqual([]);
            expect(outbox.activeRequests(0, 10)).toEqual([]);
            expect(outbox.isImported('repo-1')).toBe(false);
        } finally { outbox.close(); }
    });

    it('queue: counts file + rows and executeWipe deletes the queue file', async () => {
        const domain = createQueueDomain();
        const collected = await domain.collect({ dataDir, store });
        expect(collected.metadata.queueFileCount).toBe(1);

        const planResult = await domain.planWipe({ dataDir, store, includeWikis: false });
        // one queue file + one queue_tasks row + one queue_repo_state row
        expect(planResult.counts.deletedQueues).toBe(3);

        const result = { errors: [] as string[] };
        await domain.executeWipe({ dataDir, store, includeWikis: false }, planResult.plan, result);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-1', 'queues.json'))).toBe(false);
    });

    it('image-blobs: collects blob file and executeWipe deletes it', async () => {
        const domain = createImageBlobDomain();
        const collected = await domain.collect({ dataDir, store });
        expect(collected.metadata.blobFileCount).toBe(1);

        const planResult = await domain.planWipe({ dataDir, store, includeWikis: false });
        const result = { errors: [] as string[] };
        await domain.executeWipe({ dataDir, store, includeWikis: false }, planResult.plan, result);
        expect(fs.existsSync(path.join(dataDir, 'blobs', 'task-1.images.json'))).toBe(false);
    });

    it('preferences: collects global + repo prefs and executeWipe deletes both', async () => {
        const domain = createPreferencesDomain();
        const collected = await domain.collect({ dataDir, store });
        expect(collected.metadata.repoPreferenceCount).toBe(1);
        expect((collected.data.preferences as { global?: unknown }).global).toBeDefined();

        const planResult = await domain.planWipe({ dataDir, store, includeWikis: false });
        expect(planResult.counts.deletedRepoPreferences).toBe(1);
        expect(planResult.counts.deletedPreferences).toBe(true);

        const result = { errors: [] as string[] };
        await domain.executeWipe({ dataDir, store, includeWikis: false }, planResult.plan, result);
        expect(fs.existsSync(path.join(dataDir, 'preferences.json'))).toBe(false);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-1', 'preferences.json'))).toBe(false);
    });

    it('preferences: replace import preserves non-schema global keys verbatim', async () => {
        const domain = createPreferencesDomain();
        // Start clean so the write is deterministic.
        fs.rmSync(path.join(dataDir, 'preferences.json'), { force: true });
        const result = createImportResult();

        await domain.restoreReplace(
            emptyPayload({ preferences: { global: { theme: 'dark', customPref: 'preserved' } } }),
            { dataDir, store },
            result,
        );

        const written = JSON.parse(fs.readFileSync(path.join(dataDir, 'preferences.json'), 'utf-8'));
        expect(written.global.theme).toBe('dark');
        expect(written.global.customPref).toBe('preserved');
    });

    it('schedules: collects schedule YAML and executeWipe removes the dir', async () => {
        const domain = createScheduleDomain();
        const collected = await domain.collect({ dataDir, store });
        expect(collected.metadata.scheduleFileCount).toBe(1);

        const planResult = await domain.planWipe({ dataDir, store, includeWikis: false });
        const result = { errors: [] as string[] };
        await domain.executeWipe({ dataDir, store, includeWikis: false }, planResult.plan, result);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-1', 'schedules'))).toBe(false);
    });

    it('git-ops: contributes nothing to collect but wipes git-ops.json', async () => {
        const domain = createGitOpsDomain();
        const collected = await domain.collect({ dataDir, store });
        expect(collected.data).toEqual({});

        const planResult = await domain.planWipe({ dataDir, store, includeWikis: false });
        expect(planResult.counts.deletedGitOps).toBe(1);

        const result = { errors: [] as string[] };
        await domain.executeWipe({ dataDir, store, includeWikis: false }, planResult.plan, result);
        expect(fs.existsSync(path.join(dataDir, 'repos', 'repo-1', 'git-ops.json'))).toBe(false);
    });
});

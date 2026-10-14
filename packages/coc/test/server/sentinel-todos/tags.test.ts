import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import type { DecisionResponse } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentinelTodoStore, MAX_TODO_TAGS } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { sentinelTodoRecentList } from '../../../src/server/sentinel-todos/sentinel-todo-list';
import { DecisionService } from '../../../src/server/decisions/decision-service';
import { DecisionBackendError } from '../../../src/server/decisions/decision-backend';
import { SentinelDependencyStore } from '../../../src/server/sentinel-todos/sentinel-dependency-store';
import { SentinelDependencyActions } from '../../../src/server/sentinel-todos/sentinel-dependency-actions';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';
import { TAG_CLASSIFICATION_TIMEOUT_MS } from '../../../src/server/sentinel-todos/sentinel-todo-tags';
import { getServerLogger } from '../../../src/server/logging/server-logger';

const owner = { workspaceId: 'owner-workspace', processId: 'parent-chat' };
const tagBody = { expectedRevision: 0, name: 'Backend', color: 'blue' as const, description: 'Server work' };
const choice = (value: string): DecisionResponse => ({
    backend: 'copilot', model: 'test', metadata: { attempts: 1, durationMs: 0, confidenceKind: 'self_reported' },
    answers: { tag: { type: 'choice', choice: value, probabilities: { [value]: 1 }, confidence: 1 } },
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

describe('Sentinel to-do tags', () => {
    let directory: string;
    let db: NativeDatabase;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let enabled: boolean;
    let generation: number;
    let validOwner: boolean;
    let evaluate: ReturnType<typeof vi.fn>;
    let dependencyMutation: ReturnType<typeof vi.fn>;
    let libraryChange: ReturnType<typeof vi.fn>;
    let itemChange: ReturnType<typeof vi.fn>;
    beforeEach(() => {
        directory = path.join(process.cwd(), `.sentinel-tags-test-${randomUUID()}`);
        fs.mkdirSync(directory);
        db = new NativeDatabase(path.join(directory, 'processes.db'));
        initializeDatabase(db);
        todos = new SentinelTodoStore(db);
        enabled = true;
        generation = 0;
        validOwner = true;
        evaluate = vi.fn().mockResolvedValue(choice('tag_0'));
        dependencyMutation = vi.fn();
        libraryChange = vi.fn();
        itemChange = vi.fn();
        todos.onDependencyMutation = dependencyMutation;
        service = new SentinelTodoService({
            todos,
            store: { getProcess: async id => validOwner && id === owner.processId
                ? { id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } } as never : undefined },
            decisions: { evaluate }, resolveWorkspaceRoot: async () => directory,
            getTagsEnabled: () => enabled, getTagsGeneration: () => generation, onTagsChange: libraryChange,
            onChange: itemChange,
        });
    });
    afterEach(() => {
        vi.useRealTimers();
        db.close();
        fs.rmSync(directory, { recursive: true, force: true });
        vi.restoreAllMocks();
    });
    const createTag = () => service.createTag(owner, tagBody);

    it('persists scoped libraries and assignments additively across database reopen', async () => {
        const version = db.pragma('user_version', { simple: true });
        const library = await createTag();
        const saved = await service.create(owner, { title: 'Track', tagIds: [library.tags[0].id],
            targetRepo: { workspaceId: 'target-workspace' } }, { actor: 'user' });
        expect(db.pragma('user_version', { simple: true })).toBe(version);
        db.close();
        db = new NativeDatabase(path.join(directory, 'processes.db'));
        todos = new SentinelTodoStore(db);
        expect(todos.getTags(owner)).toEqual(library);
        expect(todos.get(owner).items[0]).toEqual(saved.item);
        for (const other of [{ ...owner, workspaceId: 'target-workspace' },
            { ...owner, processId: 'another-parent' }, { ...owner, workspaceId: 'another-workspace' }]) {
            expect(todos.getTags(other)).toEqual({ revision: 0, tags: [] });
            expect(todos.get(other).items).toEqual([]);
            expect(() => todos.create(other, { title: 'Invalid selection', tagIds: [library.tags[0].id] }, { actor: 'user' }))
                .toThrow('this parent ledger');
        }
    });

    it('projects the library through full and recent lists, including empty lists', async () => {
        const library = await createTag();
        expect(sentinelTodoRecentList(await service.list(owner))).toMatchObject({ tagLibrary: library, items: [] });
        await service.create(owner, { title: 'Track', tagIds: [] }, { actor: 'user' });
        expect(await service.list(owner)).toMatchObject({ tagLibrary: library });
        expect(libraryChange).toHaveBeenCalledWith(owner, 0);
    });

    it('classifies group-owned items in the registered parent group root across member and other targets', async () => {
        const processes = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        try {
            for (const id of ['member-repo', 'other-repo']) {
                const rootPath = path.join(directory, id);
                fs.mkdirSync(rootPath);
                await processes.registerWorkspace({ id, name: id, rootPath });
            }
            const group = await createRepoGroup(directory, processes, { name: 'Shared parent', members: ['member-repo'] });
            const groupOwner = { workspaceId: group.id, processId: 'group-parent' };
            await processes.addProcess({ id: groupOwner.processId, type: 'chat', status: 'completed', startTime: new Date(),
                metadata: { mode: 'sentinel', workspaceId: group.id } });
            const groupService = new SentinelTodoService({
                todos, store: processes, decisions: { evaluate }, getTagsEnabled: () => true,
                resolveWorkspaceRoot: async workspaceId => (await processes.getWorkspaces())
                    .find(workspace => workspace.id === workspaceId)?.rootPath,
            });
            const library = await groupService.createTag(groupOwner, tagBody);
            for (const targetRepo of [{ workspaceId: 'member-repo' }, { workspaceId: 'other-repo' },
                { workspaceId: 'other-repo', serverId: 'remote-server' }]) {
                const result = await groupService.create(groupOwner, { title: 'Server work', targetRepo }, { actor: 'user' });
                expect(result.item).toMatchObject({ tagIds: [library.tags[0].id], tagOrigin: 'suggested' });
            }
            expect(evaluate).toHaveBeenCalledTimes(3);
            for (const [, context] of evaluate.mock.calls) {
                expect(context).toMatchObject({ workspaceId: group.id, workingDirectory: group.rootPath });
            }
            expect(await groupService.getTags(groupOwner)).toEqual(library);
            expect(todos.getTags({ ...groupOwner, workspaceId: 'member-repo' })).toEqual({ revision: 0, tags: [] });
            expect(todos.getTags({ ...groupOwner, workspaceId: 'other-repo' })).toEqual({ revision: 0, tags: [] });
        } finally { processes.close(); }
    });

    it.each([
        { name: '' }, { name: ' '.repeat(5) }, { name: 'x'.repeat(81) }, { color: 'red' },
        { description: 'x'.repeat(1_001) }, { expectedRevision: -1 }, { expectedRevision: 0.5 },
        { extra: true },
    ])('validates library input %j', async change => {
        await expect(service.createTag(owner, { ...tagBody, ...change })).rejects.toMatchObject({ code: 'invalid' });
        expect(todos.getTags(owner).revision).toBe(0);
    });

    it('normalizes names, rejects case-insensitive duplicates, enforces limits and library CAS', async () => {
        let library = await service.createTag(owner, { ...tagBody, name: ' Backend ' });
        expect(library.tags[0].name).toBe('Backend');
        await expect(service.createTag(owner, { ...tagBody, expectedRevision: 1, name: 'backend' }))
            .rejects.toMatchObject({ code: 'invalid' });
        await expect(service.createTag(owner, { ...tagBody, name: 'Other' })).rejects.toMatchObject({ code: 'conflict' });
        library = await service.updateTag(owner, library.tags[0].id, {
            expectedRevision: 1, name: 'API', color: 'teal', description: '',
        });
        expect(library.tags[0]).toEqual({ id: library.tags[0].id, name: 'API', color: 'teal' });
        for (let index = 1; index < MAX_TODO_TAGS; index++) {
            library = await service.createTag(owner, { ...tagBody, expectedRevision: library.revision, name: `Tag ${index}` });
        }
        await expect(service.createTag(owner, { ...tagBody, expectedRevision: library.revision }))
            .rejects.toMatchObject({ code: 'limit' });
    });

    it('requires confirmed CAS deletion and atomically removes assignments but preserves manual locks', async () => {
        const library = await createTag();
        const id = library.tags[0].id;
        const saved = await service.create(owner, { title: 'Track', tagIds: [id] }, { actor: 'user' });
        await expect(service.deleteTag(owner, id, { expectedRevision: 1 })).rejects.toMatchObject({ code: 'invalid' });
        await expect(service.deleteTag(owner, id, { expectedRevision: 0, confirmed: true }))
            .rejects.toMatchObject({ code: 'conflict' });
        dependencyMutation.mockClear();
        expect(await service.deleteTag(owner, id, { expectedRevision: 1, confirmed: true }))
            .toEqual({ revision: 2, tags: [] });
        expect(todos.get(owner).items[0]).toMatchObject({ tagIds: [], tagOrigin: 'manual', status: saved.item.status });
        expect(dependencyMutation).not.toHaveBeenCalled();
        expect(await service.createTag(owner, { ...tagBody, expectedRevision: 2 })).toMatchObject({ revision: 3 });
    });

    it('rolls back tag deletion and assignment removal when an item write fails', async () => {
        const library = await createTag();
        await service.create(owner, { title: 'Track', tagIds: [library.tags[0].id] }, { actor: 'user' });
        const before = todos.get(owner);
        db.exec(`CREATE TRIGGER reject_tags BEFORE UPDATE ON sentinel_todo_tag_assignments
            BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
        await expect(service.deleteTag(owner, library.tags[0].id, { expectedRevision: 1, confirmed: true })).rejects.toThrow();
        expect(todos.get(owner)).toEqual(before);
        expect(todos.getTags(owner)).toEqual(library);
    });

    it('cascades libraries and assignments when the ledger is wiped', async () => {
        const library = await createTag();
        await service.create(owner, { title: 'Track', tagIds: [library.tags[0].id] }, { actor: 'user' });
        db.prepare('DELETE FROM sentinel_todo_ledgers WHERE workspace_id = ? AND parent_process_id = ?')
            .run(owner.workspaceId, owner.processId);
        expect(todos.getTags(owner)).toEqual({ revision: 0, tags: [] });
        expect(db.prepare('SELECT * FROM sentinel_todo_tag_assignments').all()).toEqual([]);
    });

    it('keeps tags machine-local and explicitly wipes additive tables even with foreign keys disabled', async () => {
        const library = await createTag();
        const saved = await service.create(owner, { title: 'Local tracking', tagIds: [library.tags[0].id] }, { actor: 'user' });
        await service.update(owner, saved.item.id, saved.item.revision, { tagIds: [], expectedTagRevision: saved.item.tagRevision ?? 0 }, 'user');
        todos.writeTag({ ...owner, processId: 'another-parent' }, undefined, tagBody);
        const domain = createSentinelTodosDomain();
        const processes = new SqliteProcessStore({ dbPath: path.join(directory, 'processes.db') });
        const context = { dataDir: directory, store: processes, includeWikis: false } as unknown as StorageSnapshotContext;
        try {
            expect(await domain.collect(context)).toEqual({ data: {}, metadata: {}, warnings: [] });
            const before = todos.get(owner);
            const errors = { errors: [] as string[] };
            await domain.restoreReplace({} as never, context, errors as never);
            await domain.restoreMerge({} as never, context, errors as never);
            expect(todos.get(owner)).toEqual(before);
            expect(todos.getTags(owner)).toEqual(library);
            processes.getDatabase().pragma('foreign_keys = OFF');
            db.exec('CREATE TABLE retained_feature (value TEXT); INSERT INTO retained_feature VALUES (\'retained\')');
            const wipe = await domain.planWipe(context);
            await domain.executeWipe(context, wipe.plan, errors);
            expect(errors.errors).toEqual([]);
            for (const table of ['sentinel_todo_tag_assignments', 'sentinel_todo_tag_libraries']) {
                expect(db.prepare(`SELECT * FROM ${table}`).all()).toEqual([]);
            }
            expect(todos.get(owner)).toEqual({ revision: 0, items: [] });
            expect(todos.getTags(owner)).toEqual({ revision: 0, tags: [] });
            expect(db.prepare('SELECT value FROM retained_feature').get()).toEqual({ value: 'retained' });
        } finally { processes.close(); }
    });

    it('honors explicit manual clears and never reclassifies locked items on meaningful edits', async () => {
        const library = await createTag();
        let result = await service.create(owner, { title: 'Track', tagIds: [] }, { actor: 'user' });
        result = { ...result, ...await service.update(owner, result.item.id, result.item.revision, { notes: 'Changed' }, 'sentinel') };
        expect(result.item).toMatchObject({ tagIds: [], tagOrigin: 'manual' });
        expect(evaluate).not.toHaveBeenCalled();
        await expect(service.update(owner, result.item.id, result.item.revision, { tagIds: [library.tags[0].id], expectedTagRevision: result.item.tagRevision ?? 0 }, 'sentinel'))
            .rejects.toMatchObject({ code: 'invalid' });
        await expect(service.suggestTags(owner, result.item.id, { expectedRevision: result.item.revision, expectedTagRevision: result.item.tagRevision ?? 0 }))
            .rejects.toMatchObject({ code: 'invalid' });
        await expect(service.suggestTags(owner, result.item.id, { expectedRevision: result.item.revision, expectedTagRevision: result.item.tagRevision ?? 0, confirmed: true }, 'sentinel'))
            .rejects.toMatchObject({ code: 'invalid' });
        const suggested = await service.suggestTags(owner, result.item.id, { expectedRevision: result.item.revision, expectedTagRevision: result.item.tagRevision ?? 0, confirmed: true });
        expect(suggested.item).toMatchObject({ tagOrigin: 'suggested', tagIds: [library.tags[0].id] });
    });

    it('classifies on create and meaningful edits only, preserves idempotency, and never changes manual tracking status', async () => {
        const library = await createTag();
        let result = await service.create(owner, { title: 'Server work', type: 'manual' }, { actor: 'user', idempotencyKey: 'once' });
        expect(result.item).toMatchObject({ type: 'manual', status: 'todo', tagIds: [library.tags[0].id],
            tagOrigin: 'suggested', tagMatch: { state: 'matched' }, jobs: [] });
        expect((await service.create(owner, { title: 'Retry' }, { actor: 'user', idempotencyKey: 'once' })).item).toEqual(result.item);
        result = { ...result, ...await service.update(owner, result.item.id, result.item.revision, { title: result.item.title, priority: 'high' }, 'user') };
        result = { ...result, ...await service.update(owner, result.item.id, result.item.revision, { notes: ' \n' }, 'user') };
        expect(evaluate).toHaveBeenCalledTimes(1);
        evaluate.mockResolvedValue(choice('none'));
        result = { ...result, ...await service.update(owner, result.item.id, result.item.revision, { completionCondition: 'New condition' }, 'user') };
        expect(result.item).toMatchObject({ tagIds: [], tagMatch: { state: 'no_match' }, status: 'todo', type: 'manual' });
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(evaluate.mock.calls[1][0].state).toMatchObject({ item: { completionCondition: 'New condition' } });
        expect(evaluate.mock.calls[1][1]).toMatchObject({ workspaceId: owner.workspaceId, workingDirectory: directory });
    });

    it('supports opt-in multiple matches using the existing DecisionService', async () => {
        const first = await createTag();
        const library = await service.createTag(owner, { ...tagBody, expectedRevision: 1, name: 'Infrastructure' });
        const backend = { name: 'copilot' as const, evaluate: vi.fn().mockResolvedValue({
            ...choice('none'), answers: {
                tag_0: { type: 'noul', value: 0.9, confidence: 0.8 },
                tag_1: { type: 'noul', value: 0.8, confidence: 0.8 },
            },
        }) };
        const decisions = new DecisionService([backend]);
        evaluate.mockImplementation(decisions.evaluate.bind(decisions));
        const result = await service.create(owner, { title: 'Server work', matchMultiple: true }, { actor: 'user' });
        expect(result.item.tagIds).toEqual([first.tags[0].id, library.tags[1].id]);
        expect(backend.evaluate.mock.calls[0][0].questions).toHaveLength(2);
    });

    it.each(['unavailable', 'failed', 'invalid-output'] as const)('preserves content saves and reports %s classification honestly', async mode => {
        await createTag();
        if (mode === 'unavailable') evaluate.mockRejectedValue(new DecisionBackendError({
            code: 'DECISION_BACKEND_UNAVAILABLE', status: 503, message: 'Unavailable',
        }));
        else if (mode === 'invalid-output') evaluate.mockResolvedValue(choice('invented'));
        else evaluate.mockRejectedValue(new Error('Provider failed'));
        const result = await service.create(owner, { title: 'Saved despite failure' }, { actor: 'user' });
        expect(result.created).toBe(true);
        expect(result.item).toMatchObject({ title: 'Saved despite failure',
            tagMatch: { state: mode === 'unavailable' ? 'unavailable' : 'failed' } });
        expect(todos.get(owner).items[0]).toEqual(result.item);
    });

    it.each(['failed', 'unavailable'] as const)('preserves manual IDs and lock when confirmed re-suggestion is %s', async state => {
        const library = await createTag();
        const saved = await service.create(owner, { title: 'Track', tagIds: [library.tags[0].id] }, { actor: 'user' });
        evaluate.mockRejectedValue(state === 'unavailable' ? new DecisionBackendError({
            code: 'DECISION_BACKEND_UNAVAILABLE', status: 503, message: 'Unavailable',
        }) : new Error('Failed'));
        const result = await service.suggestTags(owner, saved.item.id, { expectedRevision: saved.item.revision, expectedTagRevision: saved.item.tagRevision ?? 0, confirmed: true });
        expect(result.item).toMatchObject({ tagIds: saved.item.tagIds, tagOrigin: 'manual', tagMatch: { state } });
        const later = await service.update(owner, result.item.id, result.item.revision, { notes: 'Later meaningful edit' }, 'user');
        expect(later.item).toMatchObject({ tagIds: saved.item.tagIds, tagOrigin: 'manual' });
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    it('bounds inference within save budgets, aborts the backend, and ignores late results', async () => {
        await createTag();
        const pending = deferred<DecisionResponse>();
        evaluate.mockReturnValue(pending.promise);
        vi.useFakeTimers();
        const saving = service.create(owner, { title: 'Saved before inference' }, { actor: 'user' });
        await vi.advanceTimersByTimeAsync(0);
        expect(todos.get(owner).items[0].title).toBe('Saved before inference');
        const signal = evaluate.mock.calls[0][1].signal as AbortSignal;
        expect(signal.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(TAG_CLASSIFICATION_TIMEOUT_MS);
        const saved = await saving;
        expect(signal.aborted).toBe(true);
        expect(saved.item).toMatchObject({ title: 'Saved before inference', tagMatch: { state: 'failed', message: expect.stringContaining('timed out') } });
        const before = todos.get(owner);
        pending.resolve(choice('tag_0'));
        await vi.advanceTimersByTimeAsync(0);
        expect(todos.get(owner)).toEqual(before);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('logs unavailable workspace and committed notification failures without losing saved data', async () => {
        const warn = vi.spyOn(getServerLogger(), 'warn').mockImplementation(() => {});
        libraryChange.mockImplementation(() => { throw new Error('Notification unavailable'); });
        const library = await createTag();
        expect(library.tags).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ error: 'Notification unavailable' }),
            'Committed tag library notification failed');
        service = new SentinelTodoService({
            todos, store: { getProcess: async id => ({ id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } }) as never },
            decisions: { evaluate }, getTagsEnabled: () => true,
            resolveWorkspaceRoot: async () => { throw new Error('Workspace registry unavailable'); },
            onChange: () => { throw new Error('Item notification unavailable'); },
        });
        const saved = await service.create(owner, { title: 'Saved without workspace context' }, { actor: 'user' });
        expect(saved.item.tagMatch?.state).toBe('unavailable');
        expect(evaluate).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ reason: 'Workspace registry unavailable' }),
            'Tag classification workspace is unavailable');
        expect(warn).toHaveBeenCalledWith(expect.objectContaining({ error: 'Item notification unavailable' }),
            'Committed to-do change notification failed');
    });

    it('propagates unexpected classification persistence errors instead of returning success-shaped fallback', async () => {
        await createTag();
        db.exec(`CREATE TRIGGER reject_tag_persistence BEFORE INSERT ON sentinel_todo_tag_assignments
            BEGIN SELECT RAISE(ABORT, 'injected tag persistence failure'); END`);
        await expect(service.create(owner, { title: 'Content saved before persistence failure' }, { actor: 'user' }))
            .rejects.toThrow('injected tag persistence failure');
        expect(todos.get(owner).items[0]).toMatchObject({ title: 'Content saved before persistence failure' });
        expect(todos.get(owner).items[0].tagMatch).toBeUndefined();
    });

    it('logs expected stale classification discards after preserving saved and concurrent content', async () => {
        await createTag();
        const debug = vi.spyOn(getServerLogger(), 'debug').mockImplementation(() => {});
        const pending = deferred<DecisionResponse>();
        evaluate.mockReturnValue(pending.promise);
        const saving = service.create(owner, { title: 'Saved first' }, { actor: 'user' });
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
        const item = todos.get(owner).items[0];
        todos.update(owner, item.id, item.revision, { notes: 'Concurrent content' }, 'user');
        pending.resolve(choice('tag_0'));
        expect((await saving).item.notes).toBe('Concurrent content');
        expect(debug).toHaveBeenCalledWith(expect.objectContaining({ itemId: item.id, code: 'conflict' }),
            'Discarded stale or unavailable tag classification after saving content');
    });

    it('uses no_match for empty libraries without calling the classifier', async () => {
        const result = await service.create(owner, { title: 'No tags available' }, { actor: 'user' });
        expect(result.item).toMatchObject({ tagIds: [], tagOrigin: 'suggested', tagMatch: { state: 'no_match' } });
        expect(evaluate).not.toHaveBeenCalled();
    });

    it.each(['edit', 'manual-clear', 'library', 'flag', 'flag-cycle', 'owner'] as const)(
        'discards stale asynchronous classification after %s changes', async kind => {
            await createTag();
            const pending = deferred<DecisionResponse>();
            evaluate.mockReturnValue(pending.promise);
            const saving = service.create(owner, { title: 'Original' }, { actor: 'user' });
            await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
            const saved = todos.get(owner).items[0];
            if (kind === 'edit') todos.update(owner, saved.id, saved.revision, { notes: 'Concurrent edit' }, 'user');
            if (kind === 'manual-clear') todos.update(owner, saved.id, saved.revision, { tagIds: [], expectedTagRevision: saved.tagRevision ?? 0 }, 'user');
            if (kind === 'library') await service.updateTag(owner, todos.getTags(owner).tags[0].id, { ...tagBody, expectedRevision: 1, name: 'Changed' });
            if (kind === 'flag') enabled = false;
            if (kind === 'flag-cycle') generation += 2;
            if (kind === 'owner') validOwner = false;
            pending.resolve(choice('tag_0'));
            const result = await saving;
            expect(result.created).toBe(true);
            expect(todos.get(owner).items[0].tagMatch).toBeUndefined();
            expect(todos.get(owner).items[0].tagIds).toEqual(kind === 'manual-clear' ? [] : undefined);
            if (kind === 'edit') expect(todos.get(owner).items[0].notes).toBe('Concurrent edit');
        },
    );

    it('rejects explicit stale suggestions rather than overwriting concurrent updates', async () => {
        const library = await createTag();
        const saved = await service.create(owner, { title: 'Track', tagIds: [library.tags[0].id] }, { actor: 'user' });
        const pending = deferred<DecisionResponse>();
        evaluate.mockReturnValue(pending.promise);
        const suggestion = service.suggestTags(owner, saved.item.id, { expectedRevision: saved.item.revision, expectedTagRevision: saved.item.tagRevision ?? 0, confirmed: true });
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalledTimes(1));
        todos.update(owner, saved.item.id, saved.item.revision, { title: 'New content' }, 'user');
        pending.resolve(choice('tag_0'));
        await expect(suggestion).rejects.toMatchObject({ code: 'conflict' });
        expect(todos.get(owner).items[0]).toMatchObject({ title: 'New content', tagOrigin: 'manual', tagIds: saved.item.tagIds });
    });

    it('rejects invalid assignments before saving content and preserves CAS', async () => {
        const library = await createTag();
        for (const tagIds of [['missing'], [library.tags[0].id, library.tags[0].id]]) {
            await expect(service.create(owner, { title: 'Invalid', tagIds }, { actor: 'user' })).rejects.toMatchObject({ code: 'invalid' });
        }
        expect(todos.get(owner).items).toEqual([]);
        const saved = await service.create(owner, { title: 'Track', tagIds: [] }, { actor: 'user' });
        await expect(service.update(owner, saved.item.id, 0, { tagIds: [] }, 'user')).rejects.toMatchObject({ code: 'conflict' });
    });

    it('uses independent tag CAS without advancing content or ledger revisions', async () => {
        const library = await createTag();
        const saved = await service.create(owner, { title: 'Track', tagIds: [] }, { actor: 'user' });
        const snapshot = todos.get(owner);
        await expect(service.update(owner, saved.item.id, saved.item.revision, { tagIds: [] }, 'user'))
            .rejects.toMatchObject({ code: 'invalid' });
        const tagged = await service.update(owner, saved.item.id, saved.item.revision, {
            tagIds: [library.tags[0].id], expectedTagRevision: saved.item.tagRevision ?? 0,
        }, 'user');
        expect(tagged.item.revision).toBe(saved.item.revision);
        expect(tagged.ledgerRevision).toBe(saved.ledgerRevision);
        expect(tagged.item.tagRevision).toBe((saved.item.tagRevision ?? 0) + 1);
        expect(itemChange).toHaveBeenLastCalledWith(expect.objectContaining({
            ledgerRevision: saved.ledgerRevision, tagOnly: true,
        }));
        await expect(service.update(owner, saved.item.id, saved.item.revision, {
            tagIds: [], expectedTagRevision: saved.item.tagRevision ?? 0,
        }, 'user')).rejects.toMatchObject({ code: 'conflict' });
        await expect(service.suggestTags(owner, saved.item.id, {
            expectedRevision: saved.item.revision, expectedTagRevision: saved.item.tagRevision ?? 0, confirmed: true,
        })).rejects.toMatchObject({ code: 'conflict' });
        expect(todos.withCurrentEvidence(owner, snapshot, ledger => ledger.revision)).toBe(snapshot.revision);
    });

    it('rejects tag-option-only patches and tag tokens without assignments before any write', async () => {
        const saved = await service.create(owner, { title: 'Track', tagIds: [] }, { actor: 'user' });
        const before = todos.get(owner);
        dependencyMutation.mockClear();
        for (const patch of [{ matchMultiple: true }, { matchMultiple: false }, { expectedTagRevision: 0 },
            { expectedTagRevision: 1, title: 'Must not save' }, { matchMultiple: true, expectedTagRevision: 1 }]) {
            expect(() => todos.update(owner, saved.item.id, saved.item.revision, patch, 'user')).toThrow();
            expect(todos.get(owner)).toEqual(before);
        }
        expect(dependencyMutation).not.toHaveBeenCalled();
        const empty = todos.update(owner, saved.item.id, saved.item.revision, {}, 'user');
        expect(empty.item.revision).toBe(saved.item.revision + 1);
        expect(empty.ledgerRevision).toBe(saved.ledgerRevision + 1);
        expect(dependencyMutation).toHaveBeenCalledTimes(1);
    });

    it('does not stale an asynchronous dependency evidence read when tags or the library change', async () => {
        const pending = deferred<{ status: 'merged'; url: string; title: string }>();
        const fetchPr = vi.fn().mockReturnValue(pending.promise);
        service = new SentinelTodoService({
            todos, store: { getProcess: async id => ({ id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } }) as never },
            getTagsEnabled: () => true, getDependenciesEnabled: () => true, fetchPr,
        });
        const library = await createTag();
        let source = (await service.create(owner, { title: 'Output', tagIds: [] }, { actor: 'user' })).item;
        source = (await service.bindPrOutput(owner, source.id, {
            expectedRevision: source.revision, outputSlot: 'code', prUrl: 'https://github.com/example/project/pull/42',
            provenance: { kind: 'owner_selection', reason: 'Explicit output' },
        }, 'user')).item;
        let dependent = (await service.create(owner, { title: 'Dependent', tagIds: [] }, { actor: 'user' })).item;
        dependent = (await service.setDependencies(owner, dependent.id, dependent.revision, [
            { itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'code' } },
        ], 'user')).item;
        const snapshot = todos.get(owner);
        const evaluating = service.evaluateDependencies(owner, dependent.id);
        await vi.waitFor(() => expect(fetchPr).toHaveBeenCalledTimes(1));
        await service.update(owner, source.id, source.revision, {
            tagIds: [library.tags[0].id], expectedTagRevision: source.tagRevision ?? 0,
        }, 'user');
        await service.update(owner, dependent.id, dependent.revision, {
            tagIds: [library.tags[0].id], expectedTagRevision: dependent.tagRevision ?? 0,
        }, 'user');
        await service.updateTag(owner, library.tags[0].id, { ...tagBody, expectedRevision: 1, name: 'Renamed' });
        await service.deleteTag(owner, library.tags[0].id, { expectedRevision: 2, confirmed: true });
        expect(todos.get(owner).revision).toBe(snapshot.revision);
        expect(todos.get(owner).items.map(item => item.revision)).toEqual(snapshot.items.map(item => item.revision));
        pending.resolve({ status: 'merged', url: 'https://github.com/example/project/pull/42', title: 'Output' });
        await expect(evaluating).resolves.toMatchObject({ state: 'ready', itemRevision: dependent.revision,
            edges: [{ sourceRevision: source.revision, satisfied: true }] });
    });

    it('makes metadata-only writes independent of dependency invalidation and user verdicts', async () => {
        const library = await createTag();
        let result = await service.create(owner, { title: 'Track', tagIds: [] }, { actor: 'user' });
        const before = result.item;
        dependencyMutation.mockClear();
        result = { ...result, ...await service.update(owner, result.item.id, result.item.revision, { tagIds: [library.tags[0].id], expectedTagRevision: result.item.tagRevision ?? 0 }, 'user') };
        expect(result.item.userEditedAt).toEqual(before.userEditedAt);
        expect(result.item.userVerdictRevision).toEqual(before.userVerdictRevision);
        expect(result.item.updatedAt).toEqual(before.updatedAt);
        expect(result.item.dependsOn).toEqual(before.dependsOn);
        expect(result.item.evidence).toEqual(before.evidence);
        await service.suggestTags(owner, result.item.id, { expectedRevision: result.item.revision, expectedTagRevision: result.item.tagRevision ?? 0, confirmed: true });
        expect(dependencyMutation).not.toHaveBeenCalled();
        expect(todos.dependencyRevision(owner, result.item.id)).toBe(0);
    });

    it.each([false, true])('preserves readiness, wake identity and admission authority across tag-only revisions (started=%s)', async started => {
        service = new SentinelTodoService({
            todos, store: { getProcess: async id => ({ id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } }) as never },
            decisions: { evaluate }, getTagsEnabled: () => true, getDependenciesEnabled: () => true,
            resolveWorkspaceRoot: async () => directory,
        });
        const receipts = new SentinelDependencyStore(db, todos);
        const deliverOnce = vi.fn();
        const actions = new SentinelDependencyActions({
            receipts, service, delivery: { deliverOnce },
            validateProvider: async () => {}, validateTarget: async () => {}, validateCurrent: () => {},
        });
        service.dependencyActions = actions;
        const library = await createTag();
        let source = (await service.create(owner, { title: 'Source', status: 'done', tagIds: [] }, { actor: 'user' })).item;
        let dependent = (await service.create(owner, { title: 'Dependent', tagIds: [] }, { actor: 'user' })).item;
        dependent = (await service.setDependencies(owner, dependent.id, dependent.revision, [
            { itemId: source.id, condition: { kind: 'done' } },
        ], 'user')).item;
        await actions.poll(owner);
        const prior = receipts.evaluation(owner, dependent.id)!;
        const wake = receipts.wakes(owner, dependent.id)[0];
        receipts.reserveAdmission(owner, dependent.id, {
            taskId: 'tracked-work', workspaceId: owner.workspaceId, mode: 'ask', started,
            itemRevision: dependent.revision, dependencies: JSON.stringify(dependent.dependsOn),
            evidence: JSON.stringify(prior.edges), graphRevision: todos.dependencyRevision(owner, dependent.id),
            lineage: [{ itemId: source.id, revision: source.revision }],
        });
        const admission = receipts.records(owner)[0];
        source = (await service.update(owner, source.id, source.revision, { tagIds: [library.tags[0].id], expectedTagRevision: source.tagRevision ?? 0 }, 'user')).item;
        dependent = (await service.update(owner, dependent.id, dependent.revision, { tagIds: [library.tags[0].id], expectedTagRevision: dependent.tagRevision ?? 0 }, 'user')).item;
        await service.suggestTags(owner, source.id, { expectedRevision: source.revision, expectedTagRevision: source.tagRevision ?? 0, confirmed: true });
        await service.updateTag(owner, library.tags[0].id, { ...tagBody, expectedRevision: 1, name: 'Renamed' });
        await service.deleteTag(owner, library.tags[0].id, { expectedRevision: 2, confirmed: true });
        actions.refresh(owner);
        expect(receipts.records(owner)[0]).toEqual(admission);
        expect(receipts.wakes(owner, dependent.id)[0]).toEqual(wake);
        expect(receipts.evaluation(owner, dependent.id)).toEqual(prior);
        expect((await service.list(owner)).items.find(item => item.id === dependent.id)?.dependencyReadiness)
            .toMatchObject({ state: 'ready', requiresReview: false });
        await actions.poll(owner);
        expect(receipts.wakes(owner, dependent.id)).toHaveLength(1);
        expect(receipts.wakes(owner, dependent.id)[0].invalidatedAt).toBeUndefined();
        expect(deliverOnce).toHaveBeenCalledTimes(1);
        source = todos.get(owner).items.find(item => item.id === source.id)!;
        await service.update(owner, source.id, source.revision, { notes: 'Actual content changed' }, 'user');
        if (started) expect(receipts.records(owner)[0].record.requiresReview).toBe(true);
        else expect(receipts.records(owner)[0].record.error).toBeTruthy();
        expect(receipts.wakes(owner, dependent.id)[0].invalidatedAt).toBeDefined();
    });

    it('gates all tag operations and projections when disabled without losing stored metadata', async () => {
        const library = await createTag();
        const saved = await service.create(owner, { title: 'Track', tagIds: [library.tags[0].id] }, { actor: 'user', idempotencyKey: 'saved-item' });
        enabled = false;
        for (const operation of [
            () => service.getTags(owner),
            () => service.createTag(owner, tagBody),
            () => service.updateTag(owner, library.tags[0].id, tagBody),
            () => service.deleteTag(owner, library.tags[0].id, { expectedRevision: 1, confirmed: true }),
            () => service.suggestTags(owner, saved.item.id, { expectedRevision: saved.item.revision, confirmed: true }),
            () => service.create(owner, { title: 'Hidden', tagIds: [] }, { actor: 'user' }),
            () => service.update(owner, saved.item.id, saved.item.revision, { tagIds: [] }, 'user'),
        ]) await expect(operation()).rejects.toMatchObject({ code: 'not_found' });
        const view = await service.list(owner);
        expect(view.tagLibrary).toBeUndefined();
        expect(view.items[0]).not.toHaveProperty('tagIds');
        expect(view.items[0]).not.toHaveProperty('tagOrigin');
        expect(todos.get(owner).items[0].tagIds).toEqual(saved.item.tagIds);
        const replay = await service.create(owner, { title: 'Track' }, { actor: 'user', idempotencyKey: 'saved-item' });
        expect(replay.item).not.toHaveProperty('tagIds');
        const updated = await service.update(owner, saved.item.id, saved.item.revision, { notes: 'Updated while disabled' }, 'user');
        expect(updated.item).not.toHaveProperty('tagIds');
        expect(updated.item).not.toHaveProperty('tagOrigin');
        expect(todos.get(owner).items[0].tagIds).toEqual(saved.item.tagIds);
        const conflict = await service.update(owner, saved.item.id, saved.item.revision, { notes: 'Stale update' }, 'user')
            .catch(error => error);
        expect(conflict.code).toBe('conflict');
        expect(conflict.current).not.toHaveProperty('tagIds');
        expect(conflict.current).not.toHaveProperty('tagOrigin');
        expect((await service.create(owner, { title: 'Works while disabled' }, { actor: 'user' })).created).toBe(true);
        expect(evaluate).not.toHaveBeenCalled();
    });

    it('enforces owner identity even when a valid library exists', async () => {
        await createTag();
        await expect(service.getTags({ ...owner, workspaceId: 'target-workspace' })).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.createTag({ ...owner, processId: 'other-parent' }, tagBody)).rejects.toMatchObject({ code: 'not_found' });
    });
});

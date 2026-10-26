import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import * as path from 'node:path';
import { MAX_TODO_CATEGORIES, SentinelTodoError, SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTodoTestDatabase, createTodoTestDirectory } from './test-db';

describe('workspace Sentinel to-do category storage', () => {
    let fixture: ReturnType<typeof createTodoTestDatabase>;
    let store: SentinelTodoStore;
    beforeEach(() => {
        fixture = createTodoTestDatabase(createTodoTestDirectory());
        store = new SentinelTodoStore(fixture.db);
    });
    afterEach(() => fixture.dispose());

    function create(name: string, workspaceId = 'workspace') {
        return store.writeCategory(workspaceId, undefined, {
            expectedRevision: store.getCategories(workspaceId).revision, name,
        });
    }
    function expectError(action: () => unknown, code: SentinelTodoError['code']) {
        try { action(); } catch (error) {
            expect(error).toBeInstanceOf(SentinelTodoError);
            expect((error as SentinelTodoError).code).toBe(code);
            return;
        }
        throw new Error('Expected a category error');
    }

    it('shares an ordered set across chats without changing ledger revisions or other workspaces', () => {
        const first = { workspaceId: 'workspace', processId: 'chat-a' };
        const second = { ...first, processId: 'chat-b' };
        store.create(first, { title: 'A' }, { actor: 'user' });
        store.create(second, { title: 'B' }, { actor: 'user' });
        const ledgers = [store.get(first), store.get(second)];
        const initial = create('  Backend  ');
        const next = create('Frontend');
        expect(next.categories.map(category => category.name)).toEqual(['Backend', 'Frontend']);
        expect(next.revision).toBe(2);
        expect(store.getCategories('other-workspace')).toEqual({ revision: 0, categories: [] });
        const renamed = store.writeCategory(first.workspaceId, initial.categories[0].id, {
            expectedRevision: next.revision, name: 'Server',
        });
        expect(renamed.categories[0]).toEqual({ ...initial.categories[0], name: 'Server' });
        const ordered = store.reorderCategories(second.workspaceId, {
            expectedRevision: renamed.revision, categoryIds: renamed.categories.map(category => category.id).reverse(),
        });
        expect(ordered.categories.map(category => category.name)).toEqual(['Frontend', 'Server']);
        expect(ordered.revision).toBe(4);
        expect([store.get(first), store.get(second)]).toEqual(ledgers);
        create('Backend', 'other-workspace');
        expect(store.getCategories('workspace')).toEqual(ordered);
    });

    it('isolates a group category set from each member workspace', () => {
        create('Group work', 'group');
        create('Member work', 'member');
        expect(store.getCategories('group').categories.map(category => category.name)).toEqual(['Group work']);
        expect(store.getCategories('member').categories.map(category => category.name)).toEqual(['Member work']);
    });

    it('persists across connections, tolerates tag tables, and rejects stale writers', () => {
        const initial = create('Backend');
        const db = new NativeDatabase(path.join(fixture.dataDir, 'processes.db'));
        try {
            const other = new SentinelTodoStore(db);
            expect(other.getCategories('workspace')).toEqual(initial);
            const changed = other.writeCategory('workspace', undefined, { expectedRevision: 1, name: 'UI' });
            expectError(() => store.writeCategory('workspace', initial.categories[0].id, {
                expectedRevision: 1, name: 'Renamed',
            }), 'conflict');
            expectError(() => store.reorderCategories('workspace', {
                expectedRevision: 1, categoryIds: initial.categories.map(category => category.id),
            }), 'conflict');
            expect(store.getCategories('workspace')).toEqual(changed);
            expect(fixture.db.prepare("SELECT name FROM sqlite_master WHERE name = 'sentinel_todo_tag_libraries'").get()).toBeDefined();
        } finally { db.close(); }
    });

    it('validates names, workspace identity, unknown IDs and the category limit atomically', () => {
        const initial = create('Backend');
        const invalid = [
            { expectedRevision: 1, name: '' }, { expectedRevision: 1, name: '   ' },
            { expectedRevision: 1, name: 'x'.repeat(41) }, { expectedRevision: -1, name: 'Valid' },
            { expectedRevision: 1.5, name: 'Valid' }, { expectedRevision: 1, name: 'Valid', extra: true },
            { expectedRevision: 1, name: ' backend ' },
        ];
        for (const body of invalid) expectError(() => store.writeCategory('workspace', undefined, body), 'invalid');
        expectError(() => store.getCategories(''), 'invalid');
        expectError(() => store.writeCategory('workspace', 'missing', { expectedRevision: 1, name: 'Valid' }), 'not_found');
        expect(store.getCategories('workspace')).toEqual(initial);
        for (let index = 1; index < MAX_TODO_CATEGORIES; index++) create(`Category ${index}`);
        expectError(() => create('Overflow'), 'limit');
        const full = store.getCategories('workspace');
        expect(full.categories).toHaveLength(MAX_TODO_CATEGORIES);
        // Renaming remains available at the cap, including a case-only rename.
        const renamed = store.writeCategory('workspace', full.categories[0].id, { expectedRevision: full.revision, name: 'BACKEND' });
        expect(renamed.categories[0].name).toBe('BACKEND');
    });

    it('requires reorder to be an exact permutation and keeps failed writes unchanged', () => {
        create('One');
        const set = create('Two');
        const ids = set.categories.map(category => category.id);
        for (const categoryIds of [[ids[0]], [ids[0], ids[0]], [ids[0], 'missing'], [...ids, 'extra']]) {
            expectError(() => store.reorderCategories('workspace', { expectedRevision: set.revision, categoryIds }), 'invalid');
            expect(store.getCategories('workspace')).toEqual(set);
        }
        expect(store.reorderCategories('empty', { expectedRevision: 0, categoryIds: [] })).toEqual({ revision: 1, categories: [] });
        fixture.db.exec(`CREATE TEMP TRIGGER reject_categories BEFORE UPDATE ON sentinel_todo_category_sets
            BEGIN SELECT RAISE(ABORT, 'injected failure'); END`);
        expect(() => store.reorderCategories('workspace', { expectedRevision: set.revision, categoryIds: ids.reverse() })).toThrow('injected failure');
        expect(store.getCategories('workspace')).toEqual(set);
    });
    // Seed the nullable column directly to include dangling cross-workspace assignments.
    function assign(owner: { workspaceId: string; processId: string }, categoryId: string,
        input: { title: string; type?: 'normal' | 'manual'; status?: 'todo' | 'done' } = { title: 'Work' }) {
        const { item } = store.create(owner, input, { actor: 'user' });
        fixture.db.prepare(`UPDATE sentinel_todo_items SET category_id = ?
            WHERE workspace_id = ? AND parent_process_id = ? AND id = ?`)
            .run(categoryId, owner.workspaceId, owner.processId, item.id);
        return item;
    }

    it('counts and clears every assigned item across chats, preserving other categories and workspaces', () => {
        const set = create('Backend');
        const categoryId = set.categories[0].id;
        const kept = create('Frontend');
        const a = { workspaceId: 'workspace', processId: 'a' };
        const b = { ...a, processId: 'b' };
        const other = { ...a, workspaceId: 'other' };
        const first = assign(a, categoryId);
        assign(a, categoryId, { title: 'Manual', type: 'manual' });
        assign(b, categoryId, { title: 'Completed', status: 'done' });
        const archived = assign(b, categoryId, { title: 'Archived' });
        store.update(b, archived.id, archived.revision, { archived: true }, 'user');
        assign(a, kept.categories[1].id);
        assign(other, categoryId);
        const beforeA = store.get(a);
        const beforeB = store.get(b);
        const beforeOther = store.get(other);
        expect(store.getCategoryUsage(a.workspaceId, categoryId)).toEqual({ itemCount: 4, chatCount: 2 });
        const deleted = store.deleteCategory(a.workspaceId, categoryId, { expectedRevision: kept.revision, confirmed: true });
        expect(deleted).toEqual({
            categorySet: { revision: 3, categories: [kept.categories[1]] },
            affectedOwners: [a, b], itemCount: 4, chatCount: 2,
        });
        for (const [owner, before] of [[a, beforeA], [b, beforeB]] as const) {
            const after = store.get(owner);
            expect(after.revision).toBe(before.revision + 2);
            expect(after.items).toEqual(before.items.map((item, index) => index < 2
                ? { ...item, categoryId: undefined, revision: item.revision + 1, updatedBy: 'system' } : item));
        }
        expect(store.get(other)).toEqual(beforeOther);
        const remaining = fixture.db.prepare(`SELECT workspace_id, category_id FROM sentinel_todo_items
            WHERE category_id IS NOT NULL ORDER BY workspace_id`).all();
        expect(remaining).toEqual([
            { workspace_id: 'other', category_id: categoryId },
            { workspace_id: 'workspace', category_id: kept.categories[1].id },
        ]);
        expectError(() => store.update(a, first.id, first.revision, { title: 'Stale' }, 'user'), 'conflict');
        expectError(() => store.getCategoryUsage(a.workspaceId, categoryId), 'not_found');
    });

    it('requires confirmation and the current set revision, and can delete an empty category', () => {
        const set = create('Unused');
        const categoryId = set.categories[0].id;
        expect(store.getCategoryUsage('workspace', categoryId)).toEqual({ itemCount: 0, chatCount: 0 });
        for (const confirmed of [undefined, false]) {
            expectError(() => store.deleteCategory('workspace', categoryId, { expectedRevision: 1, confirmed }), 'invalid');
        }
        expectError(() => store.deleteCategory('workspace', categoryId, { expectedRevision: 0, confirmed: true }), 'conflict');
        expectError(() => store.deleteCategory('workspace', 'missing', { expectedRevision: 1, confirmed: true }), 'not_found');
        expect(store.getCategories('workspace')).toEqual(set);
        expect(store.deleteCategory('workspace', categoryId, { expectedRevision: 1, confirmed: true })).toEqual({
            categorySet: { revision: 2, categories: [] }, affectedOwners: [], itemCount: 0, chatCount: 0,
        });
    });

    it('rolls back assignment, item and ledger changes if saving the category set fails', () => {
        const set = create('Backend');
        const categoryId = set.categories[0].id;
        const owner = { workspaceId: 'workspace', processId: 'chat' };
        assign(owner, categoryId);
        const before = store.get(owner);
        fixture.db.exec(`CREATE TEMP TRIGGER reject_category_delete BEFORE UPDATE ON sentinel_todo_category_sets
            BEGIN SELECT RAISE(ABORT, 'delete failed'); END`);
        expect(() => store.deleteCategory('workspace', categoryId, { expectedRevision: 1, confirmed: true })).toThrow('delete failed');
        expect(store.getCategories('workspace')).toEqual(set);
        expect(store.get(owner)).toEqual(before);
        expect(store.getCategoryUsage('workspace', categoryId)).toEqual({ itemCount: 1, chatCount: 1 });
    });

    it('adds the nullable assignment column to an existing database without touching items or tags', () => {
        const owner = { workspaceId: 'workspace', processId: 'chat' };
        store.create(owner, { title: 'Existing item' }, { actor: 'user' });
        store.writeTag(owner, undefined, { expectedRevision: 0, name: 'Existing tag', color: 'blue' });
        const before = store.get(owner);
        const tags = store.getTags(owner);
        const version = fixture.db.pragma<number>('user_version', { simple: true });
        fixture.db.exec('ALTER TABLE sentinel_todo_items DROP COLUMN category_id');
        fixture.close();
        // Startup opens a fresh connection against the existing schema.
        const db = new NativeDatabase(path.join(fixture.dataDir, 'processes.db'));
        try {
            const reopened = new SentinelTodoStore(db);
            new SentinelTodoStore(db); // Startup is idempotent.
            expect(reopened.get(owner)).toEqual(before);
            expect(reopened.getTags(owner)).toEqual(tags);
            expect(db.prepare('SELECT category_id FROM sentinel_todo_items').all()).toEqual([{ category_id: null }]);
            expect(db.pragma<number>('user_version', { simple: true })).toBe(version);
        } finally { db.close(); }
    });

});

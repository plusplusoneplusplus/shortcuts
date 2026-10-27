import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { createSentinelTodosTool, type SentinelTodosArgs } from '../../../src/server/llm-tools/sentinel-todos-tool';

const owner = { workspaceId: 'ws-a', processId: 'parent' };
describe('Sentinel item category assignments', () => {
    let db: NativeDatabase;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let enabled: boolean;
    let first: string;
    let second: string;
    beforeEach(() => {
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        todos = new SentinelTodoStore(db);
        enabled = true;
        first = todos.writeCategory(owner.workspaceId, undefined, { expectedRevision: 0, name: 'API' }).categories[0].id;
        second = todos.writeCategory(owner.workspaceId, undefined, { expectedRevision: 1, name: 'UI' }).categories[1].id;
        service = new SentinelTodoService({ todos, getCategoriesEnabled: () => enabled,
            store: { getProcess: async id => ({ id, metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' } }) as never } });
    });
    afterEach(() => db.close());
    function call(args: SentinelTodosArgs) {
        const { tool } = createSentinelTodosTool({ service, owner });
        return tool.handler!(args, { sessionId: 's', toolCallId: 'c', toolName: tool.name, arguments: args });
    }

    it('sets, preserves, changes and clears with normal revisions for both tracking kinds', () => {
        for (const type of ['normal', 'manual'] as const) {
            const { item } = todos.create(owner, { title: 'Work', type, categoryId: first }, { actor: 'user' });
            expect(item.categoryId).toBe(first);
            const edited = todos.update(owner, item.id, 1, { notes: 'Keep assignment' }, 'user').item;
            expect(edited.categoryId).toBe(first);
            const moved = todos.update(owner, item.id, 2, { categoryId: second }, 'user').item;
            expect(moved).toMatchObject({ revision: 3, categoryId: second, userEditedAt: edited.userEditedAt });
            expect(() => todos.update(owner, item.id, 2, { categoryId: null }, 'user'))
                .toThrow(expect.objectContaining({ code: 'conflict', current: expect.objectContaining({ categoryId: second }) }));
            expect(todos.update(owner, item.id, 3, { categoryId: null }, 'user').item.categoryId).toBeUndefined();
            expect(todos.get(owner).items.find(row => row.id === item.id)?.categoryId).toBeUndefined();
        }
    });

    it('rejects invalid and foreign assignments atomically and reads missing IDs as Uncategorized', () => {
        const foreign = todos.writeCategory('ws-b', undefined, { expectedRevision: 0, name: 'Foreign' }).categories[0].id;
        for (const categoryId of ['', 'missing', foreign, 'x'.repeat(201)]) {
            expect(() => todos.create(owner, { title: 'Work', categoryId }, { actor: 'user' })).toThrow();
        }
        expect(todos.get(owner).revision).toBe(0);
        const { item } = todos.create(owner, { title: 'Work', categoryId: first }, { actor: 'user' });
        expect(() => todos.update(owner, item.id, 1, { categoryId: foreign }, 'user')).toThrow();
        expect(todos.get(owner)).toMatchObject({ revision: 1, items: [{ revision: 1, categoryId: first }] });
        db.prepare('UPDATE sentinel_todo_items SET category_id = ?').run('missing');
        expect(todos.get(owner).items[0].categoryId).toBeUndefined();
        expect(todos.update(owner, item.id, 1, { notes: 'Still editable' }, 'user').item.categoryId).toBeUndefined();
        todos.update(owner, item.id, 2, { categoryId: second }, 'user');
        todos.deleteCategory(owner.workspaceId, second, { expectedRevision: 2, confirmed: true });
        expect(todos.get(owner).items[0]).toMatchObject({ revision: 4, notes: 'Still editable' });
        expect(todos.get(owner).items[0].categoryId).toBeUndefined();
    });

    it('preserves category assignment on idempotent replay', () => {
        const options = { actor: 'user' as const, idempotencyKey: 'same' };
        todos.create(owner, { title: 'Work', categoryId: first }, options);
        expect(todos.create(owner, { title: 'Changed', categoryId: second }, options))
            .toMatchObject({ created: false, ledgerRevision: 1, item: { title: 'Work', categoryId: first } });
    });

    it('advertises the category tool parameter only while categories are enabled', () => {
        const schema = () => createSentinelTodosTool({ service, owner }).tool.parameters as any;
        expect(schema().properties.categoryId).toMatchObject({ type: ['string', 'null'] });
        expect(schema().properties.tagIds).toBeUndefined();
        enabled = false;
        expect(schema().properties.categoryId).toBeUndefined();
    });

    it('round-trips categories through the tool with discoverable workspace definitions and conflicts', async () => {
        const result = await call({ action: 'create', title: 'Work', completionCondition: 'Shipped', categoryId: first }) as any;
        expect(result.item.categoryId).toBe(first);
        expect(await call({ action: 'list' })).toMatchObject({ categorySet: { revision: 2,
            categories: [{ id: first }, { id: second }] }, items: [{ categoryId: first }] });
        expect(await call({ action: 'update', itemId: result.item.id, expectedRevision: 1, categoryId: second }))
            .toMatchObject({ item: { revision: 2, categoryId: second } });
        expect(await call({ action: 'update', itemId: result.item.id, expectedRevision: 1, categoryId: null }))
            .toMatchObject({ code: 'conflict', current: { categoryId: second } });
        const cleared = await call({ action: 'update', itemId: result.item.id, expectedRevision: 2, categoryId: null }) as any;
        expect(cleared.item.categoryId).toBeUndefined();
    });

    it('hides assignments and conflict payloads and rejects writes while disabled, preserving stored data', async () => {
        const { item } = await service.create(owner, { title: 'Work', categoryId: first }, { actor: 'user' });
        enabled = false;
        expect((await service.list(owner)).items[0].categoryId).toBeUndefined();
        expect(await call({ action: 'list' })).not.toHaveProperty('categorySet');
        for (const categoryId of [first, null]) {
            await expect(service.create(owner, { title: 'Hidden', categoryId }, { actor: 'user' })).rejects.toMatchObject({ code: 'invalid' });
            await expect(service.update(owner, item.id, 1, { categoryId }, 'user')).rejects.toMatchObject({ code: 'invalid' });
            expect(await call({ action: 'update', itemId: item.id, expectedRevision: 1, categoryId })).toMatchObject({ code: 'disabled' });
        }
        expect((await service.update(owner, item.id, 1, { notes: 'Still editable' }, 'user')).item.categoryId).toBeUndefined();
        try { await service.update(owner, item.id, 1, { notes: 'Stale' }, 'user'); }
        catch (error: any) { expect(error.current.categoryId).toBeUndefined(); }
        enabled = true;
        expect((await service.list(owner)).items[0].categoryId).toBe(first);
    });
});

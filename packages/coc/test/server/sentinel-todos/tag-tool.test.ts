import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { createSentinelTodosTool, type SentinelTodosArgs } from '../../../src/server/llm-tools/sentinel-todos-tool';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { createTodoTestDatabase, createTodoTestDirectory } from './test-db';

const owner = { workspaceId: 'workspace-a', processId: 'queue_parent' };
const foreign = { ...owner, processId: 'queue_other' };

describe('Sentinel tag tool integration', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let enabled: boolean;

    function call(args: SentinelTodosArgs, reviewOnly = false) {
        const { tool } = createSentinelTodosTool({ service, owner, reviewOnly });
        return tool.handler!(args, {
            sessionId: 'session', toolCallId: 'call', toolName: tool.name, arguments: args,
        });
    }

    beforeEach(() => {
        database = createTodoTestDatabase(createTodoTestDirectory());
        todos = new SentinelTodoStore(database.db);
        enabled = true;
        service = new SentinelTodoService({
            todos, getTagsEnabled: () => enabled,
            store: { getProcess: async id => ({
                id, type: 'chat', status: 'completed', startTime: new Date(),
                fullPrompt: '', promptPreview: '',
                metadata: { type: 'chat', workspaceId: owner.workspaceId, mode: 'sentinel' },
            } satisfies AIProcess) },
        });
    });
    afterEach(() => database.dispose());

    it('shares owner-bound library commands and includes definitions in list results', async () => {
        expect(await call({
            action: 'create_tag', expectedRevision: 0, tagName: 'Docs', tagColor: 'violet',
            tagDescription: 'Documentation and guides',
        })).toMatchObject({ tagLibrary: { revision: 1, tags: [{ name: 'Docs' }] } });
        const library = await service.getTags(owner);
        const tag = library.tags[0];
        expect(await call({ action: 'list_tags' })).toEqual({ tagLibrary: library });
        expect(await call({
            action: 'create', type: 'manual', title: 'Keep guide checklist',
            tagIds: [tag.id], targetRepo: { workspaceId: 'workspace-b' },
        })).toMatchObject({ item: { type: 'manual', status: 'todo', tagIds: [tag.id], jobs: [] } });
        expect(await call({ action: 'list' })).toMatchObject({ tagLibrary: library });
        expect(await service.getTags(foreign)).toEqual({ revision: 0, tags: [] });
        expect(await call({
            action: 'update_tag', tagId: tag.id, expectedRevision: 1,
            tagName: 'Guides', tagColor: 'blue', tagDescription: 'Guides',
        })).toMatchObject({ tagLibrary: { revision: 2, tags: [{ id: tag.id, name: 'Guides' }] } });
        expect(await call({ action: 'delete_tag', tagId: tag.id, expectedRevision: 2 }))
            .toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'delete_tag', tagId: tag.id, expectedRevision: 2, confirmed: true }))
            .toMatchObject({ tagLibrary: { tags: [] } });
        expect(todos.get(owner).items[0]).toMatchObject({ type: 'manual', status: 'todo', jobs: [], tagIds: [] });
    });

    it('cannot override explicit user removals or claim failed matching succeeded', async () => {
        await service.createTag(owner, { expectedRevision: 0, name: 'Docs', color: 'blue' });
        const { item } = await service.create(owner, { title: 'Write docs', type: 'manual', tagIds: [] }, { actor: 'user' });
        expect(await call({
            action: 'update', itemId: item.id, expectedRevision: item.revision,
            notes: 'Write a documentation guide',
        })).toMatchObject({ item: { notes: 'Write a documentation guide', tagIds: [], tagOrigin: 'manual' } });
        const current = todos.get(owner).items[0];
        expect(await call({
            action: 'suggest_tags', itemId: current.id, expectedRevision: current.revision,
            expectedTagRevision: current.tagRevision ?? 0, confirmed: true,
        })).toMatchObject({ code: 'invalid' });
        expect(todos.get(owner).items[0]).toMatchObject({ tagIds: [], tagOrigin: 'manual' });
        expect(await call({ action: 'create', title: 'Write docs', completionCondition: 'Guide published' }))
            .toMatchObject({ item: { title: 'Write docs', tagMatch: { state: 'unavailable' } } });
    });

    it('hides and rejects tags while disabled, including forged create/update fields', async () => {
        enabled = false;
        const { tool } = createSentinelTodosTool({ service, owner });
        expect(tool.description).not.toContain('list_tags');
        expect(tool.parameters).not.toHaveProperty('properties.tagIds');
        for (const action of ['list_tags', 'create_tag', 'update_tag', 'delete_tag', 'suggest_tags'] as const) {
            expect(await call({ action })).toMatchObject({ code: 'disabled' });
        }
        expect(await call({ action: 'create', type: 'manual', title: 'Checklist', tagIds: [] }))
            .toMatchObject({ code: 'disabled' });
        expect(todos.get(owner).items).toEqual([]);
    });

    it('keeps native outcome reviews limited to verdicts even when tags are enabled', async () => {
        const { tool } = createSentinelTodosTool({ service, owner, reviewOnly: true });
        expect(tool.parameters).not.toHaveProperty('properties.tagIds');
        for (const action of ['list_tags', 'create_tag', 'suggest_tags'] as const) {
            expect(await call({ action }, true)).toMatchObject({ code: 'invalid' });
        }
        expect(await call({ action: 'update', itemId: 'item', expectedRevision: 1, tagIds: [] }, true))
            .toMatchObject({ code: 'invalid' });
    });

    it('requires an actual edit rather than treating matching options as content', async () => {
        const { item } = await service.create(owner, { title: 'Checklist', type: 'manual' }, { actor: 'user' });
        const before = todos.get(owner);
        expect(await call({
            action: 'update', itemId: item.id, expectedRevision: item.revision, matchMultiple: true,
        })).toMatchObject({ code: 'invalid' });
        expect(todos.get(owner)).toEqual(before);
    });

    it('passes independent tag CAS without changing item content or execution state', async () => {
        const library = await service.createTag(owner, { expectedRevision: 0, name: 'Docs', color: 'blue' });
        const { item } = await service.create(owner, { title: 'Checklist', type: 'manual' }, { actor: 'user' });
        expect(await call({
            action: 'update', itemId: item.id, expectedRevision: item.revision,
            expectedTagRevision: item.tagRevision ?? 0, tagIds: [library.tags[0].id],
        })).toMatchObject({ item: { revision: item.revision, tagIds: [library.tags[0].id], status: 'todo', jobs: [] } });
        const current = todos.get(owner).items[0];
        expect(current.tagRevision).toBe((item.tagRevision ?? 0) + 1);
        expect(await call({
            action: 'update', itemId: item.id, expectedRevision: item.revision,
            expectedTagRevision: item.tagRevision ?? 0, tagIds: [],
        })).toMatchObject({ code: 'conflict' });
        expect(todos.get(owner).items[0].tagIds).toEqual([library.tags[0].id]);
    });
});

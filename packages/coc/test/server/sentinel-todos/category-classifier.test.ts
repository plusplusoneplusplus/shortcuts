import { NativeDatabase } from '@plusplusoneplusplus/coc-native';
import { initializeDatabase } from '@plusplusoneplusplus/forge';
import type { DecisionResponse } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentinelTodoStore } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import { DecisionBackendError } from '../../../src/server/decisions/decision-backend';
import {
    CATEGORY_CLASSIFICATION_TIMEOUT_MS, pickTodoCategory,
} from '../../../src/server/sentinel-todos/sentinel-todo-category-classifier';
import { createSentinelTodosTool, type SentinelTodosArgs } from '../../../src/server/llm-tools/sentinel-todos-tool';

const owner = { workspaceId: 'ws-a', processId: 'parent' };
const context = { workspaceId: owner.workspaceId, workingDirectory: '/repo' };
const item = { title: 'Fix login API', notes: '', completionCondition: '' };
const choice = (value: string): DecisionResponse => ({
    backend: 'copilot', model: 'test', metadata: { attempts: 1, durationMs: 0, confidenceKind: 'self_reported' },
    answers: { category: { type: 'choice', choice: value, probabilities: { [value]: 1 }, confidence: 1 } },
});
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}
const unavailable = () => new DecisionBackendError({ code: 'DECISION_BACKEND_UNAVAILABLE', status: 503, message: 'Unavailable' });

describe('pickTodoCategory', () => {
    const categories = [{ id: 'api', name: 'API' }, { id: 'ui', name: 'UI' }];
    afterEach(() => { vi.useRealTimers(); });

    it('asks one single-choice question and returns the matching category', async () => {
        const evaluate = vi.fn().mockResolvedValue(choice('category_1'));
        await expect(pickTodoCategory({ evaluate }, context, item, categories))
            .resolves.toEqual({ state: 'matched', categoryId: 'ui' });
        const [request, options] = evaluate.mock.calls[0];
        expect(request.questions.category).toMatchObject({ type: 'choice',
            criteria: { none: expect.any(String), category_0: 'API', category_1: 'UI' } });
        expect(request.state).toMatchObject({ item, categories: [{ index: 0, name: 'API' }, { index: 1, name: 'UI' }] });
        expect(options).toMatchObject(context);
    });

    it('reads none, invented choices and failures as no category', async () => {
        await expect(pickTodoCategory({ evaluate: vi.fn().mockResolvedValue(choice('none')) }, context, item, categories))
            .resolves.toEqual({ state: 'no_match' });
        await expect(pickTodoCategory({ evaluate: vi.fn().mockResolvedValue(choice('category_9')) }, context, item, categories))
            .resolves.toMatchObject({ state: 'failed' });
        await expect(pickTodoCategory({ evaluate: vi.fn().mockRejectedValue(new Error('boom')) }, context, item, categories))
            .resolves.toMatchObject({ state: 'failed' });
    });

    it('skips the backend with no categories and reports an unavailable backend or workspace', async () => {
        const evaluate = vi.fn();
        await expect(pickTodoCategory({ evaluate }, context, item, [])).resolves.toEqual({ state: 'no_match' });
        await expect(pickTodoCategory(undefined, context, item, categories)).resolves.toMatchObject({ state: 'unavailable' });
        await expect(pickTodoCategory({ evaluate }, undefined, item, categories)).resolves.toMatchObject({ state: 'unavailable' });
        expect(evaluate).not.toHaveBeenCalled();
        await expect(pickTodoCategory({ evaluate: vi.fn().mockRejectedValue(unavailable()) }, context, item, categories))
            .resolves.toMatchObject({ state: 'unavailable' });
    });

    it('times out, aborts the backend and clears its timer', async () => {
        vi.useFakeTimers();
        const evaluate = vi.fn().mockReturnValue(new Promise(() => {}));
        const picking = pickTodoCategory({ evaluate }, context, item, categories);
        await vi.advanceTimersByTimeAsync(CATEGORY_CLASSIFICATION_TIMEOUT_MS);
        await expect(picking).resolves.toEqual({ state: 'failed', message: 'Category classification timed out' });
        expect((evaluate.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('automatic category pick on create', () => {
    let db: NativeDatabase;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let evaluate: ReturnType<typeof vi.fn>;
    let enabled: boolean;
    let onChange: ReturnType<typeof vi.fn>;
    let api: string;
    let ui: string;
    beforeEach(() => {
        db = new NativeDatabase(':memory:');
        initializeDatabase(db);
        todos = new SentinelTodoStore(db);
        enabled = true;
        api = todos.writeCategory(owner.workspaceId, undefined, { expectedRevision: 0, name: 'API' }).categories[0].id;
        ui = todos.writeCategory(owner.workspaceId, undefined, { expectedRevision: 1, name: 'UI' }).categories[1].id;
        evaluate = vi.fn().mockResolvedValue(choice('category_0'));
        onChange = vi.fn();
        service = new SentinelTodoService({ todos, getCategoriesEnabled: () => enabled, decisions: { evaluate: evaluate as never },
            resolveWorkspaceRoot: async () => '/repo', onChange,
            store: { getProcess: async id => ({ id, metadata: { workspaceId: owner.workspaceId, mode: 'sentinel' } }) as never } });
    });
    afterEach(() => { vi.useRealTimers(); db.close(); });

    it('assigns the matched category to user- and Sentinel-created items', async () => {
        for (const actor of ['user', 'sentinel'] as const) {
            const result = await service.create(owner, { title: `${actor} API work` }, { actor });
            expect(result.item).toMatchObject({ categoryId: api, revision: 2, updatedBy: 'system' });
            expect(todos.get(owner).items.find(row => row.id === result.item.id)).toEqual(result.item);
            expect(result.ledgerRevision).toBe(todos.get(owner).revision);
        }
        expect(evaluate.mock.calls[0][1]).toMatchObject({ workspaceId: owner.workspaceId, workingDirectory: '/repo' });
        expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ item: expect.objectContaining({ categoryId: api }) }));
    });

    it.each([
        ['no match', () => evaluate.mockResolvedValue(choice('none'))],
        ['unavailable backend', () => evaluate.mockRejectedValue(unavailable())],
        ['failed backend', () => evaluate.mockRejectedValue(new Error('boom'))],
    ])('saves the item as Uncategorized on %s', async (_name, arrange) => {
        arrange();
        const result = await service.create(owner, { title: 'Something' }, { actor: 'user' });
        expect(result.created).toBe(true);
        expect(result.item.categoryId).toBeUndefined();
        expect(result.item.revision).toBe(1);
        expect(todos.get(owner).items).toHaveLength(1);
    });

    it('saves the item as Uncategorized when classification times out and ignores the late answer', async () => {
        const pending = deferred<DecisionResponse>();
        evaluate.mockReturnValue(pending.promise);
        vi.useFakeTimers();
        const saving = service.create(owner, { title: 'Slow' }, { actor: 'user' });
        await vi.advanceTimersByTimeAsync(0);
        expect(todos.get(owner).items[0].title).toBe('Slow');
        await vi.advanceTimersByTimeAsync(CATEGORY_CLASSIFICATION_TIMEOUT_MS);
        expect((await saving).item.categoryId).toBeUndefined();
        const before = todos.get(owner);
        pending.resolve(choice('category_0'));
        await vi.advanceTimersByTimeAsync(0);
        expect(todos.get(owner)).toEqual(before);
    });

    it('never classifies an explicit choice, including explicit Uncategorized', async () => {
        expect((await service.create(owner, { title: 'Mine', categoryId: ui }, { actor: 'user' })).item.categoryId).toBe(ui);
        expect((await service.create(owner, { title: 'None', categoryId: null }, { actor: 'user' })).item.categoryId).toBeUndefined();
        expect(evaluate).not.toHaveBeenCalled();
    });

    it('keeps a user move made while classification was running', async () => {
        const pending = deferred<DecisionResponse>();
        evaluate.mockReturnValue(pending.promise);
        const saving = service.create(owner, { title: 'Racing' }, { actor: 'user' });
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
        const saved = todos.get(owner).items[0];
        todos.update(owner, saved.id, saved.revision, { categoryId: ui }, 'user');
        pending.resolve(choice('category_0'));
        const result = await saving;
        expect(result.item.categoryId).toBe(ui);
        expect(todos.get(owner).items[0]).toMatchObject({ categoryId: ui, revision: 2 });
    });

    it('drops a pick when the category set changed during classification', async () => {
        const pending = deferred<DecisionResponse>();
        evaluate.mockReturnValue(pending.promise);
        const saving = service.create(owner, { title: 'Racing' }, { actor: 'user' });
        await vi.waitFor(() => expect(evaluate).toHaveBeenCalled());
        todos.deleteCategory(owner.workspaceId, api, { expectedRevision: 2, confirmed: true });
        pending.resolve(choice('category_0'));
        expect((await saving).item.categoryId).toBeUndefined();
    });

    it('does not re-pick on later edits, so a user-picked category survives', async () => {
        const { item } = await service.create(owner, { title: 'API work' }, { actor: 'user' });
        const moved = await service.update(owner, item.id, item.revision, { categoryId: ui }, 'user');
        evaluate.mockClear();
        const edited = await service.update(owner, item.id, moved.item.revision, { title: 'API work, renamed', notes: 'More' }, 'user');
        expect(edited.item.categoryId).toBe(ui);
        expect(evaluate).not.toHaveBeenCalled();
        expect(() => todos.setPickedCategory(owner, item.id, edited.item.revision, 2, api))
            .toThrow(expect.objectContaining({ code: 'conflict' }));
        expect(todos.get(owner).items[0].categoryId).toBe(ui);
    });

    it('skips classification when categories are disabled or the set is empty', async () => {
        enabled = false;
        await service.create(owner, { title: 'Off' }, { actor: 'user' });
        enabled = true;
        todos.deleteCategory(owner.workspaceId, api, { expectedRevision: 2, confirmed: true });
        todos.deleteCategory(owner.workspaceId, ui, { expectedRevision: 3, confirmed: true });
        await service.create(owner, { title: 'Empty' }, { actor: 'user' });
        expect(evaluate).not.toHaveBeenCalled();
    });

    it('auto-picks through the Sentinel tool when categoryId is omitted', async () => {
        const { tool } = createSentinelTodosTool({ service, owner });
        const args: SentinelTodosArgs = { action: 'create', title: 'Tool API work', completionCondition: 'API ships' } as SentinelTodosArgs;
        const result = await tool.handler!(args, { sessionId: 's', toolCallId: 'c', toolName: tool.name, arguments: args }) as any;
        expect(JSON.stringify(result)).toContain(api);
        expect(todos.get(owner).items[0].categoryId).toBe(api);
    });
});

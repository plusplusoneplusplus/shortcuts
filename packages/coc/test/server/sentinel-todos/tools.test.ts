import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { SentinelTodoStore, type SentinelTodoItem } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import {
    SENTINEL_TODOS_TOOL_NAME, createSentinelTodosTool, type SentinelTodosArgs,
    createSentinelTodoTracking,
} from '../../../src/server/llm-tools/sentinel-todos-tool';
import { buildSentinelTodosAddon, SENTINEL_TODO_LEDGER_GUIDANCE } from '../../../src/server/executors/prompt-builder';
import { SENTINEL_JOB_REVIEW_INSTRUCTIONS } from '../../../src/server/delegation/sentinel-job-review-instructions';
import { SENTINEL_DISPATCHER_DIRECTIVE } from '../../../src/server/executors/chat-mode-directive';
import { createTodoTestDatabase, createTodoTestDirectory, failTodoWrites } from './test-db';

const owner = { workspaceId: 'ws-a', processId: 'queue_parent' };
const other = { workspaceId: 'ws-a', processId: 'queue_other' };

function sentinelProcess(id: string, workspaceId: string, mode = 'sentinel'): AIProcess {
    return { id, type: 'chat', status: 'completed', startTime: new Date(), metadata: { workspaceId, mode } } as unknown as AIProcess;
}

describe('sentinel_todos tool', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let onChange: ReturnType<typeof vi.fn>;
    const processes = new Map<string, AIProcess>();

    function call(args: SentinelTodosArgs | Record<string, unknown>, bound = owner, svc = service) {
        const { tool } = createSentinelTodosTool({ service: svc, owner: bound });
        return (tool as any).handler(args, {}) as Promise<any>;
    }

    async function createItem(extra: Partial<SentinelTodosArgs> = {}): Promise<SentinelTodoItem> {
        const result = await call({ action: 'create', title: 'Fix login', completionCondition: 'Login test passes', ...extra });
        expect(result.error).toBeUndefined();
        return result.item;
    }

    beforeEach(() => {
        database = createTodoTestDatabase(createTodoTestDirectory());
        processes.clear();
        processes.set(owner.processId, sentinelProcess(owner.processId, owner.workspaceId));
        processes.set(other.processId, sentinelProcess(other.processId, other.workspaceId));
        processes.set('queue_ask', sentinelProcess('queue_ask', 'ws-a', 'ask'));
        todos = new SentinelTodoStore(database.db);
        onChange = vi.fn();
        service = new SentinelTodoService({
            todos, onChange,
            store: { getProcess: async (id: string) => processes.get(id) },
        });
    });
    afterEach(() => { database.dispose(); });

    it('permits native review verdict bookkeeping but rejects authoring and trigger actions even with forged arguments', async () => {
        const item = await createItem();
        const { tool } = createSentinelTodosTool({ service, owner, reviewOnly: true, triggers: {} as never });
        const review = (args: Record<string, unknown>) => (tool as any).handler(args, {});
        expect((tool.parameters as any).properties.action.enum).toEqual(['list', 'update']);
        for (const action of ['create', 'attach_reference', 'set_dependencies', 'create_trigger', 'run_trigger_now']) {
            expect(await review({ action, itemId: item.id })).toMatchObject({ code: 'invalid' });
        }
        for (const patch of [{ title: 'Different work' }, { notes: 'Implement next' }, { completionCondition: 'PR merged' }, { status: 'in_progress' }]) {
            expect(await review({ action: 'update', itemId: item.id, expectedRevision: 1, ...patch })).toMatchObject({ code: 'invalid' });
        }
        expect(await review({ action: 'list', itemId: item.id })).toMatchObject({ items: [{ id: item.id }] });
        expect(await review({ action: 'update', itemId: item.id, expectedRevision: 1,
            status: 'needs_attention', reason: 'Closed without delivering the requested outcome' }))
            .toMatchObject({ item: { status: 'needs_attention', completionCondition: item.completionCondition } });
        const addon = buildSentinelTodosAddon({ service, owner, reviewOnly: true });
        expect(addon.suffix).toContain('PR outcome review only');
        expect(addon.suffix).not.toContain('send_to_conversation');
    });

    it.each(['done', 'archived', 'manual'])('native review cannot override a current %s item verdict', async state => {
        const item = await createItem(state === 'manual' ? { type: 'manual' } : {});
        if (state === 'done') todos.update(owner, item.id, 1, { status: 'done' }, 'user');
        if (state === 'archived') todos.update(owner, item.id, 1, { archived: true }, 'user');
        const current = todos.get(owner).items.find(current => current.id === item.id)!;
        const { tool } = createSentinelTodosTool({ service, owner, reviewOnly: true });
        expect(await (tool as any).handler({ action: 'update', itemId: item.id, expectedRevision: current.revision,
            status: 'needs_attention', reason: 'PR closed' }, {})).toMatchObject({ code: 'invalid' });
        expect(todos.get(owner).items.find(current => current.id === item.id)).toEqual(current);
    });
    it('is named sentinel_todos and offers no archive or job-control parameters', () => {
        const { tool } = createSentinelTodosTool({ service, owner });
        expect(tool.name).toBe(SENTINEL_TODOS_TOOL_NAME);
        const props = Object.keys((tool as any).parameters.properties);
        expect(props).not.toContain('archived');
        expect(props).not.toContain('processId');
        expect(props).not.toContain('workspaceId');
        expect((tool as any).parameters.properties.action.enum).toEqual(['list', 'create', 'update', 'attach_reference']);
    });

    it('exposes revision-checked dependency edits only behind the live gate, bound to the invoking owner', async () => {
        const enabled = { value: true };
        service = new SentinelTodoService({
            todos, onChange, getDependenciesEnabled: () => enabled.value,
            store: { getProcess: async id => processes.get(id) },
        });
        const a = await createItem();
        const b = await createItem({ title: 'Dependent', targetRepo: { workspaceId: 'ws-b' } });
        const { tool } = createSentinelTodosTool({ service, owner });
        expect((tool.parameters as { properties: { action: { enum: string[] } } }).properties.action.enum).toContain('set_dependencies');
        expect(await call({ action: 'set_dependencies', itemId: b.id, expectedRevision: 1,
            dependsOn: [{ itemId: a.id, condition: { kind: 'done' } }] })).toMatchObject({ item: { revision: 2, status: 'todo' } });
        expect(await call({ action: 'set_dependencies', itemId: b.id, expectedRevision: 1, dependsOn: [] })).toMatchObject({ code: 'conflict' });
        expect(await call({ action: 'set_dependencies', itemId: b.id, expectedRevision: 2, dependsOn: [] }, other)).toMatchObject({ code: 'not_found' });
        expect(await createSentinelTodoTracking({ service, owner }).check(b.id)).toContain('Nothing was launched');
        enabled.value = false;
        expect(await call({ action: 'set_dependencies', itemId: b.id, expectedRevision: 2, dependsOn: [] })).toMatchObject({ code: 'disabled' });
        expect((createSentinelTodosTool({ service, owner }).tool.parameters as { properties: { action: { enum: string[] } } }).properties.action.enum)
            .not.toContain('set_dependencies');
    });

    it('creates an item as sentinel with a completion condition and lists it', async () => {
        const item = await createItem({ targetRepo: { workspaceId: 'ws-b', label: 'web' }, notes: 'from chat' });
        expect(item).toMatchObject({
            title: 'Fix login', completionCondition: 'Login test passes', status: 'todo',
            createdBy: 'sentinel', notes: 'from chat', targetRepo: { workspaceId: 'ws-b', label: 'web' },
        });
        expect(onChange).toHaveBeenCalledTimes(1);

        const listed = await call({ action: 'list' });
        expect(listed.items.map((i: SentinelTodoItem) => i.id)).toEqual([item.id]);
        expect(listed.ledgerRevision).toBe(1);
    });

    it('lists all active items plus recent Done, supports older lookup and never caps tracking or retained records at 50', async () => {
        const items = Array.from({ length: 60 }, (_, index) => todos.create(owner, {
            title: `Item ${index}`, completionCondition: 'Delivered', status: index === 0 ? 'in_progress' : 'done',
        }, { actor: 'user' }).item);
        todos.update(owner, items[59].id, 1, { archived: true }, 'user');
        const recent = await call({ action: 'list' });
        expect(recent.items.map((item: SentinelTodoItem) => item.id)).toEqual([items[0], ...items.slice(10, 59).reverse()].map(item => item.id));
        expect(recent).toMatchObject({ total: 59, archivedCount: 1, hasMore: true, nextOffset: 50 });
        const older = await call({ action: 'list', offset: recent.nextOffset });
        expect(older.items.map((item: SentinelTodoItem) => item.id)).toEqual(items.slice(1, 10).reverse().map(item => item.id));
        expect(older).toMatchObject({ hasMore: false, nextOffset: null });
        expect((await call({ action: 'list', itemId: items[0].id })).items).toEqual([items[0]]);
        expect((await call({ action: 'list', includeArchived: true })).items.map((item: SentinelTodoItem) => item.id))
            .toEqual(recent.items.map((item: SentinelTodoItem) => item.id));
        expect((await call({ action: 'list', itemId: items[59].id, includeArchived: true })).items[0].archived).toBe(true);
        expect((await call({ action: 'list', limit: 500, includeArchived: true })).items).toHaveLength(60);
        expect(await call({ action: 'list', itemId: items[0].id }, other)).toMatchObject({ code: 'not_found' });
        const tracking = createSentinelTodoTracking({ service, owner });
        expect(await tracking.check(items[0].id)).toBeUndefined();
        expect(await tracking.prepare?.(items[0].id, {})).toMatchObject({ dependencyBound: false });
        expect(await call({ action: 'update', itemId: items[0].id, expectedRevision: 1, notes: 'Older record' }))
            .toMatchObject({ item: { notes: 'Older record' } });
        expect((await service.list(owner)).items).toHaveLength(60);
        expect(todos.get(owner).items).toHaveLength(60);
    });

    it('keeps every active item visible above 50 and returns a Done-only continuation', async () => {
        const active = Array.from({ length: 55 }, (_, index) => todos.create(owner, {
            title: `Active ${index}`, completionCondition: 'Delivered', type: index === 0 ? 'manual' : 'normal',
        }, { actor: 'user' }).item);
        const done = todos.create(owner, { title: 'Done', status: 'done' }, { actor: 'user' }).item;
        const first = await call({ action: 'list' });
        expect(first.items).toEqual(active);
        expect(first).toMatchObject({ total: 56, hasMore: true, nextOffset: 55 });
        expect(await call({ action: 'list', offset: first.nextOffset })).toMatchObject({ items: [done], hasMore: false });
        expect((await call({ action: 'list', limit: 1 })).items).toEqual(active);
        expect((await call({ action: 'list', itemId: done.id, offset: 55 })).items).toEqual([done]);
    });

    it.each([{ limit: 0 }, { limit: 501 }, { limit: 1.5 }, { offset: -1 }, { offset: 1.5 }])(
        'rejects invalid list paging: %s', async options => {
            expect(await call({ action: 'list', ...options })).toMatchObject({ code: 'invalid' });
        },
    );

    it('requires a completion condition on create', async () => {
        const result = await call({ action: 'create', title: 'Vague idea' });
        expect(result).toMatchObject({ code: 'invalid' });
        expect(todos.get(owner).items).toHaveLength(0);
    });

    it('replays a retried create with the same idempotency key instead of duplicating', async () => {
        const first = await call({ action: 'create', title: 'A', completionCondition: 'c', idempotencyKey: 'k1' });
        const second = await call({ action: 'create', title: 'A', completionCondition: 'c', idempotencyKey: 'k1' });
        expect(first.created).toBe(true);
        expect(second).toMatchObject({ created: false, item: { id: first.item.id } });
        expect(todos.get(owner).items).toHaveLength(1);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('requires a reason for done and needs_attention', async () => {
        const item = await createItem();
        for (const status of ['done', 'needs_attention'] as const) {
            const result = await call({ action: 'update', itemId: item.id, expectedRevision: 1, status });
            expect(result).toMatchObject({ code: 'invalid' });
        }
        expect((await call({ action: 'create', title: 'x', completionCondition: 'y', status: 'done' })).code).toBe('invalid');
        expect(todos.get(owner).items[0].revision).toBe(1);
    });

    it('acknowledges exact result evidence through the verdict tool without treating unrelated edits as review', async () => {
        const item = await createItem();
        await service.linkJob(owner, item.id, {
            processId: 'queue_child', workspaceId: 'ws-child', kind: 'local', openLink: '#',
        });
        expect(await call({
            action: 'update', itemId: item.id, expectedRevision: todos.get(owner).items[0].revision,
            status: 'todo', reason: 'No result yet',
            reviewedJobs: [{ processId: 'queue_child', terminalEventId: 'event' }],
        })).toMatchObject({ code: 'invalid' });
        todos.recordJobResult(owner, 'queue_child', { terminalEventId: 'event', outcome: 'completed' }, () => 'Completed');
        const current = todos.get(owner).items[0];
        expect((await call({ action: 'update', itemId: item.id, expectedRevision: current.revision,
            notes: 'Unrelated edit' })).item.jobs[0].result.reviewed).toBeUndefined();
        const revision = todos.get(owner).items[0].revision;
        const reviewedJobs = [{ processId: 'queue_child', terminalEventId: 'event' }];
        expect(await call({ action: 'update', itemId: item.id, expectedRevision: revision, reviewedJobs }))
            .toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'update', itemId: item.id, expectedRevision: revision, reviewedJobs, status: 'todo' }))
            .toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'update', itemId: item.id, expectedRevision: revision, reviewedJobs,
            status: 'todo', reason: 'Spec ready; awaiting implementation approval' }))
            .toMatchObject({ item: { status: 'todo', jobs: [{ result: { reviewed: { recordedBy: 'sentinel' } } }] } });
        expect((await call({ action: 'list' })).items[0].jobs[0].execution)
            .toMatchObject({ review: { assessment: 'reviewed', terminalEventId: 'event' } });
    });

    it('records the reviewed reason as the outcome with sentinel provenance when marking done', async () => {
        const item = await createItem();
        const result = await call({
            action: 'update', itemId: item.id, expectedRevision: 1, status: 'done', reason: 'Login test passed in job X',
        });
        expect(result.item).toMatchObject({
            status: 'done', statusReason: 'Login test passed in job X', revision: 2, updatedBy: 'sentinel',
            outcome: { summary: 'Login test passed in job X', recordedBy: 'sentinel' },
        });
    });

    it('keeps a grilled feature todo until its final deliverable is reviewed on the same item', async () => {
        const item = await createItem({
            title: 'Add login', completionCondition: 'Login implemented and e2e passes',
            status: 'in_progress', notes: 'User requested grilling first.',
        });
        const specReady = await call({
            action: 'update', itemId: item.id, expectedRevision: item.revision,
            status: 'todo', reason: 'Spec ready; awaiting implementation approval',
            notes: `${item.notes}\nGrilling complete: notes/login-spec.md`,
        });
        expect(specReady.item).toMatchObject({
            id: item.id, status: 'todo', revision: 2,
            completionCondition: 'Login implemented and e2e passes',
            statusReason: 'Spec ready; awaiting implementation approval',
            notes: 'User requested grilling first.\nGrilling complete: notes/login-spec.md',
        });
        expect(specReady.item.outcome).toBeUndefined();
        const implementing = await call({
            action: 'update', itemId: item.id, expectedRevision: specReady.item.revision,
            status: 'in_progress', reason: 'User authorized implementation',
        });
        const done = await call({
            action: 'update', itemId: item.id, expectedRevision: implementing.item.revision,
            status: 'done', reason: 'Login implemented and e2e passes',
        });
        expect(done.item).toMatchObject({
            id: item.id, status: 'done', revision: 4, notes: specReady.item.notes,
            outcome: { summary: 'Login implemented and e2e passes', recordedBy: 'sentinel' },
        });
        expect((await call({ action: 'list' })).items).toHaveLength(1);
    });

    it('keeps an explicit outcome separate from the reason', async () => {
        const item = await createItem();
        const result = await call({
            action: 'update', itemId: item.id, expectedRevision: 1,
            status: 'needs_attention', reason: 'Job failed', outcome: 'Build broke on Windows',
        });
        expect(result.item).toMatchObject({
            status: 'needs_attention', statusReason: 'Job failed', outcome: { summary: 'Build broke on Windows' },
        });
    });

    it('sets priority on create and update independently of status, and rejects unknown values', async () => {
        const { tool } = createSentinelTodosTool({ service, owner });
        expect((tool as any).parameters.properties.priority.enum).toEqual(['high', 'regular']);
        expect((await createItem()).priority).toBe('regular');
        const item = await createItem({ title: 'Urgent', priority: 'high', idempotencyKey: 'k-high' });
        expect(item).toMatchObject({ priority: 'high', status: 'todo' });

        await call({ action: 'update', itemId: item.id, expectedRevision: 1, status: 'needs_attention', reason: 'Blocked' });
        const lowered = await call({ action: 'update', itemId: item.id, expectedRevision: 2, priority: 'regular' });
        expect(lowered.item).toMatchObject({ priority: 'regular', status: 'needs_attention', statusReason: 'Blocked', revision: 3, updatedBy: 'sentinel' });

        expect(await call({ action: 'create', title: 'x', completionCondition: 'c', priority: 'urgent' })).toMatchObject({ code: 'invalid' });
        expect(await call({ action: 'update', itemId: item.id, expectedRevision: 3, priority: 'low' })).toMatchObject({ code: 'invalid' });
        expect(todos.get(owner).items).toHaveLength(2);
        expect(todos.get(owner).items[1]).toMatchObject({ priority: 'regular', revision: 3 });
    });

    it('reports a stale write as a conflict with the current item and leaves it unchanged', async () => {
        const item = await createItem();
        todos.update(owner, item.id, 1, { notes: 'user edit' }, 'user');

        const result = await call({ action: 'update', itemId: item.id, expectedRevision: 1, notes: 'ai edit' });
        expect(result).toMatchObject({ code: 'conflict', current: { notes: 'user edit', revision: 2 } });
        expect(todos.get(owner).items[0]).toMatchObject({ notes: 'user edit', revision: 2, updatedBy: 'user' });
    });

    it('rejects an update with no changes or without a revision', async () => {
        const item = await createItem();
        expect((await call({ action: 'update', itemId: item.id, expectedRevision: 1 })).code).toBe('invalid');
        expect((await call({ action: 'update', itemId: item.id, notes: 'x' })).code).toBe('invalid');
        expect((await call({ action: 'remove', itemId: item.id })).code).toBe('invalid');
    });

    it('rejects archive requests without applying accompanying edits: archiving stays a user action', async () => {
        const item = await createItem();
        const result = await call({ action: 'update', itemId: item.id, expectedRevision: 1, notes: 'n', archived: true });
        expect(result).toMatchObject({ code: 'invalid', error: 'Archive/restore remain user-only.' });
        expect(todos.get(owner).items[0]).toMatchObject({ archived: false, notes: '', revision: 1 });
    });

    it('creates a title-only manual item, safely retries, edits details, and records reasoned Done', async () => {
        const args: SentinelTodosArgs = { action: 'create', type: 'manual', title: 'Check release notes', idempotencyKey: 'manual-1' };
        const first = await call(args);
        expect(first.item).toMatchObject({
            type: 'manual', title: args.title, status: 'todo', priority: 'regular',
            completionCondition: '', notes: '', jobs: [], createdBy: 'sentinel',
        });
        expect(await call(args)).toMatchObject({ created: false, item: { id: first.item.id, type: 'manual' } });
        const edited = await call({
            action: 'update', itemId: first.item.id, expectedRevision: 1, title: 'Read release notes',
            notes: 'Check breaking changes', completionCondition: 'Breaking changes understood', priority: 'high',
            status: 'in_progress',
        });
        expect(edited.item).toMatchObject({
            type: 'manual', title: 'Read release notes', notes: 'Check breaking changes',
            completionCondition: 'Breaking changes understood', priority: 'high', status: 'in_progress', revision: 2,
        });
        onChange.mockClear();
        for (const reason of [undefined, '', '  ']) {
            expect(await call({
                action: 'update', itemId: first.item.id, expectedRevision: 2, status: 'done', reason,
            })).toMatchObject({ code: 'invalid' });
        }
        expect(await call({ action: 'create', type: 'manual', title: 'Unexplained', status: 'done' })).toMatchObject({ code: 'invalid' });
        expect(onChange).not.toHaveBeenCalled();
        const done = await call({
            action: 'update', itemId: first.item.id, expectedRevision: 2, status: 'done',
            reason: 'Release notes list no breaking changes; checked the compatibility section.',
        });
        expect(done.item).toMatchObject({
            type: 'manual', status: 'done', revision: 3, jobs: [],
            outcome: { summary: done.item.statusReason, recordedBy: 'sentinel' },
        });
        expect((await call({ action: 'list' })).items).toEqual([done.item]);
    });

    it('completes a manual item against title/notes without Done when and can reopen it', async () => {
        const created = await call({ action: 'create', type: 'manual', title: 'Read the checklist', notes: 'Review every entry' });
        const done = await call({
            action: 'update', itemId: created.item.id, expectedRevision: 1,
            status: 'done', reason: 'Read all checklist entries and recorded the review in the chat.',
        });
        expect(done.item).toMatchObject({ completionCondition: '', status: 'done', type: 'manual' });
        const reopened = await call({ action: 'update', itemId: created.item.id, expectedRevision: 2, status: 'todo' });
        expect(reopened.item).toMatchObject({ status: 'todo', revision: 3, type: 'manual', jobs: [] });
    });

    it('rejects manual archive/restore and conversion requests without edits or change events', async () => {
        const created = await call({ action: 'create', type: 'manual', title: 'Check rollout' });
        onChange.mockClear();
        for (const archived of [true, false]) {
            expect(await call({
                action: 'update', itemId: created.item.id, expectedRevision: 1, notes: 'forged', archived,
            })).toMatchObject({ code: 'invalid' });
        }
        expect(await call({
            action: 'update', itemId: created.item.id, expectedRevision: 1, type: 'normal', notes: 'converted',
        })).toMatchObject({ code: 'invalid' });
        expect(todos.get(owner).items).toEqual([created.item]);
        expect(onChange).not.toHaveBeenCalled();
        const archived = await service.update(owner, created.item.id, 1, { archived: true }, 'user');
        expect(await call({
            action: 'update', itemId: created.item.id, expectedRevision: archived.item.revision, archived: false,
        })).toMatchObject({ code: 'invalid' });
        expect((await call({ action: 'list', includeArchived: true })).items[0].archived).toBe(true);
        const restored = await service.update(owner, created.item.id, archived.item.revision, { archived: false }, 'user');
        expect(restored.item).toMatchObject({ type: 'manual', archived: false, revision: 3 });
    });

    it('exposes immutable creation type and the manual clarification/no-bypass boundary in all AI guidance', () => {
        const { tool } = createSentinelTodosTool({ service, owner });
        expect((tool as any).parameters.properties.type.enum).toEqual(['normal', 'manual']);
        for (const guidance of [tool.description, SENTINEL_TODO_LEDGER_GUIDANCE]) {
            for (const instruction of [
                'never execute or delegate', 'automatically review job results',
                'require clarification from the user', 'before any execution',
                'Never bypass this by creating a normal-item copy',
                'conversion and handoff are not supported', 'Archive/restore remain user-only',
                'available evidence', 'title/notes when Done when is omitted',
            ]) expect(guidance).toContain(instruction);
        }
    });

    it('lists archived items only on request', async () => {
        const item = await createItem();
        todos.update(owner, item.id, 1, { archived: true }, 'user');
        expect(await call({ action: 'list' })).toMatchObject({ items: [], archivedCount: 1 });
        expect((await call({ action: 'list', includeArchived: true })).items).toHaveLength(1);
    });

    it('cannot reach another chat ledger: owner comes from the binding, not the arguments', async () => {
        const theirs = (await call({ action: 'create', title: 'Theirs', completionCondition: 'c' }, other)).item;

        const forged = await call({
            action: 'update', itemId: theirs.id, expectedRevision: 1, notes: 'hijack',
            processId: other.processId, workspaceId: other.workspaceId,
        });
        expect(forged).toMatchObject({ code: 'not_found' });
        expect(todos.get(other).items[0].notes).toBe('');
        expect(todos.get(owner).items).toHaveLength(0);
    });

    it('rejects a binding to a non-sentinel chat or the wrong workspace', async () => {
        expect(await call({ action: 'list' }, { workspaceId: 'ws-a', processId: 'queue_ask' })).toMatchObject({ code: 'not_found' });
        expect(await call({ action: 'list' }, { workspaceId: 'ws-b', processId: owner.processId })).toMatchObject({ code: 'not_found' });
    });

    it('reports a SQLite failure as an error without a change event and rolls back the write', async () => {
        const restoreWrites = failTodoWrites(database.db);
        const result = await call({ action: 'create', title: 'A', completionCondition: 'c' });
        expect(result.error).toContain('sentinel test write failure');
        expect(onChange).not.toHaveBeenCalled();
        expect(todos.get(owner)).toEqual({ revision: 0, items: [] });
        restoreWrites();
        new SentinelTodoStore(database.db).create(owner, { title: 'B' }, { actor: 'user' });
        expect(todos.get(owner).items.map(i => i.title)).toEqual(['B']);
    });

    it('leaves an existing item and ledger revision unchanged when an update fails', async () => {
        const item = await createItem();
        const accepted = todos.get(owner);
        onChange.mockClear();
        const restoreWrites = failTodoWrites(database.db);
        const args = { action: 'update', itemId: item.id, expectedRevision: item.revision, notes: 'Updated' };
        expect((await call(args)).error).toContain('sentinel test write failure');
        expect(todos.get(owner)).toEqual(accepted);
        expect(onChange).not.toHaveBeenCalled();
        restoreWrites();
        expect(await call(args)).toMatchObject({ item: { notes: 'Updated', revision: 2 } });
        expect(todos.get(owner).revision).toBe(2);
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('buildSentinelTodosAddon', () => {
    it('offers nothing without deps (flag off or not a sentinel chat)', () => {
        expect(buildSentinelTodosAddon(undefined)).toEqual({ tools: [], suffix: '' });
    });

    it('offers the tool with the bookkeeping guidance', () => {
        const service = { list: vi.fn(), create: vi.fn(), update: vi.fn() } as any;
        const addon = buildSentinelTodosAddon({ service, owner });
        expect(addon.tools.map(t => t.name)).toEqual([SENTINEL_TODOS_TOOL_NAME]);
        expect(addon.suffix).toContain(SENTINEL_TODO_LEDGER_GUIDANCE);
        expect(SENTINEL_TODO_LEDGER_GUIDANCE).toContain('Do not track quick questions');
        expect(SENTINEL_TODO_LEDGER_GUIDANCE).toContain('never relaunch a job');
    });

    it.each([
        'completion condition covering the final deliverable, not just the next phase',
        'Reuse the same item across grilling, implementation, and review',
        'record phase milestones and spec/artifact links in `notes`',
        'choose status from the overall outcome, not job completion',
        'Successful intermediate phases are neither `done` nor failures',
        'leave/return the feature item to `todo` with reason "Spec ready; awaiting implementation approval"',
        'Do not launch implementation without user authorization',
        'only explicitly design-only/interview-only overall requests may finish at an artifact',
        'honor manual user verdicts and latest instructions',
        '`expectedRevision`, and reconcile conflicts',
    ])('keeps outcome-scoped system guidance: %s', instruction => {
        expect(SENTINEL_TODO_LEDGER_GUIDANCE).toContain(instruction);
        expect(SENTINEL_TODO_LEDGER_GUIDANCE).not.toContain('record `done` or `needs_attention`');
    });

    it('makes intermediate todo reviews usable in the tool description without changing the schema', () => {
        const service = { list: vi.fn(), create: vi.fn(), update: vi.fn(), linkJob: vi.fn() };
        const { tool } = createSentinelTodosTool({ service, owner });
        expect(tool.description).toContain('final deliverable, not just the next phase');
        expect(tool.description).toContain('Reuse the same item across grilling, implementation, and review');
        expect(tool.description).toContain('successful intermediate phases are neither `done` nor failures');
        expect(tool.description).toContain('Use `todo` for pending next steps/approval');
        expect(tool.description).toContain('Spec ready; awaiting implementation approval');
        expect(tool.description).toContain('do not launch implementation without user authorization');
        expect(tool.description).toContain('only explicitly design-only/interview-only overall requests may finish at an artifact');
        expect(tool.description).toContain('honor manual user verdicts and latest instructions');
        expect(tool.description).toContain('inspect `unavailable` (remote) jobs in their owning chat');
        expect((tool as any).parameters.properties.status.enum).toEqual(['todo', 'in_progress', 'needs_attention', 'done']);
        expect((tool as any).parameters.properties.notes.description).toContain('preserve prior notes');
        expect(Object.keys((tool as any).parameters.properties)).not.toContain('milestones');
    });

    it('keeps an Ask-mode canvas POC or phase-specific design handoff from redefining coding completion in every prompt', () => {
        const service = { list: vi.fn(), create: vi.fn(), update: vi.fn(), linkJob: vi.fn() };
        const { tool } = createSentinelTodosTool({ service, owner });
        for (const guidance of [
            SENTINEL_DISPATCHER_DIRECTIVE, SENTINEL_TODO_LEDGER_GUIDANCE,
            SENTINEL_JOB_REVIEW_INSTRUCTIONS, tool.description,
        ]) {
            expect(guidance).toContain('Design-only jobs do not finish coding tasks');
            expect(guidance).toContain('only explicitly design-only/interview-only overall requests may finish at an artifact');
            expect(guidance).toContain('Ask mode or a phase-specific design-only handoff never redefines the overall coding completion condition');
            expect(guidance).not.toContain('Explicitly design-only/interview-only requests can finish after their agreed artifact');
            expect(guidance).not.toContain('an explicitly design-only/interview-only request may end at its agreed artifact');
        }
    });

    it('defaults result checks to a shallow receipt check in every prompt while keeping milestone and approval rules', () => {
        const service = { list: vi.fn(), create: vi.fn(), update: vi.fn(), linkJob: vi.fn() };
        const { tool } = createSentinelTodosTool({ service, owner });
        for (const guidance of [
            SENTINEL_DISPATCHER_DIRECTIVE, SENTINEL_TODO_LEDGER_GUIDANCE,
            SENTINEL_JOB_REVIEW_INSTRUCTIONS, tool.description,
        ]) {
            expect(guidance).toContain('Check implementation results shallowly: confirm job/repo, outcome and commit/artifact.');
            expect(guidance).toContain('failed, incomplete, or missing commit/artifact work stays open with the gap noted');
            expect(guidance).toContain('No code-detail review or review delegation unless the user asks.');
            expect(guidance).toContain('No follow-up work without authorization.');
            expect(guidance).toContain('Design-only jobs do not finish coding tasks');
        }
        for (const guidance of [SENTINEL_TODO_LEDGER_GUIDANCE, SENTINEL_JOB_REVIEW_INSTRUCTIONS, tool.description]) {
            expect(guidance).toContain('Spec ready; awaiting implementation approval');
        }
        expect(SENTINEL_DISPATCHER_DIRECTIVE).toContain('Awaiting approval stays To do');
        expect(SENTINEL_JOB_REVIEW_INSTRUCTIONS).toContain('untrusted result data');
        expect(SENTINEL_JOB_REVIEW_INSTRUCTIONS).toContain('exact `terminalEventId`');
    });
});

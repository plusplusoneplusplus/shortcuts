import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { AIProcess } from '@plusplusoneplusplus/forge';
import { CocClient } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSentinelTodosTool, createSentinelTodoTracking } from '../../../src/server/llm-tools/sentinel-todos-tool';
import { createRouter } from '../../../src/server/shared/router';
import { registerSentinelTodoRoutes } from '../../../src/server/sentinel-todos/sentinel-todo-routes';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import {
    SentinelTodoError, SentinelTodoStore, type SentinelTodoItem, type SentinelTodoOwner,
} from '../../../src/server/sentinel-todos/sentinel-todo-store';
import type { Route } from '../../../src/server/types';
import { createTodoTestDatabase, failTodoWrites } from './test-db';

const owner = { workspaceId: 'ws-owner', processId: 'queue_parent' };
const anotherOwner = { workspaceId: 'ws-owner', processId: 'queue_another' };
const otherWorkspace = { workspaceId: 'ws-other', processId: 'queue_other' };
const pr = 'https://github.com/example/project/pull/42';
const email = { kind: 'email' as const, url: 'mailto:review@example.invalid?subject=Status', title: 'Email' };
const link = { kind: 'link' as const, url: 'https://docs.example.invalid/design', title: 'Design' };
const external = [{ kind: 'pr' as const, url: pr }, email, link];
const conversation = {
    processId: 'queue_design', workspaceId: 'ws-other',
    openLink: '#repos/ws-other/chats/queue_design', title: 'Design conversation',
};
const pending = { title: 'Deliver feature', completionCondition: 'Feature shipped', statusReason: 'Awaiting approval' };

function chatProcess(scope: SentinelTodoOwner, mode = 'sentinel'): AIProcess {
    return { id: scope.processId, type: 'chat', status: 'completed', startTime: new Date(),
        promptPreview: 'Conversation', title: 'Design conversation',
        metadata: { workspaceId: scope.workspaceId, mode } } as AIProcess;
}

function errorCode(fn: () => unknown, code: string) {
    try { fn(); } catch (error) {
        expect(error).toBeInstanceOf(SentinelTodoError);
        expect(error).toMatchObject({ code });
        return;
    }
    throw new Error('Expected SentinelTodoError');
}

const invalidReferences: [string, unknown][] = [
    ['null', null],
    ['object instead of array', link],
    ['missing kind', [{ url: link.url }]],
    ['unknown kind', [{ kind: 'script', url: link.url }]],
    ['conversation through external input', [{ kind: 'conversation', ...conversation }]],
    ['missing URL', [{ kind: 'link' }]],
    ['non-string URL', [{ kind: 'link', url: 42 }]],
    ['empty URL', [{ kind: 'link', url: '  ' }]],
    ['malformed URL', [{ kind: 'link', url: 'not a URL' }]],
    ['relative URL', [{ kind: 'link', url: '/design' }]],
    ['executable link', [{ kind: 'link', url: 'javascript:alert(1)' }]],
    ['executable email', [{ kind: 'email', url: 'javascript:alert(1)' }]],
    ['data URL', [{ kind: 'link', url: 'data:text/html,hello' }]],
    ['file URL', [{ kind: 'link', url: 'file:///design.html' }]],
    ['mailto as generic link', [{ kind: 'link', url: email.url }]],
    ['credential-bearing link', [{ kind: 'link', url: 'https://user:password@example.invalid/design' }]],
    ['credential-bearing email', [{ kind: 'email', url: 'https://user@mail.example.invalid/message' }]],
    ['unsupported PR', [{ kind: 'pr', url: 'https://example.invalid/project/pull/42' }]],
    ['non-PR GitHub URL', [{ kind: 'pr', url: 'https://github.com/example/project/issues/42' }]],
    ['HTTP PR', [{ kind: 'pr', url: pr.replace('https:', 'http:') }]],
    ['credential-bearing PR', [{ kind: 'pr', url: pr.replace('https://', 'https://user:password@') }]],
    ['oversized title', [{ ...link, title: 'x'.repeat(201) }]],
    ['oversized URL', [{ ...link, url: `https://example.invalid/${'x'.repeat(2000)}` }]],
    ['unknown reference fields', [{ ...link, reviewed: true }]],
    ['more than twenty', Array.from({ length: 21 }, (_, i) => ({ kind: 'link', url: `https://example.invalid/${i}` }))],
];

describe('Sentinel typed external references', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let enabled: boolean;
    let onChange: ReturnType<typeof vi.fn>;
    let jobs: ReturnType<typeof vi.fn>;
    let fetchPr: ReturnType<typeof vi.fn>;
    const processes = new Map<string, AIProcess>();
    const current = (id: string) => todos.get(owner).items.find(item => item.id === id)!;
    const attach = (item: SentinelTodoItem) => todos.attachReference(owner, item.id, item.revision, conversation, 'user').item;
    const tool = (reviewOnly = false, bound = owner) => createSentinelTodosTool({ service, owner: bound, reviewOnly }).tool;
    const call = (args: Record<string, unknown>, reviewOnly = false, bound = owner) =>
        (tool(reviewOnly, bound) as any).handler(args, {}) as Promise<any>;

    beforeEach(() => {
        database = createTodoTestDatabase(fs.mkdtempSync(path.join(process.cwd(), '.sentinel-external-refs-test-')));
        todos = new SentinelTodoStore(database.db);
        enabled = true;
        onChange = vi.fn();
        jobs = vi.fn(() => []);
        fetchPr = vi.fn();
        processes.clear();
        for (const scope of [owner, anotherOwner, otherWorkspace]) processes.set(scope.processId, chatProcess(scope));
        processes.set(conversation.processId, chatProcess(conversation, 'ask'));
        service = new SentinelTodoService({
            todos, store: { getProcess: async id => processes.get(id) }, onChange,
            jobs: { list: jobs }, fetchPr, getExternalReferencesEnabled: () => enabled,
        });
    });
    afterEach(() => database.dispose());

    describe('store validation and persistence', () => {
        it.each(['user', 'sentinel'] as const)('creates multiple typed references as %s, canonicalizing and deduplicating per kind', actor => {
            const firstPr = 'https://github.com/Example/Project/pull/42';
            const ado = 'https://dev.azure.com/example/team/_git/project/pullrequest/17';
            const references = [
                { kind: 'pr' as const, url: ' https://www.github.com/Example/Project/pull/00042/files?diff=1#overview ', title: ' PR ' },
                { kind: 'pr' as const, url: `${pr}?duplicate=1`, title: 'Duplicate' },
                { kind: 'pr' as const, url: `${pr.replace('/42', '/43')}/commits` },
                { kind: 'pr' as const, url: `${ado}?_a=files` },
                email,
                { ...email, title: 'Duplicate email' },
                { kind: 'email' as const, url: 'https://mail.example.invalid/messages/123' },
                { ...link, url: ` ${link.url} `, title: ' Design ' },
                { ...link, title: 'Duplicate design' },
                { kind: 'link' as const, url: firstPr },
            ];
            const item = todos.create(owner, { ...pending, externalReferences: references }, { actor }).item;
            expect(item.references).toEqual([
                { kind: 'pr', url: firstPr, title: 'PR' },
                { kind: 'pr', url: pr.replace('/42', '/43') },
                { kind: 'pr', url: ado },
                email,
                { kind: 'email', url: 'https://mail.example.invalid/messages/123' },
                link,
                { kind: 'link', url: firstPr },
            ]);
            expect(item).toMatchObject({ status: 'todo', statusReason: pending.statusReason, jobs: [], evidence: [], dependsOn: [] });
            expect(item.outcome).toBeUndefined();
            expect(fetchPr).not.toHaveBeenCalled();
        });

        it.each(['http:', 'https:'])('accepts credential-free %s generic links and email message links', protocol => {
            const references = [
                { kind: 'link' as const, url: `${protocol}//docs.example.invalid/design` },
                { kind: 'email' as const, url: `${protocol}//mail.example.invalid/message/123` },
            ];
            const item = todos.create(owner, { ...pending, externalReferences: references }, { actor: 'user' }).item;
            expect(item.references).toEqual(references);
        });

        it('replaces, omits and clears only external references, retaining conversation attachment and bookkeeping', () => {
            const created = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item;
            const attached = attach(created);
            const attachedConversation = attached.references.find(ref => !ref.kind || ref.kind === 'conversation');
            const updated = todos.update(owner, created.id, attached.revision, { externalReferences: [link] }, 'sentinel').item;
            expect(updated.references).toEqual([attachedConversation, link]);
            const omitted = todos.update(owner, created.id, updated.revision, { priority: 'high' }, 'user').item;
            expect(omitted.references).toEqual(updated.references);
            const cleared = todos.update(owner, created.id, omitted.revision, { externalReferences: [] }, 'user').item;
            expect(cleared.references).toEqual([attachedConversation]);
            expect(cleared).toMatchObject({ status: 'todo', statusReason: pending.statusReason, jobs: [], evidence: [], dependsOn: [] });
            expect(cleared.userEditedAt).toBe(created.userEditedAt);
            expect(cleared.userVerdictRevision).toBe(created.userVerdictRevision);
            expect(cleared.outcome).toBeUndefined();
        });

        it.each(invalidReferences)('rejects %s atomically on create and update', (_label, references) => {
            const item = attach(todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item);
            const before = todos.get(owner);
            errorCode(() => todos.create(owner, { ...pending, externalReferences: references } as never, { actor: 'user' }), 'invalid');
            errorCode(() => todos.update(owner, item.id, item.revision,
                { title: 'Must not be committed', externalReferences: references } as never, 'sentinel'), 'invalid');
            expect(todos.get(owner)).toEqual(before);
        });

        it('accepts exact limits and keeps external and conversation limits independent', () => {
            const url = `https://example.invalid/${'x'.repeat(2000 - 'https://example.invalid/'.length)}`;
            const refs = Array.from({ length: 20 }, (_, i) => ({ kind: 'link' as const, url: i ? `${link.url}/${i}` : url, title: 'x'.repeat(200) }));
            let item = todos.create(owner, { ...pending, externalReferences: refs }, { actor: 'user' }).item;
            expect(item.references).toHaveLength(20);
            for (let i = 0; i < 20; i++) {
                item = todos.attachReference(owner, item.id, item.revision, { ...conversation, processId: `queue_ref_${i}` }, 'user').item;
            }
            expect(item.references).toHaveLength(40);
            expect(todos.update(owner, item.id, item.revision, { externalReferences: [] }, 'sentinel').item.references).toHaveLength(20);
        });

        it('enforces CAS and exact owner/workspace isolation without leaking or modifying references', () => {
            const created = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'sentinel' }).item;
            const updated = todos.update(owner, created.id, created.revision, { externalReferences: [link] }, 'user').item;
            errorCode(() => todos.update(owner, created.id, created.revision, { externalReferences: [] }, 'sentinel'), 'conflict');
            for (const scope of [anotherOwner, otherWorkspace, { ...owner, workspaceId: otherWorkspace.workspaceId }]) {
                expect(todos.get(scope).items).toEqual([]);
                errorCode(() => todos.update(scope, created.id, updated.revision, { externalReferences: [] }, 'user'), 'not_found');
            }
            expect(current(created.id)).toEqual(updated);
        });

        it('rolls back external JSON and ledger revisions when the item write fails', () => {
            const item = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item;
            const before = todos.get(owner);
            const restore = failTodoWrites(database.db);
            try {
                expect(() => todos.update(owner, item.id, item.revision, { externalReferences: [] }, 'user')).toThrow('sentinel test write failure');
                expect(() => todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' })).toThrow('sentinel test write failure');
                expect(todos.get(owner)).toEqual(before);
            } finally { restore(); }
        });

        it('stores external JSON separately and persists the union after every database handle closes', () => {
            const item = attach(todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item);
            expect(database.db.prepare('SELECT external_references FROM sentinel_todo_items WHERE id = ?')
                .get<{ external_references: string }>(item.id)).toEqual({ external_references: JSON.stringify(external) });
            expect(database.db.prepare('SELECT COUNT(*) AS count FROM sentinel_todo_references').get()).toEqual({ count: 1 });
            const before = todos.get(owner);
            database.close();
            const reopened = createTodoTestDatabase(database.dataDir);
            try { expect(new SentinelTodoStore(reopened.db).get(owner)).toEqual(before); }
            finally { reopened.close(); }
        });

        it('adds the JSON column to old rows without changing conversation storage or shared schema version', () => {
            const item = attach(todos.create(owner, pending, { actor: 'user' }).item);
            const table = database.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sentinel_todo_references'").get();
            const version = database.db.pragma('user_version', { simple: true });
            database.db.exec('ALTER TABLE sentinel_todo_items DROP COLUMN external_references');
            const migrated = new SentinelTodoStore(database.db);
            expect(migrated.get(owner).items[0]).toEqual(item);
            expect(database.db.prepare('SELECT external_references FROM sentinel_todo_items WHERE id = ?').get(item.id))
                .toEqual({ external_references: '[]' });
            expect(database.db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sentinel_todo_references'").get()).toEqual(table);
            expect(database.db.pragma('user_version', { simple: true })).toBe(version);
            expect(migrated.update(owner, item.id, item.revision, { externalReferences: external }, 'sentinel').item.references)
                .toEqual([...item.references, ...external]);
        });
    });

    describe('service gate and metadata invariants', () => {
        it('defaults off, rejects explicit writes, and hides externals even in conflicts', async () => {
            const disabled = new SentinelTodoService({ todos, store: { getProcess: async id => processes.get(id) } });
            expect(disabled.externalReferencesEnabled()).toBe(false);
            const item = attach(todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item);
            await expect(disabled.create(owner, { ...pending, externalReferences: [] }, { actor: 'user' }))
                .rejects.toMatchObject({ code: 'not_found' });
            await expect(disabled.update(owner, item.id, item.revision, { externalReferences: [] }, 'user'))
                .rejects.toMatchObject({ code: 'not_found' });
            const visible = (await disabled.list(owner)).items[0];
            expect(visible.references).toEqual(item.references.filter(ref => !ref.kind || ref.kind === 'conversation'));
            await expect(disabled.update(owner, item.id, 1, { priority: 'high' }, 'user'))
                .rejects.toMatchObject({ code: 'conflict', current: { references: visible.references } });
            expect(current(item.id)).toEqual(item);
        });

        it('supports live disable/re-enable, preserving hidden refs through ordinary writes and conversation attachment', async () => {
            expect(service.externalReferencesEnabled()).toBe(true);
            const created = await service.create(owner, { ...pending, externalReferences: external }, { actor: 'sentinel' });
            expect(created.item.references).toEqual(external);
            enabled = false;
            expect(service.externalReferencesEnabled()).toBe(false);
            const updated = await service.update(owner, created.item.id, 1, { notes: 'Keep context' }, 'user');
            expect(updated.item.references).toEqual([]);
            const attached = await service.attachReference(owner, created.item.id, updated.item.revision, conversation, 'user');
            expect(attached.item.references).toHaveLength(1);
            expect(current(created.item.id).references).toHaveLength(4);
            await expect(service.update(owner, created.item.id, attached.item.revision, { externalReferences: [link] }, 'sentinel'))
                .rejects.toMatchObject({ code: 'not_found' });
            enabled = true;
            expect((await service.list(owner)).items[0].references).toEqual(current(created.item.id).references);
            await expect(service.update(owner, created.item.id, 1, { externalReferences: [] }, 'sentinel'))
                .rejects.toMatchObject({ code: 'conflict', current: { references: current(created.item.id).references } });
        });

        it('rejects a mismatched workspace, non-Sentinel owner and another valid owner atomically', async () => {
            const item = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item;
            processes.set('queue_regular', chatProcess({ workspaceId: owner.workspaceId, processId: 'queue_regular' }, 'ask'));
            for (const scope of [anotherOwner, otherWorkspace, { ...owner, workspaceId: 'ws-other' },
                { workspaceId: owner.workspaceId, processId: 'queue_regular' }]) {
                await expect(service.update(scope, item.id, 1, { externalReferences: [] }, 'user')).rejects.toMatchObject({ code: 'not_found' });
            }
            expect(current(item.id)).toEqual(item);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('does not acknowledge a pending result or supersede it with a metadata-only user edit', async () => {
            const item = todos.create(owner, pending, { actor: 'user' }).item;
            todos.linkJob(owner, item.id, { processId: 'queue_child', workspaceId: owner.workspaceId, kind: 'local', openLink: '#child' });
            const result = todos.recordJobResult(owner, 'queue_child', { terminalEventId: 'event', outcome: 'completed' }, () => 'Completed')!.item;
            const updated = (await service.update(owner, item.id, result.revision, { externalReferences: external }, 'user')).item;
            expect(updated.jobs).toEqual(result.jobs);
            expect(updated.jobs[0].result?.reviewed).toBeUndefined();
            expect(updated.userEditedAt).toBe(result.userEditedAt);
            expect(updated.userVerdictRevision).toBe(result.userVerdictRevision);
            expect(updated.status).toBe(result.status);
            expect((await service.list(owner)).items[0].jobs[0].execution).toMatchObject({ review: { assessment: 'pending' } });
        });

        it('never uses displayed PRs as dependency outputs or tracked-job provenance', async () => {
            const evidenceService = new SentinelTodoService({
                todos, store: { getProcess: async id => processes.get(id) },
                getDependenciesEnabled: () => true, getExternalReferencesEnabled: () => true, fetchPr,
            });
            const source = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item;
            const dependent = todos.create(owner, { title: 'Follow-up' }, { actor: 'user' }).item;
            todos.setDependencies(owner, dependent.id, dependent.revision,
                [{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'code' } }], 'user');
            expect(await evidenceService.evaluateDependencies(owner, dependent.id)).toMatchObject({ state: 'waiting' });
            expect(fetchPr).not.toHaveBeenCalled();
            await expect(evidenceService.bindPrOutput(owner, source.id, {
                expectedRevision: source.revision, outputSlot: 'code', prUrl: pr,
                provenance: { kind: 'tracked_job', processId: 'queue_untracked', workspaceId: owner.workspaceId, reason: 'Display link' },
            }, 'sentinel')).rejects.toMatchObject({ code: 'invalid' });
            expect(current(source.id).evidence).toEqual([]);
            const selected = pr.replace('/42', '/99');
            const bound = await evidenceService.bindPrOutput(owner, source.id, {
                expectedRevision: source.revision, outputSlot: 'code', prUrl: selected,
                provenance: { kind: 'owner_selection', reason: 'Explicitly selected exact output' },
            }, 'user');
            expect(bound.item.evidence).toEqual([expect.objectContaining({ kind: 'pr_binding', pr: expect.objectContaining({ url: selected }) })]);
            expect(bound.item.references).toEqual(external);
            expect(bound.item.status).toBe('todo');
            expect(fetchPr).not.toHaveBeenCalled();
        });

        it('preserves an explicit user verdict and still rejects stale AI review after metadata edits', async () => {
            const item = todos.create(owner, pending, { actor: 'user' }).item;
            todos.linkJob(owner, item.id, { processId: 'queue_child', workspaceId: owner.workspaceId, kind: 'local', openLink: '#child' });
            const result = todos.recordJobResult(owner, 'queue_child', { terminalEventId: 'event', outcome: 'completed' }, () => 'Completed')!.item;
            const verdict = todos.update(owner, item.id, result.revision, { status: 'done', statusReason: 'Accepted', outcome: 'Verified by user' }, 'user').item;
            const updated = (await service.update(owner, item.id, verdict.revision, { externalReferences: external }, 'sentinel')).item;
            expect(updated).toMatchObject({ status: 'done', statusReason: verdict.statusReason, outcome: verdict.outcome,
                userVerdictRevision: verdict.userVerdictRevision, userEditedAt: verdict.userEditedAt, jobs: verdict.jobs });
            await expect(service.update(owner, item.id, updated.revision, {
                status: 'needs_attention', statusReason: 'Stale claim', reviewedJobs: [{ processId: 'queue_child', terminalEventId: 'event' }],
            }, 'sentinel')).rejects.toMatchObject({ code: 'invalid' });
            expect(current(item.id)).toEqual(updated);
        });

        it('keeps manual items tracking-only with no jobs, review receipts, evidence or dependencies', async () => {
            const item = (await service.create(owner, { type: 'manual', title: 'Read email', externalReferences: external }, { actor: 'sentinel' })).item;
            const updated = (await service.update(owner, item.id, 1, { externalReferences: [email] }, 'sentinel')).item;
            expect(updated).toMatchObject({ type: 'manual', status: 'todo', jobs: [], evidence: [], dependsOn: [] });
            expect(updated.outcome).toBeUndefined();
            expect(await createSentinelTodoTracking({ service, owner }).check(item.id)).toContain('tracking only');
            await expect(service.linkJob(owner, item.id, { processId: 'queue_child', workspaceId: owner.workspaceId, kind: 'local', openLink: '#child' }))
                .rejects.toMatchObject({ code: 'invalid' });
            await expect(service.update(owner, item.id, updated.revision, {
                status: 'done', statusReason: 'Claim', reviewedJobs: [{ processId: 'queue_child', terminalEventId: 'event' }],
            }, 'sentinel')).rejects.toMatchObject({ code: 'invalid' });
            expect(jobs).not.toHaveBeenCalled();
            expect(fetchPr).not.toHaveBeenCalled();
            expect(current(item.id)).toEqual(updated);
        });

        it('retains a manual item user verdict when the AI replaces or clears reference metadata', async () => {
            const item = (await service.create(owner, { type: 'manual', title: 'Read email', externalReferences: external }, { actor: 'user' })).item;
            const verdict = (await service.update(owner, item.id, 1, {
                status: 'done', statusReason: 'User checked', outcome: 'Confirmed by user',
            }, 'user')).item;
            const replaced = (await service.update(owner, item.id, verdict.revision, { externalReferences: [email] }, 'sentinel')).item;
            const cleared = (await service.update(owner, item.id, replaced.revision, { externalReferences: [] }, 'sentinel')).item;
            expect(cleared).toMatchObject({ status: 'done', outcome: verdict.outcome, statusReason: verdict.statusReason,
                userVerdictRevision: verdict.userVerdictRevision, userEditedAt: verdict.userEditedAt,
                jobs: [], evidence: [], dependsOn: [], references: [] });
        });
    });

    describe('AI tool', () => {
        it('offers the bounded typed schema only when enabled, and never in review-only mode', () => {
            const properties = (tool().parameters as any).properties;
            expect(properties.externalReferences).toMatchObject({
                type: 'array', maxItems: 20, items: { type: 'object', required: expect.arrayContaining(['kind', 'url']) },
            });
            expect(properties.externalReferences.items.properties.kind.enum).toEqual(['pr', 'email', 'link']);
            expect(properties.externalReferences.items.properties.url.maxLength).toBe(2000);
            expect(properties.externalReferences.items.properties.title.maxLength).toBe(200);
            expect((tool(true).parameters as any).properties.externalReferences).toBeUndefined();
            enabled = false;
            expect((tool().parameters as any).properties.externalReferences).toBeUndefined();
        });

        it('round-trips AI create, list, replacement, omission and clear without deriving Done or evidence', async () => {
            const created = await call({ action: 'create', ...pending, externalReferences: external });
            expect(created).toMatchObject({ created: true, item: { references: external, createdBy: 'sentinel', status: 'todo', jobs: [], evidence: [], dependsOn: [] } });
            const id = created.item.id;
            const attached = await call({ action: 'attach_reference', itemId: id, expectedRevision: 1,
                conversationId: conversation.processId, conversationWorkspaceId: conversation.workspaceId });
            expect(attached.item.references).toHaveLength(4);
            const replaced = await call({ action: 'update', itemId: id, expectedRevision: 2, externalReferences: [link] });
            expect(replaced.item.references).toEqual([expect.objectContaining({ processId: conversation.processId, attachedBy: 'sentinel' }), link]);
            const omitted = await call({ action: 'update', itemId: id, expectedRevision: 3, priority: 'high' });
            expect(omitted.item.references).toEqual(replaced.item.references);
            expect((await call({ action: 'list' })).items[0].references).toEqual(replaced.item.references);
            const cleared = await call({ action: 'update', itemId: id, expectedRevision: 4, externalReferences: [] });
            expect(cleared.item.references).toEqual([replaced.item.references[0]]);
            expect(cleared.item).toMatchObject({ status: 'todo', jobs: [], evidence: [], dependsOn: [] });
            expect(cleared.item.outcome).toBeUndefined();
            expect(jobs).not.toHaveBeenCalled();
            expect(fetchPr).not.toHaveBeenCalled();
        });

        it.each([null, [{ kind: 'link', url: 'javascript:alert(1)' }], [{ kind: 'pr', url: link.url }]])
        ('rejects invalid AI input %j without partial metadata changes', async externalReferences => {
            const item = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item;
            const before = todos.get(owner);
            expect(await call({ action: 'create', ...pending, externalReferences })).toMatchObject({ code: 'invalid' });
            expect(await call({ action: 'update', itemId: item.id, expectedRevision: 1, title: 'Do not save', externalReferences }))
                .toMatchObject({ code: 'invalid' });
            expect(todos.get(owner)).toEqual(before);
            expect(onChange).not.toHaveBeenCalled();
        });

        it('rejects review-only metadata edits and returns visible current references on CAS conflicts', async () => {
            const item = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item;
            const updated = todos.update(owner, item.id, 1, { priority: 'high' }, 'user').item;
            expect(await call({ action: 'update', itemId: item.id, expectedRevision: 2, externalReferences: [] }, true))
                .toMatchObject({ code: 'invalid' });
            expect(await call({ action: 'update', itemId: item.id, expectedRevision: 1, externalReferences: [] }))
                .toMatchObject({ code: 'conflict', current: { references: external } });
            enabled = false;
            expect(await call({ action: 'update', itemId: item.id, expectedRevision: 1, priority: 'regular' }))
                .toMatchObject({ code: 'conflict', current: { references: [] } });
            expect(current(item.id)).toEqual(updated);
        });

        it('checks the live gate for an already-created tool and binds writes to its exact owner', async () => {
            const handler = (tool() as any).handler;
            const item = todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item;
            enabled = false;
            expect(await handler({ action: 'update', itemId: item.id, expectedRevision: 1, externalReferences: [] }, {}))
                .toHaveProperty('error');
            expect(current(item.id)).toEqual(item);
            enabled = true;
            expect(await call({ action: 'update', itemId: item.id, expectedRevision: 1, externalReferences: [] }, false, anotherOwner))
                .toMatchObject({ code: 'not_found' });
            expect(current(item.id)).toEqual(item);
        });
    });

    describe('REST and real client', () => {
        let server: http.Server;
        let client: CocClient;
        let baseUrl: string;
        beforeEach(async () => {
            const routes: Route[] = [];
            registerSentinelTodoRoutes({ routes, service });
            server = http.createServer(createRouter({ routes, spaHtml: '' }));
            await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
            baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
            client = new CocClient({ baseUrl });
        });
        afterEach(async () => {
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        });
        const request = async (method: string, suffix: string, body?: unknown, scope = owner) => {
            const response = await fetch(`${baseUrl}/api/workspaces/${scope.workspaceId}/sentinel-todos/${scope.processId}${suffix}`, {
                method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
            });
            return { status: response.status, body: await response.json() };
        };

        it('round-trips typed create/list/update/clear and existing conversation refs through HTTP and CocClient', async () => {
            const created = await client.sentinelTodos.create(owner.workspaceId, owner.processId, {
                ...pending, externalReferences: [{ kind: 'pr', url: `${pr}/files?view=1` }, email, link],
            });
            expect(created.item.references).toEqual(external);
            expect(created.item.createdBy).toBe('user');
            const attached = await client.sentinelTodos.attachReference(owner.workspaceId, owner.processId, created.item.id,
                { expectedRevision: 1, processId: conversation.processId, workspaceId: conversation.workspaceId });
            const updated = await client.sentinelTodos.update(owner.workspaceId, owner.processId, created.item.id,
                { expectedRevision: 2, externalReferences: [email, link] });
            expect(updated.item.references).toEqual([attached.item.references[0], email, link]);
            expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId)).items[0].references).toEqual(updated.item.references);
            const cleared = await client.sentinelTodos.update(owner.workspaceId, owner.processId, created.item.id,
                { expectedRevision: 3, externalReferences: [] });
            expect(cleared.item.references).toEqual([attached.item.references[0]]);
            expect(cleared.item).toMatchObject({ status: 'todo', jobs: [], evidence: [], dependsOn: [] });
        });

        it('maps invalid input, CAS and wrong-owner errors without partial writes', async () => {
            const item = (await client.sentinelTodos.create(owner.workspaceId, owner.processId, { ...pending, externalReferences: external })).item;
            const updated = await client.sentinelTodos.update(owner.workspaceId, owner.processId, item.id,
                { expectedRevision: 1, externalReferences: [link] });
            await expect(client.sentinelTodos.update(owner.workspaceId, owner.processId, item.id,
                { expectedRevision: 1, externalReferences: [] }))
                .rejects.toMatchObject({ status: 409, code: 'conflict', body: { current: { references: [link] } } });
            for (const externalReferences of [null, [{ kind: 'link', url: 'javascript:alert(1)' }], [{ kind: 'pr', url: link.url }]]) {
                expect(await request('POST', '/items', { ...pending, externalReferences })).toMatchObject({ status: 400 });
                expect(await request('PATCH', `/items/${item.id}`, { expectedRevision: 2, title: 'Do not save', externalReferences }))
                    .toMatchObject({ status: 400 });
            }
            for (const scope of [anotherOwner, otherWorkspace, { ...owner, workspaceId: 'ws-other' }]) {
                expect(await request('PATCH', `/items/${item.id}`, { expectedRevision: 2, externalReferences: [] }, scope))
                    .toMatchObject({ status: 404 });
            }
            expect(current(item.id)).toEqual(updated.item);
        });

        it('returns 404 for gated writes and hides externals in REST reads and conflicts while preserving storage', async () => {
            const item = attach(todos.create(owner, { ...pending, externalReferences: external }, { actor: 'user' }).item);
            enabled = false;
            expect(await request('POST', '/items', { ...pending, externalReferences: [] })).toMatchObject({ status: 404 });
            expect(await request('PATCH', `/items/${item.id}`, { expectedRevision: item.revision, externalReferences: [] }))
                .toMatchObject({ status: 404 });
            const conversationOnly = item.references.filter(ref => !ref.kind || ref.kind === 'conversation');
            expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId)).items[0].references).toEqual(conversationOnly);
            expect(await request('PATCH', `/items/${item.id}`, { expectedRevision: 1, priority: 'high' }))
                .toMatchObject({ status: 409, body: { current: { references: conversationOnly } } });
            const updated = await client.sentinelTodos.update(owner.workspaceId, owner.processId, item.id,
                { expectedRevision: item.revision, priority: 'high' });
            expect(updated.item.references).toEqual(conversationOnly);
            enabled = true;
            expect((await client.sentinelTodos.get(owner.workspaceId, owner.processId)).items[0].references).toEqual(item.references);
        });
    });
});

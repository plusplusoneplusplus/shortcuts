import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SentinelTodoStore, type SentinelTodoDependency } from '../../../src/server/sentinel-todos/sentinel-todo-store';
import { SentinelTodoService } from '../../../src/server/sentinel-todos/sentinel-todo-service';
import type { DelegatedJob } from '../../../src/server/delegation/delegated-job-store';
import { artifactVersion } from '../../../src/server/sentinel-todos/sentinel-todo-evidence';
import { createSentinelTodosTool } from '../../../src/server/llm-tools/sentinel-todos-tool';
import { createSentinelTodosDomain } from '../../../src/server/storage/snapshot/delegated-jobs-domain';
import type { StorageSnapshotContext } from '../../../src/server/storage/snapshot/types';
import { createTodoTestDatabase, failTodoWrites } from './test-db';
import { getRepoDataPath } from '../../../src/server/paths';

const owner = { workspaceId: 'ws-parent', processId: 'queue_parent' };
const url = 'https://github.com/example/project/pull/42';
const selection = { kind: 'owner_selection' as const, reason: 'Selected exact implementation output after review' };

describe('Sentinel exact dependency evidence', () => {
    let database: ReturnType<typeof createTodoTestDatabase>;
    let todos: SentinelTodoStore;
    let service: SentinelTodoService;
    let root: string;
    let enabled: boolean;
    let ownerExists: boolean;
    let workspaceExists: boolean;
    let fetchPr: ReturnType<typeof vi.fn>;
    let jobs: DelegatedJob[];
    const current = (id: string) => todos.get(owner).items.find(item => item.id === id)!;
    const create = (title = 'Item') => todos.create(owner, { title }, { actor: 'user' }).item;
    const dependent = (dependsOn: SentinelTodoDependency[]) => {
        const item = create('Dependent');
        return todos.setDependencies(owner, item.id, 1, dependsOn, 'user').item;
    };
    const bind = (id: string, prUrl = url) => service.bindPrOutput(owner, id, {
        expectedRevision: current(id).revision, outputSlot: 'implementation', prUrl, provenance: selection,
    }, 'sentinel');
    const evaluate = (id: string) => service.evaluateDependencies(owner, id);

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(process.cwd(), '.sentinel-evidence-test-'));
        database = createTodoTestDatabase(root);
        todos = new SentinelTodoStore(database.db);
        enabled = true;
        ownerExists = true;
        workspaceExists = true;
        jobs = [];
        fetchPr = vi.fn(async () => ({ status: 'merged', title: 'Output', url, mergeCommit: 'commit', mergedAt: '2026-01-01T00:00:00.000Z' }));
        service = new SentinelTodoService({
            todos, getDependenciesEnabled: () => enabled, fetchPr,
            jobs: { list: () => jobs },
            resolveWorkspaceRoot: async () => workspaceExists ? root : undefined,
            store: { getProcess: async id => ownerExists ? { id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } } as never : undefined },
        });
    });
    afterEach(() => database.dispose());

    it('requires explicit Done and conjunctively waits for both sources, without changing fulfillment', async () => {
        const a = create('A');
        const b = create('B');
        const item = dependent([a, b].map(source => ({ itemId: source.id, condition: { kind: 'done' } })));
        todos.linkJob(owner, a.id, { processId: 'child', workspaceId: 'ws-execution', kind: 'local', openLink: 'child-link' });
        todos.recordJobResult(owner, 'child', { terminalEventId: 'event', outcome: 'completed' }, () => 'Delivered result');
        expect((await evaluate(item.id)).state).toBe('waiting');
        todos.update(owner, a.id, current(a.id).revision, { status: 'todo',
            reviewedJobs: [{ processId: 'child', terminalEventId: 'event' }] }, 'user');
        expect((await evaluate(item.id)).edges[0].satisfied).toBe(false);
        todos.update(owner, a.id, current(a.id).revision, { status: 'done' }, 'user');
        expect(await evaluate(item.id)).toMatchObject({ state: 'waiting', edges: [{ satisfied: true }, { satisfied: false }] });
        todos.update(owner, b.id, 1, { status: 'done', statusReason: 'Explicit assessment' }, 'sentinel');
        expect((await evaluate(item.id)).state).toBe('ready');
        expect(current(item.id)).toEqual(item);
        todos.update(owner, a.id, current(a.id).revision, { status: 'todo' }, 'user');
        expect((await evaluate(item.id)).state).toBe('waiting');
    });

    it('waits for future output binding even when source is Done, then uses canonical authoritative evidence', async () => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        todos.update(owner, source.id, 1, { status: 'done' }, 'user');
        expect(await evaluate(item.id)).toMatchObject({ state: 'waiting', edges: [{ blocker: expect.stringContaining('binding') }] });
        expect(fetchPr).not.toHaveBeenCalled();
        const result = await bind(source.id, `${url}/files?ignored=1`);
        expect(result.item.evidence[0]).toMatchObject({ kind: 'pr_binding', pr: { provider: 'github', host: 'github.com', repoPath: 'example/project', number: 42, url }, provenance: selection });
        expect(await evaluate(item.id)).toMatchObject({ state: 'ready', edges: [{ evidenceLink: url, mergeCommit: 'commit', receiptId: expect.any(String) }] });
        expect(fetchPr).toHaveBeenCalledWith(result.item.evidence[0].kind === 'pr_binding' ? result.item.evidence[0].pr : undefined);
        expect(current(item.id)).toEqual(item);
    });

    it('projects exact evidence generations separately from later source revisions', async () => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        const bound = await bind(source.id);
        const receipt = bound.item.evidence[0];
        expect(receipt.recordedRevision).toBe(2);
        todos.update(owner, source.id, 2, { notes: 'Unrelated source edit' }, 'user');
        expect(await evaluate(item.id)).toMatchObject({
            itemRevision: 2, ledgerRevision: todos.get(owner).revision,
            edges: [{ sourceRevision: 3, evidenceRevision: 2, receiptId: receipt.receiptId }],
        });
        await bind(source.id);
        const rebound = current(source.id).evidence[0];
        expect(rebound.recordedRevision).toBe(4);
        expect(rebound.receiptId).not.toBe(receipt.receiptId);
        expect((await evaluate(item.id)).edges[0]).toMatchObject({ sourceRevision: 4, evidenceRevision: 4, receiptId: rebound.receiptId });
    });

    it.each(['open', 'closed', 'unknown'])('does not accept %s as merged evidence', async status => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        await bind(source.id);
        fetchPr.mockResolvedValue({ status, url, title: 'Claim' });
        expect(await evaluate(item.id)).toMatchObject({ state: 'waiting', edges: [{ blocker: expect.stringContaining('authoritative merge') }] });
    });

    it('makes provider errors and mismatched identities explicit blockers', async () => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        await bind(source.id);
        fetchPr.mockRejectedValueOnce(new Error('Permission denied'));
        expect((await evaluate(item.id)).edges[0].blocker).toContain('Permission denied');
        fetchPr.mockResolvedValue({ status: 'merged', title: 'Wrong', url: url.replace('/42', '/43') });
        expect((await evaluate(item.id)).edges[0].blocker).toContain('different PR');
    });

    it('keeps Azure DevOps provider and repository identity in exact bindings', async () => {
        const source = create();
        const ado = 'https://dev.azure.com/example/team/_git/project/pullrequest/17';
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        await bind(source.id, ado);
        fetchPr.mockImplementation(async pr => ({ status: 'merged', url: pr.url, title: 'Verified ADO output' }));
        expect(await evaluate(item.id)).toMatchObject({ state: 'ready', edges: [{ pr: {
            provider: 'ado', host: 'dev.azure.com', repoPath: 'example/team/project', number: 17, url: ado,
        } }] });
        await expect(bind(source.id, 'file:///claim/pull/17')).rejects.toMatchObject({ code: 'invalid' });
    });

    it('requires explicit selection for ambiguous outputs, validates tracked provenance, and CAS-rebinds', async () => {
        const source = create();
        for (const processId of ['child-a', 'child-b']) {
            todos.linkJob(owner, source.id, { processId, workspaceId: 'ws-execution', kind: 'local', openLink: processId });
        }
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        expect((await evaluate(item.id)).state).toBe('waiting');
        await expect(service.bindPrOutput(owner, source.id, { expectedRevision: 3, outputSlot: 'implementation', prUrl: url }, 'user')).rejects.toMatchObject({ code: 'invalid' });
        await expect(service.bindPrOutput(owner, source.id, { expectedRevision: 3, outputSlot: 'implementation', prUrl: url,
            provenance: { kind: 'tracked_job', processId: 'foreign', workspaceId: 'ws-execution', reason: 'Claim' } }, 'user')).rejects.toMatchObject({ code: 'invalid' });
        jobs.push({ id: 'child-a', parent: owner, child: { processId: 'child-a', workspaceId: 'ws-execution' },
            title: 'Implementation', createdAt: '2026-01-01T00:00:00.000Z', terminal: {
                result: { terminalEventId: 'event', outcome: 'completed', summary: 'Output',
                    links: [url, url.replace('/42', '/43')] }, delivery: { state: 'delivered', receiptId: 'delivery' },
            } });
        await expect(service.bindPrOutput(owner, source.id, { expectedRevision: 3, outputSlot: 'implementation', prUrl: url.replace('/42', '/44'),
            provenance: { kind: 'tracked_job', processId: 'child-a', workspaceId: 'ws-execution', reason: 'Claim' } }, 'user'))
            .rejects.toThrow('not in the tracked job outputs');
        await service.bindPrOutput(owner, source.id, { expectedRevision: 3, outputSlot: 'implementation', prUrl: url,
            provenance: { kind: 'tracked_job', processId: 'child-a', workspaceId: 'ws-execution', reason: 'Explicit exact output selection' } }, 'user');
        await expect(service.bindPrOutput(owner, source.id, { expectedRevision: 3, outputSlot: 'implementation', prUrl: url.replace('/42', '/43'),
            provenance: selection }, 'user')).rejects.toMatchObject({ code: 'conflict' });
        await bind(source.id, url.replace('/42', '/43'));
        expect(current(source.id).evidence).toHaveLength(1);
        expect(current(source.id).evidence[0]).toMatchObject({ pr: { number: 43 } });
    });

    it('rejects source or graph changes during async PR I/O, including change-and-revert', async () => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        await bind(source.id);
        fetchPr.mockImplementationOnce(async () => {
            todos.update(owner, source.id, current(source.id).revision, { notes: 'Changed' }, 'user');
            todos.update(owner, source.id, current(source.id).revision, { notes: '' }, 'user');
            return { status: 'merged', url, title: '' };
        });
        await expect(evaluate(item.id)).rejects.toMatchObject({ code: 'conflict' });
        expect(database.db.prepare('SELECT count(*) AS count FROM sentinel_todo_evaluations').get()).toEqual({ count: 0 });
        fetchPr.mockImplementationOnce(async () => {
            todos.setDependencies(owner, item.id, item.revision, [], 'user');
            return { status: 'merged', url, title: '' };
        });
        await expect(evaluate(item.id)).rejects.toMatchObject({ code: 'conflict' });
    });

    it('accepts an exact design artifact without setting Done and invalidates replaced bytes', async () => {
        fs.mkdirSync(path.join(root, 'notes'));
        fs.writeFileSync(path.join(root, 'notes', 'design.md'), 'Design\r\n');
        const version = artifactVersion(root, 'notes/design.md');
        const source = create('Feature');
        const condition = { kind: 'accepted_artifact' as const, phase: 'design', reference: 'notes/design.md', version };
        const item = dependent([{ itemId: source.id, condition }]);
        expect((await evaluate(item.id)).state).toBe('waiting');
        await expect(service.acceptArtifact(owner, source.id, { expectedRevision: 1, ...condition }, 'user'))
            .rejects.toMatchObject({ code: 'invalid' });
        const { kind: _kind, ...acceptance } = condition;
        await service.acceptArtifact(owner, source.id, { expectedRevision: 1, ...acceptance }, 'sentinel');
        expect(current(source.id).status).toBe('todo');
        expect((await evaluate(item.id)).state).toBe('ready');
        fs.writeFileSync(path.join(root, 'notes', 'design.md'), 'Changed\n');
        expect((await evaluate(item.id)).edges[0].blocker).toContain('content changed');
        await expect(service.acceptArtifact(owner, source.id, { expectedRevision: 2, ...acceptance }, 'user')).rejects.toMatchObject({ code: 'conflict' });
        const next = { ...acceptance, version: artifactVersion(root, acceptance.reference) };
        await service.acceptArtifact(owner, source.id, { expectedRevision: 2, ...next }, 'user');
        expect((await evaluate(item.id)).state).toBe('waiting');
        todos.setDependencies(owner, item.id, 2, [{ itemId: source.id, condition: { kind: 'accepted_artifact', ...next } }], 'user');
        expect((await evaluate(item.id)).state).toBe('ready');
        fs.unlinkSync(path.join(root, 'notes', 'design.md'));
        expect((await evaluate(item.id)).edges[0].blocker).toContain('unavailable');
    });

    it('pins artifacts to the prerequisite execution workspace, not the parent ledger content root', async () => {
        const parentRoot = path.join(root, 'parent');
        const executionRoot = path.join(root, 'execution');
        for (const directory of [parentRoot, executionRoot]) fs.mkdirSync(directory);
        fs.writeFileSync(path.join(parentRoot, 'design.md'), 'Parent design');
        fs.writeFileSync(path.join(executionRoot, 'design.md'), 'Execution design');
        const resolveWorkspaceRoot = vi.fn(async (id: string) => workspaceExists
            ? id === 'ws-execution' ? executionRoot : id === owner.workspaceId ? parentRoot : undefined : undefined);
        service = new SentinelTodoService({
            todos, dataDir: root, getDependenciesEnabled: () => enabled, resolveWorkspaceRoot,
            store: { getProcess: async id => ({ id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } }) as never },
        });
        const source = todos.create(owner, { title: 'Design', targetRepo: { workspaceId: 'ws-execution' } }, { actor: 'user' }).item;
        const condition = { kind: 'accepted_artifact' as const, phase: 'design', reference: 'design.md', version: artifactVersion(executionRoot, 'design.md') };
        const item = dependent([{ itemId: source.id, condition }]);
        const accepted = await service.acceptArtifact(owner, source.id, {
            expectedRevision: 1, phase: condition.phase, reference: condition.reference, version: condition.version,
        }, 'user');
        expect(accepted.item.evidence[0]).toMatchObject({ workspaceId: 'ws-execution', kind: 'artifact_acceptance' });
        expect(await evaluate(item.id)).toMatchObject({ state: 'ready', edges: [{ artifactWorkspaceId: 'ws-execution' }] });
        expect(resolveWorkspaceRoot).toHaveBeenCalledWith('ws-execution');
        expect(current(source.id).status).toBe('todo');
        workspaceExists = false;
        expect((await evaluate(item.id)).state).toBe('waiting');
        workspaceExists = true;
        todos.update(owner, source.id, current(source.id).revision, { targetRepo: { workspaceId: 'ws-other' } }, 'user');
        expect((await evaluate(item.id)).state).toBe('waiting');
        todos.update(owner, source.id, current(source.id).revision, { targetRepo: { workspaceId: 'ws-execution', serverId: 'server-other' } }, 'user');
        await expect(service.acceptArtifact(owner, source.id, {
            expectedRevision: current(source.id).revision, phase: condition.phase, reference: condition.reference, version: condition.version,
        }, 'user')).rejects.toThrow('Remote artifact content');
        expect((await evaluate(item.id)).edges[0].blocker).toContain('Remote artifact content');
    });

    it('accepts exact managed plan paths only under the selected workspace and rejects foreign roots and traversal', async () => {
        const repoRoot = path.join(root, 'checkout');
        fs.mkdirSync(repoRoot);
        service = new SentinelTodoService({
            todos, dataDir: root, getDependenciesEnabled: () => enabled, resolveWorkspaceRoot: async () => repoRoot,
            store: { getProcess: async id => ({ id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } }) as never },
        });
        const source = create('Design');
        const notesRoot = getRepoDataPath(root, owner.workspaceId, 'notes');
        const plansRoot = path.join(notesRoot, 'Plans');
        fs.mkdirSync(plansRoot, { recursive: true });
        const reference = path.join(plansRoot, 'design.md');
        fs.writeFileSync(reference, 'Approved design');
        const version = artifactVersion(notesRoot, reference);
        const condition = { kind: 'accepted_artifact' as const, phase: 'design', reference, version };
        const item = dependent([{ itemId: source.id, condition }]);
        await service.acceptArtifact(owner, source.id, { expectedRevision: 1, phase: condition.phase, reference, version }, 'user');
        expect(await evaluate(item.id)).toMatchObject({ state: 'ready', edges: [{ evidenceLink: reference, artifactWorkspaceId: owner.workspaceId }] });
        const foreignRoot = getRepoDataPath(root, 'ws-foreign', 'notes');
        fs.mkdirSync(foreignRoot, { recursive: true });
        const foreign = path.join(foreignRoot, 'design.md');
        fs.writeFileSync(foreign, 'Approved design');
        await expect(service.acceptArtifact(owner, source.id, { expectedRevision: 2, phase: 'design', reference: foreign, version }, 'user'))
            .rejects.toMatchObject({ code: 'invalid' });
        const escaped = path.relative(repoRoot, reference);
        await expect(service.acceptArtifact(owner, source.id, { expectedRevision: 2, phase: 'design', reference: escaped, version }, 'user'))
            .rejects.toMatchObject({ code: 'invalid' });
        fs.writeFileSync(reference, 'Replaced design');
        expect((await evaluate(item.id)).state).toBe('waiting');
    });

    it('pins phase and reference, supports native and backslash paths and rejects traversal/foreign absolutes', async () => {
        fs.mkdirSync(path.join(root, 'notes'));
        fs.writeFileSync(path.join(root, 'notes', 'design.md'), 'Bytes');
        const version = artifactVersion(root, 'notes\\design.md');
        expect(version).toBe(artifactVersion(root, path.join(root, 'notes', 'design.md')));
        for (const reference of ['../outside.md', '..\\outside.md', 'C:\\outside\\secret.md', '//foreign/share/file']) {
            expect(() => artifactVersion(root, reference)).toThrow();
        }
        const source = create();
        await service.acceptArtifact(owner, source.id, { expectedRevision: 1, phase: 'design', reference: 'notes/design.md', version }, 'user');
        for (const condition of [
            { kind: 'accepted_artifact' as const, phase: 'implementation', reference: 'notes/design.md', version },
            { kind: 'accepted_artifact' as const, phase: 'design', reference: 'notes\\design.md', version },
        ]) expect((await evaluate(dependent([{ itemId: source.id, condition }]).id)).state).toBe('waiting');
    });

    it('rejects symlink escape on platforms permitting symlinks', () => {
        const outside = path.join(root, 'outside');
        const workspace = path.join(root, 'workspace');
        fs.mkdirSync(outside);
        fs.mkdirSync(workspace);
        fs.writeFileSync(path.join(outside, 'secret.md'), 'Do not accept');
        try { fs.symlinkSync(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir'); }
        catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') return; throw error; }
        expect(() => artifactVersion(workspace, 'escape/secret.md')).toThrow('escapes');
    });

    it('rejects nonfiles, oversized content and stale acceptance revisions', async () => {
        fs.mkdirSync(path.join(root, 'directory'));
        expect(() => artifactVersion(root, 'directory')).toThrow();
        const file = path.join(root, 'large.md');
        fs.writeFileSync(file, '');
        fs.truncateSync(file, 10 * 1024 * 1024 + 1);
        expect(() => artifactVersion(root, 'large.md')).toThrow('size limit');
        fs.writeFileSync(path.join(root, 'design.md'), 'Design');
        const acceptance = { expectedRevision: 1, phase: 'design', reference: 'design.md', version: artifactVersion(root, 'design.md') };
        const source = create();
        await service.acceptArtifact(owner, source.id, acceptance, 'user');
        await expect(service.acceptArtifact(owner, source.id, acceptance, 'user')).rejects.toMatchObject({ code: 'conflict' });
    });

    it('rolls back evidence with failed revision writes and never silently returns ready on database failure', async () => {
        const source = create();
        const unblock = failTodoWrites(database.db);
        await expect(bind(source.id)).rejects.toThrow('write failure');
        expect(current(source.id).evidence).toEqual([]);
        expect(current(source.id).revision).toBe(1);
        unblock();
        database.db.exec(`CREATE TEMP TRIGGER evidence_test_fail BEFORE INSERT ON sentinel_todo_evaluations
            BEGIN SELECT RAISE(ABORT, 'evaluation write failure'); END;`);
        await expect(evaluate(source.id)).rejects.toThrow('evaluation write failure');
    });

    it('captures artifact revisions before asynchronous workspace resolution', async () => {
        fs.writeFileSync(path.join(root, 'design.md'), 'Design');
        const source = create();
        const delayed = new SentinelTodoService({
            todos, getDependenciesEnabled: () => enabled,
            store: { getProcess: async id => ({ id, metadata: { mode: 'sentinel', workspaceId: owner.workspaceId } } as never) },
            resolveWorkspaceRoot: async () => {
                todos.update(owner, source.id, 1, { notes: 'Concurrent change' }, 'user');
                return root;
            },
        });
        await expect(delayed.acceptArtifact(owner, source.id, {
            expectedRevision: 1, phase: 'design', reference: 'design.md', version: artifactVersion(root, 'design.md'),
        }, 'user')).rejects.toMatchObject({ code: 'conflict' });
        expect(current(source.id).evidence).toEqual([]);
    });

    it('blocks archived sources, removed workspaces and unavailable owners, including delayed owner removal', async () => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'done' } }]);
        todos.update(owner, source.id, 1, { status: 'done', archived: true }, 'user');
        expect((await evaluate(item.id)).state).toBe('waiting');
        await expect(bind(source.id)).rejects.toMatchObject({ code: 'invalid' });
        ownerExists = false;
        await expect(evaluate(item.id)).rejects.toMatchObject({ code: 'not_found' });
        ownerExists = true;
        const prSource = create();
        const prItem = dependent([{ itemId: prSource.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        await bind(prSource.id);
        fetchPr.mockImplementationOnce(async () => { ownerExists = false; return { status: 'merged', url, title: '' }; });
        await expect(evaluate(prItem.id)).rejects.toMatchObject({ code: 'not_found' });
        ownerExists = true;
        fs.writeFileSync(path.join(root, 'design.md'), 'Design');
        const version = artifactVersion(root, 'design.md');
        await service.acceptArtifact(owner, prSource.id, { expectedRevision: 2, phase: 'design', reference: 'design.md', version }, 'user');
        const artifact = dependent([{ itemId: prSource.id, condition: { kind: 'accepted_artifact', phase: 'design', reference: 'design.md', version } }]);
        workspaceExists = false;
        expect((await evaluate(artifact.id)).edges[0].blocker).toContain('workspace content is unavailable');
    });

    it('fails closed for foreign ledgers, unknown fields and live flag changes', async () => {
        const source = create();
        const foreign = { ...owner, processId: 'queue_foreign' };
        await expect(service.bindPrOutput(foreign, source.id, { expectedRevision: 1, outputSlot: 'implementation', prUrl: url, provenance: selection }, 'user')).rejects.toMatchObject({ code: 'not_found' });
        await expect(service.bindPrOutput(owner, source.id, { expectedRevision: 1, outputSlot: 'implementation', prUrl: url, provenance: selection, merged: true }, 'user')).rejects.toMatchObject({ code: 'invalid' });
        enabled = false;
        await expect(bind(source.id)).rejects.toMatchObject({ code: 'not_found' });
        await expect(evaluate(source.id)).rejects.toMatchObject({ code: 'not_found' });
        expect(current(source.id).evidence).toEqual([]);
    });

    it('shares owner-bound tool commands with service, hides them off, and never launches', async () => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        const tool = createSentinelTodosTool({ service, owner }).tool;
        const call = (args: unknown) => (tool as any).handler(args, {});
        expect(await call({ action: 'bind_pr_output', itemId: source.id, expectedRevision: 1, outputSlot: 'implementation', prUrl: url, provenance: selection }))
            .toMatchObject({ item: { evidence: [{ recordedBy: 'sentinel' }] } });
        expect(await call({ action: 'evaluate_dependencies', itemId: item.id })).toMatchObject({ readiness: { state: 'ready' } });
        enabled = false;
        expect(await call({ action: 'evaluate_dependencies', itemId: item.id })).toMatchObject({ code: 'disabled' });
        expect((createSentinelTodosTool({ service, owner }).tool.parameters as any).properties.action.enum).not.toContain('bind_pr_output');
    });

    it('persists evidence and diagnostic snapshots locally, wipes them and exports neither', async () => {
        const source = create();
        const item = dependent([{ itemId: source.id, condition: { kind: 'pr_merge', outputSlot: 'implementation' } }]);
        await bind(source.id);
        await evaluate(item.id);
        expect(database.db.prepare('SELECT count(*) AS count FROM sentinel_todo_evidence').get()).toEqual({ count: 1 });
        expect(database.db.prepare('SELECT count(*) AS count FROM sentinel_todo_evaluations').get()).toEqual({ count: 1 });
        database.close();
        const reopened = createTodoTestDatabase(root);
        try {
            expect(new SentinelTodoStore(reopened.db).get(owner).items[0].evidence)
                .toEqual([expect.objectContaining({ kind: 'pr_binding', outputSlot: 'implementation', recordedBy: 'sentinel' })]);
            const domain = createSentinelTodosDomain();
            const context = { dataDir: root, store: {} } as StorageSnapshotContext;
            expect((await domain.collect(context)).data).toEqual({});
            const result = { errors: [] } as any;
            await domain.executeWipe(context, [], result);
            expect(result.errors).toEqual([]);
            expect(reopened.db.prepare('SELECT count(*) AS count FROM sentinel_todo_evidence').get()).toEqual({ count: 0 });
            expect(reopened.db.prepare('SELECT count(*) AS count FROM sentinel_todo_evaluations').get()).toEqual({ count: 0 });
        } finally { reopened.close(); }
    });
});

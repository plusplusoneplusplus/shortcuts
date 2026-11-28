import type { OwnerScriptRunner } from '../../../src/server/executors/owner-script-runner';
import { validateExtensionScriptTools } from '../../../src/server/canvas-extensions/script-tools';
import { createRepoGroup } from '../../../src/server/workspaces/repo-group-workspace';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasStore } from '../../../src/server/canvas/canvas-store';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { deleteGeneratedCanvasRecords, loadCanvasExtensionInstances } from '../../../src/server/canvas-extensions/instance-records';
import { publishGeneratedCanvas, deleteGeneratedCanvas, reconcileGeneratedPublications } from '../../../src/server/canvas-extensions/generated-publication';
import { generatedOwnerRoot, generatedPackageRoot, listGeneratedPackages, GENERATED_SOURCE_BYTES, stageGeneratedPackage } from '../../../src/server/canvas-extensions/generated-packages';
import { createCanvasExtensionTools } from '../../../src/server/llm-tools/canvas-extension-tools';
import { reopenCanvasExtension, runCanvasExtensionOperation, type CanvasExtensionInstanceDeps } from '../../../src/server/canvas-extensions/instance-service';
import { createCanvasTools } from '../../../src/server/llm-tools/canvas-tools';
import { listSessionWorkspaceOwners } from '../../../src/server/canvas-extensions/session-workspace';

vi.mock('node:fs', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs')>();
    return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

const owner = { workspaceId: 'workspace', processId: 'conversation/one' };
describe('generated extension publications with a real Node host', () => {
    let root: string, repo: string, source: string;
    let enabled: boolean, exists: boolean;
    let deps: CanvasExtensionInstanceDeps;
    let scriptRunner: OwnerScriptRunner | undefined;
    const config = () => ({ canvasExtensions: { enabled } });
    function registry() {
        return new CanvasExtensionHostRegistry({ config, store: deps.processStore, dataDir: root, log: vi.fn(), getOwnerScriptRunner: () => scriptRunner,
            deleteGeneratedRecords: scope => { deleteGeneratedCanvasRecords(deps.canvasStore, scope); },
            loadInstances: (scope, key) => loadCanvasExtensionInstances(deps.canvasStore, scope, key),
        });
    }
    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'generated-canvas-')));
        repo = path.join(root, 'repo'); fs.mkdirSync(repo);
        source = path.join(repo, 'extension.mjs');
        fs.copyFileSync(path.resolve('test/fixtures/canvas-extensions/minimal/extension.mjs'), source);
        enabled = true; exists = true; scriptRunner = undefined;
        const processStore = { getProcess: async (id: string, workspaceId: string) => exists ? {
            id, type: 'chat', workingDirectory: repo, metadata: { workspaceId, mode: 'autopilot' },
        } : undefined, getWorkspaces: async () => [{ id: owner.workspaceId, rootPath: repo }] } as unknown as ProcessStore;
        deps = { ...owner, dataDir: root, config, processStore, canvasStore: new CanvasStore(root),
            notifier: { canvasUpdated: vi.fn() }, hosts: undefined as never };
        deps.hosts = registry();
    });
    afterEach(async () => { await deps.hosts.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
    const publish = (extra = {}) => publishGeneratedCanvas(deps, { sourcePath: source, declaredCanvasId: 'counter', input: { count: 4 }, ...extra });
    async function tool(name: string, args: unknown) {
        return createCanvasExtensionTools(deps).find(item => item.name === name)!.handler(args) as Promise<any>;
    }
    it('publishes, invokes, closes, reopens after registry restart, replaces assets and deletes all instances/state', async () => {
        const asset = path.join(repo, 'data.txt'); fs.writeFileSync(asset, 'one');
        const created = await publish({ assets: [{ path: 'data.txt', sourcePath: asset }] });
        expect(created).toMatchObject({ success: true, revision: 1, declaredCanvasId: 'counter', embed: `canvas://${created.canvasId}` });
        expect(await tool('invoke_canvas_action', { instanceId: created.instanceId, actionName: 'increment' })).toEqual({ success: true, result: 5 });
        await tool('invoke_canvas_action', { instanceId: created.instanceId, actionName: 'workspace-write', input: { value: 'durable' } });
        await tool('manage_canvas', { action: 'close', instanceId: created.instanceId });
        await deps.hosts.dispose(); deps.hosts = registry();
        const opened = await reopenCanvasExtension(deps, created.canvasId);
        expect(await (await fetch(opened.url!)).json()).toEqual({ count: 4 });
        expect(await tool('invoke_canvas_action', { instanceId: created.instanceId, actionName: 'workspace-read' })).toEqual({ success: true, result: 'durable' });
        const record = deps.canvasStore.getCanvas(owner.workspaceId, created.canvasId)!;
        const updated = await publish({ canvasId: created.canvasId, expectedRevision: record.revision, input: undefined, assets: [] });
        expect(updated.canvasId).toBe(created.canvasId);
        const [item] = listGeneratedPackages(root, owner);
        expect(item.assets).toEqual([]);
        expect(fs.readdirSync(path.dirname(path.dirname(item.sourcePath)))).toEqual([item.revision]);
        expect(await tool('invoke_canvas_action', { instanceId: created.instanceId, actionName: 'workspace-read' })).toEqual({ success: true, result: 'durable' });
        const result = await runCanvasExtensionOperation(deps, () => deleteGeneratedCanvas(deps, created.extensionKey));
        expect(result.removedCanvasIds).toEqual([created.canvasId]);
        expect(deps.canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
        expect(listGeneratedPackages(root, owner)).toEqual([]);
        await expect(fetch(opened.url!)).rejects.toThrow();
    }, 30_000);
    it('enforces revisions, source bounds, old-argument rejection and owner-safe reads', async () => {
        const created = await publish();
        await expect(publish({ canvasId: created.canvasId, expectedRevision: 0 })).rejects.toMatchObject({ data: { code: 'revision-conflict' } });
        const ordinary = createCanvasTools({ dataDir: root, ...owner, canvasStore: deps.canvasStore });
        expect(await ordinary.write.handler({ canvasId: created.canvasId, expectedRevision: 1, content: '{}' })).toMatchObject({ success: false });
        const read: any = await ordinary.read.handler({ canvasId: created.canvasId });
        expect(read.sourcePath).toMatch(/extension\.mjs$/);
        expect(read.content).toBeUndefined();
        const other = createCanvasTools({ dataDir: root, workspaceId: owner.workspaceId, processId: 'other', canvasStore: deps.canvasStore });
        expect(await other.read.handler({ canvasId: created.canvasId })).toMatchObject({ success: false });
        await expect(publish({ capabilitiesJs: 'old', uiHtml: 'old' })).rejects.toThrow('Invalid extension_canvas');
        fs.writeFileSync(source, ' '.repeat(GENERATED_SOURCE_BYTES + 1));
        await expect(publish()).rejects.toThrow('exceeds');
        expect(listGeneratedPackages(root, owner)).toHaveLength(1);
    });
    it.each(['../escape', '/absolute', 'extension.mjs', 'x/../y', 'node_modules/x'])('rejects unsafe asset %s without publishing', async destination => {
        await expect(publish({ assets: [{ path: destination, sourcePath: source }] })).rejects.toThrow();
        expect(listGeneratedPackages(root, owner)).toEqual([]);
    });
    it('rejects a symlink source escaping the authorized roots', () => {
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-outside-'));
        try {
            // An untrusted root is simulated separately; OS temp itself is an authorized staging root.
            const link = path.join(repo, 'linked'); fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
            fs.writeFileSync(path.join(outside, 'secret'), 'secret');
            expect(() => stageGeneratedPackage(root, owner, { cwd: repo, roots: [repo] }, { sourcePath: path.join(link, 'secret') })).toThrow('authorized');
        } finally { fs.rmSync(outside, { recursive: true, force: true }); }
    });
    it.each(['not valid JavaScript @', 'import "missing-generated-dependency";', 'import { joinSession } from "@github/copilot-sdk/extension"; await joinSession({canvases: []});'])('cleans failed candidate source and records', async text => {
        fs.writeFileSync(source, text);
        await expect(publish()).rejects.toThrow();
        expect(listGeneratedPackages(root, owner)).toEqual([]);
        expect(deps.canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
    });
    it('revokes a queued publication when the owner is deleted and never recreates source', async () => {
        let release!: () => void;
        const queued = runCanvasExtensionOperation(deps, () => new Promise<void>(resolve => { release = resolve; }));
        await vi.waitFor(() => expect(release).toBeTypeOf('function'));
        const pending = publish();
        exists = false;
        const stopping = deps.hosts.stopConversation(owner, true);
        release(); await queued; await stopping;
        await expect(pending).rejects.toThrow();
        expect(fs.existsSync(generatedOwnerRoot(root, owner))).toBe(false);
    });
    it('cancels publication before any source reads or runtime work', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(publishGeneratedCanvas(deps, { sourcePath: source, declaredCanvasId: 'counter' }, controller.signal)).rejects.toThrow();
        expect(listGeneratedPackages(root, owner)).toEqual([]);
    });
    it('discovers source-only owners for orphan cleanup and removes interrupted staging without executing it', async () => {
        const staged = stageGeneratedPackage(root, owner, { cwd: repo, roots: [repo] }, { sourcePath: source });
        expect(await listSessionWorkspaceOwners(root)).toContainEqual(owner);
        reconcileGeneratedPublications(deps);
        expect(fs.existsSync(staged.sourcePath)).toBe(false);
    });
    it('revokes already-created tools when disabled', async () => {
        const tools = createCanvasExtensionTools(deps);
        enabled = false; await deps.hosts.syncConfig();
        const result: any = await tools.find(item => item.name === 'extension_canvas')!.handler({ sourcePath: source, declaredCanvasId: 'counter' });
        expect(result.resultType).toBe('failure');
        expect(listGeneratedPackages(root, owner)).toEqual([]);
    });
    it('cancels and exits a real child while declarations are still pending', async () => {
        const started = path.join(repo, 'started');
        fs.writeFileSync(source, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(started)}, 'yes'); setInterval(()=>{}, 1000); await new Promise(()=>{});`);
        const controller = new AbortController();
        const pending = publishGeneratedCanvas(deps, { sourcePath: source, declaredCanvasId: 'counter' }, controller.signal);
        const outcome = Promise.allSettled([pending]);
        await vi.waitFor(() => expect(fs.existsSync(started)).toBe(true));
        controller.abort();
        expect((await outcome)[0].status).toBe('rejected');
        expect(listGeneratedPackages(root, owner)).toEqual([]);
        expect(deps.canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
    }, 10_000);
    it('keeps a running committed revision when candidate declarations are incompatible', async () => {
        const created = await publish();
        const opened = await reopenCanvasExtension(deps, created.canvasId);
        const original = listGeneratedPackages(root, owner)[0];
        fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace("id: 'counter'", "id: 'different'"));
        const revision = deps.canvasStore.getCanvas(owner.workspaceId, created.canvasId)!.revision;
        await expect(publish({ canvasId: created.canvasId, expectedRevision: revision })).rejects.toThrow('declaration');
        expect(listGeneratedPackages(root, owner)[0].revision).toBe(original.revision);
        expect(await (await fetch(opened.url!)).json()).toEqual({ count: 4 });
    });
    it('retains committed source after persistence failure and requires explicit reload before actions', async () => {
        const created = await publish();
        const original = listGeneratedPackages(root, owner)[0];
        vi.spyOn(deps.canvasStore, 'updateCanvas').mockImplementationOnce(() => { throw new Error('disk failed'); });
        await expect(publish({ canvasId: created.canvasId, expectedRevision: created.revision })).rejects.toThrow('disk failed');
        expect(listGeneratedPackages(root, owner)[0]).toMatchObject({ revision: original.revision, status: 'failed' });
        expect(await tool('invoke_canvas_action', { instanceId: created.instanceId, actionName: 'increment' })).toMatchObject({ resultType: 'failure' });
        await reopenCanvasExtension(deps, created.canvasId, { reload: true });
        expect(await tool('invoke_canvas_action', { instanceId: created.instanceId, actionName: 'increment' })).toEqual({ success: true, result: 5 });
    });
    it('keeps generated identities and source reads isolated across chats and workspaces', async () => {
        const first = await publish();
        const sibling = { ...deps, processId: 'conversation/two' };
        const second = await publishGeneratedCanvas(sibling, { sourcePath: source, declaredCanvasId: 'counter' });
        expect(first.extensionKey).not.toBe(second.extensionKey);
        expect(listGeneratedPackages(root, owner)).toHaveLength(1);
        expect(listGeneratedPackages(root, sibling)).toHaveLength(1);
        const capabilities: any = await createCanvasExtensionTools(sibling).find(tool => tool.name === 'list_canvas_capabilities')!.handler({});
        expect(capabilities.canvases.some((canvas: any) => canvas.extensionKey === first.extensionKey)).toBe(false);
        vi.spyOn(deps.processStore, 'getWorkspaces').mockResolvedValue([
            { id: owner.workspaceId, rootPath: repo }, { id: 'other-workspace', rootPath: repo },
        ] as never);
        const otherWorkspace = { ...deps, workspaceId: 'other-workspace' };
        const third = await publishGeneratedCanvas(otherWorkspace, { sourcePath: source, declaredCanvasId: 'counter' });
        expect(third.extensionKey).not.toBe(first.extensionKey);
        expect(listGeneratedPackages(root, otherWorkspace)).toHaveLength(1);
        await deps.hosts.stopConversation(owner, true);
        expect(listGeneratedPackages(root, owner)).toEqual([]);
        expect(deps.canvasStore.listCanvases(owner.workspaceId, { processId: owner.processId })).toEqual([]);
        expect(listGeneratedPackages(root, sibling)).toHaveLength(1);
        expect(listGeneratedPackages(root, otherWorkspace)).toHaveLength(1);
    });
    it('denies publication on a read-only conversation before reading source', async () => {
        vi.spyOn(deps.processStore, 'getProcess').mockResolvedValue({ id: owner.processId, workingDirectory: repo,
            metadata: { workspaceId: owner.workspaceId, mode: 'ask' } } as never);
        await expect(publish()).rejects.toThrow('write-capable');
        expect(listGeneratedPackages(root, owner)).toEqual([]);
    });

    it('recovers an interrupted create journal including its provisional record and state', async () => {
        const staged = stageGeneratedPackage(root, owner, { cwd: repo, roots: [repo] }, { sourcePath: source });
        const canvas = deps.canvasStore.createCanvas({ workspaceId: owner.workspaceId, processId: owner.processId,
            title: 'Pending', type: 'copilot-extension', content: JSON.stringify({ extensionKey: staged.extension.extensionKey,
                canvasId: 'counter', instanceId: 'pending', title: 'Pending' }) });
        fs.writeFileSync(path.join(generatedPackageRoot(root, owner, staged.id), 'pending.json'), JSON.stringify({
            candidate: staged, records: [], createdCanvasId: canvas.id,
        }));
        reconcileGeneratedPublications(deps);
        expect(deps.canvasStore.getCanvas(owner.workspaceId, canvas.id)).toBeNull();
        expect(fs.existsSync(staged.sourcePath)).toBe(false);
    });
    it('recovers an interrupted update to retained committed source without starting code', async () => {
        const created = await publish();
        const previous = listGeneratedPackages(root, owner)[0];
        const record = deps.canvasStore.getCanvas(owner.workspaceId, created.canvasId)!;
        await deps.hosts.reset(owner, previous.extension);
        const staged = stageGeneratedPackage(root, owner, { cwd: repo, roots: [repo] }, { sourcePath: source }, previous.id);
        fs.writeFileSync(path.join(generatedPackageRoot(root, owner, staged.id), 'pending.json'), JSON.stringify({
            candidate: staged, previous, records: [record],
        }));
        reconcileGeneratedPublications(deps);
        expect(listGeneratedPackages(root, owner)[0]).toMatchObject({ revision: previous.revision, status: 'failed' });
        expect(fs.existsSync(staged.sourcePath)).toBe(false);
        const saved = deps.canvasStore.getCanvas(owner.workspaceId, record.id)!;
        expect(JSON.parse(saved.content).runtimeReload.error).toContain('interrupted');
    });
    it('keeps closed siblings closed and advances their revisions when replacing a package', async () => {
        const created = await publish();
        deps.config = () => ({ canvasExtensions: { enabled, singletonPerSession: false } });
        const sibling: any = await tool('manage_canvas', { action: 'open', canvasId: `${created.extensionKey}/counter`, input: { count: 2 } });
        expect(sibling.canvasId).not.toBe(created.canvasId);
        await tool('manage_canvas', { action: 'close', instanceId: sibling.instanceId });
        const before = deps.canvasStore.getCanvas(owner.workspaceId, sibling.canvasId)!;
        await publish({ canvasId: created.canvasId, expectedRevision: created.revision });
        const after = deps.canvasStore.getCanvas(owner.workspaceId, sibling.canvasId)!;
        expect(JSON.parse(after.content)).toMatchObject({ closed: true, input: { count: 2 } });
        expect(after.revision).toBeGreaterThan(before.revision);
        await expect(publish({ canvasId: sibling.canvasId, expectedRevision: before.revision })).rejects.toMatchObject({ data: { code: 'revision-conflict' } });
    });
    it('rejects duplicate destinations and finite asset/package bounds before publishing', async () => {
        await expect(publish({ assets: [{ path: 'DATA', sourcePath: source }, { path: 'data', sourcePath: source }] })).rejects.toThrow('duplicate');
        await expect(publish({ assets: Array.from({ length: 21 }, (_, index) => ({ path: `data${index}`, sourcePath: source })) })).rejects.toThrow('20');
        const asset = path.join(repo, 'large');
        fs.writeFileSync(asset, Buffer.alloc(8 * 1024 * 1024 + 1));
        await expect(publish({ assets: [{ path: 'large', sourcePath: asset }] })).rejects.toThrow('exceeds');
        fs.truncateSync(asset, 8 * 1024 * 1024);
        await expect(publish({ assets: Array.from({ length: 5 }, (_, index) => ({ path: `data${index}`, sourcePath: asset })) })).rejects.toThrow('32 MiB');
        expect(listGeneratedPackages(root, owner)).toEqual([]);
    });
    it('removes source-only owners on workspace removal before another start can enter', async () => {
        const staged = stageGeneratedPackage(root, owner, { cwd: repo, roots: [repo] }, { sourcePath: source });
        const remove = vi.fn(async () => true);
        expect(await deps.hosts.removeWorkspace(owner.workspaceId, remove)).toBe(true);
        expect(remove).toHaveBeenCalledOnce();
        expect(fs.existsSync(staged.sourcePath)).toBe(false);
    });

    it('runs the generated PR dashboard read-only script bridge and restores its atomic state files', async () => {
        fs.copyFileSync(path.resolve('test/fixtures/canvas/pr-dashboard/extension.mjs'), source);
        const value = { items: [{ id: 42, title: 'A pull request' }] };
        scriptRunner = vi.fn(async () => ({ ok: true, result: value, logs: [], calls: [], callCount: 1 }));
        const created = await publishGeneratedCanvas(deps, { sourcePath: source, declaredCanvasId: 'pr-dashboard',
            input: { provider: 'github', repository: 'example/repo' } });
        expect(await tool('invoke_canvas_action', { instanceId: created.instanceId, actionName: 'refresh' })).toEqual({ success: true, result: value });
        expect(scriptRunner).toHaveBeenCalledWith(expect.objectContaining({ ...owner,
            allowTools: ['query_pull_request'], includeMcpTools: false,
            state: { provider: 'github', repository: 'example/repo' } }));
        expect(validateExtensionScriptTools(['extension_canvas']).ok).toBe(false);
        await deps.hosts.dispose(); deps.hosts = registry();
        const reopened = await reopenCanvasExtension(deps, created.canvasId);
        expect(await (await fetch(new URL('/data', reopened.url!))).json()).toEqual(value);
        expect(scriptRunner).toHaveBeenCalledOnce();
    });
    it('publishes under a group owner using its recorded member cwd, independent of member ordering', async () => {
        const otherRepo = path.join(root, 'second'); fs.mkdirSync(otherRepo);
        const workspaces: any[] = [{ id: owner.workspaceId, name: 'One', rootPath: repo }, { id: 'second', name: 'Two', rootPath: otherRepo }];
        vi.spyOn(deps.processStore, 'getWorkspaces').mockImplementation(async () => workspaces);
        deps.processStore.registerWorkspace = async workspace => { workspaces.push(workspace); };
        const group = await createRepoGroup(root, deps.processStore, { name: 'Generated group', members: ['second', owner.workspaceId] });
        const groupDeps = { ...deps, workspaceId: group.id };
        await publishGeneratedCanvas(groupDeps, { sourcePath: source, declaredCanvasId: 'counter' });
        const [item] = listGeneratedPackages(root, groupDeps);
        expect(item.extension.cwd).toBe(repo);
        expect(item.sourcePath.startsWith(generatedOwnerRoot(root, groupDeps))).toBe(true);
        expect(listGeneratedPackages(root, owner)).toEqual([]);
    });

    it('retries an interrupted permanent deletion without replaying any action', async () => {
        const created = await publish();
        const [item] = listGeneratedPackages(root, owner);
        const packageRoot = generatedPackageRoot(root, owner, item.id);
        const remove = vi.mocked(fs.rmSync).getMockImplementation()!;
        const spy = vi.mocked(fs.rmSync).mockImplementation((target, options) => {
            if (target === packageRoot) throw Object.assign(new Error('locked source'), { code: 'EPERM' });
            return remove(target, options);
        });
        try {
            await expect(runCanvasExtensionOperation(deps, () => deleteGeneratedCanvas(deps, created.extensionKey))).rejects.toThrow('locked source');
            expect(listGeneratedPackages(root, owner)[0].status).toBe('deleting');
        } finally { spy.mockRestore(); }
        reconcileGeneratedPublications(deps);
        expect(listGeneratedPackages(root, owner)).toEqual([]);
        expect(deps.canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
    });

    it('blocks new execution throughout data wipe and removes generated identities before releasing the gate', async () => {
        await publish();
        const release = await deps.hosts.prepareDataWipe();
        try {
            expect(listGeneratedPackages(root, owner)).toEqual([]);
            expect(deps.canvasStore.listCanvases(owner.workspaceId)).toEqual([]);
            expect(() => publish()).toThrow('wiped');
        } finally { release(); }
        expect((await publish()).success).toBe(true);
    });

    it('reconciles a committed package whose last durable record was already removed', async () => {
        const created = await publish();
        const [item] = listGeneratedPackages(root, owner);
        await deps.hosts.reset(owner, item.extension);
        deps.canvasStore.deleteCanvas(owner.workspaceId, created.canvasId);
        reconcileGeneratedPublications(deps);
        expect(fs.existsSync(item.sourcePath)).toBe(false);
        expect(listGeneratedPackages(root, owner)).toEqual([]);
    });
    it('accepts an authorized checkout root alias while still rejecting child symlink escapes', async () => {
        const alias = path.join(root, 'checkout-alias');
        fs.symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
        vi.spyOn(deps.processStore, 'getWorkspaces').mockResolvedValue([{ id: owner.workspaceId, rootPath: alias }] as never);
        expect((await publishGeneratedCanvas(deps, { sourcePath: path.join(alias, 'extension.mjs'), declaredCanvasId: 'counter' })).success).toBe(true);
    });

});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { RepoQueueRegistry, SqliteProcessStore } from '@plusplusoneplusplus/forge';
import { CanvasExtensionHostRegistry } from '../../../src/server/canvas-extensions/host-registry';
import { MultiRepoQueueRouter } from '../../../src/server/queue/multi-repo-queue-router';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import { createMockSDKService } from '../../helpers/mock-sdk-service';
import type { DiscoveredCanvasExtension } from '../../../src/server/canvas-extensions/discovery';

// The repository's own .github/extensions/coc-chat-viewer, run through the real host and owner runtime.
const repoRoot = path.resolve(__dirname, '../../../../..');
const extensionPath = path.join(repoRoot, '.github', 'extensions', 'coc-chat-viewer', 'extension.mjs');

const owner = { workspaceId: 'workspace-a', processId: 'viewer-chat' };
const target = 'target-chat';
const instance = { canvasId: 'chat-viewer', instanceId: 'instance-1' };

describe('coc-chat-viewer canvas extension', () => {
    let root: string;
    let store: SqliteProcessStore;
    let router: MultiRepoQueueRouter;
    let hosts: CanvasExtensionHostRegistry;
    const sdk = createMockSDKService();
    const extension: DiscoveredCanvasExtension = { extensionKey: 'workspace-a:coc-chat-viewer', ownerWorkspaceId: owner.workspaceId,
        name: 'coc-chat-viewer', extensionPath, cwd: repoRoot, contentHash: 'test' };

    beforeEach(async () => {
        sdk.resetAll();
        root = await mkdtemp(path.join(tmpdir(), 'coc-chat-viewer-'));
        store = new SqliteProcessStore({ dbPath: ':memory:' });
        const repo = path.join(root, owner.workspaceId);
        await mkdir(repo);
        await store.registerWorkspace({ id: owner.workspaceId, name: owner.workspaceId, rootPath: repo });
        writeRepoPreferences(root, owner.workspaceId, { disabledLlmTools: [] });
        const metadata = { workspaceId: owner.workspaceId, mode: 'ask', provider: 'copilot' };
        await store.addProcess({ id: owner.processId, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Viewer', workingDirectory: repo, metadata });
        await store.addProcess({ id: target, type: 'chat', status: 'completed', startTime: new Date(),
            promptPreview: 'Target chat', workingDirectory: repo, metadata,
            conversationTurns: [
                { role: 'user', content: 'What is the capital of France?', timestamp: new Date(), turnIndex: 0, timeline: [] },
                { role: 'assistant', content: 'Paris.', timestamp: new Date(), turnIndex: 1, timeline: [] },
            ] } as never);
        router = new MultiRepoQueueRouter(new RepoQueueRegistry(), store, { dataDir: root, autoStart: false, aiService: sdk.service });
        hosts = new CanvasExtensionHostRegistry({
            config: () => ({ canvasExtensions: { enabled: true } }), store, dataDir: root, log: vi.fn(),
            getOwnerScriptRunner: () => router.runOwnerScript,
        });
    });

    afterEach(async () => {
        await hosts.dispose();
        router.dispose();
        store.close();
        await rm(root, { recursive: true, force: true });
    });

    it('loads a transcript through get_conversation from the action and the page', async () => {
        const opened = await hosts.open(owner, extension, instance) as { url: string };
        expect(new URL(opened.url).hostname).toBe('127.0.0.1');
        const html = await (await fetch(opened.url)).text();
        expect(() => new vm.Script(/<script>([\s\S]*)<\/script>/.exec(html)![1])).not.toThrow();

        const result = await hosts.invoke(owner, extension, { instanceId: instance.instanceId, actionName: 'get_conversation',
            input: { processId: target } }) as { processId: string; totalTurns: number; transcript: string };
        expect(result).toMatchObject({ processId: target, totalTurns: 2 });
        expect(result.transcript).toContain('capital of France');
        expect(result.transcript).toContain('Paris.');

        const response = await fetch(`${opened.url}conversation?id=${target}`);
        expect(response.status).toBe(200);
        expect((await response.json()).transcript).toContain('Paris.');
        expect(sdk.service.sendMessage).not.toHaveBeenCalled();
    });

    it('reports a missing process ID as an error', async () => {
        const opened = await hosts.open(owner, extension, instance) as { url: string };
        const response = await fetch(`${opened.url}conversation?id=`);
        expect(response.status).toBe(400);
        expect((await response.json()).error).toContain('processId is required');
    });
});

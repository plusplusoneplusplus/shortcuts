import { describe, expect, it, vi } from 'vitest';
import * as path from 'path';
import { createMockProcessStore } from '../../helpers/mock-process-store';
import { FakeNativeWatchService } from '../../helpers/fake-native-watch-service';
import { createWatcherInfrastructure } from '../../../src/server/infrastructure/watcher-infrastructure';
import { getRepoDataPath } from '../../../src/server/paths';

vi.mock('../../../src/server/tasks/task-migration', () => ({
    isMigrationNeeded: () => false,
    migrateTasksToRepoScoped: vi.fn(),
}));
vi.mock('../../../src/server/tasks/task-root-resolver', () => ({
    resolveTaskRoot: ({ dataDir, workspaceId }: { dataDir: string; workspaceId: string }) => ({
        absolutePath: path.join(dataDir, workspaceId, 'resolved-tasks'),
    }),
}));

const dataDir = path.resolve('data');
const workspace = { id: 'one', rootPath: path.resolve('repo'), name: 'Repo' };

async function setup(existing = true) {
    const store = createMockProcessStore();
    vi.mocked(store.getWorkspaces).mockResolvedValue(existing ? [workspace] : []);
    const wsServer = { broadcastProcessEvent: vi.fn() };
    const bridge = { registerRepoId: vi.fn() };
    const notesSearch = { activateWorkspace: vi.fn(), evictWorkspace: vi.fn() };
    const service = new FakeNativeWatchService();
    const watchers = await createWatcherInfrastructure(store, dataDir, wsServer, bridge, notesSearch, service);
    return { store, wsServer, bridge, notesSearch, service, watchers };
}

describe('createWatcherInfrastructure', () => {
    it('uses resolved notes/tasks roots and shares only .vscode for workflows/templates', async () => {
        const { service, bridge } = await setup();
        expect([...service.subscriptions.values()].map(entry => entry.options.root)).toEqual([
            path.join(dataDir, 'one', 'resolved-tasks'),
            path.join(workspace.rootPath, '.vscode'),
            path.join(workspace.rootPath, '.vscode'),
            getRepoDataPath(dataDir, 'one', 'notes'),
        ]);
        expect(bridge.registerRepoId).toHaveBeenCalledExactlyOnceWith('one', workspace.rootPath);
    });

    it('broadcasts all consumer events from injected native batches', async () => {
        const { service, wsServer } = await setup();
        service.emit(1, ['a.md']);
        service.emit(2, ['workflows/a.yaml']);
        service.emit(3, ['templates/a.yaml']);
        service.emit(4, ['a.md', 'nested/b.md']);
        expect(wsServer.broadcastProcessEvent.mock.calls.map(([event]) => event.type)).toEqual([
            'tasks-changed', 'workflows-changed', 'templates-changed', 'notes-changed',
        ]);
        expect(wsServer.broadcastProcessEvent).toHaveBeenLastCalledWith(expect.objectContaining({
            workspaceId: 'one', changedPaths: ['a.md', 'nested/b.md'],
        }));
    });

    it('registers workspaces and reactivates notes search after the store registration', async () => {
        const { store, notesSearch, watchers, service } = await setup(false);
        await store.registerWorkspace!(workspace);
        expect(notesSearch.activateWorkspace).toHaveBeenCalledExactlyOnceWith('one');
        expect(watchers.taskWatcher.isWatching('one')).toBe(true);
        expect(service.subscriptions.size).toBe(4);
    });

    it('removes all workspace subscriptions, including other consumers, without touching another workspace', async () => {
        const { store, notesSearch, watchers, service } = await setup();
        const options = service.subscriptions.get(2)!.options;
        service.subscribe(options, vi.fn());
        const other = service.subscribe({ ...options, workspaceId: 'two' }, vi.fn());
        await store.removeWorkspace!('one');
        expect([...service.subscriptions.keys()]).toEqual([other]);
        expect(notesSearch.evictWorkspace).toHaveBeenCalledExactlyOnceWith('one');
        expect(watchers.taskWatcher.isWatching('one')).toBe(false);
        expect(watchers.pipelineWatcher.isWatching('one')).toBe(false);
        expect(watchers.templateWatcher.isWatching('one')).toBe(false);
        expect(watchers.notesWatcher.isWatching('one')).toBe(false);
    });

    it('broadcasts full invalidation for rescan batches', async () => {
        const { service, wsServer } = await setup();
        for (const id of service.subscriptions.keys()) service.emit(id, [], true);
        expect(wsServer.broadcastProcessEvent).toHaveBeenCalledTimes(4);
        expect(wsServer.broadcastProcessEvent).toHaveBeenLastCalledWith(expect.objectContaining({
            type: 'notes-changed', workspaceId: 'one', changedPaths: [],
        }));
    });

    it('keeps managed data watches for migrated workspaces without a repository root', async () => {
        const { store, service, watchers } = await setup(false);
        await store.registerWorkspace!({ ...workspace, rootPath: '' });
        expect(service.subscriptions.size).toBe(2);
        expect(watchers.taskWatcher.isWatching('one')).toBe(true);
        expect(watchers.notesWatcher.isWatching('one')).toBe(true);
        expect(watchers.pipelineWatcher.isWatching('one')).toBe(false);
        expect(watchers.templateWatcher.isWatching('one')).toBe(false);
    });
});

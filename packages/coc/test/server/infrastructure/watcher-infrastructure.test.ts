/**
 * createWatcherInfrastructure Tests
 *
 * Regression coverage for the extracted watcher infrastructure builder.
 * Verifies that createWatcherInfrastructure returns correctly wired instances
 * equivalent to the inline setup it replaced in index.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { createMockProcessStore } from '../../helpers/mock-process-store';
import { TaskWatcher } from '../../../src/server/tasks/task-watcher';
import { WorkflowWatcher } from '../../../src/server/workflows/workflow-watcher';
import { TemplateWatcher } from '../../../src/server/templates/template-watcher';
import { NotesWatcher } from '../../../src/server/notes/notes-watcher';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-infra-test-'));
}

function makeMockWsServer() {
    return { broadcastProcessEvent: vi.fn() } as any;
}

function makeMockBridge() {
    return { registerRepoId: vi.fn() } as any;
}

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { createWatcherInfrastructure } from '../../../src/server/infrastructure/watcher-infrastructure';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('createWatcherInfrastructure', () => {
    let dataDir: string;
    let tmpDirs: string[] = [];

    beforeEach(() => {
        dataDir = makeTempDir();
        tmpDirs = [dataDir];
    });

    afterEach(() => {
        for (const d of tmpDirs) {
            try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    });

    it('returns TaskWatcher, WorkflowWatcher, TemplateWatcher and NotesWatcher instances', async () => {
        const store = createMockProcessStore();
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        const result = await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        expect(result.taskWatcher).toBeInstanceOf(TaskWatcher);
        expect(result.pipelineWatcher).toBeInstanceOf(WorkflowWatcher);
        expect(result.templateWatcher).toBeInstanceOf(TemplateWatcher);
        expect(result.notesWatcher).toBeInstanceOf(NotesWatcher);
    });

    it('bootstraps watchers for pre-existing workspaces', async () => {
        const rootPath = makeTempDir();
        tmpDirs.push(rootPath);

        const store = createMockProcessStore({
            initialWorkspaces: [{ id: 'ws-1', rootPath, name: 'test' } as any],
        });
        // Override getWorkspaces to return the pre-populated workspace
        (store.getWorkspaces as ReturnType<typeof vi.fn>).mockResolvedValue([{ id: 'ws-1', rootPath, name: 'test' }]);

        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        expect(bridge.registerRepoId).toHaveBeenCalledWith('ws-1', rootPath);
    });

    it('monkey-patches store.registerWorkspace to start watchers', async () => {
        const store = createMockProcessStore();
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        const { taskWatcher } = await createWatcherInfrastructure(store, dataDir, wsServer, bridge);
        const watchSpy = vi.spyOn(taskWatcher, 'watchWorkspace');

        const rootPath = makeTempDir();
        tmpDirs.push(rootPath);
        await store.registerWorkspace!({ id: 'ws-new', rootPath, name: 'new' } as any);

        expect(watchSpy).toHaveBeenCalledWith('ws-new', expect.any(String));
        expect(bridge.registerRepoId).toHaveBeenCalledWith('ws-new', rootPath);
    });

    it('monkey-patches store.removeWorkspace to stop watchers', async () => {
        const store = createMockProcessStore();
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        const { taskWatcher, pipelineWatcher, templateWatcher, notesWatcher } =
            await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        const unwatchTask = vi.spyOn(taskWatcher, 'unwatchWorkspace');
        const unwatchPipeline = vi.spyOn(pipelineWatcher, 'unwatchWorkspace');
        const unwatchTemplate = vi.spyOn(templateWatcher, 'unwatchWorkspace');
        const unwatchNotes = vi.spyOn(notesWatcher, 'unwatchWorkspace');

        await store.removeWorkspace!('ws-gone');

        expect(unwatchTask).toHaveBeenCalledWith('ws-gone');
        expect(unwatchPipeline).toHaveBeenCalledWith('ws-gone');
        expect(unwatchTemplate).toHaveBeenCalledWith('ws-gone');
        expect(unwatchNotes).toHaveBeenCalledWith('ws-gone');
    });

    it('delegates to original store.registerWorkspace before wiring watchers', async () => {
        const store = createMockProcessStore();
        const originalRegister = store.registerWorkspace as ReturnType<typeof vi.fn>;
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        const rootPath = makeTempDir();
        tmpDirs.push(rootPath);
        await store.registerWorkspace!({ id: 'ws-delegate', rootPath, name: 'delegate' } as any);

        expect(originalRegister).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'ws-delegate' }),
        );
    });

    it('delegates to original store.removeWorkspace', async () => {
        const store = createMockProcessStore();
        const originalRemove = store.removeWorkspace as ReturnType<typeof vi.fn>;
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        await createWatcherInfrastructure(store, dataDir, wsServer, bridge);
        await store.removeWorkspace!('ws-remove-me');

        expect(originalRemove).toHaveBeenCalledWith('ws-remove-me');
    });

    it('broadcasts tasks-changed event via wsServer callback', async () => {
        const store = createMockProcessStore();
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        const { taskWatcher } = await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        // Directly invoke the internal callback by triggering a watched directory change.
        // We can't easily simulate fs.watch, so we call the watcher's callback indirectly
        // by invoking watchWorkspace with a real directory and verifying the broadcast
        // function signature is wired correctly.
        // Instead, reach into the watcher's onTasksChanged via a cast.
        const watcher = taskWatcher as any;
        watcher.onTasksChanged('test-ws');

        expect(wsServer.broadcastProcessEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'tasks-changed', workspaceId: 'test-ws' }),
        );
    });

    it('broadcasts workflows-changed event via wsServer callback', async () => {
        const store = createMockProcessStore();
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        const { pipelineWatcher } = await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        (pipelineWatcher as any).onWorkflowsChanged('test-ws');

        expect(wsServer.broadcastProcessEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'workflows-changed', workspaceId: 'test-ws' }),
        );
    });

    it('broadcasts templates-changed event via wsServer callback', async () => {
        const store = createMockProcessStore();
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        const { templateWatcher } = await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        (templateWatcher as any).onTemplatesChanged('test-ws');

        expect(wsServer.broadcastProcessEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'templates-changed', workspaceId: 'test-ws' }),
        );
    });

    it('broadcasts notes-changed event via wsServer callback', async () => {
        const store = createMockProcessStore();
        const wsServer = makeMockWsServer();
        const bridge = makeMockBridge();

        const { notesWatcher } = await createWatcherInfrastructure(store, dataDir, wsServer, bridge);

        (notesWatcher as any).onNotesChanged('test-ws', ['note.md']);

        expect(wsServer.broadcastProcessEvent).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'notes-changed',
                workspaceId: 'test-ws',
                changedPaths: ['note.md'],
            }),
        );
    });
});

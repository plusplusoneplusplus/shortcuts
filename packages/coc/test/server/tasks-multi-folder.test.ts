/**
 * Tests for multi-folder tasks support:
 * - mergeTaskFoldersAsVirtualRoot()
 * - resolveAllTaskRoots()
 * - tasks-settings.json persistence (readTasksSettings / writeTasksSettings)
 * - GET /tasks with folderPaths
 * - PATCH /tasks/settings
 * - GET /tasks/settings includes folderPaths
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/forge';
import type { TaskFolder } from '@plusplusoneplusplus/forge';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import { resolveTaskRoot } from '../../src/server/task-root-resolver';
import { resolveAllTaskRoots } from '../../src/server/task-root-resolver';
import { mergeTaskFoldersAsVirtualRoot, readTasksSettings, writeTasksSettings } from '../../src/server/tasks-handler-utils';

// ============================================================================
// Helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: options.headers,
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode || 0,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString('utf-8'),
                    });
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

// ============================================================================
// Unit tests: mergeTaskFoldersAsVirtualRoot
// ============================================================================

describe('mergeTaskFoldersAsVirtualRoot', () => {
    function makeFolder(name: string): TaskFolder {
        return {
            name,
            folderPath: `/mock/${name}`,
            relativePath: '',
            isArchived: false,
            children: [],
            tasks: [],
            documentGroups: [],
            singleDocuments: [],
        };
    }

    it('returns synthetic root with children from each input folder', () => {
        const a = makeFolder('a');
        const b = makeFolder('b');
        const result = mergeTaskFoldersAsVirtualRoot([
            { folder: a, label: 'FolderA' },
            { folder: b, label: 'FolderB' },
        ]);
        expect(result.name).toBe('Tasks');
        expect(result.children).toHaveLength(2);
        expect(result.children[0].name).toBe('FolderA');
        expect(result.children[1].name).toBe('FolderB');
    });

    it('synthetic root has empty tasks/docs arrays', () => {
        const result = mergeTaskFoldersAsVirtualRoot([
            { folder: makeFolder('x'), label: 'X' },
        ]);
        expect(result.tasks).toEqual([]);
        expect(result.documentGroups).toEqual([]);
        expect(result.singleDocuments).toEqual([]);
    });
});

// ============================================================================
// Unit tests: resolveAllTaskRoots
// ============================================================================

describe('resolveAllTaskRoots', () => {
    it('returns primary root as first element', () => {
        const roots = resolveAllTaskRoots(
            { dataDir: '/data', rootPath: '/repo', workspaceId: 'ws-1' },
            [],
        );
        expect(roots).toHaveLength(1);
        expect(roots[0].absolutePath).toBe(path.join('/data', 'repos', 'ws-1', 'tasks'));
    });

    it('resolves absolute additional paths', () => {
        const roots = resolveAllTaskRoots(
            { dataDir: '/data', rootPath: '/repo', workspaceId: 'ws-1' },
            ['/extra/tasks'],
        );
        expect(roots).toHaveLength(2);
        expect(roots[1].absolutePath).toBe(path.resolve('/extra/tasks'));
        expect(roots[1].label).toBe('tasks');
    });

    it('resolves relative additional paths against rootPath', () => {
        const roots = resolveAllTaskRoots(
            { dataDir: '/data', rootPath: '/repo', workspaceId: 'ws-1' },
            ['my-tasks'],
        );
        expect(roots).toHaveLength(2);
        expect(roots[1].absolutePath).toBe(path.resolve('/repo', 'my-tasks'));
    });
});

// ============================================================================
// Unit tests: tasks-settings.json persistence
// ============================================================================

describe('tasks-settings persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasks-settings-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty folderPaths when file does not exist', async () => {
        const settings = await readTasksSettings(tmpDir, 'ws-missing');
        expect(settings.folderPaths).toEqual([]);
    });

    it('round-trips folderPaths', async () => {
        await writeTasksSettings(tmpDir, 'ws-test', { folderPaths: ['/a', '/b'] });
        const settings = await readTasksSettings(tmpDir, 'ws-test');
        expect(settings.folderPaths).toEqual(['/a', '/b']);
    });

    it('overwrites existing settings', async () => {
        await writeTasksSettings(tmpDir, 'ws-test', { folderPaths: ['/old'] });
        await writeTasksSettings(tmpDir, 'ws-test', { folderPaths: ['/new1', '/new2'] });
        const settings = await readTasksSettings(tmpDir, 'ws-test');
        expect(settings.folderPaths).toEqual(['/new1', '/new2']);
    });
});

// ============================================================================
// Integration tests: HTTP routes
// ============================================================================

describe('Tasks Multi-Folder HTTP API', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let wsId: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-folder-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-folder-ws-'));
        wsId = 'test-mf-' + Date.now();
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        fs.rmSync(dataDir, { recursive: true, force: true });
        fs.rmSync(workspaceDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id: wsId,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return wsId;
    }

    function createTaskFilesInDir(dir: string, files: Record<string, string>): void {
        for (const [filePath, content] of Object.entries(files)) {
            const fullPath = path.join(dir, filePath);
            fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            fs.writeFileSync(fullPath, content, 'utf-8');
        }
    }

    // ------------------------------------------------------------------
    // GET /tasks/settings includes folderPaths
    // ------------------------------------------------------------------

    it('GET /tasks/settings returns folderPaths (empty by default)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.folderPaths).toEqual([]);
    });

    it('GET /tasks/settings reflects saved folderPaths', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Write settings directly
        await writeTasksSettings(dataDir, wsId, { folderPaths: ['/some/path'] });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.folderPaths).toEqual(['/some/path']);
    });

    // ------------------------------------------------------------------
    // PATCH /tasks/settings
    // ------------------------------------------------------------------

    it('PATCH /tasks/settings saves and returns folderPaths', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // The additional path is inside the workspace
        const extraDir = path.join(workspaceDir, 'extra-tasks');
        fs.mkdirSync(extraDir, { recursive: true });

        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/settings`, {
            folderPaths: [extraDir],
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.folderPaths).toEqual([extraDir]);

        // Verify persistence
        const settings = await readTasksSettings(dataDir, wsId);
        expect(settings.folderPaths).toEqual([extraDir]);
    });

    it('PATCH /tasks/settings rejects invalid body', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/settings`, {
            folderPaths: 'not-an-array',
        });
        expect(res.status).toBe(400);
    });

    it('PATCH /tasks/settings rejects paths outside trusted dirs', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/settings`, {
            folderPaths: ['/some/untrusted/random/path'],
        });
        expect(res.status).toBe(403);
    });

    // ------------------------------------------------------------------
    // GET /tasks with multi-folder
    // ------------------------------------------------------------------

    it('GET /tasks returns virtual root when multiple folders configured', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create primary tasks
        const primaryDir = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
        createTaskFilesInDir(primaryDir, {
            'primary-task.md': '# Primary Task',
        });

        // Create additional tasks folder inside workspace
        const extraDir = path.join(workspaceDir, 'extra-tasks');
        createTaskFilesInDir(extraDir, {
            'extra-task.md': '# Extra Task',
        });

        // Configure multi-folder
        await writeTasksSettings(dataDir, wsId, { folderPaths: [extraDir] });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Should be a virtual root with 2 children
        expect(body.name).toBe('Tasks');
        expect(body.children).toHaveLength(2);

        // Each child should have task documents
        const primaryChild = body.children[0];
        const extraChild = body.children[1];
        expect(primaryChild.singleDocuments.length + primaryChild.documentGroups.length).toBeGreaterThanOrEqual(1);
        expect(extraChild.singleDocuments.length + extraChild.documentGroups.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /tasks returns single folder when only primary exists (no virtual root)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const primaryDir = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
        createTaskFilesInDir(primaryDir, {
            'task.md': '# Task',
        });

        // No folderPaths configured — single folder behavior
        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Should NOT be a virtual root
        expect(body.name).not.toBe('Tasks');
        expect(body.singleDocuments.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /tasks skips invalid additional folders gracefully', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const primaryDir = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
        createTaskFilesInDir(primaryDir, {
            'task.md': '# Task',
        });

        // Configure a non-existent additional path
        const nonExistent = path.join(workspaceDir, 'does-not-exist');
        await writeTasksSettings(dataDir, wsId, { folderPaths: [nonExistent] });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Only primary survived — single folder, no virtual root
        expect(body.name).not.toBe('Tasks');
    });

    it('GET /tasks with folder query param bypasses multi-folder', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create tasks in a workspace-relative folder
        const customDir = path.join(workspaceDir, 'custom-tasks');
        createTaskFilesInDir(customDir, {
            'custom.md': '# Custom',
        });

        // Even with folderPaths configured, ?folder= should override
        await writeTasksSettings(dataDir, wsId, { folderPaths: [customDir] });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks?folder=${encodeURIComponent(customDir)}`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Should be direct folder scan, not virtual root
        expect(body.name).not.toBe('Tasks');
    });
});

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
import { resolveTaskRoot } from '../../src/server/tasks/task-root-resolver';
import { resolveAllTaskRoots } from '../../src/server/tasks/task-root-resolver';
import { mergeTaskFoldersAsVirtualRoot, readTasksSettings, writeTasksSettings } from '../../src/server/tasks/tasks-handler-utils';

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
        expect(roots[1].label).toBe(path.join('extra', 'tasks'));
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
        expect(settings.persisted).toBe(false);
    });

    it('round-trips folderPaths', async () => {
        await writeTasksSettings(tmpDir, 'ws-test', { folderPaths: ['/a', '/b'] });
        const settings = await readTasksSettings(tmpDir, 'ws-test');
        expect(settings.folderPaths).toEqual(['/a', '/b']);
        expect(settings.persisted).toBe(true);
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
        expect(body.hasDefaultFolderPaths).toBe(false);
    });

    it('GET /tasks/settings injects .vscode/tasks when dir exists and no settings file', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create .vscode/tasks directory in the workspace
        fs.mkdirSync(path.join(workspaceDir, '.vscode', 'tasks'), { recursive: true });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.folderPaths).toEqual(['.vscode/tasks']);
        expect(body.hasDefaultFolderPaths).toBe(true);
    });

    it('GET /tasks/settings does not inject default after explicit empty save', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create .vscode/tasks directory in the workspace
        fs.mkdirSync(path.join(workspaceDir, '.vscode', 'tasks'), { recursive: true });

        // Explicitly save empty list
        await writeTasksSettings(dataDir, wsId, { folderPaths: [] });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.folderPaths).toEqual([]);
        expect(body.hasDefaultFolderPaths).toBe(false);
    });

    it('GET /tasks/settings does not inject default when custom paths saved', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create .vscode/tasks directory in the workspace
        fs.mkdirSync(path.join(workspaceDir, '.vscode', 'tasks'), { recursive: true });

        // Save custom paths
        await writeTasksSettings(dataDir, wsId, { folderPaths: ['/some/path'] });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/tasks/settings`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.folderPaths).toEqual(['/some/path']);
        expect(body.hasDefaultFolderPaths).toBe(false);
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

    it('GET /summary returns virtual root tasks when multiple folders configured', async () => {
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

        const res = await request(`${srv.url}/api/workspaces/${wsId}/summary`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Should be a virtual root with 2 children
        expect(body.tasks.name).toBe('Tasks');
        expect(body.tasks.children).toHaveLength(2);

        // Each child should have task documents
        const primaryChild = body.tasks.children[0];
        const extraChild = body.tasks.children[1];
        expect(primaryChild.singleDocuments.length + primaryChild.documentGroups.length).toBeGreaterThanOrEqual(1);
        expect(extraChild.singleDocuments.length + extraChild.documentGroups.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /summary returns single folder tasks when only primary exists (no virtual root)', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const primaryDir = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
        createTaskFilesInDir(primaryDir, {
            'task.md': '# Task',
        });

        // No folderPaths configured — single folder behavior
        const res = await request(`${srv.url}/api/workspaces/${wsId}/summary`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Should NOT be a virtual root
        expect(body.tasks.name).not.toBe('Tasks');
        expect(body.tasks.singleDocuments.length).toBeGreaterThanOrEqual(1);
    });

    it('GET /summary skips invalid additional folders gracefully', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        const primaryDir = resolveTaskRoot({ dataDir, rootPath: workspaceDir, workspaceId: wsId }).absolutePath;
        createTaskFilesInDir(primaryDir, {
            'task.md': '# Task',
        });

        // Configure a non-existent additional path
        const nonExistent = path.join(workspaceDir, 'does-not-exist');
        await writeTasksSettings(dataDir, wsId, { folderPaths: [nonExistent] });

        const res = await request(`${srv.url}/api/workspaces/${wsId}/summary`);
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);

        // Only primary survived — single folder, no virtual root
        expect(body.tasks.name).not.toBe('Tasks');
    });

    // ------------------------------------------------------------------
    // PATCH /tasks/content with multi-folder
    // ------------------------------------------------------------------

    it('PATCH /tasks/content writes to a file in an additional folder via folderPath', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create additional tasks folder with a file
        const extraDir = path.join(workspaceDir, 'extra-tasks');
        createTaskFilesInDir(extraDir, {
            'plan.md': '# Original',
        });

        // Configure multi-folder
        await writeTasksSettings(dataDir, wsId, { folderPaths: [extraDir] });

        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'plan.md',
            content: '# Updated via folderPath',
            folderPath: extraDir,
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.updated).toBe(true);

        // Verify file was actually written
        const written = fs.readFileSync(path.join(extraDir, 'plan.md'), 'utf-8');
        expect(written).toBe('# Updated via folderPath');
    });

    it('PATCH /tasks/content resolves file in additional folder without folderPath hint', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create additional tasks folder with a file
        const extraDir = path.join(workspaceDir, 'extra-tasks');
        createTaskFilesInDir(extraDir, {
            'extra-plan.md': '# Extra Original',
        });

        // Configure multi-folder
        await writeTasksSettings(dataDir, wsId, { folderPaths: [extraDir] });

        // Write without folderPath — server should find the file across all roots
        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'extra-plan.md',
            content: '# Updated without folderPath',
        });
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.updated).toBe(true);

        const written = fs.readFileSync(path.join(extraDir, 'extra-plan.md'), 'utf-8');
        expect(written).toBe('# Updated without folderPath');
    });

    it('PATCH /tasks/content rejects folderPath that is not a configured task root', async () => {
        const srv = await startServer();
        await registerWorkspace(srv, workspaceDir);

        // Create a directory with a file but don't configure it as a task root
        const unconfigured = path.join(workspaceDir, 'unconfigured');
        createTaskFilesInDir(unconfigured, {
            'plan.md': '# Content',
        });

        const res = await patchJSON(`${srv.url}/api/workspaces/${wsId}/tasks/content`, {
            path: 'plan.md',
            content: '# Hacked',
            folderPath: unconfigured,
        });
        // Should fall through to primary root check, then additional roots, then workspace fallback
        // Since the file doesn't exist in any of those, it should fail
        expect(res.status).not.toBe(200);
    });

});

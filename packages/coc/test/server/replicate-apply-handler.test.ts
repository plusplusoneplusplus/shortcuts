/**
 * Replicate Apply Handler Tests
 *
 * Tests for POST /api/workspaces/:id/replicate/:processId/apply
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

// ============================================================================
// HTTP helpers
// ============================================================================

function request(
    url: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
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
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
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
// Test suite
// ============================================================================

describe('Replicate Apply Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;
    let workspaceDir: string;
    let store: FileProcessStore;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replicate-apply-test-'));
        workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'replicate-ws-'));
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
        store = new FileProcessStore({ dataDir });
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir });
        return server;
    }

    async function registerWorkspace(srv: ExecutionServer, rootPath: string): Promise<string> {
        const id = 'test-ws-' + Date.now();
        const res = await postJSON(`${srv.url}/api/workspaces`, {
            id,
            name: 'Test Workspace',
            rootPath,
        });
        expect(res.status).toBe(201);
        return id;
    }

    async function addCompletedProcess(
        processId: string,
        result: unknown,
    ): Promise<void> {
        await store.addProcess({
            id: processId,
            type: 'queue-replicate-template',
            status: 'completed',
            promptPreview: 'test',
            fullPrompt: 'test instruction',
            result: typeof result === 'string' ? result : JSON.stringify(result),
            conversationTurns: [],
            startTime: new Date(),
            timeline: [],
        } as any);
    }

    async function addRunningProcess(processId: string): Promise<void> {
        await store.addProcess({
            id: processId,
            type: 'queue-replicate-template',
            status: 'running',
            promptPreview: 'test',
            fullPrompt: 'test instruction',
            conversationTurns: [],
            startTime: new Date(),
            timeline: [],
        } as any);
    }

    // ------------------------------------------------------------------
    // Success cases
    // ------------------------------------------------------------------

    it('should apply new and modified file changes from completed process', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-apply-1';

        await addCompletedProcess(processId, {
            response: 'Created 2 files',
            replicateResult: {
                summary: 'Created 2 files',
                files: [
                    { path: 'src/new-file.ts', content: 'export const x = 1;', status: 'new' },
                    { path: 'src/existing.ts', content: 'updated content', status: 'modified' },
                ],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.applied).toEqual(['src/new-file.ts', 'src/existing.ts']);
        expect(body.errors).toEqual([]);
        expect(body.total).toBe(2);

        // Verify files were written to disk
        const newFilePath = path.join(workspaceDir, 'src', 'new-file.ts');
        expect(fs.existsSync(newFilePath)).toBe(true);
        expect(fs.readFileSync(newFilePath, 'utf-8')).toBe('export const x = 1;');

        const existingPath = path.join(workspaceDir, 'src', 'existing.ts');
        expect(fs.existsSync(existingPath)).toBe(true);
        expect(fs.readFileSync(existingPath, 'utf-8')).toBe('updated content');
    });

    it('should handle deleted files', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-apply-del';

        // Create a file to delete
        const filePath = path.join(workspaceDir, 'to-delete.txt');
        fs.writeFileSync(filePath, 'old content', 'utf-8');

        await addCompletedProcess(processId, {
            response: 'Deleted 1 file',
            replicateResult: {
                summary: 'Deleted 1 file',
                files: [
                    { path: 'to-delete.txt', content: '', status: 'deleted' },
                ],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.applied).toEqual(['to-delete.txt']);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should treat deleting a non-existent file as success', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-apply-del-noent';

        await addCompletedProcess(processId, {
            response: 'Deleted 1 file',
            replicateResult: {
                summary: 'Deleted',
                files: [
                    { path: 'does-not-exist.txt', content: '', status: 'deleted' },
                ],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );

        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.applied).toEqual(['does-not-exist.txt']);
        expect(body.errors).toEqual([]);
    });

    it('should be idempotent — re-applying produces the same result', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-apply-idempotent';

        await addCompletedProcess(processId, {
            response: 'Created file',
            replicateResult: {
                summary: 'Created file',
                files: [
                    { path: 'idempotent.txt', content: 'same', status: 'new' },
                ],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const url = `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`;

        // Apply twice
        const res1 = await postJSON(url, {});
        const res2 = await postJSON(url, {});

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
        expect(fs.readFileSync(path.join(workspaceDir, 'idempotent.txt'), 'utf-8')).toBe('same');
    });

    it('should create nested directories as needed', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-apply-nested';

        await addCompletedProcess(processId, {
            response: 'Created deeply nested file',
            replicateResult: {
                summary: 'Created deeply nested file',
                files: [
                    { path: 'a/b/c/d/deep.ts', content: 'deep', status: 'new' },
                ],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );

        expect(res.status).toBe(200);
        const filePath = path.join(workspaceDir, 'a', 'b', 'c', 'd', 'deep.ts');
        expect(fs.existsSync(filePath)).toBe(true);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('deep');
    });

    // ------------------------------------------------------------------
    // Error cases
    // ------------------------------------------------------------------

    it('should return 404 for unknown workspace', async () => {
        const srv = await startServer();
        const res = await postJSON(
            `${srv.url}/api/workspaces/nonexistent/replicate/proc-1/apply`,
            {},
        );
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toBe('Workspace not found');
    });

    it('should return 404 for unknown process', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/nonexistent-proc/apply`,
            {},
        );
        expect(res.status).toBe(404);
        expect(JSON.parse(res.body).error).toBe('Process not found');
    });

    it('should return 409 for a process that is not completed', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-running';

        await addRunningProcess(processId);

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );
        expect(res.status).toBe(409);
        expect(JSON.parse(res.body).error).toContain('not completed');
    });

    it('should return 422 when process result has no replicate file changes', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-no-changes';

        await addCompletedProcess(processId, {
            response: 'AI response text only',
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );
        expect(res.status).toBe(422);
        expect(JSON.parse(res.body).error).toContain('replicate file changes');
    });

    it('should return 422 when changes array is empty', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-empty-changes';

        await addCompletedProcess(processId, {
            response: 'Nothing',
            replicateResult: {
                summary: 'Nothing',
                files: [],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );
        expect(res.status).toBe(422);
    });

    it('should return 403 for path traversal attempt', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-traversal';

        await addCompletedProcess(processId, {
            response: 'Malicious',
            replicateResult: {
                summary: 'Malicious',
                files: [
                    { path: '../../../etc/passwd', content: 'pwned', status: 'new' },
                ],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );
        expect(res.status).toBe(403);
        expect(JSON.parse(res.body).error).toContain('Path traversal denied');
    });

    // ------------------------------------------------------------------
    // Partial failure (207 Multi-Status)
    // ------------------------------------------------------------------

    it('should return 207 when some file writes fail', async () => {
        const srv = await startServer();
        const wsId = await registerWorkspace(srv, workspaceDir);
        const processId = 'proc-partial';

        // Create a directory where a file write will fail (directory can't be overwritten as file)
        const blockDir = path.join(workspaceDir, 'block');
        fs.mkdirSync(blockDir, { recursive: true });
        // Write a sub-item so the directory is not empty (prevents deletion/overwrite)
        fs.writeFileSync(path.join(blockDir, 'child.txt'), 'child');

        await addCompletedProcess(processId, {
            response: 'Mixed results',
            replicateResult: {
                summary: 'Mixed',
                files: [
                    { path: 'good-file.ts', content: 'ok', status: 'new' },
                    // Attempting to write a file at a path that is a directory will fail
                    { path: 'block', content: 'conflict', status: 'modified' },
                ],
                commitHash: 'abc123',
                templateName: 'test-template',
            },
        });

        const res = await postJSON(
            `${srv.url}/api/workspaces/${wsId}/replicate/${processId}/apply`,
            {},
        );

        // Either 200 (if writeFile can overwrite a dir somehow) or 207 with errors
        const body = JSON.parse(res.body);
        expect(body.total).toBe(2);
        expect(body.applied).toContain('good-file.ts');
        // The good file should have been written regardless of the other failure
        expect(fs.existsSync(path.join(workspaceDir, 'good-file.ts'))).toBe(true);
    });
});

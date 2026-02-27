/**
 * API Handler Tests
 *
 * Comprehensive tests for the Process REST API endpoints:
 * workspace registration, process CRUD, filtering, pagination,
 * cancel, bulk delete, stats, and helper functions.
 *
 * Uses port 0 (OS-assigned) for test isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as childProcess from 'child_process';
import { createExecutionServer } from '../../src/server/index';
import { sendJSON, sendError, parseQueryParams, stripExcludedFields } from '@plusplusoneplusplus/coc-server';
import { FileProcessStore } from '@plusplusoneplusplus/pipeline-core';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createMockSDKService } from '../helpers/mock-sdk-service';

// ============================================================================
// Helpers
// ============================================================================

/** Make an HTTP request and return status, headers, and body. */
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
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

/** POST JSON helper. */
function postJSON(url: string, data: unknown) {
    return request(url, {
        method: 'POST',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** PATCH JSON helper. */
function patchJSON(url: string, data: unknown) {
    return request(url, {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: { 'Content-Type': 'application/json' },
    });
}

/** Create a minimal process body for POST /api/processes. */
function makeProcess(overrides: Record<string, any> = {}) {
    return {
        id: `proc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        promptPreview: 'Test prompt',
        fullPrompt: 'Full test prompt text',
        status: 'running',
        startTime: new Date().toISOString(),
        type: 'clarification',
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('API Handler', () => {
    let server: ExecutionServer | undefined;
    let dataDir: string;

    beforeEach(() => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-handler-test-'));
    });

    afterEach(async () => {
        if (server) {
            await server.close();
            server = undefined;
        }
        // Clean up temp data dir
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    async function startServer(): Promise<ExecutionServer> {
        const store = new FileProcessStore({ dataDir });
        const { service: mockAiService } = createMockSDKService();
        server = await createExecutionServer({ port: 0, host: 'localhost', store, dataDir, aiService: mockAiService as any });
        return server;
    }

    // ========================================================================
    // sendJSON / sendError helpers
    // ========================================================================

    describe('sendJSON / sendError helpers', () => {
        it('should send JSON with correct status code and Content-Type', async () => {
            const srv = await startServer();
            // The server already has routes; test via an actual endpoint
            const res = await request(`${srv.url}/api/workspaces`);
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toContain('application/json');
        });

        it('should send error envelope with correct shape', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/nonexistent-id-12345`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body).toHaveProperty('error');
            expect(body.error).toBe('Process not found');
        });
    });

    // ========================================================================
    // parseQueryParams
    // ========================================================================

    describe('parseQueryParams', () => {
        it('should parse workspace param', () => {
            const filter = parseQueryParams('/api/processes?workspace=ws-1');
            expect(filter.workspaceId).toBe('ws-1');
        });

        it('should parse comma-separated status', () => {
            const filter = parseQueryParams('/api/processes?status=running,completed');
            expect(filter.status).toEqual(['running', 'completed']);
        });

        it('should ignore invalid status values', () => {
            const filter = parseQueryParams('/api/processes?status=running,invalid,failed');
            expect(filter.status).toEqual(['running', 'failed']);
        });

        it('should parse type param', () => {
            const filter = parseQueryParams('/api/processes?type=code-review');
            expect(filter.type).toBe('code-review');
        });

        it('should parse since as ISO date', () => {
            const iso = '2026-01-01T00:00:00.000Z';
            const filter = parseQueryParams(`/api/processes?since=${iso}`);
            expect(filter.since).toEqual(new Date(iso));
        });

        it('should ignore invalid since dates', () => {
            const filter = parseQueryParams('/api/processes?since=not-a-date');
            expect(filter.since).toBeUndefined();
        });

        it('should parse limit and offset', () => {
            const filter = parseQueryParams('/api/processes?limit=10&offset=20');
            expect(filter.limit).toBe(10);
            expect(filter.offset).toBe(20);
        });

        it('should return empty filter for no params', () => {
            const filter = parseQueryParams('/api/processes');
            expect(filter).toEqual({});
        });

        it('should ignore empty string values', () => {
            const filter = parseQueryParams('/api/processes?workspace=&status=');
            expect(filter.workspaceId).toBeUndefined();
            expect(filter.status).toBeUndefined();
        });

        it('should parse exclude=conversation param', () => {
            const filter = parseQueryParams('/api/processes?exclude=conversation');
            expect(filter.exclude).toEqual(['conversation']);
        });

        it('should ignore invalid exclude values', () => {
            const filter = parseQueryParams('/api/processes?exclude=invalid');
            expect(filter.exclude).toBeUndefined();
        });

        it('should parse exclude=toolCalls param', () => {
            const filter = parseQueryParams('/api/processes?exclude=toolCalls');
            expect(filter.exclude).toEqual(['toolCalls']);
        });

        it('should parse comma-separated exclude values', () => {
            const filter = parseQueryParams('/api/processes?exclude=conversation,invalid');
            expect(filter.exclude).toEqual(['conversation']);
        });

        it('should parse conversation and toolCalls together', () => {
            const filter = parseQueryParams('/api/processes?exclude=conversation,toolCalls');
            expect(filter.exclude).toEqual(['conversation', 'toolCalls']);
        });

        it('should not set exclude for empty string', () => {
            const filter = parseQueryParams('/api/processes?exclude=');
            expect(filter.exclude).toBeUndefined();
        });
    });

    // ========================================================================
    // stripExcludedFields
    // ========================================================================

    describe('stripExcludedFields', () => {
        it('should return process unchanged when exclude is undefined', () => {
            const process = { id: 'p1', conversationTurns: [{ role: 'user' }], fullPrompt: 'test' };
            const result = stripExcludedFields(process, undefined);
            expect(result).toBe(process);
        });

        it('should return process unchanged when exclude is empty', () => {
            const process = { id: 'p1', conversationTurns: [{ role: 'user' }] };
            const result = stripExcludedFields(process, []);
            expect(result).toBe(process);
        });

        it('should strip conversation fields when exclude includes conversation', () => {
            const process = {
                id: 'p1',
                promptPreview: 'Test prompt',
                fullPrompt: 'Full test prompt',
                status: 'completed',
                conversationTurns: [{ role: 'user', content: 'hello' }],
                result: 'Big result data',
                structuredResult: '{"key":"value"}',
                startTime: '2026-01-01T00:00:00Z',
                type: 'clarification',
            };
            const result = stripExcludedFields(process, ['conversation']);
            expect(result.id).toBe('p1');
            expect(result.promptPreview).toBe('Test prompt');
            expect(result.status).toBe('completed');
            expect(result.startTime).toBe('2026-01-01T00:00:00Z');
            expect(result.type).toBe('clarification');
            expect(result.conversationTurns).toBeUndefined();
            expect(result.fullPrompt).toBeUndefined();
            expect(result.result).toBeUndefined();
            expect(result.structuredResult).toBeUndefined();
        });

        it('should not strip fields for non-conversation exclude values', () => {
            const process = {
                id: 'p1',
                conversationTurns: [{ role: 'user' }],
                fullPrompt: 'Full prompt',
            };
            const result = stripExcludedFields(process, ['other']);
            expect(result).toBe(process);
        });

        it('should strip toolCalls from conversation turns when exclude includes toolCalls', () => {
            const process = {
                id: 'p1',
                conversationTurns: [
                    {
                        role: 'assistant',
                        content: 'Checking...',
                        turnIndex: 0,
                        toolCalls: [{ id: 'call_1', name: 'view', parameters: {}, result: 'ok', status: 'completed' }],
                        timeline: [],
                    },
                    { role: 'user', content: 'Thanks', turnIndex: 1, timeline: [] },
                ],
                fullPrompt: 'Full prompt',
            };
            const result = stripExcludedFields(process, ['toolCalls']);
            expect(result.conversationTurns).toHaveLength(2);
            expect(result.conversationTurns[0].toolCalls).toBeUndefined();
            expect(result.conversationTurns[0].content).toBe('Checking...');
            expect(result.conversationTurns[1].content).toBe('Thanks');
            expect(result.fullPrompt).toBe('Full prompt');
        });

        it('should return process unchanged when exclude=toolCalls but no conversationTurns', () => {
            const process = { id: 'p1', fullPrompt: 'test' };
            const result = stripExcludedFields(process, ['toolCalls']);
            expect(result).toEqual(process);
        });

        it('should give conversation precedence over toolCalls when both excluded', () => {
            const process = {
                id: 'p1',
                conversationTurns: [{ role: 'assistant', toolCalls: [{ id: 'c1' }] }],
                fullPrompt: 'prompt',
                result: 'res',
                structuredResult: '{}',
            };
            const result = stripExcludedFields(process, ['conversation', 'toolCalls']);
            expect(result.conversationTurns).toBeUndefined();
            expect(result.fullPrompt).toBeUndefined();
        });
    });

    // ========================================================================
    // Workspace endpoints
    // ========================================================================

    describe('Workspace endpoints', () => {
        it('should register a workspace and list it', async () => {
            const srv = await startServer();

            // POST workspace
            const createRes = await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-1',
                name: 'frontend',
                rootPath: '/home/user/frontend',
                color: '#ff0000',
            });
            expect(createRes.status).toBe(201);
            const created = JSON.parse(createRes.body);
            expect(created.id).toBe('ws-1');
            expect(created.name).toBe('frontend');
            expect(created.color).toBe('#ff0000');

            // GET workspaces
            const listRes = await request(`${srv.url}/api/workspaces`);
            expect(listRes.status).toBe(200);
            const listed = JSON.parse(listRes.body);
            expect(listed.workspaces).toHaveLength(1);
            expect(listed.workspaces[0].id).toBe('ws-1');
        });

        it('should return 400 when required fields are missing', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-1' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Missing required fields');
        });

        it('should return 400 on invalid JSON', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/workspaces`, {
                method: 'POST',
                body: 'not json',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });

        it('should delete a workspace', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-del', name: 'to-delete', rootPath: '/tmp/del',
            });

            const delRes = await request(`${srv.url}/api/workspaces/ws-del`, { method: 'DELETE' });
            expect(delRes.status).toBe(204);

            const listRes = await request(`${srv.url}/api/workspaces`);
            const listed = JSON.parse(listRes.body);
            expect(listed.workspaces.find((w: any) => w.id === 'ws-del')).toBeUndefined();
        });

        it('should return 404 when deleting non-existent workspace', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/no-such-ws`, { method: 'DELETE' });
            expect(res.status).toBe(404);
        });

        it('should patch workspace fields', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-patch', name: 'old-name', rootPath: '/tmp/patch', color: '#000',
            });

            const patchRes = await patchJSON(`${srv.url}/api/workspaces/ws-patch`, {
                name: 'new-name', color: '#fff',
            });
            expect(patchRes.status).toBe(200);
            const body = JSON.parse(patchRes.body);
            expect(body.workspace.name).toBe('new-name');
            expect(body.workspace.color).toBe('#fff');
            expect(body.workspace.rootPath).toBe('/tmp/patch');
        });

        it('should return 404 when patching non-existent workspace', async () => {
            const srv = await startServer();
            const res = await patchJSON(`${srv.url}/api/workspaces/nope`, { name: 'x' });
            expect(res.status).toBe(404);
        });

        it('should return git-info for a workspace with git repo', async () => {
            const srv = await startServer();
            // Use the project root itself as a real git repo
            const repoPath = path.resolve(__dirname, '..', '..', '..', '..');
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-git', name: 'git-test', rootPath: repoPath,
            });

            const res = await request(`${srv.url}/api/workspaces/ws-git/git-info`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.isGitRepo).toBe(true);
            expect(typeof body.branch).toBe('string');
            expect(body.branch.length).toBeGreaterThan(0);
        });

        it('should return isGitRepo false for non-git directory', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-nogit', name: 'no-git', rootPath: os.tmpdir(),
            });

            const res = await request(`${srv.url}/api/workspaces/ws-nogit/git-info`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.isGitRepo).toBe(false);
        });

        it('should return 404 for git-info of non-existent workspace', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/workspaces/nonexistent/git-info`);
            expect(res.status).toBe(404);
        });

        it('should auto-detect remoteUrl during workspace registration for git repos', async () => {
            const srv = await startServer();
            const repoPath = path.resolve(__dirname, '..', '..', '..', '..');
            const createRes = await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-remote', name: 'remote-test', rootPath: repoPath,
            });
            expect(createRes.status).toBe(201);
            const body = JSON.parse(createRes.body);
            // The project root is a git repo with a remote
            expect(body.remoteUrl).toBeDefined();
            expect(typeof body.remoteUrl).toBe('string');
            expect(body.remoteUrl!.length).toBeGreaterThan(0);
        });

        it('should use provided remoteUrl over auto-detected one', async () => {
            const srv = await startServer();
            const repoPath = path.resolve(__dirname, '..', '..', '..', '..');
            const createRes = await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-explicit-remote', name: 'explicit-remote', rootPath: repoPath,
                remoteUrl: 'https://github.com/custom/repo.git',
            });
            expect(createRes.status).toBe(201);
            const body = JSON.parse(createRes.body);
            expect(body.remoteUrl).toBe('https://github.com/custom/repo.git');
        });

        it('should not set remoteUrl for non-git directories', async () => {
            const srv = await startServer();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-no-remote', name: 'no-remote', rootPath: tmpDir,
            });
            const listRes = await request(`${srv.url}/api/workspaces`);
            const workspaces = JSON.parse(listRes.body).workspaces;
            const ws = workspaces.find((w: any) => w.id === 'ws-no-remote');
            expect(ws.remoteUrl).toBeUndefined();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should include remoteUrl in git-info response', async () => {
            const srv = await startServer();
            const repoPath = path.resolve(__dirname, '..', '..', '..', '..');
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-gitinfo-remote', name: 'gitinfo-remote', rootPath: repoPath,
            });
            const res = await request(`${srv.url}/api/workspaces/ws-gitinfo-remote/git-info`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.isGitRepo).toBe(true);
            expect(body).toHaveProperty('remoteUrl');
            expect(typeof body.remoteUrl).toBe('string');
        });

        it('should return null remoteUrl in git-info for non-git dirs', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-no-gitinfo-remote', name: 'no-gitinfo-remote', rootPath: os.tmpdir(),
            });
            const res = await request(`${srv.url}/api/workspaces/ws-no-gitinfo-remote/git-info`);
            const body = JSON.parse(res.body);
            expect(body.isGitRepo).toBe(false);
            expect(body.remoteUrl).toBeNull();
        });

        it('should allow updating remoteUrl via PATCH', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-patch-remote', name: 'patch-remote', rootPath: '/tmp/patch-remote',
            });
            const patchRes = await patchJSON(`${srv.url}/api/workspaces/ws-patch-remote`, {
                remoteUrl: 'https://github.com/patched/repo.git',
            });
            expect(patchRes.status).toBe(200);
            const body = JSON.parse(patchRes.body);
            expect(body.workspace.remoteUrl).toBe('https://github.com/patched/repo.git');
        });

        // ================================================================
        // git-info ahead/behind
        // ================================================================

        it('should return ahead=0 and behind=0 when branch is in sync', async () => {
            const srv = await startServer();
            const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-'));
            const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-'));
            try {
                childProcess.execSync('git init --bare', { cwd: bareDir });
                childProcess.execSync(`git clone "${bareDir}" repo`, { cwd: cloneDir });
                const repoDir = path.join(cloneDir, 'repo');
                childProcess.execSync('git config user.email "test@test.com"', { cwd: repoDir });
                childProcess.execSync('git config user.name "Test"', { cwd: repoDir });
                fs.writeFileSync(path.join(repoDir, 'file.txt'), 'init');
                childProcess.execSync('git add . && git commit -m "init"', { cwd: repoDir });
                childProcess.execSync('git push origin HEAD', { cwd: repoDir });

                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-sync', name: 'sync', rootPath: repoDir });
                const res = await request(`${srv.url}/api/workspaces/ws-sync/git-info`);
                const body = JSON.parse(res.body);
                expect(body.isGitRepo).toBe(true);
                expect(body.ahead).toBe(0);
                expect(body.behind).toBe(0);
            } finally {
                fs.rmSync(bareDir, { recursive: true, force: true });
                fs.rmSync(cloneDir, { recursive: true, force: true });
            }
        });

        it('should return ahead=1 for unpushed commit', async () => {
            const srv = await startServer();
            const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-'));
            const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-'));
            try {
                childProcess.execSync('git init --bare', { cwd: bareDir });
                childProcess.execSync(`git clone "${bareDir}" repo`, { cwd: cloneDir });
                const repoDir = path.join(cloneDir, 'repo');
                childProcess.execSync('git config user.email "test@test.com"', { cwd: repoDir });
                childProcess.execSync('git config user.name "Test"', { cwd: repoDir });
                fs.writeFileSync(path.join(repoDir, 'file.txt'), 'init');
                childProcess.execSync('git add . && git commit -m "init"', { cwd: repoDir });
                childProcess.execSync('git push origin HEAD', { cwd: repoDir });

                // Make one more commit locally without pushing
                fs.writeFileSync(path.join(repoDir, 'file2.txt'), 'local');
                childProcess.execSync('git add . && git commit -m "local"', { cwd: repoDir });

                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-ahead', name: 'ahead', rootPath: repoDir });
                const res = await request(`${srv.url}/api/workspaces/ws-ahead/git-info`);
                const body = JSON.parse(res.body);
                expect(body.ahead).toBe(1);
                expect(body.behind).toBe(0);
            } finally {
                fs.rmSync(bareDir, { recursive: true, force: true });
                fs.rmSync(cloneDir, { recursive: true, force: true });
            }
        });

        it('should return behind=1 for commits on origin not yet merged', async () => {
            const srv = await startServer();
            const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-'));
            const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-'));
            const pusherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pusher-'));
            try {
                childProcess.execSync('git init --bare', { cwd: bareDir });
                childProcess.execSync(`git clone "${bareDir}" repo`, { cwd: cloneDir });
                const repoDir = path.join(cloneDir, 'repo');
                childProcess.execSync('git config user.email "test@test.com"', { cwd: repoDir });
                childProcess.execSync('git config user.name "Test"', { cwd: repoDir });
                fs.writeFileSync(path.join(repoDir, 'file.txt'), 'init');
                childProcess.execSync('git add . && git commit -m "init"', { cwd: repoDir });
                childProcess.execSync('git push origin HEAD', { cwd: repoDir });

                // Simulate a teammate pushing a commit via a second clone
                childProcess.execSync(`git clone "${bareDir}" repo`, { cwd: pusherDir });
                const pusherRepo = path.join(pusherDir, 'repo');
                childProcess.execSync('git config user.email "other@test.com"', { cwd: pusherRepo });
                childProcess.execSync('git config user.name "Other"', { cwd: pusherRepo });
                fs.writeFileSync(path.join(pusherRepo, 'remote.txt'), 'remote');
                childProcess.execSync('git add . && git commit -m "remote" && git push origin HEAD', { cwd: pusherRepo });

                // Fetch in original clone so tracking ref is updated
                childProcess.execSync('git fetch', { cwd: repoDir });

                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-behind', name: 'behind', rootPath: repoDir });
                const res = await request(`${srv.url}/api/workspaces/ws-behind/git-info`);
                const body = JSON.parse(res.body);
                expect(body.ahead).toBe(0);
                expect(body.behind).toBe(1);
            } finally {
                fs.rmSync(bareDir, { recursive: true, force: true });
                fs.rmSync(cloneDir, { recursive: true, force: true });
                fs.rmSync(pusherDir, { recursive: true, force: true });
            }
        });

        it('should return ahead=0 and behind=0 when no upstream is configured', async () => {
            const srv = await startServer();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-upstream-'));
            try {
                childProcess.execSync('git init', { cwd: tmpDir });
                childProcess.execSync('git config user.email "test@test.com"', { cwd: tmpDir });
                childProcess.execSync('git config user.name "Test"', { cwd: tmpDir });
                fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'init');
                childProcess.execSync('git add . && git commit -m "init"', { cwd: tmpDir });

                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-no-upstream', name: 'no-upstream', rootPath: tmpDir });
                const res = await request(`${srv.url}/api/workspaces/ws-no-upstream/git-info`);
                const body = JSON.parse(res.body);
                expect(body.isGitRepo).toBe(true);
                expect(body.ahead).toBe(0);
                expect(body.behind).toBe(0);
            } finally {
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        });

        it('should return ahead=1 and behind=1 when diverged', async () => {
            const srv = await startServer();
            const bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-'));
            const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clone-'));
            const pusherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pusher-'));
            try {
                childProcess.execSync('git init --bare', { cwd: bareDir });
                childProcess.execSync(`git clone "${bareDir}" repo`, { cwd: cloneDir });
                const repoDir = path.join(cloneDir, 'repo');
                childProcess.execSync('git config user.email "test@test.com"', { cwd: repoDir });
                childProcess.execSync('git config user.name "Test"', { cwd: repoDir });
                fs.writeFileSync(path.join(repoDir, 'file.txt'), 'init');
                childProcess.execSync('git add . && git commit -m "init"', { cwd: repoDir });
                childProcess.execSync('git push origin HEAD', { cwd: repoDir });

                // Teammate pushes a commit
                childProcess.execSync(`git clone "${bareDir}" repo`, { cwd: pusherDir });
                const pusherRepo = path.join(pusherDir, 'repo');
                childProcess.execSync('git config user.email "other@test.com"', { cwd: pusherRepo });
                childProcess.execSync('git config user.name "Other"', { cwd: pusherRepo });
                fs.writeFileSync(path.join(pusherRepo, 'remote.txt'), 'remote');
                childProcess.execSync('git add . && git commit -m "remote" && git push origin HEAD', { cwd: pusherRepo });

                // Local commit + fetch (no merge)
                fs.writeFileSync(path.join(repoDir, 'local.txt'), 'local');
                childProcess.execSync('git add . && git commit -m "local"', { cwd: repoDir });
                childProcess.execSync('git fetch', { cwd: repoDir });

                await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-diverged', name: 'diverged', rootPath: repoDir });
                const res = await request(`${srv.url}/api/workspaces/ws-diverged/git-info`);
                const body = JSON.parse(res.body);
                expect(body.ahead).toBe(1);
                expect(body.behind).toBe(1);
            } finally {
                fs.rmSync(bareDir, { recursive: true, force: true });
                fs.rmSync(cloneDir, { recursive: true, force: true });
                fs.rmSync(pusherDir, { recursive: true, force: true });
            }
        });

        it('should discover pipelines in a workspace', async () => {
            const srv = await startServer();
            // Create a fake pipeline directory structure
            const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-pipeline-'));
            const pipelinesDir = path.join(wsRoot, '.vscode', 'pipelines', 'test-pipeline');
            fs.mkdirSync(pipelinesDir, { recursive: true });
            fs.writeFileSync(path.join(pipelinesDir, 'pipeline.yaml'), 'name: test');

            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-pipe', name: 'pipe-test', rootPath: wsRoot,
            });

            const res = await request(`${srv.url}/api/workspaces/ws-pipe/pipelines`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.pipelines).toHaveLength(1);
            expect(body.pipelines[0].name).toBe('test-pipeline');

            fs.rmSync(wsRoot, { recursive: true, force: true });
        });

        it('should return empty array when no pipelines folder exists', async () => {
            const srv = await startServer();
            const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-nopipe-'));
            await postJSON(`${srv.url}/api/workspaces`, {
                id: 'ws-nopipe', name: 'no-pipe', rootPath: wsRoot,
            });

            const res = await request(`${srv.url}/api/workspaces/ws-nopipe/pipelines`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.pipelines).toEqual([]);

            fs.rmSync(wsRoot, { recursive: true, force: true });
        });
    });

    // ========================================================================
    // Process CRUD lifecycle
    // ========================================================================

    describe('Process CRUD lifecycle', () => {
        it('should create, get, update, list, and delete a process', async () => {
            const srv = await startServer();

            // Create
            const proc = makeProcess({ id: 'p-lifecycle' });
            const createRes = await postJSON(`${srv.url}/api/processes`, proc);
            expect(createRes.status).toBe(201);
            const created = JSON.parse(createRes.body);
            expect(created.id).toBe('p-lifecycle');

            // Get by ID
            const getRes = await request(`${srv.url}/api/processes/p-lifecycle`);
            expect(getRes.status).toBe(200);
            const fetched = JSON.parse(getRes.body);
            expect(fetched.process.id).toBe('p-lifecycle');

            // Update via PATCH
            const patchRes = await patchJSON(`${srv.url}/api/processes/p-lifecycle`, {
                status: 'completed',
                result: 'Done!',
                endTime: new Date().toISOString(),
            });
            expect(patchRes.status).toBe(200);
            const updated = JSON.parse(patchRes.body);
            expect(updated.process.status).toBe('completed');
            expect(updated.process.result).toBe('Done!');

            // List all
            const listRes = await request(`${srv.url}/api/processes`);
            expect(listRes.status).toBe(200);
            const listed = JSON.parse(listRes.body);
            expect(listed.processes.length).toBeGreaterThanOrEqual(1);

            // Delete
            const delRes = await request(`${srv.url}/api/processes/p-lifecycle`, { method: 'DELETE' });
            expect(delRes.status).toBe(204);

            // Verify 404 on re-fetch
            const reGetRes = await request(`${srv.url}/api/processes/p-lifecycle`);
            expect(reGetRes.status).toBe(404);
        });
    });

    // ========================================================================
    // Workspace filtering
    // ========================================================================

    describe('Workspace filtering', () => {
        it('should filter processes by workspace', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'ws1-p1', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'ws1-p2', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'ws2-p1', workspaceId: 'ws-2' }));

            const res = await request(`${srv.url}/api/processes?workspace=ws-1`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes).toHaveLength(2);
            expect(body.total).toBe(2);
            body.processes.forEach((p: any) => {
                expect(p.metadata?.workspaceId).toBe('ws-1');
            });
        });
    });

    // ========================================================================
    // Pagination
    // ========================================================================

    describe('Pagination', () => {
        it('should paginate with limit and offset', async () => {
            const srv = await startServer();

            // Create 10 processes
            for (let i = 0; i < 10; i++) {
                await postJSON(`${srv.url}/api/processes`, makeProcess({ id: `pag-${i}` }));
            }

            // First page
            const page1 = await request(`${srv.url}/api/processes?limit=3&offset=0`);
            const body1 = JSON.parse(page1.body);
            expect(body1.processes).toHaveLength(3);
            expect(body1.total).toBe(10);
            expect(body1.limit).toBe(3);
            expect(body1.offset).toBe(0);

            // Second page
            const page2 = await request(`${srv.url}/api/processes?limit=3&offset=3`);
            const body2 = JSON.parse(page2.body);
            expect(body2.processes).toHaveLength(3);
            expect(body2.total).toBe(10);
            expect(body2.offset).toBe(3);
        });

        it('should default to limit=50 offset=0', async () => {
            const srv = await startServer();
            await postJSON(`${srv.url}/api/processes`, makeProcess());

            const res = await request(`${srv.url}/api/processes`);
            const body = JSON.parse(res.body);
            expect(body.limit).toBe(50);
            expect(body.offset).toBe(0);
        });
    });

    // ========================================================================
    // Status filtering
    // ========================================================================

    describe('Status filtering', () => {
        it('should filter by comma-separated statuses', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'sf-run', status: 'running' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'sf-done', status: 'completed' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'sf-fail', status: 'failed' }));

            const res = await request(`${srv.url}/api/processes?status=running,failed`);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(2);
            const statuses = body.processes.map((p: any) => p.status);
            expect(statuses).toContain('running');
            expect(statuses).toContain('failed');
            expect(statuses).not.toContain('completed');
        });
    });

    // ========================================================================
    // Type filtering
    // ========================================================================

    describe('Type filtering', () => {
        it('should filter by process type', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'tf-cr', type: 'code-review' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'tf-cl', type: 'clarification' }));

            const res = await request(`${srv.url}/api/processes?type=code-review`);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(1);
            expect(body.processes[0].type).toBe('code-review');
        });
    });

    // ========================================================================
    // Since filtering
    // ========================================================================

    describe('Since filtering', () => {
        it('should filter by start time', async () => {
            const srv = await startServer();

            const old = new Date('2025-01-01T00:00:00Z').toISOString();
            const recent = new Date('2026-06-01T00:00:00Z').toISOString();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'since-old', startTime: old }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'since-new', startTime: recent }));

            const res = await request(`${srv.url}/api/processes?since=2026-01-01T00:00:00Z`);
            const body = JSON.parse(res.body);
            expect(body.total).toBe(1);
            expect(body.processes[0].id).toBe('since-new');
        });
    });

    // ========================================================================
    // Cancel endpoint
    // ========================================================================

    describe('Cancel endpoint', () => {
        it('should cancel a running process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-1', status: 'running' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-1/cancel`, {});
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.process.status).toBe('cancelled');
            expect(body.process.endTime).toBeDefined();
        });

        it('should return 409 for already-completed process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-2', status: 'completed' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-2/cancel`, {});
            expect(res.status).toBe(409);
            expect(JSON.parse(res.body).error).toContain('terminal state');
        });

        it('should return 409 for already-cancelled process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-3', status: 'cancelled' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-3/cancel`, {});
            expect(res.status).toBe(409);
        });

        it('should return 409 for failed process', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-4', status: 'failed' }));

            const res = await postJSON(`${srv.url}/api/processes/cancel-4/cancel`, {});
            expect(res.status).toBe(409);
        });

        it('should return 404 for nonexistent process', async () => {
            const srv = await startServer();

            const res = await postJSON(`${srv.url}/api/processes/nonexistent/cancel`, {});
            expect(res.status).toBe(404);
        });
    });

    // ========================================================================
    // Bulk delete
    // ========================================================================

    describe('Bulk delete', () => {
        it('should delete processes by status', async () => {
            const srv = await startServer();

            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'bd-run', status: 'running' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'bd-done1', status: 'completed' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'bd-done2', status: 'completed' }));

            const res = await request(`${srv.url}/api/processes?status=completed`, { method: 'DELETE' });
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.removed).toBe(2);

            // Verify running process still exists
            const remaining = await request(`${srv.url}/api/processes`);
            expect(JSON.parse(remaining.body).total).toBe(1);
        });

        it('should return 400 when no status param is provided', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/processes`, { method: 'DELETE' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('status');
        });
    });

    // ========================================================================
    // Error responses
    // ========================================================================

    describe('Error responses', () => {
        it('should return 404 for nonexistent process GET', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/does-not-exist`);
            expect(res.status).toBe(404);
            expect(JSON.parse(res.body).error).toBe('Process not found');
        });

        it('should return 400 for process creation with missing fields', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/processes`, { id: 'missing-fields' });
            expect(res.status).toBe(400);
            expect(JSON.parse(res.body).error).toContain('Missing required fields');
        });

        it('should return 404 for PATCH on nonexistent process', async () => {
            const srv = await startServer();
            const res = await patchJSON(`${srv.url}/api/processes/nope`, { status: 'completed' });
            expect(res.status).toBe(404);
        });

        it('should return 404 for DELETE on nonexistent process', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/nope`, { method: 'DELETE' });
            expect(res.status).toBe(404);
        });

        it('should return 400 for invalid JSON body on process create', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes`, {
                method: 'POST',
                body: '{invalid',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
        });
    });

    // ========================================================================
    // Stats endpoint
    // ========================================================================

    describe('Stats endpoint', () => {
        it('should return correct aggregate statistics', async () => {
            const srv = await startServer();

            // Register workspaces
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-1', name: 'frontend', rootPath: '/f' });
            await postJSON(`${srv.url}/api/workspaces`, { id: 'ws-2', name: 'backend', rootPath: '/b' });

            // Create processes
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st1', status: 'running', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st2', status: 'running', workspaceId: 'ws-1' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st3', status: 'completed', workspaceId: 'ws-2' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st4', status: 'failed', workspaceId: 'ws-2' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'st5', status: 'cancelled', workspaceId: 'ws-1' }));

            const res = await request(`${srv.url}/api/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);

            expect(body.totalProcesses).toBe(5);
            expect(body.byStatus.running).toBe(2);
            expect(body.byStatus.completed).toBe(1);
            expect(body.byStatus.failed).toBe(1);
            expect(body.byStatus.cancelled).toBe(1);
            expect(body.byStatus.queued).toBe(0);

            expect(body.byWorkspace).toHaveLength(2);
            const ws1 = body.byWorkspace.find((w: any) => w.workspaceId === 'ws-1');
            const ws2 = body.byWorkspace.find((w: any) => w.workspaceId === 'ws-2');
            expect(ws1.count).toBe(3);
            expect(ws1.name).toBe('frontend');
            expect(ws2.count).toBe(2);
            expect(ws2.name).toBe('backend');
        });

        it('should return zeros when no processes exist', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/stats`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.totalProcesses).toBe(0);
            expect(body.byStatus.running).toBe(0);
            expect(body.byWorkspace).toEqual([]);
        });
    });

    // ========================================================================
    // Filesystem browse endpoint
    // ========================================================================

    describe('Filesystem browse endpoint', () => {
        it('should browse a valid directory', async () => {
            const srv = await startServer();
            // Create a temp dir with subdirectories
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-test-'));
            fs.mkdirSync(path.join(tmpDir, 'subdir-a'));
            fs.mkdirSync(path.join(tmpDir, 'subdir-b'));
            fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'hello');

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(tmpDir)}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.path).toBe(tmpDir);
            expect(body.parent).toBe(path.dirname(tmpDir));
            // Only directories returned, not files
            expect(body.entries).toHaveLength(2);
            expect(body.entries[0].name).toBe('subdir-a');
            expect(body.entries[0].type).toBe('directory');
            expect(body.entries[1].name).toBe('subdir-b');

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should return 404 for non-existent path', async () => {
            const srv = await startServer();
            const fakePath = path.join(os.tmpdir(), 'nonexistent-browse-' + Date.now());

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(fakePath)}`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('not found');
        });

        it('should default to home directory when no path provided', async () => {
            const srv = await startServer();

            const res = await request(`${srv.url}/api/fs/browse`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.path).toBe(os.homedir());
            expect(Array.isArray(body.entries)).toBe(true);
        });

        it('should allow browsing the parent of home directory', async () => {
            const srv = await startServer();
            const parentDir = path.dirname(os.homedir());

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(parentDir)}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.path).toBe(parentDir);
            expect(Array.isArray(body.entries)).toBe(true);
        });

        it('should include drive list metadata on Windows', async () => {
            if (process.platform !== 'win32') {
                return;
            }
            const srv = await startServer();
            const homeDir = os.homedir();
            const currentDriveRoot = path.parse(homeDir).root;

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(homeDir)}`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(Array.isArray(body.drives)).toBe(true);
            expect(body.drives).toContain(currentDriveRoot);
        });

        it('should hide hidden directories by default', async () => {
            const srv = await startServer();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-hidden-'));
            fs.mkdirSync(path.join(tmpDir, '.hidden'));
            fs.mkdirSync(path.join(tmpDir, 'visible'));

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(tmpDir)}`);
            const body = JSON.parse(res.body);
            expect(body.entries).toHaveLength(1);
            expect(body.entries[0].name).toBe('visible');

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should show hidden directories with showHidden=true', async () => {
            const srv = await startServer();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-show-hidden-'));
            fs.mkdirSync(path.join(tmpDir, '.hidden'));
            fs.mkdirSync(path.join(tmpDir, 'visible'));

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(tmpDir)}&showHidden=true`);
            const body = JSON.parse(res.body);
            expect(body.entries).toHaveLength(2);
            const names = body.entries.map((e: any) => e.name);
            expect(names).toContain('.hidden');
            expect(names).toContain('visible');

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should detect git repos via .git subdirectory', async () => {
            const srv = await startServer();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-git-'));
            const gitRepo = path.join(tmpDir, 'my-repo');
            fs.mkdirSync(gitRepo);
            fs.mkdirSync(path.join(gitRepo, '.git'));
            fs.mkdirSync(path.join(tmpDir, 'not-a-repo'));

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(tmpDir)}`);
            const body = JSON.parse(res.body);
            expect(body.entries).toHaveLength(2);

            const repo = body.entries.find((e: any) => e.name === 'my-repo');
            const nonRepo = body.entries.find((e: any) => e.name === 'not-a-repo');
            expect(repo.isGitRepo).toBe(true);
            expect(nonRepo.isGitRepo).toBe(false);

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('should sort entries alphabetically', async () => {
            const srv = await startServer();
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browse-sort-'));
            fs.mkdirSync(path.join(tmpDir, 'charlie'));
            fs.mkdirSync(path.join(tmpDir, 'alpha'));
            fs.mkdirSync(path.join(tmpDir, 'bravo'));

            const res = await request(`${srv.url}/api/fs/browse?path=${encodeURIComponent(tmpDir)}`);
            const body = JSON.parse(res.body);
            const names = body.entries.map((e: any) => e.name);
            expect(names).toEqual(['alpha', 'bravo', 'charlie']);

            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    // ========================================================================
    // Process output endpoint
    // ========================================================================

    describe('Process output endpoint', () => {
        it('should return 200 with content when output file exists', async () => {
            const srv = await startServer();
            const tmpFile = path.join(dataDir, 'test-output.md');
            fs.writeFileSync(tmpFile, '# Hello\n\nSome **markdown** content.');

            const proc = makeProcess({ rawStdoutFilePath: tmpFile, status: 'completed' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await request(`${srv.url}/api/processes/${encodeURIComponent(proc.id)}/output`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe('# Hello\n\nSome **markdown** content.');
            expect(body.format).toBe('markdown');
        });

        it('should return 404 when process not found', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes/nonexistent-id/output`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Process not found');
        });

        it('should return 404 when no rawStdoutFilePath set', async () => {
            const srv = await startServer();
            const proc = makeProcess({ status: 'completed' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await request(`${srv.url}/api/processes/${encodeURIComponent(proc.id)}/output`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Conversation output not found');
        });

        it('should return 404 when file path set but file missing', async () => {
            const srv = await startServer();
            const proc = makeProcess({
                rawStdoutFilePath: path.join(dataDir, 'does-not-exist.md'),
                status: 'completed',
            });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await request(`${srv.url}/api/processes/${encodeURIComponent(proc.id)}/output`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Conversation output not found');
        });

        it('should handle large output files', async () => {
            const srv = await startServer();
            const largeContent = 'Line of markdown content.\n'.repeat(5000);
            const tmpFile = path.join(dataDir, 'large-output.md');
            fs.writeFileSync(tmpFile, largeContent);

            const proc = makeProcess({ rawStdoutFilePath: tmpFile, status: 'completed' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await request(`${srv.url}/api/processes/${encodeURIComponent(proc.id)}/output`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.content).toBe(largeContent);
            expect(body.format).toBe('markdown');
        });
    });

    // ========================================================================
    // GET /api/processes?sdkSessionId= — Session ID lookup
    // ========================================================================

    describe('GET /api/processes?sdkSessionId=', () => {
        it('should return process matching sdkSessionId', async () => {
            const srv = await startServer();
            const proc = makeProcess({ sdkSessionId: 'sess-abc-123' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await request(`${srv.url}/api/processes?sdkSessionId=sess-abc-123`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.process).toBeDefined();
            expect(body.process.id).toBe(proc.id);
            expect(body.process.sdkSessionId).toBe('sess-abc-123');
        });

        it('should return 404 when sdkSessionId not found', async () => {
            const srv = await startServer();
            const res = await request(`${srv.url}/api/processes?sdkSessionId=nonexistent`);
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toContain('nonexistent');
        });

        it('should find correct process among multiple', async () => {
            const srv = await startServer();
            const proc1 = makeProcess({ id: 'p1', sdkSessionId: 'sess-111' });
            const proc2 = makeProcess({ id: 'p2', sdkSessionId: 'sess-222' });
            const proc3 = makeProcess({ id: 'p3' }); // no sdkSessionId
            await postJSON(`${srv.url}/api/processes`, proc1);
            await postJSON(`${srv.url}/api/processes`, proc2);
            await postJSON(`${srv.url}/api/processes`, proc3);

            const res = await request(`${srv.url}/api/processes?sdkSessionId=sess-222`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.process.id).toBe('p2');
        });

        it('should still support normal listing without sdkSessionId param', async () => {
            const srv = await startServer();
            const proc = makeProcess({ sdkSessionId: 'sess-xyz' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await request(`${srv.url}/api/processes`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes).toBeDefined();
            expect(Array.isArray(body.processes)).toBe(true);
        });
    });

    // ========================================================================
    // POST /api/processes/:id/message
    // ========================================================================

    describe('POST /api/processes/:id/message', () => {
        it('should return 404 for unknown process', async () => {
            const srv = await startServer();
            const res = await postJSON(`${srv.url}/api/processes/nonexistent/message`, { content: 'hello' });
            expect(res.status).toBe(404);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Process not found');
        });

        it('should return 400 for missing content', async () => {
            const srv = await startServer();
            const proc = makeProcess({ sdkSessionId: 'sess-1' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await postJSON(`${srv.url}/api/processes/${proc.id}/message`, {});
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Missing required fields: content');
        });

        it('should return 400 for non-string content', async () => {
            const srv = await startServer();
            const proc = makeProcess({ sdkSessionId: 'sess-1' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await postJSON(`${srv.url}/api/processes/${proc.id}/message`, { content: 123 });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Missing required fields: content');
        });

        it('should return 400 for invalid JSON', async () => {
            const srv = await startServer();
            const proc = makeProcess({ sdkSessionId: 'sess-1' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await request(`${srv.url}/api/processes/${proc.id}/message`, {
                method: 'POST',
                body: 'not json {{{',
                headers: { 'Content-Type': 'application/json' },
            });
            expect(res.status).toBe(400);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Invalid JSON body');
        });

        it('should return 409 for process without sdkSessionId', async () => {
            const srv = await startServer();
            const proc = makeProcess(); // no sdkSessionId
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await postJSON(`${srv.url}/api/processes/${proc.id}/message`, { content: 'hello' });
            expect(res.status).toBe(409);
            const body = JSON.parse(res.body);
            expect(body.error).toBe('Process has no SDK session — follow-up not supported');
        });

        it('should return 202 and append user turn', async () => {
            const srv = await startServer();
            const proc = makeProcess({ sdkSessionId: 'sess-abc', status: 'completed' });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await postJSON(`${srv.url}/api/processes/${proc.id}/message`, { content: 'Follow up question' });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.processId).toBe(proc.id);
            expect(body.turnIndex).toBe(0);

            // Verify the process was updated with user turn and running status
            const getRes = await request(`${srv.url}/api/processes/${proc.id}`);
            const getBody = JSON.parse(getRes.body);
            expect(getBody.process.status).toBe('running');
            expect(getBody.process.conversationTurns).toHaveLength(1);
            expect(getBody.process.conversationTurns[0].role).toBe('user');
            expect(getBody.process.conversationTurns[0].content).toBe('Follow up question');
        });

        it('should return 202 with turnIndex 0 for process with empty conversationTurns', async () => {
            const srv = await startServer();
            const proc = makeProcess({
                sdkSessionId: 'sess-xyz',
                status: 'completed',
                conversationTurns: [],
            });
            await postJSON(`${srv.url}/api/processes`, proc);

            const res = await postJSON(`${srv.url}/api/processes/${proc.id}/message`, { content: 'First follow-up' });
            expect(res.status).toBe(202);
            const body = JSON.parse(res.body);
            expect(body.turnIndex).toBe(0);
        });
    });

    // ========================================================================
    // History endpoint: exclude=conversation
    // ========================================================================

    describe('History endpoint optimization (exclude=conversation)', () => {
        it('should return processes without conversation data when exclude=conversation', async () => {
            const srv = await startServer();
            const proc = makeProcess({
                id: 'hist-1',
                status: 'completed',
                fullPrompt: 'This is a very long full prompt text',
            });
            await postJSON(`${srv.url}/api/processes`, proc);

            // Update with result and structuredResult
            await patchJSON(`${srv.url}/api/processes/hist-1`, {
                result: 'This is a big result output',
                structuredResult: '{"key":"value"}',
            });

            // Fetch with exclude=conversation
            const res = await request(`${srv.url}/api/processes?exclude=conversation`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes).toHaveLength(1);

            const p = body.processes[0];
            expect(p.id).toBe('hist-1');
            expect(p.promptPreview).toBe('Test prompt');
            expect(p.status).toBe('completed');
            // These fields should be stripped
            expect(p.fullPrompt).toBeUndefined();
            expect(p.result).toBeUndefined();
            expect(p.structuredResult).toBeUndefined();
        });

        it('should return full data when exclude param is not set', async () => {
            const srv = await startServer();
            const proc = makeProcess({
                id: 'hist-2',
                status: 'completed',
                fullPrompt: 'Full prompt text',
            });
            await postJSON(`${srv.url}/api/processes`, proc);
            await patchJSON(`${srv.url}/api/processes/hist-2`, {
                result: 'Some result',
            });

            const res = await request(`${srv.url}/api/processes`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes).toHaveLength(1);

            const p = body.processes[0];
            expect(p.fullPrompt).toBe('Full prompt text');
            expect(p.result).toBe('Some result');
        });

        it('should combine exclude=conversation with status filter for history queries', async () => {
            const srv = await startServer();

            // Create processes with different statuses
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'active-1', status: 'running' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'done-1', status: 'completed' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'fail-1', status: 'failed' }));
            await postJSON(`${srv.url}/api/processes`, makeProcess({ id: 'cancel-1', status: 'cancelled' }));

            // History query: completed + failed + cancelled, excluding conversation data
            const res = await request(`${srv.url}/api/processes?status=completed,failed,cancelled&exclude=conversation`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes).toHaveLength(3);
            expect(body.total).toBe(3);

            // Verify all returned processes are terminal
            body.processes.forEach((p: any) => {
                expect(['completed', 'failed', 'cancelled']).toContain(p.status);
                expect(p.conversationTurns).toBeUndefined();
                expect(p.fullPrompt).toBeUndefined();
            });
        });

        it('should support pagination with exclude=conversation', async () => {
            const srv = await startServer();

            // Create 5 completed processes
            for (let i = 0; i < 5; i++) {
                await postJSON(`${srv.url}/api/processes`, makeProcess({
                    id: `pag-hist-${i}`,
                    status: 'completed',
                }));
            }

            const res = await request(`${srv.url}/api/processes?status=completed&exclude=conversation&limit=2&offset=0`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            expect(body.processes).toHaveLength(2);
            expect(body.total).toBe(5);
            expect(body.limit).toBe(2);
            expect(body.offset).toBe(0);

            // Verify conversation data is stripped
            body.processes.forEach((p: any) => {
                expect(p.conversationTurns).toBeUndefined();
                expect(p.fullPrompt).toBeUndefined();
            });
        });

        it('should reduce payload size significantly with exclude=conversation', async () => {
            const srv = await startServer();
            const longContent = 'x'.repeat(10000);
            const proc = makeProcess({
                id: 'payload-test',
                status: 'completed',
                fullPrompt: longContent,
            });
            await postJSON(`${srv.url}/api/processes`, proc);
            await patchJSON(`${srv.url}/api/processes/payload-test`, {
                result: longContent,
            });

            // Full response
            const fullRes = await request(`${srv.url}/api/processes`);
            const fullBody = fullRes.body;

            // Lightweight response
            const lightRes = await request(`${srv.url}/api/processes?exclude=conversation`);
            const lightBody = lightRes.body;

            // Lightweight should be significantly smaller
            expect(lightBody.length).toBeLessThan(fullBody.length);
            // The reduction should be substantial (at least 30% — fullPrompt + result stripped)
            expect(lightBody.length).toBeLessThan(fullBody.length * 0.7);
        });
    });

    // ========================================================================
    // Tool Call Serialization
    // ========================================================================

    describe('Tool Call Serialization', () => {
        it('should include tool calls in conversation turns by default', async () => {
            const srv = await startServer();
            const proc = makeProcess({ id: 'tc-default' });
            await postJSON(`${srv.url}/api/processes`, proc);

            // Inject conversation turns with tool calls directly via store
            await srv.store.updateProcess('tc-default', {
                conversationTurns: [
                    {
                        role: 'assistant',
                        content: 'Let me check that file.',
                        timestamp: new Date(),
                        turnIndex: 0,
                        toolCalls: [
                            {
                                id: 'call_abc123',
                                name: 'view',
                                status: 'completed' as const,
                                startTime: new Date(),
                                args: { path: '/src/app.ts' },
                                result: 'File contents...',
                            },
                        ],
                        timeline: [],
                    },
                ],
            });

            const res = await request(`${srv.url}/api/processes/tc-default`);
            expect(res.status).toBe(200);
            const retrieved = JSON.parse(res.body).process;
            expect(retrieved.conversationTurns[0].toolCalls).toBeDefined();
            expect(retrieved.conversationTurns[0].toolCalls[0].name).toBe('view');
        });

        it('should exclude tool calls when ?exclude=toolCalls on single process', async () => {
            const srv = await startServer();
            const proc = makeProcess({ id: 'tc-exclude' });
            await postJSON(`${srv.url}/api/processes`, proc);

            await srv.store.updateProcess('tc-exclude', {
                conversationTurns: [
                    {
                        role: 'assistant',
                        content: 'Checking...',
                        timestamp: new Date(),
                        turnIndex: 0,
                        toolCalls: [{ id: 'call_xyz', name: 'grep', status: 'completed' as const, startTime: new Date(), args: {}, result: '' }],
                        timeline: [],
                    },
                ],
            });

            const res = await request(`${srv.url}/api/processes/tc-exclude?exclude=toolCalls`);
            expect(res.status).toBe(200);
            const retrieved = JSON.parse(res.body).process;
            expect(retrieved.conversationTurns).toBeDefined();
            expect(retrieved.conversationTurns[0].toolCalls).toBeUndefined();
            expect(retrieved.conversationTurns[0].content).toBe('Checking...');
        });

        it('should exclude tool calls from list endpoint when ?exclude=toolCalls', async () => {
            const srv = await startServer();
            const proc = makeProcess({ id: 'tc-list-exclude' });
            await postJSON(`${srv.url}/api/processes`, proc);

            await srv.store.updateProcess('tc-list-exclude', {
                conversationTurns: [
                    {
                        role: 'assistant',
                        content: 'Working...',
                        timestamp: new Date(),
                        turnIndex: 0,
                        toolCalls: [{ id: 'call_list', name: 'edit', status: 'completed' as const, startTime: new Date(), args: {} }],
                        timeline: [],
                    },
                ],
            });

            const res = await request(`${srv.url}/api/processes?exclude=toolCalls`);
            expect(res.status).toBe(200);
            const body = JSON.parse(res.body);
            const found = body.processes.find((p: any) => p.id === 'tc-list-exclude');
            expect(found).toBeDefined();
            expect(found.conversationTurns[0].toolCalls).toBeUndefined();
            expect(found.conversationTurns[0].content).toBe('Working...');
        });

        it('should preserve turn structure when excluding toolCalls', async () => {
            const srv = await startServer();
            const proc = makeProcess({ id: 'tc-preserve' });
            await postJSON(`${srv.url}/api/processes`, proc);

            await srv.store.updateProcess('tc-preserve', {
                conversationTurns: [
                    {
                        role: 'assistant',
                        content: 'Turn 0',
                        timestamp: new Date(),
                        turnIndex: 0,
                        toolCalls: [{ id: 'c1', name: 'view', status: 'completed' as const, startTime: new Date(), args: {} }],
                        timeline: [],
                    },
                    {
                        role: 'user',
                        content: 'Turn 1',
                        timestamp: new Date(),
                        turnIndex: 1,
                        timeline: [],
                    },
                ],
            });

            const res = await request(`${srv.url}/api/processes/tc-preserve?exclude=toolCalls`);
            expect(res.status).toBe(200);
            const retrieved = JSON.parse(res.body).process;
            expect(retrieved.conversationTurns).toHaveLength(2);
            expect(retrieved.conversationTurns[0].role).toBe('assistant');
            expect(retrieved.conversationTurns[0].content).toBe('Turn 0');
            expect(retrieved.conversationTurns[1].role).toBe('user');
            expect(retrieved.conversationTurns[1].content).toBe('Turn 1');
        });
    });

    // ========================================================================
    // Request Logs
    // ========================================================================

    describe('Request logs', () => {
        let stderrOutput: string[];
        let originalWrite: typeof process.stderr.write;

        beforeEach(() => {
            stderrOutput = [];
            originalWrite = process.stderr.write;
            process.stderr.write = function (chunk: any, ...args: any[]): boolean {
                if (typeof chunk === 'string') {
                    stderrOutput.push(chunk);
                } else if (Buffer.isBuffer(chunk)) {
                    stderrOutput.push(chunk.toString());
                }
                return true;
            } as any;
        });

        afterEach(() => {
            process.stderr.write = originalWrite;
        });

        it('should log [Process] cancel on POST /api/processes/:id/cancel', async () => {
            const srv = await startServer();
            const proc = makeProcess({ id: 'log-cancel-1', status: 'running' });
            const createRes = await postJSON(`${srv.url}/api/processes`, proc);
            expect(createRes.status).toBe(201);
            stderrOutput = [];

            const cancelRes = await request(`${srv.url}/api/processes/log-cancel-1/cancel`, { method: 'POST' });
            expect(cancelRes.status).toBe(200);
            expect(stderrOutput.some(l => l.includes('[Process] cancel id=log-cancel-1 prevStatus=running'))).toBe(true);
        });
    });
});

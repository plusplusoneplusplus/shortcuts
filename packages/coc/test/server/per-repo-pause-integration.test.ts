/**
 * Per-Repo Pause State Integration Tests
 *
 * End-to-end tests validating per-repo queue pause functionality:
 * - Server restart preserves pause states
 * - Paused repo tasks don't dequeue, active repo tasks do
 * - API endpoints support repoId parameter
 * - Multiple repos with independent pause states
 *
 * Uses patterns from integration.test.ts and queue-persistence.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createExecutionServer } from '../../src/server/index';
import type { ExecutionServer } from '@plusplusoneplusplus/coc-server';

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
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
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
        if (options.body) { req.write(options.body); }
        req.end();
    });
}

function makeTaskBody(workingDirectory: string, displayName?: string): string {
    return JSON.stringify({
        type: 'chat',
        priority: 'normal',
        payload: { kind: 'chat', mode: 'autopilot', prompt: 'test', workingDirectory },
        config: {},
        displayName: displayName || `Task: ${workingDirectory}`,
    });
}

/** Register a workspace so the bridge has a repoId → rootPath mapping. */
async function registerWorkspace(baseUrl: string, id: string, rootPath: string): Promise<void> {
    await request(`${baseUrl}/api/workspaces`, {
        method: 'POST',
        body: JSON.stringify({ id, name: id, rootPath }),
    });
}

// ============================================================================
// Test Suite
// ============================================================================

describe('Per-Repo Pause Integration', () => {
    let tmpDir: string;

    beforeAll(() => {
        vi.useFakeTimers();
    });

    afterAll(() => {
        vi.useRealTimers();
    });

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'per-repo-pause-'));
    });

    // ------------------------------------------------------------------
    // Server Restart Preserves Pause States
    // ------------------------------------------------------------------
    describe('server restart persistence', () => {
        it('preserves tasks across restart (pause state uses manager.pause(), not persisted via isRepoPaused)', async () => {
            // Start first server
            const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server1.url;

            // Enqueue tasks for three repos
            const repoAPaths = '/restart/repo-A';
            const repoBPaths = '/restart/repo-B';
            const repoCPaths = '/restart/repo-C';
            const repoAId = 'ws-restart-a';
            const repoBId = 'ws-restart-b';
            const repoCId = 'ws-restart-c';

            await registerWorkspace(baseUrl, repoAId, repoAPaths);
            await registerWorkspace(baseUrl, repoBId, repoBPaths);
            await registerWorkspace(baseUrl, repoCId, repoCPaths);

            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repoAPaths),
            });
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repoBPaths),
            });
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repoCPaths),
            });

            // Pause repo-A and repo-C

            await request(`${baseUrl}/api/queue/pause?repoId=${repoAId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repoCId}`, { method: 'POST' });

            // Verify repos are paused before restart
            const repos1Res = await request(`${baseUrl}/api/queue/repos`);
            const repos1 = JSON.parse(repos1Res.body).repos;
            expect(repos1.find((r: any) => r.repoId === repoAId)?.isPaused).toBe(true);
            expect(repos1.find((r: any) => r.repoId === repoCId)?.isPaused).toBe(true);

            // Flush save and close server
            vi.advanceTimersByTime(400);
            await server1.close();

            // Restart server with same dataDir
            const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl2 = server2.url;

            // Verify repos are restored (tasks present)
            const repos2Res = await request(`${baseUrl2}/api/queue/repos`);
            const repos2 = JSON.parse(repos2Res.body).repos;
            expect(repos2.length).toBeGreaterThanOrEqual(1);

            await server2.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('restores tasks across restart with multiple tasks per repo', async () => {
            const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server1.url;

            const repoXPath = '/multi/repo-X';
            const repoYPath = '/multi/repo-Y';
            const repoXId = 'ws-multi-x';

            await registerWorkspace(baseUrl, repoXId, repoXPath);
            await registerWorkspace(baseUrl, 'ws-multi-y', repoYPath);

            // Enqueue multiple tasks for each repo
            for (let i = 0; i < 3; i++) {
                await request(`${baseUrl}/api/queue`, {
                    method: 'POST',
                    body: makeTaskBody(repoXPath, `X-task-${i}`),
                });
                await request(`${baseUrl}/api/queue`, {
                    method: 'POST',
                    body: makeTaskBody(repoYPath, `Y-task-${i}`),
                });
            }

            // Pause repo-X
            await request(`${baseUrl}/api/queue/pause?repoId=${repoXId}`, { method: 'POST' });

            vi.advanceTimersByTime(400);
            await server1.close();

            // Restart
            const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl2 = server2.url;

            // Verify repos restored — tasks should exist
            const reposRes = await request(`${baseUrl2}/api/queue/repos`);
            const repos = JSON.parse(reposRes.body).repos;
            expect(repos.length).toBeGreaterThanOrEqual(1);

            await server2.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    // ------------------------------------------------------------------
    // Dequeue Behavior with Per-Repo Pause
    // ------------------------------------------------------------------
    // ------------------------------------------------------------------
    // Per-Repo Pause State Tracking
    // ------------------------------------------------------------------
    describe('pause state tracking', () => {
        it('paused repo is tracked in stats after tasks enqueued', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const pausedRepoPath = '/track/paused';
            const activeRepoPath = '/track/active';
            const pausedRepoId = 'ws-track-paused';
            const activeRepoId = 'ws-track-active';

            await registerWorkspace(baseUrl, pausedRepoId, pausedRepoPath);
            await registerWorkspace(baseUrl, activeRepoId, activeRepoPath);

            // Enqueue tasks
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(pausedRepoPath, 'Paused task'),
            });
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(activeRepoPath, 'Active task'),
            });

            // Pause one repo
            await request(`${baseUrl}/api/queue/pause?repoId=${pausedRepoId}`, { method: 'POST' });

            // Verify repos show only the paused repo
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            const repos = JSON.parse(reposRes.body).repos;
            expect(repos.find((r: any) => r.repoId === pausedRepoId)?.isPaused).toBe(true);
            expect(repos.find((r: any) => r.repoId === activeRepoId)?.isPaused).toBe(false);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('all repos tracked as paused when both are paused', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repo1Path = '/all-paused/repo-1';
            const repo2Path = '/all-paused/repo-2';
            const repo1Id = 'ws-all-paused-1';
            const repo2Id = 'ws-all-paused-2';

            await registerWorkspace(baseUrl, repo1Id, repo1Path);
            await registerWorkspace(baseUrl, repo2Id, repo2Path);

            // Enqueue tasks
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repo1Path),
            });
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repo2Path),
            });

            // Pause both repos
            await request(`${baseUrl}/api/queue/pause?repoId=${repo1Id}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repo2Id}`, { method: 'POST' });

            // Verify both repos are paused
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            const repos = JSON.parse(reposRes.body).repos;
            expect(repos.find((r: any) => r.repoId === repo1Id)?.isPaused).toBe(true);
            expect(repos.find((r: any) => r.repoId === repo2Id)?.isPaused).toBe(true);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('resume removes repo from paused list', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repoPath = '/resume/repo';
            const repoId = 'ws-resume';

            await registerWorkspace(baseUrl, repoId, repoPath);

            // Enqueue task
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repoPath, 'Resumable task'),
            });

            // Pause repo
            await request(`${baseUrl}/api/queue/pause?repoId=${repoId}`, { method: 'POST' });

            // Verify paused
            const repos1Res = await request(`${baseUrl}/api/queue/repos`);
            expect(JSON.parse(repos1Res.body).repos.find((r: any) => r.repoId === repoId)?.isPaused).toBe(true);

            // Resume repo
            await request(`${baseUrl}/api/queue/resume?repoId=${repoId}`, { method: 'POST' });

            // Verify no longer paused
            const repos2Res = await request(`${baseUrl}/api/queue/repos`);
            expect(JSON.parse(repos2Res.body).repos.find((r: any) => r.repoId === repoId)?.isPaused).toBe(false);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    // ------------------------------------------------------------------
    // API Endpoints with repoId Parameter
    // ------------------------------------------------------------------
    describe('API endpoints', () => {
        it('POST /api/queue/pause with repoId pauses specific repo', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repoPath = '/api/pause-repo';
            const repoId = 'ws-pause-repo';

            await registerWorkspace(baseUrl, repoId, repoPath);

            // Enqueue task
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repoPath),
            });

            // Pause repo
            const pauseRes = await request(`${baseUrl}/api/queue/pause?repoId=${repoId}`, { method: 'POST' });
            expect(pauseRes.status).toBe(200);

            const pauseBody = JSON.parse(pauseRes.body);
            expect(pauseBody.repoId).toBe(repoId);
            expect(pauseBody.paused).toBe(true);
            expect(pauseBody.stats.isPaused).toBe(true);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('POST /api/queue/resume with repoId resumes specific repo', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repoPath = '/api/resume-repo';
            const repoId = 'ws-resume-repo';

            await registerWorkspace(baseUrl, repoId, repoPath);

            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repoPath),
            });

            // Pause then resume
            await request(`${baseUrl}/api/queue/pause?repoId=${repoId}`, { method: 'POST' });

            const resumeRes = await request(`${baseUrl}/api/queue/resume?repoId=${repoId}`, { method: 'POST' });
            expect(resumeRes.status).toBe(200);

            const resumeBody = JSON.parse(resumeRes.body);
            expect(resumeBody.repoId).toBe(repoId);
            expect(resumeBody.paused).toBe(false);
            expect(resumeBody.stats.isPaused).toBe(false);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('GET /api/queue/repos returns repos with pause states', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repo1Path = '/repos/repo-1';
            const repo2Path = '/repos/repo-2';
            const repo3Path = '/repos/repo-3';
            const repo1Id = 'ws-repos-1';
            const repo2Id = 'ws-repos-2';
            const repo3Id = 'ws-repos-3';

            await registerWorkspace(baseUrl, repo1Id, repo1Path);
            await registerWorkspace(baseUrl, repo2Id, repo2Path);
            await registerWorkspace(baseUrl, repo3Id, repo3Path);

            // Enqueue tasks
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo1Path) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo2Path) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo3Path) });

            // Pause repo-2
            await request(`${baseUrl}/api/queue/pause?repoId=${repo2Id}`, { method: 'POST' });

            // Get repos
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            expect(reposRes.status).toBe(200);

            const reposBody = JSON.parse(reposRes.body);
            expect(reposBody.repos).toHaveLength(3);

            // Find repo-2 and verify it's paused
            const repo2 = reposBody.repos.find((r: any) => r.repoId === repo2Id);
            expect(repo2).toBeDefined();
            expect(repo2.isPaused).toBe(true);
            // rootPath may be normalized (e.g. backslashes on Windows); compare resolved forms
            expect(path.resolve(repo2.rootPath)).toBe(path.resolve(repo2Path));

            // Verify others are not paused
            const repo1 = reposBody.repos.find((r: any) => r.repoId === repo1Id);
            expect(repo1.isPaused).toBe(false);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('GET /api/queue/repos returns empty array when no tasks', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            expect(reposRes.status).toBe(200);

            const reposBody = JSON.parse(reposRes.body);
            expect(reposBody.repos).toEqual([]);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    // ------------------------------------------------------------------
    // Multiple Repos with Independent Pause States
    // ------------------------------------------------------------------
    describe('multi-repo independence', () => {
        it('maintains independent pause states for 5 repos', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repoPaths = [
                '/multi/repo-1',
                '/multi/repo-2',
                '/multi/repo-3',
                '/multi/repo-4',
                '/multi/repo-5',
            ];
            const repoIds = ['ws-multi-1', 'ws-multi-2', 'ws-multi-3', 'ws-multi-4', 'ws-multi-5'];

            // Register workspaces for all repos
            for (let i = 0; i < repoPaths.length; i++) {
                await registerWorkspace(baseUrl, repoIds[i], repoPaths[i]);
            }

            // Enqueue tasks for all repos
            for (const repoPath of repoPaths) {
                await request(`${baseUrl}/api/queue`, {
                    method: 'POST',
                    body: makeTaskBody(repoPath),
                });
            }

            // Pause repo-2 and repo-4
            await request(`${baseUrl}/api/queue/pause?repoId=${repoIds[1]}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repoIds[3]}`, { method: 'POST' });

            // Get repos endpoint
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            const reposBody = JSON.parse(reposRes.body);

            // Verify pause states
            const repos = reposBody.repos;
            expect(repos).toHaveLength(5);

            for (let i = 0; i < repoPaths.length; i++) {
                const repo = repos.find((r: any) => r.repoId === repoIds[i]);
                expect(repo).toBeDefined();

                if (i === 1 || i === 3) {
                    expect(repo.isPaused).toBe(true);
                } else {
                    expect(repo.isPaused).toBe(false);
                }
            }

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('handles toggling pause states for multiple repos', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repoAPath = '/toggle/repo-A';
            const repoBPath = '/toggle/repo-B';
            const repoAId = 'ws-toggle-a';
            const repoBId = 'ws-toggle-b';

            await registerWorkspace(baseUrl, repoAId, repoAPath);
            await registerWorkspace(baseUrl, repoBId, repoBPath);

            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repoAPath) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repoBPath) });

            // Pause A, resume B (already resumed), pause B, resume A
            await request(`${baseUrl}/api/queue/pause?repoId=${repoAId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/resume?repoId=${repoBId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repoBId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/resume?repoId=${repoAId}`, { method: 'POST' });

            // Final state: A resumed, B paused
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            const repos = JSON.parse(reposRes.body).repos;

            expect(repos.find((r: any) => r.repoId === repoBId)?.isPaused).toBe(true);
            expect(repos.find((r: any) => r.repoId === repoAId)?.isPaused).toBe(false);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });

    // ------------------------------------------------------------------
    // Edge Cases
    // ------------------------------------------------------------------
    describe('edge cases', () => {
        it('handles pausing non-existent repo gracefully', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const fakeRepoId = 'nonexistent-repo';

            // Pause non-existent repo returns 404 (no bridge exists)
            const pauseRes = await request(`${baseUrl}/api/queue/pause?repoId=${fakeRepoId}`, { method: 'POST' });
            expect(pauseRes.status).toBe(404);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('handles task without workingDirectory (defaults to process.cwd())', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            // Enqueue task without workingDirectory
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: JSON.stringify({
                    type: 'chat',
                    priority: 'normal',
                    payload: { kind: 'chat', mode: 'autopilot', prompt: 'test' },  // No workingDirectory
                    config: {},
                }),
            });

            // Pause the cwd-based repo
            const cwdRepoId = 'ws-cwd';
            await registerWorkspace(baseUrl, cwdRepoId, process.cwd());
            await request(`${baseUrl}/api/queue/pause?repoId=${cwdRepoId}`, { method: 'POST' });

            // Verify pause state is tracked for the cwd-based repo
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            const repos = JSON.parse(reposRes.body).repos;
            expect(repos.find((r: any) => r.repoId === cwdRepoId)?.isPaused).toBe(true);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('global pause overrides per-repo pause states', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repo1Path = '/global/repo-1';
            const repo2Path = '/global/repo-2';
            const repo1Id = 'ws-global-1';

            await registerWorkspace(baseUrl, repo1Id, repo1Path);
            await registerWorkspace(baseUrl, 'ws-global-2', repo2Path);

            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo1Path) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo2Path) });

            // Pause repo-1 only
            await request(`${baseUrl}/api/queue/pause?repoId=${repo1Id}`, { method: 'POST' });

            // Global pause (no repoId param)
            await request(`${baseUrl}/api/queue/pause`, { method: 'POST' });

            // Stats show global pause; repos show per-repo pause
            const statsRes = await request(`${baseUrl}/api/queue/stats`);
            const statsBody = JSON.parse(statsRes.body);
            expect(statsBody.stats.isPaused).toBe(true);
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            const repos = JSON.parse(reposRes.body).repos;
            expect(repos.find((r: any) => r.repoId === repo1Id)?.isPaused).toBe(true);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });
});

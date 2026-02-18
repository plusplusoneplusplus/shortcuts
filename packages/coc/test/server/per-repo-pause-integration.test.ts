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
import { TaskQueueManager } from '@plusplusoneplusplus/pipeline-core';
import { computeRepoId } from '../../src/server/queue-persistence';
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
        type: 'custom',
        priority: 'normal',
        payload: { workingDirectory },
        config: {},
        displayName: displayName || `Task: ${workingDirectory}`,
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
        it('preserves per-repo pause state across restart', async () => {
            // Start first server
            const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server1.url;

            // Enqueue tasks for three repos
            const repoAPaths = '/restart/repo-A';
            const repoBPaths = '/restart/repo-B';
            const repoCPaths = '/restart/repo-C';

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
            const repoAId = computeRepoId(repoAPaths);
            const repoBId = computeRepoId(repoBPaths);
            const repoCId = computeRepoId(repoCPaths);

            await request(`${baseUrl}/api/queue/pause?repoId=${repoAId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repoCId}`, { method: 'POST' });

            // Verify stats show paused repos
            const stats1 = await request(`${baseUrl}/api/queue/stats`);
            const statsBody1 = JSON.parse(stats1.body);
            expect(statsBody1.stats.pausedRepos).toContain(repoAId);
            expect(statsBody1.stats.pausedRepos).toContain(repoCId);
            expect(statsBody1.stats.pausedRepos).not.toContain(repoBId);

            // Flush save and close server
            vi.advanceTimersByTime(400);
            await server1.close();

            // Restart server with same dataDir
            const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl2 = server2.url;

            // Verify pause states restored
            const stats2 = await request(`${baseUrl2}/api/queue/stats`);
            const statsBody2 = JSON.parse(stats2.body);
            expect(statsBody2.stats.pausedRepos).toContain(repoAId);
            expect(statsBody2.stats.pausedRepos).toContain(repoCId);
            expect(statsBody2.stats.pausedRepos).not.toContain(repoBId);

            await server2.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('restores mixed pause states with multiple tasks per repo', async () => {
            const server1 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server1.url;

            const repoXPath = '/multi/repo-X';
            const repoYPath = '/multi/repo-Y';

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
            const repoXId = computeRepoId(repoXPath);
            await request(`${baseUrl}/api/queue/pause?repoId=${repoXId}`, { method: 'POST' });

            vi.advanceTimersByTime(400);
            await server1.close();

            // Restart
            const server2 = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl2 = server2.url;

            // Verify queue state — paused repo-X tasks stay queued
            const queueRes = await request(`${baseUrl2}/api/queue`);
            const queueBody = JSON.parse(queueRes.body);
            // repo-X tasks (3) remain queued because repo-X is paused
            // repo-Y tasks may have been auto-executed by the queue executor
            const queuedXTasks = queueBody.queued.filter(
                (t: any) => t.displayName?.startsWith('X-task-')
            );
            expect(queuedXTasks).toHaveLength(3);

            // Verify pause state
            const stats = await request(`${baseUrl2}/api/queue/stats`);
            const statsBody = JSON.parse(stats.body);
            expect(statsBody.stats.pausedRepos).toContain(repoXId);

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
            const pausedRepoId = computeRepoId(pausedRepoPath);
            await request(`${baseUrl}/api/queue/pause?repoId=${pausedRepoId}`, { method: 'POST' });

            // Verify stats show only the paused repo
            const stats = await request(`${baseUrl}/api/queue/stats`);
            const statsBody = JSON.parse(stats.body);
            expect(statsBody.stats.pausedRepos).toContain(pausedRepoId);
            expect(statsBody.stats.pausedRepos).not.toContain(computeRepoId(activeRepoPath));

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('all repos tracked as paused when both are paused', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repo1Path = '/all-paused/repo-1';
            const repo2Path = '/all-paused/repo-2';

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
            const repo1Id = computeRepoId(repo1Path);
            const repo2Id = computeRepoId(repo2Path);
            await request(`${baseUrl}/api/queue/pause?repoId=${repo1Id}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repo2Id}`, { method: 'POST' });

            // Verify both repos are paused
            const stats = await request(`${baseUrl}/api/queue/stats`);
            const statsBody = JSON.parse(stats.body);
            expect(statsBody.stats.pausedRepos).toContain(repo1Id);
            expect(statsBody.stats.pausedRepos).toContain(repo2Id);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('resume removes repo from paused list', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repoPath = '/resume/repo';
            const repoId = computeRepoId(repoPath);

            // Enqueue task
            await request(`${baseUrl}/api/queue`, {
                method: 'POST',
                body: makeTaskBody(repoPath, 'Resumable task'),
            });

            // Pause repo
            await request(`${baseUrl}/api/queue/pause?repoId=${repoId}`, { method: 'POST' });

            // Verify paused
            const stats1 = await request(`${baseUrl}/api/queue/stats`);
            expect(JSON.parse(stats1.body).stats.pausedRepos).toContain(repoId);

            // Resume repo
            await request(`${baseUrl}/api/queue/resume?repoId=${repoId}`, { method: 'POST' });

            // Verify no longer paused
            const stats2 = await request(`${baseUrl}/api/queue/stats`);
            expect(JSON.parse(stats2.body).stats.pausedRepos).not.toContain(repoId);

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
            const repoId = computeRepoId(repoPath);

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
            expect(pauseBody.stats.pausedRepos).toContain(repoId);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('POST /api/queue/resume with repoId resumes specific repo', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repoPath = '/api/resume-repo';
            const repoId = computeRepoId(repoPath);

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
            expect(resumeBody.stats.pausedRepos).not.toContain(repoId);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('GET /api/queue/repos returns repos with pause states', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repo1Path = '/repos/repo-1';
            const repo2Path = '/repos/repo-2';
            const repo3Path = '/repos/repo-3';

            // Enqueue tasks
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo1Path) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo2Path) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo3Path) });

            // Pause repo-2
            const repo2Id = computeRepoId(repo2Path);
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
            expect(repo2.rootPath).toBe(repo2Path);

            // Verify others are not paused
            const repo1 = reposBody.repos.find((r: any) => r.repoId === computeRepoId(repo1Path));
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

            // Enqueue tasks for all repos
            for (const repoPath of repoPaths) {
                await request(`${baseUrl}/api/queue`, {
                    method: 'POST',
                    body: makeTaskBody(repoPath),
                });
            }

            // Pause repo-2 and repo-4
            const repo2Id = computeRepoId(repoPaths[1]);
            const repo4Id = computeRepoId(repoPaths[3]);
            await request(`${baseUrl}/api/queue/pause?repoId=${repo2Id}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repo4Id}`, { method: 'POST' });

            // Get repos endpoint
            const reposRes = await request(`${baseUrl}/api/queue/repos`);
            const reposBody = JSON.parse(reposRes.body);

            // Verify pause states
            const repos = reposBody.repos;
            expect(repos).toHaveLength(5);

            for (let i = 0; i < repoPaths.length; i++) {
                const repoId = computeRepoId(repoPaths[i]);
                const repo = repos.find((r: any) => r.repoId === repoId);
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

            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repoAPath) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repoBPath) });

            const repoAId = computeRepoId(repoAPath);
            const repoBId = computeRepoId(repoBPath);

            // Pause A, resume B (already resumed), pause B, resume A
            await request(`${baseUrl}/api/queue/pause?repoId=${repoAId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/resume?repoId=${repoBId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/pause?repoId=${repoBId}`, { method: 'POST' });
            await request(`${baseUrl}/api/queue/resume?repoId=${repoAId}`, { method: 'POST' });

            // Final state: A resumed, B paused
            const statsRes = await request(`${baseUrl}/api/queue/stats`);
            const statsBody = JSON.parse(statsRes.body);

            expect(statsBody.stats.pausedRepos).toContain(repoBId);
            expect(statsBody.stats.pausedRepos).not.toContain(repoAId);

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

            const fakeRepoId = computeRepoId('/nonexistent/repo');

            // Pause non-existent repo (should not error)
            const pauseRes = await request(`${baseUrl}/api/queue/pause?repoId=${fakeRepoId}`, { method: 'POST' });
            expect(pauseRes.status).toBe(200);

            // Stats should include the paused repo even with no tasks
            const statsRes = await request(`${baseUrl}/api/queue/stats`);
            const statsBody = JSON.parse(statsRes.body);
            expect(statsBody.stats.pausedRepos).toContain(fakeRepoId);

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
                    type: 'custom',
                    priority: 'normal',
                    payload: {},  // No workingDirectory
                    config: {},
                }),
            });

            // Pause the cwd-based repo
            const cwdRepoId = computeRepoId(process.cwd());
            await request(`${baseUrl}/api/queue/pause?repoId=${cwdRepoId}`, { method: 'POST' });

            // Verify pause state is tracked for the cwd-based repo
            const statsRes = await request(`${baseUrl}/api/queue/stats`);
            const statsBody = JSON.parse(statsRes.body);
            expect(statsBody.stats.pausedRepos).toContain(cwdRepoId);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });

        it('global pause overrides per-repo pause states', async () => {
            const server = await createExecutionServer({ port: 0, host: '127.0.0.1', dataDir: tmpDir });
            const baseUrl = server.url;

            const repo1Path = '/global/repo-1';
            const repo2Path = '/global/repo-2';

            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo1Path) });
            await request(`${baseUrl}/api/queue`, { method: 'POST', body: makeTaskBody(repo2Path) });

            // Pause repo-1 only
            const repo1Id = computeRepoId(repo1Path);
            await request(`${baseUrl}/api/queue/pause?repoId=${repo1Id}`, { method: 'POST' });

            // Global pause (no repoId param)
            await request(`${baseUrl}/api/queue/pause`, { method: 'POST' });

            // Stats show global pause AND per-repo pause
            const statsRes = await request(`${baseUrl}/api/queue/stats`);
            const statsBody = JSON.parse(statsRes.body);
            expect(statsBody.stats.isPaused).toBe(true);
            expect(statsBody.stats.pausedRepos).toContain(repo1Id);

            await server.close();
            fs.rmSync(tmpDir, { recursive: true, force: true });
        });
    });
});

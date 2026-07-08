/**
 * Tests for the Git worktree management routes (AC-06 cleanup backend):
 *
 *   GET  /api/workspaces/:workspaceId/worktrees
 *   POST /api/workspaces/:workspaceId/worktrees/:id/cleanup
 *
 * Exercises real Git against throwaway repos so cleanup goes through an actual
 * `git worktree remove`. Covers the AC-06 Definition of Done:
 *   - cleanup success + branch preservation
 *   - running-session disabled state (linked process + linked Ralph session)
 *   - dirty worktree failure (non-destructive, record intact)
 *   - workspace scoping (list never mixes workspaces)
 *   - flag-off behavior + not-found + idempotent already-cleaned
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createRouter } from '../../../src/server/shared/router';
import { registerWorktreeRoutes } from '../../../src/server/routes/worktree-routes';
import { GitWorktreeService } from '../../../src/server/worktree/worktree-service';
import { RalphSessionStore } from '../../../src/server/ralph/ralph-session-store';
import type { Route } from '../../../src/server/types';
import { createMockProcessStore } from '../helpers/mock-process-store';
import type { MockProcessStore } from '../helpers/mock-process-store';

// ============================================================================
// HTTP helper
// ============================================================================

function request(
    baseUrl: string,
    urlPath: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(urlPath, baseUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const bodyStr = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: bodyStr,
                        json: () => JSON.parse(bodyStr),
                    });
                });
            },
        );
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

const get = (baseUrl: string, urlPath: string) => request(baseUrl, urlPath);
const post = (baseUrl: string, urlPath: string) => request(baseUrl, urlPath, { method: 'POST' });

// ============================================================================
// Git helpers (hermetic — no global safe.directory writes)
// ============================================================================

function git(repoRoot: string, ...args: string[]): string {
    return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' }).replace(/\r?\n$/, '');
}

function initRepo(dir: string): void {
    git(dir, 'init', '-q');
    git(dir, 'config', 'user.email', 'test@test.com');
    git(dir, 'config', 'user.name', 'Test');
    git(dir, 'config', 'commit.gpgsign', 'false');
    fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n', 'utf-8');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
}

function branchExists(repoRoot: string, branch: string): boolean {
    return git(repoRoot, 'branch', '--list', branch).trim().length > 0;
}

// ============================================================================
// Tests
// ============================================================================

describe('Git worktree management routes (AC-06)', () => {
    let server: http.Server;
    let baseUrl: string;
    let store: MockProcessStore;
    let dataDir: string;
    let sourceRepo: string;
    let flagEnabled: boolean;

    const WS = 'ws-1';

    /** Create a real worktree record + checkout for WS via the service. */
    async function seedWorktree(runId: string, extra?: { processId?: string; ralphSessionId?: string; slug?: string }) {
        const svc = new GitWorktreeService({ dataDir });
        const { metadata } = await svc.createWorktree({
            workspaceId: WS,
            sourceRepoRoot: sourceRepo,
            runId,
            slug: extra?.slug ?? runId,
            processId: extra?.processId,
            ralphSessionId: extra?.ralphSessionId,
        });
        return metadata;
    }

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-routes-data-'));
        sourceRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-routes-src-'));
        initRepo(sourceRepo);

        store = createMockProcessStore({ initialWorkspaces: [{ id: WS, rootPath: sourceRepo } as any] });
        flagEnabled = true;

        const routes: Route[] = [];
        registerWorktreeRoutes(routes, {
            store,
            dataDir,
            getGitWorktreeExecutionEnabled: () => flagEnabled,
        });

        const router = createRouter({ routes, spaHtml: '' });
        server = http.createServer(router);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterEach(async () => {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        try { git(sourceRepo, 'worktree', 'prune'); } catch { /* ignore */ }
        try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
        try { fs.rmSync(sourceRepo, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    // -----------------------------------------------------------------------
    // GET list + workspace scoping
    // -----------------------------------------------------------------------

    it('lists worktrees for a workspace, newest first', async () => {
        await seedWorktree('run-a');
        await seedWorktree('run-b');

        const res = await get(baseUrl, `/api/workspaces/${WS}/worktrees`);
        expect(res.status).toBe(200);
        const ids = res.json().worktrees.map((w: any) => w.id);
        expect(ids).toEqual(expect.arrayContaining(['run-a', 'run-b']));
        expect(res.json().worktrees).toHaveLength(2);
    });

    it('scopes the list strictly to the requested workspace (no cross-workspace mixing)', async () => {
        // Seed a worktree for WS and, via the store directly, one for another ws.
        await seedWorktree('run-a');
        const otherSvc = new GitWorktreeService({ dataDir });
        // A second source repo for ws-2 so its worktree is a real record.
        const otherRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-routes-src2-'));
        initRepo(otherRepo);
        await otherSvc.createWorktree({ workspaceId: 'ws-2', sourceRepoRoot: otherRepo, runId: 'run-x' });

        const res = await get(baseUrl, `/api/workspaces/${WS}/worktrees`);
        expect(res.status).toBe(200);
        expect(res.json().worktrees.map((w: any) => w.id)).toEqual(['run-a']);

        try { git(otherRepo, 'worktree', 'prune'); } catch { /* ignore */ }
        fs.rmSync(otherRepo, { recursive: true, force: true });
    });

    it('returns an empty list when the feature flag is off', async () => {
        await seedWorktree('run-a');
        flagEnabled = false;
        const res = await get(baseUrl, `/api/workspaces/${WS}/worktrees`);
        expect(res.status).toBe(200);
        expect(res.json().worktrees).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // Cleanup success + branch preservation
    // -----------------------------------------------------------------------

    it('cleans up a worktree checkout and preserves its branch', async () => {
        const wt = await seedWorktree('run-a');
        expect(fs.existsSync(wt.path)).toBe(true);
        expect(branchExists(sourceRepo, wt.branch)).toBe(true);

        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/run-a/cleanup`);
        expect(res.status).toBe(200);
        expect(res.json().alreadyCleaned).toBe(false);
        expect(res.json().worktree.status).toBe('cleaned');
        expect(res.json().worktree.cleanedAt).toBeTruthy();

        // Checkout removed, branch preserved, record marked cleaned.
        expect(fs.existsSync(wt.path)).toBe(false);
        expect(branchExists(sourceRepo, wt.branch)).toBe(true);
        const record = await new GitWorktreeService({ dataDir }).getWorktree(WS, 'run-a');
        expect(record?.status).toBe('cleaned');
    });

    it('is idempotent when cleaning an already-cleaned worktree', async () => {
        await seedWorktree('run-a');
        const first = await post(baseUrl, `/api/workspaces/${WS}/worktrees/run-a/cleanup`);
        expect(first.status).toBe(200);
        const second = await post(baseUrl, `/api/workspaces/${WS}/worktrees/run-a/cleanup`);
        expect(second.status).toBe(200);
        expect(second.json().alreadyCleaned).toBe(true);
        expect(second.json().worktree.status).toBe('cleaned');
    });

    // -----------------------------------------------------------------------
    // Running-session disabled state
    // -----------------------------------------------------------------------

    it('refuses cleanup while a linked process is still running (409)', async () => {
        const wt = await seedWorktree('run-a', { processId: 'queue_proc-1' });
        await store.addProcess({
            id: 'queue_proc-1',
            type: 'chat',
            status: 'running',
            startTime: new Date(),
            metadata: { workspaceId: WS },
        } as any);

        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/run-a/cleanup`);
        expect(res.status).toBe(409);
        expect(res.body.toLowerCase()).toContain('running');
        // Non-destructive: checkout + record intact.
        expect(fs.existsSync(wt.path)).toBe(true);
        const record = await new GitWorktreeService({ dataDir }).getWorktree(WS, 'run-a');
        expect(record?.status).toBe('active');
    });

    it('allows cleanup once the linked process has completed', async () => {
        await seedWorktree('run-a', { processId: 'queue_proc-1' });
        await store.addProcess({
            id: 'queue_proc-1',
            type: 'chat',
            status: 'completed',
            startTime: new Date(),
            metadata: { workspaceId: WS },
        } as any);

        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/run-a/cleanup`);
        expect(res.status).toBe(200);
        expect(res.json().worktree.status).toBe('cleaned');
    });

    it('refuses cleanup while a linked Ralph session is still executing (409)', async () => {
        await seedWorktree('ralph-sess-1', { ralphSessionId: 'ralph-sess-1' });
        const journal = new RalphSessionStore({ dataDir });
        await journal.initSession(WS, 'ralph-sess-1', { originalGoal: 'goal', maxIterations: 5 });

        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/ralph-sess-1/cleanup`);
        expect(res.status).toBe(409);
        const record = await new GitWorktreeService({ dataDir }).getWorktree(WS, 'ralph-sess-1');
        expect(record?.status).toBe('active');
    });

    it('allows cleanup once the linked Ralph session is complete', async () => {
        await seedWorktree('ralph-sess-1', { ralphSessionId: 'ralph-sess-1' });
        const journal = new RalphSessionStore({ dataDir });
        await journal.initSession(WS, 'ralph-sess-1', { originalGoal: 'goal', maxIterations: 5 });
        await journal.updateSessionRecord(WS, 'ralph-sess-1', (rec) => ({
            ...rec!,
            phase: 'complete',
            terminalReason: 'RALPH_COMPLETE',
        }));

        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/ralph-sess-1/cleanup`);
        expect(res.status).toBe(200);
        expect(res.json().worktree.status).toBe('cleaned');
    });

    // -----------------------------------------------------------------------
    // Dirty worktree failure (non-destructive)
    // -----------------------------------------------------------------------

    it('refuses cleanup of a dirty worktree without forcing, leaving the record intact', async () => {
        const wt = await seedWorktree('run-a');
        // Introduce an uncommitted change inside the worktree checkout.
        fs.writeFileSync(path.join(wt.path, 'README.md'), 'dirty change\n', 'utf-8');

        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/run-a/cleanup`);
        expect(res.status).toBe(409);
        // Git error surfaced; checkout + record + branch all intact.
        expect(fs.existsSync(wt.path)).toBe(true);
        expect(branchExists(sourceRepo, wt.branch)).toBe(true);
        const record = await new GitWorktreeService({ dataDir }).getWorktree(WS, 'run-a');
        expect(record?.status).toBe('active');
    });

    // -----------------------------------------------------------------------
    // Flag off + not found
    // -----------------------------------------------------------------------

    it('rejects cleanup when the feature flag is off (400)', async () => {
        await seedWorktree('run-a');
        flagEnabled = false;
        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/run-a/cleanup`);
        expect(res.status).toBe(400);
        expect(res.body.toLowerCase()).toContain('not enabled');
    });

    it('returns 404 for an unknown worktree id', async () => {
        const res = await post(baseUrl, `/api/workspaces/${WS}/worktrees/nope/cleanup`);
        expect(res.status).toBe(404);
    });
});

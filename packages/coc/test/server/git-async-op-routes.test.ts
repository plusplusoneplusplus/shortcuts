/**
 * End-to-end coverage for the git routes that return 202 + { jobId } and settle
 * a `GitOpJob` in the background: rebase-continue, merge-continue, reword, and
 * drop-commit.
 *
 * Asserts the contract those routes share — exactly one running job per request,
 * a terminal status carrying the error, the correct `broadcastGitChanged`
 * reason, mutable cache invalidation, duplicate rejection where it applies, and
 * workspace isolation across repos.
 *
 * Mocks BranchService, the git cache, and the websocket server. No real git.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerApiRoutes } from '../../src/server/core/api-handler';
import type { Route } from '../../src/server/types';
import { createMockProcessStore } from './helpers/mock-process-store';
import type { MockProcessStore } from './helpers/mock-process-store';

const mockRebaseContinue = vi.fn();
const mockMergeContinue = vi.fn();
const mockRewordCommit = vi.fn();
const mockDropCommit = vi.fn();

vi.mock('@plusplusoneplusplus/forge', async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    return {
        ...actual,
        BranchService: vi.fn().mockImplementation(function () { return ({
            rebaseContinue: mockRebaseContinue,
            mergeContinue: mockMergeContinue,
            rewordCommit: mockRewordCommit,
            dropCommit: mockDropCommit,
            getBranchStatus: vi.fn(async () => null),
            hasUncommittedChanges: vi.fn(async () => false),
        }); }),
        detectRemoteUrl: vi.fn(async () => undefined),
    };
});

const mockInvalidateMutable = vi.fn();
vi.mock('../../src/server/git/git-cache', async (importOriginal) => {
    const actual = await importOriginal<Record<string, any>>();
    return {
        ...actual,
        gitCache: { ...actual.gitCache, invalidateMutable: (id: string) => mockInvalidateMutable(id) },
    };
});

vi.mock('child_process', function () { return { execSync: vi.fn() }; });

function request(
    url: string,
    options: { method?: string; body?: string } = {},
): Promise<{ status: number; json: () => any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname + parsed.search,
            method: options.method || 'GET',
            headers: { 'Content-Type': 'application/json' },
        }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf-8');
                resolve({ status: res.statusCode || 0, json: () => JSON.parse(body) });
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

/** Poll the ops endpoint until the job leaves `running`. */
async function waitForTerminal(base: string, wsId: string, jobId: string): Promise<any> {
    for (let attempt = 0; attempt < 50; attempt++) {
        const res = await request(`${base}/api/workspaces/${wsId}/git/ops/${jobId}`);
        const job = res.json();
        if (job.status !== 'running') return job;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`job ${jobId} never reached a terminal state`);
}

describe('Async git op routes', () => {
    let server: http.Server;
    let port: number;
    let store: MockProcessStore;
    let tmpDir: string;
    const broadcastGitChanged = vi.fn();

    const WS_A = 'ws-async-a';
    const WS_B = 'ws-async-b';
    const base = () => `http://127.0.0.1:${port}`;

    beforeAll(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'git-async-op-test-'));
        store = createMockProcessStore();
        (store.getWorkspaces as any).mockResolvedValue([
            { id: WS_A, name: 'Repo A', rootPath: path.join(tmpDir, 'a') },
            { id: WS_B, name: 'Repo B', rootPath: path.join(tmpDir, 'b') },
        ]);

        const routes: Route[] = [];
        registerApiRoutes(
            routes, store, undefined, tmpDir,
            () => ({ broadcastGitChanged } as any),
        );
        server = http.createServer(createRouter({ routes, spaHtml: '<html></html>' }));
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        port = (server.address() as any).port;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    });

    beforeEach(() => {
        mockRebaseContinue.mockReset();
        mockMergeContinue.mockReset();
        mockRewordCommit.mockReset();
        mockDropCommit.mockReset();
        mockInvalidateMutable.mockReset();
        broadcastGitChanged.mockReset();
    });

    // Each entry: route path, the BranchService mock it drives, broadcast reason,
    // request body, and whether a duplicate request is rejected with 409.
    const OPERATIONS = [
        {
            name: 'rebase-continue',
            mock: mockRebaseContinue,
            body: undefined as string | undefined,
            rejectsDuplicate: false,
            duplicateMessage: undefined as string | undefined,
        },
        {
            name: 'merge-continue',
            mock: mockMergeContinue,
            body: undefined,
            rejectsDuplicate: false,
            duplicateMessage: undefined,
        },
        {
            name: 'reword',
            mock: mockRewordCommit,
            body: JSON.stringify({ hash: 'abc1234', title: 'fix: better title' }),
            rejectsDuplicate: true,
            duplicateMessage: 'A reword operation is already running',
        },
        {
            name: 'drop-commit',
            mock: mockDropCommit,
            body: JSON.stringify({ hash: 'abc1234' }),
            rejectsDuplicate: true,
            duplicateMessage: 'A drop-commit operation is already running',
        },
    ];

    describe.each(OPERATIONS)('POST /git/$name', (op) => {
        const post = (wsId = WS_A) =>
            request(`${base()}/api/workspaces/${wsId}/git/${op.name}`, { method: 'POST', body: op.body });

        it('returns 202 with a jobId prefixed by the op name', async () => {
            op.mock.mockResolvedValue({ success: true });
            const res = await post();

            expect(res.status).toBe(202);
            expect(res.json().jobId).toMatch(new RegExp(`^${op.name}-`));
            await waitForTerminal(base(), WS_A, res.json().jobId);
        });

        it('creates exactly one running job that settles to success', async () => {
            op.mock.mockResolvedValue({ success: true });
            const { jobId } = (await post()).json();

            const job = await waitForTerminal(base(), WS_A, jobId);
            expect(job).toMatchObject({ id: jobId, workspaceId: WS_A, op: op.name, status: 'success' });
            expect(job.finishedAt).toBeTruthy();
            expect(job.pid).toBe(process.pid);

            const latest = await request(`${base()}/api/workspaces/${WS_A}/git/ops/latest?op=${op.name}`);
            expect(latest.json().id).toBe(jobId);
        });

        it('settles to failed and records the error when the operation reports failure', async () => {
            op.mock.mockResolvedValue({ success: false, error: 'CONFLICT (content)' });
            const { jobId } = (await post()).json();

            expect(await waitForTerminal(base(), WS_A, jobId)).toMatchObject({
                status: 'failed',
                error: 'CONFLICT (content)',
            });
        });

        it('settles to failed when the operation throws', async () => {
            op.mock.mockRejectedValue(new Error('git process died'));
            const { jobId } = (await post()).json();

            expect(await waitForTerminal(base(), WS_A, jobId)).toMatchObject({
                status: 'failed',
                error: 'git process died',
            });
        });

        it('invalidates the mutable cache and broadcasts with the op name as the reason', async () => {
            op.mock.mockResolvedValue({ success: true });
            const { jobId } = (await post()).json();
            await waitForTerminal(base(), WS_A, jobId);

            // `settle` writes the terminal status first and only then invalidates
            // and broadcasts, so observing the terminal job does not mean the side
            // effects have run yet. Wait for them instead of asserting immediately.
            await vi.waitFor(() => {
                expect(mockInvalidateMutable).toHaveBeenCalledWith(WS_A);
                expect(broadcastGitChanged).toHaveBeenCalledWith(WS_A, op.name);
            });
        });

        it('keeps jobs scoped to the requesting workspace', async () => {
            op.mock.mockResolvedValue({ success: true });
            const { jobId } = (await post(WS_B)).json();
            const job = await waitForTerminal(base(), WS_B, jobId);

            expect(job.workspaceId).toBe(WS_B);
            // Broadcast happens after the terminal write — see the note above.
            await vi.waitFor(() => expect(broadcastGitChanged).toHaveBeenCalledWith(WS_B, op.name));
            const crossLookup = await request(`${base()}/api/workspaces/${WS_A}/git/ops/${jobId}`);
            expect(crossLookup.status).toBe(404);
        });

        it('404s for an unknown workspace without creating a job', async () => {
            op.mock.mockResolvedValue({ success: true });
            const res = await request(`${base()}/api/workspaces/nope/git/${op.name}`, {
                method: 'POST',
                body: op.body,
            });
            expect(res.status).toBe(404);
            expect(op.mock).not.toHaveBeenCalled();
        });

        if (op.rejectsDuplicate) {
            it(`rejects a second concurrent ${op.name} with 409`, async () => {
                let release: (value: { success: boolean }) => void = () => {};
                op.mock.mockReturnValue(new Promise(resolve => { release = resolve; }));

                const first = (await post()).json();
                const second = await post();
                expect(second.status).toBe(409);
                expect(second.json().error).toBe(op.duplicateMessage);
                expect(op.mock).toHaveBeenCalledTimes(1);

                release({ success: true });
                await waitForTerminal(base(), WS_A, first.jobId);

                // Once the first job settles, a new one is accepted again.
                op.mock.mockResolvedValue({ success: true });
                const third = await post();
                expect(third.status).toBe(202);
                await waitForTerminal(base(), WS_A, third.json().jobId);
            });

            it('allows the same op to run concurrently in a different workspace', async () => {
                let release: (value: { success: boolean }) => void = () => {};
                op.mock.mockReturnValue(new Promise(resolve => { release = resolve; }));

                const first = (await post(WS_A)).json();
                const second = await post(WS_B);
                expect(second.status).toBe(202);

                release({ success: true });
                await waitForTerminal(base(), WS_A, first.jobId);
                await waitForTerminal(base(), WS_B, second.json().jobId);
            });
        } else {
            it('does not reject a concurrent request', async () => {
                op.mock.mockResolvedValue({ success: true });
                const first = await post();
                const second = await post();
                expect(first.status).toBe(202);
                expect(second.status).toBe(202);
                expect(first.json().jobId).not.toBe(second.json().jobId);
                await waitForTerminal(base(), WS_A, second.json().jobId);
            });
        }
    });

    describe('validation', () => {
        it('reword requires both hash and title', async () => {
            const noHash = await request(`${base()}/api/workspaces/${WS_A}/git/reword`, {
                method: 'POST',
                body: JSON.stringify({ title: 'x' }),
            });
            expect(noHash.status).toBe(400);
            expect(noHash.json().details).toEqual({ fields: ['hash'] });

            const blankTitle = await request(`${base()}/api/workspaces/${WS_A}/git/reword`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'abc1234', title: '   ' }),
            });
            expect(blankTitle.status).toBe(400);
            expect(blankTitle.json().details).toEqual({ fields: ['title'] });
            expect(mockRewordCommit).not.toHaveBeenCalled();
        });

        it('drop-commit requires a hash', async () => {
            const res = await request(`${base()}/api/workspaces/${WS_A}/git/drop-commit`, {
                method: 'POST',
                body: JSON.stringify({}),
            });
            expect(res.status).toBe(400);
            expect(res.json().details).toEqual({ fields: ['hash'] });
            expect(mockDropCommit).not.toHaveBeenCalled();
        });

        it('rejects a malformed JSON body before starting any work', async () => {
            const res = await request(`${base()}/api/workspaces/${WS_A}/git/drop-commit`, {
                method: 'POST',
                body: '{not json',
            });
            expect(res.status).toBe(400);
            expect(res.json().code).toBe('INVALID_JSON');
            expect(mockDropCommit).not.toHaveBeenCalled();
        });

        it('passes the validated hash and title through to BranchService', async () => {
            mockRewordCommit.mockResolvedValue({ success: true });
            const { jobId } = (await request(`${base()}/api/workspaces/${WS_A}/git/reword`, {
                method: 'POST',
                body: JSON.stringify({ hash: 'abc1234', title: 'fix: title' }),
            })).json();
            await waitForTerminal(base(), WS_A, jobId);

            expect(mockRewordCommit).toHaveBeenCalledWith(path.join(tmpDir, 'a'), 'abc1234', 'fix: title');
        });
    });
});

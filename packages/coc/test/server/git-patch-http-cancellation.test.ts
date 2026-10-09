import * as http from 'node:http';
import { Socket } from 'node:net';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalPatchRoute } from '../../src/server/routes/api-shared';
import { registerGitCommitRoutes } from '../../src/server/routes/api-git-commit-routes';
import { registerGitBranchRangeRoutes } from '../../src/server/routes/api-git-branch-range-routes';
import { registerGitWorkingTreeRoutes } from '../../src/server/routes/api-git-working-tree-routes';
import type { ApiRouteContext } from '../../src/server/routes/api-shared';
import type { Route } from '../../src/server/types';
import { gitCache } from '../../src/server/git/git-cache';
import { createMockProcessStore } from './helpers/mock-process-store';

const mocks = vi.hoisted(() => ({
    show: vi.fn(), working: vi.fn(), detect: vi.fn(), range: vi.fn(), file: vi.fn(),
}));
vi.mock('@plusplusoneplusplus/forge', async importOriginal => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/forge')>();
    return {
        ...actual,
        loadCommitShowPatch: mocks.show,
        loadWorkingTreePatch: mocks.working,
        GitRangeService: class {
            detectCommitRange = mocks.detect;
            getRangeDiff = mocks.range;
            getFileDiff = mocks.file;
        },
    };
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(ready => { resolve = ready; });
    return { promise, resolve };
}

function messages() {
    const req = new http.IncomingMessage(new Socket());
    req.url = '/patch';
    const res = new http.ServerResponse(req);
    const write = vi.spyOn(res, 'end');
    return { req, res, write };
}

afterEach(() => {
    vi.clearAllMocks();
    gitCache.invalidateMutable('one');
    gitCache.invalidateMutable('two');
});

describe('local patch response lifetime', () => {
    it.each(['success', 'failure', 'late-result', 'late-error'] as const)('retires listeners on %s', async outcome => {
        const { req, res, write } = messages();
        const ready = deferred<void>();
        let signal!: AbortSignal;
        const route = createLocalPatchRoute({
            pattern: '/patch',
            handler: async ctx => {
                signal = ctx.signal;
                await ready.promise;
                if (outcome === 'failure' || outcome === 'late-error') throw new Error('patch failed');
                return { diff: 'patch' };
            },
        });
        const pending = route.handler(req, res);
        expect(req.listenerCount('aborted')).toBe(1);
        expect(res.listenerCount('close')).toBe(1);
        // Completion of a GET body is not abandonment of its response.
        req.emit('close');
        expect(signal.aborted).toBe(false);
        if (outcome.startsWith('late')) {
            res.emit('close');
            expect(signal.reason.message).toBe('Patch HTTP request abandoned');
        }
        ready.resolve();
        await pending;
        expect(req.listenerCount('aborted')).toBe(0);
        expect(res.listenerCount('close')).toBe(0);
        expect(write).toHaveBeenCalledTimes(outcome.startsWith('late') ? 0 : 1);
        if (outcome === 'failure') expect(res.statusCode).toBe(500);
        res.emit('close');
        expect(signal.aborted).toBe(outcome.startsWith('late'));
    });

    it.each(['request-aborted', 'response-destroyed'] as const)('does not start work on an already %s connection', async state => {
        const { req, res, write } = messages();
        if (state === 'request-aborted') req.aborted = true;
        else res.destroy();
        const handler = vi.fn();
        await createLocalPatchRoute({ pattern: '/patch', handler }).handler(req, res);
        expect(handler).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(req.listenerCount('aborted')).toBe(0);
        expect(res.listenerCount('close')).toBe(0);
    });

    it('observes an aborted request and ignores a completed response close', async () => {
        for (const aborted of [false, true]) {
            const { req, res, write } = messages();
            const ready = deferred<void>();
            let signal!: AbortSignal;
            const pending = createLocalPatchRoute({
                pattern: '/patch',
                handler: async ctx => { signal = ctx.signal; await ready.promise; return { diff: '' }; },
            }).handler(req, res);
            if (aborted) req.emit('aborted');
            else {
                Object.defineProperty(res, 'writableFinished', { value: true });
                res.emit('close');
            }
            expect(signal.aborted).toBe(aborted);
            ready.resolve();
            await pending;
            expect(write).toHaveBeenCalledTimes(aborted ? 0 : 1);
        }
    });
});

const routesUnderTest = [
    ['commits/abcd/diff', mocks.show, 3],
    ['commits/abcd/files/same.txt/diff', mocks.show, 3],
    ['changes/files/same.txt/diff?stage=staged', mocks.working, 3],
    ['changes/files/same.txt/diff?stage=unstaged', mocks.working, 3],
    ['branch-range?refresh=true', mocks.detect, 1],
    ['branch-range/files', mocks.detect, 1],
    ['branch-range/diff', mocks.range, 3],
    ['branch-range/files/same.txt/diff', mocks.file, 4],
] as const;

describe('local patch HTTP route cancellation', () => {
    it.each(routesUnderTest)('cancels %s without cancelling another workspace request', async (endpoint, boundary, signalIndex) => {
        const routes: Route[] = [];
        const roots = [path.resolve('fixture-one'), path.resolve('fixture-two')];
        const store = createMockProcessStore({ initialWorkspaces: [
            { id: 'one', name: 'One', rootPath: roots[0] },
            { id: 'two', name: 'Two', rootPath: roots[1] },
        ] });
        const ctx: ApiRouteContext = { routes, store, gitOpsStore: {} as ApiRouteContext['gitOpsStore'] };
        registerGitCommitRoutes(ctx);
        registerGitBranchRangeRoutes(ctx);
        registerGitWorkingTreeRoutes(ctx);
        mocks.detect.mockResolvedValue({ baseRef: 'origin/main', files: [] });
        const ready = deferred<AbortSignal>();
        const finished = deferred<void>();
        const writes: ReturnType<typeof vi.spyOn>[] = [];
        const active: Array<{ req: http.IncomingMessage; res: http.ServerResponse }> = [];
        let liveSignal!: AbortSignal;
        boundary.mockImplementation((root: string, ...args: unknown[]) => {
            const value = args[signalIndex - 1];
            const signal = value instanceof AbortSignal ? value : (value as { signal: AbortSignal }).signal;
            if (root === roots[1]) {
                liveSignal = signal;
                return Promise.resolve(boundary === mocks.show || boundary === mocks.working
                    ? { content: { raw: 'live' } } : boundary === mocks.detect ? { baseRef: 'origin/main', files: [] } : 'live');
            }
            ready.resolve(signal);
            return new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            });
        });
        const server = http.createServer(async (req, res) => {
            active.push({ req, res });
            writes.push(vi.spyOn(res, 'end'));
            const pathname = new URL(req.url!, 'http://localhost').pathname;
            const route = routes.find(candidate => candidate.pattern instanceof RegExp && candidate.pattern.test(pathname))!;
            try { await route.handler(req, res, pathname.match(route.pattern)!); }
            finally { if (pathname.includes('/one/')) finished.resolve(); }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        if (!address || typeof address === 'string') throw new Error('Missing test server address');
        const client = http.get(`http://127.0.0.1:${address.port}/api/workspaces/one/git/${endpoint}`);
        client.on('error', () => undefined);
        try {
            const signal = await ready.promise;
            expect(signal.aborted).toBe(false);
            const live = await fetch(`http://127.0.0.1:${address.port}/api/workspaces/two/git/${endpoint}`);
            expect(live.status).toBe(200);
            await live.json();
            client.destroy();
            await finished.promise;
            expect(signal.aborted).toBe(true);
            expect(liveSignal.aborted).toBe(false);
            expect(writes[0]).not.toHaveBeenCalled();
            expect(gitCache.get('one:branch-range:default-branch')).toBeUndefined();
            for (const { req, res } of active) {
                expect(req.listenerCount('aborted')).toBe(0);
                expect(res.listenerCount('close')).toBe(0);
            }
        } finally {
            client.destroy();
            server.closeAllConnections();
            await new Promise<void>(resolve => server.close(() => resolve()));
        }
    });
});

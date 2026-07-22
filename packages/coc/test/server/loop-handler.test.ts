/**
 * Tests for Loop REST API handler (loop-handler.ts).
 *
 * Uses in-memory stubs to exercise route logic without HTTP I/O.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { LoopStore } from '../../src/server/loops/loop-store';
import { registerLoopRoutes } from '../../src/server/loops/loop-handler';
import type { LoopRouteContext } from '../../src/server/loops/loop-handler';
import type { LoopEntry } from '../../src/server/loops/loop-types';
import type { Route } from '../../src/server/types';

// ============================================================================
// Minimal HTTP stubs (in-process route dispatch)
// ============================================================================

interface FakeRes {
    statusCode: number;
    body: any;
    headers: Record<string, string>;
}

function createFakeRes(): FakeRes & {
    writeHead: (status: number, headers?: Record<string, string>) => void;
    end: (data?: string) => void;
    setHeader: (name: string, value: string) => void;
} {
    const res: any = {
        statusCode: 200,
        body: null,
        headers: {},
        writeHead(status: number, headers?: Record<string, string>) {
            res.statusCode = status;
            if (headers) Object.assign(res.headers, headers);
        },
        end(data?: string) {
            if (data) {
                try { res.body = JSON.parse(data); } catch { res.body = data; }
            }
        },
        setHeader(name: string, value: string) {
            res.headers[name.toLowerCase()] = value;
        },
    };
    return res;
}

function createFakeReq(method: string, body?: Record<string, unknown>) {
    const chunks: Buffer[] = [];
    if (body) {
        chunks.push(Buffer.from(JSON.stringify(body)));
    }
    return {
        method,
        headers: { 'content-type': 'application/json' },
        on(event: string, cb: (data?: Buffer) => void) {
            if (event === 'data') {
                for (const c of chunks) cb(c);
            }
            if (event === 'end') cb();
            return this;
        },
    } as any;
}

// Find and call a route handler
async function dispatch(
    routes: Route[],
    method: string,
    path: string,
    body?: Record<string, unknown>,
): Promise<FakeRes> {
    const route = routes.find(r => r.method === method && r.pattern.test(path));
    if (!route) throw new Error(`No route matched ${method} ${path}`);
    const match = path.match(route.pattern);
    const res = createFakeRes();
    const req = createFakeReq(method, body);
    await route.handler(req, res as any, match);
    return res;
}

// ============================================================================
// Test helpers
// ============================================================================

function makeLoop(overrides: Partial<LoopEntry> = {}): LoopEntry {
    return {
        id: `loop_${Math.random().toString(36).slice(2, 8)}`,
        processId: 'proc_test',
        description: 'Test loop',
        intervalMs: 60_000,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastTickAt: null,
        nextTickAt: new Date(Date.now() + 60_000).toISOString(),
        tickCount: 0,
        consecutiveFailures: 0,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        pausedReason: null,
        prompt: 'Check status',
        model: null,
        ...overrides,
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('Loop REST API Handler', () => {
    let db: Database.Database;
    let store: LoopStore;
    let routes: Route[];
    let mockExecutor: any;
    let resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    let emit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new LoopStore(db);
        routes = [];

        mockExecutor = {
            armTimer: vi.fn(),
            disarmTimer: vi.fn(),
        };

        resolveWorkspaceId = vi.fn(async (processId: string) => {
            if (processId.startsWith('proc_ws1')) return 'ws1';
            if (processId.startsWith('proc_ws2')) return 'ws2';
            if (processId === 'proc_test') return 'ws1';
            return undefined;
        });

        emit = vi.fn();
        const ctx: LoopRouteContext = { store, executor: mockExecutor, emit, resolveWorkspaceId };
        registerLoopRoutes(routes, ctx);
    });

    // ========================================================================
    // GET /api/workspaces/:id/loops
    // ========================================================================

    describe('GET /api/workspaces/:id/loops', () => {
        it('returns empty array when no loops exist', async () => {
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops');
            expect(res.statusCode).toBe(200);
            expect(res.body.loops).toEqual([]);
        });

        it('returns only loops for the given workspace', async () => {
            const l1 = makeLoop({ id: 'loop_1', processId: 'proc_ws1_a', workspaceId: 'ws1' });
            const l2 = makeLoop({ id: 'loop_2', processId: 'proc_ws2_a', workspaceId: 'ws2' });
            const l3 = makeLoop({ id: 'loop_3', processId: 'proc_ws1_b', workspaceId: 'ws1' });
            store.insert(l1);
            store.insert(l2);
            store.insert(l3);

            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops');
            expect(res.statusCode).toBe(200);
            expect(res.body.loops).toHaveLength(2);
            const ids = res.body.loops.map((l: any) => l.id);
            expect(ids).toContain('loop_1');
            expect(ids).toContain('loop_3');
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/loops/:loopId
    // ========================================================================

    describe('GET /api/workspaces/:id/loops/:loopId', () => {
        it('returns a loop by ID', async () => {
            const loop = makeLoop({ id: 'loop_x' });
            store.insert(loop);
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops/loop_x');
            expect(res.statusCode).toBe(200);
            expect(res.body.loop.id).toBe('loop_x');
            expect(res.body.loop.prompt).toBe('Check status');
        });

        it('returns 404 for unknown loop', async () => {
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops/nonexistent');
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/loops/:loopId
    // ========================================================================

    describe('PATCH /api/workspaces/:id/loops/:loopId', () => {
        it('updates description and prompt', async () => {
            const loop = makeLoop({ id: 'loop_p' });
            store.insert(loop);

            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/loops/loop_p', {
                description: 'Updated desc',
                prompt: 'New prompt',
            });
            expect(res.statusCode).toBe(200);
            expect(res.body.loop.description).toBe('Updated desc');
            expect(res.body.loop.prompt).toBe('New prompt');

            // Verify persisted
            const updated = store.getById('loop_p')!;
            expect(updated.description).toBe('Updated desc');
        });

        it('rejects invalid intervalMs', async () => {
            const loop = makeLoop({ id: 'loop_inv' });
            store.insert(loop);

            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/loops/loop_inv', {
                intervalMs: 5000,
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 for unknown loop', async () => {
            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/loops/nope', {
                description: 'x',
            });
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/loops/:loopId
    // ========================================================================

    describe('DELETE /api/workspaces/:id/loops/:loopId', () => {
        it('cancels and marks the loop', async () => {
            const loop = makeLoop({ id: 'loop_d' });
            store.insert(loop);

            const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/loops/loop_d');
            expect(res.statusCode).toBe(200);
            expect(res.body.deleted).toBe(true);
            expect(res.body.loop.status).toBe('cancelled');

            expect(mockExecutor.disarmTimer).toHaveBeenCalledWith('loop_d');
            expect(store.getById('loop_d')!.status).toBe('cancelled');
        });

        it('returns 404 for unknown loop', async () => {
            const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/loops/nope');
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/loops/:loopId/pause
    // ========================================================================

    describe('POST pause', () => {
        it('pauses an active loop', async () => {
            const loop = makeLoop({ id: 'loop_pa', status: 'active' });
            store.insert(loop);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_pa/pause', {
                reason: 'manual pause',
            });
            expect(res.statusCode).toBe(200);
            expect(res.body.loop.status).toBe('paused');
            expect(res.body.loop.pausedReason).toBe('manual pause');
            expect(mockExecutor.disarmTimer).toHaveBeenCalledWith('loop_pa');
        });

        it('rejects pausing a non-active loop', async () => {
            const loop = makeLoop({ id: 'loop_pa2', status: 'paused', pausedReason: 'test' });
            store.insert(loop);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_pa2/pause', {});
            expect(res.statusCode).toBe(400);
        });

        it('uses default reason when none provided', async () => {
            const loop = makeLoop({ id: 'loop_pa3', status: 'active' });
            store.insert(loop);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_pa3/pause', {});
            expect(res.statusCode).toBe(200);
            expect(res.body.loop.pausedReason).toBe('user-paused');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/loops/:loopId/resume
    // ========================================================================

    describe('POST resume', () => {
        it('resumes a paused loop and arms timer', async () => {
            const loop = makeLoop({ id: 'loop_r', status: 'paused', pausedReason: 'server-restart' });
            store.insert(loop);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_r/resume');
            expect(res.statusCode).toBe(200);
            expect(res.body.loop.status).toBe('active');
            expect(res.body.loop.pausedReason).toBeNull();
            expect(res.body.loop.consecutiveFailures).toBe(0);
            expect(res.body.loop.nextTickAt).toBeTruthy();
            expect(mockExecutor.armTimer).toHaveBeenCalled();
        });

        it('rejects resuming an active loop', async () => {
            const loop = makeLoop({ id: 'loop_r2', status: 'active' });
            store.insert(loop);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_r2/resume');
            expect(res.statusCode).toBe(400);
        });

        it('rejects resuming an expired loop', async () => {
            const loop = makeLoop({
                id: 'loop_r3',
                status: 'paused',
                pausedReason: 'test',
                expiresAt: new Date(Date.now() - 1000).toISOString(),
            });
            store.insert(loop);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_r3/resume');
            expect(res.statusCode).toBe(400);
            // Verify the loop was marked expired
            expect(store.getById('loop_r3')!.status).toBe('expired');
        });
    });

    // ========================================================================
    // GET /api/loops (server-wide)
    // ========================================================================

    describe('GET /api/loops (server-wide)', () => {
        it('returns all loops across workspaces', async () => {
            store.insert(makeLoop({ id: 'loop_a', processId: 'proc_ws1_a', workspaceId: 'ws1' }));
            store.insert(makeLoop({ id: 'loop_b', processId: 'proc_ws2_a', workspaceId: 'ws2' }));

            const res = await dispatch(routes, 'GET', '/api/loops');
            expect(res.statusCode).toBe(200);
            expect(res.body.loops).toHaveLength(2);
        });
    });

    // ========================================================================
    // GET /api/loops/:loopId (server-wide)
    // ========================================================================

    describe('GET /api/loops/:loopId (server-wide)', () => {
        it('returns a loop by ID', async () => {
            store.insert(makeLoop({ id: 'loop_sw' }));

            const res = await dispatch(routes, 'GET', '/api/loops/loop_sw');
            expect(res.statusCode).toBe(200);
            expect(res.body.loop.id).toBe('loop_sw');
        });

        it('returns 404 for unknown loop', async () => {
            const res = await dispatch(routes, 'GET', '/api/loops/nope');
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // workspaceId stored-column filter
    // ========================================================================

    describe('workspaceId stored-column filter', () => {
        it('workspace filter uses stored workspaceId, not resolver', async () => {
            // Insert loops with explicit workspaceId — resolver is not called
            store.insert(makeLoop({ id: 'loop_ws1', processId: 'proc_a', workspaceId: 'ws1' }));
            store.insert(makeLoop({ id: 'loop_ws2', processId: 'proc_b', workspaceId: 'ws2' }));
            store.insert(makeLoop({ id: 'loop_noWs', processId: 'proc_c' })); // legacy, no workspaceId

            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops');
            expect(res.statusCode).toBe(200);
            expect(res.body.loops).toHaveLength(1);
            expect(res.body.loops[0].id).toBe('loop_ws1');

            // The resolver should NOT be called (it's no longer part of the context)
            expect(resolveWorkspaceId).not.toHaveBeenCalled();
        });

        it('includes workspaceId in serialized response', async () => {
            store.insert(makeLoop({ id: 'loop_serial', workspaceId: 'ws-xyz' }));

            const res = await dispatch(routes, 'GET', '/api/workspaces/ws-xyz/loops');
            expect(res.statusCode).toBe(200);
            expect(res.body.loops[0].workspaceId).toBe('ws-xyz');
        });

        it('omits workspaceId from response when not set', async () => {
            store.insert(makeLoop({ id: 'loop_noWs' }));

            const res = await dispatch(routes, 'GET', '/api/loops/loop_noWs');
            expect(res.statusCode).toBe(200);
            expect(res.body.loop.workspaceId).toBeUndefined();
        });

        it('multi-repo isolation — loop in ws-A not visible from ws-B', async () => {
            store.insert(makeLoop({ id: 'loop_a', workspaceId: 'ws-A' }));
            store.insert(makeLoop({ id: 'loop_b', workspaceId: 'ws-B' }));

            const resA = await dispatch(routes, 'GET', '/api/workspaces/ws-A/loops');
            const resB = await dispatch(routes, 'GET', '/api/workspaces/ws-B/loops');

            expect(resA.body.loops).toHaveLength(1);
            expect(resA.body.loops[0].id).toBe('loop_a');
            expect(resB.body.loops).toHaveLength(1);
            expect(resB.body.loops[0].id).toBe('loop_b');
        });
    });
});

// ============================================================================
// Workspace boundary — item-level routes must not cross workspaces
// ============================================================================

describe('Loop REST API Handler — workspace boundary', () => {
    let db: Database.Database;
    let store: LoopStore;
    let routes: Route[];
    let mockExecutor: any;
    let resolveWorkspaceId: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new LoopStore(db);
        routes = [];
        mockExecutor = { armTimer: vi.fn(), disarmTimer: vi.fn() };
        resolveWorkspaceId = vi.fn(async (processId: string) => {
            if (processId.startsWith('proc_ws1')) return 'ws1';
            if (processId.startsWith('proc_ws2')) return 'ws2';
            return undefined;
        });
        registerLoopRoutes(routes, { store, executor: mockExecutor, resolveWorkspaceId });
    });

    it('GET item route returns 404 for a loop owned by another workspace', async () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_ws1_a', workspaceId: 'ws1' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws2/loops/loop_a');
        expect(res.statusCode).toBe(404);
    });

    it('PATCH does not mutate a loop owned by another workspace', async () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_ws1_a', workspaceId: 'ws1', description: 'orig' }));
        const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws2/loops/loop_a', { description: 'hacked' });
        expect(res.statusCode).toBe(404);
        expect(store.getById('loop_a')!.description).toBe('orig');
    });

    it('DELETE does not cancel a loop owned by another workspace', async () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_ws1_a', workspaceId: 'ws1', status: 'active' }));
        const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws2/loops/loop_a');
        expect(res.statusCode).toBe(404);
        expect(store.getById('loop_a')!.status).toBe('active');
        expect(mockExecutor.disarmTimer).not.toHaveBeenCalled();
    });

    it('POST pause does not pause a loop owned by another workspace', async () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_ws1_a', workspaceId: 'ws1', status: 'active' }));
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws2/loops/loop_a/pause', {});
        expect(res.statusCode).toBe(404);
        expect(store.getById('loop_a')!.status).toBe('active');
    });

    it('POST resume does not resume a loop owned by another workspace', async () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_ws1_a', workspaceId: 'ws1', status: 'paused', pausedReason: 'test' }));
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws2/loops/loop_a/resume');
        expect(res.statusCode).toBe(404);
        expect(store.getById('loop_a')!.status).toBe('paused');
        expect(mockExecutor.armTimer).not.toHaveBeenCalled();
    });

    it('the owning workspace can still operate on its own loop', async () => {
        store.insert(makeLoop({ id: 'loop_a', processId: 'proc_ws1_a', workspaceId: 'ws1' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops/loop_a');
        expect(res.statusCode).toBe(200);
        expect(res.body.loop.id).toBe('loop_a');
    });

    it('backfills workspaceId for a legacy loop resolved via its process, then scopes it', async () => {
        // Legacy row with no persisted workspaceId; its process resolves to ws1.
        store.insert(makeLoop({ id: 'loop_legacy', processId: 'proc_ws1_legacy' }));

        // ws2 cannot reach it (process resolves to ws1).
        const wrong = await dispatch(routes, 'GET', '/api/workspaces/ws2/loops/loop_legacy');
        expect(wrong.statusCode).toBe(404);

        // ws1 reaches it and the workspaceId is backfilled + persisted.
        const ok = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops/loop_legacy');
        expect(ok.statusCode).toBe(200);
        expect(store.getById('loop_legacy')!.workspaceId).toBe('ws1');
    });

    it('legacy loop with an unresolvable process is 404 from every workspace route', async () => {
        store.insert(makeLoop({ id: 'loop_orphan', processId: 'proc_unknown' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/loops/loop_orphan');
        expect(res.statusCode).toBe(404);
    });
});

// ============================================================================
// Event emission via `emit` callback
// ============================================================================

describe('Loop REST API Handler — event emission', () => {
    let db: Database.Database;
    let store: LoopStore;
    let routes: Route[];
    let mockExecutor: any;
    let emit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new LoopStore(db);
        routes = [];
        mockExecutor = { armTimer: vi.fn(), disarmTimer: vi.fn() };
        emit = vi.fn();
        registerLoopRoutes(routes, { store, executor: mockExecutor, emit });
    });

    function insert(loop: LoopEntry) { store.insert(loop); }

    it('emits loop-paused after POST pause', async () => {
        const loop = makeLoop({ id: 'loop_e1', status: 'active', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(loop);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_e1/pause', { reason: 'user-paused' });
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('loop-paused');
        expect(evt.loop.id).toBe('loop_e1');
        expect(evt.loop.processId).toBe('proc_ws1_a');
        expect(evt.loop.workspaceId).toBe('ws1');
        expect(evt.loop.status).toBe('paused');
    });

    it('emits loop-resumed after POST resume', async () => {
        const loop = makeLoop({ id: 'loop_e2', status: 'paused', pausedReason: 'test', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(loop);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_e2/resume');
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('loop-resumed');
        expect(evt.loop.id).toBe('loop_e2');
        expect(evt.loop.status).toBe('active');
        expect(evt.loop.workspaceId).toBe('ws1');
    });

    it('emits loop-cancelled after DELETE', async () => {
        const loop = makeLoop({ id: 'loop_e3', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(loop);
        const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/loops/loop_e3');
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('loop-cancelled');
        expect(evt.loop.id).toBe('loop_e3');
        expect(evt.loop.status).toBe('cancelled');
    });

    it('emits loop-updated after PATCH', async () => {
        const loop = makeLoop({ id: 'loop_e4', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(loop);
        const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/loops/loop_e4', { description: 'new' });
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0].type).toBe('loop-updated');
    });

    it('emits loop-expired when resuming an already-expired loop', async () => {
        const loop = makeLoop({
            id: 'loop_e5',
            status: 'paused',
            pausedReason: 'test',
            processId: 'proc_ws1_a',
            workspaceId: 'ws1',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        });
        insert(loop);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_e5/resume');
        expect(res.statusCode).toBe(400);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0].type).toBe('loop-expired');
    });

    it('does not throw when emit callback throws', async () => {
        emit.mockImplementation(() => { throw new Error('boom'); });
        const loop = makeLoop({ id: 'loop_e6', status: 'active', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(loop);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/loops/loop_e6/pause', {});
        expect(res.statusCode).toBe(200);
        expect(res.body.loop.status).toBe('paused');
    });

    it('still succeeds when no emit callback is provided', async () => {
        const routesNoEmit: Route[] = [];
        registerLoopRoutes(routesNoEmit, { store, executor: mockExecutor });
        const loop = makeLoop({ id: 'loop_e7', status: 'active', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(loop);
        const res = await dispatch(routesNoEmit, 'POST', '/api/workspaces/ws1/loops/loop_e7/pause', {});
        expect(res.statusCode).toBe(200);
    });
});
/**
 * Tests for Cron REST API handler (cron-handler.ts).
 *
 * Uses in-memory stubs to exercise route logic without HTTP I/O.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { CronStore } from '../../src/server/cron/cron-store';
import { registerCronRoutes } from '../../src/server/cron/cron-handler';
import type { CronRouteContext } from '../../src/server/cron/cron-handler';
import type { CronEntry } from '../../src/server/cron/cron-types';
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

function makeCron(overrides: Partial<CronEntry> = {}): CronEntry {
    return {
        id: `cron_${Math.random().toString(36).slice(2, 8)}`,
        processId: 'proc_test',
        description: 'Test cron',
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

describe('Cron REST API Handler', () => {
    let db: Database.Database;
    let store: CronStore;
    let routes: Route[];
    let mockExecutor: any;
    let resolveWorkspaceId: (processId: string) => Promise<string | undefined>;
    let emit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new CronStore(db);
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
        const ctx: CronRouteContext = { store, executor: mockExecutor, emit, resolveWorkspaceId };
        registerCronRoutes(routes, ctx);
    });

    // ========================================================================
    // GET /api/workspaces/:id/cronss
    // ========================================================================

    describe('GET /api/workspaces/:id/crons', () => {
        it('returns empty array when no crons exist', async () => {
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons');
            expect(res.statusCode).toBe(200);
            expect(res.body.crons).toEqual([]);
        });

        it('returns only crons for the given workspace', async () => {
            const l1 = makeCron({ id: 'cron_1', processId: 'proc_ws1_a', workspaceId: 'ws1' });
            const l2 = makeCron({ id: 'cron_2', processId: 'proc_ws2_a', workspaceId: 'ws2' });
            const l3 = makeCron({ id: 'cron_3', processId: 'proc_ws1_b', workspaceId: 'ws1' });
            store.insert(l1);
            store.insert(l2);
            store.insert(l3);

            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons');
            expect(res.statusCode).toBe(200);
            expect(res.body.crons).toHaveLength(2);
            const ids = res.body.crons.map((l: any) => l.id);
            expect(ids).toContain('cron_1');
            expect(ids).toContain('cron_3');
        });
    });

    // ========================================================================
    // GET /api/workspaces/:id/crons/:cronId
    // ========================================================================

    describe('GET /api/workspaces/:id/crons/:cronId', () => {
        it('returns a cron by ID', async () => {
            const cron = makeCron({ id: 'cron_x' });
            store.insert(cron);
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons/cron_x');
            expect(res.statusCode).toBe(200);
            expect(res.body.cron.id).toBe('cron_x');
            expect(res.body.cron.prompt).toBe('Check status');
        });

        it('returns 404 for unknown cron', async () => {
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons/nonexistent');
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // PATCH /api/workspaces/:id/crons/:cronId
    // ========================================================================

    describe('PATCH /api/workspaces/:id/crons/:cronId', () => {
        it('updates description and prompt', async () => {
            const cron = makeCron({ id: 'cron_p' });
            store.insert(cron);

            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/crons/cron_p', {
                description: 'Updated desc',
                prompt: 'New prompt',
            });
            expect(res.statusCode).toBe(200);
            expect(res.body.cron.description).toBe('Updated desc');
            expect(res.body.cron.prompt).toBe('New prompt');

            // Verify persisted
            const updated = store.getById('cron_p')!;
            expect(updated.description).toBe('Updated desc');
        });

        it('rejects invalid intervalMs', async () => {
            const cron = makeCron({ id: 'cron_inv' });
            store.insert(cron);

            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/crons/cron_inv', {
                intervalMs: 5000,
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 for unknown cron', async () => {
            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/crons/nope', {
                description: 'x',
            });
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // DELETE /api/workspaces/:id/crons/:cronId
    // ========================================================================

    describe('DELETE /api/workspaces/:id/crons/:cronId', () => {
        it('cancels and marks the cron', async () => {
            const cron = makeCron({ id: 'cron_d' });
            store.insert(cron);

            const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/crons/cron_d');
            expect(res.statusCode).toBe(200);
            expect(res.body.deleted).toBe(true);
            expect(res.body.cron.status).toBe('cancelled');

            expect(mockExecutor.disarmTimer).toHaveBeenCalledWith('cron_d');
            expect(store.getById('cron_d')!.status).toBe('cancelled');
        });

        it('returns 404 for unknown cron', async () => {
            const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/crons/nope');
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/crons/:cronId/pause
    // ========================================================================

    describe('POST pause', () => {
        it('pauses an active cron', async () => {
            const cron = makeCron({ id: 'cron_pa', status: 'active' });
            store.insert(cron);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_pa/pause', {
                reason: 'manual pause',
            });
            expect(res.statusCode).toBe(200);
            expect(res.body.cron.status).toBe('paused');
            expect(res.body.cron.pausedReason).toBe('manual pause');
            expect(mockExecutor.disarmTimer).toHaveBeenCalledWith('cron_pa');
        });

        it('rejects pausing a non-active cron', async () => {
            const cron = makeCron({ id: 'cron_pa2', status: 'paused', pausedReason: 'test' });
            store.insert(cron);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_pa2/pause', {});
            expect(res.statusCode).toBe(400);
        });

        it('uses default reason when none provided', async () => {
            const cron = makeCron({ id: 'cron_pa3', status: 'active' });
            store.insert(cron);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_pa3/pause', {});
            expect(res.statusCode).toBe(200);
            expect(res.body.cron.pausedReason).toBe('user-paused');
        });
    });

    // ========================================================================
    // POST /api/workspaces/:id/crons/:cronId/resume
    // ========================================================================

    describe('POST resume', () => {
        it('resumes a paused cron and arms timer', async () => {
            const cron = makeCron({ id: 'cron_r', status: 'paused', pausedReason: 'server-restart' });
            store.insert(cron);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_r/resume');
            expect(res.statusCode).toBe(200);
            expect(res.body.cron.status).toBe('active');
            expect(res.body.cron.pausedReason).toBeNull();
            expect(res.body.cron.consecutiveFailures).toBe(0);
            expect(res.body.cron.nextTickAt).toBeTruthy();
            expect(mockExecutor.armTimer).toHaveBeenCalled();
        });

        it('rejects resuming an active cron', async () => {
            const cron = makeCron({ id: 'cron_r2', status: 'active' });
            store.insert(cron);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_r2/resume');
            expect(res.statusCode).toBe(400);
        });

        it('rejects resuming an expired cron', async () => {
            const cron = makeCron({
                id: 'cron_r3',
                status: 'paused',
                pausedReason: 'test',
                expiresAt: new Date(Date.now() - 1000).toISOString(),
            });
            store.insert(cron);

            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_r3/resume');
            expect(res.statusCode).toBe(400);
            // Verify the cron was marked expired
            expect(store.getById('cron_r3')!.status).toBe('expired');
        });
    });

    // ========================================================================
    // GET /api/crons (server-wide)
    // ========================================================================

    describe('GET /api/crons (server-wide)', () => {
        it('returns all crons across workspaces', async () => {
            store.insert(makeCron({ id: 'cron_a', processId: 'proc_ws1_a', workspaceId: 'ws1' }));
            store.insert(makeCron({ id: 'cron_b', processId: 'proc_ws2_a', workspaceId: 'ws2' }));

            const res = await dispatch(routes, 'GET', '/api/crons');
            expect(res.statusCode).toBe(200);
            expect(res.body.crons).toHaveLength(2);
        });
    });

    // ========================================================================
    // GET /api/crons/:cronId (server-wide)
    // ========================================================================

    describe('GET /api/crons/:cronId (server-wide)', () => {
        it('returns a cron by ID', async () => {
            store.insert(makeCron({ id: 'cron_sw' }));

            const res = await dispatch(routes, 'GET', '/api/crons/cron_sw');
            expect(res.statusCode).toBe(200);
            expect(res.body.cron.id).toBe('cron_sw');
        });

        it('returns 404 for unknown cron', async () => {
            const res = await dispatch(routes, 'GET', '/api/crons/nope');
            expect(res.statusCode).toBe(404);
        });
    });

    // ========================================================================
    // workspaceId stored-column filter
    // ========================================================================

    describe('workspaceId stored-column filter', () => {
        it('workspace filter uses stored workspaceId, not resolver', async () => {
            // Insert crons with explicit workspaceId — resolver is not called
            store.insert(makeCron({ id: 'cron_ws1', processId: 'proc_a', workspaceId: 'ws1' }));
            store.insert(makeCron({ id: 'cron_ws2', processId: 'proc_b', workspaceId: 'ws2' }));
            store.insert(makeCron({ id: 'cron_noWs', processId: 'proc_c' })); // legacy, no workspaceId

            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons');
            expect(res.statusCode).toBe(200);
            expect(res.body.crons).toHaveLength(1);
            expect(res.body.crons[0].id).toBe('cron_ws1');

            // The resolver should NOT be called (it's no longer part of the context)
            expect(resolveWorkspaceId).not.toHaveBeenCalled();
        });

        it('includes workspaceId in serialized response', async () => {
            store.insert(makeCron({ id: 'cron_serial', workspaceId: 'ws-xyz' }));

            const res = await dispatch(routes, 'GET', '/api/workspaces/ws-xyz/crons');
            expect(res.statusCode).toBe(200);
            expect(res.body.crons[0].workspaceId).toBe('ws-xyz');
        });

        it('omits workspaceId from response when not set', async () => {
            store.insert(makeCron({ id: 'cron_noWs' }));

            const res = await dispatch(routes, 'GET', '/api/crons/cron_noWs');
            expect(res.statusCode).toBe(200);
            expect(res.body.cron.workspaceId).toBeUndefined();
        });

        it('multi-repo isolation — cron in ws-A not visible from ws-B', async () => {
            store.insert(makeCron({ id: 'cron_a', workspaceId: 'ws-A' }));
            store.insert(makeCron({ id: 'cron_b', workspaceId: 'ws-B' }));

            const resA = await dispatch(routes, 'GET', '/api/workspaces/ws-A/crons');
            const resB = await dispatch(routes, 'GET', '/api/workspaces/ws-B/crons');

            expect(resA.body.crons).toHaveLength(1);
            expect(resA.body.crons[0].id).toBe('cron_a');
            expect(resB.body.crons).toHaveLength(1);
            expect(resB.body.crons[0].id).toBe('cron_b');
        });
    });
});

// ============================================================================
// Workspace boundary — item-level routes must not cross workspaces
// ============================================================================

describe('Cron REST API Handler — workspace boundary', () => {
    let db: Database.Database;
    let store: CronStore;
    let routes: Route[];
    let mockExecutor: any;
    let resolveWorkspaceId: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new CronStore(db);
        routes = [];
        mockExecutor = { armTimer: vi.fn(), disarmTimer: vi.fn() };
        resolveWorkspaceId = vi.fn(async (processId: string) => {
            if (processId.startsWith('proc_ws1')) return 'ws1';
            if (processId.startsWith('proc_ws2')) return 'ws2';
            return undefined;
        });
        registerCronRoutes(routes, { store, executor: mockExecutor, resolveWorkspaceId });
    });

    it('GET item route returns 404 for a cron owned by another workspace', async () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_ws1_a', workspaceId: 'ws1' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws2/crons/cron_a');
        expect(res.statusCode).toBe(404);
    });

    it('PATCH does not mutate a cron owned by another workspace', async () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_ws1_a', workspaceId: 'ws1', description: 'orig' }));
        const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws2/crons/cron_a', { description: 'hacked' });
        expect(res.statusCode).toBe(404);
        expect(store.getById('cron_a')!.description).toBe('orig');
    });

    it('DELETE does not cancel a cron owned by another workspace', async () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_ws1_a', workspaceId: 'ws1', status: 'active' }));
        const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws2/crons/cron_a');
        expect(res.statusCode).toBe(404);
        expect(store.getById('cron_a')!.status).toBe('active');
        expect(mockExecutor.disarmTimer).not.toHaveBeenCalled();
    });

    it('POST pause does not pause a cron owned by another workspace', async () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_ws1_a', workspaceId: 'ws1', status: 'active' }));
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws2/crons/cron_a/pause', {});
        expect(res.statusCode).toBe(404);
        expect(store.getById('cron_a')!.status).toBe('active');
    });

    it('POST resume does not resume a cron owned by another workspace', async () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_ws1_a', workspaceId: 'ws1', status: 'paused', pausedReason: 'test' }));
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws2/crons/cron_a/resume');
        expect(res.statusCode).toBe(404);
        expect(store.getById('cron_a')!.status).toBe('paused');
        expect(mockExecutor.armTimer).not.toHaveBeenCalled();
    });

    it('the owning workspace can still operate on its own cron', async () => {
        store.insert(makeCron({ id: 'cron_a', processId: 'proc_ws1_a', workspaceId: 'ws1' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons/cron_a');
        expect(res.statusCode).toBe(200);
        expect(res.body.cron.id).toBe('cron_a');
    });

    it('backfills workspaceId for a legacy cron resolved via its process, then scopes it', async () => {
        // Legacy row with no persisted workspaceId; its process resolves to ws1.
        store.insert(makeCron({ id: 'cron_legacy', processId: 'proc_ws1_legacy' }));

        // ws2 cannot reach it (process resolves to ws1).
        const wrong = await dispatch(routes, 'GET', '/api/workspaces/ws2/crons/cron_legacy');
        expect(wrong.statusCode).toBe(404);

        // ws1 reaches it and the workspaceId is backfilled + persisted.
        const ok = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons/cron_legacy');
        expect(ok.statusCode).toBe(200);
        expect(store.getById('cron_legacy')!.workspaceId).toBe('ws1');
    });

    it('legacy cron with an unresolvable process is 404 from every workspace route', async () => {
        store.insert(makeCron({ id: 'cron_orphan', processId: 'proc_unknown' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/crons/cron_orphan');
        expect(res.statusCode).toBe(404);
    });
});

// ============================================================================
// Event emission via `emit` callback
// ============================================================================

describe('Cron REST API Handler — event emission', () => {
    let db: Database.Database;
    let store: CronStore;
    let routes: Route[];
    let mockExecutor: any;
    let emit: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new CronStore(db);
        routes = [];
        mockExecutor = { armTimer: vi.fn(), disarmTimer: vi.fn() };
        emit = vi.fn();
        registerCronRoutes(routes, { store, executor: mockExecutor, emit });
    });

    function insert(cron: CronEntry) { store.insert(cron); }

    it('emits cron-paused after POST pause', async () => {
        const cron = makeCron({ id: 'cron_e1', status: 'active', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(cron);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_e1/pause', { reason: 'user-paused' });
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('cron-paused');
        expect(evt.cron.id).toBe('cron_e1');
        expect(evt.cron.processId).toBe('proc_ws1_a');
        expect(evt.cron.workspaceId).toBe('ws1');
        expect(evt.cron.status).toBe('paused');
    });

    it('emits cron-resumed after POST resume', async () => {
        const cron = makeCron({ id: 'cron_e2', status: 'paused', pausedReason: 'test', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(cron);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_e2/resume');
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('cron-resumed');
        expect(evt.cron.id).toBe('cron_e2');
        expect(evt.cron.status).toBe('active');
        expect(evt.cron.workspaceId).toBe('ws1');
    });

    it('emits cron-cancelled after DELETE', async () => {
        const cron = makeCron({ id: 'cron_e3', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(cron);
        const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/crons/cron_e3');
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        const evt = emit.mock.calls[0][0];
        expect(evt.type).toBe('cron-cancelled');
        expect(evt.cron.id).toBe('cron_e3');
        expect(evt.cron.status).toBe('cancelled');
    });

    it('emits cron-updated after PATCH', async () => {
        const cron = makeCron({ id: 'cron_e4', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(cron);
        const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/crons/cron_e4', { description: 'new' });
        expect(res.statusCode).toBe(200);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0].type).toBe('cron-updated');
    });

    it('emits cron-expired when resuming an already-expired cron', async () => {
        const cron = makeCron({
            id: 'cron_e5',
            status: 'paused',
            pausedReason: 'test',
            processId: 'proc_ws1_a',
            workspaceId: 'ws1',
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        });
        insert(cron);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_e5/resume');
        expect(res.statusCode).toBe(400);
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit.mock.calls[0][0].type).toBe('cron-expired');
    });

    it('does not throw when emit callback throws', async () => {
        emit.mockImplementation(() => { throw new Error('boom'); });
        const cron = makeCron({ id: 'cron_e6', status: 'active', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(cron);
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/crons/cron_e6/pause', {});
        expect(res.statusCode).toBe(200);
        expect(res.body.cron.status).toBe('paused');
    });

    it('still succeeds when no emit callback is provided', async () => {
        const routesNoEmit: Route[] = [];
        registerCronRoutes(routesNoEmit, { store, executor: mockExecutor });
        const cron = makeCron({ id: 'cron_e7', status: 'active', processId: 'proc_ws1_a', workspaceId: 'ws1' });
        insert(cron);
        const res = await dispatch(routesNoEmit, 'POST', '/api/workspaces/ws1/crons/cron_e7/pause', {});
        expect(res.statusCode).toBe(200);
    });
});
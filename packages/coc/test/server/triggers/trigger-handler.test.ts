/**
 * Tests for Trigger REST API handler (trigger-handler.ts).
 *
 * Uses in-memory stubs to exercise route logic without HTTP I/O, mirroring
 * loop-handler.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { TriggerStore } from '../../../src/server/triggers/trigger-store';
import { registerTriggerRoutes, validateCreateTriggerBody } from '../../../src/server/triggers/trigger-handler';
import type { TriggerRouteContext } from '../../../src/server/triggers/trigger-handler';
import type { Trigger } from '../../../src/server/triggers/trigger-types';
import type { Route } from '../../../src/server/types';

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

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
    return {
        id: `trigger_${Math.random().toString(36).slice(2, 8)}`,
        workspaceId: 'ws1',
        processId: 'queue_proc1',
        status: 'active',
        event: {
            type: 'condition-monitor',
            monitor: 'ci-failure',
            originId: 'origin1',
            prId: '42',
            pollIntervalMs: 60_000,
            lastSeenChecks: {},
        },
        action: { type: 'send-message', processId: 'queue_proc1', prompt: '', mode: 'autopilot' },
        inFlight: false,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
        lastTickAt: null,
        nextTickAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
    };
}

const VALID_CREATE_BODY = {
    processId: 'queue_proc1',
    event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'origin1', prId: '42' },
};

// ============================================================================
// Tests
// ============================================================================

describe('Trigger REST API Handler', () => {
    let db: Database.Database;
    let store: TriggerStore;
    let routes: Route[];
    let mockManager: any;
    let emit: ReturnType<typeof vi.fn>;

    function register(enabled = true) {
        routes = [];
        emit = vi.fn();
        const ctx: TriggerRouteContext = { store, manager: mockManager, emit, enabled };
        registerTriggerRoutes(routes, ctx);
    }

    beforeEach(() => {
        db = new Database(':memory:');
        store = new TriggerStore(db);
        mockManager = {
            arm: vi.fn(),
            disarm: vi.fn(),
        };
        register(true);
    });

    // ------------------------------------------------------------------
    // POST /api/workspaces/:id/triggers
    // ------------------------------------------------------------------
    describe('POST create', () => {
        it('creates and arms a ci-failure trigger', async () => {
            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', VALID_CREATE_BODY);
            expect(res.statusCode).toBe(201);
            expect(res.body.trigger.workspaceId).toBe('ws1');
            expect(res.body.trigger.processId).toBe('queue_proc1');
            expect(res.body.trigger.status).toBe('active');
            expect(res.body.trigger.event.originId).toBe('origin1');
            expect(res.body.trigger.event.prId).toBe('42');
            expect(res.body.trigger.action.processId).toBe('queue_proc1');
            expect(mockManager.arm).toHaveBeenCalledOnce();
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger-created' }));
            // Persisted
            expect(store.getByWorkspace('ws1')).toHaveLength(1);
        });

        it('rejects missing processId', async () => {
            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', {
                event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '1' },
            });
            expect(res.statusCode).toBe(400);
            expect(mockManager.arm).not.toHaveBeenCalled();
        });

        it('rejects an unsupported event type', async () => {
            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', {
                processId: 'queue_proc1',
                event: { type: 'schedule', cron: '* * * * *' },
            });
            expect(res.statusCode).toBe(400);
        });

        it('rejects a too-small pollIntervalMs', async () => {
            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', {
                processId: 'queue_proc1',
                event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '1', pollIntervalMs: 5 },
            });
            expect(res.statusCode).toBe(400);
        });

        it('returns 403 when the feature flag is off', async () => {
            register(false);
            const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', VALID_CREATE_BODY);
            expect(res.statusCode).toBe(403);
            expect(mockManager.arm).not.toHaveBeenCalled();
            expect(store.getByWorkspace('ws1')).toHaveLength(0);
        });
    });

    // ------------------------------------------------------------------
    // GET list / get
    // ------------------------------------------------------------------
    describe('GET list & get', () => {
        it('lists only triggers for the given workspace', async () => {
            store.insert(makeTrigger({ id: 't1', workspaceId: 'ws1' }));
            store.insert(makeTrigger({ id: 't2', workspaceId: 'ws2' }));
            store.insert(makeTrigger({ id: 't3', workspaceId: 'ws1' }));

            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/triggers');
            expect(res.statusCode).toBe(200);
            const ids = res.body.triggers.map((t: any) => t.id);
            expect(ids.sort()).toEqual(['t1', 't3']);
        });

        it('returns empty list when none exist', async () => {
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/triggers');
            expect(res.statusCode).toBe(200);
            expect(res.body.triggers).toEqual([]);
        });

        it('gets a single trigger by id', async () => {
            store.insert(makeTrigger({ id: 't_x' }));
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/triggers/t_x');
            expect(res.statusCode).toBe(200);
            expect(res.body.trigger.id).toBe('t_x');
        });

        it('returns 404 for an unknown trigger', async () => {
            const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/triggers/nope');
            expect(res.statusCode).toBe(404);
        });

        it('lists all triggers server-wide', async () => {
            store.insert(makeTrigger({ id: 't1', workspaceId: 'ws1' }));
            store.insert(makeTrigger({ id: 't2', workspaceId: 'ws2' }));
            const res = await dispatch(routes, 'GET', '/api/triggers');
            expect(res.statusCode).toBe(200);
            expect(res.body.triggers).toHaveLength(2);
        });
    });

    // ------------------------------------------------------------------
    // PATCH status
    // ------------------------------------------------------------------
    describe('PATCH status', () => {
        it('pauses an active trigger and disarms its timer', async () => {
            store.insert(makeTrigger({ id: 't1', status: 'active' }));
            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/triggers/t1', { status: 'paused' });
            expect(res.statusCode).toBe(200);
            expect(res.body.trigger.status).toBe('paused');
            expect(res.body.trigger.nextTickAt).toBeNull();
            expect(mockManager.disarm).toHaveBeenCalledWith('t1');
            expect(store.getById('t1')!.status).toBe('paused');
        });

        it('resumes a paused trigger and re-arms it', async () => {
            store.insert(makeTrigger({ id: 't1', status: 'paused', nextTickAt: null, inFlight: true }));
            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/triggers/t1', { status: 'active' });
            expect(res.statusCode).toBe(200);
            expect(res.body.trigger.status).toBe('active');
            expect(res.body.trigger.inFlight).toBe(false);
            expect(res.body.trigger.nextTickAt).not.toBeNull();
            expect(mockManager.arm).toHaveBeenCalledOnce();
        });

        it('refuses to resume an expired trigger', async () => {
            store.insert(makeTrigger({
                id: 't1',
                status: 'paused',
                nextTickAt: null,
                expiresAt: new Date(Date.now() - 1000).toISOString(),
            }));
            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/triggers/t1', { status: 'active' });
            expect(res.statusCode).toBe(400);
            expect(store.getById('t1')!.status).toBe('expired');
            expect(mockManager.arm).not.toHaveBeenCalled();
        });

        it('rejects an invalid status', async () => {
            store.insert(makeTrigger({ id: 't1' }));
            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/triggers/t1', { status: 'bogus' });
            expect(res.statusCode).toBe(400);
        });

        it('returns 404 for unknown trigger', async () => {
            const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws1/triggers/nope', { status: 'paused' });
            expect(res.statusCode).toBe(404);
        });
    });

    // ------------------------------------------------------------------
    // DELETE
    // ------------------------------------------------------------------
    describe('DELETE disarm', () => {
        it('disarms the timer and deletes the trigger', async () => {
            store.insert(makeTrigger({ id: 't1' }));
            const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/triggers/t1');
            expect(res.statusCode).toBe(200);
            expect(res.body.deleted).toBe(true);
            expect(res.body.trigger.status).toBe('disarmed');
            expect(mockManager.disarm).toHaveBeenCalledWith('t1');
            expect(store.getById('t1')).toBeNull();
            expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'trigger-disarmed' }));
        });

        it('returns 404 for unknown trigger', async () => {
            const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws1/triggers/nope');
            expect(res.statusCode).toBe(404);
        });
    });
});

// ============================================================================
// Workspace boundary — item routes and create verification
// ============================================================================

describe('Trigger REST API Handler — workspace boundary', () => {
    let db: Database.Database;
    let store: TriggerStore;
    let routes: Route[];
    let mockManager: any;
    let resolveWorkspaceId: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        db = new Database(':memory:');
        store = new TriggerStore(db);
        routes = [];
        mockManager = { arm: vi.fn(), disarm: vi.fn() };
        resolveWorkspaceId = vi.fn(async (processId: string) => {
            if (processId.startsWith('queue_ws1')) return 'ws1';
            if (processId.startsWith('queue_ws2')) return 'ws2';
            return undefined;
        });
        const ctx: TriggerRouteContext = { store, manager: mockManager, enabled: true, resolveWorkspaceId };
        registerTriggerRoutes(routes, ctx);
    });

    it('GET item route returns 404 for a trigger owned by another workspace', async () => {
        store.insert(makeTrigger({ id: 't1', workspaceId: 'ws1' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws2/triggers/t1');
        expect(res.statusCode).toBe(404);
    });

    it('PATCH does not mutate a trigger owned by another workspace', async () => {
        store.insert(makeTrigger({ id: 't1', workspaceId: 'ws1', status: 'active' }));
        const res = await dispatch(routes, 'PATCH', '/api/workspaces/ws2/triggers/t1', { status: 'paused' });
        expect(res.statusCode).toBe(404);
        expect(store.getById('t1')!.status).toBe('active');
        expect(mockManager.disarm).not.toHaveBeenCalled();
    });

    it('DELETE does not remove a trigger owned by another workspace', async () => {
        store.insert(makeTrigger({ id: 't1', workspaceId: 'ws1' }));
        const res = await dispatch(routes, 'DELETE', '/api/workspaces/ws2/triggers/t1');
        expect(res.statusCode).toBe(404);
        expect(store.getById('t1')).not.toBeNull();
    });

    it('the owning workspace can still operate on its own trigger', async () => {
        store.insert(makeTrigger({ id: 't1', workspaceId: 'ws1' }));
        const res = await dispatch(routes, 'GET', '/api/workspaces/ws1/triggers/t1');
        expect(res.statusCode).toBe(200);
        expect(res.body.trigger.id).toBe('t1');
    });

    it('rejects create when processId resolves to a different workspace', async () => {
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', {
            processId: 'queue_ws2_a',
            event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '1' },
        });
        expect(res.statusCode).toBe(400);
        expect(mockManager.arm).not.toHaveBeenCalled();
        expect(store.getByWorkspace('ws1')).toHaveLength(0);
    });

    it('rejects create when action.processId resolves to a different workspace', async () => {
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', {
            processId: 'queue_ws1_a',
            event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '1' },
            action: { processId: 'queue_ws2_b' },
        });
        expect(res.statusCode).toBe(400);
        expect(mockManager.arm).not.toHaveBeenCalled();
        expect(store.getByWorkspace('ws1')).toHaveLength(0);
    });

    it('allows create when the process resolves to the route workspace', async () => {
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', {
            processId: 'queue_ws1_a',
            event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '1' },
        });
        expect(res.statusCode).toBe(201);
        expect(mockManager.arm).toHaveBeenCalledOnce();
        expect(store.getByWorkspace('ws1')).toHaveLength(1);
    });

    it('allows create when the process workspace is unresolvable (cannot prove a violation)', async () => {
        const res = await dispatch(routes, 'POST', '/api/workspaces/ws1/triggers', {
            processId: 'queue_unknown_a',
            event: { type: 'condition-monitor', monitor: 'ci-failure', originId: 'o', prId: '1' },
        });
        expect(res.statusCode).toBe(201);
        expect(store.getByWorkspace('ws1')).toHaveLength(1);
    });
});

// ============================================================================
// Pure validation unit tests
// ============================================================================

describe('validateCreateTriggerBody', () => {
    it('accepts a minimal valid body', () => {
        expect(validateCreateTriggerBody(VALID_CREATE_BODY).valid).toBe(true);
    });

    it('rejects a non-send-message action type', () => {
        const result = validateCreateTriggerBody({
            ...VALID_CREATE_BODY,
            action: { type: 'webhook' },
        });
        expect(result.valid).toBe(false);
    });

    it('rejects a non-autopilot action mode', () => {
        const result = validateCreateTriggerBody({
            ...VALID_CREATE_BODY,
            action: { mode: 'ask' },
        });
        expect(result.valid).toBe(false);
    });

    it('rejects a missing originId', () => {
        const result = validateCreateTriggerBody({
            processId: 'queue_proc1',
            event: { type: 'condition-monitor', monitor: 'ci-failure', prId: '1' },
        });
        expect(result.valid).toBe(false);
    });
});

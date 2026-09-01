/**
 * Functional test standing in for the manual curl check: binds a real HTTP
 * server on an ephemeral port, registers the real stats routes backed by a
 * real SQLite `TurnPerformanceStore` (in-memory processes.db), records rows
 * through the store, and fetches `/api/stats/turn-performance` over the wire.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import DatabaseConstructor from 'better-sqlite3';
import type { TurnPerformanceEvent, TurnPerformanceStatsResponse } from '@plusplusoneplusplus/forge';
import { registerStatsRoutes } from '../../src/server/admin/stats-handler';
import { TurnPerformanceStore } from '../../src/server/storage/turn-performance-store';
import type { Route } from '@plusplusoneplusplus/coc-server';

function makeEvent(overrides: Partial<TurnPerformanceEvent> = {}): TurnPerformanceEvent {
    const processId = overrides.processId ?? 'proc-live';
    const turnIndex = overrides.turnIndex ?? 0;
    const startedAt = overrides.startedAt ?? new Date(Date.now() - 60_000).toISOString();
    return {
        id: `${processId}:${turnIndex}`,
        processId,
        turnIndex,
        workspaceId: 'ws-live',
        provider: 'claude',
        model: 'claude-sonnet-5',
        effortTier: null,
        mode: 'autopilot',
        kind: 'chat',
        enqueuedAt: null,
        startedAt,
        firstOutputAt: new Date(new Date(startedAt).getTime() + 1500).toISOString(),
        endedAt: new Date(new Date(startedAt).getTime() + 9500).toISOString(),
        ttftMs: 1500,
        queueWaitMs: null,
        generationMs: 8000,
        wallMs: 9500,
        inputTokens: 120,
        outputTokens: 320,
        totalTokens: 440,
        tpsGeneration: 40,
        tpsWall: 33.684,
        status: 'completed',
        ...overrides,
    };
}

describe('GET /api/stats/turn-performance — live HTTP round-trip', () => {
    let server: http.Server;
    let baseUrl: string;
    let db: DatabaseConstructor.Database;

    beforeAll(async () => {
        db = new DatabaseConstructor(':memory:');
        const tpStore = new TurnPerformanceStore(db);
        tpStore.record(makeEvent({ model: 'claude-sonnet-5' }));
        tpStore.record(makeEvent({ processId: 'proc-live-2', model: 'gpt-5.6', provider: 'copilot', ttftMs: 3000 }));

        const routes: Route[] = [];
        registerStatsRoutes(routes, { getAllProcesses: async () => [] } as never, () => tpStore);

        server = http.createServer((req, res) => {
            const pathname = new URL(req.url!, 'http://localhost').pathname;
            const route = routes.find((r) => r.method === req.method && r.pattern === pathname);
            if (!route) {
                res.writeHead(404).end();
                return;
            }
            void route.handler(req, res);
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const address = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
        db.close();
    });

    it('returns valid aggregated JSON for ?days=7&groupBy=model', async () => {
        const res = await fetch(`${baseUrl}/api/stats/turn-performance?days=7&groupBy=model`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as TurnPerformanceStatsResponse;
        expect(body.groupBy).toEqual(['model']);
        expect(body.days).toBe(7);
        expect(body.totalEvents).toBe(2);
        expect(body.groups.map((g) => g.key.model).sort()).toEqual(['claude-sonnet-5', 'gpt-5.6']);
        const claudeGroup = body.groups.find((g) => g.key.model === 'claude-sonnet-5')!;
        expect(claudeGroup.ttftMs.p50).toBe(1500);
        expect(claudeGroup.outputTokens).toBe(320);
    });

    it('serves the per-session lookup via ?processId=', async () => {
        const res = await fetch(`${baseUrl}/api/stats/turn-performance?processId=proc-live-2`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as TurnPerformanceStatsResponse;
        expect(body.totalEvents).toBe(1);
        expect(body.groups[0].ttftMs.p50).toBe(3000);
    });

    it('rejects a bogus groupBy over the wire with 400', async () => {
        const res = await fetch(`${baseUrl}/api/stats/turn-performance?groupBy=nope`);
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('nope');
    });
});

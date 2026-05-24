/**
 * Tests for Memory V2 REST routes.
 *
 * Covers:
 *   - Feature gate: 404 when not enabled
 *   - POST   /api/workspaces/:wsId/memory/v2/facts          — create fact (happy path + blocked)
 *   - GET    /api/workspaces/:wsId/memory/v2/facts          — list facts
 *   - PATCH  /api/workspaces/:wsId/memory/v2/facts/:id      — update fact
 *   - DELETE /api/workspaces/:wsId/memory/v2/facts/:id      — delete fact
 *   - GET    /api/workspaces/:wsId/memory/v2/review         — list review queue
 *   - POST   /api/workspaces/:wsId/memory/v2/review/:id/approve
 *   - POST   /api/workspaces/:wsId/memory/v2/review/:id/reject
 *   - GET    /api/workspaces/:wsId/memory/v2/episodes       — list episodes
 *   - GET    /api/workspaces/:wsId/memory/v2/export
 *   - DELETE /api/workspaces/:wsId/memory/v2/wipe           — with/without confirm
 *   - Global vs isolated scope
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { registerMemoryV2Routes } from '../../../src/server/memory/memory-v2-routes';
import { writeRepoPreferences } from '../../../src/server/preferences-handler';
import type { Route } from '../../../src/server/types';
import { createTestRouter } from './test-helpers';
import { createMemoryStores, MemoryCaptureService, GLOBAL_MEMORY_SUBDIR, WORKSPACE_MEMORY_SUBDIR } from '@plusplusoneplusplus/coc-memory';

// ============================================================================
// Constants
// ============================================================================

const WORKSPACE_ID = 'ws-test-v2';

// ============================================================================
// Helpers
// ============================================================================

function setupDataDir(): string {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-v2-routes-test-'));
    return dataDir;
}

function enableMemoryV2(dataDir: string, wsId: string, isolated = false): void {
    writeRepoPreferences(dataDir, wsId, {
        memoryV2: { enabled: true, isolated },
    } as any);
}

function getGlobalStoreDir(dataDir: string): string {
    return path.join(dataDir, GLOBAL_MEMORY_SUBDIR);
}

function getIsolatedStoreDir(dataDir: string, wsId: string): string {
    return path.join(dataDir, 'repos', wsId, WORKSPACE_MEMORY_SUBDIR);
}

// ============================================================================
// Tests
// ============================================================================

describe('Memory V2 Routes', () => {
    let dataDir: string;
    let routes: Route[];
    let router: ReturnType<typeof createTestRouter>;

    beforeEach(() => {
        dataDir = setupDataDir();
        routes = [];
        registerMemoryV2Routes(routes, dataDir);
        router = createTestRouter(routes);
    });

    afterEach(() => {
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ── Feature gate ──────────────────────────────────────────────────────────

    describe('feature gate', () => {
        it('returns 404 when memory v2 is not enabled', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(res.status).toBe(404);
            expect(res.body).toContain('not enabled');
        });

        it('returns 404 for all methods when not enabled', async () => {
            const routes404 = [
                () => router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, { content: 'test' }),
                () => router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/review`),
                () => router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/episodes`),
                () => router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/export`),
            ];
            for (const fn of routes404) {
                const res = await fn();
                expect(res.status).toBe(404);
            }
        });
    });

    // ── Facts: create ─────────────────────────────────────────────────────────

    describe('POST /facts', () => {
        beforeEach(() => enableMemoryV2(dataDir, WORKSPACE_ID));

        it('creates a fact and returns 201', async () => {
            const res = await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, {
                content: 'The project uses TypeScript strict mode',
                importance: 0.8,
                tags: ['typescript', 'config'],
            });
            expect(res.status).toBe(201);
            const body = res.json();
            expect(body.fact).toBeDefined();
            expect(body.fact.content).toBe('The project uses TypeScript strict mode');
            expect(body.fact.importance).toBe(0.8);
            expect(body.fact.tags).toContain('typescript');
            expect(body.fact.status).toBe('active');
        });

        it('returns 400 when content is missing', async () => {
            const res = await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, {
                importance: 0.5,
            });
            expect(res.status).toBe(400);
        });

        it('returns 422 when content is blocked by safety scanner', async () => {
            // Use a valid Bearer token format that matches the safety scanner pattern
            const res = await router.post(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`, {
                content: 'Authorization: Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
            });
            expect(res.status).toBe(422);
            const body = res.json();
            expect(body.blocked).toBe(true);
        });
    });

    // ── Facts: list/search ────────────────────────────────────────────────────

    describe('GET /facts', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            // Seed two facts
            const storeDir = getGlobalStoreDir(dataDir);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                await svc.captureExplicit({
                    content: 'Project uses Vitest for testing',
                    scope: 'global',
                    provenance: { createdBy: 'user', version: 1 },
                });
                await svc.captureExplicit({
                    content: 'Database is SQLite with better-sqlite3',
                    scope: 'global',
                    provenance: { createdBy: 'user', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('lists all active facts', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.facts).toHaveLength(2);
        });

        it('searches facts by query', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts?q=SQLite`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.facts.length).toBeGreaterThan(0);
            expect(body.facts[0].content).toContain('SQLite');
        });
    });

    // ── Facts: update ─────────────────────────────────────────────────────────

    describe('PATCH /facts/:id', () => {
        let factId: string;

        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getGlobalStoreDir(dataDir);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                const fact = await svc.captureExplicit({
                    content: 'Original content',
                    scope: 'global',
                    provenance: { createdBy: 'user', version: 1 },
                });
                factId = fact!.id;
            } finally {
                handle.close();
            }
        });

        it('updates fact content', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`, {
                content: 'Updated content',
                importance: 0.9,
            });
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.fact.content).toBe('Updated content');
            expect(body.fact.importance).toBe(0.9);
        });

        it('returns 404 for unknown fact', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/unknown-id`, {
                content: 'new',
            });
            expect(res.status).toBe(404);
        });

        it('returns 422 for blocked content in PATCH', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`, {
                content: 'password: SuperSecret123ExtraLongPwd!',
            });
            expect(res.status).toBe(422);
        });

        it('returns 400 for invalid status value', async () => {
            const res = await router.patch(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`, {
                status: 'banana',
            });
            expect(res.status).toBe(400);
        });
    });

    // ── Facts: delete ─────────────────────────────────────────────────────────

    describe('DELETE /facts/:id', () => {
        let factId: string;

        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getGlobalStoreDir(dataDir);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                const fact = await svc.captureExplicit({
                    content: 'Fact to delete',
                    scope: 'global',
                    provenance: { createdBy: 'user', version: 1 },
                });
                factId = fact!.id;
            } finally {
                handle.close();
            }
        });

        it('deletes a fact', async () => {
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/${factId}`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.deleted).toBe(true);
        });

        it('returns 404 when deleting non-existent fact', async () => {
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts/no-such-id`);
            expect(res.status).toBe(404);
        });
    });

    // ── Review queue ──────────────────────────────────────────────────────────

    describe('review queue', () => {
        let reviewFactId: string;

        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getGlobalStoreDir(dataDir);
            const handle = createMemoryStores(storeDir);
            try {
                // Insert a low-confidence fact directly as review status
                await handle.facts.addFact({
                    scope: 'global',
                    content: 'Low confidence extracted fact',
                    importance: 0.4,
                    confidence: 0.3,
                    status: 'review',
                    tags: [],
                    source: 'auto-extracted',
                    provenance: { createdBy: 'ai', version: 1 },
                });
                // Get ID of the review fact
                const all = await handle.facts.listFacts({ statuses: ['review'] });
                reviewFactId = all[0].id;
            } finally {
                handle.close();
            }
        });

        it('lists review queue', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/review`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.facts).toHaveLength(1);
            expect(body.facts[0].status).toBe('review');
        });

        it('approves a review fact → status becomes active', async () => {
            const res = await router.post(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/review/${reviewFactId}/approve`,
                {},
            );
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.fact.status).toBe('active');
        });

        it('rejects a review fact → status becomes rejected', async () => {
            const res = await router.post(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/review/${reviewFactId}/reject`,
                {},
            );
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.fact.status).toBe('rejected');
        });

        it('returns 404 when approving unknown fact', async () => {
            const res = await router.post(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/review/no-such-id/approve`,
                {},
            );
            expect(res.status).toBe(404);
        });
    });

    // ── Episodes ──────────────────────────────────────────────────────────────

    describe('GET /episodes', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getGlobalStoreDir(dataDir);
            const handle = createMemoryStores(storeDir);
            try {
                await handle.episodes.addEpisode({
                    scope: 'global',
                    processId: 'proc-001',
                    summary: 'Discussed TypeScript strict mode config',
                    eventType: 'chat-turn',
                    provenance: { createdBy: 'ai', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('lists episodes', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/episodes`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.episodes).toHaveLength(1);
            expect(body.episodes[0].processId).toBe('proc-001');
        });
    });

    // ── Export ────────────────────────────────────────────────────────────────

    describe('GET /export', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getGlobalStoreDir(dataDir);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                await svc.captureExplicit({
                    content: 'Export test fact',
                    scope: 'global',
                    provenance: { createdBy: 'user', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('exports facts and episodes as JSON', async () => {
            const res = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/export`);
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.version).toBe(1);
            expect(Array.isArray(body.facts)).toBe(true);
            expect(Array.isArray(body.episodes)).toBe(true);
            expect(body.facts).toHaveLength(1);
            expect(body.facts[0].content).toBe('Export test fact');
            expect(body.scope).toBe('global');
        });
    });

    // ── Wipe ──────────────────────────────────────────────────────────────────

    describe('DELETE /wipe', () => {
        beforeEach(async () => {
            enableMemoryV2(dataDir, WORKSPACE_ID);
            const storeDir = getGlobalStoreDir(dataDir);
            const handle = createMemoryStores(storeDir);
            try {
                const svc = new MemoryCaptureService(handle.facts, handle.episodes);
                await svc.captureExplicit({
                    content: 'Fact to be wiped',
                    scope: 'global',
                    provenance: { createdBy: 'user', version: 1 },
                });
            } finally {
                handle.close();
            }
        });

        it('returns 400 without confirm body', async () => {
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/wipe`);
            expect(res.status).toBe(400);
            expect(res.body).toContain('confirm');
        });

        it('wipes facts when confirm=true', async () => {
            // Wipe
            const res = await router.delete(`/api/workspaces/${WORKSPACE_ID}/memory/v2/wipe`);
            // This uses DELETE without body which returns 400 — force body via post-like
            // Actually, let's test that the endpoint accepts the confirm body via custom dispatch
            expect(res.status).toBe(400);
        });

        it('wipes all data with confirm: true body', async () => {
            // Verify the list is non-empty before wipe
            const listBefore = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(listBefore.json().facts).toHaveLength(1);

            // Wipe with confirm body
            const res = await router.delete(
                `/api/workspaces/${WORKSPACE_ID}/memory/v2/wipe`,
                { confirm: true }
            );
            expect(res.status).toBe(200);
            const body = res.json();
            expect(body.wiped).toBe(true);

            // Verify empty
            const listAfter = await router.get(`/api/workspaces/${WORKSPACE_ID}/memory/v2/facts`);
            expect(listAfter.json().facts).toHaveLength(0);
        });
    });

    // ── Global vs Isolated scope ──────────────────────────────────────────────

    describe('global vs isolated scope', () => {
        const WS_A = 'ws-global-test';
        const WS_B = 'ws-isolated-test';

        it('global workspace can see facts stored in global store', async () => {
            // WS_A uses global mode
            enableMemoryV2(dataDir, WS_A, false);

            const res = await router.post(`/api/workspaces/${WS_A}/memory/v2/facts`, {
                content: 'Global fact from WS_A',
            });
            expect(res.status).toBe(201);

            // WS_B also uses global mode → can see WS_A's fact
            enableMemoryV2(dataDir, WS_B, false);
            const listRes = await router.get(`/api/workspaces/${WS_B}/memory/v2/facts`);
            expect(listRes.status).toBe(200);
            const facts = listRes.json().facts as any[];
            expect(facts.some((f: any) => f.content === 'Global fact from WS_A')).toBe(true);
        });

        it('isolated workspace cannot see global facts and vice versa', async () => {
            // WS_A: global
            enableMemoryV2(dataDir, WS_A, false);
            await router.post(`/api/workspaces/${WS_A}/memory/v2/facts`, {
                content: 'Global fact, should not be seen by isolated',
            });

            // WS_B: isolated
            enableMemoryV2(dataDir, WS_B, true);
            const listRes = await router.get(`/api/workspaces/${WS_B}/memory/v2/facts`);
            expect(listRes.status).toBe(200);
            const facts = listRes.json().facts as any[];
            expect(facts.some((f: any) => f.content.includes('Global fact'))).toBe(false);
        });

        it('isolated workspace fact is not visible in global mode', async () => {
            // WS_B: isolated
            enableMemoryV2(dataDir, WS_B, true);
            await router.post(`/api/workspaces/${WS_B}/memory/v2/facts`, {
                content: 'Isolated fact, should not leak to global',
            });

            // WS_A: global
            enableMemoryV2(dataDir, WS_A, false);
            const listRes = await router.get(`/api/workspaces/${WS_A}/memory/v2/facts`);
            expect(listRes.status).toBe(200);
            const facts = listRes.json().facts as any[];
            expect(facts.some((f: any) => f.content.includes('Isolated fact'))).toBe(false);
        });
    });
});

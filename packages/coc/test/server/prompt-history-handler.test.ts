/**
 * Tests for GET /api/prompt-history — recent initial prompts for chat
 * up/down arrow history navigation.
 *
 * Verifies query handling, default and clamped limits, missing-workspace
 * silent no-op, store-method-missing fallback, and store-throws swallowing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import { createRouter } from '../../src/server/shared/router';
import {
    registerPromptHistoryRoutes,
    type PromptHistoryStore,
} from '../../src/server/processes/prompt-history-handler';
import type { Route } from '../../src/server/types';

// ============================================================================
// HTTP request helper
// ============================================================================

function request(reqUrl: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(reqUrl);
        const req = http.request(
            {
                hostname: parsed.hostname,
                port: parsed.port,
                path: parsed.pathname + parsed.search,
                method: 'GET',
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const body = Buffer.concat(chunks).toString('utf-8');
                    resolve({
                        status: res.statusCode || 0,
                        body: body ? JSON.parse(body) : null,
                    });
                });
            },
        );
        req.on('error', reject);
        req.end();
    });
}

// ============================================================================
// Server harness
// ============================================================================

interface Harness {
    server: http.Server;
    base: string;
    store: PromptHistoryStore & {
        getRecentUserPrompts: ReturnType<typeof vi.fn>;
    };
}

async function makeHarness(): Promise<Harness> {
    const store = {
        getRecentUserPrompts: vi.fn(),
    } as PromptHistoryStore & {
        getRecentUserPrompts: ReturnType<typeof vi.fn>;
    };

    const routes: Route[] = [];
    registerPromptHistoryRoutes(routes, store as any);
    const router = createRouter({ routes, spaHtml: '' });

    const server = http.createServer(router);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return { server, base: `http://127.0.0.1:${port}`, store };
}

async function disposeHarness(h: Harness): Promise<void> {
    await new Promise<void>((resolve) => h.server.close(() => resolve()));
}

// ============================================================================
// Tests
// ============================================================================

describe('GET /api/prompt-history', () => {
    let h: Harness;
    beforeEach(async () => { h = await makeHarness(); });
    afterEach(async () => { await disposeHarness(h); });

    it('returns the prompts the store provides', async () => {
        h.store.getRecentUserPrompts.mockReturnValue([
            'most recent prompt',
            'older prompt',
            'oldest prompt',
        ]);
        const r = await request(`${h.base}/api/prompt-history?workspaceId=ws-1`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
            items: ['most recent prompt', 'older prompt', 'oldest prompt'],
        });
        expect(h.store.getRecentUserPrompts).toHaveBeenCalledWith('ws-1', { limit: 50 });
    });

    it('returns an empty array silently when workspaceId is missing', async () => {
        const r = await request(`${h.base}/api/prompt-history`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ items: [] });
        expect(h.store.getRecentUserPrompts).not.toHaveBeenCalled();
    });

    it('returns an empty array silently when workspaceId is empty', async () => {
        const r = await request(`${h.base}/api/prompt-history?workspaceId=`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ items: [] });
        expect(h.store.getRecentUserPrompts).not.toHaveBeenCalled();
    });

    it('honors a custom limit query param', async () => {
        h.store.getRecentUserPrompts.mockReturnValue(['a', 'b']);
        await request(`${h.base}/api/prompt-history?workspaceId=ws-1&limit=10`);
        expect(h.store.getRecentUserPrompts).toHaveBeenCalledWith('ws-1', { limit: 10 });
    });

    it('clamps limit to MAX_LIMIT (200) when too large', async () => {
        h.store.getRecentUserPrompts.mockReturnValue([]);
        await request(`${h.base}/api/prompt-history?workspaceId=ws-1&limit=999`);
        expect(h.store.getRecentUserPrompts).toHaveBeenCalledWith('ws-1', { limit: 200 });
    });

    it('falls back to DEFAULT_LIMIT (50) when limit is invalid or non-positive', async () => {
        h.store.getRecentUserPrompts.mockReturnValue([]);
        await request(`${h.base}/api/prompt-history?workspaceId=ws-1&limit=abc`);
        expect(h.store.getRecentUserPrompts).toHaveBeenLastCalledWith('ws-1', { limit: 50 });
        await request(`${h.base}/api/prompt-history?workspaceId=ws-1&limit=0`);
        expect(h.store.getRecentUserPrompts).toHaveBeenLastCalledWith('ws-1', { limit: 50 });
        await request(`${h.base}/api/prompt-history?workspaceId=ws-1&limit=-5`);
        expect(h.store.getRecentUserPrompts).toHaveBeenLastCalledWith('ws-1', { limit: 50 });
    });

    it('returns an empty array when the store does not implement getRecentUserPrompts', async () => {
        // Re-mount routes with a store that has no method.
        await disposeHarness(h);
        const routes: Route[] = [];
        registerPromptHistoryRoutes(routes, {} as any);
        const router = createRouter({ routes, spaHtml: '' });
        const server = http.createServer(router);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const base = `http://127.0.0.1:${port}`;
        try {
            const r = await request(`${base}/api/prompt-history?workspaceId=ws-1`);
            expect(r.status).toBe(200);
            expect(r.body).toEqual({ items: [] });
        } finally {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        // Re-create harness so afterEach can dispose cleanly.
        h = await makeHarness();
    });

    it('swallows store errors and returns an empty array', async () => {
        h.store.getRecentUserPrompts.mockImplementation(() => {
            throw new Error('boom');
        });
        const r = await request(`${h.base}/api/prompt-history?workspaceId=ws-1`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ items: [] });
    });

    it('coerces a non-array store response into an empty array', async () => {
        h.store.getRecentUserPrompts.mockReturnValue('not-an-array' as any);
        const r = await request(`${h.base}/api/prompt-history?workspaceId=ws-1`);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ items: [] });
    });
});

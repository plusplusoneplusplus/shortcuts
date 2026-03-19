/**
 * Tests for model-routes — HTTP handler unit tests using in-process HTTP.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import { createRouter } from '../src/shared/router';
import { registerModelRoutes } from '../src/models/model-routes';
import type { ModelStore } from '../src/models/model-routes';
import type { Route } from '../src/types';
import type { ModelInfo } from '@plusplusoneplusplus/forge';

// ── Helpers ──────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function makeServer(store: ModelStore): http.Server {
    const routes: Route[] = [];
    registerModelRoutes(routes, store);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve();
        });
    });
}

async function stopServer(): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function apiGet(path: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${path}`);
    const body = await res.json();
    return { status: res.status, body };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeModelInfo(id: string, name: string, contextWindow = 128_000): ModelInfo {
    return {
        id,
        name,
        capabilities: {
            supports: { vision: false, reasoningEffort: false },
            limits: { max_context_window_tokens: contextWindow },
        },
    };
}

const THREE_MODELS: ModelInfo[] = [
    makeModelInfo('model-a', 'Model A'),
    makeModelInfo('model-b', 'Model B'),
    makeModelInfo('model-c', 'Model C', 200_000),
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/models', () => {
    afterEach(async () => {
        await stopServer();
    });

    it('returns store data when store is populated', async () => {
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store);
        await startServer();

        const { status, body } = await apiGet('/api/models');

        expect(status).toBe(200);
        expect(body).toEqual(THREE_MODELS);
    });

    it('falls back to dynamic list from model registry when store is empty', async () => {
        const store: ModelStore = { getAll: () => [] };
        server = makeServer(store);
        await startServer();

        const { status, body } = await apiGet('/api/models');

        expect(status).toBe(200);
        const models = body as ModelInfo[];
        expect(models.length).toBeGreaterThan(0);
        // Fallback should include models from the current static registry
        const ids = models.map((m: ModelInfo) => m.id);
        expect(ids).toContain('claude-sonnet-4.6');
        expect(ids).toContain('claude-haiku-4.5');
    });

    it('returns 500 when store.getAll() throws', async () => {
        const store: ModelStore = {
            getAll: () => {
                throw new Error('db error');
            },
        };
        server = makeServer(store);
        await startServer();

        const { status, body } = await apiGet('/api/models');

        expect(status).toBe(500);
        expect((body as { error: string }).error).toBe('db error');
    });

    it('POST /api/models is not matched (404)', async () => {
        const store: ModelStore = { getAll: () => THREE_MODELS };
        server = makeServer(store);
        await startServer();

        const res = await fetch(`${baseUrl}/api/models`, { method: 'POST' });
        expect(res.status).toBe(404);
    });
});

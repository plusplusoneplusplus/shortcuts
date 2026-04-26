/**
 * Provider Routes Tests (coc-server)
 *
 * HTTP route tests for:
 * - GET /api/providers/config — returns sanitized config (tokens masked)
 * - PUT /api/providers/config — validates and persists provider credentials
 *
 * Uses the coc-server shared router directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRouter } from '../../src/server/shared/router';
import { registerProviderRoutes } from '../../src/server/providers/provider-routes';
import type { Route } from '../../src/server/types';

// ============================================================================
// Helpers
// ============================================================================

function makeServer(dataDir: string): http.Server {
    const routes: Route[] = [];
    registerProviderRoutes(routes, dataDir);
    const handler = createRouter({ routes, spaHtml: '' });
    return http.createServer(handler);
}

async function startServer(server: http.Server): Promise<string> {
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address() as { port: number };
            resolve(`http://127.0.0.1:${addr.port}`);
        });
    });
}

async function stopServer(server: http.Server): Promise<void> {
    return new Promise(resolve => server.close(() => resolve()));
}

async function apiGet(baseUrl: string, pathname: string): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${pathname}`);
    const body = await res.json();
    return { status: res.status, body };
}

async function apiPut(baseUrl: string, pathname: string, data: unknown): Promise<{ status: number; body: unknown }> {
    const res = await fetch(`${baseUrl}${pathname}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    });
    let body: unknown = null;
    if (res.status !== 204) {
        try { body = await res.json(); } catch { body = await res.text(); }
    }
    return { status: res.status, body };
}

// ============================================================================
// Tests
// ============================================================================

describe('Provider Routes', () => {
    let server: http.Server;
    let baseUrl: string;
    let dataDir: string;

    beforeEach(async () => {
        dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-routes-test-'));
        server = makeServer(dataDir);
        baseUrl = await startServer(server);
    });

    afterEach(async () => {
        await stopServer(server);
        fs.rmSync(dataDir, { recursive: true, force: true });
    });

    // ---- GET /api/providers/config ----------------------------------------

    describe('GET /api/providers/config', () => {
        it('returns empty providers when config file is absent', async () => {
            const { status, body } = await apiGet(baseUrl, '/api/providers/config');
            expect(status).toBe(200);
            expect((body as any).providers).toBeDefined();
            expect(typeof (body as any).providers).toBe('object');
        });

        it('masks GitHub token as hasToken boolean', async () => {
            // Seed a config with a GitHub token
            const configPath = path.join(dataDir, 'providers.json');
            fs.writeFileSync(configPath, JSON.stringify({
                providers: { github: { token: 'sk-secret' } },
            }), 'utf-8');

            const { status, body } = await apiGet(baseUrl, '/api/providers/config');
            expect(status).toBe(200);
            const providers = (body as any).providers;
            // Token must not be returned as a string
            expect(typeof providers.github.token).not.toBe('string');
            // hasToken should be true
            expect(providers.github.hasToken).toBe(true);
        });

        it('returns hasToken: false when no GitHub token stored', async () => {
            const configPath = path.join(dataDir, 'providers.json');
            fs.writeFileSync(configPath, JSON.stringify({ providers: {} }), 'utf-8');

            const { status, body } = await apiGet(baseUrl, '/api/providers/config');
            expect(status).toBe(200);
            // github key should not be present at all when not configured
            expect((body as any).providers.github).toBeUndefined();
        });

        it('returns ado orgUrl without a token', async () => {
            const configPath = path.join(dataDir, 'providers.json');
            fs.writeFileSync(configPath, JSON.stringify({
                providers: { ado: { orgUrl: 'https://dev.azure.com/myorg' } },
            }), 'utf-8');

            const { status, body } = await apiGet(baseUrl, '/api/providers/config');
            expect(status).toBe(200);
            expect((body as any).providers.ado.orgUrl).toBe('https://dev.azure.com/myorg');
        });

        it('masks Tavily API key as hasApiKey boolean', async () => {
            const configPath = path.join(dataDir, 'providers.json');
            fs.writeFileSync(configPath, JSON.stringify({
                providers: { tavily: { apiKey: 'tvly-secret' } },
            }), 'utf-8');

            const { status, body } = await apiGet(baseUrl, '/api/providers/config');
            expect(status).toBe(200);
            const providers = (body as any).providers;
            expect(typeof providers.tavily.apiKey).not.toBe('string');
            expect(providers.tavily.hasApiKey).toBe(true);
        });
    });

    // ---- PUT /api/providers/config ----------------------------------------

    describe('PUT /api/providers/config', () => {
        it('saves GitHub token and returns 204', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                github: { token: 'ghp_validtoken' },
            });
            expect(status).toBe(204);

            // Verify persisted
            const configPath = path.join(dataDir, 'providers.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(saved.providers.github.token).toBe('ghp_validtoken');
        });

        it('saves ADO orgUrl and returns 204', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                ado: { orgUrl: 'https://dev.azure.com/myorg' },
            });
            expect(status).toBe(204);

            const configPath = path.join(dataDir, 'providers.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(saved.providers.ado.orgUrl).toBe('https://dev.azure.com/myorg');
        });

        it('returns 400 when github.token is empty', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                github: { token: '' },
            });
            expect(status).toBe(400);
        });

        it('returns 400 when github.token is not a string', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                github: { token: 12345 },
            });
            expect(status).toBe(400);
        });

        it('returns 400 when ado.orgUrl is empty', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                ado: { orgUrl: '' },
            });
            expect(status).toBe(400);
        });

        it('allows saving both GitHub and ADO together', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                github: { token: 'ghp_token' },
                ado: { orgUrl: 'https://dev.azure.com/myorg' },
            });
            expect(status).toBe(204);

            const configPath = path.join(dataDir, 'providers.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(saved.providers.github.token).toBe('ghp_token');
            expect(saved.providers.ado.orgUrl).toBe('https://dev.azure.com/myorg');
        });

        it('overwrites previous config on subsequent PUT', async () => {
            await apiPut(baseUrl, '/api/providers/config', { github: { token: 'first' } });
            await apiPut(baseUrl, '/api/providers/config', { github: { token: 'second' } });

            const configPath = path.join(dataDir, 'providers.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(saved.providers.github.token).toBe('second');
        });

        it('saves Tavily apiKey and returns 204', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                tavily: { apiKey: 'tvly-abc123' },
            });
            expect(status).toBe(204);

            const configPath = path.join(dataDir, 'providers.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(saved.providers.tavily.apiKey).toBe('tvly-abc123');
        });

        it('returns 400 when tavily.apiKey is empty', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                tavily: { apiKey: '' },
            });
            expect(status).toBe(400);
        });

        it('returns 400 when tavily.apiKey is not a string', async () => {
            const { status } = await apiPut(baseUrl, '/api/providers/config', {
                tavily: { apiKey: 42 },
            });
            expect(status).toBe(400);
        });

        it('merges partial saves — saving one provider preserves the others', async () => {
            // Seed all three providers
            await apiPut(baseUrl, '/api/providers/config', {
                github: { token: 'gh-1' },
                ado: { orgUrl: 'https://dev.azure.com/orgA' },
                tavily: { apiKey: 'tvly-1' },
            });

            // Update just GitHub
            await apiPut(baseUrl, '/api/providers/config', {
                github: { token: 'gh-2' },
            });

            const configPath = path.join(dataDir, 'providers.json');
            const saved = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(saved.providers.github.token).toBe('gh-2');
            expect(saved.providers.ado.orgUrl).toBe('https://dev.azure.com/orgA');
            expect(saved.providers.tavily.apiKey).toBe('tvly-1');

            // Update just Tavily
            await apiPut(baseUrl, '/api/providers/config', {
                tavily: { apiKey: 'tvly-2' },
            });
            const saved2 = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            expect(saved2.providers.github.token).toBe('gh-2');
            expect(saved2.providers.ado.orgUrl).toBe('https://dev.azure.com/orgA');
            expect(saved2.providers.tavily.apiKey).toBe('tvly-2');
        });
    });
});

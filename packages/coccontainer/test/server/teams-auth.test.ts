/**
 * Tests for Teams OAuth auth endpoints.
 *
 * Mocks the acquireTokenViaBrowser and acquireMcpOAuthToken functions
 * to test the REST API surface without requiring real Microsoft login.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock the teams-bot auth functions
vi.mock('@plusplusoneplusplus/teams-bot', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@plusplusoneplusplus/teams-bot')>();
    return {
        ...actual,
        acquireTokenViaBrowser: vi.fn().mockResolvedValue('mock-access-token'),
        acquireMcpOAuthToken: vi.fn().mockResolvedValue('mock-access-token'),
    };
});

// ── Helpers ──────────────────────────────────────────────

async function httpRequest(url: string, options: { method?: string; body?: any } = {}): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request(
            {
                hostname: u.hostname,
                port: u.port,
                path: u.pathname + u.search,
                method: options.method ?? 'GET',
                headers: { 'Content-Type': 'application/json' },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8');
                    try {
                        resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
                    } catch {
                        resolve({ status: res.statusCode ?? 0, body: raw });
                    }
                });
            }
        );
        req.on('error', reject);
        if (options.body) req.write(JSON.stringify(options.body));
        req.end();
    });
}

describe('Teams Auth Endpoints', () => {
    let containerUrl: string;
    let tmpDir: string;
    let closeContainer: () => void;

    beforeAll(async () => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coccontainer-teams-auth-'));
        const configContent = `messaging:\n  teams:\n    enabled: false\n    mode: mcp\n    mcpServerUrl: https://agent365.svc.cloud.microsoft/agents/tenants/test-tenant/servers/mcp_TeamsServer\n    botName: TestBot\n`;
        fs.writeFileSync(path.join(tmpDir, 'config.yaml'), configContent);

        const containerPort = 16000 + Math.floor(Math.random() * 4000);
        const { createContainerServer } = await import('../../src/server');
        const server = await createContainerServer({
            serve: { port: containerPort, host: '127.0.0.1', dataDir: tmpDir },
            healthCheckIntervalMs: 600_000,
            tunnelBridgeBasePort: 19600,
            messaging: {
                whatsapp: { enabled: false, sessionDir: path.join(tmpDir, 'wa'), userName: 'CoC' },
                teams: {
                    enabled: false,
                    mode: 'mcp',
                    mcpServerUrl: 'https://agent365.svc.cloud.microsoft/agents/tenants/test-tenant/servers/mcp_TeamsServer',
                    botName: 'TestBot',
                    pollIntervalMs: 3000,
                },
            },
        });
        closeContainer = () => server.close();
        containerUrl = `http://127.0.0.1:${containerPort}`;
    }, 10000);

    afterAll(() => {
        closeContainer?.();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should return auth status as not authenticated when tokens missing', async () => {
        const { acquireMcpOAuthToken } = await import('@plusplusoneplusplus/teams-bot');
        vi.mocked(acquireMcpOAuthToken).mockRejectedValueOnce(new Error('No tokens'));

        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/status`);
        expect(status).toBe(200);
        expect(body.authenticated).toBe(false);
        expect(body.pending).toBe(false);
    });

    it('should return authenticated when valid tokens exist', async () => {
        const { acquireMcpOAuthToken } = await import('@plusplusoneplusplus/teams-bot');
        vi.mocked(acquireMcpOAuthToken).mockResolvedValueOnce('valid-token');

        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/status`);
        expect(status).toBe(200);
        expect(body.authenticated).toBe(true);
    });

    it('should start login flow and return pending status', async () => {
        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/login`, {
            method: 'POST',
            body: {},
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.status).toBe('pending');
        expect(body.message).toContain('browser');

        // Wait for async login to complete
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should reject concurrent login attempts while one is pending', async () => {
        const { acquireTokenViaBrowser } = await import('@plusplusoneplusplus/teams-bot');
        // Make login take a long time
        vi.mocked(acquireTokenViaBrowser).mockImplementationOnce(
            () => new Promise(resolve => setTimeout(() => resolve('delayed-token'), 5000))
        );

        // Start first login
        await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/login`, {
            method: 'POST',
            body: {},
        });

        // Second attempt should be rejected
        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/login`, {
            method: 'POST',
            body: {},
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(false);
        expect(body.error).toContain('already in progress');
    });

    it('should handle logout', async () => {
        // Wait for any pending auth to resolve first
        await new Promise(resolve => setTimeout(resolve, 200));

        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/logout`, {
            method: 'POST',
            body: {},
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.message).toContain('Logged out');
    });
});

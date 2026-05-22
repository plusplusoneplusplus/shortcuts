/**
 * Tests for Teams OAuth auth endpoints (client-side PKCE flow).
 *
 * Mocks the exchangeCodeForToken and acquireMcpOAuthToken functions
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
        exchangeCodeForToken: vi.fn().mockResolvedValue('mock-access-token'),
        acquireMcpOAuthToken: vi.fn().mockResolvedValue('mock-access-token'),
        getOAuthConfig: vi.fn().mockReturnValue({
            clientId: 'test-client-id',
            tenantId: 'test-tenant',
            scope: 'https://test/.default offline_access',
            authorizeUrl: 'https://login.microsoftonline.com/test-tenant/oauth2/v2.0/authorize',
            tokenUrl: 'https://login.microsoftonline.com/test-tenant/oauth2/v2.0/token',
        }),
    };
});

// ── Helpers ──────────────────────────────────────────────

async function httpRequest(url: string, options: { method?: string; body?: any } = {}): Promise<{ status: number; body: any; raw?: string }> {
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
                        resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw), raw });
                    } catch {
                        resolve({ status: res.statusCode ?? 0, body: raw, raw });
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
        const configContent = `messaging:\n  teams:\n    enabled: false\n    mode: graph\n    mcpServerUrl: https://agent365.svc.cloud.microsoft/agents/tenants/test-tenant/servers/mcp_TeamsServer\n    botName: TestBot\n`;
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
                    mode: 'graph',
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

    it('should return OAuth config for client-side PKCE', async () => {
        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/config`);
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.clientId).toBe('test-client-id');
        expect(body.authorizeUrl).toContain('login.microsoftonline.com');
    });

    it('should serve callback HTML page', async () => {
        const { status, raw } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/callback?code=test-code`);
        expect(status).toBe(200);
        expect(raw).toContain('teams-auth-callback');
        expect(raw).toContain('postMessage');
    });

    it('should exchange code for token and return success', async () => {
        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/exchange`, {
            method: 'POST',
            body: { code: 'test-code', codeVerifier: 'test-verifier', redirectUri: 'http://localhost:5000/callback' },
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.message).toContain('Token exchange successful');
    });

    it('should reject exchange with missing fields', async () => {
        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/exchange`, {
            method: 'POST',
            body: { code: 'test-code' },  // missing codeVerifier and redirectUri
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(false);
        expect(body.error).toContain('Missing required fields');
    });

    it('should return auth status as not authenticated when tokens missing', async () => {
        const { acquireMcpOAuthToken } = await import('@plusplusoneplusplus/teams-bot');
        vi.mocked(acquireMcpOAuthToken).mockRejectedValueOnce(new Error('No tokens'));

        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/status`);
        expect(status).toBe(200);
        expect(body.authenticated).toBe(false);
    });

    it('should return authenticated when valid tokens exist', async () => {
        const { acquireMcpOAuthToken } = await import('@plusplusoneplusplus/teams-bot');
        vi.mocked(acquireMcpOAuthToken).mockResolvedValueOnce('valid-token');

        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/status`);
        expect(status).toBe(200);
        expect(body.authenticated).toBe(true);
    });

    it('should handle logout', async () => {
        const { status, body } = await httpRequest(`${containerUrl}/api/container/messaging/teams/auth/logout`, {
            method: 'POST',
            body: {},
        });
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.message).toContain('Logged out');
    });
});

/**
 * Tests for Azure AD auth module — device code flow and scope derivation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { acquireTokenWithDeviceCode, extractTenantId } from '../src/auth';

describe('extractTenantId', () => {
    it('should extract tenant ID from Agent365 MCP URL', () => {
        const url = 'https://agent365.svc.cloud.microsoft/agents/tenants/72f988bf-86f1-41af-91ab-2d7cd011db47/servers/mcp_TeamsServer';
        expect(extractTenantId(url)).toBe('72f988bf-86f1-41af-91ab-2d7cd011db47');
    });

    it('should return undefined for URL without tenant', () => {
        expect(extractTenantId('https://example.com/api')).toBeUndefined();
    });
});

describe('acquireTokenWithDeviceCode', () => {
    let onDeviceCode: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        mockFetch.mockReset();
        onDeviceCode = vi.fn();
    });

    it('should use organizations authority and MCP server scope', async () => {
        const mcpServerUrl = 'https://agent365.svc.cloud.microsoft/agents/tenants/72f988bf-86f1-41af-91ab-2d7cd011db47/servers/mcp_TeamsServer';

        // Device code response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                device_code: 'dc-123',
                user_code: 'ABC-XYZ',
                verification_uri: 'https://microsoft.com/devicelogin',
                expires_in: 900,
                interval: 1,
                message: 'Go to https://microsoft.com/devicelogin and enter ABC-XYZ',
            }),
        });

        // Token response (immediate success)
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                access_token: 'at-success-token',
                expires_in: 3600,
                token_type: 'Bearer',
            }),
        });

        const token = await acquireTokenWithDeviceCode(
            { mcpServerUrl },
            onDeviceCode,
        );

        expect(token).toBe('at-success-token');
        expect(onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({
            userCode: 'ABC-XYZ',
            verificationUri: 'https://microsoft.com/devicelogin',
        }));

        // Verify the device code request used the tenant from the URL
        const dcCall = mockFetch.mock.calls[0];
        const dcUrl = dcCall[0] as string;
        expect(dcUrl).toBe('https://login.microsoftonline.com/72f988bf-86f1-41af-91ab-2d7cd011db47/oauth2/v2.0/devicecode');

        // Verify scope is derived from the MCP server URL
        const dcBody = dcCall[1].body as URLSearchParams;
        expect(dcBody.get('scope')).toBe(`${mcpServerUrl}/.default`);
    });

    it('should use explicit scope when provided', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                device_code: 'dc-456',
                user_code: 'DEF-UVW',
                verification_uri: 'https://microsoft.com/devicelogin',
                expires_in: 900,
                interval: 1,
                message: 'Enter DEF-UVW',
            }),
        });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                access_token: 'at-explicit-scope',
                expires_in: 3600,
                token_type: 'Bearer',
            }),
        });

        await acquireTokenWithDeviceCode(
            { mcpServerUrl: 'https://example.com/mcp', scope: 'custom://scope/.default' },
            onDeviceCode,
        );

        const dcBody = mockFetch.mock.calls[0][1].body as URLSearchParams;
        expect(dcBody.get('scope')).toBe('custom://scope/.default');
    });

    it('should throw when no scope and no mcpServerUrl', async () => {
        await expect(
            acquireTokenWithDeviceCode({}, onDeviceCode),
        ).rejects.toThrow('No scope configured and no mcpServerUrl to derive one from');
    });

    it('should throw on device code request failure', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 400,
            text: async () => '{"error":"unauthorized_client"}',
        });

        await expect(
            acquireTokenWithDeviceCode({ mcpServerUrl: 'https://example.com/mcp' }, onDeviceCode),
        ).rejects.toThrow('Device code request failed: 400');
    });

    it('should poll until token is granted (authorization_pending)', async () => {
        vi.useFakeTimers();
        const mcpServerUrl = 'https://agent365.svc.cloud.microsoft/agents/tenants/abc/servers/mcp_TeamsServer';

        // Device code response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                device_code: 'dc-poll',
                user_code: 'POLL-CODE',
                verification_uri: 'https://microsoft.com/devicelogin',
                expires_in: 900,
                interval: 1,
                message: 'Enter POLL-CODE',
            }),
        });

        // First poll: pending
        mockFetch.mockResolvedValueOnce({
            ok: false,
            json: async () => ({ error: 'authorization_pending' }),
        });

        // Second poll: success
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                access_token: 'at-after-poll',
                expires_in: 3600,
                token_type: 'Bearer',
            }),
        });

        const tokenPromise = acquireTokenWithDeviceCode({ mcpServerUrl }, onDeviceCode);
        // Advance past the poll intervals
        await vi.advanceTimersByTimeAsync(2000);

        const token = await tokenPromise;
        expect(token).toBe('at-after-poll');
        expect(mockFetch).toHaveBeenCalledTimes(3);
        vi.useRealTimers();
    });
});

describe('acquireMcpOAuthToken', () => {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    let tmpDir: string;

    beforeEach(() => {
        mockFetch.mockReset();
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-oauth-test-'));
        const configDir = path.join(tmpDir, '.copilot', 'mcp-oauth-config');
        fs.mkdirSync(configDir, { recursive: true });
    });

    // Lazy import to get the version with mocked fetch
    async function getAcquireFn() {
        const mod = await import('../src/auth');
        return mod.acquireMcpOAuthToken;
    }

    it('should return cached token when not expired', async () => {
        const configDir = path.join(tmpDir, '.copilot', 'mcp-oauth-config');
        const serverUrl = 'https://agent365.svc.cloud.microsoft/agents/tenants/test/servers/mcp_TeamsServer';

        fs.writeFileSync(path.join(configDir, 'abc.json'), JSON.stringify({
            serverUrl,
            authorizationServerUrl: 'https://login.microsoftonline.com/organizations/v2.0',
            clientId: 'test-client',
            redirectUri: 'http://127.0.0.1:50000/',
            resourceUrl: serverUrl,
        }));
        fs.writeFileSync(path.join(configDir, 'abc.tokens.json'), JSON.stringify({
            accessToken: 'valid-token-123',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            scope: 'McpServers.Teams.All',
        }));

        const acquireMcpOAuthToken = (await getAcquireFn());
        const token = await acquireMcpOAuthToken(serverUrl, tmpDir);
        expect(token).toBe('valid-token-123');
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should refresh expired token using refresh_token', async () => {
        const configDir = path.join(tmpDir, '.copilot', 'mcp-oauth-config');
        const serverUrl = 'https://agent365.svc.cloud.microsoft/agents/tenants/test/servers/mcp_TeamsServer';

        fs.writeFileSync(path.join(configDir, 'abc.json'), JSON.stringify({
            serverUrl,
            authorizationServerUrl: 'https://login.microsoftonline.com/organizations/v2.0',
            clientId: 'test-client',
            redirectUri: 'http://127.0.0.1:50000/',
            resourceUrl: serverUrl,
        }));
        fs.writeFileSync(path.join(configDir, 'abc.tokens.json'), JSON.stringify({
            accessToken: 'expired-token',
            expiresAt: Math.floor(Date.now() / 1000) - 100,
            scope: 'McpServers.Teams.All',
            refreshToken: 'refresh-token-xyz',
        }));

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                access_token: 'new-refreshed-token',
                expires_in: 3600,
                refresh_token: 'new-refresh-token',
                scope: 'McpServers.Teams.All',
            }),
        });

        const acquireMcpOAuthToken = (await getAcquireFn());
        const token = await acquireMcpOAuthToken(serverUrl, tmpDir);
        expect(token).toBe('new-refreshed-token');
        expect(mockFetch).toHaveBeenCalledTimes(1);

        // Verify persisted
        const saved = JSON.parse(fs.readFileSync(path.join(configDir, 'abc.tokens.json'), 'utf-8'));
        expect(saved.accessToken).toBe('new-refreshed-token');
        expect(saved.refreshToken).toBe('new-refresh-token');
    });

    it('should throw when no config dir exists', async () => {
        const acquireMcpOAuthToken = (await getAcquireFn());
        const nonExistentDir = path.join(tmpDir, 'no-exist');
        await expect(
            acquireMcpOAuthToken('https://example.com/mcp', nonExistentDir),
        ).rejects.toThrow('No MCP OAuth config found');
    });

    it('should throw when server URL not found in config', async () => {
        const configDir = path.join(tmpDir, '.copilot', 'mcp-oauth-config');
        fs.writeFileSync(path.join(configDir, 'other.json'), JSON.stringify({
            serverUrl: 'https://other-server.com',
            authorizationServerUrl: 'https://login.microsoftonline.com/organizations/v2.0',
            clientId: 'x',
            redirectUri: 'http://127.0.0.1:0/',
            resourceUrl: 'https://other-server.com',
        }));

        const acquireMcpOAuthToken = (await getAcquireFn());
        await expect(
            acquireMcpOAuthToken('https://not-found.com/mcp', tmpDir),
        ).rejects.toThrow('No OAuth config found for MCP server');
    });
});

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

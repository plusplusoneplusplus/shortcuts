import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '@plusplusoneplusplus/coc-native';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TeamsAuthController } from '../../src/server/teams-auth-controller';
import { installTeamsAuthRoutes } from '../../src/server/routes/teams-auth-routes';
import { RouteTable } from '../../src/server/http-util';

describe('native Teams sign-in controller and routes', () => {
    let credential: any;
    let runtime: any;
    let messagingConfig: any;
    let controller: TeamsAuthController;
    let config: any;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        credential = {
            beginBrowser: vi.fn().mockResolvedValue({ authorizationUrl: 'https://login.example/authorize' }),
            wait: vi.fn().mockImplementation(() => new Promise<void>((yes, no) => { resolve = yes; reject = no; })),
            getToken: vi.fn().mockResolvedValue('native-fixture-token'),
            getStatus: vi.fn().mockReturnValue('unauthenticated'),
            cancelSignIn: vi.fn(), deleteCredentials: vi.fn().mockResolvedValue(undefined),
        };
        config = { messaging: { teams: { mcpServerUrl: 'https://teams.example/resource',
            mode: 'graph', enabled: false, ic3Region: 'amer' } } };
        runtime = {
            getTeamsCredential: vi.fn().mockReturnValue(credential),
            startTeamsBridge: vi.fn().mockResolvedValue(undefined),
            teamsBridge: undefined,
        };
        messagingConfig = { enableTeams: vi.fn() };
        controller = new TeamsAuthController({ config, runtime, messagingConfig });
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('returns only native browser instructions and pending status, not PKCE or tokens', async () => {
        expect(await controller.start()).toEqual({ ok: true, authorizationUrl: 'https://login.example/authorize', status: 'pending' });
        expect(runtime.startTeamsBridge).not.toHaveBeenCalled();
        expect(await controller.status()).toMatchObject({ authenticated: false, status: 'pending' });
        expect(credential.getToken).not.toHaveBeenCalled();
    });
    it('reconnects only after native verification completes', async () => {
        runtime.teamsBridge = { reconnect: vi.fn().mockResolvedValue(undefined) };
        await controller.start();
        expect(runtime.teamsBridge.reconnect).not.toHaveBeenCalled();
        resolve();
        await vi.waitFor(() => expect(runtime.teamsBridge.reconnect).toHaveBeenCalledOnce());
    });
    it.each(['graph', 'mcp'])('starts a disabled bridge after success without changing %s mode', async mode => {
        config.messaging.teams.mode = mode;
        await controller.start();
        resolve();
        await vi.waitFor(() => expect(runtime.startTeamsBridge).toHaveBeenCalledOnce());
        expect(runtime.startTeamsBridge).toHaveBeenCalledWith({
            ...config.messaging.teams, mode, enabled: true, ic3Region: 'amer',
        });
        expect(messagingConfig.enableTeams).toHaveBeenCalledOnce();
    });
    it('refreshes status from native credentials after restart without exposing bearer', async () => {
        credential.getStatus.mockReturnValue('authenticated');
        expect(await controller.status()).toEqual({ authenticated: true, status: 'authenticated' });
        expect(credential.getToken).toHaveBeenCalledOnce();
    });
    it.each(['LoginRequired', 'InteractionRequired'] as const)('reports actionable sign-in requirements for %s', async code => {
        credential.getToken.mockRejectedValueOnce(new AuthError(code));
        expect(await controller.status()).toEqual({
            authenticated: false, status: 'unauthenticated',
            error: 'Teams sign-in required. Sign in again to continue.',
        });
    });
    it.each(['StorageDenied', 'StorageUnavailable', 'AccountMismatch', 'InvalidConfiguration', 'Disposed',
        'InvalidTokenResponse', 'TokenExpired', 'TimedOut'] as const)
    ('reports %s as an explicit sanitized status error', async code => {
        credential.getToken.mockRejectedValueOnce(new AuthError(code));
        expect(await controller.status()).toEqual({
            authenticated: false, status: 'error',
            error: `Teams authentication failed: ${code}. Check authentication configuration and retry.`,
        });
        expect(console.warn).toHaveBeenCalledWith(`[container] Teams auth status: ${code}`);
    });
    it('sanitizes unknown runtime/network errors and never returns unauthenticated without detail', async () => {
        runtime.getTeamsCredential.mockImplementationOnce(() => { throw new Error('private provider response'); });
        expect(await controller.status()).toEqual({
            authenticated: false, status: 'error',
            error: 'Teams authentication failed: AuthenticationFailed. Check authentication configuration and retry.',
        });
    });
    it('pending polls retain errors and avoid token IO; successful demand recovery clears only demand errors', async () => {
        await controller.start();
        runtime.getTeamsCredential.mockImplementationOnce(() => { throw new AuthError('StorageDenied'); });
        const failure = await controller.status();
        expect(failure).toMatchObject({ status: 'error', error: expect.stringContaining('StorageDenied') });
        expect(await controller.status()).toEqual(failure);
        expect(credential.getToken).not.toHaveBeenCalled();
        resolve();
        await vi.waitFor(() => expect(runtime.startTeamsBridge).toHaveBeenCalledOnce());
        credential.getStatus.mockReturnValue('authenticated');
        expect(await controller.status()).toEqual({ authenticated: true, status: 'authenticated' });
    });
    it('sign-in failure is sanitized and never starts a bridge', async () => {
        await controller.start();
        reject(new Error('secret provider response'));
        await vi.waitFor(async () => expect(await controller.status()).toMatchObject({ status: 'error' }));
        expect(await controller.status()).toMatchObject({ error: 'Teams sign-in or connection failed' });
        expect(runtime.startTeamsBridge).not.toHaveBeenCalled();
    });
    it('begin failure and missing endpoint fail explicitly', async () => {
        credential.beginBrowser.mockRejectedValueOnce(new Error('private error'));
        expect(await controller.start()).toEqual({ ok: false, error: 'Unable to start Teams sign-in' });
        config.messaging.teams.mcpServerUrl = '';
        expect(await controller.start()).toMatchObject({ ok: false, error: 'No mcpServerUrl configured' });
    });
    it.each(['cancel', 'logout', 'configuration'])('stale completion after %s cannot reconnect', async action => {
        await controller.start();
        if (action === 'cancel') await controller.cancel();
        if (action === 'logout') await controller.logout();
        if (action === 'configuration') runtime.getTeamsCredential.mockReturnValue({ ...credential });
        resolve();
        await new Promise(r => setTimeout(r, 0));
        expect(runtime.startTeamsBridge).not.toHaveBeenCalled();
    });
    it('logout stops the bridge before deleting exact native credentials', async () => {
        runtime.teamsBridge = { stop: vi.fn(async () => {
            expect(credential.deleteCredentials).not.toHaveBeenCalled();
        }) };
        expect(await controller.logout()).toMatchObject({ ok: true });
        expect(credential.cancelSignIn).toHaveBeenCalledOnce();
        expect(credential.deleteCredentials).toHaveBeenCalledOnce();
        expect(runtime.teamsBridge).toBeUndefined();
    });
    it('credential deletion failure is explicit and sanitized', async () => {
        credential.deleteCredentials.mockRejectedValueOnce(new Error('private storage path'));
        expect(await controller.logout()).toEqual({ ok: false, error: 'Unable to stop Teams or delete credentials' });
    });
    it('routes expose server-owned start/status/cancel/logout and do not accept code exchange', async () => {
        const table = new RouteTable();
        installTeamsAuthRoutes(table, controller);
        async function dispatch(method: string, path: string) {
            const response = { writeHead: vi.fn(), end: vi.fn() };
            const matched = await table.dispatch({
                method, url: new URL(`http://localhost${path}`),
                req: Readable.from([]) as IncomingMessage, res: response as unknown as ServerResponse,
            });
            return { matched, body: response.end.mock.calls.length ? JSON.parse(response.end.mock.calls[0][0]) : undefined };
        }
        const base = '/api/container/messaging/teams/auth';
        expect((await dispatch('POST', `${base}/start`)).body).toMatchObject({ ok: true, status: 'pending' });
        expect((await dispatch('GET', `${base}/status`)).body).toMatchObject({ status: 'pending' });
        expect((await dispatch('POST', `${base}/cancel`)).body).toEqual({ ok: true });
        expect((await dispatch('POST', `${base}/logout`)).body).toMatchObject({ ok: true });
        expect((await dispatch('POST', `${base}/exchange`)).body).toBeUndefined();
        resolve();
    });
});

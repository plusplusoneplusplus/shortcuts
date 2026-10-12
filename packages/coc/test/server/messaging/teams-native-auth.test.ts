import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import { TeamsOAuthCredential } from '@plusplusoneplusplus/coc-connector/teams';
import { buildTeamsMcpAuthHandler, disposeTeamsOAuthCredentials, getTeamsOAuthCredential,
    teamsNativeAuthStatus } from '../../../src/server/messaging/teams-native-auth';

vi.mock('@plusplusoneplusplus/coc-connector/teams', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/coc-connector/teams')>(),
    TeamsOAuthCredential: vi.fn().mockImplementation(function () {
        return {
            getStatus: vi.fn(() => 'unauthenticated'),
            getTokenSnapshot: vi.fn().mockResolvedValue({
                accessToken: 'fixture-token', tokenType: 'Bearer', expiresAt: Date.now() + 3600000,
            }),
            dispose: vi.fn(),
        };
    }),
}));

const dataDir = path.join(os.tmpdir(), 'native-teams-host-fixture');
const otherDir = path.join(os.tmpdir(), 'native-teams-other-host-fixture');
const serverUrl = 'https://resource.example/tenants/11111111-1111-4111-8111-111111111111/mcp';
afterEach(() => {
    disposeTeamsOAuthCredentials(dataDir);
    disposeTeamsOAuthCredentials(otherDir);
    vi.clearAllMocks();
});

describe('host-owned Teams native credentials', () => {
    it('shares one owner across callers while isolating hosts and resource endpoints', () => {
        const first = getTeamsOAuthCredential(dataDir, serverUrl);
        expect(getTeamsOAuthCredential(dataDir, serverUrl)).toBe(first);
        expect(getTeamsOAuthCredential(otherDir, serverUrl)).not.toBe(first);
        expect(getTeamsOAuthCredential(dataDir, serverUrl + '/other')).not.toBe(first);
        expect(TeamsOAuthCredential).toHaveBeenCalledTimes(3);
        expect(TeamsOAuthCredential).toHaveBeenCalledWith({ dataDir: path.resolve(dataDir), serverUrl, mode: 'mcp' });
    });

    it('does not report a legacy cache as authenticated and disposes every host owner', () => {
        const credential = getTeamsOAuthCredential(dataDir, serverUrl);
        expect(teamsNativeAuthStatus(dataDir, serverUrl)).toBe('required');
        disposeTeamsOAuthCredentials(dataDir);
        expect(credential.dispose).toHaveBeenCalledTimes(1);
        expect(getTeamsOAuthCredential(dataDir, serverUrl)).not.toBe(credential);
    });

    it('leaves sessions without Teams on the provider-owned OAuth path', () => {
        expect(buildTeamsMcpAuthHandler(dataDir, { other: { type: 'http', url: serverUrl, tools: ['*'] } }))
            .toBeUndefined();
        expect(TeamsOAuthCredential).not.toHaveBeenCalled();
    });

    it('supplies native tokens only for exact configured server name and URL', async () => {
        const signal = new AbortController().signal;
        const handler = buildTeamsMcpAuthHandler(dataDir, {
            'Microsoft Teams': { type: 'http', url: serverUrl, tools: ['*'] },
        }, signal)!;
        const request = { requestId: 'fixture-request', serverName: 'Microsoft Teams', serverUrl,
            reason: 'initial' as const };
        const result = await handler(request, { sessionId: 'fixture-session' });
        expect(result).toMatchObject({ kind: 'token', accessToken: 'fixture-token', tokenType: 'Bearer' });
        const credential = getTeamsOAuthCredential(dataDir, serverUrl);
        expect(credential.getTokenSnapshot).toHaveBeenCalledWith(signal, false);
        await handler({ ...request, reason: 'refresh' }, { sessionId: 'fixture-session' });
        expect(credential.getTokenSnapshot).toHaveBeenLastCalledWith(signal, true);
        expect(await handler({ ...request, serverUrl: 'https://other.example' }, { sessionId: 'fixture-session' }))
            .toEqual({ kind: 'cancelled' });
        expect(await handler({ ...request, serverName: 'other' }, { sessionId: 'fixture-session' }))
            .toEqual({ kind: 'cancelled' });
        expect(await handler({ ...request, reason: 'upscope' }, { sessionId: 'fixture-session' }))
            .toEqual({ kind: 'cancelled' });
    });

    it('never supplies a token after the turn is cancelled', async () => {
        const controller = new AbortController();
        const handler = buildTeamsMcpAuthHandler(dataDir, {
            'Microsoft Teams': { type: 'http', url: serverUrl, tools: ['*'] },
        }, controller.signal)!;
        controller.abort();
        await expect(handler({ requestId: 'fixture-request', serverName: 'Microsoft Teams',
            serverUrl, reason: 'initial' }, { sessionId: 'fixture-session' })).rejects.toThrow();
        expect(TeamsOAuthCredential).not.toHaveBeenCalled();
    });
});

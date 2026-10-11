import { describe, expect, it, vi } from 'vitest';
import { AuthError } from '@plusplusoneplusplus/coc-native';
import { TeamsOAuthFlow } from '../../../src/server/messaging/teams-oauth-flow';
import { McpOauthManager } from '../../../src/server/mcp-oauth/mcp-oauth-manager';

const serverUrl = 'https://resource.example/tenants/11111111-1111-4111-8111-111111111111/mcp';
const authorizationUrl = 'https://login.microsoftonline.com/fixture/authorize';

function fixture() {
    let complete!: () => void;
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject; });
    const credential = {
        beginBrowser: vi.fn().mockResolvedValue({ authorizationUrl }),
        wait: vi.fn(() => pending),
        cancelSignIn: vi.fn(),
    };
    const manager = new McpOauthManager();
    const resolveCredential = vi.fn(() => credential);
    return { credential, manager, complete, fail, resolveCredential,
        flow: new TeamsOAuthFlow(manager, resolveCredential) };
}

describe('native Teams OAuth orchestration', () => {
    it('returns native instructions and publishes completion only after native wait succeeds', async () => {
        const f = fixture();
        const result = await f.flow.start(serverUrl, { workspaceId: 'workspace-fixture' });
        expect(result.authorizationUrl).toBe(authorizationUrl);
        expect(f.resolveCredential).toHaveBeenCalledWith(serverUrl);
        expect(f.manager.getPending(result.requestId)).toMatchObject({
            status: 'pending', authorizationUrl, workspaceId: 'workspace-fixture',
        });
        f.complete();
        await vi.waitFor(() => expect(f.manager.getPending(result.requestId)?.status).toBe('completed'));
    });

    it('does not allow concurrent sign-in for the same flow', async () => {
        const f = fixture();
        await f.flow.start(serverUrl);
        await expect(f.flow.start(serverUrl)).rejects.toThrow('already in progress');
        expect(f.credential.beginBrowser).toHaveBeenCalledTimes(1);
        f.flow.cancel();
        f.complete();
    });

    it('reports sanitized native failures without provider payloads', async () => {
        const f = fixture();
        const result = await f.flow.start(serverUrl);
        f.fail(new AuthError('IdentityVerificationFailed'));
        await vi.waitFor(() => expect(f.manager.getPending(result.requestId)).toMatchObject({
            status: 'failed', error: 'IdentityVerificationFailed',
        }));
    });

    it('never exposes arbitrary provider errors', async () => {
        const f = fixture();
        const result = await f.flow.start(serverUrl);
        f.fail(new Error('private-credential-fixture'));
        await vi.waitFor(() => expect(f.manager.getPending(result.requestId)).toMatchObject({
            status: 'failed', error: 'Teams authentication failed',
        }));
    });

    it('cancels native work and ignores delayed completion', async () => {
        const f = fixture();
        const result = await f.flow.start(serverUrl);
        f.flow.cancel();
        expect(f.credential.cancelSignIn).toHaveBeenCalledTimes(1);
        f.complete();
        await Promise.resolve();
        expect(f.manager.getPending(result.requestId)?.status).toBe('failed');
    });

    it('cancels an interrupted begin operation before publishing instructions', async () => {
        const f = fixture();
        let release!: (value: { authorizationUrl: string }) => void;
        f.credential.beginBrowser.mockImplementationOnce(() =>
            new Promise(resolve => { release = resolve; }));
        const starting = f.flow.start(serverUrl);
        f.flow.cancel();
        release({ authorizationUrl });
        await expect(starting).rejects.toThrow('interrupted');
        expect(f.manager.listPending()).toEqual([]);
        f.complete();
    });

    it('cleans up a failed begin and allows a fresh sign-in', async () => {
        const f = fixture();
        f.credential.beginBrowser.mockRejectedValueOnce(new AuthError('InvalidConfiguration'));
        await expect(f.flow.start(serverUrl)).rejects.toMatchObject({ code: 'InvalidConfiguration' });
        expect(f.credential.cancelSignIn).toHaveBeenCalledTimes(1);
        await expect(f.flow.start(serverUrl)).resolves.toMatchObject({ authorizationUrl });
        f.flow.cancel();
        f.complete();
    });

    it('cannot revive a request removed by the caller', async () => {
        const f = fixture();
        const result = await f.flow.start(serverUrl);
        f.manager.remove(result.requestId);
        f.complete();
        await Promise.resolve();
        expect(f.manager.getPending(result.requestId)).toBeUndefined();
    });

    it('does not let an old begin failure cancel a replacement sign-in', async () => {
        const f = fixture();
        let release!: (value: { authorizationUrl: string }) => void;
        f.credential.beginBrowser.mockImplementationOnce(() =>
            new Promise(resolve => { release = resolve; }));
        const old = f.flow.start(serverUrl);
        f.flow.cancel();
        const replacement = await f.flow.start(serverUrl);
        release({ authorizationUrl });
        await expect(old).rejects.toThrow('interrupted');
        expect(f.credential.cancelSignIn).toHaveBeenCalledTimes(1);
        expect(f.manager.getPending(replacement.requestId)?.status).toBe('pending');
        f.complete();
        await vi.waitFor(() => expect(f.manager.getPending(replacement.requestId)?.status).toBe('completed'));
    });
});

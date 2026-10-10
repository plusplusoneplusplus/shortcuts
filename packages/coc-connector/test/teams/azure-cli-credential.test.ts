import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, MicrosoftTokenProvider, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { TeamsAzureCliCredential } from '../../src/teams/azure-cli-credential';
import { acquireTokenViaAzCli } from '../../src/teams/auth';
import { GraphCredentialStore } from '../../src/teams/graph/graph-credential';
import { GraphChannelReader } from '../../src/teams/graph/channel-reader';
import { Ic3CredentialStore } from '../../src/teams/ic3/ic3-credential';
import { TeamsBot } from '../../src/teams/bot';
import { McpClient } from '../../src/teams/mcp/mcp-client';
import { McpTransport } from '../../src/teams/mcp/transport-mcp';

const native = vi.hoisted(() => ({
    getToken: vi.fn(), dispose: vi.fn(), cancelOutstanding: vi.fn(),
}));
vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>(),
    MicrosoftTokenProvider: vi.fn(function () { return native; }),
}));
const account = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    objectId: '22222222-2222-4222-8222-222222222222',
};
function token(audience = 'https://graph.microsoft.com', patch: Record<string, unknown> = {}) {
    return `header.${Buffer.from(JSON.stringify({
        tid: account.tenantId, oid: account.objectId, aud: audience,
        exp: Math.floor(Date.now() / 1000) + 3600,
        scp: 'ChannelMessage.Send ChannelMessage.Read.All', name: 'Fixture Account', ...patch,
    })).toString('base64url')}.signature`;
}
const signal = () => new AbortController().signal;

beforeEach(() => {
    vi.mocked(MicrosoftTokenProvider).mockClear();
    native.getToken.mockReset().mockResolvedValue({ accessToken: token() });
    native.dispose.mockReset();
    native.cancelOutstanding.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Teams auth-sdk Azure CLI adapter', () => {
    it('constructs lazily and delegates every read to one pinned resource provider', async () => {
        const credential = new TeamsAzureCliCredential('https://graph.microsoft.com');
        const value = token();
        native.getToken.mockResolvedValue({ accessToken: value });
        expect(MicrosoftTokenProvider).not.toHaveBeenCalled();
        expect(await credential.get(signal())).toBe(value);
        await credential.get(signal());
        expect(MicrosoftTokenProvider).toHaveBeenCalledExactlyOnceWith({
            source: 'azure-cli', refresh: 'auto', timeoutMs: 30_000,
            azureCli: { selection: 'active-account', namespace: 'teams', resource: 'https://graph.microsoft.com' },
        });
        expect(native.getToken.mock.calls).toEqual([[{ forceRefresh: false }], [{ forceRefresh: false }]]);
        credential.dispose();
    });

    it('forces renewal explicitly and after clearing, then resumes ordinary SDK reads', async () => {
        const credential = new TeamsAzureCliCredential('https://ic3.teams.office.com');
        await credential.get(signal(), true);
        credential.clear();
        await credential.get(signal());
        await credential.get(signal());
        expect(native.getToken.mock.calls).toEqual([
            [{ forceRefresh: true }], [{ forceRefresh: true }], [{ forceRefresh: false }],
        ]);
        credential.dispose();
    });

    it.each(['CliUnavailable', 'AccountMismatch', 'LoginRequired', 'TimedOut'] as const)(
        'propagates %s without another source or provider', async code => {
            native.getToken.mockRejectedValue(new AuthError(code));
            const credential = new TeamsAzureCliCredential('https://graph.microsoft.com');
            await expect(credential.get(signal())).rejects.toMatchObject({ code });
            expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
            expect(native.getToken).toHaveBeenCalledOnce();
            credential.dispose();
        },
    );

    it('cancels native work, removes listeners and rejects a late token', async () => {
        let release!: (value: { accessToken: string }) => void;
        native.getToken.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const caller = new AbortController();
        const remove = vi.spyOn(caller.signal, 'removeEventListener');
        const credential = new TeamsAzureCliCredential('https://graph.microsoft.com');
        const pending = credential.get(caller.signal);
        const rejected = expect(pending).rejects.toMatchObject({ code: 'Cancelled' });
        caller.abort();
        await rejected;
        expect(native.cancelOutstanding).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
        release({ accessToken: token() });
        credential.dispose();
    });

    it('rejects pre-aborted and disposed operations without constructing a provider', async () => {
        const credential = new TeamsAzureCliCredential('https://graph.microsoft.com');
        await expect(credential.get(AbortSignal.abort())).rejects.toThrow();
        credential.dispose();
        await expect(credential.get(signal())).rejects.toMatchObject({ code: 'Disposed' });
        expect(MicrosoftTokenProvider).not.toHaveBeenCalled();
    });

    it('rejects publication when the owner disposes an in-flight operation', async () => {
        let release!: (value: { accessToken: string }) => void;
        native.getToken.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const credential = new TeamsAzureCliCredential('https://graph.microsoft.com');
        const pending = credential.get(signal());
        credential.dispose();
        release({ accessToken: token() });
        await expect(pending).rejects.toMatchObject({ code: 'Disposed' });
        expect(native.dispose).toHaveBeenCalledOnce();
    });

    it('retains a clear request made while acquisition is in flight', async () => {
        let release!: (value: { accessToken: string }) => void;
        native.getToken.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
        const credential = new TeamsAzureCliCredential('https://graph.microsoft.com');
        const pending = credential.get(signal());
        credential.clear();
        release({ accessToken: token() });
        await pending;
        await credential.get(signal());
        expect(native.getToken).toHaveBeenLastCalledWith({ forceRefresh: true });
        credential.dispose();
    });

    it('disposes the one-shot public helper on both success and failure', async () => {
        await acquireTokenViaAzCli();
        expect(native.dispose).toHaveBeenCalledTimes(1);
        native.getToken.mockRejectedValueOnce(new AuthError('AccountMismatch'));
        await expect(acquireTokenViaAzCli('https://ic3.teams.office.com')).rejects.toMatchObject({ code: 'AccountMismatch' });
        expect(native.dispose).toHaveBeenCalledTimes(2);
    });
});

describe('Teams Graph startup deadlines', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay);
            return controller.signal;
        });
    });

    it('allows cold Azure CLI acquisition beyond the former reader and provider deadlines', async () => {
        native.getToken.mockImplementation(() => new Promise(resolve => {
            setTimeout(() => resolve({ accessToken: token() }), 20_000);
        }));
        const reader = new GraphChannelReader(account);
        const initialized = expect(reader.initialize()).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(20_000);
        await initialized;
        expect(AbortSignal.timeout).toHaveBeenCalledWith(30_000);
        expect(MicrosoftTokenProvider).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 30_000 }));
        expect(native.cancelOutstanding).not.toHaveBeenCalled();
        reader.stop();
    });

    it('cancels stalled acquisition at the thirty-second startup deadline', async () => {
        native.getToken.mockImplementation(() => new Promise(() => {}));
        const reader = new GraphChannelReader(account);
        const rejected = expect(reader.initialize()).rejects.toThrow('Graph credential acquisition cancelled or timed out');
        await vi.advanceTimersByTimeAsync(29_999);
        expect(native.cancelOutstanding).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(native.cancelOutstanding).toHaveBeenCalledOnce();
        reader.stop();
    });

    it('stops pending acquisition immediately without waiting for the extended deadline', async () => {
        native.getToken.mockImplementation(() => new Promise(() => {}));
        const reader = new GraphChannelReader(account);
        const rejected = expect(reader.initialize()).rejects.toThrow('Graph credential acquisition cancelled or timed out');
        await vi.advanceTimersByTimeAsync(1_000);
        reader.stop();
        await rejected;
        expect(native.cancelOutstanding).toHaveBeenCalledOnce();
        expect(native.dispose).toHaveBeenCalledOnce();
    });

    function transport() {
        vi.spyOn(McpClient.prototype, 'initialize').mockResolvedValue(undefined);
        vi.spyOn(McpClient.prototype, 'listTools').mockResolvedValue({ tools: [] });
        return new McpTransport('https://example.test/mcp', undefined, undefined, undefined, undefined, {
            channelReadBackend: 'graph', graphReadOptions: {}, graphOutboundOptions: {},
            routes: { channelSend: 'graph', channelReply: 'graph' },
        });
    }

    it('initializes both native Graph writer and reader with slow cold credentials', async () => {
        native.getToken.mockImplementation(() => new Promise(resolve => {
            setTimeout(() => resolve({ accessToken: token() }), 20_000);
        }));
        const connection = transport();
        const initialized = expect(connection.initialize(token(), { teamId: 'fixture-team' })).resolves.toBeUndefined();
        await vi.advanceTimersByTimeAsync(40_000);
        await initialized;
        expect(MicrosoftTokenProvider).toHaveBeenCalledTimes(2);
        expect(native.getToken).toHaveBeenCalledTimes(2);
        expect(vi.mocked(AbortSignal.timeout).mock.calls).toEqual([[30_000], [30_000]]);
        expect(native.cancelOutstanding).not.toHaveBeenCalled();
        connection.stop();
        expect(native.dispose).toHaveBeenCalledTimes(2);
    });

    it('bounds stalled writer startup and never initializes the reader', async () => {
        native.getToken.mockImplementation(() => new Promise(() => {}));
        const connection = transport();
        const rejected = expect(connection.initialize(token(), { teamId: 'fixture-team' }))
            .rejects.toThrow('Graph credential acquisition cancelled or timed out');
        await vi.advanceTimersByTimeAsync(29_999);
        expect(native.cancelOutstanding).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(native.cancelOutstanding).toHaveBeenCalledOnce();
        expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
        connection.stop();
        expect(native.dispose).toHaveBeenCalledOnce();
    });

    it('cancels slow writer startup immediately on transport stop', async () => {
        native.getToken.mockImplementation(() => new Promise(() => {}));
        const connection = transport();
        const rejected = expect(connection.initialize(token(), { teamId: 'fixture-team' }))
            .rejects.toThrow('Graph credential acquisition cancelled or timed out');
        await vi.advanceTimersByTimeAsync(1_000);
        connection.stop();
        await rejected;
        expect(native.cancelOutstanding).toHaveBeenCalledOnce();
        expect(native.dispose).toHaveBeenCalledOnce();
        expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
    });

    it('keeps actual sends at ten seconds despite longer startup budgets', async () => {
        const connection = transport();
        await connection.initialize(token(), { teamId: 'fixture-team' });
        native.getToken.mockImplementationOnce(() => new Promise(() => {}));
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const rejected = expect(connection.send('fixture-channel', 'fixture'))
            .rejects.toMatchObject({ code: 'timeout', outcome: 'not-attempted' });
        await vi.advanceTimersByTimeAsync(9_999);
        expect(native.cancelOutstanding).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
        expect(native.cancelOutstanding).toHaveBeenCalledOnce();
        expect(fetch).not.toHaveBeenCalled();
        connection.stop();
    });
});

describe('Teams resource credential wiring', () => {
    it('reports missing native authentication as an actionable hard failure', async () => {
        for (const credentials of [
            new GraphCredentialStore(account),
            new Ic3CredentialStore({ region: 'amer', expectedAccount: account }),
        ]) {
            vi.mocked(MicrosoftTokenProvider).mockImplementationOnce(function () {
                throw new NativeAddonLoadError('fixture missing capability');
            });
            await expect(credentials.get(signal())).rejects.toMatchObject({
                code: 'unavailable', outcome: 'not-attempted',
                message: expect.stringContaining('npm run build:native'),
            });
            credentials.dispose();
        }
        expect(native.getToken).not.toHaveBeenCalled();
    });

    it('checks the SDK account selection even with a previously valid Graph token', async () => {
        const credentials = new GraphCredentialStore(account);
        await credentials.get(signal());
        native.getToken.mockRejectedValueOnce(new AuthError('AccountMismatch'));
        await expect(credentials.get(signal())).rejects.toMatchObject({ code: 'authentication', backend: 'graph' });
        expect(native.getToken).toHaveBeenCalledTimes(2);
        credentials.dispose();
    });

    it('forces Graph 401 renewal and retains Teams account and consent checks', async () => {
        const credentials = new GraphCredentialStore(account);
        await credentials.get(signal());
        native.getToken.mockResolvedValueOnce({ accessToken: token('https://graph.microsoft.com', { oid: account.tenantId }) });
        await expect(credentials.get(signal(), true)).rejects.toThrow('identity mismatch');
        expect(native.getToken).toHaveBeenLastCalledWith({ forceRefresh: true });
        native.getToken.mockResolvedValueOnce({ accessToken: token('https://graph.microsoft.com', { scp: 'User.Read' }) });
        await expect(credentials.get(signal())).rejects.toThrow('ChannelMessage.Send');
        credentials.dispose();
    });

    it('disposes the hybrid reader provider on stop', async () => {
        const reader = new GraphChannelReader(account);
        await reader.initialize();
        reader.stop();
        expect(native.dispose).toHaveBeenCalledOnce();
    });

    it('checks the IC3 SDK selection for every operation without a TypeScript token cache', async () => {
        native.getToken.mockResolvedValue({ accessToken: token('https://ic3.teams.office.com') });
        const credentials = new Ic3CredentialStore({ region: 'amer', expectedAccount: account });
        await credentials.get(signal(), true);
        native.getToken.mockRejectedValueOnce(new AuthError('AccountMismatch'));
        await expect(credentials.get(signal(), true)).rejects.toMatchObject({ backend: 'ic3', code: 'authentication' });
        expect(native.getToken).toHaveBeenCalledTimes(2);
        expect(MicrosoftTokenProvider).toHaveBeenCalledWith(expect.objectContaining({
            azureCli: expect.objectContaining({ resource: 'https://ic3.teams.office.com' }),
        }));
        credentials.dispose();
        expect(native.dispose).toHaveBeenCalledOnce();
    });

    it('uses one SDK provider for standalone Graph connection and writes, and disposes on stop', async () => {
        const fetch = vi.fn()
            .mockResolvedValueOnce(Response.json({ id: account.objectId, displayName: 'Fixture Account' }))
            .mockResolvedValueOnce(Response.json({ id: 'message-id' }, { status: 201 }));
        vi.stubGlobal('fetch', fetch);
        const bot = new TeamsBot({ mode: 'graph', chatId: 'chat-id', onMessage: async () => {} });
        await bot.start();
        expect(bot.getStatus()).toBe('connected');
        await expect(bot.send('chat-id', 'fixture')).resolves.toBe('message-id');
        expect(MicrosoftTokenProvider).toHaveBeenCalledOnce();
        expect(native.getToken).toHaveBeenCalledTimes(2);
        await bot.stop();
        expect(native.dispose).toHaveBeenCalledOnce();
    });

    it('rejects a changed CLI account before standalone Graph write dispatch', async () => {
        const fetch = vi.fn().mockResolvedValue(Response.json({ id: account.objectId }));
        vi.stubGlobal('fetch', fetch);
        const bot = new TeamsBot({ mode: 'graph', chatId: 'chat-id', onMessage: async () => {} });
        await bot.start();
        native.getToken.mockRejectedValueOnce(new AuthError('AccountMismatch'));
        await expect(bot.send('chat-id', 'fixture')).rejects.toMatchObject({
            backend: 'graph', code: 'authentication', outcome: 'not-attempted',
        });
        expect(fetch).toHaveBeenCalledOnce();
        await bot.stop();
    });

    it('disposes a failed standalone Graph startup without a fallback', async () => {
        native.getToken.mockRejectedValueOnce(new AuthError('LoginRequired'));
        const onError = vi.fn();
        const bot = new TeamsBot({ mode: 'graph', onMessage: async () => {}, onError });
        await bot.start();
        expect(bot.getStatus()).toBe('error');
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('LoginRequired'));
        expect(native.getToken).toHaveBeenCalledOnce();
        expect(native.dispose).toHaveBeenCalledOnce();
        await bot.stop();
    });

    it('cancels standalone Graph startup on stop without making an authenticated request', async () => {
        native.getToken.mockImplementation(() => new Promise(() => {}));
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const bot = new TeamsBot({ mode: 'graph', onMessage: async () => {} });
        const start = bot.start();
        await bot.stop();
        await start;
        expect(bot.getStatus()).toBe('disconnected');
        expect(native.cancelOutstanding).toHaveBeenCalledOnce();
        expect(native.dispose).toHaveBeenCalledOnce();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not publish a stopped connection refresh failure into bot status', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: account.objectId })));
        const onError = vi.fn();
        const bot = new TeamsBot({ mode: 'graph', onMessage: async () => {}, onError });
        await bot.start();
        native.getToken.mockImplementationOnce(() => new Promise(() => {}));
        const refresh: Promise<boolean> = Reflect.apply(Reflect.get(bot, 'refreshToken'), bot, []);
        await bot.stop();
        await expect(refresh).resolves.toBe(false);
        expect(bot.getStatus()).toBe('disconnected');
        expect(onError).not.toHaveBeenCalled();
    });
});

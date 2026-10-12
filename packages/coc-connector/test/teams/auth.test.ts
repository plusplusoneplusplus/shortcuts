import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AuthError } from '@plusplusoneplusplus/coc-native';

const native = vi.hoisted(() => ({
    providers: [] as any[], signIns: [] as any[], result: undefined as any,
    begin: vi.fn(), wait: vi.fn(), get: vi.fn(), remove: vi.fn(),
    initialize: vi.fn(), tools: vi.fn(), exec: vi.fn(),
}));
vi.mock('node:child_process', async () => {
    const { promisify } = await import('node:util');
    const execFile = () => {};
    Object.assign(execFile, { [promisify.custom]: async (...args: any[]) => {
        native.exec(...args);
        return { stdout: 'S-1-5-21-123', stderr: '' };
    } });
    return { execFile };
});
vi.mock('@plusplusoneplusplus/coc-native', async original => ({
    ...await original<typeof import('@plusplusoneplusplus/coc-native')>(),
    MicrosoftOAuthSignIn: class {
        beginBrowser = native.begin;
        wait = native.wait;
        cancel = vi.fn();
        dispose = vi.fn();
        constructor(public options: any, public expected: any) { native.signIns.push(this); }
    },
    MicrosoftTokenProvider: class {
        private reject?: (error: Error) => void;
        getToken = vi.fn((options: any) => new Promise<any>((resolve, reject) => {
            this.reject = reject;
            native.get(options).then(resolve, reject);
        }));
        deleteCredentials = native.remove;
        cancelOutstanding = vi.fn(() => this.reject?.(new AuthError('Cancelled')));
        dispose = vi.fn(() => this.reject?.(new AuthError('Disposed')));
        constructor(public options: any) { native.providers.push(this); }
    },
}));
vi.mock('../../src/teams/mcp/mcp-client', () => ({
    McpClient: class {
        initialize = native.initialize;
        listTools = native.tools;
    },
}));
import { TeamsOAuthCredential, extractTenantId } from '../../src/teams/auth';

const tenant = '11111111-1111-4111-8111-111111111111';
const object = '22222222-2222-4222-8222-222222222222';
const serverUrl = `https://teams.example/agents/tenants/${tenant}/servers/mcp_TeamsServer`;

describe('native Teams OAuth owner', () => {
    let dataDir: string;
    const owners: TeamsOAuthCredential[] = [];
    function owner(options = {}) {
        const credential = new TeamsOAuthCredential({ dataDir, serverUrl, ...options });
        owners.push(credential);
        return credential;
    }
    async function login(credential: TeamsOAuthCredential) {
        await credential.beginBrowser();
        await credential.wait();
    }
    beforeEach(async () => {
        vi.clearAllMocks();
        native.providers = [];
        native.signIns = [];
        dataDir = await fs.mkdtemp(path.join(process.cwd(), '.teams-auth-test-'));
        native.result = { account: { id: object, tenant },
            token: { accessToken: 'opaque-fixture-token', account: { id: object, tenant },
                source: 'oauth', target: serverUrl, tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000 } };
        native.begin.mockResolvedValue({ authorizationUrl: 'https://login.example/authorize' });
        native.wait.mockImplementation(async () => native.result);
        native.get.mockImplementation(async () => native.result.token);
        native.remove.mockResolvedValue(undefined);
        native.initialize.mockResolvedValue(undefined);
        native.tools.mockResolvedValue({ tools: [] });
    });
    afterEach(async () => {
        owners.splice(0).forEach(credential => credential.dispose());
        vi.restoreAllMocks();
        await fs.rm(dataDir, { recursive: true, force: true });
    });

    it('construction performs no native/token IO; getToken never signs in or falls back', async () => {
        const credential = owner();
        expect(credential.getStatus()).toBe('unauthenticated');
        expect(native.signIns).toHaveLength(0);
        expect(native.providers).toHaveLength(0);
        expect(await fs.readdir(dataDir)).toEqual([]);
        await expect(credential.getToken()).rejects.toMatchObject({ code: 'LoginRequired' });
        expect(native.begin).not.toHaveBeenCalled();
        expect(native.get).not.toHaveBeenCalled();
    });
    it.each(['organizations', 'not-a-uuid', '%31%31%31'])('rejects non-exact tenant %s', tenantPart => {
        expect(extractTenantId(`https://teams.example/tenants/${tenantPart}/server`)).toBeUndefined();
        expect(() => owner({ serverUrl: `https://teams.example/tenants/${tenantPart}/server` }))
            .toThrow(AuthError);
    });
    it.each(['http://teams.example', 'invalid', `${serverUrl}?redirect=x`, `${serverUrl}#fragment`])
    ('rejects unsafe endpoint %s', url => {
        expect(() => owner({ serverUrl: url })).toThrow(AuthError);
    });
    it('composes exact identity/resource scopes, authority and supported registration', async () => {
        const credential = owner({ scope: `${serverUrl}/.default offline_access` });
        await login(credential);
        const oauth = native.signIns[0].options;
        expect(oauth).toMatchObject({
            authority: `https://login.microsoftonline.com/${tenant}`,
            clientId: 'aebc6443-996d-45c2-90f0-388ff96faa56', target: serverUrl, resource: serverUrl,
            scopes: ['offline_access', 'openid', 'profile', `${serverUrl}/.default`].sort(),
        });
        expect(oauth.coordinationDirectory.startsWith(dataDir + path.sep)).toBe(true);
        expect(native.initialize).toHaveBeenCalled();
        expect(native.tools).toHaveBeenCalled();
        expect(credential.getAccount()).toEqual({ tenantId: tenant, objectId: object });
        expect(credential.getStatus()).toBe('authenticated');
        const metadata = await fs.readFile(path.join(oauth.coordinationDirectory, 'account.json'), 'utf8');
        expect(metadata).not.toContain('opaque-fixture-token');
        expect(JSON.parse(metadata)).toEqual({ fingerprint: expect.any(String), account: { id: object, tenant } });
    });
    it('restores only verified metadata and source-pinned native credentials after restart', async () => {
        const first = owner();
        await login(first);
        first.dispose();
        const restarted = owner();
        expect(restarted.getAccount()).toEqual({ tenantId: tenant, objectId: object });
        expect(restarted.getStatus()).toBe('authenticated');
        expect(native.get).not.toHaveBeenCalled();
        expect(await restarted.getToken()).toBe('opaque-fixture-token');
        expect(restarted.getAccount()).toEqual({ tenantId: tenant, objectId: object });
        expect(native.begin).toHaveBeenCalledTimes(1);
        expect(native.providers.at(-1).options).toMatchObject({
            source: 'oauth', refresh: 'auto', account: { id: object, tenant },
        });
    });
    it('delegates every demand and forced refresh, exposing native expiry without caching tokens', async () => {
        const credential = owner();
        await login(credential);
        await credential.getToken();
        expect(await credential.getTokenSnapshot(undefined, true)).toEqual(native.result.token);
        expect(native.get.mock.calls).toEqual([[{ forceRefresh: false }], [{ forceRefresh: true }]]);
    });
    it('returns native Unix-millisecond expiry unchanged for SDK expiresIn calculation', async () => {
        const now = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(now);
        native.result.token.expiresAt = now + 3_600_000;
        const credential = owner();
        await login(credential);
        const snapshot = await credential.getTokenSnapshot();
        expect(snapshot.expiresAt).toBe(now + 3_600_000);
        expect(Math.floor((snapshot.expiresAt - Date.now()) / 1000)).toBe(3600);
    });
    it.each(['sign-in', 'demand'])('rejects expired Unix-millisecond tokens during %s', async mode => {
        const credential = owner();
        if (mode === 'demand') await login(credential);
        native.result.token.expiresAt = Date.now() - 1;
        await expect(mode === 'demand' ? credential.getTokenSnapshot() : login(credential))
            .rejects.toMatchObject({ code: 'TokenExpired' });
    });
    it('keeps Graph OAuth explicit with mandatory identity scopes', async () => {
        const credential = owner({ mode: 'graph', scope: 'https://graph.microsoft.com/ChannelMessage.Send' });
        native.result.token.target = 'https://graph.microsoft.com';
        await login(credential);
        expect(native.signIns[0].options.scopes).toEqual([
            'https://graph.microsoft.com/ChannelMessage.Send', 'offline_access', 'openid', 'profile',
        ]);
        expect(native.initialize).not.toHaveBeenCalled();
    });
    it('host, mode and scope differences cannot inherit credentials', async () => {
        await login(owner());
        await expect(owner({ scope: `${serverUrl}/Other` }).getToken()).rejects.toMatchObject({ code: 'LoginRequired' });
        await expect(owner({ mode: 'graph' }).getToken()).rejects.toMatchObject({ code: 'LoginRequired' });
        const separate = path.join(dataDir, 'other-host');
        await expect(owner({ dataDir: separate }).getToken()).rejects.toMatchObject({ code: 'LoginRequired' });
    });
    it('rejects tampered metadata on restart', async () => {
        const first = owner();
        await login(first);
        const file = path.join(native.signIns[0].options.coordinationDirectory, 'account.json');
        const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
        metadata.account.id = 'invalid';
        await fs.writeFile(file, JSON.stringify(metadata));
        await expect(owner().getToken()).rejects.toMatchObject({ code: 'AccountMismatch' });
    });
    it.each(['tenant', 'target', 'expiry', 'source'])('rejects mismatched native %s before publishing', async kind => {
        if (kind === 'tenant') native.result.account.tenant = '33333333-3333-4333-8333-333333333333';
        if (kind === 'target') native.result.token.target = 'https://other.example';
        if (kind === 'expiry') native.result.token.expiresAt = 1;
        if (kind === 'source') native.result.token.source = 'azure-cli';
        const credential = owner();
        await expect(login(credential)).rejects.toMatchObject({ code: kind === 'expiry' ? 'TokenExpired' : 'AccountMismatch' });
        expect(credential.getAccount()).toBeUndefined();
        expect(native.remove).toHaveBeenCalledOnce();
        expect(native.providers[0].dispose).toHaveBeenCalledOnce();
    });
    it('deletes provisional native credentials when MCP verification fails and sanitizes errors', async () => {
        native.tools.mockRejectedValue(new Error('secret provider body'));
        const credential = owner();
        await expect(login(credential)).rejects.toThrow('IdentityVerificationFailed');
        expect(credential.getStatus()).toBe('error');
        expect(native.remove).toHaveBeenCalledOnce();
        await expect(fs.access(path.join(native.signIns[0].options.coordinationDirectory, 'account.json')))
            .rejects.toMatchObject({ code: 'ENOENT' });
    });
    it.each(['cancel', 'dispose'])('rejects stale sign-in completion after %s and cleans provisional credentials', async action => {
        let resolve!: (value: any) => void;
        native.wait.mockReturnValue(new Promise(r => { resolve = r; }));
        const credential = owner();
        await credential.beginBrowser();
        const completion = credential.wait();
        if (action === 'cancel') credential.cancelSignIn(); else credential.dispose();
        resolve(native.result);
        await expect(completion).rejects.toMatchObject({ code: action === 'cancel' ? 'Cancelled' : 'Disposed' });
        expect(credential.getAccount()).toBeUndefined();
        expect(native.remove).toHaveBeenCalledOnce();
    });
    it('caller abort cancels native token work and rejects late completion', async () => {
        const credential = owner();
        await login(credential);
        let resolve!: (value: any) => void;
        native.get.mockReturnValue(new Promise(r => { resolve = r; }));
        const signal = new AbortController();
        const token = credential.getToken(signal.signal);
        await vi.waitFor(() => expect(native.get).toHaveBeenCalledOnce());
        signal.abort();
        await expect(token).rejects.toMatchObject({ code: 'Cancelled' });
        expect(native.providers.at(-1).cancelOutstanding).toHaveBeenCalled();
        expect(native.providers.at(-1).dispose).toHaveBeenCalled();
        resolve(native.result.token);
    });
    it.each([[false, false], [true, true], [true, false], [false, true]] as const)
    ('isolates concurrent acquisition cancellation with forceRefresh=%s/%s', async (cancelledRefresh, survivingRefresh) => {
        const credential = owner();
        await login(credential);
        let cancelledResult!: (value: any) => void;
        let survivingResult!: (value: any) => void;
        native.get.mockImplementationOnce(() => new Promise(resolve => { cancelledResult = resolve; }));
        native.get.mockImplementationOnce(() => new Promise(resolve => { survivingResult = resolve; }));
        const controller = new AbortController();
        const cancelled = credential.getToken(controller.signal, cancelledRefresh);
        const surviving = credential.getToken(undefined, survivingRefresh);
        await vi.waitFor(() => expect(native.get).toHaveBeenCalledTimes(2));
        const first = native.providers.at(-2);
        const second = native.providers.at(-1);
        expect(first).not.toBe(second);
        controller.abort();
        await expect(cancelled).rejects.toMatchObject({ code: 'Cancelled' });
        expect(first.cancelOutstanding).toHaveBeenCalledOnce();
        expect(first.dispose).toHaveBeenCalled();
        expect(second.cancelOutstanding).not.toHaveBeenCalled();
        expect(second.dispose).not.toHaveBeenCalled();
        expect(credential.getStatus()).toBe('authenticated');
        expect(credential.getAccount()).toEqual({ tenantId: tenant, objectId: object });
        survivingResult(native.result.token);
        await expect(surviving).resolves.toBe('opaque-fixture-token');
        expect(second.dispose).toHaveBeenCalledOnce();
        expect(native.get.mock.calls).toEqual([
            [{ forceRefresh: cancelledRefresh }], [{ forceRefresh: survivingRefresh }],
        ]);
        cancelledResult({ ...native.result.token, accessToken: 'discarded-late-token' });
        expect(credential.getStatus()).toBe('authenticated');
    });
    it('logout after restart deletes exact credentials and metadata; deletion errors remain visible', async () => {
        await login(owner());
        const restarted = owner();
        native.remove.mockRejectedValueOnce(new Error('secret storage body'));
        await expect(restarted.deleteCredentials()).rejects.toThrow('StorageFailed');
        expect(restarted.getStatus()).toBe('error');
        await restarted.deleteCredentials();
        expect(restarted.getAccount()).toBeUndefined();
        expect(restarted.getStatus()).toBe('unauthenticated');
        await expect(owner().getToken()).rejects.toMatchObject({ code: 'LoginRequired' });
    });
    it('native refresh expiry failures do not trigger sign-in and are sanitized', async () => {
        const credential = owner();
        await login(credential);
        native.get.mockRejectedValueOnce(new AuthError('InteractionRequired'));
        await expect(credential.getToken()).rejects.toMatchObject({ code: 'InteractionRequired' });
        expect(credential.getStatus()).toBe('error');
        expect(native.begin).toHaveBeenCalledOnce();
    });
    it('disposed owner cannot acquire or initiate sign-in', async () => {
        const credential = owner();
        credential.dispose();
        await expect(credential.getToken()).rejects.toMatchObject({ code: 'Disposed' });
        await expect(credential.beginBrowser()).rejects.toMatchObject({ code: 'Disposed' });
    });
    it('cancellation during lazy directory initialization cannot open a sign-in handle', async () => {
        const credential = owner();
        const beginning = credential.beginBrowser();
        credential.cancelSignIn();
        await expect(beginning).rejects.toMatchObject({ code: 'Cancelled' });
        expect(native.signIns).toHaveLength(0);
    });
    it('supersedes a begin still initializing without opening or cancelling the replacement handle', async () => {
        const credential = owner();
        const previous = credential.beginBrowser();
        const rejected = expect(previous).rejects.toMatchObject({ code: 'Cancelled' });
        await credential.beginBrowser();
        await rejected;
        expect(native.signIns).toHaveLength(1);
        expect(native.signIns[0].cancel).not.toHaveBeenCalled();
        expect(native.signIns[0].dispose).not.toHaveBeenCalled();
        await credential.wait();
        expect(credential.getStatus()).toBe('authenticated');
    });
    it('late completion of a superseded native begin cleans only its captured sign-in handle', async () => {
        let finishPrevious!: (value: any) => void;
        native.begin.mockImplementationOnce(() => new Promise(resolve => { finishPrevious = resolve; }));
        const credential = owner();
        const previous = credential.beginBrowser();
        const rejected = expect(previous).rejects.toMatchObject({ code: 'Cancelled' });
        await vi.waitFor(() => expect(native.signIns).toHaveLength(1));
        await credential.beginBrowser();
        const replacement = native.signIns[1];
        finishPrevious({ authorizationUrl: 'https://login.example/superseded' });
        await rejected;
        expect(replacement.cancel).not.toHaveBeenCalled();
        expect(replacement.dispose).not.toHaveBeenCalled();
        expect(credential.getAccount()).toBeUndefined();
        await credential.wait();
        expect(credential.getAccount()).toEqual({ tenantId: tenant, objectId: object });
    });
    it('replacement sign-in waits for stale wait cleanup and cannot inherit old account metadata', async () => {
        let finishPrevious!: (value: any) => void;
        let finishCleanup!: () => void;
        native.wait.mockImplementationOnce(() => new Promise(resolve => { finishPrevious = resolve; }));
        native.remove.mockImplementationOnce(() => new Promise<void>(resolve => { finishCleanup = resolve; }));
        const credential = owner();
        await credential.beginBrowser();
        const previous = credential.wait();
        const rejected = expect(previous).rejects.toMatchObject({ code: 'Cancelled' });
        const replacementBegin = credential.beginBrowser();
        const oldAccount = { tenant, id: '33333333-3333-4333-8333-333333333333' };
        finishPrevious({ account: oldAccount, token: { ...native.result.token, account: oldAccount } });
        await vi.waitFor(() => expect(native.remove).toHaveBeenCalledOnce());
        expect(native.signIns).toHaveLength(1);
        expect(credential.getAccount()).toBeUndefined();
        finishCleanup();
        await rejected;
        await replacementBegin;
        const replacement = native.signIns[1];
        expect(replacement.cancel).not.toHaveBeenCalled();
        expect(replacement.dispose).not.toHaveBeenCalled();
        await credential.wait();
        const metadata = JSON.parse(await fs.readFile(
            path.join(replacement.options.coordinationDirectory, 'account.json'), 'utf8'));
        expect(metadata.account).toEqual({ tenant, id: object });
        expect(credential.getStatus()).toBe('authenticated');
    });
    it('cancellation at atomic metadata publication removes the file and exact provisional credential', async () => {
        const credential = owner();
        const rename = fs.rename;
        vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
            await rename(...args);
            credential.cancelSignIn();
        });
        await expect(login(credential)).rejects.toMatchObject({ code: 'Cancelled' });
        expect(credential.getAccount()).toBeUndefined();
        expect(native.remove).toHaveBeenCalledOnce();
        expect(await fs.readdir(native.signIns[0].options.coordinationDirectory)).toEqual([]);
    });
    it('cleanup failure stays explicit without leaking provider errors or sign-in handles', async () => {
        native.tools.mockRejectedValue(new Error('private provider response'));
        native.remove.mockRejectedValueOnce(new Error('private storage response'));
        await expect(login(owner())).rejects.toMatchObject({ code: 'StorageFailed' });
        expect(native.signIns[0].dispose).toHaveBeenCalled();
    });
    it('native token mismatch after restart cannot publish a bearer', async () => {
        await login(owner());
        native.get.mockResolvedValueOnce({ ...native.result.token, target: 'https://other.example' });
        await expect(owner().getTokenSnapshot()).rejects.toMatchObject({ code: 'AccountMismatch' });
    });
    it('provisions private directories using the platform security boundary', async () => {
        const credential = owner();
        await login(credential);
        if (process.platform === 'win32') {
            expect(native.exec).toHaveBeenCalledWith('whoami.exe', expect.any(Array), expect.any(Object));
            const command = native.exec.mock.calls.find(call => call[0] === 'powershell.exe')!;
            const script = Buffer.from(command[1].at(-1), 'base64').toString('utf16le');
            expect(script).toContain('SetAccessRuleProtection($true,$false)');
            expect(script).toContain('SetAccessControl');
        } else {
            const stat = await fs.stat(native.signIns[0].options.coordinationDirectory);
            expect(stat.mode & 0o777).toBe(0o700);
        }
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCopilotCredential } from '../../src/copilot-http/credentials';
import { CopilotHttpClient } from '../../src/copilot-http/client';

const runtime = vi.hoisted(() => ({ load: vi.fn(), create: vi.fn() }));
vi.mock('../../src/sdk-esm-loader', () => ({ loadCopilotSdk: runtime.load }));
vi.mock('../../src/sdk-client-factory', () => ({ createSdkClient: runtime.create }));
const current = vi.fn();
const users = vi.fn();
const start = vi.fn();
const stop = vi.fn();
const user = (login = 'active', host = 'https://github.com') => ({ type: 'user', host, login });
const read = (signal = new AbortController().signal) => readCopilotCredential({ source: 'copilot-cli' }, signal);

beforeEach(() => {
    vi.resetAllMocks();
    runtime.load.mockResolvedValue({});
    runtime.create.mockResolvedValue({ start, stop, rpc: { account: { getCurrentAuth: current, getAllUsers: users } } });
    start.mockResolvedValue(undefined);
    stop.mockResolvedValue(undefined);
    current.mockResolvedValue({ authInfo: user() });
    users.mockResolvedValue([{ authInfo: user('other'), token: 'gho_wrong' }, { authInfo: user(), token: 'gho_active' }]);
});
afterEach(() => vi.unstubAllEnvs());

describe('automatic Copilot CLI credentials', () => {
    it('sends HTTP requests with CLI-selected credentials and invalidates metadata on account changes', async () => {
        const fetcher = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/models')
            ? { data: [{ id: 'gpt-5.4-mini', supported_endpoints: ['/responses'] }] }
            : { model: 'gpt-5.4-mini', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'yes' }] }] })));
        const client = new CopilotHttpClient({ credential: { source: 'copilot-cli' }, fetch: fetcher });
        try {
            const request = { model: 'gpt-5.4-mini', api: 'responses' as const, messages: [{ role: 'user' as const, content: 'source' }] };
            expect((await client.complete(request)).text).toBe('yes');
            current.mockResolvedValue({ authInfo: user('other') });
            expect((await client.complete(request)).text).toBe('yes');
            const headers = (fetcher.mock.calls as unknown as [string, RequestInit][]).map(([, init]) => init.headers as Record<string, string>);
            expect(headers.map(header => header.Authorization)).toEqual(['Bearer gho_active', 'Bearer gho_active', 'Bearer gho_wrong', 'Bearer gho_wrong']);
            expect(stop).toHaveBeenCalledTimes(2);
        } finally { client.dispose(); }
    });
    it('reads the active CLI account, including tokens from its secure store, without a session', async () => {
        expect(await read()).toEqual({ host: 'github.com', login: 'active', token: 'gho_active' });
        expect(runtime.create).toHaveBeenCalledWith({});
        expect(stop).toHaveBeenCalledOnce();
    });
    it('rereads account selection on each request', async () => {
        expect((await read()).token).toBe('gho_active');
        current.mockResolvedValue({ authInfo: user('other') });
        expect((await read()).token).toBe('gho_wrong');
        expect(current).toHaveBeenCalledTimes(2);
    });
    it.each(['env', 'gh-cli', 'token'])('uses the CLI-selected %s token without choosing a stored account', async type => {
        current.mockResolvedValue({ authInfo: { type, host: 'https://github.com', login: 'active', token: 'ghu_selected' } });
        vi.stubEnv('GH_TOKEN', 'gho_other');
        expect((await read()).token).toBe('ghu_selected');
        expect(users).not.toHaveBeenCalled();
    });
    it('never selects another host or account when the active token is missing', async () => {
        users.mockResolvedValue([{ authInfo: user('active', 'https://enterprise.example'), token: 'gho_wrong' }]);
        await expect(read()).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(stop).toHaveBeenCalledOnce();
    });
    it.each([undefined, { type: 'api-key', host: 'https://github.com', apiKey: 'secret' }, { type: 'hmac', host: 'https://github.com', hmac: 'secret' }])('rejects missing or non-GitHub authentication %#', async authInfo => {
        current.mockResolvedValue({ authInfo });
        await expect(read()).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(users).not.toHaveBeenCalled();
        expect(stop).toHaveBeenCalledOnce();
    });
    it('sanitizes RPC failures and stops the client', async () => {
        current.mockRejectedValue(new Error('gho_secret'));
        const error = await read().catch(error => error);
        expect(error.code).toBe('DIRECT_CREDENTIAL_UNAVAILABLE');
        expect(error.message).not.toContain('secret');
        expect(stop).toHaveBeenCalledOnce();
    });
    it('stops on cancellation while authentication is pending', async () => {
        const controller = new AbortController();
        current.mockImplementation(() => { controller.abort(); return new Promise(() => {}); });
        await expect(read(controller.signal)).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(stop).toHaveBeenCalled();
    });
    it('does not spawn when already cancelled', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(read(controller.signal)).rejects.toBeDefined();
        expect(runtime.create).not.toHaveBeenCalled();
    });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { AuthError, NativeAddonLoadError } from '@plusplusoneplusplus/coc-native';
import { readCopilotCredential, getDirectCopilotConfigPath, validateCredentialConfig } from '../../src/copilot-http/credentials';
import { validateTransport } from '../../src/copilot-http/config';
import { CopilotHttpClient } from '../../src/copilot-http/client';
import type { CopilotCredentialConfig } from '../../src/copilot-http/types';
import { testCopilotToken } from './token-fixture';

const nativeRead = vi.hoisted(() => vi.fn());
vi.mock('@plusplusoneplusplus/coc-native', async importOriginal => ({
    ...await importOriginal<typeof import('@plusplusoneplusplus/coc-native')>(),
    readGitHubCredential: nativeRead,
}));
const signal = () => new AbortController().signal;
const config = (): CopilotCredentialConfig => ({
    source: 'cli-config', account: 'active-cli-account', configPath: join('fixture', 'config.json'),
});
beforeEach(() => { nativeRead.mockReset().mockResolvedValue({ host: 'github.com', login: 'fixture', token: testCopilotToken('gho', 'fixture') }); });
afterEach(() => vi.unstubAllEnvs());

describe('direct credential source boundaries', () => {
    it('routes config path and selection to native without inferring another source', async () => {
        const abort = signal();
        expect(await readCopilotCredential(config(), abort)).toEqual({ host: 'github.com', login: 'fixture', token: testCopilotToken('gho', 'fixture') });
        expect(nativeRead).toHaveBeenCalledExactlyOnceWith({
            source: 'cli-config', account: 'active-cli-account', configPath: resolve('fixture', 'config.json'),
        }, abort);
    });
    it('resolves COPILOT_HOME in TypeScript and preserves exact explicit account spelling', async () => {
        vi.stubEnv('COPILOT_HOME', resolve('fixture-home'));
        const account = { host: 'https://GitHub.COM', login: 'fixture' };
        await readCopilotCredential({ source: 'cli-config', account }, signal());
        expect(nativeRead.mock.calls[0][0]).toEqual({
            source: 'cli-config', configPath: join(resolve('fixture-home'), 'config.json'), account,
        });
    });
    it('only explicitly selected gh-cli uses the native gh source and selected account', async () => {
        const abort = signal();
        await readCopilotCredential({ source: 'gh-cli', host: 'GitHub.COM', login: 'fixture' }, abort);
        expect(nativeRead).toHaveBeenCalledExactlyOnceWith({
            source: 'gh-cli', account: { host: 'GitHub.COM', login: 'fixture' },
        }, abort);
    });
    it('rereads credentials for each request and returns immutable independent snapshots', async () => {
        const first = await readCopilotCredential(config(), signal());
        nativeRead.mockResolvedValue({ host: 'GitHub.COM', login: 'other', token: testCopilotToken('gho', 'other') });
        const second = await readCopilotCredential(config(), signal());
        expect(first).toEqual({ host: 'github.com', login: 'fixture', token: testCopilotToken('gho', 'fixture') });
        expect(second).toEqual({ host: 'github.com', login: 'other', token: testCopilotToken('gho', 'other') });
        expect(Object.isFrozen(first)).toBe(true);
        expect(Object.isFrozen(second)).toBe(true);
        expect(nativeRead).toHaveBeenCalledTimes(2);
    });
    it.each([testCopilotToken('gho', 'fixture'), testCopilotToken('ghu', 'fixture'), testCopilotToken('github_pat', 'fixture')])('retains Copilot token family policy for native token %s', async token => {
        nativeRead.mockResolvedValue({ token, host: 'github.com', login: 'fixture' });
        expect((await readCopilotCredential(config(), signal())).token).toBe(token);
    });
    it.each([testCopilotToken('ghp', 'unsupported'), testCopilotToken('ghs', 'unsupported'), '', ' ', 'invalid', 123, null, {}])('rejects unsupported native token %j without another source', async token => {
        nativeRead.mockResolvedValue({ token, host: 'github.com', login: 'fixture' });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(nativeRead).toHaveBeenCalledTimes(1);
    });
    it.each(['cli-config', 'gh-cli'] as const)('surfaces sanitized native failures for %s without fallback', async source => {
        nativeRead.mockRejectedValue(new AuthError('StorageFailed'));
        vi.stubEnv('GH_TOKEN', testCopilotToken('gho', 'ambient'));
        const error = await readCopilotCredential(source === 'cli-config' ? config() : {
            source, host: 'github.com', login: 'fixture',
        }, signal()).catch(error => error);
        expect(error).toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(error.cause).toBeUndefined();
        expect(nativeRead).toHaveBeenCalledTimes(1);
    });
    it('does not retain raw native or capability error diagnostics', async () => {
        for (const error of [new Error(testCopilotToken('gho', 'private')), new NativeAddonLoadError('fixture-private-path')]) {
            nativeRead.mockRejectedValue(error);
            const failure = await readCopilotCredential(config(), signal()).catch(error => error);
            expect(failure.code).toBe('DIRECT_CREDENTIAL_UNAVAILABLE');
            expect(String(failure)).not.toContain('private');
            expect(failure.cause).toBeUndefined();
        }
    });
    it.each([['TimedOut', 'DIRECT_TIMEOUT'], ['Cancelled', 'DIRECT_CANCELLED']] as const)('maps native lifecycle error %s', async (code, directCode) => {
        nativeRead.mockRejectedValue(new AuthError(code));
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: directCode });
    });
    it('forwards AbortSignal and preserves cancellation reason', async () => {
        const controller = new AbortController();
        const reason = new Error('fixture cancellation');
        nativeRead.mockImplementation(async (_options, abort: AbortSignal) => {
            expect(abort).toBe(controller.signal);
            controller.abort(reason);
            throw new AuthError('Cancelled');
        });
        await expect(readCopilotCredential(config(), controller.signal)).rejects.toBe(reason);
    });
    it('never starts native work for an already aborted request', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(readCopilotCredential(config(), controller.signal)).rejects.toBeDefined();
        expect(nativeRead).not.toHaveBeenCalled();
    });
    it('generates a direct HTTP title through native readiness and inference credential reads', async () => {
        const fetcher = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/models')
            ? { data: [{ id: 'gpt-6-luna', supported_endpoints: ['/responses'] }] }
            : { model: 'gpt-6-luna', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
                content: [{ type: 'output_text', text: 'Software Release Preparation' }] }] })));
        const client = new CopilotHttpClient({ credential: config(), fetch: fetcher });
        try {
            expect(await client.isAvailable('gpt-6-luna')).toEqual({ available: true });
            const result = await client.complete({ model: 'gpt-6-luna', api: 'responses',
                messages: [{ role: 'user', content: 'Generate a software release title' }] });
            expect(result.text).toBe('Software Release Preparation');
            expect(result.effectiveModel).toBe('gpt-6-luna');
            expect(fetcher).toHaveBeenCalledTimes(2);
            expect(nativeRead).toHaveBeenCalledTimes(2);
        } finally { client.dispose(); }
    });
    it('keeps environment acquisition in TypeScript with no native or ambient fallback', async () => {
        vi.stubEnv('SELECTED_TOKEN', testCopilotToken('gho', 'selected')); vi.stubEnv('GH_TOKEN', testCopilotToken('gho', 'other'));
        vi.stubEnv('GITHUB_TOKEN', testCopilotToken('gho', 'ambient_other'));
        expect((await readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).token).toBe(testCopilotToken('gho', 'selected'));
        vi.stubEnv('SELECTED_TOKEN', testCopilotToken('ghp', 'unsupported'));
        await expect(readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(nativeRead).not.toHaveBeenCalled();
    });
    it('keeps custom resolver acquisition in TypeScript and sanitizes its failures', async () => {
        const resolve = vi.fn(async () => ({ host: 'github.com', login: 'fixture', token: testCopilotToken('gho', 'resolver') }));
        expect((await readCopilotCredential({ source: 'resolver', resolve }, signal())).token).toBe(testCopilotToken('gho', 'resolver'));
        resolve.mockRejectedValue(new Error(testCopilotToken('gho', 'private')));
        const error = await readCopilotCredential({ source: 'resolver', resolve }, signal()).catch(error => error);
        expect(error.code).toBe('DIRECT_CREDENTIAL_UNAVAILABLE');
        expect(String(error)).not.toContain(testCopilotToken('gho', 'private'));
        expect(nativeRead).not.toHaveBeenCalled();
    });
    it.each(['http://github.com', 'https://github.com:443', 'https://github.com:8443',
        'https://fixture@github.com', 'https://github.com/path', 'https://github.com?query',
        'https://github.com#fragment'])('rejects unsafe config host %s before acquisition', host => {
        expect(() => validateCredentialConfig({ source: 'cli-config', account: { host, login: 'fixture' } })).toThrow();
        expect(nativeRead).not.toHaveBeenCalled();
    });
    it.each([undefined, { source: 'unknown' }, { source: 'keychain', host: 'github.com', login: 'fixture' },
        { source: 'environment' }, { source: 'resolver' }, { source: 'cli-config' },
        { source: 'gh-cli', host: '--bad', login: 'fixture' }])('rejects incomplete or removed configuration %#', value => {
        expect(() => validateCredentialConfig(value as CopilotCredentialConfig)).toThrow(expect.objectContaining({ code: 'DIRECT_CONFIG_INVALID' }));
        expect(nativeRead).not.toHaveBeenCalled();
    });
    it('respects COPILOT_HOME and ordinary home, and ignores unrelated XDG config', () => {
        const home = resolve('fixture-home');
        expect(getDirectCopilotConfigPath({ XDG_CONFIG_HOME: join(home, 'xdg') }, home)).toBe(join(home, '.copilot', 'config.json'));
        expect(getDirectCopilotConfigPath({ COPILOT_HOME: join(home, 'custom') }, home)).toBe(join(home, 'custom', 'config.json'));
        expect(getDirectCopilotConfigPath({ COPILOT_HOME: 'relative' }, home)).toBe(join(home, 'relative', 'config.json'));
    });
    it('validates only explicit transport choices', () => {
        for (const value of ['', 'auto', 'DIRECT']) expect(() => validateTransport(value)).toThrow();
        expect(() => validateTransport('sdk')).not.toThrow();
        expect(() => validateTransport('direct')).not.toThrow();
    });
});

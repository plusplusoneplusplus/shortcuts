import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCopilotCredential, getDirectCopilotConfigPath, validateCredentialConfig } from '../../src/copilot-http/credentials';
import { validateTransport } from '../../src/copilot-http/config';
import { CopilotHttpClient } from '../../src/copilot-http/client';
import type { CopilotCredentialConfig } from '../../src/copilot-http/types';

const exec = vi.hoisted(() => vi.fn());
const windowsCredential = vi.hoisted(() => vi.fn());
vi.mock('@plusplusoneplusplus/coc-native', () => ({ readWindowsCredential: windowsCredential }));
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
function platform(value: string) { Object.defineProperty(process, 'platform', { value, configurable: true }); }
const fileRace = vi.hoisted(() => ({ enabled: false }));
vi.mock('node:fs/promises', async importOriginal => {
    const actual = await importOriginal<typeof import('node:fs/promises')>();
    return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
        const file = await actual.open(...args);
        if (fileRace.enabled) {
            const stat = file.stat.bind(file); let first = true;
            file.stat = (async () => {
                const result = await stat();
                if (first) { first = false; await actual.writeFile(args[0], '{}'); }
                return result;
            }) as typeof file.stat;
        }
        return file;
    } };
});
vi.mock('node:child_process', () => ({ execFile: exec }));
const signal = () => new AbortController().signal;
let dir: string;
let path: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'copilot-credential-')); path = join(dir, 'config.json'); exec.mockReset(); windowsCredential.mockReset().mockResolvedValue(null); fileRace.enabled = false; });
afterEach(async () => { Object.defineProperty(process, 'platform', originalPlatform); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
const config = (): CopilotCredentialConfig => ({ source: 'cli-config', account: 'active-cli-account', configPath: path });
async function write(data: unknown) { await writeFile(path, JSON.stringify(data)); }
const stored = () => ({ lastLoggedInUser: { host: 'github.com', login: 'active' }, copilotTokens: { 'github.com:other': 'gho_wrong', 'github.com:active': 'gho_right' } });

describe('explicit read-only credential acquisition', () => {
    it('selects only the configured variable and never falls through to valid ambient tokens', async () => {
        vi.stubEnv('SELECTED_TOKEN', 'gho_selected'); vi.stubEnv('GH_TOKEN', 'gho_other'); vi.stubEnv('GITHUB_TOKEN', 'gho_another');
        expect(await readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).toMatchObject({ token: 'gho_selected' });
        vi.stubEnv('SELECTED_TOKEN', 'ghp_unsupported');
        await expect(readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).not.toHaveBeenCalled();
    });
    it.each(['gho_test', 'ghu_test', 'github_pat_test'])('supports preliminary token family %s', async token => {
        vi.stubEnv('SELECTED_TOKEN', token);
        expect((await readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).token).toBe(token);
    });
    it('uses exact active account key in JSONC while preserving URL strings and never writes the file', async () => {
        const text = '// CLI header\n' + JSON.stringify({ ...stored(), url: 'https://github.com' }); await writeFile(path, text);
        expect(await readCopilotCredential(config(), signal())).toEqual({ host: 'github.com', login: 'active', token: 'gho_right' });
        expect(await readFile(path, 'utf8')).toBe(text); expect(exec).not.toHaveBeenCalled();
    });
    it('uses a pinned account without changing the CLI active account', async () => {
        await write(stored());
        expect(await readCopilotCredential({ source: 'cli-config', configPath: path, account: { host: 'github.com', login: 'other' } }, signal())).toMatchObject({ login: 'other', token: 'gho_wrong' });
    });
    it('prefers the config token on Windows without accessing Credential Manager', async () => {
        platform('win32'); await write(stored()); windowsCredential.mockResolvedValue('gho_vault');
        expect((await readCopilotCredential(config(), signal())).token).toBe('gho_right');
        expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each([undefined, null, ''])('reads the exact Windows account when the config token is %j', async token => {
        platform('win32');
        await write({ lastLoggedInUser: { host: 'https://github.com', login: 'active' },
            copilotTokens: { 'https://github.com:active': token, 'github.com:active': 'gho_wrong' } });
        windowsCredential.mockResolvedValue('gho_vault');
        expect(await readCopilotCredential(config(), signal())).toEqual({ host: 'github.com', login: 'active', token: 'gho_vault' });
        expect(windowsCredential).toHaveBeenCalledExactlyOnceWith('copilot-cli/https://github.com:active');
        expect(exec).not.toHaveBeenCalled();
    });
    it('reads the pinned Windows account without using the active account', async () => {
        platform('win32'); await write(stored()); windowsCredential.mockResolvedValue('gho_pinned');
        expect(await readCopilotCredential({ ...config(), account: { host: 'github.com', login: 'pinned' } }, signal()))
            .toEqual({ host: 'github.com', login: 'pinned', token: 'gho_pinned' });
        expect(windowsCredential).toHaveBeenCalledExactlyOnceWith('copilot-cli/github.com:pinned');
    });
    it('generates a direct HTTP title with Windows-only credentials and no CLI process', async () => {
        platform('win32'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        windowsCredential.mockResolvedValue('gho_vault');
        const fetcher = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('/models')
            ? { data: [{ id: 'gpt-6-luna', supported_endpoints: ['/responses'] }] }
            : { model: 'gpt-6-luna', status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed',
                content: [{ type: 'output_text', text: 'Software Release Preparation' }] }] })));
        const client = new CopilotHttpClient({ credential: config(), fetch: fetcher });
        try {
            expect(await client.isAvailable('gpt-6-luna')).toEqual({ available: true });
            const result = await client.complete({ model: 'gpt-6-luna', api: 'responses',
                messages: [{ role: 'user', content: 'Generate a title for preparing a software release' }] });
            expect(result.text).toBe('Software Release Preparation');
            expect(result.effectiveModel).toBe('gpt-6-luna');
            expect(fetcher).toHaveBeenCalledTimes(2);
            expect(windowsCredential).toHaveBeenCalledTimes(2);
            expect(exec).not.toHaveBeenCalled();
        } finally { client.dispose(); }
    });
    it.each(['darwin', 'linux'])('does not access Windows credentials on %s', async os => {
        platform(os); await write({ lastLoggedInUser: stored().lastLoggedInUser }); windowsCredential.mockResolvedValue('gho_vault');
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    });
    it.each(['ghp_invalid', 'invalid', 123, {}])('does not replace an invalid file token %j with a Windows credential', async token => {
        platform('win32'); await write({ ...stored(), copilotTokens: { 'github.com:active': token } });
        windowsCredential.mockResolvedValue('gho_vault');
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each([null, 'ghp_invalid', 'invalid'])('rejects missing or invalid Windows tokens %j', async token => {
        platform('win32'); await write({ lastLoggedInUser: stored().lastLoggedInUser }); windowsCredential.mockResolvedValue(token);
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).toHaveBeenCalledTimes(1); expect(exec).not.toHaveBeenCalled();
    });
    it('sanitizes native credential failures without another source', async () => {
        platform('win32'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        windowsCredential.mockRejectedValue(new Error('gho_secret'));
        const error = await readCopilotCredential(config(), signal()).catch(e => e);
        expect(error).toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE', message: 'Selected Copilot Windows credential could not be read.' });
        expect(exec).not.toHaveBeenCalled();
    });
    it('cancels a pending native credential read without waiting for the worker', async () => {
        platform('win32'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        const controller = new AbortController();
        windowsCredential.mockImplementation(() => { controller.abort(); return new Promise(() => {}); });
        await expect(readCopilotCredential(config(), controller.signal)).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).toHaveBeenCalledTimes(1); expect(exec).not.toHaveBeenCalled();
    });
    it('does not access Windows credentials for an already aborted request', async () => {
        platform('win32'); const controller = new AbortController(); controller.abort();
        await expect(readCopilotCredential(config(), controller.signal)).rejects.toBeDefined();
        expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each([null, {}, { lastLoggedInUser: { host: 'http://github.com', login: 'active' } }])('does not access Windows credentials for invalid config %#', async data => {
        platform('win32'); await write(data);
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each(['active-cli-account', { host: 'https://github.com', login: 'active' }] as const)('reads URL-form CLI host with exact stored key for account %j', async account => {
        await write({ lastLoggedInUser: { host: 'https://github.com', login: 'active' },
            copilotTokens: { 'https://github.com:active': 'gho_right', 'github.com:active': 'gho_wrong' } });
        expect(await readCopilotCredential({ ...config(), account }, signal())).toEqual({ host: 'github.com', login: 'active', token: 'gho_right' });
        expect(exec).not.toHaveBeenCalled();
    });
    it('does not substitute a normalized account key when the exact URL-form key is missing', async () => {
        await write({ lastLoggedInUser: { host: 'https://github.com', login: 'active' }, copilotTokens: { 'github.com:active': 'gho_wrong' } });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
    });
    it.each(['http://github.com', 'https://github.com:8443', 'https://user:pass@github.com', 'https://github.com/path',
        'https://github.com?query', 'https://github.com#fragment'])('rejects unsafe CLI config host %s', async host => {
        await write({ lastLoggedInUser: { host, login: 'active' }, copilotTokens: { [`${host}:active`]: 'gho_right' } });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(() => validateCredentialConfig({ source: 'cli-config', account: { host, login: 'active' } })).toThrow();
        expect(exec).not.toHaveBeenCalled();
    });
    it('rereads active identity and produces immutable independent snapshots', async () => {
        await write(stored()); const first = await readCopilotCredential(config(), signal());
        await write({ ...stored(), lastLoggedInUser: { host: 'github.com', login: 'other' } });
        const next = await readCopilotCredential(config(), signal());
        expect(first.token).toBe('gho_right'); expect(next.token).toBe('gho_wrong'); expect(Object.isFrozen(first)).toBe(true);
    });
    it.each([null, [], 'string', {}, { copilotTokens: { 'github.com:first': 'gho_first' } },
        { ...stored(), lastLoggedInUser: { host: 'github.com', login: 'missing' } }, { ...stored(), copilotTokens: {} }])('rejects invalid/missing active record %# without trying another source', async value => {
        await write(value); await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' }); expect(exec).not.toHaveBeenCalled();
    });
    it('rejects a concurrently rewritten config without replaying the read', async () => {
        await write(stored()); fileRace.enabled = true;
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE', message: expect.stringContaining('changed during reading') });
    });
    it('sanitizes parser errors containing credential records', async () => {
        await writeFile(path, '{"gho_secret":');
        const error = await readCopilotCredential(config(), signal()).catch(e => e);
        expect(error.code).toBe('DIRECT_CREDENTIAL_UNAVAILABLE'); expect(error.message).not.toContain('secret');
    });
    it('rejects oversized files and missing files', async () => {
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        await writeFile(path, ' '.repeat(1024 * 1024 + 1));
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
    });
    it('uses only selected resolver and sanitizes failures', async () => {
        const resolve = vi.fn(async () => { throw new Error('gho_secret'); });
        const error = await readCopilotCredential({ source: 'resolver', resolve }, signal()).catch(e => e);
        expect(error).toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' }); expect(error.message).not.toContain('gho_secret'); expect(exec).not.toHaveBeenCalled();
    });
    it('returns an explicit unverified-keychain error without reading plaintext or invoking gh', async () => {
        await write(stored());
        await expect(readCopilotCredential({ source: 'keychain', host: 'github.com', login: 'active' }, signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE', message: expect.stringContaining('unverified') });
        expect(exec).not.toHaveBeenCalled();
    });
    it('only explicitly selected gh-cli uses bounded argument-array execution for the pinned account', async () => {
        vi.stubEnv('GH_TOKEN', 'gho_wrong'); vi.stubEnv('GITHUB_TOKEN', 'gho_another');
        exec.mockImplementation((_file, _args, _options, callback) => callback(null, 'gho_selected\n'));
        expect(await readCopilotCredential({ source: 'gh-cli', host: 'github.com', login: 'active' }, signal())).toMatchObject({ token: 'gho_selected', login: 'active' });
        expect(exec).toHaveBeenCalledWith('gh', ['auth', 'token', '--hostname', 'github.com', '--user', 'active'], expect.objectContaining({ timeout: 10_000, maxBuffer: 16_384, windowsHide: true, signal: expect.any(AbortSignal) }), expect.any(Function));
        expect(exec.mock.calls[0][2].env).not.toHaveProperty('GH_TOKEN'); expect(exec.mock.calls[0][2].env).not.toHaveProperty('GITHUB_TOKEN');
    });
    it('gh failure is terminal and sanitized', async () => {
        exec.mockImplementation((_file, _args, _options, callback) => callback(new Error('secret')));
        const error = await readCopilotCredential({ source: 'gh-cli', host: 'github.com', login: 'active' }, signal()).catch(e => e);
        expect(error.code).toBe('DIRECT_CREDENTIAL_UNAVAILABLE'); expect(error.message).not.toContain('secret'); expect(exec).toHaveBeenCalledTimes(1);
    });
    it.each([undefined, { source: 'unknown' }, { source: 'environment' }, { source: 'resolver' }, { source: 'cli-config' }, { source: 'gh-cli', host: '--bad', login: 'a' }])('rejects incomplete configuration %# before acquisition', async value => {
        expect(() => validateCredentialConfig(value as any)).toThrow(expect.objectContaining({ code: 'DIRECT_CONFIG_INVALID' })); expect(exec).not.toHaveBeenCalled();
    });
    it('respects COPILOT_HOME and ordinary home, and ignores unrelated XDG config', () => {
        expect(getDirectCopilotConfigPath({ XDG_CONFIG_HOME: join(dir, 'xdg') }, dir)).toBe(join(dir, '.copilot', 'config.json'));
        expect(getDirectCopilotConfigPath({ COPILOT_HOME: join(dir, 'custom') }, dir)).toBe(join(dir, 'custom', 'config.json'));
        expect(getDirectCopilotConfigPath({ COPILOT_HOME: 'relative' }, dir)).toBe(join(dir, 'relative', 'config.json'));
    });
    it('validates only explicit transport choices', () => {
        for (const value of ['', 'auto', 'DIRECT']) expect(() => validateTransport(value)).toThrow();
        expect(() => validateTransport('sdk')).not.toThrow();
        expect(() => validateTransport('direct')).not.toThrow();
    });
});

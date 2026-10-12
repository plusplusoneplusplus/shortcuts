import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCopilotCredential, getDirectCopilotConfigPath, validateCredentialConfig } from '../../src/copilot-http/credentials';
import { validateTransport } from '../../src/copilot-http/config';
import { CopilotHttpClient } from '../../src/copilot-http/client';
import type { CopilotCredentialConfig } from '../../src/copilot-http/types';
import { testCopilotToken } from './token-fixture';

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
beforeEach(async () => { platform('linux'); dir = await mkdtemp(join(tmpdir(), 'copilot-credential-')); path = join(dir, 'config.json'); exec.mockReset(); windowsCredential.mockReset().mockResolvedValue(null); fileRace.enabled = false; });
afterEach(async () => { Object.defineProperty(process, 'platform', originalPlatform); vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
const config = (): CopilotCredentialConfig => ({ source: 'cli-config', account: 'active-cli-account', configPath: path });
async function write(data: unknown) { await writeFile(path, JSON.stringify(data)); }
const stored = () => ({ lastLoggedInUser: { host: 'github.com', login: 'active' }, copilotTokens: { 'github.com:other': testCopilotToken('gho', 'other'), 'github.com:active': testCopilotToken('gho', 'active') } });

describe('explicit read-only credential acquisition', () => {
    it('selects only the configured variable and never falls through to valid ambient tokens', async () => {
        vi.stubEnv('SELECTED_TOKEN', testCopilotToken('gho', 'selected')); vi.stubEnv('GH_TOKEN', testCopilotToken('gho', 'ambient')); vi.stubEnv('GITHUB_TOKEN', testCopilotToken('gho', 'ambient_other'));
        expect(await readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).toMatchObject({ token: testCopilotToken('gho', 'selected') });
        vi.stubEnv('SELECTED_TOKEN', testCopilotToken('ghp', 'unsupported'));
        await expect(readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).not.toHaveBeenCalled();
    });
    it.each([testCopilotToken('gho', 'oauth'), testCopilotToken('ghu', 'user'), testCopilotToken('github_pat', 'fine_grained')])('supports preliminary token family %s', async token => {
        vi.stubEnv('SELECTED_TOKEN', token);
        expect((await readCopilotCredential({ source: 'environment', variable: 'SELECTED_TOKEN' }, signal())).token).toBe(token);
    });
    it('uses exact active account key in JSONC while preserving URL strings and never writes the file', async () => {
        const text = '// CLI header\n' + JSON.stringify({ ...stored(), url: 'https://github.com' }); await writeFile(path, text);
        expect(await readCopilotCredential(config(), signal())).toEqual({ host: 'github.com', login: 'active', token: testCopilotToken('gho', 'active') });
        expect(await readFile(path, 'utf8')).toBe(text); expect(exec).not.toHaveBeenCalled();
    });
    it('uses a pinned account without changing the CLI active account', async () => {
        await write(stored());
        expect(await readCopilotCredential({ source: 'cli-config', configPath: path, account: { host: 'github.com', login: 'other' } }, signal())).toMatchObject({ login: 'other', token: testCopilotToken('gho', 'other') });
    });
    describe.each(['linux', 'win32', 'darwin'])('authTokens on %s', os => {
        it.each([':github', ''])('reads the exact selected account%s entry before copilotTokens or secure storage', async suffix => {
            platform(os);
            const data = {
                lastLoggedInUser: { host: 'https://github.com', login: 'active' },
                authTokens: {
                    [`https://github.com:active${suffix}`]: { token: testCopilotToken('gho', 'selected') },
                    [`github.com:active${suffix}`]: { token: testCopilotToken('gho', 'normalized') },
                    [`https://github.com:other${suffix}`]: { token: testCopilotToken('gho', 'other') },
                },
                copilotTokens: { 'https://github.com:active': testCopilotToken('gho', 'fallback') },
            };
            await write(data);
            expect(await readCopilotCredential(config(), signal()))
                .toEqual({ host: 'github.com', login: 'active', token: testCopilotToken('gho', 'selected') });
            expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(data);
            expect(exec).not.toHaveBeenCalled(); expect(windowsCredential).not.toHaveBeenCalled();
        });
        it.each([undefined, null, ''])('skips absent or empty primary auth token %j', async token => {
            platform(os);
            await write({ ...stored(), authTokens: {
                'github.com:active:github': { token },
                'github.com:active': { token: testCopilotToken('ghu', 'bare') },
            } });
            expect((await readCopilotCredential(config(), signal())).token).toBe(testCopilotToken('ghu', 'bare'));
            await write({ ...stored(), authTokens: {
                'github.com:active:github': { token }, 'github.com:active': { token },
            } });
            expect((await readCopilotCredential(config(), signal())).token).toBe(testCopilotToken('gho', 'active'));
            expect(exec).not.toHaveBeenCalled(); expect(windowsCredential).not.toHaveBeenCalled();
        });
        it.each([testCopilotToken('ghp', 'unsupported'), 'invalid', 123, {}])('rejects invalid primary auth token %j without fallback', async token => {
            platform(os);
            await write({ ...stored(), authTokens: {
                'github.com:active:github': { token },
                'github.com:active': { token: testCopilotToken('gho', 'bare') },
            } });
            await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
            expect(exec).not.toHaveBeenCalled(); expect(windowsCredential).not.toHaveBeenCalled();
        });
    });
    it('uses only the pinned authTokens account', async () => {
        await write({ ...stored(), authTokens: {
            'github.com:active:github': { token: testCopilotToken('gho', 'active') },
            'github.com:other:github': { token: testCopilotToken('gho', 'pinned') },
        } });
        expect(await readCopilotCredential({ ...config(), account: { host: 'github.com', login: 'other' } }, signal()))
            .toEqual({ host: 'github.com', login: 'other', token: testCopilotToken('gho', 'pinned') });
    });
    it('does not substitute normalized or other authTokens accounts or ambient credentials', async () => {
        vi.stubEnv('GH_TOKEN', testCopilotToken('gho', 'ambient'));
        await write({ lastLoggedInUser: { host: 'https://github.com', login: 'active' }, authTokens: {
            'github.com:active:github': { token: testCopilotToken('gho', 'normalized') },
            'https://github.com:other:github': { token: testCopilotToken('gho', 'other') },
        } });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).not.toHaveBeenCalled(); expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each([null, [], 'invalid', { 'github.com:active:github': 'invalid' }])('rejects malformed authTokens %# without falling back', async authTokens => {
        await write({ ...stored(), authTokens });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).not.toHaveBeenCalled(); expect(windowsCredential).not.toHaveBeenCalled();
    });
    it('prefers the config token on Windows without accessing Credential Manager', async () => {
        platform('win32'); await write(stored()); windowsCredential.mockResolvedValue(testCopilotToken('gho', 'windows_vault'));
        expect((await readCopilotCredential(config(), signal())).token).toBe(testCopilotToken('gho', 'active'));
        expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each([undefined, null, ''])('reads the exact Windows account when the config token is %j', async token => {
        platform('win32');
        await write({ lastLoggedInUser: { host: 'https://github.com', login: 'active' },
            copilotTokens: { 'https://github.com:active': token, 'github.com:active': testCopilotToken('gho', 'other') } });
        windowsCredential.mockResolvedValue(testCopilotToken('gho', 'windows_vault'));
        expect(await readCopilotCredential(config(), signal())).toEqual({ host: 'github.com', login: 'active', token: testCopilotToken('gho', 'windows_vault') });
        expect(windowsCredential).toHaveBeenCalledExactlyOnceWith('copilot-cli/https://github.com:active');
        expect(exec).not.toHaveBeenCalled();
    });
    it('reads the pinned Windows account without using the active account', async () => {
        platform('win32'); await write(stored()); windowsCredential.mockResolvedValue(testCopilotToken('gho', 'pinned'));
        expect(await readCopilotCredential({ ...config(), account: { host: 'github.com', login: 'pinned' } }, signal()))
            .toEqual({ host: 'github.com', login: 'pinned', token: testCopilotToken('gho', 'pinned') });
        expect(windowsCredential).toHaveBeenCalledExactlyOnceWith('copilot-cli/github.com:pinned');
    });
    it('generates a direct HTTP title with Windows-only credentials and no CLI process', async () => {
        platform('win32'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        windowsCredential.mockResolvedValue(testCopilotToken('gho', 'windows_vault'));
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
    it('does not access secure credentials on Linux', async () => {
        platform('linux'); await write({ lastLoggedInUser: stored().lastLoggedInUser }); windowsCredential.mockResolvedValue(testCopilotToken('gho', 'windows_vault'));
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
    });
    it('prefers the file token on macOS without accessing Keychain', async () => {
        platform('darwin'); await write(stored());
        expect((await readCopilotCredential(config(), signal())).token).toBe(testCopilotToken('gho', 'active'));
        expect(exec).not.toHaveBeenCalled(); expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each([undefined, null, ''])('reads the exact macOS account when the config token is %j', async token => {
        platform('darwin');
        await write({ lastLoggedInUser: { host: 'https://github.com', login: 'active' },
            copilotTokens: { 'https://github.com:active': token, 'github.com:active': testCopilotToken('gho', 'other') } });
        exec.mockImplementation((_file, _args, _options, cb) => cb(null, testCopilotToken('gho', 'mac_keychain') + '\n'));
        const abortSignal = signal();
        expect(await readCopilotCredential(config(), abortSignal)).toEqual({ host: 'github.com', login: 'active', token: testCopilotToken('gho', 'mac_keychain') });
        expect(exec).toHaveBeenCalledExactlyOnceWith('/usr/bin/security',
            ['find-generic-password', '-s', 'copilot-cli', '-a', 'https://github.com:active', '-w'],
            { signal: abortSignal, timeout: 10_000, maxBuffer: 16_384 }, expect.any(Function));
        expect(windowsCredential).not.toHaveBeenCalled();
    });
    it('reads the pinned macOS account without changing the config', async () => {
        platform('darwin'); await write(stored());
        const before = await readFile(path, 'utf8');
        exec.mockImplementation((_file, _args, _options, cb) => cb(null, testCopilotToken('gho', 'pinned')));
        expect(await readCopilotCredential({ ...config(), account: { host: 'github.com', login: 'pinned' } }, signal()))
            .toEqual({ host: 'github.com', login: 'pinned', token: testCopilotToken('gho', 'pinned') });
        expect(exec.mock.calls[0][1]).toEqual(['find-generic-password', '-s', 'copilot-cli', '-a', 'github.com:pinned', '-w']);
        expect(await readFile(path, 'utf8')).toBe(before);
    });
    it.each([testCopilotToken('ghp', 'invalid_family'), 'invalid', 123, {}])('does not replace an invalid macOS file token %j', async token => {
        platform('darwin'); await write({ ...stored(), copilotTokens: { 'github.com:active': token } });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).not.toHaveBeenCalled();
    });
    it.each(['', testCopilotToken('ghp', 'invalid_family'), 'invalid'])('rejects missing or invalid Keychain tokens %j', async token => {
        platform('darwin'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        exec.mockImplementation((_file, _args, _options, cb) => cb(null, token));
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).toHaveBeenCalledTimes(1);
    });
    it.each([44, 36, 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])('sanitizes Keychain failure %s without another source', async code => {
        platform('darwin'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        vi.stubEnv('GH_TOKEN', testCopilotToken('gho', 'ambient')); vi.stubEnv('GITHUB_TOKEN', testCopilotToken('gho', 'ambient_other'));
        exec.mockImplementation((_file, _args, _options, cb) => cb(Object.assign(new Error(testCopilotToken('gho', 'error_payload')), { code }), testCopilotToken('gho', 'error_payload')));
        const error = await readCopilotCredential(config(), signal()).catch(e => e);
        expect(error).toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE', message: 'Selected Copilot macOS Keychain credential could not be read.' });
        expect(exec).toHaveBeenCalledTimes(1); expect(windowsCredential).not.toHaveBeenCalled();
    });
    it('cancels a pending Keychain read through the child process signal', async () => {
        platform('darwin'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        const controller = new AbortController();
        exec.mockImplementation((_file, _args, options, cb) => {
            options.signal.addEventListener('abort', () => cb(new Error('Aborted'), ''), { once: true });
            controller.abort();
        });
        await expect(readCopilotCredential(config(), controller.signal)).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).toHaveBeenCalledTimes(1);
    });
    it('does not access Keychain for an already aborted request', async () => {
        platform('darwin'); const controller = new AbortController(); controller.abort();
        await expect(readCopilotCredential(config(), controller.signal)).rejects.toBeDefined();
        expect(exec).not.toHaveBeenCalled();
    });
    it.each([null, {}, { lastLoggedInUser: { host: 'http://github.com', login: 'active' } },
        { lastLoggedInUser: { host: 'github.com', login: 'invalid login' } }])('does not access Keychain for invalid config %#', async data => {
        platform('darwin'); await write(data);
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(exec).not.toHaveBeenCalled();
    });
    it('generates a direct HTTP title using macOS Keychain credentials without a Copilot CLI process', async () => {
        platform('darwin'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        exec.mockImplementation((_file, _args, _options, cb) => cb(null, testCopilotToken('gho', 'mac_keychain')));
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
            expect(exec).toHaveBeenCalledTimes(2);
            expect(exec.mock.calls.every(call => call[0] === '/usr/bin/security')).toBe(true);
            expect(windowsCredential).not.toHaveBeenCalled();
        } finally { client.dispose(); }
    });
    it.each([testCopilotToken('ghp', 'invalid_family'), 'invalid', 123, {}])('does not replace an invalid file token %j with a Windows credential', async token => {
        platform('win32'); await write({ ...stored(), copilotTokens: { 'github.com:active': token } });
        windowsCredential.mockResolvedValue(testCopilotToken('gho', 'windows_vault'));
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).not.toHaveBeenCalled();
    });
    it.each([null, testCopilotToken('ghp', 'invalid_family'), 'invalid'])('rejects missing or invalid Windows tokens %j', async token => {
        platform('win32'); await write({ lastLoggedInUser: stored().lastLoggedInUser }); windowsCredential.mockResolvedValue(token);
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(windowsCredential).toHaveBeenCalledTimes(1); expect(exec).not.toHaveBeenCalled();
    });
    it('sanitizes native credential failures without another source', async () => {
        platform('win32'); await write({ lastLoggedInUser: stored().lastLoggedInUser });
        windowsCredential.mockRejectedValue(new Error(testCopilotToken('gho', 'error_payload')));
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
            copilotTokens: { 'https://github.com:active': testCopilotToken('gho', 'active'), 'github.com:active': testCopilotToken('gho', 'other') } });
        expect(await readCopilotCredential({ ...config(), account }, signal())).toEqual({ host: 'github.com', login: 'active', token: testCopilotToken('gho', 'active') });
        expect(exec).not.toHaveBeenCalled();
    });
    it('does not substitute a normalized account key when the exact URL-form key is missing', async () => {
        await write({ lastLoggedInUser: { host: 'https://github.com', login: 'active' }, copilotTokens: { 'github.com:active': testCopilotToken('gho', 'other') } });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
    });
    it.each(['http://github.com', 'https://github.com:8443', 'https://user:pass@github.com', 'https://github.com/path',
        'https://github.com?query', 'https://github.com#fragment'])('rejects unsafe CLI config host %s', async host => {
        await write({ lastLoggedInUser: { host, login: 'active' }, copilotTokens: { [`${host}:active`]: testCopilotToken('gho', 'active') } });
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        expect(() => validateCredentialConfig({ source: 'cli-config', account: { host, login: 'active' } })).toThrow();
        expect(exec).not.toHaveBeenCalled();
    });
    it('rereads active identity and produces immutable independent snapshots', async () => {
        await write(stored()); const first = await readCopilotCredential(config(), signal());
        await write({ ...stored(), lastLoggedInUser: { host: 'github.com', login: 'other' } });
        const next = await readCopilotCredential(config(), signal());
        expect(first.token).toBe(testCopilotToken('gho', 'active')); expect(next.token).toBe(testCopilotToken('gho', 'other')); expect(Object.isFrozen(first)).toBe(true);
    });
    it.each([null, [], 'string', {}, { copilotTokens: { 'github.com:first': testCopilotToken('gho', 'first') } },
        { ...stored(), lastLoggedInUser: { host: 'github.com', login: 'missing' } }, { ...stored(), copilotTokens: {} }])('rejects invalid/missing active record %# without trying another source', async value => {
        await write(value); await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' }); expect(exec).not.toHaveBeenCalled();
    });
    it('rejects a concurrently rewritten config without replaying the read', async () => {
        await write(stored()); fileRace.enabled = true;
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE', message: expect.stringContaining('changed during reading') });
    });
    it('sanitizes parser errors containing credential records', async () => {
        await writeFile(path, `{"${testCopilotToken('gho', 'error_payload')}":`);
        const error = await readCopilotCredential(config(), signal()).catch(e => e);
        expect(error.code).toBe('DIRECT_CREDENTIAL_UNAVAILABLE'); expect(error.message).not.toContain('secret');
        expect(error.message).not.toContain(testCopilotToken('gho', 'error_payload'));
    });
    it('rejects oversized files and missing files', async () => {
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
        await writeFile(path, ' '.repeat(1024 * 1024 + 1));
        await expect(readCopilotCredential(config(), signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' });
    });
    it('uses only selected resolver and sanitizes failures', async () => {
        const resolve = vi.fn(async () => { throw new Error(testCopilotToken('gho', 'error_payload')); });
        const error = await readCopilotCredential({ source: 'resolver', resolve }, signal()).catch(e => e);
        expect(error).toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE' }); expect(error.message).not.toContain(testCopilotToken('gho', 'error_payload')); expect(exec).not.toHaveBeenCalled();
    });
    it('returns an explicit unverified-keychain error without reading plaintext or invoking gh', async () => {
        await write(stored());
        await expect(readCopilotCredential({ source: 'keychain', host: 'github.com', login: 'active' }, signal())).rejects.toMatchObject({ code: 'DIRECT_CREDENTIAL_UNAVAILABLE', message: expect.stringContaining('unverified') });
        expect(exec).not.toHaveBeenCalled();
    });
    it('only explicitly selected gh-cli uses bounded argument-array execution for the pinned account', async () => {
        vi.stubEnv('GH_TOKEN', testCopilotToken('gho', 'other')); vi.stubEnv('GITHUB_TOKEN', testCopilotToken('gho', 'ambient_other'));
        exec.mockImplementation((_file, _args, _options, callback) => callback(null, testCopilotToken('gho', 'selected') + '\n'));
        expect(await readCopilotCredential({ source: 'gh-cli', host: 'github.com', login: 'active' }, signal())).toMatchObject({ token: testCopilotToken('gho', 'selected'), login: 'active' });
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

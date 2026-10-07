import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCopilotCredential, getDirectCopilotConfigPath, validateCredentialConfig } from '../../src/copilot-http/credentials';
import { validateTransport } from '../../src/copilot-http/config';
import type { CopilotCredentialConfig } from '../../src/copilot-http/types';

const exec = vi.hoisted(() => vi.fn());
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
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'copilot-credential-')); path = join(dir, 'config.json'); exec.mockReset(); fileRace.enabled = false; });
afterEach(async () => { vi.unstubAllEnvs(); await rm(dir, { recursive: true, force: true }); });
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

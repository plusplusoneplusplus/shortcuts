import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCliStoredToken, resolveCliStoredToken } from '../src/cli-stored-token';

describe('readCliStoredToken', () => {
    let home: string;
    const write = (config: string) => {
        fs.mkdirSync(path.join(home, '.copilot'), { recursive: true });
        fs.writeFileSync(path.join(home, '.copilot', 'config.json'), config);
    };

    beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-token-')); });
    afterEach(() => { fs.rmSync(home, { recursive: true, force: true }); });

    const base = {
        lastLoggedInUser: { host: 'https://github.com', login: 'alice' },
    };

    it('reads the last logged-in account token from authTokens, tolerating JSONC comments', () => {
        write('// managed\n' + JSON.stringify({
            ...base,
            authTokens: {
                'https://github.com:alice:github': { token: 'gho_abc123' },
                'https://github.com:bob:github': { token: 'gho_other' },
            },
        }));
        expect(readCliStoredToken({}, home)).toBe('gho_abc123');
    });

    it('falls back to the bare account key and legacy copilotTokens', () => {
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:alice': { token: 'ghu_bare' } } }));
        expect(readCliStoredToken({}, home)).toBe('ghu_bare');
        write(JSON.stringify({ ...base, copilotTokens: { 'https://github.com:alice': 'gho_legacy' } }));
        expect(readCliStoredToken({}, home)).toBe('gho_legacy');
    });

    it('ignores other accounts and missing files but rejects malformed credentials', () => {
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:bob': { token: 'gho_bob' } } }));
        expect(readCliStoredToken({}, home)).toBeUndefined();
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:alice': { token: 'not a token' } } }));
        expect(() => readCliStoredToken({}, home)).toThrow('invalid credentials');
        write('{ not json');
        expect(() => readCliStoredToken({}, home)).toThrow('invalid credentials');
        fs.rmSync(path.join(home, '.copilot'), { recursive: true });
        expect(readCliStoredToken({}, home)).toBeUndefined();
    });

    it('defers to explicit environment tokens', () => {
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:alice': { token: 'gho_abc' } } }));
        expect(readCliStoredToken({ GH_TOKEN: 'gho_env' }, home)).toBeUndefined();
    });

    it('rejects oversized config and malformed selected accounts', () => {
        write(' '.repeat(1024 * 1024 + 1));
        expect(() => readCliStoredToken({}, home)).toThrow('invalid credentials');
        write(JSON.stringify({ lastLoggedInUser: { host: '', login: 'fixture' } }));
        expect(() => readCliStoredToken({}, home)).toThrow('invalid credentials');
    });

    it('does not substitute a legacy token when the primary credential is invalid', () => {
        write(JSON.stringify({
            ...base,
            authTokens: { 'https://github.com:alice:github': { token: 'invalid fixture' } },
            copilotTokens: { 'https://github.com:alice': 'gho_fixture' },
        }));
        expect(() => readCliStoredToken({}, home)).toThrow('invalid credentials');
    });

    it('honors COPILOT_HOME', () => {
        const alt = path.join(home, 'alt');
        fs.mkdirSync(alt);
        fs.writeFileSync(path.join(alt, 'config.json'), JSON.stringify({
            ...base, authTokens: { 'https://github.com:alice': { token: 'gho_alt' } },
        }));
        expect(readCliStoredToken({ COPILOT_HOME: alt }, home)).toBe('gho_alt');
    });

    function runtime(type: string | undefined) {
        const start = vi.fn().mockResolvedValue(undefined);
        const stop = vi.fn().mockResolvedValue(undefined);
        const getCurrentAuth = vi.fn().mockResolvedValue({ authInfo: type ? { type } : undefined });
        const client = { start, stop, rpc: { account: { getCurrentAuth } } };
        return { client, start, stop, getCurrentAuth };
    }

    it.each(['user', 'env', 'token', 'hmac'])('preserves runtime %s credentials before reading config', async type => {
        write('{ invalid json');
        const probe = runtime(type);
        expect(await resolveCliStoredToken(() => probe.client, {}, home)).toBeUndefined();
        expect(probe.stop).toHaveBeenCalledOnce();
    });

    it.each(['gh-cli', undefined])('uses the selected file account when runtime auth is %s', async type => {
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:alice:github': { token: 'gho_fixture' } } }));
        const probe = runtime(type);
        expect(await resolveCliStoredToken(() => probe.client, {}, home)).toBe('gho_fixture');
        expect(probe.start).toHaveBeenCalledOnce();
        expect(probe.getCurrentAuth).toHaveBeenCalledOnce();
        expect(probe.stop).toHaveBeenCalledOnce();
    });

    it('leaves gh fallback intact when the selected file account has no token', async () => {
        write(JSON.stringify(base));
        const probe = runtime('gh-cli');
        expect(await resolveCliStoredToken(() => probe.client, {}, home)).toBeUndefined();
        expect(probe.stop).toHaveBeenCalledOnce();
    });

    it('does not probe for ambient auth, in-process runtimes, or missing config', async () => {
        const create = vi.fn();
        expect(await resolveCliStoredToken(create, {}, home)).toBeUndefined();
        write(JSON.stringify(base));
        for (const env of [{ GH_TOKEN: 'gho_fixture' }, { COPILOT_SDK_AUTH_TOKEN: 'gho_fixture' }, { COPILOT_SDK_DEFAULT_CONNECTION: 'inprocess' }]) {
            expect(await resolveCliStoredToken(create, env, home)).toBeUndefined();
        }
        expect(create).not.toHaveBeenCalled();
    });

    it('surfaces invalid file credentials rather than falling back to gh', async () => {
        write('{ invalid json');
        const probe = runtime('gh-cli');
        await expect(resolveCliStoredToken(() => probe.client, {}, home)).rejects.toThrow('invalid credentials');
        expect(probe.stop).toHaveBeenCalledOnce();
    });

    it('sanitizes runtime errors and closes the probe', async () => {
        write(JSON.stringify(base));
        const probe = runtime('gh-cli');
        probe.getCurrentAuth.mockRejectedValue(new Error('private fixture error'));
        await expect(resolveCliStoredToken(() => probe.client, {}, home)).rejects.toThrow('Copilot runtime authentication discovery failed.');
        expect(probe.stop).toHaveBeenCalledOnce();
    });

    it('bounds stalled discovery and closes the probe', async () => {
        vi.useFakeTimers();
        try {
            write(JSON.stringify(base));
            const probe = runtime('gh-cli');
            probe.start.mockImplementation(() => new Promise(() => {}));
            const result = resolveCliStoredToken(() => probe.client, {}, home);
            const rejection = expect(result).rejects.toThrow('authentication discovery failed');
            await vi.advanceTimersByTimeAsync(10_000);
            await rejection;
            expect(probe.stop).toHaveBeenCalledOnce();
        } finally { vi.useRealTimers(); }
    });
});

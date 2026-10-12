import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readCliStoredToken } from '../src/cli-stored-token';

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

    it('ignores other accounts, malformed tokens, missing and invalid files', () => {
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:bob': { token: 'gho_bob' } } }));
        expect(readCliStoredToken({}, home)).toBeUndefined();
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:alice': { token: 'not a token' } } }));
        expect(readCliStoredToken({}, home)).toBeUndefined();
        write('{ not json');
        expect(readCliStoredToken({}, home)).toBeUndefined();
        fs.rmSync(path.join(home, '.copilot'), { recursive: true });
        expect(readCliStoredToken({}, home)).toBeUndefined();
    });

    it('defers to explicit environment tokens', () => {
        write(JSON.stringify({ ...base, authTokens: { 'https://github.com:alice': { token: 'gho_abc' } } }));
        expect(readCliStoredToken({ GH_TOKEN: 'gho_env' }, home)).toBeUndefined();
    });

    it('honors COPILOT_HOME', () => {
        const alt = path.join(home, 'alt');
        fs.mkdirSync(alt);
        fs.writeFileSync(path.join(alt, 'config.json'), JSON.stringify({
            ...base, authTokens: { 'https://github.com:alice': { token: 'gho_alt' } },
        }));
        expect(readCliStoredToken({ COPILOT_HOME: alt }, home)).toBe('gho_alt');
    });
});

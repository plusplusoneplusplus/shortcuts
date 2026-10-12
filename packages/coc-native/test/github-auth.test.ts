import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, copyFileSync, chmodSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuthError } from '../src/auth';
import { loadNativeGitHubAuth, readGitHubCredential } from '../src/github-auth';
import type { GitHubCredentialOptions } from '../src/github-auth';

let directory: string;
let configPath: string;
let bootstrap: string;
const account = { host: 'GitHub.COM', login: 'fixture' };
beforeAll(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'github-auth-fixture-'));
    configPath = path.join(directory, 'config.json');
    bootstrap = path.join(directory, 'bootstrap.cjs');
    if (process.platform === 'win32') {
        // The native gh path executes a real executable, not a shell wrapper.
        copyFileSync(process.execPath, path.join(directory, 'gh.exe'));
    } else {
        const file = path.join(directory, 'gh');
        writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" --require "${bootstrap}" "$@"\n`);
        chmodSync(file, 0o700);
    }
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
afterEach(() => vi.unstubAllEnvs());
const config = (selection: 'active-cli-account' | typeof account = 'active-cli-account'): GitHubCredentialOptions => ({
    source: 'cli-config', configPath, account: selection,
});

function fakeGh(mode: 'valid' | 'failure' | 'oversize' | 'stderr' | 'hang' | 'tree' = 'valid'): void {
    const marker = path.join(directory, 'late');
    // Node stands in for gh; validated gh argv must not become a Node script name.
    const code = [
        `require('node:module').runMain = () => {};`,
        `const mode = ${JSON.stringify(mode)};`,
        `const expected = ['auth','token','--hostname','GitHub.COM','--user','fixture'];`,
        `if (JSON.stringify([require('node:path').basename(process.argv[1]), ...process.argv.slice(2)]) !== JSON.stringify(expected)) process.exit(2);`,
        `if (['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN'].some(k => process.env[k])) process.exit(3);`,
        `if (mode === 'failure') { process.stderr.write('gho_private'); process.exit(1); }`,
        `if (mode === 'oversize' || mode === 'stderr') { (mode === 'stderr' ? process.stderr : process.stdout).write('x'.repeat(16385), () => process.exit(0)); }`,
        `else if (mode === 'hang') { setTimeout(() => process.exit(0), 60000); }`,
        `else if (mode === 'tree') {`,
        ` require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'late'), 3000);`)}], { env: { ...process.env, NODE_OPTIONS: '' }, stdio: 'ignore' });`,
        ` require('node:fs').writeFileSync(${JSON.stringify(path.join(directory, 'ready'))}, 'ready');`,
        ` setTimeout(() => process.exit(0), 60000);`,
        `} else { process.stdout.write('gho_fixture\\n'); process.exit(0); }`,
    ].join('\n');
    writeFileSync(bootstrap, code);
    vi.stubEnv('PATH', directory);
    vi.stubEnv('NODE_OPTIONS', `--require ${JSON.stringify(bootstrap)}`);
}
const gh = (timeoutMs?: number): GitHubCredentialOptions => ({ source: 'gh-cli', account, timeoutMs });

describe('built GitHub credential acquisition', () => {
    it('exports only read/cancel lifecycle and validates before acquiring', () => {
        const native = loadNativeGitHubAuth().NativeGitHubCredentialRequest;
        const request = native.copilotCliConfig(configPath);
        request.cancel();
        expect(native.ghCli(account)).toBeDefined();
        expect(() => native.copilotCliConfig('relative.json')).toThrow('[auth-sdk:InvalidConfiguration]');
        expect(() => native.ghCli({ ...account, host: 'https://github.com' })).toThrow('[auth-sdk:InvalidConfiguration]');
    });
    it('reads exact URL-form JSONC account keys, resolves each time, and freezes snapshots', async () => {
        const text = '// fixture header\n' + JSON.stringify({
            lastLoggedInUser: { host: 'https://GitHub.COM', login: 'fixture' },
            copilotTokens: { 'https://GitHub.COM:fixture': 'gho_exact', 'github.com:fixture': 'gho_wrong' },
        });
        writeFileSync(configPath, text);
        const first = await readGitHubCredential(config());
        expect(first).toEqual({ host: 'github.com', login: 'fixture', token: 'gho_exact' });
        expect(Object.isFrozen(first)).toBe(true);
        expect(readFileSync(configPath, 'utf8')).toBe(text);
        writeFileSync(configPath, JSON.stringify({
            lastLoggedInUser: { host: 'github.com', login: 'other' }, copilotTokens: { 'github.com:other': 'gho_other' },
        }));
        expect(await readGitHubCredential(config())).toEqual({ host: 'github.com', login: 'other', token: 'gho_other' });
        expect(first.token).toBe('gho_exact');
    });
    it('explicit selection works without an active account and never rewrites config', async () => {
        const text = JSON.stringify({ copilotTokens: { 'GitHub.COM:fixture': 'gho_pinned' } });
        writeFileSync(configPath, text);
        expect(await readGitHubCredential(config(account))).toEqual({ host: 'github.com', login: 'fixture', token: 'gho_pinned' });
        expect(readFileSync(configPath, 'utf8')).toBe(text);
    });
    it.each(['ghp_copilot_policy_is_in_ts', 'unsupported', ' '])('never replaces a nonempty file token %s with an OS credential', async token => {
        writeFileSync(configPath, JSON.stringify({ copilotTokens: { 'GitHub.COM:fixture': token } }));
        expect((await readGitHubCredential(config(account))).token).toBe(token);
    });
    it.each(['null', '[]', '{}', '{"gho_private":', ' '.repeat(1024 * 1024 + 1)])('rejects invalid config %# with secret-free typed errors', async text => {
        writeFileSync(configPath, text);
        const error = await readGitHubCredential(config()).catch(error => error);
        expect(error).toBeInstanceOf(AuthError);
        expect(error.code).toBe('InvalidTokenResponse');
        expect(String(error)).not.toContain('gho_private');
        expect(error.cause).toBeUndefined();
    });
    it('invokes gh with exact argv and removes ambient overrides from the child only', async () => {
        fakeGh();
        for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) vi.stubEnv(name, 'gho_ambient');
        expect(await readGitHubCredential(gh())).toEqual({ host: 'github.com', login: 'fixture', token: 'gho_fixture' });
        for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) expect(process.env[name]).toBe('gho_ambient');
    });
    it.each([['failure', 'LoginRequired'], ['oversize', 'InvalidTokenResponse'], ['stderr', 'InvalidTokenResponse']] as const)('gh %s is terminal and redacted', async (mode, code) => {
        fakeGh(mode);
        const error = await readGitHubCredential(gh()).catch(error => error);
        expect(error).toBeInstanceOf(AuthError);
        expect(error.code).toBe(code);
        expect(String(error)).not.toContain('gho_private');
        expect(error.cause).toBeUndefined();
    });
    it('missing gh is a typed capability-independent error', async () => {
        const empty = path.join(directory, 'empty');
        // A PATH entry that does not exist prevents a real credential read.
        vi.stubEnv('PATH', empty);
        await expect(readGitHubCredential(gh())).rejects.toMatchObject({ code: 'CliUnavailable' });
    });
    it('cancels one request without cancelling a concurrent caller', async () => {
        fakeGh('hang');
        const cancelled = new AbortController();
        const survivor = new AbortController();
        const first = readGitHubCredential(gh(), cancelled.signal);
        const second = readGitHubCredential(gh(), survivor.signal);
        cancelled.abort();
        await expect(first).rejects.toMatchObject({ code: 'Cancelled' });
        let settled = false;
        void second.then(() => { settled = true; }, () => { settled = true; });
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(settled).toBe(false);
        survivor.abort();
        await expect(second).rejects.toMatchObject({ code: 'Cancelled' });
    });
    it('captures cancellation before Tokio starts a submitted request', async () => {
        fakeGh('hang');
        const request = loadNativeGitHubAuth().NativeGitHubCredentialRequest.ghCli(account);
        const pending = request.read();
        request.cancel();
        await expect(pending).rejects.toThrow('[auth-sdk:Cancelled]');
        expect(() => request.read()).toThrow('[auth-sdk:InvalidConfiguration]');
    });
    it('does not acquire for an already aborted signal', async () => {
        const controller = new AbortController(); controller.abort();
        await expect(readGitHubCredential(config(), controller.signal)).rejects.toMatchObject({ code: 'Cancelled' });
    });
    it('bounds timeout and kills gh process descendants on cancel and timeout', async () => {
        for (const cancel of [true, false]) {
            const ready = path.join(directory, 'ready');
            rmSync(ready, { force: true });
            fakeGh('tree');
            const controller = new AbortController();
            const pending = readGitHubCredential(gh(cancel ? 5000 : 2000), controller.signal);
            if (cancel) {
                const deadline = Date.now() + 2500;
                while (!existsSync(ready) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
                controller.abort();
            }
            await expect(pending).rejects.toMatchObject({ code: cancel ? 'Cancelled' : 'TimedOut' });
            expect(existsSync(ready)).toBe(true);
            await new Promise(resolve => setTimeout(resolve, 3300));
            expect(existsSync(path.join(directory, 'late'))).toBe(false);
        }
    });
    it.each([0, -1, 0.5, 10_001, Number.NaN])('rejects invalid timeout %s before native conversion', async timeoutMs => {
        await expect(readGitHubCredential(gh(timeoutMs))).rejects.toMatchObject({ code: 'InvalidConfiguration' });
    });
});

describe('GitHub capability guard', () => {
    it('fails on missing factories or cancellation/read methods, without a JS fallback', async () => {
        vi.doMock('../src/loader', async importOriginal => ({
            ...await importOriginal<typeof import('../src/loader')>(),
            loadNativeAddon: () => ({ NativeGitHubCredentialRequest: class {
                static copilotCliConfig() {}
                static ghCli() {}
                read() {}
            } }),
        }));
        vi.resetModules();
        try {
            const { readGitHubCredential: missing } = await import('../src/github-auth');
            await expect(missing(config())).rejects.toThrow('missing GitHub authentication capability');
        } finally {
            vi.doUnmock('../src/loader'); vi.resetModules();
        }
    });
    it('preserves binary load failures rather than success-shaped fallbacks', async () => {
        vi.doMock('../src/loader', async importOriginal => {
            const actual = await importOriginal<typeof import('../src/loader')>();
            return { ...actual, loadNativeAddon: () => { throw new actual.NativeAddonLoadError('fixture unavailable'); } };
        });
        vi.resetModules();
        try {
            const { readGitHubCredential: missing } = await import('../src/github-auth');
            await expect(missing(config())).rejects.toThrow('fixture unavailable');
        } finally {
            vi.doUnmock('../src/loader'); vi.resetModules();
        }
    });
});

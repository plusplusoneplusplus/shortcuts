import { open } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { readWindowsCredential } from '@plusplusoneplusplus/coc-native';
import { loadCopilotSdk } from '../sdk-esm-loader';
import { createSdkClient } from '../sdk-client-factory';
import { withAbort } from './transport';
import { stripJsoncComments } from '../trusted-folder';
import { CopilotDirectError } from './errors';
import type { CopilotCredentialConfig, CopilotCredentialSnapshot } from './types';

const MAX_CONFIG_BYTES = 1024 * 1024;
const unavailable = (message: string) => new CopilotDirectError('DIRECT_CREDENTIAL_UNAVAILABLE', message);
export function getDirectCopilotConfigPath(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
    // CLI 1.0.78 passes COPILOT_HOME, not XDG_CONFIG_HOME, to resolveCopilotHome.
    return join(env.COPILOT_HOME ? resolve(home, env.COPILOT_HOME) : join(home, '.copilot'), 'config.json');
}
function accountValid(account: { host: string; login: string }): boolean {
    return typeof account.host === 'string' && /^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(account.host)
        && typeof account.login === 'string' && /^[a-zA-Z0-9_-]+$/.test(account.login);
}
function normalizeCredentialHost(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value) return undefined;
    try {
        const host = new URL(value.includes('://') ? value : `https://${value}`);
        if (host.protocol !== 'https:' || host.port || host.username || host.password
            || host.pathname !== '/' || host.search || host.hash) return undefined;
        return host.hostname;
    } catch { return undefined; }
}
export function validateCredentialConfig(config: CopilotCredentialConfig): void {
    const invalid = () => { throw new CopilotDirectError('DIRECT_CONFIG_INVALID', 'Select a valid direct credential source and account policy.'); };
    if (!config || typeof config !== 'object') return invalid();
    switch (config.source) {
        case 'copilot-cli': break;
        case 'environment':
            if (typeof config.variable !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.variable)) invalid();
            if ((config.host !== undefined || config.login !== undefined)
                && !accountValid({ host: config.host ?? '', login: config.login ?? '' })) invalid();
            break;
        case 'resolver': if (typeof config.resolve !== 'function') invalid(); break;
        case 'cli-config':
            if (config.account !== 'active-cli-account' && (!config.account
                || !accountValid({ ...config.account, host: normalizeCredentialHost(config.account.host) ?? '' }))) invalid();
            if (config.configPath !== undefined && (typeof config.configPath !== 'string' || !config.configPath)) invalid();
            break;
        case 'keychain': case 'gh-cli': if (!accountValid(config)) invalid(); break;
        default: invalid();
    }
}
/** Read the CLI's selected identity and token without creating or resuming a session. */
async function readCliCredential(signal: AbortSignal): Promise<CopilotCredentialSnapshot> {
    await withAbort(loadCopilotSdk(), signal);
    const client = await createSdkClient({});
    const stop = () => { void client.stop().catch(() => {}); };
    signal.addEventListener('abort', stop, { once: true });
    try {
        signal.throwIfAborted();
        await withAbort(client.start(), signal);
        const { authInfo } = await withAbort(client.rpc.account.getCurrentAuth(), signal);
        if (!authInfo || !['user', 'env', 'gh-cli', 'token'].includes(authInfo.type)) {
            throw unavailable('Sign in with the Copilot CLI using a supported GitHub account.');
        }
        let token: string | undefined;
        const login = 'login' in authInfo ? authInfo.login : authInfo.copilotUser?.login;
        if ('token' in authInfo) token = authInfo.token;
        else {
            const users = await withAbort(client.rpc.account.getAllUsers(), signal);
            token = users.find(user => user.authInfo.type === authInfo.type
                && user.authInfo.host === authInfo.host
                && 'login' in user.authInfo && user.authInfo.login === login)?.token;
        }
        const host = normalizeCredentialHost(authInfo.host);
        if (!host) throw unavailable('Invalid Copilot CLI authentication host.');
        return { host, login: login ?? 'cli-token', token: token ?? '' };
    } finally {
        signal.removeEventListener('abort', stop);
        await client.stop();
    }
}

export async function readCopilotCredential(config: CopilotCredentialConfig, signal: AbortSignal): Promise<Readonly<CopilotCredentialSnapshot>> {
    validateCredentialConfig(config);
    signal.throwIfAborted();
    let snapshot: CopilotCredentialSnapshot;
    try {
        switch (config.source) {
            case 'copilot-cli':
                snapshot = await readCliCredential(signal);
                break;
            case 'environment':
                snapshot = { token: process.env[config.variable] ?? '', host: config.host ?? 'github.com', login: config.login ?? 'environment' };
                break;
            case 'resolver':
                try { snapshot = await config.resolve(signal); }
                catch { throw unavailable('Selected resolver credential could not be read.'); }
                break;
            case 'keychain': throw unavailable('Direct keychain acquisition is unverified on this platform. Select SDK mode or an explicit supported credential source.');
            case 'gh-cli': {
                const token = await new Promise<string>((resolveToken, reject) => {
                    // gh otherwise prioritizes ambient tokens over the explicitly selected account.
                    const env = { ...process.env };
                    delete env.GH_TOKEN; delete env.GITHUB_TOKEN;
                    delete env.GH_ENTERPRISE_TOKEN; delete env.GITHUB_ENTERPRISE_TOKEN;
                    execFile('gh', ['auth', 'token', '--hostname', config.host, '--user', config.login],
                        { signal, timeout: 10_000, maxBuffer: 16_384, env, windowsHide: true },
                        (error, stdout) => error ? reject(unavailable('Selected gh-cli credential is unavailable.')) : resolveToken(stdout.trim()));
                });
                snapshot = { token, host: config.host, login: config.login };
                break;
            }
            case 'cli-config': {
                const file = await open(config.configPath ?? getDirectCopilotConfigPath(), 'r');
                let parsed: any;
                try {
                    const before = await file.stat();
                    if (!before.isFile() || before.size > MAX_CONFIG_BYTES) throw unavailable('Copilot credential config exceeds the read limit or is not a file.');
                    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
                    let bytes = 0;
                    while (bytes < buffer.length) {
                        const read = await file.read(buffer, bytes, buffer.length - bytes, bytes);
                        if (!read.bytesRead) break;
                        bytes += read.bytesRead;
                        signal.throwIfAborted();
                    }
                    const after = await file.stat();
                    if (bytes > MAX_CONFIG_BYTES || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
                        throw unavailable('Copilot credential config changed during reading or exceeds the read limit.');
                    parsed = JSON.parse(stripJsoncComments(buffer.subarray(0, bytes).toString('utf8')));
                } finally { await file.close(); }
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unavailable('Invalid Copilot credential config.');
                const account = config.account === 'active-cli-account' ? parsed.lastLoggedInUser : config.account;
                const host = normalizeCredentialHost(account?.host);
                if (!account || !host || !accountValid({ host, login: account.login })) throw unavailable('Selected Copilot account is missing.');
                let token = parsed.copilotTokens?.[`${account.host}:${account.login}`];
                if ((token === undefined || token === null || token === '') && process.platform === 'win32') {
                    signal.throwIfAborted();
                    try {
                        token = await withAbort(readWindowsCredential(`copilot-cli/${account.host}:${account.login}`), signal);
                    } catch {
                        throw unavailable('Selected Copilot Windows credential could not be read.');
                    }
                }
                snapshot = { host, login: account.login, token };
                break;
            }
        }
    } catch (error) {
        if (error instanceof CopilotDirectError) throw error;
        throw unavailable('Selected Copilot credential could not be read.');
    }
    const tokenPattern = config.source === 'copilot-cli'
        ? /^(gho_|ghu_|ghp_|ghs_|github_pat_)[A-Za-z0-9_]+$/
        : /^(gho_|ghu_|github_pat_)[A-Za-z0-9_]+$/;
    if (!snapshot || !accountValid(snapshot) || typeof snapshot.token !== 'string' || !tokenPattern.test(snapshot.token))
        throw unavailable('Selected Copilot credential is missing or has an unsupported token type.');
    return Object.freeze({ token: snapshot.token, host: snapshot.host.toLowerCase(), login: snapshot.login });
}

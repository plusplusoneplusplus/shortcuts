import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuthError, readGitHubCredential } from '@plusplusoneplusplus/coc-native';
import { loadCopilotSdk } from '../sdk-esm-loader';
import { createSdkClient } from '../sdk-client-factory';
import { withAbort } from './transport';
import { CopilotDirectError } from './errors';
import type { CopilotCredentialConfig, CopilotCredentialSnapshot } from './types';

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
        const authority = /^https:\/\//i.test(value) ? value.slice(8).replace(/\/$/, '') : value;
        if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(authority)
            || host.protocol !== 'https:' || host.port || host.username || host.password
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
        case 'gh-cli': if (!accountValid(config)) invalid(); break;
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
            case 'gh-cli': {
                snapshot = await readGitHubCredential({
                    source: 'gh-cli', account: { host: config.host, login: config.login },
                }, signal);
                break;
            }
            case 'cli-config': {
                snapshot = await readGitHubCredential({
                    source: 'cli-config', account: config.account,
                    configPath: resolve(config.configPath ?? getDirectCopilotConfigPath()),
                }, signal);
                break;
            }
        }
    } catch (error) {
        if (signal.aborted && (config.source === 'cli-config' || config.source === 'gh-cli')) throw signal.reason;
        if (error instanceof AuthError && error.code === 'Cancelled')
            throw new CopilotDirectError('DIRECT_CANCELLED', 'Copilot credential acquisition was cancelled.');
        if (error instanceof AuthError && error.code === 'TimedOut')
            throw new CopilotDirectError('DIRECT_TIMEOUT', 'Copilot credential acquisition deadline expired.');
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

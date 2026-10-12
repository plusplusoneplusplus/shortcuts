import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stripJsoncComments } from './trusted-folder';
import { getSDKLogger } from './logger';

const MAX_CONFIG_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^(gho_|ghu_|github_pat_)[A-Za-z0-9_]+$/;
const AMBIENT_TOKEN_VARS = ['COPILOT_SDK_AUTH_TOKEN', 'COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;

interface CliAuthProbe {
    start(): Promise<void>;
    stop(): Promise<Error[] | void>;
    rpc: { account: { getCurrentAuth(): Promise<{ authInfo?: { type: string } | null }> } };
}

class CliCredentialConfigError extends Error {
    constructor() {
        super('Copilot CLI credential config could not be read or contains invalid credentials.');
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Resolve and validate the exact account's file token for SDK and direct HTTP callers. */
export function readCliAccountToken(config: Record<string, unknown>, key: string): string | undefined {
    if (config.authTokens !== undefined && !isRecord(config.authTokens)) throw new CliCredentialConfigError();
    if (config.copilotTokens !== undefined && !isRecord(config.copilotTokens)) throw new CliCredentialConfigError();
    const readAuthToken = (entry: unknown): unknown => {
        if (entry === undefined || entry === null) return undefined;
        if (!isRecord(entry)) throw new CliCredentialConfigError();
        return entry.token;
    };
    const authTokens = isRecord(config.authTokens) ? config.authTokens : {};
    const candidates = [
        readAuthToken(authTokens[`${key}:github`]),
        readAuthToken(authTokens[key]),
        isRecord(config.copilotTokens) ? config.copilotTokens[key] : undefined,
    ];
    const token = candidates.find(t => t !== undefined && t !== null && t !== '');
    if (token === undefined) return undefined;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new CliCredentialConfigError();
    return token;
}

/**
 * Token the Copilot CLI stored for its selected account.
 *
 * Missing credentials leave runtime resolution untouched; malformed config or
 * credentials fail without silently switching accounts.
 */
export function readCliStoredToken(
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
): string | undefined {
    if (AMBIENT_TOKEN_VARS.some(name => env[name])) return undefined;
    try {
        const configPath = path.join(env.COPILOT_HOME ? path.resolve(home, env.COPILOT_HOME) : path.join(home, '.copilot'), 'config.json');
        const fd = fs.openSync(configPath, 'r');
        let text: string;
        try {
            const stat = fs.fstatSync(fd);
            if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) throw new Error('Invalid config size');
            const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
            let bytes = 0;
            while (bytes < buffer.length) {
                const count = fs.readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
                if (!count) break;
                bytes += count;
            }
            if (bytes > MAX_CONFIG_BYTES) throw new Error('Invalid config size');
            text = buffer.subarray(0, bytes).toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
        const parsed: unknown = JSON.parse(stripJsoncComments(text));
        if (!isRecord(parsed)) throw new CliCredentialConfigError();
        const account = parsed.lastLoggedInUser;
        if (account === undefined || account === null) return undefined;
        if (!isRecord(account) || typeof account.host !== 'string' || !account.host
            || typeof account.login !== 'string' || !account.login) throw new CliCredentialConfigError();
        return readCliAccountToken(parsed, `${account.host}:${account.login}`);
    } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
        throw new CliCredentialConfigError();
    }
}

/**
 * Probe runtime authentication without creating a session. Keyring and explicit
 * runtime credentials win; a CLI file token takes precedence over gh fallback.
 */
export async function resolveCliStoredToken(
    createClient: () => CliAuthProbe | Promise<CliAuthProbe>,
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
): Promise<string | undefined> {
    if (env.COPILOT_SDK_DEFAULT_CONNECTION?.toLowerCase() === 'inprocess'
        || AMBIENT_TOKEN_VARS.some(name => env[name])) return undefined;
    const configPath = path.join(env.COPILOT_HOME ? path.resolve(home, env.COPILOT_HOME) : path.join(home, '.copilot'), 'config.json');
    if (!fs.existsSync(configPath)) return undefined;

    const client = await createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let expired = false;
    try {
        return await Promise.race([
            (async () => {
                await client.start();
                if (expired) throw new Error('Authentication discovery timed out');
                const { authInfo } = await client.rpc.account.getCurrentAuth();
                if (expired) throw new Error('Authentication discovery timed out');
                if (authInfo && authInfo.type !== 'gh-cli') return undefined;
                const token = readCliStoredToken(env, home);
                if (token) getSDKLogger().info('Copilot keyring credentials unavailable; using selected CLI account config credential.');
                return token;
            })(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    expired = true;
                    reject(new Error('Authentication discovery timed out'));
                }, 10_000);
            }),
        ]);
    } catch (error) {
        if (error instanceof CliCredentialConfigError) throw error;
        throw new Error('Copilot runtime authentication discovery failed.');
    } finally {
        clearTimeout(timer);
        try { await client.stop(); }
        catch { throw new Error('Copilot authentication probe could not be stopped.'); }
    }
}

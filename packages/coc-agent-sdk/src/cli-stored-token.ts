import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stripJsoncComments } from './trusted-folder';

const MAX_CONFIG_BYTES = 1024 * 1024;
const TOKEN_PATTERN = /^(gho_|ghu_|github_pat_)[A-Za-z0-9_]+$/;
const AMBIENT_TOKEN_VARS = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'] as const;

/**
 * Token the Copilot CLI stored in `<COPILOT_HOME|~/.copilot>/config.json` for
 * its last logged-in account. The runtime launched over stdio only consults the
 * system keyring and then `gh`, so on hosts without a populated keyring it would
 * silently authenticate as the `gh` account instead of the CLI account.
 *
 * Returns `undefined` when an explicit token is already in the environment or
 * the file has no usable token, leaving the runtime's own resolution untouched.
 */
export function readCliStoredToken(
    env: NodeJS.ProcessEnv = process.env,
    home: string = os.homedir(),
): string | undefined {
    if (AMBIENT_TOKEN_VARS.some(name => env[name])) return undefined;
    try {
        const configPath = path.join(env.COPILOT_HOME ? path.resolve(home, env.COPILOT_HOME) : path.join(home, '.copilot'), 'config.json');
        const stat = fs.statSync(configPath);
        if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES) return undefined;
        const parsed = JSON.parse(stripJsoncComments(fs.readFileSync(configPath, 'utf8')));
        const account = parsed?.lastLoggedInUser;
        if (typeof account?.host !== 'string' || typeof account?.login !== 'string') return undefined;
        const key = `${account.host}:${account.login}`;
        const candidates = [
            parsed.authTokens?.[`${key}:github`]?.token,
            parsed.authTokens?.[key]?.token,
            parsed.copilotTokens?.[key],
        ];
        return candidates.find((t): t is string => typeof t === 'string' && TOKEN_PATTERN.test(t));
    } catch {
        return undefined;
    }
}

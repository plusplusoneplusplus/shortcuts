/**
 * ADO session cache — stores bearer token + account identity in
 * `~/.coc/ado-session.json` to avoid repeated `az account get-access-token`
 * calls (which take ~300–800 ms each).
 *
 * Cache is considered valid when the token expires more than 5 minutes from now.
 * No VS Code dependencies — pure Node.js.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const CACHE_FILENAME = 'ado-session.json';
/** Tokens are refreshed 5 minutes before they expire. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export interface AdoAccountInfo {
    upn: string;
    displayName: string;
    /** ADO identity GUID — resolved lazily via the Identities API. */
    adoId: string | null;
}

export interface AdoSessionCache {
    token: string;
    /** Epoch ms at which the token expires. */
    expiresAt: number;
    account: AdoAccountInfo | null;
}

function resolveCachePath(dataDir?: string): string {
    const base = dataDir ?? process.env.COC_DATA_DIR ?? path.join(os.homedir(), '.coc');
    return path.join(base, CACHE_FILENAME);
}

/**
 * Read and parse the ADO session cache.
 * Returns `null` on cache miss, parse error, or any I/O error.
 */
export async function readAdoSessionCache(dataDir?: string): Promise<AdoSessionCache | null> {
    const filePath = resolveCachePath(dataDir);
    try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as AdoSessionCache;
        if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

/**
 * Atomically write the ADO session cache (tmp → rename).
 */
export async function writeAdoSessionCache(
    cache: AdoSessionCache,
    dataDir?: string,
): Promise<void> {
    const filePath = resolveCachePath(dataDir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmpPath = filePath + '.tmp';
    await fs.writeFile(tmpPath, JSON.stringify(cache, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
}

/**
 * Clear the ADO session cache when a token is rejected by the server.
 */
export async function clearAdoSessionCache(dataDir?: string): Promise<void> {
    const filePath = resolveCachePath(dataDir);
    try {
        await fs.unlink(filePath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw err;
        }
    }
}

/**
 * Returns `true` when the cached token is still valid (expiry > 5 minutes away).
 */
export function isTokenValid(cache: AdoSessionCache): boolean {
    return cache.expiresAt - Date.now() > EXPIRY_BUFFER_MS;
}

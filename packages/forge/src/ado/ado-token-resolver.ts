/**
 * Shared ADO token resolver — ensures at most one `az account get-access-token`
 * process runs inside a CoC server process at any time.
 *
 * Concurrent callers that need the same Azure DevOps bearer token share the
 * same in-flight token refresh. Once a valid token is cached, later callers
 * use the cached token without invoking Azure CLI.
 */
import { getLogger, LogCategory } from '../logger';
import { execAsync } from '../utils/exec-utils';
import {
    type AdoAccountInfo,
    type AdoSessionCache,
    readAdoSessionCache,
    writeAdoSessionCache,
    isTokenValid,
} from './ado-session-cache';

/** Azure DevOps resource ID for OAuth token requests. */
export const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

/**
 * Injectable runner for Azure CLI commands.
 * Production code should not pass this; it exists for deterministic testing.
 */
export type AdoAzCliRunner = (command: string) => Promise<{ stdout: string; stderr: string }>;

export interface ResolveAdoAccessTokenOptions {
    dataDir?: string;
    runAzCli?: AdoAzCliRunner;
}

export interface ResolvedAdoAccessToken {
    token: string;
    expiresAt: number;
    account: AdoAccountInfo | null;
}

// ---------------------------------------------------------------------------
// Module-level single-flight state
// ---------------------------------------------------------------------------

/** In-flight refresh promises keyed by resolved dataDir. */
const inflight = new Map<string, Promise<ResolvedAdoAccessToken | null>>();

/** Global queue ensuring at most one az CLI token command at a time. */
let azCliQueue: Promise<unknown> = Promise.resolve();

function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = azCliQueue.then(operation, operation);
    azCliQueue = next.catch(() => undefined);
    return next;
}

function resolveCacheKey(dataDir?: string): string {
    return dataDir ?? process.env.COC_DATA_DIR ?? '~default';
}

// ---------------------------------------------------------------------------
// Default runner (uses cmd.exe on Windows for az.cmd resolution)
// ---------------------------------------------------------------------------

function defaultAzCliRunner(command: string): Promise<{ stdout: string; stderr: string }> {
    if (process.platform === 'win32') {
        const comSpec = process.env.ComSpec?.trim() || 'cmd.exe';
        return execAsync(`${comSpec} /d /s /c ${command}`);
    }
    return execAsync(command);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve an ADO access token, using the on-disk cache when valid and
 * single-flighting concurrent refreshes.
 */
export async function resolveAdoAccessToken(
    options?: ResolveAdoAccessTokenOptions,
): Promise<ResolvedAdoAccessToken | null> {
    const logger = getLogger();
    const dataDir = options?.dataDir;
    const runner = options?.runAzCli ?? defaultAzCliRunner;

    // 1. Read cache — fast path.
    const cached = await readAdoSessionCache(dataDir);
    if (cached && isTokenValid(cached)) {
        logger.info(LogCategory.ADO, 'ADO token resolver: using cached token');
        return { token: cached.token, expiresAt: cached.expiresAt, account: cached.account };
    }

    // 2. Resolve cache key for single-flight deduplication.
    const key = resolveCacheKey(dataDir);

    // 3. If a refresh is already in-flight for this key, await it.
    const existing = inflight.get(key);
    if (existing) {
        logger.info(LogCategory.ADO, 'ADO token resolver: awaiting in-flight refresh');
        return existing;
    }

    // 4. Create and store a refresh promise.
    const refreshPromise = (async (): Promise<ResolvedAdoAccessToken | null> => {
        // Re-read cache inside the refresh in case another refresh completed
        // between the outer cache read and this point.
        const freshCache = await readAdoSessionCache(dataDir);
        if (freshCache && isTokenValid(freshCache)) {
            logger.info(LogCategory.ADO, 'ADO token resolver: cache populated by concurrent refresh');
            return { token: freshCache.token, expiresAt: freshCache.expiresAt, account: freshCache.account };
        }

        // Run az CLI exclusively (one token command at a time process-wide).
        return runExclusive(async () => {
            // One more cache check after acquiring the queue slot.
            const postQueueCache = await readAdoSessionCache(dataDir);
            if (postQueueCache && isTokenValid(postQueueCache)) {
                return { token: postQueueCache.token, expiresAt: postQueueCache.expiresAt, account: postQueueCache.account };
            }

            logger.info(LogCategory.ADO, 'ADO token resolver: fetching token via az CLI');

            try {
                const tokenCommand = `az account get-access-token --resource ${ADO_RESOURCE_ID} --query "{token:accessToken,expiresOn:expiresOn}" -o json`;
                const { stdout: tokenJson } = await runner(tokenCommand);
                const tokenData = JSON.parse(tokenJson.trim()) as {
                    token: string;
                    expiresOn: string;
                };
                if (!tokenData.token) {
                    return null;
                }
                const expiresAt = new Date(tokenData.expiresOn).getTime();

                // Best-effort account info.
                let account: AdoAccountInfo | null = null;
                try {
                    const accountCommand = `az account show --query "{upn:user.name,displayName:user.name}" -o json`;
                    const { stdout: accountJson } = await runner(accountCommand);
                    const accountData = JSON.parse(accountJson.trim()) as {
                        upn: string;
                        displayName: string;
                    };
                    account = { upn: accountData.upn, displayName: accountData.displayName, adoId: null };
                } catch (accountErr) {
                    const msg = accountErr instanceof Error ? accountErr.message : String(accountErr);
                    logger.warn(LogCategory.ADO, `ADO token resolver: failed to fetch account info: ${msg}`);
                }

                // Write to cache (best-effort).
                const newCache: AdoSessionCache = { token: tokenData.token, expiresAt, account };
                try {
                    await writeAdoSessionCache(newCache, dataDir);
                } catch (writeErr) {
                    const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
                    logger.warn(LogCategory.ADO, `ADO token resolver: failed to write cache: ${msg}`);
                }

                return { token: tokenData.token, expiresAt, account };
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                logger.warn(LogCategory.ADO, `ADO token resolver: az CLI failed: ${msg}`);
                return null;
            }
        });
    })();

    inflight.set(key, refreshPromise);
    try {
        return await refreshPromise;
    } finally {
        inflight.delete(key);
    }
}

/**
 * Convenience wrapper that returns only the token string (or undefined).
 * Suitable as an `AzureBoardsAccessTokenResolver`.
 */
export async function resolveAdoAccessTokenValue(
    options?: ResolveAdoAccessTokenOptions,
): Promise<string | undefined> {
    const result = await resolveAdoAccessToken(options);
    return result?.token;
}

/**
 * Reset module-level state for test isolation.
 */
export function resetAdoTokenResolverForTests(): void {
    inflight.clear();
    azCliQueue = Promise.resolve();
}

/**
 * Lazy ADO identity GUID resolver.
 *
 * Resolves a user's ADO identity GUID (adoId) from their UPN via the
 * Azure DevOps Identities API, then persists the result back to the
 * session cache so future calls do not need to re-resolve.
 *
 * Best-effort: on any failure the function logs a warning and returns null.
 * Pure Node.js.
 */
import type { WebApi } from 'azure-devops-node-api';
import { getLogger, LogCategory } from '../logger';
import { readAdoSessionCache, writeAdoSessionCache } from './ado-session-cache';

/**
 * Call the ADO Identities API to resolve `upn` → identity GUID.
 *
 * @param connection - An authenticated `WebApi` instance.
 * @param orgUrl     - Full org URL, e.g. `https://dev.azure.com/myorg`.
 * @param upn        - User principal name (email address).
 * @returns The identity GUID string, or `null` on failure.
 */
export async function resolveAdoIdentity(
    connection: WebApi,
    orgUrl: string,
    upn: string,
): Promise<string | null> {
    const logger = getLogger();
    try {
        const org = extractOrgName(orgUrl);
        if (!org) {
            logger.warn(LogCategory.ADO, `resolveAdoIdentity: cannot parse org from "${orgUrl}"`);
            return null;
        }

        // The Identities API lives under the VSSPS host.
        const vsspsUrl = `https://vssps.dev.azure.com/${org}/_apis/identities?searchFilter=MailAddress&filterValue=${encodeURIComponent(upn)}&api-version=7.1`;

        // Use the underlying rest client from the WebApi connection.
        const client = await connection.rest;
        // Fallback: use node-fetch / https if rest client unavailable.
        const response = await fetchWithHandler(connection, vsspsUrl);
        if (!response) {
            logger.warn(LogCategory.ADO, `resolveAdoIdentity: empty response for "${upn}"`);
            return null;
        }

        const identities = response as { value?: Array<{ id: string }> };
        const id = identities?.value?.[0]?.id ?? null;
        void client; // client resolved but we use fetchWithHandler
        return id;
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(LogCategory.ADO, `resolveAdoIdentity failed for "${upn}": ${msg}`);
        return null;
    }
}

/**
 * Resolve the ADO identity GUID for the current cached account and persist
 * `adoId` back to the session cache.
 *
 * No-op when the cache is missing, has no account, or already has an adoId.
 *
 * @returns The resolved GUID, or `null` when resolution was skipped or failed.
 */
export async function resolveAndCacheAdoIdentity(
    connection: WebApi,
    orgUrl: string,
    dataDir?: string,
): Promise<string | null> {
    const logger = getLogger();

    const cache = await readAdoSessionCache(dataDir);
    if (!cache || !cache.account) return null;
    if (cache.account.adoId) return cache.account.adoId;

    const adoId = await resolveAdoIdentity(connection, orgUrl, cache.account.upn);
    if (!adoId) return null;

    try {
        await writeAdoSessionCache(
            { ...cache, account: { ...cache.account, adoId } },
            dataDir,
        );
    } catch (writeErr) {
        const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
        logger.warn(LogCategory.ADO, `Failed to persist adoId to cache: ${msg}`);
    }

    return adoId;
}

/**
 * Resolve the current user's ADO identity GUID directly from the
 * Connection Data API using only a bearer token. No cached UPN required.
 *
 * Endpoint: GET {orgUrl}/_apis/connectionData
 * Returns authenticatedUser.id (GUID) or null on failure.
 */
export async function resolveAdoUserIdFromConnectionData(
    orgUrl: string,
    bearerToken: string,
): Promise<string | null> {
    const logger = getLogger();
    try {
        const url = `${orgUrl.replace(/\/$/, '')}/_apis/connectionData`;
        const https = await import('https');
        return new Promise((resolve) => {
            const req = https.get(
                url,
                { headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' } },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => (data += chunk));
                    res.on('end', () => {
                        try {
                            const json = JSON.parse(data);
                            const id = json?.authenticatedUser?.id ?? null;
                            if (id) {
                                logger.info(LogCategory.ADO, `resolveAdoUserIdFromConnectionData: resolved id=${id}`);
                            }
                            resolve(id);
                        } catch {
                            resolve(null);
                        }
                    });
                },
            );
            req.on('error', () => resolve(null));
        });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(LogCategory.ADO, `resolveAdoUserIdFromConnectionData failed: ${msg}`);
        return null;
    }
}

/**
 * High-level convenience function: read cached ADO user ID, or resolve it
 * via the VSSPS Identities API and cache the result. Falls back to the
 * Connection Data API when no cached UPN is available.
 *
 * Callers only need an org URL and bearer token — no `azure-devops-node-api`
 * import required.
 *
 * Best-effort: returns `null` on any failure (missing cache, no UPN, API error).
 */
export async function getOrResolveAdoUserId(
    orgUrl: string,
    bearerToken: string,
    dataDir?: string,
): Promise<string | null> {
    try {
        // Tier 1: cached adoId
        const cache = await readAdoSessionCache(dataDir);
        if (cache?.account?.adoId) {
            return cache.account.adoId;
        }

        // Tier 1b: resolve via VSSPS Identities API (requires cached UPN)
        if (cache?.account?.upn) {
            const azdev = await import('azure-devops-node-api');
            const authHandler = azdev.getBearerHandler(bearerToken);
            const connection = new azdev.WebApi(orgUrl, authHandler);
            const resolved = await resolveAndCacheAdoIdentity(connection, orgUrl, dataDir);
            if (resolved) return resolved;
        }

        // Tier 2: resolve via Connection Data API (no cache/UPN needed)
        return await resolveAdoUserIdFromConnectionData(orgUrl, bearerToken);
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Extract the org name segment from a `https://dev.azure.com/<org>` URL. */
function extractOrgName(orgUrl: string): string | null {
    try {
        const url = new URL(orgUrl);
        const segments = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
        return segments[0] ?? null;
    } catch {
        return null;
    }
}

/**
 * Perform an authenticated GET using the WebApi's underlying credentials.
 * Returns the parsed JSON body, or null on error.
 */
async function fetchWithHandler(connection: WebApi, url: string): Promise<unknown> {
    // WebApi exposes a `rest` property (VsoClient-wrapped RestClient) and a
    // lower-level `http` client. We use the VsoClient's `_http` layer so we
    // inherit the bearer token without re-implementing auth.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyConn = connection as any;
    const restClient = anyConn.rest ?? anyConn._client;

    if (restClient && typeof restClient.get === 'function') {
        const res = await restClient.get(url);
        return res?.result ?? res;
    }

    // Final fallback: raw https.
    return fetchViaHttps(url, connection);
}

async function fetchViaHttps(url: string, connection: WebApi): Promise<unknown> {
    const https = await import('https');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = (connection as any)._authHandler?.token ?? '';

    return new Promise((resolve, reject) => {
        const req = https.get(
            url,
            { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
            (res) => {
                let data = '';
                res.on('data', (chunk: string) => (data += chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch {
                        resolve(null);
                    }
                });
            },
        );
        req.on('error', reject);
    });
}

/**
 * Lazy ADO identity GUID resolver.
 *
 * Resolves a user's ADO identity GUID (adoId) from their UPN via the
 * Azure DevOps Identities API, then persists the result back to the
 * session cache so future calls do not need to re-resolve.
 *
 * Best-effort: on any failure the function logs a warning and returns null.
 * No VS Code dependencies — pure Node.js.
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

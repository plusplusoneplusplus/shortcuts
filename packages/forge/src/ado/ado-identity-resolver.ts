import { getLogger, LogCategory } from '../logger';

/**
 * Resolve the ADO identity from the supplied token and organization. Microsoft
 * account selectors are not ADO identity GUIDs; never reuse disk-cached identity.
 */
export async function resolveAdoUserIdFromConnectionData(
    orgUrl: string,
    bearerToken: string,
    signal?: AbortSignal,
): Promise<string | null> {
    signal?.throwIfAborted();
    const logger = getLogger();
    try {
        const url = `${orgUrl.replace(/\/$/, '')}/_apis/connectionData`;
        const https = await import('https');
        signal?.throwIfAborted();
        return await new Promise((resolve) => {
            const req = https.get(
                url,
                { headers: { Authorization: `Bearer ${bearerToken}`, Accept: 'application/json' } },
                (res) => {
                    let data = '';
                    res.on('data', (chunk: string) => (data += chunk));
                    res.on('error', () => {
                        logger.warn(LogCategory.ADO, 'ADO identity response failed');
                        resolve(null);
                    });
                    res.on('end', () => {
                        if (res.statusCode !== 200) {
                            logger.warn(LogCategory.ADO, 'ADO identity request returned an unsuccessful status');
                            resolve(null);
                            return;
                        }
                        try {
                            const json = JSON.parse(data);
                            const id: unknown = json?.authenticatedUser?.id;
                            if (typeof id === 'string' && id.length > 0) {
                                resolve(id);
                            } else {
                                logger.warn(LogCategory.ADO, 'ADO identity response has no authenticated user ID');
                                resolve(null);
                            }
                        } catch {
                            logger.warn(LogCategory.ADO, 'ADO identity response is invalid JSON');
                            resolve(null);
                        }
                    });
                },
            );
            req.on('error', () => {
                logger.warn(LogCategory.ADO, 'ADO identity request failed');
                resolve(null);
            });
        });
    } catch {
        signal?.throwIfAborted();
        logger.warn(LogCategory.ADO, 'ADO identity resolution failed');
        return null;
    }
}

export async function getOrResolveAdoUserId(
    orgUrl: string,
    bearerToken: string,
    signal?: AbortSignal,
): Promise<string | null> {
    return resolveAdoUserIdFromConnectionData(orgUrl, bearerToken, signal);
}

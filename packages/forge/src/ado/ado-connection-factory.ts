import * as azdev from 'azure-devops-node-api';
import { getLogger, LogCategory } from '../logger';
import { execAsync } from '../utils/exec-utils';
import type { AdoClientOptions, AdoConnectionResult } from './types';
import {
    AdoSessionCache,
    readAdoSessionCache,
    writeAdoSessionCache,
    isTokenValid,
} from './ado-session-cache';

const ENV_ORG_URL = 'AZURE_DEVOPS_ORG_URL';
/** Azure DevOps resource ID for OAuth token requests. */
const ADO_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798';

let _instance: AdoConnectionFactory | null = null;

export class AdoConnectionFactory {
    private constructor() {}

    static getInstance(): AdoConnectionFactory {
        if (!_instance) {
            _instance = new AdoConnectionFactory();
        }
        return _instance;
    }

    static resetInstance(): void {
        _instance = null;
    }

    async connect(options?: AdoClientOptions): Promise<AdoConnectionResult> {
        const logger = getLogger();

        const orgUrl = options?.orgUrl ?? process.env[ENV_ORG_URL];
        if (!orgUrl) {
            const msg = `${ENV_ORG_URL} is not set`;
            logger.warn(LogCategory.ADO, msg);
            return { connected: false, error: msg };
        }

        const dataDir = options?.dataDir;
        const cache = await this.resolveTokenCache(dataDir);
        if (!cache.success) {
            logger.warn(LogCategory.ADO, cache.error);
            return { connected: false, error: cache.error };
        }

        const authHandler = azdev.getBearerHandler(cache.token);
        logger.debug(LogCategory.ADO, 'Using Azure CLI bearer token for authentication');

        try {
            const connection = new azdev.WebApi(orgUrl, authHandler);
            logger.debug(LogCategory.ADO, `Connected to Azure DevOps at ${orgUrl}`);
            return { connected: true, connection, account: cache.account };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `Failed to create Azure DevOps connection: ${msg}`);
            return { connected: false, error: msg };
        }
    }

    /**
     * Resolve a valid bearer token, using the on-disk cache when possible
     * and falling back to `az account get-access-token` otherwise.
     */
    private async resolveTokenCache(dataDir?: string): Promise<
        { success: true; token: string; account: AdoSessionCache['account'] } |
        { success: false; error: string }
    > {
        const logger = getLogger();

        const cached = await readAdoSessionCache(dataDir);
        if (cached && isTokenValid(cached)) {
            logger.debug(LogCategory.ADO, 'Using cached ADO bearer token');
            return { success: true, token: cached.token, account: cached.account };
        }

        return this.fetchAndCacheToken(dataDir);
    }

    /** Call az CLI to get a fresh token + account info and persist to cache. */
    private async fetchAndCacheToken(dataDir?: string): Promise<
        { success: true; token: string; account: AdoSessionCache['account'] } |
        { success: false; error: string }
    > {
        const logger = getLogger();

        try {
            // Fetch token + expiry in one call.
            const { stdout: tokenJson } = await execAsync(
                `az account get-access-token --resource ${ADO_RESOURCE_ID} --query "{token:accessToken,expiresOn:expiresOn}" -o json`,
            );
            const tokenData = JSON.parse(tokenJson.trim()) as {
                token: string;
                expiresOn: string;
            };
            if (!tokenData.token) {
                return { success: false, error: 'Azure CLI returned an empty token' };
            }
            const expiresAt = new Date(tokenData.expiresOn).getTime();

            // Fetch account info (best-effort).
            let account: AdoSessionCache['account'] = null;
            try {
                const { stdout: accountJson } = await execAsync(
                    `az account show --query "{upn:user.name,displayName:user.name}" -o json`,
                );
                const accountData = JSON.parse(accountJson.trim()) as {
                    upn: string;
                    displayName: string;
                };
                account = { upn: accountData.upn, displayName: accountData.displayName, adoId: null };
            } catch (accountErr) {
                const msg = accountErr instanceof Error ? accountErr.message : String(accountErr);
                logger.warn(LogCategory.ADO, `Failed to fetch account info from Azure CLI: ${msg}`);
            }

            const newCache: AdoSessionCache = { token: tokenData.token, expiresAt, account };
            try {
                await writeAdoSessionCache(newCache, dataDir);
            } catch (writeErr) {
                const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
                logger.warn(LogCategory.ADO, `Failed to write ADO session cache: ${msg}`);
            }

            return { success: true, token: tokenData.token, account };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                error: `Failed to get token from Azure CLI: ${msg}. Run 'az login' to authenticate.`,
            };
        }
    }
}

export function getAdoConnectionFactory(): AdoConnectionFactory {
    return AdoConnectionFactory.getInstance();
}

export function resetAdoConnectionFactory(): void {
    AdoConnectionFactory.resetInstance();
}

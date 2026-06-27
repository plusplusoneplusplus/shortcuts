import * as azdev from 'azure-devops-node-api';
import { getLogger, LogCategory } from '../logger';
import type { AdoClientOptions, AdoConnectionResult } from './types';
import { resolveAdoAccessToken } from './ado-token-resolver';

const ENV_ORG_URL = 'AZURE_DEVOPS_ORG_URL';

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
        const resolved = await resolveAdoAccessToken({ dataDir });
        if (!resolved) {
            const error = `Failed to get token from Azure CLI. Run 'az login' to authenticate.`;
            logger.warn(LogCategory.ADO, error);
            return { connected: false, error };
        }

        const authHandler = azdev.getBearerHandler(resolved.token);
        logger.info(LogCategory.ADO, 'Using Azure CLI bearer token for authentication');

        try {
            const connection = new azdev.WebApi(orgUrl, authHandler);
            logger.info(LogCategory.ADO, `Connected to Azure DevOps at ${orgUrl}`);
            return { connected: true, connection, account: resolved.account };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `Failed to create Azure DevOps connection: ${msg}`);
            return { connected: false, error: msg };
        }
    }
}

export function getAdoConnectionFactory(): AdoConnectionFactory {
    return AdoConnectionFactory.getInstance();
}

export function resetAdoConnectionFactory(): void {
    AdoConnectionFactory.resetInstance();
}

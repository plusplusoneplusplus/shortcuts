import * as azdev from 'azure-devops-node-api';
import { getLogger, LogCategory } from '../logger';
import { execAsync } from '../utils/exec-utils';
import type { AdoClientOptions, AdoConnectionResult } from './types';

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

        const azResult = await this.getTokenFromAzCli();
        if (!azResult.success) {
            logger.warn(LogCategory.ADO, azResult.error);
            return { connected: false, error: azResult.error };
        }
        const authHandler = azdev.getBearerHandler(azResult.token);
        logger.debug(LogCategory.ADO, 'Using Azure CLI bearer token for authentication');

        try {
            const connection = new azdev.WebApi(orgUrl, authHandler);
            logger.debug(LogCategory.ADO, `Connected to Azure DevOps at ${orgUrl}`);
            return { connected: true, connection };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(LogCategory.ADO, `Failed to create Azure DevOps connection: ${msg}`);
            return { connected: false, error: msg };
        }
    }

    /** Attempt to acquire a bearer token via the Azure CLI (`az account get-access-token`). */
    private async getTokenFromAzCli(): Promise<
        { success: true; token: string } | { success: false; error: string }
    > {
        try {
            const { stdout } = await execAsync(
                `az account get-access-token --resource ${ADO_RESOURCE_ID} --query accessToken -o tsv`,
            );
            const token = stdout.trim();
            if (!token) {
                return { success: false, error: 'Azure CLI returned an empty token' };
            }
            return { success: true, token };
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

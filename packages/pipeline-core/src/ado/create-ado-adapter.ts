import * as azdev from 'azure-devops-node-api';
import type { IPullRequestsService } from '../providers/interfaces';
import { AdoPullRequestsService } from './pull-requests-service';
import { AdoPullRequestsAdapter } from './ado-pull-requests-adapter';

/**
 * Create an AdoPullRequestsAdapter from token and org config.
 * Always uses a bearer auth handler (Azure CLI-issued access token).
 * Encapsulates WebApi and AdoPullRequestsService creation.
 */
export function createAdoPullRequestsAdapter(params: {
    orgUrl: string;
    token: string;
    project?: string;
}): IPullRequestsService {
    const authHandler = azdev.getBearerHandler(params.token);
    const connection = new azdev.WebApi(params.orgUrl, authHandler);
    const service = new AdoPullRequestsService(connection);
    return new AdoPullRequestsAdapter(service, params.project);
}

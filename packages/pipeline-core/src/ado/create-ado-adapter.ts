import * as azdev from 'azure-devops-node-api';
import type { IPullRequestsService } from '../providers/interfaces';
import { AdoPullRequestsService } from './pull-requests-service';
import { AdoPullRequestsAdapter } from './ado-pull-requests-adapter';

/**
 * Create an AdoPullRequestsAdapter from token and org config.
 * Uses a PAT token directly (no Azure CLI fallback) so instantiation is synchronous.
 * Encapsulates WebApi and AdoPullRequestsService creation.
 */
export function createAdoPullRequestsAdapter(params: {
    orgUrl: string;
    token: string;
    project?: string;
}): IPullRequestsService {
    const authHandler = azdev.getPersonalAccessTokenHandler(params.token);
    const connection = new azdev.WebApi(params.orgUrl, authHandler);
    const service = new AdoPullRequestsService(connection);
    return new AdoPullRequestsAdapter(service, params.project);
}

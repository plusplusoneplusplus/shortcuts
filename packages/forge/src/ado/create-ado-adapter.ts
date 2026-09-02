import * as azdev from 'azure-devops-node-api';
import type { IPullRequestsService } from '../providers/interfaces';
import { AdoPullRequestsService } from './pull-requests-service';
import { AdoPullRequestsAdapter } from './ado-pull-requests-adapter';

/**
 * Always uses a bearer auth handler (Azure CLI-issued access token).
 */
export function createAdoPullRequestsAdapter(params: {
    orgUrl: string;
    token: string;
    project?: string;
    repo?: string;
    currentUserId?: string;
}): IPullRequestsService {
    const authHandler = azdev.getBearerHandler(params.token);
    const connection = new azdev.WebApi(params.orgUrl, authHandler);
    const service = new AdoPullRequestsService(connection);
    return new AdoPullRequestsAdapter(service, params.project, params.repo, params.currentUserId);
}

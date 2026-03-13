import { Octokit } from '@octokit/rest';
import type { IPullRequestsService } from '../providers/interfaces';
import { GitHubPullRequestsAdapter } from './github-pull-requests-adapter';

/**
 * Create a GitHubPullRequestsAdapter from a token and owner/repo coordinates.
 * Encapsulates Octokit instantiation so callers don't need to depend on @octokit/rest.
 */
export function createGitHubPullRequestsAdapter(params: {
    token: string;
    owner: string;
    repo: string;
}): IPullRequestsService {
    const octokit = new Octokit({ auth: params.token });
    return new GitHubPullRequestsAdapter(octokit, { owner: params.owner, repo: params.repo });
}

import { describe, expect, it } from 'vitest';
import {
    createGitHubWorkItemSyncProviderAdapter,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueCreateInput,
    type GitHubWorkItemIssueListFilters,
    type GitHubWorkItemIssueTransport,
    type GitHubWorkItemIssueUpdateInput,
} from '../../../src/server/work-items/work-item-sync-github-provider';
import type { WorkItemSyncParentReference } from '../../../src/server/work-items/types';

const WORKSPACE_ID = 'github-sync-repo';

const REPO = {
    available: true as const,
    provider: 'github' as const,
    owner: 'octo-org',
    repo: 'octo-repo',
    url: 'https://github.com/octo-org/octo-repo',
    source: 'origin' as const,
};

class FakeGitHubTransport implements GitHubWorkItemIssueTransport {
    repositoriesChecked = 0;
    failRepository = false;

    async getRepository(): Promise<void> {
        this.repositoriesChecked++;
        if (this.failRepository) throw new Error('auth unavailable');
    }

    async listIssues(_repo: typeof REPO, _filters: GitHubWorkItemIssueListFilters = {}): Promise<GitHubWorkItemIssue[]> {
        return [];
    }

    async getIssue(_repo: typeof REPO, _issueNumber: number): Promise<GitHubWorkItemIssue | undefined> {
        return undefined;
    }

    async createIssue(_repo: typeof REPO, input: GitHubWorkItemIssueCreateInput): Promise<GitHubWorkItemIssue> {
        return {
            id: 'I_created',
            number: 1,
            title: input.title,
            state: 'open',
            htmlUrl: 'https://github.com/octo-org/octo-repo/issues/1',
            labels: input.labels,
            body: input.body,
        };
    }

    async updateIssue(
        _repo: typeof REPO,
        issueNumber: number,
        input: GitHubWorkItemIssueUpdateInput,
    ): Promise<GitHubWorkItemIssue> {
        return {
            id: `I_${issueNumber}`,
            number: issueNumber,
            title: input.title,
            state: input.state,
            htmlUrl: `https://github.com/octo-org/octo-repo/issues/${issueNumber}`,
            labels: input.labels,
            body: input.body,
        };
    }

    async setIssueParent(_repo: typeof REPO, _issueNumber: number, _parent: WorkItemSyncParentReference): Promise<void> {}
}

function makeContext() {
    return {
        workspaceId: WORKSPACE_ID,
        workspace: {
            id: WORKSPACE_ID,
            name: 'GitHub Sync',
            rootPath: undefined,
            remoteUrl: 'https://github.com/octo-org/octo-repo.git',
        },
        preferences: {},
    };
}

describe('GitHub work item sync provider status adapter', () => {
    it('reports available status from workspace origin using external auth only', async () => {
        const transport = new FakeGitHubTransport();
        const provider = createGitHubWorkItemSyncProviderAdapter({ transport });

        const status = await provider.getStatus(makeContext());

        expect(status).toMatchObject({
            provider: 'github',
            available: true,
            repository: {
                owner: 'octo-org',
                repo: 'octo-repo',
                source: 'workspaceRemote',
            },
            auth: {
                mode: 'external',
                authenticated: true,
            },
        });
        expect(transport.repositoriesChecked).toBe(1);
        expect(JSON.stringify(status)).not.toMatch(/token|secret|password|credential/i);
    });

    it('does not call the GitHub transport when repo detection fails', async () => {
        const transport = new FakeGitHubTransport();
        const provider = createGitHubWorkItemSyncProviderAdapter({ transport });

        const status = await provider.getStatus({
            ...makeContext(),
            workspace: { id: WORKSPACE_ID, name: 'No Remote', rootPath: undefined, remoteUrl: undefined },
        });

        expect(status.available).toBe(false);
        expect(status.reason).toBe('missing-workspace');
        expect(transport.repositoriesChecked).toBe(0);
    });

    it('reports auth unavailable without exposing credential details', async () => {
        const transport = new FakeGitHubTransport();
        transport.failRepository = true;
        const provider = createGitHubWorkItemSyncProviderAdapter({ transport });

        const status = await provider.getStatus(makeContext());

        expect(status).toMatchObject({
            provider: 'github',
            available: false,
            reason: 'auth-unavailable',
            repository: {
                owner: 'octo-org',
                repo: 'octo-repo',
            },
            auth: {
                mode: 'external',
                authenticated: false,
            },
        });
        expect(transport.repositoriesChecked).toBe(1);
        expect(JSON.stringify(status)).not.toMatch(/ghp_|github_pat_|x-oauth-basic/i);
    });
});

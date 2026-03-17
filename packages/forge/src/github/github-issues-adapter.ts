import type { Octokit } from '@octokit/rest';
import type { IWorkItemsService } from '../providers/interfaces';
import type {
    Comment,
    CreateWorkItemInput,
    Identity,
    UpdateWorkItemInput,
    WorkItem,
} from '../providers/types';
import type { GitHubComment, GitHubIssue, GitHubUser } from './types';

// ── mapping helpers ──────────────────────────────────────────

function mapGitHubUser(user: GitHubUser | null | undefined): Identity {
    return {
        id: String(user?.id ?? ''),
        displayName: user?.name ?? user?.login ?? '',
        email: user?.email ?? undefined,
        avatarUrl: user?.avatar_url,
    };
}

function mapGitHubIssue(issue: GitHubIssue, owner: string, repo: string): WorkItem {
    return {
        id: issue.id,
        title: issue.title,
        type: 'Issue',
        state: issue.state,
        assignees: (issue.assignees ?? []).map(mapGitHubUser),
        author: mapGitHubUser(issue.user),
        description: issue.body ?? '',
        labels: issue.labels.map(l => l.name),
        createdAt: new Date(issue.created_at),
        updatedAt: new Date(issue.updated_at),
        closedAt: issue.closed_at ? new Date(issue.closed_at) : undefined,
        url: issue.html_url,
        repositoryId: `${owner}/${repo}`,
        raw: issue,
    };
}

function mapGitHubComment(c: GitHubComment): Comment {
    return {
        id: c.id,
        author: mapGitHubUser(c.user),
        body: c.body,
        createdAt: new Date(c.created_at),
        updatedAt: new Date(c.updated_at),
        url: c.html_url,
    };
}

// ── adapter ──────────────────────────────────────────────────

/**
 * Skeleton GitHub adapter implementing `IWorkItemsService` by
 * treating GitHub Issues as work items via the GitHub REST API.
 */
export class GitHubIssuesAdapter implements IWorkItemsService {
    private readonly owner: string;
    private readonly repo: string;

    constructor(
        private readonly octokit: Octokit,
        ownerRepo: { owner: string; repo: string },
    ) {
        this.owner = ownerRepo.owner;
        this.repo = ownerRepo.repo;
    }

    async getWorkItem(id: number | string, _projectId?: string): Promise<WorkItem> {
        const { data } = await this.octokit.issues.get({
            owner: this.owner,
            repo: this.repo,
            issue_number: Number(id),
        });

        return mapGitHubIssue(data as unknown as GitHubIssue, this.owner, this.repo);
    }

    async getWorkItems(ids: Array<number | string>, _projectId?: string): Promise<WorkItem[]> {
        const items = await Promise.all(ids.map(id => this.getWorkItem(id)));
        return items;
    }

    async createWorkItem(_projectId: string, _type: string, input: CreateWorkItemInput): Promise<WorkItem> {
        const { data } = await this.octokit.issues.create({
            owner: this.owner,
            repo: this.repo,
            title: input.title,
            body: input.description,
            assignees: (input.assigneeIds ?? []) as string[],
            labels: (input.labels ?? []) as string[],
        });

        return mapGitHubIssue(data as unknown as GitHubIssue, this.owner, this.repo);
    }

    async updateWorkItem(
        id: number | string,
        update: UpdateWorkItemInput,
        _projectId?: string,
    ): Promise<WorkItem> {
        const state = update.state === 'closed' ? 'closed'
            : update.state === 'open' ? 'open'
            : undefined;

        const { data } = await this.octokit.issues.update({
            owner: this.owner,
            repo: this.repo,
            issue_number: Number(id),
            title: update.title,
            body: update.description,
            state,
            assignees: (update.assigneeIds ?? []) as string[],
            labels: (update.labels ?? []) as string[],
        });

        return mapGitHubIssue(data as unknown as GitHubIssue, this.owner, this.repo);
    }

    async searchWorkItems(query: string, _projectId?: string, top?: number): Promise<WorkItem[]> {
        const { data } = await this.octokit.search.issuesAndPullRequests({
            q: `${query} repo:${this.owner}/${this.repo} is:issue`,
            per_page: top ?? 30,
        });

        return (data.items as unknown as GitHubIssue[]).map(issue =>
            mapGitHubIssue(issue, this.owner, this.repo),
        );
    }

    async getComments(workItemId: number | string, _projectId?: string): Promise<Comment[]> {
        const { data } = await this.octokit.issues.listComments({
            owner: this.owner,
            repo: this.repo,
            issue_number: Number(workItemId),
        });

        return (data as unknown as GitHubComment[]).map(mapGitHubComment);
    }

    async addComment(workItemId: number | string, body: string, _projectId?: string): Promise<Comment> {
        const { data } = await this.octokit.issues.createComment({
            owner: this.owner,
            repo: this.repo,
            issue_number: Number(workItemId),
            body,
        });

        return mapGitHubComment(data as unknown as GitHubComment);
    }
}

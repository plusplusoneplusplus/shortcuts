import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { readRepoPreferences } from '../preferences-handler';
import {
    resolveGitHubWorkItemSyncRepo,
    type GitHubWorkItemSyncRepo,
} from './work-item-sync-github-repo';
import {
    GhCliGitHubWorkItemIssueTransport,
    deleteGitHubEpicMirrorTree,
    importGitHubEpicTreeAsWorkItems,
    type AvailableGitHubWorkItemSyncRepo,
    type GitHubSyncWarning,
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueTransport,
    type ImportGitHubEpicTreeResult,
} from './work-item-sync-github-provider';
import { parseGitHubWorkItemIssue } from './work-item-sync-github-issue';
import type { WorkItem, WorkItemIndexEntry, WorkItemStore } from './types';
import { WORK_ITEM_SYNC_MAX_ITEMS } from './work-item-sync-provider';
import { clearWorkItemResponseCacheForResolvedWorkspace } from './work-item-response-cache';
import { WorkspacePullPollScheduler, type WorkspacePullPollTimerApi } from './workspace-pull-poll-scheduler';

export const DEFAULT_WORK_ITEM_GITHUB_PULL_INTERVAL_MINUTES = 5;

export type WorkItemGitHubPullPollerTimerApi = WorkspacePullPollTimerApi;

export interface WorkItemGitHubPullPollerOptions {
    dataDir: string;
    processStore: ProcessStore;
    workItemStore: WorkItemStore;
    transport?: GitHubWorkItemIssueTransport;
    now?: () => string;
    timerApi?: WorkItemGitHubPullPollerTimerApi;
    logError?: (message: string) => void;
    getSyncEnabled?: () => boolean;
}

export interface WorkItemGitHubPullPollError {
    workItemId?: string;
    issueNumber?: number;
    message: string;
}

export interface WorkItemGitHubPullWorkspaceResult {
    workspaceId: string;
    rootsConsidered: number;
    rootsSynced: number;
    created: number;
    updated: number;
    deleted: number;
    deletedItemIds: string[];
    errors: WorkItemGitHubPullPollError[];
    /**
     * Conflicts where a locally-dirty/unpushed field was preserved over a
     * competing remote change. Surfaced so the divergence is observable in logs.
     */
    warnings: GitHubSyncWarning[];
    /** Number of remote candidate issues fetched for this poll (after the cap). */
    candidatesConsidered: number;
    /**
     * True when the candidate fetch reached {@link WORK_ITEM_SYNC_MAX_ITEMS} and
     * the remote issue list may have been truncated, so some descendants could be
     * missing from the mirror. Surfaced in the structured result and logged so the
     * truncation is observable rather than silent.
     */
    truncated: boolean;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function unavailableRepoMessage(repo: Exclude<GitHubWorkItemSyncRepo, AvailableGitHubWorkItemSyncRepo>): string {
    const reasonMessages: Record<typeof repo.reason, string> = {
        'incomplete-preference': 'GitHub sync owner/repo preference must include both owner and repo.',
        'missing-workspace': 'GitHub sync could not resolve the current workspace.',
        'missing-origin': 'GitHub sync could not find a git origin remote for this workspace.',
        'non-github-origin': 'GitHub sync requires a GitHub origin remote or workspace owner/repo override.',
    };
    return reasonMessages[repo.reason];
}

function isGitHubBackedEpicRoot(entry: WorkItemIndexEntry): boolean {
    return entry.type === 'epic'
        && !entry.parentId
        && entry.tracker?.kind === 'github-backed'
        && entry.tracker.provider === 'github';
}

function blankResult(workspaceId: string): WorkItemGitHubPullWorkspaceResult {
    return {
        workspaceId,
        rootsConsidered: 0,
        rootsSynced: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        deletedItemIds: [],
        errors: [],
        warnings: [],
        candidatesConsidered: 0,
        truncated: false,
    };
}

export class WorkItemGitHubPullPoller {
    private readonly transport: GitHubWorkItemIssueTransport;
    private readonly now?: () => string;
    private readonly logError: (message: string) => void;
    private readonly scheduler: WorkspacePullPollScheduler<WorkItemGitHubPullWorkspaceResult>;

    constructor(private readonly options: WorkItemGitHubPullPollerOptions) {
        this.transport = options.transport ?? new GhCliGitHubWorkItemIssueTransport();
        this.now = options.now;
        this.logError = options.logError ?? (message => process.stderr.write(`${message}\n`));
        this.scheduler = new WorkspacePullPollScheduler<WorkItemGitHubPullWorkspaceResult>(
            {
                logPrefix: 'work-items/github-poll',
                defaultIntervalMinutes: DEFAULT_WORK_ITEM_GITHUB_PULL_INTERVAL_MINUTES,
                listWorkspaceIds: async () =>
                    (await options.processStore.getWorkspaces()).map(workspace => workspace.id),
                isSyncEnabled: () => options.getSyncEnabled?.() !== false,
                getWorkspaceConfig: (workspaceId) => {
                    const githubPrefs = readRepoPreferences(options.dataDir, workspaceId).workItems?.sync?.github;
                    return {
                        pollingEnabled: githubPrefs?.pollingEnabled !== false,
                        pollIntervalMinutes: githubPrefs?.pollIntervalMinutes,
                    };
                },
                hasEligibleWork: async (workspaceId) =>
                    (await this.listGitHubBackedEpicRoots(workspaceId)).length > 0,
                poll: (workspaceId) => this.pollWorkspace(workspaceId),
                resultLogMessages: (result) => [
                    ...result.warnings.map(warning => warning.message),
                    ...result.errors.map(error => error.message),
                ],
            },
            { timerApi: options.timerApi, logError: this.logError },
        );
    }

    start(): Promise<void> {
        return this.scheduler.start();
    }

    dispose(): void {
        this.scheduler.dispose();
    }

    refreshWorkspaceTimers(): Promise<void> {
        return this.scheduler.refreshWorkspaceTimers();
    }

    configureWorkspace(workspaceId: string): Promise<void> {
        return this.scheduler.configureWorkspace(workspaceId);
    }

    async pollWorkspace(workspaceId: string): Promise<WorkItemGitHubPullWorkspaceResult> {
        const result = blankResult(workspaceId);
        if (this.options.getSyncEnabled?.() === false) return result;
        const roots = await this.listGitHubBackedEpicRoots(workspaceId);
        result.rootsConsidered = roots.length;
        if (roots.length === 0) return result;

        const workspace = await this.getWorkspace(workspaceId);
        const repo = await this.resolveRepo(workspaceId, workspace);
        const candidateIssues = await this.transport.listIssues(repo, { limit: WORK_ITEM_SYNC_MAX_ITEMS });
        result.candidatesConsidered = candidateIssues.length;
        // The transport caps the candidate list at WORK_ITEM_SYNC_MAX_ITEMS, so a
        // count at the cap means the remote list was (or may have been) truncated
        // and some descendants could be missing from this pull. Log it so the
        // truncation is observable instead of silently dropping issues.
        if (candidateIssues.length >= WORK_ITEM_SYNC_MAX_ITEMS) {
            result.truncated = true;
            this.logError(
                `[work-items/github-poll] ${workspaceId}: reached the ${WORK_ITEM_SYNC_MAX_ITEMS}-issue cap; `
                + 'the GitHub issue list may be truncated and some descendants could be missing from the mirror.',
            );
        }

        for (const rootEntry of roots) {
            const root = await this.options.workItemStore.getWorkItem(rootEntry.id, workspaceId);
            if (!root) continue;

            try {
                const syncResult = await this.syncRoot(workspaceId, repo, root, candidateIssues);
                result.rootsSynced++;
                result.created += syncResult.created;
                result.updated += syncResult.updated;
                result.deleted += syncResult.deleted;
                result.deletedItemIds.push(...syncResult.deletedItemIds);
                result.warnings.push(...syncResult.warnings);
            } catch (error) {
                result.errors.push({
                    workItemId: root.id,
                    issueNumber: root.tracker?.kind === 'github-backed'
                        ? root.tracker.github.issueNumber
                        : root.githubMirror?.issueNumber,
                    message: errorMessage(error),
                });
            }
        }

        if (result.created > 0 || result.updated > 0 || result.deleted > 0) {
            await clearWorkItemResponseCacheForResolvedWorkspace(this.options.workItemStore, workspaceId);
        }
        return result;
    }

    private async listGitHubBackedEpicRoots(workspaceId: string): Promise<WorkItemIndexEntry[]> {
        const list = await this.options.workItemStore.listWorkItems({
            repoId: workspaceId,
            type: 'epic',
            tracker: 'github-backed',
        });
        return list.items.filter(isGitHubBackedEpicRoot);
    }

    private async getWorkspace(workspaceId: string): Promise<WorkspaceInfo | undefined> {
        const workspaces = await this.options.processStore.getWorkspaces();
        return workspaces.find(workspace => workspace.id === workspaceId);
    }

    private async resolveRepo(workspaceId: string, workspace: WorkspaceInfo | undefined): Promise<AvailableGitHubWorkItemSyncRepo> {
        const repo = await resolveGitHubWorkItemSyncRepo({
            workspace,
            preferences: readRepoPreferences(this.options.dataDir, workspaceId),
        });
        if (!repo.available) {
            throw new Error(unavailableRepoMessage(repo));
        }
        return repo;
    }

    private async syncRoot(
        workspaceId: string,
        repo: AvailableGitHubWorkItemSyncRepo,
        root: WorkItem,
        candidateIssues: readonly GitHubWorkItemIssue[],
    ): Promise<ImportGitHubEpicTreeResult> {
        if (root.type !== 'epic' || root.parentId) {
            throw new Error(`Work item '${root.id}' is not a root Epic.`);
        }
        if (root.tracker?.kind !== 'github-backed' || root.tracker.provider !== 'github') {
            throw new Error(`Work item '${root.id}' is not a GitHub-backed Epic root.`);
        }

        const issueNumber = root.tracker.github.issueNumber ?? root.githubMirror?.issueNumber;
        if (issueNumber === undefined) {
            throw new Error(`GitHub-backed Epic root '${root.id}' is missing a GitHub issue number.`);
        }

        const issue = await this.transport.getIssue(repo, issueNumber);
        if (!issue) {
            const deleteResult = await deleteGitHubEpicMirrorTree(
                { workspaceId, workItemStore: this.options.workItemStore },
                root.id,
            );
            return {
                root,
                items: [],
                created: 0,
                updated: 0,
                warnings: [],
                ...deleteResult,
            };
        }

        const rootType = parseGitHubWorkItemIssue(issue).type ?? 'epic';
        if (rootType !== 'epic') {
            throw new Error('A GitHub-backed tree must sync from a GitHub issue marked as coc:type:epic or with no CoC type metadata.');
        }

        return importGitHubEpicTreeAsWorkItems(
            { workspaceId, workItemStore: this.options.workItemStore },
            repo,
            issue,
            candidateIssues,
            this.now,
            { pruneMissing: true, skipClosedWithoutLocal: true },
        );
    }
}

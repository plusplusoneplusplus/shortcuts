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
    type GitHubWorkItemIssue,
    type GitHubWorkItemIssueTransport,
    type ImportGitHubEpicTreeResult,
} from './work-item-sync-github-provider';
import { parseGitHubWorkItemIssue } from './work-item-sync-github-issue';
import type { WorkItem, WorkItemIndexEntry, WorkItemStore } from './types';
import { WORK_ITEM_SYNC_MAX_ITEMS } from './work-item-sync-provider';
import { clearWorkItemResponseCacheForWorkspace } from './work-item-response-cache';

export const DEFAULT_WORK_ITEM_GITHUB_PULL_INTERVAL_MINUTES = 5;

export interface WorkItemGitHubPullPollerTimerApi {
    setInterval(handler: () => void | Promise<void>, ms: number): unknown;
    clearInterval(timer: unknown): void;
}

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
}

interface WorkspaceTimer {
    timer: unknown;
    intervalMs: number;
}

const defaultTimerApi: WorkItemGitHubPullPollerTimerApi = {
    setInterval: (handler, ms) => setInterval(() => { void handler(); }, ms),
    clearInterval: timer => clearInterval(timer as ReturnType<typeof setInterval>),
};

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

function intervalMsFromMinutes(value: number | undefined): number {
    const minutes = Number.isFinite(value) && value! >= 1
        ? value!
        : DEFAULT_WORK_ITEM_GITHUB_PULL_INTERVAL_MINUTES;
    return minutes * 60 * 1000;
}

function maybeUnref(timer: unknown): void {
    if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
    }
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
    };
}

export class WorkItemGitHubPullPoller {
    private readonly transport: GitHubWorkItemIssueTransport;
    private readonly now?: () => string;
    private readonly timerApi: WorkItemGitHubPullPollerTimerApi;
    private readonly logError: (message: string) => void;
    private readonly timers = new Map<string, WorkspaceTimer>();
    private started = false;

    constructor(private readonly options: WorkItemGitHubPullPollerOptions) {
        this.transport = options.transport ?? new GhCliGitHubWorkItemIssueTransport();
        this.now = options.now;
        this.timerApi = options.timerApi ?? defaultTimerApi;
        this.logError = options.logError ?? (message => process.stderr.write(`${message}\n`));
    }

    async start(): Promise<void> {
        if (this.started) return;
        this.started = true;
        await this.refreshWorkspaceTimers();
    }

    dispose(): void {
        for (const workspaceId of this.timers.keys()) {
            this.clearWorkspaceTimer(workspaceId);
        }
        this.started = false;
    }

    async refreshWorkspaceTimers(): Promise<void> {
        const workspaces = await this.options.processStore.getWorkspaces();
        const activeWorkspaceIds = new Set<string>();
        for (const workspace of workspaces) {
            activeWorkspaceIds.add(workspace.id);
            await this.configureWorkspace(workspace.id);
        }
        for (const workspaceId of [...this.timers.keys()]) {
            if (!activeWorkspaceIds.has(workspaceId)) {
                this.clearWorkspaceTimer(workspaceId);
            }
        }
    }

    async configureWorkspace(workspaceId: string): Promise<void> {
        if (this.options.getSyncEnabled?.() === false) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }
        const prefs = readRepoPreferences(this.options.dataDir, workspaceId);
        const githubPrefs = prefs.workItems?.sync?.github;
        if (githubPrefs?.pollingEnabled === false) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }

        const roots = await this.listGitHubBackedEpicRoots(workspaceId);
        if (roots.length === 0) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }

        const intervalMs = intervalMsFromMinutes(githubPrefs?.pollIntervalMinutes);
        const existing = this.timers.get(workspaceId);
        if (existing?.intervalMs === intervalMs) return;

        this.clearWorkspaceTimer(workspaceId);
        const timer = this.timerApi.setInterval(() => this.pollWorkspaceSafely(workspaceId), intervalMs);
        maybeUnref(timer);
        this.timers.set(workspaceId, { timer, intervalMs });
    }

    async pollWorkspace(workspaceId: string): Promise<WorkItemGitHubPullWorkspaceResult> {
        const result = blankResult(workspaceId);
        if (this.options.getSyncEnabled?.() === false) return result;
        const roots = await this.listGitHubBackedEpicRoots(workspaceId);
        result.rootsConsidered = roots.length;
        if (roots.length === 0) return result;

        const workspace = await this.getWorkspace(workspaceId);
        const repo = this.resolveRepo(workspaceId, workspace);
        const candidateIssues = await this.transport.listIssues(repo, { limit: WORK_ITEM_SYNC_MAX_ITEMS });

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
            clearWorkItemResponseCacheForWorkspace(workspaceId);
        }
        return result;
    }

    private async pollWorkspaceSafely(workspaceId: string): Promise<void> {
        try {
            const result = await this.pollWorkspace(workspaceId);
            for (const error of result.errors) {
                this.logError(`[work-items/github-poll] ${workspaceId}: ${error.message}`);
            }
        } catch (error) {
            this.logError(`[work-items/github-poll] ${workspaceId}: ${errorMessage(error)}`);
        }
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

    private resolveRepo(workspaceId: string, workspace: WorkspaceInfo | undefined): AvailableGitHubWorkItemSyncRepo {
        const repo = resolveGitHubWorkItemSyncRepo({
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
            { pruneMissing: true },
        );
    }

    private clearWorkspaceTimer(workspaceId: string): void {
        const existing = this.timers.get(workspaceId);
        if (!existing) return;
        this.timerApi.clearInterval(existing.timer);
        this.timers.delete(workspaceId);
    }
}

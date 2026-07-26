import type { ProcessStore, WorkspaceInfo } from '@plusplusoneplusplus/forge';
import { readRepoPreferences } from '../preferences-handler';
import {
    AzureBoardsRestWorkItemTransport,
    azureBoardsProjectFromStatus,
    azureBoardsRemoteWorkItemIdForLocalItem,
    createAzureBoardsWorkItemSyncProviderAdapter,
    deleteAzureBoardsEpicMirrorTree,
    importAzureBoardsEpicTreeAsWorkItems,
    type AvailableAzureBoardsWorkItemSyncProject,
    type AzureBoardsSyncWarning,
    type AzureBoardsWorkItemTransport,
    type ImportAzureBoardsEpicTreeResult,
} from './work-item-sync-azure-boards-provider';
import type { WorkItem, WorkItemIndexEntry, WorkItemStore } from './types';
import {
    type WorkItemSyncProviderAdapter,
    type WorkItemSyncProviderContext,
    WORK_ITEM_SYNC_MAX_ITEMS,
} from './work-item-sync-provider';
import { clearWorkItemResponseCacheForResolvedWorkspace } from './work-item-response-cache';
import { WorkspacePullPollScheduler, type WorkspacePullPollTimerApi } from './workspace-pull-poll-scheduler';

export const DEFAULT_WORK_ITEM_AZURE_BOARDS_PULL_INTERVAL_MINUTES = 5;

export type WorkItemAzureBoardsPullPollerTimerApi = WorkspacePullPollTimerApi;

export interface WorkItemAzureBoardsPullPollerOptions {
    dataDir: string;
    processStore: ProcessStore;
    workItemStore: WorkItemStore;
    provider?: WorkItemSyncProviderAdapter;
    transport?: AzureBoardsWorkItemTransport;
    now?: () => string;
    timerApi?: WorkItemAzureBoardsPullPollerTimerApi;
    logError?: (message: string) => void;
    getSyncEnabled?: () => boolean;
}

export interface WorkItemAzureBoardsPullPollError {
    workItemId?: string;
    remoteWorkItemId?: number;
    message: string;
}

export interface WorkItemAzureBoardsPullWorkspaceResult {
    workspaceId: string;
    rootsConsidered: number;
    rootsSynced: number;
    created: number;
    updated: number;
    deleted: number;
    deletedItemIds: string[];
    warnings: AzureBoardsSyncWarning[];
    errors: WorkItemAzureBoardsPullPollError[];
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isAzureBoardsBackedEpicRoot(entry: WorkItemIndexEntry): boolean {
    return entry.type === 'epic'
        && !entry.parentId
        && entry.tracker?.kind === 'azure-boards-backed'
        && entry.tracker.provider === 'azure-boards';
}

function blankResult(workspaceId: string): WorkItemAzureBoardsPullWorkspaceResult {
    return {
        workspaceId,
        rootsConsidered: 0,
        rootsSynced: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        deletedItemIds: [],
        warnings: [],
        errors: [],
    };
}

export class WorkItemAzureBoardsPullPoller {
    private readonly provider: WorkItemSyncProviderAdapter;
    private readonly transport: AzureBoardsWorkItemTransport;
    private readonly now?: () => string;
    private readonly logError: (message: string) => void;
    private readonly scheduler: WorkspacePullPollScheduler<WorkItemAzureBoardsPullWorkspaceResult>;

    constructor(private readonly options: WorkItemAzureBoardsPullPollerOptions) {
        this.provider = options.provider ?? createAzureBoardsWorkItemSyncProviderAdapter({ dataDir: options.dataDir });
        this.transport = options.transport ?? new AzureBoardsRestWorkItemTransport();
        this.now = options.now;
        this.logError = options.logError ?? (message => process.stderr.write(`${message}\n`));
        this.scheduler = new WorkspacePullPollScheduler<WorkItemAzureBoardsPullWorkspaceResult>(
            {
                logPrefix: 'work-items/azure-boards-poll',
                defaultIntervalMinutes: DEFAULT_WORK_ITEM_AZURE_BOARDS_PULL_INTERVAL_MINUTES,
                listWorkspaceIds: async () =>
                    (await options.processStore.getWorkspaces()).map(workspace => workspace.id),
                isSyncEnabled: () => options.getSyncEnabled?.() !== false,
                getWorkspaceConfig: (workspaceId) => {
                    const azureBoardsPrefs = readRepoPreferences(options.dataDir, workspaceId)
                        .workItems?.sync?.azureBoards;
                    return {
                        pollingEnabled: azureBoardsPrefs?.pollingEnabled !== false,
                        pollIntervalMinutes: azureBoardsPrefs?.pollIntervalMinutes,
                    };
                },
                hasEligibleWork: async (workspaceId) =>
                    (await this.listAzureBoardsBackedEpicRoots(workspaceId)).length > 0,
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

    async pollWorkspace(workspaceId: string): Promise<WorkItemAzureBoardsPullWorkspaceResult> {
        const result = blankResult(workspaceId);
        if (this.options.getSyncEnabled?.() === false) return result;
        const roots = await this.listAzureBoardsBackedEpicRoots(workspaceId);
        result.rootsConsidered = roots.length;
        if (roots.length === 0) return result;

        const workspace = await this.getWorkspace(workspaceId);
        const project = await this.resolveProject(workspaceId, workspace);

        for (const rootEntry of roots) {
            const root = await this.options.workItemStore.getWorkItem(rootEntry.id, workspaceId);
            if (!root) continue;

            try {
                const syncResult = await this.syncRoot(workspaceId, project, root);
                result.rootsSynced++;
                result.created += syncResult.created;
                result.updated += syncResult.updated;
                result.deleted += syncResult.deleted;
                result.deletedItemIds.push(...syncResult.deletedItemIds);
                result.warnings.push(...syncResult.warnings);
            } catch (error) {
                result.errors.push({
                    workItemId: root.id,
                    remoteWorkItemId: azureBoardsRemoteWorkItemIdForLocalItem(root),
                    message: errorMessage(error),
                });
            }
        }

        if (result.created > 0 || result.updated > 0 || result.deleted > 0) {
            await clearWorkItemResponseCacheForResolvedWorkspace(this.options.workItemStore, workspaceId);
        }
        return result;
    }

    private async listAzureBoardsBackedEpicRoots(workspaceId: string): Promise<WorkItemIndexEntry[]> {
        const list = await this.options.workItemStore.listWorkItems({
            repoId: workspaceId,
            type: 'epic',
            tracker: 'azure-boards-backed',
        });
        return list.items.filter(isAzureBoardsBackedEpicRoot);
    }

    private async getWorkspace(workspaceId: string): Promise<WorkspaceInfo | undefined> {
        const workspaces = await this.options.processStore.getWorkspaces();
        return workspaces.find(workspace => workspace.id === workspaceId);
    }

    private async resolveProject(
        workspaceId: string,
        workspace: WorkspaceInfo | undefined,
    ): Promise<AvailableAzureBoardsWorkItemSyncProject> {
        const context: WorkItemSyncProviderContext = {
            workspaceId,
            workspace,
            preferences: readRepoPreferences(this.options.dataDir, workspaceId),
        };
        const status = await this.provider.getStatus(context);
        const project = azureBoardsProjectFromStatus(status);
        if (!status.available || !project) {
            throw new Error(status.message ?? 'Azure Boards sync provider is unavailable.');
        }
        return project;
    }

    private async syncRoot(
        workspaceId: string,
        project: AvailableAzureBoardsWorkItemSyncProject,
        root: WorkItem,
    ): Promise<ImportAzureBoardsEpicTreeResult> {
        if (root.type !== 'epic' || root.parentId) {
            throw new Error(`Work item '${root.id}' is not a root Epic.`);
        }
        if (root.tracker?.kind !== 'azure-boards-backed' || root.tracker.provider !== 'azure-boards') {
            throw new Error(`Work item '${root.id}' is not an Azure Boards-backed Epic root.`);
        }

        const workItemId = azureBoardsRemoteWorkItemIdForLocalItem(root);
        if (workItemId === undefined) {
            throw new Error(`Azure Boards-backed Epic root '${root.id}' is missing an Azure Boards work item ID.`);
        }

        const tree = await this.transport.listWorkItemTree(project, workItemId, WORK_ITEM_SYNC_MAX_ITEMS);
        const rootWorkItem = tree.find(item => item.id === workItemId);
        if (!rootWorkItem) {
            const deleteResult = await deleteAzureBoardsEpicMirrorTree(
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

        return importAzureBoardsEpicTreeAsWorkItems(
            { workspaceId, workItemStore: this.options.workItemStore },
            rootWorkItem,
            tree,
            this.now,
            { pruneMissing: true },
        );
    }
}

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

export const DEFAULT_WORK_ITEM_AZURE_BOARDS_PULL_INTERVAL_MINUTES = 5;

export interface WorkItemAzureBoardsPullPollerTimerApi {
    setInterval(handler: () => void | Promise<void>, ms: number): unknown;
    clearInterval(timer: unknown): void;
}

export interface WorkItemAzureBoardsPullPollerOptions {
    dataDir: string;
    processStore: ProcessStore;
    workItemStore: WorkItemStore;
    provider?: WorkItemSyncProviderAdapter;
    transport?: AzureBoardsWorkItemTransport;
    now?: () => string;
    timerApi?: WorkItemAzureBoardsPullPollerTimerApi;
    logError?: (message: string) => void;
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

interface WorkspaceTimer {
    timer: unknown;
    intervalMs: number;
}

const defaultTimerApi: WorkItemAzureBoardsPullPollerTimerApi = {
    setInterval: (handler, ms) => setInterval(() => { void handler(); }, ms),
    clearInterval: timer => clearInterval(timer as ReturnType<typeof setInterval>),
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function intervalMsFromMinutes(value: number | undefined): number {
    const minutes = Number.isFinite(value) && value! >= 1
        ? value!
        : DEFAULT_WORK_ITEM_AZURE_BOARDS_PULL_INTERVAL_MINUTES;
    return minutes * 60 * 1000;
}

function maybeUnref(timer: unknown): void {
    if (timer && typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
    }
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
    private readonly timerApi: WorkItemAzureBoardsPullPollerTimerApi;
    private readonly logError: (message: string) => void;
    private readonly timers = new Map<string, WorkspaceTimer>();
    private started = false;

    constructor(private readonly options: WorkItemAzureBoardsPullPollerOptions) {
        this.provider = options.provider ?? createAzureBoardsWorkItemSyncProviderAdapter({ dataDir: options.dataDir });
        this.transport = options.transport ?? new AzureBoardsRestWorkItemTransport();
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
        const prefs = readRepoPreferences(this.options.dataDir, workspaceId);
        const azureBoardsPrefs = prefs.workItems?.sync?.azureBoards;
        if (azureBoardsPrefs?.pollingEnabled === false) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }

        const roots = await this.listAzureBoardsBackedEpicRoots(workspaceId);
        if (roots.length === 0) {
            this.clearWorkspaceTimer(workspaceId);
            return;
        }

        const intervalMs = intervalMsFromMinutes(azureBoardsPrefs?.pollIntervalMinutes);
        const existing = this.timers.get(workspaceId);
        if (existing?.intervalMs === intervalMs) return;

        this.clearWorkspaceTimer(workspaceId);
        const timer = this.timerApi.setInterval(() => this.pollWorkspaceSafely(workspaceId), intervalMs);
        maybeUnref(timer);
        this.timers.set(workspaceId, { timer, intervalMs });
    }

    async pollWorkspace(workspaceId: string): Promise<WorkItemAzureBoardsPullWorkspaceResult> {
        const result = blankResult(workspaceId);
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

        return result;
    }

    private async pollWorkspaceSafely(workspaceId: string): Promise<void> {
        try {
            const result = await this.pollWorkspace(workspaceId);
            for (const warning of result.warnings) {
                this.logError(`[work-items/azure-boards-poll] ${workspaceId}: ${warning.message}`);
            }
            for (const error of result.errors) {
                this.logError(`[work-items/azure-boards-poll] ${workspaceId}: ${error.message}`);
            }
        } catch (error) {
            this.logError(`[work-items/azure-boards-poll] ${workspaceId}: ${errorMessage(error)}`);
        }
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

    private clearWorkspaceTimer(workspaceId: string): void {
        const existing = this.timers.get(workspaceId);
        if (!existing) return;
        this.timerApi.clearInterval(existing.timer);
        this.timers.delete(workspaceId);
    }
}

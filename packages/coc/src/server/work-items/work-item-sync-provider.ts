import type { WorkspaceInfo } from '@plusplusoneplusplus/forge';
import type {
    PerRepoPreferences,
    WorkItemSyncProvider as WorkItemSyncProviderName,
    WorkItemSyncProviderStatus,
} from '@plusplusoneplusplus/coc-client';

export const WORK_ITEM_SYNC_MAX_ITEMS = 200;
export const DEFAULT_WORK_ITEM_SYNC_PROVIDER: WorkItemSyncProviderName = 'github';
export const SUPPORTED_WORK_ITEM_SYNC_PROVIDERS: readonly WorkItemSyncProviderName[] = ['github', 'azure-boards'];

export interface WorkItemSyncProviderContext {
    workspaceId: string;
    workspace?: WorkspaceInfo;
    preferences: PerRepoPreferences;
}

export interface WorkItemSyncProviderAdapter {
    readonly provider: WorkItemSyncProviderName;
    getStatus(context: WorkItemSyncProviderContext): Promise<WorkItemSyncProviderStatus>;
}

export function isSupportedWorkItemSyncProvider(value: string): value is WorkItemSyncProviderName {
    return SUPPORTED_WORK_ITEM_SYNC_PROVIDERS.includes(value as WorkItemSyncProviderName);
}

export function unavailableWorkItemSyncProviderStatus(provider: WorkItemSyncProviderName): WorkItemSyncProviderStatus {
    return {
        provider,
        available: false,
        reason: 'provider-unavailable',
        message: `Work item sync provider '${provider}' is not registered.`,
    };
}

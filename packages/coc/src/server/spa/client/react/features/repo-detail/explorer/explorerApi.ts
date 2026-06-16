import type {
    CocRequestOptions,
    ExplorerBlobResponse,
    ExplorerSearchOptions,
    ExplorerSearchResponse,
    ExplorerTreeOptions,
    ExplorerTreeResponse,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../../api/cocClient';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';

export const explorerApi = {
    tree(workspaceId: string, options?: ExplorerTreeOptions): Promise<ExplorerTreeResponse> {
        return getCocClientForWorkspace(workspaceId).explorer.tree(workspaceId, options);
    },

    searchFiles(workspaceId: string, query: string, options?: ExplorerSearchOptions & Pick<CocRequestOptions, 'signal'>): Promise<ExplorerSearchResponse> {
        return getCocClientForWorkspace(workspaceId).explorer.searchFiles(workspaceId, query, options);
    },

    readBlob(workspaceId: string, path: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ExplorerBlobResponse> {
        return getCocClientForWorkspace(workspaceId).explorer.readBlob(workspaceId, path, options);
    },

    writeBlob(workspaceId: string, path: string, content: string): Promise<{ success: boolean }> {
        return getCocClientForWorkspace(workspaceId).explorer.writeBlob(workspaceId, path, content);
    },

    reveal(workspaceId: string, path: string): Promise<void> {
        return getCocClientForWorkspace(workspaceId).explorer.reveal(workspaceId, path);
    },

    readTrustedBlob(path: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ExplorerBlobResponse> {
        // Trusted-blob reads are not workspace-scoped; keep them on the local client.
        return getSpaCocClient().explorer.readTrustedBlob(path, options);
    },
};

import type {
    CocRequestOptions,
    ExplorerBlobResponse,
    ExplorerSearchOptions,
    ExplorerSearchResponse,
    ExplorerTreeOptions,
    ExplorerTreeResponse,
} from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient } from '../../../api/cocClient';

export const explorerApi = {
    tree(workspaceId: string, options?: ExplorerTreeOptions): Promise<ExplorerTreeResponse> {
        return getSpaCocClient().explorer.tree(workspaceId, options);
    },

    searchFiles(workspaceId: string, query: string, options?: ExplorerSearchOptions & Pick<CocRequestOptions, 'signal'>): Promise<ExplorerSearchResponse> {
        return getSpaCocClient().explorer.searchFiles(workspaceId, query, options);
    },

    readBlob(workspaceId: string, path: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ExplorerBlobResponse> {
        return getSpaCocClient().explorer.readBlob(workspaceId, path, options);
    },

    writeBlob(workspaceId: string, path: string, content: string): Promise<{ success: boolean }> {
        return getSpaCocClient().explorer.writeBlob(workspaceId, path, content);
    },

    reveal(workspaceId: string, path: string): Promise<void> {
        return getSpaCocClient().explorer.reveal(workspaceId, path);
    },

    readTrustedBlob(path: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ExplorerBlobResponse> {
        return getSpaCocClient().explorer.readTrustedBlob(path, options);
    },
};

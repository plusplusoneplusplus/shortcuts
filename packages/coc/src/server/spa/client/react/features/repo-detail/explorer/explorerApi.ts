import type {
    CocRequestOptions,
    ExplorerBlobResponse,
    ExplorerContentReplaceFile,
    ExplorerContentReplaceOptions,
    ExplorerContentReplaceResponse,
    ExplorerContentSearchOptions,
    ExplorerContentSearchResponse,
    ExplorerFilesOptions,
    ExplorerFilesResponse,
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

    listFiles(workspaceId: string, options?: ExplorerFilesOptions & Pick<CocRequestOptions, 'signal'>): Promise<ExplorerFilesResponse> {
        return getCocClientForWorkspace(workspaceId).explorer.listFiles(workspaceId, options);
    },

    searchFiles(workspaceId: string, query: string, options?: ExplorerSearchOptions & Pick<CocRequestOptions, 'signal'>): Promise<ExplorerSearchResponse> {
        return getCocClientForWorkspace(workspaceId).explorer.searchFiles(workspaceId, query, options);
    },

    searchContent(workspaceId: string, query: string, options?: ExplorerContentSearchOptions & Pick<CocRequestOptions, 'signal'>): Promise<ExplorerContentSearchResponse> {
        return getCocClientForWorkspace(workspaceId).explorer.searchContent(workspaceId, query, options);
    },

    replaceContent(
        workspaceId: string,
        query: string,
        replacement: string,
        files: ExplorerContentReplaceFile[],
        options?: ExplorerContentReplaceOptions,
    ): Promise<ExplorerContentReplaceResponse> {
        return getCocClientForWorkspace(workspaceId).explorer.replaceContent(workspaceId, query, replacement, files, options);
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

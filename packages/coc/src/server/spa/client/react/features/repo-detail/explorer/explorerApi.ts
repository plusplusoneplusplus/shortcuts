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
import { getCocClientForWorkspace, resolveCloneRoute } from '../../../repos/cloneRegistry';

export const explorerApi = {
    deleteEntry(workspaceId: string, path: string, routingRef?: string | null): Promise<{ success: true }> {
        const ref = routingRef === undefined ? workspaceId : routingRef;
        if (resolveCloneRoute(ref).kind === 'unresolved-remote') {
            return Promise.reject(new Error('The owning server is unavailable. Deletion was not sent.'));
        }
        return getCocClientForWorkspace(ref).explorer.deleteEntry(workspaceId, path);
    },
    tree(workspaceId: string, options?: ExplorerTreeOptions, routingRef?: string | null): Promise<ExplorerTreeResponse> {
        return getCocClientForWorkspace(routingRef === undefined ? workspaceId : routingRef)
            .explorer.tree(workspaceId, options);
    },

    listFiles(
        workspaceId: string,
        options?: ExplorerFilesOptions & Pick<CocRequestOptions, 'signal'>,
        routingRef?: string | null,
    ): Promise<ExplorerFilesResponse> {
        return getCocClientForWorkspace(routingRef === undefined ? workspaceId : routingRef)
            .explorer.listFiles(workspaceId, options);
    },

    searchFiles(
        workspaceId: string,
        query: string,
        options?: ExplorerSearchOptions & Pick<CocRequestOptions, 'signal'>,
        routingRef?: string | null,
    ): Promise<ExplorerSearchResponse> {
        return getCocClientForWorkspace(routingRef === undefined ? workspaceId : routingRef)
            .explorer.searchFiles(workspaceId, query, options);
    },

    searchContent(
        workspaceId: string,
        query: string,
        options?: ExplorerContentSearchOptions & Pick<CocRequestOptions, 'signal'>,
        routingRef?: string | null,
    ): Promise<ExplorerContentSearchResponse> {
        return getCocClientForWorkspace(routingRef === undefined ? workspaceId : routingRef)
            .explorer.searchContent(workspaceId, query, options);
    },

    replaceContent(
        workspaceId: string,
        query: string,
        replacement: string,
        files: ExplorerContentReplaceFile[],
        options?: ExplorerContentReplaceOptions,
        routingRef?: string | null,
    ): Promise<ExplorerContentReplaceResponse> {
        return getCocClientForWorkspace(routingRef === undefined ? workspaceId : routingRef)
            .explorer.replaceContent(workspaceId, query, replacement, files, options);
    },

    readBlob(
        workspaceId: string,
        path: string,
        options?: Pick<CocRequestOptions, 'signal'>,
        routingRef?: string | null,
    ): Promise<ExplorerBlobResponse> {
        return getCocClientForWorkspace(routingRef === undefined ? workspaceId : routingRef)
            .explorer.readBlob(workspaceId, path, options);
    },

    writeBlob(
        workspaceId: string,
        path: string,
        content: string,
        routingRef?: string | null,
    ): Promise<{ success: boolean }> {
        return getCocClientForWorkspace(routingRef === undefined ? workspaceId : routingRef)
            .explorer.writeBlob(workspaceId, path, content);
    },

    reveal(workspaceId: string, path: string, routingRef?: string | null): Promise<void> {
        const ref = routingRef === undefined ? workspaceId : routingRef;
        // Never let a remote clone's path fall through to the local server.
        if (resolveCloneRoute(ref).kind === 'unresolved-remote') {
            return Promise.reject(new Error('The owning server is unavailable. The file was not revealed.'));
        }
        return getCocClientForWorkspace(ref).explorer.reveal(workspaceId, path);
    },

    readTrustedBlob(path: string, options?: Pick<CocRequestOptions, 'signal'>): Promise<ExplorerBlobResponse> {
        // Trusted-blob reads are not workspace-scoped; keep them on the local client.
        return getSpaCocClient().explorer.readTrustedBlob(path, options);
    },
};

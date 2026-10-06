import { getCocClientFor } from '../../api/cocClient';
import { resolveCloneRoute } from '../../repos/cloneRegistry';
import { getApiBase } from '../../utils/config';
import { toFileBlob } from '../../features/chat/source-canvas/previewResponse';

/** Workspace-authorized, read-only paths; never sent to the writable repo blob API. */
export const WORKSPACE_PREVIEW_PREFIX = '__workspace_preview__:';

export function workspacePreviewClient(workspaceId: string, routingRef?: string | null) {
    const route = resolveCloneRoute(routingRef === undefined ? workspaceId : routingRef);
    if (route.kind === 'unresolved-remote') throw new Error('The owning remote server is unavailable.');
    return getCocClientFor(route.kind === 'remote' ? route.baseUrl : undefined);
}

export function workspacePreviewUrl(workspaceId: string, path: string, routingRef?: string | null): string {
    return `${workspaceFileApiBase(workspaceId, routingRef)}/workspaces/${encodeURIComponent(workspaceId)}/files/preview?path=${encodeURIComponent(path)}&download=true`;
}

export function workspaceFileApiBase(workspaceId: string, routingRef?: string | null): string {
    const route = resolveCloneRoute(routingRef === undefined ? workspaceId : routingRef);
    if (route.kind === 'unresolved-remote') throw new Error('The owning remote server is unavailable.');
    const base = route.kind === 'remote' ? `${route.baseUrl.replace(/\/+$/, '')}/api` : getApiBase();
    return base;
}

export async function readWorkspacePreview(
    workspaceId: string, path: string, routingRef: string | null | undefined, signal: AbortSignal,
) {
    const result = await workspacePreviewClient(workspaceId, routingRef).request(
        `/workspaces/${encodeURIComponent(workspaceId)}/files/preview`,
        { query: { path, lines: 0 }, signal },
    );
    if (!result || typeof result !== 'object') throw new Error('Invalid file preview.');
    return toFileBlob(result);
}

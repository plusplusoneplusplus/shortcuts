/**
 * useSourceCanvasContent — loads file content for the docked source canvas
 * (AC-06). Two jobs, and only the first is its own: it RESOLVES the workspace +
 * path (longest-prefix `rootPath` match, relative paths against
 * `sourceFilePath` or the workspace root), then hands the fetch to the shared
 * `useFileContent` and maps the result onto the canvas's own vocabulary.
 *
 * An unresolvable or missing path still resolves to an `error` state — the
 * canvas stays open with a clear "couldn't load <path>" message rather than
 * silently showing nothing. Nothing resolvable means a `null` key, which tells
 * `useFileContent` to issue no request and sit in `loading`.
 *
 * Returns raw text + a server language hint; rendering (markdown vs
 * syntax-highlighted source, line jump/highlight) is layered on top in AC-04/05.
 */
import { useCallback, useMemo, useState } from 'react';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { useWorkspacesWithRemote } from '../../../repos/workspacesWithRemote';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { useFileContent } from '../../../shared/file-viewer/useFileContent';
import type { FileBlob } from '../../../shared/file-viewer/types';
import { resolveSourceCanvasTarget, isSourceCanvasResolveError } from './resolve';
import { extractContent, type PreviewResponse } from './previewResponse';
import { SOURCE_CANVAS_LOADING as LOADING } from './types';
import type { SourceCanvasContentState, SourceCanvasFileRef } from './types';

// Re-exported so the panel/dock/index import sites stay put; the shape itself
// lives with the folder's other public vocabulary.
export type { SourceCanvasContentState, SourceCanvasContentStatus } from './types';

export function useSourceCanvasContent(
    fileRef: SourceCanvasFileRef | null,
): SourceCanvasContentState {
    // Remote-server workspaces are aggregated into the repos list, not into the
    // global `state.workspaces` (routing goes through the clone registry). A chat
    // link clicked in a remote conversation carries that remote workspace id, so
    // fold the remote workspaces in for resolution — otherwise the workspace (and
    // its remote `rootPath`) is invisible and a relative path can't be anchored.
    const workspaces = useWorkspacesWithRemote();

    // Line/range is a scroll target, not part of the file identity: resolve from
    // the resolution-relevant fields only, so a `:line` change never refetches.
    const fullPath = fileRef?.fullPath;
    const sourceFilePath = fileRef?.sourceFilePath;
    const wsHint = fileRef?.wsId;
    const resolved = useMemo(() => (fullPath === undefined
        ? null
        : resolveSourceCanvasTarget({ fullPath, sourceFilePath, wsId: wsHint }, workspaces)
    ), [fullPath, sourceFilePath, wsHint, workspaces]);

    const target = resolved && !isSourceCanvasResolveError(resolved) ? resolved : null;
    // A null key is "nothing to fetch": no ref at all, or a ref that didn't
    // resolve (whose error is reported below without ever hitting the network).
    const key = target ? `${target.wsId}:${target.path}` : null;

    // What the SERVER reported about ownership, which the request alone can't
    // know: a repo-group ref is sent relative and comes back owned by a member
    // workspace. Tagged with the key it was read for, so a superseded read can
    // never label the file that replaced it.
    type Attribution = { key: string; resolvedPath: string; resolvedWorkspaceId: string };
    const [attribution, setAttribution] = useState<Attribution | null>(null);

    const read = useCallback(async (signal: AbortSignal): Promise<FileBlob> => {
        if (!target || key === null) throw new Error('Failed to load file');
        // Clone-routed, so a remote workspace's preview comes from its own server.
        const r = await getCocClientForWorkspace(target.wsId)
            .tasks.previewWorkspaceFile(target.wsId, target.path, { lines: 0 })
            // Transport-specific message mapping stays next to the transport.
            .catch((err: unknown) => {
                throw new Error(getSpaCocClientErrorMessage(err, 'Failed to load file'));
            }) as PreviewResponse;
        // A superseded read must not rewrite attribution — the repo chip is keyed
        // off `resolvedWorkspaceId`, so a stale write mislabels the open file.
        if (!signal.aborted) {
            setAttribution({
                key,
                resolvedPath: typeof r.path === 'string' ? r.path : target.path,
                resolvedWorkspaceId: typeof r.resolvedWorkspaceId === 'string' ? r.resolvedWorkspaceId : target.wsId,
            });
        }
        return {
            content: extractContent(r),
            encoding: 'utf-8',
            mimeType: 'text/plain',
            language: typeof r.language === 'string' ? r.language : '',
        };
    }, [target?.wsId, target?.path, key]);

    const { blob, status, error } = useFileContent({ key, read });

    return useMemo<SourceCanvasContentState>(() => {
        if (!resolved) return LOADING;
        if (isSourceCanvasResolveError(resolved)) {
            return { ...LOADING, status: 'error', resolvedPath: resolved.attemptedPath, error: resolved.error };
        }
        if (status === 'error') {
            return { ...LOADING, status: 'error', resolvedPath: resolved.path, error: error || 'Failed to load file' };
        }
        if (status === 'loading' || !blob) return { ...LOADING, resolvedPath: resolved.path };
        const owned = attribution?.key === key ? attribution : null;
        const resolvedWorkspaceId = owned?.resolvedWorkspaceId ?? resolved.wsId;
        return {
            status: 'success',
            content: blob.content,
            language: blob.language || '',
            resolvedPath: owned?.resolvedPath ?? resolved.path,
            resolvedWorkspaceId,
            workspaceRootPath: workspaces.find((ws) => ws.id === resolvedWorkspaceId)?.rootPath || undefined,
            error: '',
        };
    }, [resolved, status, error, blob, attribution, key, workspaces]);
}

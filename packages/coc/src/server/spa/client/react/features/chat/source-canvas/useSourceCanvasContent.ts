/**
 * useSourceCanvasContent — loads file content for the docked source canvas
 * (AC-06). Resolves the workspace + path (longest-prefix `rootPath` match,
 * relative paths against `sourceFilePath` or the workspace root), fetches via
 * the existing `previewWorkspaceFile` endpoint, and exposes explicit loading /
 * success / error states.
 *
 * An unresolvable or missing path still resolves to an `error` state — the
 * canvas stays open with a clear "couldn't load <path>" message rather than
 * silently showing nothing.
 *
 * Returns raw text + a server language hint; rendering (markdown vs
 * syntax-highlighted source, line jump/highlight) is layered on top in AC-04/05.
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../../contexts/AppContext';
import { useReposOptional } from '../../../contexts/ReposContext';
import { getCocClientForWorkspace } from '../../../repos/cloneRegistry';
import { isRemoteWorkspace } from '../../../repos/remoteWorkspaceAggregation';
import { getSpaCocClientErrorMessage } from '../../../api/cocClient';
import { resolveSourceCanvasTarget, isSourceCanvasResolveError } from './resolve';
import type { SourceCanvasFileRef } from './types';

export type SourceCanvasContentStatus = 'loading' | 'success' | 'error';

export interface SourceCanvasContentState {
    status: SourceCanvasContentStatus;
    /** Loaded file text (success). */
    content: string;
    /** Server-reported language hint, for syntax highlighting (success). */
    language: string;
    /** The path actually fetched/attempted — for the header + error message. */
    resolvedPath: string;
    /** Failure reason (error). */
    error: string;
}

/** Reconstruct full text from a `previewWorkspaceFile` response. */
function extractContent(res: { content?: unknown; lines?: unknown }): string {
    if (typeof res.content === 'string') {
        return res.content;
    }
    if (Array.isArray(res.lines)) {
        return (res.lines as unknown[])
            .map((line) => (typeof line === 'string' ? line : ''))
            .join('\n');
    }
    return '';
}

const LOADING: SourceCanvasContentState = {
    status: 'loading',
    content: '',
    language: '',
    resolvedPath: '',
    error: '',
};

export function useSourceCanvasContent(
    fileRef: SourceCanvasFileRef | null,
): SourceCanvasContentState {
    const { state } = useApp();
    const repos = useReposOptional();
    const [content, setContent] = useState<SourceCanvasContentState>(LOADING);

    // Remote-server workspaces are aggregated into the repos list, not into the
    // global `state.workspaces` (routing goes through the clone registry). A chat
    // link clicked in a remote conversation carries that remote workspace id, so
    // fold the remote workspaces in for resolution — otherwise the workspace (and
    // its remote `rootPath`) is invisible and a relative path can't be anchored.
    const reposList = repos?.repos;
    const workspaces = useMemo(() => {
        const remote = (reposList ?? [])
            .map((r) => r.workspace)
            .filter(isRemoteWorkspace);
        return remote.length > 0 ? [...state.workspaces, ...remote] : state.workspaces;
    }, [state.workspaces, reposList]);

    // Line/range changes (scroll target only) must NOT trigger a refetch, so
    // depend on the resolution-relevant fields rather than the ref identity.
    const fullPath = fileRef?.fullPath;
    const sourceFilePath = fileRef?.sourceFilePath;
    const wsHint = fileRef?.wsId;

    useEffect(() => {
        if (!fileRef) {
            setContent(LOADING);
            return;
        }

        const resolved = resolveSourceCanvasTarget(fileRef, workspaces);
        if (isSourceCanvasResolveError(resolved)) {
            setContent({
                status: 'error',
                content: '',
                language: '',
                resolvedPath: resolved.attemptedPath,
                error: resolved.error,
            });
            return;
        }

        let cancelled = false;
        setContent({ ...LOADING, resolvedPath: resolved.path });
        // Route through the clone registry so a remote workspace's preview is
        // fetched from its own server; local ids fall through to the default client.
        getCocClientForWorkspace(resolved.wsId)
            .tasks.previewWorkspaceFile(resolved.wsId, resolved.path, { lines: 0 })
            .then((res) => {
                if (cancelled) {
                    return;
                }
                const r = res as { content?: unknown; lines?: unknown; language?: unknown };
                setContent({
                    status: 'success',
                    content: extractContent(r),
                    language: typeof r.language === 'string' ? r.language : '',
                    resolvedPath: resolved.path,
                    error: '',
                });
            })
            .catch((err) => {
                if (cancelled) {
                    return;
                }
                setContent({
                    status: 'error',
                    content: '',
                    language: '',
                    resolvedPath: resolved.path,
                    error: getSpaCocClientErrorMessage(err, 'Failed to load file'),
                });
            });

        return () => {
            cancelled = true;
        };
    }, [fullPath, sourceFilePath, wsHint, workspaces]);

    return content;
}

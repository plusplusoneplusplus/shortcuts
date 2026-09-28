/**
 * MonacoFileDiffViewer — one working-tree file's diff in Monaco's diff editor.
 *
 * Both sides arrive as full text from the server (AC-01); this component never
 * reconstructs files from a patch. It renders a host element, measures it, and
 * hands everything else to `monacoDiffController`: editor creation, models,
 * options, theme, diff readiness, hunk navigation and disposal.
 *
 * Monaco supplies syntax highlighting (language from the file name), find
 * (Ctrl/Cmd+F), the overview ruler (in place of `DiffMiniMap`) and virtualized
 * rendering. The imperative handle is the subset of `UnifiedDiffViewerHandle`
 * the working-tree surface and `useCrossFileNav` drive, plus `revealComment`.
 *
 * Diff comments render through `MonacoDiffCommentLayer` once the editor is
 * attached and Monaco has computed the diff for the current models.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { Spinner } from '../../../ui';
import { useTheme } from '../../../layout/ThemeProvider';
import type { DiffLine, UnifiedDiffViewerHandle } from './UnifiedDiffViewer';
import type { DiffViewMode } from '../hooks/useDiffViewMode';
import { createDiffLineIndexResolver, type DiffLineChange } from './diffCoords';
import type { DiffComment } from '../../../../comments/diff-comment-types';
import {
    MonacoDiffCommentLayer,
    type MonacoDiffCommentHandlers,
    type MonacoDiffCommentLayerHandle,
    type MonacoDiffCommentState,
} from './MonacoDiffCommentLayer';
import type { DiffEditorAdapter } from './monacoDiffController';
import {
    buildDiffEditorOptions,
    buildDiffModels,
    resolveDiffEditorTheme,
    type MonacoDiffStage,
} from './monacoDiffOptions';
import { createMonacoDiffController, type MonacoDiffController } from './monacoDiffController';
import { createDefaultDiffEditor, type DiffEditorFactory } from './monacoDiffEditorAdapter';
import { synthesizeDiffLines } from './monacoDiffLineShim';

export type MonacoFileDiffViewerHandle = Pick<
    UnifiedDiffViewerHandle,
    'scrollToNextHunk' | 'scrollToPrevHunk' | 'getHunkCount' | 'getCurrentHunkIndex' | 'scrollToHunk'
> & {
    /** False until Monaco has computed the diff for the current file. */
    isHunkNavigationReady: () => boolean;
    /** Scrolls to a comment's thread and expands it; false when not shown here. */
    revealComment: (id: string) => boolean;
};

export interface MonacoFileDiffViewerProps extends MonacoDiffCommentHandlers {
    workspaceId: string;
    /** Repo-relative, `/`-separated path; drives model URIs and language. */
    relativePath: string;
    stage: MonacoDiffStage;
    /** Full text of the base side (HEAD for staged, index for unstaged). */
    original: string;
    /** Full text of the changed side (index for staged, disk for unstaged). */
    modified: string;
    viewMode: DiffViewMode;
    /** Hunk to reveal once the diff for this file is ready. */
    initialHunkTarget?: 'first' | 'last';
    /** Monaco's line changes for the current file, on every diff update. */
    onLineChanges?: (changes: readonly DiffLineChange[]) => void;
    /**
     * TEMPORARY compatibility shim (see `monacoDiffLineShim.ts`): the classic
     * `DiffLine[]` synthesized from Monaco's line changes, for consumers that
     * have not migrated off `DiffLine[]`. Remove with the shim.
     */
    onLinesReady?: (lines: DiffLine[]) => void;
    /** Called when the editor could not be created. */
    onEditorError?: (error: unknown) => void;
    /** Comments on this diff; each placed thread renders in a view zone. */
    comments?: readonly DiffComment[];
    /** Renders one comment thread inside the editor. Required to show threads. */
    renderCommentThread?: (comment: DiffComment) => ReactNode;
    /** Editor factory; tests pass an owned adapter. Defaults to Monaco. */
    createEditor?: DiffEditorFactory;
    'data-testid'?: string;
}

const NO_COMMENTS: readonly DiffComment[] = [];

function prefersDarkScheme(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export const MonacoFileDiffViewer = forwardRef<MonacoFileDiffViewerHandle, MonacoFileDiffViewerProps>(
    function MonacoFileDiffViewer({
        workspaceId, relativePath, stage, original, modified, viewMode, initialHunkTarget,
        onLineChanges, onLinesReady, onEditorError, createEditor = createDefaultDiffEditor,
        comments, renderCommentThread, onAddComment, onAskAI, onCopyAsContext,
        'data-testid': testId = 'monaco-file-diff-viewer',
    }, ref) {
        const { theme } = useTheme();
        const hostRef = useRef<HTMLDivElement | null>(null);
        const controllerRef = useRef<MonacoDiffController | null>(null);
        const [attached, setAttached] = useState(false);
        const [editor, setEditor] = useState<DiffEditorAdapter | null>(null);
        const [modelsVersion, setModelsVersion] = useState(0);
        const [commentDiff, setCommentDiff] = useState<MonacoDiffCommentState | null>(null);
        const commentLayerRef = useRef<MonacoDiffCommentLayerHandle>(null);
        const [failed, setFailed] = useState(false);
        const identical = original === modified;

        const models = useMemo(
            () => buildDiffModels({ workspaceId, relativePath, stage, original, modified }),
            [workspaceId, relativePath, stage, original, modified],
        );
        const options = useMemo(() => buildDiffEditorOptions(viewMode), [viewMode]);
        const editorTheme = resolveDiffEditorTheme(theme, prefersDarkScheme());

        // Latest values for callbacks and the one-shot creation below.
        const latest = useRef({ options, onLineChanges, onLinesReady, onEditorError, createEditor });
        latest.current = { options, onLineChanges, onLinesReady, onEditorError, createEditor };

        // One controller per mounted host. Identical sides render no editor.
        useEffect(() => {
            const host = hostRef.current;
            if (identical || !host) return;
            const controller = createMonacoDiffController(
                () => latest.current.createEditor(host, latest.current.options),
                {
                    onAttach: () => {
                        setAttached(true);
                        setEditor(controller.getEditor());
                    },
                    onModelsApplied: () => {
                        setModelsVersion(v => v + 1);
                        setCommentDiff(null);
                    },
                    onError: (error) => {
                        setFailed(true);
                        latest.current.onEditorError?.(error);
                    },
                    onLineChanges: (changes, applied) => {
                        const lines = synthesizeDiffLines(applied.original.text, applied.modified.text, changes);
                        latest.current.onLineChanges?.(changes);
                        latest.current.onLinesReady?.(lines);
                        setCommentDiff({
                            original: applied.original.text,
                            modified: applied.modified.text,
                            lineChanges: changes,
                            diffLineIndexOf: createDiffLineIndexResolver(lines),
                        });
                    },
                },
            );
            controllerRef.current = controller;
            return () => {
                controller.dispose();
                controllerRef.current = null;
                setAttached(false);
                setEditor(null);
                setCommentDiff(null);
            };
        }, [identical]);

        // Models first, then the held hunk target, so the target applies to
        // this file's diff once it is computed.
        const initialHunkTargetRef = useRef(initialHunkTarget);
        initialHunkTargetRef.current = initialHunkTarget;
        useEffect(() => {
            const controller = controllerRef.current;
            if (!controller) return;
            controller.setModels(models);
            const target = initialHunkTargetRef.current;
            if (target) controller.navigate({ kind: target });
        }, [models, identical]);

        useEffect(() => { controllerRef.current?.setOptions(options); }, [options, identical]);
        useEffect(() => { controllerRef.current?.setTheme(editorTheme); }, [editorTheme, identical]);

        // Explicit pixel layout from the host's measured size.
        useEffect(() => {
            const host = hostRef.current;
            if (identical || !host) return;
            const update = () => {
                const { width, height } = host.getBoundingClientRect();
                controllerRef.current?.layout({ width: Math.round(width), height: Math.round(height) });
            };
            update();
            if (typeof ResizeObserver === 'undefined') return;
            const observer = new ResizeObserver(update);
            observer.observe(host);
            return () => observer.disconnect();
        }, [identical]);

        // Identical sides still report "no changes" to classic consumers.
        useEffect(() => {
            if (!identical) return;
            latest.current.onLineChanges?.([]);
            latest.current.onLinesReady?.([]);
        }, [identical, models]);

        useImperativeHandle(ref, () => ({
            scrollToNextHunk: () => controllerRef.current?.navigate({ kind: 'next' }),
            scrollToPrevHunk: () => controllerRef.current?.navigate({ kind: 'prev' }),
            scrollToHunk: (index: number) => controllerRef.current?.navigate({ kind: 'index', index }),
            getHunkCount: () => controllerRef.current?.getHunkCount() ?? 0,
            getCurrentHunkIndex: () => controllerRef.current?.getCurrentHunkIndex() ?? -1,
            isHunkNavigationReady: () => (controllerRef.current ? controllerRef.current.isHunkNavigationReady() : true),
            revealComment: (id: string) => commentLayerRef.current?.revealComment(id) ?? false,
        }), []);

        if (identical) {
            return (
                <div className="text-xs text-[#848484] px-4 py-2" data-testid={`${testId}-empty`}>
                    (no changes)
                </div>
            );
        }

        return (
            <div className="flex flex-col h-full w-full overflow-hidden" data-testid={testId} data-view-mode={viewMode}>
                {renderCommentThread && (
                    <MonacoDiffCommentLayer
                        ref={commentLayerRef}
                        editor={editor}
                        modelsVersion={modelsVersion}
                        diff={commentDiff}
                        viewMode={viewMode}
                        comments={comments ?? NO_COMMENTS}
                        renderThread={renderCommentThread}
                        onAddComment={onAddComment}
                        onAskAI={onAskAI}
                        onCopyAsContext={onCopyAsContext}
                    />
                )}
                <div className="relative flex-1 min-h-0">
                    <div ref={hostRef} className="absolute inset-0" data-testid={`${testId}-host`} />
                    {!attached && !failed && (
                        <div className="absolute inset-0 flex items-center gap-2 px-4 py-2 text-xs text-[#848484]" data-testid={`${testId}-loading`}>
                            <Spinner size="sm" /> Loading editor...
                        </div>
                    )}
                </div>
            </div>
        );
    },
);

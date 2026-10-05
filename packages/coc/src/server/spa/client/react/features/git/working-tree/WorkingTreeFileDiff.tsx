/**
 * WorkingTreeFileDiff — right-panel detail view for a working-tree file diff.
 *
 * Fetches staged or unstaged diff for a single file via
 * GET /api/workspaces/:id/git/changes/files/<path>/diff?stage=<stage>
 * and renders it in UnifiedDiffViewer. Untracked files show a placeholder.
 *
 * When the diff-engine preference is `monaco`, both full-text sides come from
 * GET .../changes/files/<path>/content?stage=<stage> and render in
 * MonacoFileDiffViewer, with comment threads portalled into editor view zones.
 * Binary, oversized or unloadable content, or an editor
 * that fails to start, falls back to the classic viewer with a visible reason
 * (see diffEngineResolution).
 *
 * In the editor engine the modified (disk) side of an unstaged diff is
 * editable; Ctrl/Cmd+S writes it to disk through the explorer blob API,
 * keyed by this diff's own workspace. A staged diff is editable only while the
 * disk file equals the index (checked by also loading the unstaged sides);
 * saving it writes the disk file and never touches the index. The header
 * Save button and dirty marker, plus `onDirtyChange` / `onRegisterSave`, follow
 * the Explorer editor contract so the owner can prompt before leaving.
 * A `refreshKey` bump re-reads the file: clean views reload silently, while
 * unsaved edits are kept and a "File changed on disk" banner offers Reload /
 * Keep mine.
 */

import { useState, useEffect, useCallback, useRef, useMemo, type RefObject } from 'react';
import type { GitWorkingTreeFileContentResponse } from '@plusplusoneplusplus/coc-client';
import { useCocClient } from '../../../repos/cloneRouting';
import { Spinner, Button, TruncatedPath } from '../../../ui';
import { UnifiedDiffViewer, HunkNavButtons } from '../diff/UnifiedDiffViewer';
import type { UnifiedDiffViewerHandle, DiffLine } from '../diff/UnifiedDiffViewer';
import type { DiffSelectionDragSource } from '../diff/diffSelectionContext';
import { SideBySideDiffViewer } from '../diff/SideBySideDiffViewer';
import { useDiffViewMode } from '../hooks/useDiffViewMode';
import { DiffViewToggle, DiffEngineToggle } from '../diff/DiffViewToggle';
import { DiffEngineFallbackBanner } from '../diff/DiffEngineFallbackBanner';
import { resolveDiffEngineSelection, type DiffContentLoadState } from '../diff/diffEngineResolution';
import { useDiffEngine } from '../hooks/useDiffEngine';
import { MonacoFileDiffViewer, type MonacoFileDiffViewerHandle } from '../diff/MonacoFileDiffViewer';
import type { DiffEditorFactory } from '../diff/monacoDiffEditorAdapter';
import { DiffMiniMap } from '../diff/DiffMiniMap';
import { useDiffComments } from '../hooks/useDiffComments';
import { CommentSidebar } from '../../../tasks/comments/CommentSidebar';
import { CommentPopover } from '../../../tasks/comments/CommentPopover';
import { CommentCard } from '../../../tasks/comments/CommentCard';
import { formatDiffCommentPrompt } from '../../../utils/diffCommentPrompt';
import { useCurrentChatInsertDraft } from '../../repo-detail/unified-right-panel/unifiedChatCanvasActions';
import { InlineCommentPopup } from '../../../tasks/comments/InlineCommentPopup';
import { useQueue } from '../../../contexts/QueueContext';
import { useCrossFileNav, type HunkNavigationHandle } from '../hooks/useCrossFileNav';
import { PreviewPane } from '../../repo-detail/explorer';
import { explorerApi } from '../../repo-detail/explorer/explorerApi';
import { repoRelative } from './WorkingTree';
import { buildDiffContext } from '../../../../comments/diff-context-utils';
import { copyToClipboard } from '../../../utils/format';
import type { DiffCommentSelection, DiffComment } from '../../../../comments/diff-comment-types';
import type { AnyComment } from '../../../../comments/shared-comment-types';
import type { TaskCommentCategory } from '../../../../comments/task-comments-types';

export interface WorkingTreeFileDiffProps {
    workspaceId: string;
    /** Concrete repo owner for selection attachments. */
    attachmentDestinationId?: string;
    filePath: string;
    stage: 'staged' | 'unstaged' | 'untracked';
    /** Workspace repo root; used to convert the absolute `filePath` to a
     * repo-relative path for the untracked-file preview. */
    repoRoot?: string;
    /** Ordered file paths for the working tree (enables cross-file hunk nav). */
    workingTreeFiles?: string[];
    /** Called when cross-file navigation requests switching to a different file. */
    onNavigateToFile?: (filePath: string, hunkTarget: 'first' | 'last') => void;
    /** When set, auto-scrolls to the first or last hunk after the diff loads. */
    initialHunkTarget?: 'first' | 'last';
    /**
     * Called once when the untracked file turns out to no longer exist on disk
     * (the working-tree list was stale). Lets the owner refresh the change list
     * so the ghost entry disappears.
     */
    onFileMissing?: () => void;
    /** Monaco diff editor factory; tests pass an owned adapter. */
    createDiffEditor?: DiffEditorFactory;
    /** Reports unsaved edits (the Explorer editor contract); false on unmount. */
    onDirtyChange?: (isDirty: boolean) => void;
    /** Registers the save function while the view is editable; null otherwise. */
    onRegisterSave?: (save: (() => Promise<boolean>) | null) => void;
    /**
     * Bumped by the owner's git refresh. Re-reads the diff and both sides;
     * unsaved edits are never replaced (a "File changed on disk" banner offers
     * Reload / Keep mine instead).
     */
    refreshKey?: number;
    /** Called after a diff edit is saved so the owner refreshes the change list and diff. */
    onSaved?: () => void;
}

/**
 * Whether the disk file equals the index for a staged diff, so its index side
 * can be edited as the disk file. `disk` is the unstaged (index → disk) content.
 */
export function stagedDiskMatchesIndex(
    staged: GitWorkingTreeFileContentResponse,
    disk: GitWorkingTreeFileContentResponse | null,
): boolean {
    if (!disk || disk.binary || disk.tooLarge) return false;
    return staged.head.exists && disk.head.exists && disk.head.content === staged.head.content;
}

const STAGE_LABEL: Record<string, string> = {
    staged: 'Staged diff',
    unstaged: 'Unstaged diff',
    untracked: 'Untracked file',
};

type PopupState = {
    position: { top: number; left: number };
    selection: DiffCommentSelection;
    selectedText: string;
} | null;

/**
 * Both file sides for the Monaco engine. `diskText` is the on-disk file (null
 * when the staged disk check failed), used to tell a disk change apart.
 */
type LoadedEditorContent = { content: GitWorkingTreeFileContentResponse; diskMatchesIndex: boolean; diskText: string | null };

/** Editor content keyed by the request that loaded it. */
type EditorContentState =
    | { key: string; status: 'loading' }
    | ({ key: string; status: 'loaded' } & LoadedEditorContent)
    | { key: string; status: 'failed' };

export function WorkingTreeFileDiff({ workspaceId, attachmentDestinationId, filePath, stage, repoRoot, workingTreeFiles, onNavigateToFile, initialHunkTarget, onFileMissing, createDiffEditor, onDirtyChange, onRegisterSave, refreshKey, onSaved }: WorkingTreeFileDiffProps) {
    const { dispatch: queueDispatch } = useQueue();
    const [diff, setDiff] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [truncated, setTruncated] = useState(false);
    const [totalLines, setTotalLines] = useState(0);
    const [fullRequested, setFullRequested] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [popupState, setPopupState] = useState<PopupState>(null);
    const [activePopoverComment, setActivePopoverComment] = useState<AnyComment | null>(null);
    const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
    const viewerRef = useRef<UnifiedDiffViewerHandle>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [diffLines, setDiffLines] = useState<DiffLine[]>([]);
    const [viewMode, setViewMode] = useDiffViewMode();
    const [diffEngine, setDiffEngine] = useDiffEngine();
    const monacoViewerRef = useRef<MonacoFileDiffViewerHandle>(null);
    const [editorContent, setEditorContent] = useState<EditorContentState | null>(null);
    // Bumped by the fallback Retry button: re-fetches content and re-mounts the editor.
    const [editorAttempt, setEditorAttempt] = useState(0);
    // Key of the file + attempt whose editor failed. Sticky, so a failing file
    // stays on the classic viewer instead of re-mounting the editor on every render.
    const [editorFailedKey, setEditorFailedKey] = useState<string | null>(null);
    // The untracked file vanished from disk after the change list was fetched.
    const [fileMissing, setFileMissing] = useState(false);
    const fileMissingNotifiedRef = useRef(false);

    const handlePreviewNotFound = useCallback(() => {
        setFileMissing(true);
        if (fileMissingNotifiedRef.current) return;
        fileMissingNotifiedRef.current = true;
        onFileMissing?.();
    }, [onFileMissing]);

    // Route this file's diff fetch to the selected clone's server (AC-07).
    const cloneClient = useCocClient(workspaceId);

    // Monaco engine: load both full-text sides for this file and stage.
    const wantsEditor = diffEngine === 'monaco' && stage !== 'untracked';
    const contentKey = `${workspaceId}\u0000${stage}\u0000${filePath}\u0000${editorAttempt}`;
    const loadEditorContent = useCallback(async (): Promise<LoadedEditorContent> => {
        const content = await cloneClient.git.getWorkingTreeFileContent(workspaceId, filePath, stage as 'staged' | 'unstaged');
        if (stage !== 'staged') return { content, diskMatchesIndex: false, diskText: content.head.content };
        // The unstaged head is the disk file; a failed check keeps the diff read-only.
        const disk = await cloneClient.git.getWorkingTreeFileContent(workspaceId, filePath, 'unstaged').catch(() => null);
        return { content, diskMatchesIndex: stagedDiskMatchesIndex(content, disk), diskText: disk?.head.content ?? null };
    }, [cloneClient, workspaceId, filePath, stage]);
    useEffect(() => {
        if (!wantsEditor) return;
        let cancelled = false;
        setEditorContent({ key: contentKey, status: 'loading' });
        loadEditorContent()
            .then(loaded => { if (!cancelled) setEditorContent({ key: contentKey, status: 'loaded', ...loaded }); })
            .catch(() => { if (!cancelled) setEditorContent({ key: contentKey, status: 'failed' }); });
        return () => { cancelled = true; };
    }, [wantsEditor, contentKey, loadEditorContent]);

    const currentContent = editorContent?.key === contentKey ? editorContent : null;
    const contentLoadState: DiffContentLoadState | null = !currentContent ? null
        : currentContent.status === 'loaded'
            ? { status: 'loaded', binary: currentContent.content.binary, tooLarge: currentContent.content.tooLarge }
            : { status: currentContent.status };
    const engineSelection = resolveDiffEngineSelection({
        preference: diffEngine,
        stage,
        content: contentLoadState,
        editorFailed: editorFailedKey === contentKey,
    });
    const editorLoading = engineSelection.engine === 'loading';
    const editorSides = engineSelection.engine === 'monaco' && currentContent?.status === 'loaded'
        ? currentContent.content
        : null;
    const showEditor = editorSides !== null;
    // Classic renders for the legacy engine and when the editor cannot show this file.
    const classicActive = engineSelection.engine === 'legacy';
    const fallbackReason = engineSelection.engine === 'legacy' ? engineSelection.fallback : null;

    // Editing the modified (disk) side. `savedText` is what the last successful
    // save wrote; `editedText` the editor's text after the latest edit.
    const relativePath = repoRoot ? repoRelative(filePath, repoRoot) : filePath;
    const diskMatchesIndex = currentContent?.status === 'loaded' && currentContent.diskMatchesIndex;
    const editable = stage === 'unstaged' || (stage === 'staged' && diskMatchesIndex);
    const [editedText, setEditedText] = useState<string | null>(null);
    const [savedText, setSavedText] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    // A refresh that found the disk file changed under unsaved edits; the
    // banner offers Reload / Keep mine. `keptDiskText` is the disk text the
    // user chose to overwrite, so later refreshes of it stay quiet.
    const [diskChange, setDiskChange] = useState<({ key: string } & LoadedEditorContent) | null>(null);
    const [keptDiskText, setKeptDiskText] = useState<string | null>(null);
    // Re-mounts the editor when its buffer must be replaced by a text equal to
    // the current `modified` prop (which alone would not reset the editor).
    const [editorGeneration, setEditorGeneration] = useState(0);
    useEffect(() => {
        setEditedText(null);
        setSavedText(null);
        setSaveError(null);
        setDiskChange(null);
        setKeptDiskText(null);
    }, [contentKey]);
    const diskText = savedText ?? editorSides?.head.content ?? null;
    const isDirty = editedText !== null && editedText !== diskText;
    const shownModified = currentContent?.status === 'loaded' ? currentContent.content.head.content : null;
    const saveStateRef = useRef({ editedText, isDirty, diskText, shownModified, contentKey, workspaceId, relativePath });
    saveStateRef.current = { editedText, isDirty, diskText, shownModified, contentKey, workspaceId, relativePath };

    // Show freshly loaded sides, dropping any edits in the buffer.
    const applyLoadedContent = useCallback((key: string, loaded: LoadedEditorContent) => {
        const { editedText: buffer, shownModified: shown } = saveStateRef.current;
        const next = loaded.content.head.content;
        if (buffer !== null && buffer !== next && shown === next) setEditorGeneration(g => g + 1);
        setEditorContent({ key, status: 'loaded', ...loaded });
        setEditedText(null);
        setSavedText(null);
        setSaveError(null);
        setDiskChange(null);
        setKeptDiskText(null);
    }, []);

    // A git refresh (auto-refresh, agent edits) re-reads both sides. Clean:
    // reload silently. Dirty: never touch the buffer; flag a disk change.
    const handleRefreshedContent = useCallback((key: string, loaded: LoadedEditorContent) => {
        const { isDirty: dirty, diskText: disk, contentKey: currentKey } = saveStateRef.current;
        if (key !== currentKey) return;
        if (!dirty) {
            applyLoadedContent(key, loaded);
            return;
        }
        if (loaded.diskText !== disk) setDiskChange({ key, ...loaded });
    }, [applyLoadedContent]);
    const reloadFromDisk = useCallback(() => {
        if (!diskChange) return;
        const { key, ...loaded } = diskChange;
        applyLoadedContent(key, loaded);
        setEditorGeneration(g => g + 1);
    }, [diskChange, applyLoadedContent]);
    const keepMine = useCallback(() => {
        setKeptDiskText(diskChange?.diskText ?? null);
        setDiskChange(null);
    }, [diskChange]);
    const showDiskChangedBanner = isDirty && diskChange !== null && diskChange.key === contentKey
        && diskChange.diskText !== keptDiskText;
    const onSavedRef = useRef(onSaved);
    onSavedRef.current = onSaved;
    const handleSaveEdits = useCallback(async (): Promise<boolean> => {
        const { editedText: text, isDirty: dirty, workspaceId: ws, relativePath: path } = saveStateRef.current;
        if (!dirty || text === null) return true;
        try {
            await explorerApi.writeBlob(ws, path, text);
            setSavedText(text);
            setSaveError(null);
            setDiskChange(null);
            setKeptDiskText(null);
            onSavedRef.current?.();
            return true;
        } catch (err) {
            setSaveError(err instanceof Error && err.message ? err.message : 'Failed to save file');
            return false;
        }
    }, []);

    // The untracked view forwards these to its PreviewPane instead.
    const canSave = stage !== 'untracked' && editable && editorSides !== null;
    useEffect(() => {
        if (stage !== 'untracked') onDirtyChange?.(isDirty);
    }, [stage, isDirty, onDirtyChange]);
    useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
    useEffect(() => {
        if (!onRegisterSave || stage === 'untracked') return;
        if (!canSave) {
            onRegisterSave(null);
            return;
        }
        onRegisterSave(handleSaveEdits);
        return () => onRegisterSave(null);
    }, [stage, canSave, onRegisterSave, handleSaveEdits]);

    const handleEditorError = useCallback(() => setEditorFailedKey(contentKey), [contentKey]);
    const retryEditor = useCallback(() => setEditorAttempt(a => a + 1), []);

    const hunkNavRef: RefObject<HunkNavigationHandle | null> = showEditor ? monacoViewerRef : viewerRef;
    const { handleNext, handlePrev } = useCrossFileNav({
        filePath,
        files: workingTreeFiles ?? [],
        viewerRef: hunkNavRef,
        onNavigateToFile,
    });

    // Auto-scroll to target hunk after diff loads (for cross-file navigation)
    const hasScrolledRef = useRef(false);
    useEffect(() => {
        // The Monaco viewer applies initialHunkTarget itself once its diff is computed.
        if (!initialHunkTarget || !diff || loading || !classicActive || hasScrolledRef.current) return;
        hasScrolledRef.current = true;
        const timer = setTimeout(() => {
            const viewer = viewerRef.current;
            if (!viewer) return;
            const count = viewer.getHunkCount();
            if (count === 0) return;
            if (initialHunkTarget === 'first') {
                viewer.scrollToHunk(0);
            } else {
                viewer.scrollToHunk(count - 1);
            }
        }, 50);
        return () => clearTimeout(timer);
    }, [initialHunkTarget, diff, loading, classicActive]);

    const diffSelectionDragSource = useMemo<DiffSelectionDragSource>(
        () => ({ workspaceId, destinationId: attachmentDestinationId, filePath: relativePath, ref: stage === 'staged' ? { type: 'staged' } : { type: 'working-tree' } }),
        [workspaceId, attachmentDestinationId, relativePath, stage],
    );

    const diffContext = stage !== 'untracked'
        ? { repositoryId: workspaceId, filePath, oldRef: stage === 'staged' ? 'HEAD' : 'INDEX', newRef: 'working-tree' as const }
        : null;

    const { comments, loading: commentsLoading, addComment, deleteComment, updateComment,
            resolveComment, unresolveComment, runRelocation, askAI, aiLoadingIds, aiErrors,
            clearAiError, resolvingIds, deletingIds, copyAllCommentsAsPrompt } = useDiffComments(workspaceId, diffContext);

    // `quiet` keeps the current diff on screen while re-reading it (refresh).
    const fetchDiff = useCallback((full = false, quiet = false) => {
        if (stage === 'untracked') {
            setLoading(false);
            setDiff(null);
            setError(null);
            return;
        }
        if (!quiet) {
            setLoading(true);
            setError(null);
            setDiff(null);
        }
        cloneClient.git.getWorkingTreeFileDiff(workspaceId, filePath, { stage, full })
            .then(data => {
                setDiff(data.diff ?? '');
                setTruncated(!!data.truncated);
                setTotalLines(data.totalLines ?? 0);
                setError(null);
            })
            .catch(err => { if (!quiet) setError(err.message || 'Failed to load diff'); })
            .finally(() => { if (!quiet) setLoading(false); });
    }, [workspaceId, filePath, stage, cloneClient]);

    useEffect(() => {
        setFullRequested(false);
        fetchDiff();
    }, [fetchDiff]);

    useEffect(() => {
        if (fullRequested) fetchDiff(true);
    }, [fullRequested, fetchDiff]);

    const lastRefreshKeyRef = useRef(refreshKey);
    useEffect(() => {
        if (refreshKey === lastRefreshKeyRef.current) return;
        lastRefreshKeyRef.current = refreshKey;
        if (stage === 'untracked') return;
        fetchDiff(fullRequested, true);
        // Only a shown editor reloads; a loading one already reads fresh content.
        if (!wantsEditor || saveStateRef.current.shownModified === null) return;
        const key = saveStateRef.current.contentKey;
        loadEditorContent()
            .then(loaded => handleRefreshedContent(key, loaded))
            .catch(() => { /* keep what is shown */ });
    }, [refreshKey, stage, fullRequested, fetchDiff, wantsEditor, loadEditorContent, handleRefreshedContent]);

    const handleAddComment = useCallback(
        (selection: DiffCommentSelection, selectedText: string, position: { top: number; left: number }) => {
            setPopupState({ position, selection, selectedText });
        },
        [],
    );

    const handleCommentClick = useCallback((comment: DiffComment, event: React.MouseEvent) => {
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        setPopoverPos({ top: rect.bottom + 8, left: Math.max(8, rect.left) });
        setActivePopoverComment(comment);
    }, []);

    const handlePopupSubmit = useCallback(
        async (text: string, category: TaskCommentCategory) => {
            if (!popupState) return;
            await addComment(popupState.selection, popupState.selectedText, text, category);
            setPopupState(null);
        },
        [popupState, addComment],
    );

    const handleAskAI = useCallback(
        (id: string, commandId: string, customQuestion?: string) => {
            void askAI(id, { commandId, customQuestion });
        },
        [askAI],
    );

    const handleAskAIDiff = useCallback(
        (selection: DiffCommentSelection, selectedText: string) => {
            const contextStr = buildDiffContext({ selectedText, selection, filePath });
            queueDispatch({ type: 'OPEN_DIALOG', workspaceId, mode: 'ask', initialPrompt: contextStr, launchMode: 'floating-chat' });
        },
        [filePath, workspaceId, queueDispatch],
    );

    const handleCopyAsContext = useCallback(
        (selection: DiffCommentSelection, selectedText: string) => {
            const contextStr = buildDiffContext({ selectedText, selection, filePath });
            void copyToClipboard(contextStr);
        },
        [filePath],
    );

    const handleSidebarCommentClick = useCallback((comment: AnyComment) => {
        if (showEditor) {
            monacoViewerRef.current?.revealComment(comment.id);
            return;
        }
        const dc = comment as DiffComment;
        const lineIdx = dc.selection?.diffLineStart;
        if (lineIdx == null) return;
        const el = scrollContainerRef.current?.querySelector<HTMLElement>(`[data-diff-line-index="${lineIdx}"]`);
        if (!el) return;
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-yellow-400');
        setTimeout(() => el.classList.remove('ring-2', 'ring-yellow-400'), 1500);
    }, [showEditor]);

    // Editor engine: the same thread card the sidebar shows, inline under the line.
    const insertDraftIntoCurrentChat = useCurrentChatInsertDraft();
    const renderCommentThread = useCallback((comment: DiffComment) => (
        <CommentCard
            comment={comment}
            onResolve={() => { void resolveComment(comment.id); }}
            onUnresolve={() => { void unresolveComment(comment.id); }}
            onEdit={(text) => { void updateComment(comment.id, { comment: text }); }}
            onDelete={() => { void deleteComment(comment.id); }}
            onAskAI={(commandId, question) => handleAskAI(comment.id, commandId, question)}
            onClick={() => undefined}
            aiLoading={aiLoadingIds.has(comment.id)}
            aiError={aiErrors.get(comment.id) ?? null}
            onClearAiError={() => clearAiError(comment.id)}
            isResolving={resolvingIds.has(comment.id)}
            isDeleting={deletingIds.has(comment.id)}
            getResolvePrompt={() => formatDiffCommentPrompt(comment)}
            onSendResolvePrompt={insertDraftIntoCurrentChat}
        />
    ), [resolveComment, unresolveComment, updateComment, deleteComment, handleAskAI, aiLoadingIds, aiErrors, clearAiError, resolvingIds, deletingIds, insertDraftIntoCurrentChat]);

    return (
        <div className="working-tree-file-diff flex flex-col h-full overflow-hidden" data-testid="working-tree-file-diff">
            {/* Header bar */}
            <div className="px-4 py-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#fafafa] dark:bg-[#252526]" data-testid="working-tree-file-diff-header">
                <div className="flex items-center gap-2">
                    <TruncatedPath path={filePath} className="text-sm font-semibold text-[#1e1e1e] dark:text-[#ccc] flex-1" />
                    {canSave && isDirty && (
                        <span
                            className="text-xs text-[#0078d4] dark:text-[#3794ff] flex-shrink-0"
                            title="Unsaved changes"
                            aria-label="Unsaved changes"
                            data-testid="working-tree-file-diff-dirty"
                        >
                            ●
                        </span>
                    )}
                    {canSave && (
                        <button
                            onClick={() => { void handleSaveEdits(); }}
                            disabled={!isDirty}
                            title="Save (Ctrl/Cmd+S)"
                            className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08] disabled:opacity-40 disabled:hover:bg-transparent"
                            data-testid="working-tree-file-diff-save-btn"
                        >
                            Save
                        </button>
                    )}
                    <HunkNavButtons onPrev={handlePrev} onNext={handleNext} />
                    {stage !== 'untracked' && <DiffEngineToggle engine={diffEngine} onChange={setDiffEngine} />}
                    {stage !== 'untracked' && <DiffViewToggle mode={viewMode} onChange={setViewMode} />}
                    <span className="text-xs text-[#616161] dark:text-[#999] flex-shrink-0">{STAGE_LABEL[stage]}</span>
                    {stage !== 'untracked' && (
                        <button
                            onClick={() => setSidebarOpen(o => !o)}
                            title="Toggle comments"
                            className="text-xs px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                            data-testid="toggle-comments-btn"
                        >
                            💬 {comments.length > 0 ? comments.length : ''}
                        </button>
                    )}
                </div>
            </div>

            {/* Diff view + sidebar */}
            <div className="flex flex-1 min-h-0">
                <div ref={scrollContainerRef} className="flex-1 overflow-auto px-1 py-1" data-testid="working-tree-file-diff-section">
                    {saveError && (
                        <div className="px-3 py-1 text-xs text-[#d32f2f] dark:text-[#f48771]" data-testid="working-tree-file-diff-save-error">
                            Save failed: {saveError}
                        </div>
                    )}
                    {showDiskChangedBanner && (
                        <div
                            className="flex items-center gap-2 px-3 py-1 text-xs bg-[#fff3cd] dark:bg-[#3a3000]"
                            data-testid="working-tree-file-diff-disk-changed"
                        >
                            <span className="flex-1">File changed on disk.</span>
                            <button
                                onClick={reloadFromDisk}
                                title="Drop your edits and load the file from disk"
                                className="px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                                data-testid="working-tree-file-diff-reload-btn"
                            >
                                Reload
                            </button>
                            <button
                                onClick={keepMine}
                                title="Keep your edits; the next save overwrites the disk file"
                                className="px-2 py-0.5 rounded hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                                data-testid="working-tree-file-diff-keep-mine-btn"
                            >
                                Keep mine
                            </button>
                        </div>
                    )}
                    {stage === 'staged' && editorSides && !diskMatchesIndex && (
                        <div className="px-3 py-1 text-xs text-[#616161] dark:text-[#999]" data-testid="working-tree-file-diff-staged-readonly-note">
                            File has unstaged changes — edit it in the Unstaged diff.
                        </div>
                    )}
                    {fallbackReason && (
                        <DiffEngineFallbackBanner reason={fallbackReason} onRetry={retryEditor} />
                    )}
                    {stage === 'untracked' && fileMissing ? (
                        <div
                            className="flex flex-col items-start gap-1 px-4 py-4"
                            data-testid="working-tree-file-diff-missing"
                        >
                            <span className="text-xs font-medium text-[#616161] dark:text-[#999]">
                                This file no longer exists on disk.
                            </span>
                            <span className="text-xs text-[#848484]">
                                The change list was out of date and has been refreshed.
                            </span>
                        </div>
                    ) : stage === 'untracked' ? (
                        <div className="h-full w-full" data-testid="working-tree-file-diff-untracked">
                            <PreviewPane
                                key={attachmentDestinationId ?? workspaceId}
                                repoId={workspaceId}
                                routingRef={attachmentDestinationId && attachmentDestinationId !== workspaceId
                                    ? attachmentDestinationId : null}
                                filePath={relativePath}
                                fileName={filePath.split('/').pop() ?? filePath}
                                onNotFound={handlePreviewNotFound}
                                onDirtyChange={onDirtyChange}
                                onRegisterSave={onRegisterSave}
                            />
                        </div>
                    ) : editorSides ? (
                        <MonacoFileDiffViewer
                            key={editorGeneration}
                            ref={monacoViewerRef}
                            workspaceId={workspaceId}
                            relativePath={relativePath}
                            stage={stage as 'staged' | 'unstaged'}
                            editable={editable}
                            modifiedMatchesWorkingCopy={stage === 'staged' ? diskMatchesIndex : undefined}
                            onModifiedChange={setEditedText}
                            onSave={() => { void handleSaveEdits(); }}
                            editedText={editedText}
                            savedText={savedText}
                            original={editorSides.base.content}
                            modified={editorSides.head.content}
                            viewMode={viewMode}
                            initialHunkTarget={initialHunkTarget}
                            onLinesReady={(lines) => { setDiffLines(lines); runRelocation(lines); }}
                            onEditorError={handleEditorError}
                            comments={comments}
                            renderCommentThread={renderCommentThread}
                            onAddComment={handleAddComment}
                            onAskAI={handleAskAIDiff}
                            onCopyAsContext={handleCopyAsContext}
                            diffSelectionDragSource={diffSelectionDragSource}
                            createEditor={createDiffEditor}
                            data-testid="working-tree-file-diff-editor"
                        />
                    ) : loading || editorLoading ? (
                        <div className="flex items-center gap-2 text-xs text-[#848484]" data-testid="working-tree-file-diff-loading">
                            <Spinner size="sm" /> Loading diff...
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2" data-testid="working-tree-file-diff-error">
                            <span className="text-xs text-[#d32f2f] dark:text-[#f48771]">{error}</span>
                            <Button variant="secondary" size="sm" onClick={() => fetchDiff()} data-testid="working-tree-file-diff-retry-btn">Retry</Button>
                        </div>
                    ) : diff ? (
                        <>
                            {viewMode === 'split' ? (
                                <SideBySideDiffViewer
                                    ref={viewerRef}
                                    diff={diff}
                                    fileName={filePath}
                                    enableComments
                                    showLineNumbers
                                    comments={comments}
                                    onLinesReady={(lines) => { setDiffLines(lines); runRelocation(lines); }}
                                    onAddComment={handleAddComment}
                                    onAskAI={handleAskAIDiff}
                                    onCopyAsContext={handleCopyAsContext}
                                    onCommentClick={handleCommentClick}
                                    diffSelectionDragSource={diffSelectionDragSource}
                                    data-testid="working-tree-file-diff-content"
                                />
                            ) : (
                                <UnifiedDiffViewer
                                    ref={viewerRef}
                                    diff={diff}
                                    fileName={filePath}
                                    enableComments
                                    showLineNumbers
                                    comments={comments}
                                    onLinesReady={(lines) => { setDiffLines(lines); runRelocation(lines); }}
                                    onAddComment={handleAddComment}
                                    onAskAI={handleAskAIDiff}
                                    onCopyAsContext={handleCopyAsContext}
                                    onCommentClick={handleCommentClick}
                                    diffSelectionDragSource={diffSelectionDragSource}
                                    data-testid="working-tree-file-diff-content"
                                />
                            )}
                            {truncated && !fullRequested && (
                                <div className="flex items-center gap-2 px-4 py-2 text-xs bg-[#fff3cd] dark:bg-[#3a3000] border-t border-[#e0e0e0] dark:border-[#3c3c3c]" data-testid="diff-truncation-banner">
                                    <span>Diff truncated (showing first 5,000 of {totalLines.toLocaleString()} lines).</span>
                                    <button
                                        className="text-[#0366d6] dark:text-[#58a6ff] underline hover:no-underline font-medium"
                                        onClick={() => setFullRequested(true)}
                                        data-testid="load-full-diff-btn"
                                    >
                                        Load full diff
                                    </button>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="text-xs text-[#848484]" data-testid="working-tree-file-diff-empty">(no changes)</div>
                    )}
                </div>
                {diff && !loading && !error && classicActive && stage !== 'untracked' && (
                    <DiffMiniMap diffLines={diffLines} scrollContainerRef={scrollContainerRef} />
                )}

                {sidebarOpen && stage !== 'untracked' && (
                    <CommentSidebar
                        taskId={workspaceId}
                        filePath={filePath}
                        comments={comments}
                        loading={commentsLoading}
                        onResolve={(id) => { void resolveComment(id); }}
                        onUnresolve={(id) => { void unresolveComment(id); }}
                        onDelete={(id) => { void deleteComment(id); }}
                        onEdit={(id, text) => { void updateComment(id, { comment: text }); }}
                        onAskAI={handleAskAI}
                        onCommentClick={handleSidebarCommentClick}
                        aiLoadingIds={aiLoadingIds}
                        aiErrors={aiErrors}
                        onClearAiError={clearAiError}
                        resolvingIds={resolvingIds}
                        deletingIds={deletingIds}
                        onCopyPrompt={copyAllCommentsAsPrompt}
                        onClose={() => setSidebarOpen(false)}
                        data-testid="diff-comment-sidebar"
                    />
                )}
            </div>

            {popupState && (
                <InlineCommentPopup
                    position={popupState.position}
                    onSubmit={handlePopupSubmit}
                    onCancel={() => setPopupState(null)}
                />
            )}

            {activePopoverComment && popoverPos && (
                <CommentPopover
                    comment={activePopoverComment}
                    position={popoverPos}
                    onClose={() => setActivePopoverComment(null)}
                    onResolve={(id) => { void resolveComment(id); }}
                    onUnresolve={(id) => { void unresolveComment(id); }}
                    onDelete={(id) => { void deleteComment(id); setActivePopoverComment(null); }}
                    onEdit={(id, text) => { void updateComment(id, { comment: text }); }}
                    onAskAI={handleAskAI}
                    aiLoading={aiLoadingIds.has(activePopoverComment.id)}
                    aiError={aiErrors.get(activePopoverComment.id) ?? null}
                    onClearAiError={clearAiError}
                    isResolving={resolvingIds.has(activePopoverComment.id)}
                    isDeleting={deletingIds.has(activePopoverComment.id)}
                />
            )}
        </div>
    );
}

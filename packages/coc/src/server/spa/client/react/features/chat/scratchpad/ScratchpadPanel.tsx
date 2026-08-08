import React, { useState, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { NoteEditor } from '../../notes/editor/NoteEditor';
import { CommentsSidebar } from '../../notes/editor/CommentsSidebar';
import { AddCommentDialog } from '../../notes/editor/NotesDialogs';
import { useComments } from '../../notes/editor/useComments';
import { notesApi } from '../../notes/notesApi';
import { createTextAnchorFromSelection, findAnchorInDoc, applyCommentMark, revealCommentThread } from '../../notes/editor/commentAnchoring';
import type { TextAnchor } from '../../notes/editor/textAnchor';
import { ScratchpadDivider } from './ScratchpadDivider';
import type { ScratchpadExpandMode } from './useScratchpadState';

/** Props passed when the panel should render a horizontal header bar at its top (vertical layout). */
export interface ScratchpadHeaderBarProps {
    expandMode: ScratchpadExpandMode;
    isDragging: boolean;
    onExpandTop: () => void;
    onExpandBottom: () => void;
    onSplitReset: () => void;
    files?: string[];
    onSelectFile?: (path: string) => void;
    /** Absolute workspace root used to copy scratchpad tab paths as full paths. */
    workspaceRootPath?: string;
    /** When true, the expand-mode buttons are omitted. Used on mobile. */
    hideModeControls?: boolean;
}

export interface ScratchpadPanelProps {
    workspaceId: string;
    notePath: string | null;
    onClose: () => void;
    height: number | string;
    /** Called when the note file is not found (404); closes the panel silently. */
    onNotFound?: () => void;
    /** processId of the parent chat — when set, resolve-with-AI sends a follow-up instead of a new task. */
    parentProcessId?: string;
    /** Current chat mode — passed through to resolve-with-AI follow-ups so they run in the user's selected mode. */
    selectedMode?: 'ask' | 'autopilot';
    /**
     * When provided, renders a horizontal header bar at the top of the panel containing
     * file tabs and control icons. Used in vertical (side-by-side) layout where the divider
     * is a thin drag-only strip and the chrome lives here instead.
     */
    headerBar?: ScratchpadHeaderBarProps;
}


export function ScratchpadPanel({ workspaceId, notePath, height, onNotFound, onClose, parentProcessId, selectedMode, headerBar }: ScratchpadPanelProps) {
    // ── Comments state (ephemeral — not persisted) ──────────────────────────
    const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const editorRef = useRef<Editor | null>(null);

    // Pending state for the "Add Comment" dialog
    const [pendingComment, setPendingComment] = useState<{
        anchor: TextAnchor;
        from: number;
        to: number;
    } | null>(null);

    const comments = useComments({
        workspaceId,
        notePath,
        parentProcessId,
        selectedMode,
    });

    // ── Wrapped delete/resolve/reopen that sync editor marks ────────────────

    const handleDeleteThread = useCallback(async (threadId: string) => {
        await comments.deleteThread(threadId);
        editorRef.current?.commands.unsetComment(threadId);
    }, [comments]);

    const handleResolveThread = useCallback(async (threadId: string) => {
        await comments.resolveThread(threadId);
        editorRef.current?.commands.unsetComment(threadId);
    }, [comments]);

    const handleReopenThread = useCallback(async (threadId: string) => {
        await comments.reopenThread(threadId);
        const editor = editorRef.current;
        if (!editor) return;
        const thread = comments.threads.find(t => t.id === threadId);
        if (!thread) return;
        const result = findAnchorInDoc(editor.state.doc, thread.anchor);
        if (result) {
            applyCommentMark(editor, threadId, result.from, result.to);
        }
    }, [comments]);

    const wrappedComments: typeof comments = {
        ...comments,
        deleteThread: handleDeleteThread,
        resolveThread: handleResolveThread,
        reopenThread: handleReopenThread,
    };

    // ── Comment creation handler ────────────────────────────────────────────

    const handleCommentCreate = useCallback(() => {
        const editor = editorRef.current;
        if (!editor || editor.state.selection.empty || !notePath) return;

        const anchor = createTextAnchorFromSelection(editor);
        if (!anchor) return;

        const { from, to } = editor.state.selection;
        setPendingComment({ anchor, from, to });
        // Panel opens only after the user confirms the dialog
    }, [notePath]);

    const handleCommentDialogConfirm = useCallback(async (text: string) => {
        if (!pendingComment) return;
        const { anchor, from, to } = pendingComment;
        setPendingComment(null);

        // Open the panel first so a failed create surfaces its error in the sidebar.
        setCommentsPanelOpen(true);

        const created = await comments.createThread(anchor, text).catch(() => null);
        if (!created) return;

        const editor = editorRef.current;
        if (!editor) return;
        const saved = { from: editor.state.selection.from, to: editor.state.selection.to };
        editor.chain()
            .setTextSelection({ from, to })
            .setComment(created.id)
            .setTextSelection(saved)
            .run();
    }, [pendingComment, comments]);

    // ── Sidebar → editor thread select handler ──────────────────────────────

    const handleThreadSelect = useCallback((threadId: string | null) => {
        setActiveCommentId(threadId);

        const editor = editorRef.current;
        if (!editor || !threadId) return;

        revealCommentThread(editor, threadId, comments.threads.find(t => t.id === threadId));
    }, [comments.threads]);

    // ── Resolve with AI handler ─────────────────────────────────────────────

    const handleResolveWithAI = useCallback(async () => {
        if (!notePath) return;
        const { content } = await notesApi.getContent(workspaceId, notePath);
        await comments.resolveWithAI(content);
    }, [notePath, workspaceId, comments]);

    // ── Layout ──────────────────────────────────────────────────────────────

    const style: React.CSSProperties = height === 'auto'
        ? { flex: '1 1 auto', minHeight: 0 }
        : { height, minHeight: 0 };

    const commentsVisible = commentsPanelOpen && !!notePath;

    return (
        <div
            className="flex flex-col overflow-hidden bg-white dark:bg-[#1e1e1e]"
            style={style}
            data-testid="scratchpad-panel"
        >
            {headerBar && (
                <ScratchpadDivider
                    linkedNotePath={notePath}
                    expandMode={headerBar.expandMode}
                    isDragging={headerBar.isDragging}
                    onOpenFilePicker={() => { /* files are discovered from conversation */ }}
                    onExpandTop={headerBar.onExpandTop}
                    onExpandBottom={headerBar.onExpandBottom}
                    onSplitReset={headerBar.onSplitReset}
                    onClose={onClose}
                    files={headerBar.files}
                    onSelectFile={headerBar.onSelectFile}
                    workspaceRootPath={headerBar.workspaceRootPath}
                    layout="horizontal"
                    panelHeader
                    hideModeControls={headerBar.hideModeControls}
                />
            )}
            <div className={`flex-1 min-h-0 flex ${commentsVisible ? 'flex-row' : 'flex-col'}`}>
                <div className="flex-1 min-w-0 min-h-0 flex flex-col">
                    <NoteEditor
                        workspaceId={workspaceId}
                        notePath={notePath}
                        onNotFound={onNotFound}
                        threads={comments.allThreads}
                        onCommentActivated={setActiveCommentId}
                        onEditorReady={(ed) => { editorRef.current = ed; }}
                        onCommentCreate={handleCommentCreate}
                        commentsEnabled={true}
                        commentsPanelOpen={commentsPanelOpen}
                        onToggleCommentsPanel={() => setCommentsPanelOpen((v) => !v)}
                        commentCount={wrappedComments.totalCount}
                    />
                </div>

                {/* Right-side comments sidebar */}
                {commentsVisible && (
                    <div
                        className="w-64 flex-shrink-0 border-l border-[#e0e0e0] dark:border-[#3c3c3c] flex flex-col overflow-hidden"
                        data-testid="scratchpad-comments-panel"
                    >
                        <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c] flex-shrink-0">
                            <span className="text-xs font-semibold text-[#616161] dark:text-[#ccc] uppercase tracking-wide">
                                Comments
                            </span>
                            <button
                                className="text-xs text-[#888] hover:text-[#333] dark:hover:text-white"
                                onClick={() => setCommentsPanelOpen(false)}
                                data-testid="scratchpad-comments-close"
                                aria-label="Close comments panel"
                            >
                                ✕
                            </button>
                        </div>
                        <div className="overflow-y-auto flex-1">
                            <CommentsSidebar
                                workspaceId={workspaceId}
                                notePath={notePath}
                                selectedThreadId={activeCommentId}
                                onThreadSelect={handleThreadSelect}
                                comments={wrappedComments}
                                onResolveWithAI={handleResolveWithAI}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Add Comment dialog */}
            <AddCommentDialog
                open={pendingComment !== null}
                quotedText={pendingComment?.anchor.quotedText ?? ''}
                onConfirm={handleCommentDialogConfirm}
                onClose={() => setPendingComment(null)}
            />
        </div>
    );
}

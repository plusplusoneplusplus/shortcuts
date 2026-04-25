import React, { useState, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { NoteEditor } from '../../notes/editor/NoteEditor';
import { CommentsSidebar } from '../../notes/editor/CommentsSidebar';
import { useComments } from '../../notes/editor/useComments';
import { createTextAnchorFromSelection, findAnchorInDoc, applyCommentMark } from '../../notes/editor/commentAnchoring';
import { useQueue } from '../../../contexts/QueueContext';

export interface ScratchpadPanelProps {
    workspaceId: string;
    notePath: string | null;
    onClose: () => void;
    height: number | string;
    /** Called when the note file is not found (404); closes the panel silently. */
    onNotFound?: () => void;
}

function isPlanFile(notePath: string | null): boolean {
    if (!notePath) return false;
    const name = notePath.replace(/\\/g, '/').split('/').pop() ?? '';
    return name === 'plan.md' || name.endsWith('.plan.md');
}

export function ScratchpadPanel({ workspaceId, notePath, height, onNotFound }: ScratchpadPanelProps) {
    const { dispatch: queueDispatch } = useQueue();

    // ── Comments state (ephemeral — not persisted) ──────────────────────────
    const [commentsPanelOpen, setCommentsPanelOpen] = useState(false);
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const editorRef = useRef<Editor | null>(null);

    const comments = useComments({
        workspaceId,
        notePath,
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
        comments.createThread(anchor, '').then((created) => {
            const currentEditor = editorRef.current;
            if (!currentEditor) return;
            const saved = { from: currentEditor.state.selection.from, to: currentEditor.state.selection.to };
            currentEditor.chain()
                .setTextSelection({ from, to })
                .setComment(created.id)
                .setTextSelection(saved)
                .run();
        }).catch(() => { /* thread creation failed — sidebar shows error */ });

        setCommentsPanelOpen(true);
    }, [notePath, comments]);

    // ── Sidebar → editor thread select handler ──────────────────────────────

    const handleThreadSelect = useCallback((threadId: string | null) => {
        setActiveCommentId(threadId);

        const editor = editorRef.current;
        if (!editor || !threadId) return;

        let markFrom: number | null = null;
        let markTo: number | null = null;
        editor.state.doc.descendants((node, pos) => {
            if (!node.isText) return;
            const commentMark = node.marks.find(
                (m) => m.type.name === 'comment' && m.attrs.commentId === threadId,
            );
            if (commentMark) {
                if (markFrom === null) markFrom = pos;
                markTo = pos + node.nodeSize;
            }
        });

        if (markFrom !== null && markTo !== null) {
            editor.chain()
                .setTextSelection({ from: markFrom, to: markTo })
                .scrollIntoView()
                .run();
        }
    }, []);

    // ── Layout ──────────────────────────────────────────────────────────────

    const style: React.CSSProperties = height === 'auto'
        ? { flex: '1 1 auto', minHeight: 0 }
        : { height, minHeight: 0 };

    const runSkillButton = isPlanFile(notePath) ? (
        <button
            type="button"
            title="Run Skill"
            data-testid="scratchpad-run-skill"
            className="h-7 px-2 rounded text-xs hover:bg-[#e0e0e0] dark:hover:bg-[#505050]"
            onMouseDown={(e) => {
                e.preventDefault();
                queueDispatch({
                    type: 'OPEN_DIALOG',
                    workspaceId,
                    contextFiles: [notePath!],
                });
            }}
        >⚡</button>
    ) : null;

    const commentsVisible = commentsPanelOpen && !!notePath;

    return (
        <div
            className="flex flex-col overflow-hidden bg-white dark:bg-[#1e1e1e]"
            style={style}
            data-testid="scratchpad-panel"
        >
            <div className="flex-1 min-h-0 flex flex-col">
                <NoteEditor
                    workspaceId={workspaceId}
                    notePath={notePath}
                    onNotFound={onNotFound}
                    toolbarRight={runSkillButton}
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

            {/* Collapsible bottom comments drawer */}
            {commentsVisible && (
                <div
                    className="flex-shrink-0 border-t border-[#e0e0e0] dark:border-[#3c3c3c] overflow-y-auto"
                    style={{ maxHeight: '40%' }}
                    data-testid="scratchpad-comments-panel"
                >
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
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
                    <CommentsSidebar
                        workspaceId={workspaceId}
                        notePath={notePath}
                        selectedThreadId={activeCommentId}
                        onThreadSelect={handleThreadSelect}
                        comments={wrappedComments}
                    />
                </div>
            )}
        </div>
    );
}

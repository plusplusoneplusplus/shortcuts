import { useState, useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { ResponsiveSidebar } from '../shared/ResponsiveSidebar';
import { NotesSidebar } from './notes/NotesSidebar';
import { NoteEditor } from './notes/NoteEditor';
import { CommentsSidebar } from './notes/CommentsSidebar';
import { useComments } from './notes/useComments';
import { createTextAnchorFromSelection, findAnchorInDoc } from './notes/commentAnchoring';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useApp } from '../context/AppContext';
import { buildNoteHash } from '../layout/Router';

export interface NotesViewProps {
    workspaceId: string;
    initialNotePath?: string | null;
}

export function NotesView({ workspaceId, initialNotePath }: NotesViewProps) {
    const { dispatch } = useApp();
    const [selectedPath, setSelectedPath] = useState<string | null>(initialNotePath ?? null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { isMobile } = useBreakpoint();

    // ── Comments state ──────────────────────────────────────────────────────

    const [commentsPanelOpen, setCommentsPanelOpen] = useState(() => {
        try { return localStorage.getItem('coc-notes-comments-panel-open') === 'true'; }
        catch { return false; }
    });
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const editorRef = useRef<Editor | null>(null);

    useEffect(() => {
        try { localStorage.setItem('coc-notes-comments-panel-open', String(commentsPanelOpen)); }
        catch { /* ignore */ }
    }, [commentsPanelOpen]);

    const comments = useComments({
        workspaceId,
        notePath: selectedPath,
    });

    // Reset active comment when switching notes
    useEffect(() => {
        setActiveCommentId(null);
    }, [selectedPath]);

    // ── Comment creation handler ────────────────────────────────────────────

    const handleCommentCreate = useCallback(() => {
        const editor = editorRef.current;
        if (!editor || editor.state.selection.empty || !selectedPath) return;

        const anchor = createTextAnchorFromSelection(editor);
        if (!anchor) return;

        // Capture selection range for mark application after server responds
        const { from, to } = editor.state.selection;

        // Create the thread on the server, then apply the mark
        comments.createThread(anchor, '').then((created) => {
            const currentEditor = editorRef.current;
            if (!currentEditor) return;

            // Apply comment mark at the original range
            const saved = { from: currentEditor.state.selection.from, to: currentEditor.state.selection.to };
            currentEditor.chain()
                .setTextSelection({ from, to })
                .setComment(created.id)
                .setTextSelection(saved)
                .run();
        }).catch(() => { /* thread creation failed — sidebar shows error */ });

        // Open comments panel immediately
        setCommentsPanelOpen(true);
    }, [selectedPath, comments]);

    // ── Sidebar → Editor selection handler ──────────────────────────────────

    const handleThreadSelect = useCallback((threadId: string | null) => {
        setActiveCommentId(threadId);

        const editor = editorRef.current;
        if (!editor || !threadId) return;

        // Find the comment mark in the editor by scanning marks
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

    // ── Navigation ──────────────────────────────────────────────────────────

    // Sync from external deep-link changes (e.g. back/forward navigation)
    useEffect(() => {
        if (initialNotePath !== undefined && initialNotePath !== selectedPath) {
            setSelectedPath(initialNotePath);
        }
    }, [initialNotePath]);

    const updateHash = useCallback((path: string | null) => {
        const target = path
            ? buildNoteHash(workspaceId, path)
            : '#repos/' + encodeURIComponent(workspaceId) + '/notes';
        if (location.hash !== target) {
            location.hash = target;
        }
    }, [workspaceId]);

    const handleSelectPage = useCallback((path: string) => {
        setSelectedPath(path);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: path });
        updateHash(path);
        if (isMobile) setSidebarOpen(false);
    }, [isMobile, dispatch, updateHash]);

    const handleNoteRenamed = useCallback((oldPath: string, newPath: string) => {
        if (selectedPath === oldPath || selectedPath?.startsWith(oldPath + '/')) {
            const updated = selectedPath === oldPath
                ? newPath
                : newPath + selectedPath.substring(oldPath.length);
            setSelectedPath(updated);
            dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: updated });
            updateHash(updated);
        }
    }, [selectedPath, dispatch, updateHash]);

    const handleNoteCreated = useCallback((path: string) => {
        setSelectedPath(path);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: path });
        updateHash(path);
    }, [dispatch, updateHash]);

    const handleNoteDeleted = useCallback((path: string) => {
        if (selectedPath === path || selectedPath?.startsWith(path + '/')) {
            setSelectedPath(null);
            dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: null });
            updateHash(null);
        }
    }, [selectedPath, dispatch, updateHash]);

    // ── Render ──────────────────────────────────────────────────────────────

    return (
        <div className="flex h-full" data-testid="notes-view">
            {/* Left: notes tree sidebar */}
            <ResponsiveSidebar
                width={280}
                tabletWidth={220}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            >
                <NotesSidebar
                    workspaceId={workspaceId}
                    selectedPath={selectedPath}
                    onSelectPage={handleSelectPage}
                    onNoteRenamed={handleNoteRenamed}
                    onNoteCreated={handleNoteCreated}
                    onNoteDeleted={handleNoteDeleted}
                />
            </ResponsiveSidebar>

            {/* Center: editor */}
            <div className="flex-1 flex flex-col min-w-0" data-testid="notes-content">
                {isMobile && (
                    <div className="h-10 flex items-center px-3 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <button
                            className="text-xs text-[#0078d4] hover:underline"
                            onClick={() => setSidebarOpen(true)}
                            data-testid="notes-mobile-menu-btn"
                        >
                            ☰ Notes
                        </button>
                        <div className="flex-1" />
                        {selectedPath && (
                            <button
                                className="text-xs text-[#0078d4] hover:underline"
                                onClick={() => setCommentsPanelOpen((v) => !v)}
                                data-testid="notes-mobile-comments-btn"
                            >
                                💬
                            </button>
                        )}
                    </div>
                )}
                {/* Desktop/tablet comments toggle */}
                {!isMobile && selectedPath && (
                    <div className="flex items-center justify-end px-2 py-0.5">
                        <button
                            className={
                                'text-xs px-2 py-0.5 rounded ' +
                                (commentsPanelOpen
                                    ? 'bg-[#e8e8e8] dark:bg-[#3c3c3c] text-[#333] dark:text-white'
                                    : 'text-[#888] hover:text-[#333] dark:hover:text-white')
                            }
                            onClick={() => setCommentsPanelOpen((v) => !v)}
                            data-testid="comments-panel-toggle"
                            aria-label={commentsPanelOpen ? 'Hide comments' : 'Show comments'}
                        >
                            💬{comments.threads.length > 0 && (
                                <span className="ml-1 text-[10px]" data-testid="comments-toggle-count">
                                    {comments.totalCount}
                                </span>
                            )}
                        </button>
                    </div>
                )}
                <NoteEditor
                    workspaceId={workspaceId}
                    notePath={selectedPath}
                    onCommentActivated={setActiveCommentId}
                    onEditorReady={(ed) => { editorRef.current = ed; }}
                    onCommentCreate={handleCommentCreate}
                    commentsEnabled={true}
                />
            </div>

            {/* Right: comments panel (collapsible) */}
            {commentsPanelOpen && selectedPath && (
                <div
                    className="w-72 border-l border-[#e0e0e0] dark:border-[#333] flex-shrink-0 overflow-y-auto bg-white dark:bg-[#1e1e1e]"
                    data-testid="comments-panel"
                >
                    <div className="flex items-center justify-between px-3 py-2 border-b border-[#e0e0e0] dark:border-[#3c3c3c]">
                        <span className="text-xs font-semibold text-[#616161] dark:text-[#ccc] uppercase tracking-wide">
                            Comments
                        </span>
                        <button
                            className="text-xs text-[#888] hover:text-[#333] dark:hover:text-white"
                            onClick={() => setCommentsPanelOpen(false)}
                            data-testid="comments-panel-close"
                            aria-label="Close comments panel"
                        >
                            ✕
                        </button>
                    </div>
                    <CommentsSidebar
                        workspaceId={workspaceId}
                        notePath={selectedPath}
                        selectedThreadId={activeCommentId}
                        onThreadSelect={handleThreadSelect}
                        comments={comments}
                    />
                </div>
            )}
        </div>
    );
}

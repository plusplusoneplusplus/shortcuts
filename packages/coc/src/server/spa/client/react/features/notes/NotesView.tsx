import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { ResponsiveSidebar } from '../../ui/ResponsiveSidebar';
import { DockedStatusFooter } from '../../layout/DockedStatusFooter';
import { NotesSidebar } from './editor/NotesSidebar';
import { NoteEditor } from './editor/NoteEditor';
import type { NoteViewMode } from './editor/NoteEditor';
import { CommentsSidebar } from './editor/CommentsSidebar';
import { NoteChatPanel } from './editor/NoteChatPanel';
import type { NotesChatWindowMode } from './editor/NotesChatHeader';
import type { ChatScope } from './hooks/useNotesChat';
import { useComments } from './editor/useComments';
import { notesApi } from './notesApi';
import { createTextAnchorFromSelection, findAnchorInDoc, applyCommentMark } from './editor/commentAnchoring';
import type { TextAnchor } from './editor/textAnchor';
import { AddCommentDialog } from './editor/NotesDialogs';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { usePublishWorkspaceLeftColWidth } from '../../hooks/ui/useWorkspaceLeftColWidth';
import { useApp } from '../../contexts/AppContext';
import { buildNoteHash } from '../../layout/Router';
import { useNoteReferences } from './editor/useNoteReferences';
import { useNotesRoots } from './hooks/useNotesRoots';
import { ReviewChatPlacementFrame } from '../git/reviewChat/ReviewChatPlacementFrame';
import { useReviewChatPresentation } from '../git/hooks/useReviewChatPresentation';
import type { ReviewChatTarget } from '../git/commits/commitChatPlacement';

export interface NotesViewProps {
    workspaceId: string;
    initialNotePath?: string | null;
    /** Default chat scope for the NoteChatPanel. Defaults to 'per-workspace'. */
    defaultScope?: ChatScope;
    /**
     * Whether this Notes tab is the active/visible sub-tab. Views are kept
     * mounted-but-hidden across tab switches, so only the active one publishes
     * its sidebar width to the global status dock. Defaults to `true` for
     * standalone use. */
    active?: boolean;
    /**
     * When true, dock the shared status/action cluster in this view's own
     * NotesSidebar footer (remote-first shell). Hosts that already provide a
     * body-level `DockedStatusFooter` for all their sub-tabs (My Work) leave
     * this off to avoid double-docking; those that don't (regular repos, My
     * Life) set it so the note editor keeps full height instead of the app-wide
     * `GlobalStatusDock` painting a partial-width band beside it. No-ops in
     * classic / mobile via `DockedStatusFooter`'s own gate. */
    dockStatusFooter?: boolean;
}

const MAX_NAV_HISTORY = 50;

function getNotesChatLegacyOpenStorageKey(workspaceId: string): string {
    return `coc-notes-chat-panel-open-${workspaceId}`;
}

export function NotesView({ workspaceId, initialNotePath, defaultScope, active = true, dockStatusFooter = false }: NotesViewProps) {
    const { dispatch } = useApp();
    const [selectedPath, setSelectedPath] = useState<string | null>(initialNotePath ?? null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [noteViewMode, setNoteViewMode] = useState<NoteViewMode>('rich');
    const { isMobile } = useBreakpoint();

    // ── Navigation history ──────────────────────────────────────────────────

    const [navHistory, setNavHistory] = useState<string[]>([]);
    const [historyIndex, setHistoryIndex] = useState<number>(-1);

    const notesChatTarget = useMemo<ReviewChatTarget>(() => ({
        type: 'notes',
        workspaceId,
    }), [workspaceId]);
    const legacyChatOpenStorageKey = useMemo(() => getNotesChatLegacyOpenStorageKey(workspaceId), [workspaceId]);
    const {
        chatOpen: chatPanelOpen,
        toggleChat: handleToggleChatPanel,
        closeChat: closeNoteChat,
        minimizeChat: minimizeNoteChat,
        restoreChat: restoreNoteChat,
        pinChat: pinNoteChat,
        unpinChat: unpinNoteChat,
        isPinned: noteChatPinned,
        isMinimized: noteChatMinimized,
        presentation: noteChatPresentation,
        lensEnabled: noteChatLensEnabled,
        isDesktop: noteChatIsDesktop,
    } = useReviewChatPresentation({
        target: notesChatTarget,
        legacyOpenStorageKey: legacyChatOpenStorageKey,
    });

    // ── Whether the notes chat has an existing conversation ──────────────────

    const [hasNoteChat, setHasNoteChat] = useState(false);

    // ── Note references (shared between editor and chat panel) ──────────────

    const noteRefs = useNoteReferences();

    // ── Notes roots (multi-root support) ────────────────────────────────────

    const { roots, selectedRootId, isDefaultRoot, selectedRootLabel, selectRoot, refreshRoots } = useNotesRoots(workspaceId);

    // Root param for API calls (undefined = default managed root)
    const rootParam = selectedRootId !== 'default' ? selectedRootId : undefined;

    // Clear selected path when root changes
    const prevRootRef = useRef(selectedRootId);
    useEffect(() => {
        if (prevRootRef.current !== selectedRootId) {
            prevRootRef.current = selectedRootId;
            setSelectedPath(null);
            dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: null });
        }
    }, [selectedRootId, dispatch]);

    // ── Notes root path (surfaced from NotesSidebar for plan-file skill button) ──

    const [notesRoot, setNotesRoot] = useState<string | null>(null);

    // ── Dismiss update dot on click anywhere in NotesView ────────────────────
    const markSeenRef = useRef<(() => void) | null>(null);
    const handlePointerDown = useCallback(() => {
        markSeenRef.current?.();
    }, []);

    // ── Resizable panels ────────────────────────────────────────────────────

    const sidebarResize = useResizablePanel({initialWidth: 280,
        minWidth: 160,
        maxWidth: 480,
        storageKey: 'coc.notesView.sidebarWidth',
        direction: 'left',
    });

    // Keep the app-shell status dock flush under the notes tree sidebar (not the
    // wider workspace default) by publishing this sidebar's live width — but only
    // while this Notes tab is the active one, since the view stays mounted-hidden
    // on other tabs. On mobile the sidebar is a drawer, so clear it.
    usePublishWorkspaceLeftColWidth(sidebarResize.width, isMobile || !active);

    const commentsPanelResize = useResizablePanel({
        initialWidth: 288,
        minWidth: 180,
        maxWidth: 480,
        storageKey: 'coc.notesView.commentsPanelWidth',
        direction: 'right',
    });

    const chatPanelResize = useResizablePanel({
        initialWidth: 320,
        minWidth: 240,
        maxWidth: 520,
        storageKey: 'coc.notesView.chatPanelWidth',
        direction: 'right',
    });

    // ── Comments state ──────────────────────────────────────────────────────

    const [commentsPanelOpen, setCommentsPanelOpen] = useState(() => {
        try { return localStorage.getItem('coc-notes-comments-panel-open') === 'true'; }
        catch { return false; }
    });
    const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const flushSaveRef = useRef<(() => Promise<void>) | null>(null);

    // Pending state for the "Add Comment" dialog
    const [pendingComment, setPendingComment] = useState<{
        anchor: TextAnchor;
        from: number;
        to: number;
    } | null>(null);

    useEffect(() => {
        try { localStorage.setItem('coc-notes-comments-panel-open', String(commentsPanelOpen)); }
        catch { /* ignore */ }
    }, [commentsPanelOpen]);

    const comments = useComments({
        workspaceId,
        notePath: selectedPath,
        root: rootParam,
    });

    // Reset active comment when switching notes
    useEffect(() => {
        setActiveCommentId(null);
    }, [selectedPath]);

    // ── Wrapped delete/resolve/reopen that also update editor marks ─────────

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

    // Expose the wrapped comments for the sidebar
    const wrappedComments: typeof comments = {
        ...comments,
        deleteThread: handleDeleteThread,
        resolveThread: handleResolveThread,
        reopenThread: handleReopenThread,
    };

    // ── Comment creation handler ────────────────────────────────────────────

    const handleCommentCreate = useCallback(() => {
        const editor = editorRef.current;
        if (!editor || editor.state.selection.empty || !selectedPath) return;

        const anchor = createTextAnchorFromSelection(editor);
        if (!anchor) return;

        const { from, to } = editor.state.selection;
        setPendingComment({ anchor, from, to });
        // Panel opens only after the user confirms the dialog
    }, [selectedPath]);

    const handleCommentDialogConfirm = useCallback(async (text: string) => {
        if (!pendingComment) return;
        const { anchor, from, to } = pendingComment;
        setPendingComment(null);

        const created = await comments.createThread(anchor, text).catch(() => null);
        if (!created) return;

        const ed = editorRef.current;
        if (!ed) return;
        const saved = { from: ed.state.selection.from, to: ed.state.selection.to };
        ed.chain()
            .setTextSelection({ from, to })
            .setComment(created.id)
            .setTextSelection(saved)
            .run();

        setCommentsPanelOpen(true);
    }, [pendingComment, comments]);

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

    // ── Resolve with AI handler (new task path — no parent chat) ────────────

    const handleResolveWithAI = useCallback(async () => {
        if (!selectedPath) return;
        const { content } = await notesApi.getContent(workspaceId, selectedPath);
        await comments.resolveWithAI(content);
    }, [selectedPath, workspaceId, comments]);

    // ── Navigation ──────────────────────────────────────────────────────────

    // Reset history when workspace changes
    useEffect(() => {
        setNavHistory([]);
        setHistoryIndex(-1);
    }, [workspaceId]);

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

    const selectedPathRef = useRef<string | null>(selectedPath);
    useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);

    const pushHistory = useCallback((newPath: string) => {
        const prev = selectedPathRef.current;
        if (!prev || prev === newPath) return;
        setNavHistory(h => {
            // Discard any forward stack, push the previous path
            const base = h.slice(0, historyIndex + 1);
            const next = [...base, prev];
            return next.length > MAX_NAV_HISTORY ? next.slice(next.length - MAX_NAV_HISTORY) : next;
        });
        setHistoryIndex(i => Math.min(i + 1, MAX_NAV_HISTORY - 1));
    }, [historyIndex]);

    const handleGoBack = useCallback(() => {
        if (historyIndex < 0) return;
        const prev = navHistory[historyIndex];
        setHistoryIndex(i => i - 1);
        setSelectedPath(prev);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: prev });
        updateHash(prev);
    }, [navHistory, historyIndex, dispatch, updateHash]);

    const canGoBack = historyIndex >= 0;

    const handleSelectPage = useCallback((path: string) => {
        pushHistory(path);
        setSelectedPath(path);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: path });
        updateHash(path);
        if (isMobile) setSidebarOpen(false);
    }, [isMobile, dispatch, updateHash, pushHistory]);

    const handleNavigateToNote = useCallback((path: string, heading?: string) => {
        handleSelectPage(path);
        if (heading) {
            // Scroll to heading after navigation. Use a small delay to allow content to load.
            setTimeout(() => {
                const slug = heading.toLowerCase().replace(/\s+/g, '-');
                const el = document.getElementById(slug)
                    ?? document.querySelector(`[data-toc-id="${slug}"]`)
                    ?? document.querySelector(`.ProseMirror h1, .ProseMirror h2, .ProseMirror h3`);
                // Find heading by text content match as a fallback
                if (!el) {
                    const headings = document.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
                    for (const h of headings) {
                        const headingSlug = (h.textContent ?? '').trim().toLowerCase().replace(/\s+/g, '-');
                        if (headingSlug === slug) {
                            h.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            return;
                        }
                    }
                } else {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 500);
        }
    }, [handleSelectPage]);

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

    const handleRestoreEditorFocus = useCallback(() => {
        if (noteViewMode !== 'rich') return;
        const editor = editorRef.current;
        if (!editor || editor.isDestroyed) return;
        editor.commands.focus();
    }, [noteViewMode]);

    // ── Render ──────────────────────────────────────────────────────────────

    const isResizing = !isMobile && (sidebarResize.isDragging || commentsPanelResize.isDragging || chatPanelResize.isDragging);
    const commentsVisible = commentsPanelOpen && !!selectedPath && noteViewMode === 'rich';
    const chatVisible = chatPanelOpen;
    // The compact Notes Chat header (rendered inside NoteChatPanel) needs to
    // know which window actions apply: minimize/pin when floating as a Lens,
    // unpin when pinned to the side panel via the shared frame, or neither
    // when embedded directly (mobile, or Lens disabled).
    const noteChatWindowMode: NotesChatWindowMode = noteChatPresentation === 'lens'
        ? 'lens'
        : (noteChatLensEnabled && noteChatPinned && noteChatIsDesktop ? 'side-panel' : 'embedded');
    const renderNoteChatPanel = () => (
        <NoteChatPanel
            workspaceId={workspaceId}
            notePath={selectedPath}
            noteTitle={selectedPath?.split('/').pop()?.replace(/\.md$/, '')}
            onClose={closeNoteChat}
            onBeforeSend={async () => { await flushSaveRef.current?.(); }}
            defaultScope={defaultScope}
            references={noteRefs.references}
            onRemoveReference={noteRefs.removeReference}
            onClearReferences={noteRefs.clearReferences}
            onHasChatChange={setHasNoteChat}
            presentation={noteChatWindowMode}
            onMinimize={noteChatWindowMode === 'lens' ? minimizeNoteChat : undefined}
            onPin={noteChatWindowMode === 'lens' ? pinNoteChat : undefined}
            onUnpin={noteChatWindowMode === 'side-panel' ? unpinNoteChat : undefined}
        />
    );

    return (
        <div
            className={`relative flex h-full${isResizing ? ' select-none' : ''}`}
            data-testid="notes-view"
            onPointerDown={handlePointerDown}
        >
            {/* Left: notes tree sidebar */}
            <ResponsiveSidebar
                width={sidebarResize.width}
                tabletWidth={sidebarResize.width}
                isOpen={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
                noBorderRight={!isMobile}
            >
                <NotesSidebar
                    workspaceId={workspaceId}
                    selectedPath={selectedPath}
                    onSelectPage={handleSelectPage}
                    onNoteRenamed={handleNoteRenamed}
                    onNoteCreated={handleNoteCreated}
                    onNoteDeleted={handleNoteDeleted}
                    canGoBack={canGoBack}
                    onGoBack={handleGoBack}
                    onNotesRootReady={setNotesRoot}
                    onRestoreEditorFocus={handleRestoreEditorFocus}
                    markSeenRef={markSeenRef}
                    isDefaultRoot={isDefaultRoot}
                    selectedRootId={selectedRootId}
                    selectedRootLabel={selectedRootLabel}
                    roots={roots}
                    onSelectRoot={selectRoot}
                    onRootsChanged={refreshRoots}
                    footer={dockStatusFooter ? <DockedStatusFooter /> : undefined}
                />
            </ResponsiveSidebar>

            {/* Sidebar resize handle (desktop/tablet only) */}
            {!isMobile && (
                <div
                    className={`w-1 self-stretch flex-shrink-0 cursor-col-resize bg-[#e0e0e0] dark:bg-[#3c3c3c] hover:bg-[#007acc]/40 active:bg-[#007acc]/60 transition-colors${sidebarResize.isDragging ? ' bg-[#007acc]/60' : ''}`}
                    onMouseDown={sidebarResize.handleMouseDown}
                    onTouchStart={sidebarResize.handleTouchStart}
                    data-testid="notes-sidebar-resize-handle"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize notes sidebar"
                    tabIndex={0}
                />
            )}

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
                        {selectedPath && noteViewMode === 'rich' && (
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
                {/* Desktop/tablet comments toggle — now merged into NoteEditorToolbar */}
                <NoteEditor
                    workspaceId={workspaceId}
                    notePath={selectedPath}
                    notesRoot={notesRoot ?? undefined}
                    threads={comments.allThreads}
                    onCommentActivated={setActiveCommentId}
                    onEditorReady={(ed) => { editorRef.current = ed; }}
                    onCommentCreate={handleCommentCreate}
                    commentsEnabled={true}
                    onViewModeChange={setNoteViewMode}
                    commentsPanelOpen={commentsPanelOpen}
                    onToggleCommentsPanel={() => setCommentsPanelOpen((v) => !v)}
                    commentCount={wrappedComments.totalCount}
                    onFlushSave={(fn) => { flushSaveRef.current = fn; }}
                    chatPanelOpen={chatPanelOpen}
                    onToggleChatPanel={handleToggleChatPanel}
                    hasExistingChat={hasNoteChat}
                    onNavigateToNote={handleNavigateToNote}
                    onAddNoteReference={chatPanelOpen ? noteRefs.addReference : undefined}
                    isDefaultRoot={isDefaultRoot}
                    root={rootParam}
                />
            </div>

            {/* Comments panel resize handle + panel (collapsible, hidden in source mode) */}
            {commentsVisible && (
                <>
                    <div
                        className={`w-1 self-stretch flex-shrink-0 cursor-col-resize bg-[#e0e0e0] dark:bg-[#3c3c3c] hover:bg-[#007acc]/40 active:bg-[#007acc]/60 transition-colors${commentsPanelResize.isDragging ? ' bg-[#007acc]/60' : ''}`}
                        onMouseDown={commentsPanelResize.handleMouseDown}
                        onTouchStart={commentsPanelResize.handleTouchStart}
                        data-testid="notes-comments-resize-handle"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize comments panel"
                        tabIndex={0}
                    />
                    <div
                        style={{ width: commentsPanelResize.width, minWidth: commentsPanelResize.width }}
                        className="flex-shrink-0 overflow-y-auto bg-white dark:bg-[#1e1e1e]"
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
                            comments={wrappedComments}
                            onResolveWithAI={handleResolveWithAI}
                        />
                    </div>
                </>
            )}

            {/* Chat panel resize handle + panel (collapsible) */}
            {chatVisible && noteChatPresentation === 'lens' && (
                <ReviewChatPlacementFrame
                    title="Notes Chat"
                    identifier={selectedPath?.split('/').pop()?.replace(/\.md$/, '')}
                    presentation="lens"
                    onClose={closeNoteChat}
                    isMinimized={noteChatMinimized}
                    onMinimize={minimizeNoteChat}
                    onRestore={restoreNoteChat}
                    onPin={pinNoteChat}
                    testIdPrefix="notes-chat"
                    hideHeader
                >
                    {renderNoteChatPanel()}
                </ReviewChatPlacementFrame>
            )}

            {chatVisible && noteChatPresentation === 'side-panel' && (
                <>
                    <div
                        className={`w-1 self-stretch flex-shrink-0 cursor-col-resize bg-[#e0e0e0] dark:bg-[#3c3c3c] hover:bg-[#007acc]/40 active:bg-[#007acc]/60 transition-colors${chatPanelResize.isDragging ? ' bg-[#007acc]/60' : ''}`}
                        onMouseDown={chatPanelResize.handleMouseDown}
                        onTouchStart={chatPanelResize.handleTouchStart}
                        data-testid="notes-chat-resize-handle"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label="Resize chat panel"
                        tabIndex={0}
                    />
                    <div
                        style={{ width: chatPanelResize.width, minWidth: chatPanelResize.width }}
                        className="flex-shrink-0 overflow-hidden bg-white dark:bg-[#1e1e1e]"
                        data-testid="note-chat-panel-container"
                    >
                        {noteChatLensEnabled && noteChatPinned && noteChatIsDesktop ? (
                            <ReviewChatPlacementFrame
                                title="Notes Chat"
                                identifier={selectedPath?.split('/').pop()?.replace(/\.md$/, '')}
                                presentation="side-panel"
                                onClose={closeNoteChat}
                                onUnpin={unpinNoteChat}
                                testIdPrefix="notes-chat"
                                hideHeader
                            >
                                {renderNoteChatPanel()}
                            </ReviewChatPlacementFrame>
                        ) : renderNoteChatPanel()}
                    </div>
                </>
            )}

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

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { ResponsiveSidebar } from '../../ui/ResponsiveSidebar';
import { DockedStatusFooter } from '../../layout/DockedStatusFooter';
import { NotesSidebar } from './editor/NotesSidebar';
import { NOTES_SIDEBAR_RAIL_WIDTH, useNotesSidebarCollapsed } from './editor/NotesSidebarCollapse';
import { NoteEditor } from './editor/NoteEditor';
import type { NoteViewMode } from './editor/NoteEditor';
import { CommentsSidebar } from './editor/CommentsSidebar';
import { NoteChatPanel } from './editor/NoteChatPanel';
import type { NotesChatWindowMode } from './editor/NotesChatHeader';
import type { ChatScope } from './hooks/useNotesChat';
import { useComments } from './editor/useComments';
import { notesApi } from './notesApi';
import { createTextAnchorFromSelection, findAnchorInDoc, applyCommentMark, revealCommentThread } from './editor/commentAnchoring';
import type { TextAnchor } from './editor/textAnchor';
import { AddCommentDialog } from './editor/NotesDialogs';
import { useBreakpoint } from '../../hooks/ui/useBreakpoint';
import { useResizablePanel } from '../../hooks/ui/useResizablePanel';
import { useHoverPeek } from '../chat/hooks/useHoverPeek';
import { usePublishWorkspaceLeftColWidth } from '../../hooks/ui/useWorkspaceLeftColWidth';
import { useApp } from '../../contexts/AppContext';
import { buildNoteHash } from '../../layout/Router';
import { useNoteReferences } from './editor/useNoteReferences';
import { formatPaperChatGrounding } from './editor/extensions/paperChatGrounding';
import { useNotesRoots } from './hooks/useNotesRoots';
import { ReviewChatPlacementFrame } from '../git/reviewChat/ReviewChatPlacementFrame';
import { useReviewChatPresentation } from '../git/hooks/useReviewChatPresentation';
import type { ReviewChatTarget } from '../git/commits/commitChatPlacement';

export interface NotesViewProps {
    workspaceId: string;
    /** Clone-qualified identity of the repository that owns these notes. */
    sourceSelectionId?: string;
    initialNotePath?: string | null;
    /** Default chat scope for the NoteChatPanel. Defaults to 'per-note'. */
    defaultScope?: ChatScope;
    /**
     * Whether this Notes tab is the active/visible sub-tab. Views are kept
     * mounted-but-hidden across tab switches, so only the active one publishes
     * its sidebar width to the global status dock. Defaults to `true` for
     * standalone use. */
    active?: boolean;
    /**
     * When true, dock the shared status/action cluster in this view's own
     * NotesSidebar footer (remote-first shell). All docked hosts set it — regular
     * repos, My Life, and My Work — so the note editor keeps full height instead
     * of the app-wide `GlobalStatusDock` painting a partial-width band beside it.
     * No-ops in classic / mobile via `DockedStatusFooter`'s own gate. */
    dockStatusFooter?: boolean;
}

const MAX_NAV_HISTORY = 50;

/**
 * Pointer-based navigation history for Notes back/forward. `entries` is the
 * single linear list of visited notes; `pointer` is the index of the currently
 * shown note (-1 when empty). `canGoBack` ⇔ `pointer > 0`, `canGoForward` ⇔
 * `pointer < entries.length - 1`.
 */
interface NavHistory {
    entries: string[];
    pointer: number;
}

function getNotesChatLegacyOpenStorageKey(workspaceId: string): string {
    return `coc-notes-chat-panel-open-${workspaceId}`;
}

/**
 * True on pointer/desktop devices (mouse/trackpad with hover). Gates the
 * hover-to-float peek of the collapsed notes rail so touch devices don't float
 * the sidebar out on an accidental tap. Defaults to true when matchMedia is
 * unavailable (SSR / jsdom). Mirrors the same helper in `SplitWorkspacePanel` /
 * `RepoChatTab`.
 */
function hasFinePointerDevice(): boolean {
    try {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
        return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
        return true;
    }
}

export function NotesView({ workspaceId, sourceSelectionId, initialNotePath, defaultScope, active = true, dockStatusFooter = false }: NotesViewProps) {
    const { dispatch } = useApp();
    const [selectedPathState, setSelectedPathState] = useState<string | null>(initialNotePath ?? null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [noteViewMode, setNoteViewMode] = useState<NoteViewMode>('rich');
    const { isMobile } = useBreakpoint();

    const updateHash = useCallback((path: string | null) => {
        const target = path
            ? buildNoteHash(workspaceId, path)
            : '#repos/' + encodeURIComponent(workspaceId) + '/notes';
        if (location.hash !== target) {
            location.hash = target;
        }
    }, [workspaceId]);

    // ── Navigation history (pointer-based back/forward) ─────────────────────
    // A single linear history: `entries` holds every visited note in order and
    // `pointer` indexes the currently-shown note within it. Back moves the
    // pointer left, Forward moves it right, and opening a brand-new note (not via
    // Back/Forward) truncates everything after the pointer (clears the forward
    // stack) before appending — the standard browser back/forward model.
    const [nav, setNav] = useState<NavHistory>({ entries: [], pointer: -1 });
    const navRef = useRef(nav);
    // Keep the ref synchronously in sync so the navigation handlers can read the
    // latest history without waiting for the next render/effect flush.
    const setNavState = useCallback((next: NavHistory) => {
        navRef.current = next;
        setNav(next);
    }, []);

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

    // ── Whole-paper chat grounding (Goal 3, AC-03) ──────────────────────────
    // The "💬 Chat about this paper" action on a cached-paper PDF embed opens the
    // Notes chat with a grounding directive (pointing the model at the paper's
    // `.papers/<id>.txt` sidecar) prepended to the next message.
    const [paperGrounding, setPaperGrounding] = useState<string | null>(null);
    const handleChatAboutPaper = useCallback((paperTextRelPath: string) => {
        setPaperGrounding(formatPaperChatGrounding(paperTextRelPath));
        // Ensure the chat panel is open so the user can type their question with
        // the paper already attached as grounding.
        if (!chatPanelOpen) handleToggleChatPanel();
    }, [chatPanelOpen, handleToggleChatPanel]);
    // Drop any pending paper grounding when the selected note changes so it never
    // rides a message about a different note.
    useEffect(() => { setPaperGrounding(null); }, [selectedPathState]);

    // ── Notes roots (multi-root support) ────────────────────────────────────

    const { roots, selectedRootId, isDefaultRoot, selectRoot, refreshRoots } = useNotesRoots(workspaceId);

    // Root param for API calls (undefined = default managed root)
    const rootParam = selectedRootId !== 'default' ? selectedRootId : undefined;
    const rootScopeKey = `${workspaceId}\0${selectedRootId}`;
    const activeRootScopeRef = useRef(rootScopeKey);
    activeRootScopeRef.current = rootScopeKey;
    const selectedPathScopeRef = useRef(rootScopeKey);
    const selectedPath = selectedPathScopeRef.current === rootScopeKey ? selectedPathState : null;
    const setSelectedPath = useCallback((path: string | null) => {
        selectedPathScopeRef.current = activeRootScopeRef.current;
        setSelectedPathState(path);
    }, []);

    // ── Notes root path (surfaced from NotesSidebar for plan-file skill button) ──

    const [notesRoot, setNotesRoot] = useState<string | null>(null);

    // Root selection and note selection form one workspace-scoped identity.
    // Clear the prior file synchronously after either part changes so the same
    // relative path is never carried into another collection or workspace.
    const prevRootScopeRef = useRef({ workspaceId, selectedRootId, initialNotePath });
    useEffect(() => {
        const previous = prevRootScopeRef.current;
        const scopeChanged = previous.workspaceId !== workspaceId
            || previous.selectedRootId !== selectedRootId;
        const initialPathChanged = previous.initialNotePath !== initialNotePath;
        prevRootScopeRef.current = { workspaceId, selectedRootId, initialNotePath };
        if (!scopeChanged) {
            return;
        }

        const workspaceChanged = previous.workspaceId !== workspaceId;
        const nextPath = workspaceChanged && initialPathChanged ? initialNotePath ?? null : null;
        setSelectedPath(nextPath);
        setNotesRoot(null);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: nextPath });
        updateHash(nextPath);
    }, [dispatch, initialNotePath, selectedRootId, updateHash, workspaceId]);

    const aiUnavailableReason = isDefaultRoot
        ? undefined
        : 'AI note actions are available only in the managed Notes collection';

    useEffect(() => {
        if (!isDefaultRoot && chatPanelOpen) {
            closeNoteChat();
        }
    }, [chatPanelOpen, closeNoteChat, isDefaultRoot]);

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

    // Whole-left-column collapse for the notes tree sidebar, persisted per
    // workspace so repo / My Life / My Work each remember their own state.
    // Collapse only applies to the desktop/tablet in-flow sidebar — on mobile the
    // sidebar is a portal drawer with its own open/close affordance.
    const [sidebarCollapsed, toggleSidebarCollapsed] = useNotesSidebarCollapsed(workspaceId);
    const sidebarCollapsedDesktop = !isMobile && sidebarCollapsed;

    // Hover-to-float peek: while the sidebar is collapsed, hovering the thin rail
    // floats the full tree sidebar back as a temporary overlay, and leaving it
    // collapses back. This never touches the persisted collapsed state — it is a
    // transient layer on top of the `»` / `«` toggle, gated to pointer/desktop
    // devices so a touch tap never floats it out. The overlay reuses the same
    // keep-alive `ResponsiveSidebar` (single mount), so tree scroll/selection
    // survive a peek. Mirrors the split-workspace collapsed-rail peek.
    const [hasFinePointer] = useState(hasFinePointerDevice);
    const peekPanelRef = useRef<HTMLDivElement | null>(null);
    const hoverPeek = useHoverPeek({
        enabled: sidebarCollapsedDesktop && hasFinePointer,
        panelRef: peekPanelRef,
    });
    // Drive a one-shot slide-in once the peek opens (matches the split panel's
    // ~200ms rail-peek timing).
    const [peekVisible, setPeekVisible] = useState(false);
    useEffect(() => {
        if (!hoverPeek.isOpen) {
            setPeekVisible(false);
            return;
        }
        const raf = requestAnimationFrame(() => setPeekVisible(true));
        return () => cancelAnimationFrame(raf);
    }, [hoverPeek.isOpen]);
    const sidebarPeeking = sidebarCollapsedDesktop && hoverPeek.isOpen;
    // Class applied to the keep-alive sidebar's own <aside> (ResponsiveSidebar
    // forwards `className`): hidden while collapsed-not-peeking, and an absolute
    // slide-in overlay while peeking. Undefined when expanded so it stays in flow.
    // `motion-reduce:transition-none` drops the slide for users who prefer reduced
    // motion — the panel still floats out, it just appears instantly.
    const sidebarPeekClassName = sidebarCollapsedDesktop
        ? sidebarPeeking
            ? `absolute inset-y-0 left-0 z-30 shadow-xl transition-transform duration-200 ease-out motion-reduce:transition-none ${peekVisible ? 'translate-x-0' : '-translate-x-full'}`
            : 'hidden'
        : undefined;

    // Keep the app-shell status dock flush under the notes tree sidebar (not the
    // wider workspace default) by publishing this sidebar's live width — but only
    // while this Notes tab is the active one, since the view stays mounted-hidden
    // on other tabs. While collapsed the column is only the thin rail, so publish
    // the rail width. On mobile the sidebar is a drawer, so clear it.
    usePublishWorkspaceLeftColWidth(
        sidebarCollapsedDesktop ? NOTES_SIDEBAR_RAIL_WIDTH : sidebarResize.width,
        isMobile || !active,
    );

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

        revealCommentThread(editor, threadId, comments.threads.find(t => t.id === threadId));
    }, [comments.threads]);

    // ── Resolve with AI handler (new task path — no parent chat) ────────────

    const handleResolveWithAI = useCallback(async () => {
        if (!selectedPath) return;
        const { content } = await notesApi.getContent(workspaceId, selectedPath, rootParam);
        await comments.resolveWithAI(content);
    }, [selectedPath, workspaceId, rootParam, comments]);

    // ── Navigation ──────────────────────────────────────────────────────────

    // Reset history (both back and forward) when workspace changes
    useEffect(() => {
        setNavState({ entries: [], pointer: -1 });
    }, [workspaceId, setNavState]);

    // Sync from external deep-link changes (e.g. back/forward navigation)
    useEffect(() => {
        if (initialNotePath !== undefined && initialNotePath !== selectedPath) {
            setSelectedPath(initialNotePath);
        }
    }, [initialNotePath]);

    const selectedPathRef = useRef<string | null>(selectedPath);
    useEffect(() => { selectedPathRef.current = selectedPath; }, [selectedPath]);

    // Open a brand-new note (from the tree, a link, etc.): truncate the forward
    // stack, then append. `selectedPathRef.current` is the authoritative current
    // note — it may differ from `entries[pointer]` after an out-of-band change
    // (rename/create/delete), so reconcile it into the base before appending.
    const pushEntry = useCallback((path: string) => {
        const current = selectedPathRef.current;
        if (current === path) return;
        const { entries, pointer } = navRef.current;
        let base = pointer >= 0 ? entries.slice(0, pointer + 1) : [];
        if (current && base[base.length - 1] !== current) {
            base = [...base, current];
        }
        let next = [...base, path];
        let nextPointer = next.length - 1;
        // Cap the history, dropping the oldest entries and shifting the pointer.
        if (next.length > MAX_NAV_HISTORY) {
            const overflow = next.length - MAX_NAV_HISTORY;
            next = next.slice(overflow);
            nextPointer -= overflow;
        }
        setNavState({ entries: next, pointer: nextPointer });
    }, [setNavState]);

    const handleGoBack = useCallback(() => {
        const { entries, pointer } = navRef.current;
        if (pointer <= 0) return;
        const nextPointer = pointer - 1;
        const target = entries[nextPointer];
        setNavState({ entries, pointer: nextPointer });
        setSelectedPath(target);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: target });
        updateHash(target);
    }, [dispatch, updateHash, setNavState, setSelectedPath]);

    const handleGoForward = useCallback(() => {
        const { entries, pointer } = navRef.current;
        if (pointer >= entries.length - 1) return;
        const nextPointer = pointer + 1;
        const target = entries[nextPointer];
        setNavState({ entries, pointer: nextPointer });
        setSelectedPath(target);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: target });
        updateHash(target);
    }, [dispatch, updateHash, setNavState, setSelectedPath]);

    const canGoBack = nav.pointer > 0;
    const canGoForward = nav.pointer >= 0 && nav.pointer < nav.entries.length - 1;

    const handleSelectPage = useCallback((path: string) => {
        pushEntry(path);
        setSelectedPath(path);
        dispatch({ type: 'SET_SELECTED_NOTE_PATH', notePath: path });
        updateHash(path);
        if (isMobile) setSidebarOpen(false);
    }, [isMobile, dispatch, updateHash, pushEntry, setSelectedPath]);

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
    const chatVisible = chatPanelOpen && isDefaultRoot;
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
            paperGrounding={paperGrounding}
            onClearPaperGrounding={() => setPaperGrounding(null)}
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
            {/* Collapsed rail — a thin strip that replaces the tree sidebar when
                collapsed (desktop/tablet only). Mirrors the split-workspace rail:
                a `»` expand button plus a vertical "Notes" label. */}
            {sidebarCollapsedDesktop && (
                <div
                    // `relative z-40` keeps the rail painted ABOVE the peek overlay
                    // (`z-30`): while hovering floats the full tree out, the `»`
                    // pin button stays uncovered and clickable at a fixed spot
                    // instead of being hidden behind the auto-expanded panel.
                    className="relative z-40 w-9 flex-shrink-0 border-r border-[#e0e0e0] dark:border-[#3c3c3c] bg-[#f3f3f3] dark:bg-[#252526] flex flex-col items-center pt-2 gap-1"
                    data-testid="notes-sidebar-rail"
                    onMouseEnter={hoverPeek.onRailPointerEnter}
                    onMouseLeave={hoverPeek.onRailPointerLeave}
                >
                    <button
                        type="button"
                        className={`w-7 h-7 flex items-center justify-center rounded text-[#848484] hover:bg-[#e8e8e8] dark:hover:bg-[#2d2d2d]${sidebarPeeking ? ' bg-[#e8e8e8] text-[#333] ring-1 ring-[#007acc]/40 dark:bg-[#2d2d2d] dark:text-[#ddd]' : ''}`}
                        onClick={toggleSidebarCollapsed}
                        aria-label={sidebarPeeking ? 'Keep notes sidebar open' : 'Expand notes sidebar'}
                        aria-expanded={!sidebarCollapsed}
                        title={sidebarPeeking ? 'Keep notes sidebar open' : 'Expand notes sidebar'}
                        data-testid="notes-sidebar-expand"
                    >
                        »
                    </button>
                    <span
                        className="mt-1 text-[10px] tracking-wide text-[#848484] select-none"
                        style={{ writingMode: 'vertical-rl' }}
                    >
                        Notes
                    </span>
                </div>
            )}

            {/* Left: notes tree sidebar. Kept mounted-but-hidden while collapsed
                (keep-alive) so tree scroll/selection survive a collapse round-trip.
                The stable wrapper carries the ref + pointer handlers the peek needs
                (ResponsiveSidebar forwards only `className`); it uses `display:flex`
                with no width, so it tracks the aside when expanded and shrinks to
                nothing while the aside floats out as an absolute overlay. */}
            <div
                ref={peekPanelRef}
                className="flex min-h-0 flex-shrink-0"
                data-testid="notes-sidebar-peek-panel"
                onMouseEnter={sidebarCollapsedDesktop ? hoverPeek.onPanelPointerEnter : undefined}
                onMouseLeave={sidebarCollapsedDesktop ? hoverPeek.onPanelPointerLeave : undefined}
            >
                <ResponsiveSidebar
                    width={sidebarResize.width}
                    tabletWidth={sidebarResize.width}
                    isOpen={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                    noBorderRight={!isMobile}
                    className={sidebarPeekClassName}
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
                        canGoForward={canGoForward}
                        onGoForward={handleGoForward}
                        onNotesRootReady={setNotesRoot}
                        onRestoreEditorFocus={handleRestoreEditorFocus}
                        markSeenRef={markSeenRef}
                        isDefaultRoot={isDefaultRoot}
                        selectedRootId={selectedRootId}
                        roots={roots}
                        onSelectRoot={selectRoot}
                        onRootsChanged={refreshRoots}
                        footer={dockStatusFooter ? <DockedStatusFooter /> : undefined}
                    />
                </ResponsiveSidebar>
            </div>

            {/* Sidebar resize handle + collapse chevron (desktop/tablet only).
                Dropped while collapsed — the rail owns the expand affordance then. */}
            {!isMobile && !sidebarCollapsed && (
                <div className="relative flex items-stretch flex-shrink-0 group">
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
                    {/* `«` collapse chevron — hover-revealed on the inner edge,
                        mirroring the split-workspace collapse affordance. */}
                    <button
                        type="button"
                        className="absolute top-1 -left-6 w-6 h-6 flex items-center justify-center rounded text-[#848484] bg-[#fafafa] dark:bg-[#1e1e1e] border border-[#e0e0e0] dark:border-[#3c3c3c] opacity-0 group-hover:opacity-100 hover:text-[#333] dark:hover:text-[#ddd] transition-opacity z-10"
                        onClick={toggleSidebarCollapsed}
                        aria-label="Collapse notes sidebar"
                        aria-expanded={!sidebarCollapsed}
                        title="Collapse notes sidebar"
                        data-testid="notes-sidebar-collapse"
                    >
                        «
                    </button>
                </div>
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
                    sourceSelectionId={sourceSelectionId}
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
                    chatLensOpen={chatVisible && noteChatPresentation === 'lens'}
                    onToggleChatPanel={handleToggleChatPanel}
                    chatDisabledReason={aiUnavailableReason}
                    hasExistingChat={hasNoteChat}
                    onNavigateToNote={handleNavigateToNote}
                    onAddNoteReference={chatVisible ? noteRefs.addReference : undefined}
                    onChatAboutPaper={isDefaultRoot ? handleChatAboutPaper : undefined}
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

// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { NotesView } from '../../../../src/server/spa/client/react/features/notes/NotesView';
import type { UseCommentsReturn, CommentFilter } from '../../../../src/server/spa/client/react/features/notes/editor/useComments';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ dispatch: mockDispatch }),
}));

const mockUseBreakpoint = vi.fn(() => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const }));
vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => mockUseBreakpoint(),
}));

vi.mock('../../../../src/server/spa/client/react/layout/Router', () => ({
    buildNoteHash: (wsId: string, path: string) => `#repos/${wsId}/notes/${path}`,
}));

// Mock NoteEditor to avoid pulling in the entire Tiptap dependency tree
let capturedOnEditorReady: ((ed: any) => void) | undefined;
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: any) => {
        capturedOnEditorReady = props.onEditorReady;
        return (
            <>
                <div
                    data-testid="note-editor"
                    data-comments-enabled={String(props.commentsEnabled)}
                    data-note-path={props.notePath || ''}
                />
                {props.notePath && props.onToggleCommentsPanel && (
                    <button
                        data-testid="comments-panel-toggle"
                        aria-label={props.commentsPanelOpen ? 'Hide comments' : 'Show comments'}
                        onClick={props.onToggleCommentsPanel}
                    >
                        💬
                        {(props.commentCount ?? 0) > 0 && (
                            <span data-testid="comments-toggle-count">
                                {props.commentCount}
                            </span>
                        )}
                    </button>
                )}
            </>
        );
    },
}));

// Mock NotesSidebar
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar', () => ({
    NotesSidebar: () => <div data-testid="notes-sidebar" />,
}));

// Mock useResizablePanel
vi.mock('../../../../src/server/spa/client/react/hooks/useResizablePanel', () => ({
    useResizablePanel: ({ initialWidth }: { initialWidth?: number } = {}) => ({
        width: initialWidth ?? 320,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

// Mock ResponsiveSidebar
vi.mock('../../../../src/server/spa/client/react/shared/ResponsiveSidebar', () => ({
    ResponsiveSidebar: ({ children }: any) => <div data-testid="responsive-sidebar">{children}</div>,
}));

// Mock CommentsSidebar — capture the comments prop for testing wrapped handlers
let capturedComments: UseCommentsReturn | undefined;
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/CommentsSidebar', () => ({
    CommentsSidebar: (props: any) => {
        capturedComments = props.comments;
        return (
            <div
                data-testid="comments-sidebar"
                data-selected-thread={props.selectedThreadId || ''}
            />
        );
    },
}));

// Mock useComments hook
function makeMockComments(overrides: Partial<UseCommentsReturn> = {}): UseCommentsReturn {
    return {
        threads: [],
        selectedThreadId: null,
        filter: 'all' as CommentFilter,
        loading: false,
        error: null,
        totalCount: 0,
        openCount: 0,
        resolvedCount: 0,
        setFilter: vi.fn(),
        selectThread: vi.fn(),
        createThread: vi.fn().mockResolvedValue({ id: 'server-1', anchor: {}, status: 'open', comments: [], createdAt: '' }),
        resolveThread: vi.fn(),
        reopenThread: vi.fn(),
        deleteThread: vi.fn(),
        addComment: vi.fn(),
        editComment: vi.fn(),
        deleteComment: vi.fn(),
        reload: vi.fn(),
        ...overrides,
    };
}

let mockCommentsReturn: UseCommentsReturn;
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/useComments', () => ({
    useComments: () => mockCommentsReturn,
}));

// Mock commentAnchoring
const mockFindAnchorInDoc = vi.fn(() => ({ from: 1, to: 5 }));
const mockApplyCommentMark = vi.fn();
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    createTextAnchorFromSelection: vi.fn(() => ({ quotedText: 'test', prefix: '', suffix: '' })),
    findAnchorInDoc: (...args: any[]) => mockFindAnchorInDoc(...args),
    applyCommentMark: (...args: any[]) => mockApplyCommentMark(...args),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NotesView — comments integration', () => {
    beforeEach(() => {
        mockCommentsReturn = makeMockComments();
        capturedComments = undefined;
        capturedOnEditorReady = undefined;
        mockFindAnchorInDoc.mockReturnValue({ from: 1, to: 5 });
        mockApplyCommentMark.mockClear();
        mockUseBreakpoint.mockReturnValue({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const });
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders notes-view with editor', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        expect(screen.getByTestId('notes-view')).toBeInTheDocument();
        expect(screen.getByTestId('note-editor')).toBeInTheDocument();
    });

    it('renders comments panel when commentsPanelOpen is true and note is selected', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.getByTestId('comments-panel')).toBeInTheDocument();
        expect(screen.getByTestId('comments-sidebar')).toBeInTheDocument();
    });

    it('hides comments panel when commentsPanelOpen is false', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'false');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();
    });

    it('hides comments panel when no note is selected', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" />);

        expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();
    });

    it('toggles comments panel via toggle button', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        // Panel should be closed initially (localStorage is clear)
        expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();

        // Click toggle to open
        fireEvent.click(screen.getByTestId('comments-panel-toggle'));
        expect(screen.getByTestId('comments-panel')).toBeInTheDocument();

        // Click toggle to close
        fireEvent.click(screen.getByTestId('comments-panel-toggle'));
        expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();
    });

    it('persists commentsPanelOpen to localStorage', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        // Open
        fireEvent.click(screen.getByTestId('comments-panel-toggle'));
        expect(localStorage.getItem('coc-notes-comments-panel-open')).toBe('true');

        // Close
        fireEvent.click(screen.getByTestId('comments-panel-toggle'));
        expect(localStorage.getItem('coc-notes-comments-panel-open')).toBe('false');
    });

    it('restores commentsPanelOpen from localStorage on mount', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.getByTestId('comments-panel')).toBeInTheDocument();
    });

    it('closes comments panel via close button', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.getByTestId('comments-panel')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('comments-panel-close'));
        expect(screen.queryByTestId('comments-panel')).not.toBeInTheDocument();
    });

    it('shows comment count badge on toggle button when threads exist', () => {
        mockCommentsReturn = makeMockComments({
            threads: [
                { id: 't1', anchor: { quotedText: 'x', prefix: '', suffix: '' }, status: 'open', comments: [], createdAt: '' },
            ],
            totalCount: 3,
        });

        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const badge = screen.getByTestId('comments-toggle-count');
        expect(badge.textContent).toBe('3');
    });

    it('hides count badge when no threads exist', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.queryByTestId('comments-toggle-count')).not.toBeInTheDocument();
    });

    it('renders comments panel header with "Comments" label', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.getByText('Comments')).toBeInTheDocument();
    });

    it('passes commentsEnabled=true to NoteEditor', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const editor = screen.getByTestId('note-editor');
        expect(editor.getAttribute('data-comments-enabled')).toBe('true');
    });

    it('does not show toggle button when no note is selected', () => {
        render(<NotesView workspaceId="ws1" />);

        expect(screen.queryByTestId('comments-panel-toggle')).not.toBeInTheDocument();
    });

    it('comments panel has default width and no legacy w-72/border-l classes', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const panel = screen.getByTestId('comments-panel');
        // Width is now applied via inline style (288px default)
        expect(panel.style.width).toBe('288px');
        // No legacy Tailwind classes
        expect(panel.className).not.toContain('w-72');
        expect(panel.className).not.toContain('border-l');
    });

    it('close button has correct aria-label', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const closeBtn = screen.getByTestId('comments-panel-close');
        expect(closeBtn.getAttribute('aria-label')).toBe('Close comments panel');
    });

    it('toggle button aria-label reflects panel state', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const toggle = screen.getByTestId('comments-panel-toggle');
        expect(toggle.getAttribute('aria-label')).toBe('Show comments');

        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-label')).toBe('Hide comments');
    });

    // ── delete/resolve/reopen mark bridging ─────────────────────────────────

    function renderWithEditor() {
        const mockEditor = {
            commands: {
                unsetComment: vi.fn(),
            },
            state: {
                doc: { textContent: 'Hello world' },
            },
        };

        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        // Simulate editor ready
        act(() => { capturedOnEditorReady?.(mockEditor as any); });

        return { mockEditor, comments: capturedComments! };
    }

    it('deleteThread calls unsetComment to remove the mark from the editor', async () => {
        mockCommentsReturn = makeMockComments({
            deleteThread: vi.fn().mockResolvedValue(undefined),
        });

        const { mockEditor, comments } = renderWithEditor();
        await act(async () => { await comments.deleteThread('thread-1'); });

        expect(mockCommentsReturn.deleteThread).toHaveBeenCalledWith('thread-1');
        expect(mockEditor.commands.unsetComment).toHaveBeenCalledWith('thread-1');
    });

    it('resolveThread calls unsetComment to remove the highlight', async () => {
        mockCommentsReturn = makeMockComments({
            resolveThread: vi.fn().mockResolvedValue(undefined),
        });

        const { mockEditor, comments } = renderWithEditor();
        await act(async () => { await comments.resolveThread('thread-2'); });

        expect(mockCommentsReturn.resolveThread).toHaveBeenCalledWith('thread-2');
        expect(mockEditor.commands.unsetComment).toHaveBeenCalledWith('thread-2');
    });

    it('reopenThread re-applies the comment mark via applyCommentMark', async () => {
        const anchor = { quotedText: 'world', prefix: 'Hello ', suffix: '' };
        mockCommentsReturn = makeMockComments({
            reopenThread: vi.fn().mockResolvedValue(undefined),
            threads: [
                { id: 'thread-3', anchor, status: 'resolved', comments: [], createdAt: '' },
            ],
        });
        mockFindAnchorInDoc.mockReturnValue({ from: 7, to: 12 });

        const { comments } = renderWithEditor();
        await act(async () => { await comments.reopenThread('thread-3'); });

        expect(mockCommentsReturn.reopenThread).toHaveBeenCalledWith('thread-3');
        expect(mockApplyCommentMark).toHaveBeenCalledWith(
            expect.anything(), 'thread-3', 7, 12,
        );
    });

    it('reopenThread does nothing if anchor is not found in document', async () => {
        const anchor = { quotedText: 'missing', prefix: '', suffix: '' };
        mockCommentsReturn = makeMockComments({
            reopenThread: vi.fn().mockResolvedValue(undefined),
            threads: [
                { id: 'thread-4', anchor, status: 'resolved', comments: [], createdAt: '' },
            ],
        });
        mockFindAnchorInDoc.mockReturnValue(null);

        const { comments } = renderWithEditor();
        await act(async () => { await comments.reopenThread('thread-4'); });

        expect(mockCommentsReturn.reopenThread).toHaveBeenCalledWith('thread-4');
        expect(mockApplyCommentMark).not.toHaveBeenCalled();
    });

    it('deleteThread works gracefully when no editor is set', async () => {
        mockCommentsReturn = makeMockComments({
            deleteThread: vi.fn().mockResolvedValue(undefined),
        });

        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        // Do NOT call capturedOnEditorReady — no editor

        await act(async () => { await capturedComments!.deleteThread('thread-5'); });

        expect(mockCommentsReturn.deleteThread).toHaveBeenCalledWith('thread-5');
        // Should not throw
    });

    // ── Resize handles ──────────────────────────────────────────────────────

    it('renders sidebar resize handle on desktop', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const handle = screen.getByTestId('notes-sidebar-resize-handle');
        expect(handle).toBeInTheDocument();
        expect(handle.getAttribute('aria-label')).toBe('Resize notes sidebar');
        expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('does not render sidebar resize handle on mobile', () => {
        mockUseBreakpoint.mockReturnValue({ isMobile: true, isTablet: false, isDesktop: false, breakpoint: 'mobile' as const });
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.queryByTestId('notes-sidebar-resize-handle')).not.toBeInTheDocument();
    });

    it('renders comments panel resize handle when panel is open', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const handle = screen.getByTestId('notes-comments-resize-handle');
        expect(handle).toBeInTheDocument();
        expect(handle.getAttribute('aria-label')).toBe('Resize comments panel');
        expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    });

    it('does not render comments panel resize handle when panel is closed', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        expect(screen.queryByTestId('notes-comments-resize-handle')).not.toBeInTheDocument();
    });

    it('does not render comments panel resize handle when no note is selected', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" />);

        expect(screen.queryByTestId('notes-comments-resize-handle')).not.toBeInTheDocument();
    });
});

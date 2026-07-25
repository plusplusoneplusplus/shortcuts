// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { NotesView } from '../../../../src/server/spa/client/react/features/notes/NotesView';
import type { UseCommentsReturn, CommentFilter } from '../../../../src/server/spa/client/react/features/notes/editor/useComments';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ dispatch: mockDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/Router', () => ({
    buildNoteHash: (wsId: string, path: string) => `#repos/${wsId}/notes/${path}`,
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: any) => (
        <div data-testid="note-editor" data-note-path={props.notePath || ''} />
    ),
}));

// Mock NotesSidebar — capture back/forward props and expose back + next buttons
let capturedCanGoBack: boolean | undefined;
let capturedOnGoBack: (() => void) | undefined;
let capturedCanGoForward: boolean | undefined;
let capturedOnGoForward: (() => void) | undefined;
let capturedOnSelectPage: ((path: string) => void) | undefined;
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar', () => ({
    NotesSidebar: (props: any) => {
        capturedCanGoBack = props.canGoBack;
        capturedOnGoBack = props.onGoBack;
        capturedCanGoForward = props.canGoForward;
        capturedOnGoForward = props.onGoForward;
        capturedOnSelectPage = props.onSelectPage;
        return (
            <div data-testid="notes-sidebar">
                <button
                    data-testid="notes-back-btn"
                    disabled={!props.canGoBack}
                    onClick={props.onGoBack}
                >
                    ←
                </button>
                <button
                    data-testid="notes-next-btn"
                    disabled={!props.canGoForward}
                    onClick={props.onGoForward}
                >
                    →
                </button>
            </div>
        );
    },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useResizablePanel', () => ({
    useResizablePanel: ({ initialWidth }: { initialWidth?: number } = {}) => ({
        width: initialWidth ?? 320,
        isDragging: false,
        handleMouseDown: vi.fn(),
        handleTouchStart: vi.fn(),
        resetWidth: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/ui/ResponsiveSidebar', () => ({
    ResponsiveSidebar: ({ children }: any) => <div data-testid="responsive-sidebar">{children}</div>,
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/CommentsSidebar', () => ({
    CommentsSidebar: () => <div data-testid="comments-sidebar" />,
}));

function makeMockComments(overrides: Partial<UseCommentsReturn> = {}): UseCommentsReturn {
    return {
        threads: [],
        allThreads: [],
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
        resolveWithAI: vi.fn(),
        ...overrides,
    };
}

let mockCommentsReturn: UseCommentsReturn;
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/useComments', () => ({
    useComments: () => mockCommentsReturn,
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    createTextAnchorFromSelection: vi.fn(),
    findAnchorInDoc: vi.fn(),
    applyCommentMark: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/editor/useNoteReferences', () => ({
    useNoteReferences: () => ({ references: [], addReference: vi.fn(), removeReference: vi.fn(), clearReferences: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel', () => ({
    NoteChatPanel: () => <div data-testid="note-chat-panel" />,
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NotesView — navigation history', () => {
    beforeEach(() => {
        mockCommentsReturn = makeMockComments();
        capturedCanGoBack = undefined;
        capturedOnGoBack = undefined;
        capturedCanGoForward = undefined;
        capturedOnGoForward = undefined;
        capturedOnSelectPage = undefined;
        mockDispatch.mockClear();
        localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('canGoBack is false initially', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        expect(capturedCanGoBack).toBe(false);
    });

    it('canGoBack becomes true after navigating to a different note', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        expect(capturedCanGoBack).toBe(false);

        act(() => { capturedOnSelectPage?.('Page2'); });
        expect(capturedCanGoBack).toBe(true);
    });

    it('navigating to the already-active note does not push a history entry', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        act(() => { capturedOnSelectPage?.('Page1'); });
        expect(capturedCanGoBack).toBe(false);
    });

    it('handleGoBack restores the previous note path', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        act(() => { capturedOnSelectPage?.('Page2'); });
        expect(capturedCanGoBack).toBe(true);

        // Go back
        act(() => { capturedOnGoBack?.(); });

        const editor = screen.getByTestId('note-editor');
        expect(editor.getAttribute('data-note-path')).toBe('Page1');
    });

    it('canGoBack is false again after going back to origin', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnGoBack?.(); });

        expect(capturedCanGoBack).toBe(false);
    });

    it('multi-step back navigation works correctly', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="A" />);

        act(() => { capturedOnSelectPage?.('B'); });
        act(() => { capturedOnSelectPage?.('C'); });

        // Back once → B
        act(() => { capturedOnGoBack?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('B');

        // Back again → A
        act(() => { capturedOnGoBack?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('A');
        expect(capturedCanGoBack).toBe(false);
    });

    it('back button in sidebar is disabled when canGoBack is false', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        const btn = screen.getByTestId('notes-back-btn');
        expect(btn).toBeDisabled();
    });

    it('back button in sidebar is enabled after navigation', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        act(() => { capturedOnSelectPage?.('Page2'); });

        const btn = screen.getByTestId('notes-back-btn');
        expect(btn).not.toBeDisabled();
    });

    it('clicking back button navigates to previous note', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        act(() => { capturedOnSelectPage?.('Page2'); });
        fireEvent.click(screen.getByTestId('notes-back-btn'));

        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('Page1');
    });

    it('history stack is reset when workspaceId changes', async () => {
        const { rerender } = render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        act(() => { capturedOnSelectPage?.('Page2'); });
        expect(capturedCanGoBack).toBe(true);

        await act(async () => {
            rerender(<NotesView workspaceId="ws2" initialNotePath="Page1" />);
        });

        expect(capturedCanGoBack).toBe(false);
    });

    it('history stack is capped at MAX_NAV_HISTORY (50) entries', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page0" />);

        // Navigate to 60 distinct pages; stack should cap at 50
        for (let i = 1; i <= 60; i++) {
            act(() => { capturedOnSelectPage?.(`Page${i}`); });
        }

        // Should still be able to go back (cap doesn't break back nav)
        expect(capturedCanGoBack).toBe(true);

        // Going back 50 times should exhaust the stack
        for (let i = 0; i < 50; i++) {
            act(() => { capturedOnGoBack?.(); });
        }

        expect(capturedCanGoBack).toBe(false);
    });

    it('dispatch is called with the restored path on go back', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        mockDispatch.mockClear();

        act(() => { capturedOnGoBack?.(); });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_NOTE_PATH', notePath: 'Page1' });
    });

    // ── Forward ("Next") navigation ─────────────────────────────────────────

    it('canGoForward is false initially', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        expect(capturedCanGoForward).toBe(false);
    });

    it('canGoForward stays false while only navigating forward through new notes', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnSelectPage?.('Page3'); });
        expect(capturedCanGoForward).toBe(false);
    });

    it('canGoForward becomes true after going back', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        expect(capturedCanGoForward).toBe(false);

        act(() => { capturedOnGoBack?.(); });
        expect(capturedCanGoForward).toBe(true);
    });

    it('handleGoForward re-visits the note navigated away from', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnGoBack?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('Page1');

        act(() => { capturedOnGoForward?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('Page2');
    });

    it('canGoForward is false again after going forward to the newest entry', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnGoBack?.(); });
        act(() => { capturedOnGoForward?.(); });
        expect(capturedCanGoForward).toBe(false);
        expect(capturedCanGoBack).toBe(true);
    });

    it('multi-step back then forward traverses the single linear history', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="A" />);
        act(() => { capturedOnSelectPage?.('B'); });
        act(() => { capturedOnSelectPage?.('C'); });

        // Back to B, then A
        act(() => { capturedOnGoBack?.(); });
        act(() => { capturedOnGoBack?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('A');
        expect(capturedCanGoBack).toBe(false);
        expect(capturedCanGoForward).toBe(true);

        // Forward to B, then C
        act(() => { capturedOnGoForward?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('B');
        act(() => { capturedOnGoForward?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('C');
        expect(capturedCanGoForward).toBe(false);
    });

    it('opening a brand-new note mid-history clears the forward stack', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="A" />);
        act(() => { capturedOnSelectPage?.('B'); });
        act(() => { capturedOnSelectPage?.('C'); });

        // Back to A → forward stack has B, C
        act(() => { capturedOnGoBack?.(); });
        act(() => { capturedOnGoBack?.(); });
        expect(capturedCanGoForward).toBe(true);

        // Open a brand-new note D → forward stack cleared
        act(() => { capturedOnSelectPage?.('D'); });
        expect(capturedCanGoForward).toBe(false);
        expect(capturedCanGoBack).toBe(true);

        // Going back now returns to A (the note D branched from), not B
        act(() => { capturedOnGoBack?.(); });
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('A');
    });

    it('next button in sidebar is disabled when canGoForward is false', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        expect(screen.getByTestId('notes-next-btn')).toBeDisabled();
    });

    it('next button in sidebar is enabled after going back', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnGoBack?.(); });
        expect(screen.getByTestId('notes-next-btn')).not.toBeDisabled();
    });

    it('clicking next button navigates forward to the next note', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnGoBack?.(); });
        fireEvent.click(screen.getByTestId('notes-next-btn'));
        expect(screen.getByTestId('note-editor').getAttribute('data-note-path')).toBe('Page2');
    });

    it('dispatch is called with the restored path on go forward', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnGoBack?.(); });
        mockDispatch.mockClear();

        act(() => { capturedOnGoForward?.(); });
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_NOTE_PATH', notePath: 'Page2' });
    });

    it('forward stack is cleared when workspaceId changes', async () => {
        const { rerender } = render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
        act(() => { capturedOnSelectPage?.('Page2'); });
        act(() => { capturedOnGoBack?.(); });
        expect(capturedCanGoForward).toBe(true);

        await act(async () => {
            rerender(<NotesView workspaceId="ws2" initialNotePath="Page1" />);
        });
        expect(capturedCanGoForward).toBe(false);
    });
});

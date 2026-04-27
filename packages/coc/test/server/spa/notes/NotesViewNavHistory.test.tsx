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

// Mock NotesSidebar — capture canGoBack / onGoBack props and expose a back button
let capturedCanGoBack: boolean | undefined;
let capturedOnGoBack: (() => void) | undefined;
let capturedOnSelectPage: ((path: string) => void) | undefined;
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar', () => ({
    NotesSidebar: (props: any) => {
        capturedCanGoBack = props.canGoBack;
        capturedOnGoBack = props.onGoBack;
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
});

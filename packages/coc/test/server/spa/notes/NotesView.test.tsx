// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, cleanup, act } from '@testing-library/react';
import { NotesView } from '../../../../src/server/spa/client/react/repos/NotesView';
import type { UseCommentsReturn, CommentFilter } from '../../../../src/server/spa/client/react/repos/notes/useComments';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/context/AppContext', () => ({
    useApp: () => ({ dispatch: mockDispatch }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/Router', () => ({
    buildNoteHash: (wsId: string, path: string) => `#repos/${wsId}/notes/${path}`,
}));

// Mock NoteEditor to avoid pulling in the entire Tiptap dependency tree
const mockOnEditorReady = vi.fn();
const mockOnCommentActivated = vi.fn();
vi.mock('../../../../src/server/spa/client/react/repos/notes/NoteEditor', () => ({
    NoteEditor: (props: any) => {
        // Expose callbacks for tests
        mockOnEditorReady.mockImplementation(() => props.onEditorReady);
        mockOnCommentActivated.mockImplementation(() => props.onCommentActivated);
        return (
            <div
                data-testid="note-editor"
                data-comments-enabled={String(props.commentsEnabled)}
                data-note-path={props.notePath || ''}
            />
        );
    },
}));

// Mock NotesSidebar
vi.mock('../../../../src/server/spa/client/react/repos/notes/NotesSidebar', () => ({
    NotesSidebar: () => <div data-testid="notes-sidebar" />,
}));

// Mock ResponsiveSidebar
vi.mock('../../../../src/server/spa/client/react/shared/ResponsiveSidebar', () => ({
    ResponsiveSidebar: ({ children }: any) => <div data-testid="responsive-sidebar">{children}</div>,
}));

// Mock CommentsSidebar
vi.mock('../../../../src/server/spa/client/react/repos/notes/CommentsSidebar', () => ({
    CommentsSidebar: (props: any) => (
        <div
            data-testid="comments-sidebar"
            data-selected-thread={props.selectedThreadId || ''}
        />
    ),
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
vi.mock('../../../../src/server/spa/client/react/repos/notes/useComments', () => ({
    useComments: () => mockCommentsReturn,
}));

// Mock commentAnchoring
vi.mock('../../../../src/server/spa/client/react/repos/notes/commentAnchoring', () => ({
    createTextAnchorFromSelection: vi.fn(() => ({ quotedText: 'test', prefix: '', suffix: '' })),
    findAnchorInDoc: vi.fn(() => ({ from: 1, to: 5 })),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NotesView — comments integration', () => {
    beforeEach(() => {
        mockCommentsReturn = makeMockComments();
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

    it('comments panel has correct width and border styling', () => {
        localStorage.setItem('coc-notes-comments-panel-open', 'true');
        render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);

        const panel = screen.getByTestId('comments-panel');
        expect(panel.className).toContain('w-72');
        expect(panel.className).toContain('border-l');
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
});

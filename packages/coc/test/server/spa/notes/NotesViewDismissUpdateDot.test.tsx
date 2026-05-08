// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';
import { NotesView } from '../../../../src/server/spa/client/react/features/notes/NotesView';

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
    NoteEditor: () => <div data-testid="note-editor" />,
}));

// Capture the markSeenRef prop passed to NotesSidebar so we can simulate populating it
let capturedMarkSeenRef: React.RefObject<(() => void) | null> | undefined;
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar', () => ({
    NotesSidebar: (props: any) => {
        capturedMarkSeenRef = props.markSeenRef;
        return <div data-testid="notes-sidebar" />;
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

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/useComments', () => ({
    useComments: () => ({
        threads: [], allThreads: [], selectedThreadId: null, filter: 'all',
        loading: false, error: null, totalCount: 0, openCount: 0, resolvedCount: 0,
        setFilter: vi.fn(), selectThread: vi.fn(), createThread: vi.fn(),
        resolveThread: vi.fn(), reopenThread: vi.fn(), deleteThread: vi.fn(),
        addComment: vi.fn(), editComment: vi.fn(), deleteComment: vi.fn(),
        reload: vi.fn(), resolveWithAI: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    createTextAnchorFromSelection: vi.fn(),
    findAnchorInDoc: vi.fn(),
    applyCommentMark: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel', () => ({
    NoteChatPanel: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NotesDialogs', () => ({
    AddCommentDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/useNoteReferences', () => ({
    useNoteReferences: () => ({ references: [], addReference: vi.fn(), removeReference: vi.fn(), clearReferences: vi.fn() }),
}));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NotesView — dismiss update dot on click', () => {
    beforeEach(() => {
        capturedMarkSeenRef = undefined;
        localStorage.clear();
    });

    it('passes markSeenRef to NotesSidebar', () => {
        render(<NotesView workspaceId="ws1" initialNotePath="Notebook/Page.md" />);
        expect(capturedMarkSeenRef).toBeDefined();
        expect(capturedMarkSeenRef!.current).toBeNull(); // sidebar mock doesn't populate it
    });

    it('calls markSeenRef.current on pointerdown anywhere in NotesView', () => {
        const markSeen = vi.fn();
        render(<NotesView workspaceId="ws1" initialNotePath="Notebook/Page.md" />);

        // Simulate the NotesSidebar populating the ref (as the real component does)
        act(() => {
            if (capturedMarkSeenRef) {
                (capturedMarkSeenRef as React.MutableRefObject<(() => void) | null>).current = markSeen;
            }
        });

        // Click anywhere in the NotesView root
        const notesView = screen.getByTestId('notes-view');
        fireEvent.pointerDown(notesView);

        expect(markSeen).toHaveBeenCalledTimes(1);
    });

    it('does not throw when markSeenRef.current is null (no selected note)', () => {
        render(<NotesView workspaceId="ws1" />);

        const notesView = screen.getByTestId('notes-view');
        // Should not throw even though markSeenRef.current is null
        expect(() => fireEvent.pointerDown(notesView)).not.toThrow();
    });
});

// @vitest-environment jsdom
/**
 * NotesView → NoteEditor `chatLensOpen` wiring.
 *
 * The Notes Chat lens floats over the editor's bottom-right corner, where the
 * AI-edit pill used to live — it covered the pill's "Keep" button entirely.
 * NoteEditor relocates the pill when `chatLensOpen` is true, so that signal must
 * be true for the lens presentation *only*: side-panel and embedded chats are
 * laid out in flow and never overlap the pill.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { NotesView } from '../../../../src/server/spa/client/react/features/notes/NotesView';
import type { UseReviewChatPresentationReturn } from '../../../../src/server/spa/client/react/features/git/hooks/useReviewChatPresentation';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ dispatch: vi.fn() }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' as const }),
}));

vi.mock('../../../../src/server/spa/client/react/layout/Router', () => ({
    buildNoteHash: (wsId: string, path: string) => `#repos/${wsId}/notes/${path}`,
}));

// Mock NoteEditor to avoid pulling in the entire Tiptap dependency tree, and to
// surface the prop under test.
vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', () => ({
    NoteEditor: (props: any) => (
        <div data-testid="note-editor" data-chat-lens-open={String(props.chatLensOpen)} />
    ),
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel', () => ({
    NoteChatPanel: () => <div data-testid="note-chat-panel" />,
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/NotesSidebar', () => ({
    NotesSidebar: () => <div data-testid="notes-sidebar" />,
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
        threads: [], selectedThreadId: null, filter: 'all', loading: false, error: null,
        totalCount: 0, openCount: 0, resolvedCount: 0,
        setFilter: vi.fn(), selectThread: vi.fn(), createThread: vi.fn(), resolveThread: vi.fn(),
        reopenThread: vi.fn(), deleteThread: vi.fn(), addComment: vi.fn(), editComment: vi.fn(),
        deleteComment: vi.fn(), reload: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/notes/editor/commentAnchoring', () => ({
    createTextAnchorFromSelection: vi.fn(),
    findAnchorInDoc: vi.fn(() => ({ from: 1, to: 5 })),
    applyCommentMark: vi.fn(),
}));

let mockPresentation: UseReviewChatPresentationReturn;
vi.mock('../../../../src/server/spa/client/react/features/git/hooks/useReviewChatPresentation', () => ({
    useReviewChatPresentation: () => mockPresentation,
}));

function setChatState(
    presentation: UseReviewChatPresentationReturn['presentation'],
    chatOpen: boolean,
): void {
    mockPresentation = {
        chatOpen,
        toggleChat: vi.fn(),
        closeChat: vi.fn(),
        minimizeChat: vi.fn(),
        restoreChat: vi.fn(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        isPinned: presentation === 'side-panel',
        isMinimized: false,
        presentation,
        lensEnabled: true,
        isDesktop: true,
    };
}

/** Render NotesView and read the chatLensOpen prop handed to NoteEditor. */
function renderAndReadLensFlag(): string | null {
    render(<NotesView workspaceId="ws1" initialNotePath="Page1" />);
    return screen.getByTestId('note-editor').getAttribute('data-chat-lens-open');
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('NotesView — chatLensOpen wiring', () => {
    beforeEach(() => {
        localStorage.clear();
        setChatState('lens', true);
    });

    afterEach(() => {
        cleanup();
    });

    it('is true when the chat is open as a lens', () => {
        setChatState('lens', true);
        expect(renderAndReadLensFlag()).toBe('true');
    });

    it('is false when the chat is pinned to the side panel', () => {
        setChatState('side-panel', true);
        expect(renderAndReadLensFlag()).toBe('false');
    });

    it('is false when the chat is embedded', () => {
        setChatState('embedded', true);
        expect(renderAndReadLensFlag()).toBe('false');
    });

    it('is false when the chat is closed, even in lens presentation', () => {
        setChatState('lens', false);
        expect(renderAndReadLensFlag()).toBe('false');
    });
});

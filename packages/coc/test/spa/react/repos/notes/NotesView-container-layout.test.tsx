/**
 * NotesView — `layout="container"` adapts to the view's own width.
 *
 * The unified right panel hosts NotesView with `layout="container"`. Below
 * `NOTES_CONTAINER_WIDE_WIDTH` the tree sidebar hides behind a rail toggle
 * that opens it as an overlay, and the note chat starts collapsed without
 * rewriting the persisted open state shared with the main Notes sub-tab.
 * Wide containers keep the main Notes layout.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { NoteTreeNode, NotesRootEntry } from '../../../../../src/server/spa/client/react/features/notes/notesApi';
import { NotesView, NOTES_CONTAINER_WIDE_WIDTH } from '../../../../../src/server/spa/client/react/features/notes/NotesView';
import { notesSidebarCollapsedStorageKey } from '../../../../../src/server/spa/client/react/features/notes/editor/NotesSidebarCollapse';

const CHAT_OPEN_KEY = 'coc-notes-chat-panel-open-ws1';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    listRoots: vi.fn(),
    getTree: vi.fn(),
    getGitStatus: vi.fn(),
    getComments: vi.fn(),
    addToast: vi.fn(),
    width: 0,
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: {}, dispatch: mocks.dispatch }),
}));
vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));
vi.mock('../../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({ addToast: mocks.addToast, removeToast: vi.fn(), toasts: [] }),
}));
vi.mock('../../../../../src/server/spa/client/react/features/notes/notesApi', () => ({
    notesApi: {
        listRoots: (...args: any[]) => mocks.listRoots(...args),
        getTree: (...args: any[]) => mocks.getTree(...args),
        getGitStatus: (...args: any[]) => mocks.getGitStatus(...args),
        getComments: (...args: any[]) => mocks.getComments(...args),
    },
}));
vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/NoteEditor', async () => {
    const React = await import('react');
    return {
        NoteEditor: (props: { chatPanelOpen?: boolean; onToggleChatPanel?: () => void }) => React.createElement('button', {
            'data-testid': 'mock-chat-toggle',
            'data-open': String(!!props.chatPanelOpen),
            onClick: props.onToggleChatPanel,
        }),
    };
});
vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel', async () => {
    const React = await import('react');
    return { NoteChatPanel: () => React.createElement('div', { 'data-testid': 'mock-note-chat-panel' }) };
});
vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/CommentsSidebar', async () => {
    const React = await import('react');
    return { CommentsSidebar: () => React.createElement('div', { 'data-testid': 'mock-comments-sidebar' }) };
});

const ROOTS: NotesRootEntry[] = [{ rootId: 'default', label: 'Notes', isDefault: true }];
const TREE: NoteTreeNode[] = [{ name: 'NB', path: 'NB', type: 'notebook', children: [] }];

let clientWidthDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.location.hash = '';
    mocks.width = 0;
    mocks.listRoots.mockResolvedValue({ roots: ROOTS });
    mocks.getGitStatus.mockResolvedValue({ initialized: false });
    mocks.getComments.mockResolvedValue({ threads: {} });
    mocks.getTree.mockResolvedValue({ tree: TREE, notesRoot: '/managed/notes', systemFolders: [] });
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get() { return mocks.width; },
    });
});

afterEach(() => {
    if (clientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
    }
});

async function renderView(width: number, layout: 'viewport' | 'container' = 'container') {
    mocks.width = width;
    render(<NotesView workspaceId="ws1" navigation="local" active={false} layout={layout} />);
    await waitFor(() => expect(mocks.getTree).toHaveBeenCalled());
}

describe('NotesView layout="container"', () => {
    it('narrow container: sidebar hidden behind a rail toggle that opens it as an overlay', async () => {
        await renderView(NOTES_CONTAINER_WIDE_WIDTH - 1);

        await waitFor(() => expect(screen.getByTestId('notes-view').dataset.compact).toBe('true'));
        const sidebar = screen.getByTestId('responsive-sidebar');
        expect(sidebar.classList.contains('hidden')).toBe(true);
        expect(screen.queryByTestId('notes-sidebar-resize-handle')).toBeNull();

        const toggle = screen.getByTestId('notes-sidebar-overlay-toggle');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        fireEvent.click(toggle);
        expect(sidebar.classList.contains('hidden')).toBe(false);
        expect(sidebar.className).toContain('absolute');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        fireEvent.click(toggle);
        expect(sidebar.classList.contains('hidden')).toBe(true);
        // The overlay toggle never rewrites the persisted collapse flag.
        expect(window.localStorage.getItem(notesSidebarCollapsedStorageKey('ws1'))).toBeNull();
    });

    it('narrow container: chat starts collapsed even when persisted open, and the toggle reopens it', async () => {
        window.localStorage.setItem(CHAT_OPEN_KEY, 'true');
        await renderView(400);

        await waitFor(() => expect(screen.getByTestId('notes-view').dataset.compact).toBe('true'));
        expect(screen.queryByTestId('mock-note-chat-panel')).toBeNull();
        expect(screen.getByTestId('mock-chat-toggle').dataset.open).toBe('false');
        // The shared persisted state is untouched.
        expect(window.localStorage.getItem(CHAT_OPEN_KEY)).toBe('true');

        fireEvent.click(screen.getByTestId('mock-chat-toggle'));
        await waitFor(() => expect(screen.getByTestId('mock-note-chat-panel')).toBeTruthy());
        expect(screen.getByTestId('mock-chat-toggle').dataset.open).toBe('true');
    });

    it('wide container: full layout with in-flow sidebar and the persisted chat visible', async () => {
        window.localStorage.setItem(CHAT_OPEN_KEY, 'true');
        await renderView(NOTES_CONTAINER_WIDE_WIDTH);

        await waitFor(() => expect(screen.getByTestId('mock-note-chat-panel')).toBeTruthy());
        expect(screen.getByTestId('notes-view').dataset.compact).toBeUndefined();
        expect(screen.getByTestId('responsive-sidebar').classList.contains('hidden')).toBe(false);
        expect(screen.getByTestId('notes-sidebar-resize-handle')).toBeTruthy();
        expect(screen.queryByTestId('notes-sidebar-rail')).toBeNull();
    });

    it('default viewport layout ignores a narrow container', async () => {
        window.localStorage.setItem(CHAT_OPEN_KEY, 'true');
        await renderView(300, 'viewport');

        await waitFor(() => expect(screen.getByTestId('mock-note-chat-panel')).toBeTruthy());
        expect(screen.getByTestId('notes-view').dataset.compact).toBeUndefined();
        expect(screen.getByTestId('responsive-sidebar').classList.contains('hidden')).toBe(false);
        expect(screen.queryByTestId('notes-sidebar-rail')).toBeNull();
    });
});

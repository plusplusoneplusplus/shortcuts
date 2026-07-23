/**
 * NotesView — collapse/expand of the left tree sidebar.
 *
 * The notes sidebar mirrors the split-workspace whole-left-column collapse UX:
 * a `«` chevron (hover-revealed on the resize divider) collapses the tree to a
 * thin rail carrying a `»` expand button; the tree body stays mounted-hidden
 * (keep-alive). While collapsed the view publishes the RAIL width (not the full
 * sidebar width) to the app-shell status dock so the docked bar stays flush.
 * Collapse persists per workspace and applies only on desktop/tablet — the
 * mobile drawer keeps its own open/close affordance.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { NoteTreeNode, NotesRootEntry } from '../../../../../src/server/spa/client/react/features/notes/notesApi';
import { NotesView } from '../../../../../src/server/spa/client/react/features/notes/NotesView';
import { notesSidebarCollapsedStorageKey } from '../../../../../src/server/spa/client/react/features/notes/editor/NotesSidebarCollapse';

const VAR = '--workspace-left-col-width';
const readVar = () => document.documentElement.style.getPropertyValue(VAR);

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    listRoots: vi.fn(),
    getTree: vi.fn(),
    getGitStatus: vi.fn(),
    getComments: vi.fn(),
    addToast: vi.fn(),
    isMobile: false,
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: {}, dispatch: mocks.dispatch }),
}));
vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: mocks.isMobile, isTablet: false, isDesktop: !mocks.isMobile, breakpoint: mocks.isMobile ? 'mobile' : 'desktop' }),
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
    return { NoteEditor: () => React.createElement('div', { 'data-testid': 'mock-note-editor' }) };
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

beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.location.hash = '';
    document.documentElement.style.removeProperty(VAR);
    mocks.isMobile = false;
    mocks.listRoots.mockResolvedValue({ roots: ROOTS });
    mocks.getGitStatus.mockResolvedValue({ initialized: false });
    mocks.getComments.mockResolvedValue({ threads: {} });
    mocks.getTree.mockResolvedValue({ tree: TREE, notesRoot: '/managed/notes', systemFolders: [] });
});

describe('NotesView — collapse/expand the tree sidebar', () => {
    it('renders expanded by default: full sidebar, resize handle, no rail', async () => {
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('280px'));

        expect(screen.getByTestId('responsive-sidebar').classList.contains('hidden')).toBe(false);
        expect(screen.getByTestId('notes-sidebar-resize-handle')).toBeTruthy();
        expect(screen.queryByTestId('notes-sidebar-rail')).toBeNull();
    });

    it('collapses via the chevron: shows the rail, hides the sidebar (keep-alive), publishes the rail width', async () => {
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('280px'));

        fireEvent.click(screen.getByTestId('notes-sidebar-collapse'));

        await waitFor(() => expect(readVar()).toBe('36px'));
        // Rail with expand button appears.
        expect(screen.getByTestId('notes-sidebar-rail')).toBeTruthy();
        expect(screen.getByTestId('notes-sidebar-expand')).toBeTruthy();
        // Sidebar stays mounted (keep-alive) but is hidden; resize handle drops.
        expect(screen.getByTestId('responsive-sidebar').classList.contains('hidden')).toBe(true);
        expect(screen.queryByTestId('notes-sidebar-resize-handle')).toBeNull();
        // Persisted per workspace as '1'.
        expect(window.localStorage.getItem(notesSidebarCollapsedStorageKey('ws1'))).toBe('1');
    });

    it('expands again via the rail button: restores the full sidebar width and clears the flag', async () => {
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws1" active />);
        // Starts collapsed from persisted state.
        await waitFor(() => expect(readVar()).toBe('36px'));
        expect(screen.getByTestId('notes-sidebar-rail')).toBeTruthy();

        fireEvent.click(screen.getByTestId('notes-sidebar-expand'));

        await waitFor(() => expect(readVar()).toBe('280px'));
        expect(screen.queryByTestId('notes-sidebar-rail')).toBeNull();
        expect(screen.getByTestId('notes-sidebar-resize-handle')).toBeTruthy();
        expect(window.localStorage.getItem(notesSidebarCollapsedStorageKey('ws1'))).toBe('0');
    });

    it('rehydrates collapsed from a persisted flag and honors the resized full width on expand', async () => {
        window.localStorage.setItem('coc.notesView.sidebarWidth', '360');
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws1" active />);

        await waitFor(() => expect(readVar()).toBe('36px'));
        fireEvent.click(screen.getByTestId('notes-sidebar-expand'));
        await waitFor(() => expect(readVar()).toBe('360px'));
    });

    it('ignores collapse on mobile: no rail, no chevron, sidebar is the drawer', async () => {
        mocks.isMobile = true;
        // Even with a persisted collapsed flag, mobile keeps its drawer.
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws1" active />);

        // Mobile clears the docked width var entirely (drawer, no docked bar).
        await waitFor(() => expect(readVar()).toBe(''));
        expect(screen.queryByTestId('notes-sidebar-rail')).toBeNull();
        expect(screen.queryByTestId('notes-sidebar-collapse')).toBeNull();
        expect(screen.queryByTestId('notes-sidebar-resize-handle')).toBeNull();
    });

    it('keeps collapse state independent per workspace', async () => {
        // ws1 collapsed, ws2 has no history → ws2 renders expanded.
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws2" active />);
        await waitFor(() => expect(readVar()).toBe('280px'));
        expect(screen.queryByTestId('notes-sidebar-rail')).toBeNull();
    });
});

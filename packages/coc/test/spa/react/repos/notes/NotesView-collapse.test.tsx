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
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
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

describe('NotesView collapsed rail — hover-to-peek', () => {
    it('hovering the rail floats the sidebar back as an overlay; leaving re-hides it; persisted state untouched', async () => {
        // Start collapsed from persisted state (fine-pointer: jsdom has no
        // matchMedia so hasFinePointerDevice() defaults to true → peek enabled).
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('36px'));

        const sidebar = screen.getByTestId('responsive-sidebar');
        // Hidden while collapsed and not peeking.
        expect(sidebar.classList.contains('hidden')).toBe(true);

        vi.useFakeTimers();
        try {
            // Hover the rail → after the open delay the sidebar floats out as an overlay.
            act(() => { fireEvent.mouseEnter(screen.getByTestId('notes-sidebar-rail')); });
            act(() => { vi.advanceTimersByTime(450); });
            expect(sidebar.classList.contains('hidden')).toBe(false);
            expect(sidebar.className).toContain('absolute');
            expect(sidebar.className).toContain('z-30');
            // The transient peek never rewrites the persisted collapsed flag.
            expect(window.localStorage.getItem(notesSidebarCollapsedStorageKey('ws1'))).toBe('1');

            // Leaving the floated panel re-hides it after the grace delay.
            act(() => { fireEvent.mouseLeave(screen.getByTestId('notes-sidebar-peek-panel')); });
            act(() => { vi.advanceTimersByTime(300); });
            expect(sidebar.classList.contains('hidden')).toBe(true);
            // Still collapsed — the rail is present, not the expanded sidebar.
            expect(screen.getByTestId('notes-sidebar-rail')).toBeTruthy();
        } finally {
            vi.useRealTimers();
        }
    });

    it('Escape collapses an open peek back to the rail', async () => {
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('36px'));
        const sidebar = screen.getByTestId('responsive-sidebar');

        vi.useFakeTimers();
        try {
            act(() => { fireEvent.mouseEnter(screen.getByTestId('notes-sidebar-rail')); });
            act(() => { vi.advanceTimersByTime(450); });
            expect(sidebar.classList.contains('hidden')).toBe(false);

            act(() => { fireEvent.keyDown(document, { key: 'Escape' }); });
            expect(sidebar.classList.contains('hidden')).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });

    it('does not peek on a coarse-pointer device (touch)', async () => {
        const originalMatchMedia = window.matchMedia;
        // matchMedia present but not a fine pointer → peek disabled at mount.
        window.matchMedia = ((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia;
        try {
            window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
            render(<NotesView workspaceId="ws1" active />);
            await waitFor(() => expect(readVar()).toBe('36px'));
            const sidebar = screen.getByTestId('responsive-sidebar');

            vi.useFakeTimers();
            try {
                act(() => { fireEvent.mouseEnter(screen.getByTestId('notes-sidebar-rail')); });
                act(() => { vi.advanceTimersByTime(450); });
                // No float-out: the sidebar stays hidden behind the rail.
                expect(sidebar.classList.contains('hidden')).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        } finally {
            if (originalMatchMedia === undefined) {
                // jsdom default: property was absent — remove it again.
                delete (window as unknown as { matchMedia?: unknown }).matchMedia;
            } else {
                window.matchMedia = originalMatchMedia;
            }
        }
    });

    it('drops the peek slide transition under prefers-reduced-motion', async () => {
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('36px'));
        const sidebar = screen.getByTestId('responsive-sidebar');

        vi.useFakeTimers();
        try {
            act(() => { fireEvent.mouseEnter(screen.getByTestId('notes-sidebar-rail')); });
            act(() => { vi.advanceTimersByTime(450); });
            // The overlay carries the reduced-motion opt-out; the CSS media query
            // handles suppression at runtime, so the class is always present while
            // peeking (jsdom can't evaluate the media query itself).
            expect(sidebar.className).toContain('motion-reduce:transition-none');
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('NotesView collapse controls — aria-expanded state', () => {
    it('expanded: the collapse chevron reports aria-expanded="true"', async () => {
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('280px'));

        expect(screen.getByTestId('notes-sidebar-collapse').getAttribute('aria-expanded')).toBe('true');
    });

    it('collapsed: the rail expand button reports aria-expanded="false"', async () => {
        window.localStorage.setItem(notesSidebarCollapsedStorageKey('ws1'), '1');
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('36px'));

        expect(screen.getByTestId('notes-sidebar-expand').getAttribute('aria-expanded')).toBe('false');
    });

    it('toggling collapse flips aria-expanded across the two controls', async () => {
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('280px'));
        // Expanded → chevron says expanded.
        expect(screen.getByTestId('notes-sidebar-collapse').getAttribute('aria-expanded')).toBe('true');

        fireEvent.click(screen.getByTestId('notes-sidebar-collapse'));
        await waitFor(() => expect(readVar()).toBe('36px'));
        // Collapsed → the rail's expand button says not-expanded.
        expect(screen.getByTestId('notes-sidebar-expand').getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(screen.getByTestId('notes-sidebar-expand'));
        await waitFor(() => expect(readVar()).toBe('280px'));
        expect(screen.getByTestId('notes-sidebar-collapse').getAttribute('aria-expanded')).toBe('true');
    });
});

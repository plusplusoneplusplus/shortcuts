/**
 * NotesView publishes its sidebar width to the app-shell status dock.
 *
 * The GlobalStatusDock sizes its bottom bar to `--workspace-left-col-width`.
 * NotesView has its own (narrower) resizable tree sidebar, so it must publish
 * that width while it is the ACTIVE Notes tab — otherwise the dock keeps the
 * wider workspace default and overhangs past the notes sidebar into the editor.
 * Because tabs stay mounted-but-hidden, an inactive Notes tab must NOT own the
 * variable, and mobile (drawer sidebar) must clear it.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import type { NoteTreeNode, NotesRootEntry } from '../../../../../src/server/spa/client/react/features/notes/notesApi';
import { NotesView } from '../../../../../src/server/spa/client/react/features/notes/NotesView';

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

describe('NotesView — publishes sidebar width to the status dock', () => {
    it('publishes the notes sidebar width (default 280px) while active on desktop', async () => {
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('280px'));
    });

    it('honors a persisted sidebar width', async () => {
        window.localStorage.setItem('coc.notesView.sidebarWidth', '360');
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe('360px'));
    });

    it('does not own the variable while inactive (kept mounted-hidden on another tab)', async () => {
        document.documentElement.style.setProperty(VAR, '640px');
        render(<NotesView workspaceId="ws1" active={false} />);
        await waitFor(() => expect(readVar()).toBe(''));
    });

    it('clears the variable on mobile (sidebar is a drawer, no docked bar)', async () => {
        mocks.isMobile = true;
        document.documentElement.style.setProperty(VAR, '640px');
        render(<NotesView workspaceId="ws1" active />);
        await waitFor(() => expect(readVar()).toBe(''));
    });
});

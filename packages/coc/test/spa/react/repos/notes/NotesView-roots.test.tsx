/**
 * Tests for NotesView multi-root browsing preservation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import type { NoteTreeNode, NotesRootEntry } from '../../../../../src/server/spa/client/react/features/notes/notesApi';
import { NotesView } from '../../../../../src/server/spa/client/react/features/notes/NotesView';

const mocks = vi.hoisted(() => ({
    dispatch: vi.fn(),
    listRoots: vi.fn(),
    getTree: vi.fn(),
    getGitStatus: vi.fn(),
    getComments: vi.fn(),
    addToast: vi.fn(),
    noteEditorProps: [] as Array<{
        notePath: string | null;
        root?: string;
        isDefaultRoot?: boolean;
    }>,
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({ state: {}, dispatch: mocks.dispatch }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/ToastContext', () => ({
    useGlobalToast: () => ({
        addToast: mocks.addToast,
        removeToast: vi.fn(),
        toasts: [],
    }),
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
        NoteEditor: (props: any) => {
            mocks.noteEditorProps.push({
                notePath: props.notePath,
                root: props.root,
                isDefaultRoot: props.isDefaultRoot,
            });
            return React.createElement(
                'div',
                {
                    'data-testid': 'mock-note-editor',
                    'data-note-path': props.notePath ?? '',
                    'data-root': props.root ?? 'default',
                    'data-is-default-root': String(props.isDefaultRoot),
                },
                props.notePath ?? 'No note selected',
            );
        },
    };
});

vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/NoteChatPanel', async () => {
    const React = await import('react');
    return {
        NoteChatPanel: () => React.createElement('div', { 'data-testid': 'mock-note-chat-panel' }),
    };
});

vi.mock('../../../../../src/server/spa/client/react/features/notes/editor/CommentsSidebar', async () => {
    const React = await import('react');
    return {
        CommentsSidebar: () => React.createElement('div', { 'data-testid': 'mock-comments-sidebar' }),
    };
});

const ROOTS: NotesRootEntry[] = [
    { rootId: 'default', label: 'Notes', isDefault: true },
    { rootId: 'docs', label: 'Docs', isDefault: false },
    { rootId: 'plans', label: 'Plans', isDefault: false },
];

const DEFAULT_TREE: NoteTreeNode[] = [
    {
        name: 'DefaultNotebook',
        path: 'DefaultNotebook',
        type: 'notebook',
        children: [
            { name: 'Default.md', path: 'DefaultNotebook/Default.md', type: 'page' },
            { name: 'Other.md', path: 'DefaultNotebook/Other.md', type: 'page' },
        ],
    },
];

const DOCS_TREE: NoteTreeNode[] = [
    {
        name: 'DocsNotebook',
        path: 'DocsNotebook',
        type: 'notebook',
        children: [
            { name: 'DocsPage.md', path: 'DocsNotebook/DocsPage.md', type: 'page' },
        ],
    },
];

function renderNotesView(initialNotePath = 'DefaultNotebook/Default.md') {
    return render(<NotesView workspaceId="ws1" initialNotePath={initialNotePath} />);
}

describe('NotesView root selection preservation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.noteEditorProps.length = 0;
        window.localStorage.clear();
        window.location.hash = '';

        mocks.listRoots.mockResolvedValue({ roots: ROOTS });
        mocks.getGitStatus.mockResolvedValue({ initialized: false });
        mocks.getComments.mockResolvedValue({ threads: {} });
        mocks.getTree.mockImplementation(async (_workspaceId: string, root?: string) => ({
            tree: root === 'docs' ? DOCS_TREE : DEFAULT_TREE,
            notesRoot: root === 'docs' ? '/workspace/docs' : '/managed/notes',
            systemFolders: [],
        }));
    });

    it('plain root click switches one active root, clears the selected note, and scopes browsing to that root', async () => {
        renderNotesView();

        await screen.findByTestId('notes-root-selector');
        await waitFor(() => {
            expect(mocks.getTree).toHaveBeenCalledWith('ws1', undefined);
        });
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-note-path')).toBe('DefaultNotebook/Default.md');
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe('default');

        fireEvent.click(screen.getByTestId('notes-root-selector'));
        fireEvent.click(await screen.findByTestId('notes-root-option-docs'));

        await waitFor(() => {
            expect(mocks.getTree).toHaveBeenCalledWith('ws1', 'docs');
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe('docs');
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-note-path')).toBe('');
        });

        expect(mocks.dispatch).toHaveBeenCalledWith({ type: 'SET_SELECTED_NOTE_PATH', notePath: null });
        expect(screen.queryByTestId('notes-root-dropdown')).toBeNull();
        expect(await screen.findByTestId('notes-tree-item-DocsNotebook')).toBeTruthy();
        expect(screen.queryByTestId('notes-tree-item-DefaultNotebook')).toBeNull();
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-is-default-root')).toBe('false');
    });

    it('modifier collection selection is removal-only and leaves active-root page browsing unchanged', async () => {
        renderNotesView();

        const otherPage = await screen.findByTestId('notes-tree-item-Other.md');

        fireEvent.click(screen.getByTestId('notes-root-selector'));
        fireEvent.click(await screen.findByTestId('notes-root-option-docs'), { ctrlKey: true });

        expect(screen.getByTestId('notes-root-dropdown')).toBeTruthy();
        expect(screen.getByTestId('notes-root-option-docs').getAttribute('data-removal-selected')).toBe('true');
        expect(mocks.getTree).not.toHaveBeenCalledWith('ws1', 'docs');
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe('default');
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-note-path')).toBe('DefaultNotebook/Default.md');

        fireEvent.click(otherPage, { ctrlKey: true });

        expect(otherPage.getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('notes-root-option-docs').getAttribute('data-removal-selected')).toBe('true');
        expect(mocks.getTree).not.toHaveBeenCalledWith('ws1', 'docs');
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe('default');
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-note-path')).toBe('DefaultNotebook/Default.md');
    });
});

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
        chatDisabledReason?: string;
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
                chatDisabledReason: props.chatDisabledReason,
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
    { rootId: 'task:primary', label: 'Task Plans', isDefault: false, isProtected: true },
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

const TASK_TREE: NoteTreeNode[] = [
    { name: 'Existing.plan.md', path: 'Existing.plan.md', type: 'page' },
];

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

function renderNotesView(initialNotePath: string | null = 'DefaultNotebook/Default.md') {
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
            tree: root === 'docs' ? DOCS_TREE : root === 'task:primary' ? TASK_TREE : DEFAULT_TREE,
            notesRoot: root === 'docs' ? '/workspace/docs' : root === 'task:primary' ? '/repo-data/tasks' : '/managed/notes',
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

    it('refreshes discovered collections and falls back to managed Notes when the active task root disappears', async () => {
        mocks.listRoots
            .mockResolvedValueOnce({ roots: ROOTS })
            .mockResolvedValue({ roots: [ROOTS[0]] });
        renderNotesView();

        fireEvent.click(await screen.findByTestId('notes-root-selector'));
        fireEvent.click(await screen.findByTestId('notes-root-option-task:primary'));

        await waitFor(() => {
            expect(mocks.getTree).toHaveBeenCalledWith('ws1', 'task:primary');
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe('task:primary');
        });
        expect(mocks.noteEditorProps[mocks.noteEditorProps.length - 1]?.chatDisabledReason).toContain('managed Notes collection');

        fireEvent.click(await screen.findByTestId('notes-tree-item-Existing.plan.md'));
        expect(screen.getByTestId('mock-note-editor').getAttribute('data-note-path')).toBe('Existing.plan.md');

        fireEvent.click(screen.getByTestId('refresh-notes-btn'));

        await waitFor(() => {
            expect(mocks.listRoots).toHaveBeenCalledTimes(2);
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe('default');
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-note-path')).toBe('');
        });
        expect(window.localStorage.getItem('coc-notes-selected-root-ws1')).toBe('default');
        expect(screen.queryByTestId('notes-root-selector')).toBeNull();
        expect(window.location.hash).toBe('#repos/ws1/notes');
    });

    it('shows a task collection that appears when Notes collections are refreshed', async () => {
        mocks.listRoots
            .mockResolvedValueOnce({ roots: [ROOTS[0]] })
            .mockResolvedValue({ roots: ROOTS });
        renderNotesView(null);

        expect(await screen.findByTestId('refresh-notes-btn')).toBeTruthy();
        expect(screen.queryByTestId('notes-root-selector')).toBeNull();

        fireEvent.click(screen.getByTestId('refresh-notes-btn'));

        expect(await screen.findByTestId('notes-root-selector')).toBeTruthy();
        fireEvent.click(screen.getByTestId('notes-root-selector'));
        expect((await screen.findByTestId('notes-root-option-task:primary')).textContent).toContain('Task Plans');
    });

    it('drops stale root and tree responses when switching workspaces', async () => {
        const ws1Roots = deferred<{ roots: NotesRootEntry[] }>();
        const ws1Tree = deferred<{ tree: NoteTreeNode[]; notesRoot: string; systemFolders: string[] }>();
        const ws1RootId = 'task:workspace-one';
        const ws2RootId = 'task:workspace-two';
        const ws2Roots: NotesRootEntry[] = [
            { rootId: 'default', label: 'Notes', isDefault: true },
            { rootId: ws2RootId, label: 'Workspace Two Plans', isDefault: false, isProtected: true },
        ];
        window.localStorage.setItem('coc-notes-selected-root-ws1', ws1RootId);
        window.localStorage.setItem('coc-notes-selected-root-ws2', ws2RootId);
        mocks.listRoots.mockImplementation((workspaceId: string) => workspaceId === 'ws1'
            ? ws1Roots.promise
            : Promise.resolve({ roots: ws2Roots }));
        mocks.getTree.mockImplementation((workspaceId: string, root?: string) => {
            if (workspaceId === 'ws1') {
                return ws1Tree.promise;
            }
            return Promise.resolve({
                tree: [{ name: 'WorkspaceTwo.plan.md', path: 'WorkspaceTwo.plan.md', type: 'page' as const }],
                notesRoot: '/workspace-two/tasks',
                systemFolders: [],
                rootId: root,
            });
        });

        const { rerender } = render(<NotesView workspaceId="ws1" initialNotePath="WorkspaceOne.plan.md" />);
        await waitFor(() => expect(mocks.listRoots).toHaveBeenCalledWith('ws1'));

        rerender(<NotesView workspaceId="ws2" />);

        await waitFor(() => {
            expect(mocks.listRoots).toHaveBeenCalledWith('ws2');
            expect(mocks.getTree).toHaveBeenCalledWith('ws2', ws2RootId);
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe(ws2RootId);
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-note-path')).toBe('');
        });
        expect(mocks.getTree).not.toHaveBeenCalledWith('ws2', ws1RootId);
        expect(await screen.findByTestId('notes-tree-item-WorkspaceTwo.plan.md')).toBeTruthy();

        ws1Roots.resolve({
            roots: [
                { rootId: 'default', label: 'Notes', isDefault: true },
                { rootId: ws1RootId, label: 'Workspace One Plans', isDefault: false, isProtected: true },
            ],
        });
        ws1Tree.resolve({
            tree: [{ name: 'WorkspaceOne.plan.md', path: 'WorkspaceOne.plan.md', type: 'page' }],
            notesRoot: '/workspace-one/tasks',
            systemFolders: [],
        });

        await waitFor(() => {
            expect(screen.getByTestId('mock-note-editor').getAttribute('data-root')).toBe(ws2RootId);
            expect(screen.getByTestId('notes-tree-item-WorkspaceTwo.plan.md')).toBeTruthy();
            expect(screen.queryByTestId('notes-tree-item-WorkspaceOne.plan.md')).toBeNull();
        });
        fireEvent.click(screen.getByTestId('notes-root-selector'));
        expect(screen.queryByText('Workspace One Plans')).toBeNull();
        expect(screen.getAllByText('Workspace Two Plans').length).toBeGreaterThan(0);
    });
});

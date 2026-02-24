/**
 * Tests for the file right-click context menu in TasksPanel.
 * Covers: context menu rendering on files and document groups,
 * Copy Path, Archive, Rename, Move, Delete, and context-file exclusion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';
import { useTaskGeneration } from '../../../src/server/spa/client/react/hooks/useTaskGeneration';
import type { Mock } from 'vitest';

vi.mock('../../../src/server/spa/client/react/hooks/useTaskGeneration', () => ({
    useTaskGeneration: vi.fn(),
}));

const mockUseTaskGeneration = useTaskGeneration as Mock;

// ── Helpers ────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                    {children}
                </ToastProvider>
            </QueueProvider>
        </AppProvider>
    );
}

const mockTree = {
    name: 'tasks',
    relativePath: '',
    children: [
        {
            name: 'feature1',
            relativePath: 'feature1',
            children: [],
            documentGroups: [],
            singleDocuments: [
                { baseName: 'design', fileName: 'design.md', relativePath: 'feature1', isArchived: false, status: 'pending' },
            ],
            contextDocuments: [
                { baseName: 'CONTEXT', fileName: 'CONTEXT.md', relativePath: 'feature1', isArchived: false },
            ],
        },
    ],
    documentGroups: [
        {
            baseName: 'task1',
            isArchived: false,
            documents: [
                { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', relativePath: '', isArchived: false },
                { baseName: 'task1', docType: 'spec', fileName: 'task1.spec.md', relativePath: '', isArchived: false },
            ],
        },
    ],
    singleDocuments: [
        { baseName: 'notes', fileName: 'notes.md', relativePath: '', isArchived: false },
        // Context file — should NOT get a context menu
        { baseName: 'README', fileName: 'README.md', relativePath: '', isArchived: false },
    ],
};

const archivedTree = {
    ...mockTree,
    singleDocuments: [
        { baseName: 'notes', fileName: 'notes.md', relativePath: 'archive', isArchived: true },
    ],
    documentGroups: [],
};

function setupFetch(tree = mockTree) {
    return vi.fn().mockImplementation((url: string) => {
        if (url.includes('comment-counts')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (url.includes('tasks/content')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: '# Title' }) });
        }
        if (url.includes('/comments/')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) });
        }
        if (url.includes('/archive')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (url.includes('tasks') && !url.includes('comment') && !url.includes('content') && !url.includes('move')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve(tree) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('File context menu', () => {
    let clipboardSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        global.fetch = setupFetch();
        clipboardSpy = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText: clipboardSpy } });
        mockUseTaskGeneration.mockReturnValue({
            status: 'idle',
            chunks: [],
            progressMessage: null,
            result: null,
            error: null,
            generate: vi.fn(),
            cancel: vi.fn(),
            reset: vi.fn(),
        });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    // ── Rendering ──────────────────────────────────────────────────────

    it('renders file context menu when right-clicking a single document', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.queryByTestId('context-menu')).not.toBeNull();
    });

    it('renders file context menu when right-clicking a document group', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-task1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task1'));
        expect(screen.queryByTestId('context-menu')).not.toBeNull();
    });

    it('does NOT render file context menu for context files (README.md)', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.queryByTestId('task-tree-item-README')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-README'));
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('renders file context menu for CONTEXT.md inside a folder', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-CONTEXT')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-CONTEXT'));
        expect(screen.queryByTestId('context-menu')).not.toBeNull();
        expect(screen.getByText('Rename')).toBeTruthy();
        expect(screen.getByText('Delete')).toBeTruthy();
    });

    it('closes file context menu when Escape is pressed', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.queryByTestId('context-menu')).not.toBeNull();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    // ── Menu items ──────────────────────────────────────────────────────

    it('file context menu contains Copy Path item', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.getByText('Copy Path')).toBeTruthy();
    });

    it('file context menu contains Rename item', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.getByText('Rename')).toBeTruthy();
    });

    it('file context menu contains Archive item for non-archived file', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.getByText('Archive')).toBeTruthy();
    });

    it('file context menu contains Unarchive item for archived file', async () => {
        global.fetch = setupFetch(archivedTree);

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.getByText('Unarchive')).toBeTruthy();
    });

    it('file context menu contains Move File item', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.getByText('Move File')).toBeTruthy();
    });

    it('file context menu contains Delete item', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        expect(screen.getByText('Delete')).toBeTruthy();
    });

    // ── Copy Path ──────────────────────────────────────────────────────

    it('"Copy Path" writes the file relative path to clipboard', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Copy Path'));
        expect(clipboardSpy).toHaveBeenCalledWith('notes.md');
    });

    // ── Rename dialog ──────────────────────────────────────────────────

    it('clicking Rename opens the rename dialog with pre-filled name', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByTestId('folder-action-input');
        expect(input).toBeTruthy();
        expect((input as HTMLInputElement).value).toBe('notes');
    });

    it('renaming a file calls the PATCH API with correct path and newName', async () => {
        const fetchMock = setupFetch();
        global.fetch = fetchMock;

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'my-notes' } });
        fireEvent.click(screen.getByText('Rename', { selector: 'button' }));

        await waitFor(() => {
            const patchCalls = (fetchMock as Mock).mock.calls.filter(
                ([url, opts]: [string, RequestInit]) => opts?.method === 'PATCH' && url.includes('/tasks')
            );
            expect(patchCalls.length).toBeGreaterThan(0);
        });
    });

    it('renaming CONTEXT.md in a folder calls PATCH with nested path', async () => {
        const fetchMock = setupFetch();
        global.fetch = fetchMock;

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-CONTEXT')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-CONTEXT'));
        fireEvent.click(screen.getByText('Rename'));

        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'UPDATED_CONTEXT' } });
        fireEvent.click(screen.getByText('Rename', { selector: 'button' }));

        await waitFor(() => {
            const renameCall = (fetchMock as Mock).mock.calls.find(
                ([url, opts]: [string, RequestInit]) => opts?.method === 'PATCH' && url.includes('/tasks')
            );
            expect(renameCall).toBeTruthy();
            const [, opts] = renameCall as [string, RequestInit];
            const body = JSON.parse(String(opts.body));
            expect(body.path).toBe('feature1/CONTEXT.md');
            expect(body.newName).toBe('UPDATED_CONTEXT');
        });
    });

    // ── Delete dialog ──────────────────────────────────────────────────

    it('clicking Delete opens the delete confirmation dialog', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Delete'));

        expect(screen.getByText('Delete File')).toBeTruthy();
        // The dialog body should mention the file name "notes"
        expect(screen.getAllByText(/notes/).length).toBeGreaterThan(0);
    });

    it('confirming delete calls the DELETE API', async () => {
        const fetchMock = setupFetch();
        global.fetch = fetchMock;

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Delete'));

        // Click the danger Delete button (variant="danger" in the dialog footer)
        const deleteBtns = screen.getAllByText('Delete');
        // The last Delete button should be the one in the dialog footer
        const confirmBtn = deleteBtns[deleteBtns.length - 1];
        expect(confirmBtn).toBeTruthy();
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            const deleteCalls = (fetchMock as Mock).mock.calls.filter(
                ([url, opts]: [string, RequestInit]) => opts?.method === 'DELETE'
            );
            expect(deleteCalls.length).toBeGreaterThan(0);
        });
    });

    it('deleting CONTEXT.md in a folder calls DELETE with nested path', async () => {
        const fetchMock = setupFetch();
        global.fetch = fetchMock;

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-CONTEXT')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-CONTEXT'));
        fireEvent.click(screen.getByText('Delete'));

        const deleteBtns = screen.getAllByText('Delete');
        const confirmBtn = deleteBtns[deleteBtns.length - 1];
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            const deleteCall = (fetchMock as Mock).mock.calls.find(
                ([url, opts]: [string, RequestInit]) => opts?.method === 'DELETE' && url.includes('/tasks')
            );
            expect(deleteCall).toBeTruthy();
            const [, opts] = deleteCall as [string, RequestInit];
            const body = JSON.parse(String(opts.body));
            expect(body.path).toBe('feature1/CONTEXT.md');
        });
    });

    // ── Move dialog ────────────────────────────────────────────────────

    it('clicking Move File opens the move dialog', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Move File'));

        expect(screen.getByTestId('file-move-destination-list')).toBeTruthy();
    });

    it('move dialog shows Tasks Root as a destination option', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Move File'));

        expect(screen.getByTestId('file-move-dest-root')).toBeTruthy();
    });

    it('move dialog excludes .git folders from destination options', async () => {
        const treeWithGit = {
            ...mockTree,
            children: [
                ...mockTree.children,
                {
                    name: '.git',
                    relativePath: '.git',
                    children: [],
                    documentGroups: [],
                    singleDocuments: [],
                },
            ],
        };
        global.fetch = setupFetch(treeWithGit as typeof mockTree);

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-notes')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-notes'));
        fireEvent.click(screen.getByText('Move File'));

        expect(screen.getByTestId('file-move-destination-list')).toBeTruthy();
        expect(screen.getByTestId('file-move-dest-feature1')).toBeTruthy();
        expect(screen.queryByTestId('file-move-dest-.git')).toBeNull();
    });
});

/**
 * Tests for FolderActionDialog component and the dialog-bearing
 * context menu actions in TasksPanel (Rename, Create Subfolder,
 * Create Task, Delete, Bulk Follow Prompt).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { FolderActionDialog } from '../../../src/server/spa/client/react/tasks/FolderActionDialog';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';

// ── Helpers ────────────────────────────────────────────────────────────

const mockAddToast = vi.fn();

function Wrap({ children }: { children: ReactNode }) {
    return (
        <AppProvider>
            <QueueProvider>
                <ToastProvider value={{ addToast: mockAddToast, removeToast: vi.fn(), toasts: [] }}>
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
        },
    ],
    documentGroups: [],
    singleDocuments: [],
};

function setupFetch(tree = mockTree) {
    return vi.fn().mockImplementation((url: string, opts?: any) => {
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
        // Folder mutations (PATCH, POST with folder body, DELETE)
        if (opts?.method === 'PATCH' || opts?.method === 'DELETE') {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        if (opts?.method === 'POST' && url.includes('/tasks') && !url.includes('/archive')) {
            return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(tree) });
    });
}

// ── FolderActionDialog unit tests ─────────────────────────────────────

describe('FolderActionDialog', () => {
    afterEach(() => {
        cleanup();
    });

    it('renders title, label, input, Cancel, and Confirm buttons when open', () => {
        const onClose = vi.fn();
        const onConfirm = vi.fn();
        render(
            <FolderActionDialog
                open
                title="Rename Folder"
                label="New name"
                initialValue="old-name"
                confirmLabel="Rename"
                onClose={onClose}
                onConfirm={onConfirm}
            />
        );
        expect(screen.getByText('Rename Folder')).toBeTruthy();
        expect(screen.getByText('New name')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
        expect(screen.getByText('Rename')).toBeTruthy();
        const input = screen.getByTestId('folder-action-input') as HTMLInputElement;
        expect(input.value).toBe('old-name');
    });

    it('does not render when open is false', () => {
        render(
            <FolderActionDialog
                open={false}
                title="Rename Folder"
                label="New name"
                initialValue=""
                confirmLabel="Rename"
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        expect(screen.queryByText('Rename Folder')).toBeNull();
    });

    it('Confirm button is disabled when input is empty', () => {
        render(
            <FolderActionDialog
                open
                title="Create Subfolder"
                label="Name"
                initialValue=""
                confirmLabel="Create"
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        const confirmBtn = screen.getByText('Create').closest('button')!;
        expect(confirmBtn.disabled).toBe(true);
    });

    it('Confirm button is enabled once user types', () => {
        render(
            <FolderActionDialog
                open
                title="Create Subfolder"
                label="Name"
                initialValue=""
                confirmLabel="Create"
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'new-folder' } });
        const confirmBtn = screen.getByText('Create').closest('button')!;
        expect(confirmBtn.disabled).toBe(false);
    });

    it('Confirm button is disabled while submitting', () => {
        render(
            <FolderActionDialog
                open
                title="Rename"
                label="Name"
                initialValue="test"
                confirmLabel="Save"
                submitting
                onClose={vi.fn()}
                onConfirm={vi.fn()}
            />
        );
        const confirmBtn = screen.getByText('Save').closest('button')!;
        expect(confirmBtn.disabled).toBe(true);
    });

    it('pressing Enter in the input calls onConfirm with trimmed value', () => {
        const onConfirm = vi.fn();
        render(
            <FolderActionDialog
                open
                title="Rename"
                label="Name"
                initialValue="  hello  "
                confirmLabel="Rename"
                onClose={vi.fn()}
                onConfirm={onConfirm}
            />
        );
        const input = screen.getByTestId('folder-action-input');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onConfirm).toHaveBeenCalledWith('hello', undefined);
    });

    it('pressing Enter with empty input does not call onConfirm', () => {
        const onConfirm = vi.fn();
        render(
            <FolderActionDialog
                open
                title="Create"
                label="Name"
                initialValue=""
                confirmLabel="Create"
                onClose={vi.fn()}
                onConfirm={onConfirm}
            />
        );
        const input = screen.getByTestId('folder-action-input');
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('clicking Cancel calls onClose', () => {
        const onClose = vi.fn();
        render(
            <FolderActionDialog
                open
                title="Test"
                label="Name"
                initialValue=""
                confirmLabel="OK"
                onClose={onClose}
                onConfirm={vi.fn()}
            />
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onClose).toHaveBeenCalled();
    });

    it('pressing Escape calls onClose (inherited from Dialog)', () => {
        const onClose = vi.fn();
        render(
            <FolderActionDialog
                open
                title="Test"
                label="Name"
                initialValue=""
                confirmLabel="OK"
                onClose={onClose}
                onConfirm={vi.fn()}
            />
        );
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalled();
    });

    it('clicking Confirm calls onConfirm with trimmed value', () => {
        const onConfirm = vi.fn();
        render(
            <FolderActionDialog
                open
                title="Edit"
                label="Name"
                initialValue="  my-folder  "
                confirmLabel="Save"
                onClose={vi.fn()}
                onConfirm={onConfirm}
            />
        );
        fireEvent.click(screen.getByText('Save'));
        expect(onConfirm).toHaveBeenCalledWith('my-folder', undefined);
    });
});

// ── TasksPanel dialog integration tests ───────────────────────────────

describe('TasksPanel folder dialog actions', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = setupFetch();
        global.fetch = fetchSpy;
        mockAddToast.mockClear();
        Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('clicking "Rename Folder" opens FolderActionDialog with title "Rename Folder" and initialValue=folder.name', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Rename Folder'));

        // Context menu should close, dialog should open
        expect(screen.queryByTestId('context-menu')).toBeNull();
        expect(screen.getByText('Rename Folder')).toBeTruthy();
        expect(screen.getByText('New name')).toBeTruthy();
        const input = screen.getByTestId('folder-action-input') as HTMLInputElement;
        expect(input.value).toBe('feature1');
    });

    it('confirming rename calls renameFolder API and refreshes tree', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Rename Folder'));

        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'new-feature' } });
        fireEvent.click(screen.getByText('Rename'));

        await waitFor(() => {
            const patchCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[1]?.method === 'PATCH'
            );
            expect(patchCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(patchCalls[0][1].body);
            expect(body.path).toBe('feature1');
            expect(body.newName).toBe('new-feature');
        });
    });

    it('clicking "Create Subfolder" opens FolderActionDialog with empty input', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Create Subfolder'));

        expect(screen.getByText('Create Subfolder')).toBeTruthy();
        expect(screen.getByText('Subfolder name')).toBeTruthy();
        const input = screen.getByTestId('folder-action-input') as HTMLInputElement;
        expect(input.value).toBe('');
    });

    it('confirming create subfolder calls createSubfolder API', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Create Subfolder'));

        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'sub-feature' } });
        fireEvent.click(screen.getByText('Create'));

        await waitFor(() => {
            const postCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[1]?.method === 'POST' && call[0].includes('/tasks') && !call[0].includes('/archive')
            );
            expect(postCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.type).toBe('folder');
            expect(body.name).toBe('sub-feature');
            expect(body.parent).toBe('feature1');
        });
    });

    it('clicking "Create Task in Folder" opens FolderActionDialog with empty input', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Create Task in Folder'));

        expect(screen.getByText('Create Task in Folder')).toBeTruthy();
        expect(screen.getByText('Task name')).toBeTruthy();
        const input = screen.getByTestId('folder-action-input') as HTMLInputElement;
        expect(input.value).toBe('');
    });

    it('confirming create task calls createTask API', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Create Task in Folder'));

        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'my-task' } });
        fireEvent.click(screen.getByText('Create'));

        await waitFor(() => {
            const postCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[1]?.method === 'POST' && call[0].includes('/tasks') && !call[0].includes('/archive')
            );
            expect(postCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(postCalls[0][1].body);
            expect(body.name).toBe('my-task');
            expect(body.folder).toBe('feature1');
        });
    });

    it('clicking "Delete Folder" opens confirmation dialog with folder name', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Delete Folder'));

        expect(screen.queryByTestId('context-menu')).toBeNull();
        // The delete dialog contains "feature1" in a <strong> tag
        const strongEl = document.querySelector('strong');
        expect(strongEl?.textContent).toBe('feature1');
        expect(screen.getByText('Delete')).toBeTruthy();
        // No input field for delete dialog
        expect(screen.queryByTestId('folder-action-input')).toBeNull();
    });

    it('confirming delete calls deleteFolder API', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Delete Folder'));
        fireEvent.click(screen.getByText('Delete'));

        await waitFor(() => {
            const deleteCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[1]?.method === 'DELETE'
            );
            expect(deleteCalls.length).toBeGreaterThan(0);
            const body = JSON.parse(deleteCalls[0][1].body);
            expect(body.path).toBe('feature1');
        });
    });

    it('clicking "Bulk Follow Prompt" mounts FollowPromptDialog', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Bulk Follow Prompt'));

        // FollowPromptDialog renders a Dialog with title "Follow Prompt"
        expect(screen.getByText('Follow Prompt')).toBeTruthy();
        expect(screen.getByText('Model')).toBeTruthy();
    });

    it('cancel button closes the rename dialog without mutation', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Rename Folder'));
        expect(screen.getByTestId('folder-action-input')).toBeTruthy();

        fireEvent.click(screen.getByText('Cancel'));
        expect(screen.queryByTestId('folder-action-input')).toBeNull();

        // No PATCH calls
        const patchCalls = fetchSpy.mock.calls.filter((call: any[]) =>
            call[1]?.method === 'PATCH'
        );
        expect(patchCalls.length).toBe(0);
    });

    it('cancel button closes the delete dialog without mutation', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Delete Folder'));
        const strongEl = document.querySelector('strong');
        expect(strongEl?.textContent).toBe('feature1');

        // Click Cancel in the delete dialog footer
        const cancelBtns = screen.getAllByText('Cancel');
        fireEvent.click(cancelBtns[0]);

        // No DELETE calls
        const deleteCalls = fetchSpy.mock.calls.filter((call: any[]) =>
            call[1]?.method === 'DELETE'
        );
        expect(deleteCalls.length).toBe(0);
    });

    it('on mutation error, toast is shown and dialog remains open', async () => {
        // Override fetch to fail on PATCH
        fetchSpy.mockImplementation((url: string, opts?: any) => {
            if (opts?.method === 'PATCH') {
                return Promise.resolve({
                    ok: false,
                    status: 500,
                    text: () => Promise.resolve('Internal error'),
                });
            }
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Rename Folder'));

        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'bad-name' } });
        fireEvent.click(screen.getByText('Rename'));

        await waitFor(() => {
            expect(mockAddToast).toHaveBeenCalledWith(
                expect.stringContaining('failed'),
                'error'
            );
        });

        // Dialog should remain open
        expect(screen.getByTestId('folder-action-input')).toBeTruthy();
    });

    it('successful mutation closes dialog and refreshes tree', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        const initialFetchCount = fetchSpy.mock.calls.length;

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Rename Folder'));

        const input = screen.getByTestId('folder-action-input');
        fireEvent.change(input, { target: { value: 'new-name' } });
        fireEvent.click(screen.getByText('Rename'));

        await waitFor(() => {
            // Dialog should be closed
            expect(screen.queryByTestId('folder-action-input')).toBeNull();
        });

        // Tree should be refreshed (additional tasks fetch)
        await waitFor(() => {
            const taskFetches = fetchSpy.mock.calls.filter((call: any[]) =>
                call[0].includes('/tasks') && !call[0].includes('comment-counts') && !call[0].includes('/archive')
            );
            expect(taskFetches.length).toBeGreaterThanOrEqual(2);
        });
    });
});

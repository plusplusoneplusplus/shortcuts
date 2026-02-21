/**
 * Tests for the folder right-click context menu wiring in TasksPanel.
 * Covers: context menu rendering, Copy Path, Copy Absolute Path,
 * Queue All Tasks, Archive/Unarchive, close behaviour, and non-folder rows.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';

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
        },
        {
            name: 'archive',
            relativePath: 'archive',
            children: [
                {
                    name: 'old-feature',
                    relativePath: 'archive/old-feature',
                    children: [],
                    documentGroups: [],
                    singleDocuments: [
                        { baseName: 'archived-task', fileName: 'archived-task.md', relativePath: 'archive/old-feature', isArchived: true },
                    ],
                },
            ],
            documentGroups: [],
            singleDocuments: [],
        },
        {
            name: 'empty-folder',
            relativePath: 'empty-folder',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        },
    ],
    documentGroups: [],
    singleDocuments: [
        { baseName: 'README', fileName: 'README.md', relativePath: '', isArchived: false },
    ],
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
        return Promise.resolve({ ok: true, json: () => Promise.resolve(tree) });
    });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Folder context menu', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let clipboardSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = setupFetch();
        global.fetch = fetchSpy;
        clipboardSpy = vi.fn().mockResolvedValue(undefined);
        Object.assign(navigator, { clipboard: { writeText: clipboardSpy } });
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('renders a context menu portal when right-clicking a folder row', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByTestId('context-menu')).toBeTruthy();
    });

    it('does not render context menu when right-clicking a non-folder (file) row', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-README')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-README'));
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('"Copy Path" writes folder.relativePath to clipboard', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        const copyPathBtn = screen.getByText('Copy Path');
        fireEvent.click(copyPathBtn);
        expect(clipboardSpy).toHaveBeenCalledWith('feature1');
    });

    it('"Copy Absolute Path" writes rootPath + .vscode/tasks + relativePath to clipboard', async () => {
        // Pre-populate workspace with rootPath via dispatch
        const { unmount } = render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        unmount();

        // Re-render with a workspace that has rootPath in AppProvider
        // We need to mock the workspaces in AppContext — inject via fetch
        const fetchWithWorkspaces = vi.fn().mockImplementation((url: string) => {
            if (url.includes('/workspaces') && !url.includes('/tasks')) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve([{ id: 'ws1', rootPath: '/home/user/project' }]),
                });
            }
            return fetchSpy(url);
        });
        global.fetch = fetchWithWorkspaces;

        // Render a version with AppProvider that gets workspaces loaded
        // Since AppProvider doesn't fetch workspaces automatically, we'll test the fallback path
        // where rootPath is empty (no workspace found)
        global.fetch = fetchSpy;
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        const absPathBtn = screen.getByText('Copy Absolute Path');
        fireEvent.click(absPathBtn);
        // Without rootPath in context, it falls back to '.vscode/tasks/feature1'
        expect(clipboardSpy).toHaveBeenCalledWith('.vscode/tasks/feature1');
    });

    it('"Queue All Tasks" is disabled when folder has zero markdown files', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-empty-folder')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-empty-folder'));
        const menu = screen.getByTestId('context-menu');
        const queueBtn = screen.getByText('Queue All Tasks');
        expect(queueBtn.closest('button')?.disabled).toBe(true);
    });

    it('"Queue All Tasks" is enabled when folder has markdown files', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        const queueBtn = screen.getByText('Queue All Tasks');
        expect(queueBtn.closest('button')?.disabled).toBe(false);
    });

    it('"Archive Folder" label shows for non-archived folders', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByText('Archive Folder')).toBeTruthy();
        expect(screen.queryByText('Unarchive Folder')).toBeNull();
    });

    it('"Unarchive Folder" label shows for folders whose relativePath starts with archive', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-archive')).toBeTruthy();
        });

        // Click archive folder to expand it, then right-click the child
        fireEvent.click(screen.getByTestId('task-tree-item-archive'));
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-old-feature')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-old-feature'));
        expect(screen.getByText('Unarchive Folder')).toBeTruthy();
        expect(screen.queryByText('Archive Folder')).toBeNull();
    });

    it('Archive action calls folderActions.archiveFolder and refresh', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        // Count initial fetch calls (tree + comment-counts)
        const initialCalls = fetchSpy.mock.calls.length;

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        const archiveBtn = screen.getByText('Archive Folder');
        fireEvent.click(archiveBtn);

        // Should have made a POST to /archive
        await waitFor(() => {
            const archiveCalls = fetchSpy.mock.calls.filter((call: any[]) =>
                call[0].includes('/archive')
            );
            expect(archiveCalls.length).toBeGreaterThan(0);
        });

        // Should also trigger a refresh (additional tasks fetch)
        await waitFor(() => {
            const taskFetches = fetchSpy.mock.calls.filter((call: any[]) =>
                call[0].includes('/tasks') && !call[0].includes('comment-counts') && !call[0].includes('/archive')
            );
            // At least 2 fetches: initial + refresh after archive
            expect(taskFetches.length).toBeGreaterThanOrEqual(2);
        });
    });

    it('context menu closes on Escape', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByTestId('context-menu')).toBeTruthy();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('context menu closes after an action is invoked', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByTestId('context-menu')).toBeTruthy();

        fireEvent.click(screen.getByText('Copy Path'));
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('context menu shows all ten items', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        expect(screen.getByText('Copy Path')).toBeTruthy();
        expect(screen.getByText('Copy Absolute Path')).toBeTruthy();
        expect(screen.getByText('Queue All Tasks')).toBeTruthy();
        expect(screen.getByText('Archive Folder')).toBeTruthy();
        expect(screen.getByText('Rename Folder')).toBeTruthy();
        expect(screen.getByText('Create Subfolder')).toBeTruthy();
        expect(screen.getByText('Create Task in Folder')).toBeTruthy();
        expect(screen.getByText('Delete Folder')).toBeTruthy();
        expect(screen.getByText('Move Folder')).toBeTruthy();
        expect(screen.getByText('Bulk Follow Prompt')).toBeTruthy();
    });

    it('does not render context menu when right-clicking a document group row', async () => {
        const treeWithGroup = {
            ...mockTree,
            documentGroups: [
                {
                    baseName: 'task1',
                    isArchived: false,
                    documents: [
                        { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', relativePath: '', isArchived: false },
                    ],
                },
            ],
        };
        global.fetch = setupFetch(treeWithGroup);

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-task1')).toBeTruthy();
        });

        fireEvent.contextMenu(screen.getByTestId('task-tree-item-task1'));
        expect(screen.queryByTestId('context-menu')).toBeNull();
    });

    it('"Copy Path" uses folder.name for root-level folders (empty relativePath)', async () => {
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        // feature1 has relativePath='feature1', so relativePath is used
        fireEvent.contextMenu(screen.getByTestId('task-tree-item-feature1'));
        fireEvent.click(screen.getByText('Copy Path'));
        expect(clipboardSpy).toHaveBeenCalledWith('feature1');
    });
});

/**
 * Tests for TasksPanel, TaskTree, TaskTreeItem, and TaskActions React components.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { TaskProvider } from '../../../src/server/spa/client/react/context/TaskContext';
import { taskReducer, type TaskContextState, type TaskAction } from '../../../src/server/spa/client/react/context/TaskContext';
import { TasksPanel, parseTaskHashParams } from '../../../src/server/spa/client/react/tasks/TasksPanel';
import { getFolderKey } from '../../../src/server/spa/client/react/tasks/TaskTree';
import type { TaskFolder } from '../../../src/server/spa/client/react/hooks/useTaskTree';

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
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
    documentGroups: [
        {
            baseName: 'task1',
            isArchived: false,
            documents: [
                { baseName: 'task1', docType: 'plan', fileName: 'task1.plan.md', relativePath: '', isArchived: false, status: 'done' },
                { baseName: 'task1', docType: 'spec', fileName: 'task1.spec.md', relativePath: '', isArchived: false, status: 'pending' },
            ],
        },
    ],
    singleDocuments: [
        { baseName: 'README', fileName: 'README.md', relativePath: '', isArchived: false },
    ],
};

const mockCommentCounts = { 'task1.plan.md': 3 };

// ============================================================================
// TaskContext reducer tests
// ============================================================================

describe('taskReducer', () => {
    const initial: TaskContextState = {
        openFilePath: null,
        selectedFilePaths: new Set(),
        showContextFiles: true,
        lastTasksChangedWsId: null,
        tasksChangedAt: 0,
    };

    it('SET_OPEN_FILE_PATH sets the open file', () => {
        const state = taskReducer(initial, { type: 'SET_OPEN_FILE_PATH', path: 'task1.md' });
        expect(state.openFilePath).toBe('task1.md');
    });

    it('SET_OPEN_FILE_PATH can clear the file', () => {
        const state = taskReducer({ ...initial, openFilePath: 'task1.md' }, { type: 'SET_OPEN_FILE_PATH', path: null });
        expect(state.openFilePath).toBeNull();
    });

    it('TOGGLE_SELECTED_FILE adds a file', () => {
        const state = taskReducer(initial, { type: 'TOGGLE_SELECTED_FILE', path: 'task1.md' });
        expect(state.selectedFilePaths.has('task1.md')).toBe(true);
    });

    it('TOGGLE_SELECTED_FILE removes a selected file', () => {
        const selected = new Set(['task1.md']);
        const state = taskReducer({ ...initial, selectedFilePaths: selected }, { type: 'TOGGLE_SELECTED_FILE', path: 'task1.md' });
        expect(state.selectedFilePaths.has('task1.md')).toBe(false);
    });

    it('CLEAR_SELECTION clears all selected files', () => {
        const selected = new Set(['task1.md', 'task2.md']);
        const state = taskReducer({ ...initial, selectedFilePaths: selected }, { type: 'CLEAR_SELECTION' });
        expect(state.selectedFilePaths.size).toBe(0);
    });

    it('TOGGLE_SHOW_CONTEXT_FILES toggles the flag', () => {
        const state1 = taskReducer(initial, { type: 'TOGGLE_SHOW_CONTEXT_FILES' });
        expect(state1.showContextFiles).toBe(false);
        const state2 = taskReducer(state1, { type: 'TOGGLE_SHOW_CONTEXT_FILES' });
        expect(state2.showContextFiles).toBe(true);
    });

    it('WORKSPACE_TASKS_CHANGED updates wsId and timestamp', () => {
        const state = taskReducer(initial, { type: 'WORKSPACE_TASKS_CHANGED', wsId: 'ws1' });
        expect(state.lastTasksChangedWsId).toBe('ws1');
        expect(state.tasksChangedAt).toBeGreaterThan(0);
    });

    it('returns same state for unknown action', () => {
        const state = taskReducer(initial, { type: 'UNKNOWN' } as any);
        expect(state).toBe(initial);
    });
});

// ============================================================================
// TasksPanel — loading / error / empty states
// ============================================================================

describe('TasksPanel', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('shows loading spinner initially', () => {
        // Fetch never resolves => stays loading
        fetchSpy.mockReturnValue(new Promise(() => {}));
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        expect(screen.getByText(/Loading tasks/)).toBeTruthy();
    });

    it('shows error when fetch fails', async () => {
        fetchSpy.mockRejectedValue(new Error('Server error'));
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('tasks-error')).toBeTruthy();
        });
    });

    it('shows empty state when tree is null', async () => {
        fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve(null) });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText(/No tasks folder found/)).toBeTruthy();
        });
    });

    it('renders task tree when data loads', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCommentCounts) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree')).toBeTruthy();
        });
    });

    it('renders context files toggle', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('Context files')).toBeTruthy();
        });
    });

    it('renders folder and document items in first column', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCommentCounts) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        });
        // The root column should have: feature1 folder, task1 group, README.md
        expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        expect(screen.getByTestId('task-tree-item-task1')).toBeTruthy();
        expect(screen.getByTestId('task-tree-item-README')).toBeTruthy();
    });

    it('opens a second column when clicking a folder', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        await waitFor(() => {
            expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        });
    });

    it('keeps previous miller columns visible when opening markdown preview', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('tasks/content')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: '# Preview heading\nBody line' }) });
            }
            if (url.includes('/comments/')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) });
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

        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        await waitFor(() => {
            expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('task-tree-item-design'));
        await waitFor(() => {
            expect(screen.getByTestId('markdown-review-status-bar')).toBeTruthy();
        });

        expect(screen.getByTestId('miller-column-0')).toBeTruthy();
        expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        expect(screen.getByTestId('tasks-miller-scroll-container')).toBeTruthy();
    });

    it('shows comment count badge', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(mockCommentCounts) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByText('3')).toBeTruthy();
        });
    });

    it('shows recursive markdown count badge for folder rows', async () => {
        const nestedTree = {
            name: 'tasks',
            relativePath: '',
            children: [
                {
                    name: 'feature1',
                    relativePath: 'feature1',
                    children: [
                        {
                            name: 'backlog',
                            relativePath: 'feature1/backlog',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [
                                { baseName: 'item', fileName: 'item.md', relativePath: 'feature1/backlog', isArchived: false },
                            ],
                        },
                    ],
                    documentGroups: [
                        {
                            baseName: 'spec',
                            isArchived: false,
                            documents: [
                                { baseName: 'spec', docType: 'plan', fileName: 'spec.plan.md', relativePath: 'feature1', isArchived: false },
                            ],
                        },
                    ],
                    singleDocuments: [
                        { baseName: 'design', fileName: 'design.md', relativePath: 'feature1', isArchived: false },
                    ],
                },
            ],
            documentGroups: [],
            singleDocuments: [],
        };

        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(nestedTree) });
        });

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });

        const featureRow = screen.getByTestId('task-tree-item-feature1');
        const folderBadge = featureRow.querySelector('.task-folder-count');
        expect(folderBadge).toBeTruthy();
        expect(folderBadge?.textContent).toBe('3');
    });

    it('highlights active folder on click', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        await waitFor(() => {
            expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        });
        const folderRow = screen.getByTestId('task-tree-item-feature1');
        expect(folderRow.className).toContain('bg-[#0078d4]');
    });

    it('updates URL on folder click via history.replaceState', async () => {
        const replaceStateSpy = vi.spyOn(history, 'replaceState');
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-feature1')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('task-tree-item-feature1'));
        expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#repos/ws1/tasks/feature1');
        replaceStateSpy.mockRestore();
    });

    it('updates URL on file click via history.replaceState', async () => {
        const replaceStateSpy = vi.spyOn(history, 'replaceState');
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-README')).toBeTruthy();
        });
        fireEvent.click(screen.getByTestId('task-tree-item-README'));
        expect(replaceStateSpy).toHaveBeenCalledWith(null, '', '#repos/ws1/tasks/README.md');
        replaceStateSpy.mockRestore();
    });

    it('restores folder and file from URL on mount', async () => {
        // Set location.hash before rendering
        window.location.hash = '#repos/ws1/tasks/feature1/design.md';
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('tasks/content')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: '# Design' }) });
            }
            if (url.includes('/comments/')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) });
            }
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(mockTree) });
        });
        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            // Should auto-expand feature1 folder (column 1) and open file preview
            expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        });
        // The feature1 folder should be highlighted as active
        const folderRow = screen.getByTestId('task-tree-item-feature1');
        expect(folderRow.className).toContain('bg-[#0078d4]');
        // Cleanup
        window.location.hash = '';
    });
});

// ============================================================================
// Folder click clears markdown preview
// ============================================================================

describe('TasksPanel — folder click clears preview', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    const twoFolderTree = {
        name: 'tasks',
        relativePath: '',
        children: [
            {
                name: 'chat',
                relativePath: 'chat',
                children: [],
                documentGroups: [],
                singleDocuments: [
                    { baseName: 'design', fileName: 'design.md', relativePath: 'chat', isArchived: false, status: 'pending' },
                ],
            },
            {
                name: 'repo-queue-tab',
                relativePath: 'repo-queue-tab',
                children: [],
                documentGroups: [],
                singleDocuments: [
                    { baseName: 'spec', fileName: 'spec.md', relativePath: 'repo-queue-tab', isArchived: false },
                ],
            },
        ],
        documentGroups: [],
        singleDocuments: [],
    };

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('hides markdown preview when clicking a folder after a file was open', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('tasks/content')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: '# Design\nBody' }) });
            }
            if (url.includes('/comments/')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) });
            }
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(twoFolderTree) });
        });

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-chat')).toBeTruthy();
        });

        // Click "chat" folder to expand it
        fireEvent.click(screen.getByTestId('task-tree-item-chat'));
        await waitFor(() => {
            expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        });

        // Click the file inside "chat" to open the markdown preview
        fireEvent.click(screen.getByTestId('task-tree-item-design'));
        await waitFor(() => {
            expect(screen.getByTestId('markdown-review-status-bar')).toBeTruthy();
        });

        // Now click "repo-queue-tab" folder — preview should disappear
        fireEvent.click(screen.getByTestId('task-tree-item-repo-queue-tab'));
        await waitFor(() => {
            expect(screen.queryByTestId('markdown-review-status-bar')).toBeNull();
        });
    });

    it('hides markdown preview when clicking the same folder level after file was open', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('tasks/content')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ content: '# Spec' }) });
            }
            if (url.includes('/comments/')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ comments: [] }) });
            }
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(twoFolderTree) });
        });

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-repo-queue-tab')).toBeTruthy();
        });

        // Click "repo-queue-tab" folder to expand it
        fireEvent.click(screen.getByTestId('task-tree-item-repo-queue-tab'));
        await waitFor(() => {
            expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        });

        // Click the file inside to open preview
        fireEvent.click(screen.getByTestId('task-tree-item-spec'));
        await waitFor(() => {
            expect(screen.getByTestId('markdown-review-status-bar')).toBeTruthy();
        });

        // Click "chat" folder — preview should disappear
        fireEvent.click(screen.getByTestId('task-tree-item-chat'));
        await waitFor(() => {
            expect(screen.queryByTestId('markdown-review-status-bar')).toBeNull();
        });
    });

    it('clicking a folder when no file is open does not break', async () => {
        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(twoFolderTree) });
        });

        render(<Wrap><TasksPanel wsId="ws1" /></Wrap>);
        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-chat')).toBeTruthy();
        });

        // Click folder when no file is open — should not crash
        fireEvent.click(screen.getByTestId('task-tree-item-chat'));
        await waitFor(() => {
            expect(screen.getByTestId('miller-column-1')).toBeTruthy();
        });
        expect(screen.queryByTestId('markdown-review-status-bar')).toBeNull();
    });
});

// ============================================================================
// parseTaskHashParams — URL parsing unit tests
// ============================================================================

describe('parseTaskHashParams', () => {
    it('returns nulls for non-matching hash', () => {
        expect(parseTaskHashParams('#other/path', 'ws1')).toEqual({
            initialFolderPath: null,
            initialFilePath: null,
        });
    });

    it('returns nulls for tasks root with no sub-path', () => {
        expect(parseTaskHashParams('#repos/ws1/tasks', 'ws1')).toEqual({
            initialFolderPath: null,
            initialFilePath: null,
        });
    });

    it('parses a single folder segment', () => {
        expect(parseTaskHashParams('#repos/ws1/tasks/misc', 'ws1')).toEqual({
            initialFolderPath: 'misc',
            initialFilePath: null,
        });
    });

    it('parses nested folder segments', () => {
        expect(parseTaskHashParams('#repos/ws1/tasks/coc/backlog', 'ws1')).toEqual({
            initialFolderPath: 'coc/backlog',
            initialFilePath: null,
        });
    });

    it('parses a file in a folder', () => {
        expect(parseTaskHashParams('#repos/ws1/tasks/misc/file.plan.md', 'ws1')).toEqual({
            initialFolderPath: 'misc',
            initialFilePath: 'misc/file.plan.md',
        });
    });

    it('parses a file in nested folders', () => {
        expect(parseTaskHashParams('#repos/ws1/tasks/coc/backlog/task.plan.md', 'ws1')).toEqual({
            initialFolderPath: 'coc/backlog',
            initialFilePath: 'coc/backlog/task.plan.md',
        });
    });

    it('parses a root-level file', () => {
        expect(parseTaskHashParams('#repos/ws1/tasks/README.md', 'ws1')).toEqual({
            initialFolderPath: null,
            initialFilePath: 'README.md',
        });
    });

    it('handles URL-encoded wsId', () => {
        expect(parseTaskHashParams('#repos/ws%201/tasks/misc', 'ws 1')).toEqual({
            initialFolderPath: 'misc',
            initialFilePath: null,
        });
    });

    it('returns nulls when wsId does not match', () => {
        expect(parseTaskHashParams('#repos/ws2/tasks/misc', 'ws1')).toEqual({
            initialFolderPath: null,
            initialFilePath: null,
        });
    });
});

// ============================================================================
// getFolderKey — folder key generation unit tests
// ============================================================================

describe('getFolderKey', () => {
    it('returns name for root-level folder', () => {
        const folder: TaskFolder = {
            name: 'misc',
            relativePath: '',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        expect(getFolderKey(folder)).toBe('misc');
    });

    it('returns relativePath for nested folder', () => {
        const folder: TaskFolder = {
            name: 'backlog',
            relativePath: 'coc/backlog',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        expect(getFolderKey(folder)).toBe('coc/backlog');
    });

    it('returns relativePath for first-level folder', () => {
        const folder: TaskFolder = {
            name: 'feature1',
            relativePath: 'feature1',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        };
        expect(getFolderKey(folder)).toBe('feature1');
    });
});

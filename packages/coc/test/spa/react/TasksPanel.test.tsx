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
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';

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
});

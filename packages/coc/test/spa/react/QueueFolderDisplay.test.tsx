/**
 * Tests for queue folder display: grouping, badges, and folder queue counts.
 * Covers ProcessesSidebar grouping, QueueTaskCard folder badge, TaskTreeItem folderQueueCount,
 * and TaskTree folderMap wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { TaskProvider } from '../../../src/server/spa/client/react/context/TaskContext';
import { ProcessesSidebar } from '../../../src/server/spa/client/react/processes/ProcessesSidebar';
import { TaskTreeItem, type TaskTreeItemProps } from '../../../src/server/spa/client/react/tasks/TaskTreeItem';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';

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

// Seed queue state with running/queued tasks
function SeededQueuePanelWithTasks({ running, queued }: { running: any[]; queued: any[] }) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({
            type: 'QUEUE_UPDATED',
            queue: {
                running,
                queued,
                stats: { queued: queued.length, running: running.length, completed: 0, failed: 0 },
            },
        });
    }, [dispatch, running, queued]);
    return <ProcessesSidebar />;
}

// ============================================================================
// ProcessesSidebar — grouping by folderPath
// ============================================================================

describe('ProcessesSidebar folder grouping', () => {
    it('groups running tasks by folderPath with folder headings', () => {
        const running = [
            { id: 't1', status: 'running', folderPath: 'features/auth', prompt: 'task 1', startTime: new Date().toISOString() },
            { id: 't2', status: 'running', folderPath: 'features/auth', prompt: 'task 2', startTime: new Date().toISOString() },
            { id: 't3', status: 'running', folderPath: 'features/ui', prompt: 'task 3', startTime: new Date().toISOString() },
        ];

        render(<Wrap><SeededQueuePanelWithTasks running={running} queued={[]} /></Wrap>);

        // Folder headings should be present
        const headings = document.querySelectorAll('.queue-folder-heading');
        expect(headings.length).toBe(2);
        expect(headings[0].textContent).toContain('features/auth');
        expect(headings[1].textContent).toContain('features/ui');
    });

    it('renders no folder heading for null folderPath group', () => {
        const running = [
            { id: 't1', status: 'running', folderPath: null, prompt: 'task 1', startTime: new Date().toISOString() },
            { id: 't2', status: 'running', prompt: 'task 2', startTime: new Date().toISOString() }, // undefined folderPath
        ];

        render(<Wrap><SeededQueuePanelWithTasks running={running} queued={[]} /></Wrap>);

        // No folder heading for null/undefined group
        const headings = document.querySelectorAll('.queue-folder-heading');
        expect(headings.length).toBe(0);
    });

    it('groups queued tasks by folderPath', () => {
        const queued = [
            { id: 'q1', status: 'queued', folderPath: 'features/auth', prompt: 'queued 1' },
            { id: 'q2', status: 'queued', folderPath: 'features/auth', prompt: 'queued 2' },
        ];

        render(<Wrap><SeededQueuePanelWithTasks running={[]} queued={queued} /></Wrap>);

        const headings = document.querySelectorAll('.queue-folder-heading');
        expect(headings.length).toBe(1);
        expect(headings[0].textContent).toContain('features/auth');
    });

    it('places null-folder group last', () => {
        const running = [
            { id: 't1', status: 'running', prompt: 'no folder', startTime: new Date().toISOString() },
            { id: 't2', status: 'running', folderPath: 'a-folder', prompt: 'has folder', startTime: new Date().toISOString() },
        ];

        render(<Wrap><SeededQueuePanelWithTasks running={running} queued={[]} /></Wrap>);

        // The folder heading should appear, meaning 'a-folder' renders first
        const headings = document.querySelectorAll('.queue-folder-heading');
        expect(headings.length).toBe(1);
        expect(headings[0].textContent).toContain('a-folder');
    });
});

// ============================================================================
// QueueTaskCard — folder breadcrumb badge
// ============================================================================

describe('QueueTaskCard folder badge', () => {
    it('shows folder badge in full layout when folderPath is set', () => {
        const running = [
            { id: 't1', status: 'running', folderPath: 'features/auth/tasks', prompt: 'test task', startTime: new Date().toISOString() },
        ];

        render(<Wrap><SeededQueuePanelWithTasks running={running} queued={[]} /></Wrap>);

        const badge = document.querySelector('.queue-task-folder-badge');
        expect(badge).toBeTruthy();
        expect(badge?.textContent).toContain('features/auth/tasks');
    });

    it('does not show folder badge when folderPath is absent', () => {
        const running = [
            { id: 't1', status: 'running', prompt: 'test task', startTime: new Date().toISOString() },
        ];

        render(<Wrap><SeededQueuePanelWithTasks running={running} queued={[]} /></Wrap>);

        const badge = document.querySelector('.queue-task-folder-badge');
        expect(badge).toBeNull();
    });

    it('truncates long folderPath with leading ellipsis', () => {
        const longPath = 'a/very/deeply/nested/folder/structure/that/is/longer/than/thirty/two/characters';
        const running = [
            { id: 't1', status: 'running', folderPath: longPath, prompt: 'test', startTime: new Date().toISOString() },
        ];

        render(<Wrap><SeededQueuePanelWithTasks running={running} queued={[]} /></Wrap>);

        const badge = document.querySelector('.queue-task-folder-badge');
        expect(badge).toBeTruthy();
        const text = badge?.textContent || '';
        expect(text).toContain('…');
        // Should not contain the full path
        expect(text).not.toContain(longPath);
    });

    it('does not show folder badge in compact layout (history)', () => {
        // History items use compact layout
        const { dispatch } = { dispatch: null as any };
        function SeededHistory() {
            const { dispatch: d } = useQueue();
            useEffect(() => {
                d({ type: 'SET_HISTORY', history: [
                    { id: 'h1', status: 'completed', folderPath: 'features/auth', prompt: 'done task' },
                ] });
                d({ type: 'TOGGLE_HISTORY' });
            }, [d]);
            return <ProcessesSidebar />;
        }

        render(<Wrap><SeededHistory /></Wrap>);

        // Compact cards should not have the folder badge
        const badge = document.querySelector('.queue-task-folder-badge');
        expect(badge).toBeNull();
    });
});

// ============================================================================
// TaskTreeItem — folderQueueCount badge
// ============================================================================

describe('TaskTreeItem folderQueueCount badge', () => {
    const baseFolderProps: TaskTreeItemProps = {
        item: {
            name: 'auth',
            relativePath: 'features/auth',
            children: [],
            documentGroups: [],
            singleDocuments: [],
        } as any,
        wsId: 'ws1',
        isSelected: false,
        isOpen: false,
        commentCount: 0,
        queueRunning: 0,
        folderMdCount: 3,
        showContextFiles: true,
        onFolderClick: vi.fn(),
        onFileClick: vi.fn(),
        onCheckboxChange: vi.fn(),
    };

    it('renders folder queue badge with count when folderQueueCount > 0', () => {
        render(
            <ul>
                <TaskTreeItem {...baseFolderProps} folderQueueCount={3} />
            </ul>
        );

        const row = screen.getByTestId('task-tree-item-auth');
        const badges = row.querySelectorAll('.miller-queue-indicator-running');
        // Should have the folder queue badge
        const folderBadge = Array.from(badges).find(b => b.textContent?.includes('3 in progress'));
        expect(folderBadge).toBeTruthy();
        expect(folderBadge?.classList.contains('animate-pulse')).toBe(true);
    });

    it('does not render folder queue badge when folderQueueCount is 0', () => {
        render(
            <ul>
                <TaskTreeItem {...baseFolderProps} folderQueueCount={0} />
            </ul>
        );

        const row = screen.getByTestId('task-tree-item-auth');
        const badges = row.querySelectorAll('.miller-queue-indicator-running');
        const folderBadge = Array.from(badges).find(b => b.textContent?.includes('in progress'));
        expect(folderBadge).toBeFalsy();
    });

    it('does not render folder queue badge when folderQueueCount is undefined', () => {
        render(
            <ul>
                <TaskTreeItem {...baseFolderProps} />
            </ul>
        );

        const row = screen.getByTestId('task-tree-item-auth');
        const badges = row.querySelectorAll('.miller-queue-indicator-running');
        const folderBadge = Array.from(badges).find(b => b.textContent?.includes('in progress'));
        expect(folderBadge).toBeFalsy();
    });

    it('does not render folder queue badge for non-folder items', () => {
        const fileProps: TaskTreeItemProps = {
            ...baseFolderProps,
            item: {
                baseName: 'spec',
                fileName: 'spec.md',
                relativePath: 'features/auth',
                isArchived: false,
                status: 'pending',
            } as any,
            folderQueueCount: 5,
        };

        render(
            <ul>
                <TaskTreeItem {...fileProps} />
            </ul>
        );

        const row = screen.getByTestId('task-tree-item-spec');
        const badges = row.querySelectorAll('.miller-queue-indicator-running');
        const folderBadge = Array.from(badges).find(b => b.textContent?.includes('5 in progress'));
        expect(folderBadge).toBeFalsy();
    });

    it('renders folderMdCount badge alongside folderQueueCount badge', () => {
        render(
            <ul>
                <TaskTreeItem {...baseFolderProps} folderQueueCount={2} />
            </ul>
        );

        const row = screen.getByTestId('task-tree-item-auth');
        // folderMdCount badge
        const mdBadge = row.querySelector('.task-folder-count');
        expect(mdBadge).toBeTruthy();
        expect(mdBadge?.textContent).toBe('3');
        // folderQueueCount badge
        const queueBadges = row.querySelectorAll('.miller-queue-indicator-running');
        const folderBadge = Array.from(queueBadges).find(b => b.textContent?.includes('2 in progress'));
        expect(folderBadge).toBeTruthy();
    });

    it('shows singular "task" in title when folderQueueCount is 1', () => {
        render(
            <ul>
                <TaskTreeItem {...baseFolderProps} folderQueueCount={1} />
            </ul>
        );

        const row = screen.getByTestId('task-tree-item-auth');
        const badge = Array.from(row.querySelectorAll('.miller-queue-indicator-running'))
            .find(b => b.textContent?.includes('1 in progress'));
        expect(badge).toBeTruthy();
        expect(badge?.getAttribute('title')).toBe('1 task in progress in this folder');
    });
});

// ============================================================================
// TaskTree — folderMap wiring
// ============================================================================

describe('TaskTree folderMap wiring', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchSpy = vi.fn();
        global.fetch = fetchSpy;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes folderQueueCount to TaskTreeItem for folder nodes', async () => {
        const treeWithFolder = {
            name: 'tasks',
            relativePath: '',
            children: [
                {
                    name: 'features',
                    relativePath: 'features',
                    children: [
                        {
                            name: 'auth',
                            relativePath: 'features/auth',
                            children: [],
                            documentGroups: [],
                            singleDocuments: [
                                { baseName: 'spec', fileName: 'spec.md', relativePath: 'features/auth', isArchived: false },
                            ],
                        },
                    ],
                    documentGroups: [],
                    singleDocuments: [],
                },
            ],
            documentGroups: [],
            singleDocuments: [],
        };

        fetchSpy.mockImplementation((url: string) => {
            if (url.includes('tasks/settings')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ folderPath: '/data/repos/abc/tasks' }) });
            }
            if (url.includes('comment-counts')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve(treeWithFolder) });
        });

        // Seed workspace with rootPath so useQueueActivity can match
        function WrapWithWorkspace({ children }: { children: ReactNode }) {
            return (
                <AppProvider>
                    <QueueProvider>
                        <ToastProvider value={{ addToast: vi.fn(), removeToast: vi.fn(), toasts: [] }}>
                            <SeedWorkspaceAndQueue wsId="ws1" rootPath="/workspace">
                                {children}
                            </SeedWorkspaceAndQueue>
                        </ToastProvider>
                    </QueueProvider>
                </AppProvider>
            );
        }

        function SeedWorkspaceAndQueue({ children, wsId, rootPath }: { children: ReactNode; wsId: string; rootPath: string }) {
            const { dispatch: appDispatch } = useApp();
            const { dispatch: queueDispatch } = useQueue();
            useEffect(() => {
                appDispatch({
                    type: 'WORKSPACES_LOADED',
                    workspaces: [{ id: wsId, rootPath, name: 'test' }],
                } as any);
                queueDispatch({
                    type: 'QUEUE_UPDATED',
                    queue: {
                        running: [
                            {
                                id: 'r1',
                                status: 'running',
                                payload: { planFilePath: `/data/repos/abc/tasks/features/auth/spec.md` },
                            },
                            {
                                id: 'r2',
                                status: 'running',
                                payload: { planFilePath: `/data/repos/abc/tasks/features/auth/other.md` },
                            },
                        ],
                        queued: [],
                        stats: { queued: 0, running: 2, completed: 0, failed: 0 },
                    },
                });
            }, [appDispatch, queueDispatch, wsId, rootPath]);
            return <>{children}</>;
        }

        render(<WrapWithWorkspace><TasksPanel wsId="ws1" /></WrapWithWorkspace>);

        await waitFor(() => {
            expect(screen.getByTestId('task-tree-item-features')).toBeTruthy();
        });

        const featuresRow = screen.getByTestId('task-tree-item-features');
        const badges = featuresRow.querySelectorAll('.miller-queue-indicator-running');
        const folderBadge = Array.from(badges).find(b => b.textContent?.includes('in progress'));
        expect(folderBadge).toBeTruthy();
        // features folder should aggregate the 2 running tasks in features/auth
        expect(folderBadge?.textContent).toContain('2 in progress');
    });
});

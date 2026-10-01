/**
 * Tests for queue folder display: folder queue counts.
 * Covers TaskTreeItem folderQueueCount and TaskTree folderMap wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { TaskProvider } from '../../../src/server/spa/client/react/contexts/TaskContext';
import { TaskTreeItem, type TaskTreeItemProps } from '../../../src/server/spa/client/react/tasks/TaskTreeItem';
import { TasksPanel } from '../../../src/server/spa/client/react/tasks/TasksPanel';

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
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ workflows: [], tasks: treeWithFolder }) });
        });

        // Seed workspace with rootPath so useQueueChat can match
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

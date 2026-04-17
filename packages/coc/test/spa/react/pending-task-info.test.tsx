/**
 * Tests for PendingTaskInfoPanel rendered inside ActivityChatDetail
 * with QueueProvider + AppProvider.
 * Verifies metadata fields, action buttons, task-type-specific payload sections,
 * and the /queue/<id> API call on mount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { ActivityChatDetail } from '../../../src/server/spa/client/react/repos/ActivityChatDetail';

// Mock useChatPrefs to avoid ChatPreferencesProvider requirement
vi.mock('../../../src/server/spa/client/react/context/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        archivedChatIds: new Set<string>(),
        unarchiveChat: vi.fn(),
        pinnedChatIds: new Set<string>(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
    }),
}));

// Mock config to return predictable API base
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
    getWsPath: () => '/ws',
    getWsUrl: () => 'ws://localhost/ws',
}));

// Mock useDisplaySettings
vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/hooks/useContainerWidth', () => ({
    useContainerWidth: () => ({ width: 800, tier: 'wide', isWide: true, isMedium: false, isNarrow: false }),
}));

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

/**
 * Seeds a pending (queued) task into queue state and selects it,
 * so ActivityChatDetail renders the PendingTaskInfoPanel.
 */
function SeededActivityChatDetail({ task }: { task: any }) {
    const { dispatch: queueDispatch } = useQueue();
    useEffect(() => {
        queueDispatch({ type: 'QUEUE_UPDATED', queue: { queued: [task], running: [], stats: {} } });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
    }, []);
    return <ActivityChatDetail taskId={task.id} />;
}

function makePendingTask(overrides?: Partial<any>): any {
    return {
        id: 'task-123',
        type: 'run-script',
        status: 'queued',
        displayName: 'My Task',
        createdAt: '2025-01-15T10:00:00Z',
        priority: 'normal',
        repoId: 'repo-abc',
        payload: {
            kind: 'script',
            prompt: 'Please implement the feature.',
            workingDirectory: '/home/user/project',
        },
        config: { model: 'gpt-4' },
        ...overrides,
    };
}

describe('PendingTaskInfoPanel', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function setupFetchForTask(taskData: any) {
        fetchMock.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/queue/') && url.includes('/resolved-prompt')) {
                return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            if (typeof url === 'string' && url.includes('/queue/')) {
                return new Response(JSON.stringify({ task: taskData }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
        });
    }

    it('renders "Task ID", "Working Directory", "Repo ID" metadata fields', async () => {
        const task = makePendingTask();
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
            expect(screen.getByText('task-123')).toBeTruthy();
        });
        expect(screen.getByText('Working Directory')).toBeTruthy();
        const workingDir = screen.getByText('~/project');
        expect(workingDir).toBeTruthy();
        expect(workingDir.getAttribute('data-full-path')).toBe('/home/user/project');
        expect(screen.getByText('Repo ID')).toBeTruthy();
        expect(screen.getByText('repo-abc')).toBeTruthy();
    });

    it('renders "Cancel Task" and "Move to Top" action buttons', async () => {
        const task = makePendingTask();
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Cancel Task')).toBeTruthy();
            expect(screen.getByText('Move to Top')).toBeTruthy();
        });
    });

    it('renders prompt area for chat task type', async () => {
        const task = makePendingTask({
            type: 'chat',
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Please implement the feature.',
                workingDirectory: '/home/user/project',
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Please implement the feature.')).toBeTruthy();
        });
    });

    it('renders prompt for chat task with mode', async () => {
        const task = makePendingTask({
            type: 'chat',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Clarify this function.\n\nfunction doSomething()',
                workingDirectory: '/home/user/project',
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText(/function doSomething\(\)/)).toBeTruthy();
        });
    });

    it('renders resolve-comments payload with document, comments, and prompt', async () => {
        // PendingTaskPayload's resolve-comments section requires type === 'chat'.
        // Since chat tasks now skip PendingTaskInfoPanel in the full flow,
        // test the panel component directly.
        const { PendingTaskInfoPanel } = await import('../../../src/server/spa/client/react/queue/PendingTaskInfoPanel');
        const task = {
            id: 'task-rc',
            type: 'chat',
            status: 'queued',
            displayName: 'Resolve Comments',
            createdAt: '2025-01-15T10:00:00Z',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: '# Document Revision Request\n\nPlease address these comments.',
                workingDirectory: '/home/user/project',
                context: {
                    resolveComments: {
                        filePath: 'docs/readme.md',
                        commentIds: ['c-1', 'c-2'],
                        documentContent: 'content',
                        documentUri: '/tmp/doc',
                    },
                },
            },
        };
        setupFetchForTask(task);

        render(
            <Wrap>
                <PendingTaskInfoPanel task={task} onCancel={vi.fn()} onMoveToTop={vi.fn()} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Resolve Comments Details')).toBeTruthy();
            expect(screen.getByText('Document')).toBeTruthy();
            expect(screen.getByText('Comments')).toBeTruthy();
            expect(screen.getByText('2 (c-1, c-2)')).toBeTruthy();
            expect(screen.getByText('Prompt')).toBeTruthy();
            expect(screen.getByText(/Document Revision Request/)).toBeTruthy();
            expect(screen.getByText(/Please address these comments\./)).toBeTruthy();
        });
    });

    it('renders context files and mode for chat task', async () => {
        // PendingTaskPayload's mode/files section requires type === 'chat'.
        // Since chat tasks now skip PendingTaskInfoPanel in the full flow,
        // test the panel component directly.
        const { PendingTaskInfoPanel } = await import('../../../src/server/spa/client/react/queue/PendingTaskInfoPanel');
        const task = {
            id: 'task-ctx',
            type: 'chat',
            status: 'queued',
            displayName: 'Context Files',
            createdAt: '2025-01-15T10:00:00Z',
            priority: 'normal',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Review these files.',
                workingDirectory: '/home/user/project',
                context: {
                    files: ['/home/user/project/src/auth.ts'],
                },
            },
        };
        setupFetchForTask(task);

        render(
            <Wrap>
                <PendingTaskInfoPanel task={task} onCancel={vi.fn()} onMoveToTop={vi.fn()} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Mode')).toBeTruthy();
            expect(screen.getByText('ask')).toBeTruthy();
        });
    });

    it('calls /queue/<id> API on mount to fetch full task data', async () => {
        const task = makePendingTask();
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            const queueCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/queue/task-123') && !url.includes('resolved-prompt')
            );
            expect(queueCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('shows loading state while fetching task data', async () => {
        const task = makePendingTask();
        // Delay the fetch response
        fetchMock.mockImplementation(() => new Promise(() => {})); // Never resolves

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        // ActivityChatDetail fetches from the API, so a never-resolving fetch shows loading state
        await waitFor(() => {
            expect(screen.getByText('Loading conversation...')).toBeTruthy();
        });
    });

    it('renders hourglass icon in pending task header', async () => {
        const task = makePendingTask();
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('⏳')).toBeTruthy();
        });
    });

    it('renders "Plan File" metadata row when planFilePath is present', async () => {
        const task = makePendingTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Implement the feature.',
                workingDirectory: '/home/user/project',
                planFilePath: '/home/user/project/.vscode/tasks/feature.plan.md',
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Plan File')).toBeTruthy();
        });
        const planFileLink = screen.getByText('~/project/.vscode/tasks/feature.plan.md');
        expect(planFileLink).toBeTruthy();
        expect(planFileLink.getAttribute('data-full-path')).toBe('/home/user/project/.vscode/tasks/feature.plan.md');
    });

    it('renders "File" metadata row when filePath is present', async () => {
        const task = makePendingTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Review this file.',
                workingDirectory: '/home/user/project',
                filePath: '/home/user/project/src/auth.ts',
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('File')).toBeTruthy();
        });
        const fileLink = screen.getByText('~/project/src/auth.ts');
        expect(fileLink).toBeTruthy();
        expect(fileLink.getAttribute('data-full-path')).toBe('/home/user/project/src/auth.ts');
    });

    it('renders "Workflow" metadata row when workflowPath is present', async () => {
        const task = makePendingTask({
            type: 'run-workflow',
            payload: {
                kind: 'run-workflow',
                workflowPath: '/home/user/project/.vscode/workflows/ci/pipeline.yaml',
                workingDirectory: '/home/user/project',
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Workflow')).toBeTruthy();
        });
        const workflowLink = screen.getByText('~/project/.vscode/workflows/ci/pipeline.yaml');
        expect(workflowLink).toBeTruthy();
        expect(workflowLink.getAttribute('data-full-path')).toBe('/home/user/project/.vscode/workflows/ci/pipeline.yaml');
    });

    it('does not render "Plan File", "File", or "Workflow" rows when those fields are absent', async () => {
        const task = makePendingTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Simple chat without file references.',
                workingDirectory: '/home/user/project',
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        expect(screen.queryByText('Plan File')).toBeNull();
        expect(screen.queryByText('File')).toBeNull();
        expect(screen.queryByText('Workflow')).toBeNull();
    });

    it('renders all three file-path metadata rows when all fields are present', async () => {
        const task = makePendingTask({
            payload: {
                kind: 'chat',
                mode: 'autopilot',
                prompt: 'Run workflow with all paths.',
                workingDirectory: '/home/user/project',
                planFilePath: '/home/user/project/tasks/spec.plan.md',
                filePath: '/home/user/project/src/main.ts',
                workflowPath: '/home/user/project/.vscode/workflows/build.yaml',
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededActivityChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Plan File')).toBeTruthy();
            expect(screen.getByText('File')).toBeTruthy();
            expect(screen.getByText('Workflow')).toBeTruthy();
        });
    });
});

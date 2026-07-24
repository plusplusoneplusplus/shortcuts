/**
 * Tests for PendingTaskInfoPanel rendered inside ChatDetail
 * with QueueProvider + AppProvider.
 * Verifies metadata fields, action buttons, task-type-specific payload sections,
 * and the /queue/<id> API call on mount.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { ChatDetail } from '../../../src/server/spa/client/react/features/chat/ChatDetail';

// Mock useChatPrefs to avoid ChatPreferencesProvider requirement
vi.mock('../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
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
    isContainerMode: () => false,
    getApiBase: () => '/api',
    getWsPath: () => '/ws',
    getWsUrl: () => 'ws://localhost/ws',
    isRalphEnabled: () => true,
    isRalphMultiAgentGrillEnabled: () => false,
    isLoopsEnabled: () => false,
    isEffortLevelsEnabled: () => false,
    isForEachEnabled: () => false,
    getDefaultProvider: () => 'copilot' as const,
    getActiveProvider: () => 'copilot' as const,
    isSessionContextAttachmentsEnabled: () => false,
    isCanvasEnabled: () => false,
    isRemoteShellEnabled: () => false,
    isQuickAskSidenotesEnabled: () => false,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    getPrewarmDebounceMs: () => 500,
    getWarmClientTtlMs: () => 300000,
}));

// Mock useDisplaySettings
vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/features/chat/hooks/useContainerWidth', () => ({
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
 * so ChatDetail renders the PendingTaskInfoPanel.
 */
function SeededChatDetail({ task }: { task: any }) {
    const { dispatch: queueDispatch } = useQueue();
    useEffect(() => {
        queueDispatch({ type: 'QUEUE_UPDATED', queue: { queued: [task], running: [], stats: {} } });
        queueDispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
    }, []);
    return <ChatDetail taskId={task.id} />;
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
            kind: 'run-script',
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
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        // Chat tasks now show the full PendingTaskInfoPanel with the prompt
        expect(screen.queryByText(/Task queued, starting soon/)).toBeNull();
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
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        // Chat tasks now show the full PendingTaskInfoPanel
        expect(screen.queryByText(/Task queued, starting soon/)).toBeNull();
        // The prompt is shown
        await waitFor(() => {
            expect(screen.getByText(/function doSomething\(\)/)).toBeTruthy();
        });
    });

    it('renders resolve-comments payload with document, comments, and prompt', async () => {
        const task = makePendingTask({
            type: 'chat',
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
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        // Resolve Comments Details section is now shown for chat tasks too
        expect(screen.queryByText(/Task queued, starting soon/)).toBeNull();
        await waitFor(() => {
            expect(screen.getByText('Resolve Comments Details')).toBeTruthy();
        });
    });

    it('renders context files and mode for chat task', async () => {
        const task = makePendingTask({
            type: 'chat',
            payload: {
                kind: 'chat',
                mode: 'ask',
                prompt: 'Review these files.',
                workingDirectory: '/home/user/project',
                context: {
                    files: ['/home/user/project/src/auth.ts'],
                },
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        // Chat tasks now show the full PendingTaskInfoPanel
        expect(screen.queryByText(/Task queued, starting soon/)).toBeNull();
        // Mode row and files are shown
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
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
            </Wrap>
        );

        // ChatDetail fetches from the API, so a never-resolving fetch shows loading state
        await waitFor(() => {
            expect(screen.getByText('Loading conversation...')).toBeTruthy();
        });
    });

    it('renders hourglass icon in pending task header', async () => {
        const task = makePendingTask();
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
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
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Plan File')).toBeTruthy();
            expect(screen.getByText('File')).toBeTruthy();
            expect(screen.getByText('Workflow')).toBeTruthy();
        });
    });

    it('renders queue position when task is in the queue', async () => {
        const task = makePendingTask();
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            // task-123 is the only queued item, so position should be "1 of 1"
            expect(screen.getByText('Queue Position')).toBeTruthy();
            expect(screen.getByText('1 of 1')).toBeTruthy();
        });
    });

    it('does not render queue position when task is not in the queued list', async () => {
        // Task status is queued but it's absent from queueState.queued (e.g. just transitioned to running)
        const task = makePendingTask();
        setupFetchForTask(task);

        function SeededChatDetailWithoutQueueEntry({ task }: { task: any }) {
            const { dispatch: queueDispatch } = useQueue();
            useEffect(() => {
                // Seed an empty queued list — task-123 is not in it
                queueDispatch({ type: 'QUEUE_UPDATED', queue: { queued: [], running: [], stats: {} } });
                queueDispatch({ type: 'SELECT_QUEUE_TASK', id: task.id });
            }, []);
            return <ChatDetail taskId={task.id} />;
        }

        render(
            <Wrap>
                <SeededChatDetailWithoutQueueEntry task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        expect(screen.queryByText('Queue Position')).toBeNull();
    });

    // AC-04: Provider row
    it('shows Provider badge when task has a concrete provider', async () => {
        const task = makePendingTask({ provider: 'claude' });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Provider')).toBeTruthy();
        });
        const panel = document.querySelector('.pending-task-info')!;
        const badge = within(panel).getByTestId('provider-badge');
        expect(badge.getAttribute('data-provider')).toBe('claude');
        expect(badge.textContent).toContain('Claude');
    });

    it('shows "Auto (pending)" Provider badge when auto-routing is requested but not yet resolved', async () => {
        const task = makePendingTask({
            status: 'queued',
            payload: {
                kind: 'chat',
                workingDirectory: '/home/user/project',
                context: {
                    autoProviderRouting: { requested: true },
                },
            },
        });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Provider')).toBeTruthy();
        });
        const panel = document.querySelector('.pending-task-info')!;
        const badge = within(panel).getByTestId('provider-badge');
        expect(badge.getAttribute('data-provider')).toBe('auto-pending');
        expect(badge.textContent).toContain('Auto (pending)');
    });

    it('reads provider from task.metadata.provider when task.provider is absent', async () => {
        const task = makePendingTask({ metadata: { provider: 'codex' } });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Provider')).toBeTruthy();
        });
        const panel = document.querySelector('.pending-task-info')!;
        const badge = within(panel).getByTestId('provider-badge');
        expect(badge.getAttribute('data-provider')).toBe('codex');
    });

    it('does not show Provider row when no provider metadata is present', async () => {
        const task = makePendingTask();
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        expect(screen.queryByText('Provider')).toBeNull();
        expect(screen.queryByTestId('provider-badge')).toBeNull();
    });

    // AC-05: Effort Tier row
    it('shows Effort Tier row when task.config.effortTier is set', async () => {
        const task = makePendingTask({ config: { model: 'gpt-4', effortTier: 'medium' } });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Effort Tier')).toBeTruthy();
        });
        expect(screen.getByText('medium')).toBeTruthy();
    });

    it('shows Effort Tier row for all valid tier values', async () => {
        for (const tier of ['very-low', 'low', 'high']) {
            const task = makePendingTask({ config: { model: 'gpt-4', effortTier: tier } });
            setupFetchForTask(task);

            const { unmount } = render(
                <Wrap>
                    <SeededChatDetail task={task} />
                </Wrap>
            );

            await waitFor(() => {
                expect(screen.getByText('Effort Tier')).toBeTruthy();
            });
            expect(screen.getByText(tier)).toBeTruthy();
            unmount();
        }
    });

    // An Auto task reaches the queue with no model (execution resolves the tier
    // once the provider is known), carrying the tier as `afterEffortTier`.
    it('shows the Effort Tier row from afterEffortTier with no Model row for an Auto task', async () => {
        const task = makePendingTask({ config: { afterEffortTier: 'medium' } });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Effort Tier')).toBeTruthy();
        });
        expect(screen.getByText('medium')).toBeTruthy();
        expect(screen.queryByText('Model')).toBeNull();
    });

    it('shows the Effort Tier row from afterEffortTier alongside a seeded model', async () => {
        const task = makePendingTask({ config: { model: 'gpt-4', afterEffortTier: 'high' } });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Effort Tier')).toBeTruthy();
        });
        expect(screen.getByText('high')).toBeTruthy();
        expect(screen.getByText('Model')).toBeTruthy();
    });

    it('does not show Effort Tier row when effortTier is absent', async () => {
        const task = makePendingTask({ config: { model: 'gpt-4' } });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Model')).toBeTruthy();
        });
        expect(screen.queryByText('Effort Tier')).toBeNull();
    });

    it('does not show Effort Tier row when config is absent', async () => {
        const task = makePendingTask({ config: undefined });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Task ID')).toBeTruthy();
        });
        expect(screen.queryByText('Effort Tier')).toBeNull();
    });

    // Dark-mode readability: the resolved-prompt <pre> box must carry an
    // explicit light-on-dark text color, not inherit near-black text.
    it('renders "Full Prompt (Resolved)" box with readable dark-mode text color', async () => {
        const task = makePendingTask({
            type: 'chat',
            payload: { kind: 'chat', mode: 'autopilot', prompt: 'do it', workingDirectory: '/home/user/project' },
        });
        fetchMock.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/resolved-prompt')) {
                return new Response(JSON.stringify({ resolvedPrompt: 'FULLY RESOLVED PROMPT' }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (typeof url === 'string' && url.includes('/queue/')) {
                return new Response(JSON.stringify({ task }), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
        });

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Full Prompt (Resolved)')).toBeTruthy();
        });
        const pre = Array.from(document.querySelectorAll('pre')).find((p) =>
            (p.textContent || '').includes('FULLY RESOLVED PROMPT'),
        );
        expect(pre).toBeTruthy();
        expect(pre!.className).toContain('text-[#1e1e1e]');
        expect(pre!.className).toContain('dark:text-[#cccccc]');
    });

    it('existing Model row is unaffected when both model and effortTier are present', async () => {
        const task = makePendingTask({ config: { model: 'gpt-4', effortTier: 'high' } });
        setupFetchForTask(task);

        render(
            <Wrap>
                <SeededChatDetail task={task} />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('Model')).toBeTruthy();
        });
        expect(screen.getByText('gpt-4')).toBeTruthy();
        expect(screen.getByText('Effort Tier')).toBeTruthy();
        expect(screen.getByText('high')).toBeTruthy();
    });
});

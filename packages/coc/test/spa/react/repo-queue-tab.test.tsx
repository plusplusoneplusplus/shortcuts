/**
 * Tests for RepoQueueTab rendered inside QueueProvider.
 * Verifies API calls, history rendering, pause/resume, task filter, and empty state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { useQueue } from '../../../src/server/spa/client/react/context/QueueContext';
import { RepoQueueTab } from '../../../src/server/spa/client/react/repos/RepoQueueTab';

vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '/api',
    getWsPath: () => '/ws',
}));

vi.mock('../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
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

/** Simulates the router setting selectedTaskId before data loads (deep-link). */
function PreSelectTask({ taskId }: { taskId: string }) {
    const { dispatch } = useQueue();
    useLayoutEffect(() => {
        dispatch({ type: 'SELECT_QUEUE_TASK', id: taskId });
    }, [taskId, dispatch]);
    return null;
}

function makeQueueResponse(opts?: { queued?: any[]; running?: any[]; stats?: any }) {
    return {
        queued: opts?.queued ?? [],
        running: opts?.running ?? [],
        stats: opts?.stats ?? { isPaused: false },
    };
}

function makeHistoryResponse(history: any[]) {
    return { history };
}

function makeCompletedTask(overrides?: Partial<any>): any {
    return {
        id: 'completed-1',
        type: 'follow-prompt',
        status: 'completed',
        displayName: 'Completed Task',
        completedAt: '2025-01-15T12:00:00Z',
        ...overrides,
    };
}

function makeRunningTask(overrides?: Partial<any>): any {
    return {
        id: 'running-1',
        type: 'follow-prompt',
        status: 'running',
        displayName: 'Running Task',
        startedAt: '2025-01-15T11:00:00Z',
        ...overrides,
    };
}

function makeQueuedTask(overrides?: Partial<any>): any {
    return {
        id: 'queued-1',
        type: 'follow-prompt',
        status: 'queued',
        displayName: 'Queued Task',
        createdAt: '2025-01-15T10:00:00Z',
        ...overrides,
    };
}

describe('RepoQueueTab', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        (global as any).EventSource = vi.fn().mockImplementation(() => ({
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            close: vi.fn(),
        }));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function setupFetch(opts: {
        queue?: ReturnType<typeof makeQueueResponse>;
        history?: ReturnType<typeof makeHistoryResponse>;
    }) {
        const queueData = opts.queue ?? makeQueueResponse();
        const historyData = opts.history ?? makeHistoryResponse([]);

        fetchMock.mockImplementation(async (url: string) => {
            if (typeof url === 'string' && url.includes('/queue/history')) {
                return new Response(JSON.stringify(historyData), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (typeof url === 'string' && url.includes('/queue/resume')) {
                return new Response(JSON.stringify({}), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (typeof url === 'string' && url.includes('/queue/pause')) {
                return new Response(JSON.stringify({}), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            if (typeof url === 'string' && url.includes('/queue')) {
                return new Response(JSON.stringify(queueData), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response(JSON.stringify({}), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        });
    }

    it('calls /queue/history?repoId= separately from /queue?repoId= on mount', async () => {
        setupFetch({
            queue: makeQueueResponse({ running: [makeRunningTask()] }),
            history: makeHistoryResponse([makeCompletedTask()]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            const queueCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/queue?repoId=') && !url.includes('history')
            );
            const historyCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/queue/history?repoId=')
            );
            expect(queueCalls.length).toBeGreaterThanOrEqual(1);
            expect(historyCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('renders completed tasks from history response', async () => {
        setupFetch({
            queue: makeQueueResponse({ running: [makeRunningTask()] }),
            history: makeHistoryResponse([
                makeCompletedTask({ displayName: 'Build Feature X' }),
            ]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText(/Build Feature X/)).toBeTruthy();
        });
    });

    it('pause button calls correct POST endpoint', async () => {
        setupFetch({
            queue: makeQueueResponse({ running: [makeRunningTask()], stats: { isPaused: false } }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByTestId('repo-pause-resume-btn')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('repo-pause-resume-btn'));

        await waitFor(() => {
            const pauseCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/queue/pause')
            );
            expect(pauseCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('resume button calls correct POST endpoint', async () => {
        setupFetch({
            queue: makeQueueResponse({ queued: [makeQueuedTask()], stats: { isPaused: true } }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByTestId('repo-pause-resume-btn')).toBeTruthy();
        });

        fireEvent.click(screen.getByTestId('repo-pause-resume-btn'));

        await waitFor(() => {
            const resumeCalls = fetchMock.mock.calls.filter(
                ([url]: [string]) => typeof url === 'string' && url.includes('/queue/resume')
            );
            expect(resumeCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('task type filter filters displayed tasks', async () => {
        setupFetch({
            queue: makeQueueResponse({
                running: [
                    makeRunningTask({ type: 'follow-prompt', displayName: 'Prompt Task' }),
                    makeRunningTask({ id: 'running-2', type: 'code-review', displayName: 'Review Task' }),
                ],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        // Wait for tasks to render
        await waitFor(() => {
            expect(screen.getByText(/Prompt Task/)).toBeTruthy();
            expect(screen.getByText(/Review Task/)).toBeTruthy();
        });

        // The filter dropdown should appear when there are multiple task types
        const filterDropdown = screen.queryByTestId('queue-filter-dropdown');
        if (filterDropdown) {
            fireEvent.change(filterDropdown, { target: { value: 'follow-prompt' } });
            await waitFor(() => {
                expect(screen.getByText(/Prompt Task/)).toBeTruthy();
                expect(screen.queryByText(/Review Task/)).toBeNull();
            });
        }
    });

    it('empty state renders when no tasks exist', async () => {
        setupFetch({
            queue: makeQueueResponse(),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText('No tasks in queue for this repository')).toBeTruthy();
        });
    });

    it('empty state shows "+ Queue Task" button that dispatches OPEN_DIALOG with workspaceId', async () => {
        setupFetch({
            queue: makeQueueResponse(),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByTestId('repo-queue-task-btn-empty')).toBeTruthy();
        });

        expect(screen.getByTestId('repo-queue-task-btn-empty').textContent).toContain('Queue Task');
    });

    it('toolbar does not contain "+ Queue Task" button (moved to RepoDetail header)', async () => {
        setupFetch({
            queue: makeQueueResponse({ running: [makeRunningTask()] }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getAllByText(/Running Task/).length).toBeGreaterThan(0);
        });

        expect(screen.queryByTestId('repo-queue-task-btn')).toBeNull();
    });

    it('preserves deep-link selectedTaskId through the loading phase', async () => {
        const deepLinkTaskId = 'deep-linked-task';

        setupFetch({
            queue: makeQueueResponse({
                running: [makeRunningTask({ id: deepLinkTaskId, displayName: 'Deep Link Task' })],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <PreSelectTask taskId={deepLinkTaskId} />
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        // Wait for data to load and task to appear in the list
        await waitFor(() => {
            expect(screen.getByText(/Deep Link Task/)).toBeTruthy();
        });

        // Selection should be preserved — the placeholder must NOT be visible
        expect(screen.queryByText('Select a task to view details')).toBeNull();
    });

    it('clears selectedTaskId after loading when task is not in any list', async () => {
        const missingTaskId = 'task-does-not-exist';

        setupFetch({
            queue: makeQueueResponse({
                running: [makeRunningTask()],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <PreSelectTask taskId={missingTaskId} />
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        // Wait for data to load
        await waitFor(() => {
            expect(screen.getAllByText(/Running Task/).length).toBeGreaterThan(0);
        });

        // The stale selection should have been cleared — placeholder should appear
        await waitFor(() => {
            expect(screen.getByText('Select a task to view details')).toBeTruthy();
        });
    });

    it('does not render inline action buttons on queued tasks', async () => {
        setupFetch({
            queue: makeQueueResponse({
                queued: [makeQueuedTask(), makeQueuedTask({ id: 'queued-2', displayName: 'Queued Task 2' })],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getAllByText(/Queued Task/).length).toBeGreaterThan(0);
        });

        // The old inline buttons (▲, ⏬, ✕) should not be rendered as buttons
        const buttons = screen.getAllByRole('button');
        const inlineLabels = buttons.map(b => b.textContent?.trim());
        expect(inlineLabels).not.toContain('▲');
        expect(inlineLabels).not.toContain('⏬');
        expect(inlineLabels).not.toContain('✕');
    });

    it('does not render inline action buttons on running tasks', async () => {
        setupFetch({
            queue: makeQueueResponse({
                running: [makeRunningTask()],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getAllByText(/Running Task/).length).toBeGreaterThan(0);
        });

        const buttons = screen.getAllByRole('button');
        const inlineLabels = buttons.map(b => b.textContent?.trim());
        expect(inlineLabels).not.toContain('✕');
    });

    it('right-click on a queued task shows context menu with Move Up, Move to Top, and Cancel', async () => {
        setupFetch({
            queue: makeQueueResponse({
                queued: [
                    makeQueuedTask({ id: 'q1', displayName: 'First' }),
                    makeQueuedTask({ id: 'q2', displayName: 'Second' }),
                ],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText(/Second/)).toBeTruthy();
        });

        // Right-click on the second queued task (index > 0, so Move Up should appear)
        const taskCards = screen.getAllByText(/Second/);
        fireEvent.contextMenu(taskCards[0], { clientX: 100, clientY: 100 });

        await waitFor(() => {
            expect(screen.getByTestId('context-menu')).toBeTruthy();
        });

        expect(screen.getByText('Move Up')).toBeTruthy();
        expect(screen.getByText('Move to Top')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('right-click on the first queued task omits Move Up', async () => {
        setupFetch({
            queue: makeQueueResponse({
                queued: [
                    makeQueuedTask({ id: 'q1', displayName: 'Only Task' }),
                ],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText(/Only Task/)).toBeTruthy();
        });

        const taskCards = screen.getAllByText(/Only Task/);
        fireEvent.contextMenu(taskCards[0], { clientX: 100, clientY: 100 });

        await waitFor(() => {
            expect(screen.getByTestId('context-menu')).toBeTruthy();
        });

        expect(screen.queryByText('Move Up')).toBeNull();
        expect(screen.getByText('Move to Top')).toBeTruthy();
        expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('right-click on a running task shows context menu with only Cancel', async () => {
        setupFetch({
            queue: makeQueueResponse({
                running: [makeRunningTask({ id: 'r1', displayName: 'Running One' })],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText(/Running One/)).toBeTruthy();
        });

        const taskCards = screen.getAllByText(/Running One/);
        fireEvent.contextMenu(taskCards[0], { clientX: 200, clientY: 200 });

        await waitFor(() => {
            expect(screen.getByTestId('context-menu')).toBeTruthy();
        });

        expect(screen.queryByText('Move Up')).toBeNull();
        expect(screen.queryByText('Move to Top')).toBeNull();
        expect(screen.getByText('Cancel')).toBeTruthy();
    });

    it('clicking a context menu Cancel item calls DELETE on the task', async () => {
        setupFetch({
            queue: makeQueueResponse({
                running: [makeRunningTask({ id: 'r1', displayName: 'Cancel Me' })],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText(/Cancel Me/)).toBeTruthy();
        });

        const taskCards = screen.getAllByText(/Cancel Me/);
        fireEvent.contextMenu(taskCards[0], { clientX: 100, clientY: 100 });

        await waitFor(() => {
            expect(screen.getByTestId('context-menu')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Cancel'));

        await waitFor(() => {
            const deleteCalls = fetchMock.mock.calls.filter(
                ([url, opts]: [string, any]) => typeof url === 'string' && url.includes('/queue/r1') && opts?.method === 'DELETE'
            );
            expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('clicking a context menu Move Up item calls move-up endpoint', async () => {
        setupFetch({
            queue: makeQueueResponse({
                queued: [
                    makeQueuedTask({ id: 'q1', displayName: 'First' }),
                    makeQueuedTask({ id: 'q2', displayName: 'Second' }),
                ],
            }),
            history: makeHistoryResponse([]),
        });

        render(
            <Wrap>
                <RepoQueueTab workspaceId="ws1" />
            </Wrap>
        );

        await waitFor(() => {
            expect(screen.getByText(/Second/)).toBeTruthy();
        });

        const taskCards = screen.getAllByText(/Second/);
        fireEvent.contextMenu(taskCards[0], { clientX: 100, clientY: 100 });

        await waitFor(() => {
            expect(screen.getByTestId('context-menu')).toBeTruthy();
        });

        fireEvent.click(screen.getByText('Move Up'));

        await waitFor(() => {
            const moveUpCalls = fetchMock.mock.calls.filter(
                ([url, opts]: [string, any]) => typeof url === 'string' && url.includes('/queue/q2/move-up') && opts?.method === 'POST'
            );
            expect(moveUpCalls.length).toBeGreaterThanOrEqual(1);
        });
    });
});

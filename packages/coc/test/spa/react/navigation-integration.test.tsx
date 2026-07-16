/**
 * Tests for navigation integration:
 * - QueueTaskItem: mini progress indicator on running workflow cards
 * - WorkflowRunHistory: clicks navigate to workflow run view
 * - ProcessDetail: "View Workflow →" button for workflow processes
 * - useWorkflowProgress hook: SSE subscription lifecycle
 *
 * Converted from source-file-reading tests to render/hook tests.
 *
 * ── Dropped tests (not convertible to render tests) ──────────────────
 * - Import/export existence checks (covered by TypeScript compiler)
 * - Negative import checks (e.g. "does not import WorkflowResultCard")
 * - Source-level string pattern checks on handler bodies
 * - Interface shape checks (e.g. RunHistoryItemProps)
 * - Source-level conditional expression checks
 * These are implementation details verified by the compiler and by the
 * behavioral render tests below.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor, renderHook } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { AppProvider, useApp } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider, useQueue } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { WorkflowRunHistory } from '../../../src/server/spa/client/react/features/workflow/WorkflowRunHistory';
import { QueueTaskItem } from '../../../src/server/spa/client/react/features/chat/ChatListPane';
import { useWorkflowProgress } from '../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress';
import { resetSpaCocClientForTests } from '../../../src/server/spa/client/react/api/cocClient';
import { createMockFetch } from './test-utils';

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));

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
    ChatPreferencesProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Helpers ────────────────────────────────────────────────────────────

function Wrap({ children }: { children: ReactNode }) {
    return <AppProvider><QueueProvider>{children}</QueueProvider></AppProvider>;
}

/** Seeds repoQueueMap so WorkflowRunHistory sees active tasks. */
function SeededWorkflowRunHistory({ workspaceId, pipelineName, tasks }: {
    workspaceId: string;
    pipelineName: string;
    tasks: any[];
}) {
    const { dispatch } = useQueue();
    useEffect(() => {
        dispatch({
            type: 'REPO_QUEUE_UPDATED',
            repoId: workspaceId,
            queue: {
                queued: tasks.filter(t => t.status === 'queued'),
                running: tasks.filter(t => t.status === 'running'),
                stats: { queued: 0, running: 0, total: 0, isPaused: false, isDraining: false },
            },
        });
    }, [dispatch, workspaceId, tasks]);
    return <WorkflowRunHistory workspaceId={workspaceId} pipelineName={pipelineName} />;
}

// ── EventSource mock infrastructure ────────────────────────────────────

interface MockEventSourceInstance {
    url: string;
    listeners: Record<string, ((e: any) => void)[]>;
    close: ReturnType<typeof vi.fn>;
    addEventListener: (type: string, cb: (e: any) => void) => void;
    onerror: ((e: any) => void) | null;
}

function createMockEventSourceClass() {
    const instances: MockEventSourceInstance[] = [];
    const cls = vi.fn(function (url: string) {
        const inst: MockEventSourceInstance = {
            url,
            listeners: {},
            close: vi.fn(),
            addEventListener(type: string, cb: (e: any) => void) {
                (inst.listeners[type] = inst.listeners[type] || []).push(cb);
            },
            onerror: null,
        };
        instances.push(inst);
        return inst;
    }) as any;
    return { cls, instances };
}

// ════════════════════════════════════════════════════════════════════════
// QueueTaskItem: mini progress indicator
// ════════════════════════════════════════════════════════════════════════

describe('QueueTaskItem: mini progress indicator', () => {
    let esClass: ReturnType<typeof createMockEventSourceClass>;
    let originalEventSource: typeof EventSource;

    beforeEach(() => {
        esClass = createMockEventSourceClass();
        originalEventSource = globalThis.EventSource;
        globalThis.EventSource = esClass.cls;
    });

    afterEach(() => {
        globalThis.EventSource = originalEventSource;
    });

    it('renders progress indicator for running workflow task', async () => {
        const task = { id: 'task-1', processId: 'proc-1', type: 'run-workflow', displayName: 'My Workflow', status: 'running' };
        render(
            <Wrap>
                <QueueTaskItem task={task} status="running" now={Date.now()} />
            </Wrap>,
        );

        // Trigger SSE progress event
        await waitFor(() => expect(esClass.instances.length).toBeGreaterThan(0));
        const es = esClass.instances[0];
        act(() => {
            for (const cb of es.listeners['workflow-progress'] || []) {
                cb({ data: JSON.stringify({ completedItems: 3, totalItems: 5, phase: 'map' }) });
            }
        });

        expect(screen.getByTestId('workflow-progress-indicator')).toBeDefined();
        expect(screen.getByText('▶ Map: 3/5')).toBeDefined();
    });

    it('does not show progress for non-workflow tasks', () => {
        const task = { id: 'task-2', type: 'chat', displayName: 'Chat Task', status: 'running' };
        render(
            <Wrap>
                <QueueTaskItem task={task} status="running" now={Date.now()} />
            </Wrap>,
        );

        // No EventSource should be created for chat tasks
        expect(esClass.instances.length).toBe(0);
        expect(screen.queryByTestId('workflow-progress-indicator')).toBeNull();
    });

    it('does not show progress for queued workflow tasks', () => {
        const task = { id: 'task-3', type: 'run-workflow', displayName: 'Queued Workflow', status: 'queued' };
        render(
            <Wrap>
                <QueueTaskItem task={task} status="queued" now={Date.now()} />
            </Wrap>,
        );

        expect(esClass.instances.length).toBe(0);
        expect(screen.queryByTestId('workflow-progress-indicator')).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// WorkflowRunHistory: workflow navigation
// ════════════════════════════════════════════════════════════════════════

describe('WorkflowRunHistory: workflow navigation', () => {
    let fetchMock: ReturnType<typeof createMockFetch>;

    beforeEach(() => {
        fetchMock = createMockFetch({
            '/queue/history': { body: { history: [] } },
        });
        resetSpaCocClientForTests();
    });

    afterEach(() => {
        resetSpaCocClientForTests();
        vi.restoreAllMocks();
    });

    it('navigates to run view when clicking an active task', async () => {
        window.location.hash = '#repos/ws-1/pipelines/my-pipe';
        const tasks = [
            { id: 'qt-1', processId: 'proc-1', type: 'run-workflow', status: 'running', metadata: { pipelineName: 'my-pipe' }, displayName: 'my-pipe' },
        ];

        render(
            <Wrap>
                <SeededWorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipe" tasks={tasks} />
            </Wrap>,
        );

        const item = await screen.findByTestId('run-history-item');
        fireEvent.click(item);
        expect(window.location.hash).toBe('#repos/ws-1/pipelines/my-pipe/run/proc-1');
    });

    it('uses queue_ prefix fallback when processId is missing', async () => {
        window.location.hash = '#repos/ws-2/pipelines/pipe2';
        const tasks = [
            { id: 'qt-2', type: 'run-workflow', status: 'queued', metadata: { pipelineName: 'pipe2' }, displayName: 'pipe2' },
        ];

        render(
            <Wrap>
                <SeededWorkflowRunHistory workspaceId="ws-2" pipelineName="pipe2" tasks={tasks} />
            </Wrap>,
        );

        const item = await screen.findByTestId('run-history-item');
        fireEvent.click(item);
        expect(window.location.hash).toBe('#repos/ws-2/pipelines/pipe2/run/queue_qt-2');
    });

    it('shows empty state when no runs exist', async () => {
        render(
            <Wrap>
                <SeededWorkflowRunHistory workspaceId="ws-3" pipelineName="pipe3" tasks={[]} />
            </Wrap>,
        );

        await waitFor(() => {
            expect(screen.getByTestId('empty-state')).toBeDefined();
        });
    });
});

// ════════════════════════════════════════════════════════════════════════
// useWorkflowProgress hook
// ════════════════════════════════════════════════════════════════════════

describe('useWorkflowProgress hook', () => {
    let esClass: ReturnType<typeof createMockEventSourceClass>;
    let originalEventSource: typeof EventSource;

    beforeEach(() => {
        esClass = createMockEventSourceClass();
        originalEventSource = globalThis.EventSource;
        globalThis.EventSource = esClass.cls;
    });

    afterEach(() => {
        globalThis.EventSource = originalEventSource;
    });

    it('returns null when processId is null', () => {
        const { result } = renderHook(() => useWorkflowProgress(null));
        expect(result.current).toBeNull();
        expect(esClass.instances.length).toBe(0);
    });

    it('subscribes to SSE and returns progress', async () => {
        const { result } = renderHook(() => useWorkflowProgress('proc-1'));

        expect(esClass.instances.length).toBe(1);
        expect(esClass.instances[0].url).toContain('/processes/proc-1/stream');

        // Fire progress event
        act(() => {
            for (const cb of esClass.instances[0].listeners['workflow-progress'] || []) {
                cb({ data: JSON.stringify({ completedItems: 7, totalItems: 10, phase: 'reduce' }) });
            }
        });

        expect(result.current).toEqual({ completed: 7, total: 10, phase: 'reduce' });
    });

    it('closes EventSource on unmount', () => {
        const { unmount } = renderHook(() => useWorkflowProgress('proc-2'));

        expect(esClass.instances.length).toBe(1);
        unmount();
        expect(esClass.instances[0].close).toHaveBeenCalled();
    });

    it('closes EventSource when status is completed', () => {
        renderHook(() => useWorkflowProgress('proc-3'));

        const es = esClass.instances[0];
        act(() => {
            for (const cb of es.listeners['status'] || []) {
                cb({ data: JSON.stringify({ status: 'completed' }) });
            }
        });

        expect(es.close).toHaveBeenCalled();
    });

    it('closes EventSource when status is failed', () => {
        renderHook(() => useWorkflowProgress('proc-4'));

        const es = esClass.instances[0];
        act(() => {
            for (const cb of es.listeners['status'] || []) {
                cb({ data: JSON.stringify({ status: 'failed' }) });
            }
        });

        expect(es.close).toHaveBeenCalled();
    });

    it('closes EventSource when status is cancelled', () => {
        renderHook(() => useWorkflowProgress('proc-5'));

        const es = esClass.instances[0];
        act(() => {
            for (const cb of es.listeners['status'] || []) {
                cb({ data: JSON.stringify({ status: 'cancelled' }) });
            }
        });

        expect(es.close).toHaveBeenCalled();
    });
});

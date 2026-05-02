/**
 * Tests for WorkflowRunHistory — run history list, empty state, refresh, active tasks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/contexts/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/contexts/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/contexts/ToastContext';
import { WorkflowRunHistory } from '../../../src/server/spa/client/react/features/workflow/WorkflowRunHistory';

const { mockRunHistory } = vi.hoisted(() => ({
    mockRunHistory: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        workflow: {
            runHistory: mockRunHistory,
        },
    }),
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

beforeEach(() => {
    vi.restoreAllMocks();
    mockRunHistory.mockReset();
});

describe('WorkflowRunHistory', () => {
    it('renders empty state when no history', async () => {
        mockRunHistory.mockResolvedValue({ history: [] });
        render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('empty-state')).toBeDefined();
        });
        expect(screen.getByText(/No runs yet/)).toBeDefined();
    });

    it('renders history items with status badges', async () => {
        mockRunHistory.mockResolvedValue({
            history: [
                { id: 't1', status: 'completed', startedAt: '2026-01-15T10:00:00Z', durationMs: 3000 },
                { id: 't2', status: 'failed', startedAt: '2026-01-15T09:00:00Z', durationMs: 1000 },
                { id: 't3', status: 'running', startedAt: '2026-01-15T08:00:00Z' },
            ],
        });
        render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            const items = screen.getAllByTestId('run-history-item');
            expect(items.length).toBe(3);
        });
    });

    it('clicking a history item navigates to workflow view', async () => {
        mockRunHistory.mockResolvedValueOnce({
            history: [
                { id: 't1', status: 'completed', processId: 'proc-1' },
            ],
        });

        render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('run-history-item')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('run-history-item'));
        });

        expect(location.hash).toBe('#repos/ws-1/pipelines/my-pipeline/run/proc-1');
    });

    it('clicking a history item without processId uses queue_ prefix', async () => {
        mockRunHistory.mockResolvedValueOnce({
            history: [
                { id: 't2', status: 'completed' },
            ],
        });

        render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('run-history-item')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('run-history-item'));
        });

        expect(location.hash).toBe('#repos/ws-1/pipelines/my-pipeline/run/queue_t2');
    });

    it('does not render WorkflowResultCard after click', async () => {
        mockRunHistory.mockResolvedValueOnce({
            history: [
                { id: 't1', status: 'completed', processId: 'proc-1' },
            ],
        });

        render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('run-history-item')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('run-history-item'));
        });

        expect(screen.queryByTestId('workflow-result-card')).toBeNull();
    });

    it('re-fetches on refreshKey change', async () => {
        mockRunHistory.mockResolvedValue({ history: [] });

        const { rerender } = render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" refreshKey={1} />
            </Wrap>
        );
        await waitFor(() => {
            expect(mockRunHistory).toHaveBeenCalledTimes(1);
        });

        rerender(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" refreshKey={2} />
            </Wrap>
        );
        await waitFor(() => {
            expect(mockRunHistory).toHaveBeenCalledTimes(2);
        });
    });

    it('renders Run History heading', async () => {
        mockRunHistory.mockResolvedValue({ history: [] });
        render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Run History')).toBeDefined();
        });
    });

    it('fetches history through the workflow client with workspace and pipeline name', async () => {
        mockRunHistory.mockResolvedValue({ history: [] });
        render(
            <Wrap>
                <WorkflowRunHistory workspaceId="ws-1" pipelineName="Bug Triage" />
            </Wrap>
        );
        await waitFor(() => {
            expect(mockRunHistory).toHaveBeenCalledWith('ws-1', 'Bug Triage');
        });
    });
});

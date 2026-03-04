/**
 * Tests for PipelineRunHistory — run history list, empty state, refresh, active tasks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider } from '../../../src/server/spa/client/react/context/AppContext';
import { QueueProvider } from '../../../src/server/spa/client/react/context/QueueContext';
import { ToastProvider } from '../../../src/server/spa/client/react/context/ToastContext';
import { PipelineRunHistory } from '../../../src/server/spa/client/react/repos/PipelineRunHistory';

// Mock fetchApi
const mockFetchApi = vi.fn();
vi.mock('../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: (...args: any[]) => mockFetchApi(...args),
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
    mockFetchApi.mockReset();
});

describe('PipelineRunHistory', () => {
    it('renders empty state when no history', async () => {
        mockFetchApi.mockResolvedValue({ history: [] });
        render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('empty-state')).toBeDefined();
        });
        expect(screen.getByText(/No runs yet/)).toBeDefined();
    });

    it('renders history items with status badges', async () => {
        mockFetchApi.mockResolvedValue({
            history: [
                { id: 't1', status: 'completed', startedAt: '2026-01-15T10:00:00Z', durationMs: 3000 },
                { id: 't2', status: 'failed', startedAt: '2026-01-15T09:00:00Z', durationMs: 1000 },
                { id: 't3', status: 'running', startedAt: '2026-01-15T08:00:00Z' },
            ],
        });
        render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            const items = screen.getAllByTestId('run-history-item');
            expect(items.length).toBe(3);
        });
    });

    it('clicking a history item navigates to workflow view', async () => {
        mockFetchApi.mockResolvedValueOnce({
            history: [
                { id: 't1', status: 'completed', processId: 'proc-1' },
            ],
        });

        render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('run-history-item')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('run-history-item'));
        });

        expect(location.hash).toBe('#repos/ws-1/workflow/proc-1');
    });

    it('clicking a history item without processId uses queue_ prefix', async () => {
        mockFetchApi.mockResolvedValueOnce({
            history: [
                { id: 't2', status: 'completed' },
            ],
        });

        render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('run-history-item')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('run-history-item'));
        });

        expect(location.hash).toBe('#repos/ws-1/workflow/queue_t2');
    });

    it('does not render PipelineResultCard after click', async () => {
        mockFetchApi.mockResolvedValueOnce({
            history: [
                { id: 't1', status: 'completed', processId: 'proc-1' },
            ],
        });

        render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByTestId('run-history-item')).toBeDefined();
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('run-history-item'));
        });

        expect(screen.queryByTestId('pipeline-result-card')).toBeNull();
    });

    it('re-fetches on refreshKey change', async () => {
        mockFetchApi.mockResolvedValue({ history: [] });

        const { rerender } = render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" refreshKey={1} />
            </Wrap>
        );
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledTimes(1);
        });

        rerender(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" refreshKey={2} />
            </Wrap>
        );
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledTimes(2);
        });
    });

    it('renders Run History heading', async () => {
        mockFetchApi.mockResolvedValue({ history: [] });
        render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="my-pipeline" />
            </Wrap>
        );
        await waitFor(() => {
            expect(screen.getByText('Run History')).toBeDefined();
        });
    });

    it('fetches history with correct pipelineName query param', async () => {
        mockFetchApi.mockResolvedValue({ history: [] });
        render(
            <Wrap>
                <PipelineRunHistory workspaceId="ws-1" pipelineName="Bug Triage" />
            </Wrap>
        );
        await waitFor(() => {
            expect(mockFetchApi).toHaveBeenCalledWith(
                expect.stringContaining('pipelineName=Bug%20Triage')
            );
        });
    });
});

/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MapReduceRun } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    start: vi.fn(),
    continueRun: vi.fn(),
    retryItem: vi.fn(),
    skipItem: vi.fn(),
    retryReduce: vi.fn(),
    cancel: vi.fn(),
    getErrorMessage: vi.fn((err: unknown, fallback: string) => err instanceof Error ? err.message : fallback),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        mapReduce: {
            get: mocks.get,
            start: mocks.start,
            continue: mocks.continueRun,
            retryItem: mocks.retryItem,
            skipItem: mocks.skipItem,
            retryReduce: mocks.retryReduce,
            cancel: mocks.cancel,
        },
    }),
    getSpaCocClientErrorMessage: mocks.getErrorMessage,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/format', () => ({
    formatRelativeTime: (value: string) => `relative:${value}`,
}));

import { MapReduceRunPane } from '../../../../../src/server/spa/client/react/features/chat/MapReduceRunPane';

function makeRun(overrides: Partial<MapReduceRun> = {}): MapReduceRun {
    return {
        runId: 'map-reduce-run-1',
        workspaceId: 'ws-1',
        status: 'approved',
        originalRequest: 'Fan out the work',
        sharedInstructions: 'Keep each map item isolated',
        reduceInstructions: 'Merge all map results',
        maxParallel: 3,
        childMode: 'autopilot',
        provider: 'copilot',
        generationProcessId: 'queue_generation-chat',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        approvedAt: '2026-01-01T00:00:30.000Z',
        reduceStep: { status: 'pending' },
        items: [
            {
                id: 'pending-item',
                title: 'Pending item',
                prompt: 'Do pending work',
                status: 'pending',
            },
            {
                id: 'failed-item',
                title: 'Failed item',
                prompt: 'Retry this work',
                status: 'failed',
                error: 'Child task failed',
                childProcessId: 'queue_child-failed',
            },
            {
                id: 'done-item',
                title: 'Done item',
                prompt: 'Already done',
                status: 'completed',
                childProcessId: 'queue_child-done',
            },
        ],
        ...overrides,
    } as MapReduceRun;
}

describe('MapReduceRunPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.get.mockResolvedValue(makeRun());
        mocks.start.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.continueRun.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.retryItem.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.skipItem.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.retryReduce.mockResolvedValue(makeRun({ status: 'reducing', reduceStep: { status: 'running' } }));
        mocks.cancel.mockResolvedValue(makeRun({ status: 'cancelled' }));
    });

    it('renders run metadata, reduce step, item chips, and child links', async () => {
        const onSelectChildProcess = vi.fn();
        const onSelectGenerationProcess = vi.fn();
        render(<MapReduceRunPane workspaceId="ws-1" runId="map-reduce-run-1" onSelectChildProcess={onSelectChildProcess} onSelectGenerationProcess={onSelectGenerationProcess} />);

        await waitFor(() => expect(screen.getByTestId('map-reduce-run-pane')).toBeTruthy());
        expect(screen.getByTestId('map-reduce-run-status').textContent).toContain('approved');
        expect(screen.getByTestId('map-reduce-run-counts').textContent).toContain('1 pending');
        expect(screen.getByTestId('map-reduce-original-request').textContent).toContain('Fan out the work');
        expect(screen.getByTestId('map-reduce-shared-instructions-preview').textContent).toContain('Keep each map item isolated');
        expect(screen.getByTestId('map-reduce-reduce-step').textContent).toContain('Merge all map results');
        expect(screen.getByTestId('map-reduce-reduce-status').textContent).toContain('pending');
        expect(screen.getByTestId('map-reduce-item-prompt-pending-item').textContent).toContain('Do pending work');

        fireEvent.click(screen.getByTestId('map-reduce-generation-link-btn'));
        expect(onSelectGenerationProcess).toHaveBeenCalledWith('queue_generation-chat');

        fireEvent.click(screen.getByTestId('map-reduce-child-link-done-item'));
        expect(onSelectChildProcess).toHaveBeenCalledWith('queue_child-done');
        expect(screen.getByTestId('map-reduce-child-link-done-item').textContent).toContain('Open map chat');
    });

    it('starts an approved run with the start endpoint', async () => {
        mocks.get.mockResolvedValueOnce(makeRun({ status: 'approved', items: [makeRun().items[0]] }));

        render(<MapReduceRunPane workspaceId="ws-1" runId="map-reduce-run-1" />);
        await waitFor(() => expect(screen.getByTestId('map-reduce-continue-btn')).toBeEnabled());

        fireEvent.click(screen.getByTestId('map-reduce-continue-btn'));

        await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1'));
        expect(mocks.continueRun).not.toHaveBeenCalled();
    });

    it('continues a reducing run with a pending reduce step', async () => {
        mocks.get.mockResolvedValueOnce(makeRun({
            status: 'reducing',
            reduceStep: { status: 'pending' },
            items: [{ ...makeRun().items[2] }],
        }));

        render(<MapReduceRunPane workspaceId="ws-1" runId="map-reduce-run-1" />);
        await waitFor(() => expect(screen.getByTestId('map-reduce-continue-btn')).toBeEnabled());

        fireEvent.click(screen.getByTestId('map-reduce-continue-btn'));

        await waitFor(() => expect(mocks.continueRun).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1'));
        expect(mocks.start).not.toHaveBeenCalled();
    });

    it('disables continue while the reduce step is running', async () => {
        mocks.get.mockResolvedValueOnce(makeRun({
            status: 'reducing',
            reduceStep: { status: 'running', childProcessId: 'queue_reduce-chat' },
            items: [{ ...makeRun().items[2] }],
        }));

        render(<MapReduceRunPane workspaceId="ws-1" runId="map-reduce-run-1" />);
        await waitFor(() => expect(screen.getByTestId('map-reduce-run-pane')).toBeTruthy());
        expect(screen.getByTestId('map-reduce-continue-btn')).toBeDisabled();
        expect(screen.getByTestId('map-reduce-reduce-child-link').textContent).toContain('Open reduce chat');
    });

    it('retries a failed reduce step and links the final result when completed', async () => {
        const onSelectChildProcess = vi.fn();
        mocks.get.mockResolvedValueOnce(makeRun({
            status: 'failed',
            reduceStep: { status: 'failed', error: 'reduce blew up', childProcessId: 'queue_reduce-chat' },
        }));
        mocks.retryReduce.mockResolvedValueOnce(makeRun({
            status: 'completed',
            reduceStep: { status: 'completed', childProcessId: 'queue_reduce-final' },
        }));

        render(<MapReduceRunPane workspaceId="ws-1" runId="map-reduce-run-1" onSelectChildProcess={onSelectChildProcess} />);
        await waitFor(() => expect(screen.getByTestId('map-reduce-reduce-step').textContent).toContain('reduce blew up'));

        fireEvent.click(screen.getByTestId('map-reduce-retry-reduce'));
        await waitFor(() => expect(mocks.retryReduce).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1'));

        await waitFor(() => expect(screen.getByTestId('map-reduce-final-result-link')).toBeTruthy());
        fireEvent.click(screen.getByTestId('map-reduce-final-result-link'));
        expect(onSelectChildProcess).toHaveBeenCalledWith('queue_reduce-final');
    });

    it('retries failed items, skips pending items, and cancels remaining work', async () => {
        render(<MapReduceRunPane workspaceId="ws-1" runId="map-reduce-run-1" />);
        await waitFor(() => expect(screen.getByTestId('map-reduce-run-pane')).toBeTruthy());

        fireEvent.click(screen.getByTestId('map-reduce-retry-failed-item'));
        await waitFor(() => expect(mocks.retryItem).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1', 'failed-item'));

        fireEvent.click(screen.getByTestId('map-reduce-skip-pending-item'));
        await waitFor(() => expect(mocks.skipItem).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1', 'pending-item'));

        fireEvent.click(screen.getByTestId('map-reduce-cancel-btn'));
        await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('ws-1', 'map-reduce-run-1'));
    });

    it('shows an empty state when the run cannot be loaded', async () => {
        mocks.get.mockRejectedValueOnce(new Error('missing run'));

        render(<MapReduceRunPane workspaceId="ws-1" runId="missing-run" />);

        await waitFor(() => expect(screen.getByTestId('map-reduce-run-pane-empty').textContent).toContain('Map Reduce run not found'));
        expect(screen.getByTestId('map-reduce-run-pane-empty').textContent).toContain('missing run');
    });
});

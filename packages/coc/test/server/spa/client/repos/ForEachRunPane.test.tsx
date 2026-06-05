/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ForEachRun } from '@plusplusoneplusplus/coc-client';

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    start: vi.fn(),
    continueRun: vi.fn(),
    retryItem: vi.fn(),
    skipItem: vi.fn(),
    cancel: vi.fn(),
    getErrorMessage: vi.fn((err: unknown, fallback: string) => err instanceof Error ? err.message : fallback),
}));

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        forEach: {
            get: mocks.get,
            start: mocks.start,
            continue: mocks.continueRun,
            retryItem: mocks.retryItem,
            skipItem: mocks.skipItem,
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

import { ForEachRunPane } from '../../../../../src/server/spa/client/react/features/chat/ForEachRunPane';

function makeRun(overrides: Partial<ForEachRun> = {}): ForEachRun {
    return {
        runId: 'for-each-run-1',
        workspaceId: 'ws-1',
        status: 'approved',
        originalRequest: 'Split the work',
        sharedInstructions: 'Keep each item isolated',
        childMode: 'autopilot',
        provider: 'copilot',
        generationProcessId: 'queue_generation-chat',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z',
        approvedAt: '2026-01-01T00:00:30.000Z',
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
    };
}

describe('ForEachRunPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const run = makeRun();
        mocks.get.mockResolvedValue(run);
        mocks.start.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.continueRun.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.retryItem.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.skipItem.mockResolvedValue(makeRun({ status: 'running' }));
        mocks.cancel.mockResolvedValue(makeRun({ status: 'cancelled' }));
    });

    it('renders run metadata, item status chips, prompt previews, and child links', async () => {
        const onSelectChildProcess = vi.fn();
        const onSelectGenerationProcess = vi.fn();
        render(<ForEachRunPane workspaceId="ws-1" runId="for-each-run-1" onSelectChildProcess={onSelectChildProcess} onSelectGenerationProcess={onSelectGenerationProcess} />);

        await waitFor(() => expect(screen.getByTestId('for-each-run-pane')).toBeTruthy());
        expect(screen.getByTestId('for-each-run-status').textContent).toContain('approved');
        expect(screen.getByTestId('for-each-run-counts').textContent).toContain('1 pending');
        expect(screen.getByTestId('for-each-original-request').textContent).toContain('Split the work');
        expect(screen.getByTestId('for-each-shared-instructions-preview').textContent).toContain('Keep each item isolated');
        expect(screen.getByTestId('for-each-item-prompt-pending-item').textContent).toContain('Do pending work');

        fireEvent.click(screen.getByTestId('for-each-generation-link-btn'));
        expect(onSelectGenerationProcess).toHaveBeenCalledWith('queue_generation-chat');

        fireEvent.click(screen.getByTestId('for-each-child-link-done-item'));
        expect(onSelectChildProcess).toHaveBeenCalledWith('queue_child-done');
    });

    it('starts an approved run with the start endpoint', async () => {
        mocks.get.mockResolvedValueOnce(makeRun({ status: 'approved', items: [makeRun().items[0]] }));

        render(<ForEachRunPane workspaceId="ws-1" runId="for-each-run-1" />);
        await waitFor(() => expect(screen.getByTestId('for-each-continue-btn')).toBeEnabled());

        fireEvent.click(screen.getByTestId('for-each-continue-btn'));

        await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('ws-1', 'for-each-run-1'));
        expect(mocks.continueRun).not.toHaveBeenCalled();
    });

    it('keeps the parent pane open and shows the linked running child after start', async () => {
        mocks.get.mockResolvedValueOnce(makeRun({ status: 'approved', items: [makeRun().items[0]] }));
        mocks.start.mockResolvedValueOnce(makeRun({
            status: 'running',
            items: [{
                ...makeRun().items[0],
                status: 'running',
                childProcessId: 'queue_child-running',
                childTaskId: 'child-running',
            }],
        }));

        render(<ForEachRunPane workspaceId="ws-1" runId="for-each-run-1" />);
        await waitFor(() => expect(screen.getByTestId('for-each-continue-btn')).toBeEnabled());

        fireEvent.click(screen.getByTestId('for-each-continue-btn'));

        await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('ws-1', 'for-each-run-1'));
        await waitFor(() => expect(screen.getByTestId('for-each-run-pane')).toBeTruthy());
        expect(screen.getByTestId('for-each-run-status').textContent).toContain('running');
        expect(screen.getByTestId('for-each-child-link-pending-item').textContent).toContain('Open child chat');
    });

    it('retries failed items, skips pending items, and cancels remaining work', async () => {
        render(<ForEachRunPane workspaceId="ws-1" runId="for-each-run-1" />);
        await waitFor(() => expect(screen.getByTestId('for-each-run-pane')).toBeTruthy());

        fireEvent.click(screen.getByTestId('for-each-retry-failed-item'));
        await waitFor(() => expect(mocks.retryItem).toHaveBeenCalledWith('ws-1', 'for-each-run-1', 'failed-item'));

        fireEvent.click(screen.getByTestId('for-each-skip-pending-item'));
        await waitFor(() => expect(mocks.skipItem).toHaveBeenCalledWith('ws-1', 'for-each-run-1', 'pending-item'));

        fireEvent.click(screen.getByTestId('for-each-cancel-btn'));
        await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith('ws-1', 'for-each-run-1'));
    });

    it('shows an empty state when the run cannot be loaded', async () => {
        mocks.get.mockRejectedValueOnce(new Error('missing run'));

        render(<ForEachRunPane workspaceId="ws-1" runId="missing-run" />);

        await waitFor(() => expect(screen.getByTestId('for-each-run-pane-empty').textContent).toContain('For Each run not found'));
        expect(screen.getByTestId('for-each-run-pane-empty').textContent).toContain('missing run');
    });
});

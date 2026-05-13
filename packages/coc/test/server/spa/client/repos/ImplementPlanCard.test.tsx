/**
 * @vitest-environment jsdom
 *
 * Tests for ImplementPlanCard — verifies enqueue payload, navigation handoff,
 * disabled / submitted states, existing-runs banner, and persistence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing the component under test
// ---------------------------------------------------------------------------

const mockEnqueue = vi.fn();
const mockProcessUpdate = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueue },
        processes: { update: mockProcessUpdate },
    }),
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { ImplementPlanCard } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';
import type { ExistingRun } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImplementPlanCard', () => {
    const onImplemented = vi.fn();
    const onViewRun = vi.fn();
    const onRecordPersisted = vi.fn();

    beforeEach(() => {
        mockEnqueue.mockReset();
        mockProcessUpdate.mockReset();
        onImplemented.mockReset();
        onViewRun.mockReset();
        onRecordPersisted.mockReset();
    });

    // ── Existing tests (no-runs / baseline) ────────────────────────────

    it('renders the plan path and CTA button', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/.vscode/tasks/feature.plan.md"
                workspaceId="ws-1"
                workingDirectory="/repo"
                onImplemented={onImplemented}
            />,
        );
        expect(screen.getByTestId('implement-plan-card')).toBeTruthy();
        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toContain('Implement');
        expect(screen.getByText('/repo/.vscode/tasks/feature.plan.md')).toBeTruthy();
    });

    it('renders unchanged when no prior runs exist (no banner)', () => {
        render(
            <ImplementPlanCard
                planFilePath="/repo/plan.md"
                onImplemented={onImplemented}
                existingRuns={[]}
            />,
        );
        expect(screen.queryByTestId('implement-plan-card-banner')).toBeNull();
        expect(screen.getByTestId('implement-plan-card-btn').textContent).toContain('Implement →');
    });

    it('enqueues an autopilot chat task with the plan file path', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-abc' } });

        render(
            <ImplementPlanCard
                planFilePath="/repo/.vscode/tasks/feature.plan.md"
                workspaceId="ws-1"
                workingDirectory="/repo"
                onImplemented={onImplemented}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(mockEnqueue).toHaveBeenCalledTimes(1);
        });

        const payload = mockEnqueue.mock.calls[0][0];
        expect(payload.type).toBe('chat');
        expect(payload.priority).toBe('normal');
        expect(payload.payload.kind).toBe('chat');
        expect(payload.payload.mode).toBe('autopilot');
        expect(payload.payload.workspaceId).toBe('ws-1');
        expect(payload.payload.workingDirectory).toBe('/repo');
        expect(payload.payload.context.files).toEqual(['/repo/.vscode/tasks/feature.plan.md']);
        expect(payload.payload.prompt).toContain('/repo/.vscode/tasks/feature.plan.md');
    });

    it('navigates via onImplemented with a queue_-prefixed processId', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-xyz' } });

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                workspaceId="ws-1"
                onImplemented={onImplemented}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(onImplemented).toHaveBeenCalledTimes(1);
        });
        const id = onImplemented.mock.calls[0][0];
        expect(id).toBe('queue_task-xyz');
    });

    it('passes through an already-prefixed queue process id unchanged', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'queue_existing-id' } });

        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(onImplemented).toHaveBeenCalledWith('queue_existing-id');
        });
    });

    it('marks the button as submitted after success and prevents re-clicks', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-1' } });

        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} />);

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        await act(async () => {
            fireEvent.click(btn);
        });

        await waitFor(() => {
            expect(btn.disabled).toBe(true);
            expect(btn.textContent).toContain('Implementing');
        });

        // Second click is a no-op
        await act(async () => {
            fireEvent.click(btn);
        });
        expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });

    it('shows an error message and stays enabled when enqueue fails', async () => {
        mockEnqueue.mockRejectedValue(new Error('Network down'));

        render(<ImplementPlanCard planFilePath="/p.md" onImplemented={onImplemented} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(screen.getByTestId('implement-plan-card-error').textContent).toContain('Network down');
        });

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(onImplemented).not.toHaveBeenCalled();
    });

    // ── New tests: existing runs banner ────────────────────────────────

    it('renders a banner when a single completed run exists', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1',
            planFilePath: '/plan.md',
            enqueuedAt: new Date(Date.now() - 300000).toISOString(), // 5 min ago
            liveStatus: 'completed',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        expect(screen.getByTestId('implement-plan-card-banner')).toBeTruthy();
        const pill = screen.getByTestId('implement-plan-card-status-pill');
        expect(pill.textContent).toContain('Completed');
        expect(screen.getByTestId('implement-plan-card-view-btn')).toBeTruthy();
    });

    it('shows "Implement again" with secondary style when latest run is active', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1',
            planFilePath: '/plan.md',
            enqueuedAt: new Date().toISOString(),
            liveStatus: 'running',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.textContent).toContain('Implement again');
        expect(btn.title).toContain('already running');
        // Secondary style: border instead of bg-blue-600
        expect(btn.className).toContain('border');
    });

    it('shows run count and expandable list for multiple runs', () => {
        const runs: ExistingRun[] = [
            { processId: 'queue_impl-1', planFilePath: '/p.md', enqueuedAt: new Date(Date.now() - 600000).toISOString(), liveStatus: 'failed' },
            { processId: 'queue_impl-2', planFilePath: '/p.md', enqueuedAt: new Date().toISOString(), liveStatus: 'running' },
        ];

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        // Banner shows latest run (running) and total count
        const pill = screen.getByTestId('implement-plan-card-status-pill');
        expect(pill.textContent).toContain('Running');
        expect(screen.getByTestId('implement-plan-card-banner').textContent).toContain('2 runs total');

        // Expandable button exists
        const expandBtn = screen.getByTestId('implement-plan-card-expand-btn');
        expect(expandBtn.textContent).toContain('Show all 2 runs');

        // List not visible until expanded
        expect(screen.queryByTestId('implement-plan-card-run-list')).toBeNull();

        // Expand
        fireEvent.click(expandBtn);
        expect(screen.getByTestId('implement-plan-card-run-list')).toBeTruthy();
    });

    it('navigates via onViewRun when View button is clicked', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-42',
            planFilePath: '/p.md',
            enqueuedAt: new Date().toISOString(),
            liveStatus: 'completed',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                onImplemented={onImplemented}
                existingRuns={runs}
                onViewRun={onViewRun}
            />,
        );

        fireEvent.click(screen.getByTestId('implement-plan-card-view-btn'));
        expect(onViewRun).toHaveBeenCalledWith('queue_impl-42');
    });

    it('persists implementation record after successful enqueue', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-new' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                workspaceId="ws-1"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{ type: 'chat', workspaceId: 'ws-1' }}
                onRecordPersisted={onRecordPersisted}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(mockProcessUpdate).toHaveBeenCalledTimes(1);
        });

        const [pid, updates] = mockProcessUpdate.mock.calls[0];
        expect(pid).toBe('queue_source-1');
        const impls = updates.metadata.implementations;
        expect(impls).toHaveLength(1);
        expect(impls[0].processId).toBe('queue_task-new');
        expect(impls[0].planFilePath).toBe('/plan.md');
        expect(impls[0].enqueuedAt).toBeTruthy();

        // onRecordPersisted should be called
        expect(onRecordPersisted).toHaveBeenCalledTimes(1);

        // onImplemented should still be called
        expect(onImplemented).toHaveBeenCalledWith('queue_task-new');
    });

    it('appends to existing implementations without overwriting', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-second' } });
        mockProcessUpdate.mockResolvedValue({ process: {} });

        const existingImpls = [
            { processId: 'queue_first', planFilePath: '/plan.md', enqueuedAt: '2026-01-01T00:00:00Z' },
        ];

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{ type: 'chat', implementations: existingImpls }}
                onRecordPersisted={onRecordPersisted}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(mockProcessUpdate).toHaveBeenCalledTimes(1);
        });

        const impls = mockProcessUpdate.mock.calls[0][1].metadata.implementations;
        expect(impls).toHaveLength(2);
        expect(impls[0].processId).toBe('queue_first');
        expect(impls[1].processId).toBe('queue_task-second');
    });

    it('still navigates even if persistence fails', async () => {
        mockEnqueue.mockResolvedValue({ task: { id: 'task-ok' } });
        mockProcessUpdate.mockRejectedValue(new Error('Server error'));
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        render(
            <ImplementPlanCard
                planFilePath="/plan.md"
                onImplemented={onImplemented}
                sourceProcessId="queue_source-1"
                sourceMetadata={{}}
                onRecordPersisted={onRecordPersisted}
            />,
        );

        await act(async () => {
            fireEvent.click(screen.getByTestId('implement-plan-card-btn'));
        });

        await waitFor(() => {
            expect(onImplemented).toHaveBeenCalledWith('queue_task-ok');
        });

        // Persistence failed but navigation succeeded
        expect(onRecordPersisted).not.toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalled();
        consoleSpy.mockRestore();
    });

    it('does not show tooltip when no active run', () => {
        const runs: ExistingRun[] = [{
            processId: 'queue_impl-1',
            planFilePath: '/p.md',
            enqueuedAt: new Date().toISOString(),
            liveStatus: 'completed',
        }];

        render(
            <ImplementPlanCard
                planFilePath="/p.md"
                onImplemented={onImplemented}
                existingRuns={runs}
            />,
        );

        const btn = screen.getByTestId('implement-plan-card-btn') as HTMLButtonElement;
        expect(btn.title).toBeFalsy();
    });
});

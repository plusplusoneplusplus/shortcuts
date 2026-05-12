/**
 * @vitest-environment jsdom
 *
 * Tests for ImplementPlanCard — verifies enqueue payload, navigation handoff,
 * and disabled / submitted states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing the component under test
// ---------------------------------------------------------------------------

const mockEnqueue = vi.fn();

vi.mock('../../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        queue: { enqueue: mockEnqueue },
    }),
    getSpaCocClientErrorMessage: (err: any, fallback: string) =>
        (err instanceof Error ? err.message : undefined) || fallback,
}));

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------

import { ImplementPlanCard } from '../../../../../src/server/spa/client/react/features/chat/ImplementPlanCard';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImplementPlanCard', () => {
    const onImplemented = vi.fn();

    beforeEach(() => {
        mockEnqueue.mockReset();
        onImplemented.mockReset();
    });

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
});

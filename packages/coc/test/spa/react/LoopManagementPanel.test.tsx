/**
 * Tests for LoopManagementPanel — rendering loop list, actions, empty state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoopManagementPanel } from '../../../src/server/spa/client/react/features/chat/LoopManagementPanel';
import type { LoopEntry } from '@plusplusoneplusplus/coc-client';

function makeLoop(overrides: Partial<LoopEntry> = {}): LoopEntry {
    return {
        id: 'loop-1',
        processId: 'proc-1',
        description: 'Check server status',
        intervalMs: 60_000,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastTickAt: null,
        nextTickAt: null,
        tickCount: 0,
        consecutiveFailures: 0,
        expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        pausedReason: null,
        prompt: 'Check server status and report',
        model: null,
        ...overrides,
    };
}

describe('LoopManagementPanel', () => {
    const defaultHandlers = {
        onPause: vi.fn().mockResolvedValue(undefined),
        onResume: vi.fn().mockResolvedValue(undefined),
        onCancel: vi.fn().mockResolvedValue(undefined),
        onClose: vi.fn(),
    };

    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <LoopManagementPanel
                loops={[makeLoop()]}
                isOpen={false}
                {...defaultHandlers}
            />,
        );
        expect(container.querySelector('[data-testid="loop-management-panel"]')).toBeNull();
    });

    it('renders panel when isOpen is true', () => {
        render(
            <LoopManagementPanel
                loops={[makeLoop()]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('loop-management-panel')).toBeTruthy();
    });

    it('shows empty state when no loops', () => {
        render(
            <LoopManagementPanel
                loops={[]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText('No loops for this conversation')).toBeTruthy();
    });

    it('renders loop items with status and description', () => {
        const loop = makeLoop({ id: 'abc', description: 'Monitor logs' });
        render(
            <LoopManagementPanel
                loops={[loop]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('loop-item-abc')).toBeTruthy();
        expect(screen.getByText('Monitor logs')).toBeTruthy();
        expect(screen.getByText('active')).toBeTruthy();
    });

    it('shows pause button for active loops', () => {
        render(
            <LoopManagementPanel
                loops={[makeLoop({ id: 'l1', status: 'active' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('loop-pause-l1')).toBeTruthy();
    });

    it('shows resume button for paused loops', () => {
        render(
            <LoopManagementPanel
                loops={[makeLoop({ id: 'l2', status: 'paused' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('loop-resume-l2')).toBeTruthy();
    });

    it('calls onPause when pause button clicked', async () => {
        const onPause = vi.fn().mockResolvedValue(undefined);
        render(
            <LoopManagementPanel
                loops={[makeLoop({ id: 'l1', status: 'active' })]}
                isOpen={true}
                {...defaultHandlers}
                onPause={onPause}
            />,
        );
        fireEvent.click(screen.getByTestId('loop-pause-l1'));
        await waitFor(() => expect(onPause).toHaveBeenCalledWith('l1'));
    });

    it('calls onResume when resume button clicked', async () => {
        const onResume = vi.fn().mockResolvedValue(undefined);
        render(
            <LoopManagementPanel
                loops={[makeLoop({ id: 'l2', status: 'paused' })]}
                isOpen={true}
                {...defaultHandlers}
                onResume={onResume}
            />,
        );
        fireEvent.click(screen.getByTestId('loop-resume-l2'));
        await waitFor(() => expect(onResume).toHaveBeenCalledWith('l2'));
    });

    it('calls onCancel when cancel button clicked', async () => {
        const onCancel = vi.fn().mockResolvedValue(undefined);
        render(
            <LoopManagementPanel
                loops={[makeLoop({ id: 'l1', status: 'active' })]}
                isOpen={true}
                {...defaultHandlers}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByTestId('loop-cancel-l1'));
        await waitFor(() => expect(onCancel).toHaveBeenCalledWith('l1'));
    });

    it('formats interval correctly', () => {
        render(
            <LoopManagementPanel
                loops={[makeLoop({ intervalMs: 300_000 })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText('every 5m')).toBeTruthy();
    });

    it('separates active and inactive loops', () => {
        const loops = [
            makeLoop({ id: 'active-1', status: 'active' }),
            makeLoop({ id: 'cancelled-1', status: 'cancelled' }),
        ];
        render(
            <LoopManagementPanel
                loops={loops}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText('Inactive')).toBeTruthy();
        expect(screen.getByTestId('loop-item-active-1')).toBeTruthy();
        expect(screen.getByTestId('loop-item-cancelled-1')).toBeTruthy();
    });

    it('does not show action buttons for cancelled loops', () => {
        render(
            <LoopManagementPanel
                loops={[makeLoop({ id: 'c1', status: 'cancelled' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.queryByTestId('loop-pause-c1')).toBeNull();
        expect(screen.queryByTestId('loop-resume-c1')).toBeNull();
        expect(screen.queryByTestId('loop-cancel-c1')).toBeNull();
    });

    it('shows loop count in header', () => {
        render(
            <LoopManagementPanel
                loops={[makeLoop(), makeLoop({ id: 'loop-2' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText(/Loops \(2\)/)).toBeTruthy();
    });
});

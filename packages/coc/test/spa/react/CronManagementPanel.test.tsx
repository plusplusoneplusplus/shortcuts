/**
 * Tests for CronManagementPanel — rendering cron list, actions, empty state.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CronManagementPanel } from '../../../src/server/spa/client/react/features/chat/CronManagementPanel';
import type { CronEntry } from '@plusplusoneplusplus/coc-client';

function makeCron(overrides: Partial<CronEntry> = {}): CronEntry {
    return {
        id: 'cron-1',
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

describe('CronManagementPanel', () => {
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
            <CronManagementPanel
                crons={[makeCron()]}
                isOpen={false}
                {...defaultHandlers}
            />,
        );
        expect(container.querySelector('[data-testid="cron-management-panel"]')).toBeNull();
    });

    it('renders panel when isOpen is true', () => {
        render(
            <CronManagementPanel
                crons={[makeCron()]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('cron-management-panel')).toBeTruthy();
    });

    it('shows empty state when no crons', () => {
        render(
            <CronManagementPanel
                crons={[]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText('No crons for this conversation')).toBeTruthy();
    });

    it('renders cron items with status and description', () => {
        const cron = makeCron({ id: 'abc', description: 'Monitor logs' });
        render(
            <CronManagementPanel
                crons={[cron]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('cron-item-abc')).toBeTruthy();
        expect(screen.getByText('Monitor logs')).toBeTruthy();
        expect(screen.getByText('active')).toBeTruthy();
    });

    it('shows pause button for active crons', () => {
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l1', status: 'active' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('cron-pause-l1')).toBeTruthy();
    });

    it('shows resume button for paused crons', () => {
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l2', status: 'paused' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('cron-resume-l2')).toBeTruthy();
    });

    it('calls onPause when pause button clicked', async () => {
        const onPause = vi.fn().mockResolvedValue(undefined);
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l1', status: 'active' })]}
                isOpen={true}
                {...defaultHandlers}
                onPause={onPause}
            />,
        );
        fireEvent.click(screen.getByTestId('cron-pause-l1'));
        await waitFor(() => expect(onPause).toHaveBeenCalledWith('l1'));
    });

    it('calls onResume when resume button clicked', async () => {
        const onResume = vi.fn().mockResolvedValue(undefined);
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l2', status: 'paused' })]}
                isOpen={true}
                {...defaultHandlers}
                onResume={onResume}
            />,
        );
        fireEvent.click(screen.getByTestId('cron-resume-l2'));
        await waitFor(() => expect(onResume).toHaveBeenCalledWith('l2'));
    });

    it('calls onCancel when cancel button clicked', async () => {
        const onCancel = vi.fn().mockResolvedValue(undefined);
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l1', status: 'active' })]}
                isOpen={true}
                {...defaultHandlers}
                onCancel={onCancel}
            />,
        );
        fireEvent.click(screen.getByTestId('cron-cancel-l1'));
        await waitFor(() => expect(onCancel).toHaveBeenCalledWith('l1'));
    });

    it('formats interval correctly', () => {
        render(
            <CronManagementPanel
                crons={[makeCron({ intervalMs: 300_000 })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText('every 5m')).toBeTruthy();
    });

    it('shows next scheduled time for active crons with nextTickAt', () => {
        const nextTickAt = new Date(Date.now() + 2 * 3_600_000 + 30_000).toISOString();
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l1', status: 'active', nextTickAt })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        const el = screen.getByTestId('cron-next-l1');
        expect(el.textContent).toBe('Next: in 2h');
        expect(el.getAttribute('title')).toBe(new Date(nextTickAt).toLocaleString());
    });

    it('does not show next scheduled time when nextTickAt is null', () => {
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l1', status: 'active', nextTickAt: null })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.queryByTestId('cron-next-l1')).toBeNull();
    });

    it('does not show next scheduled time for paused crons', () => {
        const nextTickAt = new Date(Date.now() + 3_600_000).toISOString();
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l1', status: 'paused', nextTickAt })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.queryByTestId('cron-next-l1')).toBeNull();
    });

    it('shows "due now" when nextTickAt is in the past', () => {
        const nextTickAt = new Date(Date.now() - 5_000).toISOString();
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'l1', status: 'active', nextTickAt })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByTestId('cron-next-l1').textContent).toBe('Next: due now');
    });

    it('separates active and inactive crons', () => {
        const crons = [
            makeCron({ id: 'active-1', status: 'active' }),
            makeCron({ id: 'cancelled-1', status: 'cancelled' }),
        ];
        render(
            <CronManagementPanel
                crons={crons}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText('Inactive')).toBeTruthy();
        expect(screen.getByTestId('cron-item-active-1')).toBeTruthy();
        expect(screen.getByTestId('cron-item-cancelled-1')).toBeTruthy();
    });

    it('does not show action buttons for cancelled crons', () => {
        render(
            <CronManagementPanel
                crons={[makeCron({ id: 'c1', status: 'cancelled' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.queryByTestId('cron-pause-c1')).toBeNull();
        expect(screen.queryByTestId('cron-resume-c1')).toBeNull();
        expect(screen.queryByTestId('cron-cancel-c1')).toBeNull();
    });

    it('shows cron count in header', () => {
        render(
            <CronManagementPanel
                crons={[makeCron(), makeCron({ id: 'cron-2' })]}
                isOpen={true}
                {...defaultHandlers}
            />,
        );
        expect(screen.getByText(/Crons \(2\)/)).toBeTruthy();
    });
});

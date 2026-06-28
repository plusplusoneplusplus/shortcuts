/**
 * Tests for RewindConfirmDialog — the destructive-rewind confirmation
 * (AC-04: confirmation dialog warning, confirm/cancel wiring, pending state).
 */

// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RewindConfirmDialog } from '../../../src/server/spa/client/react/features/chat/conversation/RewindConfirmDialog';

vi.mock('../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false, isDesktop: true }),
}));

describe('RewindConfirmDialog', () => {
    it('renders nothing when closed', () => {
        render(<RewindConfirmDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.queryByText('Rewind conversation?')).toBeNull();
    });

    it('warns that this is destructive and chat-only when open', () => {
        render(<RewindConfirmDialog open onConfirm={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByText('Rewind conversation?')).toBeTruthy();
        expect(screen.getByText(/everything after it/i)).toBeTruthy();
        expect(screen.getByText(/files.*not reverted/i)).toBeTruthy();
    });

    it('calls onConfirm when the Rewind button is clicked', () => {
        const onConfirm = vi.fn();
        render(<RewindConfirmDialog open onConfirm={onConfirm} onCancel={vi.fn()} />);
        fireEvent.click(screen.getByText('Rewind'));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it('calls onCancel when the Cancel button is clicked', () => {
        const onCancel = vi.fn();
        render(<RewindConfirmDialog open onConfirm={vi.fn()} onCancel={onCancel} />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('disables both actions and shows a pending label while in flight', () => {
        const onConfirm = vi.fn();
        const onCancel = vi.fn();
        render(<RewindConfirmDialog open pending onConfirm={onConfirm} onCancel={onCancel} />);
        const confirmBtn = screen.getByText('Rewinding…');
        const cancelBtn = screen.getByText('Cancel');
        expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
        expect((cancelBtn as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(confirmBtn);
        fireEvent.click(cancelBtn);
        expect(onConfirm).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });
});

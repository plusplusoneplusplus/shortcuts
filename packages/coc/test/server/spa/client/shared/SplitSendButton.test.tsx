/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

import { SplitSendButton } from '../../../../../src/server/spa/client/react/shared/SplitSendButton';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof SplitSendButton>[0]> = {}) {
    return {
        sending: false,
        disabled: false,
        ctrlHeld: false,
        onSend: vi.fn(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests — single button mode (sending=false)
// ---------------------------------------------------------------------------

describe('SplitSendButton — single mode (sending=false)', () => {
    it('renders single "Send" button when sending=false', () => {
        render(<SplitSendButton {...defaultProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toBe('Send');
    });

    it('shows "⚡ Steer" when ctrlHeld=true and sending=false', () => {
        render(<SplitSendButton {...defaultProps({ ctrlHeld: true })} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toBe('⚡ Steer');
    });

    it('applies orange bg when ctrlHeld=true and sending=false', () => {
        render(<SplitSendButton {...defaultProps({ ctrlHeld: true })} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('bg-[#e8912d]');
    });

    it('applies blue bg when ctrlHeld=false and sending=false', () => {
        render(<SplitSendButton {...defaultProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('bg-[#0078d4]');
    });

    it('fires onSend() with no arg on click in single mode', () => {
        const onSend = vi.fn();
        render(<SplitSendButton {...defaultProps({ onSend })} />);
        fireEvent.click(screen.getByTestId('activity-chat-send-btn'));
        expect(onSend).toHaveBeenCalledOnce();
        expect(onSend).toHaveBeenCalledWith();
    });

    it('shows default tooltip when no modifier is held', () => {
        render(<SplitSendButton {...defaultProps()} />);
        expect(screen.getByTestId('activity-chat-send-btn').title).toBe(
            'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline',
        );
    });

    it('shows modifier-held tooltip when ctrlHeld=true', () => {
        render(<SplitSendButton {...defaultProps({ ctrlHeld: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn').title).toBe(
            'Release Ctrl to queue instead',
        );
    });

    it('is disabled when disabled=true', () => {
        render(<SplitSendButton {...defaultProps({ disabled: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn')).toBeDisabled();
    });

    it('does not render split-send-group when sending=false', () => {
        render(<SplitSendButton {...defaultProps()} />);
        expect(screen.queryByTestId('split-send-group')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Tests — split mode (sending=true)
// ---------------------------------------------------------------------------

describe('SplitSendButton — split mode (sending=true)', () => {
    it('renders split button group when sending=true', () => {
        render(<SplitSendButton {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('split-send-group')).toBeTruthy();
        expect(screen.getByTestId('activity-chat-send-btn')).toBeTruthy();
        expect(screen.getByTestId('split-send-steer-btn')).toBeTruthy();
    });

    it('Queue segment text contains "Queue"', () => {
        render(<SplitSendButton {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn').textContent).toContain('Queue');
    });

    it('Steer segment text contains "⚡ Steer"', () => {
        render(<SplitSendButton {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('split-send-steer-btn').textContent).toContain('⚡ Steer');
    });

    it('Queue segment fires onSend("enqueue") on click', () => {
        const onSend = vi.fn();
        render(<SplitSendButton {...defaultProps({ sending: true, onSend })} />);
        fireEvent.click(screen.getByTestId('activity-chat-send-btn'));
        expect(onSend).toHaveBeenCalledOnce();
        expect(onSend).toHaveBeenCalledWith('enqueue');
    });

    it('Steer segment fires onSend("immediate") on click', () => {
        const onSend = vi.fn();
        render(<SplitSendButton {...defaultProps({ sending: true, onSend })} />);
        fireEvent.click(screen.getByTestId('split-send-steer-btn'));
        expect(onSend).toHaveBeenCalledOnce();
        expect(onSend).toHaveBeenCalledWith('immediate');
    });

    it('Steer segment gets ring-2 emphasis when ctrlHeld=true', () => {
        render(<SplitSendButton {...defaultProps({ sending: true, ctrlHeld: true })} />);
        const steerBtn = screen.getByTestId('split-send-steer-btn');
        expect(steerBtn.className).toContain('ring-2');
        expect(steerBtn.className).toContain('ring-white');
    });

    it('Steer segment has no ring when ctrlHeld=false', () => {
        render(<SplitSendButton {...defaultProps({ sending: true, ctrlHeld: false })} />);
        const steerBtn = screen.getByTestId('split-send-steer-btn');
        expect(steerBtn.className).not.toContain('ring-2');
    });

    it('both segments disabled when disabled=true', () => {
        render(<SplitSendButton {...defaultProps({ sending: true, disabled: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn')).toBeDisabled();
        expect(screen.getByTestId('split-send-steer-btn')).toBeDisabled();
    });

    it('Queue segment tooltip says "Queue after current response (Enter)"', () => {
        render(<SplitSendButton {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn').title).toBe(
            'Queue after current response (Enter)',
        );
    });

    it('Steer segment tooltip says "Inject into running session now (Ctrl+Enter)"', () => {
        render(<SplitSendButton {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('split-send-steer-btn').title).toBe(
            'Inject into running session now (Ctrl+Enter)',
        );
    });

    it('Queue segment has blue background', () => {
        render(<SplitSendButton {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn').className).toContain('bg-[#0078d4]');
    });

    it('Steer segment has orange background', () => {
        render(<SplitSendButton {...defaultProps({ sending: true })} />);
        expect(screen.getByTestId('split-send-steer-btn').className).toContain('bg-[#e8912d]');
    });
});

// ---------------------------------------------------------------------------
// Tests — custom data-testid
// ---------------------------------------------------------------------------

describe('SplitSendButton — custom data-testid', () => {
    it('uses custom data-testid on primary segment (single mode)', () => {
        render(<SplitSendButton {...defaultProps({ 'data-testid': 'item-conversation-send' } as any)} />);
        expect(screen.getByTestId('item-conversation-send')).toBeTruthy();
        expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
    });

    it('uses custom data-testid on primary segment (split mode)', () => {
        render(<SplitSendButton {...defaultProps({ sending: true, 'data-testid': 'item-conversation-send' } as any)} />);
        expect(screen.getByTestId('item-conversation-send')).toBeTruthy();
        expect(screen.getByTestId('split-send-steer-btn')).toBeTruthy();
    });
});

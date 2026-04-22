/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@plusplusoneplusplus/forge', () => ({}));

import { SendButton, SplitSendButton } from '../../../../../src/server/spa/client/react/ui/SplitSendButton';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(overrides: Partial<Parameters<typeof SendButton>[0]> = {}) {
    return {
        disabled: false,
        ctrlHeld: false,
        onSend: vi.fn(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Tests — single button (default state, no modifier)
// ---------------------------------------------------------------------------

describe('SendButton — default state (ctrlHeld=false)', () => {
    it('renders "Send" label', () => {
        render(<SendButton {...defaultProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toBe('Send');
    });

    it('applies blue background', () => {
        render(<SendButton {...defaultProps()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('bg-[#0078d4]');
    });

    it('fires onSend("enqueue") on click', () => {
        const onSend = vi.fn();
        render(<SendButton {...defaultProps({ onSend })} />);
        fireEvent.click(screen.getByTestId('activity-chat-send-btn'));
        expect(onSend).toHaveBeenCalledOnce();
        expect(onSend).toHaveBeenCalledWith('enqueue');
    });

    it('shows default tooltip', () => {
        render(<SendButton {...defaultProps()} />);
        expect(screen.getByTestId('activity-chat-send-btn').title).toBe(
            'Send (Enter) · Ctrl+Enter to steer AI · Shift+Enter for newline',
        );
    });

    it('is disabled when disabled=true', () => {
        render(<SendButton {...defaultProps({ disabled: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn')).toBeDisabled();
    });

    it('does not render split-send-group', () => {
        render(<SendButton {...defaultProps()} />);
        expect(screen.queryByTestId('split-send-group')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Tests — steering state (ctrlHeld=true)
// ---------------------------------------------------------------------------

describe('SendButton — steering state (ctrlHeld=true)', () => {
    it('renders "⚡ Steer" label', () => {
        render(<SendButton {...defaultProps({ ctrlHeld: true })} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toBe('⚡ Steer');
    });

    it('applies orange background', () => {
        render(<SendButton {...defaultProps({ ctrlHeld: true })} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.className).toContain('bg-[#e8912d]');
    });

    it('fires onSend("immediate") on click', () => {
        const onSend = vi.fn();
        render(<SendButton {...defaultProps({ ctrlHeld: true, onSend })} />);
        fireEvent.click(screen.getByTestId('activity-chat-send-btn'));
        expect(onSend).toHaveBeenCalledOnce();
        expect(onSend).toHaveBeenCalledWith('immediate');
    });

    it('shows modifier-held tooltip', () => {
        render(<SendButton {...defaultProps({ ctrlHeld: true })} />);
        expect(screen.getByTestId('activity-chat-send-btn').title).toBe(
            'Release Ctrl to queue instead',
        );
    });
});

// ---------------------------------------------------------------------------
// Tests — custom data-testid
// ---------------------------------------------------------------------------

describe('SendButton — custom data-testid', () => {
    it('uses custom data-testid', () => {
        render(<SendButton {...defaultProps({ 'data-testid': 'item-conversation-send' } as any)} />);
        expect(screen.getByTestId('item-conversation-send')).toBeTruthy();
        expect(screen.queryByTestId('activity-chat-send-btn')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Tests — deprecated SplitSendButton alias
// ---------------------------------------------------------------------------

describe('SplitSendButton (deprecated alias)', () => {
    it('renders identically to SendButton (sending prop is ignored)', () => {
        render(<SplitSendButton sending={true} disabled={false} ctrlHeld={false} onSend={vi.fn()} />);
        const btn = screen.getByTestId('activity-chat-send-btn');
        expect(btn.textContent).toBe('Send');
        expect(screen.queryByTestId('split-send-group')).toBeNull();
    });
});

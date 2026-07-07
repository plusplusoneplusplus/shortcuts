/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueueFollowUpButton } from '../../../../src/server/spa/client/react/ui/QueueFollowUpButton';

describe('QueueFollowUpButton', () => {
    it('preserves compact desktop sizing while exposing a 32px mobile/tablet tap target', () => {
        render(
            <QueueFollowUpButton
                disabled={false}
                ctrlHeld={false}
                onSend={vi.fn()}
                mobileTapTarget={true}
            />,
        );

        const tokens = screen.getByTestId('activity-chat-send-btn').className.split(/\s+/);
        expect(tokens).toContain('h-8');
        expect(tokens).toContain('w-8');
        expect(tokens).toContain('justify-center');
        expect(tokens).toContain('sm:w-auto');
        expect(tokens).toContain('sm:pl-2.5');
        expect(tokens).toContain('sm:pr-2');
        expect(tokens).toContain('lg:h-[24px]');
        expect(tokens).toContain('lg:pl-2');
        expect(tokens).toContain('lg:pr-1.5');
    });

    it('hides the text label below sm when using mobile tap-target mode', () => {
        render(
            <QueueFollowUpButton
                disabled={false}
                ctrlHeld={false}
                onSend={vi.fn()}
                mobileTapTarget={true}
            />,
        );

        const button = screen.getByTestId('activity-chat-send-btn');
        expect(button.getAttribute('aria-label')).toBe('Send');
        expect(button.querySelector('span')?.className).toBe('hidden sm:inline');
    });

    it('renders icon-only at every viewport when iconOnly is set', () => {
        render(
            <QueueFollowUpButton
                disabled={false}
                ctrlHeld={false}
                onSend={vi.fn()}
                mobileTapTarget={true}
                iconOnly={true}
            />,
        );

        const button = screen.getByTestId('activity-chat-send-btn');
        // No text label, no ⌘↵ hint — the icon svg is the only content.
        expect(button.textContent).toBe('');
        expect(screen.queryByTestId('queue-follow-up-shortcut-hint')).toBeNull();
        // Accessible name preserved.
        expect(button.getAttribute('aria-label')).toBe('Send');
        // Fixed square-ish sizing, not the viewport-responsive classes.
        const tokens = button.className.split(/\s+/);
        expect(tokens).toContain('w-[26px]');
        expect(tokens).toContain('justify-center');
        expect(tokens).not.toContain('sm:w-auto');
    });

    it('keeps the Steer state icon when iconOnly and ctrl is held', () => {
        render(
            <QueueFollowUpButton
                disabled={false}
                ctrlHeld={true}
                onSend={vi.fn()}
                iconOnly={true}
            />,
        );

        const button = screen.getByTestId('activity-chat-send-btn');
        expect(button.textContent).toBe('⚡');
        expect(button.getAttribute('aria-label')).toBe('Steer');
    });
});

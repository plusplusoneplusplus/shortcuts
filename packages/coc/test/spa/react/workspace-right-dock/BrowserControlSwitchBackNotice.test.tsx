// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BrowserControlSwitchBackNotices } from '../../../../src/server/spa/client/react/shared/file-path/BrowserControlSwitchBackNotice';
import { clearBrowserControlNotice, setBrowserControlNotice, type BrowserControlNotice } from '../../../../src/server/spa/client/react/shared/file-path/browser-control-notice';

const notice = (overrides: Partial<BrowserControlNotice> = {}): BrowserControlNotice => ({
    key: 'k1', workspaceId: 'ws-a', processId: 'p1', routingRef: 'ws-a', actions: ['paste_html', 'click'],
    switchBack: vi.fn(), stop: vi.fn(async () => {}), ...overrides,
});

afterEach(() => {
    cleanup();
    clearBrowserControlNotice('k1');
    clearBrowserControlNotice('k2');
});

describe('BrowserControlSwitchBackNotices', () => {
    it('renders nothing without waiting turns', () => {
        const { container } = render(<BrowserControlSwitchBackNotices />);
        expect(container.innerHTML).toBe('');
    });

    it('shows one card per waiting turn naming the workspace and actions, and Switch back calls the relay', () => {
        const first = notice();
        render(<BrowserControlSwitchBackNotices />);
        act(() => {
            setBrowserControlNotice(first);
            setBrowserControlNotice(notice({ key: 'k2', workspaceId: 'ws-b', routingRef: 'ws-b', actions: ['click'] }));
        });
        const cards = screen.getAllByTestId('browser-control-notice');
        expect(cards).toHaveLength(2);
        expect(cards[0].textContent).toContain('ws-a');
        expect(cards[0].textContent).toContain('paste_html, click');
        fireEvent.click(screen.getAllByTestId('browser-control-switch-back')[0]);
        expect(first.switchBack).toHaveBeenCalledOnce();
        act(() => clearBrowserControlNotice('k1'));
        expect(screen.getAllByTestId('browser-control-notice')).toHaveLength(1);
    });

    it('stops the turn and reports a failed stop', async () => {
        const stop = vi.fn(async () => { throw new Error('offline'); });
        render(<BrowserControlSwitchBackNotices />);
        act(() => setBrowserControlNotice(notice({ stop })));
        fireEvent.click(screen.getByTestId('browser-control-notice-stop'));
        expect(stop).toHaveBeenCalledOnce();
        expect(await screen.findByText('Could not stop browser control. Try again.')).toBeTruthy();
    });
});

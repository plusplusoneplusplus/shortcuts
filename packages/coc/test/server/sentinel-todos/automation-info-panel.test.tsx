/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SentinelAutomationInfo } from '../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/SentinelAutomationInfo';

const viewport = { width: window.innerWidth, height: window.innerHeight };
afterEach(() => {
    cleanup(); vi.restoreAllMocks();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewport.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport.height });
});

describe('Sentinel automation information', () => {
    it.each(['Overtures', 'Refrains', 'Coda'] as const)('opens %s on keyboard/click, dismisses on Escape/outside/touch and restores appropriate focus', async term => {
        const user = userEvent.setup();
        render(<><SentinelAutomationInfo term={term} /><button type="button">Other control</button></>);
        const trigger = screen.getByRole('button', { name: `About ${term}` });
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        fireEvent.mouseEnter(trigger);
        expect(screen.queryByRole('dialog')).toBeNull();
        trigger.focus();
        await user.keyboard('{Enter}');
        const dialog = screen.getByRole('dialog', { name: `About ${term}` });
        expect(document.activeElement).toBe(dialog);
        expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
        expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
        expect(dialog.querySelector('p')?.id).toBe(dialog.getAttribute('aria-describedby'));
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        await user.keyboard(' ');
        await user.click(screen.getByRole('button', { name: `Close ${term} information` }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(trigger);
        await user.click(trigger);
        await user.click(trigger);
        expect(screen.queryByRole('dialog')).toBeNull();
        await user.click(trigger);
        const outside = screen.getByRole('button', { name: 'Other control' });
        await user.click(outside);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(document.activeElement).toBe(outside);
        await user.click(trigger);
        fireEvent.touchStart(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it.each([320, 1000])('constrains portaled help at the viewport edge at width %ipx', async width => {
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 240 });
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
            return this.getAttribute('role') === 'dialog'
                ? { width: 288, height: 160, top: 0, left: 0, right: 288, bottom: 160 } as DOMRect
                : { width: 24, height: 24, top: 210, bottom: 234, left: width - 24, right: width } as DOMRect;
        });
        const { container } = render(<SentinelAutomationInfo term="Coda" />);
        fireEvent.click(screen.getByRole('button', { name: 'About Coda' }));
        const dialog = screen.getByRole('dialog', { name: 'About Coda' });
        expect(container.contains(dialog)).toBe(false);
        expect(Number.parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(8);
        expect(Number.parseFloat(dialog.style.left) + 288).toBeLessThanOrEqual(width - 8);
        expect(Number.parseFloat(dialog.style.maxWidth)).toBe(width - 16);
        expect(Number.parseFloat(dialog.style.top) + 160).toBeLessThanOrEqual(232);
        expect(dialog.className).toContain('overflow-auto');
        expect(dialog.className).toContain('overflow-wrap:anywhere');
        expect(within(dialog).getByText(/manual and Deferred items need your approval/)).toBeTruthy();
    });

    it('dismisses help when its containing section hides or its owner view unmounts', async () => {
        const view = render(<div><SentinelAutomationInfo term="Coda" /></div>);
        fireEvent.click(screen.getByRole('button', { name: 'About Coda' }));
        view.rerender(<div hidden><SentinelAutomationInfo term="Coda" /></div>);
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        view.rerender(<div><SentinelAutomationInfo term="Coda" /></div>);
        fireEvent.click(screen.getByRole('button', { name: 'About Coda' }));
        expect(screen.getByRole('dialog')).toBeTruthy();
        view.unmount();
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

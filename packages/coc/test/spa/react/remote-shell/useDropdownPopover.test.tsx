/**
 * useDropdownPopover — the shared popover-interaction hook adopted by both remote
 * repo pickers. Covers open/toggle/close, outside-click, Escape (close + refocus
 * trigger), and search auto-focus on open.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest';
import { useRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useDropdownPopover } from '../../../../src/server/spa/client/react/features/remote-shell/useDropdownPopover';

function Harness() {
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const { open, toggle, close, searchRef } = useDropdownPopover(rootRef, triggerRef);
    return (
        <div>
            <div ref={rootRef}>
                <button ref={triggerRef} data-testid="trigger" onClick={toggle}>toggle</button>
                {open && (
                    <div data-testid="popover">
                        <input ref={searchRef} data-testid="search" />
                        <button data-testid="close-btn" onClick={close}>close</button>
                    </div>
                )}
            </div>
            <button data-testid="outside">outside</button>
        </div>
    );
}

afterEach(cleanup);

describe('useDropdownPopover', () => {
    it('starts closed and toggles open/closed via the trigger', () => {
        render(<Harness />);
        expect(screen.queryByTestId('popover')).toBeNull();
        fireEvent.click(screen.getByTestId('trigger'));
        expect(screen.getByTestId('popover')).toBeTruthy();
        fireEvent.click(screen.getByTestId('trigger'));
        expect(screen.queryByTestId('popover')).toBeNull();
    });

    it('closes on outside mousedown', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('trigger'));
        expect(screen.getByTestId('popover')).toBeTruthy();
        fireEvent.mouseDown(screen.getByTestId('outside'));
        expect(screen.queryByTestId('popover')).toBeNull();
    });

    it('does not close on mousedown inside the popover root', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('trigger'));
        fireEvent.mouseDown(screen.getByTestId('search'));
        expect(screen.getByTestId('popover')).toBeTruthy();
    });

    it('closes on Escape and refocuses the trigger', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('trigger'));
        expect(screen.getByTestId('popover')).toBeTruthy();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('popover')).toBeNull();
        expect(document.activeElement).toBe(screen.getByTestId('trigger'));
    });

    it('auto-focuses the search input after opening', async () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('trigger'));
        await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('search')));
    });

    it('closes via the close() helper', () => {
        render(<Harness />);
        fireEvent.click(screen.getByTestId('trigger'));
        fireEvent.click(screen.getByTestId('close-btn'));
        expect(screen.queryByTestId('popover')).toBeNull();
    });
});

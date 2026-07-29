/**
 * useDiffFindShortcut — Ctrl+F ownership for the in-diff find widget.
 *
 * Verifies the peer-of-useScopedFindShortcut contract: the hook opens the find
 * widget (and calls preventDefault) ONLY when the Ctrl/Cmd+F keydown originates
 * inside the diff container, stays inert (native find wins) when focus is
 * elsewhere, and tags its container with data-find-scope so sibling search
 * panels yield.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { useDiffFindShortcut } from '../../../src/server/spa/client/react/features/git/diff/useDiffFindShortcut';

afterEach(cleanup);

function Harness({ onTrigger, enabled }: { onTrigger: () => void; enabled?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useDiffFindShortcut(ref, onTrigger, enabled);
    return (
        <div>
            <div ref={ref} data-testid="diff-container">
                <input data-testid="inside-input" />
            </div>
            <input data-testid="outside-input" />
        </div>
    );
}

/**
 * jsdom's offsetParent is null for every element, which the hook treats as
 * "hidden". Make the container report a truthy offsetParent so the visible-panel
 * branch runs.
 */
function makeVisible(el: HTMLElement) {
    Object.defineProperty(el, 'offsetParent', { configurable: true, get: () => el.parentElement });
}

describe('useDiffFindShortcut', () => {
    it('opens the widget and prevents default when Ctrl+F fires inside the diff container', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Harness onTrigger={onTrigger} />);
        const container = getByTestId('diff-container');
        makeVisible(container);
        const inside = getByTestId('inside-input');

        const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        inside.dispatchEvent(evt);

        expect(onTrigger).toHaveBeenCalledTimes(1);
        expect(evt.defaultPrevented).toBe(true);
    });

    it('also handles Cmd+F (metaKey) inside the container', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Harness onTrigger={onTrigger} />);
        const container = getByTestId('diff-container');
        makeVisible(container);

        const evt = new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true, cancelable: true });
        getByTestId('inside-input').dispatchEvent(evt);

        expect(onTrigger).toHaveBeenCalledTimes(1);
        expect(evt.defaultPrevented).toBe(true);
    });

    it('stays inert (native find wins) when focus is outside the diff container', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Harness onTrigger={onTrigger} />);
        const container = getByTestId('diff-container');
        makeVisible(container);

        const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        getByTestId('outside-input').dispatchEvent(evt);

        expect(onTrigger).not.toHaveBeenCalled();
        expect(evt.defaultPrevented).toBe(false);
    });

    it('does not intercept a hidden (offsetParent === null) container', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Harness onTrigger={onTrigger} />);
        // container left hidden (jsdom default offsetParent === null)
        const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        getByTestId('inside-input').dispatchEvent(evt);
        expect(onTrigger).not.toHaveBeenCalled();
    });

    it('ignores non-Ctrl/Cmd F and other keys', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Harness onTrigger={onTrigger} />);
        const container = getByTestId('diff-container');
        makeVisible(container);
        const inside = getByTestId('inside-input');

        fireEvent.keyDown(inside, { key: 'f' }); // plain f
        fireEvent.keyDown(inside, { key: 'g', ctrlKey: true }); // ctrl+g
        expect(onTrigger).not.toHaveBeenCalled();
    });

    it('is inert when disabled', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Harness onTrigger={onTrigger} enabled={false} />);
        const container = getByTestId('diff-container');
        makeVisible(container);

        const evt = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
        getByTestId('inside-input').dispatchEvent(evt);
        expect(onTrigger).not.toHaveBeenCalled();
        expect(evt.defaultPrevented).toBe(false);
    });

    it('tags the container with data-find-scope while mounted so siblings yield', () => {
        const { getByTestId, unmount } = render(<Harness onTrigger={() => {}} />);
        const container = getByTestId('diff-container');
        expect(container.hasAttribute('data-find-scope')).toBe(true);
        unmount();
    });
});

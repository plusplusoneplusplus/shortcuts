/* @vitest-environment jsdom */
/**
 * Tests for useScopedFindShortcut — the shared Ctrl+F / Cmd+F routing helper
 * that all search-owning panels use so they never fight over preventDefault or
 * swallow native find-in-page.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import {
    useScopedFindShortcut,
    isWithinDetailPane,
    type ScopedFindShortcutOptions,
} from '../../../../src/server/spa/client/react/hooks/useScopedFindShortcut';

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
});

/** Force a truthy offsetParent (jsdom always reports null → "hidden"). */
function makeVisible(el: HTMLElement) {
    Object.defineProperty(el, 'offsetParent', { get: () => document.body, configurable: true });
}

function Panel({ testid, onTrigger, options }: {
    testid: string;
    onTrigger: () => void;
    options?: ScopedFindShortcutOptions;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useScopedFindShortcut(ref, onTrigger, options);
    return (
        <div ref={ref} data-testid={testid}>
            <input data-testid={`${testid}-input`} />
        </div>
    );
}

function pressCtrlF(target: EventTarget = document): KeyboardEvent {
    const event = new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
    });
    target.dispatchEvent(event);
    return event;
}

describe('isWithinDetailPane', () => {
    it('is true for a target inside [data-pane="detail"]', () => {
        document.body.innerHTML = '<div data-pane="detail"><input id="i"/></div>';
        const input = document.getElementById('i')!;
        expect(isWithinDetailPane(input)).toBe(true);
    });

    it('is false for a target outside the detail pane', () => {
        document.body.innerHTML = '<div><input id="i"/></div>';
        const input = document.getElementById('i')!;
        expect(isWithinDetailPane(input)).toBe(false);
    });

    it('is false for non-Element targets', () => {
        expect(isWithinDetailPane(null)).toBe(false);
        expect(isWithinDetailPane(document)).toBe(false);
    });
});

describe('useScopedFindShortcut', () => {
    it('triggers + preventDefault when focus is inside the container', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Panel testid="p" onTrigger={onTrigger} />);
        makeVisible(getByTestId('p') as HTMLElement);

        const event = pressCtrlF(getByTestId('p-input'));

        expect(onTrigger).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('is a no-op when the container is hidden (offsetParent === null)', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Panel testid="p" onTrigger={onTrigger} />);
        // Do NOT makeVisible → offsetParent stays null.

        const event = pressCtrlF(getByTestId('p-input'));

        expect(onTrigger).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('yields to native find when focus is in the detail pane', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(
            <>
                <Panel testid="p" onTrigger={onTrigger} />
                <div data-pane="detail"><input data-testid="detail-input" /></div>
            </>,
        );
        makeVisible(getByTestId('p') as HTMLElement);

        const event = pressCtrlF(getByTestId('detail-input'));

        expect(onTrigger).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('handles body focus when it claims body focus (default)', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Panel testid="p" onTrigger={onTrigger} />);
        makeVisible(getByTestId('p') as HTMLElement);

        const event = pressCtrlF(document.body);

        expect(onTrigger).toHaveBeenCalledTimes(1);
        expect(event.defaultPrevented).toBe(true);
    });

    it('ignores body focus when it does not claim body focus', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(
            <Panel testid="p" onTrigger={onTrigger} options={{ claimsBodyFocus: false }} />,
        );
        makeVisible(getByTestId('p') as HTMLElement);

        const event = pressCtrlF(document.body);

        expect(onTrigger).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('only the focused panel triggers when two panels are mounted', () => {
        const onA = vi.fn();
        const onB = vi.fn();
        const { getByTestId } = render(
            <>
                <Panel testid="a" onTrigger={onA} />
                <Panel testid="b" onTrigger={onB} />
            </>,
        );
        makeVisible(getByTestId('a') as HTMLElement);
        makeVisible(getByTestId('b') as HTMLElement);

        // Focus in panel B → only B handles; A must not steal it.
        const event = pressCtrlF(getByTestId('b-input'));

        expect(onB).toHaveBeenCalledTimes(1);
        expect(onA).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(true);
    });

    it('the body-default panel wins over a secondary panel on body focus', () => {
        const onPrimary = vi.fn();
        const onSecondary = vi.fn();
        const { getByTestId } = render(
            <>
                <Panel testid="primary" onTrigger={onPrimary} />
                <Panel testid="secondary" onTrigger={onSecondary} options={{ claimsBodyFocus: false }} />
            </>,
        );
        makeVisible(getByTestId('primary') as HTMLElement);
        makeVisible(getByTestId('secondary') as HTMLElement);

        pressCtrlF(document.body);

        expect(onPrimary).toHaveBeenCalledTimes(1);
        expect(onSecondary).not.toHaveBeenCalled();
    });

    it('REGRESSION: two hidden panels never preventDefault Ctrl+F in the detail pane', () => {
        // Emulates TasksPanel + WorkItemSection kept mounted but hidden. With the
        // old unconditional preventDefault this swallowed native find everywhere.
        const onA = vi.fn();
        const onB = vi.fn();
        const { getByTestId } = render(
            <>
                <Panel testid="tasks" onTrigger={onA} />
                <Panel testid="workitems" onTrigger={onB} />
                <div data-pane="detail"><input data-testid="detail-input" /></div>
            </>,
        );
        // Both panels stay hidden (no makeVisible).

        const event = pressCtrlF(getByTestId('detail-input'));

        expect(onA).not.toHaveBeenCalled();
        expect(onB).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('is inert when enabled is false', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(
            <Panel testid="p" onTrigger={onTrigger} options={{ enabled: false }} />,
        );
        makeVisible(getByTestId('p') as HTMLElement);

        const event = pressCtrlF(getByTestId('p-input'));

        expect(onTrigger).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it('ignores non-Ctrl+F keydowns', () => {
        const onTrigger = vi.fn();
        const { getByTestId } = render(<Panel testid="p" onTrigger={onTrigger} />);
        makeVisible(getByTestId('p') as HTMLElement);

        getByTestId('p-input').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true, cancelable: true }),
        );
        getByTestId('p-input').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }),
        );

        expect(onTrigger).not.toHaveBeenCalled();
    });

    it('tags the container with data-find-scope while mounted and cleans it up', () => {
        const { getByTestId, unmount } = render(<Panel testid="p" onTrigger={vi.fn()} />);
        const el = getByTestId('p') as HTMLElement;
        expect(el.hasAttribute('data-find-scope')).toBe(true);

        unmount();
        expect(el.hasAttribute('data-find-scope')).toBe(false);
    });

    it('removes the document keydown listener on unmount', () => {
        const removeSpy = vi.spyOn(document, 'removeEventListener');
        const { unmount } = render(<Panel testid="p" onTrigger={vi.fn()} />);
        unmount();
        expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
});

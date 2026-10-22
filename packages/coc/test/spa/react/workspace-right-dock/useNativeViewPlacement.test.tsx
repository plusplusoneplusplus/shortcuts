// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativeViewPlacement } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/useNativeViewPlacement';
import { BrowserAddressBar } from '../../../../src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserAddressBar';

interface Box { left: number; top: number; width: number; height: number }

const PLACEHOLDER: Box = { left: 500, top: 100, width: 400, height: 400 };
let overlays: Array<{ el: HTMLElement; box: Box }> = [];
let placeholder: HTMLDivElement;
const placement = { setBounds: vi.fn(), hide: vi.fn() };

function toRect({ left, top, width, height }: Box): DOMRect {
    return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect;
}

function contains(box: Box, x: number, y: number): boolean {
    return x >= box.left && x <= box.left + box.width && y >= box.top && y <= box.top + box.height;
}

/** Fake layout: later overlays paint above earlier ones, all paint above the placeholder. */
function elementFromPoint(x: number, y: number): Element | null {
    for (let i = overlays.length - 1; i >= 0; i--) {
        const { el, box } = overlays[i];
        if (el.isConnected && contains(box, x, y)) return el.firstElementChild ?? el;
    }
    return contains(PLACEHOLDER, x, y) ? placeholder : document.body;
}

function addOverlay(box: Box, attrs: Record<string, string> = {}): HTMLElement {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => toRect(box);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.appendChild(document.createElement('button'));
    overlays.push({ el, box });
    document.body.appendChild(el);
    return el;
}

function mount() {
    return renderHook(() => useNativeViewPlacement({ current: placeholder }, true, placement));
}

beforeEach(() => {
    vi.clearAllMocks();
    overlays = [];
    placeholder = document.createElement('div');
    placeholder.getBoundingClientRect = () => toRect(PLACEHOLDER);
    document.body.appendChild(placeholder);
    document.elementFromPoint = elementFromPoint;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => toRect(PLACEHOLDER));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
});

afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('useNativeViewPlacement', () => {
    it.each(['', '   '])('keeps WebView2 visible for blank address %j, hides for suggestions and restores after Escape', async url => {
        const user = userEvent.setup();
        const suggest = vi.fn(async () => ({ ok: true, entries: [{ url: 'https://recent.test/', title: 'Recent',
            lastVisited: 1, visitCount: 1, completion: null }], total: 1, recording: true, storageError: null }));
        mount();
        render(<BrowserAddressBar inputRef={createRef()} url={url} enabled ownerKey="workspace:view" invalid={false}
            onEdit={vi.fn()} onOpen={vi.fn()} history={{
                suggest,
                query: vi.fn(), delete: vi.fn(), clear: vi.fn(), setRecording: vi.fn(), onChanged: vi.fn(() => vi.fn()),
            }} />);
        const input = screen.getByRole('combobox', { name: 'Address' });
        await user.click(input);
        expect(suggest).not.toHaveBeenCalled();
        expect(screen.queryByRole('listbox')).toBeNull();
        expect(placement.hide).not.toHaveBeenCalled();
        expect(placement.setBounds).toHaveBeenLastCalledWith({ x: 500, y: 100, width: 400, height: 400 });
        await user.clear(input);
        await user.type(input, 'recent');
        await screen.findByRole('listbox');
        expect(suggest).toHaveBeenLastCalledWith('recent');
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
        placement.setBounds.mockClear();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox')).toBeNull();
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalledWith({ x: 500, y: 100, width: 400, height: 400 }));
    });

    it('places the view over an uncovered placeholder', () => {
        mount();
        expect(placement.setBounds).toHaveBeenLastCalledWith({ x: 500, y: 100, width: 400, height: 400 });
        expect(placement.hide).not.toHaveBeenCalled();
    });

    // Regression: the workspace clone dropdown (role="menu", not a modal) rendered under the browser.
    it('hides the view while a dropdown hangs over the placeholder and restores it after close', async () => {
        mount();
        const dropdown = addOverlay({ left: 300, top: 60, width: 520, height: 180 }, { role: 'menu', 'data-testid': 'clone-popover' });
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());

        placement.setBounds.mockClear();
        dropdown.remove();
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalledWith({ x: 500, y: 100, width: 400, height: 400 }));
    });

    it('hides for an explicit native-view overlay even between probes and restores after dismissal', async () => {
        mount();
        const menu = addOverlay({ left: 890, top: 100, width: 8, height: 8 }, { role: 'menu', 'data-native-view-overlay': '' });
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
        placement.setBounds.mockClear();
        menu.remove();
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalledWith({ x: 500, y: 100, width: 400, height: 400 }));
    });

    it('hides the view for overlays without any menu or dialog role', async () => {
        mount();
        addOverlay({ left: 0, top: 0, width: 1200, height: 800 });
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
    });

    it.each(['data-native-view-overlay', 'data-testid'])('keeps the view for an unrelated explicit overlay (%s), including edge contact', async attr => {
        mount();
        const box = { left: 100, top: 100, width: 400, height: 100 };
        const overlay = addOverlay(box, { [attr]: attr === 'data-testid' ? 'unified-panel-tab-menu' : '' });
        // Wait for a placement update, rather than assuming the observer has fired.
        placement.setBounds.mockClear();
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalled());
        expect(placement.hide).not.toHaveBeenCalled();
        overlay.remove();
    });

    it('restores when a marked preview becomes hidden or moves out of overlap, then hides again when it returns', async () => {
        mount();
        const box = { left: 890, top: 100, width: 8, height: 8 };
        const preview = addOverlay(box, { 'data-native-view-overlay': '' });
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
        placement.setBounds.mockClear();
        preview.style.visibility = 'hidden';
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalled());
        placement.hide.mockClear();
        preview.style.visibility = 'visible';
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
        placement.setBounds.mockClear();
        box.left = 100;
        preview.style.left = '100px';
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalled());
        placement.hide.mockClear();
        box.left = 890;
        preview.style.left = '890px';
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
    });

    it('tracks explicit overlay registration and removal on an existing node between probes', async () => {
        mount();
        const preview = addOverlay({ left: 890, top: 100, width: 8, height: 8 });
        placement.setBounds.mockClear();
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalled());
        expect(placement.hide).not.toHaveBeenCalled();
        preview.setAttribute('data-native-view-overlay', '');
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
        placement.setBounds.mockClear();
        preview.removeAttribute('data-native-view-overlay');
        await waitFor(() => expect(placement.setBounds).toHaveBeenCalled());
    });

    it('does not restore a previous owner from a stale scheduled frame after replacement or unmount', async () => {
        const frames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
        const ref = { current: placeholder };
        const next = { setBounds: vi.fn(), hide: vi.fn() };
        const view = renderHook(({ owner }) => useNativeViewPlacement(ref, true, owner), { initialProps: { owner: placement } });
        const overlay = addOverlay({ left: 600, top: 100, width: 100, height: 100 });
        await waitFor(() => expect(frames).toHaveLength(1));
        view.rerender({ owner: next });
        overlay.remove();
        placement.setBounds.mockClear();
        act(() => frames[0](0));
        expect(placement.setBounds).not.toHaveBeenCalled();
        await waitFor(() => expect(frames).toHaveLength(2));
        view.unmount();
        next.setBounds.mockClear();
        act(() => frames[1](0));
        expect(next.setBounds).not.toHaveBeenCalled();
    });

    it('keeps the view when an overlay sits outside the placeholder', async () => {
        mount();
        addOverlay({ left: 0, top: 0, width: 300, height: 300 }, { role: 'menu' });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(placement.hide).not.toHaveBeenCalled();
    });

    it('ignores an element touching only the placeholder edge, like a splitter', async () => {
        mount();
        addOverlay({ left: 496, top: 100, width: 8, height: 400 });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(placement.hide).not.toHaveBeenCalled();
    });

    it('keeps the view under overlays marked data-native-view-passthrough', async () => {
        mount();
        addOverlay({ left: 600, top: 400, width: 300, height: 80 }, { 'data-native-view-passthrough': '' });
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(placement.hide).not.toHaveBeenCalled();
    });

    it('hides the view for a modal dialog anywhere on the page', async () => {
        mount();
        addOverlay({ left: 0, top: 0, width: 10, height: 10 }, { role: 'dialog', 'aria-modal': 'true' });
        await waitFor(() => expect(placement.hide).toHaveBeenCalled());
    });

    it('hides the view when not shown and on unmount', () => {
        const { unmount } = mount();
        unmount();
        expect(placement.hide).toHaveBeenCalledTimes(1);

        renderHook(() => useNativeViewPlacement({ current: placeholder }, false, placement));
        expect(placement.hide).toHaveBeenCalledTimes(2);
    });
});

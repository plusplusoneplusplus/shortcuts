import { describe, it, expect } from 'vitest';
import { renderHook, act, render, fireEvent } from '@testing-library/react';
import { createElement, useEffect, useRef, type ReactElement } from 'react';
import { useZoomPan } from '../../../../src/server/spa/client/react/hooks/ui/useZoomPan';

const defaultOptions = { contentWidth: 400, contentHeight: 200 };

/**
 * A real-DOM harness: the wheel listener is attached in an effect to
 * `containerRef.current`, so it only exists when the ref points at a live node
 * (the `renderHook` tests above poke a mock ref and never exercise the wheel).
 * The container holds a bare canvas surface and a `[data-no-drag]` overlay
 * (mirroring toolbar/legend overlays) so we can dispatch wheel events at each.
 */
function ZoomPanHarness(): ReactElement {
    const { containerRef, zoomLabel } = useZoomPan(defaultOptions);
    return createElement(
        'div',
        { ref: containerRef, 'data-testid': 'container' },
        createElement('div', { 'data-testid': 'surface' }),
        createElement(
            'div',
            { 'data-no-drag': true },
            createElement('div', { 'data-testid': 'overlay-content' }),
        ),
        createElement('span', { 'data-testid': 'label' }, zoomLabel),
    );
}

describe('useZoomPan', () => {
    it('initial state is scale=1, translate=(0,0), isDragging=false', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        expect(result.current.state).toEqual({
            scale: 1,
            translateX: 0,
            translateY: 0,
            isDragging: false,
        });
    });

    it('zoomIn increases scale by ZOOM_BTN_STEP (0.25)', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => result.current.zoomIn());
        expect(result.current.state.scale).toBe(1.25);
    });

    it('zoomOut decreases scale by ZOOM_BTN_STEP (0.25)', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => result.current.zoomOut());
        expect(result.current.state.scale).toBe(0.75);
    });

    it('zoomIn is capped at maxZoom (default 3)', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        for (let i = 0; i < 20; i++) {
            act(() => result.current.zoomIn());
        }
        expect(result.current.state.scale).toBe(3);
    });

    it('zoomOut is capped at minZoom (default 0.25)', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        for (let i = 0; i < 20; i++) {
            act(() => result.current.zoomOut());
        }
        expect(result.current.state.scale).toBe(0.25);
    });

    it('respects custom minZoom and maxZoom', () => {
        const { result } = renderHook(() =>
            useZoomPan({ ...defaultOptions, minZoom: 0.5, maxZoom: 2 })
        );
        for (let i = 0; i < 20; i++) {
            act(() => result.current.zoomOut());
        }
        expect(result.current.state.scale).toBe(0.5);

        for (let i = 0; i < 20; i++) {
            act(() => result.current.zoomIn());
        }
        expect(result.current.state.scale).toBe(2);
    });

    it('reset returns to scale=1, translate=(0,0)', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => result.current.zoomIn());
        act(() => result.current.zoomIn());
        expect(result.current.state.scale).not.toBe(1);

        act(() => result.current.reset());
        expect(result.current.state).toEqual({
            scale: 1,
            translateX: 0,
            translateY: 0,
            isDragging: false,
        });
    });

    it('svgTransform has correct format', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        expect(result.current.svgTransform).toBe('translate(0, 0) scale(1)');
    });

    it('svgTransform updates after zoomIn', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => result.current.zoomIn());
        expect(result.current.svgTransform).toBe('translate(0, 0) scale(1.25)');
    });

    it('zoomLabel is correct percentage string', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        expect(result.current.zoomLabel).toBe('100%');
    });

    it('zoomLabel updates after zoom', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => result.current.zoomIn());
        expect(result.current.zoomLabel).toBe('125%');
        act(() => result.current.zoomOut());
        act(() => result.current.zoomOut());
        expect(result.current.zoomLabel).toBe('75%');
    });

    it('fitToView does nothing when contentWidth is 0', () => {
        const { result } = renderHook(() =>
            useZoomPan({ contentWidth: 0, contentHeight: 200 })
        );
        act(() => result.current.fitToView());
        // Should stay at initial state since contentWidth is 0
        expect(result.current.state.scale).toBe(1);
    });

    it('fitToView does nothing when contentHeight is 0', () => {
        const { result } = renderHook(() =>
            useZoomPan({ contentWidth: 400, contentHeight: 0 })
        );
        act(() => result.current.fitToView());
        expect(result.current.state.scale).toBe(1);
    });

    it('containerRef is defined', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        expect(result.current.containerRef).toBeDefined();
        expect(result.current.containerRef.current).toBeNull();
    });

    it('multiple zoomIn/zoomOut cycles return to original scale', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => result.current.zoomIn());
        act(() => result.current.zoomIn());
        act(() => result.current.zoomOut());
        act(() => result.current.zoomOut());
        expect(result.current.state.scale).toBe(1);
    });

    it('centerContent centers content at 100% using the container rect', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions)); // content 400x200
        act(() => {
            (result.current.containerRef as { current: unknown }).current = {
                getBoundingClientRect: () => ({ width: 800, height: 600 }),
            };
            result.current.centerContent(1);
        });
        expect(result.current.state.scale).toBe(1);
        expect(result.current.state.translateX).toBe(200); // (800 - 400) / 2
        expect(result.current.state.translateY).toBe(200); // (600 - 200) / 2
    });

    it('centerContent no-ops when there is no container', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => result.current.centerContent(1));
        expect(result.current.state).toEqual({ scale: 1, translateX: 0, translateY: 0, isDragging: false });
    });

    it('centerContent clamps the scale to the configured bounds', () => {
        const { result } = renderHook(() => useZoomPan({ ...defaultOptions, maxZoom: 2 }));
        act(() => {
            (result.current.containerRef as { current: unknown }).current = {
                getBoundingClientRect: () => ({ width: 800, height: 600 }),
            };
            result.current.centerContent(5); // above maxZoom
        });
        expect(result.current.state.scale).toBe(2);
    });

    it('zoomTo zooms about the viewport center, keeping that point fixed', () => {
        const { result } = renderHook(() => useZoomPan(defaultOptions));
        act(() => {
            (result.current.containerRef as { current: unknown }).current = {
                getBoundingClientRect: () => ({ width: 800, height: 600 }),
            };
            result.current.zoomTo(2);
        });
        expect(result.current.state.scale).toBe(2);
        // center (400,300) under world point (400,300); tx = 400 - 400*2, ty = 300 - 300*2
        expect(result.current.state.translateX).toBe(-400);
        expect(result.current.state.translateY).toBe(-300);
    });

    it('zoomTo clamps the scale and works without a container', () => {
        const { result } = renderHook(() => useZoomPan({ ...defaultOptions, maxZoom: 2 }));
        act(() => result.current.zoomTo(5));
        expect(result.current.state.scale).toBe(2);
        expect(result.current.state.translateX).toBe(0);
    });
});

describe('useZoomPan wheel handling', () => {
    it('zooms when the wheel fires over the canvas surface', () => {
        const { getByTestId } = render(createElement(ZoomPanHarness));
        // deltaY < 0 → zoom in by one ZOOM_STEP (0.15) → 115%.
        const prevented = fireEvent.wheel(getByTestId('surface'), { deltaY: -100, clientX: 10, clientY: 10 });
        expect(getByTestId('label').textContent).toBe('115%');
        // The handler called preventDefault, so the page/canvas doesn't scroll.
        expect(prevented).toBe(false);
    });

    it('does NOT zoom when the wheel fires inside a [data-no-drag] overlay', () => {
        // Regression: scrolling inside an overlay must scroll the overlay, not
        // zoom the canvas underneath it.
        const { getByTestId } = render(createElement(ZoomPanHarness));
        const notPrevented = fireEvent.wheel(getByTestId('overlay-content'), { deltaY: -100, clientX: 10, clientY: 10 });
        expect(getByTestId('label').textContent).toBe('100%');
        // Not prevented → the browser performs its native scroll of the overlay.
        expect(notPrevented).toBe(true);
    });
});

/**
 * Mirrors the SVG canvas: the content lives in a shadow root, so `event.target`
 * is retargeted to the host and only `composedPath()` sees the real node.
 */
function ShadowHarness({ selectableSelector }: { selectableSelector?: string }): ReactElement {
    const { containerRef, state, zoomLabel } = useZoomPan({ ...defaultOptions, selectableSelector });
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = hostRef.current;
        if (!host || host.shadowRoot) return;
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg">
                <rect id="bg" width="100" height="100"></rect>
                <text id="label">Repo selector</text>
            </svg>
            <div data-no-drag><span id="overlay">toolbar</span></div>
        `;
    }, []);

    return createElement(
        'div',
        { ref: containerRef, 'data-testid': 'container' },
        createElement('div', { ref: hostRef, 'data-testid': 'host' }),
        createElement('span', { 'data-testid': 'label' }, zoomLabel),
        createElement('span', { 'data-testid': 'tx' }, String(state.translateX)),
    );
}

function shadowNode(host: HTMLElement, id: string): Element {
    const node = host.shadowRoot?.getElementById(id);
    if (!node) throw new Error(`missing shadow node #${id}`);
    return node;
}

describe('useZoomPan text selection inside a shadow root', () => {
    it('does NOT pan when a drag starts on selectable text, leaving the native selection alone', () => {
        const { getByTestId } = render(createElement(ShadowHarness, { selectableSelector: 'text, tspan' }));
        const text = shadowNode(getByTestId('host'), 'label');

        const notPrevented = fireEvent.mouseDown(text, { button: 0, clientX: 10, clientY: 10, composed: true });
        fireEvent.mouseMove(document, { clientX: 60, clientY: 40 });
        fireEvent.mouseUp(document);

        // Not prevented → the browser runs its own text-selection drag.
        expect(notPrevented).toBe(true);
        expect(getByTestId('tx').textContent).toBe('0');
    });

    it('still pans when the drag starts on non-text content inside the shadow root', () => {
        const { getByTestId } = render(createElement(ShadowHarness, { selectableSelector: 'text, tspan' }));
        const bg = shadowNode(getByTestId('host'), 'bg');

        fireEvent.mouseDown(bg, { button: 0, clientX: 10, clientY: 10, composed: true });
        fireEvent.mouseMove(document, { clientX: 60, clientY: 40 });
        fireEvent.mouseUp(document);

        expect(getByTestId('tx').textContent).toBe('50');
    });

    it('pans from text when no selectableSelector is configured (DAG/agent canvases)', () => {
        const { getByTestId } = render(createElement(ShadowHarness, {}));
        const text = shadowNode(getByTestId('host'), 'label');

        fireEvent.mouseDown(text, { button: 0, clientX: 10, clientY: 10, composed: true });
        fireEvent.mouseMove(document, { clientX: 60, clientY: 40 });
        fireEvent.mouseUp(document);

        expect(getByTestId('tx').textContent).toBe('50');
    });

    it('honors a [data-no-drag] overlay nested in the shadow root', () => {
        const { getByTestId } = render(createElement(ShadowHarness, {}));
        const overlay = shadowNode(getByTestId('host'), 'overlay');

        const notPrevented = fireEvent.wheel(overlay, { deltaY: -100, clientX: 10, clientY: 10, composed: true });

        expect(notPrevented).toBe(true);
        expect(getByTestId('label').textContent).toBe('100%');
    });
});

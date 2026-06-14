import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useZoomPan } from '../../../../src/server/spa/client/react/hooks/ui/useZoomPan';

const defaultOptions = { contentWidth: 400, contentHeight: 200 };

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

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useZoomPan } from '../../../../src/server/spa/client/react/hooks/useZoomPan';

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
});

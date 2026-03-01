import { describe, it, expect, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBreakpoint } from '../../../../src/server/spa/client/react/hooks/useBreakpoint';
import { mockViewport } from '../../helpers/viewport-mock';

describe('useBreakpoint', () => {
    let cleanup: (() => void) | undefined;

    afterEach(() => {
        cleanup?.();
        cleanup = undefined;
    });

    it('returns isMobile=true for viewport width 375px', () => {
        cleanup = mockViewport(375);
        const { result } = renderHook(() => useBreakpoint());
        expect(result.current).toEqual({
            isMobile: true,
            isTablet: false,
            isDesktop: false,
            breakpoint: 'mobile',
        });
    });

    it('returns isTablet=true for viewport width 768px', () => {
        cleanup = mockViewport(768);
        const { result } = renderHook(() => useBreakpoint());
        expect(result.current).toEqual({
            isMobile: false,
            isTablet: true,
            isDesktop: false,
            breakpoint: 'tablet',
        });
    });

    it('returns isDesktop=true for viewport width 1280px', () => {
        cleanup = mockViewport(1280);
        const { result } = renderHook(() => useBreakpoint());
        expect(result.current).toEqual({
            isMobile: false,
            isTablet: false,
            isDesktop: true,
            breakpoint: 'desktop',
        });
    });

    it('returns isDesktop=true at exact boundary 1024px', () => {
        cleanup = mockViewport(1024);
        const { result } = renderHook(() => useBreakpoint());
        expect(result.current.isDesktop).toBe(true);
        expect(result.current.breakpoint).toBe('desktop');
    });

    it('returns isMobile=true at 767px (just below tablet)', () => {
        cleanup = mockViewport(767);
        const { result } = renderHook(() => useBreakpoint());
        expect(result.current.isMobile).toBe(true);
        expect(result.current.breakpoint).toBe('mobile');
    });

    it('cleans up matchMedia listeners on unmount', () => {
        cleanup = mockViewport(375);

        const removeListenerCalls: string[] = [];
        const originalMM = window.matchMedia;
        window.matchMedia = (query: string): MediaQueryList => {
            const mql = originalMM(query);
            const origRemove = mql.removeEventListener.bind(mql);
            mql.removeEventListener = (event: string, fn: any) => {
                removeListenerCalls.push(event);
                origRemove(event, fn);
            };
            return mql;
        };

        const { unmount } = renderHook(() => useBreakpoint());
        unmount();

        expect(removeListenerCalls.filter(e => e === 'change')).toHaveLength(2);
    });

    it('defaults to desktop when window.matchMedia is undefined', () => {
        const original = window.matchMedia;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).matchMedia = undefined;

        const { result } = renderHook(() => useBreakpoint());
        expect(result.current).toEqual({
            isMobile: false,
            isTablet: false,
            isDesktop: true,
            breakpoint: 'desktop',
        });

        window.matchMedia = original;
    });
});

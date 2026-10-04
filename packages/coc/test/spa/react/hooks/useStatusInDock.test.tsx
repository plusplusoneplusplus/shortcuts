/**
 * useStatusInDock — true only on desktop, the single
 * gate every host of the docked status cluster shares.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let mockIsMobile = false;

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({
        breakpoint: mockIsMobile ? 'mobile' : 'desktop',
        isMobile: mockIsMobile,
        isTablet: false,
        isDesktop: !mockIsMobile,
    }),
}));

import { useStatusInDock } from '../../../../src/server/spa/client/react/hooks/ui/useStatusInDock';

beforeEach(() => {
    mockIsMobile = false;
});

describe('useStatusInDock', () => {
    it('is true on desktop', () => {
        const { result } = renderHook(() => useStatusInDock());
        expect(result.current).toBe(true);
    });

    it('is false on mobile (no room for a docked cluster)', () => {
        mockIsMobile = true;
        const { result } = renderHook(() => useStatusInDock());
        expect(result.current).toBe(false);
    });

});

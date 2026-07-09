/**
 * useStatusInDock — true only in the remote-first shell on desktop, the single
 * gate every host of the docked status cluster shares.
 *
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

let mockRemoteShell = true;
let mockIsMobile = false;

vi.mock('../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled', () => ({
    useRemoteShellEnabled: () => mockRemoteShell,
}));
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
    mockRemoteShell = true;
    mockIsMobile = false;
});

describe('useStatusInDock', () => {
    it('is true in the remote-first shell on desktop', () => {
        const { result } = renderHook(() => useStatusInDock());
        expect(result.current).toBe(true);
    });

    it('is false when the remote shell is off (classic mode keeps the topbar cluster)', () => {
        mockRemoteShell = false;
        const { result } = renderHook(() => useStatusInDock());
        expect(result.current).toBe(false);
    });

    it('is false on mobile (no room for a docked cluster)', () => {
        mockIsMobile = true;
        const { result } = renderHook(() => useStatusInDock());
        expect(result.current).toBe(false);
    });

    it('is false when both are off', () => {
        mockRemoteShell = false;
        mockIsMobile = true;
        const { result } = renderHook(() => useStatusInDock());
        expect(result.current).toBe(false);
    });
});

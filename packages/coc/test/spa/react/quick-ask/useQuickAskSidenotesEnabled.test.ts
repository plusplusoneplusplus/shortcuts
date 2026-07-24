/**
 * useQuickAskSidenotesEnabled / isQuickAskSidenotesEnabled — tests for the live
 * admin `features.quickAskSidenotes` flag read path.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isQuickAskSidenotesEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { useQuickAskSidenotesEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useQuickAskSidenotesEnabled';

describe('Quick Ask side-notes feature flag', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ quickAskSidenotesEnabled: false });
    });

    it('reads a disabled flag as off', () => {
        expect(isQuickAskSidenotesEnabled()).toBe(false);
    });

    it('isQuickAskSidenotesEnabled reflects the runtime flag', () => {
        applyRuntimeConfigPatch({ quickAskSidenotesEnabled: true });
        expect(isQuickAskSidenotesEnabled()).toBe(true);
        applyRuntimeConfigPatch({ quickAskSidenotesEnabled: false });
        expect(isQuickAskSidenotesEnabled()).toBe(false);
    });

    it('useQuickAskSidenotesEnabled reads the flag and reacts to runtime config updates', () => {
        const { result } = renderHook(() => useQuickAskSidenotesEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ quickAskSidenotesEnabled: true }); });
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ quickAskSidenotesEnabled: false }); });
        expect(result.current).toBe(false);
    });
});

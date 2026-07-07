/**
 * useSchedulesInScheduledSlideEnabled / isSchedulesInScheduledSlideEnabled —
 * tests for the global admin `features.schedulesInScheduledSlide` flag read path.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyRuntimeConfigPatch, isSchedulesInScheduledSlideEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { renderHook, act } from '@testing-library/react';
import { useSchedulesInScheduledSlideEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useSchedulesInScheduledSlideEnabled';

describe('schedules in Scheduled slide feature flag', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ schedulesInScheduledSlideEnabled: false });
    });

    it('reads a disabled flag as off (default OFF)', () => {
        expect(isSchedulesInScheduledSlideEnabled()).toBe(false);
    });

    it('isSchedulesInScheduledSlideEnabled reflects the runtime flag', () => {
        applyRuntimeConfigPatch({ schedulesInScheduledSlideEnabled: true });
        expect(isSchedulesInScheduledSlideEnabled()).toBe(true);
        applyRuntimeConfigPatch({ schedulesInScheduledSlideEnabled: false });
        expect(isSchedulesInScheduledSlideEnabled()).toBe(false);
    });

    it('useSchedulesInScheduledSlideEnabled reads the flag and reacts to runtime config updates', () => {
        const { result } = renderHook(() => useSchedulesInScheduledSlideEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ schedulesInScheduledSlideEnabled: true }); });
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ schedulesInScheduledSlideEnabled: false }); });
        expect(result.current).toBe(false);
    });
});

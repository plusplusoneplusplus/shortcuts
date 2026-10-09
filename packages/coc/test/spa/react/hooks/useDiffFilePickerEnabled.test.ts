/**
 * useDiffFilePickerEnabled / isDiffFilePickerEnabled — the live admin
 * `features.diffFilePicker` read path. On by default: absent reads as on,
 * only an explicit false turns it off.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isDiffFilePickerEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { useDiffFilePickerEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useDiffFilePickerEnabled';

describe('diff file picker feature flag', () => {
    afterEach(() => { applyRuntimeConfigPatch({ diffFilePickerEnabled: true }); });

    // Runs first, before any patch writes the flag.
    it('defaults to true when the flag is absent from config', () => {
        expect(isDiffFilePickerEnabled()).toBe(true);
        expect(renderHook(() => useDiffFilePickerEnabled()).result.current).toBe(true);
    });

    it('respects an explicit false', () => {
        applyRuntimeConfigPatch({ diffFilePickerEnabled: false });
        expect(isDiffFilePickerEnabled()).toBe(false);
    });

    it('reacts to runtime config updates', () => {
        const { result } = renderHook(() => useDiffFilePickerEnabled());
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ diffFilePickerEnabled: false }); });
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ diffFilePickerEnabled: true }); });
        expect(result.current).toBe(true);
    });
});

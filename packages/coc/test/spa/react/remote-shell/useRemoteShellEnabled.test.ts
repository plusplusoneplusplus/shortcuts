/**
 * useRemoteShellEnabled / isRemoteShellEnabled — tests for the global admin
 * `features.remoteShell` flag read path.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isRemoteShellEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { useRemoteShellEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useRemoteShellEnabled';

describe('remote-first shell feature flag', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ remoteShellEnabled: false });
    });

    it('reads a disabled flag as off', () => {
        expect(isRemoteShellEnabled()).toBe(false);
    });

    it('isRemoteShellEnabled reflects the runtime flag', () => {
        applyRuntimeConfigPatch({ remoteShellEnabled: true });
        expect(isRemoteShellEnabled()).toBe(true);
        applyRuntimeConfigPatch({ remoteShellEnabled: false });
        expect(isRemoteShellEnabled()).toBe(false);
    });

    it('useRemoteShellEnabled reads the flag and reacts to runtime config updates', () => {
        const { result } = renderHook(() => useRemoteShellEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ remoteShellEnabled: true }); });
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ remoteShellEnabled: false }); });
        expect(result.current).toBe(false);
    });
});

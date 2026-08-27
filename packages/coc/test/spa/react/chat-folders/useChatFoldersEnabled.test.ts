/**
 * useChatFoldersEnabled / isChatFoldersEnabled — tests for the global admin
 * `features.chatFolders` flag read path (AC-03).
 *
 * The flag gates the folder UI only; the REST routes and the schema migration
 * ship regardless, so it must default to off and must track live config
 * updates without a reload.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isChatFoldersEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { useChatFoldersEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useChatFoldersEnabled';

describe('chat folders feature flag', () => {
    // Runs first, before any patch below writes the flag: an absent
    // `chatFoldersEnabled` must read as off, not as undefined-is-truthy.
    it('defaults to false when the flag is absent from config', () => {
        expect(isChatFoldersEnabled()).toBe(false);
        const { result } = renderHook(() => useChatFoldersEnabled());
        expect(result.current).toBe(false);
    });

    it('isChatFoldersEnabled reflects the runtime flag', () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
        expect(isChatFoldersEnabled()).toBe(true);
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
        expect(isChatFoldersEnabled()).toBe(false);
    });

    it('reads a non-boolean flag value as off', () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: 'yes' as unknown as boolean });
        expect(isChatFoldersEnabled()).toBe(false);
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
    });

    it('useChatFoldersEnabled reads the flag and reacts to runtime config updates', () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
        const { result } = renderHook(() => useChatFoldersEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ chatFoldersEnabled: true }); });
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ chatFoldersEnabled: false }); });
        expect(result.current).toBe(false);
    });

    it('stops tracking config updates after unmount', () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
        const { result, unmount } = renderHook(() => useChatFoldersEnabled());
        unmount();
        act(() => { applyRuntimeConfigPatch({ chatFoldersEnabled: true }); });
        expect(result.current).toBe(false);
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
    });
});

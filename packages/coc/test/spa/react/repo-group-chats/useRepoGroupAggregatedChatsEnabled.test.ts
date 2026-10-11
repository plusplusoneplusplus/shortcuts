/**
 * useRepoGroupAggregatedChatsEnabled / isRepoGroupAggregatedChatsEnabled —
 * read path of the default-off `features.repoGroupAggregatedChats` flag.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isRepoGroupAggregatedChatsEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { useRepoGroupAggregatedChatsEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useRepoGroupAggregatedChatsEnabled';

describe('repo-group aggregated chats feature flag', () => {
    it('defaults to false when the flag is absent from config', () => {
        expect(isRepoGroupAggregatedChatsEnabled()).toBe(false);
        const { result } = renderHook(() => useRepoGroupAggregatedChatsEnabled());
        expect(result.current).toBe(false);
    });

    it('reads a non-boolean flag value as off', () => {
        applyRuntimeConfigPatch({ repoGroupAggregatedChatsEnabled: 'yes' as unknown as boolean });
        expect(isRepoGroupAggregatedChatsEnabled()).toBe(false);
        applyRuntimeConfigPatch({ repoGroupAggregatedChatsEnabled: false });
    });

    it('tracks live runtime config updates until unmount', () => {
        const { result, unmount } = renderHook(() => useRepoGroupAggregatedChatsEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ repoGroupAggregatedChatsEnabled: true }); });
        expect(result.current).toBe(true);
        unmount();
        act(() => { applyRuntimeConfigPatch({ repoGroupAggregatedChatsEnabled: false }); });
        expect(result.current).toBe(true);
    });
});

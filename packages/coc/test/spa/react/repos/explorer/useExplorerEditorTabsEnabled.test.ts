/**
 * useExplorerEditorTabsEnabled / isExplorerEditorTabsEnabled — tests for the
 * global admin `features.explorerEditorTabs` flag read path.
 *
 * The multi-tab Explorer editor ships behind a runtime flag that is on by
 * default; only an explicit `false` keeps the single replaceable preview pane.
 * The flag gates UI only, so it also has to track live config updates without
 * a page reload.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isExplorerEditorTabsEnabled } from '../../../../../src/server/spa/client/react/utils/config';
import { useExplorerEditorTabsEnabled } from '../../../../../src/server/spa/client/react/hooks/feature-flags/useExplorerEditorTabsEnabled';

describe('explorer editor tabs feature flag', () => {
    // Runs first, before any patch below writes the flag: an absent
    // `explorerEditorTabsEnabled` (partial or older runtime config) reads as on.
    it('defaults to true when the flag is absent from config', () => {
        expect(isExplorerEditorTabsEnabled()).toBe(true);
        const { result } = renderHook(() => useExplorerEditorTabsEnabled());
        expect(result.current).toBe(true);
    });

    it('isExplorerEditorTabsEnabled reflects the runtime flag', () => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true });
        expect(isExplorerEditorTabsEnabled()).toBe(true);
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
        expect(isExplorerEditorTabsEnabled()).toBe(false);
    });

    it('reads only an explicit false as off', () => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: 'yes' as unknown as boolean });
        expect(isExplorerEditorTabsEnabled()).toBe(true);
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
    });

    it('useExplorerEditorTabsEnabled reads the flag and reacts to runtime config updates', () => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
        const { result } = renderHook(() => useExplorerEditorTabsEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true }); });
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false }); });
        expect(result.current).toBe(false);
    });

    it('stops tracking config updates after unmount', () => {
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
        const { result, unmount } = renderHook(() => useExplorerEditorTabsEnabled());
        unmount();
        act(() => { applyRuntimeConfigPatch({ explorerEditorTabsEnabled: true }); });
        expect(result.current).toBe(false);
        applyRuntimeConfigPatch({ explorerEditorTabsEnabled: false });
    });
});

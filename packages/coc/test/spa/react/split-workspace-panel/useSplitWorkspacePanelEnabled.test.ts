/**
 * useSplitWorkspacePanelEnabled / isSplitWorkspacePanelEnabled — tests for the
 * global admin `features.splitWorkspacePanel` flag read path.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isSplitWorkspacePanelEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { useSplitWorkspacePanelEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useSplitWorkspacePanelEnabled';

describe('split Workspace panel feature flag', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ splitWorkspacePanelEnabled: false });
    });

    it('reads a disabled flag as off', () => {
        expect(isSplitWorkspacePanelEnabled()).toBe(false);
    });

    it('isSplitWorkspacePanelEnabled reflects the runtime flag', () => {
        applyRuntimeConfigPatch({ splitWorkspacePanelEnabled: true });
        expect(isSplitWorkspacePanelEnabled()).toBe(true);
        applyRuntimeConfigPatch({ splitWorkspacePanelEnabled: false });
        expect(isSplitWorkspacePanelEnabled()).toBe(false);
    });

    it('useSplitWorkspacePanelEnabled reads the flag and reacts to runtime config updates', () => {
        const { result } = renderHook(() => useSplitWorkspacePanelEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ splitWorkspacePanelEnabled: true }); });
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ splitWorkspacePanelEnabled: false }); });
        expect(result.current).toBe(false);
    });
});

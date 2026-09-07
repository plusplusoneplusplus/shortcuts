/**
 * useUnifiedRightPanelEnabled / isUnifiedRightPanelEnabled — tests for the
 * global admin `features.unifiedRightPanel` flag read path, which gates the
 * unified Cursor-style resource-tabbed right panel.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { applyRuntimeConfigPatch, isUnifiedRightPanelEnabled } from '../../../../src/server/spa/client/react/utils/config';
import { useUnifiedRightPanelEnabled } from '../../../../src/server/spa/client/react/hooks/feature-flags/useUnifiedRightPanelEnabled';
import { ADMIN_SETTING_DEFINITIONS } from '../../../../src/config/admin-setting-definitions';
import { DEFAULT_CONFIG } from '../../../../src/config';

describe('unified right panel feature flag', () => {
    beforeEach(() => {
        applyRuntimeConfigPatch({ unifiedRightPanelEnabled: undefined });
    });

    it('defaults to off when the runtime config says nothing', () => {
        expect(isUnifiedRightPanelEnabled()).toBe(false);
    });

    it('ships disabled by default in the admin registry and DEFAULT_CONFIG', () => {
        const def = ADMIN_SETTING_DEFINITIONS.find(d => d.key === 'features.unifiedRightPanel');
        expect(def).toBeDefined();
        expect(def?.default).toBe(false);
        expect(def?.runtimeFlag).toBe('unifiedRightPanelEnabled');
        expect(DEFAULT_CONFIG.features.unifiedRightPanel).toBe(false);
    });

    it('isUnifiedRightPanelEnabled reflects the runtime flag', () => {
        applyRuntimeConfigPatch({ unifiedRightPanelEnabled: true });
        expect(isUnifiedRightPanelEnabled()).toBe(true);
        applyRuntimeConfigPatch({ unifiedRightPanelEnabled: false });
        expect(isUnifiedRightPanelEnabled()).toBe(false);
    });

    it('useUnifiedRightPanelEnabled reads the flag and reacts to runtime config updates', () => {
        const { result } = renderHook(() => useUnifiedRightPanelEnabled());
        expect(result.current).toBe(false);
        act(() => { applyRuntimeConfigPatch({ unifiedRightPanelEnabled: true }); });
        expect(result.current).toBe(true);
        act(() => { applyRuntimeConfigPatch({ unifiedRightPanelEnabled: false }); });
        expect(result.current).toBe(false);
    });
});

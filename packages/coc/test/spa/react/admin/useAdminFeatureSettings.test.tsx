// @vitest-environment jsdom
/**
 * Focused controller tests for `useAdminFeatureSettings` — the Workspace
 * Features card logic. Covers hydrate/dirty tracking, save (payload +
 * runtime-config patch + display-settings invalidation), cancel, the
 * Ctrl/Cmd+S save shortcut gating, and the search reset on tab leave.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { updateConfig, applyRuntimeConfigPatch, invalidateDisplaySettings } = vi.hoisted(() => ({
    updateConfig: vi.fn(),
    applyRuntimeConfigPatch: vi.fn(),
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ admin: { updateConfig } }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    invalidateDisplaySettings,
}));
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    applyRuntimeConfigPatch,
}));

import {
    useAdminFeatureSettings,
    FEATURES_CARD_SETTINGS,
    readFeatureValues,
    readRuntimeFeatureValues,
} from '../../../../src/server/spa/client/react/admin/useAdminFeatureSettings';

// A boolean-valued feature key to flip in the tests.
const boolDef = FEATURES_CARD_SETTINGS.find(d => d.ui?.control?.type !== 'select')!;

function renderController(overrides: Partial<Parameters<typeof useAdminFeatureSettings>[0]> = {}) {
    const addToast = vi.fn();
    const view = renderHook(
        (props: Parameters<typeof useAdminFeatureSettings>[0]) => useAdminFeatureSettings(props),
        { initialProps: { addToast, searchActive: true, shortcutActive: true, ...overrides } },
    );
    return { view, addToast };
}

beforeEach(() => {
    updateConfig.mockReset();
    updateConfig.mockResolvedValue({});
    applyRuntimeConfigPatch.mockClear();
    invalidateDisplaySettings.mockClear();
});

describe('useAdminFeatureSettings', () => {
    it('is not dirty after hydrate and becomes dirty on edit', () => {
        const { view } = renderController();
        act(() => view.result.current.hydrate({}));
        expect(view.result.current.featuresDirty).toBe(false);

        const current = view.result.current.featureValues[boolDef.key] === true;
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, [boolDef.key]: !current })));
        expect(view.result.current.featuresDirty).toBe(true);
    });

    it('save posts the feature payload, patches runtime config, invalidates display settings, and clears dirty', async () => {
        const { view } = renderController();
        act(() => view.result.current.hydrate({}));
        const current = view.result.current.featureValues[boolDef.key] === true;
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, [boolDef.key]: !current })));

        await act(async () => { await view.result.current.handleSaveFeatures(); });

        expect(updateConfig).toHaveBeenCalledTimes(1);
        const payload = updateConfig.mock.calls[0][0];
        expect(payload[boolDef.key]).toBe(!current);
        // Only registry keys appear in the payload.
        for (const key of Object.keys(payload)) {
            expect(FEATURES_CARD_SETTINGS.some(d => d.key === key)).toBe(true);
        }
        expect(invalidateDisplaySettings).toHaveBeenCalledTimes(1);
        expect(applyRuntimeConfigPatch).toHaveBeenCalledTimes(1);
        expect(applyRuntimeConfigPatch.mock.calls[0][0]).toEqual(
            readRuntimeFeatureValues(view.result.current.featureValues),
        );
        expect(view.result.current.featuresDirty).toBe(false);
    });

    it('cancel reverts edits back to the last snapshot', () => {
        const { view } = renderController();
        act(() => view.result.current.hydrate({}));
        const original = view.result.current.featureValues[boolDef.key];
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, [boolDef.key]: !original })));
        act(() => view.result.current.handleCancelFeatures());
        expect(view.result.current.featureValues[boolDef.key]).toBe(original);
        expect(view.result.current.featuresDirty).toBe(false);
    });

    it('Ctrl/Cmd+S saves when the shortcut is active and the card is dirty', () => {
        const { view } = renderController({ shortcutActive: true });
        act(() => view.result.current.hydrate({}));
        const current = view.result.current.featureValues[boolDef.key] === true;
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, [boolDef.key]: !current })));

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
        });
        expect(updateConfig).toHaveBeenCalledTimes(1);
    });

    it('Ctrl/Cmd+S is ignored when the shortcut is inactive', () => {
        const { view } = renderController({ shortcutActive: false });
        act(() => view.result.current.hydrate({}));
        const current = view.result.current.featureValues[boolDef.key] === true;
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, [boolDef.key]: !current })));

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
        });
        expect(updateConfig).not.toHaveBeenCalled();
    });

    it('clears the search string when the Features sub-tab is left', () => {
        const addToast = vi.fn();
        const { view } = renderController({ addToast, searchActive: true });
        act(() => view.result.current.setFeatureSearch('loops'));
        expect(view.result.current.featureSearch).toBe('loops');
        act(() => view.rerender({ addToast, searchActive: false, shortcutActive: false }));
        expect(view.result.current.featureSearch).toBe('');
    });
});

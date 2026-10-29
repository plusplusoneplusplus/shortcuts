// @vitest-environment jsdom
/**
 * Focused controller tests for `useAdminFeatureSettings` — the Workspace
 * Features card logic. Covers hydrate/dirty tracking, save (payload +
 * runtime-config patch + display-settings invalidation), cancel, and the
 * search reset on tab leave.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { updateConfig, applyRuntimeConfigPatch, invalidateDisplaySettings, listWorkspaces, listSkills, workspaceConfig, globalConfig } = vi.hoisted(() => ({
    updateConfig: vi.fn(),
    applyRuntimeConfigPatch: vi.fn(),
    invalidateDisplaySettings: vi.fn(),
    listWorkspaces: vi.fn(),
    listSkills: vi.fn(),
    workspaceConfig: vi.fn(),
    globalConfig: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        admin: { updateConfig }, workspaces: { list: listWorkspaces },
        skills: { listWorkspace: listSkills, getWorkspaceConfig: workspaceConfig, getGlobalConfig: globalConfig },
    }),
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
        { initialProps: { addToast, searchActive: true, ...overrides } },
    );
    return { view, addToast };
}

beforeEach(() => {
    updateConfig.mockReset();
    updateConfig.mockResolvedValue({});
    applyRuntimeConfigPatch.mockClear();
    invalidateDisplaySettings.mockClear();
    listWorkspaces.mockReset().mockResolvedValue({ workspaces: [{ id: 'alpha', rootPath: 'fixture-root' }] });
    listSkills.mockReset().mockResolvedValue([{ name: 'dispatcher' }]);
    workspaceConfig.mockReset().mockResolvedValue({ disabledSkills: [] });
    globalConfig.mockReset().mockResolvedValue({ globalDisabledSkills: [] });
});

describe('useAdminFeatureSettings', () => {
    it('defaults canvas extensions off and saves the explicit opt-in on Features', async () => {
        const definition = FEATURES_CARD_SETTINGS.find(d => d.key === 'canvasExtensions.enabled');
        expect(definition?.ui?.hint).toContain('run code shipped in any opened repo');
        const { view } = renderController();
        act(() => view.result.current.hydrate({}));
        expect(view.result.current.featureValues['canvasExtensions.enabled']).toBe(false);
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, 'canvasExtensions.enabled': true })));
        expect(view.result.current.isTabDirty('features')).toBe(true);
        await act(async () => { await view.result.current.handleSaveTab('features'); });
        expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ 'canvasExtensions.enabled': true }));
        expect(view.result.current.isTabDirty('features')).toBe(false);
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, 'canvasExtensions.enabled': false })));
        act(() => view.result.current.handleCancelTab('features'));
        expect(view.result.current.featureValues['canvasExtensions.enabled']).toBe(true);
    });

    it.each(['tab', 'all'])('preserves an invalid compliance draft and displays a validation error on %s save', async scope => {
        const { view, addToast } = renderController();
        act(() => view.result.current.setFeatureValues(prev => ({
            ...prev, 'features.teamsOutboundCompliance': true, 'teamsOutboundCompliance.prompt': ' \n',
        })));
        await act(async () => {
            if (scope === 'tab') await view.result.current.handleSaveTab('teams');
            else await view.result.current.handleSaveFeatures();
        });
        expect(updateConfig).not.toHaveBeenCalled();
        expect(addToast).toHaveBeenCalledWith('Save failed', 'error');
        expect(view.result.current.featureValues['teamsOutboundCompliance.prompt']).toBe(' \n');
        expect(view.result.current.isTabDirty('teams')).toBe(true);
        expect(view.result.current.savingTab).toBeNull();
        expect(view.result.current.featuresSaving).toBe(false);
    });

    it('keeps a valid compliance draft after server save failure, then saves and cancels through the Teams controls', async () => {
        const { view, addToast } = renderController();
        act(() => view.result.current.setFeatureValues(prev => ({
            ...prev, 'features.teamsOutboundCompliance': true, 'teamsOutboundCompliance.prompt': 'Allow public text.',
        })));
        updateConfig.mockRejectedValueOnce(new Error('Policy save unavailable'));
        await act(async () => { await view.result.current.handleSaveTab('teams'); });
        expect(addToast).toHaveBeenCalledWith('Save failed', 'error');
        expect(view.result.current.isTabDirty('teams')).toBe(true);
        expect(view.result.current.featureValues['teamsOutboundCompliance.prompt']).toBe('Allow public text.');
        await act(async () => { await view.result.current.handleSaveTab('teams'); });
        expect(view.result.current.isTabDirty('teams')).toBe(false);
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, 'teamsOutboundCompliance.prompt': '' })));
        act(() => view.result.current.handleCancelTab('teams'));
        expect(view.result.current.featureValues['teamsOutboundCompliance.prompt']).toBe('Allow public text.');
        expect(view.result.current.isTabDirty('teams')).toBe(false);
    });

    const binding = {
        features: { teamsReactionDelegation: true },
        teamsReactionDelegation: { workspaceId: 'alpha', dispatcherSkill: 'dispatcher' },
    };

    it.each(['tab', 'all'])('validates enabled reaction bindings before a %s save', async scope => {
        const { view } = renderController();
        act(() => view.result.current.hydrate(binding));
        await act(async () => {
            if (scope === 'tab') await view.result.current.handleSaveTab('teams');
            else await view.result.current.handleSaveFeatures();
        });
        expect(listSkills).toHaveBeenCalledWith('alpha');
        expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({
            'features.teamsReactionDelegation': true,
            'teamsReactionDelegation.workspaceId': 'alpha',
            'teamsReactionDelegation.dispatcherSkill': 'dispatcher',
        }));
    });

    it.each(['workspace', 'skill', 'workspace-disabled', 'global-disabled', 'read-failure', 'incomplete'])(
        'refuses enabled saves with %s errors and retains pending edits', async failure => {
            if (failure === 'workspace') listWorkspaces.mockResolvedValue({ workspaces: [] });
            if (failure === 'skill') listSkills.mockResolvedValue([]);
            if (failure === 'workspace-disabled') workspaceConfig.mockResolvedValue({ disabledSkills: ['dispatcher'] });
            if (failure === 'global-disabled') globalConfig.mockResolvedValue({ globalDisabledSkills: ['dispatcher'] });
            if (failure === 'read-failure') listSkills.mockRejectedValue(new Error('unavailable'));
            const { view, addToast } = renderController();
            act(() => view.result.current.hydrate(binding));
            act(() => view.result.current.setFeatureValues(prev => ({
                ...prev, 'features.teamsMessageReaction': true,
                ...(failure === 'incomplete' ? { 'teamsReactionDelegation.dispatcherSkill': '' } : {}),
            })));
            await act(async () => { await view.result.current.handleSaveTab('teams'); });
            expect(updateConfig).not.toHaveBeenCalled();
            expect(addToast).toHaveBeenCalledWith('Save failed', 'error');
            expect(view.result.current.isTabDirty('teams')).toBe(true);
            expect(view.result.current.savingTab).toBeNull();
            expect(applyRuntimeConfigPatch).not.toHaveBeenCalled();
        },
    );

    it('allows disabling a removed binding without requiring working skill reads', async () => {
        const { view } = renderController();
        act(() => view.result.current.hydrate(binding));
        act(() => view.result.current.setFeatureValues(prev => ({ ...prev, 'features.teamsReactionDelegation': false })));
        await act(async () => { await view.result.current.handleSaveTab('teams'); });
        expect(listWorkspaces).not.toHaveBeenCalled();
        expect(updateConfig).toHaveBeenCalledWith(expect.objectContaining({ 'features.teamsReactionDelegation': false }));
        expect(view.result.current.isTabDirty('teams')).toBe(false);
    });

    it('does not validate or save Teams bindings when another tab is saved, and cancel restores all binding keys', async () => {
        const { view } = renderController();
        act(() => view.result.current.hydrate(binding));
        act(() => view.result.current.setFeatureValues(prev => ({
            ...prev, 'teamsReactionDelegation.workspaceId': 'beta', 'teamsReactionDelegation.dispatcherSkill': 'other',
        })));
        await act(async () => { await view.result.current.handleSaveTab('chat'); });
        expect(listWorkspaces).not.toHaveBeenCalled();
        expect(updateConfig.mock.calls[0][0]).not.toHaveProperty('features.teamsReactionDelegation');
        expect(view.result.current.isTabDirty('teams')).toBe(true);
        act(() => view.result.current.handleCancelTab('teams'));
        expect(view.result.current.featureValues).toMatchObject({
            'features.teamsReactionDelegation': true, 'teamsReactionDelegation.workspaceId': 'alpha',
            'teamsReactionDelegation.dispatcherSkill': 'dispatcher',
        });
        expect(view.result.current.isTabDirty('teams')).toBe(false);
    });

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

    it('keeps To-do layout unconditional and absent from Admin preferences', () => {
        expect(FEATURES_CARD_SETTINGS.some(setting => setting.key === 'features.sentinelTodoSplitLayout')).toBe(false);
    });

    it('clears the search string when the Features sub-tab is left', () => {
        const addToast = vi.fn();
        const { view } = renderController({ addToast, searchActive: true });
        act(() => view.result.current.setFeatureSearch('loops'));
        expect(view.result.current.featureSearch).toBe('loops');
        act(() => view.rerender({ addToast, searchActive: false }));
        expect(view.result.current.featureSearch).toBe('');
    });
});

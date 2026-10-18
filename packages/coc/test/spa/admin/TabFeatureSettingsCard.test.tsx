// @vitest-environment jsdom
/**
 * Per-tab registry "Features" sections (AI & Execution, Chat, Sentinel, Appearance,
 * Editors, Integrations). Each tab lists only the toggles placed on it; Save sends
 * only that tab's keys; Cancel reverts only that tab's edits.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const { updateConfig, applyRuntimeConfigPatch, invalidateDisplaySettings } = vi.hoisted(() => ({
    updateConfig: vi.fn(),
    applyRuntimeConfigPatch: vi.fn(),
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({ admin: { updateConfig } }),
    getSpaCocClientErrorMessage: (_e: unknown, fallback: string) => fallback,
}));
vi.mock('../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    invalidateDisplaySettings,
}));
vi.mock('../../../src/server/spa/client/react/utils/config', () => ({
    applyRuntimeConfigPatch,
}));

import { TabFeatureSettingsCard } from '../../../src/server/spa/client/react/admin/FeatureSettingsCard';
import {
    useAdminFeatureSettings,
    getTabFeatureSettings,
    readRuntimeFeatureValues,
} from '../../../src/server/spa/client/react/admin/useAdminFeatureSettings';
import type { AdminFeatureSettings } from '../../../src/server/spa/client/react/admin/useAdminFeatureSettings';
import type { FeatureSettingTab } from '../../../src/config/admin-setting-definitions';

type SectionTab = Exclude<FeatureSettingTab, 'features'>;
const SECTION_TABS: SectionTab[] = ['ai', 'chat', 'sentinel', 'appearance', 'editors', 'integrations', 'teams'];

let controller: AdminFeatureSettings;

function Harness({ tabs }: { tabs: SectionTab[] }) {
    controller = useAdminFeatureSettings({ addToast: vi.fn(), searchActive: false });
    return (
        <>
            {tabs.map(tab => (
                <TabFeatureSettingsCard
                    key={tab}
                    tab={tab}
                    featureValues={controller.featureValues}
                    setFeatureValues={controller.setFeatureValues}
                    dirty={controller.isTabDirty(tab)}
                    saving={controller.savingTab === tab}
                    onSave={() => { void controller.handleSaveTab(tab); }}
                    onCancel={() => controller.handleCancelTab(tab)}
                    sources={{}}
                    isDefaultValue={() => true}
                />
            ))}
        </>
    );
}

/** First boolean toggle on `tab` with no dependsOn (always visible). */
function toggleDef(tab: SectionTab) {
    const def = getTabFeatureSettings(tab).find(d => d.ui!.control?.type !== 'select' && !d.ui!.dependsOn);
    if (!def) throw new Error(`no plain toggle on ${tab}`);
    return def;
}

function withinSection(tab: SectionTab) {
    return screen.getByTestId(`settings-tab-features-${tab}`);
}

beforeEach(() => {
    updateConfig.mockReset();
    updateConfig.mockResolvedValue({});
    applyRuntimeConfigPatch.mockClear();
    invalidateDisplaySettings.mockClear();
});

describe('TabFeatureSettingsCard', () => {
    it('ignores saved rail Git opt-outs in Appearance and runtime updates', () => {
        render(<Harness tabs={['appearance']} />);
        act(() => controller.hydrate({ features: { railGitSummary: false } }));
        expect(screen.queryByText('Git on collapsed sidebar')).toBeNull();
        expect(screen.queryByTestId('toggle-rail-git-summary-enabled')).toBeNull();
        expect(controller.featureValues).not.toHaveProperty('features.railGitSummary');
        expect(readRuntimeFeatureValues(controller.featureValues)).not.toHaveProperty('railGitSummaryEnabled');
        expect(controller.isTabDirty('appearance')).toBe(false);
        expect(updateConfig).not.toHaveBeenCalled();
    });

    it.each([undefined, false, true])('keeps collapsed-sidebar controls and runtime values consistent (%s)', enabled => {
        render(<Harness tabs={['appearance']} />);
        const features = enabled === undefined
            ? {}
            : { railManualRefresh: enabled, railStatusActions: !enabled };
        act(() => controller.hydrate({ features }));
        const refreshEnabled = enabled ?? true;
        const statusEnabled = enabled === undefined ? true : !enabled;
        expect(screen.getByTestId('toggle-rail-manual-refresh-enabled')).toHaveProperty('checked', refreshEnabled);
        expect(screen.getByTestId('toggle-rail-status-actions-enabled')).toHaveProperty('checked', statusEnabled);
        expect(readRuntimeFeatureValues(controller.featureValues)).toMatchObject({
            railManualRefreshEnabled: refreshEnabled,
            railStatusActionsEnabled: statusEnabled,
        });
        expect(screen.getByText('Refresh on collapsed sidebar').closest('.ar-row')?.textContent).not.toContain('Experimental');
        expect(screen.getByText('Admin and quota on collapsed sidebar').closest('.ar-row')?.textContent).not.toContain('Experimental');
        expect(controller.isTabDirty('appearance')).toBe(false);
        expect(updateConfig).not.toHaveBeenCalled();
        expect(applyRuntimeConfigPatch).not.toHaveBeenCalled();
    });

    it('saves explicit opt-outs through the existing Appearance controls and runtime patch', async () => {
        render(<Harness tabs={['appearance']} />);
        fireEvent.click(screen.getByTestId('toggle-rail-manual-refresh-enabled'));
        fireEvent.click(screen.getByTestId('toggle-rail-status-actions-enabled'));
        await act(async () => { await controller.handleSaveTab('appearance'); });
        expect(updateConfig).toHaveBeenCalledTimes(1);
        expect(updateConfig.mock.calls[0][0]).toMatchObject({
            'features.railManualRefresh': false,
            'features.railStatusActions': false,
        });
        expect(applyRuntimeConfigPatch.mock.calls[0][0]).toMatchObject({
            railManualRefreshEnabled: false,
            railStatusActionsEnabled: false,
        });
        expect(controller.isTabDirty('appearance')).toBe(false);
    });

    it('omits the ledger toggle and keeps Sentinel Mode and Scrubber independently default-off', () => {
        render(<Harness tabs={['sentinel']} />);
        expect(screen.queryByTestId('toggle-sentinel-todo-ledger-enabled')).toBeNull();
        expect(controller.featureValues).not.toHaveProperty('features.sentinelTodoLedger');
        expect(controller.featureValues['features.sentinelTodoScrubber']).toBe(false);
        expect(screen.getByTestId('toggle-sentinel-todo-scrubber-enabled')).toBeTruthy();
        expect(controller.featureValues['sentinel.enabled']).toBe(false);
    });

    it('defaults to Direct HTTP and saves an explicit SDK choice without credential fields', async () => {
        render(<Harness tabs={['ai']} />);
        const select = screen.getByTestId('select-copilot-transform-transport') as HTMLSelectElement;
        expect(select.value).toBe('direct');
        fireEvent.change(select, { target: { value: 'sdk' } });
        await act(async () => { await controller.handleSaveTab('ai'); });
        expect(updateConfig.mock.calls[0][0]).toMatchObject({ 'copilot.transformTransport': 'sdk' });
        expect(Object.keys(updateConfig.mock.calls[0][0]).some(key => /credential|token/i.test(key))).toBe(false);
    });
    it.each(SECTION_TABS)('the %s tab lists only toggles placed on it', tab => {
        render(<Harness tabs={[tab]} />);
        const section = withinSection(tab);
        const own = getTabFeatureSettings(tab).filter(d => !d.ui!.dependsOn);
        for (const def of own) {
            expect(section.querySelector(`[data-testid="${def.ui!.testId}"]`)).not.toBeNull();
        }
        for (const other of ['features', ...SECTION_TABS.filter(t => t !== tab)] as FeatureSettingTab[]) {
            for (const def of getTabFeatureSettings(other)) {
                expect(section.querySelector(`[data-testid="${def.ui!.testId}"]`)).toBeNull();
            }
        }
    });

    it('groups Appearance into interface sections with navigable ids and experimental badges', () => {
        render(<Harness tabs={['appearance']} />);
        const section = withinSection('appearance');
        const heads = Array.from(section.querySelectorAll('.ar-feature-group-head')).map(h => h.textContent);
        expect(heads).toEqual(['Layout & Navigation', 'Chat Interface', 'Editors & Files']);
        for (const group of ['uiGeneral', 'uiChat', 'editorFiles']) {
            expect(section.querySelector(`#appearance-group-${group}`), group).not.toBeNull();
        }
        const editorGroup = section.querySelector('#appearance-group-editorFiles')!;
        const chatGroup = section.querySelector('#appearance-group-uiChat')!;
        for (const testId of ['toggle-explorer-editor-tabs-enabled', 'toggle-markdown-panel-preview-enabled', 'toggle-diff-file-picker-enabled']) {
            expect(editorGroup.querySelector(`[data-testid="${testId}"]`), testId).not.toBeNull();
        }
        for (const testId of ['toggle-composer-word-hint-enabled', 'toggle-chat-folders-enabled', 'toggle-sentinel-result-cards-enabled']) {
            expect(chatGroup.querySelector(`[data-testid="${testId}"]`), testId).not.toBeNull();
        }
        for (const testId of ['toggle-explorer-editor-tabs-enabled', 'toggle-markdown-panel-preview-enabled']) {
            const toggle = section.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;
            // Default-on experimental toggles drop the Experimental pill.
            expect(toggle.checked, testId).toBe(true);
            expect(toggle.closest('.ar-row')?.textContent, testId).not.toContain('Experimental');
        }
    });

    it('keeps only the functional Notes editor toggle on Editors', () => {
        render(<Harness tabs={['editors']} />);
        const section = withinSection('editors');
        expect(section.querySelectorAll('.ar-feature-group-head')).toHaveLength(0);
        expect(Array.from(section.querySelectorAll('input')).map(i => i.getAttribute('data-testid'))).toEqual(['toggle-arxiv-paper-ingest-enabled']);
    });

    it('saves moved editor UI toggles from Appearance with their existing keys and runtime flags', async () => {
        render(<Harness tabs={['appearance', 'editors']} />);
        fireEvent.click(screen.getByTestId('toggle-explorer-editor-tabs-enabled'));
        fireEvent.click(screen.getByTestId('toggle-arxiv-paper-ingest-enabled'));
        await act(async () => { await controller.handleSaveTab('appearance'); });
        const payload = updateConfig.mock.calls[0][0] as Record<string, unknown>;
        expect(payload).toMatchObject({
            'features.explorerEditorTabs': false,
            'features.markdownPanelPreview': true,
        });
        expect(payload).not.toHaveProperty('features.arxivPaperIngest');
        expect(applyRuntimeConfigPatch.mock.calls[0][0]).toMatchObject({
            explorerEditorTabsEnabled: false,
            markdownPanelPreviewEnabled: true,
        });
        expect(controller.isTabDirty('appearance')).toBe(false);
        expect(controller.isTabDirty('editors')).toBe(true);
        await act(async () => { await controller.handleSaveTab('editors'); });
        expect(updateConfig.mock.calls[1][0]).toEqual({ 'features.arxivPaperIngest': true });
        expect(applyRuntimeConfigPatch.mock.calls[1][0]).toEqual({ arxivPaperIngestEnabled: true });
    });

    it('shows group headings only when the tab spans more than one group', () => {
        render(<Harness tabs={['ai']} />);
        const groups = new Set(getTabFeatureSettings('ai').map(d => d.ui!.group));
        const heads = withinSection('ai').querySelectorAll('.ar-feature-group-head');
        expect(heads.length).toBe(groups.size > 1 ? groups.size : 0);
    });

    it('hides dependsOn rows until the parent toggle is on', () => {
        render(<Harness tabs={['appearance']} />);
        const dependent = getTabFeatureSettings('appearance').find(d => d.ui!.dependsOn)!;
        const parentOn = controller.featureValues[dependent.ui!.dependsOn!] === true;
        expect(screen.queryByTestId(dependent.ui!.testId) !== null).toBe(parentOn);
        act(() => controller.setFeatureValues(prev => ({ ...prev, [dependent.ui!.dependsOn!]: true })));
        expect(screen.getByTestId(dependent.ui!.testId)).toBeTruthy();
    });

    it.each(SECTION_TABS)('saving the %s section sends only that tab\'s keys', async tab => {
        render(<Harness tabs={[tab]} />);
        const def = toggleDef(tab);
        const before = controller.featureValues[def.key] === true;
        fireEvent.click(screen.getByTestId(def.ui!.testId));
        expect(controller.isTabDirty(tab)).toBe(true);

        await act(async () => { await controller.handleSaveTab(tab); });

        expect(updateConfig).toHaveBeenCalledTimes(1);
        const payload = updateConfig.mock.calls[0][0] as Record<string, unknown>;
        expect(payload[def.key]).toBe(!before);
        expect(Object.keys(payload).sort()).toEqual(getTabFeatureSettings(tab).map(d => d.key).sort());
        expect(invalidateDisplaySettings).toHaveBeenCalledTimes(1);
        expect(controller.isTabDirty(tab)).toBe(false);
    });

    it.each<SectionTab>(['ai', 'sentinel'])('cancel on %s keeps unsaved edits on another tab', tab => {
        render(<Harness tabs={[tab, 'appearance']} />);
        const aiDef = toggleDef(tab);
        const appDef = toggleDef('appearance');
        const aiBefore = controller.featureValues[aiDef.key];
        const appBefore = controller.featureValues[appDef.key];
        fireEvent.click(screen.getByTestId(aiDef.ui!.testId));
        fireEvent.click(screen.getByTestId(appDef.ui!.testId));

        act(() => controller.handleCancelTab(tab));

        expect(controller.featureValues[aiDef.key]).toBe(aiBefore);
        expect(controller.featureValues[appDef.key]).toBe(!appBefore);
        expect(controller.isTabDirty(tab)).toBe(false);
        expect(controller.isTabDirty('appearance')).toBe(true);
    });

    it.each<SectionTab>(['chat', 'sentinel'])('saving %s leaves another tab\'s edits pending', async tab => {
        render(<Harness tabs={[tab, 'integrations']} />);
        const chatDef = toggleDef(tab);
        const intDef = toggleDef('integrations');
        fireEvent.click(screen.getByTestId(chatDef.ui!.testId));
        fireEvent.click(screen.getByTestId(intDef.ui!.testId));

        await act(async () => { await controller.handleSaveTab(tab); });

        const payload = updateConfig.mock.calls[0][0] as Record<string, unknown>;
        expect(intDef.key in payload).toBe(false);
        expect(controller.isTabDirty(tab)).toBe(false);
        expect(controller.isTabDirty('integrations')).toBe(true);
    });

    it('keeps a failed Sentinel save dirty and cancels back to hydrated values only', async () => {
        render(<Harness tabs={['sentinel', 'chat']} />);
        act(() => controller.hydrate({
            sentinel: { enabled: true },
            features: { sentinelTodoTags: true, sentinelResultCards: false },
        }));
        expect(controller.isTabDirty('sentinel')).toBe(false);
        fireEvent.click(screen.getByTestId('toggle-sentinel-todo-tags-enabled'));
        const chatDef = toggleDef('chat');
        fireEvent.click(screen.getByTestId(chatDef.ui!.testId));
        updateConfig.mockRejectedValueOnce(new Error('Save failed'));
        await act(async () => { await controller.handleSaveTab('sentinel'); });
        expect(controller.isTabDirty('sentinel')).toBe(true);
        expect(controller.savingTab).toBeNull();
        expect(applyRuntimeConfigPatch).not.toHaveBeenCalled();

        act(() => controller.handleCancelTab('sentinel'));
        expect(controller.featureValues['sentinel.enabled']).toBe(true);
        expect(controller.featureValues['features.sentinelTodoTags']).toBe(true);
        expect(controller.featureValues['features.sentinelResultCards']).toBe(false);
        expect(controller.isTabDirty('sentinel')).toBe(false);
        expect(controller.isTabDirty('chat')).toBe(true);
    });

    it.each<FeatureSettingTab>(['ai', 'chat', 'appearance', 'editors', 'integrations', 'teams', 'features'])(
        'saving or canceling %s cannot consume pending Sentinel edits',
        async tab => {
            render(<Harness tabs={['sentinel']} />);
            const def = getTabFeatureSettings(tab).find(d => d.value.kind === 'boolean' && !d.ui!.dependsOn)!;
            fireEvent.click(screen.getByTestId('toggle-sentinel-enabled'));
            act(() => controller.setFeatureValues(prev => ({ ...prev, [def.key]: prev[def.key] !== true })));
            await act(async () => { await controller.handleSaveTab(tab); });
            expect(controller.isTabDirty(tab)).toBe(false);
            expect(controller.isTabDirty('sentinel')).toBe(true);
            const payload = updateConfig.mock.calls[0][0];
            const runtimePatch = applyRuntimeConfigPatch.mock.calls[0][0];
            for (const sentinel of getTabFeatureSettings('sentinel')) {
                expect(Object.keys(payload)).not.toContain(sentinel.key);
                expect(runtimePatch).not.toHaveProperty(sentinel.runtimeFlag!);
            }
            act(() => controller.handleCancelTab(tab));
            expect(controller.featureValues['sentinel.enabled']).toBe(true);
            expect(controller.isTabDirty('sentinel')).toBe(true);
        },
    );

    it('the section Save button calls updateConfig', async () => {
        render(<Harness tabs={['chat']} />);
        fireEvent.click(screen.getByTestId(toggleDef('chat').ui!.testId));
        const save = Array.from(withinSection('chat').querySelectorAll('button'))
            .find(b => /save/i.test(b.textContent ?? ''))!;
        await act(async () => { fireEvent.click(save); });
        expect(updateConfig).toHaveBeenCalledTimes(1);
    });
});

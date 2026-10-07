// @vitest-environment jsdom
/**
 * Per-tab registry "Features" sections (AI & Execution, Chat, Appearance,
 * Integrations). Each tab lists only the toggles placed on it; Save sends
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
} from '../../../src/server/spa/client/react/admin/useAdminFeatureSettings';
import type { AdminFeatureSettings } from '../../../src/server/spa/client/react/admin/useAdminFeatureSettings';
import type { FeatureSettingTab } from '../../../src/config/admin-setting-definitions';

type SectionTab = Exclude<FeatureSettingTab, 'features'>;
const SECTION_TABS: SectionTab[] = ['ai', 'chat', 'appearance', 'integrations'];

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
    it('saves Direct HTTP as the Copilot transport without credential fields', async () => {
        render(<Harness tabs={['ai']} />);
        const select = screen.getByTestId('select-copilot-transform-transport') as HTMLSelectElement;
        expect(select.value).toBe('sdk');
        fireEvent.change(select, { target: { value: 'direct' } });
        await act(async () => { await controller.handleSaveTab('ai'); });
        expect(updateConfig.mock.calls[0][0]).toMatchObject({ 'copilot.transformTransport': 'direct' });
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

    it('cancel on one tab keeps unsaved edits on another tab', () => {
        render(<Harness tabs={['ai', 'appearance']} />);
        const aiDef = toggleDef('ai');
        const appDef = toggleDef('appearance');
        const aiBefore = controller.featureValues[aiDef.key];
        const appBefore = controller.featureValues[appDef.key];
        fireEvent.click(screen.getByTestId(aiDef.ui!.testId));
        fireEvent.click(screen.getByTestId(appDef.ui!.testId));

        act(() => controller.handleCancelTab('ai'));

        expect(controller.featureValues[aiDef.key]).toBe(aiBefore);
        expect(controller.featureValues[appDef.key]).toBe(!appBefore);
        expect(controller.isTabDirty('ai')).toBe(false);
        expect(controller.isTabDirty('appearance')).toBe(true);
    });

    it('saving one tab leaves another tab\'s edits pending', async () => {
        render(<Harness tabs={['chat', 'integrations']} />);
        const chatDef = toggleDef('chat');
        const intDef = toggleDef('integrations');
        fireEvent.click(screen.getByTestId(chatDef.ui!.testId));
        fireEvent.click(screen.getByTestId(intDef.ui!.testId));

        await act(async () => { await controller.handleSaveTab('chat'); });

        const payload = updateConfig.mock.calls[0][0] as Record<string, unknown>;
        expect(intDef.key in payload).toBe(false);
        expect(controller.isTabDirty('chat')).toBe(false);
        expect(controller.isTabDirty('integrations')).toBe(true);
    });

    it('the section Save button calls updateConfig', async () => {
        render(<Harness tabs={['chat']} />);
        fireEvent.click(screen.getByTestId(toggleDef('chat').ui!.testId));
        const save = Array.from(withinSection('chat').querySelectorAll('button'))
            .find(b => /save/i.test(b.textContent ?? ''))!;
        await act(async () => { fireEvent.click(save); });
        expect(updateConfig).toHaveBeenCalledTimes(1);
    });
});

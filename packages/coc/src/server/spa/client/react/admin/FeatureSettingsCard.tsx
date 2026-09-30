/**
 * FeatureSettingsCard — the "Workspace Features" card.
 *
 * Pure presentation over registry-driven feature values: a live search box
 * plus grouped toggle/select rows derived from `FEATURE_CARD_GROUPS`. All
 * state and the save/cancel behaviour live in `useAdminFeatureSettings`; this
 * component only renders and reports edits back up.
 */
import { SettingsCard } from './SettingsCard';
import { AdminRow, AdminToggle, SourceBadge } from './adminControls';
import {
    FEATURE_CARD_GROUPS,
    getFeatureCardSettings,
    getFeatureSettingTab,
} from '../../../../../config/admin-setting-definitions';
import type { AdminSettingDefinition, FeatureSettingTab } from '../../../../../config/admin-setting-definitions';
import { getSettingsSubTabMeta } from './adminNavigation';
import type { FeatureValues } from './useAdminFeatureSettings';

const FEATURE_BADGES: Record<string, { className: string; label: string }> = {
    restart: { className: 'ar-badge ar-badge-warning', label: 'Restart' },
    experimental: { className: 'ar-badge ar-badge-accent', label: 'Experimental' },
    preview: { className: 'ar-badge ar-badge-accent', label: 'Preview' },
};

/**
 * Badge to render next to a feature's label, or undefined for none.
 *
 * A feature that ships enabled is no longer experimental in practice, so the
 * "Experimental" pill is suppressed once its default flips to `true`. Other
 * badges are unaffected: 'restart' describes how the setting applies rather
 * than how mature it is, and 'preview' is set deliberately per feature.
 */
export function resolveFeatureBadge(def: AdminSettingDefinition) {
    const badge = def.ui?.badge;
    if (!badge) return undefined;
    if (badge === 'experimental' && def.default === true) return undefined;
    return FEATURE_BADGES[badge];
}

interface FeatureSettingRowProps {
    def: AdminSettingDefinition;
    featureValues: FeatureValues;
    setFeatureValues: React.Dispatch<React.SetStateAction<FeatureValues>>;
    sources: Record<string, string>;
    isDefaultValue: (key: string) => boolean | undefined;
}

/** One registry-driven toggle/select row (label, badge, source badge, control). */
function FeatureSettingRow({ def, featureValues, setFeatureValues, sources, isDefaultValue }: FeatureSettingRowProps) {
    const ui = def.ui!;
    const badge = resolveFeatureBadge(def);
    const name = badge
        ? <>{ui.label} <span className={badge.className}>{badge.label}</span></>
        : ui.label;
    return (
        <AdminRow name={name} hint={ui.hint}>
            <SourceBadge source={sources[def.key]} isDefault={isDefaultValue(def.key)} />
            {ui.control?.type === 'select' ? (
                <select
                    className="ar-select ar-med"
                    value={String(featureValues[def.key] ?? '')}
                    onChange={e => setFeatureValues(prev => ({ ...prev, [def.key]: e.target.value }))}
                    data-testid={ui.testId}
                >
                    {ui.control.options.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </select>
            ) : (
                <AdminToggle
                    checked={featureValues[def.key] === true}
                    onChange={checked => setFeatureValues(prev => ({ ...prev, [def.key]: checked }))}
                    data-testid={ui.testId}
                />
            )}
        </AdminRow>
    );
}

export interface FeatureSettingsCardProps {
    featureValues: FeatureValues;
    setFeatureValues: React.Dispatch<React.SetStateAction<FeatureValues>>;
    featureSearch: string;
    setFeatureSearch: React.Dispatch<React.SetStateAction<string>>;
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
    sources: Record<string, string>;
    isDefaultValue: (key: string) => boolean | undefined;
    onNavigateToTab: (tab: Exclude<FeatureSettingTab, 'features'>) => void;
}

export function FeatureSettingsCard({
    featureValues,
    setFeatureValues,
    featureSearch,
    setFeatureSearch,
    dirty,
    saving,
    onSave,
    onCancel,
    sources,
    isDefaultValue,
    onNavigateToTab,
}: FeatureSettingsCardProps) {
    // Case-insensitive substring match against label + hint. Whitespace-only
    // query is treated as empty (full list).
    const query = featureSearch.trim().toLowerCase();
    const groups = FEATURE_CARD_GROUPS
        .map(group => ({
            group,
            defs: getFeatureCardSettings(group.id).filter(def => {
                const ui = def.ui!;
                // dependsOn-hidden rows never appear, regardless of text match.
                if (ui.dependsOn && featureValues[ui.dependsOn] !== true) return false;
                if (!query) return getFeatureSettingTab(def) === 'features';
                return ui.label.toLowerCase().includes(query)
                    || ui.hint.toLowerCase().includes(query);
            }),
        }))
        .filter(entry => entry.defs.length > 0);

    return (
        <SettingsCard
            title="Workspace Features"
            description="Enable or disable optional dashboard features."
            dirty={dirty}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
            data-testid="settings-features"
        >
            <div className="ar-feature-search">
                <span className="ar-feature-search-icon" aria-hidden="true">🔍</span>
                <input
                    type="text"
                    className="ar-input ar-full"
                    placeholder="Search features…"
                    value={featureSearch}
                    onChange={e => setFeatureSearch(e.target.value)}
                    aria-label="Search features"
                    data-testid="feature-search-input"
                />
                {featureSearch && (
                    <button
                        type="button"
                        className="ar-feature-search-clear"
                        onClick={() => setFeatureSearch('')}
                        title="Clear search"
                        aria-label="Clear search"
                        data-testid="feature-search-clear"
                    >
                        ✕
                    </button>
                )}
            </div>
            {query && groups.length === 0 ? (
                <div className="ar-feature-empty" data-testid="feature-search-empty">
                    No features match.
                </div>
            ) : (
                groups.map(({ group, defs }) => (
                    <div className="ar-feature-group" data-testid={group.testId} key={group.id}>
                        <div className="ar-feature-group-head">{group.heading}</div>
                        {defs.map(def => {
                            const tab = getFeatureSettingTab(def);
                            return tab === 'features' ? (
                                <FeatureSettingRow
                                    key={def.key}
                                    def={def}
                                    featureValues={featureValues}
                                    setFeatureValues={setFeatureValues}
                                    sources={sources}
                                    isDefaultValue={isDefaultValue}
                                />
                            ) : (
                                <AdminRow key={def.key} name={def.ui!.label} hint={def.ui!.hint}>
                                    <a
                                        href={`#admin/settings/${tab}`}
                                        onClick={() => onNavigateToTab(tab)}
                                        data-testid={`feature-search-link-${def.ui!.testId}`}
                                    >
                                        in {getSettingsSubTabMeta(tab).label}
                                    </a>
                                </AdminRow>
                            );
                        })}
                    </div>
                ))
            )}
        </SettingsCard>
    );
}

export interface TabFeatureSettingsCardProps {
    tab: Exclude<FeatureSettingTab, 'features'>;
    featureValues: FeatureValues;
    setFeatureValues: React.Dispatch<React.SetStateAction<FeatureValues>>;
    dirty: boolean;
    saving: boolean;
    onSave: () => void;
    onCancel: () => void;
    sources: Record<string, string>;
    isDefaultValue: (key: string) => boolean | undefined;
}

/**
 * Registry-driven "Features" section for a non-Features settings tab. Lists
 * only toggles placed on `tab`, with group headings shown when the tab spans
 * more than one `FEATURE_CARD_GROUPS` group. Renders nothing when no visible
 * toggle is placed on the tab.
 */
export function TabFeatureSettingsCard({
    tab,
    featureValues,
    setFeatureValues,
    dirty,
    saving,
    onSave,
    onCancel,
    sources,
    isDefaultValue,
}: TabFeatureSettingsCardProps) {
    const groups = FEATURE_CARD_GROUPS
        .map(group => ({
            group,
            defs: getFeatureCardSettings(group.id, tab).filter(def => {
                const dependsOn = def.ui!.dependsOn;
                return !dependsOn || featureValues[dependsOn] === true;
            }),
        }))
        .filter(entry => entry.defs.length > 0);
    if (groups.length === 0) return null;
    const showHeadings = groups.length > 1;

    return (
        <SettingsCard
            title="Features"
            description="Optional features for this area."
            dirty={dirty}
            saving={saving}
            onSave={onSave}
            onCancel={onCancel}
            data-testid={`settings-tab-features-${tab}`}
        >
            {groups.map(({ group, defs }) => (
                <div className="ar-feature-group" key={group.id}>
                    {showHeadings && <div className="ar-feature-group-head">{group.heading}</div>}
                    {defs.map(def => (
                        <FeatureSettingRow
                            key={def.key}
                            def={def}
                            featureValues={featureValues}
                            setFeatureValues={setFeatureValues}
                            sources={sources}
                            isDefaultValue={isDefaultValue}
                        />
                    ))}
                </div>
            ))}
        </SettingsCard>
    );
}

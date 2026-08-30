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
} from '../../../../../config/admin-setting-definitions';
import type { AdminSettingDefinition } from '../../../../../config/admin-setting-definitions';
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
                if (!query) return true;
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
                            const ui = def.ui!;
                            const badge = resolveFeatureBadge(def);
                            const name = badge
                                ? <>{ui.label} <span className={badge.className}>{badge.label}</span></>
                                : ui.label;
                            return (
                                <AdminRow key={def.key} name={name} hint={ui.hint}>
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
                        })}
                    </div>
                ))
            )}
        </SettingsCard>
    );
}

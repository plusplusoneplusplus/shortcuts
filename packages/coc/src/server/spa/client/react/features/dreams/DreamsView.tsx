// Admin "Dreams" tab — the single home for Dreams configuration and activity.
//
// Lives in the dashboard's "Knowledge" nav group (alongside Memory and
// Skills) and is embedded inside the admin shell. This tab owns:
//   • the global `dreams.enabled` toggle,
//   • the running-interval (`dreams.idleCheckIntervalMs`, edited in minutes),
//   • default provider / model / timeout for idle-triggered Dream runs, and
//   • the "Dreams provider activity" queue + history.
//
// The per-workspace dream-cards review panel (`DreamsPanel`) is a separate,
// untouched surface under each repo's detail view.
//
// Config (form + dirty/save) and the provider-activity feed are owned by
// `AdminPanel` and passed in as props, so they load with the rest of the admin
// config and reuse the shared toast + runtime-flag plumbing.

import { SettingsCard } from '../../admin/SettingsCard';
import { AdminRow, AdminToggle } from '../../admin/adminControls';
import type { AgentProviderWorkActivity } from '../../shared/providerActivity';
import { ProviderActivitySection } from './ProviderActivitySection';

/** Editable global Dreams settings surfaced on the Dreams tab. */
export interface DreamsConfigForm {
    /** Global `dreams.enabled` flag — gates idle-time reflection everywhere. */
    enabled: boolean;
}

export interface DreamsViewProps {
    config?: DreamsConfigForm;
    onConfigChange?: (patch: Partial<DreamsConfigForm>) => void;
    configDirty?: boolean;
    configSaving?: boolean;
    onSaveConfig?: () => void;
    onCancelConfig?: () => void;
    providerActivity?: AgentProviderWorkActivity[];
    providerActivityError?: string | null;
    onRefreshProviderActivity?: () => void;
}

const DEFAULT_CONFIG: DreamsConfigForm = { enabled: false };

export function DreamsView({
    config = DEFAULT_CONFIG,
    onConfigChange,
    configDirty,
    configSaving,
    onSaveConfig,
    onCancelConfig,
    providerActivity = [],
    providerActivityError,
    onRefreshProviderActivity,
}: DreamsViewProps = {}) {
    return (
        <div className="aip-page" data-testid="dreams-admin-page">
            <div className="aip-page-head">
                <div>
                    <h2 className="ar-page-title">Dreams</h2>
                    <p className="ar-page-desc">
                        Enable Dreams, tune the idle-reflection schedule and defaults, and watch the
                        provider activity queue — all from one place.
                    </p>
                </div>
                <span className="ar-badge ar-badge-accent"><span className="aip-dot" /> Restart-aware</span>
            </div>

            <SettingsCard
                title="Dreams"
                description="Idle-time reflection that surfaces opt-in review cards per workspace."
                dirty={configDirty}
                saving={configSaving}
                onSave={onSaveConfig}
                onCancel={onCancelConfig}
                data-testid="dreams-settings"
            >
                <AdminRow
                    name={<>Enable Dreams <span className="ar-badge ar-badge-accent">Experimental</span></>}
                    hint="Enables workspace opt-in review cards from idle-time reflection. Disabled by default; workspaces must also opt in individually."
                >
                    <AdminToggle
                        checked={config.enabled === true}
                        onChange={enabled => onConfigChange?.({ enabled })}
                        data-testid="toggle-dreams-enabled"
                    />
                </AdminRow>
            </SettingsCard>

            <ProviderActivitySection
                activity={providerActivity}
                error={providerActivityError}
                onRefresh={onRefreshProviderActivity}
            />
        </div>
    );
}

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
import { AdminInputSuffix, AdminRow, AdminSeg, AdminToggle } from '../../admin/adminControls';
import type { AgentProviderWorkActivity } from '../../shared/providerActivity';
import { ProviderActivitySection } from './ProviderActivitySection';

/** Editable global Dreams settings surfaced on the Dreams tab. */
export interface DreamsConfigForm {
    /** Global `dreams.enabled` flag — gates idle-time reflection everywhere. */
    enabled: boolean;
    /** Default provider for idle-triggered Dream runs; blank uses the global default provider. */
    provider: '' | 'copilot' | 'codex' | 'claude';
    /** Optional default model for idle-triggered Dream runs. */
    model: string;
    /** Default Dream AI request timeout, edited in minutes and persisted as milliseconds. */
    timeoutMinutes: string;
    /** Automatic idle-check cadence, edited in minutes and persisted as milliseconds. */
    intervalMinutes: string;
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

const DEFAULT_CONFIG: DreamsConfigForm = { enabled: false, provider: '', model: '', timeoutMinutes: '60', intervalMinutes: '5' };

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
                <AdminRow
                    name={<>Idle check interval <span className="ar-badge">Restart</span></>}
                    hint="How often the server checks for idle workspaces that are ready for automatic Dream runs. Saved immediately; restart the server for the scheduler cadence to use the new value."
                >
                    <AdminInputSuffix suffix="min">
                        <input
                            id="dreams-idle-check-interval-minutes"
                            className="ar-input ar-input-sm"
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={config.intervalMinutes}
                            onChange={event => onConfigChange?.({ intervalMinutes: event.target.value })}
                            data-testid="dreams-idle-check-interval-minutes"
                        />
                    </AdminInputSuffix>
                </AdminRow>
                <AdminRow
                    name="Default provider"
                    hint="Provider used by automatic idle Dream runs. Use global default keeps Dreams aligned with the server-wide provider fallback."
                >
                    <AdminSeg
                        value={config.provider}
                        onChange={provider => onConfigChange?.({ provider })}
                        aria-label="Dreams default provider"
                        options={[
                            { value: '', label: 'Global', testId: 'dreams-provider-global' },
                            { value: 'copilot', label: 'Copilot', testId: 'dreams-provider-copilot' },
                            { value: 'codex', label: 'Codex', testId: 'dreams-provider-codex' },
                            { value: 'claude', label: 'Claude', testId: 'dreams-provider-claude' },
                        ]}
                    />
                </AdminRow>
                <AdminRow
                    name="Default model"
                    hint="Optional model override for idle Dream runs. Leave blank to use the selected provider's default model."
                >
                    <input
                        id="dreams-default-model"
                        className="ar-input ar-input-sm"
                        type="text"
                        value={config.model}
                        onChange={event => onConfigChange?.({ model: event.target.value })}
                        placeholder="Provider default"
                        data-testid="dreams-default-model"
                    />
                </AdminRow>
                <AdminRow
                    name="Run timeout"
                    hint="Timeout for each read-only analyzer and critic request in a Dream run."
                >
                    <AdminInputSuffix suffix="min">
                        <input
                            id="dreams-timeout-minutes"
                            className="ar-input ar-input-sm"
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            value={config.timeoutMinutes}
                            onChange={event => onConfigChange?.({ timeoutMinutes: event.target.value })}
                            data-testid="dreams-timeout-minutes"
                        />
                    </AdminInputSuffix>
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

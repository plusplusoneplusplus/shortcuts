/**
 * ProviderActivitySection — the "Dreams provider activity" queue + history card.
 *
 * Renders active and recent Dream runs attributed to the provider, model, and
 * timeout selected for each run, with an optional Refresh control. Lives in the
 * admin **Dreams** tab (`DreamsView`); the state, fetch, and refresh handler are
 * owned by `AdminPanel` and passed in as props.
 */
import { formatProviderActivityTimeout, type AgentProviderWorkActivity } from '../../shared/providerActivity';
import { PROVIDER_LABELS, ProviderAvatar } from '../../shared/providerVisuals';

export interface ProviderActivitySectionProps {
    activity: AgentProviderWorkActivity[];
    error?: string | null;
    onRefresh?: () => void;
}

export function ProviderActivitySection({ activity, error, onRefresh }: ProviderActivitySectionProps) {
    return (
        <section className="aip-auto-card" aria-labelledby="provider-dream-activity-title" data-testid="provider-dream-activity">
            <div className="aip-auto-head">
                <div>
                    <div className="aip-provider-line">
                        <span className="aip-provider-main" id="provider-dream-activity-title">Dreams provider activity</span>
                        <span className="aip-provider-source">queue + history</span>
                    </div>
                    <div className="aip-provider-meta">
                        Active and recent Dream jobs are attributed to the provider, model, and timeout selected for each run.
                    </div>
                </div>
                {onRefresh && (
                    <button
                        type="button"
                        className="ar-btn ar-btn-secondary ar-btn-sm"
                        onClick={onRefresh}
                        data-testid="provider-dream-activity-refresh"
                    >
                        Refresh
                    </button>
                )}
            </div>
            {error ? (
                <div className="aip-error-banner" data-testid="provider-dream-activity-error">⚠ {error}</div>
            ) : activity.length === 0 ? (
                <div className="aip-auto-disabled" data-testid="provider-dream-activity-empty">
                    No active or recent Dreams work.
                </div>
            ) : (
                <div className="aip-auto-rules">
                    {activity.map(item => {
                        const providerLabel = PROVIDER_LABELS[item.provider] ?? item.provider;
                        const trigger = item.trigger === 'idle' ? 'Idle' : item.trigger === 'manual' ? 'Manual' : 'Dreams';
                        const status = item.status ? item.status.replace(/-/g, ' ') : 'unknown';
                        return (
                            <div className="aip-auto-rule" key={item.id} data-testid={`provider-dream-activity-${item.id}`}>
                                <div className="aip-auto-rule-main">
                                    <ProviderAvatar provider={item.provider} />
                                    <div>
                                        <div className="aip-provider-line">
                                            <span className="aip-provider-main">{item.label}</span>
                                            <span className="ar-badge ar-badge-accent">{providerLabel}</span>
                                        </div>
                                        <div className="aip-provider-meta">
                                            {trigger} · {status} · {item.model ?? 'provider default'} · {formatProviderActivityTimeout(item.timeoutMs)}
                                        </div>
                                        {item.error && <div className="aip-install-error">✕ {item.error}</div>}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}

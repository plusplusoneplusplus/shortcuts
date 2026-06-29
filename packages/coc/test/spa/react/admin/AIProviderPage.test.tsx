/**
 * Dedicated mock-based tests for the AIProviderPage component.
 * Tests the redesigned AI Provider admin page in isolation from AdminPanel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React, { Suspense } from 'react';
import type { AIProviderPageProps } from '../../../../src/server/spa/client/react/admin/AIProviderPage';

vi.mock('../../../../src/server/spa/client/react/features/models/ProviderModelsSection', () => ({
    ProviderModelsSection: ({ provider, available, unavailableMessage, allProviders, onProviderChange }: {
        provider: string; available: boolean; unavailableMessage?: string;
        allProviders?: string[]; onProviderChange?: (p: string) => void;
    }) => (
        <div data-testid="mock-provider-models-section" data-provider={provider} data-available={String(available)}>
            {unavailableMessage && <span data-testid="mock-unavailable-msg">{unavailableMessage}</span>}
            {allProviders && (
                <div data-testid="mock-provider-tabs">
                    {allProviders.map(p => (
                        <button key={p} data-testid={`mock-provider-tab-${p}`} onClick={() => onProviderChange?.(p)}>{p}</button>
                    ))}
                </div>
            )}
        </div>
    ),
}));

const { AIProviderPage } = await import('../../../../src/server/spa/client/react/admin/AIProviderPage');

function makeProps(overrides: Partial<AIProviderPageProps> = {}): AIProviderPageProps {
    return {
        defaultProvider: 'copilot',
        setDefaultProvider: vi.fn(),
        codexEnabled: true,
        setCodexEnabled: vi.fn(),
        claudeEnabled: false,
        setClaudeEnabled: vi.fn(),
        autoAgentProviderRoutingEnabled: false,
        setAutoAgentProviderRoutingEnabled: vi.fn(),
        autoRoutingConfig: undefined,
        setAutoRoutingConfig: vi.fn(),
        providerAvailability: {
            codex: { available: true },
            claude: { available: false, error: 'SDK not installed' },
            opencode: { available: false, error: 'SDK not installed' },
        },
        sdkInstallStatuses: {
            codex: 'installed',
            claude: 'not-installed',
            opencode: 'not-installed',
        },
        sdkInstallErrors: {},
        onInstallSdk: vi.fn(),
        dirty: false,
        saving: false,
        onSave: vi.fn(),
        onCancel: vi.fn(),
        quotaData: null,
        quotaLoading: false,
        quotaError: null,
        onRefreshQuota: vi.fn(),
        sources: {},
        ...overrides,
    };
}

function renderPage(overrides: Partial<AIProviderPageProps> = {}) {
    const props = makeProps(overrides);
    return {
        ...render(
            <div className="admin-redesign">
                <Suspense fallback={null}>
                    <AIProviderPage {...props} />
                </Suspense>
            </div>,
        ),
        props,
    };
}

function quotaType(overrides: {
    type: string;
    remainingPercentage?: number;
    usedRequests?: number;
    entitlementRequests?: number;
    resetDate?: string;
    isUnlimitedEntitlement?: boolean;
}) {
    return {
        type: overrides.type,
        isUnlimitedEntitlement: overrides.isUnlimitedEntitlement ?? false,
        usedRequests: overrides.usedRequests ?? 0,
        entitlementRequests: overrides.entitlementRequests ?? 100,
        remainingPercentage: overrides.remainingPercentage ?? 1,
        usageAllowedWithExhaustedQuota: false,
        overage: 0,
        resetDate: overrides.resetDate ?? '',
    };
}

describe('AIProviderPage', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    // ────────────── Page structure ──────────────
    it('renders the page container with data-testid', () => {
        renderPage();
        expect(screen.getByTestId('ai-provider-page')).toBeDefined();
    });

    it('renders the page title and description', () => {
        renderPage();
        expect(screen.getByText('AI Provider')).toBeDefined();
        expect(screen.getByText(/Set defaults, provider readiness/)).toBeDefined();
    });

    it('renders the restart-aware badge', () => {
        renderPage();
        expect(screen.getByText('Restart-aware')).toBeDefined();
    });

    // ────────────── Sub-tab bar ──────────────
    it('renders the sub-tab bar with routing and models tabs', () => {
        renderPage();
        expect(screen.getByTestId('aip-subtab-row')).toBeDefined();
        expect(screen.getByTestId('aip-subtab-routing')).toBeDefined();
        expect(screen.getByTestId('aip-subtab-models')).toBeDefined();
    });

    it('defaults to the routing sub-tab', () => {
        renderPage();
        const routingTab = screen.getByTestId('aip-subtab-routing');
        expect(routingTab.getAttribute('aria-selected')).toBe('true');
        expect(routingTab.className).toContain('is-active');
    });

    it('switches to models sub-tab when clicked', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        const modelsTab = screen.getByTestId('aip-subtab-models');
        expect(modelsTab.getAttribute('aria-selected')).toBe('true');
        expect(modelsTab.className).toContain('is-active');
        expect(screen.getByTestId('aip-subtab-routing').getAttribute('aria-selected')).toBe('false');
    });

    it('hides routing content when models tab is active', () => {
        renderPage();
        expect(screen.getByTestId('aip-summary-grid')).toBeDefined();
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        expect(screen.queryByTestId('aip-summary-grid')).toBeNull();
    });

    it('hides models content when routing tab is active', () => {
        renderPage();
        expect(screen.queryByTestId('mock-provider-models-section')).toBeNull();
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        expect(screen.getByTestId('mock-provider-models-section')).toBeDefined();
    });

    // ────────────── Summary grid ──────────────
    it('renders the summary grid with four cards', () => {
        renderPage();
        const grid = screen.getByTestId('aip-summary-grid');
        expect(grid).toBeDefined();
        expect(screen.getByText('Default route')).toBeDefined();
        expect(screen.getByText('Provider health')).toBeDefined();
        expect(screen.getByText('Enabled models')).toBeDefined();
        expect(screen.getByText('Quota risk')).toBeDefined();
    });

    it('shows the default provider label in the summary', () => {
        renderPage({ defaultProvider: 'codex' });
        const grid = screen.getByTestId('aip-summary-grid');
        expect(within(grid).getByText('Codex')).toBeDefined();
    });

    it('shows provider health count', () => {
        renderPage();
        expect(screen.getByText(/2 \/ 4/)).toBeDefined();
    });

    it('shows "All providers available" when all are available', () => {
        renderPage({
            providerAvailability: {
                codex: { available: true },
                claude: { available: true },
                opencode: { available: true },
            },
        });
        expect(screen.getByText('All providers available')).toBeDefined();
    });

    it('shows unavailable count when some providers are down', () => {
        renderPage();
        expect(screen.getByText(/2 unavailable/)).toBeDefined();
    });

    // ────────────── Provider routing table ──────────────
    it('renders four provider rows in the routing table', () => {
        renderPage();
        expect(screen.getByTestId('provider-row-copilot')).toBeDefined();
        expect(screen.getByTestId('provider-row-codex')).toBeDefined();
        expect(screen.getByTestId('provider-row-claude')).toBeDefined();
        expect(screen.getByTestId('provider-row-opencode')).toBeDefined();
    });

    it('renders provider avatars with SVG icons', () => {
        renderPage();
        const copilotRow = screen.getByTestId('provider-row-copilot');
        const svgs = copilotRow.querySelectorAll('svg');
        expect(svgs.length).toBeGreaterThanOrEqual(1);
    });

    it('renders status badges for each provider', () => {
        renderPage();
        const availableBadges = screen.getAllByText('Available');
        const unavailableBadges = screen.getAllByText('Unavailable');
        expect(availableBadges.length).toBeGreaterThanOrEqual(1);
        expect(unavailableBadges.length).toBeGreaterThanOrEqual(1);
    });

    it('renders install status badges', () => {
        renderPage();
        expect(screen.queryByTestId('sdk-install-badge-installed')).toBeDefined();
        expect(screen.getAllByTestId('sdk-install-badge-not-installed').length).toBeGreaterThanOrEqual(1);
    });

    it('renders "Built in" badge for copilot', () => {
        renderPage();
        expect(screen.getByText('Built in')).toBeDefined();
    });

    it('renders install button for not-installed providers', () => {
        renderPage();
        expect(screen.getByTestId('btn-install-claude')).toBeDefined();
    });

    it('calls onInstallSdk when install button is clicked', () => {
        const { props } = renderPage();
        fireEvent.click(screen.getByTestId('btn-install-claude'));
        expect(props.onInstallSdk).toHaveBeenCalledWith('claude');
    });

    it('shows install error when install-failed', () => {
        renderPage({
            sdkInstallStatuses: { codex: 'install-failed', claude: 'not-installed' },
            sdkInstallErrors: { codex: 'npm install failed' },
        });
        expect(screen.getByTestId('codex-install-error')).toBeDefined();
        expect(screen.getByText(/npm install failed/)).toBeDefined();
    });

    // ────────────── Default provider buttons ──────────────
    it('renders default provider buttons for each provider', () => {
        renderPage();
        expect(screen.getByTestId('select-default-provider-copilot')).toBeDefined();
        expect(screen.getByTestId('select-default-provider-codex')).toBeDefined();
        expect(screen.getByTestId('select-default-provider-claude')).toBeDefined();
    });

    it('shows "Default" on the active default provider button', () => {
        renderPage({ defaultProvider: 'copilot' });
        expect(screen.getByTestId('select-default-provider-copilot').textContent).toContain('Default');
    });

    it('shows "Make default" on non-default provider buttons', () => {
        renderPage({ defaultProvider: 'copilot' });
        expect(screen.getByTestId('select-default-provider-codex').textContent).toContain('Make default');
        expect(screen.getByTestId('select-default-provider-claude').textContent).toContain('Make default');
    });

    it('calls setDefaultProvider when a provider button is clicked', () => {
        const { props } = renderPage({ defaultProvider: 'copilot' });
        fireEvent.click(screen.getByTestId('select-default-provider-codex'));
        expect(props.setDefaultProvider).toHaveBeenCalledWith('codex');
    });

    // ────────────── Auto provider routing ──────────────
    it('shows the Auto toggle and hides the routing editor when Auto is disabled', () => {
        renderPage({ autoAgentProviderRoutingEnabled: false });

        const toggle = screen.getByTestId('toggle-auto-agent-provider-routing-enabled');
        expect(toggle.getAttribute('aria-checked')).toBe('false');
        expect(screen.getByTestId('auto-provider-routing-disabled')).toBeDefined();
        expect(screen.queryByTestId('auto-provider-rules')).toBeNull();
    });

    it('renders the first-use Auto profile when the feature flag is enabled', () => {
        renderPage({ autoAgentProviderRoutingEnabled: true });

        expect(screen.getByTestId('toggle-auto-agent-provider-routing-enabled').getAttribute('aria-checked')).toBe('true');
        expect(screen.getByTestId('auto-provider-rule-claude')).toBeDefined();
        expect(screen.getByTestId('auto-provider-rule-codex')).toBeDefined();
        expect(screen.getByTestId('auto-provider-rule-copilot')).toBeDefined();
        expect(screen.getByTestId('auto-provider-rule-opencode')).toBeDefined();
        expect((screen.getByTestId('auto-provider-threshold-claude') as HTMLInputElement).value).toBe('33');
        expect((screen.getByTestId('auto-provider-threshold-codex') as HTMLInputElement).value).toBe('33');
        expect((screen.getByTestId('auto-provider-threshold-copilot') as HTMLInputElement).value).toBe('10');
        expect((screen.getByTestId('auto-provider-threshold-opencode') as HTMLInputElement).value).toBe('25');
        expect((screen.getByTestId('auto-provider-weekly-threshold-claude') as HTMLInputElement).value).toBe('33');
        expect((screen.getByTestId('auto-provider-fallback') as HTMLSelectElement).value).toBe('copilot');
    });

    it('toggles Auto routing enablement', () => {
        const { props } = renderPage({ autoAgentProviderRoutingEnabled: false });

        fireEvent.click(screen.getByTestId('toggle-auto-agent-provider-routing-enabled'));

        expect(props.setAutoAgentProviderRoutingEnabled).toHaveBeenCalledWith(true);
    });

    it('edits Auto rule normal thresholds, weekly guard, priority, and fallback', () => {
        const { props } = renderPage({ autoAgentProviderRoutingEnabled: true });

        fireEvent.change(screen.getByTestId('auto-provider-threshold-claude'), { target: { value: '40' } });
        expect(props.setAutoRoutingConfig).toHaveBeenLastCalledWith(expect.objectContaining({
            rules: expect.arrayContaining([
                expect.objectContaining({ provider: 'claude', minimumRemainingPercent: 40 }),
            ]),
        }));

        fireEvent.click(screen.getByTestId('auto-provider-weekly-enabled-claude'));
        expect(props.setAutoRoutingConfig).toHaveBeenLastCalledWith(expect.objectContaining({
            rules: expect.arrayContaining([
                expect.objectContaining({
                    provider: 'claude',
                    weeklyGuard: expect.objectContaining({ enabled: false }),
                }),
            ]),
        }));

        fireEvent.click(screen.getByTestId('auto-provider-move-down-claude'));
        expect(props.setAutoRoutingConfig).toHaveBeenLastCalledWith(expect.objectContaining({
            rules: expect.arrayContaining([
                expect.objectContaining({ provider: 'codex' }),
                expect.objectContaining({ provider: 'claude' }),
                expect.objectContaining({ provider: 'copilot' }),
                expect.objectContaining({ provider: 'opencode' }),
            ]),
        }));

        fireEvent.change(screen.getByTestId('auto-provider-fallback'), { target: { value: 'claude' } });
        expect(props.setAutoRoutingConfig).toHaveBeenLastCalledWith(expect.objectContaining({ fallbackProvider: 'claude' }));
    });

    it('previews the concrete provider selected by Auto routing with weekly guard details', () => {
        renderPage({
            autoAgentProviderRoutingEnabled: true,
            claudeEnabled: true,
            providerAvailability: { codex: { available: true }, claude: { available: true } },
            quotaData: {
                lastUpdated: '2026-06-06T17:00:00Z',
                providers: [
                    {
                        id: 'claude',
                        quotaTypes: [
                            quotaType({ type: 'five_hour', remainingPercentage: 0.8 }),
                            quotaType({ type: 'seven_day', remainingPercentage: 0.2 }),
                        ],
                    },
                    {
                        id: 'codex',
                        quotaTypes: [
                            quotaType({ type: 'five_hour', remainingPercentage: 0.5 }),
                            quotaType({ type: 'seven_day', remainingPercentage: 0.5 }),
                        ],
                    },
                    {
                        id: 'copilot',
                        quotaTypes: [quotaType({ type: 'five_hour', remainingPercentage: 0.9 })],
                    },
                ],
            },
        });

        const preview = screen.getByTestId('auto-provider-preview');
        expect(within(preview).getByText('Codex')).toBeDefined();
        expect(screen.getByTestId('auto-provider-weekly-status-claude').textContent).toContain('below the 33% guard');
        expect(screen.getByTestId('auto-provider-rule-reason-codex').textContent).toContain('passed availability');
    });

    // ────────────── Toggle switches ──────────────
    it('renders toggle switches for codex and claude', () => {
        renderPage();
        expect(screen.getByTestId('toggle-codex-enabled')).toBeDefined();
        expect(screen.getByTestId('toggle-claude-enabled')).toBeDefined();
    });

    it('copilot toggle is disabled (locked)', () => {
        renderPage();
        const copilotRow = screen.getByTestId('provider-row-copilot');
        const toggleBtn = copilotRow.querySelector('[role="switch"]') as HTMLButtonElement;
        expect(toggleBtn.disabled).toBe(true);
    });

    it('codex toggle reflects enabled state', () => {
        renderPage({ codexEnabled: true });
        const toggle = screen.getByTestId('toggle-codex-enabled');
        expect(toggle.getAttribute('aria-checked')).toBe('true');
    });

    it('claude toggle reflects disabled state', () => {
        renderPage({ claudeEnabled: false });
        const toggle = screen.getByTestId('toggle-claude-enabled');
        expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('calls setCodexEnabled when codex toggle is clicked', () => {
        const { props } = renderPage({ codexEnabled: true });
        fireEvent.click(screen.getByTestId('toggle-codex-enabled'));
        expect(props.setCodexEnabled).toHaveBeenCalledWith(false);
    });

    it('calls setClaudeEnabled when claude toggle is clicked', () => {
        const { props } = renderPage({ claudeEnabled: false });
        fireEvent.click(screen.getByTestId('toggle-claude-enabled'));
        expect(props.setClaudeEnabled).toHaveBeenCalledWith(true);
    });

    // ────────────── Quota display ──────────────
    it('shows "No data" when quotaData is null', () => {
        renderPage({ quotaData: null });
        const quotaCells = screen.getAllByText('No data');
        expect(quotaCells.length).toBeGreaterThanOrEqual(1);
    });

    it('shows quota percentage for finite quota', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'codex',
                        quotaTypes: [quotaType({
                            type: 'requests',
                            remainingPercentage: 0.7,
                            usedRequests: 30,
                            entitlementRequests: 100,
                            resetDate: '2026-06-01',
                        })],
                    },
                ],
            },
        });
        const allMatches = screen.getAllByText('70% remaining');
        expect(allMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('renders every finite quota window as one compact row without per-window status badges', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'codex',
                        quotaTypes: [
                            quotaType({
                                type: 'five_hour',
                                remainingPercentage: 0.42,
                                usedRequests: 58,
                                entitlementRequests: 100,
                                resetDate: '2026-06-05T20:00:00Z',
                            }),
                            quotaType({
                                type: 'seven_day',
                                remainingPercentage: 0.87,
                                usedRequests: 13,
                                entitlementRequests: 100,
                                resetDate: '2026-06-12T20:00:00Z',
                            }),
                        ],
                    },
                ],
            },
        });

        const codexRow = screen.getByTestId('provider-row-codex');
        // Exactly one compact row per quota window.
        expect(codexRow.querySelectorAll('.aip-quota-row').length).toBe(2);
        expect(within(codexRow).getByText('5h')).toBeDefined();
        expect(within(codexRow).getByText('42% remaining')).toBeDefined();
        expect(within(codexRow).getByText('58 / 100 used')).toBeDefined();
        expect(within(codexRow).getByLabelText('5h quota remaining')).toBeDefined();
        expect(within(codexRow).getByText('Weekly')).toBeDefined();
        expect(within(codexRow).getByText('87% remaining')).toBeDefined();
        expect(within(codexRow).getByText('13 / 100 used')).toBeDefined();
        expect(within(codexRow).getByLabelText('Weekly quota remaining')).toBeDefined();
        // Per-window OK / Watch / Risk badges are removed from quota rows.
        expect(within(codexRow).queryByText('OK')).toBeNull();
        expect(within(codexRow).queryByText('Watch')).toBeNull();
        expect(within(codexRow).queryByText('Risk')).toBeNull();
    });

    it('no longer renders the Dreams provider activity section (relocated to the Dreams tab)', () => {
        renderPage();
        // AC-05: the queue + history card moved out of the AI Provider page.
        expect(screen.queryByTestId('provider-dream-activity')).toBeNull();
        expect(screen.queryByText('Dreams provider activity')).toBeNull();
    });

    it('renders simultaneous Claude five-hour and weekly quota windows as separate rows', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'claude',
                        quotaTypes: [
                            quotaType({
                                type: 'five_hour',
                                remainingPercentage: 0.24,
                                usedRequests: 76,
                                entitlementRequests: 100,
                                resetDate: '2026-06-05T20:00:00Z',
                            }),
                            quotaType({
                                type: 'seven_day',
                                remainingPercentage: 0.68,
                                usedRequests: 32,
                                entitlementRequests: 100,
                                resetDate: '2026-06-12T20:00:00Z',
                            }),
                        ],
                    },
                ],
            },
        });

        const claudeRow = screen.getByTestId('provider-row-claude');
        // One compact row per quota window, no duplicate per-window status badges.
        expect(claudeRow.querySelectorAll('.aip-quota-row').length).toBe(2);
        expect(within(claudeRow).getByText('5h')).toBeDefined();
        expect(within(claudeRow).getByText('24% remaining')).toBeDefined();
        expect(within(claudeRow).getByText('76 / 100 used')).toBeDefined();
        expect(within(claudeRow).getByLabelText('5h quota remaining')).toBeDefined();
        expect(within(claudeRow).getByText('Weekly')).toBeDefined();
        expect(within(claudeRow).getByText('68% remaining')).toBeDefined();
        expect(within(claudeRow).getByText('32 / 100 used')).toBeDefined();
        expect(within(claudeRow).getByLabelText('Weekly quota remaining')).toBeDefined();
        // Per-window OK / Watch / Risk badges are removed from quota rows.
        expect(within(claudeRow).queryByText('OK')).toBeNull();
        expect(within(claudeRow).queryByText('Watch')).toBeNull();
        expect(within(claudeRow).queryByText('Risk')).toBeNull();
    });

    it('keeps Copilot finite quota display on the tightest quota row', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'copilot',
                        quotaTypes: [
                            quotaType({
                                type: 'five_hour',
                                remainingPercentage: 0.72,
                                usedRequests: 28,
                                entitlementRequests: 100,
                                resetDate: '2026-06-05T20:00:00Z',
                            }),
                            quotaType({
                                type: 'seven_day',
                                remainingPercentage: 0.18,
                                usedRequests: 82,
                                entitlementRequests: 100,
                                resetDate: '2026-06-12T20:00:00Z',
                            }),
                        ],
                    },
                ],
            },
        });

        const copilotRow = screen.getByTestId('provider-row-copilot');
        expect(within(copilotRow).getByText('18% remaining')).toBeDefined();
        expect(within(copilotRow).getByText('82 / 100 used')).toBeDefined();
        expect(within(copilotRow).getByText('Risk')).toBeDefined();
        expect(within(copilotRow).queryByText('5h')).toBeNull();
        expect(within(copilotRow).queryByText('Weekly')).toBeNull();
        expect(within(copilotRow).queryByText('72% remaining')).toBeNull();
        expect(within(copilotRow).queryByLabelText('Weekly quota remaining')).toBeNull();
    });

    it('falls back to a readable label for unknown quota types', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'claude',
                        quotaTypes: [quotaType({
                            type: 'monthly-window',
                            remainingPercentage: 0.53,
                        })],
                    },
                ],
            },
        });

        const claudeRow = screen.getByTestId('provider-row-claude');
        expect(within(claudeRow).getByText('Monthly window')).toBeDefined();
        expect(within(claudeRow).getByText('53% remaining')).toBeDefined();
        expect(within(claudeRow).getByLabelText('Monthly window quota remaining')).toBeDefined();
    });

    it('shows unlimited for unlimited quota', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'copilot',
                        quotaTypes: [quotaType({
                            type: 'chat',
                            isUnlimitedEntitlement: true,
                            remainingPercentage: 1,
                            usedRequests: 0,
                            entitlementRequests: 0,
                        })],
                    },
                ],
            },
        });
        expect(screen.getByText('Unlimited')).toBeDefined();
    });

    it('shows not reported when a provider returns no quota snapshots', () => {
        renderPage({
            quotaData: {
                providers: [
                    { id: 'codex', quotaTypes: [] },
                ],
            },
        });

        const codexRow = screen.getByTestId('provider-row-codex');
        expect(within(codexRow).getByText('Not reported')).toBeDefined();
        expect(within(codexRow).getByText('Provider returned no quota snapshots')).toBeDefined();
    });

    it('shows provider quota errors without changing row controls', () => {
        renderPage({
            quotaData: {
                providers: [
                    { id: 'claude', quotaTypes: [], error: 'quota unavailable' },
                ],
            },
        });

        const claudeRow = screen.getByTestId('provider-row-claude');
        expect(within(claudeRow).getAllByText('Error').length).toBeGreaterThanOrEqual(1);
        expect(within(claudeRow).getByText('quota unavailable')).toBeDefined();
        expect(within(claudeRow).getByTestId('toggle-claude-enabled')).toBeDefined();
    });

    // ────────────── Refresh quota ──────────────
    it('renders refresh quota button', () => {
        renderPage();
        expect(screen.getByTestId('btn-refresh-quota')).toBeDefined();
    });

    it('calls onRefreshQuota with force when refresh button is clicked', () => {
        const { props } = renderPage();
        fireEvent.click(screen.getByTestId('btn-refresh-quota'));
        expect(props.onRefreshQuota).toHaveBeenCalledWith({ force: true });
    });

    it('disables refresh quota button while loading', () => {
        renderPage({ quotaLoading: true });
        const btn = screen.getByTestId('btn-refresh-quota') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    // ────────────── Quota error banner ──────────────
    it('shows quota error banner when quotaError is set', () => {
        renderPage({ quotaError: 'Failed to fetch quota' });
        expect(screen.getByTestId('quota-error-banner')).toBeDefined();
        expect(screen.getByText(/Failed to fetch quota/)).toBeDefined();
    });

    it('does not show quota error banner when quotaError is null', () => {
        renderPage({ quotaError: null });
        expect(screen.queryByTestId('quota-error-banner')).toBeNull();
    });

    // ────────────── Save/Cancel footer ──────────────
    it('renders save and cancel buttons', () => {
        renderPage();
        expect(screen.getByTestId('settings-default-provider-save')).toBeDefined();
        expect(screen.getByTestId('settings-default-provider-cancel')).toBeDefined();
    });

    it('save button is disabled when not dirty', () => {
        renderPage({ dirty: false });
        const saveBtn = screen.getByTestId('settings-default-provider-save') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(true);
    });

    it('save button is enabled when dirty', () => {
        renderPage({ dirty: true });
        const saveBtn = screen.getByTestId('settings-default-provider-save') as HTMLButtonElement;
        expect(saveBtn.disabled).toBe(false);
    });

    it('cancel button is disabled when not dirty', () => {
        renderPage({ dirty: false });
        const cancelBtn = screen.getByTestId('settings-default-provider-cancel') as HTMLButtonElement;
        expect(cancelBtn.disabled).toBe(true);
    });

    it('calls onSave when save button is clicked', () => {
        const { props } = renderPage({ dirty: true });
        fireEvent.click(screen.getByTestId('settings-default-provider-save'));
        expect(props.onSave).toHaveBeenCalled();
    });

    it('calls onCancel when cancel button is clicked', () => {
        const { props } = renderPage({ dirty: true });
        fireEvent.click(screen.getByTestId('settings-default-provider-cancel'));
        expect(props.onCancel).toHaveBeenCalled();
    });

    it('shows unsaved changes indicator when dirty', () => {
        renderPage({ dirty: true });
        expect(screen.getByText('Unsaved changes')).toBeDefined();
    });

    it('hides unsaved changes indicator when not dirty', () => {
        renderPage({ dirty: false });
        expect(screen.queryByText('Unsaved changes')).toBeNull();
    });

    // ────────────── Unavailability warnings ──────────────
    it('shows codex unavailability banner when codex is default and unavailable', () => {
        renderPage({
            defaultProvider: 'codex',
            providerAvailability: { codex: { available: false, error: 'Codex SDK not found' }, claude: { available: false } },
        });
        expect(screen.getByTestId('codex-sdk-unavailable-banner')).toBeDefined();
    });

    it('shows claude unavailability banner when claude is default and unavailable', () => {
        renderPage({
            defaultProvider: 'claude',
            providerAvailability: { codex: { available: true }, claude: { available: false, error: 'Claude SDK error' } },
        });
        expect(screen.getByTestId('claude-sdk-unavailable-banner')).toBeDefined();
    });

    it('does not show unavailability banner when default provider is available', () => {
        renderPage({
            defaultProvider: 'copilot',
            providerAvailability: { codex: { available: false }, claude: { available: false } },
        });
        expect(screen.queryByTestId('codex-sdk-unavailable-banner')).toBeNull();
        expect(screen.queryByTestId('claude-sdk-unavailable-banner')).toBeNull();
    });

    // ────────────── ProviderModelsSection integration ──────────────
    it('passes defaultProvider to ProviderModelsSection', () => {
        renderPage({ defaultProvider: 'codex' });
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-provider')).toBe('codex');
    });

    it('passes available=true for copilot provider', () => {
        renderPage({ defaultProvider: 'copilot' });
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-available')).toBe('true');
    });

    it('passes available=false when provider is disabled', () => {
        renderPage({
            defaultProvider: 'claude',
            claudeEnabled: false,
            providerAvailability: { codex: { available: true }, claude: { available: true } },
        });
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-available')).toBe('false');
    });

    it('passes unavailable message when provider is disabled', () => {
        renderPage({
            defaultProvider: 'codex',
            codexEnabled: false,
            providerAvailability: { codex: { available: true }, claude: { available: true } },
        });
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        const msg = screen.getByTestId('mock-unavailable-msg');
        expect(msg.textContent).toContain('Enable the Codex provider');
    });

    // ────────────── Quota risk summary ──────────────
    it('shows healthy quota risk when all quota is high', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'codex',
                        quotaTypes: [{
                            type: 'requests',
                            remainingPercentage: 0.9,
                            usedRequests: 10,
                            entitlementRequests: 100,
                            resetDate: '',
                            isUnlimitedEntitlement: false,
                        }],
                    },
                ],
            },
        });
        expect(screen.getByText('Healthy')).toBeDefined();
    });

    it('shows risk quota badge when quota is low', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'codex',
                        quotaTypes: [{
                            type: 'requests',
                            remainingPercentage: 0.15,
                            usedRequests: 85,
                            entitlementRequests: 100,
                            resetDate: '',
                            isUnlimitedEntitlement: false,
                        }],
                    },
                ],
            },
        });
        const allMatches = screen.getAllByText('Risk');
        expect(allMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('shows watch quota badge when quota is medium', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'codex',
                        quotaTypes: [{
                            type: 'requests',
                            remainingPercentage: 0.35,
                            usedRequests: 65,
                            entitlementRequests: 100,
                            resetDate: '',
                            isUnlimitedEntitlement: false,
                        }],
                    },
                ],
            },
        });
        const allMatches = screen.getAllByText('Watch');
        expect(allMatches.length).toBeGreaterThanOrEqual(1);
    });

    // ────────────── Provider source labels ──────────────
    it('renders provider source labels', () => {
        renderPage();
        expect(screen.getByText('default')).toBeDefined();
        const configLabels = screen.getAllByText('config');
        expect(configLabels.length).toBe(3);
    });

    // ────────────── Provider notes ──────────────
    it('renders provider notes', () => {
        renderPage();
        expect(screen.getByText('Built in provider, no SDK install needed')).toBeDefined();
        expect(screen.getByText('@openai/codex-sdk')).toBeDefined();
        expect(screen.getByText('@anthropic-ai/claude-agent-sdk')).toBeDefined();
    });

    // ────────────── Table headers ──────────────
    it('renders routing table column headers', () => {
        renderPage();
        const table = screen.getByRole('table', { name: 'Provider routing table' });
        const headers = table.querySelectorAll('th');
        const headerTexts = Array.from(headers).map(h => h.textContent?.trim());
        expect(headerTexts).toContain('Provider');
        expect(headerTexts).toContain('Status');
        expect(headerTexts).toContain('Default');
        expect(headerTexts).toContain('Quota');
        expect(headerTexts).toContain('Enabled');
    });

    // ────────────── Panel header ──────────────
    it('renders provider routing panel title and description', () => {
        renderPage();
        const allMatches = screen.getAllByText('Provider routing');
        expect(allMatches.length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/Availability, quota, install state/)).toBeDefined();
    });

    it('renders restart required badge', () => {
        renderPage();
        expect(screen.getByText('Restart required for default changes')).toBeDefined();
    });

    // ────────────── Model provider tabs ──────────────
    it('passes allProviders to ProviderModelsSection', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        expect(screen.getByTestId('mock-provider-tabs')).toBeDefined();
        expect(screen.getByTestId('mock-provider-tab-copilot')).toBeDefined();
        expect(screen.getByTestId('mock-provider-tab-codex')).toBeDefined();
        expect(screen.getByTestId('mock-provider-tab-claude')).toBeDefined();
    });

    it('defaults model provider tab to defaultProvider', () => {
        renderPage({ defaultProvider: 'codex' });
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-provider')).toBe('codex');
    });

    it('switches model provider when tab is clicked', () => {
        renderPage({ defaultProvider: 'copilot' });
        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        expect(screen.getByTestId('mock-provider-models-section').getAttribute('data-provider')).toBe('copilot');

        fireEvent.click(screen.getByTestId('mock-provider-tab-claude'));

        expect(screen.getByTestId('mock-provider-models-section').getAttribute('data-provider')).toBe('claude');
    });

    it('updates availability when switching to a disabled provider tab', () => {
        renderPage({
            defaultProvider: 'copilot',
            claudeEnabled: false,
            providerAvailability: { codex: { available: true }, claude: { available: true } },
        });

        fireEvent.click(screen.getByTestId('aip-subtab-models'));
        fireEvent.click(screen.getByTestId('mock-provider-tab-claude'));

        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-available')).toBe('false');
        const msg = screen.getByTestId('mock-unavailable-msg');
        expect(msg.textContent).toContain('Enable the Claude provider');
    });
});

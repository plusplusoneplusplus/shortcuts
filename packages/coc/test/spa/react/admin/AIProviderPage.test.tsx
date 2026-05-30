/**
 * Dedicated mock-based tests for the AIProviderPage component.
 * Tests the redesigned AI Provider admin page in isolation from AdminPanel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React, { Suspense } from 'react';
import type { AIProviderPageProps } from '../../../../src/server/spa/client/react/admin/AIProviderPage';

vi.mock('../../../../src/server/spa/client/react/features/models/ProviderModelsSection', () => ({
    ProviderModelsSection: ({ provider, available, unavailableMessage }: { provider: string; available: boolean; unavailableMessage?: string }) => (
        <div data-testid="mock-provider-models-section" data-provider={provider} data-available={String(available)}>
            {unavailableMessage && <span data-testid="mock-unavailable-msg">{unavailableMessage}</span>}
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
        providerAvailability: {
            codex: { available: true },
            claude: { available: false, error: 'SDK not installed' },
        },
        sdkInstallStatuses: {
            codex: 'installed',
            claude: 'not-installed',
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

    // ────────────── Summary grid ──────────────
    it('renders the summary grid with four cards', () => {
        renderPage();
        const grid = screen.getByTestId('aip-summary-grid');
        expect(grid).toBeDefined();
        expect(screen.getByText('Default provider')).toBeDefined();
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
        expect(screen.getByText(/2 \/ 3/)).toBeDefined();
    });

    it('shows "All providers available" when all are available', () => {
        renderPage({
            providerAvailability: {
                codex: { available: true },
                claude: { available: true },
            },
        });
        expect(screen.getByText('All providers available')).toBeDefined();
    });

    it('shows unavailable count when some providers are down', () => {
        renderPage();
        expect(screen.getByText(/1 unavailable/)).toBeDefined();
    });

    // ────────────── Provider routing table ──────────────
    it('renders three provider rows in the routing table', () => {
        renderPage();
        expect(screen.getByTestId('provider-row-copilot')).toBeDefined();
        expect(screen.getByTestId('provider-row-codex')).toBeDefined();
        expect(screen.getByTestId('provider-row-claude')).toBeDefined();
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
        expect(screen.getByTestId('sdk-install-badge-installed')).toBeDefined();
        expect(screen.getByTestId('sdk-install-badge-not-installed')).toBeDefined();
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
                        quotaTypes: [{
                            type: 'requests',
                            remainingPercentage: 0.7,
                            usedRequests: 30,
                            entitlementRequests: 100,
                            resetDate: '2026-06-01',
                            isUnlimitedEntitlement: false,
                        }],
                    },
                ],
            },
        });
        const allMatches = screen.getAllByText('70% remaining');
        expect(allMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('shows unlimited for unlimited quota', () => {
        renderPage({
            quotaData: {
                providers: [
                    {
                        id: 'copilot',
                        quotaTypes: [{
                            type: 'chat',
                            isUnlimitedEntitlement: true,
                            remainingPercentage: 1,
                            usedRequests: 0,
                            entitlementRequests: 0,
                            resetDate: '',
                        }],
                    },
                ],
            },
        });
        expect(screen.getByText('Unlimited')).toBeDefined();
    });

    // ────────────── Refresh quota ──────────────
    it('renders refresh quota button', () => {
        renderPage();
        expect(screen.getByTestId('btn-refresh-quota')).toBeDefined();
    });

    it('calls onRefreshQuota when refresh button is clicked', () => {
        const { props } = renderPage();
        fireEvent.click(screen.getByTestId('btn-refresh-quota'));
        expect(props.onRefreshQuota).toHaveBeenCalled();
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
        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-provider')).toBe('codex');
    });

    it('passes available=true for copilot provider', () => {
        renderPage({ defaultProvider: 'copilot' });
        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-available')).toBe('true');
    });

    it('passes available=false when provider is disabled', () => {
        renderPage({
            defaultProvider: 'claude',
            claudeEnabled: false,
            providerAvailability: { codex: { available: true }, claude: { available: true } },
        });
        const section = screen.getByTestId('mock-provider-models-section');
        expect(section.getAttribute('data-available')).toBe('false');
    });

    it('passes unavailable message when provider is disabled', () => {
        renderPage({
            defaultProvider: 'codex',
            codexEnabled: false,
            providerAvailability: { codex: { available: true }, claude: { available: true } },
        });
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
        expect(configLabels.length).toBe(2);
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
        expect(screen.getByText('Provider routing')).toBeDefined();
        expect(screen.getByText(/Availability, quota, install state/)).toBeDefined();
    });

    it('renders restart required badge', () => {
        renderPage();
        expect(screen.getByText('Restart required for default changes')).toBeDefined();
    });
});

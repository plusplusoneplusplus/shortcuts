import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AgentProvidersQuotaResponse, ProviderQuotaType } from '@plusplusoneplusplus/coc-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentProviderQuotaIndicator as AgentProviderQuotaIndicator } from '../../../../src/server/spa/client/react/shared/AgentProviderQuotaIndicator';

const mocks = vi.hoisted(() => ({
    getAgentProvidersQuota: vi.fn(),
    queueList: vi.fn(),
    queueHistory: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        admin: {
            getAgentProvidersQuota: mocks.getAgentProvidersQuota,
        },
        queue: {
            list: mocks.queueList,
            history: mocks.queueHistory,
        },
    }),
    getSpaCocClientErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));

function quotaType(overrides: Partial<ProviderQuotaType> & { type: string }): ProviderQuotaType {
    return {
        type: overrides.type,
        isUnlimitedEntitlement: overrides.isUnlimitedEntitlement ?? false,
        usedRequests: overrides.usedRequests ?? 0,
        entitlementRequests: overrides.entitlementRequests ?? 100,
        remainingPercentage: overrides.remainingPercentage ?? 1,
        usageAllowedWithExhaustedQuota: overrides.usageAllowedWithExhaustedQuota ?? false,
        overage: overrides.overage ?? 0,
        resetDate: overrides.resetDate,
    };
}

function quotaResponse(overrides: Partial<AgentProvidersQuotaResponse> = {}): AgentProvidersQuotaResponse {
    return {
        lastUpdated: '2026-06-06T10:00:00.000Z',
        providers: [
            { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.8, usedRequests: 20, entitlementRequests: 100 })] },
        ],
        ...overrides,
    };
}

describe('AgentProviderQuotaIndicator', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date('2026-06-06T10:02:00.000Z'));
        mocks.getAgentProvidersQuota.mockReset();
        mocks.queueList.mockReset();
        mocks.queueHistory.mockReset();
        mocks.queueList.mockResolvedValue({ queued: [], running: [], stats: {} });
        mocks.queueHistory.mockResolvedValue({ history: [] });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fills the top-bar gauge from the most constrained provider used percentage', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(quotaResponse({
            providers: [
                { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.8 })] },
                { id: 'codex', quotaTypes: [quotaType({ type: 'five_hour', remainingPercentage: 0.25 })] },
            ],
        }));

        render(<AgentProviderQuotaIndicator />);

        const button = await screen.findByTestId('agent-provider-quota-indicator');
        await waitFor(() => expect(button.getAttribute('data-state')).toBe('finite'));

        expect(button.getAttribute('data-used-percent')).toBe('75');
        const gauge = screen.getByTestId('agent-provider-quota-gauge');
        expect(gauge.getAttribute('data-used-percent')).toBe('75');
        expect(gauge.getAttribute('data-gauge-background')).toContain('75%');
        expect(mocks.getAgentProvidersQuota).toHaveBeenCalledWith(undefined);
    });

    it('is desktop-only through responsive visibility classes', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(quotaResponse());

        render(<AgentProviderQuotaIndicator />);

        const container = await screen.findByTestId('agent-provider-quota-container');
        expect(container.className).toContain('hidden');
        expect(container.className).toContain('md:block');
    });

    it('renders one dropdown row per enabled provider with every finite quota window', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(quotaResponse({
            providers: [
                {
                    id: 'copilot',
                    quotaTypes: [quotaType({
                        type: 'chat',
                        remainingPercentage: 0.85,
                        usedRequests: 15,
                        entitlementRequests: 100,
                        // +30s of slack keeps the minute-floor countdown stable under
                        // the fake timer's shouldAdvanceTime; seconds are not displayed.
                        resetDate: '2026-06-07T00:00:30.000Z',
                    })],
                },
                {
                    id: 'codex',
                    quotaTypes: [
                        quotaType({ type: 'seven_day', remainingPercentage: 0.9, usedRequests: 10, entitlementRequests: 100, resetDate: '2026-06-13T00:00:30.000Z' }),
                        quotaType({ type: 'five_hour', remainingPercentage: 0.2, usedRequests: 80, entitlementRequests: 100, resetDate: '2026-06-06T15:00:30.000Z' }),
                    ],
                },
                {
                    id: 'claude',
                    quotaTypes: [quotaType({ type: 'messages', isUnlimitedEntitlement: true })],
                },
            ],
        }));

        render(<AgentProviderQuotaIndicator />);
        fireEvent.click(await screen.findByTestId('agent-provider-quota-indicator'));

        const panel = await screen.findByTestId('agent-provider-quota-panel');
        const rows = within(panel).getAllByTestId(/^quota-provider-row-/);
        expect(rows).toHaveLength(3);

        const copilotRow = screen.getByTestId('quota-provider-row-copilot');
        expect(copilotRow.textContent).toContain('Copilot');
        expect(copilotRow.textContent).toContain('Chat');
        expect(copilotRow.textContent).toContain('15 / 100 used');
        // Minute-level reset timestamp plus a remaining-time countdown.
        expect(copilotRow.textContent).toContain('Reset 2026-06-07 00:00');
        expect(copilotRow.textContent).toContain('13h 58m left');

        const codexRow = screen.getByTestId('quota-provider-row-codex');
        expect(codexRow.textContent).toContain('Codex');
        // Both the weekly and 5h windows are now displayed.
        expect(codexRow.textContent).toContain('Weekly');
        expect(codexRow.textContent).toContain('5h');
        // The gauge stays driven by the most constrained (5h) window.
        expect(screen.getByTestId('quota-provider-gauge-codex').getAttribute('data-used-percent')).toBe('80');

        const codexWeekly = screen.getByTestId('quota-provider-window-codex-seven_day');
        expect(codexWeekly.textContent).toContain('10 / 100 used');
        // Multi-day windows collapse to a days + hours countdown.
        expect(codexWeekly.textContent).toContain('Reset 2026-06-13 00:00');
        expect(codexWeekly.textContent).toContain('6d 13h left');

        const codexFiveHour = screen.getByTestId('quota-provider-window-codex-five_hour');
        expect(codexFiveHour.textContent).toContain('80 / 100 used');
        expect(codexFiveHour.textContent).toContain('Reset 2026-06-06 15:00');
        expect(codexFiveHour.textContent).toContain('4h 58m left');

        const claudeRow = screen.getByTestId('quota-provider-row-claude');
        expect(claudeRow.textContent).toContain('Claude');
        expect(claudeRow.textContent).toContain('Unlimited');

        expect(screen.getByTestId('agent-provider-quota-last-updated').textContent).toBe('Last updated 2m ago');
        expect(screen.getByTestId('agent-provider-quota-admin-link').getAttribute('href')).toBe('#admin/agents');
    });

    it('keeps the dropdown scoped to provider quota instead of Dreams activity', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(quotaResponse({
            providers: [
                { id: 'claude', quotaTypes: [quotaType({ type: 'messages', remainingPercentage: 0.9 })] },
            ],
        }));

        render(<AgentProviderQuotaIndicator />);
        fireEvent.click(await screen.findByTestId('agent-provider-quota-indicator'));

        const panel = await screen.findByTestId('agent-provider-quota-panel');
        expect(within(panel).getByTestId('quota-provider-row-claude').textContent).toContain('Claude');
        expect(screen.queryByTestId('agent-provider-dream-activity')).toBeNull();

        fireEvent.click(screen.getByTestId('agent-provider-quota-refresh'));
        await waitFor(() => expect(mocks.getAgentProvidersQuota).toHaveBeenCalledWith({ force: true }));
        expect(mocks.queueList).not.toHaveBeenCalled();
        expect(mocks.queueHistory).not.toHaveBeenCalled();
    });

    it('marks an elapsed reset as due and handles a missing reset date', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(quotaResponse({
            providers: [
                {
                    id: 'codex',
                    quotaTypes: [
                        // Reset already in the past relative to the mocked clock.
                        quotaType({ type: 'five_hour', remainingPercentage: 0.2, usedRequests: 80, entitlementRequests: 100, resetDate: '2026-06-06T09:00:00.000Z' }),
                        // No reset date reported.
                        quotaType({ type: 'seven_day', remainingPercentage: 0.5, usedRequests: 50, entitlementRequests: 100 }),
                    ],
                },
            ],
        }));

        render(<AgentProviderQuotaIndicator />);
        fireEvent.click(await screen.findByTestId('agent-provider-quota-indicator'));

        const codexFiveHour = await screen.findByTestId('quota-provider-window-codex-five_hour');
        expect(codexFiveHour.textContent).toContain('Reset 2026-06-06 09:00 · due');
        expect(codexFiveHour.textContent).not.toContain('left');

        const codexWeekly = screen.getByTestId('quota-provider-window-codex-seven_day');
        expect(codexWeekly.textContent).toContain('Reset not reported');
    });

    it('forces a live refresh from the dropdown and updates the gauge', async () => {
        mocks.getAgentProvidersQuota
            .mockResolvedValueOnce(quotaResponse({
                providers: [
                    { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.9 })] },
                ],
            }))
            .mockResolvedValueOnce(quotaResponse({
                providers: [
                    { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.1 })] },
                ],
            }));

        render(<AgentProviderQuotaIndicator />);

        const button = await screen.findByTestId('agent-provider-quota-indicator');
        await waitFor(() => expect(button.getAttribute('data-used-percent')).toBe('10'));

        fireEvent.click(button);
        fireEvent.click(screen.getByTestId('agent-provider-quota-refresh'));

        await waitFor(() => expect(mocks.getAgentProvidersQuota).toHaveBeenCalledWith({ force: true }));
        await waitFor(() => expect(button.getAttribute('data-used-percent')).toBe('90'));
    });

    it('polls the cached endpoint and re-renders when the server cache updates', async () => {
        mocks.getAgentProvidersQuota
            .mockResolvedValueOnce(quotaResponse({
                providers: [
                    { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.7 })] },
                ],
            }))
            .mockResolvedValueOnce(quotaResponse({
                providers: [
                    { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', remainingPercentage: 0.4 })] },
                ],
            }));

        render(<AgentProviderQuotaIndicator />);

        const button = await screen.findByTestId('agent-provider-quota-indicator');
        await waitFor(() => expect(button.getAttribute('data-used-percent')).toBe('30'));

        vi.advanceTimersByTime(5 * 60 * 1000);

        await waitFor(() => expect(button.getAttribute('data-used-percent')).toBe('60'));
        expect(mocks.getAgentProvidersQuota).toHaveBeenLastCalledWith(undefined);
    });

    it('shows loading and top-level error states in the dropdown', async () => {
        let rejectInitial!: (error: Error) => void;
        mocks.getAgentProvidersQuota.mockReturnValue(new Promise((_resolve, reject) => {
            rejectInitial = reject;
        }));

        render(<AgentProviderQuotaIndicator />);
        fireEvent.click(await screen.findByTestId('agent-provider-quota-indicator'));

        expect(screen.getByTestId('agent-provider-quota-loading').textContent).toBe('Loading quota…');

        rejectInitial(new Error('quota service offline'));
        await waitFor(() => expect(screen.getByTestId('agent-provider-quota-error').textContent).toBe('quota service offline'));
        expect(screen.getByTestId('agent-provider-quota-indicator').getAttribute('data-state')).toBe('error');
    });

    it('uses a neutral top-bar state when every enabled provider is unlimited', async () => {
        mocks.getAgentProvidersQuota.mockResolvedValue(quotaResponse({
            providers: [
                { id: 'copilot', quotaTypes: [quotaType({ type: 'chat', isUnlimitedEntitlement: true })] },
                { id: 'codex', quotaTypes: [quotaType({ type: 'five_hour', isUnlimitedEntitlement: true })] },
            ],
        }));

        render(<AgentProviderQuotaIndicator />);

        const button = await screen.findByTestId('agent-provider-quota-indicator');
        await waitFor(() => expect(button.getAttribute('data-state')).toBe('neutral'));
        expect(button.getAttribute('data-used-percent')).toBe('0');
    });
});

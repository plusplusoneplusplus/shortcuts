/// <reference types="vitest/globals" />
/**
 * Component tests for PauseDurationMenu quota strip and smart "until" rows.
 *
 * Exercises the quota-derived rows added to the pause duration menu:
 * - Quota strip (one row per provider with finite quotas)
 * - "Until <provider> <type> resets" row for the most-constrained provider
 * - "Until all quotas recover" row when multiple constrained providers have resetDates
 * - Smart rows fire onSelect({ until }) with the correct epoch ms
 * - No smart rows when there are no future resetDates
 */
// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { AgentProvidersQuotaResponse } from '@plusplusoneplusplus/coc-client';
import { renderWithProviders } from '../test-utils';
import { ChatListPane } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

// ── Mutable quota state controlled per test ──────────────────────────────────
let mockQuotaData: AgentProvidersQuotaResponse | null = null;

vi.mock('../../../../src/server/spa/client/react/shared/useAgentProvidersQuota', () => ({
    useAgentProvidersQuota: () => ({
        quotaData: mockQuotaData,
        loading: false,
        refreshing: false,
        error: null,
        refresh: vi.fn(),
    }),
    AGENT_PROVIDER_QUOTA_POLL_MS: 300000,
}));

// ── Minimal mocks required by ChatListPane ───────────────────────────────────

vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        pinnedChatIds: new Set(),
        archivedChatIds: new Set(),
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
        archiveChats: vi.fn(),
        unarchiveChats: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ taskCardDensity: 'normal', showReportIntent: false }),
    invalidateDisplaySettings: vi.fn(),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createDragStartHandler: () => vi.fn(), createDragEndHandler: () => vi.fn(),
        createDragOverHandler: () => vi.fn(), createDragEnterHandler: () => vi.fn(),
        createDragLeaveHandler: () => vi.fn(), createDropHandler: () => vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createTouchStartHandler: () => vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn(), onTouchMove: vi.fn(), didLongPress: () => false }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isLoopsEnabled: () => false,
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
    isCommitChatLensEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn(),
    formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
    formatRelativeTime: (d: string) => d,
    statusLabel: (status: string) => status,
    typeLabel: (type: string) => type,
    repoName: (path: string) => path,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    buildRows: () => [{ label: 'Type', value: 'chat' }],
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

vi.mock('../../../../src/server/spa/client/react/features/schedules/ScheduledSlideSchedules', () => ({
    ScheduledSlideSchedules: () => null,
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        id: 'h-1',
        type: 'chat',
        displayName: 'History Task',
        customTitle: 'History Task',
        status: 'completed',
        completedAt: '2026-01-01T00:00:00Z',
        payload: {},
        ...overrides,
    };
}

function defaultProps(overrides: Partial<any> = {}): any {
    return {
        running: [],
        queued: [],
        history: [makeTask()],
        isPaused: false,
        isPauseResumeLoading: false,
        isRefreshing: false,
        selectedTaskId: null,
        isMobile: false,
        now: Date.now(),
        onSelectTask: vi.fn(),
        onPauseResume: vi.fn(),
        onRefresh: vi.fn(),
        onOpenDialog: vi.fn(),
        fetchQueue: vi.fn().mockResolvedValue(undefined),
        onPauseResumeAutopilot: vi.fn(),
        ...overrides,
    };
}

function renderPane(overrides: Partial<any> = {}) {
    const props = defaultProps(overrides);
    return { ...renderWithProviders(<ChatListPane {...props} />), props };
}

// A future reset timestamp: 2 hours from a fixed reference
const RESET_DATE_FUTURE = '2099-12-31T12:00:00.000Z';
const RESET_DATE_FUTURE_LATER = '2099-12-31T20:00:00.000Z';
const RESET_DATE_PAST = '2000-01-01T00:00:00.000Z';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PauseDurationMenu — quota strip and smart rows', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuotaData = null;
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    });

    function openAllMenu() {
        fireEvent.click(screen.getByTestId('repo-pause-resume-btn'));
        return screen.getByTestId('pause-duration-menu-all');
    }

    it('shows no quota strip when quotaData is null', () => {
        mockQuotaData = null;
        renderPane();
        openAllMenu();
        expect(screen.queryByTestId('pause-duration-quota-strip-all')).toBeNull();
    });

    it('shows no quota strip when all providers have errors', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{ id: 'claude', quotaTypes: [], error: 'unreachable' }],
        };
        renderPane();
        openAllMenu();
        expect(screen.queryByTestId('pause-duration-quota-strip-all')).toBeNull();
    });

    it('shows no quota strip when providers only have unlimited quotas', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'chat',
                    isUnlimitedEntitlement: true,
                    usedRequests: 0,
                    entitlementRequests: 0,
                    remainingPercentage: 1,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                }],
            }],
        };
        renderPane();
        openAllMenu();
        expect(screen.queryByTestId('pause-duration-quota-strip-all')).toBeNull();
    });

    it('shows quota strip row for provider with finite quota', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 75,
                    entitlementRequests: 100,
                    remainingPercentage: 0.25,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                    resetDate: RESET_DATE_FUTURE,
                }],
            }],
        };
        renderPane();
        openAllMenu();
        expect(screen.getByTestId('pause-duration-quota-strip-all')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-quota-row-claude')).toBeTruthy();
    });

    it('shows "until provider resets" smart row when most-constrained has a future resetDate', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 80,
                    entitlementRequests: 100,
                    remainingPercentage: 0.20,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                    resetDate: RESET_DATE_FUTURE,
                }],
            }],
        };
        renderPane();
        openAllMenu();
        expect(screen.getByTestId('pause-duration-all-until-provider-resets')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-all-until-provider-resets').textContent).toContain('claude');
        expect(screen.getByTestId('pause-duration-all-until-provider-resets').textContent).toContain('5h');
    });

    it('clicking "until provider resets" calls onPauseResume with { until: Date.parse(resetDate) }', () => {
        const onPauseResume = vi.fn();
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 80,
                    entitlementRequests: 100,
                    remainingPercentage: 0.20,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                    resetDate: RESET_DATE_FUTURE,
                }],
            }],
        };
        renderPane({ onPauseResume });
        openAllMenu();

        fireEvent.click(screen.getByTestId('pause-duration-all-until-provider-resets'));
        expect(onPauseResume).toHaveBeenCalledWith({ until: Date.parse(RESET_DATE_FUTURE) });
    });

    it('shows "until all quotas recover" when multiple constrained providers have future resetDates', () => {
        const onPauseResume = vi.fn();
        mockQuotaData = {
            lastUpdated: null,
            providers: [
                {
                    id: 'claude',
                    quotaTypes: [{
                        type: 'five_hour',
                        isUnlimitedEntitlement: false,
                        usedRequests: 85,
                        entitlementRequests: 100,
                        remainingPercentage: 0.15,
                        usageAllowedWithExhaustedQuota: false,
                        overage: 0,
                        resetDate: RESET_DATE_FUTURE,
                    }],
                },
                {
                    id: 'copilot',
                    quotaTypes: [{
                        type: 'seven_day',
                        isUnlimitedEntitlement: false,
                        usedRequests: 60,
                        entitlementRequests: 100,
                        remainingPercentage: 0.40,
                        usageAllowedWithExhaustedQuota: false,
                        overage: 0,
                        resetDate: RESET_DATE_FUTURE_LATER,
                    }],
                },
            ],
        };
        renderPane({ onPauseResume });
        openAllMenu();

        // Both smart rows should be visible
        expect(screen.getByTestId('pause-duration-all-until-provider-resets')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-all-until-all-recover')).toBeTruthy();

        // "Until all" uses the later of the two reset dates
        fireEvent.click(screen.getByTestId('pause-duration-all-until-all-recover'));
        expect(onPauseResume).toHaveBeenCalledWith({ until: Date.parse(RESET_DATE_FUTURE_LATER) });
    });

    it('hides "until all quotas recover" when only one constrained provider (same as single-provider row)', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 80,
                    entitlementRequests: 100,
                    remainingPercentage: 0.20,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                    resetDate: RESET_DATE_FUTURE,
                }],
            }],
        };
        renderPane();
        openAllMenu();
        // Single provider → only show per-provider row, not the "all" row (they'd be identical)
        expect(screen.getByTestId('pause-duration-all-until-provider-resets')).toBeTruthy();
        expect(screen.queryByTestId('pause-duration-all-until-all-recover')).toBeNull();
    });

    it('hides smart rows when resetDate is in the past', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 90,
                    entitlementRequests: 100,
                    remainingPercentage: 0.10,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                    resetDate: RESET_DATE_PAST,
                }],
            }],
        };
        renderPane();
        openAllMenu();
        // Past resetDate → no smart rows
        expect(screen.queryByTestId('pause-duration-all-until-provider-resets')).toBeNull();
        expect(screen.queryByTestId('pause-duration-all-until-all-recover')).toBeNull();
    });

    it('hides smart rows when resetDate is absent', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 90,
                    entitlementRequests: 100,
                    remainingPercentage: 0.10,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                }],
            }],
        };
        renderPane();
        openAllMenu();
        expect(screen.queryByTestId('pause-duration-all-until-provider-resets')).toBeNull();
        expect(screen.queryByTestId('pause-duration-all-until-all-recover')).toBeNull();
    });

    it('skips providers with errors when computing smart rows', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [
                { id: 'claude', quotaTypes: [], error: 'unreachable' },
                {
                    id: 'codex',
                    quotaTypes: [{
                        type: 'five_hour',
                        isUnlimitedEntitlement: false,
                        usedRequests: 80,
                        entitlementRequests: 100,
                        remainingPercentage: 0.20,
                        usageAllowedWithExhaustedQuota: false,
                        overage: 0,
                        resetDate: RESET_DATE_FUTURE,
                    }],
                },
            ],
        };
        renderPane();
        openAllMenu();
        // Strip shows only the non-errored codex row
        expect(screen.queryByTestId('pause-duration-quota-row-claude')).toBeNull();
        expect(screen.getByTestId('pause-duration-quota-row-codex')).toBeTruthy();
        // Smart row uses codex
        expect(screen.getByTestId('pause-duration-all-until-provider-resets').textContent).toContain('codex');
    });

    it('gives primary label buttons a theme-aware text color (legible in dark mode, not pure white)', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 80,
                    entitlementRequests: 100,
                    remainingPercentage: 0.20,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                    resetDate: RESET_DATE_FUTURE,
                }],
            }],
        };
        renderPane();
        openAllMenu();

        // Primary label buttons must set an explicit theme-aware text color, matching the
        // app's primary-text token (text-[#1e1e1e] dark:text-[#cccccc]) — not pure white.
        const primaryButtons = [
            'pause-duration-all-indefinite',
            'pause-duration-all-1h',
            'pause-duration-all-until-provider-resets',
        ];
        for (const testId of primaryButtons) {
            const btn = screen.getByTestId(testId);
            expect(btn.className).toContain('text-[#1e1e1e]');
            expect(btn.className).toContain('dark:text-[#cccccc]');
            expect(btn.className).not.toContain('dark:text-[#fff]');
            expect(btn.className).not.toContain('dark:text-white');
        }
    });

    it('preserves existing duration presets alongside quota rows', () => {
        mockQuotaData = {
            lastUpdated: null,
            providers: [{
                id: 'claude',
                quotaTypes: [{
                    type: 'five_hour',
                    isUnlimitedEntitlement: false,
                    usedRequests: 80,
                    entitlementRequests: 100,
                    remainingPercentage: 0.20,
                    usageAllowedWithExhaustedQuota: false,
                    overage: 0,
                    resetDate: RESET_DATE_FUTURE,
                }],
            }],
        };
        renderPane();
        openAllMenu();
        // Original presets still present
        expect(screen.getByTestId('pause-duration-all-indefinite')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-all-1h')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-all-2h')).toBeTruthy();
    });
});

/// <reference types="vitest/globals" />
/**
 * Component tests for the pause pills (ALL / AP) quota-aware visual changes.
 *
 * Exercises the three new behaviors added in Part B:
 * 1. Running-state dot color changes based on quota risk (safe/watch/risk).
 * 2. % tail appended to the pill label when running and remainingPercent < 50.
 * 3. QUOTA inline badge shown when paused with pauseSource / autopilotPauseSource === 'quota'.
 */
// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen } from '@testing-library/react';
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

/** Build a provider quota data object with a given remainingPercentage (0–1). */
function makeQuotaData(remainingPercentage: number): AgentProvidersQuotaResponse {
    return {
        lastUpdated: null,
        providers: [{
            id: 'claude',
            quotaTypes: [{
                type: 'five_hour',
                isUnlimitedEntitlement: false,
                usedRequests: Math.round((1 - remainingPercentage) * 100),
                entitlementRequests: 100,
                remainingPercentage,
                usageAllowedWithExhaustedQuota: false,
                overage: 0,
            }],
        }],
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Pause pills — quota-aware visuals', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuotaData = null;
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    });

    // ── 1. Running-state dot color ────────────────────────────────────────────

    describe('running-state dot color', () => {
        it('ALL dot has emerald class when quotaData is null (safe)', () => {
            mockQuotaData = null;
            renderPane();
            const allBtn = screen.getByTestId('repo-pause-resume-btn');
            const dot = allBtn.querySelector('[aria-hidden="true"]');
            expect(dot?.className).toContain('bg-emerald-500');
        });

        it('ALL dot has emerald class when remaining >= 50% (safe)', () => {
            mockQuotaData = makeQuotaData(0.75); // 75% remaining
            renderPane();
            const allBtn = screen.getByTestId('repo-pause-resume-btn');
            const dot = allBtn.querySelector('[aria-hidden="true"]');
            expect(dot?.className).toContain('bg-emerald-500');
        });

        it('ALL dot has amber class when 25% <= remaining < 50% (watch)', () => {
            mockQuotaData = makeQuotaData(0.35); // 35% remaining
            renderPane();
            const allBtn = screen.getByTestId('repo-pause-resume-btn');
            const dot = allBtn.querySelector('[aria-hidden="true"]');
            expect(dot?.className).toContain('bg-amber-500');
            // Not pulsing (that's paused state only)
            expect(dot?.className).not.toContain('animate-pulse');
        });

        it('ALL dot has red class when remaining < 25% (risk)', () => {
            mockQuotaData = makeQuotaData(0.10); // 10% remaining
            renderPane();
            const allBtn = screen.getByTestId('repo-pause-resume-btn');
            const dot = allBtn.querySelector('[aria-hidden="true"]');
            expect(dot?.className).toContain('bg-red-500');
            expect(dot?.className).not.toContain('animate-pulse');
        });

        it('ALL dot keeps amber + pulse when paused regardless of quota', () => {
            mockQuotaData = makeQuotaData(0.10); // risk-level quota
            renderPane({ isPaused: true, pauseSource: 'manual' });
            const allBtn = screen.getByTestId('repo-pause-resume-btn');
            const dot = allBtn.querySelector('[aria-hidden="true"]');
            expect(dot?.className).toContain('bg-amber-500');
            expect(dot?.className).toContain('animate-pulse');
        });

        it('AP dot has red class when remaining < 25% (risk) and not paused', () => {
            mockQuotaData = makeQuotaData(0.10); // 10% remaining
            renderPane({ isAutopilotPaused: false });
            const apBtn = screen.getByTestId('autopilot-pause-resume-btn');
            const dot = apBtn.querySelector('[aria-hidden="true"]');
            expect(dot?.className).toContain('bg-red-500');
            expect(dot?.className).not.toContain('animate-pulse');
        });

        it('AP dot keeps amber + pulse when autopilot is paused regardless of quota', () => {
            mockQuotaData = makeQuotaData(0.10); // risk-level quota
            renderPane({ isAutopilotPaused: true, autopilotPauseSource: 'quota' });
            const apBtn = screen.getByTestId('autopilot-pause-resume-btn');
            const dot = apBtn.querySelector('[aria-hidden="true"]');
            expect(dot?.className).toContain('bg-amber-500');
            expect(dot?.className).toContain('animate-pulse');
        });
    });

    // ── 2. % tail ────────────────────────────────────────────────────────────

    describe('% tail in running state', () => {
        it('shows no % tail when safe (>= 50%)', () => {
            mockQuotaData = makeQuotaData(0.60);
            renderPane();
            expect(screen.queryByTestId('pause-pill-quota-pct-all')).toBeNull();
        });

        it('shows % tail on ALL pill when watch (35%)', () => {
            mockQuotaData = makeQuotaData(0.35);
            renderPane();
            const tail = screen.getByTestId('pause-pill-quota-pct-all');
            expect(tail.textContent).toContain('35%');
            expect(tail.className).toContain('amber');
        });

        it('shows % tail on ALL pill when risk (10%) with red color', () => {
            mockQuotaData = makeQuotaData(0.10);
            renderPane();
            const tail = screen.getByTestId('pause-pill-quota-pct-all');
            expect(tail.textContent).toContain('10%');
            expect(tail.className).toContain('red');
        });

        it('shows % tail on AP pill when risk (10%)', () => {
            mockQuotaData = makeQuotaData(0.10);
            renderPane();
            const tail = screen.getByTestId('pause-pill-quota-pct-ap');
            expect(tail.textContent).toContain('10%');
        });

        it('hides % tail on ALL pill when paused (even at risk quota)', () => {
            mockQuotaData = makeQuotaData(0.10);
            renderPane({ isPaused: true, pauseSource: 'manual' });
            expect(screen.queryByTestId('pause-pill-quota-pct-all')).toBeNull();
        });

        it('hides % tail on AP pill when autopilot paused', () => {
            mockQuotaData = makeQuotaData(0.10);
            renderPane({ isAutopilotPaused: true, autopilotPauseSource: 'quota' });
            expect(screen.queryByTestId('pause-pill-quota-pct-ap')).toBeNull();
        });
    });

    // ── 3. QUOTA badge ───────────────────────────────────────────────────────

    describe('QUOTA badge when paused', () => {
        it('shows QUOTA badge on ALL pill when paused with pauseSource === "quota"', () => {
            renderPane({ isPaused: true, pauseSource: 'quota' });
            const badge = screen.getByTestId('pause-pill-quota-badge-all');
            expect(badge.textContent).toBe('QUOTA');
        });

        it('does not show QUOTA badge on ALL pill when paused with pauseSource === "manual"', () => {
            renderPane({ isPaused: true, pauseSource: 'manual' });
            expect(screen.queryByTestId('pause-pill-quota-badge-all')).toBeNull();
        });

        it('does not show QUOTA badge on ALL pill when paused with no pauseSource', () => {
            renderPane({ isPaused: true });
            expect(screen.queryByTestId('pause-pill-quota-badge-all')).toBeNull();
        });

        it('does not show QUOTA badge on ALL pill when not paused', () => {
            renderPane({ isPaused: false, pauseSource: 'quota' });
            expect(screen.queryByTestId('pause-pill-quota-badge-all')).toBeNull();
        });

        it('shows QUOTA badge on AP pill when autopilot paused with autopilotPauseSource === "quota"', () => {
            renderPane({ isAutopilotPaused: true, autopilotPauseSource: 'quota' });
            const badge = screen.getByTestId('pause-pill-quota-badge-ap');
            expect(badge.textContent).toBe('QUOTA');
        });

        it('does not show QUOTA badge on AP pill when autopilot paused with autopilotPauseSource === "manual"', () => {
            renderPane({ isAutopilotPaused: true, autopilotPauseSource: 'manual' });
            expect(screen.queryByTestId('pause-pill-quota-badge-ap')).toBeNull();
        });

        it('does not show QUOTA badge on AP pill when not paused', () => {
            renderPane({ isAutopilotPaused: false, autopilotPauseSource: 'quota' });
            expect(screen.queryByTestId('pause-pill-quota-badge-ap')).toBeNull();
        });
    });
});

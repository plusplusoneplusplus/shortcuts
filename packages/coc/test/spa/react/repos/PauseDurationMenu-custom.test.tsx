/// <reference types="vitest/globals" />
/**
 * Component tests for the PauseDurationMenu "Custom…" float-hours row and
 * fractional-hour formatting of PauseMarkerRow.
 *
 * Covers:
 * - Custom row renders in both the ALL and AP (autopilot) menus
 * - Float value submitted as { durationHours } on Enter and via the ✓ button
 * - Invalid values (0, -1, 25, empty, non-numeric) rejected inline without
 *   closing the menu or invoking the pause callback
 * - PauseMarkerRow renders fractional durations as "Xh Ym" (e.g. 1.5 → 1h 30m)
 */
// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
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
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
    isChatFoldersEnabled: () => false,
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isCronEnabled: () => false,
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
        onSetTaskDelay: vi.fn().mockResolvedValue(undefined),
        onSkipTaskDelay: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    };
}

function renderPane(overrides: Partial<any> = {}) {
    const props = defaultProps(overrides);
    return { ...renderWithProviders(<ChatListPane {...props} />), props };
}

function openAllMenu() {
    fireEvent.click(screen.getByTestId('repo-pause-resume-btn'));
    return screen.getByTestId('pause-duration-menu-all');
}

function openAutopilotMenu() {
    fireEvent.click(screen.getByTestId('autopilot-pause-resume-btn'));
    return screen.getByTestId('pause-duration-menu-autopilot');
}

function submitCustomValue(scope: string, value: string, via: 'enter' | 'button' = 'enter') {
    fireEvent.click(screen.getByTestId(`pause-duration-${scope}-custom`));
    const input = screen.getByTestId(`pause-duration-${scope}-custom-input`);
    fireEvent.change(input, { target: { value } });
    if (via === 'enter') {
        fireEvent.keyDown(input, { key: 'Enter' });
    } else {
        fireEvent.click(screen.getByTestId(`pause-duration-${scope}-custom-submit`));
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PauseDurationMenu — Custom… float-hours row', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuotaData = null;
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    });

    it('renders the Custom… row in the ALL menu below the presets', () => {
        renderPane();
        openAllMenu();
        expect(screen.getByTestId('pause-duration-all-custom')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-all-custom').textContent).toContain('Custom');
        // Presets are unchanged alongside the custom row
        for (const hours of [1, 2, 3, 4, 8]) {
            expect(screen.getByTestId(`pause-duration-all-${hours}h`)).toBeTruthy();
        }
    });

    it('renders the Custom… row in the AP (autopilot) menu', () => {
        renderPane();
        openAutopilotMenu();
        expect(screen.getByTestId('pause-duration-autopilot-custom')).toBeTruthy();
    });

    it('clicking Custom… reveals the inline number input', () => {
        renderPane();
        openAllMenu();
        expect(screen.queryByTestId('pause-duration-all-custom-input')).toBeNull();
        fireEvent.click(screen.getByTestId('pause-duration-all-custom'));
        expect(screen.getByTestId('pause-duration-all-custom-input')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-all-custom-submit')).toBeTruthy();
    });

    it('submits a float durationHours on Enter (ALL scope)', () => {
        const { props } = renderPane();
        openAllMenu();
        submitCustomValue('all', '1.5', 'enter');
        expect(props.onPauseResume).toHaveBeenCalledWith({ durationHours: 1.5 });
        // Menu closes after a successful selection
        expect(screen.queryByTestId('pause-duration-menu-all')).toBeNull();
    });

    it('submits a float durationHours via the ✓ button (AP scope)', () => {
        const { props } = renderPane();
        openAutopilotMenu();
        submitCustomValue('autopilot', '0.5', 'button');
        expect(props.onPauseResumeAutopilot).toHaveBeenCalledWith({ durationHours: 0.5 });
        expect(screen.queryByTestId('pause-duration-menu-autopilot')).toBeNull();
    });

    it('accepts integer custom values too', () => {
        const { props } = renderPane();
        openAllMenu();
        submitCustomValue('all', '12', 'enter');
        expect(props.onPauseResume).toHaveBeenCalledWith({ durationHours: 12 });
    });

    for (const invalid of ['0', '-1', '25', '']) {
        it(`rejects invalid value "${invalid}" inline without closing the menu`, () => {
            const { props } = renderPane();
            openAllMenu();
            submitCustomValue('all', invalid, 'enter');
            expect(props.onPauseResume).not.toHaveBeenCalled();
            expect(screen.getByTestId('pause-duration-all-custom-error').textContent)
                .toContain('greater than 0 and at most 24');
            // Menu and input stay open for correction
            expect(screen.getByTestId('pause-duration-menu-all')).toBeTruthy();
            expect(screen.getByTestId('pause-duration-all-custom-input')).toBeTruthy();
        });
    }

    it('rejects non-numeric input inline', () => {
        // jsdom number inputs sanitize non-numeric text to '', which must also be rejected
        const { props } = renderPane();
        openAllMenu();
        submitCustomValue('all', 'abc', 'enter');
        expect(props.onPauseResume).not.toHaveBeenCalled();
        expect(screen.getByTestId('pause-duration-all-custom-error')).toBeTruthy();
        expect(screen.getByTestId('pause-duration-menu-all')).toBeTruthy();
    });

    it('clears the inline error when the value is edited', () => {
        renderPane();
        openAllMenu();
        submitCustomValue('all', '0', 'enter');
        expect(screen.getByTestId('pause-duration-all-custom-error')).toBeTruthy();
        fireEvent.change(screen.getByTestId('pause-duration-all-custom-input'), { target: { value: '2' } });
        expect(screen.queryByTestId('pause-duration-all-custom-error')).toBeNull();
    });
});

describe('PauseDurationMenu — delay between tasks', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuotaData = null;
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    });

    it('renders the shared presets and marks Off active by default', () => {
        renderPane();
        openAllMenu();

        for (const value of ['off', '1', '5', '15', '30', '60']) {
            expect(screen.getByTestId(`task-delay-all-${value}`)).toBeTruthy();
        }
        expect(screen.getByTestId('task-delay-all-off').textContent).toContain('✓');
    });

    it('applies a preset to the scope that opened the menu and closes on success', async () => {
        const onSetTaskDelay = vi.fn().mockResolvedValue(undefined);
        renderPane({ onSetTaskDelay });
        openAutopilotMenu();
        fireEvent.click(screen.getByTestId('task-delay-autopilot-15'));

        await waitFor(() => expect(onSetTaskDelay).toHaveBeenCalledWith('autopilot', 15));
        await waitFor(() => expect(screen.queryByTestId('pause-duration-menu-autopilot')).toBeNull());
    });

    it('marks the matching configured preset active independently by scope', () => {
        renderPane({ taskDelayMinutes: 5, autopilotTaskDelayMinutes: 30 });
        openAllMenu();
        expect(screen.getByTestId('task-delay-all-5').textContent).toContain('✓');
        expect(screen.getByTestId('task-delay-all-30').textContent).not.toContain('✓');
    });

    it('shows a non-preset active value on the Custom row', () => {
        renderPane({ taskDelayMinutes: 7 });
        openAllMenu();
        expect(screen.getByTestId('task-delay-all-custom').textContent).toContain('Custom… (7m)');
        expect(screen.getByTestId('task-delay-all-custom').textContent).toContain('✓');
    });

    it('submits custom integer minutes and supports turning the delay off', async () => {
        const onSetTaskDelay = vi.fn().mockResolvedValue(undefined);
        renderPane({ taskDelayMinutes: 5, onSetTaskDelay });
        openAllMenu();
        fireEvent.click(screen.getByTestId('task-delay-all-custom'));
        const input = screen.getByTestId('task-delay-all-custom-input');
        fireEvent.change(input, { target: { value: '1440' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        await waitFor(() => expect(onSetTaskDelay).toHaveBeenCalledWith('all', 1440));

        openAllMenu();
        fireEvent.click(screen.getByTestId('task-delay-all-off'));
        await waitFor(() => expect(onSetTaskDelay).toHaveBeenLastCalledWith('all', null));
    });

    for (const invalid of ['0', '1.5', '1441', '']) {
        it(`rejects invalid custom minutes "${invalid}" inline`, () => {
            const onSetTaskDelay = vi.fn().mockResolvedValue(undefined);
            renderPane({ onSetTaskDelay });
            openAllMenu();
            fireEvent.click(screen.getByTestId('task-delay-all-custom'));
            const input = screen.getByTestId('task-delay-all-custom-input');
            fireEvent.change(input, { target: { value: invalid } });
            fireEvent.keyDown(input, { key: 'Enter' });

            expect(onSetTaskDelay).not.toHaveBeenCalled();
            expect(screen.getByTestId('task-delay-all-custom-error').textContent)
                .toContain('whole number of minutes from 1 to 1440');
        });
    }

    it('disables the section while a request is pending', async () => {
        let resolveRequest!: () => void;
        const onSetTaskDelay = vi.fn(() => new Promise<void>(resolve => { resolveRequest = resolve; }));
        renderPane({ onSetTaskDelay });
        openAllMenu();
        fireEvent.click(screen.getByTestId('task-delay-all-5'));

        expect(screen.getByTestId('task-delay-all-off')).toBeDisabled();
        expect(screen.getByTestId('task-delay-all-custom')).toBeDisabled();
        resolveRequest();
        await waitFor(() => expect(screen.queryByTestId('pause-duration-menu-all')).toBeNull());
    });

    it('keeps the prior value checked and shows an inline request error', async () => {
        const onSetTaskDelay = vi.fn().mockRejectedValue(new Error('Could not save delay'));
        renderPane({ taskDelayMinutes: 5, onSetTaskDelay });
        openAllMenu();
        fireEvent.click(screen.getByTestId('task-delay-all-15'));

        await waitFor(() => expect(screen.getByTestId('task-delay-all-custom-error').textContent).toContain('Could not save delay'));
        expect(screen.getByTestId('task-delay-all-5').textContent).toContain('✓');
        expect(screen.getByTestId('pause-duration-menu-all')).toBeTruthy();
    });

    it('shows scope-specific cooldown countdowns and hides expired deadlines', () => {
        const now = 1_800_000_000_000;
        renderPane({
            now,
            taskDelayUntil: now + 5 * 60_000,
            autopilotTaskDelayUntil: now + 30_000,
        });

        expect(screen.getByTestId('task-delay-countdown-all').textContent).toBe('next in 5m');
        expect(screen.getByTestId('task-delay-countdown-autopilot').textContent).toBe('next in 30s');
    });

    it('does not show a cooldown countdown without a future deadline', () => {
        const now = 1_800_000_000_000;
        renderPane({ now, taskDelayUntil: now });

        expect(screen.queryByTestId('task-delay-countdown-all')).toBeNull();
        expect(screen.queryByTestId('task-delay-countdown-autopilot')).toBeNull();
    });

    it('gives manual pause text precedence over a cooldown countdown', () => {
        const now = 1_800_000_000_000;
        renderPane({
            now,
            isPaused: true,
            pausedUntil: now + 2 * 60_000,
            taskDelayUntil: now + 5 * 60_000,
        });

        expect(screen.getByLabelText('▶ Resume all tasks').textContent).toBe('2m');
        expect(screen.queryByTestId('task-delay-countdown-all')).toBeNull();
    });

    it('skips only the pending scope and keeps the configured delay', async () => {
        const now = 1_800_000_000_000;
        const onSkipTaskDelay = vi.fn().mockResolvedValue(undefined);
        renderPane({
            now,
            taskDelayMinutes: 5,
            taskDelayUntil: now + 5 * 60_000,
            onSkipTaskDelay,
        });
        openAllMenu();

        expect(screen.getByTestId('task-delay-all-5').textContent).toContain('✓');
        expect(screen.queryByTestId('task-delay-autopilot-skip')).toBeNull();
        fireEvent.click(screen.getByTestId('task-delay-all-skip'));

        await waitFor(() => expect(onSkipTaskDelay).toHaveBeenCalledWith('all'));
        await waitFor(() => expect(screen.queryByTestId('pause-duration-menu-all')).toBeNull());
        expect(screen.queryByTestId('task-delay-countdown-all')).toBeTruthy();
    });

    it('keeps the menu open and reports a skip failure inline', async () => {
        const now = 1_800_000_000_000;
        const onSkipTaskDelay = vi.fn().mockRejectedValue(new Error('Could not skip delay'));
        renderPane({ now, taskDelayUntil: now + 60_000, onSkipTaskDelay });
        openAllMenu();
        fireEvent.click(screen.getByTestId('task-delay-all-skip'));

        await waitFor(() => expect(screen.getByTestId('task-delay-all-custom-error').textContent).toContain('Could not skip delay'));
        expect(screen.getByTestId('pause-duration-menu-all')).toBeTruthy();
    });
});

describe('PauseDurationMenu — per-section custom hours in the insert menu', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuotaData = null;
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ markerId: 'pm-new' }), {
            status: 201,
            headers: { 'content-type': 'application/json' },
        }));
    });

    function openInsertMenu() {
        const insertZone = screen.getByTestId('pause-insert-zone-0');
        fireEvent.mouseEnter(insertZone);
        fireEvent.click(insertZone);
    }

    it('keeps the two sections\' custom editors independent', () => {
        renderPane({ workspaceId: 'ws-1', queued: [{ id: 'q-1', displayName: 'Queued' }] });
        openInsertMenu();

        fireEvent.click(screen.getByTestId('pause-duration-insert-0-autopilot-custom'));
        expect(screen.getByTestId('pause-duration-insert-0-autopilot-custom-input')).toBeTruthy();
        // Opening the autopilot editor must not open the all-scope one.
        expect(screen.queryByTestId('pause-duration-insert-0-custom-input')).toBeNull();
        expect(screen.getByTestId('pause-duration-insert-0-custom')).toBeTruthy();
    });

    it('submits a custom autopilot duration with scope=autopilot', async () => {
        const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
        renderPane({ workspaceId: 'ws-1', queued: [{ id: 'q-1', displayName: 'Queued' }] });
        openInsertMenu();

        submitCustomValue('insert-0-autopilot', '1.5');

        await waitFor(() => {
            const call = fetchMock.mock.calls.find(
                (c: any[]) => typeof c[0] === 'string' && c[0].includes('/queue/pause-marker'),
            );
            expect(call).toBeTruthy();
            expect(JSON.parse(call![1].body)).toEqual({
                afterIndex: 0,
                repoId: 'ws-1',
                durationHours: 1.5,
                scope: 'autopilot',
            });
        });
    });

    it('rejects an out-of-range autopilot custom value without inserting', async () => {
        const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
        renderPane({ workspaceId: 'ws-1', queued: [{ id: 'q-1', displayName: 'Queued' }] });
        openInsertMenu();

        submitCustomValue('insert-0-autopilot', '25');

        expect(screen.getByTestId('pause-duration-insert-0-autopilot-custom-error')).toBeTruthy();
        expect(fetchMock.mock.calls.some(
            (c: any[]) => typeof c[0] === 'string' && c[0].includes('/queue/pause-marker'),
        )).toBe(false);
    });
});

describe('PauseMarkerRow — fractional-hour formatting', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockQuotaData = null;
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    });

    it('renders 1.5 hours as "1h 30m" in label and tooltip', () => {
        renderPane({
            queued: [{ id: 'pm-timed', kind: 'pause-marker', durationHours: 1.5 }],
        });
        expect(screen.getByText('Queue pauses here · 1h 30m')).toBeTruthy();
        expect(screen.getByTestId('pause-marker-row').getAttribute('title'))
            .toContain('pause for 1h 30m');
    });

    it('renders an autopilot-scoped fractional duration with the autopilot wording', () => {
        renderPane({
            queued: [{ id: 'pm-timed', kind: 'pause-marker', scope: 'autopilot', durationHours: 1.5 }],
        });
        expect(screen.getByText('Autopilot pauses here · 1h 30m')).toBeTruthy();
        expect(screen.getByTestId('pause-marker-row').getAttribute('title'))
            .toContain('Autopilot tasks will pause for 1h 30m');
    });

    it('renders sub-hour durations as minutes only', () => {
        renderPane({
            queued: [{ id: 'pm-timed', kind: 'pause-marker', durationHours: 0.5 }],
        });
        expect(screen.getByText('Queue pauses here · 30m')).toBeTruthy();
    });

    it('keeps whole hours as "Xh" with no minutes suffix', () => {
        renderPane({
            queued: [{ id: 'pm-timed', kind: 'pause-marker', durationHours: 2 }],
        });
        expect(screen.getByText('Queue pauses here · 2h')).toBeTruthy();
    });
});

/**
 * Render tests for ChatListPane.
 *
 * Dropped source-level tests that inspected code text rather than behavior:
 *   - Export name checks (TASK_TYPE_LABELS, QueueTaskItem, …)
 *   - TypeScript interface shape assertions (ChatListPaneProps)
 *   - Import existence checks (useChatPrefs, useDisplaySettings, …)
 *   - State variable declaration checks (useState calls)
 *   - useMemo dependency-array inspections
 *   - CSS class-name literal searches on source text
 *   - Context-menu item builder coverage via source parsing
 *
 * These ~110 tests exercise the component from the outside through
 * renderWithProviders + screen queries, asserting visible output,
 * data attributes, callbacks, and context-menu behaviour.
 */

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import {
    ChatListPane,
    buildHistoryRangeRows,
    getForEachRunRangeId,
    getMapReduceRunRangeId,
    getRalphSessionRangeId,
    resolveGroupSelectionState,
    resolveHistoryRangeSelection,
    taskMatchesFilter,
    taskMatchesSearch,
    getTaskTypeIcon,
    getTaskPromptPreview,
    getTaskModeKey,
    getTaskModeLabel,
} from '../../../../src/server/spa/client/react/features/chat/ChatListPane';
import { POINTER_CONTEXT_DRAG_MIME, SESSION_CONTEXT_DRAG_MIME } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { readSessionContextDropPayloads } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { groupBySpawnedTree, type SpawnedTreeEntry } from '../../../../src/server/spa/client/react/features/chat/spawned-tree-grouping';
import {
    drainNewChatSeedContext,
    peekNewChatSeedContext,
    resetNewChatSeedContext,
} from '../../../../src/server/spa/client/react/features/chat/newChatSeedContext';

// ── Mocks ──────────────────────────────────────────────────────────────

// Portal passthrough so ContextMenu renders inline
vi.mock('react-dom', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-dom')>();
    return { ...actual, createPortal: (children: React.ReactNode) => children };
});

// ContextMenu — render items as flat buttons for easy querying
vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: ({ items, onClose }: any) => (
        <div data-testid="context-menu">
            {items.filter((i: any) => !i.separator).map((item: any, idx: number) => (
                <button
                    key={idx}
                    onClick={() => { item.onClick(); onClose(); }}
                    disabled={item.disabled}
                    data-testid={`context-menu-item-${idx}`}
                >
                    {item.icon} {item.label}
                </button>
            ))}
        </div>
    ),
}));

// ── Chat preferences (mutable module-level state) ──
let mockPinnedChatIds = new Set<string>();
let mockArchivedChatIds = new Set<string>();
const mockPinChat = vi.fn();
const mockUnpinChat = vi.fn();
const mockArchiveChat = vi.fn();
const mockUnarchiveChat = vi.fn();
const mockArchiveChats = vi.fn();
const mockUnarchiveChats = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    ChatPrefsSync: () => null,
    useChatPrefs: () => ({
        pinnedChatIds: mockPinnedChatIds,
        archivedChatIds: mockArchivedChatIds,
        pinChat: mockPinChat,
        unpinChat: mockUnpinChat,
        archiveChat: mockArchiveChat,
        unarchiveChat: mockUnarchiveChat,
        archiveChats: mockArchiveChats,
        unarchiveChats: mockUnarchiveChats,
    }),
}));

// ── Display settings ──
let mockDisplaySettings = { taskCardDensity: 'normal' as string, showReportIntent: false };
let mockSessionContextAttachmentsEnabled = false;
vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => mockDisplaySettings,
    invalidateDisplaySettings: vi.fn(),
}));

// ── Queue drag-drop (desktop) ──
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createDragStartHandler: () => vi.fn(), createDragEndHandler: () => vi.fn(),
        createDragOverHandler: () => vi.fn(), createDragEnterHandler: () => vi.fn(),
        createDragLeaveHandler: () => vi.fn(), createDropHandler: () => vi.fn(),
    }),
}));

// ── Queue touch drag ──
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createTouchStartHandler: () => vi.fn(),
    }),
}));

// ── Long-press ──
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn(), onTouchMove: vi.fn(), didLongPress: () => false }),
}));

// ── Draft store ──
const mockGetDraft = vi.fn().mockReturnValue(null);
vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: (id: string) => mockGetDraft(id),
}));

// ── Workflow progress ──
vi.mock('../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => null,
}));

// ── Agent providers quota (prevent network calls from useAgentProvidersQuota in ChatListPane) ──
vi.mock('../../../../src/server/spa/client/react/shared/useAgentProvidersQuota', () => ({
    useAgentProvidersQuota: () => ({ quotaData: null, loading: false, refreshing: false, error: null, refresh: vi.fn() }),
    AGENT_PROVIDER_QUOTA_POLL_MS: 300000,
}));

// ── Utilities / config ──
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isLoopsEnabled: () => false,
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => mockSessionContextAttachmentsEnabled,
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn(),
    formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
    formatRelativeTime: (d: string) => d,
    statusLabel: (status: string, _type?: string) => status,
    typeLabel: (type: string) => type,
    repoName: (path: string) => path,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    buildRows: () => [{ label: 'Type', value: 'chat' }],
}));

// ── Swipeable wrapper — passthrough ──
vi.mock('../../../../src/server/spa/client/react/features/chat/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Summarize dialog — stub ──
vi.mock('../../../../src/server/spa/client/react/features/chat/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));

// ── useBreakpoint (used by Dialog inside RenameDialog) ──
vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// ── Factory helpers ────────────────────────────────────────────────────

function makeTask(overrides: Record<string, any> = {}): Record<string, any> {
    const base = {
        id: 'task-1',
        type: 'chat',
        displayName: 'Test Task',
        status: 'completed',
        completedAt: '2026-01-01T00:00:00Z',
        payload: {},
        ...overrides,
    };
    // For sidebar tests: mirror displayName to customTitle by default unless
    // explicitly overridden, since the sidebar reads customTitle (not
    // displayName) for chat-row titles after the rename feature.
    if (!('customTitle' in overrides) && typeof base.displayName === 'string') {
        (base as any).customTitle = base.displayName;
    }
    return base;
}

function makeRunningTask(overrides: Record<string, any> = {}) {
    return makeTask({
        id: 'run-1', status: 'running', displayName: 'Running Task',
        startedAt: '2026-01-01T00:00:00Z', completedAt: undefined, ...overrides,
    });
}

function makeQueuedTask(overrides: Record<string, any> = {}) {
    return makeTask({
        id: 'q-1', status: 'queued', displayName: 'Queued Task',
        completedAt: undefined, ...overrides,
    });
}

function makeHistoryTask(overrides: Record<string, any> = {}) {
    return makeTask({ id: 'h-1', status: 'completed', displayName: 'History Task', ...overrides });
}

// ── Default props ──────────────────────────────────────────────────────

function defaultProps(overrides: Partial<any> = {}): any {
    return {
        running: [],
        queued: [],
        history: [],
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
        ...overrides,
    };
}

function renderPane(overrides: Partial<any> = {}) {
    const props = defaultProps(overrides);
    return { ...renderWithProviders(<ChatListPane {...props} />), props };
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

describe('ChatListPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPinnedChatIds = new Set();
        mockArchivedChatIds = new Set();
        mockDisplaySettings = { taskCardDensity: 'normal', showReportIntent: false };
        mockSessionContextAttachmentsEnabled = false;
        mockGetDraft.mockReturnValue(null);
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        // Reset persisted scope so each test sees the default ('all'). The
        // Activity-tab scope segmented control writes to this key.
        try { window.localStorage.removeItem('coc-activity-scope'); } catch { /* ignore */ }
        // jsdom has no layout engine so offsetParent is always null.
        // Mock it to return document.body for connected elements so the
        // visibility guard in ChatListPane's Ctrl+F handler behaves correctly.
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            get() { return this.isConnected ? document.body : null; },
            configurable: true,
        });
    });

    // ── Empty state ────────────────────────────────────────────────────
    describe('Empty state', () => {
        it('shows "No tasks in queue" when all arrays empty', () => {
            renderPane();
            expect(screen.getByTestId('queue-empty-state')).toBeTruthy();
            expect(screen.getByText(/No tasks in queue/)).toBeTruthy();
        });

        it('shows repository-specific message when workspaceId set', () => {
            renderPane({ workspaceId: 'ws-1' });
            expect(screen.getByText('No tasks in queue for this repository')).toBeTruthy();
        });

        it('shows "Queue is paused" when paused and empty', () => {
            renderPane({ isPaused: true });
            expect(screen.getByText('Queue is paused')).toBeTruthy();
        });

        it('shows empty state text when not paused', () => {
            renderPane();
            expect(screen.getByText(/No tasks in queue/)).toBeTruthy();
        });

        it('shows refreshing indicator when isRefreshing and empty', () => {
            renderPane({ isRefreshing: true });
            expect(screen.getByTestId('queue-refreshing-indicator')).toBeTruthy();
            expect(screen.getByText('Refreshing…')).toBeTruthy();
        });

        // ── Activity empty-state "+ New" button ─────────────────────────
        describe('Activity empty-state "+ New" button', () => {
            // AC-01: repo-scoped Activity tab empty state shows a desktop-visible
            // "+ New" action when there are no entries and no server search.
            it('renders "+ New" on the repo-scoped Activity tab empty state', () => {
                renderPane({ workspaceId: 'ws-1', onNewChat: vi.fn() });
                const btn = screen.getByTestId('activity-empty-new-chat-btn');
                expect(btn).toBeTruthy();
                expect(btn.textContent).toContain('+ New');
                // Desktop-visible: not hidden when not mobile.
                expect(btn.className).not.toContain('hidden');
            });

            // AC-02: clicking "+ New" runs the same new-chat flow (onNewChat).
            it('invokes onNewChat when "+ New" is clicked', () => {
                const onNewChat = vi.fn();
                renderPane({ workspaceId: 'ws-1', onNewChat });
                fireEvent.click(screen.getByTestId('activity-empty-new-chat-btn'));
                expect(onNewChat).toHaveBeenCalledTimes(1);
            });

            // AC-03: not rendered on the Tasks (queue) tab — scope unchanged.
            it('does not render "+ New" on the Tasks tab empty state', () => {
                renderPane({ workspaceId: 'ws-1', onNewChat: vi.fn(), activeTab: 'tasks' });
                expect(screen.queryByTestId('activity-empty-new-chat-btn')).toBeNull();
            });

            // AC-03: not rendered on the Chats tab empty state ("No chats yet").
            it('does not render "+ New" on the Chats tab empty state', () => {
                renderPane({ workspaceId: 'ws-1', onNewChat: vi.fn(), activeTab: 'chats' });
                expect(screen.queryByTestId('activity-empty-new-chat-btn')).toBeNull();
                expect(screen.getByText('No chats yet')).toBeTruthy();
            });

            // AC-03: paused empty state still shows Resume and no "+ New".
            it('keeps the paused empty state (Resume only, no "+ New")', () => {
                renderPane({ workspaceId: 'ws-1', onNewChat: vi.fn(), isPaused: true });
                expect(screen.getByTestId('repo-pause-resume-btn-empty')).toBeTruthy();
                expect(screen.getByText('Queue is paused')).toBeTruthy();
                expect(screen.queryByTestId('activity-empty-new-chat-btn')).toBeNull();
            });

            // AC-01/Constraints: requires a repo scope (workspaceId).
            it('does not render "+ New" without a workspaceId', () => {
                renderPane({ onNewChat: vi.fn() });
                expect(screen.queryByTestId('activity-empty-new-chat-btn')).toBeNull();
            });

            // AC-03: when no onNewChat handler is wired (e.g. global Processes
            // view), the inline action is absent.
            it('does not render "+ New" when onNewChat is not provided', () => {
                renderPane({ workspaceId: 'ws-1' });
                expect(screen.queryByTestId('activity-empty-new-chat-btn')).toBeNull();
            });

            // AC-03: on mobile the inline button is hidden and the FAB remains.
            it('hides the inline "+ New" on mobile but keeps the FAB', () => {
                renderPane({ workspaceId: 'ws-1', onNewChat: vi.fn(), isMobile: true });
                expect(screen.getByTestId('activity-empty-new-chat-btn').className).toContain('hidden');
                expect(screen.getByTestId('mobile-new-chat-fab-empty')).toBeTruthy();
            });

            // AC-03: server search active suppresses the empty state entirely,
            // so the "+ New" action is not shown (search-results path is used).
            it('does not render "+ New" while a server search is active', () => {
                renderPane({ workspaceId: 'ws-1', onNewChat: vi.fn(), searchResults: [] });
                expect(screen.queryByTestId('queue-empty-state')).toBeNull();
                expect(screen.queryByTestId('activity-empty-new-chat-btn')).toBeNull();
            });
        });
    });

    // ── Banners ────────────────────────────────────────────────────────
    describe('Banners', () => {
        it('shows queue paused banner when isPaused', () => {
            renderPane({ isPaused: true, history: [makeHistoryTask()] });
            expect(screen.getByTestId('queue-paused-banner')).toBeTruthy();
        });

        it('banner shows pause reason with task name', () => {
            renderPane({
                isPaused: true,
                pauseReason: { taskId: 'x', displayName: 'My Task', failedAt: new Date().toISOString() },
                history: [makeHistoryTask()],
            });
            expect(screen.getByText('My Task')).toBeTruthy();
        });

        it('shows View Task button when pauseReason present', () => {
            renderPane({
                isPaused: true,
                pauseReason: { taskId: 'x', displayName: 'My Task', failedAt: new Date().toISOString() },
                history: [makeHistoryTask()],
            });
            expect(screen.getByTestId('queue-banner-view-task-btn')).toBeTruthy();
        });

        it('does not render a redundant Paused badge when paused (banner is sufficient)', () => {
            renderPane({ isPaused: true, history: [makeHistoryTask()] });
            // The banner already communicates paused state; no separate badge should exist
            expect(screen.getByTestId('queue-paused-banner')).toBeTruthy();
            expect(screen.queryByText('Paused')).toBeNull();
        });

    });

    // ── Toolbar ────────────────────────────────────────────────────────
    describe('Toolbar', () => {
        it('renders refresh button', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.getByTestId('queue-refresh-btn')).toBeTruthy();
        });

        it('pause button shows only the ALL scope tag when not paused (color signals state)', () => {
            renderPane({ history: [makeHistoryTask()] });
            const text = screen.getByTestId('repo-pause-resume-btn').textContent ?? '';
            expect(text).toContain('ALL');
            // The running/idle state is communicated by the green dot + scope-tag
            // colour — no redundant "ON" copy clutters the pill.
            expect(text).not.toContain('ON');
            expect(text).not.toContain('PAUSED');
        });

        it('pause button reveals PAUSED label when paused indefinitely', () => {
            renderPane({ isPaused: true, history: [makeHistoryTask()] });
            const text = screen.getByTestId('repo-pause-resume-btn').textContent ?? '';
            expect(text).toContain('ALL');
            expect(text).toContain('PAUSED');
        });

        it('opens duration menu and pauses all tasks for selected hours', () => {
            const onPauseResume = vi.fn();
            renderPane({ history: [makeHistoryTask()], onPauseResume });

            fireEvent.click(screen.getByTestId('repo-pause-resume-btn'));
            expect(screen.getByTestId('pause-duration-menu-all')).toBeTruthy();

            fireEvent.click(screen.getByTestId('pause-duration-all-2h'));
            expect(onPauseResume).toHaveBeenCalledWith({ durationHours: 2 });
        });

        it('closes the all-tasks duration menu on outside click', () => {
            renderPane({ history: [makeHistoryTask()] });

            fireEvent.click(screen.getByTestId('repo-pause-resume-btn'));
            expect(screen.getByTestId('pause-duration-menu-all')).toBeTruthy();

            fireEvent.mouseDown(document.body);
            expect(screen.queryByTestId('pause-duration-menu-all')).toBeNull();
        });

        it('opens duration menu and pauses autopilot tasks for selected hours', () => {
            const onPauseResumeAutopilot = vi.fn();
            renderPane({
                history: [makeHistoryTask()],
                onPauseResumeAutopilot,
            });

            fireEvent.click(screen.getByTestId('autopilot-pause-resume-btn'));
            expect(screen.getByTestId('pause-duration-menu-autopilot')).toBeTruthy();

            fireEvent.click(screen.getByTestId('pause-duration-autopilot-3h'));
            expect(onPauseResumeAutopilot).toHaveBeenCalledWith({ durationHours: 3 });
        });

        it('closes the autopilot duration menu on outside click', () => {
            renderPane({
                history: [makeHistoryTask()],
                onPauseResumeAutopilot: vi.fn(),
            });

            fireEvent.click(screen.getByTestId('autopilot-pause-resume-btn'));
            expect(screen.getByTestId('pause-duration-menu-autopilot')).toBeTruthy();

            fireEvent.mouseDown(document.body);
            expect(screen.queryByTestId('pause-duration-menu-autopilot')).toBeNull();
        });

        it('shows timed pause remaining in banners and toolbar labels', () => {
            const now = Date.parse('2026-01-01T00:00:00Z');
            const pausedUntil = now + 90 * 60 * 1000;
            renderPane({
                isPaused: true,
                pausedUntil,
                isAutopilotPaused: true,
                autopilotPausedUntil: pausedUntil,
                onPauseResumeAutopilot: vi.fn(),
                history: [makeHistoryTask()],
                now,
            });

            expect(screen.getByTestId('queue-paused-banner').textContent).toContain('1h 30m');
            // Action-bar pause pill renders the remaining label inline next to the
            // ALL / AP scope tag (e.g. "ALL · 1h 30m"). Both scopes share the same
            // formatter so the substring assertion remains the contract.
            expect(screen.getByTestId('repo-pause-resume-btn').textContent).toContain('1h 30m');
            expect(screen.getByTestId('autopilot-pause-resume-btn').textContent).toContain('1h 30m');
        });

        // The running/idle pill state is signalled by colour alone (no "ON"
        // copy), so the ALL / AP label font must track the status dot: emerald
        // when running, amber when paused. The emerald label is chosen so the
        // pill stays legible in dark mode — regression guard against reverting
        // to the previous muted-gray label that was hard to read on dark bg.
        const findScopeLabel = (btnTestId: string, text: string) =>
            Array.from(screen.getByTestId(btnTestId).querySelectorAll('span'))
                .find(el => el.textContent === text);

        it('ALL/AP labels use the emerald status color when running', () => {
            renderPane({ history: [makeHistoryTask()], onPauseResumeAutopilot: vi.fn() });
            for (const [btn, text] of [
                ['repo-pause-resume-btn', 'ALL'],
                ['autopilot-pause-resume-btn', 'AP'],
            ] as const) {
                const label = findScopeLabel(btn, text);
                expect(label?.className).toContain('text-emerald-700');
                expect(label?.className).toContain('dark:text-emerald-400');
                expect(label?.className).not.toContain('#9d9d9d');
            }
        });

        it('ALL/AP labels switch to the amber status color when paused', () => {
            renderPane({
                isPaused: true,
                isAutopilotPaused: true,
                onPauseResumeAutopilot: vi.fn(),
                history: [makeHistoryTask()],
            });
            for (const [btn, text] of [
                ['repo-pause-resume-btn', 'ALL'],
                ['autopilot-pause-resume-btn', 'AP'],
            ] as const) {
                const label = findScopeLabel(btn, text);
                expect(label?.className).toContain('text-amber-700');
                expect(label?.className).toContain('dark:text-amber-400');
            }
        });

        // ── Activity-compact action bar layout ─────────────────────────
        // The ChatListPane action bar matches the activity-compact reference:
        //   [+ New chat ⌘N] [↺] [● ALL ON | ● AP ON]
        // Both Pause All and Pause AP toggles must remain visible in a single
        // split pill; the pause functionality is unchanged from the legacy
        // "⏸ All / ⏸ AP" buttons.
        it('action bar groups New chat, refresh, and split pause pill into one row', () => {
            renderPane({
                history: [makeHistoryTask()],
                onPauseResumeAutopilot: vi.fn(),
            });
            const newChatBtn = screen.getByTestId('toolbar-new-chat-btn');
            const refreshBtn = screen.getByTestId('queue-refresh-btn');
            const pauseGroup = screen.getByTestId('pause-toggle-group');
            const allBtn = screen.getByTestId('repo-pause-resume-btn');
            const apBtn = screen.getByTestId('autopilot-pause-resume-btn');

            expect(newChatBtn).toBeTruthy();
            expect(refreshBtn).toBeTruthy();
            expect(pauseGroup).toBeTruthy();
            // Both pause toggles live inside the same split pill container.
            expect(pauseGroup.contains(allBtn)).toBe(true);
            expect(pauseGroup.contains(apBtn)).toBe(true);
        });

        it('action bar, scope tabs, and search share a tight gap-1.5 toolbar wrapper', () => {
            // The three header rows (action bar / scope tabs / search) get
            // their own sub-container with `gap-1.5` (6px) so they sit closer
            // together than the parent's `gap-2 md:gap-3` would allow. This
            // also means each row no longer needs an `mb-*` margin of its own.
            renderPane({
                history: [makeHistoryTask()],
                onPauseResumeAutopilot: vi.fn(),
            });
            const newChatBtn = screen.getByTestId('toolbar-new-chat-btn');
            const scopeTabs = screen.getByTestId('activity-scope-tabs');
            // The search input is hidden until Ctrl+F reveals it.
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            const searchInput = screen.getByTestId('queue-search-input');

            const actionBar = newChatBtn.parentElement!;
            const wrapper = actionBar.parentElement!;
            const wrapperClass = wrapper.className ?? '';
            expect(wrapperClass).toContain('flex-col');
            expect(wrapperClass).toContain('gap-1.5');

            expect(wrapper.contains(scopeTabs)).toBe(true);
            expect(wrapper.contains(searchInput)).toBe(true);

            // The action bar itself no longer carries a redundant bottom margin
            // — the wrapper's gap is the single source of vertical rhythm.
            expect(actionBar.className).not.toContain('mb-1.5');
            expect(actionBar.className).not.toContain('md:mb-3');
        });

        it('keeps the activity controls sticky above the scrolling task list', () => {
            renderPane({
                history: [makeHistoryTask()],
                onPauseResumeAutopilot: vi.fn(),
            });

            const fixedHeader = screen.getByTestId('chat-list-fixed-header');
            const pane = screen.getByTestId('chat-list-pane');
            const newChatBtn = screen.getByTestId('toolbar-new-chat-btn');
            // The search input is hidden until Ctrl+F reveals it.
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            const searchInput = screen.getByTestId('queue-search-input');
            const completedHeader = screen.getByText('Completed Tasks').closest('[data-section="completed"]');

            expect(fixedHeader.className).toContain('sticky');
            expect(fixedHeader.className).toContain('top-0');
            // Compact top/bottom padding: the sticky header uses a tight
            // vertical rhythm (`py-1.5 md:py-2`) rather than the looser
            // `py-2 md:py-4`, keeping the New chat + scope controls close to
            // the section edges.
            const fixedHeaderClasses = fixedHeader.className.split(/\s+/);
            expect(fixedHeaderClasses).toContain('py-1.5');
            expect(fixedHeaderClasses).toContain('md:py-2');
            expect(fixedHeaderClasses).not.toContain('py-2');
            expect(fixedHeaderClasses).not.toContain('md:py-4');
            // The sticky header full-bleeds to the scroll container's horizontal
            // edges (`-mx-*`). Regression guard for the "gap above the New chat
            // panel": the scroll container must NOT carry TOP padding, because a
            // `sticky top-0` header clamps to the padding edge — so any top padding
            // shows as an empty gap above the panel that a negative header margin
            // cannot cancel. Horizontal + bottom padding stay.
            expect(fixedHeader.className).toContain('-mx-2');
            expect(fixedHeader.className).toContain('md:-mx-4');
            const paneClasses = pane.className.split(/\s+/);
            expect(paneClasses).not.toContain('p-2');
            expect(paneClasses).not.toContain('md:p-4');
            expect(paneClasses).not.toContain('pt-2');
            expect(paneClasses).not.toContain('md:pt-4');
            expect(paneClasses).toContain('pb-2');
            expect(paneClasses).toContain('md:pb-4');
            expect(fixedHeader.contains(newChatBtn)).toBe(true);
            expect(fixedHeader.contains(searchInput)).toBe(true);
            expect(completedHeader && fixedHeader.contains(completedHeader)).toBe(false);
            expect(completedHeader && pane.contains(completedHeader)).toBe(true);
        });

        it('AP pause button shows only the AP scope tag when not paused', () => {
            renderPane({
                history: [makeHistoryTask()],
                onPauseResumeAutopilot: vi.fn(),
            });
            const text = screen.getByTestId('autopilot-pause-resume-btn').textContent ?? '';
            expect(text).toContain('AP');
            expect(text).not.toContain('ON');
            expect(text).not.toContain('PAUSED');
        });

        it('AP pause button reveals PAUSED label when autopilot is paused indefinitely', () => {
            renderPane({
                isAutopilotPaused: true,
                onPauseResumeAutopilot: vi.fn(),
                history: [makeHistoryTask()],
            });
            const text = screen.getByTestId('autopilot-pause-resume-btn').textContent ?? '';
            expect(text).toContain('AP');
            expect(text).toContain('PAUSED');
        });

        it('omits the AP pause toggle when no autopilot pause handler is provided', () => {
            renderPane({
                history: [makeHistoryTask()],
                onPauseResumeAutopilot: undefined,
            });
            expect(screen.queryByTestId('autopilot-pause-resume-btn')).toBeNull();
            expect(screen.getByTestId('repo-pause-resume-btn')).toBeTruthy();
        });

        it('New chat button always shows the "New chat" label and a keyboard hint', () => {
            renderPane({ history: [makeHistoryTask()] });
            const btn = screen.getByTestId('toolbar-new-chat-btn');
            expect(btn.textContent ?? '').toContain('New chat');
            // ⌘N or Ctrl+N depending on the host platform — both tokens are accepted.
            expect((btn.textContent ?? '').match(/⌘N|Ctrl\+N/)).not.toBeNull();
        });

        it('New chat button blends with the theme (light surface in light mode, dark surface in dark mode, no border)', () => {
            renderPane({ history: [makeHistoryTask()] });
            const btn = screen.getByTestId('toolbar-new-chat-btn');
            const cls = btn.className ?? '';
            // Theme-matching surfaces, mirroring NewChatArea + Send button.
            expect(cls).toContain('bg-[#f3f3f3]');
            expect(cls).toContain('dark:bg-[#1e1e1e]');
            expect(cls).toContain('text-[#1e1e1e]');
            expect(cls).toContain('dark:text-white');
            // Regression: the high-contrast outline border was removed when the
            // button switched from "stand-out CTA" to "blend with surface".
            expect(cls).not.toMatch(/(^|\s)border(\s|$)/);
            expect(cls).not.toContain('border-[#1e1e1e]');
            expect(cls).not.toContain('dark:border-[#cccccc]');
        });

        it('⌘N (or Ctrl+N) triggers the New chat handler when the activity pane is visible', () => {
            const onNewChat = vi.fn();
            renderPane({ history: [makeHistoryTask()], onNewChat });

            // jsdom defaults navigator.platform to "" — Ctrl+N is the platform-neutral
            // fallback. The handler intercepts both ⌘N and Ctrl+N to stay portable.
            fireEvent.keyDown(document, { key: 'n', ctrlKey: true });
            expect(onNewChat).toHaveBeenCalledTimes(1);
        });

        it('⌘N falls through to onOpenDialog when no onNewChat handler is provided', () => {
            const onOpenDialog = vi.fn();
            renderPane({ history: [makeHistoryTask()], onOpenDialog });

            fireEvent.keyDown(document, { key: 'n', metaKey: true });
            expect(onOpenDialog).toHaveBeenCalledTimes(1);
        });
    });

    // ── Activity scope tabs ────────────────────────────────────────────
    describe('Activity scope tabs (Chats / Automations / All)', () => {
        function makeMixedFixture() {
            const chatA = makeHistoryTask({ id: 'chat-a', type: 'chat', displayName: 'Chat A' });
            const chatB = makeHistoryTask({ id: 'chat-b', type: 'chat', displayName: 'Chat B' });
            const scriptA = makeHistoryTask({ id: 'scr-a', type: 'run-script', displayName: 'Script A' });
            const wfA = makeHistoryTask({ id: 'wf-a', type: 'run-workflow', displayName: 'Workflow A' });
            return [chatA, chatB, scriptA, wfA];
        }

        it('renders the scope tabs container in the Activity branch (no activeTab prop)', () => {
            renderPane({ history: makeMixedFixture() });
            expect(screen.getByTestId('activity-scope-tabs')).toBeTruthy();
            expect(screen.getByTestId('activity-scope-tab-chat')).toBeTruthy();
            expect(screen.getByTestId('activity-scope-tab-auto')).toBeTruthy();
            expect(screen.getByTestId('activity-scope-tab-all')).toBeTruthy();
        });

        it('does not render the scope tabs in the Chats branch (activeTab="chats")', () => {
            renderPane({ history: makeMixedFixture(), activeTab: 'chats' });
            expect(screen.queryByTestId('activity-scope-tabs')).toBeNull();
        });

        it('does not render the scope tabs in the Tasks branch (activeTab="tasks")', () => {
            renderPane({ history: makeMixedFixture(), activeTab: 'tasks' });
            expect(screen.queryByTestId('activity-scope-tabs')).toBeNull();
        });

        it('shows correct counts for chat / auto / all', () => {
            renderPane({ history: makeMixedFixture() });
            expect(screen.getByTestId('activity-scope-count-chat').textContent).toBe('2');
            expect(screen.getByTestId('activity-scope-count-auto').textContent).toBe('2');
            expect(screen.getByTestId('activity-scope-count-all').textContent).toBe('4');
        });

        it('counts include running, queued (non-pause-marker) and history tasks', () => {
            renderPane({
                running: [makeRunningTask({ id: 'run-chat', type: 'chat' })],
                queued: [
                    makeQueuedTask({ id: 'q-script', type: 'run-script' }),
                    { id: 'pause', kind: 'pause-marker' } as any,
                ],
                history: [
                    makeHistoryTask({ id: 'h-chat', type: 'chat' }),
                    makeHistoryTask({ id: 'h-wf', type: 'run-workflow' }),
                ],
            });
            expect(screen.getByTestId('activity-scope-count-chat').textContent).toBe('2');
            expect(screen.getByTestId('activity-scope-count-auto').textContent).toBe('2');
            expect(screen.getByTestId('activity-scope-count-all').textContent).toBe('4');
        });

        it('default scope is "all" — every row is visible', () => {
            renderPane({ history: makeMixedFixture() });
            expect(screen.getByTestId('activity-scope-tab-all').getAttribute('data-active')).toBe('true');
            expect(screen.getByText('Chat A')).toBeTruthy();
            expect(screen.getByText('Chat B')).toBeTruthy();
            expect(screen.getByText('Script A')).toBeTruthy();
            expect(screen.getByText('Workflow A')).toBeTruthy();
        });

        it('clicking the Chats tab hides automations and keeps chats', () => {
            renderPane({ history: makeMixedFixture() });
            fireEvent.click(screen.getByTestId('activity-scope-tab-chat'));
            expect(screen.getByTestId('activity-scope-tab-chat').getAttribute('data-active')).toBe('true');
            expect(screen.getByTestId('activity-scope-tab-all').getAttribute('data-active')).toBeNull();
            expect(screen.getByText('Chat A')).toBeTruthy();
            expect(screen.getByText('Chat B')).toBeTruthy();
            expect(screen.queryByText('Script A')).toBeNull();
            expect(screen.queryByText('Workflow A')).toBeNull();
        });

        it('clicking the Automations tab hides chats and keeps run-script + run-workflow', () => {
            renderPane({ history: makeMixedFixture() });
            fireEvent.click(screen.getByTestId('activity-scope-tab-auto'));
            expect(screen.getByTestId('activity-scope-tab-auto').getAttribute('data-active')).toBe('true');
            expect(screen.queryByText('Chat A')).toBeNull();
            expect(screen.queryByText('Chat B')).toBeNull();
            expect(screen.getByText('Script A')).toBeTruthy();
            expect(screen.getByText('Workflow A')).toBeTruthy();
        });

        it('persists the active scope across remounts via localStorage', () => {
            const { unmount } = renderPane({ history: makeMixedFixture() });
            fireEvent.click(screen.getByTestId('activity-scope-tab-auto'));
            expect(window.localStorage.getItem('coc-activity-scope')).toBe('auto');
            unmount();

            renderPane({ history: makeMixedFixture() });
            expect(screen.getByTestId('activity-scope-tab-auto').getAttribute('data-active')).toBe('true');
            expect(screen.queryByText('Chat A')).toBeNull();
            expect(screen.getByText('Script A')).toBeTruthy();
        });

        it('falls back to "all" when localStorage holds an invalid value', () => {
            window.localStorage.setItem('coc-activity-scope', 'bogus');
            renderPane({ history: makeMixedFixture() });
            expect(screen.getByTestId('activity-scope-tab-all').getAttribute('data-active')).toBe('true');
        });

        it('treats work-item executions as automations (not chats)', () => {
            const workItem = makeHistoryTask({
                id: 'wi-1',
                type: 'chat',
                displayName: 'Work Item Run',
                workItemId: 'wi-123',
            });
            renderPane({ history: [...makeMixedFixture(), workItem] });
            expect(screen.getByTestId('activity-scope-count-chat').textContent).toBe('2');
            expect(screen.getByTestId('activity-scope-count-auto').textContent).toBe('2');
            expect(screen.getByTestId('activity-scope-count-all').textContent).toBe('5');

            fireEvent.click(screen.getByTestId('activity-scope-tab-chat'));
            expect(screen.queryByText('Work Item Run')).toBeNull();
        });

        it('shows zero count for empty buckets (e.g. only chats present → auto count = 0)', () => {
            renderPane({
                history: [
                    makeHistoryTask({ id: 'c1', type: 'chat' }),
                    makeHistoryTask({ id: 'c2', type: 'chat' }),
                ],
            });
            expect(screen.getByTestId('activity-scope-count-chat').textContent).toBe('2');
            expect(screen.getByTestId('activity-scope-count-auto').textContent).toBe('0');
            expect(screen.getByTestId('activity-scope-count-all').textContent).toBe('2');
        });

        it('exposes role="tablist" and aria-selected on the active tab', () => {
            renderPane({ history: makeMixedFixture() });
            expect(screen.getByTestId('activity-scope-tabs').getAttribute('role')).toBe('tablist');
            expect(screen.getByTestId('activity-scope-tab-all').getAttribute('aria-selected')).toBe('true');
            expect(screen.getByTestId('activity-scope-tab-chat').getAttribute('aria-selected')).toBe('false');

            fireEvent.click(screen.getByTestId('activity-scope-tab-chat'));
            expect(screen.getByTestId('activity-scope-tab-chat').getAttribute('aria-selected')).toBe('true');
            expect(screen.getByTestId('activity-scope-tab-all').getAttribute('aria-selected')).toBe('false');
        });
    });

    // ── Running Tasks section ──────────────────────────────────────────
    describe('Running Tasks section', () => {
        it('shows section header with count', () => {
            renderPane({ running: [makeRunningTask()] });
            const toggle = screen.getByTestId('running-tasks-section-toggle');
            expect(toggle.textContent).toContain('Running Tasks');
            expect(toggle.textContent).toContain('1');
        });

        it('hides section when no running tasks', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.queryByTestId('running-tasks-section-toggle')).toBeNull();
        });

        it('shows task display name', () => {
            renderPane({ running: [makeRunningTask({ displayName: 'Build App' })] });
            expect(screen.getByText('Build App')).toBeTruthy();
        });

        it('shows mode pill for ask mode', () => {
            const { container } = renderPane({ running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })] });
            expect(container.textContent).toContain('A');
        });

        it('clicking task calls onSelectTask', () => {
            const { props } = renderPane({ running: [makeRunningTask()] });
            const card = document.querySelector('[data-task-id="run-1"]');
            fireEvent.click(card!);
            expect(props.onSelectTask).toHaveBeenCalledWith('run-1', expect.anything());
        });

        it('collapsing section hides task cards', () => {
            renderPane({ running: [makeRunningTask()] });
            expect(document.querySelector('[data-task-id="run-1"]')).toBeTruthy();
            fireEvent.click(screen.getByTestId('running-tasks-section-toggle'));
            expect(document.querySelector('[data-task-id="run-1"]')).toBeNull();
        });

        it('shows "Thinking" indicator when the task is running without pending ask_user', () => {
            renderPane({ running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })] });
            expect(screen.queryByTestId('thinking-indicator')).toBeTruthy();
            expect(screen.queryByTestId('awaiting-input-indicator')).toBeNull();
            const row = document.querySelector('[data-task-id="run-1"]') as HTMLElement | null;
            expect(row).toBeTruthy();
            expect(row!.getAttribute('data-awaiting-input')).toBeNull();
        });

        it('renders "Needs input" indicator when awaitingInputProcessIds contains the task id', () => {
            renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })],
                awaitingInputProcessIds: new Set(['run-1']),
            });
            const indicator = screen.queryByTestId('awaiting-input-indicator');
            expect(indicator).toBeTruthy();
            expect(indicator!.textContent).toContain('Needs input');
            expect(screen.queryByTestId('thinking-indicator')).toBeNull();
            const row = document.querySelector('[data-task-id="run-1"]') as HTMLElement | null;
            expect(row).toBeTruthy();
            expect(row!.getAttribute('data-awaiting-input')).toBe('true');
            expect(row!.getAttribute('title')).toContain('waiting for your input');
            expect(row!.className).toContain('border-l-amber-400');
        });

        it('matches on task.processId when the running id and processId differ', () => {
            renderPane({
                running: [makeRunningTask({ id: 'queue-task', processId: 'proc-99', type: 'chat', payload: { mode: 'plan' } })],
                awaitingInputProcessIds: new Set(['proc-99']),
            });
            expect(screen.queryByTestId('awaiting-input-indicator')).toBeTruthy();
            const row = document.querySelector('[data-task-id="queue-task"]') as HTMLElement | null;
            expect(row).toBeTruthy();
            expect(row!.getAttribute('data-awaiting-input')).toBe('true');
        });

        it('falls back to pendingAskUserCount on the running task when no set is supplied', () => {
            renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' }, pendingAskUserCount: 2 })],
            });
            expect(screen.queryByTestId('awaiting-input-indicator')).toBeTruthy();
            expect(screen.queryByTestId('thinking-indicator')).toBeNull();
        });

        it('does not show "Needs input" for queued tasks even if their id is in the set', () => {
            renderPane({
                queued: [makeQueuedTask({ id: 'q-1', type: 'chat', payload: { mode: 'ask' } })],
                awaitingInputProcessIds: new Set(['q-1']),
            });
            expect(screen.queryByTestId('awaiting-input-indicator')).toBeNull();
            const row = document.querySelector('[data-task-id="q-1"]') as HTMLElement | null;
            expect(row).toBeTruthy();
            expect(row!.getAttribute('data-awaiting-input')).toBeNull();
        });
    });

    // ── Queued Tasks section ───────────────────────────────────────────
    describe('Queued Tasks section', () => {
        it('shows section header with count', () => {
            renderPane({ queued: [makeQueuedTask()] });
            const toggle = screen.getByTestId('queued-tasks-section-toggle');
            expect(toggle.textContent).toContain('Queued Tasks');
            expect(toggle.textContent).toContain('1');
        });

        it('shows task display name', () => {
            renderPane({ queued: [makeQueuedTask({ displayName: 'Queued Work' })] });
            expect(screen.getByText('Queued Work')).toBeTruthy();
        });

        it('clicking task calls onSelectTask', () => {
            const { props } = renderPane({ queued: [makeQueuedTask()] });
            const card = document.querySelector('[data-task-id="q-1"]');
            fireEvent.click(card!);
            expect(props.onSelectTask).toHaveBeenCalledWith('q-1', expect.anything());
        });

        it('renders pause marker for pause-marker items', () => {
            renderPane({
                queued: [makeQueuedTask(), { id: 'pm-1', kind: 'pause-marker' }],
            });
            expect(screen.getByTestId('pause-marker-row')).toBeTruthy();
        });

        it('shows a static duration label for timed pause markers', () => {
            renderPane({
                queued: [
                    { id: 'pm-indefinite', kind: 'pause-marker' },
                    { id: 'pm-timed', kind: 'pause-marker', durationHours: 2 },
                ],
            });

            expect(screen.getByText('Queue pauses here')).toBeTruthy();
            expect(screen.getByText('Queue pauses here · 2h')).toBeTruthy();
        });

        it('opens a duration menu from the insert zone and inserts a timed pause marker', async () => {
            const fetchQueue = vi.fn().mockResolvedValue(undefined);
            const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
            fetchMock.mockResolvedValue(new Response(JSON.stringify({ markerId: 'pm-new', afterIndex: 0, durationHours: 2 }), {
                status: 201,
                headers: { 'content-type': 'application/json' },
            }));
            renderPane({
                workspaceId: 'ws-1',
                queued: [makeQueuedTask({ id: 'q-1' })],
                fetchQueue,
            });

            const insertZone = screen.getByTestId('pause-insert-zone-0');
            fireEvent.mouseEnter(insertZone);
            fireEvent.click(insertZone);

            expect(screen.getByTestId('pause-duration-menu-insert-0')).toBeTruthy();
            expect(screen.getByTestId('pause-duration-insert-0-indefinite')).toBeTruthy();
            for (const hours of [1, 2, 3, 4, 8]) {
                expect(screen.getByTestId(`pause-duration-insert-0-${hours}h`)).toBeTruthy();
            }

            await act(async () => {
                fireEvent.click(screen.getByTestId('pause-duration-insert-0-2h'));
            });

            await waitFor(() => {
                const pauseMarkerCall = fetchMock.mock.calls.find(
                    (call: any[]) => typeof call[0] === 'string' && call[0].includes('/queue/pause-marker'),
                );
                expect(pauseMarkerCall).toBeTruthy();
                expect(JSON.parse(pauseMarkerCall![1].body)).toEqual({
                    afterIndex: 0,
                    repoId: 'ws-1',
                    durationHours: 2,
                });
                expect(fetchQueue).toHaveBeenCalled();
            });
        });

        it('inserts an indefinite pause marker when Until resumed is selected', async () => {
            const fetchQueue = vi.fn().mockResolvedValue(undefined);
            const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
            fetchMock.mockResolvedValue(new Response(JSON.stringify({ markerId: 'pm-new', afterIndex: -1 }), {
                status: 201,
                headers: { 'content-type': 'application/json' },
            }));
            renderPane({
                workspaceId: 'ws-1',
                queued: [makeQueuedTask({ id: 'q-1' })],
                fetchQueue,
            });

            const insertZone = screen.getByTestId('pause-insert-zone--1');
            fireEvent.mouseEnter(insertZone);
            fireEvent.click(insertZone);

            await act(async () => {
                fireEvent.click(screen.getByTestId('pause-duration-insert--1-indefinite'));
            });

            await waitFor(() => {
                const pauseMarkerCall = fetchMock.mock.calls.find(
                    (call: any[]) => typeof call[0] === 'string' && call[0].includes('/queue/pause-marker'),
                );
                expect(pauseMarkerCall).toBeTruthy();
                const body = JSON.parse(pauseMarkerCall![1].body);
                expect(body).toEqual({ afterIndex: -1, repoId: 'ws-1' });
                expect(body).not.toHaveProperty('durationHours');
                expect(fetchQueue).toHaveBeenCalled();
            });
        });

        it('collapsing section hides task cards', () => {
            renderPane({ queued: [makeQueuedTask()] });
            expect(document.querySelector('[data-task-id="q-1"]')).toBeTruthy();
            fireEvent.click(screen.getByTestId('queued-tasks-section-toggle'));
            expect(document.querySelector('[data-task-id="q-1"]')).toBeNull();
        });
    });

    // ── Session context drag sources ────────────────────────────────────
    describe('Session context drag sources', () => {
        it('does not expose session-context drag attributes while the feature flag is disabled', () => {
            renderPane({
                activeTab: 'chats',
                workspaceId: 'ws-1',
                history: [makeHistoryTask({
                    id: 'proc-1',
                    workspaceId: 'ws-1',
                    title: 'Source Chat',
                    startTime: Date.parse('2026-01-01T00:00:00Z'),
                })],
            });

            const row = document.querySelector('[data-task-id="proc-1"]') as HTMLElement | null;
            expect(row).toBeTruthy();
            expect(row!.getAttribute('data-session-context-source')).toBeNull();
            expect(row!.getAttribute('draggable')).not.toBe('true');
        });

        it('sets a pointer-only safe drag payload for same-workspace chat rows when enabled', () => {
            mockSessionContextAttachmentsEnabled = true;
            renderPane({
                activeTab: 'chats',
                workspaceId: 'ws-1',
                history: [makeHistoryTask({
                    id: 'proc-1',
                    workspaceId: 'ws-1',
                    title: undefined,
                    customTitle: undefined,
                    displayName: undefined,
                    promptPreview: 'Debug /home/example/repo/src/app.ts',
                    startTime: Date.parse('2026-01-01T00:00:00Z'),
                })],
            });

            const row = document.querySelector('[data-task-id="proc-1"]') as HTMLElement;
            expect(row.getAttribute('draggable')).toBe('true');
            expect(row.getAttribute('data-session-context-source')).toBe('true');
            expect(row.getAttribute('data-session-context-status')).toBe('completed');

            const dataTransfer = { setData: vi.fn(), effectAllowed: 'move' as DataTransfer['effectAllowed'] };
            fireEvent.dragStart(row, { dataTransfer });
            const [, rawPayload] = dataTransfer.setData.mock.calls.find((call: any[]) => call[0] === SESSION_CONTEXT_DRAG_MIME)!;
            const payload = JSON.parse(rawPayload);
            expect(payload).toMatchObject({
                sourceWorkspaceId: 'ws-1',
                sourceProcessId: 'proc-1',
                status: 'completed',
                title: 'Debug [path]',
                lastActivityAt: '2026-01-01T00:00:00.000Z',
            });
            expect(rawPayload).not.toContain('/home/example');
        });

        it('uses a queue process pointer for queued chat rows without a processId', () => {
            mockSessionContextAttachmentsEnabled = true;
            renderPane({
                workspaceId: 'ws-1',
                queued: [makeQueuedTask({
                    id: 'q-source',
                    repoId: 'ws-1',
                    createdAt: '2026-01-01T00:00:00Z',
                    displayName: 'Queued Source',
                })],
            });

            const row = document.querySelector('[data-task-id="q-source"]') as HTMLElement;
            const dataTransfer = { setData: vi.fn(), effectAllowed: 'move' as DataTransfer['effectAllowed'] };
            fireEvent.dragStart(row, { dataTransfer });
            const [, rawPayload] = dataTransfer.setData.mock.calls.find((call: any[]) => call[0] === SESSION_CONTEXT_DRAG_MIME)!;
            expect(JSON.parse(rawPayload)).toMatchObject({
                sourceWorkspaceId: 'ws-1',
                sourceProcessId: 'queue_q-source',
                status: 'queued',
            });
        });
    });

    // ── AC-01: "+ New chat" button as a seeded-composer drop target ──────
    describe('New chat drop target', () => {
        const sessionPayload = {
            kind: 'coc.session-context',
            version: 1,
            sourceWorkspaceId: 'ws-1',
            sourceProcessId: 'source-proc-123456',
            title: 'Source chat',
            status: 'completed',
            lastActivityAt: '2026-01-01T00:00:00.000Z',
        };
        const commitPayload = {
            kind: 'coc.git-commit-context',
            version: 1,
            sourceWorkspaceId: 'ws-1',
            commitHash: 'abcdef1234567890',
            shortHash: 'abcdef1',
            label: 'Commit abcdef1',
            subject: 'Add drop target',
            title: 'Add drop target',
        };

        function makeDropDataTransfer(payload: unknown, mime = SESSION_CONTEXT_DRAG_MIME) {
            return {
                types: [mime],
                dropEffect: 'none',
                getData: (format: string) => (format === mime ? JSON.stringify(payload) : ''),
            };
        }

        beforeEach(() => {
            resetNewChatSeedContext();
            mockSessionContextAttachmentsEnabled = true;
        });
        afterEach(() => {
            resetNewChatSeedContext();
        });

        it('shows the drop affordance while a session-context drag is over the button', () => {
            renderPane({ workspaceId: 'ws-1', onNewChat: vi.fn(), history: [makeHistoryTask()] });
            const btn = screen.getByTestId('toolbar-new-chat-btn');

            const dataTransfer = makeDropDataTransfer(sessionPayload);
            fireEvent.dragEnter(btn, { dataTransfer });

            expect(dataTransfer.dropEffect).toBe('copy');
            expect(btn.getAttribute('data-drop-active')).toBe('true');
            expect(btn.textContent).toContain('Drop to start a new chat');

            fireEvent.dragLeave(btn, { dataTransfer });
            expect(btn.getAttribute('data-drop-active')).toBeNull();
        });

        it.each([
            ['chat/session', sessionPayload, SESSION_CONTEXT_DRAG_MIME],
            ['git commit (pointer)', commitPayload, POINTER_CONTEXT_DRAG_MIME],
        ])('opens the new-chat flow and buffers the dropped %s item', (_label, payload, mime) => {
            const onNewChat = vi.fn();
            renderPane({ workspaceId: 'ws-1', onNewChat, history: [makeHistoryTask()] });
            const btn = screen.getByTestId('toolbar-new-chat-btn');

            const dataTransfer = makeDropDataTransfer(payload, mime);
            fireEvent.dragOver(btn, { dataTransfer });
            fireEvent.drop(btn, { dataTransfer });

            // Composer opens via the existing new-chat flow.
            expect(onNewChat).toHaveBeenCalledTimes(1);
            // Dropped item is buffered for the composer to drain (no auto-send).
            expect(peekNewChatSeedContext()).toEqual([payload]);
            // Affordance clears after the drop.
            expect(btn.getAttribute('data-drop-active')).toBeNull();
        });

        it('falls back to onOpenDialog when no onNewChat handler is provided', () => {
            const onOpenDialog = vi.fn();
            renderPane({ workspaceId: 'ws-1', onNewChat: undefined, onOpenDialog, history: [makeHistoryTask()] });
            const btn = screen.getByTestId('toolbar-new-chat-btn');

            const dataTransfer = makeDropDataTransfer(commitPayload, POINTER_CONTEXT_DRAG_MIME);
            fireEvent.drop(btn, { dataTransfer });

            expect(onOpenDialog).toHaveBeenCalledTimes(1);
            expect(peekNewChatSeedContext()).toEqual([commitPayload]);
        });

        it('ignores drops that carry no supported context and does not open the composer', () => {
            const onNewChat = vi.fn();
            renderPane({ workspaceId: 'ws-1', onNewChat, history: [makeHistoryTask()] });
            const btn = screen.getByTestId('toolbar-new-chat-btn');

            fireEvent.drop(btn, {
                dataTransfer: { types: ['text/plain'], dropEffect: 'none', getData: () => 'nope' },
            });

            expect(onNewChat).not.toHaveBeenCalled();
            expect(drainNewChatSeedContext()).toEqual([]);
        });

        it('does not activate the drop target when the feature flag is off', () => {
            mockSessionContextAttachmentsEnabled = false;
            const onNewChat = vi.fn();
            renderPane({ workspaceId: 'ws-1', onNewChat, history: [makeHistoryTask()] });
            const btn = screen.getByTestId('toolbar-new-chat-btn');

            const dataTransfer = makeDropDataTransfer(sessionPayload);
            fireEvent.dragEnter(btn, { dataTransfer });
            expect(btn.getAttribute('data-drop-active')).toBeNull();

            fireEvent.drop(btn, { dataTransfer });
            expect(onNewChat).not.toHaveBeenCalled();
            expect(drainNewChatSeedContext()).toEqual([]);
        });
    });

    // ── AC-02: chat-row multi-select drag bundles all selected chats ─────
    describe('Chat-row multi-select drag bundling', () => {
        function makeRecordingDataTransfer() {
            const store = new Map<string, string>();
            return {
                effectAllowed: 'none' as DataTransfer['effectAllowed'],
                setData(format: string, data: string) { store.set(format, data); },
                getData(format: string) { return store.get(format) ?? ''; },
                get types() { return Array.from(store.keys()); },
            };
        }

        function renderThreeChats() {
            return renderPane({
                activeTab: 'chats',
                workspaceId: 'ws-1',
                history: [
                    makeHistoryTask({ id: 'chat-a', workspaceId: 'ws-1', displayName: 'Chat A' }),
                    makeHistoryTask({ id: 'chat-b', workspaceId: 'ws-1', displayName: 'Chat B' }),
                    makeHistoryTask({ id: 'chat-c', workspaceId: 'ws-1', displayName: 'Chat C' }),
                ],
            });
        }

        function row(id: string) {
            return document.querySelector(`[data-task-id="${id}"]`) as HTMLElement;
        }

        function dragStartAndRead(id: string) {
            const dataTransfer = makeRecordingDataTransfer();
            fireEvent.dragStart(row(id), { dataTransfer });
            return readSessionContextDropPayloads(dataTransfer) as Array<{ sourceProcessId: string }>;
        }

        beforeEach(() => {
            mockSessionContextAttachmentsEnabled = true;
        });

        it('bundles every selected chat when dragging one that is in the selection', () => {
            renderThreeChats();
            fireEvent.click(row('chat-a'), { ctrlKey: true });
            fireEvent.click(row('chat-b'), { ctrlKey: true });

            const payloads = dragStartAndRead('chat-a');
            expect(payloads.map(p => p.sourceProcessId).sort()).toEqual(['chat-a', 'chat-b']);
        });

        it('carries only the dragged chat when it is not part of the selection', () => {
            renderThreeChats();
            fireEvent.click(row('chat-a'), { ctrlKey: true });
            fireEvent.click(row('chat-b'), { ctrlKey: true });

            const payloads = dragStartAndRead('chat-c');
            expect(payloads.map(p => p.sourceProcessId)).toEqual(['chat-c']);
        });

        it('carries only the dragged chat when there is no multi-selection', () => {
            renderThreeChats();

            const payloads = dragStartAndRead('chat-a');
            expect(payloads.map(p => p.sourceProcessId)).toEqual(['chat-a']);
        });
    });

    // ── Pinned section ─────────────────────────────────────────────────
    describe('Pinned section', () => {
        it('shows section header with count', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({ history: [makeHistoryTask()] });
            const toggle = screen.getByTestId('pinned-chats-section-toggle');
            // Section is now wrapped in a sticky container; the count badge is a sibling element.
            const sectionWrapper = toggle.closest('[data-section="pinned"]') as HTMLElement | null;
            expect(sectionWrapper).toBeTruthy();
            expect(toggle.textContent).toContain('Pinned');
            expect(sectionWrapper!.textContent).toContain('1');
        });

        it('shows pinned section when history tasks are pinned', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.getByTestId('pinned-chats-section-toggle')).toBeTruthy();
        });

        it('pinned cards have amber left border', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({ history: [makeHistoryTask()] });
            const card = document.querySelector('[data-task-id="h-1"]');
            expect(card).toBeTruthy();
            expect(card!.className).toContain('border-l-amber-400');
        });

        it('pinned cards render inside pinned section', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({ history: [makeHistoryTask()] });
            const toggle = screen.getByTestId('pinned-chats-section-toggle');
            const section = toggle.parentElement!.parentElement!;
            expect(section.querySelector('[data-task-id="h-1"]')).toBeTruthy();
        });

        it('pinned section count includes pinned running tasks', () => {
            mockPinnedChatIds = new Set(['run-1']);
            renderPane({ running: [makeRunningTask()] });
            const toggle = screen.getByTestId('pinned-chats-section-toggle');
            const sectionWrapper = toggle.closest('[data-section="pinned"]') as HTMLElement | null;
            expect(sectionWrapper).toBeTruthy();
            expect(sectionWrapper!.textContent).toContain('1');
        });

        it('pinned section hidden when no pinned tasks', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.queryByTestId('pinned-chats-section-toggle')).toBeNull();
        });
    });

    // ── Completed Tasks section ────────────────────────────────────────
    describe('Completed Tasks section', () => {
        it('shows section header with count', () => {
            const { container } = renderPane({ history: [makeHistoryTask()] });
            // Completed section has no data-testid — find by text
            expect(container.textContent).toContain('Completed Tasks');
            const completedSection = container.querySelector('[data-section="completed"]') as HTMLElement | null;
            expect(completedSection).toBeTruthy();
            expect(completedSection!.textContent).toContain('1');
        });

        it('completed task shows name', () => {
            renderPane({ history: [makeHistoryTask({ displayName: 'Done Job' })] });
            expect(screen.getByText('Done Job')).toBeTruthy();
        });

        it('selected task has ring highlight', () => {
            renderPane({ history: [makeHistoryTask()], selectedTaskId: 'h-1' });
            const card = document.querySelector('[data-task-id="h-1"]');
            expect(card!.className).toContain('ring-2');
        });

        it('uses roomier mobile padding while preserving dense desktop row sizing', () => {
            renderPane({ history: [makeHistoryTask()] });
            const card = document.querySelector('[data-task-id="h-1"]') as HTMLElement | null;

            expect(card).toBeTruthy();
            expect(card!.className).toContain('px-4');
            expect(card!.className).toContain('py-2');
            expect(card!.className).toContain('min-h-[40px]');
            expect(card!.className).toContain('md:px-3');
            expect(card!.className).toContain('md:py-1');
            expect(card!.className).toContain('md:min-h-0');
            expect(card!.className).toContain('md:h-[26px]');
        });

        it('hides when no completed tasks', () => {
            const { container } = renderPane({ running: [makeRunningTask()] });
            expect(container.textContent).not.toContain('Completed Tasks');
        });

        it('collapse hides task cards', () => {
            const { container } = renderPane({ history: [makeHistoryTask()] });
            // Find the completed section toggle button by its text content
            const buttons = container.querySelectorAll('button');
            let toggleBtn: Element | null = null;
            buttons.forEach(btn => {
                if (btn.textContent?.includes('Completed Tasks')) toggleBtn = btn;
            });
            expect(toggleBtn).toBeTruthy();
            fireEvent.click(toggleBtn!);
            expect(document.querySelector('[data-task-id="h-1"]')).toBeNull();
        });
    });

    // ── Archived section ───────────────────────────────────────────────
    describe('Archived section', () => {
        it('shows section header with count', () => {
            mockArchivedChatIds = new Set(['h-a']);
            renderPane({ history: [makeHistoryTask({ id: 'h-a' })] });
            const toggle = screen.getByTestId('archived-chats-section-toggle');
            expect(toggle.textContent).toContain('📦 Archived');
            const sectionWrapper = toggle.closest('[data-section="archived"]') as HTMLElement | null;
            expect(sectionWrapper).toBeTruthy();
            expect(sectionWrapper!.textContent).toContain('1');
        });

        it('starts collapsed by default', () => {
            mockArchivedChatIds = new Set(['h-a']);
            renderPane({ history: [makeHistoryTask({ id: 'h-a' })] });
            expect(screen.getByTestId('archived-chats-section-toggle')).toBeTruthy();
            // Card should not be rendered because section is collapsed
            const toggle = screen.getByTestId('archived-chats-section-toggle');
            const section = toggle.parentElement!;
            expect(section.querySelector('[data-task-id="h-a"]')).toBeNull();
        });

        it('expands on click', () => {
            mockArchivedChatIds = new Set(['h-a']);
            renderPane({ history: [makeHistoryTask({ id: 'h-a' })] });
            fireEvent.click(screen.getByTestId('archived-chats-section-toggle'));
            expect(document.querySelector('[data-task-id="h-a"]')).toBeTruthy();
        });

        it('archived cards have opacity-70', () => {
            mockArchivedChatIds = new Set(['h-a']);
            renderPane({ history: [makeHistoryTask({ id: 'h-a' })] });
            fireEvent.click(screen.getByTestId('archived-chats-section-toggle'));
            const card = document.querySelector('[data-task-id="h-a"]');
            expect(card).toBeTruthy();
            expect(card!.className).toContain('opacity-70');
        });

        it('archived cards are inside the archived section', () => {
            mockArchivedChatIds = new Set(['h-a']);
            renderPane({ history: [makeHistoryTask({ id: 'h-a' })] });
            fireEvent.click(screen.getByTestId('archived-chats-section-toggle'));
            const toggle = screen.getByTestId('archived-chats-section-toggle');
            const section = toggle.parentElement!.parentElement!;
            expect(section.querySelector('[data-task-id="h-a"]')).toBeTruthy();
        });
    });

    // ── Context menus ──────────────────────────────────────────────────
    describe('Context menus', () => {
        describe('Running task menu', () => {
            it('right-click opens context menu', () => {
                renderPane({ running: [makeRunningTask()] });
                const card = document.querySelector('[data-task-id="run-1"]')!;
                fireEvent.contextMenu(card);
                expect(screen.getByTestId('context-menu')).toBeTruthy();
            });

            it('"Pin to top" shown for unpinned task', () => {
                renderPane({ running: [makeRunningTask()] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="run-1"]')!);
                expect(screen.getByText(/Pin to top/)).toBeTruthy();
            });

            it('clicking "Pin to top" calls pinChat', () => {
                renderPane({ running: [makeRunningTask()] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="run-1"]')!);
                fireEvent.click(screen.getByText(/Pin to top/));
                expect(mockPinChat).toHaveBeenCalledWith('run-1');
            });

            it('"Unpin" shown for pinned running task', () => {
                mockPinnedChatIds = new Set(['run-1']);
                renderPane({ running: [makeRunningTask()] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="run-1"]')!);
                expect(screen.getByText(/Unpin/)).toBeTruthy();
            });

            it('"Cancel" menu item present', () => {
                renderPane({ running: [makeRunningTask()] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="run-1"]')!);
                expect(screen.getByText(/Cancel/)).toBeTruthy();
            });
        });

        describe('Queued task menu', () => {
            it('right-click opens context menu', () => {
                renderPane({ queued: [makeQueuedTask()] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="q-1"]')!);
                expect(screen.getByTestId('context-menu')).toBeTruthy();
            });

            it('"Move Up" shown when not first', () => {
                renderPane({
                    queued: [
                        makeQueuedTask({ id: 'q-1', displayName: 'First' }),
                        makeQueuedTask({ id: 'q-2', displayName: 'Second' }),
                    ],
                });
                fireEvent.contextMenu(document.querySelector('[data-task-id="q-2"]')!);
                expect(screen.getByText(/Move Up/)).toBeTruthy();
            });

            it('"Move Up" hidden for first item', () => {
                renderPane({ queued: [makeQueuedTask()] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="q-1"]')!);
                expect(screen.queryByText(/Move Up/)).toBeNull();
            });

            it('"Freeze" shown for unfrozen task', () => {
                renderPane({ queued: [makeQueuedTask()] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="q-1"]')!);
                expect(screen.getByText(/Freeze/)).toBeTruthy();
            });

            it('"Unfreeze" shown for frozen task', () => {
                renderPane({ queued: [makeQueuedTask({ frozen: true })] });
                fireEvent.contextMenu(document.querySelector('[data-task-id="q-1"]')!);
                expect(screen.getByText(/Unfreeze/)).toBeTruthy();
            });
        });

        describe('Completed task menu', () => {
            it('right-click opens context menu', () => {
                renderPane({ history: [makeHistoryTask()], onMarkRead: vi.fn(), onMarkUnread: vi.fn() });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByTestId('context-menu')).toBeTruthy();
            });

            it('"Pin to top" shown for unpinned task', () => {
                renderPane({ history: [makeHistoryTask()], onMarkUnread: vi.fn() });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByText(/Pin to top/)).toBeTruthy();
            });

            it('"Mark as Read" shown for unseen task', () => {
                renderPane({
                    history: [makeHistoryTask()],
                    unseenProcessIds: new Set(['h-1']),
                    onMarkRead: vi.fn(),
                });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByText(/Mark as Read/)).toBeTruthy();
            });

            it('"Mark as Unread" shown for seen task', () => {
                renderPane({
                    history: [makeHistoryTask()],
                    onMarkUnread: vi.fn(),
                });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByText(/Mark as Unread/)).toBeTruthy();
            });

            it('"Archive" shown for non-archived task', () => {
                renderPane({ history: [makeHistoryTask()], onMarkUnread: vi.fn() });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                // The menu item text is "📦 Archive"
                const items = screen.getAllByRole('button');
                const archiveBtn = items.find(b => b.textContent?.trim() === '📦 Archive');
                expect(archiveBtn).toBeTruthy();
            });

            it('"Delete" present', () => {
                renderPane({ history: [makeHistoryTask()], onMarkUnread: vi.fn() });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                // Completed tasks always use bulk menu path (bulkIds=[taskId])
                expect(screen.getByText(/Delete 1 chats/)).toBeTruthy();
            });

            it('"Rename" shown for completed task', () => {
                renderPane({ history: [makeHistoryTask()], onMarkUnread: vi.fn() });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                const menuItems = screen.getByTestId('context-menu');
                expect(menuItems.textContent).toContain('Rename');
            });

            it('clicking Rename opens the RenameDialog', async () => {
                renderPane({ history: [makeHistoryTask()], onMarkUnread: vi.fn() });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                // Find Rename button inside the context menu
                const menu = screen.getByTestId('context-menu');
                const renameBtn = Array.from(menu.querySelectorAll('button')).find(b => b.textContent?.includes('Rename'));
                expect(renameBtn).toBeTruthy();
                fireEvent.click(renameBtn!);
                await waitFor(() => {
                    expect(screen.getByText('Rename Chat')).toBeTruthy();
                });
            });

            it('calls PATCH /api/processes/queue_<taskId> on rename confirm', async () => {
                const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
                fetchMock.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
                renderPane({
                    history: [makeHistoryTask({ id: 'h-rename', displayName: 'Old Name' })],
                    onMarkUnread: vi.fn(),
                    fetchQueue: vi.fn().mockResolvedValue(undefined),
                });
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-rename"]')!);
                // Find Rename button inside the context menu
                const menu = screen.getByTestId('context-menu');
                const renameBtn = Array.from(menu.querySelectorAll('button')).find(b => b.textContent?.includes('Rename'));
                fireEvent.click(renameBtn!);
                await waitFor(() => {
                    expect(screen.getByText('Rename Chat')).toBeTruthy();
                });
                const input = screen.getByPlaceholderText('Chat title') as HTMLInputElement;
                fireEvent.change(input, { target: { value: 'New Name' } });
                await act(async () => {
                    fireEvent.click(screen.getByText('Rename'));
                });
                await waitFor(() => {
                    const patchCall = fetchMock.mock.calls.find(
                        (c: any[]) => typeof c[0] === 'string' && c[0].includes('/processes/queue_h-rename') && c[1]?.method === 'PATCH'
                    );
                    expect(patchCall).toBeTruthy();
                    const body = JSON.parse(patchCall![1].body);
                    expect(body.customTitle).toBe('New Name');
                });
            });
        });

        describe('Bulk context menu', () => {
            function renderThreeHistoryTasks(extra: Partial<any> = {}) {
                return renderPane({
                    history: [
                        makeHistoryTask({ id: 'h-1', displayName: 'Task A' }),
                        makeHistoryTask({ id: 'h-2', displayName: 'Task B' }),
                        makeHistoryTask({ id: 'h-3', displayName: 'Task C' }),
                    ],
                    onMarkRead: vi.fn(),
                    onMarkUnread: vi.fn(),
                    ...extra,
                });
            }

            function selectRange() {
                // Plain click on h-1 sets anchor
                fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
                // Shift+click on h-3 selects h-1, h-2, h-3
                fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { shiftKey: true });
            }

            it('shift+click selects range', () => {
                renderThreeHistoryTasks();
                selectRange();
                expect(screen.getByTestId('selection-count-pill').textContent).toContain('3 selected');
            });

            it('ctrl+click toggles individual selection', () => {
                renderThreeHistoryTasks();
                // Anchor on h-1
                fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
                // Ctrl+click h-2 and h-3
                fireEvent.click(document.querySelector('[data-task-id="h-2"]')!, { ctrlKey: true });
                fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { ctrlKey: true });
                expect(screen.getByTestId('selection-count-pill').textContent).toContain('2 selected');
            });

            it('right-click selected item shows bulk menu', () => {
                renderThreeHistoryTasks();
                selectRange();
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-2"]')!);
                expect(screen.getByTestId('context-menu')).toBeTruthy();
                expect(screen.getByText(/tasks selected/)).toBeTruthy();
            });

            it('bulk menu shows count header', () => {
                renderThreeHistoryTasks();
                selectRange();
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByText(/3 tasks selected/)).toBeTruthy();
            });

            it('bulk "Mark as Read" shown when any unseen', () => {
                renderThreeHistoryTasks({ unseenProcessIds: new Set(['h-1', 'h-2']) });
                selectRange();
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByText(/Mark as Read/)).toBeTruthy();
            });

            it('bulk "Summarize" shown for ≤20', () => {
                renderThreeHistoryTasks();
                selectRange();
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByText(/Summarize/)).toBeTruthy();
            });

            it('bulk "Delete" present', () => {
                renderThreeHistoryTasks();
                selectRange();
                fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
                expect(screen.getByText(/Delete.*chats/)).toBeTruthy();
            });
        });
    });

    // ── Multi-select ───────────────────────────────────────────────────
    describe('Multi-select', () => {
        function renderTwo(extra: Partial<any> = {}) {
            return renderPane({
                history: [
                    makeHistoryTask({ id: 'h-1', displayName: 'A' }),
                    makeHistoryTask({ id: 'h-2', displayName: 'B' }),
                    makeHistoryTask({ id: 'h-3', displayName: 'C' }),
                ],
                ...extra,
            });
        }

        it('Escape clears selection when search is toggled to re-bind handler', () => {
            renderTwo();
            fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
            fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { shiftKey: true });
            expect(screen.getByTestId('selection-count-pill')).toBeTruthy();
            // Open search so the keydown effect re-binds with current selectedHistoryIds
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByTestId('selection-count-pill')).toBeNull();
        });

        it('selection clear button clears selection', () => {
            renderTwo();
            fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
            fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { shiftKey: true });
            fireEvent.click(screen.getByTestId('selection-clear-btn'));
            expect(screen.queryByTestId('selection-count-pill')).toBeNull();
        });

        it('selected cards show checkbox ☑', () => {
            renderTwo();
            fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
            fireEvent.click(document.querySelector('[data-task-id="h-2"]')!, { ctrlKey: true });
            fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { ctrlKey: true });
            expect(screen.getAllByTestId('selection-checkbox').length).toBeGreaterThanOrEqual(2);
        });

        it('selected cards have blue tint', () => {
            renderTwo();
            fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
            fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { shiftKey: true });
            const card = document.querySelector('[data-task-id="h-2"]');
            expect(card!.className).toContain('bg-[#0078d4]/10');
        });

        it('selected cards have outline class', () => {
            renderTwo();
            fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
            fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { shiftKey: true });
            const card = document.querySelector('[data-task-id="h-2"]');
            expect(card!.className).toContain('outline');
        });

        it('plain click clears selection and opens task', () => {
            const { props } = renderTwo();
            fireEvent.click(document.querySelector('[data-task-id="h-1"]')!);
            fireEvent.click(document.querySelector('[data-task-id="h-3"]')!, { shiftKey: true });
            expect(screen.getByTestId('selection-count-pill')).toBeTruthy();
            // Plain click on h-2 clears selection
            fireEvent.click(document.querySelector('[data-task-id="h-2"]')!);
            expect(screen.queryByTestId('selection-count-pill')).toBeNull();
            expect(props.onSelectTask).toHaveBeenCalledWith('h-2', expect.anything());
        });
    });

    // ── Group selection ────────────────────────────────────────────────
    describe('Group selection', () => {
        function makeGroupedHistory() {
            // startTime used by history-grouping for sort order (descending).
            // Group 2 (500) → standalone (300) → Group 1 (200) in visual order.
            return [
                makeHistoryTask({ id: 'g1-a', displayName: 'G1 Task A', planFilePath: '/plans/plan1.md', startTime: 100 }),
                makeHistoryTask({ id: 'g1-b', displayName: 'G1 Task B', planFilePath: '/plans/plan1.md', startTime: 200 }),
                makeHistoryTask({ id: 'standalone', displayName: 'Standalone', startTime: 300 }),
                makeHistoryTask({ id: 'g2-a', displayName: 'G2 Task A', planFilePath: '/plans/plan2.md', startTime: 400 }),
                makeHistoryTask({ id: 'g2-b', displayName: 'G2 Task B', planFilePath: '/plans/plan2.md', startTime: 500 }),
            ];
        }

        function renderGrouped(extra: Partial<any> = {}) {
            mockDisplaySettings = { taskCardDensity: 'normal', showReportIntent: false, historyGrouping: true } as any;
            return renderPane({ history: makeGroupedHistory(), ...extra });
        }

        it('chevron click toggles expand/collapse without selecting', () => {
            renderGrouped();
            const chevrons = screen.getAllByTestId('group-chevron');
            fireEvent.click(chevrons[0]);
            // Should toggle but not select
            expect(screen.queryByTestId('selection-count-pill')).toBeNull();
        });

        it('right-click on group header opens context menu with bulk ids', () => {
            renderGrouped();
            const headers = screen.getAllByTestId('history-group-header');
            fireEvent.contextMenu(headers[0]);
            expect(screen.getByTestId('context-menu')).toBeTruthy();
            expect(screen.getByText(/tasks selected/)).toBeTruthy();
        });

        it('expanded child rows are marked with data-group-child', () => {
            renderGrouped();
            // Groups default collapsed — expand both groups by clicking their
            // chevrons before asserting on child rows.
            const chevrons = screen.getAllByTestId('group-chevron');
            chevrons.forEach(c => fireEvent.click(c));
            const g1a = document.querySelector('[data-task-id="g1-a"]') as HTMLElement | null;
            const standalone = document.querySelector('[data-task-id="standalone"]') as HTMLElement | null;
            expect(g1a).toBeTruthy();
            expect(standalone).toBeTruthy();
            expect(g1a!.getAttribute('data-group-child')).toBe('true');
            expect(standalone!.getAttribute('data-group-child')).toBeNull();
        });

        it('expanded children container has guide-line border classes', () => {
            renderGrouped();
            const chevrons = screen.getAllByTestId('group-chevron');
            chevrons.forEach(c => fireEvent.click(c));
            const containers = screen.getAllByTestId('history-group-children');
            expect(containers.length).toBeGreaterThan(0);
            const cls = containers[0].className;
            expect(cls).toContain('border-l');
            expect(cls).toContain('pl-2');
            expect(cls).toContain('ml-3');
        });

        it('keeps unseen plan-file groups collapsed after workspace switches while preserving unread affordances', () => {
            const onMarkAllRead = vi.fn();
            const { rerender, props } = renderGrouped({
                workspaceId: 'ws-a',
                unseenProcessIds: new Set(['g2-a']),
                onMarkAllRead,
            });

            rerender(<ChatListPane {...props} workspaceId="__all" />);
            const unseenGroup = screen.getByTestId('group-unseen-dot').closest('[data-testid="history-group"]') as HTMLElement;
            expect(unseenGroup.getAttribute('data-expanded')).toBe('false');
            expect(screen.queryByTestId('history-group-children')).toBeNull();
            expect(screen.getByTestId('unseen-count-badge').textContent).toBe('1');
            expect(screen.getByTestId('mark-all-read-btn')).toBeTruthy();
            fireEvent.click(screen.getByTestId('mark-all-read-btn'));
            expect(onMarkAllRead).toHaveBeenCalledTimes(1);
            expect(onMarkAllRead.mock.calls[0][0].map((task: any) => task.id)).toEqual(
                expect.arrayContaining(['g2-a', 'g2-b', 'standalone', 'g1-a', 'g1-b']),
            );
        });

        it('keeps a selected unseen plan-file group collapsed after workspace switches', () => {
            const groupForPlan = (planFilePath: string) =>
                screen.getByTitle(planFilePath).closest('[data-testid="history-group"]') as HTMLElement;
            const { rerender, props } = renderGrouped({
                workspaceId: 'ws-a',
                selectedTaskId: 'g2-a',
                unseenProcessIds: new Set(['g2-a']),
                onMarkAllRead: vi.fn(),
            });

            const selectedUnseenGroup = groupForPlan('/plans/plan2.md');
            fireEvent.click(selectedUnseenGroup.querySelector('[data-testid="group-chevron"]')!);
            expect(selectedUnseenGroup.getAttribute('data-expanded')).toBe('true');
            expect(document.querySelector('[data-task-id="g2-a"]')).toBeTruthy();

            rerender(<ChatListPane {...props} workspaceId="__all" />);
            const allReposGroup = groupForPlan('/plans/plan2.md');
            expect(allReposGroup.getAttribute('data-expanded')).toBe('false');
            expect(document.querySelector('[data-task-id="g2-a"]')).toBeNull();
            expect(screen.getByTestId('group-unseen-dot')).toBeTruthy();
            expect(screen.getByTestId('unseen-count-badge').textContent).toBe('1');

            rerender(<ChatListPane {...props} workspaceId="ws-a" />);
            const repoGroup = groupForPlan('/plans/plan2.md');
            expect(repoGroup.getAttribute('data-expanded')).toBe('false');
            expect(document.querySelector('[data-task-id="g2-a"]')).toBeNull();
            expect(screen.getByTestId('group-unseen-dot')).toBeTruthy();
        });

        it('respects manual plan-file group toggles only until the workspace changes or remounts', () => {
            const { rerender, props } = renderGrouped({ workspaceId: 'ws-a' });
            const firstGroup = screen.getAllByTestId('history-group')[0];
            const firstChevron = screen.getAllByTestId('group-chevron')[0];
            expect(firstGroup.getAttribute('data-expanded')).toBe('false');

            fireEvent.click(firstChevron);
            expect(firstGroup.getAttribute('data-expanded')).toBe('true');

            rerender(<ChatListPane {...props} workspaceId="__all" />);
            expect(screen.getAllByTestId('history-group')[0].getAttribute('data-expanded')).toBe('false');

            fireEvent.click(screen.getAllByTestId('group-chevron')[0]);
            expect(screen.getAllByTestId('history-group')[0].getAttribute('data-expanded')).toBe('true');

            rerender(<ChatListPane {...props} workspaceId="ws-a" />);
            expect(screen.getAllByTestId('history-group')[0].getAttribute('data-expanded')).toBe('false');
        });

        it('starts plan-file groups collapsed again after remounting the same workspace', () => {
            const { unmount } = renderGrouped({
                workspaceId: 'ws-a',
                unseenProcessIds: new Set(['g2-a']),
            });

            fireEvent.click(screen.getAllByTestId('group-chevron')[0]);
            expect(screen.getAllByTestId('history-group')[0].getAttribute('data-expanded')).toBe('true');

            unmount();
            renderGrouped({
                workspaceId: 'ws-a',
                unseenProcessIds: new Set(['g2-a']),
            });

            const unseenGroup = screen.getByTestId('group-unseen-dot').closest('[data-testid="history-group"]') as HTMLElement;
            expect(unseenGroup.getAttribute('data-expanded')).toBe('false');
            expect(screen.queryByTestId('history-group-children')).toBeNull();
            expect(screen.getByTestId('unseen-count-badge').textContent).toBe('1');
        });

        it('keeps new plan-file groups collapsed after history refresh without closing expanded groups', () => {
            const groupForPlan = (planFilePath: string) =>
                screen.getByTitle(planFilePath).closest('[data-testid="history-group"]') as HTMLElement;
            const { rerender, props } = renderGrouped({ workspaceId: 'ws-a' });

            const existingGroup = groupForPlan('/plans/plan2.md');
            fireEvent.click(existingGroup.querySelector('[data-testid="group-chevron"]')!);
            expect(existingGroup.getAttribute('data-expanded')).toBe('true');

            rerender(
                <ChatListPane
                    {...props}
                    history={[
                        ...makeGroupedHistory(),
                        makeHistoryTask({ id: 'g3-a', displayName: 'G3 Task A', planFilePath: '/plans/plan3.md', startTime: 600 }),
                        makeHistoryTask({ id: 'g3-b', displayName: 'G3 Task B', planFilePath: '/plans/plan3.md', startTime: 700 }),
                    ]}
                />,
            );

            expect(groupForPlan('/plans/plan2.md').getAttribute('data-expanded')).toBe('true');
            expect(groupForPlan('/plans/plan3.md').getAttribute('data-expanded')).toBe('false');
            expect(document.querySelector('[data-task-id="g3-a"]')).toBeNull();
        });

        it('keeps a manually collapsed unseen plan-file group collapsed after same-workspace refresh', () => {
            const groupForPlan = (planFilePath: string) =>
                screen.getByTitle(planFilePath).closest('[data-testid="history-group"]') as HTMLElement;
            const { rerender, props } = renderGrouped({
                workspaceId: 'ws-a',
                unseenProcessIds: new Set(['g2-a']),
                onMarkAllRead: vi.fn(),
            });

            const unseenGroup = groupForPlan('/plans/plan2.md');
            const unseenChevron = unseenGroup.querySelector('[data-testid="group-chevron"]')!;
            expect(unseenGroup.getAttribute('data-expanded')).toBe('false');

            fireEvent.click(unseenChevron);
            expect(unseenGroup.getAttribute('data-expanded')).toBe('true');
            expect(document.querySelector('[data-task-id="g2-a"]')).toBeTruthy();

            fireEvent.click(unseenChevron);
            expect(unseenGroup.getAttribute('data-expanded')).toBe('false');
            expect(document.querySelector('[data-task-id="g2-a"]')).toBeNull();

            rerender(
                <ChatListPane
                    {...props}
                    history={[
                        ...makeGroupedHistory(),
                        makeHistoryTask({ id: 'refresh-a', displayName: 'Refresh Task A', planFilePath: '/plans/refresh.md', startTime: 600 }),
                        makeHistoryTask({ id: 'refresh-b', displayName: 'Refresh Task B', planFilePath: '/plans/refresh.md', startTime: 700 }),
                    ]}
                />,
            );

            const refreshedUnseenGroup = groupForPlan('/plans/plan2.md');
            expect(refreshedUnseenGroup.getAttribute('data-expanded')).toBe('false');
            expect(document.querySelector('[data-task-id="g2-a"]')).toBeNull();
            expect(screen.getByTestId('group-unseen-dot')).toBeTruthy();
            expect(screen.getByTestId('unseen-count-badge').textContent).toBe('1');
            expect(screen.getByTestId('mark-all-read-btn')).toBeTruthy();
            expect(groupForPlan('/plans/refresh.md').getAttribute('data-expanded')).toBe('false');
        });

    });

    // ── Search ─────────────────────────────────────────────────────────
    describe('Search', () => {
        it('search input is hidden by default', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.queryByTestId('queue-search-input')).toBeNull();
        });

        it('Ctrl+F opens search bar', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.queryByTestId('queue-search-input')).toBeNull();
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            expect(screen.getByTestId('queue-search-input')).toBeTruthy();
        });

        it('search input has placeholder', () => {
            renderPane({ history: [makeHistoryTask()] });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            const input = screen.getByTestId('queue-search-input');
            expect(input.getAttribute('placeholder')).toContain('Search');
        });

        it('typing filters running tasks', () => {
            renderPane({
                running: [
                    makeRunningTask({ id: 'r-1', displayName: 'Alpha' }),
                    makeRunningTask({ id: 'r-2', displayName: 'Beta' }),
                ],
            });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            fireEvent.change(screen.getByTestId('queue-search-input'), { target: { value: 'Alpha' } });
            expect(document.querySelector('[data-task-id="r-1"]')).toBeTruthy();
            expect(document.querySelector('[data-task-id="r-2"]')).toBeNull();
        });

        it('typing filters history tasks', () => {
            renderPane({
                history: [
                    makeHistoryTask({ id: 'h-1', displayName: 'Gamma' }),
                    makeHistoryTask({ id: 'h-2', displayName: 'Delta' }),
                ],
            });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            fireEvent.change(screen.getByTestId('queue-search-input'), { target: { value: 'Delta' } });
            expect(document.querySelector('[data-task-id="h-2"]')).toBeTruthy();
            expect(document.querySelector('[data-task-id="h-1"]')).toBeNull();
        });

        it('match count shown when query non-empty', () => {
            renderPane({
                history: [makeHistoryTask({ id: 'h-1', displayName: 'Foo' })],
            });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            fireEvent.change(screen.getByTestId('queue-search-input'), { target: { value: 'Foo' } });
            // Match count is a plain span showing the number
            const searchBar = screen.getByTestId('queue-search-input').parentElement!;
            expect(searchBar.textContent).toContain('1');
        });

        it('close button clears the query but keeps the search bar open', () => {
            // ✕ only clears the query (and is itself only visible while there *is*
            // a query); the search bar stays open so the user can type again.
            renderPane({ history: [makeHistoryTask({ id: 'h-1', displayName: 'Foo' })] });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            const input = screen.getByTestId('queue-search-input');
            fireEvent.change(input, { target: { value: 'Foo' } });
            fireEvent.click(screen.getByTestId('queue-search-close'));
            const inputAfter = screen.getByTestId('queue-search-input') as HTMLInputElement;
            expect(inputAfter.value).toBe('');
        });

        it('Escape clears the query and hides the search bar', () => {
            renderPane({ history: [makeHistoryTask({ id: 'h-1', displayName: 'Foo' })] });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            const input = screen.getByTestId('queue-search-input');
            fireEvent.change(input, { target: { value: 'Foo' } });
            fireEvent.keyDown(document, { key: 'Escape' });
            // Escape both clears the query and closes the bar (hidden by default).
            expect(screen.queryByTestId('queue-search-input')).toBeNull();
        });
    });

    // ── Frozen task visual ─────────────────────────────────────────────
    describe('Frozen task visual', () => {
        it('frozen queued task shows ❄️ icon', () => {
            const { container } = renderPane({ queued: [makeQueuedTask({ frozen: true })] });
            expect(container.textContent).toContain('❄️');
        });

        it('frozen task card has task-frozen class', () => {
            renderPane({ queued: [makeQueuedTask({ frozen: true })] });
            const card = document.querySelector('[data-task-id="q-1"]');
            expect(card!.className).toContain('task-frozen');
        });
    });

    // ── Draft badge ────────────────────────────────────────────────────
    describe('Draft badge', () => {
        it('draft badge shown on running task when draft exists', () => {
            mockGetDraft.mockReturnValue('draft text');
            renderPane({ running: [makeRunningTask()] });
            expect(screen.getByTestId('draft-badge')).toBeTruthy();
        });

        it('no draft badge when no draft', () => {
            renderPane({ running: [makeRunningTask()] });
            expect(screen.queryByTestId('draft-badge')).toBeNull();
        });
    });

    // ── Unseen dot ─────────────────────────────────────────────────────
    describe('Unseen dot', () => {
        it('unseen dot shown on completed task', () => {
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
            });
            expect(screen.getByTestId('unseen-dot')).toBeTruthy();
        });

        it('unseen dot shown on pinned task', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
            });
            expect(screen.getByTestId('unseen-dot')).toBeTruthy();
        });

        it('unseen task title is bold', () => {
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
            });
            const card = document.querySelector('[data-task-id="h-1"]');
            const boldSpan = card!.querySelector('.font-semibold');
            expect(boldSpan).toBeTruthy();
            expect(boldSpan!.textContent).toContain('History Task');
        });

        it('unseen count badge in header', () => {
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
            });
            expect(screen.getByTestId('unseen-count-badge')).toBeTruthy();
            expect(screen.getByTestId('unseen-count-badge').textContent).toBe('1');
        });

        it('mark all read button shown', () => {
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
                onMarkAllRead: vi.fn(),
            });
            expect(screen.getByTestId('mark-all-read-btn')).toBeTruthy();
        });

        it('unseen dot shown on archived task', () => {
            mockArchivedChatIds = new Set(['h-1']);
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
            });
            // Expand the archived section
            fireEvent.click(screen.getByTestId('archived-chats-section-toggle'));
            expect(screen.getByTestId('unseen-dot')).toBeTruthy();
        });
    });

    // ── Pinned section mark all read ──────────────────────────────────
    describe('Pinned section mark all read', () => {
        it('mark all read button appears when unseen pinned items exist', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
                onMarkAllRead: vi.fn(),
            });
            expect(screen.getByTestId('mark-all-read-pinned-btn')).toBeTruthy();
        });

        it('clicking mark all read calls onMarkAllRead with pinned tasks', () => {
            mockPinnedChatIds = new Set(['h-1']);
            const onMarkAllRead = vi.fn();
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
                onMarkAllRead,
            });
            fireEvent.click(screen.getByTestId('mark-all-read-pinned-btn'));
            expect(onMarkAllRead).toHaveBeenCalledTimes(1);
            expect(onMarkAllRead.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'h-1' })]);
        });

        it('mark all read button hidden when no unseen pinned items', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(),
                onMarkAllRead: vi.fn(),
            });
            expect(screen.queryByTestId('mark-all-read-pinned-btn')).toBeNull();
        });

        it('unseen badge shows correct count for pinned section', () => {
            mockPinnedChatIds = new Set(['p-1', 'p-2']);
            renderPane({
                history: [
                    makeHistoryTask({ id: 'p-1', displayName: 'Pinned 1' }),
                    makeHistoryTask({ id: 'p-2', displayName: 'Pinned 2' }),
                ],
                unseenProcessIds: new Set(['p-1', 'p-2']),
            });
            expect(screen.getByTestId('unseen-pinned-count-badge')).toBeTruthy();
            expect(screen.getByTestId('unseen-pinned-count-badge').textContent).toBe('2');
        });
    });

    // ── Archived section mark all read ────────────────────────────────
    describe('Archived section mark all read', () => {
        it('mark all read button appears when unseen archived items exist', () => {
            mockArchivedChatIds = new Set(['h-1']);
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
                onMarkAllRead: vi.fn(),
            });
            expect(screen.getByTestId('mark-all-read-archived-btn')).toBeTruthy();
        });

        it('clicking mark all read calls onMarkAllRead with archived tasks', () => {
            mockArchivedChatIds = new Set(['h-1']);
            const onMarkAllRead = vi.fn();
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(['h-1']),
                onMarkAllRead,
            });
            fireEvent.click(screen.getByTestId('mark-all-read-archived-btn'));
            expect(onMarkAllRead).toHaveBeenCalledTimes(1);
            expect(onMarkAllRead.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'h-1' })]);
        });

        it('mark all read button hidden when no unseen archived items', () => {
            mockArchivedChatIds = new Set(['h-1']);
            renderPane({
                history: [makeHistoryTask()],
                unseenProcessIds: new Set(),
                onMarkAllRead: vi.fn(),
            });
            expect(screen.queryByTestId('mark-all-read-archived-btn')).toBeNull();
        });

        it('unseen badge shows correct count for archived section', () => {
            mockArchivedChatIds = new Set(['a-1', 'a-2', 'a-3']);
            renderPane({
                history: [
                    makeHistoryTask({ id: 'a-1', displayName: 'Archived 1' }),
                    makeHistoryTask({ id: 'a-2', displayName: 'Archived 2' }),
                    makeHistoryTask({ id: 'a-3', displayName: 'Archived 3' }),
                ],
                unseenProcessIds: new Set(['a-1', 'a-3']),
            });
            expect(screen.getByTestId('unseen-archived-count-badge')).toBeTruthy();
            expect(screen.getByTestId('unseen-archived-count-badge').textContent).toBe('2');
        });
    });

    // ── Mode pills ─────────────────────────────────────────────────────
    // The redesigned compact list surfaces task category via a MODE pill in the
    // 20px column. Pills show a single letter: A (ask/auto), R (ralph), S (script).
    describe('Mode pills', () => {
        it('chat ask renders A pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })],
            });
            expect(container.textContent).toContain('A');
        });

        it('legacy chat plan renders A pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'plan' } })],
            });
            expect(container.textContent).toContain('A');
            expect(container.textContent).not.toContain('PLAN');
        });

        it('chat default renders A pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat' })],
            });
            expect(container.textContent).toContain('A');
        });

        it('run-workflow renders A pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'run-workflow' })],
            });
            expect(container.textContent).toContain('A');
        });

        it('run-script renders S pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'run-script' })],
            });
            expect(container.textContent).toContain('S');
        });

        it('chat ralph renders R pill (execution phase)', () => {
            const { container } = renderPane({
                running: [makeRunningTask({
                    type: 'chat',
                    payload: { mode: 'ralph', context: { ralph: { sessionId: 's-1', phase: 'executing', originalGoal: 'g' } } },
                })],
            });
            expect(container.textContent).toContain('R');
        });

        it('chat ask + ralph context renders R pill (grilling phase)', () => {
            const { container } = renderPane({
                running: [makeRunningTask({
                    type: 'chat',
                    payload: { mode: 'ask', context: { ralph: { sessionId: 's-2', phase: 'grilling', originalGoal: 'g' } } },
                })],
            });
            expect(container.textContent).toContain('R');
        });

        it('plain ask (no ralph context) still renders A pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })],
            });
            expect(container.textContent).toContain('A');
        });

        it('ralph pill uses purple text class', () => {
            const { container } = renderPane({
                running: [makeRunningTask({
                    type: 'chat',
                    payload: { mode: 'ralph', context: { ralph: { sessionId: 's-3', phase: 'executing', originalGoal: 'g' } } },
                })],
            });
            const pill = Array.from(container.querySelectorAll('span')).find(el => el.textContent === 'R');
            expect(pill).toBeDefined();
            expect(pill!.className).toContain('text-purple-600');
        });

        it('ask pill uses rounded-full (circle) shape', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })],
            });
            const pill = Array.from(container.querySelectorAll('span')).find(el => el.textContent === 'A' && el.className.includes('text-amber'));
            expect(pill).toBeDefined();
            expect(pill!.className).toContain('rounded-full');
        });

        it('auto pill uses rounded-[3px] (rect) shape, not rounded-full', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'autopilot' } })],
            });
            const pill = Array.from(container.querySelectorAll('span')).find(el => el.textContent === 'A' && el.className.includes('text-emerald'));
            expect(pill).toBeDefined();
            expect(pill!.className).not.toContain('rounded-full');
        });
    });

    // ── Dense mode ─────────────────────────────────────────────────────
    // The redesigned compact list always uses a 26px-tall single-line row, so
    // the legacy taskCardDensity setting no longer changes per-row padding.
    // The setting still hides the prompt-preview line in dense mode.
    describe('Dense mode', () => {
        it('hides prompt preview', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            renderPane({
                history: [makeHistoryTask({ prompt: 'This is a prompt' })],
            });
            expect(screen.queryByText('This is a prompt')).toBeNull();
        });

        it('compact row is rendered as a CSS grid with the dot/pill/title/right columns', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            renderPane({ running: [makeRunningTask()] });
            const card = document.querySelector('[data-task-id="run-1"]');
            expect(card!.className).toContain('grid');
            expect(card!.className).toContain('grid-cols-[10px_20px_minmax(0,1fr)_auto]');
        });
    });

    // ── Delete chat ────────────────────────────────────────────────────
    describe('Delete chat', () => {
        it('confirm dialog shown on delete', async () => {
            renderPane({ history: [makeHistoryTask()], onMarkUnread: vi.fn() });
            fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
            // Completed tasks always use bulk menu path — "Delete 1 chats…"
            fireEvent.click(screen.getByText(/Delete 1 chats/));
            expect(window.confirm).toHaveBeenCalled();
        });

        it('DELETE called when confirmed', async () => {
            renderPane({ history: [makeHistoryTask()], onMarkUnread: vi.fn(), workspaceId: 'ws-1' });
            fireEvent.contextMenu(document.querySelector('[data-task-id="h-1"]')!);
            fireEvent.click(screen.getByText(/Delete 1 chats/));
            await waitFor(() => {
                expect(globalThis.fetch).toHaveBeenCalledWith(
                    expect.stringContaining('/workspaces/ws-1/history/'),
                    expect.objectContaining({ method: 'DELETE' }),
                );
            });
        });
    });

    // ── Shift+right-click bypass ───────────────────────────────────────
    describe('shift+right-click bypass', () => {
        it('shift+right-click does not open context menu', () => {
            renderPane({ running: [makeRunningTask()] });
            const card = document.querySelector('[data-task-id="run-1"]')!;
            fireEvent.contextMenu(card, { shiftKey: true });
            expect(screen.queryByTestId('context-menu')).toBeNull();
        });
    });

    // ── Prompt preview ─────────────────────────────────────────────────
    // The redesigned compact list is a single-line row, so the multi-line prompt
    // preview is gone. The prompt is now used as the title fallback when neither
    // displayName nor title are present (and is still truncated/skill-filtered
    // by getChatTitle).
    describe('Prompt preview', () => {
        it('falls back to prompt text as title when displayName and title are absent', () => {
            renderPane({
                history: [makeHistoryTask({ displayName: undefined, title: undefined, prompt: 'Fix the login bug' })],
            });
            expect(screen.getByText('Fix the login bug')).toBeTruthy();
        });

        it('truncates long prompts when used as title', () => {
            const longPrompt = 'A'.repeat(100);
            renderPane({
                history: [makeHistoryTask({ displayName: undefined, title: undefined, prompt: longPrompt })],
            });
            expect(screen.getByText('A'.repeat(47) + '…')).toBeTruthy();
        });

        it('does not surface prompts that match the skill-only pattern', () => {
            renderPane({
                history: [makeHistoryTask({ displayName: undefined, title: undefined, prompt: 'Use the deploy skill.' })],
            });
            expect(screen.queryByText(/Use the deploy skill/)).toBeNull();
        });
    });

    // ── History card rendering — ProcessHistoryItem fields ──────────────

    describe('History card: endTime fallback', () => {
        it('renders timestamp from endTime when completedAt is absent', () => {
            const task = makeHistoryTask({
                completedAt: undefined,
                endTime: new Date('2026-01-15T10:00:00Z').getTime(),
            });
            renderPane({ history: [task] });
            // The formatRelativeTime call should produce a timestamp string
            const card = document.querySelector('[data-task-id="h-1"]')!;
            expect(card).toBeTruthy();
            // Should contain tabular-nums span with text (not empty)
            const timestampEl = card.querySelector('.tabular-nums');
            expect(timestampEl?.textContent).not.toBe('');
        });

        it('renders empty timestamp when both completedAt and endTime are absent', () => {
            const task = makeHistoryTask({
                completedAt: undefined,
                endTime: undefined,
            });
            renderPane({ history: [task] });
            const card = document.querySelector('[data-task-id="h-1"]')!;
            const timestampEl = card.querySelector('.tabular-nums');
            expect(timestampEl?.textContent).toBe('');
        });
    });

    describe('History card: title fallback', () => {
        it('renders customTitle when set (user-set name)', () => {
            const task = makeHistoryTask({
                displayName: undefined,
                customTitle: 'My Chat Title',
            });
            renderPane({ history: [task] });
            expect(screen.getByText('My Chat Title')).toBeTruthy();
        });

        it('prefers customTitle over lastMessagePreview', () => {
            const task = makeHistoryTask({
                displayName: undefined,
                customTitle: 'Custom Name',
                lastMessagePreview: 'Latest message...',
            });
            renderPane({ history: [task] });
            expect(screen.getByText('Custom Name')).toBeTruthy();
            expect(screen.queryByText('Latest message...')).toBeNull();
        });

        it('prefers AI title over lastMessagePreview', () => {
            const task = makeHistoryTask({
                displayName: undefined,
                customTitle: undefined,
                title: 'AI Generated Title',
                lastMessagePreview: 'recent activity',
            });
            renderPane({ history: [task] });
            expect(screen.getByText('AI Generated Title')).toBeTruthy();
            expect(screen.queryByText('recent activity')).toBeNull();
        });

        it('falls back to lastMessagePreview when no customTitle or AI title', () => {
            const task = makeHistoryTask({
                displayName: undefined,
                customTitle: undefined,
                title: undefined,
                lastMessagePreview: 'recent activity',
            });
            renderPane({ history: [task] });
            expect(screen.getByText('recent activity')).toBeTruthy();
        });

        it('falls back to chat label when no customTitle, preview, or prompt', () => {
            const task = makeHistoryTask({
                displayName: undefined,
                customTitle: undefined,
                lastMessagePreview: undefined,
                title: undefined,
                prompt: undefined,
                promptPreview: undefined,
            });
            renderPane({ history: [task] });
            expect(screen.getByText('Chat')).toBeTruthy();
        });
    });

    // ── Load more button ────────────────────────────────────────────────
    describe('Load more button', () => {
        it('does not render Load more button when hasMore is false', () => {
            renderPane({ history: [makeHistoryTask()], hasMore: false, onLoadMore: vi.fn() });
            expect(screen.queryByTestId('activity-load-more-btn')).toBeNull();
        });

        it('does not render Load more button when onLoadMore is not provided', () => {
            renderPane({ history: [makeHistoryTask()], hasMore: true });
            expect(screen.queryByTestId('activity-load-more-btn')).toBeNull();
        });

        it('renders Load more button when hasMore is true and onLoadMore is provided', () => {
            renderPane({ history: [makeHistoryTask()], hasMore: true, onLoadMore: vi.fn() });
            expect(screen.getByTestId('activity-load-more-btn')).toBeTruthy();
            expect(screen.getByTestId('activity-load-more-btn').textContent).toContain('Load more');
        });

        it('calls onLoadMore when Load more button is clicked', () => {
            const onLoadMore = vi.fn();
            renderPane({ history: [makeHistoryTask()], hasMore: true, onLoadMore });
            fireEvent.click(screen.getByTestId('activity-load-more-btn'));
            expect(onLoadMore).toHaveBeenCalledTimes(1);
        });

        it('shows "Loading…" text when loadingMore is true', () => {
            renderPane({ history: [makeHistoryTask()], hasMore: true, loadingMore: true, onLoadMore: vi.fn() });
            expect(screen.getByTestId('activity-load-more-btn').textContent).toContain('Loading');
        });

        it('disables button when loadingMore is true', () => {
            renderPane({ history: [makeHistoryTask()], hasMore: true, loadingMore: true, onLoadMore: vi.fn() });
            expect(screen.getByTestId('activity-load-more-btn')).toHaveProperty('disabled', true);
        });

        it('keeps Load more visible when Completed Tasks section is collapsed', () => {
            renderPane({ history: [makeHistoryTask()], hasMore: true, onLoadMore: vi.fn() });
            // showHistory starts as true; click to collapse
            fireEvent.click(screen.getByText(/Completed Tasks/));
            expect(screen.getByTestId('activity-load-more-btn')).toBeTruthy();
        });

        it('renders Load more button after the Archived section', () => {
            mockArchivedChatIds = new Set(['h-a']);
            renderPane({
                history: [makeHistoryTask({ id: 'h-1' }), makeHistoryTask({ id: 'h-a' })],
                hasMore: true,
                onLoadMore: vi.fn(),
            });
            const btn = screen.getByTestId('activity-load-more-btn');
            const archivedToggle = screen.getByTestId('archived-chats-section-toggle');
            // Load more button should appear after the archived section in the DOM
            const comparison = archivedToggle.compareDocumentPosition(btn);
            // DOCUMENT_POSITION_FOLLOWING = 4
            expect(comparison & 4).toBeTruthy();
        });
    });

    // ── Server-side search results ─────────────────────────────────────
    describe('Server-side search results', () => {
        function makeSearchResultTask(overrides: Record<string, any> = {}) {
            return {
                id: 'sr-1',
                type: 'chat',
                status: 'completed',
                workspaceId: 'ws-1',
                displayName: 'Search Result Task',
                title: 'Search Result Task',
                promptPreview: 'some prompt',
                completedAt: '2026-01-01T00:00:00Z',
                endTime: '2026-01-01T00:00:00Z',
                _searchSnippet: 'found <mark>test</mark> in response',
                _isSearchResult: true,
                ...overrides,
            };
        }

        it('renders search results section when searchResults is non-null', () => {
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask()],
                searchTotal: 1,
            });
            expect(screen.getByText(/Search Results/)).toBeTruthy();
            expect(document.querySelector('[data-testid="search-result-item"]')).toBeTruthy();
        });

        it('hides pinned/completed/archived sections when searching', () => {
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({
                history: [makeHistoryTask({ id: 'h-1' }), makeHistoryTask({ id: 'h-2' })],
                searchResults: [makeSearchResultTask()],
                searchTotal: 1,
            });
            expect(screen.queryByTestId('pinned-chats-section-toggle')).toBeNull();
            expect(screen.queryByText(/Completed Tasks/)).toBeNull();
        });

        it('shows search result count including total', () => {
            const { container } = renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask()],
                searchTotal: 47,
            });
            // The header label and the count badge are siblings inside the section wrapper.
            const section = container.querySelector('[data-section="search-results"]') as HTMLElement | null;
            expect(section).toBeTruthy();
            expect(section!.textContent).toContain('Search Results');
            expect(section!.textContent).toContain('1');
            expect(section!.textContent).toContain('47');
        });

        it('shows "No matching conversations found" for empty results', () => {
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [],
                searchTotal: 0,
            });
            expect(screen.getByTestId('search-no-results')).toBeTruthy();
            expect(screen.getByText('No matching conversations found')).toBeTruthy();
        });

        it('renders search snippet with dangerouslySetInnerHTML', () => {
            const { container } = renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask({
                    _searchSnippet: 'found <mark>query</mark> here',
                })],
                searchTotal: 1,
            });
            const snippetEl = container.querySelector('[data-testid="search-snippet"]');
            expect(snippetEl).toBeTruthy();
            expect(snippetEl!.innerHTML).toContain('<mark>query</mark>');
        });

        it('encodes failure status via the row dot color in search results', () => {
            const { container } = renderPane({
                history: [makeHistoryTask()],
                searchResults: [
                    makeSearchResultTask({ id: 'sr-ok', status: 'completed' }),
                    makeSearchResultTask({ id: 'sr-fail', status: 'failed' }),
                ],
                searchTotal: 2,
            });
            // Status icons (✅/❌) were replaced by the colored status dot in the redesigned
            // compact list. Verify the failed row's dot uses the red status color, and the
            // completed row's dot uses the neutral gray.
            const okDot = container.querySelector('[data-task-id="sr-ok"] [aria-label^="status"]');
            const failDot = container.querySelector('[data-task-id="sr-fail"] [aria-label^="status"]');
            expect(okDot?.className).toContain('bg-[#bbbbbb]');
            expect(failDot?.className).toContain('bg-red-500');
        });

        it('calls onSelectTask when clicking a search result', () => {
            const onSelectTask = vi.fn();
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask({ id: 'sr-click' })],
                searchTotal: 1,
                onSelectTask,
            });
            fireEvent.click(screen.getByTestId('search-result-item'));
            expect(onSelectTask).toHaveBeenCalledWith('sr-click', expect.objectContaining({ id: 'sr-click' }));
        });

        it('highlights selected search result with ring', () => {
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask({ id: 'sr-sel' })],
                searchTotal: 1,
                selectedTaskId: 'sr-sel',
            });
            const card = document.querySelector('[data-task-id="sr-sel"]');
            expect(card?.className).toContain('ring-2');
        });

        it('shows Load more results button when searchHasMore is true', () => {
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask()],
                searchTotal: 100,
                searchHasMore: true,
                onLoadMoreSearchResults: vi.fn(),
            });
            expect(screen.getByTestId('search-load-more-btn')).toBeTruthy();
            expect(screen.getByTestId('search-load-more-btn').textContent).toContain('Load more results');
        });

        it('calls onLoadMoreSearchResults when Load more results is clicked', () => {
            const onLoadMore = vi.fn();
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask()],
                searchTotal: 100,
                searchHasMore: true,
                onLoadMoreSearchResults: onLoadMore,
            });
            fireEvent.click(screen.getByTestId('search-load-more-btn'));
            expect(onLoadMore).toHaveBeenCalledTimes(1);
        });

        it('shows loading state on Load more results button', () => {
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask()],
                searchTotal: 100,
                searchHasMore: true,
                searchLoadingMore: true,
                onLoadMoreSearchResults: vi.fn(),
            });
            expect(screen.getByTestId('search-load-more-btn').textContent).toContain('Loading');
            expect(screen.getByTestId('search-load-more-btn')).toHaveProperty('disabled', true);
        });

        it('does not show normal Load more when in search mode', () => {
            renderPane({
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask()],
                searchTotal: 1,
                hasMore: true,
                onLoadMore: vi.fn(),
            });
            expect(screen.queryByTestId('activity-load-more-btn')).toBeNull();
        });

        it('running tasks are still shown with client-side filter while searching', () => {
            renderPane({
                running: [makeRunningTask({ id: 'r-1', displayName: 'Active Run' })],
                history: [makeHistoryTask()],
                searchResults: [makeSearchResultTask()],
                searchTotal: 1,
            });
            expect(document.querySelector('[data-task-id="r-1"]')).toBeTruthy();
        });

        it('calls onSearchQueryChange when search input changes', () => {
            const onSearchQueryChange = vi.fn();
            renderPane({
                history: [makeHistoryTask()],
                onSearchQueryChange,
            });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            fireEvent.change(screen.getByTestId('queue-search-input'), { target: { value: 'test' } });
            expect(onSearchQueryChange).toHaveBeenCalledWith('test');
        });

        it('shows loading indicator when searchLoading is true', () => {
            renderPane({
                history: [makeHistoryTask()],
                searchLoading: true,
                searchResults: [],
                searchTotal: 0,
            });
            // Search loading indicator only visible when search bar is open
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            fireEvent.change(screen.getByTestId('queue-search-input'), { target: { value: 'test' } });
            expect(screen.getByTestId('search-loading-indicator')).toBeTruthy();
        });

        it('search placeholder says "Search all conversations…"', () => {
            renderPane({ history: [makeHistoryTask()] });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            const input = screen.getByTestId('queue-search-input');
            expect(input.getAttribute('placeholder')).toBe('Search all conversations…');
        });

        it('reverts to normal view when searchResults is null', () => {
            renderPane({
                history: [makeHistoryTask({ id: 'h-normal' })],
                searchResults: null,
                searchTotal: 0,
            });
            expect(screen.queryByText(/Search Results/)).toBeNull();
            expect(document.querySelector('[data-task-id="h-normal"]')).toBeTruthy();
        });
    });
});

describe('ChatListPane history range helpers', () => {
    const ralphSession: any = {
        kind: 'ralph-session',
        sessionId: 'rs-1',
        grillingProcess: { id: 'rs-1-grill' },
        iterations: [{ id: 'rs-1-iter-1' }, { id: 'rs-1-iter-2' }],
        latestTimestamp: 3,
        hasUnseen: false,
        phase: 'complete',
        loopCount: 1,
    };
    const forEachRun: any = {
        kind: 'for-each-run',
        runId: 'fe-1',
        run: {
            runId: 'fe-1',
            workspaceId: 'ws-1',
            status: 'completed',
            originalRequest: 'Split range work',
            childMode: 'ask',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:01:00.000Z',
            generationProcessId: 'fe-1-generation',
            itemCount: 2,
            itemStatusCounts: {
                pending: 0,
                running: 0,
                completed: 2,
                failed: 0,
                skipped: 0,
            },
        },
        children: [{ id: 'fe-1-generation' }, { id: 'fe-1-child-1' }],
        latestTimestamp: 2,
        hasUnseen: false,
    };
    const mapReduceRun: any = {
        kind: 'map-reduce-run',
        runId: 'mr-1',
        run: {
            runId: 'mr-1',
            workspaceId: 'ws-1',
            status: 'completed',
            reduceStatus: 'completed',
            originalRequest: 'Reduce range work',
            childMode: 'ask',
            reduceInstructions: 'Combine the outputs',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:01:00.000Z',
            generationProcessId: 'mr-1-generation',
            itemCount: 2,
        },
        children: [{ id: 'mr-1-generation' }, { id: 'mr-1-child-1' }, { id: 'mr-1-reduce' }],
        latestTimestamp: 2,
        hasUnseen: false,
    };

    it('expands a collapsed Ralph session sentinel into its child process ids', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, { id: 'regular-b' }],
            new Set(),
        );

        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            getRalphSessionRangeId('rs-1'),
            'regular-b',
        ]);
        expect(Array.from(resolveHistoryRangeSelection(rows, 'regular-a', 'regular-b')!)).toEqual([
            'regular-a',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'regular-b',
        ]);
    });

    it('uses individual Ralph child rows when the session is expanded', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, { id: 'regular-b' }],
            new Set(['rs-1']),
        );

        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'regular-b',
        ]);
        expect(Array.from(resolveHistoryRangeSelection(rows, 'regular-a', 'regular-b')!)).toEqual([
            'regular-a',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'regular-b',
        ]);
    });

    it('normalizes a Ralph child anchor to the group boundary when selecting outside the group', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, { id: 'regular-b' }],
            new Set(['rs-1']),
        );

        expect(Array.from(resolveHistoryRangeSelection(rows, 'rs-1-iter-2', 'regular-b')!)).toEqual([
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'regular-b',
        ]);
        expect(Array.from(resolveHistoryRangeSelection(rows, 'rs-1-iter-2', 'regular-a')!)).toEqual([
            'regular-a',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
        ]);
    });

    it('treats a collapsed For Each run as one endpoint and selects represented child process ids only', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, forEachRun, { id: 'regular-b' }],
            new Set(),
        );

        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            getForEachRunRangeId('fe-1'),
            'regular-b',
        ]);
        const selected = Array.from(resolveHistoryRangeSelection(rows, 'regular-a', 'regular-b')!);
        expect(selected).toEqual([
            'regular-a',
            'fe-1-generation',
            'fe-1-child-1',
            'regular-b',
        ]);
        expect(selected).not.toContain('fe-1');
    });

    it('uses For Each child rows when expanded while keeping the parent row as a selectable endpoint', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, forEachRun, { id: 'regular-b' }],
            new Set(),
            new Set(['fe-1']),
        );

        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            'fe-1-generation',
            'fe-1-child-1',
            'regular-b',
        ]);
        expect(Array.from(resolveHistoryRangeSelection(rows, 'regular-a', getForEachRunRangeId('fe-1'))!)).toEqual([
            'regular-a',
            'fe-1-generation',
            'fe-1-child-1',
        ]);
        expect(Array.from(resolveHistoryRangeSelection(rows, getForEachRunRangeId('fe-1'), 'regular-b')!)).toEqual([
            'fe-1-generation',
            'fe-1-child-1',
            'regular-b',
        ]);
    });

    // ── AC-01: Map Reduce runs (collapsed + expanded) ───────────────────
    it('AC-01: treats a collapsed Map Reduce run as one endpoint and selects its child process ids only', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, mapReduceRun, { id: 'regular-b' }],
            new Set(),
        );

        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            getMapReduceRunRangeId('mr-1'),
            'regular-b',
        ]);
        const selected = Array.from(resolveHistoryRangeSelection(rows, 'regular-a', 'regular-b')!);
        expect(selected).toEqual([
            'regular-a',
            'mr-1-generation',
            'mr-1-child-1',
            'mr-1-reduce',
            'regular-b',
        ]);
        expect(selected).not.toContain('mr-1');
    });

    it('AC-01: uses Map Reduce child rows when expanded while keeping the run header a selectable endpoint', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, mapReduceRun, { id: 'regular-b' }],
            new Set(),
            new Set(),
            new Set(['mr-1']),
        );

        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            'mr-1-generation',
            'mr-1-child-1',
            'mr-1-reduce',
            'regular-b',
        ]);
        // anchor = plain before, target = run header id → whole run + the plain
        expect(Array.from(resolveHistoryRangeSelection(rows, 'regular-a', getMapReduceRunRangeId('mr-1'))!)).toEqual([
            'regular-a',
            'mr-1-generation',
            'mr-1-child-1',
            'mr-1-reduce',
        ]);
        // anchor = a middle child, target = plain after → child anchor snaps to the
        // whole run boundary (group semantics), selecting the entire run + the plain.
        expect(Array.from(resolveHistoryRangeSelection(rows, 'mr-1-child-1', 'regular-b')!)).toEqual([
            'mr-1-generation',
            'mr-1-child-1',
            'mr-1-reduce',
            'regular-b',
        ]);
    });

    // ── AC-01: anchor-on-group-header / target-on-group-header ──────────
    it('AC-01: anchor on a collapsed group header selects the group plus the plain target', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, { id: 'regular-b' }],
            new Set(),
        );
        // anchor = ralph header, target = plain after
        expect(Array.from(resolveHistoryRangeSelection(rows, getRalphSessionRangeId('rs-1'), 'regular-b')!)).toEqual([
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'regular-b',
        ]);
        // anchor = ralph header, target = plain before
        expect(Array.from(resolveHistoryRangeSelection(rows, getRalphSessionRangeId('rs-1'), 'regular-a')!)).toEqual([
            'regular-a',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
        ]);
    });

    it('AC-01: target on a collapsed group header pulls in the whole group', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, forEachRun, { id: 'regular-b' }],
            new Set(),
        );
        // anchor = plain before, target = for-each header
        expect(Array.from(resolveHistoryRangeSelection(rows, 'regular-a', getForEachRunRangeId('fe-1'))!)).toEqual([
            'regular-a',
            'fe-1-generation',
            'fe-1-child-1',
        ]);
    });

    // ── AC-01: mixed-kind ranges spanning multiple group kinds ──────────
    it('AC-01: a plain→plain range spanning ralph + for-each + map-reduce (all collapsed) selects every child id in order', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, forEachRun, mapReduceRun, { id: 'regular-b' }],
            new Set(),
        );
        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            getRalphSessionRangeId('rs-1'),
            getForEachRunRangeId('fe-1'),
            getMapReduceRunRangeId('mr-1'),
            'regular-b',
        ]);
        const selected = Array.from(resolveHistoryRangeSelection(rows, 'regular-a', 'regular-b')!);
        expect(selected).toEqual([
            'regular-a',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'fe-1-generation',
            'fe-1-child-1',
            'mr-1-generation',
            'mr-1-child-1',
            'mr-1-reduce',
            'regular-b',
        ]);
        // no range-id sentinels leak into the selection
        expect(selected).not.toContain(getRalphSessionRangeId('rs-1'));
        expect(selected).not.toContain('fe-1');
        expect(selected).not.toContain('mr-1');
    });

    it('AC-01: a mixed range from one group header to another selects both groups and everything between', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, { id: 'regular-mid' }, mapReduceRun, { id: 'regular-b' }],
            new Set(),
        );
        // anchor = ralph header, target = map-reduce header
        const selected = Array.from(resolveHistoryRangeSelection(rows, getRalphSessionRangeId('rs-1'), getMapReduceRunRangeId('mr-1'))!);
        expect(selected).toEqual([
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'regular-mid',
            'mr-1-generation',
            'mr-1-child-1',
            'mr-1-reduce',
        ]);
    });

    it('AC-01: a mixed range with groups expanded selects the same child ids as when collapsed', () => {
        const collapsedRows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, forEachRun, { id: 'regular-b' }],
            new Set(),
        );
        const expandedRows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, forEachRun, { id: 'regular-b' }],
            new Set(['rs-1']),
            new Set(['fe-1']),
        );
        const collapsed = Array.from(resolveHistoryRangeSelection(collapsedRows, 'regular-a', 'regular-b')!);
        const expanded = Array.from(resolveHistoryRangeSelection(expandedRows, 'regular-a', 'regular-b')!);
        expect(expanded).toEqual(collapsed);
        expect(expanded).toEqual([
            'regular-a',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'fe-1-generation',
            'fe-1-child-1',
            'regular-b',
        ]);
    });

    it('AC-01: an expanded-group child anchor to a child in a different expanded group selects both whole groups', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, forEachRun, { id: 'regular-b' }],
            new Set(['rs-1']),
            new Set(['fe-1']),
        );
        // anchor = a ralph child, target = a for-each child → both groups whole
        const selected = Array.from(resolveHistoryRangeSelection(rows, 'rs-1-iter-1', 'fe-1-child-1')!);
        expect(selected).toEqual([
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'fe-1-generation',
            'fe-1-child-1',
        ]);
    });

    it('AC-01: resolveHistoryRangeSelection returns null when an endpoint is not present', () => {
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, ralphSession, { id: 'regular-b' }],
            new Set(),
        );
        expect(resolveHistoryRangeSelection(rows, 'regular-a', 'does-not-exist')).toBeNull();
        expect(resolveHistoryRangeSelection(rows, 'does-not-exist', 'regular-b')).toBeNull();
    });

    // ── AC-05: spawned-conversation trees participate in range selection ──
    //
    // Build a real spawned tree via groupBySpawnedTree so the fixture matches
    // production shape exactly. Shape (children sorted oldest-first by activity):
    //   st-root
    //   ├─ st-child-1  (ts 5)
    //   │   └─ st-gc-1  (ts 4)
    //   └─ st-child-2  (ts 6)
    // Pre-order chat ids: st-root, st-child-1, st-gc-1, st-child-2.
    const makeSpawnedTree = (): SpawnedTreeEntry => {
        const tasks = [
            { id: 'st-root', lastActivityAt: 10 },
            { id: 'st-child-1', parentProcessId: 'st-root', lastActivityAt: 5 },
            { id: 'st-child-2', parentProcessId: 'st-root', lastActivityAt: 6 },
            { id: 'st-gc-1', parentProcessId: 'st-child-1', lastActivityAt: 4 },
        ];
        const entry = groupBySpawnedTree(tasks).find(
            (e): e is SpawnedTreeEntry => (e as any).kind === 'spawned-tree',
        );
        if (!entry) throw new Error('fixture: expected a spawned-tree entry');
        return entry;
    };

    it('AC-05: a collapsed spawned tree is one endpoint that selects root + all descendants as a unit', () => {
        const tree = makeSpawnedTree();
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, tree, { id: 'regular-b' }],
            new Set(),
            new Set(),
            new Set(),
            new Set(['st-root']), // root collapsed → whole tree hidden under one row
        );
        expect(rows.map(row => row.id)).toEqual(['regular-a', 'st-root', 'regular-b']);
        // The single collapsed row carries the whole subtree.
        expect(rows[1]).toMatchObject({ kind: 'spawned-tree', rootProcessId: 'st-root' });
        expect(Array.from(resolveHistoryRangeSelection(rows, 'regular-a', 'regular-b')!)).toEqual([
            'regular-a',
            'st-root',
            'st-child-1',
            'st-gc-1',
            'st-child-2',
            'regular-b',
        ]);
        // Anchoring on the collapsed tree itself still selects the whole unit.
        expect(Array.from(resolveHistoryRangeSelection(rows, 'st-root', 'st-root')!)).toEqual([
            'st-root',
            'st-child-1',
            'st-gc-1',
            'st-child-2',
        ]);
    });

    it('AC-05: an expanded spawned tree exposes each visible node as an independent range row', () => {
        const tree = makeSpawnedTree();
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, tree, { id: 'regular-b' }],
            new Set(),
            new Set(),
            new Set(),
            new Set(), // nothing collapsed → fully expanded (default-expanded contract)
        );
        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            'st-root',
            'st-child-1',
            'st-gc-1',
            'st-child-2',
            'regular-b',
        ]);
        expect(rows.every(row => row.kind === 'task')).toBe(true);
        // A sub-range inside the tree selects only the visible nodes it spans —
        // no whole-tree snapping, so descendants outside the span stay unselected.
        expect(Array.from(resolveHistoryRangeSelection(rows, 'st-root', 'st-child-1')!)).toEqual([
            'st-root',
            'st-child-1',
        ]);
        // Spanning the whole tree selects every node.
        expect(Array.from(resolveHistoryRangeSelection(rows, 'st-root', 'st-child-2')!)).toEqual([
            'st-root',
            'st-child-1',
            'st-gc-1',
            'st-child-2',
        ]);
    });

    it('AC-05: a collapsed inner node stays a sub-unit while its expanded root remains individually selectable', () => {
        const tree = makeSpawnedTree();
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, tree, { id: 'regular-b' }],
            new Set(),
            new Set(),
            new Set(),
            new Set(['st-child-1']), // root expanded, inner child-1 collapsed → hides st-gc-1
        );
        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            'st-root',
            'st-child-1',
            'st-child-2',
            'regular-b',
        ]);
        // The collapsed inner node is the unit that represents its hidden grandchild.
        expect(rows[2]).toMatchObject({ kind: 'spawned-tree', id: 'st-child-1' });
        // Selecting the collapsed inner node pulls in its hidden grandchild.
        expect(Array.from(resolveHistoryRangeSelection(rows, 'st-child-1', 'st-child-1')!)).toEqual([
            'st-child-1',
            'st-gc-1',
        ]);
        // A range across the tree includes the hidden grandchild via the inner unit.
        expect(Array.from(resolveHistoryRangeSelection(rows, 'st-root', 'st-child-2')!)).toEqual([
            'st-root',
            'st-child-1',
            'st-gc-1',
            'st-child-2',
        ]);
    });

    it('AC-05: a mixed range spanning a plain chat, a collapsed spawned tree, and a collapsed ralph session selects every child id in order', () => {
        const tree = makeSpawnedTree();
        const rows = buildHistoryRangeRows(
            [{ id: 'regular-a' }, tree, ralphSession, { id: 'regular-b' }],
            new Set(),
            new Set(),
            new Set(),
            new Set(['st-root']),
        );
        expect(rows.map(row => row.id)).toEqual([
            'regular-a',
            'st-root',
            getRalphSessionRangeId('rs-1'),
            'regular-b',
        ]);
        const selected = Array.from(resolveHistoryRangeSelection(rows, 'regular-a', 'regular-b')!);
        expect(selected).toEqual([
            'regular-a',
            'st-root',
            'st-child-1',
            'st-gc-1',
            'st-child-2',
            'rs-1-grill',
            'rs-1-iter-1',
            'rs-1-iter-2',
            'regular-b',
        ]);
        // No synthetic range-id sentinel leaks into the selection.
        expect(selected).not.toContain(getRalphSessionRangeId('rs-1'));
    });

    it('AC-05: spawned-tree entries are no longer dropped from the range rows (regression guard)', () => {
        const tree = makeSpawnedTree();
        // Before AC-05 a SpawnedTreeEntry (no `id`, has `rootProcessId`) fell
        // through every branch and was silently dropped, leaving a gap that
        // shift-range skipped over. It must now contribute at least one row.
        const collapsed = buildHistoryRangeRows([tree], new Set(), new Set(), new Set(), new Set(['st-root']));
        expect(collapsed).toHaveLength(1);
        const expanded = buildHistoryRangeRows([tree], new Set(), new Set(), new Set(), new Set());
        expect(expanded.map(row => row.id)).toEqual(['st-root', 'st-child-1', 'st-gc-1', 'st-child-2']);
    });
});

// ── AC-06: partial group-header selection state ────────────────────────
describe('resolveGroupSelectionState', () => {
    it('returns neither full nor partial for an empty group', () => {
        expect(resolveGroupSelectionState([], new Set())).toEqual({
            isFullySelected: false,
            isPartiallySelected: false,
        });
    });

    it('returns neither when no child is selected', () => {
        expect(resolveGroupSelectionState(['a', 'b', 'c'], new Set(['x', 'y']))).toEqual({
            isFullySelected: false,
            isPartiallySelected: false,
        });
    });

    it('is fully selected — not partial — when every child is selected', () => {
        expect(resolveGroupSelectionState(['a', 'b', 'c'], new Set(['a', 'b', 'c']))).toEqual({
            isFullySelected: true,
            isPartiallySelected: false,
        });
    });

    it('is partially selected — not full — when some but not all children are selected', () => {
        expect(resolveGroupSelectionState(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual({
            isFullySelected: false,
            isPartiallySelected: true,
        });
    });

    it('treats a single selected child of a multi-child group as partial', () => {
        expect(resolveGroupSelectionState(['a', 'b', 'c'], new Set(['b']))).toEqual({
            isFullySelected: false,
            isPartiallySelected: true,
        });
    });

    it('treats a single-child group as full (never partial) when that child is selected', () => {
        expect(resolveGroupSelectionState(['solo'], new Set(['solo']))).toEqual({
            isFullySelected: true,
            isPartiallySelected: false,
        });
    });

    it('ignores selected ids that are not children of the group', () => {
        // Extra unrelated selection entries do not push a fully-selected group
        // into a partial state.
        expect(resolveGroupSelectionState(['a', 'b'], new Set(['a', 'b', 'unrelated']))).toEqual({
            isFullySelected: true,
            isPartiallySelected: false,
        });
    });
});

describe('taskMatchesFilter: exclusion logic', () => {
    it('returns true when excludedTypes is empty', () => {
        expect(taskMatchesFilter({ type: 'chat', payload: {} }, new Set())).toBe(true);
    });

    it('excludes chat type when "chat" is excluded', () => {
        expect(taskMatchesFilter({ type: 'chat', payload: {} }, new Set(['chat']))).toBe(false);
    });

    it('excludes chat with mode when parent "chat" is excluded', () => {
        expect(taskMatchesFilter({ type: 'chat', payload: { mode: 'ask' } }, new Set(['chat']))).toBe(false);
    });

    it('excludes chat by mode', () => {
        expect(taskMatchesFilter({ type: 'chat', payload: { mode: 'ask' } }, new Set(['ask']))).toBe(false);
    });

    it('excludes legacy plan chat when ask is excluded', () => {
        expect(taskMatchesFilter({ type: 'chat', payload: { mode: 'plan' } }, new Set(['ask']))).toBe(false);
    });

    it('does not exclude chat without mode when only mode is excluded', () => {
        expect(taskMatchesFilter({ type: 'chat', payload: {} }, new Set(['ask']))).toBe(true);
    });

    it('excludes run-workflow type', () => {
        expect(taskMatchesFilter({ type: 'run-workflow', payload: {} }, new Set(['run-workflow']))).toBe(false);
    });

    it('does not exclude run-workflow when chat is excluded', () => {
        expect(taskMatchesFilter({ type: 'run-workflow', payload: {} }, new Set(['chat']))).toBe(true);
    });

    it('excludes run-script type', () => {
        expect(taskMatchesFilter({ type: 'run-script', payload: {} }, new Set(['run-script']))).toBe(false);
    });

    it('does not exclude run-script when run-workflow is excluded', () => {
        expect(taskMatchesFilter({ type: 'run-script', payload: {} }, new Set(['run-workflow']))).toBe(true);
    });

    it('handles unknown type with exclusion', () => {
        expect(taskMatchesFilter({ type: 'custom', payload: {} }, new Set(['custom']))).toBe(false);
    });

    it('handles unknown type without exclusion', () => {
        expect(taskMatchesFilter({ type: 'custom', payload: {} }, new Set(['chat']))).toBe(true);
    });

    // ── Flat mode field (ProcessHistoryItem shape) ──

    it('excludes by flat mode field when payload.mode is absent', () => {
        expect(taskMatchesFilter({ type: 'chat', mode: 'ask' }, new Set(['ask']))).toBe(false);
    });

    it('includes by flat mode field when another mode is excluded', () => {
        expect(taskMatchesFilter({ type: 'chat', mode: 'ask' }, new Set(['autopilot']))).toBe(true);
    });

    it('prefers payload.mode over flat mode', () => {
        expect(taskMatchesFilter({ type: 'chat', mode: 'plan', payload: { mode: 'ask' } }, new Set(['ask']))).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// taskMatchesSearch: promptPreview support
// ═══════════════════════════════════════════════════════════════════════

describe('taskMatchesSearch: promptPreview support', () => {
    it('matches by promptPreview field', () => {
        expect(taskMatchesSearch({ promptPreview: 'hello world' }, 'hello')).toBe(true);
    });

    it('does not match when promptPreview does not contain query', () => {
        expect(taskMatchesSearch({ promptPreview: 'hello world' }, 'goodbye')).toBe(false);
    });

    it('prefers prompt over promptPreview', () => {
        expect(taskMatchesSearch({ prompt: 'first', promptPreview: 'second' }, 'first')).toBe(true);
    });

    it('falls back to promptPreview when prompt is absent', () => {
        expect(taskMatchesSearch({ promptPreview: 'fallback text' }, 'fallback')).toBe(true);
    });

    it('returns true for empty query', () => {
        expect(taskMatchesSearch({ promptPreview: 'anything' }, '')).toBe(true);
    });
});

// ═══════════════════════════════════════════════════════════════════════
// getTaskTypeIcon: flat mode and scheduleId
// ═══════════════════════════════════════════════════════════════════════

describe('getTaskTypeIcon: flat mode and scheduleId', () => {
    it('returns 💡 for chat with flat mode=ask', () => {
        expect(getTaskTypeIcon({ type: 'chat', mode: 'ask' })).toBe('💡');
    });

    it('returns 💡 for chat with legacy flat mode=plan', () => {
        expect(getTaskTypeIcon({ type: 'chat', mode: 'plan' })).toBe('💡');
    });

    it('returns 🤖 for chat with no mode', () => {
        expect(getTaskTypeIcon({ type: 'chat' })).toBe('🤖');
    });

    it('returns 📅 for flat scheduleId', () => {
        expect(getTaskTypeIcon({ type: 'chat', scheduleId: 's1' })).toBe('📅');
    });

    it('returns 📅 for payload.scheduleId', () => {
        expect(getTaskTypeIcon({ type: 'chat', payload: { scheduleId: 's1' } })).toBe('📅');
    });

    it('prefers payload.mode over flat mode', () => {
        expect(getTaskTypeIcon({ type: 'chat', mode: 'autopilot', payload: { mode: 'plan' } })).toBe('💡');
    });

    it('returns ▶️ for run-workflow', () => {
        expect(getTaskTypeIcon({ type: 'run-workflow' })).toBe('▶️');
    });

    it('returns 🛠️ for run-script', () => {
        expect(getTaskTypeIcon({ type: 'run-script' })).toBe('🛠️');
    });
});

// ═══════════════════════════════════════════════════════════════════════
// getTaskPromptPreview: promptPreview field
// ═══════════════════════════════════════════════════════════════════════

describe('getTaskPromptPreview: promptPreview field', () => {
    it('uses promptPreview when prompt is absent', () => {
        expect(getTaskPromptPreview({ promptPreview: 'short text' })).toBe('short text');
    });

    it('truncates long promptPreview', () => {
        const longText = 'a'.repeat(100);
        const result = getTaskPromptPreview({ promptPreview: longText });
        expect(result.length).toBeLessThanOrEqual(60);
        expect(result).toContain('…');
    });

    it('prefers prompt over promptPreview', () => {
        expect(getTaskPromptPreview({ prompt: 'direct', promptPreview: 'preview' })).toBe('direct');
    });

    it('returns empty for skill invocation prompt', () => {
        expect(getTaskPromptPreview({ promptPreview: 'Use the impl skill.' })).toBe('');
    });
});

describe('getTaskModeKey / getTaskModeLabel — Ralph', () => {
    it('returns ralph for chat task with payload.mode === ralph', () => {
        const t = { type: 'chat', payload: { mode: 'ralph', context: { ralph: { sessionId: 's1' } } } };
        expect(getTaskModeKey(t)).toBe('ralph');
        expect(getTaskModeLabel(t)).toBe('R');
    });

    it('returns ralph for chat task with mode=ask + ralph context (grilling phase)', () => {
        const t = { type: 'chat', payload: { mode: 'ask', context: { ralph: { sessionId: 's2', phase: 'grilling' } } } };
        expect(getTaskModeKey(t)).toBe('ralph');
        expect(getTaskModeLabel(t)).toBe('R');
    });

    it('returns ralph when ralph context lives on metadata (history projection)', () => {
        const t = { type: 'chat', payload: { mode: 'autopilot' }, metadata: { ralph: { sessionId: 's3' } } };
        expect(getTaskModeKey(t)).toBe('ralph');
        expect(getTaskModeLabel(t)).toBe('R');
    });

    it('returns ask for plain ask task without ralph context (regression)', () => {
        const t = { type: 'chat', payload: { mode: 'ask' } };
        expect(getTaskModeKey(t)).toBe('ask');
        expect(getTaskModeLabel(t)).toBe('A');
    });

    it('returns auto for plain autopilot chat task', () => {
        const t = { type: 'chat', payload: { mode: 'autopilot' } };
        expect(getTaskModeKey(t)).toBe('auto');
        expect(getTaskModeLabel(t)).toBe('A');
    });
});

describe('getTaskTypeIcon — Ralph', () => {
    it('returns the loop icon for chat task with ralph context (grilling phase, mode=ask)', () => {
        const t = { type: 'chat', payload: { mode: 'ask', context: { ralph: { sessionId: 's-g' } } } };
        expect(getTaskTypeIcon(t)).toBe('🔄');
    });

    it('returns the loop icon for chat task with payload.mode === ralph', () => {
        const t = { type: 'chat', payload: { mode: 'ralph' } };
        expect(getTaskTypeIcon(t)).toBe('🔄');
    });
});

// ── Mobile single-tap regression ──────────────────────────────────────
describe('Mobile single-tap navigation', () => {
    it('single click on a history task calls onSelectTask immediately on mobile (no multi-select)', () => {
        const { props } = renderPane({
            isMobile: true,
            history: [makeHistoryTask({ id: 'h-mob-1', displayName: 'Mobile Task' })],
        });
        const card = document.querySelector('[data-task-id="h-mob-1"]');
        expect(card).toBeTruthy();
        fireEvent.click(card!);
        expect(props.onSelectTask).toHaveBeenCalledTimes(1);
        expect(props.onSelectTask).toHaveBeenCalledWith('h-mob-1', expect.anything());
    });

    it('single click on mobile does not enter multi-select state', () => {
        renderPane({
            isMobile: true,
            history: [
                makeHistoryTask({ id: 'h-mob-1', displayName: 'Task A' }),
                makeHistoryTask({ id: 'h-mob-2', displayName: 'Task B' }),
            ],
        });
        const cardA = document.querySelector('[data-task-id="h-mob-1"]');
        fireEvent.click(cardA!);
        // No selection pill should appear (multi-select is bypassed on mobile)
        expect(screen.queryByTestId('selection-count-pill')).toBeNull();
    });

    it('shift+click on mobile still directly navigates (no range selection)', () => {
        const { props } = renderPane({
            isMobile: true,
            history: [
                makeHistoryTask({ id: 'h-mob-1', displayName: 'Task A' }),
                makeHistoryTask({ id: 'h-mob-2', displayName: 'Task B' }),
            ],
        });
        const cardA = document.querySelector('[data-task-id="h-mob-1"]');
        const cardB = document.querySelector('[data-task-id="h-mob-2"]');
        fireEvent.click(cardA!);
        fireEvent.click(cardB!, { shiftKey: true });
        // On mobile, both clicks should call onSelectTask (no range selection)
        expect(props.onSelectTask).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('selection-count-pill')).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// AC-03: spawned-conversation tree rendering in the chat list
// ════════════════════════════════════════════════════════════════════════
describe('ChatListPane spawned-conversation tree (AC-03)', () => {
    const SPAWNED_TOGGLE_KEY = 'coc-spawned-tree-enabled';
    const SPAWNED_COLLAPSED_KEY = 'coc-spawned-tree-collapsed';

    beforeEach(() => {
        vi.clearAllMocks();
        mockPinnedChatIds = new Set();
        mockArchivedChatIds = new Set();
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        try {
            window.localStorage.removeItem(SPAWNED_TOGGLE_KEY);
            window.localStorage.removeItem(SPAWNED_COLLAPSED_KEY);
        } catch { /* ignore */ }
    });

    /** A root chat that spawned `child`, which in turn spawned `grand`. */
    function spawnTreeHistory(now: number) {
        const stamp = (offsetMs: number) => ({
            completedAt: new Date(now - offsetMs).toISOString(),
            lastActivityAt: now - offsetMs,
            startTime: now - offsetMs,
        });
        return [
            makeHistoryTask({ id: 'root', displayName: 'Root Chat', ...stamp(3000) }),
            makeHistoryTask({ id: 'child', displayName: 'Child Chat', parentProcessId: 'root', ...stamp(2000) }),
            makeHistoryTask({ id: 'grand', displayName: 'Grandchild Chat', parentProcessId: 'child', ...stamp(1000) }),
            makeHistoryTask({ id: 'lonely', displayName: 'Lonely Chat', ...stamp(500) }),
        ];
    }

    it('renders the root as a spawned-tree with a recursive sub-job count and nests descendants', () => {
        const now = Date.now();
        renderPane({ activeTab: 'chats', now, history: spawnTreeHistory(now) });

        // Root is rendered inside a spawned-tree row.
        const treeRow = document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]') as HTMLElement;
        expect(treeRow).toBeTruthy();
        expect(treeRow.querySelector('[data-task-id="root"]')).toBeTruthy();

        // Sub-job count = ALL descendants (child + grandchild) = 2.
        const countChip = treeRow.querySelector('[data-testid="spawned-tree-child-count"]');
        expect(countChip?.textContent).toBe('2');

        // Descendants nest under the tree (default expanded) and do NOT appear
        // as separate flat top-level rows: each id resolves to exactly one row.
        expect(document.querySelectorAll('[data-task-id="child"]')).toHaveLength(1);
        expect(document.querySelectorAll('[data-task-id="grand"]')).toHaveLength(1);
        const childInTree = treeRow.querySelector('[data-testid="spawned-tree-children"] [data-task-id="child"]');
        expect(childInTree).toBeTruthy();

        // The unrelated chat stays a normal flat row (not in any tree).
        const lonely = document.querySelector('[data-task-id="lonely"]');
        expect(lonely).toBeTruthy();
        expect(lonely!.closest('[data-testid="spawned-tree-row"]')).toBeNull();
    });

    it('collapsing a root hides its descendants and persists the collapsed id', () => {
        const now = Date.now();
        renderPane({ activeTab: 'chats', now, history: spawnTreeHistory(now) });

        const rootNode = document.querySelector('[data-testid="spawned-tree-node"][data-node-id="root"]') as HTMLElement;
        const chevron = rootNode.querySelector('[data-testid="spawned-tree-chevron"]') as HTMLElement;
        expect(chevron).toBeTruthy();

        // Default expanded: descendants visible.
        expect(document.querySelector('[data-task-id="child"]')).toBeTruthy();

        fireEvent.click(chevron);

        // Collapsed: descendants gone, root still visible.
        expect(document.querySelector('[data-task-id="child"]')).toBeNull();
        expect(document.querySelector('[data-task-id="root"]')).toBeTruthy();

        // Persisted so the collapse survives a reload.
        const persisted = JSON.parse(window.localStorage.getItem(SPAWNED_COLLAPSED_KEY) || '[]');
        expect(persisted).toContain('root');
    });

    it('toggle OFF (persisted) flattens the tree back to standard rows', () => {
        window.localStorage.setItem(SPAWNED_TOGGLE_KEY, 'false');
        const now = Date.now();
        renderPane({ activeTab: 'chats', now, history: spawnTreeHistory(now) });

        // No tree wrapper; every chat renders as a flat row.
        expect(document.querySelector('[data-testid="spawned-tree-row"]')).toBeNull();
        expect(document.querySelector('[data-task-id="root"]')).toBeTruthy();
        expect(document.querySelector('[data-task-id="child"]')).toBeTruthy();
        expect(document.querySelector('[data-task-id="grand"]')).toBeTruthy();
    });

    // ════════════════════════════════════════════════════════════════════
    // AC-01 / AC-02: archived spawned subtrees leave COMPLETED and render as
    // nested trees under ARCHIVED (fixes the leak where an archived tree node
    // stayed rendered under COMPLETED).
    // ════════════════════════════════════════════════════════════════════

    /** root → childA (leaf) and root → childB → grand — a two-branch tree. */
    function spawnTreeTwoBranch(now: number) {
        const stamp = (offsetMs: number) => ({
            completedAt: new Date(now - offsetMs).toISOString(),
            lastActivityAt: now - offsetMs,
            startTime: now - offsetMs,
        });
        return [
            makeHistoryTask({ id: 'root', displayName: 'Root Chat', ...stamp(4000) }),
            makeHistoryTask({ id: 'childA', displayName: 'Child A', parentProcessId: 'root', ...stamp(3000) }),
            makeHistoryTask({ id: 'childB', displayName: 'Child B', parentProcessId: 'root', ...stamp(2000) }),
            makeHistoryTask({ id: 'grand', displayName: 'Grandchild', parentProcessId: 'childB', ...stamp(1000) }),
        ];
    }

    it('AC-01/AC-02: archiving the root moves the whole subtree out of COMPLETED and into ARCHIVED as a nested tree', () => {
        mockArchivedChatIds = new Set(['root']);
        const now = Date.now();
        renderPane({ activeTab: 'chats', now, history: spawnTreeHistory(now) });

        // The archived tree is gone from COMPLETED entirely (archived section is
        // collapsed by default, so its subtree is not rendered anywhere yet).
        expect(document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]')).toBeNull();
        expect(document.querySelector('[data-task-id="child"]')).toBeNull();
        expect(document.querySelector('[data-task-id="grand"]')).toBeNull();

        // The unrelated chat stays a normal flat row under COMPLETED.
        expect(document.querySelector('[data-task-id="lonely"]')).toBeTruthy();

        // The archived toggle reports the moved subtree as one archived tree.
        const toggle = screen.getByTestId('chat-archived-toggle');
        expect(toggle.textContent).toContain('1');

        // Expanding ARCHIVED reveals the same tree, nested, with its full sub-job
        // count (child + grandchild = 2).
        fireEvent.click(toggle);
        const archivedTree = document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]') as HTMLElement;
        expect(archivedTree).toBeTruthy();
        expect(archivedTree.querySelector('[data-testid="spawned-tree-child-count"]')?.textContent).toBe('2');
        expect(archivedTree.querySelector('[data-testid="spawned-tree-children"] [data-task-id="child"]')).toBeTruthy();
        expect(archivedTree.querySelector('[data-task-id="grand"]')).toBeTruthy();
    });

    it('AC-01: archiving a middle node splits it off — the active root keeps its other branch in COMPLETED, the archived branch nests under ARCHIVED', () => {
        mockArchivedChatIds = new Set(['childB']);
        const now = Date.now();
        renderPane({ activeTab: 'chats', now, history: spawnTreeTwoBranch(now) });

        // The active root stays in COMPLETED with only its non-archived branch
        // (childA). Sub-job count drops to 1 (childB + grand peeled off).
        const activeTree = document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]') as HTMLElement;
        expect(activeTree).toBeTruthy();
        expect(activeTree.querySelector('[data-testid="spawned-tree-child-count"]')?.textContent).toBe('1');
        expect(activeTree.querySelector('[data-task-id="childA"]')).toBeTruthy();
        // The archived branch is absent from COMPLETED (archived + collapsed).
        expect(document.querySelector('[data-task-id="childB"]')).toBeNull();
        expect(document.querySelector('[data-task-id="grand"]')).toBeNull();

        // Expanding ARCHIVED reveals the split-off branch rooted at childB.
        fireEvent.click(screen.getByTestId('chat-archived-toggle'));
        const archivedTree = document.querySelector('[data-testid="spawned-tree-row"][data-root-id="childB"]') as HTMLElement;
        expect(archivedTree).toBeTruthy();
        expect(archivedTree.querySelector('[data-testid="spawned-tree-child-count"]')?.textContent).toBe('1');
        expect(archivedTree.querySelector('[data-task-id="grand"]')).toBeTruthy();
        // The active root did NOT follow the archived branch out of COMPLETED.
        expect(document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]')).toBeTruthy();
    });

    it('AC-01: archiving a leaf keeps the parent tree in COMPLETED and demotes the leaf to a flat row under ARCHIVED', () => {
        mockArchivedChatIds = new Set(['grand']);
        const now = Date.now();
        renderPane({ activeTab: 'chats', now, history: spawnTreeHistory(now) });

        // Parent tree stays in COMPLETED; only the archived leaf is pruned, so the
        // sub-job count drops to 1 (child only).
        const activeTree = document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]') as HTMLElement;
        expect(activeTree).toBeTruthy();
        expect(activeTree.querySelector('[data-testid="spawned-tree-child-count"]')?.textContent).toBe('1');
        expect(activeTree.querySelector('[data-task-id="child"]')).toBeTruthy();
        expect(document.querySelector('[data-task-id="grand"]')).toBeNull();

        // The archived leaf has no descendants, so it renders as a flat archived
        // row (not a tree).
        fireEvent.click(screen.getByTestId('chat-archived-toggle'));
        const grand = document.querySelector('[data-task-id="grand"]');
        expect(grand).toBeTruthy();
        expect(grand!.closest('[data-testid="spawned-tree-row"]')).toBeNull();
    });

    it('AC-01: archiving the only leaf of a two-node tree demotes both roots to flat rows (COMPLETED parent, ARCHIVED leaf)', () => {
        mockArchivedChatIds = new Set(['child']);
        const now = Date.now();
        const stamp = (offsetMs: number) => ({
            completedAt: new Date(now - offsetMs).toISOString(),
            lastActivityAt: now - offsetMs,
            startTime: now - offsetMs,
        });
        renderPane({
            activeTab: 'chats',
            now,
            history: [
                makeHistoryTask({ id: 'root', displayName: 'Root Chat', ...stamp(2000) }),
                makeHistoryTask({ id: 'child', displayName: 'Child Chat', parentProcessId: 'root', ...stamp(1000) }),
            ],
        });

        // The root lost its only child, so there is no tree left — the root
        // demotes to a plain COMPLETED row.
        expect(document.querySelector('[data-testid="spawned-tree-row"]')).toBeNull();
        const root = document.querySelector('[data-task-id="root"]');
        expect(root).toBeTruthy();
        expect(root!.closest('[data-testid="spawned-tree-row"]')).toBeNull();
        expect(document.querySelector('[data-task-id="child"]')).toBeNull();

        // The archived leaf surfaces as a flat row under ARCHIVED.
        fireEvent.click(screen.getByTestId('chat-archived-toggle'));
        expect(document.querySelector('[data-task-id="child"]')).toBeTruthy();
    });

    it('AC-03: with no archived ids the whole tree stays in COMPLETED and ARCHIVED is empty (display-only, reversible)', () => {
        mockArchivedChatIds = new Set();
        const now = Date.now();
        renderPane({ activeTab: 'chats', now, history: spawnTreeHistory(now) });

        // Full tree in COMPLETED, no archived section at all.
        const tree = document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]') as HTMLElement;
        expect(tree).toBeTruthy();
        expect(tree.querySelector('[data-testid="spawned-tree-child-count"]')?.textContent).toBe('2');
        expect(screen.queryByTestId('chat-archived-toggle')).toBeNull();
    });

    it('AC-02: the Activity-tab ARCHIVED section also renders the archived subtree as a nested tree', () => {
        mockArchivedChatIds = new Set(['root']);
        const now = Date.now();
        // No activeTab → the Activity branch (Completed Tasks / 📦 Archived).
        renderPane({ now, history: spawnTreeHistory(now) });

        // Not in COMPLETED (archived + collapsed archived section).
        expect(document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]')).toBeNull();

        // Expand the Activity-tab archived toggle → nested tree appears.
        fireEvent.click(screen.getByTestId('archived-chats-section-toggle'));
        const archivedTree = document.querySelector('[data-testid="spawned-tree-row"][data-root-id="root"]') as HTMLElement;
        expect(archivedTree).toBeTruthy();
        expect(archivedTree.querySelector('[data-testid="spawned-tree-child-count"]')?.textContent).toBe('2');
        expect(archivedTree.querySelector('[data-testid="spawned-tree-children"] [data-task-id="child"]')).toBeTruthy();
    });
});

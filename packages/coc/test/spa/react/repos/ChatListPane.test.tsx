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
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test-utils';
import {
    ChatListPane,
    taskMatchesFilter,
    taskMatchesSearch,
    getTaskTypeIcon,
    getTaskPromptPreview,
    getTaskModeKey,
    getTaskModeLabel,
} from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

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

// ── Utilities / config ──
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isLoopsEnabled: () => false,
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
            expect(container.textContent).toContain('ASK');
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

        it('collapsing section hides task cards', () => {
            renderPane({ queued: [makeQueuedTask()] });
            expect(document.querySelector('[data-task-id="q-1"]')).toBeTruthy();
            fireEvent.click(screen.getByTestId('queued-tasks-section-toggle'));
            expect(document.querySelector('[data-task-id="q-1"]')).toBeNull();
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

    });

    // ── Search ─────────────────────────────────────────────────────────
    describe('Search', () => {
        it('Ctrl+F opens search bar', () => {
            renderPane({ history: [makeHistoryTask()] });
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

        it('close button clears the query but keeps the search bar visible', () => {
            // Activity-compact reference: search input is permanent. ✕ only clears
            // the query (and is itself only visible while there *is* a query).
            renderPane({ history: [makeHistoryTask({ id: 'h-1', displayName: 'Foo' })] });
            const input = screen.getByTestId('queue-search-input');
            fireEvent.change(input, { target: { value: 'Foo' } });
            fireEvent.click(screen.getByTestId('queue-search-close'));
            const inputAfter = screen.getByTestId('queue-search-input') as HTMLInputElement;
            expect(inputAfter.value).toBe('');
        });

        it('Escape clears the query but keeps the search bar visible', () => {
            renderPane({ history: [makeHistoryTask({ id: 'h-1', displayName: 'Foo' })] });
            const input = screen.getByTestId('queue-search-input');
            fireEvent.change(input, { target: { value: 'Foo' } });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            fireEvent.keyDown(document, { key: 'Escape' });
            const inputAfter = screen.getByTestId('queue-search-input') as HTMLInputElement;
            expect(inputAfter.value).toBe('');
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
    // 36px column instead of inline emoji icons. Pills are ASK / AUTO / SCRP.
    describe('Mode pills', () => {
        it('chat ask renders ASK pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })],
            });
            expect(container.textContent).toContain('ASK');
        });

        it('legacy chat plan renders ASK pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'plan' } })],
            });
            expect(container.textContent).toContain('ASK');
            expect(container.textContent).not.toContain('PLAN');
        });

        it('chat default renders AUTO pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat' })],
            });
            expect(container.textContent).toContain('AUTO');
        });

        it('run-workflow renders AUTO pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'run-workflow' })],
            });
            expect(container.textContent).toContain('AUTO');
        });

        it('run-script renders SCRP pill', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'run-script' })],
            });
            expect(container.textContent).toContain('SCRP');
        });

        it('chat ralph renders RLPH pill (execution phase)', () => {
            const { container } = renderPane({
                running: [makeRunningTask({
                    type: 'chat',
                    payload: { mode: 'ralph', context: { ralph: { sessionId: 's-1', phase: 'executing', originalGoal: 'g' } } },
                })],
            });
            expect(container.textContent).toContain('RLPH');
            expect(container.textContent).not.toContain('AUTO');
        });

        it('chat ask + ralph context renders RLPH pill (grilling phase)', () => {
            const { container } = renderPane({
                running: [makeRunningTask({
                    type: 'chat',
                    payload: { mode: 'ask', context: { ralph: { sessionId: 's-2', phase: 'grilling', originalGoal: 'g' } } },
                })],
            });
            expect(container.textContent).toContain('RLPH');
            expect(container.textContent).not.toContain('ASK');
        });

        it('plain ask (no ralph context) still renders ASK', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })],
            });
            expect(container.textContent).toContain('ASK');
            expect(container.textContent).not.toContain('RLPH');
        });

        it('ralph pill uses purple text class', () => {
            const { container } = renderPane({
                running: [makeRunningTask({
                    type: 'chat',
                    payload: { mode: 'ralph', context: { ralph: { sessionId: 's-3', phase: 'executing', originalGoal: 'g' } } },
                })],
            });
            const pill = Array.from(container.querySelectorAll('span')).find(el => el.textContent === 'RLPH');
            expect(pill).toBeDefined();
            expect(pill!.className).toContain('text-purple-600');
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
            expect(card!.className).toContain('grid-cols-[10px_36px_minmax(0,1fr)_auto]');
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
        expect(getTaskModeLabel(t)).toBe('RLPH');
    });

    it('returns ralph for chat task with mode=ask + ralph context (grilling phase)', () => {
        const t = { type: 'chat', payload: { mode: 'ask', context: { ralph: { sessionId: 's2', phase: 'grilling' } } } };
        expect(getTaskModeKey(t)).toBe('ralph');
        expect(getTaskModeLabel(t)).toBe('RLPH');
    });

    it('returns ralph when ralph context lives on metadata (history projection)', () => {
        const t = { type: 'chat', payload: { mode: 'autopilot' }, metadata: { ralph: { sessionId: 's3' } } };
        expect(getTaskModeKey(t)).toBe('ralph');
        expect(getTaskModeLabel(t)).toBe('RLPH');
    });

    it('returns ask for plain ask task without ralph context (regression)', () => {
        const t = { type: 'chat', payload: { mode: 'ask' } };
        expect(getTaskModeKey(t)).toBe('ask');
        expect(getTaskModeLabel(t)).toBe('ASK');
    });

    it('returns auto for plain autopilot chat task', () => {
        const t = { type: 'chat', payload: { mode: 'autopilot' } };
        expect(getTaskModeKey(t)).toBe('auto');
        expect(getTaskModeLabel(t)).toBe('AUTO');
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

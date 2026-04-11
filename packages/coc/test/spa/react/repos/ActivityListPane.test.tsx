/**
 * Render tests for ActivityListPane.
 *
 * Dropped source-level tests that inspected code text rather than behavior:
 *   - Export name checks (TASK_TYPE_LABELS, QueueTaskItem, …)
 *   - TypeScript interface shape assertions (ActivityListPaneProps)
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
    ActivityListPane,
    taskMatchesFilter,
    taskMatchesSearch,
    getTaskTypeIcon,
    getTaskPromptPreview,
} from '../../../../src/server/spa/client/react/repos/ActivityListPane';

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
vi.mock('../../../../src/server/spa/client/react/context/ChatPreferencesContext', () => ({
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
vi.mock('../../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => mockDisplaySettings,
    invalidateDisplaySettings: vi.fn(),
}));

// ── Queue drag-drop (desktop) ──
vi.mock('../../../../src/server/spa/client/react/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createDragStartHandler: () => vi.fn(), createDragEndHandler: () => vi.fn(),
        createDragOverHandler: () => vi.fn(), createDragEnterHandler: () => vi.fn(),
        createDragLeaveHandler: () => vi.fn(), createDropHandler: () => vi.fn(),
    }),
}));

// ── Queue touch drag ──
vi.mock('../../../../src/server/spa/client/react/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        draggedTaskId: null, dropTargetIndex: null, dropPosition: null,
        createTouchStartHandler: () => vi.fn(),
    }),
}));

// ── Long-press ──
vi.mock('../../../../src/server/spa/client/react/hooks/useLongPress', () => ({
    useLongPress: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn(), onTouchMove: vi.fn(), didLongPress: () => false }),
}));

// ── Draft store ──
const mockGetDraft = vi.fn().mockReturnValue(null);
vi.mock('../../../../src/server/spa/client/react/hooks/useDraftStore', () => ({
    getDraft: (id: string) => mockGetDraft(id),
}));

// ── Workflow progress ──
vi.mock('../../../../src/server/spa/client/react/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => null,
}));

// ── Utilities / config ──
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => '',
}));

vi.mock('../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn(),
    formatDuration: (ms: number) => `${Math.round(ms / 1000)}s`,
    formatRelativeTime: (d: string) => d,
}));

vi.mock('../../../../src/server/spa/client/react/processes/ConversationMetadataPopover', () => ({
    buildRows: () => [{ label: 'Type', value: 'chat' }],
}));

// ── Swipeable wrapper — passthrough ──
vi.mock('../../../../src/server/spa/client/react/repos/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Summarize dialog — stub ──
vi.mock('../../../../src/server/spa/client/react/repos/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));

// ── useBreakpoint (used by Dialog inside RenameDialog) ──
vi.mock('../../../../src/server/spa/client/react/hooks/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));

// ── Factory helpers ────────────────────────────────────────────────────

function makeTask(overrides: Record<string, any> = {}): Record<string, any> {
    return {
        id: 'task-1',
        type: 'chat',
        displayName: 'Test Task',
        status: 'completed',
        completedAt: '2026-01-01T00:00:00Z',
        payload: {},
        ...overrides,
    };
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
    return { ...renderWithProviders(<ActivityListPane {...props} />), props };
}

// ════════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════════

describe('ActivityListPane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockPinnedChatIds = new Set();
        mockArchivedChatIds = new Set();
        mockDisplaySettings = { taskCardDensity: 'normal', showReportIntent: false };
        mockGetDraft.mockReturnValue(null);
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
        vi.spyOn(window, 'confirm').mockReturnValue(true);
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

        it('shows "Queue Task" button when not paused', () => {
            renderPane();
            expect(screen.getByTestId('repo-queue-task-btn-empty')).toBeTruthy();
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

        it('shows autopilot paused banner', () => {
            renderPane({
                isAutopilotPaused: true,
                onPauseResumeAutopilot: vi.fn(),
                history: [makeHistoryTask()],
            });
            expect(screen.getByTestId('autopilot-paused-banner')).toBeTruthy();
        });
    });

    // ── Toolbar ────────────────────────────────────────────────────────
    describe('Toolbar', () => {
        it('renders refresh button', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.getByTestId('queue-refresh-btn')).toBeTruthy();
        });

        it('pause button shows ⏸ when not paused', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.getByTestId('repo-pause-resume-btn').textContent).toContain('⏸');
        });

        it('pause button shows ▶ when paused', () => {
            renderPane({ isPaused: true, history: [makeHistoryTask()] });
            expect(screen.getByTestId('repo-pause-resume-btn').textContent).toContain('▶');
        });
    });

    // ── Running Tasks section ──────────────────────────────────────────
    describe('Running Tasks section', () => {
        it('shows section header with count', () => {
            renderPane({ running: [makeRunningTask()] });
            const toggle = screen.getByTestId('running-tasks-section-toggle');
            expect(toggle.textContent).toContain('Running Tasks');
            expect(toggle.textContent).toContain('(1)');
        });

        it('hides section when no running tasks', () => {
            renderPane({ history: [makeHistoryTask()] });
            expect(screen.queryByTestId('running-tasks-section-toggle')).toBeNull();
        });

        it('shows task display name', () => {
            renderPane({ running: [makeRunningTask({ displayName: 'Build App' })] });
            expect(screen.getByText('Build App')).toBeTruthy();
        });

        it('shows type icon for ask mode', () => {
            const { container } = renderPane({ running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })] });
            expect(container.textContent).toContain('💡');
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
    });

    // ── Queued Tasks section ───────────────────────────────────────────
    describe('Queued Tasks section', () => {
        it('shows section header with count', () => {
            renderPane({ queued: [makeQueuedTask()] });
            const toggle = screen.getByTestId('queued-tasks-section-toggle');
            expect(toggle.textContent).toContain('Queued Tasks');
            expect(toggle.textContent).toContain('(1)');
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
            expect(toggle.textContent).toContain('📌 Pinned');
            expect(toggle.textContent).toContain('(1)');
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
            expect(toggle.textContent).toContain('(1)');
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
            expect(container.textContent).toContain('(1)');
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
            expect(toggle.textContent).toContain('(1)');
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
                    expect(body.title).toBe('New Name');
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

        it('close button clears and hides', () => {
            renderPane({ history: [makeHistoryTask()] });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            expect(screen.getByTestId('queue-search-input')).toBeTruthy();
            fireEvent.click(screen.getByTestId('queue-search-close'));
            expect(screen.queryByTestId('queue-search-input')).toBeNull();
        });

        it('Escape closes search', () => {
            renderPane({ history: [makeHistoryTask()] });
            fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
            expect(screen.getByTestId('queue-search-input')).toBeTruthy();
            fireEvent.keyDown(document, { key: 'Escape' });
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

    // ── Type icons ─────────────────────────────────────────────────────
    describe('Type icons', () => {
        it('chat ask shows 💡', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'ask' } })],
            });
            expect(container.textContent).toContain('💡');
        });

        it('chat plan shows 📋', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat', payload: { mode: 'plan' } })],
            });
            expect(container.textContent).toContain('📋');
        });

        it('chat default shows 🤖', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'chat' })],
            });
            expect(container.textContent).toContain('🤖');
        });

        it('run-workflow shows ▶️', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'run-workflow' })],
            });
            expect(container.textContent).toContain('▶️');
        });

        it('run-script shows 🛠️', () => {
            const { container } = renderPane({
                running: [makeRunningTask({ type: 'run-script' })],
            });
            expect(container.textContent).toContain('🛠️');
        });
    });

    // ── Dense mode ─────────────────────────────────────────────────────
    describe('Dense mode', () => {
        it('hides prompt preview', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            renderPane({
                history: [makeHistoryTask({ prompt: 'This is a prompt' })],
            });
            expect(screen.queryByText('This is a prompt')).toBeNull();
        });

        it('uses tighter padding with mobile-responsive vertical padding', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            renderPane({ running: [makeRunningTask()] });
            const card = document.querySelector('[data-task-id="run-1"]');
            expect(card!.className).toContain('px-2');
            expect(card!.className).toContain('py-2.5');
            expect(card!.className).toContain('md:py-1');
        });

        it('uses reduced gap for section containers', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            const { container } = renderPane({ running: [makeRunningTask()] });
            const gapEl = container.querySelector('.gap-0\\.5');
            expect(gapEl).toBeTruthy();
        });

        it('applies mobile-responsive padding to history cards', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            renderPane({ history: [makeHistoryTask()] });
            const card = document.querySelector('[data-task-id="h-1"]');
            expect(card!.className).toContain('py-2.5');
            expect(card!.className).toContain('md:py-1');
        });

        it('applies mobile-responsive padding to pinned cards', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            mockPinnedChatIds = new Set(['h-1']);
            renderPane({ history: [makeHistoryTask()] });
            const card = document.querySelector('[data-task-id="h-1"]');
            expect(card!.className).toContain('py-2.5');
            expect(card!.className).toContain('md:py-1');
        });

        it('applies mobile-responsive padding to queued cards', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            renderPane({ queued: [makeQueuedTask()] });
            const card = document.querySelector('[data-task-id="q-1"]');
            expect(card!.className).toContain('py-2.5');
            expect(card!.className).toContain('md:py-1');
        });

        it('applies mobile-responsive padding to archived cards', () => {
            mockDisplaySettings = { taskCardDensity: 'dense', showReportIntent: false };
            mockArchivedChatIds = new Set(['h-1']);
            renderPane({ history: [makeHistoryTask()] });
            // Archived section is collapsed by default — expand it
            fireEvent.click(screen.getByTestId('archived-chats-section-toggle'));
            const card = document.querySelector('[data-task-id="h-1"]');
            expect(card!.className).toContain('py-2.5');
            expect(card!.className).toContain('md:py-1');
        });

        it('does not apply mobile-responsive padding in compact mode', () => {
            mockDisplaySettings = { taskCardDensity: 'compact', showReportIntent: false };
            renderPane({ history: [makeHistoryTask()] });
            const card = document.querySelector('[data-task-id="h-1"]');
            expect(card!.className).not.toContain('py-2.5');
            expect(card!.className).not.toContain('md:py-1');
        });

        it('does not apply mobile-responsive padding in normal mode', () => {
            mockDisplaySettings = { taskCardDensity: 'normal', showReportIntent: false };
            renderPane({ history: [makeHistoryTask()] });
            const card = document.querySelector('[data-task-id="h-1"]');
            expect(card!.className).not.toContain('py-2.5');
            expect(card!.className).not.toContain('md:py-1');
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
                    expect.stringContaining('/api/workspaces/ws-1/history/'),
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
    describe('Prompt preview', () => {
        it('shows prompt preview in compact mode', () => {
            renderPane({
                history: [makeHistoryTask({ prompt: 'Fix the login bug' })],
            });
            expect(screen.getByText('Fix the login bug')).toBeTruthy();
        });

        it('truncates long prompts', () => {
            const longPrompt = 'A'.repeat(100);
            renderPane({
                history: [makeHistoryTask({ prompt: longPrompt })],
            });
            expect(screen.getByText('A'.repeat(57) + '…')).toBeTruthy();
        });

        it('hides prompt matching skill pattern', () => {
            renderPane({
                history: [makeHistoryTask({ prompt: 'Use the deploy skill.' })],
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
        it('renders title field when displayName is absent', () => {
            const task = makeHistoryTask({
                displayName: undefined,
                title: 'My Chat Title',
            });
            renderPane({ history: [task] });
            expect(screen.getByText('My Chat Title')).toBeTruthy();
        });

        it('prefers displayName over title', () => {
            const task = makeHistoryTask({
                displayName: 'Display Name',
                title: 'Title Name',
            });
            renderPane({ history: [task] });
            expect(screen.getByText('Display Name')).toBeTruthy();
            expect(screen.queryByText('Title Name')).toBeNull();
        });

        it('falls back to type when both displayName and title are absent', () => {
            const task = makeHistoryTask({
                displayName: undefined,
                title: undefined,
            });
            renderPane({ history: [task] });
            expect(screen.getByText('chat')).toBeTruthy();
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

    it('does not exclude chat with different mode', () => {
        expect(taskMatchesFilter({ type: 'chat', payload: { mode: 'plan' } }, new Set(['ask']))).toBe(true);
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

    it('includes by flat mode field when not excluded', () => {
        expect(taskMatchesFilter({ type: 'chat', mode: 'ask' }, new Set(['plan']))).toBe(true);
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

    it('returns 📋 for chat with flat mode=plan', () => {
        expect(getTaskTypeIcon({ type: 'chat', mode: 'plan' })).toBe('📋');
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
        expect(getTaskTypeIcon({ type: 'chat', mode: 'ask', payload: { mode: 'plan' } })).toBe('📋');
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

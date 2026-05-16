/**
 * Tests for useAllLoops hook and ChatListPane loop awareness:
 * - inline 🔁 indicator on chat rows with active/paused loops
 * - "Loops" scope segment in the tab bar
 * - feature gate via isLoopsEnabled()
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ---

const mockListAll = vi.fn().mockResolvedValue([]);

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        loops: { listAll: mockListAll },
    }),
}));

let loopsEnabledValue = false;
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isLoopsEnabled: () => loopsEnabledValue,
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        handleDragStart: vi.fn(),
        handleDragOver: vi.fn(),
        handleDrop: vi.fn(),
        handleDragEnd: vi.fn(),
        dragOverIndex: null,
        dragSourceIndex: null,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        handleTouchStart: vi.fn(),
        handleTouchMove: vi.fn(),
        handleTouchEnd: vi.fn(),
        isDragging: false,
        dragOverIndex: null,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({
        onTouchStart: vi.fn(),
        onTouchEnd: vi.fn(),
        onTouchMove: vi.fn(),
        didLongPress: () => false,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => ({
        progress: null,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    useChatPrefs: () => ({
        pinnedChatIds: new Set(),
        archivedChatIds: new Set(),
        onPinChat: vi.fn(),
        onUnpinChat: vi.fn(),
        onArchiveChat: vi.fn(),
        onUnarchiveChat: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { isTaskSubmitting: false },
        setPriority: vi.fn(),
        remove: vi.fn(),
        reload: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: {
            myWorkExcludedTypes: [],
            selectedWorkspaceId: 'ws-test',
        },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({
        getBoolean: () => false,
        setBoolean: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/list-mode-config', () => ({
    getListModeConfig: () => ({
        showRunningSection: true,
        showQueueSection: true,
        showHistorySection: true,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    buildRows: () => [],
}));

vi.mock('../../../../src/server/spa/client/react/ui/RenameDialog', () => ({
    RenameDialog: () => null,
}));

vi.mock('../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: () => null,
}));

import { ChatListPane } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

function makeTask(overrides: Record<string, any> = {}) {
    return {
        id: 'task-1',
        type: 'chat',
        status: 'completed',
        displayName: 'Test Chat',
        startedAt: new Date().toISOString(),
        payload: { mode: 'ask' },
        ...overrides,
    };
}

const defaultProps = {
    running: [],
    queued: [],
    history: [],
    isPaused: false,
    isPauseResumeLoading: false,
    isRefreshing: false,
    selectedTaskId: null,
    isMobile: false,
    now: Date.now(),
    workspaceId: 'ws-test',
    onSelectTask: vi.fn(),
    onPauseResume: vi.fn(),
    onRefresh: vi.fn(),
    onOpenDialog: vi.fn(),
    fetchQueue: vi.fn().mockResolvedValue(undefined),
};

describe('ChatListPane loop awareness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loopsEnabledValue = false;
        mockListAll.mockResolvedValue([]);
        // Clear localStorage
        try { localStorage.removeItem('coc-activity-scope'); } catch { /* ignore */ }
    });

    describe('feature gate', () => {
        it('does not show Loops scope tab when loops disabled', async () => {
            loopsEnabledValue = false;
            const tasks = [makeTask({ id: 'task-x', displayName: 'Some Chat' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const tabs = screen.getByTestId('activity-scope-tabs');
            expect(within(tabs).queryByTestId('activity-scope-tab-loops')).toBeNull();
        });

        it('shows Loops scope tab when loops enabled', async () => {
            loopsEnabledValue = true;
            const tasks = [makeTask({ id: 'task-x', displayName: 'Some Chat' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const tabs = screen.getByTestId('activity-scope-tabs');
            expect(within(tabs).getByTestId('activity-scope-tab-loops')).toBeTruthy();
        });
    });

    describe('Loops segment tab', () => {
        it('displays correct count of conversations with loops', async () => {
            loopsEnabledValue = true;
            const tasks = [
                makeTask({ id: 'proc-a', displayName: 'Chat A' }),
                makeTask({ id: 'proc-b', displayName: 'Chat B' }),
                makeTask({ id: 'proc-c', displayName: 'Chat C' }),
            ];
            mockListAll.mockResolvedValue([
                { id: 'loop-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
                { id: 'loop-2', processId: 'proc-b', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'test', prompt: '', model: null },
                { id: 'loop-3', processId: 'proc-c', status: 'cancelled', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            // proc-a (active) and proc-b (paused) should be counted; proc-c is cancelled
            const countEl = screen.getByTestId('activity-scope-count-loops');
            expect(countEl.textContent).toBe('2');
        });

        it('filters chat list to only conversations with loops when Loops tab is active', async () => {
            loopsEnabledValue = true;
            const tasks = [
                makeTask({ id: 'proc-a', displayName: 'Chat A' }),
                makeTask({ id: 'proc-b', displayName: 'Chat B' }),
            ];
            mockListAll.mockResolvedValue([
                { id: 'loop-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            // Click the Loops tab
            const loopsTab = screen.getByTestId('activity-scope-tab-loops');
            await act(async () => {
                await userEvent.click(loopsTab);
            });
            // Only proc-a should be visible (has an active loop)
            const rows = screen.getAllByTestId('history-task-row');
            expect(rows).toHaveLength(1);
        });
    });

    describe('inline loop indicator', () => {
        it('shows 🔁 indicator with green tint for active loops', async () => {
            loopsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            mockListAll.mockResolvedValue([
                { id: 'loop-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const indicator = screen.getByTestId('loop-indicator');
            expect(indicator.querySelector('[data-testid="loop-icon"]')).toBeTruthy();
            expect(indicator.title).toBe('Has active loops');
            // Green tint class
            expect(indicator.className).toContain('text-[#15703a]');
        });

        it('shows 🔁 indicator with amber tint for paused loops', async () => {
            loopsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            mockListAll.mockResolvedValue([
                { id: 'loop-1', processId: 'proc-a', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'test', prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const indicator = screen.getByTestId('loop-indicator');
            expect(indicator.title).toBe('Has paused loops');
            // Amber tint class
            expect(indicator.className).toContain('text-[#8a5a00]');
        });

        it('does not show loop indicator when loops disabled', async () => {
            loopsEnabledValue = false;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            expect(screen.queryByTestId('loop-indicator')).toBeNull();
        });

        it('does not show loop indicator for conversations without loops', async () => {
            loopsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-no-loop', displayName: 'Chat No Loop' })];
            mockListAll.mockResolvedValue([]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            expect(screen.queryByTestId('loop-indicator')).toBeNull();
        });

        it('active state takes priority over paused when both exist', async () => {
            loopsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            mockListAll.mockResolvedValue([
                { id: 'loop-1', processId: 'proc-a', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'test', prompt: '', model: null },
                { id: 'loop-2', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const indicator = screen.getByTestId('loop-indicator');
            // Active takes priority — should show green
            expect(indicator.title).toBe('Has active loops');
            expect(indicator.className).toContain('text-[#15703a]');
        });
    });

    describe('WebSocket-driven refresh', () => {
        it('refetches and updates row indicator when coc-ws-message loop-paused arrives', async () => {
            loopsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            // First fetch: active loop → green
            mockListAll.mockResolvedValueOnce([
                { id: 'loop-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            let indicator = screen.getByTestId('loop-indicator');
            expect(indicator.title).toBe('Has active loops');
            expect(indicator.className).toContain('text-[#15703a]');

            // Second fetch (after WS event): now paused → amber
            mockListAll.mockResolvedValueOnce([
                { id: 'loop-1', processId: 'proc-a', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'user-paused', prompt: '', model: null },
            ]);

            await act(async () => {
                window.dispatchEvent(new CustomEvent('coc-ws-message', {
                    detail: { type: 'loop-paused', loopId: 'loop-1', processId: 'proc-a', status: 'paused' },
                }));
                // allow promise chain to flush
                await Promise.resolve();
                await Promise.resolve();
            });

            indicator = screen.getByTestId('loop-indicator');
            expect(indicator.title).toBe('Has paused loops');
            expect(indicator.className).toContain('text-[#8a5a00]');
            expect(mockListAll).toHaveBeenCalledTimes(2);
        });
    });
});

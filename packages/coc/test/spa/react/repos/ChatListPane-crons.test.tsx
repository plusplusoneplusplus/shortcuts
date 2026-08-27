/**
 * Tests for useAllCrons hook and ChatListPane cron awareness:
 * - inline 🔁 indicator on chat rows with active/paused crons
 * - "Crons" scope segment in the tab bar
 * - feature gate via isCronEnabled()
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// --- Mocks ---

const mockListAll = vi.fn().mockResolvedValue([]);

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: mockListAll },
    }),
}));

let cronsEnabledValue = false;
vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isChatFoldersEnabled: () => false,
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isCronEnabled: () => cronsEnabledValue,
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
    // ChatListPane renders ScheduledSlideSchedules, whose flag hook imports both
    // of these from utils/config — a full-replacement mock must include them or
    // useSchedulesInScheduledSlideEnabled() throws at mount.
    isSchedulesInScheduledSlideEnabled: () => false,
    DASHBOARD_CONFIG_UPDATED_EVENT: 'coc-dashboard-config-updated',
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

vi.mock('../../../../src/server/spa/client/react/shared/useAgentProvidersQuota', () => ({
    useAgentProvidersQuota: () => ({ quotaData: null, loading: false, refreshing: false, error: null, refresh: vi.fn() }),
    AGENT_PROVIDER_QUOTA_POLL_MS: 300000,
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

describe('ChatListPane cron awareness', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cronsEnabledValue = false;
        mockListAll.mockResolvedValue([]);
        // Clear localStorage
        try { localStorage.removeItem('coc-activity-scope'); } catch { /* ignore */ }
    });

    describe('feature gate', () => {
        it('does not show Crons scope tab when crons disabled', async () => {
            cronsEnabledValue = false;
            const tasks = [makeTask({ id: 'task-x', displayName: 'Some Chat' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const tabs = screen.getByTestId('activity-scope-tabs');
            expect(within(tabs).queryByTestId('activity-scope-tab-loops')).toBeNull();
        });

        it('shows Crons scope tab when crons enabled', async () => {
            cronsEnabledValue = true;
            const tasks = [makeTask({ id: 'task-x', displayName: 'Some Chat' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const tabs = screen.getByTestId('activity-scope-tabs');
            expect(within(tabs).getByTestId('activity-scope-tab-loops')).toBeTruthy();
        });
    });

    describe('Crons segment tab', () => {
        it('displays correct count of conversations with crons', async () => {
            cronsEnabledValue = true;
            const tasks = [
                makeTask({ id: 'proc-a', displayName: 'Chat A' }),
                makeTask({ id: 'proc-b', displayName: 'Chat B' }),
                makeTask({ id: 'proc-c', displayName: 'Chat C' }),
            ];
            mockListAll.mockResolvedValue([
                { id: 'cron-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
                { id: 'cron-2', processId: 'proc-b', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'test', prompt: '', model: null },
                { id: 'cron-3', processId: 'proc-c', status: 'cancelled', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            // proc-a (active) and proc-b (paused) should be counted; proc-c is cancelled
            const countEl = screen.getByTestId('activity-scope-count-loops');
            expect(countEl.textContent).toBe('2');
        });

        it('filters chat list to only conversations with crons when Crons tab is active', async () => {
            cronsEnabledValue = true;
            const tasks = [
                makeTask({ id: 'proc-a', displayName: 'Chat A' }),
                makeTask({ id: 'proc-b', displayName: 'Chat B' }),
            ];
            mockListAll.mockResolvedValue([
                { id: 'cron-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            // Click the Crons tab
            const cronsTab = screen.getByTestId('activity-scope-tab-loops');
            await act(async () => {
                await userEvent.click(cronsTab);
            });
            // Only proc-a should be visible (has an active cron)
            const rows = screen.getAllByTestId('history-task-row');
            expect(rows).toHaveLength(1);
        });
    });

    describe('inline cron indicator', () => {
        it('shows 🔁 indicator with green tint for active crons', async () => {
            cronsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            mockListAll.mockResolvedValue([
                { id: 'cron-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const indicator = screen.getByTestId('cron-indicator');
            expect(indicator.querySelector('[data-testid="cron-icon"]')).toBeTruthy();
            expect(indicator.title).toBe('Has active crons');
            // Green tint class
            expect(indicator.className).toContain('text-[#15703a]');
        });

        it('shows 🔁 indicator with amber tint for paused crons', async () => {
            cronsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            mockListAll.mockResolvedValue([
                { id: 'cron-1', processId: 'proc-a', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'test', prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const indicator = screen.getByTestId('cron-indicator');
            expect(indicator.title).toBe('Has paused crons');
            // Amber tint class
            expect(indicator.className).toContain('text-[#8a5a00]');
        });

        it('does not show cron indicator when crons disabled', async () => {
            cronsEnabledValue = false;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            expect(screen.queryByTestId('cron-indicator')).toBeNull();
        });

        it('does not show cron indicator for conversations without crons', async () => {
            cronsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-no-cron', displayName: 'Chat No Cron' })];
            mockListAll.mockResolvedValue([]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            expect(screen.queryByTestId('cron-indicator')).toBeNull();
        });

        it('active state takes priority over paused when both exist', async () => {
            cronsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            mockListAll.mockResolvedValue([
                { id: 'cron-1', processId: 'proc-a', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'test', prompt: '', model: null },
                { id: 'cron-2', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const indicator = screen.getByTestId('cron-indicator');
            // Active takes priority — should show green
            expect(indicator.title).toBe('Has active crons');
            expect(indicator.className).toContain('text-[#15703a]');
        });
    });

    describe('WebSocket-driven refresh', () => {
        it('refetches and updates row indicator when coc-ws-message cron-paused arrives', async () => {
            cronsEnabledValue = true;
            const tasks = [makeTask({ id: 'proc-a', displayName: 'Chat A' })];
            // First fetch: active cron → green
            mockListAll.mockResolvedValueOnce([
                { id: 'cron-1', processId: 'proc-a', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
            ]);
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            let indicator = screen.getByTestId('cron-indicator');
            expect(indicator.title).toBe('Has active crons');
            expect(indicator.className).toContain('text-[#15703a]');

            // Second fetch (after WS event): now paused → amber
            mockListAll.mockResolvedValueOnce([
                { id: 'cron-1', processId: 'proc-a', status: 'paused', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: 'user-paused', prompt: '', model: null },
            ]);

            await act(async () => {
                window.dispatchEvent(new CustomEvent('coc-ws-message', {
                    detail: { type: 'cron-paused', cronId: 'cron-1', processId: 'proc-a', status: 'paused' },
                }));
                // allow promise chain to flush
                await Promise.resolve();
                await Promise.resolve();
            });

            indicator = screen.getByTestId('cron-indicator');
            expect(indicator.title).toBe('Has paused crons');
            expect(indicator.className).toContain('text-[#8a5a00]');
            expect(mockListAll).toHaveBeenCalledTimes(2);
        });
    });
});

/**
 * Tests for provider badge rendering in ChatListPane.
 * - Shows ProviderBadge for codex tasks
 * - Does NOT show ProviderBadge for copilot-only tasks (default)
 * - Reads provider from task.provider (HistorySummary top-level), metadata.provider, or payload.provider
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// --- Mocks (same as ChatListPane-loops pattern) ---

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        loops: { listAll: vi.fn().mockResolvedValue([]) },
    }),
}));

vi.mock('../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => '',
    isRalphEnabled: () => false,
    isLoopsEnabled: () => false,
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        handleDragStart: vi.fn(),
        handleDragOver: vi.fn(),
        handleDrop: vi.fn(),
        handleDragEnd: vi.fn(),
        dragOverIndex: null,
        dragSourceIndex: null,
        createDragStartHandler: () => vi.fn(),
        createDragEndHandler: () => vi.fn(),
        createDragOverHandler: () => vi.fn(),
        createDragEnterHandler: () => vi.fn(),
        createDragLeaveHandler: () => vi.fn(),
        createDropHandler: () => vi.fn(),
        draggedTaskId: null,
        dropTargetIndex: null,
        dropPosition: null,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        handleTouchStart: vi.fn(),
        handleTouchMove: vi.fn(),
        handleTouchEnd: vi.fn(),
        isDragging: false,
        dragOverIndex: null,
        draggedTaskId: null,
        dropTargetIndex: null,
        dropPosition: null,
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
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
        archiveChats: vi.fn(),
        unarchiveChats: vi.fn(),
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
        taskCardDensity: 'normal',
        historyGrouping: 'none',
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
    useBreakpoint: () => ({ isMobile: false, isTablet: false, isDesktop: true, breakpoint: 'desktop' }),
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

describe('ChatListPane provider badge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('codex provider', () => {
        it('shows provider-badge for task with provider="codex" at top level', async () => {
            const tasks = [makeTask({ id: 'task-a', displayName: 'Codex Chat', provider: 'codex' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const badges = screen.getAllByTestId('provider-badge');
            expect(badges.length).toBeGreaterThan(0);
            expect(badges[0].getAttribute('data-provider')).toBe('codex');
            expect(badges[0].textContent).toBe('Codex');
        });

        it('shows provider-badge for task with metadata.provider="codex"', async () => {
            const tasks = [makeTask({ id: 'task-b', displayName: 'Codex Meta Chat', metadata: { provider: 'codex' } })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const badges = screen.getAllByTestId('provider-badge');
            expect(badges[0].getAttribute('data-provider')).toBe('codex');
        });

        it('shows provider-badge for task with payload.provider="codex"', async () => {
            const tasks = [makeTask({ id: 'task-c', displayName: 'Codex Payload Chat', payload: { mode: 'ask', provider: 'codex' } })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const badges = screen.getAllByTestId('provider-badge');
            expect(badges[0].getAttribute('data-provider')).toBe('codex');
        });
    });

    describe('copilot provider (default)', () => {
        it('does NOT show provider-badge for task with provider="copilot"', async () => {
            const tasks = [makeTask({ id: 'task-d', displayName: 'Copilot Chat', provider: 'copilot' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            // Copilot is the default — no badge shown to avoid visual noise
            expect(screen.queryByTestId('provider-badge')).toBeNull();
        });

        it('does NOT show provider-badge when no provider is set', async () => {
            const tasks = [makeTask({ id: 'task-e', displayName: 'Default Chat' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            expect(screen.queryByTestId('provider-badge')).toBeNull();
        });
    });

    describe('mixed provider list', () => {
        it('shows badge only for codex tasks in a mixed list', async () => {
            const tasks = [
                makeTask({ id: 'task-1', displayName: 'Copilot Chat', provider: 'copilot' }),
                makeTask({ id: 'task-2', displayName: 'Codex Chat', provider: 'codex' }),
                makeTask({ id: 'task-3', displayName: 'No Provider Chat' }),
            ];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            // Only the codex task should have a badge
            const badges = screen.getAllByTestId('provider-badge');
            expect(badges).toHaveLength(1);
            expect(badges[0].getAttribute('data-provider')).toBe('codex');
        });
    });
});

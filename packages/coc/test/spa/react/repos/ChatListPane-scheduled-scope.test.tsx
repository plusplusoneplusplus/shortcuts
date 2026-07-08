/**
 * Tests for the Activity-tab "Scheduled" scope (internal id `loops`):
 * - pure helpers `isScheduledTask` / `taskInScope` (scope membership rules)
 * - scheduled runs move Chats → Scheduled, stay in All, leave Automations
 * - "counted once" when a task is both scheduled and has a `/loop`
 * - visibility gating: segment shows when loops enabled OR a scheduled run exists
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
    isCommitChatLensEnabled: () => false,
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

import {
    ChatListPane,
    isScheduledTask,
    taskInScope,
} from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

// --- Pure helper unit tests (no rendering) ---

describe('isScheduledTask', () => {
    it('returns true when scheduleId is on payload', () => {
        expect(isScheduledTask({ type: 'chat', payload: { scheduleId: 'sch-1' } })).toBe(true);
    });
    it('returns true when scheduleId is top-level', () => {
        expect(isScheduledTask({ type: 'chat', scheduleId: 'sch-2' })).toBe(true);
    });
    it('returns false for a plain chat task', () => {
        expect(isScheduledTask({ type: 'chat', payload: { mode: 'ask' } })).toBe(false);
    });
    it('returns false for null/empty input', () => {
        expect(isScheduledTask(null)).toBe(false);
        expect(isScheduledTask(undefined)).toBe(false);
        expect(isScheduledTask({})).toBe(false);
    });
});

describe('taskInScope', () => {
    const chat = { type: 'chat', payload: { mode: 'ask' } };
    const scheduledChat = { type: 'chat', payload: { scheduleId: 'sch-1' } };
    const auto = { type: 'run-script' };
    const scheduledAuto = { type: 'run-workflow', payload: { scheduleId: 'sch-2' } };

    it('chat scope: plain chats only, scheduled chats excluded', () => {
        expect(taskInScope('chat', chat, false)).toBe(true);
        expect(taskInScope('chat', scheduledChat, false)).toBe(false);
        expect(taskInScope('chat', auto, false)).toBe(false);
    });

    it('auto scope: plain automations only, scheduled automations excluded', () => {
        expect(taskInScope('auto', auto, false)).toBe(true);
        expect(taskInScope('auto', scheduledAuto, false)).toBe(false);
        expect(taskInScope('auto', chat, false)).toBe(false);
    });

    it('loops (Scheduled) scope: scheduled runs OR tasks with a loop', () => {
        expect(taskInScope('loops', scheduledChat, false)).toBe(true);   // scheduled, no loop
        expect(taskInScope('loops', scheduledAuto, false)).toBe(true);   // scheduled automation
        expect(taskInScope('loops', chat, true)).toBe(true);             // not scheduled, has loop
        expect(taskInScope('loops', chat, false)).toBe(false);           // neither
    });

    it('all scope: everything, including scheduled runs', () => {
        expect(taskInScope('all', chat, false)).toBe(true);
        expect(taskInScope('all', scheduledChat, false)).toBe(true);
        expect(taskInScope('all', scheduledAuto, false)).toBe(true);
    });
});

// --- Render integration tests ---

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

describe('ChatListPane Scheduled scope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loopsEnabledValue = false;
        mockListAll.mockResolvedValue([]);
        try { localStorage.removeItem('coc-activity-scope'); } catch { /* ignore */ }
    });

    it('renders the third segment labelled "Scheduled" (id stays loops)', async () => {
        loopsEnabledValue = true;
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={[makeTask()]} />);
        });
        const tab = screen.getByTestId('activity-scope-tab-loops');
        // Label is accessible via title and aria-label, not visible text content.
        expect(tab.getAttribute('title')).toBe('Scheduled');
        expect(tab.getAttribute('aria-label')).toContain('Scheduled');
        expect(tab.textContent).not.toContain('Loops');
        expect(tab.textContent).not.toContain('Scheduled');
    });

    it('excludes scheduled runs from Chats count and includes them in Scheduled count', async () => {
        loopsEnabledValue = true;
        const tasks = [
            makeTask({ id: 'plain-chat', displayName: 'Plain Chat' }),
            makeTask({ id: 'sched-chat', displayName: 'Scheduled Chat', payload: { scheduleId: 'sch-1' } }),
        ];
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={tasks} />);
        });
        expect(screen.getByTestId('activity-scope-count-chat').textContent).toBe('1');
        expect(screen.getByTestId('activity-scope-count-loops').textContent).toBe('1');
        // All still includes both
        expect(screen.getByTestId('activity-scope-count-all').textContent).toBe('2');
    });

    it('excludes scheduled automations from the Automations count', async () => {
        loopsEnabledValue = true;
        const tasks = [
            makeTask({ id: 'auto-1', type: 'run-script', displayName: 'Script' }),
            makeTask({ id: 'sched-auto', type: 'run-workflow', displayName: 'Scheduled WF', payload: { scheduleId: 'sch-2' } }),
        ];
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={tasks} />);
        });
        expect(screen.getByTestId('activity-scope-count-auto').textContent).toBe('1');
        expect(screen.getByTestId('activity-scope-count-loops').textContent).toBe('1');
    });

    it('routes a scheduled run into Scheduled and out of Chats in the list', async () => {
        loopsEnabledValue = true;
        const tasks = [
            makeTask({ id: 'plain-chat', title: 'Plain Chat' }),
            makeTask({ id: 'sched-chat', title: 'Scheduled Chat', payload: { scheduleId: 'sch-1' } }),
        ];
        const rowText = () => screen.queryAllByTestId('history-task-row').map(r => r.textContent || '');
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={tasks} />);
        });
        // Chats scope: only the plain chat
        await act(async () => { await userEvent.click(screen.getByTestId('activity-scope-tab-chat')); });
        expect(rowText()).toHaveLength(1);
        expect(rowText().some(t => t.includes('Plain Chat'))).toBe(true);
        // Scheduled scope: only the scheduled run
        await act(async () => { await userEvent.click(screen.getByTestId('activity-scope-tab-loops')); });
        expect(rowText()).toHaveLength(1);
        expect(rowText().some(t => t.includes('Scheduled Chat'))).toBe(true);
        // All scope: both visible
        await act(async () => { await userEvent.click(screen.getByTestId('activity-scope-tab-all')); });
        expect(rowText()).toHaveLength(2);
    });

    it('counts a task that is both scheduled and has a loop only once', async () => {
        loopsEnabledValue = true;
        const tasks = [makeTask({ id: 'sched-loop', displayName: 'Sched+Loop', payload: { scheduleId: 'sch-1' } })];
        mockListAll.mockResolvedValue([
            { id: 'loop-1', processId: 'sched-loop', status: 'active', description: '', intervalMs: 60000, createdAt: '', lastTickAt: null, nextTickAt: null, tickCount: 0, consecutiveFailures: 0, expiresAt: '', pausedReason: null, prompt: '', model: null },
        ]);
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={tasks} />);
        });
        expect(screen.getByTestId('activity-scope-count-loops').textContent).toBe('1');
        await act(async () => { await userEvent.click(screen.getByTestId('activity-scope-tab-loops')); });
        expect(screen.getAllByTestId('history-task-row')).toHaveLength(1);
    });

    describe('visibility gating (AC-03)', () => {
        it('shows the Scheduled segment with 4 columns when loops OFF but a scheduled run exists', async () => {
            loopsEnabledValue = false;
            const tasks = [makeTask({ id: 'sched-chat', displayName: 'Scheduled Chat', payload: { scheduleId: 'sch-1' } })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const tabs = screen.getByTestId('activity-scope-tabs');
            expect(within(tabs).getByTestId('activity-scope-tab-loops')).toBeTruthy();
            expect(tabs.className).toContain('grid-cols-4');
        });

        it('hides the Scheduled segment with 3 columns when loops OFF and no scheduled runs', async () => {
            loopsEnabledValue = false;
            const tasks = [makeTask({ id: 'plain-chat', displayName: 'Plain Chat' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const tabs = screen.getByTestId('activity-scope-tabs');
            expect(within(tabs).queryByTestId('activity-scope-tab-loops')).toBeNull();
            expect(tabs.className).toContain('grid-cols-3');
        });

        it('shows the Scheduled segment when loops ON regardless of scheduled runs', async () => {
            loopsEnabledValue = true;
            const tasks = [makeTask({ id: 'plain-chat', displayName: 'Plain Chat' })];
            await act(async () => {
                render(<ChatListPane {...defaultProps} history={tasks} />);
            });
            const tabs = screen.getByTestId('activity-scope-tabs');
            expect(within(tabs).getByTestId('activity-scope-tab-loops')).toBeTruthy();
            expect(tabs.className).toContain('grid-cols-4');
        });
    });

    it('persists the selected scope id as "loops" to localStorage', async () => {
        loopsEnabledValue = true;
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={[makeTask()]} />);
        });
        await act(async () => { await userEvent.click(screen.getByTestId('activity-scope-tab-loops')); });
        expect(localStorage.getItem('coc-activity-scope')).toBe('loops');
    });
});

// --- forceScope: schedules route forces the Scheduled slide active (AC-03/AC-04) ---

describe('ChatListPane forceScope', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The Scheduled segment must be visible for the force to have a target.
        loopsEnabledValue = true;
        mockListAll.mockResolvedValue([]);
        try { localStorage.removeItem('coc-activity-scope'); } catch { /* ignore */ }
    });

    it('forces the Scheduled segment active, overriding a persisted "chat" scope', async () => {
        try { localStorage.setItem('coc-activity-scope', 'chat'); } catch { /* ignore */ }
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={[makeTask()]} forceScope="loops" />);
        });
        expect(screen.getByTestId('activity-scope-tab-loops').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('activity-scope-tab-chat').getAttribute('aria-selected')).toBe('false');
        // The force writes through to the persisted scope (matches existing
        // scope-persistence behavior).
        expect(localStorage.getItem('coc-activity-scope')).toBe('loops');
    });

    it('uses the persisted scope when forceScope is absent (flag off / non-schedule routes)', async () => {
        try { localStorage.setItem('coc-activity-scope', 'chat'); } catch { /* ignore */ }
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={[makeTask()]} />);
        });
        expect(screen.getByTestId('activity-scope-tab-chat').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('activity-scope-tab-loops').getAttribute('aria-selected')).toBe('false');
    });

    it('still lets the user switch segments while forced (does not re-force)', async () => {
        await act(async () => {
            render(<ChatListPane {...defaultProps} history={[makeTask()]} forceScope="loops" />);
        });
        expect(screen.getByTestId('activity-scope-tab-loops').getAttribute('aria-selected')).toBe('true');
        // A schedule stays open (forceScope prop unchanged) but the user picks Chats.
        await act(async () => { await userEvent.click(screen.getByTestId('activity-scope-tab-chat')); });
        expect(screen.getByTestId('activity-scope-tab-chat').getAttribute('aria-selected')).toBe('true');
        expect(screen.getByTestId('activity-scope-tab-loops').getAttribute('aria-selected')).toBe('false');
    });
});

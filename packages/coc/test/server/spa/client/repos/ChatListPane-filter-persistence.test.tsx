/**
 * @vitest-environment jsdom
 *
 * Tests for ChatListPane — filter persistence through AppContext.
 * Verifies that excludedTypes are read from / written to AppContext
 * instead of ephemeral local state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing the component under test
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/shared', () => ({
    Card: ({ children, className, onClick, 'data-task-id': dtid, 'data-testid': dtestid, ...rest }: any) => (
        <div className={className} onClick={onClick} data-task-id={dtid} data-testid={dtestid ?? 'card'}>{children}</div>
    ),
    Button: ({ children, onClick, disabled, className, 'data-testid': dt, ...rest }: any) => (
        <button onClick={onClick} disabled={disabled} className={className} data-testid={dt}>{children}</button>
    ),
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
    FilterDropdown: ({ excludedValues, onChange, ...rest }: any) => (
        <div data-testid={rest['data-testid'] ?? 'filter-dropdown'}>
            <span data-testid="excluded-count">{excludedValues.size}</span>
            <button data-testid="toggle-chat" onClick={() => {
                const next = new Set(excludedValues);
                if (next.has('chat')) next.delete('chat'); else next.add('chat');
                onChange(next);
            }}>toggle chat</button>
        </div>
    ),
}));

vi.mock('../../../../../src/server/spa/client/react/shared/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    getApiBase: () => 'http://localhost:4000/api',
}));

vi.mock('../../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn(),
    formatDuration: vi.fn(() => '1s'),
    formatRelativeTime: vi.fn(() => '1m ago'),
    statusLabel: vi.fn(() => 'running'),
}));

vi.mock('../../../../../src/server/spa/client/react/chat/ConversationMetadataPopover', () => ({
    buildRows: () => [],
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        activeDraggedTaskId: null,
        activeDropTargetIndex: null,
        activeDropPosition: null,
        createDragStartHandler: () => () => {},
        createDragEndHandler: () => () => {},
        createDragOverHandler: () => () => {},
        createDragEnterHandler: () => () => {},
        createDragLeaveHandler: () => () => {},
        createDropHandler: () => () => {},
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        createTouchStartHandler: () => () => {},
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/shared/RenameDialog', () => ({
    RenameDialog: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => ({ progress: null }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useDraftStore', () => ({
    getDraft: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useLongPress', () => ({
    useLongPress: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn(), onTouchMove: vi.fn() }),
}));

vi.mock('../../../../../src/server/spa/client/react/context/ChatPreferencesContext', () => ({
    useChatPrefs: () => ({
        pinnedChatIds: null,
        archivedChatIds: null,
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
        archiveChats: vi.fn(),
        unarchiveChats: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/context/QueueContext', () => ({
    useQueue: () => ({
        state: { isTaskSubmitting: false },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ taskCardDensity: 'normal', historyGrouping: false }),
}));

vi.mock('../../../../../src/server/spa/client/react/repos/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/repos/history-grouping', () => ({
    groupHistoryByPlanFile: () => [],
}));

vi.mock('../../../../../src/server/spa/client/react/repos/HistoryGroupHeader', () => ({
    HistoryGroupHeader: () => null,
}));

// AppContext mock — per-test override via mockAppState
let mockAppState = { myWorkExcludedTypes: [] as string[], preferencesLoaded: true };
const mockAppDispatch = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/context/AppContext', async (importOriginal) => {
    const actual = await importOriginal() as Record<string, unknown>;
    return {
        ...actual,
        useApp: () => ({
            state: mockAppState,
            dispatch: mockAppDispatch,
        }),
    };
});

import { ChatListPane } from '../../../../../src/server/spa/client/react/repos/ChatListPane';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noop = () => {};
const noopAsync = async () => {};

function defaultProps(overrides: Partial<Parameters<typeof ChatListPane>[0]> = {}) {
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
        workspaceId: 'ws-1',
        unseenProcessIds: new Set<string>(),
        onMarkAllRead: noop,
        onMarkRead: noop,
        onMarkUnread: noop,
        onSelectTask: noop,
        onPauseResume: noop,
        onRefresh: noop,
        onOpenDialog: noop,
        fetchQueue: noopAsync,
        onSearchQueryChange: noop,
        ...overrides,
    } as Parameters<typeof ChatListPane>[0];
}

function makeChatTask(id: string, title: string) {
    return { id, type: 'chat', status: 'completed', displayName: title, completedAt: new Date().toISOString() };
}

function makeWorkflowTask(id: string, title: string) {
    return { id, type: 'run-workflow', status: 'completed', displayName: title, completedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Tests — Filter persistence via AppContext
// ---------------------------------------------------------------------------

describe('ChatListPane – filter persistence', () => {
    beforeEach(() => {
        mockAppState = { myWorkExcludedTypes: [], preferencesLoaded: true };
        mockAppDispatch.mockClear();
    });

    it('initializes excludedTypes from AppContext myWorkExcludedTypes', () => {
        mockAppState = { myWorkExcludedTypes: ['chat'], preferencesLoaded: true };
        render(<ChatListPane {...defaultProps({ history: [makeChatTask('t1', 'Hello'), makeWorkflowTask('t2', 'Build')] })} />);
        const excluded = screen.getByTestId('excluded-count');
        expect(excluded.textContent).toBe('1');
    });

    it('dispatches SET_MY_WORK_EXCLUDED_TYPES when filter changes', () => {
        render(<ChatListPane {...defaultProps({ history: [makeChatTask('t1', 'Hello')] })} />);
        fireEvent.click(screen.getByTestId('toggle-chat'));
        expect(mockAppDispatch).toHaveBeenCalledWith({
            type: 'SET_MY_WORK_EXCLUDED_TYPES',
            value: ['chat'],
        });
    });

    it('does not reset excludedTypes on workspace change', () => {
        mockAppState = { myWorkExcludedTypes: ['run-workflow'], preferencesLoaded: true };
        const { rerender } = render(<ChatListPane {...defaultProps({ history: [makeWorkflowTask('t1', 'Build')], workspaceId: 'ws-1' })} />);
        // Switch workspace — excludedTypes should persist since they're in AppContext
        rerender(<ChatListPane {...defaultProps({ history: [makeWorkflowTask('t2', 'Deploy')], workspaceId: 'ws-2' })} />);
        const excluded = screen.getByTestId('excluded-count');
        expect(excluded.textContent).toBe('1');
    });
});

// ---------------------------------------------------------------------------
// Tests — AppContext reducer for myWorkExcludedTypes
// ---------------------------------------------------------------------------

import { appReducer } from '../../../../../src/server/spa/client/react/context/AppContext';

describe('appReducer – myWorkExcludedTypes', () => {
    const baseState = {
        processes: [],
        selectedId: null,
        workspace: '__all',
        statusFilter: '__all',
        typeFilter: '__all',
        myWorkExcludedTypes: [],
        searchQuery: '',
        searchResults: null,
        searchLoading: false,
        expandedGroups: {},
        activeTab: 'repos' as const,
        workspaces: [],
        selectedRepoId: null,
        activeRepoSubTab: 'copilot' as const,
        reposSidebarCollapsed: false,
        selectedWikiId: null,
        selectedWikiComponentId: null,
        wikiView: 'list' as const,
        wikiDetailInitialTab: null,
        wikiDetailInitialAdminTab: null,
        wikiAutoGenerate: false,
        wikis: [],
        selectedRepoWikiId: null,
        repoWikiInitialTab: null,
        repoWikiInitialAdminTab: null,
        repoWikiInitialComponentId: null,
        selectedWorkflowName: null,
        selectedWorkflowRunProcessId: null,
        selectedSkillTemplateId: null,
        selectedScriptTemplateId: null,
        selectedScheduleId: null,
        selectedGitCommitHash: null,
        selectedGitFilePath: null,
        selectedPrId: null,
        selectedPrDetailTab: null,
        selectedWorkflowProcessId: null,
        selectedExplorerPath: null,
        selectedNotePath: null,
        conversationCache: {},
        wsStatus: 'connecting' as const,
        activeMemorySubTab: 'bounded' as const,
        activeSkillsSubTab: 'installed' as const,
        activeAdminSubTab: 'storage' as const,
        adminDbTable: null,
        adminDbPage: 0,
        adminDbSort: null,
        adminDbOrder: null,
        repoTabState: {},
        notePathState: {},
        wikiTabState: {},
        repoSubTabNavState: {},
        settingsSection: 'info' as const,
        hasSeenWelcome: false,
        onboardingProgress: { hasRunWorkflow: false, hasOpenedWiki: false, hasUsedChat: false, settingsVisited: false, dismissed: false, hasCompletedTour: false },
        dismissedTips: [],
        preferencesLoaded: false,
    };

    it('SET_MY_WORK_EXCLUDED_TYPES updates the exclusion list', () => {
        const result = appReducer(baseState as any, { type: 'SET_MY_WORK_EXCLUDED_TYPES', value: ['chat', 'ask'] });
        expect(result.myWorkExcludedTypes).toEqual(['chat', 'ask']);
    });

    it('SET_MY_WORK_EXCLUDED_TYPES with empty array clears exclusions', () => {
        const state = { ...baseState, myWorkExcludedTypes: ['chat'] } as any;
        const result = appReducer(state, { type: 'SET_MY_WORK_EXCLUDED_TYPES', value: [] });
        expect(result.myWorkExcludedTypes).toEqual([]);
    });

    it('SET_WELCOME_PREFERENCES loads myWorkExcludedTypes from server', () => {
        const result = appReducer(baseState as any, {
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                activityFilters: { myWorkExcludedTypes: ['run-workflow', 'plan'] },
            },
        });
        expect(result.myWorkExcludedTypes).toEqual(['run-workflow', 'plan']);
        expect(result.preferencesLoaded).toBe(true);
    });

    it('SET_WELCOME_PREFERENCES without myWorkExcludedTypes preserves default', () => {
        const result = appReducer(baseState as any, {
            type: 'SET_WELCOME_PREFERENCES',
            payload: {
                activityFilters: { statusFilter: 'running' },
            },
        });
        expect(result.myWorkExcludedTypes).toEqual([]);
        expect(result.statusFilter).toBe('running');
    });

    it('SET_WELCOME_PREFERENCES without activityFilters preserves default', () => {
        const result = appReducer(baseState as any, {
            type: 'SET_WELCOME_PREFERENCES',
            payload: {},
        });
        expect(result.myWorkExcludedTypes).toEqual([]);
    });
});

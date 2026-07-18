/**
 * @vitest-environment jsdom
 *
 * Tests for ChatListPane left-panel chat-title double-click behavior.
 *
 * Goal: on the CoC desktop shell (window.cocDesktop.isDesktop === true),
 * double-clicking a chat title pops the chat out to a new window instead of
 * opening the inline rename dialog. On the web SPA it keeps opening rename.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Card: ({ children, className, onClick, 'data-task-id': dtid, 'data-testid': dtestid, 'data-pinned': dp, 'data-archived': da }: any) => (
        <div
            className={className}
            onClick={onClick}
            data-task-id={dtid}
            data-testid={dtestid ?? 'card'}
            data-pinned={dp}
            data-archived={da}
        >
            {children}
        </div>
    ),
    Button: ({ children, onClick, disabled, className, 'data-testid': dt }: any) => (
        <button onClick={onClick} disabled={disabled} className={className} data-testid={dt}>{children}</button>
    ),
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
    FilterDropdown: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/ui/cn', () => ({
    cn: (...classes: any[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('../../../../../src/server/spa/client/react/utils/config', () => ({
    isContainerMode: () => false,
    getApiBase: () => 'http://localhost:4000/api',
    isRalphEnabled: () => false,
    isLoopsEnabled: () => false,
    isForEachEnabled: () => false,
    isMapReduceEnabled: () => false,
    isSessionContextAttachmentsEnabled: () => false,
}));

vi.mock('../../../../../src/server/spa/client/react/utils/format', () => ({
    copyToClipboard: vi.fn(),
    formatDuration: vi.fn(() => '1s'),
    formatRelativeTime: vi.fn(() => '1m ago'),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/conversation/ConversationMetadataPopover', () => ({
    buildRows: () => [],
}));

vi.mock('../../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
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

vi.mock('../../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        createTouchStartHandler: () => () => {},
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/tasks/comments/ContextMenu', () => ({
    ContextMenu: () => null,
}));

// Render a marker when the rename dialog is open so tests can assert on it.
vi.mock('../../../../../src/server/spa/client/react/ui/RenameDialog', () => ({
    RenameDialog: ({ open }: any) => (open ? <div data-testid="rename-dialog-open" /> : null),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/useApi', () => ({
    fetchApi: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../../../../src/server/spa/client/react/features/workflow/hooks/useWorkflowProgress', () => ({
    useWorkflowProgress: () => ({ progress: null }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/hooks/useDraftStore', () => ({
    getDraft: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/ui/useLongPress', () => ({
    useLongPress: () => ({ onTouchStart: vi.fn(), onTouchEnd: vi.fn(), onTouchMove: vi.fn(), didLongPress: vi.fn(() => false) }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
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

vi.mock('../../../../../src/server/spa/client/react/contexts/QueueContext', () => ({
    useQueue: () => ({
        state: { isTaskSubmitting: false },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { myWorkExcludedTypes: [], preferencesLoaded: true },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ taskCardDensity: 'normal', historyGrouping: false }),
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/SwipeableHistoryItem', () => ({
    SwipeableHistoryItem: ({ children }: any) => <>{children}</>,
}));

vi.mock('../../../../../src/server/spa/client/react/features/chat/SummarizeChatDialog', () => ({
    SummarizeChatDialog: () => null,
}));

vi.mock('../../../../../src/server/spa/client/react/features/git/history-grouping', () => ({
    groupHistoryByPlanFile: () => [],
}));

vi.mock('../../../../../src/server/spa/client/react/features/git/commits/HistoryGroupHeader', () => ({
    HistoryGroupHeader: () => null,
}));

// markPoppedOut spy shared across the PopOut context mock.
const markPoppedOut = vi.fn();
vi.mock('../../../../../src/server/spa/client/react/contexts/PopOutContext', () => ({
    usePopOut: () => ({ markPoppedOut, markRestored: vi.fn(), poppedOutTasks: new Set(), postMessage: vi.fn() }),
}));

import { ChatListPane } from '../../../../../src/server/spa/client/react/features/chat/ChatListPane';

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
        searchResults: null,
        searchLoading: false,
        searchTotal: undefined,
        searchHasMore: false,
        searchLoadingMore: false,
        onSearchQueryChange: noop,
        onLoadMoreSearchResults: noop,
        ...overrides,
    } as Parameters<typeof ChatListPane>[0];
}

function makeChatTask(id: string, title: string) {
    return { id, type: 'chat', status: 'completed', displayName: title, customTitle: title, completedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatListPane – left-panel chat-title double-click', () => {
    let openSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        openSpy = vi.fn(() => ({} as Window));
        vi.stubGlobal('open', openSpy);
    });

    afterEach(() => {
        delete (window as any).cocDesktop;
        vi.unstubAllGlobals();
    });

    it('desktop: double-clicking a chat title pops out and does NOT open rename (AC-01/03/05)', () => {
        (window as any).cocDesktop = { isDesktop: true };
        render(
            <ChatListPane {...defaultProps({ history: [makeChatTask('queue_abc', 'My chat')], activeTab: 'chats' })} />,
        );

        fireEvent.doubleClick(screen.getByText('My chat'));

        // Pop-out opened with the #popout/activity/<taskId> URL.
        expect(openSpy).toHaveBeenCalledTimes(1);
        const url = openSpy.mock.calls[0][0] as string;
        expect(url).toContain('#popout/activity/queue_abc');
        // Marked popped out (AC-05).
        expect(markPoppedOut).toHaveBeenCalledWith('queue_abc');
        // Rename dialog NOT opened (AC-01).
        expect(screen.queryByTestId('rename-dialog-open')).toBeNull();
    });

    it('desktop: title tooltip reflects the pop-out behavior (AC-06)', () => {
        (window as any).cocDesktop = { isDesktop: true };
        render(
            <ChatListPane {...defaultProps({ history: [makeChatTask('queue_abc', 'My chat')], activeTab: 'chats' })} />,
        );

        expect(screen.getByText('My chat').getAttribute('title')).toBe('Double-click to open in a new window');
    });

    it('web: double-clicking a chat title opens the rename dialog, not a pop-out (AC-02)', () => {
        // window.cocDesktop absent → web SPA.
        render(
            <ChatListPane {...defaultProps({ history: [makeChatTask('queue_abc', 'My chat')], activeTab: 'chats' })} />,
        );

        fireEvent.doubleClick(screen.getByText('My chat'));

        expect(openSpy).not.toHaveBeenCalled();
        expect(markPoppedOut).not.toHaveBeenCalled();
        expect(screen.getByTestId('rename-dialog-open')).toBeTruthy();
    });

    it('web: title tooltip reflects the rename behavior (AC-06)', () => {
        render(
            <ChatListPane {...defaultProps({ history: [makeChatTask('queue_abc', 'My chat')], activeTab: 'chats' })} />,
        );

        expect(screen.getByText('My chat').getAttribute('title')).toBe('Double-click to rename');
    });
});

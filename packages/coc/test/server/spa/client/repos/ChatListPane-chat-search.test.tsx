/**
 * @vitest-environment jsdom
 *
 * Tests for ChatListPane — focused on FTS5 search wiring in the Chats tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks – declared before importing component under test
// ---------------------------------------------------------------------------

vi.mock('../../../../../src/server/spa/client/react/ui', () => ({
    Card: ({ children, className, onClick, 'data-task-id': dtid, 'data-testid': dtestid, 'data-pinned': dp, 'data-archived': da, ...rest }: any) => (
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
    Button: ({ children, onClick, disabled, className, 'data-testid': dt, ...rest }: any) => (
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

vi.mock('../../../../../src/server/spa/client/react/ui/RenameDialog', () => ({
    RenameDialog: () => null,
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

function makeSearchResult(id: string, displayName: string, snippet = '') {
    return {
        id,
        type: 'chat',
        status: 'completed',
        displayName,
        customTitle: displayName,
        title: displayName,
        promptPreview: '',
        completedAt: new Date().toISOString(),
        endTime: new Date().toISOString(),
        _searchSnippet: snippet,
        _isSearchResult: true as const,
    };
}

// ---------------------------------------------------------------------------
// Tests — Chats tab FTS5 search wiring
// ---------------------------------------------------------------------------

describe('ChatListPane – Chats tab FTS5 search', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Normal (no search active) ────────────────────────────────────────────

    it('renders normal chat list when searchResults is null', () => {
        const chat = makeChatTask('queue_abc', 'My first chat');
        render(
            <ChatListPane
                {...defaultProps({
                    history: [chat],
                    activeTab: 'chats',
                    searchResults: null,
                })}
            />,
        );

        expect(screen.queryByTestId('chat-search-results')).toBeNull();
        // The chat title should appear in normal sections
        expect(screen.getByText('My first chat')).toBeTruthy();
    });

    it('shows "No chats yet" when there are no chats and search is not active', () => {
        render(
            <ChatListPane
                {...defaultProps({ activeTab: 'chats', searchResults: null })}
            />,
        );

        expect(screen.getByText('No chats yet')).toBeTruthy();
    });

    // ── Server search active ─────────────────────────────────────────────────

    it('renders FTS5 search results section when searchResults is an array', () => {
        const results = [makeSearchResult('queue_r1', 'Chat about auth')];
        render(
            <ChatListPane
                {...defaultProps({
                    activeTab: 'chats',
                    searchResults: results,
                })}
            />,
        );

        expect(screen.getByTestId('chat-search-results')).toBeTruthy();
        expect(screen.getByTestId('chat-search-result-item')).toBeTruthy();
        expect(screen.getByText('Chat about auth')).toBeTruthy();
    });

    it('hides normal pinned/unpinned sections when searchResults is active', () => {
        const chat = makeChatTask('queue_abc', 'My first chat');
        const results = [makeSearchResult('queue_r1', 'Search result')];
        render(
            <ChatListPane
                {...defaultProps({
                    history: [chat],
                    activeTab: 'chats',
                    searchResults: results,
                })}
            />,
        );

        // FTS5 result visible
        expect(screen.getByText('Search result')).toBeTruthy();
        // Local chat title is NOT in a normal section (only accessible through FTS5)
        expect(screen.queryByText('💬 Recently')).toBeNull();
        expect(screen.queryByText('📌 Pinned')).toBeNull();
    });

    it('shows "no results" message when searchResults is empty array and not loading', () => {
        render(
            <ChatListPane
                {...defaultProps({
                    activeTab: 'chats',
                    searchResults: [],
                    searchLoading: false,
                })}
            />,
        );

        expect(screen.getByTestId('chat-search-no-results')).toBeTruthy();
    });

    it('renders snippet with dangerouslySetInnerHTML', () => {
        const results = [makeSearchResult('queue_r1', 'Highlighted chat', 'Hello <mark>world</mark>')];
        render(
            <ChatListPane
                {...defaultProps({
                    activeTab: 'chats',
                    searchResults: results,
                })}
            />,
        );

        const snippetEl = screen.getByTestId('chat-search-snippet');
        expect(snippetEl.innerHTML).toContain('<mark>world</mark>');
    });

    it('calls onSelectTask with the search result ID when clicked', () => {
        const onSelectTask = vi.fn();
        const results = [makeSearchResult('queue_r1', 'Clickable result')];
        render(
            <ChatListPane
                {...defaultProps({
                    activeTab: 'chats',
                    searchResults: results,
                    onSelectTask,
                })}
            />,
        );

        fireEvent.click(screen.getByTestId('chat-search-result-item'));
        expect(onSelectTask).toHaveBeenCalledWith('queue_r1', expect.objectContaining({ id: 'queue_r1' }));
    });

    // ── Count badge ─────────────────────────────────────────────────────────

    it('shows searchTotal in count badge when FTS5 search is active on Chats tab', () => {
        const results = [
            makeSearchResult('queue_r1', 'Result 1'),
            makeSearchResult('queue_r2', 'Result 2'),
        ];
        render(
            <ChatListPane
                {...defaultProps({
                    activeTab: 'chats',
                    searchResults: results,
                    searchTotal: 42,
                })}
            />,
        );

        // Type in the Chats tab's own search bar
        const input = screen.getByTestId('queue-search-input');
        fireEvent.change(input, { target: { value: 'hello' } });

        const badge = screen.getByTestId('search-match-count');
        expect(badge.textContent).toBe('42');
    });

    it('shows client-side count in badge when no FTS5 search is active', () => {
        const chat1 = makeChatTask('queue_c1', 'Chat 1');
        const chat2 = makeChatTask('queue_c2', 'Chat 2');
        render(
            <ChatListPane
                {...defaultProps({
                    history: [chat1, chat2],
                    activeTab: 'chats',
                    searchResults: null, // no server search
                })}
            />,
        );

        const input = screen.getByTestId('queue-search-input');
        fireEvent.change(input, { target: { value: 'Chat' } });

        const badge = screen.getByTestId('search-match-count');
        // Client-side filter matches both chats
        expect(badge.textContent).toBe('2');
    });

    // ── Load more ───────────────────────────────────────────────────────────

    it('renders Load more button when searchHasMore is true', () => {
        const results = [makeSearchResult('queue_r1', 'Result')];
        render(
            <ChatListPane
                {...defaultProps({
                    activeTab: 'chats',
                    searchResults: results,
                    searchHasMore: true,
                    searchLoadingMore: false,
                    onLoadMoreSearchResults: vi.fn(),
                })}
            />,
        );

        expect(screen.getByTestId('chat-search-load-more-btn')).toBeTruthy();
    });

    it('does not render Load more button when searchHasMore is false', () => {
        const results = [makeSearchResult('queue_r1', 'Result')];
        render(
            <ChatListPane
                {...defaultProps({
                    activeTab: 'chats',
                    searchResults: results,
                    searchHasMore: false,
                })}
            />,
        );

        expect(screen.queryByTestId('chat-search-load-more-btn')).toBeNull();
    });
});

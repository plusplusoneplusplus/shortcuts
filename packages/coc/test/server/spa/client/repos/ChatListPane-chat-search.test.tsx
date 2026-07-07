/**
 * @vitest-environment jsdom
 *
 * Tests for ChatListPane — focused on FTS5 search wiring in the Chats tab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

function makeForEachGenerationChat(overrides: Record<string, unknown> = {}) {
    return {
        ...makeChatTask('queue_for_each_gen', 'Split work into tasks'),
        customTitle: undefined,
        title: 'Split work into tasks',
        forEach: {
            kind: 'generation',
            workspaceId: 'ws-1',
            generationId: 'for-each-gen-1',
            childMode: 'ask',
            originalRequest: 'Split work into tasks',
            status: 'draft',
            latestItemCount: 3,
            ...overrides,
        },
    };
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

// The search input is hidden by default and only mounts once the user presses
// Ctrl+F / ⌘F. jsdom has no layout engine (offsetParent is always null), so the
// keydown handler's visibility guard would bail — force a truthy offsetParent on
// the pane, then fire Ctrl+F to reveal the input.
function revealSearch() {
    const pane = screen.getByTestId('chat-list-pane');
    Object.defineProperty(pane, 'offsetParent', {
        configurable: true,
        get: () => document.body,
    });
    fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });
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

    it('renders a For Each badge and draft generated-plan preview for generation chats', () => {
        render(
            <ChatListPane
                {...defaultProps({
                    history: [makeForEachGenerationChat()],
                    activeTab: 'chats',
                    searchResults: null,
                })}
            />,
        );

        expect(screen.getByTestId('for-each-generation-badge').textContent).toBe('For Each');
        expect(screen.getByTestId('for-each-generation-preview').textContent).toBe('3 proposed items - draft');
    });

    it('renders approved For Each generation previews with singular item copy', () => {
        render(
            <ChatListPane
                {...defaultProps({
                    history: [makeForEachGenerationChat({ status: 'approved', latestItemCount: 1, runId: 'for-each-run-1' })],
                    activeTab: 'chats',
                    searchResults: null,
                })}
            />,
        );

        expect(screen.getByTestId('for-each-generation-preview').textContent).toBe('1 proposed item - approved');
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

        // Reveal + type in the Chats tab's own search bar
        revealSearch();
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

        revealSearch();
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

// ---------------------------------------------------------------------------
// Tests — Ctrl+F / Ctrl+N list-focus guard
//
// The list-pane Ctrl+F (focus search) and Ctrl+N (new chat) shortcuts should
// only fire when the user is actually working inside the chat list. When a
// conversation is open and focus sits elsewhere — inside the conversation
// pane, the message box, or nowhere in particular (document.body) — the
// shortcut must be left alone so it does not yank focus back to the list (and
// so the desktop shell's native find-in-page can handle Ctrl+F instead).
//
// Regression: focus used to be tracked with a mousedown-only flag that went
// stale when a chat was opened by clicking its list row, and a follow-up
// attempt that keyed off the event target missed the common case where a
// conversation is open but focus rests on document.body.
// ---------------------------------------------------------------------------

describe('ChatListPane – Ctrl+F / Ctrl+N list-focus guard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // jsdom performs no layout, so offsetParent is always null and the
    // shortcut guard `offsetParent === null` would bail before reaching the
    // focus check. Force a truthy offsetParent so the real code path runs.
    function makePaneVisible() {
        const pane = screen.getByTestId('chat-list-pane');
        Object.defineProperty(pane, 'offsetParent', {
            configurable: true,
            get: () => document.body,
        });
    }

    // Build a sibling conversation pane holding a focusable editor.
    function mountDetailPane() {
        const detail = document.createElement('div');
        detail.setAttribute('data-pane', 'detail');
        const editor = document.createElement('textarea');
        detail.appendChild(editor);
        document.body.appendChild(detail);
        return { detail, editor };
    }

    // A non-empty list is required so the full list (with its pane container)
    // renders instead of the empty-state placeholder.
    const CHAT_ID = 'queue_x';
    const listProps = () => ({ activeTab: 'chats' as const, history: [makeChatTask(CHAT_ID, 'A chat')] });
    // Same, but with the chat open in the detail pane.
    const chatOpenProps = () => ({ ...listProps(), selectedTaskId: CHAT_ID });

    it('Ctrl+F reveals and focuses the list search when no conversation is open', async () => {
        render(<ChatListPane {...defaultProps(listProps())} />);
        makePaneVisible();
        // Hidden by default.
        expect(screen.queryByTestId('queue-search-input')).toBeNull();

        // Nothing is open and focus rests on the body.
        fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });

        const input = await screen.findByTestId('queue-search-input');
        await waitFor(() => expect(document.activeElement).toBe(input));
    });

    it('Ctrl+F reveals and focuses the list search when focus is within the list even with a conversation open', async () => {
        render(<ChatListPane {...defaultProps(chatOpenProps())} />);
        makePaneVisible();
        const newChatBtn = screen.getByTestId('new-chat-btn');
        newChatBtn.focus();

        // Ctrl+F originates from a control inside the list pane.
        fireEvent.keyDown(newChatBtn, { key: 'f', ctrlKey: true });

        const input = await screen.findByTestId('queue-search-input');
        await waitFor(() => expect(document.activeElement).toBe(input));
    });

    it('Ctrl+F does NOT reveal the list search while focus is in the conversation composer (AC-01)', async () => {
        render(<ChatListPane {...defaultProps(chatOpenProps())} />);
        makePaneVisible();
        // The editor stands in for the conversation's message composer, which
        // lives inside the right conversation panel (data-pane="detail"). Ctrl+F
        // with focus there must fall through to the native find-in-page, leaving
        // the list search unmounted and focus in the field.
        const { detail, editor } = mountDetailPane();
        editor.focus();
        expect(document.activeElement).toBe(editor);

        fireEvent.keyDown(editor, { key: 'f', ctrlKey: true });

        await new Promise(resolve => setTimeout(resolve, 5));
        expect(screen.queryByTestId('queue-search-input')).toBeNull();
        expect(document.activeElement).toBe(editor);

        document.body.removeChild(detail);
    });

    it('Ctrl+F does NOT reveal the list search while focus is in the conversation reading area (AC-01)', async () => {
        render(<ChatListPane {...defaultProps(chatOpenProps())} />);
        makePaneVisible();
        // The user is reading the conversation: focus rests on a NON-editable
        // element inside the right panel (data-pane="detail") — e.g. the detail
        // pane container itself, which is focusable via tabIndex. AC-01 broadens
        // the exception from "editable target only" to "any focus in the right
        // panel", so Ctrl+F must fall through to the native find-in-page here and
        // NOT open the list search.
        const { detail } = mountDetailPane();
        const reader = document.createElement('div');
        reader.setAttribute('tabindex', '-1');
        detail.appendChild(reader);
        reader.focus();

        fireEvent.keyDown(reader, { key: 'f', ctrlKey: true });

        await new Promise(resolve => setTimeout(resolve, 5));
        expect(screen.queryByTestId('queue-search-input')).toBeNull();

        document.body.removeChild(detail);
    });

    it('Ctrl+F reveals the list search when a conversation is open but focus rests on the body (nothing focused)', async () => {
        render(<ChatListPane {...defaultProps(chatOpenProps())} />);
        makePaneVisible();

        // A conversation is open, but keyboard focus is nowhere in particular —
        // it sits on document.body (not inside the right panel). Per AC-01,
        // "nothing / body focused" opens the list search.
        expect(screen.queryByTestId('queue-search-input')).toBeNull();
        fireEvent.keyDown(document.body, { key: 'f', ctrlKey: true });

        const input = await screen.findByTestId('queue-search-input');
        await waitFor(() => expect(document.activeElement).toBe(input));
    });

    it('Ctrl+N opens a new chat when no conversation is open', () => {
        const onNewChat = vi.fn();
        render(<ChatListPane {...defaultProps({ ...listProps(), onNewChat })} />);
        makePaneVisible();

        fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });

        expect(onNewChat).toHaveBeenCalledTimes(1);
    });

    it('Ctrl+N does NOT fire when a conversation is open and focus is outside the list (regression)', () => {
        const onNewChat = vi.fn();
        render(<ChatListPane {...defaultProps({ ...chatOpenProps(), onNewChat })} />);
        makePaneVisible();

        // Focus rests on the body while a conversation is open.
        fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });

        expect(onNewChat).not.toHaveBeenCalled();
    });
});

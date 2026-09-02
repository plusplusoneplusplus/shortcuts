/**
 * ChatListPane — folders under an active search (AC-08).
 *
 * While a query is active the tree flattens: only folders whose *name* matches
 * survive, expanded with all of their contents, and every other folder dissolves
 * so its matching members fall back into the flat date buckets carrying a
 * folder-name chip. Clearing the query restores the tree, collapse state and all.
 *
 * `utils/config` is deliberately NOT mocked so the real feature-flag read path
 * runs via `applyRuntimeConfigPatch`.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

const FOLDERS = [
    {
        id: 'folder-auth',
        name: 'Auth rewrite',
        color: 'purple',
        sortIndex: 0,
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z',
    },
    {
        id: 'folder-perf',
        name: 'Perf: chat list',
        color: 'green',
        sortIndex: 1,
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z',
    },
];

const listChatFolders = vi.fn(async () => ({ folders: FOLDERS }));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: {
            listChatFolders: (...args: any[]) => listChatFolders(...(args as [])),
            summaries: async () => ({ summaries: mockProcesses }),
        },
    }),
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
    useWorkflowProgress: () => ({ progress: null }),
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

// `folderId` rides on the workspace-scoped summaries fetch (`useChatFolderMembership`).
let mockProcesses: any[] = [];
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { myWorkExcludedTypes: [], selectedWorkspaceId: 'ws-test', processes: mockProcesses },
        dispatch: vi.fn(),
    }),
}));

vi.mock('../../../../src/server/spa/client/react/hooks/preferences/useDisplaySettings', () => ({
    useDisplaySettings: () => ({ getBoolean: () => false, setBoolean: vi.fn() }),
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

function makeChat(overrides: Record<string, any> = {}) {
    return {
        id: 'task-1',
        type: 'chat',
        status: 'completed',
        displayName: 'Test Chat',
        title: 'Test Chat',
        startedAt: new Date().toISOString(),
        lastActivityAt: Date.now(),
        payload: { mode: 'ask' },
        ...overrides,
    };
}

function makeScript(overrides: Record<string, any> = {}) {
    return makeChat({ type: 'run-script', payload: {}, ...overrides });
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

async function renderPane(props: Record<string, any> = {}) {
    let utils: ReturnType<typeof render>;
    await act(async () => {
        utils = render(<ChatListPane {...defaultProps} {...props} />);
    });
    return utils!;
}


/** Reveal the search bar (Ctrl+F) and type a query. */
async function search(query: string) {
    fireEvent.keyDown(document, { key: 'f', ctrlKey: true });
    const input = screen.getByTestId('queue-search-input');
    await act(async () => {
        fireEvent.change(input, { target: { value: query } });
    });
    return input;
}

/** One folder's rendered block, addressed by id rather than by position. */
function folderBlock(folderId: string): HTMLElement {
    return document.querySelector(`[data-folder-id="${folderId}"]`) as HTMLElement;
}

/** The chip rendered on one specific row, if any. */
function chipOn(taskId: string): HTMLElement | null {
    const row = document.querySelector(`[data-task-id="${taskId}"]`);
    return row ? row.querySelector('[data-testid="chat-folder-chip"]') : null;
}

describe('ChatListPane — chat folders under search (AC-08)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
        // jsdom has no layout engine, so `offsetParent` is always null and the
        // Ctrl+F visibility guard in `useScopedFindShortcut` would bail. Report a
        // connected element as visible so the search bar can actually open.
        Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
            get() { return this.isConnected ? document.body : null; },
            configurable: true,
        });
    });

    it('flattens the tree: a folder whose name does not match dissolves and its member returns to the date bucket', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-perf' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'token refresh', displayName: 'token refresh' }),
                makeChat({ id: 'proc-b', title: 'count tokens end to end', displayName: 'count tokens end to end' }),
            ],
        });
        // Unsearched, the row lives inside its folder.
        expect(screen.getByTestId('chat-folder-children').textContent).toContain('token refresh');

        await search('token');

        // "token" matches neither folder name, so no folder survives at all.
        expect(document.querySelector('[data-section="folders"]')).toBeNull();
        const today = document.querySelector('[data-section="completed-today"]')!;
        expect(today.textContent).toContain('token refresh');
        expect(today.textContent).toContain('count tokens end to end');
    });

    it('gives a flattened result a folder chip, and gives an unfiled result none', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-perf' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'token refresh', displayName: 'token refresh' }),
                makeChat({ id: 'proc-b', title: 'count tokens end to end', displayName: 'count tokens end to end' }),
            ],
        });
        await search('token');

        const filedChip = chipOn('proc-a');
        expect(filedChip).not.toBeNull();
        expect(filedChip!.textContent).toContain('Perf');
        // An unfiled result gets no chip rather than one reading "Unfiled".
        expect(chipOn('proc-b')).toBeNull();
    });

    it('carries no chip when nothing is being searched', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-perf' }];
        await renderPane({
            history: [makeChat({ id: 'proc-a', title: 'token refresh', displayName: 'token refresh' })],
        });
        // The row is inside its folder; the folder row itself says where it lives.
        expect(chipOn('proc-a')).toBeNull();
    });

    it('renders a name-matched folder expanded with every member, including ones whose own text does not match', async () => {
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-x', folderId: 'folder-auth' },
        ];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'token refresh', displayName: 'token refresh' }),
                makeChat({ id: 'proc-x', title: 'session cookie ttl', displayName: 'session cookie ttl' }),
                makeChat({ id: 'proc-b', title: 'unrelated chat', displayName: 'unrelated chat' }),
            ],
        });

        await search('auth');

        expect(screen.getByTestId('chat-folder-name').textContent).toBe('Auth rewrite');
        const children = screen.getByTestId('chat-folder-children');
        expect(children.textContent).toContain('token refresh');
        expect(children.textContent).toContain('session cookie ttl');
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('2');
        // The non-member, non-matching chat is gone from the results entirely.
        expect(document.querySelector('[data-task-id="proc-b"]')).toBeNull();
    });

    it('renders a row that matches AND sits in a matching folder exactly once', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'auth token refresh', displayName: 'auth token refresh' }),
            ],
        });

        await search('auth');

        expect(document.querySelectorAll('[data-task-id="proc-a"]')).toHaveLength(1);
        expect(screen.getByTestId('chat-folder-children').textContent).toContain('auth token refresh');
        expect(document.querySelector('[data-section="completed-today"]')?.textContent ?? '')
            .not.toContain('auth token refresh');
    });

    it('never renders a member of a matched folder inside the folder without a chip on it', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            history: [makeChat({ id: 'proc-a', title: 'auth token refresh', displayName: 'auth token refresh' })],
        });
        await search('auth');
        // The folder row above it already says where it lives.
        expect(chipOn('proc-a')).toBeNull();
    });

    it('does not mutate collapse state — searching and clearing restores the prior expansion', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'token refresh', displayName: 'token refresh' }),
                makeChat({ id: 'proc-b', title: 'unrelated chat', displayName: 'unrelated chat' }),
            ],
        });

        // Collapse the folder in the tree.
        await act(async () => {
            fireEvent.click(folderBlock('folder-auth').querySelector('[data-testid="chat-folder-row"]')!);
        });
        expect(folderBlock('folder-auth').querySelector('[data-testid="chat-folder-children"]')).toBeNull();

        // A folder-name search forces it open, without writing the collapse set.
        const input = await search('auth');
        expect(folderBlock('folder-auth').querySelector('[data-testid="chat-folder-children"]')!.textContent)
            .toContain('token refresh');

        // Clearing the query restores exactly the prior expansion.
        await act(async () => {
            fireEvent.change(input, { target: { value: '' } });
        });
        expect(folderBlock('folder-auth')).not.toBeNull();
        expect(folderBlock('folder-auth').querySelector('[data-testid="chat-folder-children"]')).toBeNull();
    });

    it('restores the unsearched tree when the query is cleared', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-perf' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'token refresh', displayName: 'token refresh' }),
                makeChat({ id: 'proc-b', title: 'unrelated chat', displayName: 'unrelated chat' }),
            ],
        });
        const input = await search('token');
        expect(document.querySelector('[data-section="folders"]')).toBeNull();

        await act(async () => {
            fireEvent.change(input, { target: { value: '' } });
        });
        expect(document.querySelector('[data-section="folders"]')).not.toBeNull();
        expect(screen.getByTestId('chat-folder-children').textContent).toContain('token refresh');
        expect(chipOn('proc-a')).toBeNull();
    });

    it('shows no folder chrome at all while searching when the flag is off', async () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-perf' }];
        await renderPane({
            history: [makeChat({ id: 'proc-a', title: 'token refresh', displayName: 'token refresh' })],
        });
        await search('token');
        expect(document.querySelector('[data-section="folders"]')).toBeNull();
        expect(chipOn('proc-a')).toBeNull();
    });
});

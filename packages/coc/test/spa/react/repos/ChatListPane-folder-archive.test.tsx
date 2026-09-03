/**
 * ChatListPane — archiving interacts with chat folders (AC-09).
 *
 * Archiving is a chat *preference*, so a folder membership row is never
 * touched: an archived chat keeps its folder, unarchiving puts it straight
 * back, and the folder survives an "Archive all chats" at count 0. This suite
 * drives the folder ⋯ menu item, its confirm, the pinned-member skip, and the
 * undo toast.
 *
 * The real `ContextMenu` is used (not mocked) so the item's disabled state is
 * exercised as shipped.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { applyRuntimeConfigPatch } from '../../../../src/server/spa/client/react/utils/config';

function makeFolder(id: string, name: string, sortIndex: number): any {
    return {
        id,
        name,
        color: 'purple',
        sortIndex,
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z',
    };
}

const FOLDERS = [
    makeFolder('folder-auth', 'Auth rewrite', 0),
    makeFolder('folder-perf', 'Perf: chat list', 1),
];

const listChatFolders = vi.fn(async () => ({ folders: FOLDERS }));
const createChatFolder = vi.fn(async (_ws: string, body: any) => ({
    folder: {
        id: 'folder-new',
        name: body.name,
        color: body.color ?? 'blue',
        sortIndex: 0,
        createdAt: '2026-08-27T00:00:00.000Z',
        updatedAt: '2026-08-27T00:00:00.000Z',
    },
}));
const updateChatFolder = vi.fn(async (_ws: string, folderId: string, body: any) => ({
    folder: { ...FOLDERS[0], id: folderId, ...body },
}));
const deleteChatFolder = vi.fn(async () => ({ deleted: true, unfiled: [] as string[] }));
const setProcessFolderBatch = vi.fn(async (ids: string[], folderId: string | null) => ({ updated: ids, folderId }));
const setProcessFolder = vi.fn(async (id: string, folderId: string | null) => ({ id, folderId }));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: {
            listChatFolders: (...args: any[]) => listChatFolders(...(args as [])),
            summaries: async () => ({ summaries: mockProcesses }),
            createChatFolder: (...args: any[]) => (createChatFolder as any)(...args),
            updateChatFolder: (...args: any[]) => (updateChatFolder as any)(...args),
            deleteChatFolder: (...args: any[]) => (deleteChatFolder as any)(...args),
            setProcessFolderBatch: (...args: any[]) => (setProcessFolderBatch as any)(...args),
            setProcessFolder: (...args: any[]) => (setProcessFolder as any)(...args),
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

// Pin / archive live in a chat preference, which is exactly why membership
// survives archiving. The sets are mutable so a test can archive and then
// re-render to see the list as it would look on the next paint.
let mockPinnedIds = new Set<string>();
let mockArchivedIds = new Set<string>();
const archiveChatsSpy = vi.fn((ids: string[]) => {
    mockArchivedIds = new Set([...mockArchivedIds, ...ids]);
});
const unarchiveChatsSpy = vi.fn((ids: string[]) => {
    const next = new Set(mockArchivedIds);
    for (const id of ids) {next.delete(id);}
    mockArchivedIds = next;
});
vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    // Real key names — the context exposes pinChat/archiveChats and
    // ChatListPane renames them on destructure.
    useChatPrefs: () => ({
        pinnedChatIds: mockPinnedIds,
        archivedChatIds: mockArchivedIds,
        pinChat: vi.fn(),
        unpinChat: vi.fn(),
        archiveChat: vi.fn(),
        unarchiveChat: vi.fn(),
        archiveChats: (ids: string[]) => archiveChatsSpy(ids),
        unarchiveChats: (ids: string[]) => unarchiveChatsSpy(ids),
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
const mockDispatch = vi.fn();
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', () => ({
    useApp: () => ({
        state: { myWorkExcludedTypes: [], selectedWorkspaceId: 'ws-test', processes: mockProcesses },
        dispatch: mockDispatch,
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

/**
 * Renders the pane with at least one unfiled chat: an entirely empty list
 * short-circuits to the "No tasks in queue" empty state, which has no header
 * and therefore no folder chrome to drive.
 */
async function renderPane(props: Record<string, any> = {}) {
    const history = props.history ?? [makeChat({ id: 'proc-seed', title: 'seed chat' })];
    let utils: ReturnType<typeof render>;
    await act(async () => {
        utils = render(<ChatListPane {...defaultProps} {...props} history={history} />);
    });
    return utils!;
}

/**
 * Open the ⋯ menu on one folder. Addressed by `data-folder-id`, never by
 * position: an empty-everywhere folder still renders, so `chat-folder-row`
 * alone is ambiguous.
 */
async function openFolderMenu(folderId: string) {
    const row = document.querySelector(`[data-folder-id="${folderId}"]`);
    if (!row) {throw new Error(`No folder row for ${folderId}`);}
    const btn = row.querySelector('[data-testid="chat-folder-menu-btn"]')
        ?? screen.getByTestId('chat-folder-menu-btn');
    await act(async () => { fireEvent.click(btn as Element); });
    return screen.getByTestId('context-menu');
}

/** The folder row for `folderId`, or null when it is not rendered at all. */
function folderRow(folderId: string): HTMLElement | null {
    return document.querySelector(`[data-folder-id="${folderId}"]`);
}

function menuItemByLabel(label: string): HTMLElement {
    const menu = screen.getByTestId('context-menu');
    const match = [...menu.querySelectorAll('button')].find(b => b.textContent?.includes(label));
    if (!match) {throw new Error(`No menu item labelled "${label}" — saw: ${menu.textContent}`);}
    return match as HTMLElement;
}


describe('ChatListPane — archive interaction with folders (AC-09)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockPinnedIds = new Set<string>();
        mockArchivedIds = new Set<string>();
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
    });

    /** Two chats filed in Auth rewrite, plus one unfiled row to keep the header alive. */
    function filedFixture() {
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-b', folderId: 'folder-auth' },
        ];
        return {
            history: [
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
                makeChat({ id: 'proc-b', title: 'beta chat' }),
                makeChat({ id: 'proc-seed', title: 'seed chat' }),
            ],
        };
    }

    // ── Membership survives archiving ───────────────────────────────────────

    it('keeps a chat filed while it is archived, and the folder count drops', async () => {
        const props = filedFixture();
        const { rerender } = await renderPane(props);
        expect(folderRow('folder-auth')?.textContent).toContain('2');

        // Archive one member the way the row menu does.
        act(() => { archiveChatsSpy(['proc-a']); });
        await act(async () => { rerender(<ChatListPane {...defaultProps} {...props} />); });

        // Membership is untouched — nothing wrote to the summaries index.
        expect(mockProcesses.find(p => p.id === 'proc-a')?.folderId).toBe('folder-auth');
        expect(setProcessFolder).not.toHaveBeenCalled();
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        // ...but the archived row is no longer one of the folder's visible chats.
        const row = folderRow('folder-auth');
        expect(row?.textContent).not.toContain('alpha chat');
        expect(row?.querySelector('[data-testid="chat-folder-count"]')?.textContent).toBe('1');
    });

    it('unarchiving puts the chat back inside its folder', async () => {
        const props = filedFixture();
        const { rerender } = await renderPane(props);
        act(() => { archiveChatsSpy(['proc-a', 'proc-b']); });
        await act(async () => { rerender(<ChatListPane {...defaultProps} {...props} />); });
        expect(folderRow('folder-auth')?.textContent).not.toContain('alpha chat');

        act(() => { unarchiveChatsSpy(['proc-a', 'proc-b']); });
        await act(async () => { rerender(<ChatListPane {...defaultProps} {...props} />); });
        const row = folderRow('folder-auth');
        expect(row?.textContent).toContain('alpha chat');
        expect(row?.textContent).toContain('beta chat');
    });

    it('keeps the folder on screen at count 0 when every member is archived', async () => {
        const props = filedFixture();
        const { rerender } = await renderPane(props);
        act(() => { archiveChatsSpy(['proc-a', 'proc-b']); });
        await act(async () => { rerender(<ChatListPane {...defaultProps} {...props} />); });

        const row = folderRow('folder-auth');
        expect(row).not.toBeNull();
        expect(row?.querySelector('[data-testid="chat-folder-count"]')?.textContent).toBe('0');
    });

    // ── Archive all chats ───────────────────────────────────────────────────

    it('offers Archive all chats on the folder ⋯ menu', async () => {
        await renderPane(filedFixture());
        await openFolderMenu('folder-auth');
        expect(menuItemByLabel('Archive all chats')).toBeTruthy();
    });

    it('disables Archive all chats when every member is already archived', async () => {
        const props = filedFixture();
        const { rerender } = await renderPane(props);
        act(() => { archiveChatsSpy(['proc-a', 'proc-b']); });
        await act(async () => { rerender(<ChatListPane {...defaultProps} {...props} />); });

        await openFolderMenu('folder-auth');
        const item = menuItemByLabel('Archive all chats') as HTMLButtonElement;
        expect(item.disabled).toBe(true);
        await act(async () => { fireEvent.click(item); });
        expect(screen.queryByTestId('chat-folder-archive-copy')).toBeNull();
    });

    it('confirms with the count, and archives nothing until confirmed', async () => {
        await renderPane(filedFixture());
        await openFolderMenu('folder-auth');
        await act(async () => { fireEvent.click(menuItemByLabel('Archive all chats')); });

        expect(screen.getByText('Archive 2 chats?')).toBeTruthy();
        expect(screen.getByTestId('chat-folder-archive-copy').textContent).toContain('The folder stays');
        expect(archiveChatsSpy).not.toHaveBeenCalled();

        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-archive-cancel')); });
        expect(archiveChatsSpy).not.toHaveBeenCalled();
        expect(screen.queryByTestId('chat-folder-archive-copy')).toBeNull();
    });

    it('archives every member on confirm and leaves the folder in place', async () => {
        const props = filedFixture();
        const { rerender } = await renderPane(props);
        await openFolderMenu('folder-auth');
        await act(async () => { fireEvent.click(menuItemByLabel('Archive all chats')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-archive-confirm')); });

        expect(archiveChatsSpy).toHaveBeenCalledWith(['proc-a', 'proc-b']);
        await act(async () => { rerender(<ChatListPane {...defaultProps} {...props} />); });
        expect(deleteChatFolder).not.toHaveBeenCalled();
        expect(folderRow('folder-auth')).not.toBeNull();
    });

    it('skips pinned members and says so in the undo toast', async () => {
        mockPinnedIds = new Set(['proc-b']);
        await renderPane(filedFixture());
        await openFolderMenu('folder-auth');
        await act(async () => { fireEvent.click(menuItemByLabel('Archive all chats')); });

        expect(screen.getByText('Archive 1 chat?')).toBeTruthy();
        expect(screen.getByTestId('chat-folder-archive-copy').textContent).toContain('1 pinned chat is skipped');
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-archive-confirm')); });

        expect(archiveChatsSpy).toHaveBeenCalledWith(['proc-a']);
        expect(screen.getByTestId('chat-folder-archive-undo-toast').textContent)
            .toContain('1 pinned skipped');
    });

    // ── Undo ────────────────────────────────────────────────────────────────

    it('undo unarchives exactly the chats it archived', async () => {
        const props = filedFixture();
        const { rerender } = await renderPane(props);
        await openFolderMenu('folder-auth');
        await act(async () => { fireEvent.click(menuItemByLabel('Archive all chats')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-archive-confirm')); });

        const toast = screen.getByTestId('chat-folder-archive-undo-toast');
        expect(toast.textContent).toContain('Archived 2 chats in “Auth rewrite”');
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-archive-undo-btn')); });

        expect(unarchiveChatsSpy).toHaveBeenCalledWith(['proc-a', 'proc-b']);
        expect(screen.queryByTestId('chat-folder-archive-undo-toast')).toBeNull();
        await act(async () => { rerender(<ChatListPane {...defaultProps} {...props} />); });
        expect(folderRow('folder-auth')?.textContent).toContain('alpha chat');
    });

    it('dismissing the toast leaves the chats archived', async () => {
        await renderPane(filedFixture());
        await openFolderMenu('folder-auth');
        await act(async () => { fireEvent.click(menuItemByLabel('Archive all chats')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-archive-confirm')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-archive-undo-dismiss')); });

        expect(unarchiveChatsSpy).not.toHaveBeenCalled();
        expect(mockArchivedIds.has('proc-a')).toBe(true);
    });

    it('renders nothing folder-related with the flag off', async () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
        await renderPane(filedFixture());
        expect(document.querySelector('[data-section="folders"]')).toBeNull();
    });
});

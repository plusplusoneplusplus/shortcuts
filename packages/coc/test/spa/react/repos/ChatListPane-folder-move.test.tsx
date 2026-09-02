/**
 * ChatListPane — filing rows into folders from the row context menu (AC-06).
 *
 * Drives "Move to folder ▸" end to end: a single move, a batch move over a
 * mixed-membership selection, "Remove from folder", the "+ New folder…"
 * create-and-file step, the filter input that only appears past 10 folders,
 * and keyboard-only navigation into the submenu.
 *
 * The real `ContextMenu` is used (not mocked) so the submenu, its filter, and
 * its arrow-key behaviour are all exercised as shipped.
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

vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    // Real key names — the context exposes pinChat/archiveChats and
    // ChatListPane renames them on destructure. Getting these wrong silently
    // drops Pin and Archive from the menu, which is what this suite orders
    // "Move to folder" against.
    useChatPrefs: () => ({
        pinnedChatIds: new Set<string>(),
        archivedChatIds: new Set<string>(),
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
import { MAX_CHAT_FOLDER_NAME_LENGTH } from '../../../../src/server/processes/chat-folder-validation';

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

/** Open the inline create row via the ＋folder toolbar button. */
async function openCreateRow() {
    await act(async () => {
        fireEvent.click(screen.getByTestId('chat-list-new-folder-btn'));
    });
    return screen.getByTestId('chat-folder-name-input') as HTMLInputElement;
}

/** Open the ⋯ menu on the one folder this suite renders. */
async function openFolderMenu() {
    await act(async () => {
        fireEvent.click(screen.getByTestId('chat-folder-menu-btn'));
    });
    return screen.getByTestId('context-menu');
}

function menuItemByLabel(label: string): HTMLElement {
    const menu = screen.getByTestId('context-menu');
    const match = [...menu.querySelectorAll('button')].find(b => b.textContent?.includes(label));
    if (!match) {throw new Error(`No menu item labelled "${label}" — saw: ${menu.textContent}`);}
    return match as HTMLElement;
}

/** Right-click a history row, returning the open root menu. */
async function openRowMenu(rowTitle: string) {
    const row = [...screen.getAllByTestId('history-task-row')]
        .find(r => r.textContent?.includes(rowTitle));
    if (!row) {throw new Error(`No history row titled "${rowTitle}"`);}
    await act(async () => { fireEvent.contextMenu(row); });
    return screen.getByTestId('context-menu');
}

/** Ctrl-click a row to add it to the multi-selection. */
async function ctrlClickRow(rowTitle: string) {
    const row = [...screen.getAllByTestId('history-task-row')]
        .find(r => r.textContent?.includes(rowTitle));
    if (!row) {throw new Error(`No history row titled "${rowTitle}"`);}
    await act(async () => { fireEvent.click(row, { ctrlKey: true }); });
}

/** Hover the "Move to folder" parent item open and return its submenu panel. */
async function openMoveSubmenu(expectedLabel = 'Move to folder') {
    const parent = menuItemByLabel(expectedLabel);
    await act(async () => { fireEvent.click(parent); });
    const panel = parent.closest('[data-testid^="context-menu-item-"]')
        ?.querySelector('[data-submenu-panel="true"]');
    if (!panel) {throw new Error('Move-to-folder submenu did not open');}
    return panel as HTMLElement;
}

function submenuItemByLabel(panel: HTMLElement, label: string): HTMLElement {
    const match = [...panel.querySelectorAll('button')].find(b => b.textContent?.includes(label));
    if (!match) {throw new Error(`No submenu item labelled "${label}" — saw: ${panel.textContent}`);}
    return match as HTMLElement;
}

describe('ChatListPane — Move to folder context menu (AC-06)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
    });

    // ── Placement and gating ────────────────────────────────────────────────

    it('places Move to folder after Pin and before Archive', async () => {
        await renderPane({
            history: [makeChat({ id: 'proc-a', title: 'alpha chat' })],
        });
        const menu = await openRowMenu('alpha chat');
        const labels = [...menu.querySelectorAll('button')].map(b => b.textContent ?? '');
        const pin = labels.findIndex(l => l.includes('Pin to top'));
        const move = labels.findIndex(l => l.includes('Move to folder'));
        const archive = labels.findIndex(l => l.includes('Archive'));
        expect(pin).toBeGreaterThanOrEqual(0);
        expect(move).toBeGreaterThan(pin);
        expect(archive).toBeGreaterThan(move);
    });

    it('omits every folder item when the flag is off', async () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: false });
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const menu = await openRowMenu('alpha chat');
        expect(menu.textContent).not.toContain('Move to folder');
        expect(menu.textContent).not.toContain('Remove from folder');
    });

    // ── Single move ─────────────────────────────────────────────────────────

    it('files a single row into the picked folder and shows it there optimistically', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        const panel = await openMoveSubmenu();

        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'Auth rewrite')); });

        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-auth');
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        // The membership map is patched optimistically, so the row renders
        // inside the folder before any summaries refetch.
        const folder = document.querySelector('[data-testid="chat-folder"][data-folder-id="folder-auth"]');
        expect(folder?.textContent).toContain('alpha chat');
    });

    it('lists folders in the tree order', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        const panel = await openMoveSubmenu();
        const labels = [...panel.querySelectorAll('button')].map(b => b.textContent ?? '');
        expect(labels[0]).toContain('Auth rewrite');
        expect(labels[1]).toContain('Perf: chat list');
        expect(labels[labels.length - 1]).toContain('New folder');
    });

    it('issues no request when the row is already in the target folder', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        const panel = await openMoveSubmenu();

        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'Auth rewrite')); });

        expect(setProcessFolder).not.toHaveBeenCalled();
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
    });

    // ── Remove from folder ──────────────────────────────────────────────────

    it('offers Remove from folder only for a filed row, and unfiles it', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        let menu = await openRowMenu('alpha chat');
        expect(menu.textContent).not.toContain('Remove from folder');

        cleanup();
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        menu = await openRowMenu('alpha chat');
        expect(menu.textContent).toContain('Remove from folder');

        await act(async () => { fireEvent.click(menuItemByLabel('Remove from folder')); });
        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', null);
    });

    // ── Batch ───────────────────────────────────────────────────────────────

    it('pluralizes the label with the selection count and batch-moves mixed membership', async () => {
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-b', folderId: null },
        ];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
                makeChat({ id: 'proc-b', title: 'bravo chat' }),
                makeChat({ id: 'proc-c', title: 'charlie chat' }),
            ],
        });
        await ctrlClickRow('alpha chat');
        await ctrlClickRow('bravo chat');
        await ctrlClickRow('charlie chat');
        const menu = await openRowMenu('charlie chat');
        expect(menu.textContent).toContain('Move 3 chats to folder');

        const panel = await openMoveSubmenu('Move 3 chats to folder');
        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'Perf: chat list')); });

        expect(setProcessFolderBatch).toHaveBeenCalledTimes(1);
        const [ids, folderId] = setProcessFolderBatch.mock.calls[0];
        expect([...ids].sort()).toEqual(['proc-a', 'proc-b', 'proc-c']);
        expect(folderId).toBe('folder-perf');
    });

    it('drops a row that is already in the target from the batch, not the whole move', async () => {
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-b', folderId: null },
        ];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
                makeChat({ id: 'proc-b', title: 'bravo chat' }),
            ],
        });
        await ctrlClickRow('alpha chat');
        await ctrlClickRow('bravo chat');
        await openRowMenu('bravo chat');
        const panel = await openMoveSubmenu('Move 2 chats to folder');
        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'Auth rewrite')); });

        // Only proc-b actually changes folders, so it is the only id written —
        // and a single id takes the single-row endpoint.
        expect(setProcessFolder).toHaveBeenCalledWith('proc-b', 'folder-auth');
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
    });

    // ── + New folder… ───────────────────────────────────────────────────────

    it('creates a folder and files the row into it in one step', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        const panel = await openMoveSubmenu();

        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'New folder')); });

        const input = screen.getByTestId('chat-folder-name-input') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Password reset' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(createChatFolder).toHaveBeenCalledWith('ws-test', { name: 'Password reset', color: 'purple' });
        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-new');
    });

    it('moves nothing when the "+ New folder…" create is cancelled', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        const panel = await openMoveSubmenu();
        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'New folder')); });

        const input = screen.getByTestId('chat-folder-name-input') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Discarded' } });
            fireEvent.keyDown(input, { key: 'Escape' });
            fireEvent.blur(input);
        });

        expect(createChatFolder).not.toHaveBeenCalled();
        expect(setProcessFolder).not.toHaveBeenCalled();
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
    });

    // ── Filter ──────────────────────────────────────────────────────────────

    it('shows no filter input at 10 folders and one past 10', async () => {
        const ten = Array.from({ length: 10 }, (_, i) => makeFolder(`folder-${i}`, `Folder ${i}`, i));
        listChatFolders.mockResolvedValue({ folders: ten });
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        let panel = await openMoveSubmenu();
        expect(panel.querySelector('input')).toBeNull();

        cleanup();
        listChatFolders.mockResolvedValue({
            folders: [...ten, makeFolder('folder-10', 'Auth rewrite', 10)],
        });
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        panel = await openMoveSubmenu();
        const filter = panel.querySelector('input');
        expect(filter).not.toBeNull();

        await act(async () => { fireEvent.change(filter!, { target: { value: 'auth' } }); });
        const labels = [...panel.querySelectorAll('button')].map(b => b.textContent ?? '');
        expect(labels.filter(l => l.includes('Folder '))).toHaveLength(0);
        expect(labels.some(l => l.includes('Auth rewrite'))).toBe(true);
        // The escape hatch must survive any query.
        expect(labels.some(l => l.includes('New folder'))).toBe(true);
    });

    // ── Keyboard ────────────────────────────────────────────────────────────

    it('files a chat with the keyboard alone', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const menu = await openRowMenu('alpha chat');

        /** The focused element, but only when it is really a menu item. */
        const focusedItem = () => {
            const el = document.activeElement as HTMLElement | null;
            return el?.getAttribute('role') === 'menuitem' ? el : null;
        };

        // Arrow down the root menu until "Move to folder" holds focus.
        let guard = 0;
        while (!(focusedItem()?.textContent ?? '').includes('Move to folder')) {
            const from = focusedItem() ?? menu;
            await act(async () => { fireEvent.keyDown(from, { key: 'ArrowDown' }); });
            if (++guard > 20) {throw new Error('Never reached the Move to folder item');}
        }

        // ArrowRight opens the submenu and hands it focus.
        await act(async () => { fireEvent.keyDown(focusedItem()!, { key: 'ArrowRight' }); });
        expect(focusedItem()?.textContent).toContain('Auth rewrite');

        // ArrowDown walks the submenu, not back into the root list.
        await act(async () => { fireEvent.keyDown(focusedItem()!, { key: 'ArrowDown' }); });
        expect(focusedItem()?.textContent).toContain('Perf: chat list');

        await act(async () => { fireEvent.keyDown(focusedItem()!, { key: 'Enter' }); });
        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-perf');
    });

    it('closes the submenu on ArrowLeft, returning focus to its parent row', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await openRowMenu('alpha chat');
        const panel = await openMoveSubmenu();
        const first = submenuItemByLabel(panel, 'Auth rewrite');
        await act(async () => { first.focus(); fireEvent.keyDown(first, { key: 'ArrowLeft' }); });

        const focused = document.activeElement as HTMLElement | null;
        expect(focused?.getAttribute('role')).toBe('menuitem');
        expect(focused?.textContent).toContain('Move to folder');
        expect(document.querySelector('[data-submenu-panel="true"]')).toBeNull();
    });
});

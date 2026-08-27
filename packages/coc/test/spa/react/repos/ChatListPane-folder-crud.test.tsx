/**
 * ChatListPane — folder create / rename / recolor / delete (AC-05).
 *
 * Drives the affordances end to end: the ＋folder toolbar button, the inline
 * create and rename rows with their Enter / Esc / blur commit rules, the ⋯
 * menu's color submenu and Delete, the confirm that only a non-empty folder
 * gets, and the single-level undo that restores both the folder and its
 * membership.
 *
 * The real `ContextMenu` and `Dialog` are used (not mocked) — the point of DoD
 * item 3 is that the confirm is the app's dialog, never `window.confirm`.
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

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: {
            listChatFolders: (...args: any[]) => listChatFolders(...(args as [])),
            createChatFolder: (...args: any[]) => (createChatFolder as any)(...args),
            updateChatFolder: (...args: any[]) => (updateChatFolder as any)(...args),
            deleteChatFolder: (...args: any[]) => (deleteChatFolder as any)(...args),
            setProcessFolderBatch: (...args: any[]) => (setProcessFolderBatch as any)(...args),
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

// `folderId` rides on the process-summary index that AppContext already holds.
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

describe('ChatListPane — folder create / rename / recolor / delete (AC-05)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
    });

    // ── Create ──────────────────────────────────────────────────────────────

    it('creates a folder from the ＋folder button and puts it at the top', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a' })] });
        const input = await openCreateRow();

        await act(async () => {
            fireEvent.change(input, { target: { value: 'Password reset' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(createChatFolder).toHaveBeenCalledWith('ws-test', { name: 'Password reset', color: 'purple' });
        const names = screen.getAllByTestId('chat-folder-name').map(n => n.textContent);
        expect(names[0]).toBe('Password reset');
        expect(names).toContain('Auth rewrite');
    });

    it('opens the create row even when the workspace has no folders yet', async () => {
        listChatFolders.mockResolvedValue({ folders: [] });
        await renderPane({ history: [makeChat({ id: 'proc-a' })] });
        // Zero folders still keeps the header, which is where ＋New folder
        // lives — otherwise the first folder would be uncreatable.
        expect(document.querySelector('[data-section="folders"]')).not.toBeNull();
        expect(screen.queryByTestId('chat-folder-create-row')).toBeNull();
        await openCreateRow();
        expect(screen.getByTestId('chat-folder-create-row')).not.toBeNull();
    });

    it('commits with the chosen swatch colour', async () => {
        await renderPane();
        const input = await openCreateRow();
        await act(async () => {
            fireEvent.click(screen.getByTestId('chat-folder-color-swatch-green'));
            fireEvent.change(input, { target: { value: 'Perf' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        expect(createChatFolder).toHaveBeenCalledWith('ws-test', { name: 'Perf', color: 'green' });
    });

    it('cancels the create on Esc, sending no request even though text was typed', async () => {
        await renderPane();
        const input = await openCreateRow();
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Discarded' } });
            fireEvent.keyDown(input, { key: 'Escape' });
            // Esc necessarily blurs the field next; blur-with-text must not
            // resurrect the commit the user just cancelled.
            fireEvent.blur(input);
        });
        expect(createChatFolder).not.toHaveBeenCalled();
        expect(screen.queryByTestId('chat-folder-create-row')).toBeNull();
    });

    it('cancels the create when blurred while empty, and commits when blurred with text', async () => {
        await renderPane();
        let input = await openCreateRow();
        await act(async () => { fireEvent.blur(input); });
        expect(createChatFolder).not.toHaveBeenCalled();
        expect(screen.queryByTestId('chat-folder-create-row')).toBeNull();

        input = await openCreateRow();
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Kept' } });
            fireEvent.blur(input);
        });
        expect(createChatFolder).toHaveBeenCalledWith('ws-test', { name: 'Kept', color: 'purple' });
    });

    it('clamps the typed name to 60 characters', async () => {
        await renderPane();
        const input = await openCreateRow();
        await act(async () => {
            fireEvent.change(input, { target: { value: 'z'.repeat(MAX_CHAT_FOLDER_NAME_LENGTH + 40) } });
        });
        expect(input.value).toHaveLength(MAX_CHAT_FOLDER_NAME_LENGTH);

        await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
        expect(createChatFolder).toHaveBeenCalledWith('ws-test', {
            name: 'z'.repeat(MAX_CHAT_FOLDER_NAME_LENGTH),
            color: 'purple',
        });
    });

    it('trims the committed name', async () => {
        // Newline stripping is not observable through a text <input> — the
        // element sanitizes \r\n out of its own value, in jsdom and in a real
        // browser alike — so that rule is covered directly in
        // `chat-folder-mutations.test.ts` against the shared validator.
        await renderPane();
        const input = await openCreateRow();
        await act(async () => {
            fireEvent.change(input, { target: { value: '  Spaced  ' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        expect(createChatFolder).toHaveBeenCalledWith('ws-test', { name: 'Spaced', color: 'purple' });
    });

    it('shows a soft duplicate-name hint without blocking the create', async () => {
        await renderPane();
        const input = await openCreateRow();
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Auth rewrite' } });
        });
        expect(screen.getByTestId('chat-folder-duplicate-hint').textContent).toContain('already exists');
        await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
        expect(createChatFolder).toHaveBeenCalledWith('ws-test', { name: 'Auth rewrite', color: 'purple' });
    });

    // ── Rename ──────────────────────────────────────────────────────────────

    it('renames via F2 on the folder row', async () => {
        await renderPane();
        await act(async () => {
            fireEvent.keyDown(screen.getByTestId('chat-folder-row'), { key: 'F2' });
        });
        const input = screen.getByTestId('chat-folder-name-input') as HTMLInputElement;
        // The rename row seeds from the current name and omits the swatches.
        expect(input.value).toBe('Auth rewrite');
        expect(screen.queryByTestId('chat-folder-color-swatch-purple')).toBeNull();

        await act(async () => {
            fireEvent.change(input, { target: { value: 'Auth rewrite v2' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        expect(updateChatFolder).toHaveBeenCalledWith('ws-test', 'folder-auth', { name: 'Auth rewrite v2' });
        expect(screen.getByTestId('chat-folder-name').textContent).toBe('Auth rewrite v2');
    });

    it('renames via double-click on the name, and Esc reverts it', async () => {
        await renderPane();
        await act(async () => {
            fireEvent.doubleClick(screen.getByTestId('chat-folder-name'));
        });
        const input = screen.getByTestId('chat-folder-name-input') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: 'nope' } });
            fireEvent.keyDown(input, { key: 'Escape' });
            fireEvent.blur(input);
        });
        expect(updateChatFolder).not.toHaveBeenCalled();
        expect(screen.getByTestId('chat-folder-name').textContent).toBe('Auth rewrite');
    });

    it('treats renaming to the identical string as a no-op, not a request', async () => {
        await renderPane();
        await act(async () => {
            fireEvent.keyDown(screen.getByTestId('chat-folder-row'), { key: 'F2' });
        });
        const input = screen.getByTestId('chat-folder-name-input');
        await act(async () => { fireEvent.keyDown(input, { key: 'Enter' }); });
        expect(updateChatFolder).not.toHaveBeenCalled();
    });

    it('does not toggle the folder collapse when Enter commits the rename', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a' })] });
        const before = screen.getByTestId('chat-folder').getAttribute('data-expanded');
        await act(async () => {
            fireEvent.keyDown(screen.getByTestId('chat-folder-row'), { key: 'F2' });
        });
        const input = screen.getByTestId('chat-folder-name-input');
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Renamed' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        expect(screen.getByTestId('chat-folder').getAttribute('data-expanded')).toBe(before);
    });

    // ── Recolor ─────────────────────────────────────────────────────────────

    it('recolors from the ⋯ menu colour submenu', async () => {
        await renderPane();
        await openFolderMenu();
        await act(async () => { fireEvent.click(menuItemByLabel('Folder color')); });
        await act(async () => {
            const submenu = screen.getByTestId('context-submenu-1');
            const green = [...submenu.querySelectorAll('button')].find(b => b.textContent?.includes('Green'))!;
            fireEvent.click(green);
        });
        expect(updateChatFolder).toHaveBeenCalledWith('ws-test', 'folder-auth', { color: 'green' });
    });

    it('starts a rename from the ⋯ menu', async () => {
        await renderPane();
        await openFolderMenu();
        await act(async () => { fireEvent.click(menuItemByLabel('Rename')); });
        expect(screen.getByTestId('chat-folder-rename-row')).not.toBeNull();
    });

    // ── Delete + undo ───────────────────────────────────────────────────────

    it('deletes an empty folder with no confirm', async () => {
        mockProcesses = [];
        await renderPane();
        await openFolderMenu();
        await act(async () => { fireEvent.click(menuItemByLabel('Delete folder')); });

        expect(screen.queryByTestId('chat-folder-delete-copy')).toBeNull();
        expect(deleteChatFolder).toHaveBeenCalledWith('ws-test', 'folder-auth');
        expect(screen.queryAllByTestId('chat-folder')).toHaveLength(0);
    });

    it('confirms before deleting a non-empty folder, naming the count and promising no data loss', async () => {
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-b', folderId: 'folder-auth' },
        ];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'token refresh' }),
                makeChat({ id: 'proc-b', title: 'count tokens' }),
            ],
        });
        await openFolderMenu();
        await act(async () => { fireEvent.click(menuItemByLabel('Delete folder')); });

        // Nothing is deleted until the dialog is answered.
        expect(deleteChatFolder).not.toHaveBeenCalled();
        const copy = screen.getByTestId('chat-folder-delete-copy').textContent ?? '';
        expect(copy).toContain('No conversations will be deleted');
        expect(copy).toContain('2 chats');

        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-delete-confirm')); });
        expect(deleteChatFolder).toHaveBeenCalledWith('ws-test', 'folder-auth');
    });

    it('cancelling the confirm deletes nothing', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'token refresh' })] });
        await openFolderMenu();
        await act(async () => { fireEvent.click(menuItemByLabel('Delete folder')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-delete-cancel')); });

        expect(deleteChatFolder).not.toHaveBeenCalled();
        expect(screen.getByTestId('chat-folder-name').textContent).toBe('Auth rewrite');
    });

    it('offers an undo that restores the folder and re-files its members', async () => {
        mockProcesses = [
            { id: 'proc-a', folderId: 'folder-auth' },
            { id: 'proc-b', folderId: 'folder-auth' },
        ];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'token refresh' }),
                makeChat({ id: 'proc-b', title: 'count tokens' }),
            ],
        });
        await openFolderMenu();
        await act(async () => { fireEvent.click(menuItemByLabel('Delete folder')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-delete-confirm')); });

        const toast = screen.getByTestId('chat-folder-undo-toast');
        expect(toast.textContent).toContain('Auth rewrite');
        expect(toast.textContent).toContain('2 chats unfiled');

        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-undo-btn')); });

        // The original group_id is gone, so undo re-creates the folder…
        expect(createChatFolder).toHaveBeenCalledWith('ws-test', { name: 'Auth rewrite', color: 'purple' });
        // …and re-files exactly the members it remembered, into the new id.
        expect(setProcessFolderBatch).toHaveBeenCalledWith(['proc-a', 'proc-b'], 'folder-new');
        // The summary index is patched too, or every restored row would keep
        // pointing at the folder that no longer exists.
        expect(mockDispatch).toHaveBeenCalledWith({
            type: 'PROCESS_UPDATED',
            process: { id: 'proc-a', folderId: 'folder-new' },
        });
        expect(screen.getAllByTestId('chat-folder-name').map(n => n.textContent)).toContain('Auth rewrite');
        expect(screen.queryByTestId('chat-folder-undo-toast')).toBeNull();
    });

    it('dismissing the undo toast leaves the deletion standing', async () => {
        mockProcesses = [];
        await renderPane();
        await openFolderMenu();
        await act(async () => { fireEvent.click(menuItemByLabel('Delete folder')); });
        await act(async () => { fireEvent.click(screen.getByTestId('chat-folder-undo-dismiss')); });

        expect(createChatFolder).not.toHaveBeenCalled();
        expect(screen.queryByTestId('chat-folder-undo-toast')).toBeNull();
        expect(screen.queryAllByTestId('chat-folder')).toHaveLength(0);
    });

    // ── Collapse all ────────────────────────────────────────────────────────

    it('collapses every folder from the toolbar button and persists it', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'token refresh' })] });
        expect(screen.getByTestId('chat-folder').getAttribute('data-expanded')).toBe('true');

        await act(async () => {
            fireEvent.click(screen.getByTestId('chat-list-collapse-all-folders-btn'));
        });
        expect(screen.getByTestId('chat-folder').getAttribute('data-expanded')).toBe('false');
        expect(localStorage.getItem('coc-chat-folder-collapsed:ws-test')).toContain('folder-auth');
    });
});

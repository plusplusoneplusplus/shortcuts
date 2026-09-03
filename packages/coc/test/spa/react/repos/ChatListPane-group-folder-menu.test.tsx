/**
 * ChatListPane — "Move to folder ▸" on a whole chat *group* row (AC-03).
 *
 * A group row files itself with ONE PATCH against `"<type>:<groupId>"`, never
 * the per-child batch the bulk menu would otherwise fire over its children.
 * The real `ContextMenu` is used so the submenu behaves exactly as shipped.
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
const setGroupFolder = vi.fn(async () => ({ group: null }));
const setProcessFolder = vi.fn(async () => ({ id: 'x', folderId: null }));
const setProcessFolderBatch = vi.fn(async () => ({ updated: [], folderId: null }));
const createChatFolder = vi.fn(async (_ws: string, body: any) => ({
    folder: { id: 'folder-new', name: body.name, color: body.color ?? 'blue', sortIndex: 1, createdAt: '', updatedAt: '' },
}));
/** `"<type>:<groupId>" -> folderId` — the group sidecar, not per-child rows. */
let mockGroupFolders: Record<string, string> = {};
const listGroupFolders = vi.fn(async () => ({ groups: mockGroupFolders, assignments: [] }));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: {
            listChatFolders: (...args: any[]) => listChatFolders(...(args as [])),
            listGroupFolders: (...args: any[]) => listGroupFolders(...(args as [])),
            setGroupFolder: (...args: any[]) => (setGroupFolder as any)(...args),
            setProcessFolder: (...args: any[]) => (setProcessFolder as any)(...args),
            setProcessFolderBatch: (...args: any[]) => (setProcessFolderBatch as any)(...args),
            createChatFolder: (...args: any[]) => (createChatFolder as any)(...args),
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

import { ChatListPane } from '../../../../src/server/spa/client/react/features/chat/ChatListPane';

const SESSION_ID = 'ralph-sess-A';
const GROUP_KEY = `ralph-session:${SESSION_ID}`;
const NOW = Date.now();

function makeRalphIteration(iter: number, ageMs = iter * 1000): any {
    return {
        id: `ralph-${SESSION_ID}-${iter}`,
        type: 'chat',
        status: 'completed',
        displayName: `Ralph iteration ${iter}`,
        endTime: new Date(NOW - ageMs).toISOString(),
        completedAt: new Date(NOW - ageMs).toISOString(),
        lastActivityAt: NOW - ageMs,
        payload: {
            mode: 'ralph',
            context: { ralph: { sessionId: SESSION_ID, phase: 'executing', currentIteration: iter } },
        },
    };
}

function makeStandaloneChat(id: string, label: string): any {
    return {
        id,
        type: 'chat',
        status: 'completed',
        displayName: label,
        customTitle: label,
        title: label,
        completedAt: new Date(NOW - 5000).toISOString(),
        lastActivityAt: NOW - 5000,
        payload: { mode: 'ask' },
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
    now: NOW,
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

/** The one for-each run this suite renders, seeded from a run summary. */
const FOR_EACH_RUN_ID = 'fe-run-1';
function makeForEachRunSummary(): any {
    return {
        runId: FOR_EACH_RUN_ID,
        workspaceId: 'ws-test',
        status: 'completed',
        originalRequest: 'Split the migration',
        childMode: 'ask',
        createdAt: new Date(NOW - 7000).toISOString(),
        updatedAt: new Date(NOW - 7000).toISOString(),
        itemCount: 1,
        itemStatusCounts: { pending: 0, running: 0, completed: 1, failed: 0, skipped: 0 },
    };
}

function makeForEachChild(): any {
    return {
        ...makeStandaloneChat(`fe-child-${FOR_EACH_RUN_ID}`, 'For Each child'),
        forEach: { kind: 'child', workspaceId: 'ws-test', runId: FOR_EACH_RUN_ID, itemId: 'item-1' },
    };
}

function menuItemByLabel(label: string): HTMLElement {
    const menu = screen.getByTestId('context-menu');
    const match = [...menu.querySelectorAll('button')].find(b => b.textContent?.includes(label));
    if (!match) {throw new Error(`No menu item labelled "${label}" — saw: ${menu.textContent}`);}
    return match as HTMLElement;
}

async function openGroupRowMenu(testid: string) {
    // The context-menu handler lives on the group row's clickable *body*, not
    // the outer wrapper the `-row` testid marks.
    const row = screen.getAllByTestId(testid)[0];
    await act(async () => { fireEvent.contextMenu(row); });
    return screen.getByTestId('context-menu');
}

async function openMoveSubmenu() {
    const parent = menuItemByLabel('Move to folder');
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

describe('ChatListPane — Move a chat group to a folder from the context menu (AC-03)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockGroupFolders = {};
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        setGroupFolder.mockResolvedValue({ group: null } as any);
        applyRuntimeConfigPatch({ chatFoldersEnabled: true, ralphEnabled: true, forEachEnabled: true });
    });

    it('files a ralph session with one group PATCH, not a per-child batch', async () => {
        await renderPane({
            history: [makeRalphIteration(1), makeRalphIteration(2), makeRalphIteration(3)],
        });

        await openGroupRowMenu('ralph-session-body');
        const panel = await openMoveSubmenu();
        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'Auth rewrite')); });

        expect(setGroupFolder).toHaveBeenCalledTimes(1);
        expect(setGroupFolder).toHaveBeenCalledWith('ws-test', 'ralph-session', SESSION_ID, 'folder-auth');
        // The children are never touched — that is what lets AC-05 work.
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        expect(setProcessFolder).not.toHaveBeenCalled();

        // …and the row moved optimistically, ahead of any re-fetch.
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('1');
        const children = screen.getByTestId('chat-folder-children');
        expect(children.querySelectorAll('[data-testid="ralph-session-row"]')).toHaveLength(1);
        expect(document.querySelector('[data-section="completed-today"]')
            ?.querySelector('[data-testid="ralph-session-row"]') ?? null).toBeNull();
    });

    it('rolls the group back to its bucket when the request is rejected', async () => {
        setGroupFolder.mockRejectedValue(new Error('boom') as never);
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        await openGroupRowMenu('ralph-session-body');
        const panel = await openMoveSubmenu();
        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'Auth rewrite')); });

        expect(setGroupFolder).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('0');
        const today = document.querySelector('[data-section="completed-today"]')!;
        expect(today.querySelector('[data-testid="ralph-session-row"]')).not.toBeNull();
    });

    it('unfiles a filed group through "Remove from folder"', async () => {
        mockGroupFolders = { [GROUP_KEY]: 'folder-auth' };
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        await openGroupRowMenu('ralph-session-body');
        await act(async () => { fireEvent.click(menuItemByLabel('Remove from folder')); });

        expect(setGroupFolder).toHaveBeenCalledWith('ws-test', 'ralph-session', SESSION_ID, null);
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('0');
    });

    it('offers no "Remove from folder" for a group that is not filed', async () => {
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });
        const menu = await openGroupRowMenu('ralph-session-body');
        expect(menu.textContent).toContain('Move to folder');
        expect(menu.textContent).not.toContain('Remove from folder');
    });

    it('files a for-each run as a group too', async () => {
        await renderPane({
            history: [makeForEachChild()],
            forEachRuns: [makeForEachRunSummary()],
        });

        await openGroupRowMenu('for-each-run-body');
        const panel = await openMoveSubmenu();
        await act(async () => { fireEvent.click(submenuItemByLabel(panel, 'Auth rewrite')); });

        expect(setGroupFolder).toHaveBeenCalledWith('ws-test', 'for-each-run', FOR_EACH_RUN_ID, 'folder-auth');
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
    });

    it('files the group into a folder created from "+ New folder…"', async () => {
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        await openGroupRowMenu('ralph-session-body');
        const panel = await openMoveSubmenu();
        await act(async () => { fireEvent.click(submenuItemByLabel(panel, '+ New folder')); });

        const input = screen.getByTestId('chat-folder-name-input') as HTMLInputElement;
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Group work' } });
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        expect(createChatFolder).toHaveBeenCalled();
        expect(setGroupFolder).toHaveBeenCalledWith('ws-test', 'ralph-session', SESSION_ID, 'folder-new');
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
    });
});

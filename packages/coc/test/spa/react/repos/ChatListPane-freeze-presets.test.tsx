/**
 * ChatListPane — per-task "Freeze for…" preset submenu (AC-03).
 *
 * The plain "Freeze" item stays indefinite; the submenu holds a task for a
 * fixed number of hours. The real `ContextMenu` is used so the submenu
 * behaves exactly as shipped.
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

const freeze = vi.fn(async () => ({ frozen: true }));
const unfreeze = vi.fn(async () => ({ unfrozen: true }));
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
        queue: {
            freeze: (...args: any[]) => (freeze as any)(...args),
            unfreeze: (...args: any[]) => (unfreeze as any)(...args),
        },
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

const noopHandler = () => () => {};
vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop', () => ({
    useQueueDragDrop: () => ({
        draggedTaskId: null,
        dropTargetIndex: null,
        dropPosition: null,
        createDragStartHandler: noopHandler,
        createDragEndHandler: noopHandler,
        createDragOverHandler: noopHandler,
        createDragEnterHandler: noopHandler,
        createDragLeaveHandler: noopHandler,
        createDropHandler: noopHandler,
    }),
}));

vi.mock('../../../../src/server/spa/client/react/queue/hooks/useQueueTouchDragDrop', () => ({
    useQueueTouchDragDrop: () => ({
        draggedTaskId: null,
        dropTargetIndex: null,
        dropPosition: null,
        createTouchStartHandler: noopHandler,
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

const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;

function makeQueuedTask(overrides: Record<string, any> = {}): any {
    return {
        id: 'q-1',
        type: 'chat',
        status: 'queued',
        priority: 'normal',
        displayName: 'Queued chat',
        createdAt: NOW - 1000,
        payload: { mode: 'ask', prompt: 'hi' },
        config: {},
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

async function openTaskMenu(taskId: string) {
    const row = document.querySelector(`[data-task-id="${taskId}"]`);
    if (!row) {throw new Error(`No row for task ${taskId}`);}
    await act(async () => { fireEvent.contextMenu(row); });
    return screen.getByTestId('context-menu');
}

function menuItemByLabel(label: string): HTMLElement {
    const menu = screen.getByTestId('context-menu');
    const match = [...menu.querySelectorAll('button')].find(b => b.textContent?.includes(label));
    if (!match) {throw new Error(`No menu item labelled "${label}" — saw: ${menu.textContent}`);}
    return match as HTMLElement;
}

async function openFreezeSubmenu() {
    const parent = menuItemByLabel('Freeze for');
    await act(async () => { fireEvent.click(parent); });
    const panel = parent.closest('[data-testid^="context-menu-item-"]')
        ?.querySelector('[data-submenu-panel="true"]');
    if (!panel) {throw new Error('Freeze-for submenu did not open');}
    return panel as HTMLElement;
}

describe('ChatListPane — timed freeze presets (AC-03)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockGroupFolders = {};
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
    });

    it('offers every preset under "Freeze for…" alongside the indefinite Freeze', async () => {
        await renderPane({ queued: [makeQueuedTask()] });

        await openTaskMenu('q-1');
        const panel = await openFreezeSubmenu();
        const labels = [...panel.querySelectorAll('button')].map(b => b.textContent?.trim());
        for (const hours of [1, 2, 4, 8, 24]) {
            expect(labels.some(l => l?.includes(`${hours}h`))).toBe(true);
        }
    });

    it('freezes for the chosen number of hours', async () => {
        await renderPane({ queued: [makeQueuedTask()] });

        await openTaskMenu('q-1');
        const panel = await openFreezeSubmenu();
        const four = [...panel.querySelectorAll('button')].find(b => b.textContent?.trim().includes('4h'))!;
        await act(async () => { fireEvent.click(four); });

        expect(freeze).toHaveBeenCalledWith('q-1', { durationHours: 4 });
    });

    it('plain "Freeze" still freezes indefinitely', async () => {
        await renderPane({ queued: [makeQueuedTask()] });

        await openTaskMenu('q-1');
        const plain = [...screen.getByTestId('context-menu').querySelectorAll('button')]
            .find(b => b.textContent?.trim().replace(/^❄\s*/, '') === 'Freeze')!;
        await act(async () => { fireEvent.click(plain); });

        expect(freeze).toHaveBeenCalledWith('q-1', undefined);
    });

    it('offers Unfreeze and no preset submenu for an already-frozen task', async () => {
        await renderPane({ queued: [makeQueuedTask({ frozen: true, frozenUntil: NOW + HOUR_MS })] });

        const menu = await openTaskMenu('q-1');
        expect(menu.textContent).toContain('Unfreeze');
        expect(menu.textContent).not.toContain('Freeze for');
    });

    it('shows remaining time on the badge for a timed freeze', async () => {
        await renderPane({ queued: [makeQueuedTask({ frozen: true, frozenUntil: Date.now() + 3 * HOUR_MS })] });

        const row = document.querySelector('[data-task-id="q-1"]')!;
        expect(row.textContent).toContain('3h');
        expect(row.querySelector('[title="Frozen 3h"]')).not.toBeNull();
    });

    it('shows the plain frozen badge for an indefinite freeze', async () => {
        await renderPane({ queued: [makeQueuedTask({ frozen: true })] });

        const row = document.querySelector('[data-task-id="q-1"]')!;
        expect(row.querySelector('[title="Frozen"]')).not.toBeNull();
    });
});

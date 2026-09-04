/**
 * ChatListPane — chat-row layout around the folder chip.
 *
 * Two contracts live here:
 *  - The row grid has exactly four columns, so the optional folder chip must
 *    share the trailing column with the timestamp. A fifth direct grid child
 *    would auto-place the timestamp onto an implicit second row at column 1,
 *    which overflows the fixed-height row and paints over the row below.
 *  - A row rendered underneath its own folder never shows a chip naming that
 *    folder — including a spawned-tree ROOT, which renders at depth 0 and is
 *    therefore not a "group child".
 *
 * `utils/config` is deliberately NOT mocked so the real feature-flag read path
 * runs via `applyRuntimeConfigPatch`.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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
// `"<type>:<groupId>" -> folderId` — how a *group* (here a spawned tree) is filed.
let mockGroupFolders: Record<string, string> = {};

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: {
            listChatFolders: (...args: any[]) => listChatFolders(...(args as [])),
            listGroupFolders: async () => ({ groups: mockGroupFolders }),
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

/** The one grid child that holds the folder chip and the timestamp. */
function trailingCell(row: Element): Element {
    return row.children[row.children.length - 1];
}

describe('ChatListPane — folder chip does not break the row grid', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockGroupFolders = {};
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
    });

    it('keeps a chipped row at four direct grid children, with the chip beside the timestamp', async () => {
        mockProcesses = [{ id: 'proc-run', folderId: 'folder-auth' }];
        await renderPane({
            running: [makeChat({ id: 'proc-run', status: 'running', displayName: 'fix flaky e2e shard', title: 'fix flaky e2e shard' })],
        });

        const chip = screen.getByTestId('chat-folder-chip');
        const row = chip.closest('.chat-row')!;
        expect(row).not.toBeNull();

        // The template is still four columns; the chip did not widen it.
        expect(row.className).toContain('grid-cols-[10px_20px_minmax(0,1fr)_auto]');
        // …so there must be exactly four direct children. A fifth would wrap the
        // timestamp onto an implicit second grid row at the far left.
        expect(row.children).toHaveLength(4);

        // Chip and timestamp live together in the trailing column, chip first.
        const cell = trailingCell(row);
        expect(cell.contains(chip)).toBe(true);
        const when = row.querySelector('.chat-row-when')!;
        expect(when).not.toBeNull();
        expect(cell.contains(when)).toBe(true);
        expect(cell.firstElementChild).toBe(chip);
    });

    it('lays out an unchipped row exactly the same way, so the fix did not shift ordinary rows', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-b', displayName: 'Quick Open tie-break', title: 'Quick Open tie-break' })] });

        expect(screen.queryByTestId('chat-folder-chip')).toBeNull();
        const row = document.querySelector('.chat-row')!;
        expect(row.className).toContain('grid-cols-[10px_20px_minmax(0,1fr)_auto]');
        expect(row.children).toHaveLength(4);
        expect(trailingCell(row).contains(row.querySelector('.chat-row-when')!)).toBe(true);
    });
});

describe('ChatListPane — no redundant chip on a row inside its own folder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockGroupFolders = {};
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true });
    });

    /**
     * A running spawned-tree root filed into a folder. The root renders at
     * depth 0 inside the folder, so `isGroupChild` is false for it — the bug
     * this guards is exactly that.
     */
    async function renderFiledSpawnedTree() {
        mockGroupFolders = { 'spawned-tree:proc-root': 'folder-auth' };
        return renderPane({
            running: [makeChat({
                id: 'proc-root',
                processId: 'proc-root',
                status: 'running',
                displayName: 'Submit Ralph commits as PR',
                title: 'Submit Ralph commits as PR',
            })],
            history: [makeChat({
                id: 'proc-child',
                processId: 'proc-child',
                parentProcessId: 'proc-root',
                displayName: 'spawned follow-up',
                title: 'spawned follow-up',
            })],
        });
    }

    it('renders a filed spawned tree under its folder with no folder chip anywhere in it', async () => {
        await renderFiledSpawnedTree();

        const children = screen.getByTestId('chat-folder-children');
        expect(children.textContent).toContain('Submit Ralph commits as PR');
        expect(children.textContent).toContain('spawned follow-up');
        // The root is running, which is what used to earn it a chip.
        expect(children.querySelectorAll('[data-testid="chat-folder-chip"]')).toHaveLength(0);
    });

    it('keeps every row of a filed spawned tree inside the four-column grid', async () => {
        await renderFiledSpawnedTree();

        const rows = screen.getByTestId('chat-folder-children').querySelectorAll('.chat-row');
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.children).toHaveLength(4);
        }
    });

    it('still chips a running row in the Running section, where the chip is the only clue to where it lives', async () => {
        mockProcesses = [{ id: 'proc-run', folderId: 'folder-auth' }];
        await renderPane({
            running: [makeChat({ id: 'proc-run', status: 'running', displayName: 'fix flaky e2e shard', title: 'fix flaky e2e shard' })],
        });

        const chip = screen.getByTestId('chat-folder-chip');
        expect(chip.getAttribute('data-folder-name')).toBe('Auth rewrite');
        expect(document.querySelector('[data-section="running"]')!.contains(chip)).toBe(true);
    });

    // The search-flattened chip is covered by `ChatListPane-folder-search.test.tsx`.
});

/**
 * ChatListPane — a whole chat *group* filed into a folder (AC-02/AC-05/AC-06).
 *
 * `ChatListPane-folders.test.tsx` covers a single chat's membership; this suite
 * is the group case: membership is keyed on `"<type>:<groupId>"` in the
 * server-side sidecar, so the group row renders inside the folder, counts as
 * one member, leaves its date bucket, and adopts children that arrive after the
 * move without any extra write.
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
];

const listChatFolders = vi.fn(async () => ({ folders: FOLDERS }));
/** `"<type>:<groupId>" -> folderId` — the group sidecar, not per-child rows. */
let mockGroupFolders: Record<string, string> = {};
const listGroupFolders = vi.fn(async () => ({ groups: mockGroupFolders, assignments: [] }));

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: {
            listChatFolders: (...args: any[]) => listChatFolders(...(args as [])),
            listGroupFolders: (...args: any[]) => listGroupFolders(...(args as [])),
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

describe('ChatListPane — a chat group filed into a folder', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockGroupFolders = {};
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true, ralphEnabled: true });
    });

    it('renders a filed ralph session inside the folder, counted as one member', async () => {
        mockGroupFolders = { [GROUP_KEY]: 'folder-auth' };
        await renderPane({
            history: [
                makeRalphIteration(1),
                makeRalphIteration(2),
                makeRalphIteration(3),
                makeStandaloneChat('std-1', 'Quick Open tie-break'),
            ],
        });

        // Three iterations, but the folder holds one thing: the session.
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('1');
        const children = screen.getByTestId('chat-folder-children');
        expect(children.querySelectorAll('[data-testid="ralph-session-row"]')).toHaveLength(1);

        // …and the session is gone from Today, where the unfiled chat still sits.
        const today = document.querySelector('[data-section="completed-today"]')!;
        expect(today.textContent).toContain('Quick Open tie-break');
        expect(today.querySelector('[data-testid="ralph-session-row"]')).toBeNull();
    });

    it('leaves an unfiled group in its date bucket', async () => {
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        expect(screen.getByTestId('chat-folder-count').textContent).toBe('0');
        const today = document.querySelector('[data-section="completed-today"]')!;
        expect(today.querySelector('[data-testid="ralph-session-row"]')).not.toBeNull();
    });

    it('adopts an iteration enqueued after the move, with no extra write (AC-05)', async () => {
        mockGroupFolders = { [GROUP_KEY]: 'folder-auth' };
        const history = [makeRalphIteration(1), makeRalphIteration(2)];
        const { rerender } = await renderPane({ history });

        // A later iteration arrives; nothing is written for it.
        const late = makeRalphIteration(3, 500);
        await act(async () => {
            rerender(<ChatListPane {...defaultProps} history={[...history, late]} />);
        });

        // The map was read once, at mount — the late child triggered no write
        // and no re-read, because membership is keyed on the group.
        expect(listGroupFolders).toHaveBeenCalledTimes(1);
        const children = screen.getByTestId('chat-folder-children');
        expect(children.querySelectorAll('[data-testid="ralph-session-row"]')).toHaveLength(1);
        // The session inside the folder now spans three iterations, not two.
        expect(children.textContent).toContain('3 iter');
        // Nothing about the new iteration leaked into a date bucket.
        const today = document.querySelector('[data-section="completed-today"]');
        expect(today?.querySelector('[data-testid="ralph-session-row"]') ?? null).toBeNull();
        expect(today?.textContent ?? '').not.toContain('Ralph iteration 3');
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('1');
    });

    it("lets the group's folder win over a child's own membership, once (AC-06)", async () => {
        mockGroupFolders = { [GROUP_KEY]: 'folder-auth' };
        // Iteration 2 was filed to the *other* folder before the group moved.
        mockProcesses = [{ id: `ralph-${SESSION_ID}-2`, folderId: 'folder-perf' }];
        listChatFolders.mockResolvedValue({
            folders: [...FOLDERS, {
                id: 'folder-perf',
                name: 'Perf work',
                color: 'blue',
                sortIndex: 1,
                createdAt: '2026-08-26T00:00:00.000Z',
                updatedAt: '2026-08-26T00:00:00.000Z',
            }],
        });

        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        expect(screen.getAllByTestId('chat-folder')).toHaveLength(2);
        // The group's folder holds the session; the child's old folder is empty.
        const counts = screen.getAllByTestId('chat-folder-count').map(el => el.textContent);
        expect(counts).toEqual(['1', '0']);
        expect(screen.getAllByTestId('chat-folder-empty')).toHaveLength(1);
        // The session renders exactly once across the whole list — the child's
        // stale membership never splits the group across two folders.
        expect(document.querySelectorAll('[data-testid="ralph-session-row"]')).toHaveLength(1);
        const filed = screen.getAllByTestId('chat-folder-children');
        expect(filed).toHaveLength(1);
        expect(filed[0].textContent).toContain('2 iter');
    });
});

/**
 * ChatListPane — dragging a whole chat *group* row onto a folder (AC-04).
 *
 * The group row writes the folder-move MIME onto the SAME gesture that already
 * carries its session context, tagged with the group. Dropping it on a folder
 * therefore files the group with ONE PATCH against `"<type>:<groupId>"` — never
 * the per-child batch — and a drop on the folder it already lives in writes
 * nothing at all.
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

/** A DataTransfer stand-in shared across dragstart → dragover → drop. */
function makeDataTransfer(): any {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
        get types() { return [...store.keys()]; },
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
        setDragImage() { /* no-op */ },
    };
}

/** Drag the row carrying `testid` onto the first folder row. */
async function dragRowOntoFolder(testid: string) {
    const dataTransfer = makeDataTransfer();
    const row = screen.getAllByTestId(testid)[0];
    await act(async () => { fireEvent.dragStart(row, { dataTransfer }); });
    const folderRow = screen.getAllByTestId('chat-folder-row')[0];
    await act(async () => {
        fireEvent.dragOver(folderRow, { dataTransfer, clientY: 10 });
        fireEvent.drop(folderRow, { dataTransfer });
    });
    return dataTransfer;
}

describe('ChatListPane — drag a chat group onto a folder (AC-04)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockGroupFolders = {};
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        setGroupFolder.mockResolvedValue({ group: null } as any);
        applyRuntimeConfigPatch({ chatFoldersEnabled: true, ralphEnabled: true, forEachEnabled: true });
    });

    it('files a for-each run with one group PATCH when dropped on a folder', async () => {
        await renderPane({
            history: [makeForEachChild()],
            forEachRuns: [makeForEachRunSummary()],
        });

        await dragRowOntoFolder('for-each-run-body');

        expect(setGroupFolder).toHaveBeenCalledTimes(1);
        expect(setGroupFolder).toHaveBeenCalledWith('ws-test', 'for-each-run', FOR_EACH_RUN_ID, 'folder-auth');
        // The children are never written — that is what makes AC-05 work.
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        expect(setProcessFolder).not.toHaveBeenCalled();

        // …and the row moved optimistically, counting as ONE member.
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('1');
        const children = screen.getByTestId('chat-folder-children');
        expect(children.querySelectorAll('[data-testid="for-each-run-row"]')).toHaveLength(1);
    });

    it('writes the group flavour alongside the session-context payload on a ralph row', async () => {
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        const dataTransfer = await dragRowOntoFolder('ralph-session-body');

        // Both flavours rode the one gesture, so a composer drop still works.
        expect(dataTransfer.types).toContain('application/vnd.coc.chat-folder-move+json');
        const move = JSON.parse(dataTransfer.getData('application/vnd.coc.chat-folder-move+json'));
        expect(move.group).toEqual({ type: 'ralph-session', groupId: SESSION_ID });
        expect(dataTransfer.effectAllowed).toBe('copyMove');

        expect(setGroupFolder).toHaveBeenCalledWith('ws-test', 'ralph-session', SESSION_ID, 'folder-auth');
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
    });

    it('rolls the group back to its date bucket when the request is rejected', async () => {
        setGroupFolder.mockRejectedValue(new Error('boom') as never);
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        await dragRowOntoFolder('ralph-session-body');

        expect(setGroupFolder).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('0');
        const today = document.querySelector('[data-section="completed-today"]')!;
        expect(today.querySelector('[data-testid="ralph-session-row"]')).not.toBeNull();
    });

    it('writes nothing when the group is dropped on the folder it already lives in', async () => {
        mockGroupFolders = { [GROUP_KEY]: 'folder-auth' };
        await renderPane({ history: [makeRalphIteration(1), makeRalphIteration(2)] });

        await dragRowOntoFolder('ralph-session-body');

        expect(setGroupFolder).not.toHaveBeenCalled();
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        expect(screen.getByTestId('chat-folder-count').textContent).toBe('1');
    });

    it('leaves a plain chat drag on the per-chat batch path', async () => {
        mockProcesses = [{ id: 'chat-loose', folderId: null }];
        await renderPane({ history: [makeStandaloneChat('chat-loose', 'Loose chat')] });

        const dataTransfer = await dragRowOntoFolder('history-task-row');

        const move = JSON.parse(dataTransfer.getData('application/vnd.coc.chat-folder-move+json'));
        expect(move.group).toBeUndefined();
        expect(setGroupFolder).not.toHaveBeenCalled();
        expect(setProcessFolder.mock.calls.length + setProcessFolderBatch.mock.calls.length).toBe(1);
    });
});

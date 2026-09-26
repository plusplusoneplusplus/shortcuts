/**
 * ChatListPane — drag a pinned entry to a new slot in the Pinned section.
 *
 * The reorder rides the existing row drag (one more MIME), so this suite also
 * pins the invariants that keep the other drags intact: a folder-move drag
 * from an unpinned row is ignored by pinned rows, a multi-selection never
 * reorders, and nothing is wired when `onReorderPins` is absent.
 *
 * @vitest-environment jsdom
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

// A remote SSH clone's server: reached only through `getCocClientFor(baseUrl)`
// once the clone registry maps the workspace to its forwarded origin.
const remoteListChatFolders = vi.fn(async () => ({ folders: [] as any[] }));
const remoteSummaries = vi.fn(async () => ({ summaries: [] as any[] }));
const remoteSetProcessFolder = vi.fn(async (id: string, folderId: string | null) => ({ id, folderId }));
const remoteSetProcessFolderBatch = vi.fn(async (ids: string[], folderId: string | null) => ({ updated: ids, folderId }));

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
    getCocClientFor: (_baseUrl?: string) => ({
        crons: { listAll: vi.fn().mockResolvedValue([]) },
        processes: {
            listChatFolders: (...args: any[]) => (remoteListChatFolders as any)(...args),
            summaries: (...args: any[]) => (remoteSummaries as any)(...args),
            setProcessFolder: (...args: any[]) => (remoteSetProcessFolder as any)(...args),
            setProcessFolderBatch: (...args: any[]) => (remoteSetProcessFolderBatch as any)(...args),
        },
    }),
    toSpaCocRequestOptions: (options?: unknown) => options ?? {},
    translateSpaCocClientError: (error: unknown) => { throw error; },
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

let mockPinnedChatIds = new Set<string>();
vi.mock('../../../../src/server/spa/client/react/contexts/ChatPreferencesContext', () => ({
    // Real key names — the context exposes pinChat/archiveChats and
    // ChatListPane renames them on destructure. Getting these wrong silently
    // drops Pin and Archive from the menu, which is what this suite orders
    // "Move to folder" against.
    useChatPrefs: () => ({
        pinnedChatIds: mockPinnedChatIds,
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
import { CHAT_FOLDER_MOVE_MIME } from '../../../../src/server/spa/client/react/features/chat/chat-folder-drag';
import { PINNED_REORDER_MIME } from '../../../../src/server/spa/client/react/features/chat/pinned-reorder-drag';

function makeDataTransfer(): any {
    const store = new Map<string, string>();
    return {
        effectAllowed: 'uninitialized',
        dropEffect: 'none',
        setDragImage: vi.fn(),
        get types() { return [...store.keys()]; },
        setData(format: string, data: string) { store.set(format, data); },
        getData(format: string) { return store.get(format) ?? ''; },
    };
}

const NOW = Date.now();

function makeChat(id: string, title: string, pinnedAt?: string): any {
    return {
        id,
        type: 'chat',
        status: 'completed',
        displayName: title,
        title,
        startedAt: new Date(NOW - 60_000).toISOString(),
        lastActivityAt: NOW - 60_000,
        payload: { mode: 'ask' },
        ...(pinnedAt ? { pinnedAt } : {}),
    };
}

const PINNED = [
    makeChat('proc-a', 'alpha chat', '2026-01-03T00:00:00.000Z'),
    makeChat('proc-b', 'beta chat', '2026-01-02T00:00:00.000Z'),
    makeChat('proc-c', 'gamma chat', '2026-01-01T00:00:00.000Z'),
];

const defaultProps = {
    running: [],
    queued: [],
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
        utils = render(<ChatListPane {...defaultProps} history={PINNED} {...props} />);
    });
    return utils!;
}

function pinnedSection(): HTMLElement {
    const node = document.querySelector('[data-section="pinned"]');
    if (!node) throw new Error('No pinned section');
    return node as HTMLElement;
}

function pinnedEntry(key: string): HTMLElement {
    const node = pinnedSection().querySelector(`[data-pinned-key="${key}"]`);
    if (!node) throw new Error(`No pinned entry "${key}"`);
    return node as HTMLElement;
}

function rowByTitle(title: string): HTMLElement {
    const row = [...screen.getAllByTestId('history-task-row')].find(r => r.textContent?.includes(title));
    if (!row) throw new Error(`No row titled "${title}"`);
    return row;
}

function withBox(element: HTMLElement, top: number, height = 24): HTMLElement {
    element.getBoundingClientRect = () => ({
        top, height, bottom: top + height, left: 0, right: 200, width: 200, x: 0, y: top,
        toJSON: () => ({}),
    }) as DOMRect;
    return element;
}

async function fireDrag(type: string, target: HTMLElement, dataTransfer: any, clientY = 0): Promise<void> {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(event, 'clientY', { value: clientY });
    await act(async () => { fireEvent(target, event); });
}

async function startDrag(target: HTMLElement): Promise<any> {
    const dataTransfer = makeDataTransfer();
    await act(async () => { fireEvent.dragStart(target, { dataTransfer }); });
    return dataTransfer;
}

const chatKeys = (entries: any[]) => entries.map(e => (e.kind === 'chat' ? e.id : `${e.type}:${e.groupId}`));

describe.each([
    ['Chats tab', 'chats'],
    ['Activity', undefined],
])('ChatListPane — pinned reorder drag (%s)', (_label, activeTab) => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        mockPinnedChatIds = new Set(['proc-a', 'proc-b', 'proc-c']);
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        applyRuntimeConfigPatch({ chatFoldersEnabled: true, sessionContextAttachmentsEnabled: true, ralphEnabled: false });
    });

    afterEach(() => { cleanup(); });

    it('dragging the bottom pinned row onto the top row\'s upper half moves it first', async () => {
        const onReorderPins = vi.fn();
        await renderPane({ activeTab, onReorderPins });

        const dataTransfer = await startDrag(rowByTitle('gamma chat'));
        expect(dataTransfer.types).toContain(PINNED_REORDER_MIME);
        // Folder filing still rides the same gesture.
        expect(dataTransfer.types).toContain(CHAT_FOLDER_MOVE_MIME);
        expect(dataTransfer.effectAllowed).toBe('copyMove');

        const target = withBox(pinnedEntry('proc-a'), 100);
        await fireDrag('dragover', target, dataTransfer, 104);
        expect(target.getAttribute('data-pinned-drop')).toBe('above');
        expect(pinnedEntry('proc-c').getAttribute('data-pinned-dragging')).toBe('true');
        expect(dataTransfer.dropEffect).toBe('move');

        await fireDrag('dragover', target, dataTransfer, 120);
        expect(target.getAttribute('data-pinned-drop')).toBe('below');

        await fireDrag('dragover', target, dataTransfer, 104);
        await fireDrag('drop', target, dataTransfer, 104);
        expect(onReorderPins).toHaveBeenCalledTimes(1);
        expect(chatKeys(onReorderPins.mock.calls[0][0])).toEqual(['proc-c', 'proc-a', 'proc-b']);
        expect(pinnedSection().querySelector('[data-pinned-drop]')).toBeNull();
    });

    it('a drop next to the row\'s own slot saves nothing', async () => {
        const onReorderPins = vi.fn();
        await renderPane({ activeTab, onReorderPins });
        const dataTransfer = await startDrag(rowByTitle('beta chat'));
        const target = withBox(pinnedEntry('proc-a'), 100);
        await fireDrag('dragover', target, dataTransfer, 120);
        await fireDrag('drop', target, dataTransfer, 120);
        expect(onReorderPins).not.toHaveBeenCalled();
    });

    it('ignores a folder-move-only drag from an unpinned row', async () => {
        const onReorderPins = vi.fn();
        await renderPane({ activeTab, onReorderPins, history: [...PINNED, makeChat('proc-x', 'loose chat')] });

        const dataTransfer = await startDrag(rowByTitle('loose chat'));
        expect(dataTransfer.types).toContain(CHAT_FOLDER_MOVE_MIME);
        expect(dataTransfer.types).not.toContain(PINNED_REORDER_MIME);

        const target = withBox(pinnedEntry('proc-a'), 100);
        await fireDrag('dragover', target, dataTransfer, 104);
        expect(target.getAttribute('data-pinned-drop')).toBeNull();
        await fireDrag('drop', target, dataTransfer, 104);
        expect(onReorderPins).not.toHaveBeenCalled();
    });

    it('a multi-selection drag does not write the pinned MIME', async () => {
        await renderPane({ activeTab, onReorderPins: vi.fn() });
        await act(async () => { fireEvent.click(rowByTitle('alpha chat'), { ctrlKey: true }); });
        await act(async () => { fireEvent.click(rowByTitle('beta chat'), { ctrlKey: true }); });

        const dataTransfer = await startDrag(rowByTitle('alpha chat'));
        expect(dataTransfer.types).not.toContain(PINNED_REORDER_MIME);
        expect(dataTransfer.types).toContain(CHAT_FOLDER_MOVE_MIME);
    });

    it('wires nothing when onReorderPins is absent', async () => {
        await renderPane({ activeTab });
        expect(pinnedSection().querySelector('[data-pinned-key]')).toBeNull();
        const dataTransfer = await startDrag(rowByTitle('gamma chat'));
        expect(dataTransfer.types).not.toContain(PINNED_REORDER_MIME);
    });

    it('a pinned Ralph group row is draggable and reorders with folders off', async () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: false, sessionContextAttachmentsEnabled: false, ralphEnabled: true });
        const ralph = {
            ...makeChat('ralph-1', 'Ralph iteration 1'),
            payload: { mode: 'ralph', context: { ralph: { sessionId: 'sess-1', phase: 'executing', currentIteration: 1 } } },
        };
        const onReorderPins = vi.fn();
        await renderPane({
            activeTab,
            onReorderPins,
            history: [...PINNED, ralph],
            groupPins: [{ type: 'ralph-session', groupId: 'sess-1', pinnedAt: '2025-12-31T00:00:00.000Z' }],
        });

        const groupEntry = pinnedEntry('ralph-session:sess-1');
        expect(groupEntry.getAttribute('draggable')).toBe('true');
        const dataTransfer = await startDrag(groupEntry);
        expect(dataTransfer.types).toContain(PINNED_REORDER_MIME);

        const target = withBox(pinnedEntry('proc-b'), 100);
        await fireDrag('dragover', target, dataTransfer, 104);
        await fireDrag('drop', target, dataTransfer, 104);
        expect(chatKeys(onReorderPins.mock.calls[0][0])).toEqual(['proc-a', 'ralph-session:sess-1', 'proc-b', 'proc-c']);
    });

    it('dragend clears the drop line', async () => {
        await renderPane({ activeTab, onReorderPins: vi.fn() });
        const dataTransfer = await startDrag(rowByTitle('gamma chat'));
        const target = withBox(pinnedEntry('proc-a'), 100);
        await fireDrag('dragover', target, dataTransfer, 104);
        expect(target.getAttribute('data-pinned-drop')).toBe('above');
        await act(async () => { fireEvent.dragEnd(rowByTitle('gamma chat'), { dataTransfer }); });
        expect(pinnedSection().querySelector('[data-pinned-drop]')).toBeNull();
    });

    it('shows a grip only on mobile, and a finger drag over another row reorders', async () => {
        const onReorderPins = vi.fn();
        await renderPane({ activeTab, onReorderPins });
        expect(screen.queryAllByTestId('pinned-reorder-grip')).toHaveLength(0);
        cleanup();

        await renderPane({ activeTab, onReorderPins, isMobile: true });
        const grips = pinnedSection().querySelectorAll('[data-testid="pinned-reorder-grip"]');
        expect(grips).toHaveLength(3);

        const target = withBox(pinnedEntry('proc-a'), 100);
        const original = document.elementFromPoint;
        document.elementFromPoint = () => target;
        try {
            const grip = pinnedEntry('proc-c').querySelector('[data-testid="pinned-reorder-grip"]') as HTMLElement;
            await act(async () => { fireEvent.touchStart(grip, { touches: [{ clientX: 5, clientY: 150 }] }); });
            await act(async () => { fireEvent.touchMove(document, { touches: [{ clientX: 5, clientY: 104 }] }); });
            expect(target.getAttribute('data-pinned-drop')).toBe('above');
            await act(async () => { fireEvent.touchEnd(document, { touches: [] }); });
        } finally {
            document.elementFromPoint = original;
        }
        expect(chatKeys(onReorderPins.mock.calls[0][0])).toEqual(['proc-c', 'proc-a', 'proc-b']);
    });
});

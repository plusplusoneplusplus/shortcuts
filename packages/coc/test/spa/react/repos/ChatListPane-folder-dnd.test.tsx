/**
 * ChatListPane — filing chats by drag and reordering folders (AC-07).
 *
 * The gesture is the one the list already had: a chat row drag. This suite
 * drives the new *targets* — a folder row, an expanded folder's body, the gap
 * between folder rows, and the date buckets that unfile — plus the two
 * invariants that make the feature safe to ship: a session-context drop into a
 * composer still works unchanged, and a queue reorder drag never lights up a
 * folder row.
 *
 * `useQueueDragDrop` is deliberately NOT mocked here: the queue's real handlers
 * are half of what is being asserted.
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
import {
    CHAT_FOLDER_MOVE_MIME,
    CHAT_FOLDER_REORDER_MIME,
} from '../../../../src/server/spa/client/react/features/chat/chat-folder-drag';
import { SESSION_CONTEXT_DRAG_MIME } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrag';
import { readSessionContextDropPayloads } from '../../../../src/server/spa/client/react/features/chat/sessionContextDrop';
import { QUEUE_DRAG_MIME } from '../../../../src/server/spa/client/react/queue/hooks/useQueueDragDrop';
import {
    registerCloneBaseUrls,
    resetCloneRegistryForTests,
} from '../../../../src/server/spa/client/react/repos/cloneRegistry';

/** A DataTransfer stand-in; jsdom ships no usable one. */
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

async function renderPane(props: Record<string, any> = {}) {
    const history = props.history ?? [makeChat({ id: 'proc-seed', title: 'seed chat' })];
    let utils: ReturnType<typeof render>;
    await act(async () => {
        utils = render(<ChatListPane {...defaultProps} {...props} history={history} />);
    });
    return utils!;
}

function rowByTitle(title: string): HTMLElement {
    const row = [...screen.getAllByTestId('history-task-row')].find(r => r.textContent?.includes(title));
    if (!row) {throw new Error(`No history row titled "${title}"`);}
    return row;
}

function folderById(folderId: string): HTMLElement {
    const node = document.querySelector(`[data-testid="chat-folder"][data-folder-id="${folderId}"]`);
    if (!node) {throw new Error(`No folder row for "${folderId}"`);}
    return node as HTMLElement;
}

function folderRow(folderId: string): HTMLElement {
    return folderById(folderId).querySelector('[data-testid="chat-folder-row"]') as HTMLElement;
}

/** Give an element a real box so above/below splits are meaningful in jsdom. */
function withBox(element: HTMLElement, top: number, height = 24): HTMLElement {
    element.getBoundingClientRect = () => ({
        top, height, bottom: top + height, left: 0, right: 200, width: 200, x: 0, y: top,
        toJSON: () => ({}),
    }) as DOMRect;
    return element;
}

/** Start a drag on a chat row and return the DataTransfer it wrote. */
async function startChatDrag(title: string): Promise<any> {
    const dataTransfer = makeDataTransfer();
    await act(async () => { fireEvent.dragStart(rowByTitle(title), { dataTransfer }); });
    return dataTransfer;
}

/**
 * jsdom has no `DragEvent`, and Testing Library's fallback drops `clientY` —
 * which the above/below split depends on. Build the native event by hand and
 * let React read `clientY` and `dataTransfer` straight off it.
 */
async function fireDrag(type: string, target: HTMLElement, dataTransfer: any, clientY = 0): Promise<void> {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(event, 'clientY', { value: clientY });
    await act(async () => { fireEvent(target, event); });
}

async function dragOver(target: HTMLElement, dataTransfer: any, clientY = 0): Promise<void> {
    await fireDrag('dragover', target, dataTransfer, clientY);
}

async function drop(target: HTMLElement, dataTransfer: any, clientY = 0): Promise<void> {
    await fireDrag('drop', target, dataTransfer, clientY);
}

/** The Activity list's unfiled region — its date-bucket equivalent. */
function unfiledRegion(): HTMLElement {
    const node = document.querySelector('[data-section="completed"]');
    if (!node) {throw new Error('No unfiled (completed) section rendered');}
    return node as HTMLElement;
}

describe('ChatListPane — folder drag and drop (AC-07)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        mockProcesses = [];
        listChatFolders.mockResolvedValue({ folders: FOLDERS });
        // Both flags on: the point of AC-07 is that ONE gesture serves both.
        applyRuntimeConfigPatch({ chatFoldersEnabled: true, sessionContextAttachmentsEnabled: true });
        // A drag image is parked on <body> until `dragend`; a test that ends
        // mid-drag would otherwise leak it into the next one.
        document.querySelectorAll('[data-testid="chat-folder-drag-image"]').forEach(node => node.remove());
    });

    afterEach(() => {
        cleanup();
    });

    // ── The drag source ─────────────────────────────────────────────────────

    it('writes the folder-move MIME alongside session context on one gesture', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');

        expect(dataTransfer.types).toContain(CHAT_FOLDER_MOVE_MIME);
        expect(dataTransfer.types).toContain(SESSION_CONTEXT_DRAG_MIME);
        // Either meaning is still possible; the drop target decides.
        expect(dataTransfer.effectAllowed).toBe('copyMove');
    });

    it('leaves the session-context payload a composer reads completely unchanged', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');

        const payloads = readSessionContextDropPayloads(dataTransfer);
        expect(payloads).toHaveLength(1);
        expect(payloads[0]).toMatchObject({ sourceProcessId: 'proc-a', sourceWorkspaceId: 'ws-test' });
    });

    it('carries no folder MIME when the flag is off', async () => {
        applyRuntimeConfigPatch({ chatFoldersEnabled: false, sessionContextAttachmentsEnabled: true });
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');

        expect(dataTransfer.types).not.toContain(CHAT_FOLDER_MOVE_MIME);
        expect(document.querySelector('[data-section="folders"]')).toBeNull();
    });

    it('carries the whole multi-selection when the drag starts inside one', async () => {
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
                makeChat({ id: 'proc-b', title: 'beta chat' }),
            ],
        });
        await act(async () => { fireEvent.click(rowByTitle('alpha chat'), { ctrlKey: true }); });
        await act(async () => { fireEvent.click(rowByTitle('beta chat'), { ctrlKey: true }); });

        const dataTransfer = await startChatDrag('alpha chat');
        const payload = JSON.parse(dataTransfer.getData(CHAT_FOLDER_MOVE_MIME));
        expect(payload.processIds).toHaveLength(2);
        expect(payload.processIds).toContain('proc-a');
        expect(payload.processIds).toContain('proc-b');
    });

    // ── Dropping on a folder ────────────────────────────────────────────────

    it('drop on a folder row files the chat there', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');
        await drop(folderRow('folder-auth'), dataTransfer);

        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-auth');
    });

    it('highlights the folder and names it while the pointer is over it', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');
        await dragOver(folderRow('folder-auth'), dataTransfer);

        expect(folderById('folder-auth').getAttribute('data-drop-mode')).toBe('into');
        expect(screen.getByTestId('chat-folder-drop-hint').textContent).toContain('Auth rewrite');
        expect(dataTransfer.dropEffect).toBe('move');
    });

    it('a drop on a collapsed folder files the chat and leaves it collapsed', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        await act(async () => { fireEvent.click(folderRow('folder-auth')); });
        expect(folderById('folder-auth').getAttribute('data-expanded')).toBe('false');

        const dataTransfer = await startChatDrag('alpha chat');
        await drop(folderRow('folder-auth'), dataTransfer);

        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-auth');
        expect(folderById('folder-auth').getAttribute('data-expanded')).toBe('false');
    });

    it('drop anywhere in an expanded folder body files the chat there', async () => {
        mockProcesses = [{ id: 'proc-filed', folderId: 'folder-auth' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-filed', title: 'filed chat' }),
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
            ],
        });
        const dataTransfer = await startChatDrag('alpha chat');
        const body = folderById('folder-auth').querySelector('[data-testid="chat-folder-children"]') as HTMLElement;
        await drop(body, dataTransfer);

        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-auth');
    });

    it('drop into an empty folder’s dashed zone files the chat there', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');
        const zone = folderById('folder-perf').querySelector('[data-testid="chat-folder-empty"]') as HTMLElement;
        await drop(zone, dataTransfer);

        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-perf');
    });

    it('drop onto the folder the chat is already in issues no request', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });

        const row = folderById('folder-auth').querySelector('[data-testid="history-task-row"]') as HTMLElement;
        const dataTransfer = makeDataTransfer();
        await act(async () => { fireEvent.dragStart(row, { dataTransfer }); });
        await dragOver(folderRow('folder-auth'), dataTransfer);
        await drop(folderRow('folder-auth'), dataTransfer);

        expect(setProcessFolder).not.toHaveBeenCalled();
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        // Nor does it even offer itself as a target.
        expect(folderById('folder-auth').getAttribute('data-drop-mode')).toBeNull();
    });

    // ── Reordering folders ──────────────────────────────────────────────────

    it('dragging a folder below another reorders and persists both sortIndexes', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });

        const dataTransfer = makeDataTransfer();
        await act(async () => { fireEvent.dragStart(folderRow('folder-auth'), { dataTransfer }); });
        expect(dataTransfer.types).toContain(CHAT_FOLDER_REORDER_MIME);

        const target = withBox(folderRow('folder-perf'), 100);
        await drop(target, dataTransfer, 120);

        expect(updateChatFolder).toHaveBeenCalledWith('ws-test', 'folder-perf', { sortIndex: 0 });
        expect(updateChatFolder).toHaveBeenCalledWith('ws-test', 'folder-auth', { sortIndex: 1 });
    });

    it('shows an insertion line, not a row tint, while reordering', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });

        const dataTransfer = makeDataTransfer();
        await act(async () => { fireEvent.dragStart(folderRow('folder-auth'), { dataTransfer }); });
        await dragOver(withBox(folderRow('folder-perf'), 100), dataTransfer, 120);

        expect(folderById('folder-perf').getAttribute('data-drop-mode')).toBe('below');
        expect(document.querySelector('[data-testid="chat-folder-drop-hint"]')).toBeNull();
    });

    it('a folder dropped on itself changes nothing', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });

        const dataTransfer = makeDataTransfer();
        const row = withBox(folderRow('folder-auth'), 100);
        await act(async () => { fireEvent.dragStart(row, { dataTransfer }); });
        await dragOver(row, dataTransfer, 120);
        await drop(row, dataTransfer, 120);

        expect(folderById('folder-auth').getAttribute('data-drop-mode')).toBeNull();
        expect(updateChatFolder).not.toHaveBeenCalled();
    });

    it('a folder dropped into a folder body is refused — that would be nesting', async () => {
        mockProcesses = [{ id: 'proc-filed', folderId: 'folder-auth' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-filed', title: 'filed chat' }),
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
            ],
        });

        const dataTransfer = makeDataTransfer();
        await act(async () => { fireEvent.dragStart(folderRow('folder-perf'), { dataTransfer }); });
        const body = folderById('folder-auth').querySelector('[data-testid="chat-folder-children"]') as HTMLElement;
        await drop(body, dataTransfer);

        expect(updateChatFolder).not.toHaveBeenCalled();
    });

    // ── Unfiling ────────────────────────────────────────────────────────────

    it('dropping a filed chat on a date bucket removes it from its folder', async () => {
        mockProcesses = [{ id: 'proc-a', folderId: 'folder-auth' }];
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
                makeChat({ id: 'proc-b', title: 'beta chat' }),
            ],
        });

        const filedRow = folderById('folder-auth').querySelector('[data-testid="history-task-row"]') as HTMLElement;
        const dataTransfer = makeDataTransfer();
        await act(async () => { fireEvent.dragStart(filedRow, { dataTransfer }); });

        const bucket = unfiledRegion();
        await dragOver(bucket, dataTransfer);
        expect(bucket.getAttribute('data-drop-unfile')).toBe('true');
        await drop(bucket, dataTransfer);

        expect(setProcessFolder).toHaveBeenCalledWith('proc-a', null);
    });

    it('dropping an already-unfiled chat on a date bucket issues no request', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');

        const bucket = unfiledRegion();
        await dragOver(bucket, dataTransfer);
        expect(bucket.getAttribute('data-drop-unfile')).toBeNull();
        await drop(bucket, dataTransfer);

        expect(setProcessFolder).not.toHaveBeenCalled();
    });

    // ── Isolation from the queue's reorder drag ─────────────────────────────

    it('a queue reorder drag does not highlight a folder row', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });

        const dataTransfer = makeDataTransfer();
        dataTransfer.setData(QUEUE_DRAG_MIME, 'queued-1');
        await dragOver(folderRow('folder-auth'), dataTransfer);

        expect(folderById('folder-auth').getAttribute('data-drop-mode')).toBeNull();
        // The event is left untouched, so the queue's own target still sees it.
        expect(dataTransfer.dropEffect).toBe('none');
    });

    it('a queue reorder drag dropped on a folder row does not file anything', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });

        const dataTransfer = makeDataTransfer();
        dataTransfer.setData(QUEUE_DRAG_MIME, 'queued-1');
        await drop(folderRow('folder-auth'), dataTransfer);

        expect(setProcessFolder).not.toHaveBeenCalled();
        expect(setProcessFolderBatch).not.toHaveBeenCalled();
        expect(updateChatFolder).not.toHaveBeenCalled();
    });

    // ── Ending the gesture ──────────────────────────────────────────────────

    it('dragend clears every folder highlight', async () => {
        await renderPane({ history: [makeChat({ id: 'proc-a', title: 'alpha chat' })] });
        const dataTransfer = await startChatDrag('alpha chat');
        await dragOver(folderRow('folder-auth'), dataTransfer);
        expect(folderById('folder-auth').getAttribute('data-drop-mode')).toBe('into');

        await act(async () => { fireEvent.dragEnd(rowByTitle('alpha chat'), { dataTransfer }); });
        expect(folderById('folder-auth').getAttribute('data-drop-mode')).toBeNull();
    });

    it('leaves no drag image behind after the gesture ends', async () => {
        await renderPane({
            history: [
                makeChat({ id: 'proc-a', title: 'alpha chat' }),
                makeChat({ id: 'proc-b', title: 'beta chat' }),
            ],
        });
        await act(async () => { fireEvent.click(rowByTitle('alpha chat'), { ctrlKey: true }); });
        await act(async () => { fireEvent.click(rowByTitle('beta chat'), { ctrlKey: true }); });

        const dataTransfer = await startChatDrag('alpha chat');
        expect(dataTransfer.setDragImage).toHaveBeenCalled();
        expect(document.querySelectorAll('[data-testid="chat-folder-drag-image"]')).toHaveLength(1);

        await act(async () => { fireEvent.dragEnd(rowByTitle('alpha chat'), { dataTransfer }); });
        expect(document.querySelectorAll('[data-testid="chat-folder-drag-image"]')).toHaveLength(0);
    });

    // ── Remote SSH workspaces ───────────────────────────────────────────────
    // The regression this pins: folders rendered, the row dragged, the folder
    // highlighted — and nothing landed, because membership was read from the
    // page-origin summaries index that never holds a remote clone's processes.

    describe('remote SSH workspace', () => {
        const REMOTE_WS = 'ws-v2-remote';
        const REMOTE_URL = 'http://127.0.0.1:4321';

        beforeEach(() => {
            registerCloneBaseUrls([{ workspaceId: REMOTE_WS, baseUrl: REMOTE_URL }]);
            remoteListChatFolders.mockResolvedValue({ folders: FOLDERS });
            remoteSummaries.mockResolvedValue({ summaries: [] });
        });

        afterEach(() => {
            resetCloneRegistryForTests();
        });

        it('renders membership fetched from the remote server, not the page origin', async () => {
            remoteSummaries.mockResolvedValue({ summaries: [{ id: 'proc-filed', folderId: 'folder-auth' }] });
            await renderPane({
                workspaceId: REMOTE_WS,
                history: [makeChat({ id: 'proc-filed', title: 'filed chat' })],
            });

            expect(remoteSummaries).toHaveBeenCalledWith({ workspace: REMOTE_WS, limit: 5000 });
            expect(folderById('folder-auth').textContent).toContain('filed chat');
        });

        it('a drop on a folder writes to the remote server and visibly moves the row', async () => {
            await renderPane({
                workspaceId: REMOTE_WS,
                history: [makeChat({ id: 'proc-a', title: 'alpha chat' })],
            });
            expect(folderById('folder-auth').textContent).not.toContain('alpha chat');

            const dataTransfer = await startChatDrag('alpha chat');
            await drop(folderRow('folder-auth'), dataTransfer);

            expect(remoteSetProcessFolder).toHaveBeenCalledWith('proc-a', 'folder-auth');
            expect(setProcessFolder).not.toHaveBeenCalled();
            // The optimistic membership override files the row into the tree
            // immediately — the part that visibly failed before the fix.
            expect(folderById('folder-auth').textContent).toContain('alpha chat');
        });
    });
});

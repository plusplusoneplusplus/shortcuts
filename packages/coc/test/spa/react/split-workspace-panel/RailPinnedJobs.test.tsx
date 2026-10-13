/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CocClient, WorkspacePinnedEntry } from '@plusplusoneplusplus/coc-client';
import { SplitWorkspacePanel } from '../../../../src/server/spa/client/react/features/repo-detail/SplitWorkspacePanel';
import { splitWorkspaceLeftCollapsedStorageKey } from '../../../../src/server/spa/client/react/features/repo-detail/WorkspaceLeftCollapse';
import { RailPinnedJobs } from '../../../../src/server/spa/client/react/features/chat/RailPinnedJobs';
import { ChatPreferencesProvider, ChatPrefsSync, useChatPrefs } from '../../../../src/server/spa/client/react/contexts/ChatPreferencesContext';
import { WorkspaceOwnerContext } from '../../../../src/server/spa/client/react/repos/workspaceOwnerContext';
import { ToastProvider } from '../../../../src/server/spa/client/react/contexts/ToastContext';

vi.mock('../../../../src/server/spa/client/react/api/cocClient', () => ({
    getSpaCocClient: () => localClient,
    getCocClientFor: (baseUrl?: string) => {
        if (!baseUrl) return localClient;
        const owner = ownerClients.get(baseUrl);
        if (!owner) throw new Error('Unexpected owner');
        return owner;
    },
}));

vi.mock('../../../../src/server/spa/client/react/hooks/ui/useBreakpoint', () => ({
    useBreakpoint: () => ({ isMobile: false }),
}));
let excludedTypes: string[] = [];
vi.mock('../../../../src/server/spa/client/react/contexts/AppContext', async importOriginal => ({
    ...(await importOriginal<object>()),
    useApp: () => ({ state: { myWorkExcludedTypes: excludedTypes }, dispatch: vi.fn() }),
}));

const entry = (id: string, pinnedAt: string, overrides: Partial<WorkspacePinnedEntry> = {}): WorkspacePinnedEntry => ({
    id, type: 'chat', status: 'completed', title: `Server ${id}`, pinnedAt, ...overrides,
});
/** Loaded first-page history rows, as the chat list holds them. */
const historyRow = (id: string, pinnedAt?: string, overrides: Record<string, unknown> = {}) => ({
    id, type: 'chat', status: 'completed', customTitle: `Loaded ${id}`, pinnedAt, ...overrides,
});

let serverEntries: WorkspacePinnedEntry[];
let pinned: ReturnType<typeof vi.fn>;
let pinMutation: ReturnType<typeof vi.fn>;
const addToast = vi.fn();
const ownerClients = new Map<string, CocClient>();
function client(baseUrl?: string): CocClient {
    const result = {
        options: { baseUrl },
        workspaces: { pinned: (id: string) => pinned(id) },
        processes: { pin: vi.fn((...args: unknown[]) => pinMutation(...args)) },
    } as unknown as CocClient;
    if (baseUrl) ownerClients.set(baseUrl, result);
    return result;
}
const localClient = client();

function MainPinState() {
    const prefs = useChatPrefs();
    return <output data-testid="main-pin-state">{[...prefs.pinnedChatIds].join(',')}</output>;
}

interface PanelProps {
    history?: any[];
    running?: any[];
    routeId?: string;
    workspaceId?: string;
    cocClient?: CocClient;
    onOpen?: (task: any) => void;
    tab?: 'activity' | 'chats' | 'tasks';
    onRefreshReady?: (refresh: (() => Promise<void>) | null) => void;
    ownerAvailable?: boolean;
}
function panel({ history = [], running = [], routeId = 'ws-alpha', workspaceId = 'ws-alpha', cocClient = localClient, onOpen = vi.fn(), tab = 'activity', onRefreshReady, ownerAvailable }: PanelProps = {}) {
    return (
        <WorkspaceOwnerContext.Provider value={{ workspaceId, selectionId: routeId, baseUrl: cocClient.options?.baseUrl }}>
        <ToastProvider value={{ addToast, removeToast: vi.fn(), toasts: [] }}>
        <ChatPreferencesProvider workspaceId={workspaceId}>
            <ChatPrefsSync history={history} workspaceId={workspaceId} />
        <SplitWorkspacePanel workspaceId="ws-alpha" chatList={(
            <>
                <MainPinState />
                <div>Pinned and completed history</div>
            </>
        )} railShortcuts={(
            <RailPinnedJobs workspaceId={workspaceId} routeId={routeId} client={cocClient} running={running}
                history={history} scopeLabel="Local / Alpha" tab={tab} onOpen={onOpen} onRefreshReady={onRefreshReady}
                ownerAvailable={ownerAvailable} />
        )} gitList={<div>Git</div>} detail={<div>Detail</div>} />
        </ChatPreferencesProvider>
        </ToastProvider>
        </WorkspaceOwnerContext.Provider>
    );
}
async function flush(ms = 0) {
    await act(async () => { vi.advanceTimersByTime(ms); });
}
function tick(ms: number) {
    act(() => { vi.advanceTimersByTime(ms); });
}
const pin = () => screen.getByTestId('split-workspace-left-pinned');
function hover() {
    fireEvent.pointerEnter(pin(), { pointerType: 'mouse' });
}

beforeEach(() => {
    vi.useFakeTimers();
    excludedTypes = [];
    serverEntries = [
        entry('queue_a', '2026-10-03T00:00:00.000Z'),
        entry('queue_old', '2026-09-01T00:00:00.000Z', { title: 'Beyond the loaded page' }),
        entry('queue_run', '2026-10-02T00:00:00.000Z', { status: 'running' }),
    ];
    pinned = vi.fn(async () => ({ entries: serverEntries }));
    pinMutation = vi.fn(async (id: string) => { serverEntries = serverEntries.filter(row => row.id !== id); });
    vi.mocked(localClient.processes.pin).mockClear();
    ownerClients.clear();
    addToast.mockClear();
    localStorage.clear();
    localStorage.setItem(splitWorkspaceLeftCollapsedStorageKey('ws-alpha'), '1');
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
        readonly pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, init);
            this.pointerType = init.pointerType ?? 'mouse';
        }
    });
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});
afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('collapsed-rail pinned jobs', () => {
    it.each([
        ['local', 'ws-alpha', 'ws-alpha', undefined],
        ['group', 'group-alpha', 'group-alpha', undefined],
        ['remote', 'ws-alpha', 'remote:server-a:ws-alpha', 'http://server-a:4000'],
        ['remote group', 'group-alpha', 'remote:server-a:group-alpha', 'http://server-a:4000'],
    ])('unpins loaded and unloaded rows through the shared %s owner action without opening or expanding', async (_label, workspaceId, routeId, baseUrl) => {
        const cocClient = baseUrl ? client(baseUrl) : localClient;
        const onOpen = vi.fn();
        render(panel({ workspaceId, routeId, cocClient, onOpen, history: [historyRow('queue_a', '2026-10-03T00:00:00.000Z')] }));
        await flush();
        hover();
        tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Unpin job: Beyond the loaded page' }));
        await flush();
        expect(cocClient.processes.pin).toHaveBeenCalledWith('queue_old', false, { workspace: workspaceId });
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
        expect(screen.queryByRole('link', { name: 'Open job: Beyond the loaded page' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Unpin job: Loaded queue_a' }));
        await flush();
        expect(cocClient.processes.pin).toHaveBeenCalledWith('queue_a', false, { workspace: workspaceId });
        expect(screen.getByTestId('main-pin-state')).not.toHaveTextContent('queue_a');
        expect(pin()).toHaveAccessibleName('1 pinned job');
        expect(screen.getByRole('dialog')).toHaveTextContent('Pinned jobs (1)');
        expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
        expect(onOpen).not.toHaveBeenCalled();
        if (baseUrl) expect(localClient.processes.pin).not.toHaveBeenCalled();
    });

    it('uses the canonical process id for a running queue row and keeps Open available while unpinning', async () => {
        let finish!: () => void;
        pinMutation.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const view = render(panel({ running: [{ id: 'run', processId: 'queue_run', type: 'chat', status: 'running', customTitle: 'Live' }] }));
        await flush();
        hover();
        tick(200);
        const button = screen.getByRole('button', { name: 'Unpin job: Live' });
        act(() => button.focus());
        fireEvent.click(button);
        fireEvent.click(button);
        expect(pinMutation).toHaveBeenCalledTimes(1);
        expect(pinMutation).toHaveBeenCalledWith('queue_run', false, { workspace: 'ws-alpha' });
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('link', { name: 'Open job: Live' })).toBeTruthy();
        view.rerender(panel({ history: [historyRow('queue_run', '2026-10-02T00:00:00.000Z', { customTitle: 'Live' })] }));
        expect(button).toHaveFocus();
        await act(async () => { finish(); });
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
        expect(screen.queryByRole('button', { name: 'Unpin job: Live' })).toBeNull();
    });

    it('keeps a loaded row and keyboard focus pending, reports rejection, and allows retry', async () => {
        let reject!: (error: Error) => void;
        pinMutation.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
        render(panel({ history: [historyRow('queue_a', '2026-10-03T00:00:00.000Z')] }));
        await flush();
        act(() => pin().focus());
        const button = screen.getByRole('button', { name: 'Unpin job: Loaded queue_a' });
        act(() => button.focus());
        fireEvent.click(button);
        fireEvent.click(button);
        await flush(300);
        expect(pinMutation).toHaveBeenCalledTimes(1);
        expect(button).toHaveFocus();
        expect(pin()).toHaveAccessibleName('3 pinned jobs');
        await act(async () => { reject(new Error('Permission denied')); });
        expect(addToast).toHaveBeenCalledWith('Could not unpin job: Permission denied', 'error');
        expect(button).toHaveFocus();
        expect(button).toHaveAttribute('aria-disabled', 'false');
        expect(screen.getByTestId('main-pin-state')).toHaveTextContent('queue_a');
        fireEvent.click(button);
        await flush();
        expect(pinMutation).toHaveBeenCalledTimes(2);
        expect(screen.getByRole('link', { name: 'Open job: Server queue_run' })).toHaveFocus();
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
    });

    it('supports Enter/Space unpin, keeps arrow and Escape navigation, and focuses the rail after the last pin', async () => {
        serverEntries = [entry('queue_a', '2026-10-03T00:00:00Z'), entry('queue_b', '2026-10-02T00:00:00Z')];
        const onOpen = vi.fn();
        render(panel({ onOpen }));
        await flush();
        vi.useRealTimers();
        const user = userEvent.setup();
        act(() => pin().focus());
        await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown}');
        expect(screen.getByRole('button', { name: 'Unpin job: Server queue_a' })).toHaveFocus();
        await user.keyboard('{Enter}');
        expect(pin()).toHaveAccessibleName('1 pinned job');
        expect(screen.getByRole('link', { name: 'Open job: Server queue_b' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(pin()).toHaveFocus();
        expect(screen.queryByRole('dialog')).toBeNull();
        await user.keyboard('{ArrowRight}{ArrowDown}{ArrowDown} ');
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('split-workspace-left-pinned')).toBeNull();
        expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveFocus();
        expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('does not restore an unpinned row from an older in-flight pinned read', async () => {
        let refresh: (() => Promise<void>) | null = null;
        render(panel({ onRefreshReady: next => { refresh = next; } }));
        await flush();
        let finish!: (value: { entries: WorkspacePinnedEntry[] }) => void;
        const oldEntries = [...serverEntries];
        pinned.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        let read!: Promise<void>;
        act(() => { read = refresh!(); });
        hover();
        tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Unpin job: Beyond the loaded page' }));
        await flush();
        await act(async () => { finish({ entries: oldEntries }); await read; });
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
        expect(screen.queryByRole('link', { name: 'Open job: Beyond the loaded page' })).toBeNull();
    });

    it('retains an unloaded pending row when a pinned read omits it', async () => {
        let refresh: (() => Promise<void>) | null = null;
        let finish!: () => void;
        pinMutation.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        render(panel({ onRefreshReady: next => { refresh = next; } }));
        await flush();
        act(() => pin().focus());
        const button = screen.getByRole('button', { name: 'Unpin job: Beyond the loaded page' });
        act(() => button.focus());
        fireEvent.click(button);
        serverEntries = serverEntries.filter(row => row.id !== 'queue_old');
        await act(async () => { await refresh!(); });
        expect(button).toHaveFocus();
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(pin()).toHaveAccessibleName('3 pinned jobs');
        await act(async () => { finish(); });
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
        expect(screen.getByRole('link', { name: 'Open job: Server queue_run' })).toHaveFocus();
    });

    it('commits shared pin state after a history refresh during the request', async () => {
        let finish!: () => void;
        pinMutation.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const a = historyRow('queue_a', '2026-10-03T00:00:00Z');
        const view = render(panel({ history: [a] }));
        await flush();
        hover();
        tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Unpin job: Loaded queue_a' }));
        view.rerender(panel({ history: [{ ...a }] }));
        expect(screen.getByTestId('main-pin-state')).toHaveTextContent('queue_a');
        await act(async () => { finish(); });
        expect(screen.getByTestId('main-pin-state')).not.toHaveTextContent('queue_a');
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
    });

    it('Open retains its owner route and dismissal while an unpin is pending', async () => {
        let finish!: () => void;
        pinMutation.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const onOpen = vi.fn();
        render(panel({ routeId: 'remote:server-a:ws-alpha', cocClient: client('http://server-a:4000'), onOpen }));
        await flush();
        hover();
        tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Unpin job: Beyond the loaded page' }));
        const link = screen.getByRole('link', { name: 'Open job: Beyond the loaded page' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver-a%3Aws-alpha/activity/queue_old');
        fireEvent.click(link);
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'queue_old' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        await act(async () => { finish(); });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
        expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
    });

    it.each(['resolve', 'reject'])('ignores a late unpin %s after changing owners with the same workspace id', async outcome => {
        let finish!: () => void;
        let reject!: (error: Error) => void;
        pinMutation.mockImplementationOnce(() => new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; }));
        const history = [historyRow('queue_a', '2026-10-03T00:00:00Z')];
        const view = render(panel({ history }));
        await flush();
        hover();
        tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Unpin job: Loaded queue_a' }));
        const remoteHistory = [historyRow('queue_a')];
        view.rerender(panel({ history: remoteHistory, routeId: 'remote:server-b:ws-alpha', cocClient: client('http://server-b:4000') }));
        await flush();
        await act(async () => { outcome === 'resolve' ? finish() : reject(new Error('Old owner failure')); });
        expect(screen.getByTestId('main-pin-state')).not.toHaveTextContent('queue_a');
        expect(addToast).not.toHaveBeenCalled();
        expect(pin()).toHaveAccessibleName('2 pinned jobs');
    });

    it('does not mutate an unavailable owner', async () => {
        render(panel({ ownerAvailable: false }));
        await flush();
        expect(screen.queryByTestId('split-workspace-left-pinned')).toBeNull();
        expect(pinMutation).not.toHaveBeenCalled();
    });

    it('clears pending row state on an owner round-trip and ignores the earlier response', async () => {
        let finish!: () => void;
        pinMutation.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
        const view = render(panel());
        await flush();
        hover();
        tick(200);
        fireEvent.click(screen.getByRole('button', { name: 'Unpin job: Beyond the loaded page' }));
        view.rerender(panel({ routeId: 'remote:server-b:ws-alpha', cocClient: client('http://server-b:4000') }));
        await flush();
        view.rerender(panel());
        await flush();
        hover();
        tick(200);
        const button = screen.getByRole('button', { name: 'Unpin job: Beyond the loaded page' });
        expect(button).toHaveAttribute('aria-disabled', 'false');
        await act(async () => { finish(); });
        expect(pin()).toHaveAccessibleName('3 pinned jobs');
        expect(button).toHaveAttribute('aria-busy', 'false');
    });

    it('shares mode pills for unloaded pins and live rows without additional owner reads', async () => {
        serverEntries = [
            entry('queue_a', '2026-10-03T00:00:00.000Z', { mode: 'sentinel' }),
            entry('queue_old', '2026-09-01T00:00:00.000Z', { executionMode: 'ralph', mode: 'ask' }),
        ];
        const a = historyRow('queue_a', '2026-10-03T00:00:00.000Z', { mode: 'ask' });
        const view = render(panel({ history: [a] }));
        await flush();
        hover();
        tick(200);
        expect(screen.getAllByTestId('rail-job-mode').map(pill => pill.textContent?.trim())).toEqual(['Ask', 'Ralph']);
        const reads = pinned.mock.calls.length;
        view.rerender(panel({ history: [{ ...a, mode: 'autopilot' }] }));
        expect(screen.getAllByTestId('rail-job-mode').map(pill => pill.textContent?.trim())).toEqual(['Autopilot', 'Ralph']);
        expect(pinned).toHaveBeenCalledTimes(reads);
    });

    it('manual reload changes the full pin indicator even with unchanged loaded rows', async () => {
        let refresh: (() => Promise<void>) | null = null;
        const onRefreshReady = (next: (() => Promise<void>) | null) => { refresh = next; };
        render(panel({ onRefreshReady }));
        await flush();
        expect(pin()).toHaveAccessibleName('3 pinned jobs');
        serverEntries = [entry('queue_unloaded_new', '2026-10-10T00:00:00Z')];
        await act(async () => { await refresh!(); });
        expect(pin()).toHaveAccessibleName('1 pinned job');
        hover();
        tick(200);
        expect(screen.getByRole('link', { name: 'Open job: Server queue_unloaded_new' })).toBeTruthy();
    });

    it('a newer manual pin read supersedes a delayed older snapshot', async () => {
        let refresh: (() => Promise<void>) | null = null;
        render(panel({ onRefreshReady: next => { refresh = next; } }));
        await flush();
        let finish!: (value: any) => void;
        pinned.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        let old!: Promise<void>;
        act(() => { old = refresh!(); });
        serverEntries = [entry('queue_new', '2026-10-10T00:00:00Z')];
        await act(async () => { await refresh!(); });
        await act(async () => { finish({ entries: [entry('queue_stale', '2026-10-01T00:00:00Z'), entry('queue_stale2', '2026-10-01T00:00:00Z')] }); await old; });
        expect(pin()).toHaveAccessibleName('1 pinned job');
        hover();
        tick(200);
        expect(screen.getByRole('link', { name: 'Open job: Server queue_new' })).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'Open job: Server queue_stale' })).toBeNull();
    });

    it('counts the full pinned set, including completed and unloaded pins, in pin order', async () => {
        render(panel({ history: [historyRow('queue_a', '2026-10-03T00:00:00.000Z')] }));
        await flush();
        expect(pinned).toHaveBeenCalledWith('ws-alpha');
        expect(pin()).toHaveAccessibleName('3 pinned jobs');
        expect(pin()).toHaveTextContent('3');
        hover();
        tick(199);
        expect(screen.queryByRole('dialog')).toBeNull();
        tick(1);
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveTextContent('Pinned jobs (3)');
        expect(dialog).toHaveTextContent('Local / Alpha');
        expect(dialog).not.toHaveTextContent('Pinned and completed history');
        const titles = within(dialog).getAllByRole('link').map(link => link.getAttribute('aria-label'));
        expect(titles).toEqual(['Open job: Loaded queue_a', 'Open job: Server queue_run', 'Open job: Beyond the loaded page']);
        expect(dialog).toHaveTextContent('Completed');
        expect(dialog).toHaveTextContent('Thinking'); // ChatStatusPill's running-chat label
        // Pinned previews never trigger the full-sidebar hover peek.
        fireEvent.mouseMove(pin());
        tick(500);
        expect(screen.getByTestId('split-workspace-left')).toHaveClass('hidden');
    });

    it('hides at zero and shows the 99+ badge with the exact header count', async () => {
        serverEntries = [];
        const view = render(panel());
        await flush();
        expect(screen.queryByTestId('split-workspace-left-pinned')).toBeNull();
        serverEntries = Array.from({ length: 120 }, (_, i) => entry(`queue_${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()));
        view.unmount();
        render(panel());
        await flush();
        expect(pin()).toHaveTextContent('99+');
        hover();
        tick(200);
        expect(screen.getByRole('dialog')).toHaveTextContent('Pinned jobs (120)');
    });

    it('applies sidebar unpin/archive/delete immediately, refetches, and dismisses when the last pin goes', async () => {
        serverEntries = [entry('queue_a', '2026-10-03T00:00:00.000Z'), entry('queue_b', '2026-10-02T00:00:00.000Z')];
        const a = historyRow('queue_a', '2026-10-03T00:00:00.000Z');
        const b = historyRow('queue_b', '2026-10-02T00:00:00.000Z');
        const view = render(panel({ history: [a, b] }));
        await flush();
        hover();
        tick(200);
        expect(screen.getByRole('dialog')).toHaveTextContent('Pinned jobs (2)');

        // Unpinned in the sidebar: gone before the server answers.
        view.rerender(panel({ history: [a, { ...b, pinnedAt: undefined }] }));
        expect(screen.getByRole('dialog')).toHaveTextContent('Pinned jobs (1)');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('Loaded queue_b');
        serverEntries = [entry('queue_a', '2026-10-03T00:00:00.000Z')];
        const calls = pinned.mock.calls.length;
        await flush(300);
        expect(pinned.mock.calls.length).toBe(calls + 1);

        // A page refresh must not infer deletion; the authoritative refetch removes it.
        serverEntries = [];
        view.rerender(panel({ history: [] }));
        await flush(300);
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.queryByTestId('split-workspace-left-pinned')).toBeNull();
    });

    it('keeps completed pins after a running pin finishes and drops archived pins', async () => {
        serverEntries = [entry('queue_run', '2026-10-02T00:00:00.000Z', { status: 'running' })];
        const view = render(panel({ running: [{ id: 'run', processId: 'queue_run', type: 'chat', status: 'running', displayName: 'Live' }] }));
        await flush();
        expect(pin()).toHaveAccessibleName('1 pinned job');
        serverEntries = [entry('queue_run', '2026-10-02T00:00:00.000Z')];
        view.rerender(panel({ history: [historyRow('queue_run', '2026-10-02T00:00:00.000Z')] }));
        await flush(300);
        hover();
        tick(200);
        expect(screen.getByRole('dialog')).toHaveTextContent('Completed');
        view.rerender(panel({ history: [historyRow('queue_run', '2026-10-02T00:00:00.000Z', { archived: true })] }));
        expect(screen.queryByTestId('split-workspace-left-pinned')).toBeNull();
    });

    it('respects the sidebar type exclusions', async () => {
        excludedTypes = ['run-script'];
        serverEntries = [entry('queue_a', '2026-10-03T00:00:00.000Z'), entry('queue_s', '2026-10-02T00:00:00.000Z', { type: 'run-script' })];
        render(panel());
        await flush();
        expect(pin()).toHaveAccessibleName('1 pinned job');
    });

    it('uses the current Chats or Tasks list visibility for the count and rows', async () => {
        serverEntries = [
            entry('queue_chat', '2026-10-03T00:00:00.000Z'),
            entry('queue_script', '2026-10-02T00:00:00.000Z', { type: 'run-script' }),
        ];
        const view = render(panel({ tab: 'chats' }));
        await flush();
        expect(pin()).toHaveAccessibleName('1 pinned job');
        hover();
        tick(200);
        expect(screen.getByRole('dialog')).toHaveTextContent('Server queue_chat');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('Server queue_script');

        view.rerender(panel({ tab: 'tasks' }));
        expect(pin()).toHaveAccessibleName('1 pinned job');
        expect(screen.queryByRole('dialog')).toBeNull();
        hover();
        tick(200);
        expect(screen.getByRole('dialog')).toHaveTextContent('Server queue_script');
        expect(screen.getByRole('dialog')).not.toHaveTextContent('Server queue_chat');
    });

    it('opens rows through the list selection with owner-qualified routes', async () => {
        const onOpen = vi.fn();
        const routeId = 'remote:server-a:ws-alpha';
        render(panel({ routeId, cocClient: client('http://server-a:4000'), onOpen }));
        await flush();
        hover();
        tick(200);
        const link = screen.getByRole('link', { name: 'Open job: Beyond the loaded page' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver-a%3Aws-alpha/activity/queue_old');
        fireEvent.click(link);
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'queue_old' }));
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByTestId('split-workspace-left-rail')).toBeTruthy();
    });

    it('keeps group scope on its owner and routes workflow rows by type', async () => {
        serverEntries = [entry('queue_flow', '2026-10-03T00:00:00.000Z', { type: 'run-workflow' })];
        const onOpen = vi.fn();
        render(panel({
            workspaceId: 'group-alpha',
            routeId: 'remote:server-a:group-alpha',
            cocClient: client('http://server-a:4000'),
            onOpen,
        }));
        await flush();
        expect(pinned).toHaveBeenCalledWith('group-alpha');
        hover();
        tick(200);
        const link = screen.getByRole('link', { name: 'Open job: Server queue_flow' });
        expect(link).toHaveAttribute('href', '#repos/remote%3Aserver-a%3Agroup-alpha/workflow/queue_flow');
        fireEvent.click(link);
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'queue_flow', type: 'run-workflow' }));
    });

    it('never reads the page origin for an unresolved remote selection', async () => {
        render(panel({ routeId: 'remote:server-a:ws-alpha', history: [historyRow('queue_a', '2026-10-03T00:00:00.000Z')] }));
        await flush(500);
        expect(pinned).not.toHaveBeenCalled();
        expect(screen.queryByTestId('split-workspace-left-pinned')).toBeNull();
    });

    it('ordinary click and touch expand the sidebar without a preview', async () => {
        render(panel());
        await flush();
        fireEvent.pointerEnter(pin(), { pointerType: 'touch' });
        fireEvent.pointerDown(pin(), { pointerType: 'touch' });
        act(() => pin().focus());
        tick(500);
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(pin());
        expect(screen.queryByTestId('split-workspace-left-rail')).toBeNull();
    });

    it('supports keyboard entry, Escape focus return without reopening, and deliberate re-entry', async () => {
        render(panel());
        await flush();
        vi.useRealTimers();
        const user = userEvent.setup();
        act(() => pin().focus());
        expect(screen.getByRole('dialog')).toBeTruthy();
        await user.keyboard('{ArrowRight}');
        expect(screen.getByRole('button', { name: 'Close job preview' })).toHaveFocus();
        await user.keyboard('{ArrowDown}');
        expect(screen.getByRole('link', { name: 'Open job: Server queue_a' })).toHaveFocus();
        await user.keyboard('{Escape}');
        expect(pin()).toHaveFocus();
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.keyDown(pin(), { key: 'ArrowRight' });
        expect(screen.getByRole('button', { name: 'Close job preview' })).toHaveFocus();
        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('renders nothing outside the split rail and cleans timers on unmount', async () => {
        render(<RailPinnedJobs workspaceId="ws-alpha" routeId="ws-alpha" client={localClient} running={[]} history={[]}
            scopeLabel="x" tab="activity" onOpen={vi.fn()} />);
        await flush();
        expect(screen.queryByTestId('split-workspace-left-pinned')).toBeNull();
        cleanup();
        const view = render(panel());
        await flush();
        hover();
        view.unmount();
        expect(vi.getTimerCount()).toBe(0);
    });
});

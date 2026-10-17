/**
 * adminTarget — the machine whose server-owned settings Desktop Admin edits.
 *
 * Behind `features.adminMachineSwitch` (desktop shell, non-container only),
 * `AdminTargetProvider` keeps an in-memory selection that starts on the
 * connected server every time the Admin dialog mounts. Server-owned Admin
 * code reads its transport from `useAdminServer()`; each selection gets its
 * own scoped `CocClient` whose reads are aborted when the selection changes
 * and whose writes are counted so a switch never races an uncertain outcome.
 * `AdminTargetGate` remounts the Admin content per selection, so drafts,
 * polling and subscriptions never cross machines.
 *
 * Without the provider (flag off, browser dashboard, container mode)
 * `useAdminServer()` returns the page-origin defaults, byte-for-byte the
 * previous behavior. Nothing here persists the selection or mutates the
 * shared SPA client.
 */

import {
    createContext,
    Fragment,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { CocClient, type RemoteServer } from '@plusplusoneplusplus/coc-client';
import { getSpaCocClient, getSpaCocClientErrorMessage, toLegacyFetchInit } from '../api/cocClient';
import { isDesktopShell } from '../hooks/ui/useDesktopShell';
import { Spinner } from '../ui';
import {
    getApiBase,
    getHostname,
    getRawApiBase,
    getWsPath,
    isAdminMachineSwitchEnabled,
    isContainerMode,
    isServersEnabled,
} from '../utils/config';
import { getServerEndpoint } from '../utils/serverRegistry';

// ── Transport seam ──────────────────────────────────────────────────────────

/** How server-owned Admin code reaches the machine it is configuring. */
export interface AdminServerAccess {
    /** Typed client for the target server. Read it at call time. */
    readonly client: CocClient;
    /** True when the target is a registered remote, not the connected server. */
    readonly isRemote: boolean;
    /** REST base for hand-built URLs (EventSource, raw fetch). */
    readonly apiBase: string;
    /** Container-level REST base (connected server only). */
    readonly rawApiBase: string;
    /** Maps an origin-relative URL (`/api/...`) onto the target's origin. */
    resolveUrl(path: string): string;
    /** `fetch` bound to the target's lifetime; pass a URL built from `apiBase`. */
    fetch(url: string, init?: RequestInit): Promise<Response>;
    /** Cache scope for per-server caches: the remote baseUrl, undefined locally. */
    readonly cacheScope: string | undefined;
    /** Human-readable machine name for confirmations; empty without the provider. */
    readonly label: string;
    /** Runtime feature flags of the target server. */
    readonly serversEnabled: boolean;
}

const DEFAULT_ACCESS: AdminServerAccess = {
    get client() { return getSpaCocClient(); },
    isRemote: false,
    get apiBase() { return getApiBase(); },
    get rawApiBase() { return getRawApiBase(); },
    resolveUrl: path => path,
    fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
    cacheScope: undefined,
    label: '',
    get serversEnabled() { return isServersEnabled(); },
};

// ── Machines ────────────────────────────────────────────────────────────────

export const CONNECTED_MACHINE_KEY = 'connected';

export interface AdminMachine {
    /** `connected`, or `server:<registry id>` for a registered remote. */
    key: string;
    label: string;
    /** Credential-free connection identity used to tell same-named machines apart. */
    hint: string;
    connected: boolean;
    /** Status text shown next to the name; never color alone. */
    statusText: string;
}

export function remoteMachineKey(serverId: string): string {
    return `server:${serverId}`;
}

function safeHost(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** Connection identity without credentials, paths or queries. */
export function machineIdentityHint(server: RemoteServer): string {
    if (server.kind === 'url') return safeHost(server.url);
    if (server.kind === 'devtunnel') return `tunnel ${server.tunnelId}`;
    return `ssh ${server.host}`;
}

const STATUS_TEXT: Record<string, string> = {
    online: 'Online',
    connecting: 'Connecting',
    offline: 'Offline',
    failed: 'Connection failed',
    idle: 'Not connected',
};

export function machineStatusText(server: RemoteServer): string {
    // Direct URLs have no managed connection; an unprobed one is just unchecked.
    if (server.kind === 'url' && (server.status ?? 'idle') === 'idle') return 'Not checked';
    return STATUS_TEXT[server.status ?? 'idle'] ?? 'Unknown';
}

export function connectedMachine(): AdminMachine {
    return {
        key: CONNECTED_MACHINE_KEY,
        label: getHostname() || 'Connected server',
        hint: 'this desktop\'s server',
        connected: true,
        statusText: 'Connected',
    };
}

/** Connected server first, then registered machines in registry order. */
export function buildAdminMachines(servers: readonly RemoteServer[]): AdminMachine[] {
    return [
        connectedMachine(),
        ...servers.map(server => ({
            key: remoteMachineKey(server.id),
            label: server.label || machineIdentityHint(server),
            hint: machineIdentityHint(server),
            connected: false,
            statusText: machineStatusText(server),
        })),
    ];
}

// ── Scoped transport ────────────────────────────────────────────────────────

function abortError(): Error {
    const error = new Error('The Admin target changed before this request finished.');
    error.name = 'AbortError';
    return error;
}

function linkSignals(owner: AbortSignal, request?: AbortSignal | null): AbortSignal {
    if (!request) return owner;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (owner.aborted || request.aborted) abort();
    owner.addEventListener('abort', abort, { once: true });
    request.addEventListener('abort', abort, { once: true });
    return controller.signal;
}

export interface ScopedFetchHooks {
    signal: AbortSignal;
    onMutation(delta: 1 | -1): void;
    /** Returns a reason when writes must not dispatch (e.g. lost connection). */
    blockedReason(): string | null;
    onNetworkError(): void;
}

/**
 * `fetch` tied to one Admin selection: aborted with it, so a delayed answer
 * from a previous machine rejects instead of reaching the new view.
 */
export function createScopedFetch(hooks: ScopedFetchHooks): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (hooks.signal.aborted) throw abortError();
        const method = (init?.method ?? 'GET').toUpperCase();
        const mutation = method !== 'GET' && method !== 'HEAD';
        if (mutation) {
            const blocked = hooks.blockedReason();
            if (blocked) throw new Error(blocked);
            hooks.onMutation(1);
        }
        try {
            const response = await fetch(input, {
                ...toLegacyFetchInit(init),
                signal: linkSignals(hooks.signal, init?.signal),
            });
            if (hooks.signal.aborted) throw abortError();
            return response;
        } catch (error) {
            if (hooks.signal.aborted) throw abortError();
            if (error instanceof TypeError) hooks.onNetworkError();
            throw error;
        } finally {
            if (mutation) hooks.onMutation(-1);
        }
    }) as typeof fetch;
}

function trimSlash(url: string): string {
    return url.replace(/\/+$/, '');
}

// ── Provider state ──────────────────────────────────────────────────────────

export type AdminTargetPhase = 'loading' | 'ready' | 'unavailable';

interface Session {
    /** Changes per selection/attempt; keys the remounted Admin content. */
    id: number;
    key: string;
    phase: AdminTargetPhase;
    error: string | null;
    access: AdminServerAccess;
    controller: AbortController;
}

export interface AdminDirtyEntry {
    label: string;
    dirty: boolean;
    saving?: boolean;
    /** Saves the draft on the current target; failures leave it dirty. */
    save: () => unknown;
}

type PendingSwitch =
    | { key: string; mode: 'prompt' }
    | { key: string; mode: 'saving' }
    | { key: string; mode: 'failed'; outstanding: string[] };

interface AdminTargetContextValue {
    machines: AdminMachine[];
    machinesError: string | null;
    machine: AdminMachine;
    session: Session;
    /** Set when a ready remote stops answering or leaves the registry. */
    degraded: string | null;
    busy: boolean;
    pending: PendingSwitch | null;
    dirtyLabels: string[];
    requestSelect(key: string): void;
    retry(): void;
    refreshMachines(): void;
    guardSave(): void;
    guardDiscard(): void;
    guardCancel(): void;
    registerDirty(id: string, entry: { current: AdminDirtyEntry }): () => void;
    dirtyChanged(): void;
}

const AdminTargetContext = createContext<AdminTargetContextValue | null>(null);

/** Transport for server-owned Admin code; page-origin defaults without the provider. */
export function useAdminServer(): AdminServerAccess {
    const ctx = useContext(AdminTargetContext);
    return ctx?.session.access ?? DEFAULT_ACCESS;
}

/** True when the machine selector is active (feature flag on, desktop shell). */
export function useAdminMachineSwitchActive(): boolean {
    return useContext(AdminTargetContext) !== null;
}

/**
 * Registers an unsaved server-owned draft so switching machines can offer
 * Save / Discard / Cancel. No-op without the provider.
 */
export function useAdminDirtyGuard(id: string, entry: AdminDirtyEntry): void {
    const ctx = useContext(AdminTargetContext);
    const ref = useRef(entry);
    ref.current = entry;
    const register = ctx?.registerDirty;
    const changed = ctx?.dirtyChanged;
    useLayoutEffect(() => register?.(id, ref), [register, id]);
    useLayoutEffect(() => { changed?.(); }, [changed, entry.dirty, entry.saving, entry.label]);
}

function connectedAccess(hooks: ScopedFetchHooks): AdminServerAccess {
    const scopedFetch = createScopedFetch(hooks);
    const apiBase = getApiBase();
    return {
        client: new CocClient({ baseUrl: '', apiBasePath: apiBase, wsPath: getWsPath(), fetch: scopedFetch }),
        isRemote: false,
        apiBase,
        rawApiBase: getRawApiBase(),
        resolveUrl: path => path,
        fetch: (url, init) => scopedFetch(url, init),
        cacheScope: undefined,
        label: connectedMachine().label,
        serversEnabled: isServersEnabled(),
    };
}

function remoteAccess(baseUrl: string, label: string, hooks: ScopedFetchHooks, serversEnabled = false): AdminServerAccess {
    const scopedFetch = createScopedFetch(hooks);
    const origin = trimSlash(baseUrl);
    const wsPath = (globalThis as any).window?.__DASHBOARD_CONFIG__?.wsPath ?? '/ws';
    return {
        client: new CocClient({ baseUrl: origin, wsPath, fetch: scopedFetch }),
        isRemote: true,
        apiBase: `${origin}/api`,
        rawApiBase: `${origin}/api`,
        resolveUrl: path => `${origin}${path}`,
        fetch: (url, init) => scopedFetch(url, init),
        cacheScope: origin,
        label,
        serversEnabled,
    };
}

/** Access that refuses every request; held by sessions that are not ready. */
function unavailableAccess(label: string): AdminServerAccess {
    const refuse = () => Promise.reject(new Error(`${label} is unavailable.`));
    const client = new CocClient({ baseUrl: 'http://unavailable.invalid', fetch: refuse as typeof fetch });
    return {
        client,
        isRemote: true,
        apiBase: 'http://unavailable.invalid/api',
        rawApiBase: 'http://unavailable.invalid/api',
        resolveUrl: path => `http://unavailable.invalid${path}`,
        fetch: refuse,
        cacheScope: 'unavailable',
        label,
        serversEnabled: false,
    };
}

/**
 * Provides the Admin machine selection. Mount it inside the Admin dialog so
 * every genuine open starts on the connected server.
 */
export function AdminTargetProvider({ children }: { children: ReactNode }) {
    // Anchored to the connected server and read once per open, so selecting a
    // remote (or saving its features) cannot remove the selector mid-session.
    const [enabled] = useState(() => isAdminMachineSwitchEnabled() && isDesktopShell() && !isContainerMode());
    if (!enabled) return <>{children}</>;
    return <EnabledAdminTargetProvider>{children}</EnabledAdminTargetProvider>;
}

function EnabledAdminTargetProvider({ children }: { children: ReactNode }) {
    const [servers, setServers] = useState<RemoteServer[]>([]);
    const [machinesError, setMachinesError] = useState<string | null>(null);
    const [mutations, setMutations] = useState(0);
    const [degraded, setDegraded] = useState<string | null>(null);
    const degradedRef = useRef<string | null>(null);
    degradedRef.current = degraded;
    const [pending, setPending] = useState<PendingSwitch | null>(null);
    const [, setDirtyVersion] = useState(0);
    const dirtyRegistry = useRef(new Map<string, { current: AdminDirtyEntry }>());
    const sessionIdRef = useRef(0);

    const makeHooks = useCallback((controller: AbortController, label: string): ScopedFetchHooks => ({
        signal: controller.signal,
        onMutation: delta => { if (!controller.signal.aborted) setMutations(count => Math.max(0, count + delta)); },
        blockedReason: () => (degradedRef.current ? `${label}: ${degradedRef.current}` : null),
        onNetworkError: () => {
            if (!controller.signal.aborted) setDegraded(prev => prev ?? 'Connection lost. Changes cannot be saved until it answers again.');
        },
    }), []);

    const [session, setSession] = useState<Session>(() => {
        const controller = new AbortController();
        return {
            id: 0,
            key: CONNECTED_MACHINE_KEY,
            phase: 'ready',
            error: null,
            access: connectedAccess(makeHooks(controller, connectedMachine().label)),
            controller,
        };
    });
    const sessionRef = useRef(session);
    sessionRef.current = session;

    useEffect(() => () => sessionRef.current.controller.abort(), []);

    // Registry discovery always asks the connected server, never the target.
    const listServers = useCallback(async (): Promise<RemoteServer[] | null> => {
        try {
            const list = await getSpaCocClient().servers.list();
            setServers(list);
            setMachinesError(null);
            return list;
        } catch (error) {
            setMachinesError(getSpaCocClientErrorMessage(error, 'Could not load registered machines'));
            return null;
        }
    }, []);

    const machines = useMemo(() => buildAdminMachines(servers), [servers]);

    const resolveRemote = useCallback(async (id: number, key: string, controller: AbortController) => {
        const isCurrent = () => sessionIdRef.current === id && !controller.signal.aborted;
        const fail = (label: string, error: string) => {
            if (!isCurrent()) return;
            setSession(prev => prev.id === id ? { ...prev, phase: 'unavailable', error, access: unavailableAccess(label) } : prev);
        };
        const list = await listServers();
        if (!isCurrent()) return;
        if (!list) {
            fail('This machine', 'The connected server could not list registered machines.');
            return;
        }
        const server = list.find(s => remoteMachineKey(s.id) === key);
        if (!server) {
            fail('This machine', 'This machine is no longer registered on the connected server.');
            return;
        }
        const label = server.label || machineIdentityHint(server);
        const endpoint = getServerEndpoint(server);
        const managed = server.kind !== 'url';
        if (!endpoint || (managed && server.status !== 'online')) {
            const detail = server.lastError ? ` ${server.lastError}` : '';
            fail(label, `${label} is ${machineStatusText(server).toLowerCase()}.${detail}`);
            return;
        }
        const probeHooks = makeHooks(controller, label);
        const probe = remoteAccess(endpoint, label, probeHooks);
        let serversEnabled = false;
        try {
            const health = await probe.client.health.get();
            if (!isCurrent()) return;
            if (server.serverIdentity && health.serverIdentity !== server.serverIdentity) {
                fail(label, `${label} answered as a different server than the one registered. Check the connection on the Servers page.`);
                return;
            }
            const runtime = await probe.client.request<{ features?: { serversEnabled?: boolean } }>('/config/runtime').catch(() => null);
            serversEnabled = runtime?.features?.serversEnabled === true;
        } catch (error) {
            fail(label, `${label} did not answer: ${getSpaCocClientErrorMessage(error, 'unreachable')}`);
            return;
        }
        if (!isCurrent()) return;
        setSession(prev => prev.id === id
            ? { ...prev, phase: 'ready', error: null, access: remoteAccess(endpoint, label, probeHooks, serversEnabled) }
            : prev);
    }, [listServers, makeHooks]);

    const commitSelect = useCallback((key: string) => {
        sessionRef.current.controller.abort();
        const id = ++sessionIdRef.current;
        const controller = new AbortController();
        setDegraded(null);
        setMutations(0);
        setPending(null);
        if (key === CONNECTED_MACHINE_KEY) {
            setSession({ id, key, phase: 'ready', error: null, access: connectedAccess(makeHooks(controller, connectedMachine().label)), controller });
            return;
        }
        const label = machines.find(m => m.key === key)?.label ?? 'This machine';
        setSession({ id, key, phase: 'loading', error: null, access: unavailableAccess(label), controller });
        void resolveRemote(id, key, controller);
    }, [machines, makeHooks, resolveRemote]);

    const commitSelectRef = useRef(commitSelect);
    commitSelectRef.current = commitSelect;

    const dirtyEntries = () => [...dirtyRegistry.current.values()].map(ref => ref.current);
    const busy = mutations > 0 || dirtyEntries().some(entry => entry.saving);
    const dirtyLabels = dirtyEntries().filter(entry => entry.dirty).map(entry => entry.label);

    const requestSelect = useCallback((key: string) => {
        if (key === sessionRef.current.key) return;
        const entries = [...dirtyRegistry.current.values()].map(ref => ref.current);
        if (entries.some(entry => entry.saving)) return;
        if (entries.some(entry => entry.dirty)) {
            setPending({ key, mode: 'prompt' });
            return;
        }
        commitSelect(key);
    }, [commitSelect]);

    const guardSave = useCallback(() => {
        const target = pending?.key;
        if (!target) return;
        const origin = sessionRef.current.id;
        setPending({ key: target, mode: 'saving' });
        void (async () => {
            for (const ref of [...dirtyRegistry.current.values()]) {
                if (!ref.current.dirty) continue;
                try {
                    await ref.current.save();
                } catch {
                    // The card reports its own failure; it stays dirty.
                }
            }
            // Let the cards commit their post-save state, then switch only when
            // every draft is clean on the original machine.
            for (let i = 0; i < 50; i++) {
                await new Promise(resolve => setTimeout(resolve, 0));
                if (![...dirtyRegistry.current.values()].some(ref => ref.current.saving)) break;
            }
            if (sessionRef.current.id !== origin) return;
            const outstanding = [...dirtyRegistry.current.values()].filter(ref => ref.current.dirty).map(ref => ref.current.label);
            if (outstanding.length === 0) commitSelectRef.current(target);
            else setPending({ key: target, mode: 'failed', outstanding });
        })();
    }, [pending?.key]);

    const guardDiscard = useCallback(() => {
        if (pending) commitSelect(pending.key);
    }, [pending, commitSelect]);
    const guardCancel = useCallback(() => setPending(null), []);

    const retry = useCallback(() => {
        const current = sessionRef.current;
        if (current.phase !== 'ready') {
            commitSelect(current.key);
            return;
        }
        if (current.key === CONNECTED_MACHINE_KEY) {
            setDegraded(null);
            return;
        }
        // A ready remote keeps its drafts: re-check the same target in place.
        void (async () => {
            const list = await listServers();
            if (sessionRef.current.id !== current.id) return;
            const server = list?.find(s => remoteMachineKey(s.id) === current.key);
            if (!server) {
                setDegraded('This machine is no longer registered on the connected server.');
                return;
            }
            try {
                const health = await current.access.client.health.get();
                if (sessionRef.current.id !== current.id) return;
                if (server.serverIdentity && health.serverIdentity !== server.serverIdentity) {
                    setDegraded('The endpoint now answers as a different server. Choose the machine again.');
                    return;
                }
                if (getServerEndpoint(server) && trimSlash(getServerEndpoint(server)!) !== current.access.cacheScope) {
                    setDegraded('The connection endpoint changed. Choose the machine again to reload it.');
                    return;
                }
                setDegraded(null);
            } catch {
                setDegraded(prev => prev ?? 'Connection lost. Changes cannot be saved until it answers again.');
            }
        })();
    }, [commitSelect, listServers]);

    const refreshMachines = useCallback(() => {
        void listServers().then(list => {
            const current = sessionRef.current;
            if (!list || current.key === CONNECTED_MACHINE_KEY || current.phase !== 'ready') return;
            if (!list.some(s => remoteMachineKey(s.id) === current.key)) {
                setDegraded('This machine is no longer registered on the connected server.');
            }
        });
    }, [listServers]);

    useEffect(() => { refreshMachines(); }, [refreshMachines]);

    const registerDirty = useCallback((id: string, ref: { current: AdminDirtyEntry }) => {
        dirtyRegistry.current.set(id, ref);
        setDirtyVersion(v => v + 1);
        return () => {
            if (dirtyRegistry.current.get(id) === ref) dirtyRegistry.current.delete(id);
            setDirtyVersion(v => v + 1);
        };
    }, []);
    const dirtyChanged = useCallback(() => setDirtyVersion(v => v + 1), []);

    const machine = machines.find(m => m.key === session.key)
        ?? (session.key === CONNECTED_MACHINE_KEY ? connectedMachine() : { key: session.key, label: session.access.label, hint: '', connected: false, statusText: 'Unavailable' });

    const value: AdminTargetContextValue = {
        machines,
        machinesError,
        machine,
        session,
        degraded,
        busy,
        pending,
        dirtyLabels,
        requestSelect,
        retry,
        refreshMachines,
        guardSave,
        guardDiscard,
        guardCancel,
        registerDirty,
        dirtyChanged,
    };
    return <AdminTargetContext.Provider value={value}>{children}</AdminTargetContext.Provider>;
}

// ── UI ──────────────────────────────────────────────────────────────────────

function machineOptionText(machine: AdminMachine, duplicate: boolean): string {
    if (machine.connected) return `${machine.label} — connected server`;
    const name = duplicate ? `${machine.label} (${machine.hint})` : machine.label;
    return `${name} — ${machine.statusText}`;
}

function phaseText(ctx: AdminTargetContextValue): string {
    if (ctx.session.phase === 'loading') return 'Connecting…';
    if (ctx.session.phase === 'unavailable') return 'Unavailable';
    if (ctx.degraded) return 'Connection problem';
    return ctx.machine.connected ? 'Connected server' : 'Remote · Online';
}

/** Compact "Configure machine" selector for the Admin header. */
export function AdminMachineSelector() {
    const ctx = useContext(AdminTargetContext);
    if (!ctx) return null;
    const labelCounts = new Map<string, number>();
    for (const m of ctx.machines) labelCounts.set(m.label, (labelCounts.get(m.label) ?? 0) + 1);
    const options = ctx.machines.some(m => m.key === ctx.machine.key) ? ctx.machines : [...ctx.machines, ctx.machine];
    const switching = ctx.pending?.mode === 'saving';
    const pendingMachine = ctx.pending ? options.find(m => m.key === ctx.pending!.key) : undefined;

    return (
        <div className="ar-machine" data-testid="admin-machine-selector">
            <div className="ar-machine-row">
                <label className="ar-machine-label" htmlFor="admin-machine-select">Configure machine</label>
                <select
                    id="admin-machine-select"
                    className="ar-tab-select ar-machine-select"
                    value={ctx.machine.key}
                    onChange={e => ctx.requestSelect(e.target.value)}
                    onFocus={ctx.refreshMachines}
                    disabled={ctx.busy || switching}
                    title={ctx.busy ? 'Wait for the current save to finish before switching machines.' : undefined}
                    data-testid="admin-machine-select"
                >
                    {options.map(m => (
                        <option key={m.key} value={m.key}>{machineOptionText(m, (labelCounts.get(m.label) ?? 0) > 1)}</option>
                    ))}
                </select>
                <span className="ar-machine-status" role="status" data-testid="admin-machine-status">
                    {ctx.session.phase === 'loading' && <Spinner size="sm" />}
                    {phaseText(ctx)}
                </span>
            </div>
            {ctx.machinesError && (
                <p className="ar-machine-note" data-testid="admin-machine-list-error">Registered machines unavailable: {ctx.machinesError}</p>
            )}
            {ctx.degraded && ctx.session.phase === 'ready' && (
                <div className="ar-machine-banner" role="alert" data-testid="admin-machine-degraded">
                    <span>{ctx.machine.label}: {ctx.degraded} Unsaved edits are kept.</span>
                    <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" onClick={ctx.retry} data-testid="admin-machine-retry">Retry</button>
                </div>
            )}
            {ctx.pending && (
                <div className="ar-machine-banner" role="alertdialog" aria-label="Unsaved changes" data-testid="admin-machine-guard">
                    <span>
                        {ctx.pending.mode === 'failed'
                            ? <>Could not save {ctx.pending.outstanding.join(', ')} on {ctx.machine.label}. You are still configuring {ctx.machine.label}.</>
                            : <>Unsaved changes on {ctx.machine.label}: {ctx.dirtyLabels.join(', ')}. Save them before switching to {pendingMachine?.label ?? 'the other machine'}?</>}
                    </span>
                    <span className="ar-hstack" style={{ gap: 6 }}>
                        <button type="button" className="ar-btn ar-btn-primary ar-btn-sm" onClick={ctx.guardSave} disabled={switching} data-testid="admin-machine-guard-save">
                            {switching && <Spinner size="sm" />}{ctx.pending.mode === 'failed' ? 'Try saving again' : 'Save'}
                        </button>
                        <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" onClick={ctx.guardDiscard} disabled={switching} data-testid="admin-machine-guard-discard">Discard</button>
                        <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" onClick={ctx.guardCancel} disabled={switching} data-testid="admin-machine-guard-cancel">Cancel</button>
                    </span>
                </div>
            )}
        </div>
    );
}

/** "This desktop" label for desktop-owned cards while the selector is active. */
export function useAdminLocalBadge(fallback: string): string {
    return useAdminMachineSwitchActive() ? 'This desktop' : fallback;
}

/**
 * Mounts the Admin content for the ready selection only, remounting it per
 * selection. Loading and unavailable targets get a placeholder that keeps
 * the selector reachable but never shows another machine's content.
 */
export function AdminTargetGate({ children }: { children: ReactNode }) {
    const ctx = useContext(AdminTargetContext);
    if (!ctx) return <>{children}</>;
    if (ctx.session.phase === 'ready') return <Fragment key={ctx.session.id}>{children}</Fragment>;
    return (
        <div id="view-admin" className="admin-redesign" data-testid="admin-target-placeholder">
            <main className="ar-main" style={{ padding: 20 }}>
                <header className="ar-topbar"><AdminMachineSelector /></header>
                {ctx.session.phase === 'loading' ? (
                    <div className="ar-section ar-hstack ar-muted" data-testid="admin-target-loading"><Spinner size="sm" /> Connecting to {ctx.machine.label}…</div>
                ) : (
                    <section className="ar-card" data-testid="admin-target-unavailable">
                        <div className="ar-section">
                            <p style={{ margin: 0 }}><strong>{ctx.machine.label}</strong> cannot be configured right now.</p>
                            <p className="ar-muted" style={{ margin: '6px 0 12px' }}>{ctx.session.error}</p>
                            <p className="ar-muted" style={{ margin: '0 0 12px' }}>No settings from this desktop's server are shown in its place.</p>
                            <button type="button" className="ar-btn ar-btn-secondary ar-btn-sm" onClick={ctx.retry} data-testid="admin-target-retry">Retry</button>
                        </div>
                    </section>
                )}
            </main>
        </div>
    );
}

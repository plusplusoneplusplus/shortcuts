import { BrowserHostError, type BrowserEngineHost, type BrowserEventSink, type BrowserHostedView, type BrowserSiteFacts, type FilePreviewHost } from './browser-host-contract';
import {
    BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, BROWSER_VIEW_REOPEN_CLOSED_REQUESTED_CHANNEL, BROWSER_VIEW_TAB_SHORTCUT_CHANNEL, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, BROWSER_VIEW_CLOSED_CHANNEL, BROWSER_VIEW_DOWNLOAD_CHANNEL, BROWSER_VIEW_NEW_TAB_CHANNEL, BROWSER_VIEW_STATE_CHANNEL,
    BROWSER_PAGE_ZOOM, isBrowserPageZoom, isBrowserEngine, isValidBrowserSessionKey, isValidBrowserViewId, toBrowserSource, validateBrowserUrl,
    type BrowserEngine, type BrowserFailureReason, type BrowserNavAction, type BrowserCookieImportResult, type BrowserSiteConnection, type BrowserSiteInfo, type BrowserSiteInfoResult, type BrowserOpenResult, type BrowserOperationResult, type BrowserPreferences,
    type BrowserSourceKind, type BrowserViewState,
} from './browser-view-policy';
import { parseBrowserCookies } from './browser-cookie-import';
import { dispatchClickOnce, ClickOnceError, type ClickOncePolicy } from './browser-clickonce';
import { validateHtmlPagePath, type HtmlPageBounds } from './html-page-policy';
import type { BrowserHistoryStore } from './browser-history';
import { BrowserHumanTakeover } from './browser-human-takeover';
import { BrowserControlQueue } from './browser-control-queue';
import { withRichClipboard, type RichClipboard } from './browser-rich-clipboard';
import type { BrowserControlPage } from './browser-control-page';
import { BrowserDemoRecorders } from './browser-demo-recorder';
import type { BrowserDemoOwner } from './browser-demo-session';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserCommandRequest, BrowserCommandResult, BrowserControlTab, BrowserTakeoverState, BrowserTakeoverAction } from '@plusplusoneplusplus/coc-client';
import { validBrowserFavicon } from './browser-favicon';
import { BROWSER_CONTROL_TAKEOVER_STATE_CHANNEL, BROWSER_CONTROL_REVEAL_CHANNEL, BROWSER_CONTROL_FOCUSED_CHANNEL, BROWSER_CONTROL_ACTIVITY_CHANNEL, BROWSER_CONTROL_STOP_CHANNEL, BROWSER_CONTROL_NAVIGATION_CHECK_CHANNEL, type BrowserControlActivityEvent, type BrowserNavigationCheckEvent, validateBrowserCommandRequest } from './browser-control-command';

interface Entry {
    ownerId: number;
    viewId: string;
    sessionKey: string;
    engine: BrowserEngine;
    sourceKind: BrowserSourceKind;
    /** Validated file for `file` views; a different path replaces the view. */
    path?: string;
    closed: boolean;
    ready: Promise<BrowserHostedView>;
    view?: BrowserHostedView;
    startupFailed?: boolean;
    committedPage?: BrowserViewState['committedPage'];
    commitRevision?: number;
    control?: BrowserControlQueue;
    takeover?: BrowserHumanTakeover;
    controlStamp?: string;
    popout?: boolean;
    activity?: ControlActivity;
    /** CDP focus emulation is on so a background tab takes input without window focus. */
    focusEmulated?: boolean;
    hostGeneration?: object;
}

type ControlActivity = BrowserControlActivityEvent & { routingOwnerId: number };

interface NavigationCheck {
    entry: Entry;
    popoutViewId?: string;
    event: BrowserNavigationCheckEvent;
    routingOwnerId: number;
    resolve(allow: boolean): void;
    /** Paused 60s deadlines of this conversation's commands. */
    releases: (() => void)[];
}

interface CommandHold {
    routingOwnerId: number;
    workspaceId: string;
    processId: string;
    hold(): () => void;
}

interface TakeoverTurn {
    ownerId: number;
    control: BrowserHumanTakeover;
    entries: Set<Entry>;
    refreshed?: BrowserCommandResult;
    beforeTakeover: Map<Entry, string | undefined>;
    selected?: Entry;
}

export const BROWSER_DEMO_RECORDING_ERROR = 'recording-active: the user is recording a browser demo for this chat';

function throwRejected(results: PromiseSettledResult<unknown>[]): void {
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed) { throw failed.reason; }
}

export interface BrowserManagerOptions {
    clickOnce?: ClickOncePolicy;
    richClipboard?: RichClipboard;
    history: Pick<BrowserHistoryStore, 'recordVisit' | 'updateTitle' | 'flush' | 'clearEngine'>;
    hosts: Record<BrowserEngine, BrowserEngineHost>;
    /** Local HTML previews: always Electron, isolated from every engine profile and never cleared with them. */
    fileHost: FilePreviewHost;
    getDefault(): BrowserEngine;
    saveDefault(engine: BrowserEngine): void;
    getPageZoom(): number;
    savePageZoom(percent: number): void;
    send(ownerId: number, channel: string, payload: unknown): void;
    changed(): void;
}

export class BrowserHostManager {
    private readonly controlScopes = new Map<number, { workspaceId: string; sessionKey: string }>();
    /** Background scopes a window keeps serving after its selection moves on, keyed by owner `sessionKey`. */
    private readonly retainedScopes = new Map<number, Map<string, string>>();
    private readonly finishedTurns = new Map<number, Set<string>>();
    private readonly visibleControl = new Map<number, Map<string, boolean>>();
    private readonly owners = new Map<number, Map<string, Entry>>();
    private readonly clearing = new Set<BrowserEngine>();
    private disposed = false;
    private readonly imports = new Map<BrowserEngine, Set<Promise<BrowserCookieImportResult>>>();
    private zoomUpdate: Promise<unknown> = Promise.resolve();
    /** Held agent-driven navigations, keyed by check id, answered by the routing window. */
    private readonly navigationChecks = new Map<string, NavigationCheck>();
    /** A tab `open` is creating: its first load is gated before the turn activates the tab. */
    private readonly pendingActivity = new Map<string, ControlActivity>();
    private readonly pendingHumanTabs = new Map<string, { sessionKey: string; control: BrowserHumanTakeover }>();
    private readonly takeovers = new Map<string, TakeoverTurn>();
    private readonly commandHolds = new Set<CommandHold>();
    private readonly demoControlReservations = new Set<BrowserDemoOwner>();
    /** Windows whose SPA enabled Ctrl/Cmd+1–9 tab switching; other windows' pages keep those keys. */
    private readonly tabShortcutOwners = new Set<number>();

    /** Task-demonstration drafts; recorded chats and tabs refuse AI control while capturing. */
    readonly demos: BrowserDemoRecorders;

    constructor(private readonly options: BrowserManagerOptions) {
        this.demos = new BrowserDemoRecorders({
            send: options.send,
            busy: owner => [...this.demoControlReservations].some(request =>
                request.workspaceId === owner.workspaceId && request.processId === owner.processId && request.routingRef === owner.routingRef)
                ? 'An AI browser command for this chat is still finishing.' : undefined,
            lookup: (ownerId, viewId) => {
                const entry = this.entry(ownerId, viewId);
                if (!entry?.view || entry.closed) return undefined;
                const busy = entry.activity || entry.control?.busy ? 'An AI browser turn is using this tab.'
                    : entry.takeover?.paused ? 'Finish the human takeover in this tab first.' : undefined;
                return { view: entry.view, sessionKey: entry.sessionKey, sourceKind: entry.sourceKind, ...(busy ? { busy } : {}) };
            },
        });
    }

    finishControl(ownerId: number, turnId?: string, includeOwned = true, routingRef?: string): void {
        for (const item of this.takeovers.values()) if (item.ownerId === ownerId
            && (!routingRef || item.control.owner.routingRef === routingRef) && (!turnId || item.control.owner.turnId === turnId)
            && (turnId || !item.control.paused)) {
                item.control.stop('Browser conversation turn has finished');
                for (const entry of item.entries) if (entry.takeover === item.control) entry.takeover = undefined;
                this.takeovers.delete(this.takeoverKey(item.ownerId, item.control.owner.workspaceId, item.control.owner.processId, item.control.owner.routingRef));
            }
        if (!turnId) {
            if (routingRef) this.visibleControl.get(ownerId)?.delete(routingRef);
            else this.visibleControl.delete(ownerId);
        }
        if (turnId) {
            const finished = this.finishedTurns.get(ownerId) ?? new Set<string>();
            finished.add(turnId);
            this.finishedTurns.set(ownerId, finished);
        }
        // Target ownership does not imply turn ownership during anonymous source teardown.
        for (const entries of this.owners.values()) for (const entry of entries.values()) {
            if (entry.activity && (entry.activity.routingOwnerId === ownerId || !!turnId && includeOwned && entry.ownerId === ownerId)
                && (!routingRef || entry.activity.routingRef === routingRef) && (!turnId || entry.activity.turnId === turnId)) {
                if (!turnId && entry.takeover?.paused) continue;
                this.clearControlEntry(entry);
            }
        }
    }

    setControlVisible(ownerId: number, visible: boolean, routingRef: string): void {
        if (!isValidBrowserSessionKey(routingRef)) return;
        const scopes = this.visibleControl.get(ownerId) ?? new Map<string, boolean>();
        scopes.set(routingRef, visible);
        this.visibleControl.set(ownerId, scopes);
        for (const entries of this.owners.values()) for (const entry of entries.values()) {
            if (entry.activity?.routingOwnerId === ownerId && entry.activity.routingRef === routingRef) this.nativeActivity(entry);
        }
    }

    private nativeActivity(entry: Entry): void {
        let appliedTurnId: string | null = null;
        void Promise.resolve().then(() => {
            const activity = entry.activity;
            appliedTurnId = activity && (!entry.takeover || entry.takeover.status === 'agent') && this.visibleControl.get(activity.routingOwnerId)?.get(activity.routingRef) === true ? activity.turnId : null;
            return entry.view?.setControlActivity?.(appliedTurnId);
        }).catch(error => {
            console.error('[coc-desktop] Browser control chrome failed:', error);
            if (appliedTurnId) this.stopControl(entry, appliedTurnId);
        });
    }

    private clearControlEntry(entry: Entry, finished = true): void {
        const activity = entry.activity;
        if (!activity) return;
        if (finished) {
            const turns = this.finishedTurns.get(activity.routingOwnerId) ?? new Set<string>();
            turns.add(activity.turnId);
            this.finishedTurns.set(activity.routingOwnerId, turns);
        }
        entry.activity = undefined;
        // Turn finish, Stop, tab close and a moved turn take the AI cursor away at once.
        if (!entry.closed) entry.control?.removeCursor();
        this.pruneNavigationChecks();
        this.options.send(entry.ownerId, BROWSER_CONTROL_ACTIVITY_CHANNEL, { ...activity, active: false, finished });
        this.nativeActivity(entry);
        this.nativeNavigationGate(entry);
        if (activity.background) void this.backgroundControl(entry, false).catch(error => console.error('[coc-desktop] Browser background control cleanup failed:', error));
    }

    /** Hidden layout and focus emulation for a tab a background turn drives; foreground commands undo both. */
    private async backgroundControl(entry: Entry, enabled: boolean): Promise<void> {
        const view = entry.view;
        if (!view || entry.closed) return;
        await view.setBackgroundControl?.(enabled);
        if (!view.cdp || (entry.focusEmulated ?? false) === enabled) return;
        entry.focusEmulated = enabled;
        await view.cdp('Emulation.setFocusEmulationEnabled', { enabled });
    }

    private activateControl(entry: Entry, routingOwnerId: number, request: BrowserCommandRequest, background: boolean): void {
        const turnId = request.turnId ?? request.processId;
        if (this.finishedTurns.get(routingOwnerId)?.has(turnId)) throw new Error('Browser conversation turn has finished');
        for (const entries of this.owners.values()) for (const other of entries.values()) {
            if (other !== entry && other.activity?.routingRef === entry.sessionKey && other.activity.processId === request.processId) this.clearControlEntry(other, false);
        }
        if (entry.activity && entry.activity.turnId !== turnId) this.clearControlEntry(entry, entry.activity.processId === request.processId);
        entry.activity = { workspaceId: request.workspaceId, processId: request.processId, turnId,
            routingRef: entry.sessionKey, viewId: entry.viewId, active: true, routingOwnerId, ...(background ? { background: true } : {}) };
        this.options.send(entry.ownerId, BROWSER_CONTROL_ACTIVITY_CHANNEL, entry.activity);
        this.nativeActivity(entry);
        this.nativeNavigationGate(entry);
    }

    /** Engines without in-flight request holds cancel gated navigations natively only during a turn. */
    private nativeNavigationGate(entry: Entry): void {
        void Promise.resolve().then(() => entry.closed ? undefined : entry.view?.setNavigationGate?.(!!this.gateActivity(entry)))
            .catch(error => console.error('[coc-desktop] Browser navigation gate update failed:', error));
    }

    private stopControl(entry: Entry, turnId: string): void {
        const activity = entry.activity;
        if (!activity || activity.turnId !== turnId || this.visibleControl.get(activity.routingOwnerId)?.get(activity.routingRef) !== true) return;
        this.options.send(activity.routingOwnerId, BROWSER_CONTROL_STOP_CHANNEL, activity);
    }

    /** Foreground scope; a full clear (`null`, `null`) also drops every retained background scope. */
    bindControlScope(ownerId: number, workspaceId: unknown, sessionKey: unknown): void {
        if (workspaceId === null && sessionKey === null) {
            this.finishControl(ownerId, undefined, false);
            this.controlScopes.delete(ownerId);
            this.retainedScopes.delete(ownerId);
            return;
        }
        if (typeof workspaceId !== 'string' || !isValidBrowserSessionKey(workspaceId) || !isValidBrowserSessionKey(sessionKey)) throw new TypeError('Invalid browser workspace scope');
        this.controlScopes.set(ownerId, { workspaceId, sessionKey });
    }

    /** Keep (`workspaceId`) or drop (`null`) a background scope that stays controllable while another workspace is selected. */
    retainControlScope(ownerId: number, sessionKey: unknown, workspaceId: unknown): void {
        if (!isValidBrowserSessionKey(sessionKey)) throw new TypeError('Invalid browser workspace scope');
        const scopes = this.retainedScopes.get(ownerId) ?? new Map<string, string>();
        if (workspaceId === null) {
            scopes.delete(sessionKey);
            if (scopes.size === 0) this.retainedScopes.delete(ownerId);
            return;
        }
        if (typeof workspaceId !== 'string' || !isValidBrowserSessionKey(workspaceId)) throw new TypeError('Invalid browser workspace scope');
        if (!scopes.has(sessionKey) && scopes.size >= 64) throw new Error('Too many background browser workspaces');
        scopes.set(sessionKey, workspaceId);
        this.retainedScopes.set(ownerId, scopes);
    }

    foregroundSessionKey(ownerId: number): string | undefined {
        return this.controlScopes.get(ownerId)?.sessionKey;
    }

    retainedSessionKeys(ownerId: number): Set<string> {
        return new Set([...(this.retainedScopes.get(ownerId)?.keys() ?? []), ...[...this.takeovers.values()].filter(item => item.ownerId === ownerId && item.control.paused).map(item => item.control.owner.routingRef)]);
    }

    /** Finish this window's control activity except for retained background scopes. */
    finishUnretainedControl(ownerId: number): void {
        const retained = this.retainedSessionKeys(ownerId);
        if (retained.size === 0) { this.finishControl(ownerId, undefined, false); return; }
        const refs = new Set(this.visibleControl.get(ownerId)?.keys());
        for (const entries of this.owners.values()) for (const entry of entries.values()) {
            if (entry.activity?.routingOwnerId === ownerId) refs.add(entry.activity.routingRef);
        }
        for (const ref of refs) if (!retained.has(ref)) this.finishControl(ownerId, undefined, false, ref);
    }

    /** Owner session a request runs in; `routingRef` may select a retained background scope. */
    controlSessionKey(ownerId: number, workspaceId: string, routingRef?: string): string {
        return this.controlScope(ownerId, workspaceId, routingRef).sessionKey;
    }

    private controlScope(ownerId: number, workspaceId: string, routingRef?: string): { sessionKey: string; background: boolean } {
        const scope = this.controlScopes.get(ownerId);
        if (scope && scope.workspaceId === workspaceId && (routingRef === undefined || scope.sessionKey === routingRef)) return { sessionKey: scope.sessionKey, background: false };
        if (routingRef !== undefined && (this.retainedScopes.get(ownerId)?.get(routingRef) === workspaceId || [...this.takeovers.values()].some(item => item.ownerId === ownerId && item.control.paused && item.control.owner.workspaceId === workspaceId && item.control.owner.routingRef === routingRef))) return { sessionKey: routingRef, background: true };
        throw new Error('Browser workspace scope changed');
    }

    async releaseFrames(ownerId: number, sessionKey: unknown): Promise<void> {
        const scope = this.controlScopes.get(ownerId);
        const workspaceId = scope && scope.sessionKey === sessionKey ? scope.workspaceId
            : typeof sessionKey === 'string' ? this.retainedScopes.get(ownerId)?.get(sessionKey) : undefined;
        if (!workspaceId) throw new Error('Browser workspace scope changed');
        const results = await Promise.allSettled(this.scopedEntries(ownerId, workspaceId, sessionKey as string).filter(entry => !entry.takeover?.paused).map(entry =>
            entry.control!.run(page => page.configureFrames(false))));
        throwRejected(results);
    }

    /**
     * The cursor setting turned off live: take the AI cursor away now from the views this window
     * drives under `routingRef`, without waiting for a command. Other windows and scopes keep theirs.
     */
    removeCursors(ownerId: number, routingRef: unknown): void {
        if (!isValidBrowserSessionKey(routingRef)) throw new TypeError('Invalid browser workspace scope');
        for (const entries of this.owners.values()) for (const entry of entries.values()) {
            if (!entry.closed && entry.activity?.routingOwnerId === ownerId && entry.activity.routingRef === routingRef) entry.control?.disableCursor();
        }
    }

    private controlId(entry: Entry): string { return `t${entry.ownerId}:${entry.viewId}`; }

    private scopedEntries(ownerId: number, workspaceId: string, routingRef?: string): Entry[] {
        const scope = this.controlScope(ownerId, workspaceId, routingRef);
        return [...this.owners.values()].flatMap(entries => [...entries.values()]).filter(entry =>
            !entry.closed && entry.sourceKind === 'url' && entry.sessionKey === scope.sessionKey);
    }

    /**
     * `hold` pauses the caller's own 60s deadline while a navigation of this conversation waits
     * for the user's approval; the per-view queue deadline pauses as well.
     */
    setHumanTakeoverEnabled(ownerId: number, routingRef: string, enabled: boolean): void {
        if (enabled) return;
        for (const item of this.takeovers.values()) if (item.ownerId === ownerId && item.control.owner.routingRef === routingRef) item.control.stop('Browser human takeover disabled');
    }

    private takeoverKey(ownerId: number, workspaceId: string, processId: string, routingRef: string): string {
        return JSON.stringify([ownerId, workspaceId, processId, routingRef]);
    }

    /** Registered renderer IPC is the only UI entry. Identity must match the exact retained turn. */
    async humanTakeover(ownerId: number, identity: BrowserTakeoverState, action: BrowserTakeoverAction, note?: string): Promise<void> {
        if (!identity || typeof identity !== 'object' || !['take', 'return', 'stop'].includes(action)) throw new TypeError('Invalid browser takeover');
        const item = this.takeovers.get(this.takeoverKey(ownerId, identity.workspaceId, identity.processId, identity.routingRef));
        if (!item || item.control.owner.turnId !== identity.turnId) throw new Error('Browser takeover owner or turn changed');
        if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) throw new TypeError('Browser handoff note exceeds 2000 characters');
        if (action === 'take') {
            if (!item.control.paused) item.beforeTakeover = new Map([...item.entries].map(entry => [entry, entry.controlStamp]));
            const taking = item.control.take();
            // Manual loads must not inherit agent site-approval holds.
            for (const entry of item.entries) this.nativeNavigationGate(entry);
            this.pruneNavigationChecks();
            await taking;
        } else if (action === 'stop') item.control.stop();
        else await item.control.returnToAgent(async () => {
            if (this.foregroundSessionKey(ownerId) !== identity.routingRef) throw new Error('foreground-required: Return to agent requires the owning workspace on screen');
            let refreshed: BrowserCommandResult | undefined;
            for (const entry of item.entries) {
                if (entry.closed || entry.takeover !== item.control) throw new Error('Browser takeover tab closed or owner changed');
                const context = await this.withControlPage(entry.ownerId, entry.viewId, entry.sessionKey, async page => {
                    const snapshot = await page.snapshot();
                    return { tab: this.controlId(entry), title: snapshot.title, url: snapshot.url, elements: snapshot.elements, ...page.frameMetadata() };
                }, undefined, true);
                if (!refreshed || entry === item.selected) refreshed = context;
            }
            item.refreshed = refreshed;
        }, note).finally(() => { for (const entry of item.entries) this.nativeNavigationGate(entry); });
    }

    async executeControl(ownerId: number, input: BrowserCommandRequest, signal?: AbortSignal, routingRef?: string, hold?: () => () => void): Promise<BrowserCommandResult> {
        const request = validateBrowserCommandRequest(input);
        const scope = this.controlScope(ownerId, request.workspaceId, routingRef);
        if (this.demos.capturing({ workspaceId: request.workspaceId, processId: request.processId, routingRef: scope.sessionKey })) throw new Error(BROWSER_DEMO_RECORDING_ERROR);
        const key = this.takeoverKey(ownerId, request.workspaceId, request.processId, scope.sessionKey);
        let item = this.takeovers.get(key);
        if (item && item.control.owner.turnId !== (request.turnId ?? request.processId)) {
            item.control.stop('Browser conversation turn has finished'); this.takeovers.delete(key); item = undefined;
        }
        if (item?.control.status === 'terminated') throw new Error('Browser human takeover continuation terminated');
        if (!request.humanTakeoverEnabled) {
            if (item?.control.paused) { item.control.stop('Browser human takeover disabled'); throw new Error('Browser human takeover disabled; continuation terminated'); }
            if (request.command.action === 'request_human') throw new Error('Browser human takeover unavailable or disabled');
            return this.executeControlUnpaused(ownerId, request, signal, scope.sessionKey, hold);
        }
        if (!item) {
            const control = new BrowserHumanTakeover({ workspaceId: request.workspaceId, processId: request.processId,
                turnId: request.turnId ?? request.processId, routingRef: scope.sessionKey }, state => {
                const live = this.takeovers.get(key);
                if (live) for (const entry of live.entries) {
                    this.nativeActivity(entry); this.nativeNavigationGate(entry);
                    // The human drives now, or the continuation ended: the AI cursor goes at once.
                    if (state.status !== 'agent' && state.status !== 'checking' && !entry.closed) entry.control?.removeCursor();
                }
                this.pruneNavigationChecks();
                if (state.status === 'terminated' && live) for (const [pendingKey, pending] of this.pendingHumanTabs) {
                    if (pending.control === live.control) this.pendingHumanTabs.delete(pendingKey);
                }
                this.options.send(ownerId, BROWSER_CONTROL_TAKEOVER_STATE_CHANNEL, { ...state, viewIds: [...(live?.entries ?? [])].map(entry => entry.viewId) });
            });
            item = { ownerId, control, entries: new Set(), beforeTakeover: new Map() }; this.takeovers.set(key, item);
        }
        const current = item;
        if (request.command.action === 'request_human') {
            if (!current.entries.size) throw new Error('Select a browser tab before requesting human assistance');
            const release = hold?.();
            try {
                if (!current.control.paused) current.beforeTakeover = new Map([...current.entries].map(entry => [entry, entry.controlStamp]));
                const taking = current.control.take(request.command.text?.slice(0, 2000));
                for (const entry of current.entries) this.nativeNavigationGate(entry);
                this.pruneNavigationChecks();
                await taking;
                await current.control.wait(signal);
                return { ...current.refreshed, handoffNote: current.control.note };
            } finally { release?.(); }
        }
        const target = request.command.action === 'select' ? request.command.tab : request.selectedTab;
        const entry = target ? this.scopedEntries(ownerId, request.workspaceId, routingRef).find(view => this.controlId(view) === target) : undefined;
        const stamp = entry && request.validateAfterTakeover ? current.beforeTakeover.get(entry) : entry?.controlStamp;
        const validate = async (validationSignal: AbortSignal) => {
            if (!entry || entry.closed || entry.takeover !== current.control || !stamp) throw new Error('stale-action: browser target validity unavailable; replan');
            try {
                await this.withControlPage(entry.ownerId, entry.viewId, entry.sessionKey, async page => {
                    if (await page.continuationStamp() !== stamp) throw new Error('stale-action: page or target changed during human takeover; replan');
                }, validationSignal);
            } finally { await entry.control?.settled(); }
        };
        return current.control.run(async commandSignal => {
            try {
                const result = await this.executeControlUnpaused(ownerId, request, commandSignal, scope.sessionKey, hold);
                commandSignal.throwIfAborted();
                return { ...result, ...(current.control.note ? { handoffNote: current.control.note } : {}) };
            } finally {
                // queue.run rejects promptly on abort; takeover readiness waits for actual engine settlement.
                await Promise.all([...current.entries].map(view => view.control?.settled()));
            }
        }, signal, hold, validate, request.validateAfterTakeover);
    }

    private async executeControlUnpaused(ownerId: number, input: BrowserCommandRequest, signal?: AbortSignal, routingRef?: string, hold?: () => () => void): Promise<BrowserCommandResult> {
        const request = validateBrowserCommandRequest(input);
        const scope = this.controlScope(ownerId, request.workspaceId, routingRef);
        const reservation = { workspaceId: request.workspaceId, processId: request.processId, routingRef: scope.sessionKey };
        if (this.demos.capturing(reservation)) throw new Error(BROWSER_DEMO_RECORDING_ERROR);
        const queues = new Set<BrowserControlQueue>();
        const commandHold: CommandHold | undefined = hold && { routingOwnerId: ownerId, workspaceId: request.workspaceId, processId: request.processId, hold };
        if (commandHold) {
            this.commandHolds.add(commandHold);
            for (const check of this.navigationChecks.values()) if (this.holdsCommand(check, commandHold)) check.releases.push(commandHold.hold());
        }
        const pendingKeys: string[] = [];
        this.demoControlReservations.add(reservation);
        try { return await this.runControl(ownerId, request, signal, scope.sessionKey, pendingKeys, queues); }
        finally {
            // Abort rejects the caller before CDP settles; admission must still await required releases.
            void Promise.all([...queues].map(queue => queue.settled())).then(() => this.demoControlReservations.delete(reservation));
            if (commandHold) this.commandHolds.delete(commandHold);
            for (const key of pendingKeys) {
                this.pendingActivity.delete(key);
                const [owner, viewId] = JSON.parse(key) as [number, string];
                const entry = this.entry(owner, viewId);
                if (entry) this.nativeNavigationGate(entry);
            }
            if (pendingKeys.length) this.pruneNavigationChecks();
        }
    }

    private async runControl(ownerId: number, request: BrowserCommandRequest, signal: AbortSignal | undefined, routingRef: string | undefined, pendingKeys: string[], queues: Set<BrowserControlQueue>): Promise<BrowserCommandResult> {
        signal?.throwIfAborted();
        if (this.finishedTurns.get(ownerId)?.has(request.turnId ?? request.processId)) throw new Error('Browser conversation turn has finished');
        const scope = this.controlScope(ownerId, request.workspaceId, routingRef);
        // Background reveals publish the tab without raising the window or changing its selection.
        const background = scope.background ? { background: true } : {};
        // Tabs another chat is recording stay out of reach, reads included.
        let entries = this.scopedEntries(ownerId, request.workspaceId, routingRef).filter(entry => !this.demos.recordingTab(entry.ownerId, entry.viewId));
        const command = request.command;
        if (command.action === 'tabs') {
            const tabs: BrowserControlTab[] = [];
            for (const entry of entries) {
                if (entry.takeover?.paused && entry.takeover !== this.takeovers.get(this.takeoverKey(ownerId, request.workspaceId, request.processId, scope.sessionKey))?.control) continue;
                const view = await entry.ready;
                signal?.throwIfAborted();
                if (entry.closed) continue;
                const state = view.snapshot();
                if (!validateBrowserUrl(state.url).ok) continue;
                tabs.push({ id: this.controlId(entry), title: state.title, url: state.url, engine: entry.engine });
            }
            return { tabs };
        }
        const target = command.action === 'select' ? command.tab : request.selectedTab;
        let entry = target ? entries.find(entry => this.controlId(entry) === target) : undefined;
        let created = false;
        // Select fails closed; open can replace a vanished remembered selection.
        if (target && !entry && command.action !== 'open') throw new Error('Browser tab not found in this workspace');
        if (command.action === 'open' && (command.newTab || !entry)) {
            const viewId = `browser-${randomUUID()}`;
            const pendingKey = JSON.stringify([ownerId, viewId]);
            this.pendingActivity.set(pendingKey, { workspaceId: request.workspaceId, processId: request.processId, turnId: request.turnId ?? request.processId,
                routingRef: scope.sessionKey, viewId, active: true, routingOwnerId: ownerId });
            pendingKeys.push(pendingKey);
            const opened = this.open(ownerId, viewId, command.url!, scope.sessionKey);
            // Publish through the existing unified panel before Electron waits for guest adoption.
            this.options.send(ownerId, BROWSER_CONTROL_REVEAL_CHANNEL, {
                workspaceId: request.workspaceId, processId: request.processId, turnId: request.turnId, viewId, url: command.url, routingRef: scope.sessionKey, routingOwnerId: ownerId, ...background,
            });
            const result = await opened;
            if (!result.ok) throw new Error(result.message ?? result.reason);
            entries = this.scopedEntries(ownerId, request.workspaceId, routingRef);
            entry = entries.find(entry => entry.ownerId === ownerId && entry.viewId === viewId);
            created = true;
        }
        if (!entry) throw new Error('No browser tab selected; use tabs, select or open');
        const selected = entry;
        if (selected.control) queues.add(selected.control);
        const takeover = this.takeovers.get(this.takeoverKey(ownerId, request.workspaceId, request.processId, scope.sessionKey));
        if (selected.takeover?.paused && selected.takeover !== takeover?.control) throw new Error('Browser view is under exclusive human control');
        if (takeover && request.humanTakeoverEnabled) {
            for (const old of this.takeovers.values()) if (old.control === selected.takeover && old !== takeover) {
                old.entries.delete(selected);
                this.options.send(old.ownerId, BROWSER_CONTROL_TAKEOVER_STATE_CHANNEL, { ...old.control.state(), viewIds: [...old.entries].map(view => view.viewId) });
            }
            selected.takeover = takeover.control; takeover.entries.add(selected); takeover.selected = selected;
            this.options.send(ownerId, BROWSER_CONTROL_TAKEOVER_STATE_CHANNEL, { ...takeover.control.state(), viewIds: [...takeover.entries].map(view => view.viewId) });
        }

        if (!selected.popout) this.options.send(selected.ownerId, BROWSER_CONTROL_REVEAL_CHANNEL, {
            workspaceId: request.workspaceId, processId: request.processId, turnId: request.turnId, viewId: selected.viewId, routingOwnerId: ownerId,
            url: command.action === 'open' ? command.url : selected.view?.snapshot().url, routingRef: selected.sessionKey, ...background,
        });
        return this.withControlPage(selected.ownerId, selected.viewId, selected.sessionKey, async (page, activeSignal, view) => {
            if (this.demos.capturing({ workspaceId: request.workspaceId, processId: request.processId, routingRef: scope.sessionKey })) throw new Error(BROWSER_DEMO_RECORDING_ERROR);
            this.scopedEntries(ownerId, request.workspaceId, routingRef);
            activeSignal.throwIfAborted();
            this.activateControl(selected, ownerId, request, scope.background);
            await this.backgroundControl(selected, scope.background);
            activeSignal.throwIfAborted();
            await page.configureFrames(request.framesEnabled === true,
                view.onCdpEvent ? listener => view.onCdpEvent!(listener) : undefined,
                view.waitForCdpEvents ? () => view.waitForCdpEvents!() : undefined);
            // Also drawn for background tabs, so the last spot shows when the user switches back.
            page.setCursorOverlay(request.cursorOverlayEnabled === true);
            // Background tabs never take focus: input relies on CDP focus emulation instead.
            if (!scope.background && (selected.popout || command.action === 'click' || command.action === 'type'
                || command.action === 'select_option' || command.action === 'press'
                || command.action === 'scroll')) {
                await view.focus();
                activeSignal.throwIfAborted();
            }
            switch (command.action) {
                case 'paste_html': {
                    const clipboard = this.options.richClipboard;
                    if (!clipboard) throw new Error('unsupported-runtime: native rich clipboard unavailable');
                    // Native paste needs real window focus, which a background tab must not take.
                    if (scope.background) throw new Error('foreground-required: rich paste needs the workspace on screen');
                    await withRichClipboard(clipboard, command.html!, command.text!, command.replaceClipboard === true, activeSignal, async write => {
                        activeSignal.throwIfAborted();
                        await view.focus();
                        activeSignal.throwIfAborted();
                        await page.pasteHtml(command.ref!, write, activeSignal);
                    });
                    break;
                }
                case 'open':
                    if (!created && view.snapshot().url !== command.url) await view.navigate(command.url!);
                    break;
                case 'select': break;
                case 'frames': return { tab: this.controlId(selected), ...page.frameMetadata(command.offset) };
                case 'snapshot': {
                    const snapshot = await page.snapshot({ ref: command.ref, all: command.all });
                    const interactive = command.ref || command.all ? await page.snapshot() : snapshot;
                    return {
                        tab: this.controlId(selected), title: snapshot.title, url: snapshot.url,
                        elements: snapshot.elements, interactiveElements: interactive.elements,
                        ...page.frameMetadata(0, undefined, command.ref),
                    };
                }
                case 'read': {
                    return { tab: this.controlId(selected), ...await page.readPage(command.ref, command.offset ?? 0, command.frame),
                        ...page.frameMetadata(0, command.frame, command.ref) };
                }
                case 'eval': return { tab: this.controlId(selected), ...await page.evaluateForTool(command.js!, command.frame),
                    ...page.frameMetadata(0, command.frame) };
                case 'screenshot': {
                    const image = await page.screenshot(command.ref, command.format);
                    const { title, url } = view.snapshot();
                    return { tab: this.controlId(selected), title, url, image, ...page.frameMetadata(0, undefined, command.ref) };
                }
                case 'click': await page.click(command.ref!); break;
                case 'type': await page.type(command.ref!, command.text!, command.submit); break;
                case 'select_option': await page.selectOption(command.ref!, command.value!); break;
                case 'press': await page.press(command.key!, command.frame); break;
                case 'scroll': await page.scroll((command.direction ?? 'down') as 'up' | 'down' | 'left' | 'right', command.ref, command.frame); break;
                case 'navigate': await view.nav(command.direction as 'back' | 'forward' | 'reload'); break;
                case 'wait': await page.wait(command.text ?? command.ms!, activeSignal, command.frame); break;
            }
            activeSignal.throwIfAborted();
            await view.waitForControlReady?.(activeSignal);
            while (view.snapshot().loading) {
                await delay(25, undefined, { signal: activeSignal });
                activeSignal.throwIfAborted();
            }
            const snapshot = await page.snapshot();
            return { tab: this.controlId(selected), title: snapshot.title, url: snapshot.url, elements: snapshot.elements, ...page.frameMetadata() };
        }, signal);
    }

    private entry(ownerId: number, viewId: unknown): Entry | undefined {
        return isValidBrowserViewId(viewId) ? this.owners.get(ownerId)?.get(viewId) : undefined;
    }

    async preferences(): Promise<BrowserPreferences> {
        const engines = await Promise.all(Object.values(this.options.hosts).map(host => host.availability()));
        return {
            defaultEngine: this.options.getDefault(), engines, clearing: [...this.clearing],
            pageZoom: { percent: this.options.getPageZoom(), min: BROWSER_PAGE_ZOOM.min, max: BROWSER_PAGE_ZOOM.max, step: BROWSER_PAGE_ZOOM.step },
        };
    }

    setPageZoom(percent: unknown): Promise<BrowserOperationResult> {
        if (!isBrowserPageZoom(percent)) { return Promise.resolve({ ok: false, reason: 'invalid' }); }
        const update = this.zoomUpdate.then(async (): Promise<BrowserOperationResult> => {
            if (this.disposed) { return { ok: false, reason: 'busy' }; }
            try {
                this.options.savePageZoom(percent);
                const entries = [...this.owners.values()].flatMap(owner => [...owner.values()]);
                const results = await Promise.allSettled(entries.filter(entry => entry.sourceKind === 'url').map(async entry => {
                    const view = await entry.ready;
                    if (entry.closed) { return; }
                    if (!view.setPageZoom) { throw new BrowserHostError('unsupported', 'Web page zoom is unavailable for this browser engine.'); }
                    await view.setPageZoom(percent);
                }));
                throwRejected(results);
                return { ok: true };
            } catch (error) {
                return this.failure(error, 'runtime-crashed');
            } finally {
                this.options.changed();
            }
        });
        this.zoomUpdate = update;
        return update;
    }

    /** The window's SPA opts its web pages in or out of forwarding Ctrl/Cmd+1–9 and modifier holds. */
    setTabShortcuts(ownerId: number, enabled: boolean): void {
        if (enabled === this.tabShortcutOwners.has(ownerId)) return;
        if (enabled) this.tabShortcutOwners.add(ownerId);
        else this.tabShortcutOwners.delete(ownerId);
        for (const entry of this.owners.get(ownerId)?.values() ?? []) {
            if (entry.sourceKind !== 'url' || entry.popout) continue;
            // Apply the latest value, not this call's: toggles may race a view's startup.
            void entry.ready.then(view => entry.closed ? undefined : view.setTabShortcuts?.(this.tabShortcutOwners.has(ownerId)))
                .catch(error => console.error('[coc-desktop] Browser tab shortcut update failed:', error));
        }
    }

    async select(engine: unknown): Promise<BrowserOperationResult> {
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        const availability = await this.options.hosts[engine].availability();
        if (availability.reason === 'unsupported-platform') { return { ok: false, reason: availability.reason, message: availability.message }; }
        try {
            this.options.saveDefault(engine);
            this.options.changed();
            return { ok: true };
        } catch (error) {
            return this.failure(error, 'startup-failed');
        }
    }

    /** Open any source: `file` always goes to the file host, whatever `relatedEngine` says. */
    openSource(ownerId: number, viewId: unknown, source: unknown, sessionKey: unknown, relatedEngine?: unknown): Promise<BrowserOpenResult> {
        const checked = toBrowserSource(source);
        if ('ok' in checked) { return Promise.resolve(checked); }
        return checked.kind === 'file'
            ? this.openFile(ownerId, viewId, checked.path, sessionKey)
            : this.open(ownerId, viewId, checked.url, sessionKey, relatedEngine);
    }

    async open(ownerId: number, viewId: unknown, url: unknown, sessionKey: unknown, relatedEngine?: unknown): Promise<BrowserOpenResult> {
        if (!isValidBrowserViewId(viewId)) { return { ok: false, reason: 'bad-id' }; }
        if (!isValidBrowserSessionKey(sessionKey)) { return { ok: false, reason: 'bad-session' }; }
        const check = validateBrowserUrl(url);
        if (!check.ok) { return check; }
        if (relatedEngine !== undefined && !isBrowserEngine(relatedEngine)) { return { ok: false, reason: 'bad-engine' }; }
        const entry = this.entry(ownerId, viewId);
        if (entry && entry.sessionKey !== sessionKey) { return { ok: false, reason: 'bad-session' }; }
        if (entry && entry.sourceKind !== 'url') { return { ok: false, reason: 'bad-id' }; }
        let engine: BrowserEngine;
        try {
            engine = entry?.engine ?? (isBrowserEngine(relatedEngine) ? relatedEngine : this.options.getDefault());
        } catch (error) {
            return this.failure(error, 'startup-failed');
        }
        if (this.disposed || this.clearing.has(engine)) { return { ok: false, engine, reason: 'busy', message: 'Browser data is being cleared. Try again when cleanup finishes.' }; }
        const create = (e: Entry) => this.createUrl(e, check.url);
        return this.attach(entry ?? this.add({ ownerId, viewId, sessionKey, engine, sourceKind: 'url' }, create), create);
    }

    /** Open a local HTML preview in the file host. The engine preference and cleanup never apply. */
    async openFile(ownerId: number, viewId: unknown, filePath: unknown, sessionKey: unknown): Promise<BrowserOpenResult> {
        if (!isValidBrowserViewId(viewId)) { return { ok: false, reason: 'bad-id' }; }
        if (!isValidBrowserSessionKey(sessionKey)) { return { ok: false, reason: 'bad-session' }; }
        const check = validateHtmlPagePath(filePath);
        if (!check.ok) { return check; }
        let entry = this.entry(ownerId, viewId);
        if (entry && entry.sessionKey !== sessionKey) { return { ok: false, reason: 'bad-session' }; }
        if (entry && entry.sourceKind !== 'file') { return { ok: false, reason: 'bad-id' }; }
        if (this.disposed) { return { ok: false, engine: 'electron', reason: 'busy', message: 'The desktop browser is shutting down.' }; }
        if (entry && entry.path !== check.path) {
            await this.closeEntry(entry);
            entry = undefined;
        }
        const create = (e: Entry) => this.start(e, sink => this.options.fileHost.create({ ownerId, viewId: e.viewId, sessionKey, path: check.path }, sink));
        return this.attach(entry ?? this.add({ ownerId, viewId, sessionKey, engine: 'electron', sourceKind: 'file', path: check.path }, create), create);
    }

    private add(init: Pick<Entry, 'ownerId' | 'viewId' | 'sessionKey' | 'engine' | 'sourceKind' | 'path'>, create: (entry: Entry) => Promise<BrowserHostedView>): Entry {
        let entries = this.owners.get(init.ownerId);
        if (!entries) { entries = new Map(); this.owners.set(init.ownerId, entries); }
        const entry = { ...init, closed: false } as Entry;
        const pendingKey = JSON.stringify([init.ownerId, init.viewId]);
        const inherited = this.pendingHumanTabs.get(pendingKey);
        this.pendingHumanTabs.delete(pendingKey);
        if (inherited && inherited.sessionKey === init.sessionKey && inherited.control.status !== 'terminated') {
            entry.takeover = inherited.control;
            for (const item of this.takeovers.values()) if (item.control === inherited.control) {
                item.entries.add(entry);
                this.options.send(item.ownerId, BROWSER_CONTROL_TAKEOVER_STATE_CHANNEL, { ...item.control.state(), viewIds: [...item.entries].map(view => view.viewId) });
            }
        }
        entry.ready = Promise.resolve().then(() => create(entry));
        if (entry.sourceKind === 'url') {
            void entry.ready.then(() => this.demos.tabReady(init.ownerId, init.viewId), () => this.demos.tabClosed(init.ownerId, init.viewId))
                .catch(error => console.error('[coc-desktop] Browser demo tab capture failed:', error));
            entry.control = new BrowserControlQueue((method, params, sessionId) => {
                if (entry.closed || this.disposed) throw new BrowserHostError('not-found', 'Browser tab closed');
                if (!entry.view?.cdp) throw new BrowserHostError('unsupported', 'Browser control is unavailable for this view');
                return sessionId === undefined ? entry.view.cdp(method, params) : entry.view.cdp(method, params, sessionId);
            });
        }
        entries.set(init.viewId, entry);
        return entry;
    }

    /** Start a new or failed view, or replay a live one's state. */
    private async attach(entry: Entry, create: (entry: Entry) => Promise<BrowserHostedView>): Promise<BrowserOpenResult> {
        const engine = entry.engine;
        if (entry.startupFailed) {
            entry.startupFailed = false;
            entry.ready = Promise.resolve().then(() => create(entry));
        }
        try {
            const view = await entry.ready;
            if (entry.closed) { return { ok: false, engine, reason: 'not-found' }; }
            this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, view.snapshot()));
            return {
                ok: true, engine, sourceKind: entry.sourceKind,
                ...(view.embed ? { embed: view.embed, src: view.src, partition: view.partition } : {}),
            };
        } catch (error) {
            // Failed startup keeps its selected engine but permits an explicit open retry.
            entry.startupFailed = true;
            return { ...this.failure(error, 'startup-failed'), engine };
        }
    }

    private state(entry: Entry, state: BrowserViewState): BrowserViewState {
        const committedPage = entry.sourceKind === 'url' && !state.loading && !state.error
            && entry.committedPage?.url === state.url ? entry.committedPage : undefined;
        // File previews never carry icons; web icons are re-validated before they reach the SPA.
        const favicon = entry.sourceKind === 'url' && !state.error && validBrowserFavicon(state.favicon) ? state.favicon : undefined;
        return { ...state, committedPage, favicon, engine: entry.engine, viewId: entry.viewId, sourceKind: entry.sourceKind };
    }

    private async createUrl(entry: Entry, url: string): Promise<BrowserHostedView> {
        if (entry.closed) { throw new BrowserHostError('not-found', 'Browser tab closed during startup.'); }
        const host = this.options.hosts[entry.engine];
        const availability = await host.availability();
        if (!availability.available) { throw new BrowserHostError(availability.reason ?? 'startup-failed', availability.message ?? 'Browser engine unavailable.'); }
        return this.start(entry, sink => host.create({
            ownerId: entry.ownerId, viewId: entry.viewId, sessionKey: entry.sessionKey, url,
            pageZoomPercent: this.options.getPageZoom(),
            ...(this.options.clickOnce?.enabled() ? { clickOnceEnabled: true } : {}),
            ...(this.gateActivity(entry) ? { navigationGate: true } : {}),
        }, sink));
    }

    private async start(entry: Entry, create: (sink: BrowserEventSink) => Promise<BrowserHostedView>): Promise<BrowserHostedView> {
        if (entry.closed) { throw new BrowserHostError('not-found', 'Browser tab closed during startup.'); }
        let applicationPending = false;
        const generation = entry.hostGeneration = {};
        const view = await create({
            application: (request, current) => {
                if (entry.sourceKind !== 'url' || applicationPending || !this.options.clickOnce) return;
                const live = () => !this.disposed && !entry.closed && entry.hostGeneration === generation && this.entry(entry.ownerId, entry.viewId) === entry && current();
                applicationPending = true;
                void dispatchClickOnce(this.options.clickOnce, request, live, entry.ownerId).then(result => {
                    if (live() && result === 'disabled') this.options.clickOnce!.report(entry.ownerId, 'ClickOnce is disabled. Enable it in Desktop Preferences and open a new tab.');
                    if (live() && result === 'cancelled') this.options.clickOnce!.report(entry.ownerId, 'ClickOnce activation was cancelled.');
                }).catch(error => {
                    // URLs and native diagnostics are deliberately excluded.
                    console.error('[coc-desktop] ClickOnce activation failed.');
                    if (live()) this.options.clickOnce!.report(entry.ownerId, error instanceof ClickOnceError ? error.message : 'ClickOnce activation failed.');
                }).finally(() => { applicationPending = false; });
            },
            state: state => {
                if (entry.closed) return;
                if (state.error) entry.committedPage = undefined;
                if (state.errorCode === 'runtime-crashed') {
                    this.demos.crashed(entry.ownerId, entry.viewId);
                    entry.takeover?.stop('Browser runtime crashed during human takeover');
                    this.clearControlEntry(entry, false);
                    entry.control?.cancel(new BrowserHostError('runtime-crashed', state.error || 'Browser tab crashed'));
                }
                this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, state));
            },
            navigationStarted: () => {
                if (entry.closed) return;
                entry.committedPage = undefined;
                if (entry.view) this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, entry.view.snapshot()));
            },
            documentCommitted: (url, title) => {
                if (entry.closed || entry.sourceKind !== 'url') return;
                entry.commitRevision = (entry.commitRevision ?? 0) + 1;
                entry.committedPage = validateBrowserUrl(url).ok ? { url, title, revision: entry.commitRevision } : undefined;
                if (entry.view) this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, entry.view.snapshot()));
            },
            documentTitleUpdated: (url, title) => {
                if (entry.closed || entry.sourceKind !== 'url' || entry.committedPage?.url !== url) return;
                entry.committedPage = { ...entry.committedPage, title };
                if (entry.view) this.options.send(entry.ownerId, BROWSER_VIEW_STATE_CHANNEL, this.state(entry, entry.view.snapshot()));
            },
            visited: (url, title, sourceViewId) => {
                if (!entry.closed && entry.sourceKind === 'url') {
                    const source = sourceViewId ? this.entry(entry.ownerId, sourceViewId) : entry;
                    if (source && !source.closed && source.sessionKey === entry.sessionKey) {
                        this.demos.navigated(entry.ownerId, source.viewId, url, title);
                    }
                    void this.options.history.recordVisit(entry.engine, url, title)
                        .catch(error => console.error('[coc-desktop] Browser history save failed:', error));
                }
            },
            titleUpdated: (url, title) => {
                if (!entry.closed && entry.sourceKind === 'url') {
                    void this.options.history.updateTitle(entry.engine, url, title)
                        .catch(error => console.error('[coc-desktop] Browser history title save failed:', error));
                }
            },
            newTab: (target, openerViewId) => {
                if (!entry.closed && validateBrowserUrl(target).ok) {
                    const opener = openerViewId ? this.entry(entry.ownerId, openerViewId) : entry;
                    if (!opener || opener.closed || opener.sessionKey !== entry.sessionKey) return;
                    let viewId: string | undefined;
                    if (entry.takeover?.paused) {
                        if (this.pendingHumanTabs.size >= 128) return;
                        viewId = `browser-${randomUUID()}`;
                        this.pendingHumanTabs.set(JSON.stringify([entry.ownerId, viewId]), { sessionKey: entry.sessionKey, control: entry.takeover });
                    }
                    // A recorded tab's child joins the recording under the id the SPA opens it with.
                    viewId = this.demos.reserveChild(entry.ownerId, opener.viewId, viewId) ?? viewId;
                    this.options.send(entry.ownerId, BROWSER_VIEW_NEW_TAB_CHANNEL, { openerViewId: entry.viewId, engine: entry.engine, url: target, ...(viewId ? { viewId } : {}) });
                }
            },
            focusAddressRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_FOCUS_ADDRESS_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
            },
            openMenuRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_OPEN_MENU_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
            },
            reopenClosedRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_REOPEN_CLOSED_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
            },
            tabShortcut: event => {
                if (!entry.closed && this.tabShortcutOwners.has(entry.ownerId)) {
                    this.options.send(entry.ownerId, BROWSER_VIEW_TAB_SHORTCUT_CHANNEL, { viewId: entry.viewId, ...event });
                }
            },
            closeRequested: () => {
                if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_CLOSE_REQUESTED_CHANNEL, { viewId: entry.viewId }); }
            },
            download: event => { if (!entry.closed) { this.options.send(entry.ownerId, BROWSER_VIEW_DOWNLOAD_CHANNEL, event); } },
            closed: () => { void this.closeEntry(entry, true).catch(error => console.error('[coc-desktop] Browser guest cleanup failed:', error)); },
            controlPopoutOpened: (viewId, view, openerViewId) => {
                if (entry.closed || entry.sourceKind !== 'url' || !isValidBrowserViewId(viewId) || !view.cdp) return;
                const opener = openerViewId ? this.entry(entry.ownerId, openerViewId) : entry;
                if (!opener || opener.closed || opener.sessionKey !== entry.sessionKey) return;
                const popout: Entry = {
                    ownerId: entry.ownerId, viewId, sessionKey: entry.sessionKey, engine: entry.engine,
                    sourceKind: 'url', closed: false, ready: Promise.resolve(view), view, popout: true,
                };
                popout.takeover = entry.takeover;
                for (const item of this.takeovers.values()) if (item.control === entry.takeover) item.entries.add(popout);
                popout.control = new BrowserControlQueue((method, params) => {
                    if (popout.closed || this.disposed) throw new Error('Browser popout closed');
                    return view.cdp!(method, params);
                });
                this.owners.get(entry.ownerId)?.set(viewId, popout);
                void this.demos.popupOpened(entry.ownerId, opener.viewId, viewId, view).catch(error => console.error('[coc-desktop] Browser demo popup capture failed:', error));
            },
            controlPopoutClosed: viewId => {
                const popout = this.entry(entry.ownerId, viewId);
                if (!popout?.popout) return;
                popout.takeover?.stop('Browser controlled popout closed');
                this.clearControlEntry(popout, false);
                popout.closed = true;
                this.pruneNavigationChecks();
                popout.control?.cancel(new Error('Browser popout closed'));
                this.owners.get(entry.ownerId)?.delete(viewId);
                void this.demos.tabClosed(entry.ownerId, viewId)
                    .catch(error => console.error('[coc-desktop] Browser demo popup cleanup failed:', error));
            },
            controlFocused: sourceViewId => {
                if (!entry.closed && entry.sourceKind === 'url') {
                    const source = sourceViewId ? this.entry(entry.ownerId, sourceViewId) : entry;
                    if (source && !source.closed && source.sessionKey === entry.sessionKey) this.demos.switched(entry.ownerId, source.viewId);
                    this.options.send(entry.ownerId, BROWSER_CONTROL_FOCUSED_CHANNEL, {});
                }
            },
            controlStopRequested: (viewId, turnId) => {
                const popout = this.entry(entry.ownerId, viewId);
                if (popout?.popout && !popout.closed) this.stopControl(popout, turnId);
            },
            navigationGate: (url, popoutViewId) => this.navigationGate(entry, url, popoutViewId),
        });
        if (entry.closed) {
            await view.close();
            throw new BrowserHostError('not-found', 'Browser tab closed during startup.');
        }
        entry.view = view;
        if (entry.sourceKind === 'url' && view.setPageZoom) {
            try { await view.setPageZoom(this.options.getPageZoom()); }
            catch (error) { await view.close(); entry.view = undefined; throw error; }
        }
        if (entry.sourceKind === 'url' && this.tabShortcutOwners.has(entry.ownerId)) {
            try { await view.setTabShortcuts?.(true); }
            catch (error) { console.error('[coc-desktop] Browser tab shortcut setup failed:', error); }
        }
        return view;
    }

    /** The control turn driving a view: its popout's, its own, or the `open` that is creating it. */
    private gateActivity(entry: Entry, popoutViewId?: string): ControlActivity | undefined {
        if (entry.takeover && entry.takeover.status !== 'agent') return undefined;
        const popout = popoutViewId === undefined ? undefined : this.entry(entry.ownerId, popoutViewId);
        if (popout?.popout && !popout.closed && popout.activity) return popout.activity;
        return entry.activity ?? this.pendingActivity.get(JSON.stringify([entry.ownerId, entry.viewId]));
    }

    /** Manual navigation passes; an agent-driven one waits for the routing window's server to decide. */
    private navigationGate(entry: Entry, url: string, popoutViewId?: string): boolean | Promise<boolean> {
        const activity = this.gateActivity(entry, popoutViewId);
        if (!activity || entry.sourceKind !== 'url' || !validateBrowserUrl(url).ok) return true;
        if (this.disposed || entry.closed) return false;
        const event: BrowserNavigationCheckEvent = { checkId: randomUUID(), workspaceId: activity.workspaceId, processId: activity.processId,
            turnId: activity.turnId, routingRef: activity.routingRef, url };
        return new Promise<boolean>(resolve => {
            const check: NavigationCheck = { entry, popoutViewId, event, routingOwnerId: activity.routingOwnerId, resolve, releases: [] };
            if (entry.control) check.releases.push(entry.control.hold());
            const popout = popoutViewId === undefined ? undefined : this.entry(entry.ownerId, popoutViewId);
            if (popout?.control) check.releases.push(popout.control.hold());
            for (const commandHold of this.commandHolds) if (this.holdsCommand(check, commandHold)) check.releases.push(commandHold.hold());
            this.navigationChecks.set(event.checkId, check);
            this.options.send(activity.routingOwnerId, BROWSER_CONTROL_NAVIGATION_CHECK_CHANNEL, event);
        });
    }

    private holdsCommand(check: NavigationCheck, hold: CommandHold): boolean {
        return hold.routingOwnerId === check.routingOwnerId && hold.workspaceId === check.event.workspaceId && hold.processId === check.event.processId;
    }

    private settleNavigation(check: NavigationCheck, allow: boolean): void {
        if (this.navigationChecks.get(check.event.checkId) !== check) return;
        this.navigationChecks.delete(check.event.checkId);
        for (const release of check.releases) release();
        check.resolve(allow);
    }

    /** Only the window that received a check can answer it. */
    decideNavigation(ownerId: number, checkId: unknown, allow: unknown): void {
        const check = typeof checkId === 'string' ? this.navigationChecks.get(checkId) : undefined;
        if (check && check.routingOwnerId === ownerId && typeof allow === 'boolean') this.settleNavigation(check, allow);
    }

    /** A held navigation whose tab closed or whose turn ended is blocked. */
    private pruneNavigationChecks(): void {
        for (const check of [...this.navigationChecks.values()]) {
            const current = this.gateActivity(check.entry, check.popoutViewId);
            if (this.disposed || check.entry.closed || current?.turnId !== check.event.turnId || current.processId !== check.event.processId) {
                this.settleNavigation(check, false);
            }
        }
    }

    async adopt(ownerId: number, viewId: unknown, guestId: unknown): Promise<BrowserOperationResult> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed || typeof guestId !== 'number' || !Number.isSafeInteger(guestId)) { return { ok: false, reason: 'not-found' }; }
        try {
            const view = await entry.ready;
            if (entry.closed || !view.adopt) { return { ok: false, reason: 'not-found' }; }
            await view.adopt(guestId);
            return { ok: true };
        } catch (error) { return this.failure(error, 'not-found'); }
    }

    async importCookies(ownerId: number, viewId: unknown, domain: unknown, input: unknown, relatedEngine?: unknown): Promise<BrowserCookieImportResult> {
        const entry = this.entry(ownerId, viewId);
        // Null explicitly requests the profile without a page. Unknown view ids never fall back.
        if (viewId !== null && (!entry || entry.closed)) return { ok: false, reason: 'not-found' };
        if (entry && entry.sourceKind !== 'url') return { ok: false, reason: 'unsupported' };
        if (relatedEngine !== undefined && !isBrowserEngine(relatedEngine)) return { ok: false, reason: 'bad-engine' };
        let engine: BrowserEngine;
        try { engine = entry?.engine ?? (isBrowserEngine(relatedEngine) ? relatedEngine : this.options.getDefault()); }
        catch { return { ok: false, reason: 'bad-engine' }; }
        if (this.disposed || this.clearing.has(engine)) return { ok: false, reason: 'busy' };
        let cookies;
        try { cookies = parseBrowserCookies(domain, input); }
        catch (error) { return this.failure(error, 'invalid'); }
        const operation = (async (): Promise<BrowserCookieImportResult> => {
            try {
                if (entry) {
                    const view = await entry.ready;
                    if (entry.closed || this.disposed) return { ok: false, reason: 'not-found' };
                    if (!view.importCookies) return { ok: false, reason: 'unsupported' };
                    await view.importCookies(cookies);
                } else {
                    const host = this.options.hosts[engine];
                    const availability = await host.availability();
                    if (!availability.available) return { ok: false, reason: availability.reason ?? 'startup-failed', message: availability.message };
                    if (this.disposed) return { ok: false, reason: 'busy' };
                    if (!host.importCookies) return { ok: false, reason: 'unsupported' };
                    await host.importCookies(cookies);
                }
                return { ok: true, count: cookies.length };
            } catch {
                // Engine errors can contain cookie values. Never return them to the renderer or logs.
                return { ok: false, reason: 'invalid', message: 'Cookie import failed. Some cookies may have been added. Check the fields and retry.' };
            }
        })();
        const pending = this.imports.get(engine) ?? new Set<Promise<BrowserCookieImportResult>>();
        this.imports.set(engine, pending);
        pending.add(operation);
        try { return await operation; } finally { pending.delete(operation); }
    }

    /**
     * Read-only site information for the exact owner/view/session. It describes the committed
     * document, never an address draft, and is refused once a newer document or failure replaces it.
     */
    async siteInfo(ownerId: number, viewId: unknown, sessionKey: unknown): Promise<BrowserSiteInfoResult> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed || entry.popout || this.disposed) return { ok: false, reason: 'not-found' };
        if (!isValidBrowserSessionKey(sessionKey) || entry.sessionKey !== sessionKey) return { ok: false, reason: 'bad-session' };
        let view: BrowserHostedView;
        try { view = await entry.ready; } catch (error) { return this.failure(error, 'not-found'); }
        if (entry.closed || this.disposed) return { ok: false, reason: 'not-found' };
        const state = view.snapshot();
        const host = (() => { try { return new URL(state.url).hostname; } catch { return ''; } })();
        if (entry.sourceKind === 'file') {
            return { ok: true, info: { viewId: entry.viewId, engine: entry.engine, sourceKind: 'file', url: state.url, host,
                connection: 'local-file', cookies: { available: false, reason: 'not-applicable' } } };
        }
        const committed = this.state(entry, state).committedPage;
        let facts: BrowserSiteFacts | undefined;
        try { facts = await view.siteFacts?.(committed?.url); }
        catch { facts = undefined; }
        const now = view.snapshot();
        if (entry.closed || this.disposed || now.url !== state.url || now.loading !== state.loading || now.error !== state.error
            || this.state(entry, now).committedPage?.revision !== committed?.revision) {
            return { ok: false, reason: 'busy', message: 'The page changed. Open site information again.' };
        }
        const connection: BrowserSiteConnection = state.loading ? 'loading'
            : state.error ? (facts?.certificateError ? 'certificate-error' : 'failed')
            : !committed ? 'unknown'
            : committed.url.startsWith('http:') ? 'insecure'
            : facts?.rejectsInvalidCertificates ? 'secure' : 'https-unverified';
        const info: BrowserSiteInfo = {
            viewId: entry.viewId, engine: entry.engine, sourceKind: 'url', url: committed?.url ?? state.url, host, connection,
            ...(connection === 'secure' && facts?.certificate ? { certificate: facts.certificate } : {}),
            cookies: !committed ? { available: false, reason: 'not-applicable' }
                : facts?.cookieCount !== undefined ? { available: true, count: facts.cookieCount }
                : { available: false, reason: view.siteFacts ? 'failed' : 'unsupported' },
            ...(committed ? { revision: committed.revision } : {}),
        };
        return { ok: true, info };
    }

    async navigate(ownerId: number, viewId: unknown, url: unknown): Promise<BrowserOpenResult> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed) { return { ok: false, reason: 'not-found' }; }
        // Previews only move by in-page links that pass the file policy.
        if (entry.sourceKind !== 'url') { return { ok: false, reason: 'unsupported', engine: entry.engine }; }
        const check = validateBrowserUrl(url);
        if (!check.ok) { return { ...check, engine: entry.engine }; }
        try {
            await (await entry.ready).navigate(check.url);
            return { ok: true, engine: entry.engine };
        } catch (error) { return { ...this.failure(error, 'runtime-crashed'), engine: entry.engine }; }
    }

    async command(ownerId: number, viewId: unknown, command: (view: BrowserHostedView) => void | Promise<void>): Promise<void> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed) { return; }
        try {
            const view = await entry.ready;
            if (!entry.closed) { await command(view); }
        } catch (error) {
            if (!entry.closed) { this.options.send(ownerId, BROWSER_VIEW_STATE_CHANNEL, {
                viewId: entry.viewId, engine: entry.engine, sourceKind: entry.sourceKind, url: entry.view?.snapshot().url ?? '', title: '',
                canGoBack: false, canGoForward: false, loading: false,
                error: error instanceof Error ? error.message : String(error), errorCode: this.failure(error, 'runtime-crashed').reason,
            }); }
        }
    }

    /** Internal main-process control path; unlike UI commands, results and errors reach the caller. */
    async withControlPage<T>(
        ownerId: number, viewId: unknown, sessionKey: unknown,
        operation: (page: BrowserControlPage, signal: AbortSignal, view: BrowserHostedView) => Promise<T>, signal?: AbortSignal, privateRefresh = false,
    ): Promise<T> {
        const entry = this.entry(ownerId, viewId);
        if (!entry || entry.closed || this.disposed) throw new BrowserHostError('not-found', 'Browser tab not found');
        if (!isValidBrowserSessionKey(sessionKey) || entry.sessionKey !== sessionKey) {
            throw new BrowserHostError('bad-session', 'Browser tab belongs to another workspace');
        }
        if (!entry.control) throw new BrowserHostError('unsupported', 'Browser control supports URL tabs only');
        return entry.control.run(async (page, commandSignal) => {
            const view = await entry.ready;
            commandSignal.throwIfAborted();
            if (!view.cdp) throw new BrowserHostError('unsupported', 'Browser control is unavailable for this view');
            await view.waitForControlReady?.(commandSignal);
            while (view.snapshot().loading) await delay(25, undefined, { signal: commandSignal });
            if (this.demos.recordingTab(entry.ownerId, entry.viewId)) throw new Error(BROWSER_DEMO_RECORDING_ERROR);
            if (entry.takeover?.paused && !privateRefresh) throw new Error('Browser actions and observation paused for human takeover');
            const result = await operation(page, commandSignal, view);
            commandSignal.throwIfAborted();
            if (entry.takeover && !privateRefresh) {
                // Uninspectable child frames make preservation unprovable, without changing a completed action's outcome.
                try { entry.controlStamp = await page.continuationStamp(); }
                catch { entry.controlStamp = undefined; }
            }
            commandSignal.throwIfAborted();
            return result;
        }, signal);
    }

    /** Hand a view's current page to the system: an http(s) page for `url` views, the previewed `file:` page for `file` views. */
    openExternal(ownerId: number, viewId: unknown, open: (url: string) => Promise<void>): Promise<void> {
        const sourceKind = this.entry(ownerId, viewId)?.sourceKind;
        return this.command(ownerId, viewId, view => {
            const url = view.snapshot().url;
            if (sourceKind === 'file' ? url.startsWith('file:') : validateBrowserUrl(url).ok) { return open(url); }
        });
    }

    nav(ownerId: number, viewId: unknown, action: BrowserNavAction): Promise<void> {
        return this.command(ownerId, viewId, view => view.nav(action));
    }

    bounds(ownerId: number, viewId: unknown, bounds: HtmlPageBounds | null): Promise<void> {
        return this.command(ownerId, viewId, view => view.setBounds(bounds));
    }

    async close(ownerId: number, viewId: unknown, notify = false): Promise<void> {
        const entry = this.entry(ownerId, viewId);
        if (entry) { await this.closeEntry(entry, notify); }
    }

    private async closeEntry(entry: Entry, notify = false): Promise<void> {
        if (!entry || entry.closed) { return; }
        entry.takeover?.stop('Browser controlled tab closed during human takeover');
        this.clearControlEntry(entry, false);
        entry.closed = true;
        this.pruneNavigationChecks();
        entry.control?.cancel(new BrowserHostError('not-found', 'Browser tab closed'));
        const current = this.owners.get(entry.ownerId);
        if (current?.get(entry.viewId) === entry) { current.delete(entry.viewId); }
        const demoClosed = this.demos.tabClosed(entry.ownerId, entry.viewId);
        if (notify) { this.options.send(entry.ownerId, BROWSER_VIEW_CLOSED_CHANNEL, { viewId: entry.viewId, engine: entry.engine }); }
        // Startup is allowed to finish; create() then closes the partial view itself.
        const view = await entry.ready.catch(error => {
            if (!(error instanceof BrowserHostError)) { console.error('[coc-desktop] Browser startup failed while closing:', error); }
            return undefined;
        });
        await demoClosed;
        if (view) { await view.close(); }
    }

    async closeOwner(ownerId: number): Promise<void> {
        // Drafts go synchronously; the window's tab map must clear in this tick too, or a reload's reopen reuses it.
        const demos = this.demos.closeOwner(ownerId);
        for (const [key, item] of this.takeovers) if (item.ownerId === ownerId) { item.control.stop('Browser owner window disconnected'); this.takeovers.delete(key); }
        for (const key of this.pendingHumanTabs.keys()) if (JSON.parse(key)[0] === ownerId) this.pendingHumanTabs.delete(key);
        this.finishControl(ownerId);
        this.visibleControl.delete(ownerId);
        this.tabShortcutOwners.delete(ownerId);
        this.controlScopes.delete(ownerId);
        this.retainedScopes.delete(ownerId);
        const entries = this.owners.get(ownerId);
        this.owners.delete(ownerId);
        const results = await Promise.allSettled([demos, ...[...entries?.values() ?? []].map(entry => this.closeEntry(entry))]);
        throwRejected(results);
    }

    /** A full renderer reload destroys all guests; persisted tab descriptors may reopen fresh views. */
    async reloadOwner(ownerId: number): Promise<void> {
        await this.closeOwner(ownerId);
    }

    async clear(engine: unknown): Promise<BrowserOperationResult> {
        if (this.disposed) { return { ok: false, reason: 'busy', message: 'The desktop browser is shutting down.' }; }
        if (!isBrowserEngine(engine)) { return { ok: false, reason: 'bad-engine' }; }
        if (this.clearing.has(engine)) { return { ok: false, reason: 'busy' }; }
        this.clearing.add(engine);
        this.options.changed();
        try {
            await Promise.all([...this.imports.get(engine) ?? []]);
            const entries = [...this.owners.values()].flatMap(entries => [...entries.values()]).filter(entry => entry.engine === engine && entry.sourceKind === 'url');
            const results = await Promise.allSettled(entries.map(entry => this.close(entry.ownerId, entry.viewId, true)));
            throwRejected(results);
            await this.options.hosts[engine].clearData();
            await this.options.history.clearEngine(engine);
            return { ok: true };
        } catch (error) { return this.failure(error, 'cleanup-failed'); }
        finally { this.clearing.delete(engine); this.options.changed(); }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.pruneNavigationChecks();
        const closed = await Promise.allSettled([...this.owners.keys()].map(id => this.closeOwner(id)));
        const disposed = await Promise.allSettled([...Object.values(this.options.hosts), this.options.fileHost].map(host => host.dispose()));
        const history = await Promise.allSettled([this.options.history.flush()]);
        throwRejected([...closed, ...disposed, ...history]);
    }

    private failure(error: unknown, reason: BrowserFailureReason): { ok: false; reason: BrowserFailureReason; message: string } {
        return { ok: false, reason: error instanceof BrowserHostError ? error.reason : reason, message: error instanceof Error ? error.message : String(error) };
    }
}

import type { BrowserCommandRequest, BrowserNavigationPrompt, BrowserTakeoverState, ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { desktopBrowserBridge, type BrowserControlReveal, type BrowserControlActivityEvent } from './browser-bridge';
import { getSpaCocClient, getCocClientFor } from '../../api/cocClient';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isBrowserBackgroundControlEnabled, isBrowserControlEnabled } from '../../utils/config';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { lookupCloneBaseUrl } from '../../repos/cloneRegistry';
import { browserOpenInput } from '../../features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { openUnifiedPanelTab } from '../../features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { findBrowserPanelView } from '../../features/repo-detail/unified-right-panel/unifiedPanelStore';
import { attachBrowserWebview, setBrowserWebviewBackground } from '../../features/repo-detail/unified-right-panel/browserWebviewLayerStore';
import { getBrowserControlScope, subscribeBrowserControlScope } from './browser-control-scope';
import { startBrowserControlActivity, updateBrowserControlTab, finishBrowserControlActivity, resumeBrowserControlActivity, removeBrowserControlActivity } from './browser-control-activity';
import { clearBrowserControlNotice, setBrowserControlNotice } from './browser-control-notice';
import { setBrowserTakeover, clearBrowserTakeover } from './browser-takeover';
import { clearBrowserNavigationPrompt, setBrowserNavigationPrompt } from './browser-navigation-prompts';

/**
 * One relay on the existing socket; only the socket owning the selected clone advertises.
 * With background control on, scopes with active turns stay retained and served after a switch.
 * Background actions the desktop reports as `foreground-required:` wait, without a timeout,
 * behind a Switch back notice and re-run once that scope is the foreground scope again.
 * Navigations the desktop holds during a turn are asked of the owning server; its prompts
 * show in the conversation's chat and are blocked when the socket goes away.
 */
export function createBrowserSocketRelay(connection: Pick<ProcessWebSocketConnection, 'send'>, baseUrl?: string) {
    const control = desktopBrowserBridge()?.control;
    let routingRef: string | null = null;
    let workspaceId: string | null = null;
    let revision = 0;
    let connected = false;
    let disposed = false;
    let selectedRef: string | null = null;
    let ownerId: number | undefined;
    const handoffs = new Map<string, BrowserTakeoverState>();
    const paused = (ref: string) => [...handoffs.values()].some(state => state.routingRef === ref && !['agent', 'terminated'].includes(state.status));
    const controlled = new Map<string, { workspaceId: string; processId: string; routingRef: string; turnId?: string; routed?: boolean }>();
    /** Pending request id -> the routing ref it runs under. */
    const pending = new Map<string, string>();
    const framePending = new Set<string>();
    const frameRefs = new Set<string>();
    /** Background scopes retained on the desktop: routing ref -> workspace id. */
    const retained = new Map<string, string>();
    /** Routing ref -> the dashboard scope (workspace or repo group) to open on Switch back. */
    const panelScopes = new Map<string, string>();
    /** Requests waiting on Switch back; they keep their `pending` entry. */
    const waiting = new Map<string, { request: BrowserCommandRequest; ref: string }>();
    const noticeKey = (ref: string, request: BrowserCommandRequest) => JSON.stringify([baseUrl ?? '', ref, request.turnId ?? request.processId]);
    const ownerClient = () => baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient();
    const refreshNotice = (key: string) => {
        const entries = [...waiting.values()].filter(entry => noticeKey(entry.ref, entry.request) === key);
        if (!entries.length) { clearBrowserControlNotice(key); return; }
        const { request, ref } = entries[0];
        setBrowserControlNotice({
            key, workspaceId: request.workspaceId, processId: request.processId, routingRef: ref,
            actions: [...new Set(entries.map(entry => entry.request.command?.action ?? 'browser action'))],
            switchBack: () => {
                if (disposed) return;
                if (routingRef === ref) { rerunWaiting(); return; }
                const scope = panelScopes.get(ref) ?? ref;
                window.location.hash = `#repos/${encodeURIComponent(scope)}/chats/${encodeURIComponent(request.processId)}`;
            },
            stop: async () => { await ownerClient().processes.cancel(request.processId, { workspace: request.workspaceId }); },
        });
    };
    /** Rejects (when `error` is set) and forgets a waiting request. */
    const dropWaiting = (id: string, error?: string) => {
        const entry = waiting.get(id);
        if (!entry) return false;
        waiting.delete(id);
        pending.delete(id);
        framePending.delete(id);
        refreshNotice(noticeKey(entry.ref, entry.request));
        if (error && connected) connection.send({ type: 'browser-command-result', reply: { id, ok: false, error } });
        return true;
    };
    const dropWaitingTurn = (targetWorkspace: string, processId: string, turnId: string | undefined, error: string) => {
        for (const [id, entry] of [...waiting]) {
            if (entry.request.workspaceId === targetWorkspace && entry.request.processId === processId
                && (turnId === undefined || (entry.request.turnId ?? entry.request.processId) === turnId)) dropWaiting(id, error);
        }
    };
    /** Cancels pending work (desktop) or rejects it while it waits on Switch back. */
    const cancelRequest = (id: string, error = 'Browser workspace scope changed') => {
        if (dropWaiting(id, error)) return;
        control?.cancel(id);
        pending.delete(id);
        framePending.delete(id);
    };
    const backgroundOn = () => !!control?.retainScope && isBrowserBackgroundControlEnabled();
    const backgroundIds = () => [...retained].filter(([ref]) => ref !== routingRef).map(([, id]) => id);
    const track = (targetWorkspace: string, processId: string, ownerRef: string, tabId?: string, turnId?: string, routed?: boolean) => {
        const key = JSON.stringify([targetWorkspace, processId]);
        const previous = controlled.get(key);
        const activity = { workspaceId: targetWorkspace, processId, tabId, routingRef: ownerRef, sourceBaseUrl: baseUrl, turnId,
            routed: routed ?? (previous?.turnId === turnId && previous?.routed === true) };
        if (!startBrowserControlActivity(activity)) return false;
        controlled.set(key, activity);
        syncVisibility();
        return true;
    };
    const panelTabId = (wireTab: string | undefined, targetWorkspace: string | null, ref: string | null): string | undefined => {
        if (!wireTab || !targetWorkspace || !ref) return undefined;
        const match = /^t(\d+):(.+)$/.exec(wireTab);
        if (!match || ownerId !== undefined && Number(match[1]) !== ownerId) return undefined;
        return findBrowserPanelView(match[2], targetWorkspace, ref)?.tab.id;
    };
    const background = () => backgroundOn() || handoffs.size > 0 ? { background: backgroundIds() } : {};
    const advertise = (focused = document.hasFocus()) => {
        if (!connected) return;
        if (workspaceId) connection.send({ type: 'browser-capability', workspaceId, focused, ...(control?.humanTakeoverSupported ? { humanTakeoverSupported: true } : {}), ...background() });
        else if (backgroundOn() || handoffs.size > 0) connection.send({ type: 'browser-capability-clear', ...background() });
    };
    const focus = () => advertise();
    const offFocused = control?.onFocused?.(() => advertise(true));
    /** Retains every controlled scope other than the foreground one; never drops (see `releaseRetained`). */
    const retainControlled = (foreground: string | null) => {
        if ((!backgroundOn() && !handoffs.size) || !connected) return;
        for (const activity of controlled.values()) {
            if (!backgroundOn() && !paused(activity.routingRef)) continue;
            if (activity.routingRef === foreground || retained.has(activity.routingRef) || retained.size >= 64) continue;
            retained.set(activity.routingRef, activity.workspaceId);
            void control!.retainScope!(activity.routingRef, activity.workspaceId)
                .catch(error => console.warn('Could not retain desktop browser control scope:', error));
        }
    };
    /** Drops retained scopes without an active turn; their pending requests are cancelled. */
    const releaseRetained = (all = false) => {
        const live = new Set(all || !connected ? [] : [...controlled.values()].filter(activity => backgroundOn() || paused(activity.routingRef)).map(activity => activity.routingRef));
        if (!all && routingRef) live.delete(routingRef);
        let changed = false;
        for (const ref of [...retained.keys()]) {
            if (live.has(ref)) continue;
            retained.delete(ref);
            changed = true;
            for (const [id, owner] of [...pending]) if (owner === ref && owner !== routingRef) cancelRequest(id);
            void control?.retainScope?.(ref, null).catch(error => console.warn('Could not release desktop browser control scope:', error));
        }
        return changed;
    };
    const syncRetention = () => {
        if (disposed) return;
        retainControlled(routingRef);
        if (releaseRetained()) advertise();
    };
    window.addEventListener('focus', focus);
    const offReveal = control?.onReveal((event: BrowserControlReveal) => {
        if (disposed) return;
        const ownerRef = event.routingRef ?? routingRef;
        if (!ownerRef) return;
        const clone = parseRemoteCloneKey(ownerRef);
        if (baseUrl ? !clone || lookupCloneBaseUrl(ownerRef) !== baseUrl : clone) return;
        if ((clone?.workspaceId ?? ownerRef) !== event.workspaceId) return;
        if (!track(event.workspaceId, event.processId, ownerRef, undefined, event.turnId,
            event.routingOwnerId === undefined ? undefined : event.routingOwnerId === ownerId)) return;
        const existing = findBrowserPanelView(event.viewId, event.workspaceId, ownerRef);
        const scope = existing?.scope ?? (event.workspaceId === workspaceId ? getBrowserControlScope()?.panelScope : undefined) ?? ownerRef;
        const tabId = openUnifiedPanelTab(scope, existing ? {
            ...existing.tab, chatId: event.processId,
        } : {
            ...browserOpenInput({ ownerWorkspaceId: event.workspaceId, ownerRoutingRef: ownerRef, chatId: event.processId }, event.url),
            resourceId: event.viewId,
        });
        updateBrowserControlTab(event.workspaceId, event.processId, tabId, baseUrl);
        if (event.background === true) {
            // The owning panel is not mounted: create the guest here so the turn can drive it unseen.
            const bridge = desktopBrowserBridge();
            if (bridge?.adopt && event.url) attachBrowserWebview(event.viewId, event.url, ownerRef, bridge);
            setBrowserWebviewBackground(event.viewId, true);
        }
        if (!panelScopes.has(ownerRef)) panelScopes.set(ownerRef, scope);
        if (event.background !== true && event.workspaceId !== workspaceId && !window.location.hash.startsWith('#popout/')) {
            window.location.hash = `#repos/${encodeURIComponent(scope)}/chats/${encodeURIComponent(event.processId)}`;
        }
    });
    const matchesSource = (event: Pick<BrowserControlActivityEvent, 'routingRef' | 'workspaceId'>) => {
        const clone = parseRemoteCloneKey(event.routingRef);
        return (baseUrl ? !!clone && lookupCloneBaseUrl(event.routingRef) === baseUrl : !clone)
            && (clone?.workspaceId ?? event.routingRef) === event.workspaceId;
    };
    const offActivity = control?.onActivity?.(event => {
        if (disposed || !matchesSource(event)) return;
        setBrowserWebviewBackground(event.viewId, event.active && event.background === true);
        if (!event.active) {
            dropWaitingTurn(event.workspaceId, event.processId, event.turnId,
                event.finished === false ? 'Browser tab closed' : 'Browser conversation turn has finished');
            if (event.finished === false) removeBrowserControlActivity(event.workspaceId, event.processId, baseUrl, event.turnId);
            else finishBrowserControlActivity(event.workspaceId, event.processId, baseUrl, event.turnId);
            if (event.finished !== false && controlled.get(JSON.stringify([event.workspaceId, event.processId]))?.turnId === event.turnId) {
                controlled.delete(JSON.stringify([event.workspaceId, event.processId]));
                syncRetention();
            }
            return;
        }
        const tab = findBrowserPanelView(event.viewId, event.workspaceId, event.routingRef);
        if (tab) track(event.workspaceId, event.processId, event.routingRef, tab.tab.id, event.turnId,
            event.routingOwnerId === undefined ? undefined : event.routingOwnerId === ownerId);
    });
    /** Held desktop navigations this socket asked its server about. */
    const navigationChecks = new Set<string>();
    const promptKey = (checkId: string) => JSON.stringify([baseUrl ?? '', checkId]);
    const decideNavigation = (checkId: string, allow: boolean) => {
        if (!navigationChecks.delete(checkId)) return;
        clearBrowserNavigationPrompt(promptKey(checkId));
        control?.decideNavigation?.(checkId, allow);
    };
    const blockNavigations = () => { for (const checkId of [...navigationChecks]) decideNavigation(checkId, false); };
    const offNavigationCheck = control?.onNavigationCheck?.(event => {
        if (disposed || !matchesSource(event)) return;
        if (!connected) { control.decideNavigation?.(event.checkId, false); return; }
        navigationChecks.add(event.checkId);
        connection.send({ type: 'browser-navigation-check', checkId: event.checkId, workspaceId: event.workspaceId,
            processId: event.processId, turnId: event.turnId, url: event.url });
    });
    const offTakeover = control?.onTakeover?.(state => {
        if (disposed || !matchesSource(state)) return;
        const key = JSON.stringify([state.workspaceId, state.processId]);
        handoffs.set(key, state);
        setBrowserTakeover(state);
        if (connected) connection.send({ type: 'browser-takeover-state', state });
        syncRetention();
        advertise();
    });
    const clearHandoffs = () => {
        for (const state of handoffs.values()) {
            void control?.setTakeoverPolicy?.(state.routingRef, false);
            clearBrowserTakeover(state.routingRef, state.processId);
        }
        handoffs.clear();
    };
    const stopping = new Set<string>();
    const offStop = control?.onStop?.(event => {
        if (!connected || !matchesSource(event) || stopping.has(event.turnId)) return;
        if (controlled.get(JSON.stringify([event.workspaceId, event.processId]))?.turnId !== event.turnId) return;
        stopping.add(event.turnId);
        const client = baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient();
        void client.processes.cancel(event.processId, { workspace: event.workspaceId }).then(() => {
            control.finish?.(event.turnId);
            finishBrowserControlActivity(event.workspaceId, event.processId, baseUrl, event.turnId);
        }, () => console.warn('Could not stop browser control. Try again.')).finally(() => stopping.delete(event.turnId));
    });
    let visibilityRevision = 0;
    const visibilityRefs = new Set<string>();
    const visibilityScopes = () => {
        const scopes = new Map<string, string>();
        if (workspaceId && routingRef) scopes.set(routingRef, workspaceId);
        for (const activity of controlled.values()) scopes.set(activity.routingRef, activity.workspaceId);
        return scopes;
    };
    const syncVisibility = () => {
        const version = ++visibilityRevision;
        if (!control?.setVisible || disposed || !connected) return;
        const scopes = visibilityScopes();
        for (const ref of visibilityRefs) if (!scopes.has(ref)) {
            control.setVisible(false, ref);
            visibilityRefs.delete(ref);
        }
        const client = baseUrl ? getCocClientFor(baseUrl) : getSpaCocClient();
        for (const [ref, targetWorkspace] of scopes) {
            visibilityRefs.add(ref);
            if (!baseUrl && !isBrowserControlEnabled()) { control.setVisible(false, ref); continue; }
            void client.preferences.getLlmToolsConfig(targetWorkspace).then(config => {
                if (!disposed && connected && version === visibilityRevision) control.setVisible?.(
                    config.tools.some(tool => tool.name === 'browser') && !config.disabledLlmTools.includes('browser'), ref);
            }, () => { if (!disposed && connected && version === visibilityRevision) control.setVisible?.(false, ref); });
        }
    };
    syncVisibility();
    const onConfigUpdated = () => { syncVisibility(); syncRetention(); };
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
    const releaseFrames = (all = true) => {
        for (const ref of frameRefs) {
            if (!all && retained.has(ref)) continue;
            frameRefs.delete(ref);
            void control?.releaseFrames?.(ref).catch(error => console.warn('Could not release desktop browser frame control:', error));
        }
    };
    /** The server's cursor setting turned off: drawn AI cursors in its scopes go away now. */
    const removeCursors = () => {
        for (const ref of visibilityScopes().keys()) {
            void control?.removeCursors?.(ref).catch(error => console.warn('Could not remove the desktop AI cursor:', error));
        }
    };
    /** Cancels pending work; retained background scopes keep theirs unless `all`. */
    const cancelPending = (all = true) => {
        for (const [id, ref] of [...pending]) {
            if (!all && retained.has(ref)) continue;
            cancelRequest(id);
        }
        releaseFrames(all);
    };
    const clearActivities = () => {
        ++visibilityRevision;
        for (const ref of new Set([...visibilityRefs, ...visibilityScopes().keys()])) {
            control?.setVisible?.(false, ref);
            control?.finish?.(undefined, ref);
        }
        visibilityRefs.clear();
        for (const [key, activity] of controlled) {
            if (!control?.onActivity || activity.routed) {
                finishBrowserControlActivity(activity.workspaceId, activity.processId, baseUrl, activity.turnId);
                controlled.delete(key);
            } else if (disposed) {
                removeBrowserControlActivity(activity.workspaceId, activity.processId, baseUrl, activity.turnId);
                controlled.delete(key);
            }
        }
    };
    const run = (request: BrowserCommandRequest, ref: string) => {
        pending.set(request.id, ref);
        if (request.framesEnabled === true) { framePending.add(request.id); frameRefs.add(ref); }
        // Cancellation (switch, close, config change) removes the entry, so only live requests reply.
        const live = () => pending.get(request.id) === ref && connected && !waiting.has(request.id);
        void (backgroundOn() || request.humanTakeoverEnabled ? control!.execute(request, ref) : control!.execute(request)).then(
            result => {
                if (live()) {
                    const tabId = panelTabId(result.tab, request.workspaceId, ref) ?? result.tab;
                    if (tabId) updateBrowserControlTab(request.workspaceId, request.processId, tabId, baseUrl, request.turnId);
                    connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: true, result } });
                }
            },
            error => {
                if (!live()) return;
                const message = error instanceof Error ? error.message : String(error);
                if (ref !== routingRef && retained.has(ref) && message.includes('foreground-required:')) {
                    // Known not to run hidden: wait for Switch back; the server pauses its 60s limit.
                    waiting.set(request.id, { request, ref });
                    connection.send({ type: 'browser-command-waiting', id: request.id, waiting: true });
                    refreshNotice(noticeKey(ref, request));
                    return;
                }
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: message } });
            },
        ).finally(() => {
            if (waiting.has(request.id) || pending.get(request.id) !== ref) return;
            pending.delete(request.id);
            framePending.delete(request.id);
        });
    };
    /** Re-runs the requests waiting on the scope that just became the foreground scope. */
    function rerunWaiting() {
        if (!connected || disposed || !routingRef) return;
        for (const [id, entry] of [...waiting]) {
            if (entry.ref !== routingRef) continue;
            waiting.delete(id);
            refreshNotice(noticeKey(entry.ref, entry.request));
            connection.send({ type: 'browser-command-waiting', id, waiting: false });
            run(entry.request, entry.ref);
        }
    }
    const relay = {
        async update(selected: string | null) {
            selectedRef = selected;
            const ref = getBrowserControlScope()?.routingRef ?? selected;
            if (!control || disposed) return;
            const version = ++revision;
            const clone = parseRemoteCloneKey(ref);
            const matches = ref && (baseUrl ? clone && lookupCloneBaseUrl(ref) === baseUrl : !clone);
            // Retain the turns being switched away from before the desktop rebinds its foreground scope.
            retainControlled(matches ? ref : null);
            cancelPending(false);
            workspaceId = null;
            routingRef = null;
            connection.send({ type: 'browser-capability-clear', ...background() });
            if (!matches) { syncVisibility(); syncRetention(); return; }
            let scope: { ownerId: number } | void;
            try { scope = await control.bindScope(clone?.workspaceId ?? ref!, ref); }
            catch {
                console.warn('Could not bind desktop browser control scope; capability remains unavailable.');
                return;
            }
            if (version !== revision || disposed) return;
            routingRef = ref;
            workspaceId = clone?.workspaceId ?? ref;
            ownerId = scope?.ownerId;
            panelScopes.set(ref!, getBrowserControlScope()?.panelScope ?? ref!);
            syncVisibility();
            releaseRetained();
            advertise();
            rerunWaiting();
        },
        onOpen() { connected = true; syncVisibility(); retainControlled(routingRef); advertise(); },
        onClose() { connected = false; clearHandoffs(); cancelPending(); blockNavigations(); releaseRetained(true); clearActivities(); },
        onMessage(message: { type: string; [key: string]: unknown }): boolean {
            if (message.type === 'browser-takeover-policy' && message.enabled === false) { clearHandoffs(); return true; }
            if (message.type === 'browser-cursor-policy' && message.enabled === false) { removeCursors(); return true; }
            if (message.type === 'config-changed') {
                for (const id of [...framePending]) {
                    if (dropWaiting(id, 'Browser frame policy changed during command')) continue;
                    control?.cancel(id);
                    pending.delete(id);
                    connection.send({ type: 'browser-command-result', reply: { id, ok: false, error: 'Browser frame policy changed during command' } });
                }
                framePending.clear();
                releaseFrames();
                onConfigUpdated();
            }
            if (message.type === 'browser-turn-finished' && typeof message.turnId === 'string'
                && typeof message.workspaceId === 'string' && typeof message.processId === 'string') {
                const handoffKey = JSON.stringify([message.workspaceId, message.processId]);
                const handoff = handoffs.get(handoffKey);
                if (handoff?.turnId === message.turnId) { clearBrowserTakeover(handoff.routingRef, handoff.processId); handoffs.delete(handoffKey); }
                control?.finish?.(message.turnId);
                dropWaitingTurn(message.workspaceId, message.processId, message.turnId, 'Browser conversation turn has finished');
                finishBrowserControlActivity(message.workspaceId, message.processId, baseUrl, message.turnId);
                const key = JSON.stringify([message.workspaceId, message.processId]);
                if (controlled.get(key)?.turnId === message.turnId) { controlled.delete(key); syncRetention(); }
                return true;
            }
            if (message.type === 'process-updated') {
                const process = message.process as { id?: string; workspaceId?: string; status?: string } | undefined;
                if (process?.id && process.workspaceId) {
                    const activity = controlled.get(JSON.stringify([process.workspaceId, process.id]));
                    if (activity || process.workspaceId === workspaceId) {
                        if (process.status === 'running') resumeBrowserControlActivity(process.workspaceId, process.id, baseUrl);
                        else if (!control?.onActivity && ['completed', 'cancelled', 'failed', 'cancelling'].includes(process.status ?? '')) {
                            if (activity?.turnId) control?.finish?.(activity.turnId);
                            dropWaitingTurn(process.workspaceId, process.id, undefined, 'Browser conversation turn has finished');
                            finishBrowserControlActivity(process.workspaceId, process.id, baseUrl);
                            controlled.delete(JSON.stringify([process.workspaceId, process.id]));
                            syncRetention();
                        }
                    }
                }
            }
            if (message.type === 'browser-command-cancel') {
                if (typeof message.id === 'string' && !dropWaiting(message.id) && pending.has(message.id)) control?.cancel(message.id);
                return true;
            }
            if (message.type === 'browser-navigation-decision') {
                if (typeof message.checkId === 'string') decideNavigation(message.checkId, message.allow === true);
                return true;
            }
            if (message.type === 'browser-navigation-prompt') {
                const prompt = message.prompt as BrowserNavigationPrompt | undefined;
                if (!prompt || typeof prompt.checkId !== 'string' || !navigationChecks.has(prompt.checkId)) return true;
                setBrowserNavigationPrompt({
                    ...prompt, key: promptKey(prompt.checkId), sourceBaseUrl: baseUrl,
                    answer: answer => { if (connected) connection.send({ type: 'browser-navigation-answer', checkId: prompt.checkId, answer }); },
                });
                return true;
            }
            if (message.type === 'browser-navigation-prompt-cleared') {
                if (typeof message.checkId === 'string') clearBrowserNavigationPrompt(promptKey(message.checkId));
                return true;
            }
            if (message.type !== 'browser-command') return false;
            const request = message.request as BrowserCommandRequest | undefined;
            if (!request || typeof request.id !== 'string') return true;
            const backgroundRef = control && request.workspaceId !== workspaceId
                ? [...retained].find(([ref, id]) => ref !== routingRef && id === request.workspaceId)?.[0] : undefined;
            if (!control || !backgroundRef && (!workspaceId || request.workspaceId !== workspaceId)) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Browser workspace scope changed' } });
                return true;
            }
            if (request.framesEnabled !== undefined && typeof request.framesEnabled !== 'boolean') {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Invalid browser frame policy' } });
                return true;
            }
            if (request.framesEnabled === true && control.framesSupported !== true) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Unsupported desktop capability: browser frame control' } });
                return true;
            }
            if (request.humanTakeoverEnabled && control.humanTakeoverSupported !== true) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Unsupported desktop capability: browser human takeover' } }); return true;
            }
            if (request.command?.action === 'paste_html' && (control.richPasteSupported !== true || request.richPasteEnabled !== true)) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Unsupported or disabled desktop rich paste capability' } });
                return true;
            }
            if (request.framesEnabled !== true && (request.command?.action === 'frames' || request.command?.frame !== undefined)) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Browser frame control is disabled' } });
                return true;
            }
            if (pending.has(request.id)) return true;
            const targetedTab = request.command?.action === 'select' ? request.command.tab : request.selectedTab;
            const ref = backgroundRef ?? routingRef!;
            if (!control.onActivity && !track(request.workspaceId, request.processId, ref, panelTabId(targetedTab, request.workspaceId, ref) ?? targetedTab, request.turnId)) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Browser conversation turn has finished' } });
                return true;
            }
            if (control.onActivity) controlled.set(JSON.stringify([request.workspaceId, request.processId]), {
                workspaceId: request.workspaceId, processId: request.processId, routingRef: ref, turnId: request.turnId, routed: true,
            });
            run(request, ref);
            syncVisibility();
            return true;
        },
        dispose() {
            disposed = true;
            clearHandoffs();
            ++revision;
            cancelPending();
            blockNavigations();
            releaseRetained(true);
            clearActivities();
            if (control) connection.send({ type: 'browser-capability-clear' });
            offReveal?.();
            offFocused?.();
            offActivity?.();
            offStop?.();
            offNavigationCheck?.();
            offTakeover?.();
            window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, onConfigUpdated);
            window.removeEventListener('focus', focus);
            unsubscribeScope();
        },
    };
    const unsubscribeScope = subscribeBrowserControlScope(() => { void relay.update(selectedRef); });
    return relay;
}

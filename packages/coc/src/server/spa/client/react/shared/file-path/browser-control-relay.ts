import type { BrowserCommandRequest, ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { desktopBrowserBridge, type BrowserControlReveal, type BrowserControlActivityEvent } from './browser-bridge';
import { getSpaCocClient, getCocClientFor } from '../../api/cocClient';
import { DASHBOARD_CONFIG_UPDATED_EVENT, isBrowserControlEnabled } from '../../utils/config';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { lookupCloneBaseUrl } from '../../repos/cloneRegistry';
import { browserOpenInput } from '../../features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { openUnifiedPanelTab } from '../../features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { findBrowserPanelView } from '../../features/repo-detail/unified-right-panel/unifiedPanelStore';
import { getBrowserControlScope, subscribeBrowserControlScope } from './browser-control-scope';
import { startBrowserControlActivity, updateBrowserControlTab, finishBrowserControlActivity, resumeBrowserControlActivity, removeBrowserControlActivity } from './browser-control-activity';

/** One relay on the existing socket; only the socket owning the selected clone advertises. */
export function createBrowserSocketRelay(connection: Pick<ProcessWebSocketConnection, 'send'>, baseUrl?: string) {
    const control = desktopBrowserBridge()?.control;
    let routingRef: string | null = null;
    let workspaceId: string | null = null;
    let revision = 0;
    let connected = false;
    let disposed = false;
    let selectedRef: string | null = null;
    let ownerId: number | undefined;
    const controlled = new Map<string, { workspaceId: string; processId: string; routingRef: string; turnId?: string; routed?: boolean }>();
    const pending = new Set<string>();
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
    const panelTabId = (wireTab: string | undefined): string | undefined => {
        if (!wireTab || !workspaceId || !routingRef) return undefined;
        const match = /^t(\d+):(.+)$/.exec(wireTab);
        if (!match || ownerId !== undefined && Number(match[1]) !== ownerId) return undefined;
        return findBrowserPanelView(match[2], workspaceId, routingRef)?.tab.id;
    };
    const advertise = () => {
        if (connected && workspaceId) connection.send({ type: 'browser-capability', workspaceId, focused: document.hasFocus() });
    };
    const focus = () => advertise();
    const offFocused = control?.onFocused?.(() => {
        if (connected && workspaceId) connection.send({ type: 'browser-capability', workspaceId, focused: true });
    });
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
        if (event.workspaceId !== workspaceId && !window.location.hash.startsWith('#popout/')) {
            window.location.hash = `#repos/${encodeURIComponent(scope)}/chats/${encodeURIComponent(event.processId)}`;
        }
    });
    const matchesSource = (event: BrowserControlActivityEvent) => {
        const clone = parseRemoteCloneKey(event.routingRef);
        return (baseUrl ? !!clone && lookupCloneBaseUrl(event.routingRef) === baseUrl : !clone)
            && (clone?.workspaceId ?? event.routingRef) === event.workspaceId;
    };
    const offActivity = control?.onActivity?.(event => {
        if (disposed || !matchesSource(event)) return;
        if (!event.active) {
            if (event.finished === false) removeBrowserControlActivity(event.workspaceId, event.processId, baseUrl, event.turnId);
            else finishBrowserControlActivity(event.workspaceId, event.processId, baseUrl, event.turnId);
            if (event.finished !== false && controlled.get(JSON.stringify([event.workspaceId, event.processId]))?.turnId === event.turnId) {
                controlled.delete(JSON.stringify([event.workspaceId, event.processId]));
            }
            return;
        }
        const tab = findBrowserPanelView(event.viewId, event.workspaceId, event.routingRef);
        if (tab) track(event.workspaceId, event.processId, event.routingRef, tab.tab.id, event.turnId,
            event.routingOwnerId === undefined ? undefined : event.routingOwnerId === ownerId);
    });
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
    window.addEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, syncVisibility);
    const cancelPending = () => {
        for (const id of pending) control?.cancel(id);
        pending.clear();
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
    const relay = {
        async update(selected: string | null) {
            selectedRef = selected;
            const ref = getBrowserControlScope()?.routingRef ?? selected;
            if (!control || disposed) return;
            const version = ++revision;
            cancelPending();
            workspaceId = null;
            routingRef = null;
            connection.send({ type: 'browser-capability-clear' });
            const clone = parseRemoteCloneKey(ref);
            const matches = ref && (baseUrl ? clone && lookupCloneBaseUrl(ref) === baseUrl : !clone);
            if (!matches) { syncVisibility(); return; }
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
            syncVisibility();
            advertise();
        },
        onOpen() { connected = true; syncVisibility(); advertise(); },
        onClose() { connected = false; cancelPending(); clearActivities(); },
        onMessage(message: { type: string; [key: string]: unknown }): boolean {
            if (message.type === 'config-changed') syncVisibility();
            if (message.type === 'browser-turn-finished' && typeof message.turnId === 'string'
                && typeof message.workspaceId === 'string' && typeof message.processId === 'string') {
                control?.finish?.(message.turnId);
                finishBrowserControlActivity(message.workspaceId, message.processId, baseUrl, message.turnId);
                const key = JSON.stringify([message.workspaceId, message.processId]);
                if (controlled.get(key)?.turnId === message.turnId) controlled.delete(key);
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
                            finishBrowserControlActivity(process.workspaceId, process.id, baseUrl);
                            controlled.delete(JSON.stringify([process.workspaceId, process.id]));
                        }
                    }
                }
            }
            if (message.type === 'browser-command-cancel') {
                if (typeof message.id === 'string' && pending.has(message.id)) control?.cancel(message.id);
                return true;
            }
            if (message.type !== 'browser-command') return false;
            const request = message.request as BrowserCommandRequest | undefined;
            if (!request || typeof request.id !== 'string') return true;
            if (!control || !workspaceId || request.workspaceId !== workspaceId) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Browser workspace scope changed' } });
                return true;
            }
            if (pending.has(request.id)) return true;
            const targetedTab = request.command?.action === 'select' ? request.command.tab : request.selectedTab;
            if (!control.onActivity && !track(request.workspaceId, request.processId, routingRef!, panelTabId(targetedTab) ?? targetedTab, request.turnId)) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Browser conversation turn has finished' } });
                return true;
            }
            if (control.onActivity) controlled.set(JSON.stringify([request.workspaceId, request.processId]), {
                workspaceId: request.workspaceId, processId: request.processId, routingRef: routingRef!, turnId: request.turnId, routed: true,
            });
            pending.add(request.id);
            syncVisibility();
            const version = revision;
            void control.execute(request).then(
                result => {
                    if (pending.has(request.id) && version === revision && connected) {
                        const tabId = panelTabId(result.tab) ?? result.tab;
                        if (tabId) updateBrowserControlTab(request.workspaceId, request.processId, tabId, baseUrl, request.turnId);
                        connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: true, result } });
                    }
                },
                error => {
                    if (pending.has(request.id) && version === revision && connected) connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } });
                },
            ).finally(() => pending.delete(request.id));
            return true;
        },
        dispose() {
            disposed = true;
            ++revision;
            cancelPending();
            clearActivities();
            if (control) connection.send({ type: 'browser-capability-clear' });
            offReveal?.();
            offFocused?.();
            offActivity?.();
            offStop?.();
            window.removeEventListener(DASHBOARD_CONFIG_UPDATED_EVENT, syncVisibility);
            window.removeEventListener('focus', focus);
            unsubscribeScope();
        },
    };
    const unsubscribeScope = subscribeBrowserControlScope(() => { void relay.update(selectedRef); });
    return relay;
}

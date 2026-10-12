import type { BrowserCommandRequest, ProcessWebSocketConnection } from '@plusplusoneplusplus/coc-client';
import { desktopBrowserBridge, type BrowserControlReveal } from './browser-bridge';
import { parseRemoteCloneKey } from '../../repos/cloneIdentity';
import { lookupCloneBaseUrl } from '../../repos/cloneRegistry';
import { browserOpenInput } from '../../features/repo-detail/unified-right-panel/unifiedBrowserTabs';
import { openUnifiedPanelTab } from '../../features/repo-detail/unified-right-panel/unifiedPanelOpen';
import { findBrowserPanelView } from '../../features/repo-detail/unified-right-panel/unifiedPanelStore';
import { getBrowserControlScope, subscribeBrowserControlScope } from './browser-control-scope';
import { startBrowserControlActivity, updateBrowserControlTab, finishBrowserControlActivity, resumeBrowserControlActivity, clearBrowserControlActivities } from './browser-control-activity';

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
    const controlled = new Map<string, { workspaceId: string; processId: string; routingRef: string }>();
    const controlledWorkspaces = new Set<string>();
    const pending = new Set<string>();
    const track = (targetWorkspace: string, processId: string, ownerRef: string, tabId?: string) => {
        const activity = { workspaceId: targetWorkspace, processId, tabId, routingRef: ownerRef, sourceBaseUrl: baseUrl };
        if (!startBrowserControlActivity(activity)) return false;
        controlledWorkspaces.add(targetWorkspace);
        controlled.set(JSON.stringify([targetWorkspace, processId]), activity);
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
        const ownerRef = event.routingRef ?? routingRef;
        if (!ownerRef) return;
        const clone = parseRemoteCloneKey(ownerRef);
        if (baseUrl ? !clone || lookupCloneBaseUrl(ownerRef) !== baseUrl : clone) return;
        if ((clone?.workspaceId ?? ownerRef) !== event.workspaceId) return;
        if (!track(event.workspaceId, event.processId, ownerRef)) return;
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
    const cancelPending = () => {
        for (const id of pending) control?.cancel(id);
        pending.clear();
    };
    const clearActivities = () => {
        for (const workspace of controlledWorkspaces) clearBrowserControlActivities(workspace, baseUrl);
        controlled.clear();
        controlledWorkspaces.clear();
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
            if (!matches) return;
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
            advertise();
        },
        onOpen() { connected = true; advertise(); },
        onClose() { connected = false; cancelPending(); clearActivities(); },
        onMessage(message: { type: string; [key: string]: unknown }): boolean {
            if (message.type === 'process-updated') {
                const process = message.process as { id?: string; workspaceId?: string; status?: string } | undefined;
                if (process?.id && process.workspaceId) {
                    const activity = controlled.get(JSON.stringify([process.workspaceId, process.id]));
                    if (activity || process.workspaceId === workspaceId) {
                        if (process.status === 'running') resumeBrowserControlActivity(process.workspaceId, process.id, baseUrl);
                        else if (['completed', 'cancelled', 'failed', 'cancelling'].includes(process.status ?? '')) {
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
            if (!track(request.workspaceId, request.processId, routingRef!, panelTabId(targetedTab) ?? targetedTab)) {
                connection.send({ type: 'browser-command-result', reply: { id: request.id, ok: false, error: 'Browser conversation turn has finished' } });
                return true;
            }
            pending.add(request.id);
            const version = revision;
            void control.execute(request).then(
                result => {
                    if (pending.has(request.id) && version === revision && connected) {
                        const tabId = panelTabId(result.tab) ?? result.tab;
                        if (tabId) updateBrowserControlTab(request.workspaceId, request.processId, tabId, baseUrl);
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
            window.removeEventListener('focus', focus);
            unsubscribeScope();
        },
    };
    const unsubscribeScope = subscribeBrowserControlScope(() => { void relay.update(selectedRef); });
    return relay;
}

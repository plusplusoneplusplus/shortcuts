import { desktopBrowserBridge, type BrowserDemoCommand, type BrowserDemoCommandResult, type BrowserDemoOwner, type BrowserDemoState, type DesktopBrowserDemo } from './browser-bridge';

/**
 * This window's live browser demo states, mirrored from desktop main. Main
 * owns the drafts; this store holds counts and tab ids only, so a panel
 * remount finds a running recording again.
 */
const states = new Map<string, BrowserDemoState>();
const listeners = new Set<() => void>();
let attached: { demo: DesktopBrowserDemo; off: () => void } | null = null;

const notify = () => { for (const listener of listeners) listener(); };

function apply(state: BrowserDemoState): void {
    if (state.ended) states.delete(state.id);
    else states.set(state.id, state);
    notify();
}

function attach(): DesktopBrowserDemo | undefined {
    const demo = desktopBrowserBridge()?.demo;
    if (attached?.demo === demo) return demo;
    attached?.off();
    attached = null;
    if (!demo) return undefined;
    attached = { demo, off: demo.onState(apply) };
    void demo.command({ action: 'list' }).then(result => {
        if (!result.ok || !result.drafts) return;
        for (const state of result.drafts) states.set(state.id, state);
        notify();
    }).catch(() => undefined);
    return demo;
}

export function subscribeBrowserDemos(listener: () => void): () => void {
    attach();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** The demo that captures `viewId` for this tab's routing scope. */
export function getBrowserDemoForView(routingRef: string, viewId: string): BrowserDemoState | null {
    for (const state of states.values()) if (state.owner.routingRef === routingRef && state.viewIds.includes(viewId)) return state;
    return null;
}

/** The exact owner's demo in any status, including one waiting for review. */
export function getBrowserDemoForOwner(owner: BrowserDemoOwner): BrowserDemoState | null {
    for (const state of states.values()) {
        if (state.owner.workspaceId === owner.workspaceId && state.owner.processId === owner.processId
            && state.owner.routingRef === owner.routingRef) return state;
    }
    return null;
}

/** Whether a chat is recording or paused: its AI browser input stays blocked. */
export function isBrowserDemoCapturing(workspaceId: string, processId: string): boolean {
    for (const state of states.values()) {
        if (state.owner.workspaceId === workspaceId && state.owner.processId === processId && state.status !== 'stopped') return true;
    }
    return false;
}

export function listBrowserDemos(): BrowserDemoState[] {
    return [...states.values()];
}

/** Run one recorder command; failures, including a missing host, come back as values. */
export async function runBrowserDemoCommand(command: BrowserDemoCommand): Promise<BrowserDemoCommandResult> {
    const demo = attach();
    if (!demo) return { ok: false, reason: 'engine-unsupported', message: 'Demo recording is unavailable in this desktop version.' };
    let result: BrowserDemoCommandResult;
    try {
        result = await demo.command(command);
    } catch (error) {
        return { ok: false, reason: 'handshake-failed', message: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
        if (result.state) apply(result.state);
        if ((command.action === 'discard' || command.action === 'sent') && states.delete(command.id)) notify();
    } else if (result.reason === 'not-found' && 'id' in command && states.delete(command.id)) {
        notify();
    }
    return result;
}

export function resetBrowserDemosForTest(): void {
    attached?.off();
    attached = null;
    states.clear();
    listeners.clear();
}

import { useSyncExternalStore } from 'react';
import { desktopBrowserBridge, type BrowserDemoCommand, type BrowserDemoCommandResult, type BrowserDemoOwner, type BrowserDemoState, type DesktopBrowserDemo } from './browser-bridge';
import { clearBrowserDemoEdits } from './browser-demo-review';

/**
 * This window's live browser demo states, mirrored from desktop main. Main
 * owns the drafts; this store holds counts and tab ids only, so a panel
 * remount finds a running recording again.
 */
const states = new Map<string, BrowserDemoState>();
const listeners = new Set<() => void>();
let attached: { demo: DesktopBrowserDemo; off: () => void } | null = null;
let unloadGuardAttached = false;

function beforeUnload(event: BeforeUnloadEvent): void {
    if (!states.size) return;
    event.preventDefault();
    event.returnValue = 'Unsent browser demos will be discarded.';
}

const notify = () => {
    if (typeof window !== 'undefined') {
        if (states.size && !unloadGuardAttached) {
            window.addEventListener('beforeunload', beforeUnload);
            unloadGuardAttached = true;
        } else if (!states.size && unloadGuardAttached) {
            window.removeEventListener('beforeunload', beforeUnload);
            unloadGuardAttached = false;
        }
    }
    for (const listener of listeners) listener();
};

function apply(state: BrowserDemoState): void {
    if (state.ended) {
        states.delete(state.id);
        clearBrowserDemoEdits(state.id);
    }
    else states.set(state.id, state);
    notify();
    pauseOutOfScope();
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
        pauseOutOfScope();
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
        if (sameChatOwner(state.owner, owner)) return state;
    }
    return null;
}

const bareProcessId = (id: string) => id.startsWith('queue_') ? id.slice(6) : id;

function sameChatOwner(a: BrowserDemoOwner, b: BrowserDemoOwner): boolean {
    return a.workspaceId === b.workspaceId && a.routingRef === b.routingRef
        && bareProcessId(a.processId) === bareProcessId(b.processId);
}

/** Queue aliases identify the same chat only within its concrete workspace/server owner. */
export function isBrowserDemoCapturingChat(owner: BrowserDemoOwner | null | undefined): boolean {
    if (!owner) return false;
    for (const state of states.values()) if (state.status !== 'stopped' && sameChatOwner(state.owner, owner)) return true;
    return false;
}

export function useBrowserDemoCapturingChat(owner: BrowserDemoOwner | null | undefined): boolean {
    return useSyncExternalStore(subscribeBrowserDemos, () => isBrowserDemoCapturingChat(owner), () => false);
}

export function listBrowserDemos(): BrowserDemoState[] {
    return [...states.values()];
}

let viewing: { token: number; owner: BrowserDemoOwner | null } | null = null;
let nextViewingToken = 1;
const scopePauses = new Set<string>();

/** Pause recordings whose chat is not the one this window shows; nothing records for another scope. */
function pauseOutOfScope(): void {
    for (const state of states.values()) {
        if (state.status === 'recording' && !isBrowserDemoChatInView(state.owner) && !scopePauses.has(state.id)) {
            scopePauses.add(state.id);
            void runBrowserDemoCommand({ action: 'pause', id: state.id, reason: 'scope' })
                .finally(() => { scopePauses.delete(state.id); });
        }
    }
}

/**
 * The right panel reports the chat it shows. Leaving the recording chat or its workspace
 * pauses the recording; the user resumes it explicitly. Returns the release for unmount,
 * which waits a tick so a remount in the same scope does not pause.
 */
export function setBrowserDemoViewingChat(owner: BrowserDemoOwner | null): () => void {
    const token = nextViewingToken++;
    viewing = { token, owner: owner ? { ...owner } : null };
    notify();
    pauseOutOfScope();
    return () => {
        setTimeout(() => {
            if (viewing?.token !== token) return;
            viewing = null;
            notify();
            pauseOutOfScope();
        }, 0);
    };
}

/** Whether this window shows the exact owner's chat, so its paused recording may resume. */
export function isBrowserDemoChatInView(owner: BrowserDemoOwner): boolean {
    return !!viewing?.owner && sameChatOwner(viewing.owner, owner);
}

/** Run one recorder command; failures, including a missing host, come back as values. */
export async function runBrowserDemoCommand(command: BrowserDemoCommand): Promise<BrowserDemoCommandResult> {
    const demo = attach();
    if (!demo) return { ok: false, reason: 'engine-unsupported', message: 'Demo recording is unavailable in this desktop version.' };
    if (command.action === 'start' || command.action === 'resume' || command.action === 'add-tab') {
        const owner = command.action === 'start' ? command.owner : states.get(command.id)?.owner;
        if (!owner || !isBrowserDemoChatInView(owner)) {
            return { ok: false, reason: 'invalid', message: 'Open the recording chat to continue.' };
        }
    }
    let result: BrowserDemoCommandResult;
    try {
        result = await demo.command(command);
    } catch (error) {
        return { ok: false, reason: 'handshake-failed', message: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
        if (result.state) apply(result.state);
        // Stop answers with the draft; mark it stopped now so a review opened from this
        // result does not see the recording state that main's state event replaces later.
        const stopped = command.action === 'stop' ? states.get(command.id) : undefined;
        if (stopped && stopped.status !== 'stopped') apply({ ...stopped, status: 'stopped', pauseReason: undefined });
        if (command.action === 'discard' || command.action === 'sent') {
            clearBrowserDemoEdits(command.id);
            if (states.delete(command.id)) notify();
        }
    } else if (result.reason === 'not-found' && 'id' in command && states.delete(command.id)) {
        clearBrowserDemoEdits(command.id);
        notify();
    }
    return result;
}

export function resetBrowserDemosForTest(): void {
    viewing = null;
    attached?.off();
    attached = null;
    states.clear();
    scopePauses.clear();
    listeners.clear();
    if (unloadGuardAttached) window.removeEventListener('beforeunload', beforeUnload);
    unloadGuardAttached = false;
}

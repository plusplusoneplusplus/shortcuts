export interface BrowserControlActivity {
    workspaceId: string;
    processId: string;
    tabId?: string;
    sourceBaseUrl?: string;
    routingRef?: string | null;
}

const activities = new Map<string, BrowserControlActivity>();
const finishedProcesses = new Map<string, { workspaceId: string; sourceBaseUrl?: string }>();
const listeners = new Set<() => void>();
const key = (workspaceId: string, processId: string, sourceBaseUrl?: string) => JSON.stringify([sourceBaseUrl ?? '', workspaceId, processId]);
const notify = () => listeners.forEach(listener => listener());
let observingProcessUpdates = false;

function observeProcessUpdates(): void {
    if (observingProcessUpdates || typeof window === 'undefined') return;
    observingProcessUpdates = true;
    window.addEventListener('coc-local-ws-message', event => observeBrowserControlProcessUpdate((event as CustomEvent).detail));
    window.addEventListener('coc-remote-ws-message', event => {
        const detail = (event as CustomEvent).detail;
        if (typeof detail?.baseUrl === 'string') observeBrowserControlProcessUpdate(detail.message ?? detail.data, detail.baseUrl);
    });
}

export function observeBrowserControlProcessUpdate(message: unknown, sourceBaseUrl?: string): void {
    if (!message || typeof message !== 'object') return;
    const update = message as { type?: string; process?: { workspaceId?: string; id?: string; status?: string } };
    if (update.type !== 'process-updated') return;
    const process = update.process;
    if (typeof process?.workspaceId !== 'string' || typeof process.id !== 'string') return;
    if (process.status === 'running') {
        resumeBrowserControlActivity(process.workspaceId, process.id, sourceBaseUrl);
    } else if (process.status && ['completed', 'cancelled', 'failed', 'cancelling'].includes(process.status)) {
        finishBrowserControlActivity(process.workspaceId, process.id, sourceBaseUrl);
    }
}

export function subscribeBrowserControlActivity(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

export function getBrowserControlActivity(workspaceId: string, tabId: string, sourceBaseUrl?: string): BrowserControlActivity | null {
    return Array.from(activities.values()).reverse().find(activity => activity.workspaceId === workspaceId && activity.tabId === tabId && activity.sourceBaseUrl === sourceBaseUrl) ?? null;
}

/** Command completion retains ownership until the conversation turn settles. */
export function startBrowserControlActivity(activity: BrowserControlActivity): boolean {
    if (!activity.workspaceId || !activity.processId) return false;
    observeProcessUpdates();
    const id = key(activity.workspaceId, activity.processId, activity.sourceBaseUrl);
    if (finishedProcesses.has(id)) return false;
    const previous = activities.get(id);
    activities.delete(id);
    activities.set(id, {
        ...activity,
        tabId: activity.tabId ?? previous?.tabId,
        routingRef: activity.routingRef === undefined ? previous?.routingRef : activity.routingRef,
    });
    notify();
    return true;
}

/** Late command responses cannot restore a completed or cancelled turn. */
export function updateBrowserControlTab(workspaceId: string, processId: string, tabId: string, sourceBaseUrl?: string): void {
    const id = key(workspaceId, processId, sourceBaseUrl);
    const activity = activities.get(id);
    if (!activity || !tabId) return;
    activities.delete(id);
    activities.set(id, { ...activity, tabId });
    notify();
}

export function finishBrowserControlActivity(workspaceId: string, processId: string, sourceBaseUrl?: string): void {
    if (!workspaceId || !processId) return;
    const id = key(workspaceId, processId, sourceBaseUrl);
    finishedProcesses.set(id, { workspaceId, sourceBaseUrl });
    if (activities.delete(id)) notify();
}

/** Only an authoritative running-process notification begins another turn. */
export function resumeBrowserControlActivity(workspaceId: string, processId: string, sourceBaseUrl?: string): void {
    finishedProcesses.delete(key(workspaceId, processId, sourceBaseUrl));
}

export function clearBrowserControlActivities(workspaceId: string, sourceBaseUrl?: string): void {
    let changed = false;
    for (const [id, activity] of activities) {
        if (activity.workspaceId === workspaceId && activity.sourceBaseUrl === sourceBaseUrl) {
            activities.delete(id);
            changed = true;
        }
    }
    for (const [id, owner] of finishedProcesses) {
        if (owner.workspaceId === workspaceId && owner.sourceBaseUrl === sourceBaseUrl) finishedProcesses.delete(id);
    }
    if (changed) notify();
}

observeProcessUpdates();

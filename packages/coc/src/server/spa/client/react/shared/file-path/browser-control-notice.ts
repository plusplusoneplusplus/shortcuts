/** A background browser-control turn whose actions wait for the user to bring its workspace on screen. */
export interface BrowserControlNotice {
    key: string;
    workspaceId: string;
    processId: string;
    routingRef: string;
    actions: string[];
    switchBack: () => void;
    stop: () => Promise<void>;
}

const notices = new Map<string, BrowserControlNotice>();
const listeners = new Set<() => void>();
let snapshot: BrowserControlNotice[] = [];
const publish = () => {
    snapshot = [...notices.values()];
    listeners.forEach(listener => listener());
};

export function setBrowserControlNotice(notice: BrowserControlNotice): void {
    notices.set(notice.key, notice);
    publish();
}

export function clearBrowserControlNotice(key: string): void {
    if (notices.delete(key)) publish();
}

export function getBrowserControlNotices(): BrowserControlNotice[] {
    return snapshot;
}

export function subscribeBrowserControlNotices(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

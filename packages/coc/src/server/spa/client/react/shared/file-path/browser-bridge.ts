import type { BrowserCommandRequest, BrowserCommandResult } from '@plusplusoneplusplus/coc-client';
import { getLinkHandlersConfig } from '../../hooks/useLinkHandlers';
import { findLinkHandler } from '../../utils/link-handler';

/** Reply to `browser.open` / `browser.navigate`. */
export type BrowserEngine = 'electron' | 'webview2';
/** What `browser.open` loads; a bare string is a `url` source. */
export type BrowserSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };
export type BrowserOpenResult = { ok: true; engine: BrowserEngine; sourceKind?: BrowserSource['kind']; embed?: 'webview'; src?: string; partition?: string } | { ok: false; reason: string; message?: string; engine?: BrowserEngine };
export interface BrowserPreferences {
    clickOnce?: { enabled: boolean; supported: boolean };
    defaultEngine: BrowserEngine;
    engines: { engine: BrowserEngine; available: boolean; reason?: string; message?: string }[];
    clearing: BrowserEngine[];
    pageZoom?: { percent: number; min: number; max: number; step: number };
}
export type BrowserOperationResult = { ok: true } | { ok: false; reason: string; message?: string };
/** Cookie import also reports how many cookies it set, never their names or values. */
export type BrowserCookieImportResult = { ok: true; count: number } | { ok: false; reason: string; message?: string };
/** Mirrors `BrowserSiteInfo` in coc-desktop's browser-view-policy.ts. */
export type BrowserSiteConnection = 'secure' | 'https-unverified' | 'insecure' | 'certificate-error' | 'failed' | 'loading' | 'local-file' | 'unknown';
export interface BrowserSiteInfo {
    viewId: string;
    engine: BrowserEngine;
    sourceKind: 'url' | 'file';
    url: string;
    host: string;
    connection: BrowserSiteConnection;
    /** Unix seconds. */
    certificate?: { subject: string; issuer: string; validStart: number; validExpiry: number };
    cookies: { available: true; count: number } | { available: false; reason: 'not-applicable' | 'unsupported' | 'failed' };
    revision?: number;
}
export type BrowserSiteInfoResult = { ok: true; info: BrowserSiteInfo } | { ok: false; reason: string; message?: string };
export interface BrowserHistoryEntry {
    url: string;
    title: string;
    lastVisited: number;
    visitCount: number;
}
export interface BrowserHistorySuggestion extends BrowserHistoryEntry { completion: string | null }
export type BrowserHistoryResult<T = BrowserHistoryEntry> = {
    ok: true; entries: T[]; total: number; recording: boolean; storageError: string | null;
} | { ok: false; reason: string; message?: string };
export interface DesktopBrowserHistory {
    query(search?: string, offset?: number, limit?: number): Promise<BrowserHistoryResult>;
    suggest(search?: string): Promise<BrowserHistoryResult<BrowserHistorySuggestion>>;
    delete(url: string): Promise<BrowserOperationResult>;
    clear(): Promise<BrowserOperationResult>;
    setRecording(recording: boolean): Promise<BrowserOperationResult>;
    onChanged(callback: () => void): () => void;
}
/** Mirrors desktop main's public download metadata; no local paths or request URLs. */
export interface BrowserManagedDownload {
    id: string;
    engine: 'electron';
    filename: string;
    source: string;
    started: number;
    updated: number;
    state: 'downloading' | 'paused' | 'completed' | 'cancelled' | 'interrupted' | 'failed';
    received: number;
    total: number;
    active: boolean;
    canPause: boolean;
    canResume: boolean;
    fileAvailable: boolean;
}
export type BrowserDownloadAction = 'pause' | 'resume' | 'cancel' | 'open' | 'show' | 'remove' | 'clear';
export type BrowserDownloadsResult = { ok: true; entries: BrowserManagedDownload[]; storageError: string | null;
    engines: Record<string, { managed: boolean; message: string }> } | { ok: false; reason: string; message?: string };
export interface DesktopBrowserDownloads {
    query(): Promise<BrowserDownloadsResult>;
    action(id: string | null, action: BrowserDownloadAction): Promise<BrowserOperationResult>;
    onChanged(callback: () => void): () => void;
}
/** Mirrors coc-desktop browser-demo-*.ts: one chat's in-memory task demonstration. */
export interface BrowserDemoOwner { workspaceId: string; processId: string; routingRef: string }
export type BrowserDemoStatus = 'recording' | 'paused' | 'stopped';
export type BrowserDemoPauseReason = 'user' | 'scope' | 'disconnected';
export type BrowserDemoErrorReason = 'engine-unsupported' | 'handshake-failed' | 'file-preview' | 'busy' | 'limit' | 'not-found' | 'invalid';
/** Compact live state: counts and tab ids only, never labels or URLs. */
export interface BrowserDemoState {
    id: string;
    owner: BrowserDemoOwner;
    status: BrowserDemoStatus;
    pauseReason?: BrowserDemoPauseReason;
    stepCount: number;
    tabCount: number;
    viewIds: string[];
    incomplete: boolean;
    ended?: 'discarded' | 'sent';
}
export interface BrowserDemoAction {
    kind: 'click' | 'type' | 'toggle' | 'select' | 'file' | 'submit' | 'key';
    role: string;
    label: string;
    url: string;
    sensitive?: true;
    checked?: boolean;
    key?: 'Enter' | 'Escape' | 'Tab';
}
export interface BrowserDemoTab {
    viewId: string;
    index: number;
    openerViewId?: string;
    addedByUser?: true;
    url: string;
    title: string;
    closed?: true;
}
export type BrowserDemoGapReason = 'paused' | 'rate-limit' | 'step-limit' | 'tab-limit' | 'capture-failed' | 'frame-unavailable' | 'tab-crashed' | 'tab-not-opened';
export type BrowserDemoStep = { id: number; at: number; viewId: string } & (
    | { type: 'action'; action: BrowserDemoAction }
    | { type: 'navigate'; url: string; title: string }
    | { type: 'tab-opened'; openerViewId?: string; addedByUser?: true; url: string }
    | { type: 'switch' }
    | { type: 'tab-closed' }
    | { type: 'gap'; reason: BrowserDemoGapReason }
);
/** The redacted draft; review edits stay in SPA memory. */
export interface BrowserDemoSnapshot {
    id: string;
    owner: BrowserDemoOwner;
    status: BrowserDemoStatus;
    startedAt: number;
    tabs: BrowserDemoTab[];
    steps: BrowserDemoStep[];
    incomplete: boolean;
}
export type BrowserDemoCommand =
    | { action: 'start'; owner: BrowserDemoOwner; viewId: string }
    | { action: 'pause'; id: string; reason?: BrowserDemoPauseReason }
    | { action: 'resume' | 'stop' | 'draft' | 'discard' | 'sent'; id: string }
    | { action: 'add-tab' | 'remove-tab'; id: string; viewId: string }
    | { action: 'switch'; viewId: string }
    | { action: 'list' };
export type BrowserDemoCommandResult =
    | { ok: true; state?: BrowserDemoState; draft?: BrowserDemoSnapshot; drafts?: BrowserDemoState[] }
    | { ok: false; reason: BrowserDemoErrorReason; message: string };
export interface DesktopBrowserDemo {
    supported?: boolean;
    command(command: BrowserDemoCommand): Promise<BrowserDemoCommandResult>;
    onState(callback: (state: BrowserDemoState) => void): () => void;
}
export const WEBVIEW2_INSTALL_URL = 'https://developer.microsoft.com/microsoft-edge/webview2/#download-section';
export const DESKTOP_BROWSER_PREFERENCES_HASH = '#admin/settings/appearance';

/** Live navigation snapshot of a desktop browser view. */
export interface BrowserViewState {
    viewId: string;
    engine: BrowserEngine;
    sourceKind?: BrowserSource['kind'];
    url: string;
    title: string;
    /** Successful document identity; absent while navigating or on older hosts. */
    committedPage?: { url: string; title: string; revision: number };
    /** Validated `data:image/...` site icon for web pages; absent while unknown or on older hosts. */
    favicon?: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
    error?: string;
    errorCode?: string;
}

/** A page asked to open a new-window link as another tab. */
export interface BrowserNewTabRequest {
    openerViewId: string;
    /** Main-minted identity for a popup created during human ownership. */
    viewId?: string;
    engine: BrowserEngine;
    url: string;
    /** An AI turn drives the opener unseen: add the tab without selecting it. */
    background?: boolean;
}

/** Download fallback notice; current desktops return a safe source label in `url`. */
export interface BrowserDownloadEvent {
    viewId: string;
    url: string;
    ok: boolean;
    error?: string;
}

/** The desktop preload's browser tab API (see coc-desktop browser-view-host.ts). */
export interface DesktopBrowserBridge {
    showAddressMenu?(hasSelection: boolean): Promise<BrowserOperationResult>;
    control?: {
        framesSupported?: boolean;
        richPasteSupported?: boolean;
        humanTakeoverSupported?: boolean;
        takeover?(identity: import('@plusplusoneplusplus/coc-client').BrowserTakeoverState, action: 'take' | 'return' | 'stop', note?: string): Promise<void>;
        setTakeoverPolicy?(routingRef: string, enabled: boolean): Promise<void>;
        onTakeover?(callback: (state: import('@plusplusoneplusplus/coc-client').BrowserTakeoverState) => void): () => void;
        bindScope(workspaceId: string | null, sessionKey: string | null): Promise<{ ownerId: number } | void>;
        /** Keep a background scope controllable while another is selected; `null` drops it. Absent on older desktops. */
        retainScope?(sessionKey: string, workspaceId: string | null): Promise<void>;
        /**
         * `placement` is window-local policy: `hiddenTargets` runs targets that are off screen like background
         * tabs (no selection change or focus); `watch` shows the target first. Older desktops ignore it.
         */
        execute(request: BrowserCommandRequest, routingRef?: string, placement?: { hiddenTargets?: boolean; watch?: boolean }): Promise<BrowserCommandResult>;
        cancel(id: string): void;
        releaseFrames?(routingRef: string): Promise<void>;
        /** Removes the AI cursor from this window's views in the scope now; absent on older desktops. */
        removeCursors?(routingRef: string): Promise<void>;
        finish?(turnId?: string, routingRef?: string): void;
        setVisible?(visible: boolean, routingRef: string): void;
        onActivity?(callback: (event: BrowserControlActivityEvent) => void): () => void;
        onStop?(callback: (event: BrowserControlActivityEvent) => void): () => void;
        onFocused?(callback: () => void): () => void;
        onReveal(callback: (event: BrowserControlReveal) => void): () => void;
        /** Agent-driven top-level navigations held during an active turn; absent on older desktops. */
        onNavigationCheck?(callback: (event: BrowserNavigationCheckEvent) => void): () => void;
        /** Resumes (`allow`) or blocks a held navigation. */
        decideNavigation?(checkId: string, allow: boolean): void;
    };
    /** Installation-wide history; absent on older desktop hosts. */
    history?: DesktopBrowserHistory;
    /** Installation-wide downloads; absent on older hosts. */
    downloads?: DesktopBrowserDownloads;
    /** Task-demonstration recording; absent on older desktop hosts. */
    demo?: DesktopBrowserDemo;
    /** Source kinds `open` accepts; absent on desktops that only open URLs. */
    sources?: readonly string[];
    importCookies?(viewId: string | null, domain: string, cookies: string, engine?: BrowserEngine): Promise<BrowserCookieImportResult>;
    /** Read-only facts for an owned view's committed page; absent on older desktop hosts. */
    siteInfo?(viewId: string, sessionKey: string): Promise<BrowserSiteInfoResult>;
    open(viewId: string, source: string | BrowserSource, sessionKey: string, relatedEngine?: BrowserEngine): Promise<BrowserOpenResult>;
    adopt?(viewId: string, guestId: number): Promise<BrowserOperationResult>;
    navigate(viewId: string, url: string): Promise<BrowserOpenResult>;
    nav(viewId: string, action: 'back' | 'forward' | 'reload' | 'stop'): void;
    setBounds(viewId: string, rect: { x: number; y: number; width: number; height: number } | null): void;
    hide(viewId: string): void;
    close(viewId: string): void;
    focus(viewId: string): void;
    openExternal(url: string): Promise<boolean>;
    /** Hand a view's current page to the system handler; present alongside `sources`. */
    openViewExternal?(viewId: string): void;
    onState(callback: (state: BrowserViewState) => void): () => void;
    onNewTab(callback: (request: BrowserNewTabRequest) => void): () => void;
    onDownload(callback: (event: BrowserDownloadEvent) => void): () => void;
    getPreferences(): Promise<BrowserPreferences>;
    setClickOnce?(enabled: boolean): Promise<BrowserOperationResult>;
    setPageZoom?(percent: number): Promise<BrowserOperationResult>;
    setDefaultEngine(engine: BrowserEngine): Promise<BrowserOperationResult>;
    clearData(engine: BrowserEngine): Promise<BrowserOperationResult>;
    onPreferencesChanged(callback: () => void): () => void;
    /** Native page shortcuts cannot bubble into the SPA document. */
    onFocusAddressRequested?(callback: (event: { viewId: string }) => void): () => void;
    onOpenMenuRequested?(callback: (event: { viewId: string }) => void): () => void;
    onCloseRequested?(callback: (event: { viewId: string }) => void): () => void;
    onReopenClosedRequested?(callback: (event: { viewId: string }) => void): () => void;
    /** Opt this window's pages in to forwarding Ctrl/Cmd+1–9 and modifier holds; absent on older desktops. */
    setTabShortcuts?(enabled: boolean): void;
    /** A focused page's Ctrl/Cmd+1–9 (`digit`) or platform-modifier hold (`held`). */
    onTabShortcut?(callback: (event: { viewId: string; digit?: number; held?: boolean }) => void): () => void;
    onClosed(callback: (event: { viewId: string; engine: BrowserEngine }) => void): () => void;
}

export interface BrowserControlReveal {
    routingOwnerId?: number;
    workspaceId: string;
    processId: string;
    viewId: string;
    url?: string;
    routingRef?: string;
    turnId?: string;
    /** The view runs unseen (a retained scope, or a tab off screen); the window must not switch or select it. */
    background?: boolean;
}

/** A top-level navigation the desktop holds until the owning server decides. */
export interface BrowserNavigationCheckEvent {
    checkId: string;
    workspaceId: string;
    processId: string;
    turnId: string;
    routingRef: string;
    url: string;
}

export interface BrowserControlActivityEvent {
    routingOwnerId?: number;
    workspaceId: string;
    processId: string;
    turnId: string;
    routingRef: string;
    viewId: string;
    active: boolean;
    finished?: boolean;
    /** The turn drives this tab unseen: from a retained scope, or while the tab is off screen. */
    background?: boolean;
}

/** Event a chat web-link click sends to ask the right panel for a browser tab. */
export const OPEN_BROWSER_URL_EVENT = 'coc-open-browser-url';

/**
 * Explicit owner of a requested browser tab, for links shown in a resource
 * (a canvas) rather than the selected chat. Only the panel whose scope is
 * `scopeWorkspaceId` takes the request.
 */
export interface OpenBrowserUrlOwner {
    scopeWorkspaceId: string;
    /** The concrete clone that owns the resource. */
    workspaceId: string;
    routingRef?: string | null;
    /** The conversation the resource is linked to. */
    chatId: string | null;
}

export interface OpenBrowserUrlDetail {
    url: string;
    /** Absent for chat links: the panel's dock target owns the tab. */
    owner?: OpenBrowserUrlOwner;
    /** Set by the panel that opened the tab. */
    handled?: boolean;
}

/**
 * Ask the mounted right panel to open `url` in a browser tab. Returns false
 * when there is no desktop browser view or no panel took it, so the caller
 * keeps its normal link behavior.
 */
export function requestPanelBrowserTab(url: string, owner?: OpenBrowserUrlOwner): boolean {
    if (!desktopBrowserBridge()) return false;
    const detail: OpenBrowserUrlDetail = { url, ...(owner ? { owner } : {}) };
    window.dispatchEvent(new CustomEvent(OPEN_BROWSER_URL_EVENT, { detail }));
    return detail.handled === true;
}

/**
 * The http(s) anchor a plain primary click should open in a panel browser
 * tab, or null when the link keeps its normal handling: modified clicks,
 * downloads, other schemes, and URLs a configured link handler owns.
 */
export function panelBrowserLinkFromClick(event: MouseEvent): HTMLAnchorElement | null {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return null;
    if (!(event.target instanceof Element)) return null;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!link || link.hasAttribute('download')) return null;
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(href)) return null;
    if (findLinkHandler(href, getLinkHandlersConfig())) return null;
    return link;
}

export function desktopBrowserBridge(): DesktopBrowserBridge | undefined {
    return (window as { cocDesktop?: { browser?: DesktopBrowserBridge } }).cocDesktop?.browser;
}

/**
 * Open an http(s) URL in the system browser: through the desktop bridge when
 * there is one, else a new `noopener` window. Resolves false when the handoff
 * failed (or a pop-up blocker stopped it).
 */
export async function openUrlInSystemBrowser(url: string): Promise<boolean> {
    const bridge = desktopBrowserBridge();
    if (bridge) {
        try {
            return await bridge.openExternal(url);
        } catch {
            return false;
        }
    }
    // `noopener` makes window.open return null even on success, so only a throw counts as failure.
    try {
        window.open(url, '_blank', 'noopener,noreferrer');
        return true;
    } catch {
        return false;
    }
}

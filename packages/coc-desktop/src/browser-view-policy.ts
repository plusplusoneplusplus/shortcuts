/**
 * CoC Desktop — browser tab — pure policy.
 *
 * The SPA's right panel can host general web pages in "browser" tabs. The main
 * process routes each view to its engine (see `browser-view-host.ts`).
 * Everything decidable without Electron lives here so it is unit-testable
 * under plain Node, the same split as `html-page-policy.ts` / `file-preview-host.ts`.
 *
 * SECURITY — remote pages never carry the CoC preload and run with
 * `contextIsolation` + `sandbox` + normal TLS validation. This module is the gate for:
 *   - which URLs the SPA may load ({@link validateBrowserUrl}: http(s) only);
 *   - where a page may navigate itself ({@link classifyBrowserNavigation});
 *   - what `window.open` does ({@link classifyBrowserWindowOpen}): pop-up
 *     windows (sign-in flows) get a sandboxed child window, other new-window
 *     links become another CoC browser tab in the opener's engine.
 * Engine profiles are persistent and installation-wide, isolated from CoC
 * itself and local HTML page tabs.
 */

/** Longest URL accepted from the SPA. */
const MAX_URL_LENGTH = 8192;

/** Outcome of validating a URL the SPA asked the main process to load. */
export type BrowserUrlCheck =
    | { ok: true; url: string }
    | { ok: false; reason: 'invalid' | 'unsupported' };

function parse(url: unknown): URL | null {
    if (typeof url !== 'string' || !url.trim() || url.length > MAX_URL_LENGTH || /[\u0000-\u001f]/.test(url)) {
        return null;
    }
    try {
        return new URL(url.trim());
    } catch {
        return null;
    }
}

function isHttp(url: URL): boolean {
    return url.protocol === 'http:' || url.protocol === 'https:';
}

/**
 * Validate a URL the SPA asked to load. The SPA already normalizes typed
 * input (bare domains get `https://`); the main process only re-checks that the
 * result is an absolute http(s) URL.
 */
export function validateBrowserUrl(url: unknown): BrowserUrlCheck {
    const parsed = parse(url);
    if (!parsed || !parsed.hostname || parsed.href.length > MAX_URL_LENGTH) {
        return { ok: false, reason: 'invalid' };
    }
    if (!isHttp(parsed)) {
        return { ok: false, reason: 'unsupported' };
    }
    return { ok: true, url: parsed.href };
}

/** What to do with a top-level navigation started by the page. */
export type BrowserNavDecision = 'allow' | 'deny';

/**
 * Decide a top-level navigation (`will-navigate` / `will-redirect`). Web
 * pages navigate freely across http(s) and `about:blank`; everything else
 * (custom app schemes, `file:`, `javascript:`, `data:`) is denied.
 */
export function classifyBrowserNavigation(targetUrl: string): BrowserNavDecision {
    const target = parse(targetUrl);
    if (!target) {
        return 'deny';
    }
    return isHttp(target) || target.href === 'about:blank' ? 'allow' : 'deny';
}

/** What to do with a `window.open` / `target=_blank` from the page. */
export type BrowserWindowOpenDecision = 'popup' | 'tab' | 'deny';

/**
 * Decide a `window.open`. Electron reports `new-window` for scripted opens
 * that ask for window features (sign-in pop-ups); those get a real sandboxed
 * child window so `window.opener` messaging works. Plain new-window links
 * (`foreground-tab`, `background-tab`, `default`) open another CoC browser tab.
 * `about:blank` is only allowed for pop-ups, which commonly open blank and
 * then set their location.
 */
export function classifyBrowserWindowOpen(targetUrl: string, disposition: string): BrowserWindowOpenDecision {
    const target = parse(targetUrl);
    const popup = disposition === 'new-window';
    if (!target) {
        return popup && (targetUrl === '' || targetUrl === 'about:blank') ? 'popup' : 'deny';
    }
    if (target.href === 'about:blank') {
        return popup ? 'popup' : 'deny';
    }
    if (!isHttp(target)) {
        return 'deny';
    }
    return popup ? 'popup' : 'tab';
}

/** Session keys are SPA-chosen concrete owner identities (workspace id or clone routing ref). */
export function isValidBrowserSessionKey(key: unknown): key is string {
    return typeof key === 'string' && key.length > 0 && key.length <= 1024 && !/[\u0000-\u001f]/.test(key);
}

/**
 * Strip Electron and app tokens from the default user agent so sites treat the
 * tab like the matching Chrome build (some sign-in pages refuse "Electron").
 */
export function browserUserAgent(defaultUserAgent: string): string {
    return defaultUserAgent
        .split(' ')
        .filter((token) => !/^(Electron|coc[\w.-]*|CoC[\w.-]*)\//.test(token))
        .join(' ');
}

/** Permission requests a browser tab may be granted; everything else is denied. */
const ALLOWED_PERMISSIONS: readonly string[] = ['clipboard-sanitized-write', 'fullscreen'];

/** Whether a page permission request (camera, notifications, …) is granted. */
export function isBrowserPermissionAllowed(permission: string): boolean {
    return ALLOWED_PERMISSIONS.includes(permission);
}

// ── IPC contract ────────────────────────────────────────────────────────────
// preload.ts re-declares these as literals (its sandboxed `require` cannot load
// this module); preload.test.ts keeps the two in sync.

/** SPA → main (invoke): open a view `(viewId, source, sessionKey, relatedEngine?)` → {@link BrowserOpenResult}; `source` is a {@link BrowserSource} or a bare URL string. */
export const BROWSER_VIEW_OPEN_CHANNEL = 'coc-desktop:browser-view-open';
/** SPA → main (invoke): load a new URL in an existing view `(viewId, url)` → {@link BrowserOpenResult}. */
export const BROWSER_VIEW_NAVIGATE_CHANNEL = 'coc-desktop:browser-view-navigate';
/** SPA → main: history / load control `(viewId, action)` where action is a {@link BrowserNavAction}. */
export const BROWSER_VIEW_NAV_CHANNEL = 'coc-desktop:browser-view-nav';
/** SPA → main: place the view `(viewId, rect)`; a null/empty rect hides it. */
export const BROWSER_VIEW_SET_BOUNDS_CHANNEL = 'coc-desktop:browser-view-set-bounds';
/** SPA → main: hide the view `(viewId)` without destroying it. */
export const BROWSER_VIEW_HIDE_CHANNEL = 'coc-desktop:browser-view-hide';
/** SPA → main: destroy the view and its pop-ups `(viewId)`. */
export const BROWSER_VIEW_CLOSE_CHANNEL = 'coc-desktop:browser-view-close';
/** SPA → main (invoke): open an http(s) URL in the system browser `(url)` → boolean. */
export const BROWSER_OPEN_EXTERNAL_CHANNEL = 'coc-desktop:browser-open-external';
/** main → SPA: {@link BrowserViewState} updates for every view the SPA owns. */
export const BROWSER_VIEW_STATE_CHANNEL = 'coc-desktop:browser-view-state';
/** main → SPA: {@link BrowserNewTabRequest} when a page opens a new-window link. */
export const BROWSER_VIEW_NEW_TAB_CHANNEL = 'coc-desktop:browser-view-new-tab';
/** main → SPA: {@link BrowserDownloadEvent} after a download is handed to the system browser. */
export const BROWSER_VIEW_DOWNLOAD_CHANNEL = 'coc-desktop:browser-view-download';
export const BROWSER_PREFERENCES_GET_CHANNEL = 'coc-desktop:browser-preferences-get';
export const BROWSER_PREFERENCES_SET_CHANNEL = 'coc-desktop:browser-preferences-set';
export const BROWSER_PREFERENCES_CHANGED_CHANNEL = 'coc-desktop:browser-preferences-changed';
export const BROWSER_CLEAR_DATA_CHANNEL = 'coc-desktop:browser-clear-data';
export const BROWSER_VIEW_CLOSED_CHANNEL = 'coc-desktop:browser-view-closed';
export const BROWSER_VIEW_FOCUS_CHANNEL = 'coc-desktop:browser-view-focus';
export const BROWSER_HOST_FOCUS_CHANNEL = 'coc-desktop:browser-host-focus';
/** SPA → main: open a view's current page in the system browser `(viewId)`. */
export const BROWSER_VIEW_OPEN_EXTERNAL_CHANNEL = 'coc-desktop:browser-view-open-external';

export type BrowserEngine = 'electron' | 'webview2';
export function isBrowserEngine(value: unknown): value is BrowserEngine {
    return value === 'electron' || value === 'webview2';
}

export type BrowserFailureReason =
    | 'unsupported-platform' | 'missing-runtime' | 'native-unavailable'
    | 'profile-locked' | 'startup-failed' | 'runtime-crashed' | 'navigation-failed' | 'cleanup-failed' | 'busy'
    | 'invalid' | 'unsupported' | 'bad-id' | 'bad-session' | 'bad-engine' | 'no-window' | 'not-found'
    | 'not-absolute' | 'not-html' | 'missing' | 'not-file';

/**
 * What a view shows: a web page (`url`, routed to the engine preference) or a
 * local HTML preview (`file`, always the isolated Electron file host).
 */
export type BrowserSourceKind = 'url' | 'file';
/** Source kinds this desktop build can open; exposed as `cocDesktop.browser.sources` for SPA feature detection. */
export const BROWSER_SOURCE_KINDS: readonly BrowserSourceKind[] = ['url', 'file'];

/** What `open` loads. Open-ended: later kinds (e.g. a server-served preview URL) add fields, never reuse `file`. */
export type BrowserSource = { kind: 'url'; url: string } | { kind: 'file'; path: string };

/**
 * Normalize an open request's source. A bare string is a `url` source (the
 * pre-source `open(viewId, url, …)` call shape). Only the `file` kind may load
 * a local file; a `url` source with `file:` is refused later by {@link validateBrowserUrl}.
 */
export function toBrowserSource(source: unknown): BrowserSource | { ok: false; reason: 'invalid' | 'unsupported' } {
    if (typeof source === 'string') { return { kind: 'url', url: source }; }
    if (!source || typeof source !== 'object') { return { ok: false, reason: 'invalid' }; }
    const { kind, url, path } = source as Record<string, unknown>;
    if (kind === 'url') { return typeof url === 'string' ? { kind, url } : { ok: false, reason: 'invalid' }; }
    if (kind === 'file') { return typeof path === 'string' ? { kind, path } : { ok: false, reason: 'invalid' }; }
    return { ok: false, reason: 'unsupported' };
}

export interface BrowserAvailability {
    engine: BrowserEngine;
    available: boolean;
    reason?: BrowserFailureReason;
    message?: string;
}

export interface BrowserPreferences {
    defaultEngine: BrowserEngine;
    engines: BrowserAvailability[];
    clearing: BrowserEngine[];
}

export type BrowserOperationResult = { ok: true } | {
    ok: false;
    reason: BrowserFailureReason;
    message?: string;
};

/** History / load control actions. */
export type BrowserNavAction = 'back' | 'forward' | 'reload' | 'stop';

export function isBrowserNavAction(action: unknown): action is BrowserNavAction {
    return action === 'back' || action === 'forward' || action === 'reload' || action === 'stop';
}

/** Reply to an open / navigate request. */
export type BrowserOpenResult =
    | { ok: true; engine: BrowserEngine; sourceKind?: BrowserSourceKind }
    | { ok: false; reason: BrowserFailureReason; message?: string; engine?: BrowserEngine };

/** Live navigation snapshot pushed to the SPA. */
export interface BrowserViewState {
    viewId: string;
    engine: BrowserEngine;
    sourceKind?: BrowserSourceKind;
    url: string;
    title: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
    /** Chromium's error description for a failed main-frame load. */
    error?: string;
    errorCode?: BrowserFailureReason;
}

/** A page asked to open `url` in a new tab; the SPA opens it with the opener's owner. */
export interface BrowserNewTabRequest {
    openerViewId: string;
    engine: BrowserEngine;
    url: string;
}

/** Result of handing a download to the system browser. */
export interface BrowserDownloadEvent {
    viewId: string;
    url: string;
    ok: boolean;
    error?: string;
}

/** View ids are SPA-chosen opaque keys; keep them short and printable. */
export function isValidBrowserViewId(viewId: unknown): viewId is string {
    return typeof viewId === 'string' && viewId.length > 0 && viewId.length <= 512
        && !/[\u0000-\u001f]/.test(viewId);
}

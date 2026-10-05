/**
 * CoC Desktop — HTML page tab — pure policy.
 *
 * A local `.html`/`.htm` file clicked in a chat response can be opened as a
 * real rendered page in the SPA's right panel. The main process hosts it in a
 * `WebContentsView` loaded over `file://` (see `file-preview-host.ts`). Everything
 * decidable without Electron lives here so it is unit-testable under plain Node,
 * the same split as `popout-chrome.ts` / `popout-window-host.ts`.
 *
 * SECURITY — the page view never carries the CoC preload and runs with
 * `contextIsolation` + `sandbox`. On top of that, this module is the gate for:
 *   - which paths the SPA may ask the main process to open
 *     ({@link validateHtmlPagePath}: absolute, `.html`/`.htm`, an existing file);
 *   - where the page may navigate itself ({@link classifyHtmlPageNavigation}):
 *     in place only for same-document anchors and `.html`/`.htm` files under
 *     the opened file's folder; http(s) goes to the system browser; everything
 *     else is denied;
 *   - what `window.open` does ({@link classifyHtmlPageWindowOpen}): http(s) goes
 *     to the system browser, nothing ever gets a new Electron window.
 * Subresource fetches (CSS, JS, images, `fetch()`) are not navigations and are
 * not restricted — the page has normal network access by design.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type { BrowserViewState } from './browser-view-policy';

/** File extensions the HTML page tab accepts (lower-case, with the dot). */
export const HTML_PAGE_EXTENSIONS: readonly string[] = ['.html', '.htm'];

/** Whether a path or file name ends in `.html` / `.htm` (case-insensitive). */
export function hasHtmlExtension(filePath: string): boolean {
    if (typeof filePath !== 'string') {
        return false;
    }
    const ext = path.extname(filePath).toLowerCase();
    return HTML_PAGE_EXTENSIONS.includes(ext);
}

/** Outcome of validating an open request coming from the SPA. */
export type HtmlPagePathCheck =
    | { ok: true; path: string }
    | { ok: false; reason: 'invalid' | 'not-absolute' | 'not-html' | 'missing' | 'not-file' };

/** Minimal `fs.statSync` shape so tests can inject a fake filesystem. */
export type HtmlPageStat = (filePath: string) => { isFile(): boolean } | null;

function defaultStat(filePath: string): { isFile(): boolean } | null {
    try {
        return fs.statSync(filePath);
    } catch {
        return null;
    }
}

/**
 * Validate a path the SPA asked the main process to open as a page tab. Only
 * absolute `.html`/`.htm` paths naming an existing regular file are accepted;
 * the SPA falls back to the source viewer on any rejection.
 */
export function validateHtmlPagePath(
    filePath: unknown,
    stat: HtmlPageStat = defaultStat,
): HtmlPagePathCheck {
    if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
        return { ok: false, reason: 'invalid' };
    }
    if (!path.isAbsolute(filePath)) {
        return { ok: false, reason: 'not-absolute' };
    }
    if (!hasHtmlExtension(filePath)) {
        return { ok: false, reason: 'not-html' };
    }
    const normalized = path.normalize(filePath);
    const info = stat(normalized);
    if (!info) {
        return { ok: false, reason: 'missing' };
    }
    if (!info.isFile()) {
        return { ok: false, reason: 'not-file' };
    }
    return { ok: true, path: normalized };
}

/** The `file://` URL the page view loads for a validated path. */
export function htmlPageFileUrl(filePath: string): string {
    return pathToFileURL(filePath).href;
}

/** What to do with a navigation or `window.open` attempted by the page. */
export type HtmlPageNavDecision = 'allow' | 'external' | 'deny';

function isHttp(url: URL): boolean {
    return url.protocol === 'http:' || url.protocol === 'https:';
}

/** Whether `child` sits at or below the `parent` directory. */
function isInsideDir(child: string, parent: string): boolean {
    const rel = path.relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Decide a top-level navigation (`will-navigate` / `will-redirect`) started by
 * the page.
 *
 * - `allow` — a same-document anchor on the current page, or a `.html`/`.htm`
 *   `file://` page inside the folder of the file the tab was opened with.
 * - `external` — any http(s) URL; the caller hands it to the system browser.
 * - `deny` — everything else (other `file://` targets, `javascript:`, `data:`,
 *   custom schemes, unparseable input).
 *
 * @param targetUrl  URL the page is trying to navigate to.
 * @param currentUrl URL the page view is currently showing.
 * @param rootFilePath Absolute path of the file the tab was opened with.
 */
export function classifyHtmlPageNavigation(
    targetUrl: string,
    currentUrl: string,
    rootFilePath: string,
): HtmlPageNavDecision {
    let target: URL;
    try {
        target = new URL(targetUrl);
    } catch {
        return 'deny';
    }
    if (isHttp(target)) {
        return 'external';
    }
    if (target.protocol !== 'file:') {
        return 'deny';
    }
    try {
        const current = new URL(currentUrl);
        if (current.protocol === 'file:' && stripHash(current) === stripHash(target)) {
            return 'allow';
        }
    } catch {
        // No usable current URL — fall through to the folder check.
    }
    let targetPath: string;
    try {
        targetPath = fileURLToPath(target);
    } catch {
        return 'deny';
    }
    if (!hasHtmlExtension(targetPath)) {
        return 'deny';
    }
    return isInsideDir(path.normalize(targetPath), path.dirname(path.normalize(rootFilePath)))
        ? 'allow'
        : 'deny';
}

function stripHash(url: URL): string {
    const copy = new URL(url.href);
    copy.hash = '';
    return copy.href;
}

/**
 * Decide a `window.open` from the page. The page view never spawns Electron
 * windows: http(s) targets open in the system browser, anything else is denied.
 */
export function classifyHtmlPageWindowOpen(targetUrl: string): Exclude<HtmlPageNavDecision, 'allow'> {
    try {
        return isHttp(new URL(targetUrl)) ? 'external' : 'deny';
    } catch {
        return 'deny';
    }
}

// ── IPC contract ────────────────────────────────────────────────────────────
// preload.ts re-declares these as literals (its sandboxed `require` cannot load
// this module); preload.test.ts keeps the two in sync.

/** SPA → main (invoke): open a page tab `(pageId, filePath)` → {@link HtmlPageOpenResult}. */
export const HTML_PAGE_OPEN_CHANNEL = 'coc-desktop:html-page-open';
/** SPA → main: place the page view `(pageId, rect)`; a null/empty rect hides it. */
export const HTML_PAGE_SET_BOUNDS_CHANNEL = 'coc-desktop:html-page-set-bounds';
/** SPA → main: hide the page view `(pageId)` without destroying it. */
export const HTML_PAGE_HIDE_CHANNEL = 'coc-desktop:html-page-hide';
/** SPA → main: destroy the page view `(pageId)`. */
export const HTML_PAGE_CLOSE_CHANNEL = 'coc-desktop:html-page-close';
/** SPA → main: reload the page view `(pageId)`. */
export const HTML_PAGE_RELOAD_CHANNEL = 'coc-desktop:html-page-reload';
/** SPA → main: open the page's current `file://` URL in the system browser `(pageId)`. */
export const HTML_PAGE_OPEN_EXTERNAL_CHANNEL = 'coc-desktop:html-page-open-external';
/** main → SPA: {@link HtmlPageLoadState} updates for every page view the SPA owns. */
export const HTML_PAGE_STATE_CHANNEL = 'coc-desktop:html-page-state';

/** Reply to an open request. The SPA falls back to the source viewer when `ok` is false. */
export type HtmlPageOpenResult =
    | { ok: true }
    | { ok: false; reason: Extract<HtmlPagePathCheck, { ok: false }>['reason'] | 'bad-id' | 'no-window' };

/** Load status pushed to the SPA so the tab can show a spinner or an inline error. */
export interface HtmlPageLoadState {
    pageId: string;
    status: 'loading' | 'loaded' | 'failed';
    /** Current page URL (a `file://` URL). */
    url?: string;
    /** Chromium's error description when `status` is `failed`. */
    error?: string;
}

/**
 * `htmlPage` previews live in the shared browser manager under this view-id
 * prefix, so a page id can never collide with a browser tab's view id.
 */
export const HTML_PAGE_VIEW_PREFIX = 'html-page:';
/** Session key for `htmlPage` previews, which carry no workspace owner. */
export const HTML_PAGE_SESSION_KEY = 'html-page';

/** The `htmlPage` load state for a manager view state. */
export function toHtmlPageLoadState(pageId: string, state: BrowserViewState): HtmlPageLoadState {
    const status = state.error ? 'failed' : state.loading ? 'loading' : 'loaded';
    return { pageId, status, url: state.url || undefined, ...(state.error ? { error: state.error } : {}) };
}

/** Page ids are SPA-chosen opaque keys; keep them short and printable. */
export function isValidHtmlPageId(pageId: unknown): pageId is string {
    return typeof pageId === 'string' && pageId.length > 0 && pageId.length <= 512
        && !/[\u0000-\u001f]/.test(pageId);
}

/** A rectangle in the host window's content coordinates (DIP). */
export interface HtmlPageBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Turn the placeholder rect the SPA reports (CSS px from
 * `getBoundingClientRect()`) into integer view bounds. CSS px scale with the
 * SPA's zoom factor, so they are multiplied by it. Returns null — meaning
 * "hide the view" — for a missing, non-finite or empty rect.
 */
export function toHtmlPageViewBounds(rect: unknown, zoomFactor = 1): HtmlPageBounds | null {
    if (!rect || typeof rect !== 'object') {
        return null;
    }
    const { x, y, width, height } = rect as Record<string, unknown>;
    if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) {
        return null;
    }
    const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
    const left = Math.round((x as number) * zoom);
    const top = Math.round((y as number) * zoom);
    const right = Math.round(((x as number) + (width as number)) * zoom);
    const bottom = Math.round(((y as number) + (height as number)) * zoom);
    const clampedLeft = Math.max(0, left);
    const clampedTop = Math.max(0, top);
    const w = right - clampedLeft;
    const h = bottom - clampedTop;
    if (w <= 0 || h <= 0) {
        return null;
    }
    return { x: clampedLeft, y: clampedTop, width: w, height: h };
}

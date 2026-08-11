/**
 * CoC Desktop — pop-out window chrome (address bar) — pure logic.
 *
 * A pop-out window (`#popout/markdown`, `#popout/activity`, `#popout/git-review`,
 * `#popout/canvas`, `#popout/dev-tools`, and same-origin PDF children) is built by the main process
 * out of TWO `WebContentsView`s stacked inside one BrowserWindow: a fixed-height
 * chrome strip on top and the popped-out page below. See `popout-window-host.ts`
 * for the Electron half; everything decidable without Electron lives here so it
 * is unit-testable under plain Node.
 *
 * SECURITY — the page view carries the standard preload, which is only safe
 * because {@link resolveTypedUrl} keeps that view same-origin: a typed
 * cross-origin http(s) URL is handed to the system browser and anything that is
 * not http(s) is rejected outright. If that policy is ever relaxed to let the
 * page view navigate to a foreign origin, the preload MUST be dropped for that
 * origin — otherwise the address bar turns every pop-out into an unrestricted
 * browser with a privileged IPC bridge attached.
 */

import { isSameOriginPdfChildUrl } from './pdf-child-window';

/** IPC channel: chrome bar / page → main, `{ action }` navigation command. */
export const POPOUT_NAV_CHANNEL = 'coc-desktop:popout-nav';
/** IPC channel: chrome bar → main, the user committed a typed URL. */
export const POPOUT_NAVIGATE_CHANNEL = 'coc-desktop:popout-navigate';
/** IPC channel: chrome bar → main, hand the current URL to the system browser. */
export const POPOUT_OPEN_EXTERNAL_CHANNEL = 'coc-desktop:popout-open-external';
/** IPC channel: chrome bar → main, copy the current URL to the clipboard. */
export const POPOUT_COPY_URL_CHANNEL = 'coc-desktop:popout-copy-url';
/** IPC channel: main → chrome bar, carrying a {@link PopOutState} snapshot. */
export const POPOUT_STATE_CHANNEL = 'coc-desktop:popout-state';

/** Height (px) of the chrome strip pinned to the top of every pop-out window. */
export const CHROME_BAR_HEIGHT = 40;

/** Fallback pop-out size when the `window.open` features string omits one. */
export const POPOUT_DEFAULT_WIDTH = 900;
export const POPOUT_DEFAULT_HEIGHT = 700;
/** Floor for a requested size, so a malformed features string cannot produce a sliver. */
export const POPOUT_MIN_WIDTH = 320;
export const POPOUT_MIN_HEIGHT = 240;

/**
 * Commands the chrome bar (or the page's injected shortcut listener) can send.
 * `focus-bar` / `focus-page` are not navigations but share the channel: they are
 * the two halves of the focus handoff (Cmd/Ctrl+L into the bar, Esc back out).
 */
export type PopOutNavAction = 'back' | 'forward' | 'reload' | 'stop' | 'focus-bar' | 'focus-page';

/** Snapshot the main process pushes to the chrome bar after every nav event. */
export interface PopOutState {
    url: string;
    canGoBack: boolean;
    canGoForward: boolean;
    loading: boolean;
}

/** Rectangle for a `WebContentsView.setBounds` call. */
export interface ViewBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Where each of a pop-out window's two views sits inside the content area. */
export interface PopOutLayout {
    chrome: ViewBounds;
    page: ViewBounds;
}

/**
 * Whether a `window.open` target should be intercepted and rebuilt as a
 * chrome-bar pop-out window.
 *
 * Deliberately an allow-list, not a blanket deny: several SPA call sites use the
 * handle `window.open` returns (print preview writes into an `about:blank`
 * child; the Teams auth popup waits on a `postMessage`), and a denied open
 * returns `null`. Only same-origin http(s) URLs whose hash is a `#popout/` route
 * — plus the same-origin PDF shapes already recognised by
 * {@link isSameOriginPdfChildUrl} — qualify. Everything else keeps today's
 * plain `{ action: 'allow' }` path.
 */
export function isPopOutChildUrl(targetUrl: string, appUrl: string): boolean {
    let target: URL;
    let app: URL;
    try {
        target = new URL(targetUrl);
        app = new URL(appUrl);
    } catch {
        return false;
    }
    if (
        (target.protocol !== 'http:' && target.protocol !== 'https:') ||
        target.origin !== app.origin
    ) {
        return false;
    }
    if (target.hash.startsWith('#popout/')) {
        return true;
    }
    return isSameOriginPdfChildUrl(targetUrl, appUrl);
}

/** Outcome of normalising whatever the user typed into the address field. */
export type ResolvedTypedUrl =
    | { kind: 'internal'; url: string }
    | { kind: 'external'; url: string }
    | { kind: 'invalid' };

/** Matches a leading `scheme:`, capturing the scheme and whether `//` follows. */
const SCHEME_RE = /^([a-z][a-z0-9+.-]*):(\/\/)?/i;
/** After `host:`, a run of digits then a path/query/fragment boundary means "port". */
const PORT_RE = /^\d+(?:[/?#]|$)/;

/**
 * Normalise a typed address into the navigation policy's three outcomes.
 *
 * - `internal` — same origin as the app, so the page view may load it.
 * - `external` — some other http(s) origin; the caller hands it to the system
 *   browser and leaves the page view alone (mirrors `shouldOpenExternally`).
 * - `invalid` — empty, unparseable, or a scheme the bar must never navigate to
 *   (`javascript:`, `file:`, `data:`, `mailto:`, …). The bar reverts its text.
 *
 * Bare input is interpreted the way a browser omnibox does: a leading `/` is a
 * path resolved against the app origin, `host:port/...` keeps the host, and
 * anything else gets an `https://` prefix.
 */
export function resolveTypedUrl(input: string, appOrigin: string): ResolvedTypedUrl {
    const raw = typeof input === 'string' ? input.trim() : '';
    if (!raw) {
        return { kind: 'invalid' };
    }
    let origin: string;
    try {
        origin = new URL(appOrigin).origin;
    } catch {
        return { kind: 'invalid' };
    }

    let candidate = raw;
    const scheme = SCHEME_RE.exec(raw);
    if (scheme) {
        const name = scheme[1].toLowerCase();
        const hasSlashes = !!scheme[2];
        // `localhost:3000/x` looks like a scheme but is really host:port.
        const isHostPort = !hasSlashes && PORT_RE.test(raw.slice(name.length + 1));
        if (!isHostPort) {
            if (name !== 'http' && name !== 'https') {
                return { kind: 'invalid' };
            }
        } else {
            candidate = 'https://' + raw;
        }
    } else if (raw.startsWith('/')) {
        candidate = origin + raw;
    } else {
        candidate = 'https://' + raw;
    }

    let target: URL;
    try {
        target = new URL(candidate);
    } catch {
        return { kind: 'invalid' };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        return { kind: 'invalid' };
    }
    if (!target.hostname) {
        return { kind: 'invalid' };
    }
    return target.origin === origin
        ? { kind: 'internal', url: target.href }
        : { kind: 'external', url: target.href };
}

/**
 * What the address field shows while it is not being edited: the full URL, with
 * no truncation or elision (the field scrolls). `about:blank` and empty URLs
 * render as an empty field so the placeholder shows through.
 *
 * Kept dependency-free so it can be both unit-tested here AND embedded verbatim
 * into the bar's page script via `.toString()` — one source of truth.
 */
export function formatDisplayUrl(url: string): string {
    if (!url || url === 'about:blank') {
        return '';
    }
    return url;
}

/**
 * Split a pop-out window's content area between the chrome strip and the page.
 * The strip is a fixed {@link CHROME_BAR_HEIGHT}; the page takes the remainder.
 * A window shorter than the strip degrades to "chrome only" rather than giving
 * the page a negative height.
 */
export function layoutPopOutViews(contentWidth: number, contentHeight: number): PopOutLayout {
    const width = Math.max(0, Math.round(contentWidth));
    const height = Math.max(0, Math.round(contentHeight));
    const chromeHeight = Math.min(CHROME_BAR_HEIGHT, height);
    return {
        chrome: { x: 0, y: 0, width, height: chromeHeight },
        page: { x: 0, y: chromeHeight, width, height: height - chromeHeight },
    };
}

/**
 * Read `width=` / `height=` out of a `window.open` features string.
 *
 * The height is grown by {@link CHROME_BAR_HEIGHT} so the popped-out page ends
 * up the size the SPA asked for — the chrome strip is added on top rather than
 * eating into the caller's request.
 */
export function parsePopOutWindowSize(features?: string): { width: number; height: number } {
    const read = (key: string): number | null => {
        if (!features) {
            return null;
        }
        const match = new RegExp('(?:^|,)\\s*' + key + '\\s*=\\s*(\\d+)', 'i').exec(features);
        return match ? Number(match[1]) : null;
    };
    const width = read('width') ?? POPOUT_DEFAULT_WIDTH;
    const height = read('height') ?? POPOUT_DEFAULT_HEIGHT;
    return {
        width: Math.max(POPOUT_MIN_WIDTH, width),
        height: Math.max(POPOUT_MIN_HEIGHT, height) + CHROME_BAR_HEIGHT,
    };
}

/**
 * Build the shortcut listener injected into the POPPED-OUT PAGE (not the bar).
 *
 * Same technique and same rules as `buildFindShortcutScript`: bubble phase, so
 * anything the SPA already handles wins; bail on `defaultPrevented`; idempotent
 * so re-injection on every `did-finish-load` is a no-op.
 */
export function buildPopOutShortcutScript(): string {
    // NOTE: this string runs in the popped-out page's context, NOT here. Keep it
    // free of TypeScript syntax and of backticks / ${...}.
    return `(function () {
  if (window.__cocPopOutShortcutsInstalled) { return; }
  var api = window.cocDesktop && window.cocDesktop.popout;
  if (!api || !api.nav) { return; }
  window.__cocPopOutShortcutsInstalled = true;
  window.addEventListener('keydown', function (e) {
    if (e.defaultPrevented) { return; }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); api.nav('back'); return; }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); api.nav('forward'); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault(); api.nav('reload'); return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault(); api.nav('focus-bar'); return;
    }
  });
})();`;
}

/**
 * Build the script that drives the chrome bar's own document. Separated from
 * {@link buildChromeBarHtml} so tests can drive it against a DOM stub, the same
 * way `buildFindBarPageScript` is tested.
 *
 * Focus discipline (the bar and the page share one window): the bar only takes
 * focus on an explicit click or Cmd/Ctrl+L, and Esc always reverts the field to
 * the live URL and hands focus back to the page. While the field has focus the
 * script stops overwriting it, so a state push mid-typing cannot clobber input.
 */
export function buildChromeBarPageScript(): string {
    // NOTE: runs in the chrome bar page's context. No TypeScript, no backticks.
    return `(function () {
  var api = window.cocDesktop && window.cocDesktop.popout;
  if (!api) { return; }

  var formatDisplayUrl = ${formatDisplayUrl.toString()};

  var backBtn = document.getElementById('popout-back');
  var forwardBtn = document.getElementById('popout-forward');
  var reloadBtn = document.getElementById('popout-reload');
  var input = document.getElementById('popout-url');
  var copyBtn = document.getElementById('popout-copy');
  var externalBtn = document.getElementById('popout-external');

  var currentUrl = '';
  var loading = false;
  var editing = false;

  function revert() {
    input.value = formatDisplayUrl(currentUrl);
  }

  api.onState(function (state) {
    currentUrl = state.url || '';
    loading = !!state.loading;
    backBtn.disabled = !state.canGoBack;
    forwardBtn.disabled = !state.canGoForward;
    reloadBtn.textContent = loading ? '\\u2715' : '\\u21bb';
    reloadBtn.title = loading ? 'Stop loading' : 'Reload (Ctrl+R)';
    reloadBtn.setAttribute('aria-label', loading ? 'Stop loading' : 'Reload');
    if (!editing) { revert(); }
  });

  backBtn.addEventListener('click', function () { api.nav('back'); });
  forwardBtn.addEventListener('click', function () { api.nav('forward'); });
  reloadBtn.addEventListener('click', function () { api.nav(loading ? 'stop' : 'reload'); });
  copyBtn.addEventListener('click', function () { api.copyUrl(); });
  externalBtn.addEventListener('click', function () { api.openExternal(); });

  input.addEventListener('focus', function () { editing = true; });
  input.addEventListener('blur', function () { editing = false; revert(); });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      editing = false;
      api.navigate(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing = false;
      revert();
      api.nav('focus-page');
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  // Called by the main process (executeJavaScript) when the page asks for the
  // address field — Cmd/Ctrl+L pressed while the page had focus.
  window.__cocPopOutFocusUrl = function () {
    input.focus();
    input.select();
  };
})();`;
}

/**
 * Full HTML document for the chrome bar `WebContentsView`, loaded as a data:
 * URL. Self-contained: inline styles in the find bar's palette (the view has no
 * access to the SPA's CSS) plus {@link buildChromeBarPageScript}.
 *
 * On macOS the window uses `hiddenInset`, so the traffic lights overlay this
 * strip's top-left — `macInset` adds the matching left padding (the same 88 px
 * clearance `buildMacInsetCss` gives the SPA's own top bar).
 */
export function buildChromeBarHtml(options: { macInset?: boolean } = {}): string {
    const leftPadding = options.macInset ? 88 : 8;
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body {
    display: flex; align-items: center; gap: 6px;
    padding: 0 8px 0 ${leftPadding}px;
    box-sizing: border-box;
    background: #161b22; border-bottom: 1px solid #30363d;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px; color: #e6edf3;
    -webkit-app-region: drag;
  }
  #popout-url {
    flex: 1; min-width: 0; height: 26px; padding: 0 8px; border-radius: 13px;
    border: 1px solid #30363d; background: #0d1117; color: #e6edf3; outline: none;
    font-family: inherit; font-size: 12px; text-overflow: ellipsis;
    -webkit-app-region: no-drag;
  }
  #popout-url:focus { border-color: #58a6ff; text-overflow: clip; }
  button {
    min-width: 26px; height: 26px; padding: 0 6px; border-radius: 4px;
    border: 1px solid #30363d; background: #21262d; color: #e6edf3; cursor: pointer;
    font-size: 13px; line-height: 1;
    -webkit-app-region: no-drag;
  }
  button:disabled { opacity: 0.4; cursor: default; }
</style>
</head>
<body>
  <button id="popout-back" type="button" title="Back (Alt+Left)" aria-label="Back">&#8592;</button>
  <button id="popout-forward" type="button" title="Forward (Alt+Right)" aria-label="Forward">&#8594;</button>
  <button id="popout-reload" type="button" title="Reload (Ctrl+R)" aria-label="Reload">&#8635;</button>
  <input id="popout-url" type="text" spellcheck="false" placeholder="Address"
         aria-label="Address" autocomplete="off">
  <button id="popout-copy" type="button" title="Copy URL" aria-label="Copy URL">&#128203;</button>
  <button id="popout-external" type="button" title="Open in system browser"
          aria-label="Open in system browser">&#8599;</button>
  <script>${buildChromeBarPageScript()}</script>
</body>
</html>`;
}

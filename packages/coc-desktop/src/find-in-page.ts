/**
 * CoC Desktop — find-in-page (Ctrl+F / Cmd+F) support.
 *
 * Electron has no built-in find bar, and the served SPA relies on the browser's
 * native find-in-page for content pages (chat conversations, notes, wiki, diffs)
 * that have no in-app search box of their own. This module supplies that missing
 * capability: a find-bar overlay hosted in its OWN WebContentsView (see
 * `find-bar-host.ts`), wired through IPC to `webContents.findInPage` /
 * `stopFindInPage` on the SPA's webContents.
 *
 * The bar deliberately lives OUTSIDE the searched page — like Chrome's own find
 * bar — because an in-page bar fights the find machinery it drives: the query
 * matches its own input (+1 on every count), find activation steals focus from
 * the input mid-typing, editing during an active session clobbers the input's
 * caret, and stopping a find can wipe the caret entirely. A separate
 * webContents is immune to all of that by construction.
 *
 * The SPA page only gets a tiny injected shortcut listener: it observes Ctrl+F
 * in the bubble phase and bails out whenever the keydown was already
 * `defaultPrevented` — so on the pages where the SPA already owns Ctrl+F (Chat
 * list, Tasks, Work Items), the SPA's own search wins and this bar stays
 * closed. It only opens where nothing else handled the shortcut.
 *
 * Like `splash.ts` and `app-menu.ts`, this module imports NOTHING from
 * `electron`, so the channel constants, the count formatter, and the script /
 * HTML builders are all unit-testable under plain Node/vitest.
 */

/** IPC channel: find-bar renderer → main, "search the page for this text". */
export const FIND_IN_PAGE_CHANNEL = 'coc-desktop:find-in-page';
/** IPC channel: find-bar renderer → main, "clear the current find selection". */
export const STOP_FIND_IN_PAGE_CHANNEL = 'coc-desktop:stop-find-in-page';
/** IPC channel: main → find-bar renderer, carrying an Electron `found-in-page` result. */
export const FIND_RESULT_CHANNEL = 'coc-desktop:find-result';
/** IPC channel: SPA renderer → main, "show and focus the find bar". */
export const OPEN_FIND_BAR_CHANNEL = 'coc-desktop:open-find-bar';
/** IPC channel: find-bar renderer → main, "hide the find bar and stop finding". */
export const CLOSE_FIND_BAR_CHANNEL = 'coc-desktop:close-find-bar';

/** Find-bar view geometry (px). The view is pinned to the window's top-right. */
export const FIND_BAR_WIDTH = 380;
export const FIND_BAR_HEIGHT = 44;
export const FIND_BAR_MARGIN = 12;

/**
 * Render the match-count label shown in the find bar. Mirrors the shape of an
 * Electron `found-in-page` result: `activeMatchOrdinal` is the 1-based index of
 * the highlighted match and `matches` is the total. Zero matches reads as
 * "No results"; otherwise "3/12".
 *
 * Kept as a standalone, dependency-free function so it can be both unit-tested
 * here AND embedded verbatim into the find-bar page script (via `.toString()`),
 * keeping a single source of truth for the formatting.
 */
export function formatFindCount(activeMatchOrdinal: number, matches: number): string {
    if (!matches || matches <= 0) {
        return 'No results';
    }
    return activeMatchOrdinal + '/' + matches;
}

/**
 * Build the tiny script injected into the SPA page (via `executeJavaScript`).
 * It ONLY forwards unhandled Ctrl+F / Cmd+F to the main process; the find bar
 * itself lives in a separate WebContentsView and never touches this page.
 *
 * Bubble-phase listener on window: document-level SPA handlers fire first, so
 * if the active page already handled Ctrl+F (calling preventDefault) we leave
 * it alone and never open the bar.
 *
 * Idempotent — a guard makes re-injection (e.g. on reload) a no-op.
 */
export function buildFindShortcutScript(): string {
    // NOTE: this string runs in the SPA page's context, NOT here. Keep it free
    // of TypeScript syntax and of backticks / ${...}.
    return `(function () {
  if (window.__cocFindShortcutInstalled) { return; }
  var api = window.cocDesktop && window.cocDesktop.find;
  if (!api || !api.openBar) { return; }
  window.__cocFindShortcutInstalled = true;
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      if (e.defaultPrevented) { return; }
      e.preventDefault();
      api.openBar();
    }
  });
})();`;
}

/**
 * Build the script that drives the find-bar page (running in the bar's own
 * WebContentsView, with the standard preload bridge). Separated from
 * `buildFindBarHtml` so tests can drive it against a DOM stub.
 *
 * Electron findInPage semantics: findNext:true BEGINS a new find session
 * (first request for a query); findNext:false advances within the current
 * session. So a (re)typed query passes newSession=true and Enter / the
 * prev-next buttons pass newSession=false — inverting these leaves typing
 * with no session and snaps every Enter back to the first match.
 */
export function buildFindBarPageScript(): string {
    // NOTE: runs in the find-bar page's context. No TypeScript, no backticks.
    return `(function () {
  var api = window.cocDesktop && window.cocDesktop.find;
  if (!api) { return; }

  var formatFindCount = ${formatFindCount.toString()};

  var input = document.getElementById('find-input');
  var count = document.getElementById('find-count');
  var prevBtn = document.getElementById('find-prev');
  var nextBtn = document.getElementById('find-next');
  var closeBtn = document.getElementById('find-close');

  var debounceTimer = null;

  function runFind(newSession, forward) {
    var text = input.value;
    if (!text) { api.stop(); count.textContent = ''; return; }
    api.query(text, { findNext: newSession, forward: forward });
  }

  input.addEventListener('input', function () {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    debounceTimer = setTimeout(function () { runFind(true, true); }, 50);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind(false, !e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      api.closeBar();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      // Ctrl+F while already in the bar: behave like Chrome — reselect.
      e.preventDefault();
      input.focus();
      input.select();
    }
  });

  prevBtn.addEventListener('click', function () { input.focus(); runFind(false, false); });
  nextBtn.addEventListener('click', function () { input.focus(); runFind(false, true); });
  closeBtn.addEventListener('click', function () { api.closeBar(); });

  api.onResult(function (result) {
    if (!input.value) { count.textContent = ''; return; }
    count.textContent = formatFindCount(result.activeMatchOrdinal, result.matches);
  });

  // Called by the main process (executeJavaScript) whenever the bar is shown:
  // focus + select the query and, if one is present, re-run it so the page's
  // highlights come back after a close/reopen.
  window.__cocFindBarFocus = function () {
    input.focus();
    input.select();
    if (input.value) { runFind(true, true); }
  };
})();`;
}

/**
 * Full HTML document for the find-bar WebContentsView, loaded as a data: URL.
 * Self-contained: inline styles (the view has no access to the SPA's CSS) and
 * the page script from `buildFindBarPageScript`.
 */
export function buildFindBarHtml(): string {
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body {
    display: flex; align-items: center; gap: 6px; padding: 0 8px;
    box-sizing: border-box;
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px; color: #e6edf3;
  }
  #find-input {
    flex: 1; min-width: 0; padding: 4px 6px; border-radius: 4px;
    border: 1px solid #30363d; background: #0d1117; color: #e6edf3; outline: none;
  }
  #find-count { min-width: 56px; text-align: center; color: #8b949e; }
  button {
    min-width: 26px; height: 26px; padding: 0 6px; border-radius: 4px;
    border: 1px solid #30363d; background: #21262d; color: #e6edf3; cursor: pointer;
  }
</style>
</head>
<body role="search">
  <input id="find-input" type="text" placeholder="Find" aria-label="Find in page" autofocus>
  <span id="find-count"></span>
  <button id="find-prev" type="button" title="Previous match (Shift+Enter)">&#8593;</button>
  <button id="find-next" type="button" title="Next match (Enter)">&#8595;</button>
  <button id="find-close" type="button" title="Close (Esc)">&#10005;</button>
  <script>${buildFindBarPageScript()}</script>
</body>
</html>`;
}

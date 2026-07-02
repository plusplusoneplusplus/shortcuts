/**
 * CoC Desktop — find-in-page (Ctrl+F / Cmd+F) support.
 *
 * Electron has no built-in find bar, and the served SPA relies on the browser's
 * native find-in-page for content pages (chat conversations, notes, wiki, diffs)
 * that have no in-app search box of their own. This module supplies that missing
 * capability: a small find-bar overlay injected into the renderer, wired through
 * IPC to `webContents.findInPage` / `stopFindInPage` in the main process.
 *
 * The overlay listens on `window` in the bubble phase and bails out whenever the
 * keydown was already `defaultPrevented` — so on the pages where the SPA already
 * owns Ctrl+F (Chat list, Tasks, Work Items), the SPA's own search wins and this
 * bar stays closed. It only opens where nothing else handled the shortcut.
 *
 * Like `splash.ts` and `app-menu.ts`, this module imports NOTHING from `electron`,
 * so the channel constants, the count formatter, and the injected-script builder
 * are all unit-testable under plain Node/vitest.
 */

/** IPC channel: renderer → main, "search the page for this text". */
export const FIND_IN_PAGE_CHANNEL = 'coc-desktop:find-in-page';
/** IPC channel: renderer → main, "clear the current find selection". */
export const STOP_FIND_IN_PAGE_CHANNEL = 'coc-desktop:stop-find-in-page';
/** IPC channel: main → renderer, carrying an Electron `found-in-page` result. */
export const FIND_RESULT_CHANNEL = 'coc-desktop:find-result';

/**
 * Render the match-count label shown in the find bar. Mirrors the shape of an
 * Electron `found-in-page` result: `activeMatchOrdinal` is the 1-based index of
 * the highlighted match and `matches` is the total. Zero matches reads as
 * "No results"; otherwise "3/12".
 *
 * Kept as a standalone, dependency-free function so it can be both unit-tested
 * here AND embedded verbatim into the injected renderer script (via
 * `.toString()`), keeping a single source of truth for the formatting.
 */
export function formatFindCount(activeMatchOrdinal: number, matches: number): string {
    if (!matches || matches <= 0) {
        return 'No results';
    }
    return activeMatchOrdinal + '/' + matches;
}

/**
 * Build the self-contained JavaScript injected into the renderer (via
 * `webContents.executeJavaScript`) that creates and drives the find bar.
 *
 * The script is idempotent — a `__cocFindBarInstalled` guard makes re-injection
 * (e.g. on reload) a no-op. All styling is applied via the CSSOM (`el.style`),
 * never an injected `<style>` element, so a strict page CSP cannot block it.
 */
export function buildFindBarScript(): string {
    // NOTE: this string runs in the page's context, NOT here. Keep it free of
    // TypeScript syntax and of backticks / ${...} so it nests cleanly in this
    // template literal.
    return `(function () {
  if (window.__cocFindBarInstalled) { return; }
  var api = window.cocDesktop && window.cocDesktop.find;
  if (!api) { return; }
  window.__cocFindBarInstalled = true;

  var formatFindCount = ${formatFindCount.toString()};

  var bar = document.createElement('div');
  bar.setAttribute('role', 'search');
  bar.style.cssText = 'position:fixed;top:12px;right:16px;z-index:2147483647;display:none;' +
    'align-items:center;gap:6px;padding:6px 8px;border-radius:8px;' +
    'background:#161b22;border:1px solid #30363d;box-shadow:0 6px 20px rgba(0,0,0,0.4);' +
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#e6edf3;';

  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Find';
  input.setAttribute('aria-label', 'Find in page');
  input.style.cssText = 'width:200px;padding:4px 6px;border-radius:4px;border:1px solid #30363d;' +
    'background:#0d1117;color:#e6edf3;outline:none;';

  var count = document.createElement('span');
  count.style.cssText = 'min-width:56px;text-align:center;color:#8b949e;';

  function makeButton(label, title) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'min-width:26px;height:26px;padding:0 6px;border-radius:4px;' +
      'border:1px solid #30363d;background:#21262d;color:#e6edf3;cursor:pointer;';
    return b;
  }
  var prevBtn = makeButton('\\u2191', 'Previous match (Shift+Enter)');
  var nextBtn = makeButton('\\u2193', 'Next match (Enter)');
  var closeBtn = makeButton('\\u2715', 'Close (Esc)');

  bar.appendChild(input);
  bar.appendChild(count);
  bar.appendChild(prevBtn);
  bar.appendChild(nextBtn);
  bar.appendChild(closeBtn);

  function mount() {
    if (!bar.parentNode && document.body) { document.body.appendChild(bar); }
  }

  var isOpen = false;
  var debounceTimer = null;

  function runFind(findNext, forward) {
    var text = input.value;
    if (!text) { api.stop(); count.textContent = ''; return; }
    api.query(text, { findNext: findNext, forward: forward });
  }

  function open() {
    mount();
    isOpen = true;
    bar.style.display = 'flex';
    input.focus();
    input.select();
    if (input.value) { runFind(true, true); }
  }

  function close() {
    isOpen = false;
    bar.style.display = 'none';
    count.textContent = '';
    api.stop();
  }

  input.addEventListener('input', function () {
    if (debounceTimer) { clearTimeout(debounceTimer); }
    debounceTimer = setTimeout(function () { runFind(false, true); }, 120);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      runFind(true, !e.shiftKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  prevBtn.addEventListener('click', function () { input.focus(); runFind(true, false); });
  nextBtn.addEventListener('click', function () { input.focus(); runFind(true, true); });
  closeBtn.addEventListener('click', function () { close(); });

  // Bubble-phase listener on window: document-level SPA handlers fire first, so
  // if the active page already handled Ctrl+F (calling preventDefault) we leave
  // it alone and never open this bar.
  window.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
      if (e.defaultPrevented) { return; }
      e.preventDefault();
      open();
    }
  });

  api.onResult(function (result) {
    if (!isOpen) { return; }
    if (!input.value) { count.textContent = ''; return; }
    count.textContent = formatFindCount(result.activeMatchOrdinal, result.matches);
  });
})();`;
}

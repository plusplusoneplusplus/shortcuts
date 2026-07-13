/**
 * E2E runner for the find bar — executed inside a REAL Electron main process
 * (spawned by find-bar.e2e.test.ts). Loads a mock "workspace" page (left panel
 * + right conversation pane with known text), wires the real compiled product
 * modules (dist/find-bar-host.js + dist/preload.js), and drives the bar with
 * real input events. Emits one `E2E::{json}` line per step; the vitest side
 * parses and asserts them.
 *
 * Kept as plain CommonJS: Electron loads it directly as an app main script.
 */
'use strict';

const path = require('path');
const { app, BrowserWindow, webContents } = require('electron');
const { registerFindBarIpc, attachFindBar } = require(
    path.join(__dirname, '..', '..', 'dist', 'find-bar-host.js'),
);
const { FIND_BAR_WIDTH, FIND_BAR_MARGIN } = require(
    path.join(__dirname, '..', '..', 'dist', 'find-in-page.js'),
);

/** Mock data: a fake workspace layout. "needle" appears 3 times across the
 *  left panel (1) and the right conversation pane (2); the find-bar query box
 *  itself must never add a 4th. */
const MOCK_PAGE = 'data:text/html,' + encodeURIComponent(`<!doctype html>
<html><body>
  <div id="left-panel">
    <div class="chat-row">chat about the needle refactor</div>
    <div class="chat-row">unrelated chat</div>
  </div>
  <div data-pane="detail" id="right-panel">
    <p>user: where is the needle module?</p>
    <p>assistant: the needle module moved to src/lib.</p>
    <p>assistant: nothing else here.</p>
  </div>
  <script>
    // Mock of the SPA's scoped Ctrl+F ownership (useScopedFindShortcut):
    // while __spaOwnsFind is set, a document-level handler claims the keydown.
    window.__spaOwnsFind = false;
    document.addEventListener('keydown', function (e) {
      if (window.__spaOwnsFind && (e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
      }
    });
  </script>
</body></html>`);

const emit = (step, data) => console.log('E2E::' + JSON.stringify({ step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function key(wc, keyCode, modifiers = []) {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}

async function typeText(wc, text) {
    for (const ch of text) {
        wc.sendInputEvent({ type: 'keyDown', keyCode: ch });
        wc.sendInputEvent({ type: 'char', keyCode: ch });
        wc.sendInputEvent({ type: 'keyUp', keyCode: ch });
        await sleep(20);
    }
}

function findBarWc(mainWcId) {
    return webContents.getAllWebContents().find(
        (wc) => wc.id !== mainWcId
            && wc.getURL().startsWith('data:text/html')
            && wc.getURL().includes('find-input'),
    );
}

app.whenReady().then(async () => {
    registerFindBarIpc();
    const win = new BrowserWindow({
        width: 900,
        height: 600,
        show: true,
        webPreferences: {
            preload: path.join(__dirname, '..', '..', 'dist', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    attachFindBar(win);

    let lastResult = null;
    win.webContents.on('found-in-page', (_e, r) => {
        lastResult = { ordinal: r.activeMatchOrdinal, matches: r.matches };
    });

    await win.loadURL(MOCK_PAGE);
    await sleep(400);
    win.focus();

    const mainWc = win.webContents;
    const barState = () => ({ childViews: win.contentView.children.length });

    // 1. Preload bridge + shortcut script installed in the mock SPA page.
    emit('bridge', await mainWc.executeJavaScript(`({
        hasFind: !!(window.cocDesktop && window.cocDesktop.find),
        shortcutInstalled: !!window.__cocFindShortcutInstalled,
    })`));

    // 2. While the SPA owns Ctrl+F (preventDefault), the bar must NOT open.
    await mainWc.executeJavaScript('window.__spaOwnsFind = true');
    key(mainWc, 'f', ['control']);
    await sleep(300);
    emit('spa-owned', barState());
    await mainWc.executeJavaScript('window.__spaOwnsFind = false');

    // 3. Unhandled Ctrl+F opens the bar, pinned to the top-right.
    key(mainWc, 'f', ['control']);
    await sleep(400);
    const barWc = findBarWc(mainWc.id);
    const bounds = win.contentView.children[0] ? win.contentView.children[0].getBounds() : null;
    const [contentWidth] = win.getContentSize();
    emit('open', {
        ...barState(),
        hasBarWc: !!barWc,
        bounds,
        expectedX: Math.max(0, contentWidth - FIND_BAR_WIDTH - FIND_BAR_MARGIN),
    });
    if (!barWc) {
        app.exit(1);
        return;
    }

    // 4. Typing searches the mock panels — exactly 3 matches, no self-match.
    await typeText(barWc, 'needle');
    await sleep(400);
    emit('type', {
        ...(await barWc.executeJavaScript(`({
            value: document.getElementById('find-input').value,
            count: document.getElementById('find-count').textContent,
        })`)),
        lastResult,
    });

    // 5. Enter cycles matches forward and wraps; Shift+Enter goes back.
    const ordinals = [];
    for (let i = 0; i < 3; i++) {
        key(barWc, 'Return');
        await sleep(250);
        ordinals.push(lastResult && lastResult.ordinal);
    }
    key(barWc, 'Return', ['shift']);
    await sleep(250);
    emit('cycle', { ordinals, afterShiftEnter: lastResult && lastResult.ordinal });

    // 6. Backspace edits the query live.
    key(barWc, 'Backspace');
    key(barWc, 'Backspace');
    await sleep(400);
    emit('edit', {
        value: await barWc.executeJavaScript(`document.getElementById('find-input').value`),
        lastResult,
    });

    // 7. Escape closes the bar and detaches the view.
    key(barWc, 'Escape');
    await sleep(300);
    emit('close', barState());

    // 8. Reopen re-attaches and re-runs the persisted query.
    lastResult = null;
    key(mainWc, 'f', ['control']);
    await sleep(400);
    emit('reopen', {
        ...barState(),
        value: await barWc.executeJavaScript(`document.getElementById('find-input').value`),
        lastResult,
    });

    // 9. Resizing keeps the bar pinned to the top-right.
    win.setContentSize(700, 500);
    await sleep(300);
    const bounds2 = win.contentView.children[0] ? win.contentView.children[0].getBounds() : null;
    emit('resize', {
        bounds: bounds2,
        expectedX: Math.max(0, 700 - FIND_BAR_WIDTH - FIND_BAR_MARGIN),
    });

    app.exit(0);
});

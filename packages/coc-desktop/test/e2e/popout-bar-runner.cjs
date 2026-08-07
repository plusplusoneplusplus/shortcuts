/**
 * E2E runner for the pop-out address bar — executed inside a REAL Electron main
 * process (spawned by popout-bar.e2e.test.ts). Serves a two-page fixture over
 * loopback HTTP (the allow-list only matches same-origin http(s), so a data:
 * URL would never be intercepted), wires the real compiled product modules
 * (dist/popout-window-host.js + dist/preload.js), and drives the bar through its
 * own document. Emits one `E2E::{json}` line per step; the vitest side parses
 * and asserts them.
 *
 * Kept as plain CommonJS: Electron loads it directly as an app main script.
 */
'use strict';

const path = require('path');
const http = require('http');
const { app, BrowserWindow, shell } = require('electron');

const distDir = path.join(__dirname, '..', '..', 'dist');
const { registerPopOutIpc, createPopOutWindow } = require(path.join(distDir, 'popout-window-host.js'));
const { CHROME_BAR_HEIGHT, isPopOutChildUrl } = require(path.join(distDir, 'popout-chrome.js'));

const emit = (step, data) => console.log('E2E::' + JSON.stringify({ step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every URL handed to the system browser, so AC-04 can be asserted. */
const externalCalls = [];
shell.openExternal = (url) => {
    externalCalls.push(url);
    return Promise.resolve();
};

/** Two same-origin pages, each a `#popout/markdown` route. */
function startServer() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`<!doctype html><html><body><h1>page ${req.url}</h1></body></html>`);
        });
        server.listen(0, '127.0.0.1', () => resolve(server));
    });
}

app.whenReady().then(async () => {
    const server = await startServer();
    const origin = `http://127.0.0.1:${server.address().port}`;
    const appUrl = `${origin}/`;
    const pageOne = `${origin}/?p=1#popout/markdown`;
    const pageTwo = `${origin}/?p=2#popout/markdown`;

    registerPopOutIpc();

    const main = new BrowserWindow({
        width: 900,
        height: 600,
        show: true,
        webPreferences: {
            preload: path.join(distDir, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    main.webContents.setWindowOpenHandler(({ url, frameName, features }) => {
        if (isPopOutChildUrl(url, appUrl)) {
            createPopOutWindow({ url, name: frameName, features, appUrl });
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
    await main.loadURL(appUrl);
    await sleep(300);

    // 1. A pop-out-shaped window.open is intercepted and rebuilt with chrome.
    //    The SPA sees `null` back — that is the case popOutOpened() covers.
    const openResult = await main.webContents.executeJavaScript(
        `String(window.open(${JSON.stringify(pageOne)}, 'coc-e2e-popout', 'width=700,height=500'))`,
    );
    await sleep(1200);

    const popouts = BrowserWindow.getAllWindows().filter((w) => w.id !== main.id);
    const popout = popouts[0];
    if (!popout) {
        emit('open', { windowCount: 0, openResult });
        app.exit(1);
        return;
    }
    const views = popout.contentView.children;
    const pageView = views[0];
    const chromeView = views[1];
    const [contentWidth, contentHeight] = popout.getContentSize();
    emit('open', {
        openResult,
        windowCount: popouts.length,
        viewCount: views.length,
        chromeBounds: chromeView.getBounds(),
        pageBounds: pageView.getBounds(),
        expectedChrome: { x: 0, y: 0, width: contentWidth, height: CHROME_BAR_HEIGHT },
        expectedPage: {
            x: 0,
            y: CHROME_BAR_HEIGHT,
            width: contentWidth,
            height: contentHeight - CHROME_BAR_HEIGHT,
        },
        // The features string asked for a 500 px page; the strip is added on top.
        contentHeight,
        expectedContentHeight: 500 + CHROME_BAR_HEIGHT,
    });

    const barWc = chromeView.webContents;
    const pageWc = pageView.webContents;
    const readBar = () => barWc.executeJavaScript(`({
        url: document.getElementById('popout-url').value,
        canGoBack: !document.getElementById('popout-back').disabled,
        canGoForward: !document.getElementById('popout-forward').disabled,
    })`);

    // 2. The bar shows the popped-out URL with no history behind it yet.
    emit('initial', { ...(await readBar()), pageUrl: pageWc.getURL() });

    // 3. Typing a same-origin URL navigates the PAGE view (AC-04 internal).
    await barWc.executeJavaScript(`(function () {
        var input = document.getElementById('popout-url');
        input.focus();
        input.value = ${JSON.stringify(pageTwo)};
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(1000);
    emit('navigate', { ...(await readBar()), pageUrl: pageWc.getURL() });

    // 4. Back returns to the first page and flips the buttons around.
    await barWc.executeJavaScript(`document.getElementById('popout-back').click()`);
    await sleep(1000);
    emit('back', { ...(await readBar()), pageUrl: pageWc.getURL() });

    // 5. A typed cross-origin URL goes to the system browser and leaves the
    //    page view exactly where it was (AC-04 external).
    await barWc.executeJavaScript(`(function () {
        var input = document.getElementById('popout-url');
        input.focus();
        input.value = 'https://example.com/docs';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(600);
    emit('external', { externalCalls: externalCalls.slice(), pageUrl: pageWc.getURL() });

    // 6. A rejected scheme navigates nothing and opens nothing.
    await barWc.executeJavaScript(`(function () {
        var input = document.getElementById('popout-url');
        input.focus();
        input.value = 'javascript:window.__pwned = 1';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await sleep(600);
    emit('rejected', {
        externalCallCount: externalCalls.length,
        pageUrl: pageWc.getURL(),
        barUrl: (await readBar()).url,
    });

    // 7. Re-opening the same window NAME focuses the existing window instead of
    //    spawning a second one — MarkdownReviewDialog & friends depend on this.
    await main.webContents.executeJavaScript(
        `window.open(${JSON.stringify(pageOne)}, 'coc-e2e-popout', 'width=700,height=500')`,
    );
    await sleep(800);
    emit('reuse', {
        windowCount: BrowserWindow.getAllWindows().filter((w) => w.id !== main.id).length,
    });

    // 8. Resizing keeps both views filling the window.
    popout.setContentSize(600, 400);
    await sleep(500);
    emit('resize', {
        chromeBounds: chromeView.getBounds(),
        pageBounds: pageView.getBounds(),
    });

    server.close();
    app.exit(0);
});

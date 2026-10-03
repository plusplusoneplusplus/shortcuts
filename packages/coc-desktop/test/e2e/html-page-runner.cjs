/**
 * E2E runner for the HTML page tab host — executed inside a REAL Electron main
 * process (spawned by html-page.e2e.test.ts). Writes a fixture folder
 * (index.html + sibling style.css + other.html), loads a stand-in SPA document
 * with the real preload, and drives `window.cocDesktop.htmlPage` from it
 * exactly like the SPA will. Emits one `E2E::{json}` line per step; the vitest
 * side parses and asserts them.
 *
 * Kept as plain CommonJS: Electron loads it directly as an app main script.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, shell } = require('electron');

const distDir = path.join(__dirname, '..', '..', 'dist');
const { registerHtmlPageIpc } = require(path.join(distDir, 'html-page-host.js'));

const emit = (step, data) => console.log('E2E::' + JSON.stringify({ step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every URL handed to the system browser. */
const externalCalls = [];
shell.openExternal = (url) => {
    externalCalls.push(url);
    return Promise.resolve();
};

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-html-page-e2e-'));
const indexPath = path.join(fixtureDir, 'index.html');
const otherPath = path.join(fixtureDir, 'other.html');
const brokenPath = path.join(fixtureDir, 'broken.html');
fs.writeFileSync(path.join(fixtureDir, 'style.css'), 'body { background-color: rgb(1, 2, 3); }\n');
fs.writeFileSync(indexPath, '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head>'
    + '<body><h1 id="title">Fixture</h1></body></html>');
fs.writeFileSync(otherPath, '<!doctype html><html><body><h1>Other</h1></body></html>');
fs.writeFileSync(brokenPath, '<!doctype html><html><body>will be deleted</body></html>');

/** Stand-in SPA: a right-panel placeholder the page view should cover. */
const spaHtml = '<!doctype html><html><body style="margin:0">'
    + '<div id="slot" style="position:absolute;left:400px;top:50px;width:300px;height:200px"></div>'
    + '<script>window.__states = []; window.cocDesktop.htmlPage.onState(function (s) { window.__states.push(s); });'
    + 'window.__place = function (id) { var r = document.getElementById("slot").getBoundingClientRect();'
    + ' window.cocDesktop.htmlPage.setBounds(id, { x: r.x, y: r.y, width: r.width, height: r.height }); };'
    + '</script></body></html>';

app.whenReady().then(async () => {
    registerHtmlPageIpc();

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
    await main.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(spaHtml));
    await sleep(200);
    const spa = (js) => main.webContents.executeJavaScript(js);

    // 1. Open requests the main process must refuse.
    const rejectNotHtml = await spa(`window.cocDesktop.htmlPage.open('bad', ${JSON.stringify(path.join(fixtureDir, 'style.css'))})`);
    const rejectMissing = await spa(`window.cocDesktop.htmlPage.open('bad', ${JSON.stringify(path.join(fixtureDir, 'nope.html'))})`);
    const rejectRelative = await spa(`window.cocDesktop.htmlPage.open('bad', 'index.html')`);
    emit('reject', { rejectNotHtml, rejectMissing, rejectRelative, viewCount: main.contentView.children.length });

    // 2. Open + place the page; it renders with the sibling CSS and no bridge.
    const openResult = await spa(`window.cocDesktop.htmlPage.open('p1', ${JSON.stringify(indexPath)})`);
    await spa(`window.__place('p1')`);
    await sleep(1200);
    const view = main.contentView.children[0];
    const pageWc = view && view.webContents;
    if (!pageWc) {
        emit('open', { openResult, viewCount: main.contentView.children.length });
        app.exit(1);
        return;
    }
    const probe = await pageWc.executeJavaScript(`({
        background: getComputedStyle(document.body).backgroundColor,
        title: document.getElementById('title') && document.getElementById('title').textContent,
        hasBridge: typeof window.cocDesktop !== 'undefined',
        hasRequire: typeof require !== 'undefined',
        hasProcess: typeof process !== 'undefined',
    })`);
    emit('open', {
        openResult,
        viewCount: main.contentView.children.length,
        bounds: view.getBounds(),
        visible: view.getVisible(),
        url: pageWc.getURL(),
        expectedUrl: require('url').pathToFileURL(indexPath).href,
        states: (await spa('window.__states')).map((s) => s.status),
        ...probe,
    });

    // 3. Opening the same id + path again reuses the view.
    const stateCount = (await spa('window.__states')).length;
    const reopen = await spa(`window.cocDesktop.htmlPage.open('p1', ${JSON.stringify(indexPath)})`);
    await sleep(100);
    emit('reuse', {
        reopen, viewCount: main.contentView.children.length,
        replayed: (await spa('window.__states')).slice(stateCount).map(s => s.status),
    });

    // 4. The panel resizes: the SPA re-reports its placeholder and the view follows.
    await spa(`(function () { var s = document.getElementById('slot'); s.style.left = '300px'; s.style.width = '500px'; s.style.height = '350px'; window.__place('p1'); })()`);
    await sleep(300);
    emit('resize', { bounds: view.getBounds(), visible: view.getVisible() });

    // 5. Hide (tab switch / panel collapse), then show again.
    await spa(`window.cocDesktop.htmlPage.hide('p1')`);
    await sleep(200);
    const hiddenByHide = !view.getVisible();
    await spa(`window.__place('p1')`);
    await sleep(200);
    const shownAgain = view.getVisible();
    await spa(`window.cocDesktop.htmlPage.setBounds('p1', null)`);
    await sleep(200);
    const hiddenByNull = !view.getVisible();
    await spa(`window.__place('p1')`);
    await sleep(200);
    emit('hide', { hiddenByHide, shownAgain, hiddenByNull });

    // 6. Navigation policy: external http(s) → system browser; sibling page in place.
    await pageWc.executeJavaScript(`location.href = 'https://example.com/nav'`);
    await sleep(500);
    await pageWc.executeJavaScript(`window.open('https://example.com/popup'); 1`);
    await sleep(300);
    const afterExternalUrl = pageWc.getURL();
    await pageWc.executeJavaScript(`location.href = 'other.html'`);
    await sleep(800);
    emit('navigate', {
        externalCalls: externalCalls.slice(),
        afterExternalUrl,
        afterSiblingUrl: pageWc.getURL(),
        windowCount: BrowserWindow.getAllWindows().length,
    });

    // 7. Open in system browser hands over the current file:// URL.
    await spa(`window.cocDesktop.htmlPage.openExternal('p1')`);
    await sleep(200);
    emit('open-external', { last: externalCalls[externalCalls.length - 1] });

    // 8. A load failure is reported so the tab can show its error state.
    await spa(`window.cocDesktop.htmlPage.open('p2', ${JSON.stringify(brokenPath)})`);
    await spa(`window.__place('p2')`);
    await sleep(800);
    fs.unlinkSync(brokenPath);
    await spa(`window.cocDesktop.htmlPage.reload('p2')`);
    await sleep(800);
    const p2States = (await spa('window.__states')).filter((s) => s.pageId === 'p2');
    emit('failure', { last: p2States[p2States.length - 1], viewCount: main.contentView.children.length });

    // 9. Closing the tabs destroys the views.
    await spa(`window.cocDesktop.htmlPage.close('p1'); window.cocDesktop.htmlPage.close('p2')`);
    await sleep(300);
    emit('close', { viewCount: main.contentView.children.length, pageDestroyed: pageWc.isDestroyed() });

    // 10. A normal quit with a page tab still open must finish: the window
    //     'closed' teardown runs after the window is destroyed (regression:
    //     it read win.webContents there, threw, and app.quit() hung).
    await spa(`window.cocDesktop.htmlPage.open('p3', ${JSON.stringify(indexPath)})`);
    await spa(`window.__place('p3')`);
    await sleep(500);
    const liveViews = main.contentView.children.length;
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    app.on('will-quit', () => emit('quit', { liveViews }));
    setTimeout(() => {
        emit('quit-hung', { liveViews });
        app.exit(2);
    }, 10_000).unref();
    app.quit();
}).catch((err) => {
    console.error(err);
    app.exit(1);
});

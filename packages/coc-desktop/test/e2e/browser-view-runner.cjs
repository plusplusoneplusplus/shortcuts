/**
 * E2E runner for the browser tab host — executed inside a REAL Electron main
 * process (spawned by browser-view.e2e.test.ts). Starts local HTTP fixture
 * servers, loads a stand-in SPA document with the real preload, and drives
 * `window.cocDesktop.browser` from it exactly like the SPA will. Emits one
 * `E2E::{json}` line per step; the vitest side parses and asserts them.
 *
 * `argv` containing `--restart-check` runs only the restart phase: a fresh
 * process (same userData dir) reopens a tab with the same session key and
 * reports whether any cookie survived.
 *
 * Kept as plain CommonJS: Electron loads it directly as an app main script.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { app, BrowserWindow, session, shell, webContents } = require('electron');

const distDir = path.join(__dirname, '..', '..', 'dist');
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require(path.join(distDir, 'browser-view-host.js'));
const { fixtureScript } = require('./webview-fixture.cjs');
const { checkWebviewSecurity, checkDomCompositing } = require('./webview-security-checks.cjs');

const restartCheck = process.argv.includes('--restart-check');
if (process.env.COC_BROWSER_E2E_USER_DATA) {
    app.setPath('userData', process.env.COC_BROWSER_E2E_USER_DATA);
}
const downloadsDir = fs.mkdtempSync(path.join(process.env.COC_BROWSER_E2E_USER_DATA, 'downloads-'));
app.setPath('downloads', downloadsDir);

const emit = (step, data) => console.log('E2E::' + JSON.stringify({ step, ...data }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every URL handed to the system browser. */
const externalCalls = [];
shell.openExternal = (url) => {
    externalCalls.push(url);
    return Promise.resolve();
};

const page = (title, body = '') => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    switch (url.pathname) {
        case '/':
            res.setHeader('Content-Type', 'text/html');
            res.end(page('Home', '<a id="next" href="/second">next</a>'));
            return;
        case '/second':
            res.setHeader('Content-Type', 'text/html');
            res.end(page('Second'));
            return;
        case '/redirect':
            res.writeHead(302, { Location: '/landed' });
            res.end();
            return;
        case '/landed':
            res.setHeader('Content-Type', 'text/html');
            res.end(page('Landed'));
            return;
        case '/slow':
            // Never finishes on its own; the test stops it.
            res.setHeader('Content-Type', 'text/html');
            res.write('<!doctype html><html><head><title>Slow</title></head><body>');
            setTimeout(() => res.end('</body></html>'), 20_000);
            return;
        case '/login':
            // The sign-in pop-up: sets a session cookie, tells the opener, closes.
            res.setHeader('Set-Cookie', 'sid=signed-in; Path=/; Max-Age=3600');
            res.setHeader('Content-Type', 'text/html');
            res.end(page('Login', '<script>window.opener && window.opener.postMessage("signed-in", "*");</script>'));
            return;
        case '/file.zip':
            res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="file.zip"' });
            res.end('PK fake zip');
            return;
        default:
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end(page('Not found'));
    }
}

function listen(server, port = 0) {
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
}

/** Stand-in SPA: a right-panel placeholder the browser view should cover. */
const spaHtml = '<!doctype html><html><body style="margin:0">'
    + '<div id="slot" style="position:absolute;left:400px;top:50px;width:400px;height:300px"></div>'
    + '<script>window.__states = []; window.__newTabs = []; window.__downloads = []; window.__closeRequests = [];'
    + 'var b = window.cocDesktop.browser;'
    + 'b.onState(function (s) { window.__states.push(s); });'
    + 'b.onNewTab(function (r) { window.__newTabs.push(r); });'
    + 'b.onDownload(function (d) { window.__downloads.push(d); });'
    + 'b.onCloseRequested(function (r) { window.__closeRequests.push(r); });'
    + 'window.__last = function (id) { var l = window.__states.filter(function (s) { return s.viewId === id; }); return l[l.length - 1] || null; };'
    + 'window.__place = function (id) { var r = document.getElementById("slot").getBoundingClientRect();'
    + ' window.__browser.setBounds(id, { x: r.x, y: r.y, width: r.width, height: r.height }); };'
    + '</script></body></html>';

async function waitFor(fn, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const value = await fn();
        if (value) return value;
        await sleep(50);
    }
    return null;
}

app.whenReady().then(async () => {
    registerBrowserViewIpc(path.join(app.getPath('userData'), 'coc'));
    const server = http.createServer(handler);
    const port = await listen(server);
    const base = `http://127.0.0.1:${port}`;

    const main = new BrowserWindow({
        width: 1000,
        height: 700,
        show: true,
        webPreferences: {
            preload: path.join(distDir, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true,
        },
    });
    const spaUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(spaHtml);
    registerBrowserEmbedder(main, spaUrl);
    await main.loadURL(spaUrl);
    await main.webContents.executeJavaScript(fixtureScript);
    await sleep(200);
    const spa = (js) => main.webContents.executeJavaScript(js.replaceAll('window.cocDesktop.browser.', 'window.__browser.'));
    const last = (id) => spa(`window.__last(${JSON.stringify(id)})`);
    const views = new Map();
    const viewFor = id => views.get(id);
    const children = () => [...views.values()].filter(view => !view.webContents.isDestroyed()).length;
    const settled = (id, pred) => waitFor(async () => {
        const s = await last(id);
        return s && !s.loading && pred(s) ? s : null;
    });

    const open = async (id, url, key) => {
        const result = await spa(`window.__browser.open(${JSON.stringify(id)}, ${JSON.stringify(url)}, ${JSON.stringify(key)})`);
        if (result.ok) {
            const guestId = await spa(`window.__webviews.get(${JSON.stringify(id)}).getWebContentsId()`);
            views.set(id, {
                webContents: webContents.fromId(guestId),
                getBounds: () => spa(`(() => {const r=window.__webviews.get(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`),
                getVisible: () => spa(`window.__webviews.get(${JSON.stringify(id)}).style.visibility !== 'hidden'`),
            });
        }
        return result;
    };
    if (restartCheck) {
        await open('r1', base + '/', 'ws-a');
        const s = await settled('r1', (st) => st.title === 'Home');
        const wc = viewFor('r1').webContents;
        emit('restart', {
            title: s && s.title,
            cookie: await wc.executeJavaScript('document.cookie'),
            canGoBack: s && s.canGoBack,
        });
        await disposeBrowserViews();
        server.close();
        // Quit the way the real app does (windows close first), not app.exit().
        app.quit();
        return;
    }

    // 1. Refused open requests create no view.
    emit('reject', {
        ftp: await open('bad', 'ftp://127.0.0.1/', 'ws-a'),
        file: await open('bad', 'file:///etc/hosts', 'ws-a'),
        text: await open('bad', 'hello world', 'ws-a'),
        noSession: await open('bad', base + '/', ''),
        viewCount: children(),
    });

    // 2. Open + place: renders the page, no CoC bridge, state carries url/title.
    const openResult = await open('b1', base + '/', 'ws-a');
    await spa(`window.__place('b1')`);
    const home = await settled('b1', (s) => s.title === 'Home');
    const b1 = viewFor('b1');
    const probe = await b1.webContents.executeJavaScript(`({
        hasBridge: typeof window.cocDesktop !== 'undefined',
        hasRequire: typeof require !== 'undefined',
        hasProcess: typeof process !== 'undefined',
    })`);
    emit('open', {
        openResult, home, viewCount: children(), bounds: await b1.getBounds(), visible: await b1.getVisible(),
        partitionPersistent: b1.webContents.session.isPersistent(),
        userAgent: b1.webContents.getUserAgent(),
        ...probe,
    });
    emit('dom-compositing', await checkDomCompositing(main, b1.webContents));
    emit('webview-security', await checkWebviewSecurity(main, base));

    // Native page focus must forward through the real preload, never page DOM.
    const modifiers = [process.platform === 'darwin' ? 'meta' : 'control'];
    await b1.webContents.executeJavaScript(`document.body.innerHTML += '<input id="editable">';
        document.getElementById('editable').focus();
        window.__pageCloseKeys = 0;
        document.addEventListener('keydown', e => { if (e.key.toLowerCase() === 'w') window.__pageCloseKeys++; });`);
    b1.webContents.focus();
    const press = async (key, mods) => {
        b1.webContents.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
        b1.webContents.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
        await sleep(100);
    };
    await press('W', [...modifiers, 'alt']);
    const beforeClose = await spa('window.__closeRequests.length');
    const beforePage = await b1.webContents.executeJavaScript('window.__pageCloseKeys');
    await press('W', modifiers);
    await waitFor(async () => (await spa('window.__closeRequests.length')) === beforeClose + 1);
    await press('W', [...modifiers, 'isautorepeat']);
    const forwarded = await spa('window.__closeRequests');
    const pageCloseKeys = await b1.webContents.executeJavaScript('window.__pageCloseKeys');
    await spa("window.cocDesktop.browser.hide('b1')");
    await sleep(100);
    await press('W', modifiers);
    emit('close-shortcut', {
        forwarded, beforeClose, beforePage, pageCloseKeys,
        afterHidden: await spa('window.__closeRequests.length'),
        windowAlive: !main.isDestroyed(), viewAlive: !b1.webContents.isDestroyed(),
    });
    await spa("window.__place('b1')");

    // 3. Link click navigates in the tab; redirects and in-page navigation update the URL.
    await b1.webContents.executeJavaScript(`document.getElementById('next').click()`, true);
    const second = await settled('b1', (s) => s.title === 'Second');
    await spa(`window.cocDesktop.browser.navigate('b1', ${JSON.stringify(base + '/redirect')})`);
    const landed = await settled('b1', (s) => s.title === 'Landed');
    await b1.webContents.executeJavaScript(`history.pushState({}, '', '/landed?tab=2'); 1`, true);
    const inPage = await waitFor(async () => {
        const s = await last('b1');
        return s && s.url.endsWith('/landed?tab=2') ? s : null;
    });
    emit('navigate', { second, landed, inPage });

    // 4. History: back, then forward.
    await spa(`window.cocDesktop.browser.nav('b1', 'back')`);
    await sleep(300);
    await spa(`window.cocDesktop.browser.nav('b1', 'back')`);
    const back = await settled('b1', (s) => s.title === 'Second');
    await spa(`window.cocDesktop.browser.nav('b1', 'forward')`);
    const forward = await settled('b1', (s) => s.title === 'Landed');
    emit('history', { back, forward });

    // 5. Stop a slow load; reload a finished page.
    await spa(`window.cocDesktop.browser.navigate('b1', ${JSON.stringify(base + '/slow')})`);
    const slowLoading = await waitFor(async () => {
        const s = await last('b1');
        return s && s.loading && s.url.endsWith('/slow') ? s : null;
    });
    await sleep(300);
    await spa(`window.cocDesktop.browser.nav('b1', 'stop')`);
    const stopped = await settled('b1', () => true);
    await spa(`window.cocDesktop.browser.navigate('b1', ${JSON.stringify(base + '/')})`);
    await settled('b1', (s) => s.title === 'Home');
    const beforeReload = (await spa('window.__states')).length;
    await spa(`window.cocDesktop.browser.nav('b1', 'reload')`);
    await sleep(100);
    const reloaded = await settled('b1', (s) => s.title === 'Home');
    const sawReloadLoading = (await spa('window.__states')).slice(beforeReload).some((s) => s.viewId === 'b1' && s.loading);
    emit('stop-reload', { slowLoading: !!slowLoading, stopped, reloaded, sawReloadLoading });

    // 6. Failure then retry: a down server, then the same URL once it is back.
    const flaky = http.createServer(handler);
    const flakyPort = await listen(flaky);
    await new Promise((r) => flaky.close(r));
    const flakyUrl = `http://127.0.0.1:${flakyPort}/second`;
    await spa(`window.cocDesktop.browser.navigate('b1', ${JSON.stringify(flakyUrl)})`);
    const failed = await settled('b1', (s) => !!s.error);
    const flaky2 = http.createServer(handler);
    await listen(flaky2, flakyPort);
    await spa(`window.cocDesktop.browser.nav('b1', 'reload')`);
    await sleep(100);
    const retried = await settled('b1', (s) => s.title === 'Second' && !s.error);
    flaky2.close();
    emit('failure', { failed, retried });

    // 7. New-window links become a new-tab request, not a window.
    const windowsBefore = BrowserWindow.getAllWindows().length;
    await b1.webContents.executeJavaScript(`window.open(${JSON.stringify(base + '/second')}, '_blank'); 1`, true);
    const newTab = await waitFor(() => spa('window.__newTabs[0] || null'));
    emit('new-tab', { newTab, windowDelta: BrowserWindow.getAllWindows().length - windowsBefore });

    // 8. Sign-in pop-up: a real child window in the same session that can message the opener.
    await b1.webContents.executeJavaScript(`window.__msgs = []; window.addEventListener('message', function (e) { window.__msgs.push(e.data); }); 1`);
    await b1.webContents.executeJavaScript(`window.__popup = window.open(${JSON.stringify(base + '/login')}, 'signin', 'popup,width=420,height=520'); 1`, true);
    const popup = await waitFor(() => BrowserWindow.getAllWindows().find((w) => w !== main) || null);
    const message = await waitFor(() => b1.webContents.executeJavaScript('window.__msgs[0] || null'));
    const popupPrefs = popup ? await popup.webContents.executeJavaScript(`({
        hasBridge: typeof window.cocDesktop !== 'undefined',
        hasRequire: typeof require !== 'undefined',
    })`) : null;
    const cookieInTab = await b1.webContents.executeJavaScript('document.cookie');
    emit('popup', {
        popupOpened: !!popup,
        message,
        popupPrefs,
        sameSession: popup ? popup.webContents.session === b1.webContents.session : false,
        cookieInTab,
    });
    if (popup && !popup.isDestroyed()) popup.destroy();

    // 9. Session sharing / isolation.
    await open('b2', base + '/second', 'ws-a');
    await settled('b2', (s) => s.title === 'Second');
    await open('b3', base + '/second', 'clone:ws-a:other');
    await settled('b3', (s) => s.title === 'Second');
    const spaCookies = await main.webContents.session.cookies.get({ url: base });
    emit('sessions', {
        sameOwner: await viewFor('b2').webContents.executeJavaScript('document.cookie'),
        otherOwner: await viewFor('b3').webContents.executeJavaScript('document.cookie'),
        spaCookies: spaCookies.length,
    });

    // 10. Downloads go to the system browser; nothing lands on disk.
    externalCalls.length = 0;
    await b1.webContents.executeJavaScript(`location.href = ${JSON.stringify(base + '/file.zip')}; 1`);
    const download = await waitFor(() => spa('window.__downloads[0] || null'));
    await sleep(300);
    emit('download', {
        download,
        externalCalls: externalCalls.slice(),
        downloadedFiles: fs.readdirSync(downloadsDir),
        tabUrl: b1.webContents.getURL(),
    });

    // 11. Open in system browser validates the URL and the sender.
    externalCalls.length = 0;
    emit('open-external', {
        ok: await spa(`window.cocDesktop.browser.openExternal(${JSON.stringify(base + '/second')})`),
        refused: await spa(`window.cocDesktop.browser.openExternal('file:///etc/hosts')`),
        externalCalls: externalCalls.slice(),
    });

    // 12. Visibility: hide(), null rect, and re-show; reopening the same id keeps history.
    await spa(`window.cocDesktop.browser.hide('b1')`);
    await sleep(100);
    const hiddenByHide = !await b1.getVisible();
    await spa(`window.__place('b1')`);
    await sleep(100);
    const shownAgain = await b1.getVisible();
    await spa(`window.cocDesktop.browser.setBounds('b1', null)`);
    await sleep(100);
    const hiddenByNull = !await b1.getVisible();
    await b1.webContents.executeJavaScript(`window.__retainedState={input:'draft text',workspace:'workspace-a'};document.body.style.height='2500px';window.scrollTo(0,350);`);
    const beforeSwitch = { guestId: b1.webContents.id, url: b1.webContents.getURL(), history: b1.webContents.navigationHistory.length() };
    await spa("window.__browser.setBounds('b2', {x:400,y:50,width:400,height:300})");
    await sleep(150);
    await spa("window.__browser.hide('b2');window.__place('b1')");
    const retained = await b1.webContents.executeJavaScript('({state:window.__retainedState,scrollY})');
    const viewsBefore = children();
    const reopen = await spa(`window.cocDesktop.browser.open('b1', ${JSON.stringify(base + '/')}, 'ws-a')`);
    await sleep(200);
    emit('visibility', {
        hiddenByHide, shownAgain, hiddenByNull, reopen,
        sameViewCount: children() === viewsBefore,
        keptHistory: b1.webContents.navigationHistory.canGoBack(),
        workspaceSwitch: { before: beforeSwitch, after: { guestId: b1.webContents.id, url: b1.webContents.getURL(), history: b1.webContents.navigationHistory.length() }, retained },
    });

    // 13. Closing a tab destroys its view and its pop-ups.
    await b1.webContents.executeJavaScript(`window.open(${JSON.stringify(base + '/second')}, 'other', 'popup,width=300,height=300'); 1`, true);
    const popup2 = await waitFor(() => BrowserWindow.getAllWindows().find((w) => w !== main && !w.isDestroyed()) || null);
    const b1Wc = b1.webContents;
    await spa(`window.cocDesktop.browser.close('b1')`);
    await sleep(300);
    emit('close', {
        viewDestroyed: b1Wc.isDestroyed(),
        popupDestroyed: popup2 ? popup2.isDestroyed() : null,
        viewCount: children(),
        otherTabsAlive: !viewFor('b2').webContents.isDestroyed(),
    });

    // 14. A full SPA reload (CoC restart of the renderer) drops every view.
    await main.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(spaHtml));
    await sleep(300);
    emit('owner-reload', { viewCount: children() });

    await disposeBrowserViews();
    server.close();
    fs.rmSync(downloadsDir, { recursive: true, force: true });
    app.exit(0);
}).catch((err) => {
    console.error(err);
    app.exit(1);
});

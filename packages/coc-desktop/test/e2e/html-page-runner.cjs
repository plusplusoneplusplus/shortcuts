/**
 * E2E runner for the HTML page tab host — executed inside a REAL Electron main
 * process (spawned by html-page.e2e.test.ts). Writes a fixture folder
 * (index.html + sibling style.css + other.html), loads a stand-in SPA document
 * with the real preload, and drives `window.cocDesktop.htmlPage` from it
 * exactly like the SPA will. Previews are hosted by the shared browser manager
 * (`registerBrowserViewIpc`), next to a real Electron browser tab used to prove
 * the preview cannot see browser-profile cookies. Emits one `E2E::{json}` line per step; the vitest
 * side parses and asserts them.
 *
 * Kept as plain CommonJS: Electron loads it directly as an app main script.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { app, BrowserWindow, dialog, shell, webContents } = require('electron');

const distDir = path.join(__dirname, '..', '..', 'dist');
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require(path.join(distDir, 'browser-view-host.js'));
const { fixtureScript } = require('./webview-fixture.cjs');
const { HTML_PAGE_PARTITION } = require(path.join(distDir, 'file-preview-host.js'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-html-page-e2e-data-'));

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
fs.writeFileSync(otherPath, '<!doctype html><html><body><h1>Other</h1><div style="height:3000px"></div></body></html>');
fs.writeFileSync(brokenPath, '<!doctype html><html><body>will be deleted</body></html>');

/** Stand-in SPA: a right-panel placeholder the page view should cover. */
const spaHtml = '<!doctype html><html><body style="margin:0">'
    + '<div id="slot" style="position:absolute;left:400px;top:50px;width:300px;height:200px"></div>'
    + '<script>window.__states = []; window.cocDesktop.htmlPage.onState(function (s) { window.__states.push(s); });'
    + 'window.__browserStates = []; window.cocDesktop.browser.onState(function (s) { window.__browserStates.push(s); });'
    + 'window.__place = function (id) { var r = document.getElementById("slot").getBoundingClientRect();'
    + ' window.__htmlPage.setBounds(id, { x: r.x, y: r.y, width: r.width, height: r.height }); };'
    + '</script></body></html>';

/** Local site that sets a cookie in whichever session loads it. */
const cookieServer = http.createServer((req, res) => {
    res.setHeader('Set-Cookie', 'coc_profile_probe=signed-in; Path=/; Max-Age=3600');
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>Signed in</title>');
});

app.whenReady().then(async () => {
    registerBrowserViewIpc(dataDir);
    await new Promise((resolve) => cookieServer.listen(0, '127.0.0.1', resolve));
    const siteUrl = `http://127.0.0.1:${cookieServer.address().port}/`;

    const main = new BrowserWindow({
        width: 900,
        height: 600,
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
    const spa = (js) => main.webContents.executeJavaScript(js.replaceAll('window.cocDesktop.browser.', 'window.__browser.').replaceAll('window.cocDesktop.htmlPage.', 'window.__htmlPage.'));
    const browserContents = async id => webContents.fromId(await spa(`window.__webviews.get(${JSON.stringify(id)}).getWebContentsId()`));
    const count = () => spa('window.__webviews.size');
    const viewFor = async id => ({
        webContents: await browserContents(id),
        getBounds: () => spa(`(() => {const r=window.__webviews.get(${JSON.stringify(id)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`),
        getVisible: () => spa(`window.__webviews.get(${JSON.stringify(id)}).style.visibility !== 'hidden'`),
    });

    // 1. Open requests the main process must refuse.
    const rejectNotHtml = await spa(`window.cocDesktop.htmlPage.open('bad', ${JSON.stringify(path.join(fixtureDir, 'style.css'))})`);
    const rejectMissing = await spa(`window.cocDesktop.htmlPage.open('bad', ${JSON.stringify(path.join(fixtureDir, 'nope.html'))})`);
    const rejectRelative = await spa(`window.cocDesktop.htmlPage.open('bad', 'index.html')`);
    emit('reject', { rejectNotHtml, rejectMissing, rejectRelative, viewCount: await count() });

    // 2. Open + place the page; it renders with the sibling CSS and no bridge.
    const openResult = await spa(`window.cocDesktop.htmlPage.open('p1', ${JSON.stringify(indexPath)})`);
    await spa(`window.__place('p1')`);
    await sleep(1200);
    let view = await viewFor('html-page:p1');
    let pageWc = view && view.webContents;
    if (!pageWc) {
        emit('open', { openResult, viewCount: await count() });
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
        viewCount: await count(),
        bounds: await view.getBounds(),
        visible: await view.getVisible(),
        url: pageWc.getURL(),
        expectedUrl: require('url').pathToFileURL(indexPath).href,
        states: (await spa('window.__states')).map((s) => s.status),
        ...probe,
    });

    // 2b. Sign in to a site in a browser tab: its cookie lands in the
    //     browser/electron profile and must stay invisible to the preview.
    const browserOpen = await spa(`window.cocDesktop.browser.open('site', ${JSON.stringify(siteUrl)}, 'workspace-a')`);
    await sleep(1000);
    const siteContents = await browserContents('site');
    const profileCookies = await siteContents.session.cookies.get({ name: 'coc_profile_probe' });
    const previewCookies = await pageWc.session.cookies.get({});
    const previewDocumentCookie = await pageWc.executeJavaScript('document.cookie');
    emit('isolation', {
        browserOpen,
        profileCookieCount: profileCookies.length,
        previewCookieNames: previewCookies.map((c) => c.name),
        previewDocumentCookie,
        sameSession: siteContents.session === pageWc.session,
        previewPersistent: pageWc.session.isPersistent(),
        previewPartitionMatches: pageWc.session === require('electron').session.fromPartition(HTML_PAGE_PARTITION),
    });
    await spa(`window.cocDesktop.browser.close('site')`);
    await sleep(300);

    // 2c. The merged browser API opens file sources in the file host whatever
    //     engine is asked for, and a url source can never load a file.
    const viewsBefore = await count();
    const fileSource = await spa(`window.cocDesktop.browser.open('f1', { kind: 'file', path: ${JSON.stringify(indexPath)} }, 'workspace-a', 'webview2')`);
    await sleep(500);
    const fileView = await viewFor('f1');
    const fileUrlAsUrl = await spa(`window.cocDesktop.browser.open('f2', { kind: 'url', url: ${JSON.stringify(require('url').pathToFileURL(indexPath).href)} }, 'workspace-a')`);
    emit('source', {
        sources: await spa('window.cocDesktop.browser.sources'),
        fileSource,
        fileUrlAsUrl,
        addedViews: await count() - viewsBefore,
        filePartitionMatches: !!fileView && fileView.webContents.session === require('electron').session.fromPartition(HTML_PAGE_PARTITION),
    });
    await spa(`window.cocDesktop.browser.close('f1')`);
    await sleep(300);

    // 3. Opening the same id + path again reuses the view.
    const stateCount = (await spa('window.__states')).length;
    const reopen = await spa(`window.cocDesktop.htmlPage.open('p1', ${JSON.stringify(indexPath)})`);
    await sleep(100);
    emit('reuse', {
        reopen,         viewCount: await count(),
        replayed: (await spa('window.__states')).slice(stateCount).map(s => s.status),
    });

    // 4. The panel resizes: the SPA re-reports its placeholder and the view follows.
    await spa(`(function () { var s = document.getElementById('slot'); s.style.left = '300px'; s.style.width = '500px'; s.style.height = '350px'; window.__place('p1'); })()`);
    await sleep(300);
    emit('resize', { bounds: await view.getBounds(), visible: await view.getVisible() });

    // 5. Hide (tab switch / panel collapse), then show again.
    await spa(`window.cocDesktop.htmlPage.hide('p1')`);
    await sleep(200);
    const hiddenByHide = !await view.getVisible();
    await spa(`window.__place('p1')`);
    await sleep(200);
    const shownAgain = await view.getVisible();
    await spa(`window.cocDesktop.htmlPage.setBounds('p1', null)`);
    await sleep(200);
    const hiddenByNull = !await view.getVisible();
    await spa(`window.__place('p1')`);
    await sleep(200);
    emit('hide', { hiddenByHide, shownAgain, hiddenByNull });

    // 6. Navigation policy: external http(s) → system browser; sibling page in place.
    await pageWc.executeJavaScript(`location.href = 'https://example.com/nav'`);
    await sleep(500);
    await pageWc.executeJavaScript(`window.open('https://example.com/popup'); 1`);
    await sleep(300);
    const afterExternalUrl = pageWc.getURL();
    await pageWc.executeJavaScript(`location.href = 'other.html'`, true); // a user-gesture click keeps index.html in back history
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

    // 7b. Browser-data cleanup excludes file guests; a full reload closes all
    // guests and reopening a persisted file tab starts a fresh page.
    await pageWc.executeJavaScript('window.scrollTo(0, 400); window.__inPage = "kept"; 1');
    await spa(`window.cocDesktop.browser.open('site2', ${JSON.stringify(siteUrl)}, 'workspace-a')`);
    await sleep(800);
    const siteWc = await browserContents('site2');
    dialog.showMessageBox = async () => ({ response: 1 });
    const clear = await spa("window.__browser.clearData('electron')");
    await sleep(200);
    emit('clear', { clear, fileAlive: !pageWc.isDestroyed(), siteClosed: siteWc.isDestroyed(), viewCount: await count() });
    await spa(`window.__browser.open('site3', ${JSON.stringify(siteUrl)}, 'workspace-a')`);
    const reloadSiteWc = await browserContents('site3');
    const pageWcId = pageWc.id;
    const oldPageWc = pageWc;
    main.webContents.reload();
    await new Promise((resolve) => main.webContents.once('did-finish-load', resolve));
    await main.webContents.executeJavaScript(fixtureScript);
    await sleep(500);
    const viewsAfterReload = await count();
    const reattach = await spa(`window.cocDesktop.htmlPage.open('p1', ${JSON.stringify(indexPath)})`);
    await spa(`window.__place('p1')`);
    await sleep(300);
    view = await viewFor('html-page:p1');
    pageWc = view.webContents;
    const replayedStates = await spa('window.__states');
    const replayedBrowser = (await spa('window.__browserStates')).filter((s) => s.viewId === 'html-page:p1');
    const fresh = await pageWc.executeJavaScript('({ scrollY: window.scrollY, inPage: window.__inPage ?? null, url: location.href })');
    await spa(`window.cocDesktop.browser.nav('html-page:p1', 'back')`);
    await sleep(800);
    emit('reload', {
        previousPageClosed: oldPageWc.isDestroyed(),
        viewsAfterReload,
        siteClosed: reloadSiteWc.isDestroyed(),
        reattach,
        replayed: replayedStates.map((s) => s.status),
        canGoBack: replayedBrowser.length > 0 && replayedBrowser[0].canGoBack,
        sameView: pageWc.id === pageWcId,
        visible: await view.getVisible(),
        ...fresh,
        afterBackUrl: pageWc.getURL(),
    });

    // 8. A load failure is reported so the tab can show its error state.
    await spa(`window.cocDesktop.htmlPage.open('p2', ${JSON.stringify(brokenPath)})`);
    await spa(`window.__place('p2')`);
    await sleep(800);
    fs.unlinkSync(brokenPath);
    await spa(`window.cocDesktop.htmlPage.reload('p2')`);
    await sleep(800);
    const p2States = (await spa('window.__states')).filter((s) => s.pageId === 'p2');
    emit('failure', { last: p2States[p2States.length - 1], viewCount: await count() });

    // 9. Closing the tabs destroys the views.
    await spa(`window.cocDesktop.htmlPage.close('p1'); window.cocDesktop.htmlPage.close('p2')`);
    await sleep(300);
    emit('close', { viewCount: await count(), pageDestroyed: pageWc.isDestroyed() });

    // 10. A normal quit with a page tab still open must finish: the window
    //     'closed' teardown runs after the window is destroyed (regression:
    //     it read win.webContents there, threw, and app.quit() hung).
    await spa(`window.cocDesktop.htmlPage.open('p3', ${JSON.stringify(indexPath)})`);
    await spa(`window.__place('p3')`);
    await sleep(500);
    const liveViews = await count();
    fs.rmSync(fixtureDir, { recursive: true, force: true });
    cookieServer.close();
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

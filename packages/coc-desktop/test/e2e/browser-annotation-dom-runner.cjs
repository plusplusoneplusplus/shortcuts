'use strict';

const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');
const { captureElectronAnnotation } = require('../../dist/electron-annotation-capture.js');
const { captureWebView2Annotation } = require('../../dist/webview2-annotation-capture.js');
const { buildBrowserAnnotationExpression } = require('../../dist/browser-annotation-dom.js');
const { BrowserAnnotationTab } = require('../../dist/browser-annotation-tab.js');
const { ElectronBrowserCdp } = require('../../dist/electron-browser-cdp.js');

app.setPath('userData', process.env.COC_BROWSER_E2E_USER_DATA);
app.setPath('sessionData', path.join(process.env.COC_BROWSER_E2E_USER_DATA, 'session'));
let win;
let pdf;
const server = http.createServer((request, response) => {
    if (request.url === '/download?id=1') {
        response.setHeader('Content-Type', 'application/pdf');
        response.end(pdf);
        return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end(`<!doctype html><title>Annotation fixture</title><style>
        body { margin: 0; }
        button { position: absolute; left: 40px; top: 60px; width: 120px; height: 40px; background: rgb(200, 20, 40); }
        [style*="position: fixed"] { background: black !important; display: none !important; }
        .pin { background: black !important; color: black !important; }
        .outline { background: black !important; border: 20px solid red !important; }
        </style><button>Pick me</button><script>
        window.clicks = 0;
        document.addEventListener('click', () => window.clicks++, true);
        window.pageKeys = 0;
        document.addEventListener('keydown', () => window.pageKeys++, true);
        document.addEventListener('input', () => window.pageKeys++, true);
        </script>`);
});
const evaluate = code => win.webContents.executeJavaScriptInIsolatedWorld(991, [{ code }]);
const command = action => evaluate(buildBrowserAnnotationExpression({ action, session: 'fixture' }));
async function until(expression, isolated = true) {
    for (const started = Date.now(); Date.now() - started < 5000; await new Promise(resolve => setTimeout(resolve, 25))) {
        if (await (isolated ? evaluate(expression) : win.webContents.executeJavaScript(expression))) return;
    }
    throw new Error('Timed out waiting for ' + expression);
}
function click(x, y, modifiers = []) {
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) {
        win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers });
    }
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await app.whenReady();
    win = new BrowserWindow({ width: 800, height: 600, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    win.focus();
    await evaluate(`{
        const attach = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function(init) {
            const root = attach.call(this, init);
            if (init.mode === 'closed') window.fixtureRoot = root;
            return root;
        };
    }; void 0;`);
    await command('start');
    click(80, 80);
    await until('window.__cocBrowserAnnotation.events.length > 0');
    const element = await command('drain');
    const styles = await evaluate(`(() => {
        const root = window.fixtureRoot;
        const host = root.host;
        const outline = getComputedStyle(root.querySelector('.outline'));
        const style = getComputedStyle(host);
        return { closed: host.shadowRoot === null, position: style.position, display: style.display,
            background: style.backgroundColor, outlineBackground: outline.backgroundColor,
            outlineBorder: outline.borderTopWidth, label: root.querySelector('.label').textContent };
    })()`);
    const isolation = await win.webContents.executeJavaScript('({ clicks: window.clicks, private: !window.__cocBrowserAnnotation && !window.fixtureRoot })');
    // Trusted keyboard defaults must still edit the private textarea despite window capture.
    for (const type of ['keyDown', 'char', 'keyUp']) {
        win.webContents.sendInputEvent({ type, keyCode: 'F' });
    }
    await until(`window.fixtureRoot.querySelector('textarea').value === 'F'`);
    await win.webContents.insertText('ix this element');
    await until(`!window.fixtureRoot.querySelector('.save').disabled`);
    const savePoint = await evaluate(`(() => {
        const rect = window.fixtureRoot.querySelector('.save').getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    click(savePoint.x, savePoint.y);
    await until(`window.__cocBrowserAnnotation.events.some(event => event.type === 'comment')`);
    const comment = await command('drain');
    const pinStyles = await evaluate(`(() => {
        const pin = window.fixtureRoot.querySelector('.pin');
        return { text: pin.textContent, background: getComputedStyle(pin).backgroundColor,
            private: document.querySelector('.pin') === null };
    })()`);
    const center = selector => evaluate(`(() => {
        const rect = window.fixtureRoot.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    const pinPoint = await center('.pin');
    click(pinPoint.x, pinPoint.y);
    await until(`!window.fixtureRoot.querySelector('.editor').hidden`);
    await evaluate(`{ const input = window.fixtureRoot.querySelector('textarea'); input.setSelectionRange(input.value.length, input.value.length); } void 0;`);
    await win.webContents.insertText(' revised');
    const editSavePoint = await center('.save');
    click(editSavePoint.x, editSavePoint.y);
    await until(`window.__cocBrowserAnnotation.events.some(event => event.type === 'comment')`);
    const edit = await command('drain');
    click(pinPoint.x, pinPoint.y);
    await until(`!window.fixtureRoot.querySelector('.editor').hidden`);
    const deletePoint = await center('.delete');
    click(deletePoint.x, deletePoint.y);
    await until(`window.__cocBrowserAnnotation.events.some(event => event.type === 'delete')`);
    const deleted = await command('drain');
    const pinsRemoved = await evaluate(`!window.fixtureRoot.querySelector('.pin')`);
    const pageKeys = await win.webContents.executeJavaScript('window.pageKeys');
    for (const [type, x, y] of [['mouseDown', 200, 200], ['mouseMove', 300, 280], ['mouseUp', 300, 280]]) {
        win.webContents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1, modifiers: ['shift'] });
    }
    await until('window.__cocBrowserAnnotation.events.length > 0');
    const area = await command('drain');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
    await until(`window.fixtureRoot.querySelector('.editor').hidden`);
    const editorEscape = await command('drain');
    await command('stop');
    click(80, 80);
    await until('window.clicks === 1', false);
    const released = await win.webContents.executeJavaScript('window.clicks');
    await command('start');
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
    await until('!window.__cocBrowserAnnotation.active');
    const escaped = await command('drain');
    const removed = await evaluate('!window.fixtureRoot.host.isConnected');
    // Exercise the production main-only CDP adapter, including private-world event drain and revocation.
    const cdp = new ElectronBrowserCdp(win.webContents);
    const events = [];
    const endings = [];
    let annotationContext;
    const annotationEval = async expression => (await cdp.send('Runtime.evaluate', {
        expression, contextId: annotationContext, returnByValue: true,
    })).result.value;
    const hosted = { cdp: async (method, params) => {
        const reply = await cdp.send(method, params);
        if (method === 'Page.createIsolatedWorld') {
            annotationContext = reply.executionContextId;
            // Test-only closed-root access remains in the exact private world, never the website.
            await annotationEval(`{
                const attach = Element.prototype.attachShadow;
                Element.prototype.attachShadow = function(init) {
                    const root = attach.call(this, init);
                    if (init.mode === 'closed') window.captureFixtureRoot = root;
                    return root;
                };
            }; void 0;`);
        }
        return reply;
    }, onCdpEvent: cdp.onEvent.bind(cdp),
        captureAnnotation: (rect, viewport) => captureElectronAnnotation(win.webContents, rect, viewport) };
    const transport = new BrowserAnnotationTab(hosted, {
        events: batch => events.push(...batch), ended: reason => endings.push(reason),
    }, 60_000);
    await transport.start();
    click(80, 80);
    for (const started = Date.now(); Date.now() - started < 5000; await new Promise(resolve => setTimeout(resolve, 25))) {
        if (await annotationEval('!!window.captureFixtureRoot.querySelector("textarea") && !window.captureFixtureRoot.querySelector(".editor").hidden')) break;
    }
    await win.webContents.insertText('Capture before Save');
    const captureSaveCenter = () => annotationEval(`(() => {
        const rect = window.captureFixtureRoot.querySelector('.save').getBoundingClientRect();
        return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    })()`);
    const earlySave = await captureSaveCenter();
    click(earlySave.x, earlySave.y);
    const fastSaveBlocked = await annotationEval(`!window.captureFixtureRoot.querySelector('.pin')
        && window.captureFixtureRoot.querySelector('.save').disabled`);
    for (const started = Date.now(); !events.length && Date.now() - started < 5000; await new Promise(resolve => setTimeout(resolve, 25))) {
        await transport.poll();
    }
    if (!events.length) throw new Error('CDP transport did not deliver the selection');
    const selectionImage = events[0].image;
    if (!selectionImage) throw new Error('Automatic selection capture did not deliver a PNG');
    const selectionPixels = nativeImage.createFromDataURL(selectionImage.dataUrl);
    const bitmap = selectionPixels.toBitmap();
    const png = selectionPixels.toPNG();
    // A sample inside the element detects the translucent blue highlight leaking into capture.
    const offset = (10 * selectionImage.width + 10) * 4;
    const captureResult = { width: selectionImage.width, height: selectionImage.height,
        pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20),
        expectedWidth: Math.ceil(events[0].rect.width * events[0].page.viewport.devicePixelRatio),
        expectedHeight: Math.ceil(events[0].rect.height * events[0].page.viewport.devicePixelRatio),
        pixel: [...bitmap.subarray(offset, offset + 4)],
        restored: await cdp.send('Runtime.evaluate', { expression: `document.querySelector('[tabindex="-1"]').style.opacity`, returnByValue: true }) };
    const transportPrivate = await win.webContents.executeJavaScript('!window.__cocBrowserAnnotation');
    const readySave = await captureSaveCenter();
    click(readySave.x, readySave.y);
    for (const started = Date.now(); events.length < 2 && Date.now() - started < 5000; await new Promise(resolve => setTimeout(resolve, 25))) {
        await transport.poll();
    }
    const capturedComment = events.find(event => event.type === 'comment');
    const handshake = { fastSaveBlocked, saved: capturedComment?.comment,
        captureMatches: capturedComment?.selection.captureId === events[0].captureId,
        imagePrivate: capturedComment && !('image' in capturedComment.selection) };
    await transport.stop();
    click(80, 80);
    await until('window.clicks === 2', false);
    await win.webContents.executeJavaScript(`Object.assign(document.querySelector('button').style,
        { left: '40.25px', top: '60.5px', width: '120.5px', height: '40.25px' }); void 0;`);
    win.webContents.setZoomFactor(1.25);
    const zoomEvents = [];
    // Exercise real PNG decoding/cropping of a full-viewport preview, as supplied by WebView2.
    // This validates shared geometry with native pixels, not the Windows CapturePreview runtime.
    const previewHosted = { ...hosted, captureAnnotation: (rect, viewport) => captureWebView2Annotation(
        async () => (await win.webContents.capturePage()).toDataURL(), rect, viewport) };
    const zoomed = new BrowserAnnotationTab(previewHosted, { events: batch => zoomEvents.push(...batch), ended() {} });
    await zoomed.start();
    click(100, 100);
    for (const started = Date.now(); !zoomEvents.length && Date.now() - started < 5000; await new Promise(resolve => setTimeout(resolve, 25))) {
        await zoomed.poll();
    }
    const fractionalImage = zoomEvents[0].image;
    if (!fractionalImage) throw new Error('Automatic full-preview capture did not deliver a PNG');
    const zoomRect = zoomEvents[0].rect, zoomDpr = zoomEvents[0].page.viewport.devicePixelRatio;
    const fractional = { width: fractionalImage.width, height: fractionalImage.height,
        expectedWidth: Math.ceil((zoomRect.x + zoomRect.width) * zoomDpr) - Math.floor(zoomRect.x * zoomDpr),
        expectedHeight: Math.ceil((zoomRect.y + zoomRect.height) * zoomDpr) - Math.floor(zoomRect.y * zoomDpr),
        dpr: zoomDpr, rect: zoomRect,
        pixel: [...nativeImage.createFromDataURL(fractionalImage.dataUrl).toBitmap().subarray(
            (10 * fractionalImage.width + 10) * 4, (10 * fractionalImage.width + 10) * 4 + 4)] };
    await zoomed.stop();
    win.webContents.setZoomFactor(1);
    const navigationEndings = [];
    const navigating = new BrowserAnnotationTab(hosted, {
        events() {}, ended: reason => navigationEndings.push(reason),
    });
    await navigating.start();
    await win.loadURL(`http://127.0.0.1:${server.address().port}/?next`);
    await navigating.stop().catch(() => {}); // Replaced documents can destroy the pinned context before cleanup.
    const noReinstall = await win.webContents.executeJavaScript(`document.querySelectorAll('[tabindex="-1"]').length === 0`);
    const transportResult = { selection: events[0].kind, rect: events[0].rect, private: transportPrivate,
        endings, navigationEndings, noReinstall, capture: captureResult, fractional, handshake };
    const deniedCommands = [];
    const deniedHost = { ...hosted, cdp: (method, params) => {
        deniedCommands.push(method);
        return cdp.send(method, params);
    } };
    const deniedSink = { events() { throw new Error('Excluded documents must not emit selections'); }, ended() {} };
    const expectDenied = async tab => {
        try { await tab.start(); } catch (error) {
            if (!error.message.includes('PDFs, previews or the CoC app')) throw error;
            await tab.stop();
            return;
        }
        throw new Error('Excluded document admitted annotation');
    };
    await expectDenied(new BrowserAnnotationTab(deniedHost, deniedSink, 100, () => true));
    const appDenied = !deniedCommands.includes('Page.createIsolatedWorld');
    pdf = await win.webContents.printToPDF({});
    await win.loadURL(`http://127.0.0.1:${server.address().port}/download?id=1`);
    const pdfTree = await cdp.send('Page.getFrameTree');
    deniedCommands.length = 0;
    await expectDenied(new BrowserAnnotationTab(deniedHost, deniedSink));
    const pdfDenied = !deniedCommands.includes('Page.createIsolatedWorld');
    const admission = { appDenied, pdfDenied, pdfMimeType: pdfTree.frameTree.frame.mimeType };
    cdp.dispose();
    console.log('E2E::' + JSON.stringify({ element, styles, isolation, comment, pinStyles, edit, deleted, pinsRemoved, pageKeys, area, editorEscape, released, escaped, removed, transport: transportResult, admission }));
    win.destroy();
    server.close();
    app.exit(0);
})().catch(error => {
    console.error(error);
    if (win && !win.isDestroyed()) win.destroy();
    server.close();
    app.exit(1);
});

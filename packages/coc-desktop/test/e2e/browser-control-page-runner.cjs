'use strict';

// Isolated shared-page-engine fixture; the server/SPA relay is tested separately.
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, nativeImage } = require('electron');
const { ElectronBrowserCdp } = require('../../dist/electron-browser-cdp.js');
const { BrowserControlQueue } = require('../../dist/browser-control-queue.js');
const { BrowserControlPage } = require('../../dist/browser-control-page.js');
let win;
let cdp;

app.setPath('userData', process.env.COC_BROWSER_E2E_USER_DATA);
app.setPath('sessionData', path.join(process.env.COC_BROWSER_E2E_USER_DATA, 'session'));
const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/frame') {
        response.end(`<label>Frame text <input></label><button onclick="parent.frameClicked=true">Frame action</button>`);
        return;
    }
    response.end(`<!doctype html><title>Control fixture</title>
        <style>body { margin:20px; } iframe { width:500px; height:100px; }</style>
        <label>Name <input id="name" value="replace me"></label><button id="save" onclick="document.querySelector('#out').textContent=document.querySelector('#name').value">Save</button>
        <label>Plan <select id="plan"><option value="a">A</option><option disabled value="skip">Choice</option><option value="b">B</option><option value="c1">Choice</option><option value="c">Choice</option></select></label>
        <label>Choices <select id="choices" multiple><option value="a" selected>A</option><option value="b">B</option><option value="c">C</option></select></label>
        <output id="out"></output><iframe src="/frame"></iframe><div id="shadow"></div>
        <script>
            window.events=[];
            for(const event of ['input','change','click']) document.addEventListener(event,e=>events.push({type:event,trusted:e.isTrusted}));
            const shadow=document.querySelector('#shadow').attachShadow({mode:'open'});
            shadow.innerHTML='<button>Shadow action</button>';
            shadow.querySelector('button').addEventListener('click',e=>{window.shadowClicked=e.isTrusted});
        </script>`);
});

const evaluate = async expression => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;
async function until(check, label) {
    for (const started = Date.now(); Date.now() - started < 5000; await new Promise(resolve => setTimeout(resolve, 25))) {
        if (await check()) return;
    }
    throw new Error('Timed out waiting for ' + label);
}

/** Pixels that differ between two same-size PNG screenshots, optionally inside a CSS-pixel box. */
function pixelDiff(first, second, box) {
    const [a, b] = [first, second].map(shot => nativeImage.createFromBuffer(Buffer.from(shot.data, 'base64')));
    const { width, height } = a.getSize();
    if (b.getSize().width !== width || b.getSize().height !== height) throw new Error('Screenshot sizes differ');
    const scale = box ? width / box.viewportWidth : 1;
    const [left, top] = box ? [Math.floor(box.x * scale), Math.floor(box.y * scale)] : [0, 0];
    const [right, bottom] = box ? [Math.min(width, Math.ceil((box.x + box.size) * scale)), Math.min(height, Math.ceil((box.y + box.size) * scale))] : [width, height];
    const [pixelsA, pixelsB] = [a.toBitmap(), b.toBitmap()];
    let changed = 0;
    for (let y = Math.max(0, top); y < bottom; y++) {
        for (let x = Math.max(0, left); x < right; x++) {
            const offset = (y * width + x) * 4;
            if (pixelsA.readUInt32LE(offset) !== pixelsB.readUInt32LE(offset)) changed++;
        }
    }
    return changed;
}

/** The agent's screenshots, snapshots and reads never contain the AI cursor drawn on screen. */
async function cursorEvidence(queue, ref, baseline) {
    // An overlay-free page with the same capture path shows what is really on screen.
    const screen = new BrowserControlPage((method, params) => cdp.send(method, params), process.platform);
    await queue.run(async page => page.setCursorOverlay(true));
    await queue.run(page => page.type(ref('Name'), 'Ada'));
    const hosts = await evaluate('document.querySelectorAll("coc-ai-cursor").length');
    const snapshot = await queue.run(page => page.snapshot());
    const text = await queue.run(page => page.read());
    await queue.run(page => page.click(ref('Save')));
    // Let the glide and ripple settle, well before the idle fade.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const point = await evaluate('window.__cocCursorOverlay?.point');
    const box = { ...point, size: 20, viewportWidth: await evaluate('document.documentElement.clientWidth') };
    const visible = await screen.screenshot(undefined, 'png');
    const agent = await queue.run(page => page.screenshot(undefined, 'png'));
    await until(async () => await evaluate('window.__cocCursorOverlay?.layer.style.visibility') === 'visible', 'cursor shown again after the agent screenshot');
    queue.removeCursor();
    await until(async () => await evaluate('document.querySelectorAll("coc-ai-cursor").length') === 0, 'cursor removed');
    const clean = await screen.screenshot(undefined, 'png');
    const serialized = JSON.stringify(snapshot);
    return {
        hosts, point: !!point,
        snapshotHasOverlay: /coc-ai-cursor|typing…/i.test(serialized),
        readHasOverlay: /coc-ai-cursor|typing…/i.test(text),
        refsStable: snapshot.elements.map(e => e.ref).join() === baseline.elements.map(e => e.ref).join(),
        visibleCursorPixels: pixelDiff(visible, clean, box),
        agentCursorPixels: pixelDiff(agent, clean, box),
        agentPagePixels: pixelDiff(agent, clean),
    };
}

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await app.whenReady();
    win = new BrowserWindow({ width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await win.loadURL(url);
    cdp = new ElectronBrowserCdp(win.webContents);
    let stop;
    const queue = new BrowserControlQueue(async (method, params) => {
        const result = await cdp.send(method, params);
        if (stop && method === 'Input.dispatchMouseEvent' && params?.type === 'mousePressed') {
            stop.abort(new Error('Fixture Stop'));
            stop = undefined;
        }
        return result;
    });
    const before = await queue.run(page => page.snapshot());
    const ref = name => {
        const entry = before.elements.find(element => element.name === name);
        if (!entry) throw new Error('Missing fixture element: ' + name + '\n' + JSON.stringify(before));
        return entry.ref;
    };
    stop = new AbortController();
    let cancelled;
    try { await queue.run(page => page.type(ref('Name'), 'not inserted'), stop.signal); }
    catch (error) { cancelled = error.message; }
    const stoppedField = await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('#name').value`, returnByValue: true,
    });
    await queue.run(page => page.type(ref('Name'), 'Ada'));
    await queue.run(page => page.click(ref('Save')));
    await queue.run(page => page.selectOption(ref('Plan'), 'c'));
    const macPage = new BrowserControlPage((method, params) => cdp.send(method, params), 'darwin');
    const typeAheadSelections = [];
    for (const value of ['c1', 'c', 'c1', 'c']) {
        await macPage.selectOption(ref('Plan'), value);
        typeAheadSelections.push(await macPage.evaluate('document.querySelector("#plan").value'));
    }
    await queue.run(page => page.selectOption(ref('Choices'), 'b'));
    await queue.run(page => page.type(ref('Frame text'), 'Nested'));
    await queue.run(page => page.click(ref('Frame action')));
    await queue.run(page => page.click(ref('Shadow action')));
    await queue.run((page, signal) => page.wait('Ada', signal));
    await queue.run((page, signal) => page.wait('Shadow action', signal));
    const report = await cdp.send('Runtime.evaluate', {
        expression: `({value:document.querySelector('#out').textContent,plan:document.querySelector('#plan').value,choices:Array.from(document.querySelector('#choices').selectedOptions,o=>o.value),frameText:document.querySelector('iframe').contentDocument.querySelector('input').value,frameClicked:window.frameClicked,shadowClicked:window.shadowClicked,events:window.events})`,
        returnByValue: true,
    });
    const repeated = await queue.run(page => page.snapshot());
    const cursor = await cursorEvidence(queue, ref, repeated);
    await win.loadURL(url + '?navigated');
    const after = await queue.run(page => page.snapshot());
    let stale;
    try { await queue.run(page => page.click(ref('Save'))); } catch (error) { stale = error.message; }
    console.log('E2E::' + JSON.stringify({ cursor, report: report.result.value, typeAheadSelections, cancelled, stoppedField: stoppedField.result.value, stable: repeated.elements.map(e => e.ref).join() === before.elements.map(e => e.ref).join(), reused: after.elements.some(e => before.elements.some(old => old.ref === e.ref)), stale }));
    cdp.dispose();
    win.destroy();
    await new Promise(resolve => server.close(resolve));
    app.exit(0);
})().catch(error => {
    console.error(error);
    cdp?.dispose();
    if (win && !win.isDestroyed()) win.destroy();
    server.closeAllConnections();
    server.close();
    app.exit(1);
});

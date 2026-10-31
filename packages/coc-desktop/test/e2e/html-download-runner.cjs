'use strict';

// Real Chromium handles and saved bytes. Only the native chooser is substituted:
// this fixture proves transfer/handoff, not native dialog UI or modal revocation.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { app, BrowserWindow, dialog, webContents } = require('electron');
const { fixtureScript } = require('./webview-fixture.cjs');
const dist = path.join(__dirname, '..', '..', 'dist');
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require(path.join(dist, 'browser-view-host.js'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-html-download-e2e-'));
const seen = new Set();
let stage = 'setup';
const emit = (step, data) => console.log('E2E::' + JSON.stringify({ step, ...data }));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(probe, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const result = await probe();
        if (result) return result;
        await sleep(25);
    }
    throw new Error('Timed out: ' + label);
}
async function digestFile(file) {
    const hash = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}

// Runs inside the sandboxed file document. No bridge, preload or Node API.
function installExport(spec) {
    document.body.innerHTML = '<button id="export" style="width:160px;height:50px">Download</button>';
    const bytes = spec.large ? new Uint8Array(spec.large).fill(90) : new Uint8Array(spec.bytes);
    const url = spec.kind === 'blob'
        ? URL.createObjectURL(new Blob([bytes], { type: spec.mime }))
        : 'data:' + spec.mime + (spec.percent ? ',' + encodeURIComponent(new TextDecoder().decode(bytes))
            : ';base64,' + btoa(String.fromCharCode(...bytes)));
    window.__trustedActivations = [];
    document.getElementById('export').onclick = event => {
        window.__trustedActivations.push(event.isTrusted);
        const a = document.createElement('a');
        a.href = url;
        a.download = spec.name;
        document.body.append(a);
        a.click(); // A click-handler-created anchor must retain native intent.
        a.remove();
    };
    window.__releaseExport = () => { if (spec.kind === 'blob') URL.revokeObjectURL(url); };
}

app.whenReady().then(async () => {
    registerBrowserViewIpc(path.join(root, 'desktop'));
    const file = path.join(root, 'export.html');
    fs.writeFileSync(file, '<!doctype html><title>Local export</title><body>Ready</body>');
    const main = new BrowserWindow({ width: 900, height: 600, show: true, webPreferences: {
        preload: path.join(dist, 'preload.js'), contextIsolation: true,
        nodeIntegration: false, sandbox: true, webviewTag: true,
    } });
    const spaUrl = 'data:text/html,' + encodeURIComponent('<!doctype html><body>Export fixture</body>');
    registerBrowserEmbedder(main, spaUrl);
    await main.loadURL(spaUrl);
    await main.webContents.executeJavaScript(fixtureScript);
    const spa = js => main.webContents.executeJavaScript(js);
    // A file remains Electron even when the requested URL-tab engine is WebView2.
    const opened = await spa(`window.__browser.open('export', {kind:'file',path:${JSON.stringify(file)}}, 'workspace-export', 'webview2')`);
    if (!opened.ok) throw new Error('Preview open failed');
    await spa("window.__browser.setBounds('export', {x:20,y:20,width:600,height:400})");
    const guest = webContents.fromId(await spa("window.__webviews.get('export').getWebContentsId()"));
    await waitFor(async () => guest.getURL() === pathToFileURL(file).href && !guest.isLoadingMainFrame()
        && await guest.executeJavaScript("document.readyState === 'complete' && document.title === 'Local export'"), 'preview document');
    const originalUrl = guest.getURL();
    emit('isolation', {
        engine: opened.engine, sourceKind: opened.sourceKind,
        persistent: guest.session.isPersistent(),
        preferences: { sandbox: guest.getLastWebPreferences().sandbox, contextIsolation: guest.getLastWebPreferences().contextIsolation },
        ...await guest.executeJavaScript('({bridge:typeof window.cocDesktop,node:typeof require})'),
    });

    const csv = Buffer.from('名前,値\r\n雪,☃️\r\n', 'utf8');
    const binary = Buffer.from([0, 255, 128, 1, 13, 10, 0, 42]);
    const cases = [
        { id: 'blob-csv', kind: 'blob', mime: 'text/csv', name: '雪.csv', bytes: [...csv], input: 'mouse' },
        { id: 'data-csv', kind: 'data', mime: 'text/csv;charset=utf-8', name: 'Unicode.csv', bytes: [...csv], percent: true, input: 'keyboard' },
        { id: 'data-binary', kind: 'data', mime: 'application/zip', name: 'binary.zip', bytes: [...binary], input: 'mouse' },
        { id: 'blob-empty', kind: 'blob', mime: 'application/octet-stream', name: 'empty.bin', bytes: [], input: 'keyboard' },
        { id: 'blob-missing', kind: 'blob', mime: 'text/plain', name: '', bytes: [65], input: 'mouse' },
        { id: 'data-unsafe', kind: 'data', mime: 'application/pdf', name: '../../CON.pdf', bytes: [...binary], input: 'keyboard' },
        { id: 'blob-large', kind: 'blob', mime: 'application/octet-stream', name: 'large.bin', large: 101 * 1024 * 1024, input: 'mouse' },
    ];
    const originalChooser = dialog.showSaveDialogSync;
    const outputDir = path.join(root, 'chosen-folder');
    fs.mkdirSync(outputDir);
    try {
        for (const spec of cases) {
            stage = spec.id;
            const destination = path.join(outputDir, 'renamed-' + spec.id + '.saved');
            const dialogs = [];
            dialog.showSaveDialogSync = (owner, options) => {
                dialogs.push({ correctOwner: owner === main, suggestion: path.basename(options.defaultPath), properties: options.properties });
                return destination;
            };
            await guest.executeJavaScript(`(${installExport.toString()})(${JSON.stringify(spec)})`);
            main.focus();
            await spa("window.__browser.focus('export')");
            await waitFor(() => main.isFocused() && guest.isFocused(), 'native guest focus');
            // Native main-process input, never executeJavaScript(..., true), DOM
            // event dispatch, gate calls or fabricated EventEmitter input hooks.
            if (spec.input === 'keyboard') {
                await guest.executeJavaScript("document.getElementById('export').focus()");
                guest.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
                guest.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
            } else {
                const point = await guest.executeJavaScript("(()=>{const r=document.getElementById('export').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
                guest.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
                guest.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
            }
            const record = await waitFor(async () => {
                const result = await spa('window.cocDesktop.browser.downloads.query()');
                if (!result.ok) throw new Error('Download query failed');
                const entry = result.entries.find(value => !seen.has(value.id));
                if (entry && ['failed', 'cancelled', 'interrupted'].includes(entry.state)) throw new Error('Native transfer ' + entry.state);
                return entry?.state === 'completed' ? entry : undefined;
            }, spec.id + ' completed download', 30000);
            seen.add(record.id);
            const expected = createHash('sha256');
            if (spec.large) {
                const chunk = Buffer.alloc(1024 * 1024, 90);
                for (let i = 0; i < 101; i++) expected.update(chunk);
            } else expected.update(Buffer.from(spec.bytes));
            const savedSize = fs.statSync(destination).size;
            const actualHash = await digestFile(destination);
            const expectedHash = expected.digest('hex');
            emit(spec.id, {
                dialogs, savedSize, expectedSize: spec.large || spec.bytes.length,
                actualHash, expectedHash, state: record.state, received: record.received, total: record.total,
                fileAvailable: record.fileAvailable, filename: record.filename,
                publicMetadataSafe: !JSON.stringify(record).includes(root) && !JSON.stringify(record).includes('data:') && !JSON.stringify(record).includes('blob:'),
                previewUsable: guest.getURL() === originalUrl && await guest.executeJavaScript("!!document.getElementById('export')"),
                trusted: await guest.executeJavaScript('window.__trustedActivations'),
            });
            await guest.executeJavaScript('window.__releaseExport()');
        }
    } finally {
        dialog.showSaveDialogSync = originalChooser;
    }
    await disposeBrowserViews();
    main.destroy();
    fs.rmSync(root, { recursive: true, force: true });
    app.quit();
}).catch(async error => {
    // No payload, URL or native destination in fixture diagnostics.
    console.error('HTML download fixture failed:', stage, error.name);
    try { await disposeBrowserViews(); } catch { /* preserve the original failure */ }
    fs.rmSync(root, { recursive: true, force: true });
    app.exit(1);
});

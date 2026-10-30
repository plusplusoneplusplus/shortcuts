'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, shell, webContents } = require('electron');
const dist = path.join(__dirname, '..', '..', 'dist');
const { ExtensionCanvasHost } = require(path.join(dist, 'extension-canvas-host.js'));
const { installBrowserWebviewGuard, registerBrowserEmbedder } = require(path.join(dist, 'browser-webview-guard.js'));

installBrowserWebviewGuard();
const external = [];
shell.openExternal = async url => { external.push(url); };
const streams = new Set();
let foreignRequests = 0;
const foreign = http.createServer((_request, response) => {
    foreignRequests++;
    response.end('must not load');
});
const site = http.createServer((request, response) => {
    if (request.url === '/events') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream' });
        response.write('data: 0\n\n');
        streams.add(response);
        response.on('close', () => streams.delete(response));
        return;
    }
    if (request.url === '/update') {
        for (const stream of streams) stream.write('data: 1\n\n');
        response.end('updated');
        return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Canvas fixture</title><p id="count">waiting</p>'
        + '<a id="external" href="https://example.test/extension">External</a>'
        + '<script>new EventSource("/events").onmessage = event => document.getElementById("count").textContent = event.data;</script>');
});
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
    const deadline = Date.now() + 10_000;
    while (!await check()) {
        if (Date.now() > deadline) throw new Error('Canvas condition timed out');
        await sleep(25);
    }
}

app.whenReady().then(async () => {
    const host = new ExtensionCanvasHost();
    let main;
    try {
        await listen(site);
        await listen(foreign);
        const url = `http://127.0.0.1:${site.address().port}/`;
        const foreignUrl = `http://127.0.0.1:${foreign.address().port}/`;
        main = new BrowserWindow({
            show: true,
            webPreferences: { webviewTag: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
        });
        const spaUrl = 'data:text/html,' + encodeURIComponent('<!doctype html><title>Canvas host</title><body></body>');
        registerBrowserEmbedder(main, spaUrl);
        await main.loadURL(spaUrl);
        const states = [];
        const guestHandle = host.create({
            ownerId: main.webContents.id, extensionKey: 'fixture:counter', url,
        }, { state: state => states.push(state), closed() {} });
        const id = await main.webContents.executeJavaScript(`new Promise((resolve, reject) => {
            const guest = document.createElement('webview');
            guest.setAttribute('partition', ${JSON.stringify(guestHandle.partition)});
            guest.setAttribute('src', ${JSON.stringify(guestHandle.src)});
            guest.style.cssText = 'width:600px;height:400px';
            guest.addEventListener('dom-ready', () => resolve(guest.getWebContentsId()), { once: true });
            guest.addEventListener('did-fail-load', event => reject(new Error(event.errorDescription)), { once: true });
            document.body.appendChild(guest);
        })`);
        guestHandle.adopt(id);
        const guest = webContents.fromId(id);
        await until(async () => await guest.executeJavaScript('document.getElementById("count").textContent') === '0');
        assert.deepEqual(await guest.executeJavaScript(`({
            title: document.title, bridge: typeof window.cocDesktop, node: typeof require
        })`), { title: 'Canvas fixture', bridge: 'undefined', node: 'undefined' });
        assert.equal(guest.session.isPersistent(), false);
        assert.equal(guest.getLastWebPreferences().sandbox, true);
        await fetch(url + 'update');
        await until(async () => await guest.executeJavaScript('document.getElementById("count").textContent') === '1');
        await guest.executeJavaScript('document.getElementById("external").click()');
        await until(() => external.length === 1);
        assert.deepEqual(external, ['https://example.test/extension']);
        assert.equal(guest.getURL(), url);
        // Main-initiated loads bypass will-navigate; the session request gate must still deny them.
        await assert.rejects(guest.loadURL(foreignUrl));
        assert.equal(foreignRequests, 0);
        assert.ok(states.some(state => state.status === 'loaded'));
        guestHandle.close();
        await until(() => guest.isDestroyed());
        console.log('E2E::' + JSON.stringify({
            rendered: true, sse: true, external: true, originBlocked: true, sandboxed: true, closed: true,
        }));
    } finally {
        host.dispose();
        if (main && !main.isDestroyed()) main.destroy();
        for (const stream of streams) stream.end();
        site.closeAllConnections();
        foreign.closeAllConnections();
        site.close();
        foreign.close();
    }
}).then(() => app.exit(0), error => {
    console.error(error);
    app.exit(1);
});

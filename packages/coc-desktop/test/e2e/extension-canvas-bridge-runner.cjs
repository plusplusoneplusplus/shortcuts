'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, BrowserWindow, shell, webContents } = require('electron');
const { SqliteProcessStore } = require('@plusplusoneplusplus/forge');
const { CanvasStore } = require('@plusplusoneplusplus/coc/dist/server/canvas/canvas-store');
const { CanvasExtensionHostRegistry } = require('@plusplusoneplusplus/coc/dist/server/canvas-extensions/host-registry');
const { loadCanvasExtensionInstances } = require('@plusplusoneplusplus/coc/dist/server/canvas-extensions/instance-records');
const { registerCanvasExtensionRoutes } = require('@plusplusoneplusplus/coc/dist/server/canvas-extensions/routes');
const { createCanvasExtensionTools } = require('@plusplusoneplusplus/coc/dist/server/llm-tools/canvas-extension-tools');
const { createCanvasUpdateNotifier } = require('@plusplusoneplusplus/coc/dist/server/canvas/canvas-update-notifier');
const { createRouter } = require('@plusplusoneplusplus/coc/dist/server/shared/router');
const dist = path.join(__dirname, '..', '..', 'dist');
const { registerExtensionCanvasIpc, disposeExtensionCanvasIpc } = require(path.join(dist, 'extension-canvas-ipc.js'));
const { installBrowserWebviewGuard, registerBrowserEmbedder } = require(path.join(dist, 'browser-webview-guard.js'));

installBrowserWebviewGuard();
const external = [];
shell.openExternal = async url => { external.push(url); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
    const deadline = Date.now() + 10_000;
    while (!await check()) {
        if (Date.now() > deadline) throw new Error('Canvas bridge condition timed out');
        await sleep(25);
    }
}

app.whenReady().then(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canvas-bridge-e2e-'));
    let store, hosts, server, main;
    try {
        const repo = path.join(root, 'repo');
        const folder = path.join(repo, '.github', 'extensions', 'interactive');
        await fs.mkdir(folder, { recursive: true });
        await fs.copyFile(path.join(__dirname, '..', '..', '..', 'coc', 'test', 'fixtures', 'canvas-extensions', 'interactive', 'extension.mjs'),
            path.join(folder, 'extension.mjs'));
        const config = () => ({ canvasExtensions: { enabled: true } });
        store = new SqliteProcessStore({ dbPath: path.join(root, 'processes.db') });
        const scope = { workspaceId: 'workspace', processId: 'conversation' };
        await store.registerWorkspace({ id: scope.workspaceId, name: 'Fixture', rootPath: repo });
        await store.addProcess({
            id: scope.processId, type: 'chat', status: 'completed', promptPreview: 'Canvas', fullPrompt: 'Canvas',
            startTime: new Date(), metadata: { workspaceId: scope.workspaceId },
        });
        const canvasStore = new CanvasStore(root);
        const registry = () => new CanvasExtensionHostRegistry({
            config, dataDir: root, store, log: message => console.error(message),
            loadInstances: (owner, key) => loadCanvasExtensionInstances(canvasStore, owner, key),
        });
        hosts = registry();
        const runtime = {
            config, get hosts() { return hosts; }, canvasStore, notifier: createCanvasUpdateNotifier({ processStore: store }),
        };
        async function tool(name, args) {
            const result = await createCanvasExtensionTools({
                ...runtime, ...scope, processStore: store, dataDir: root,
            }).find(value => value.name === name).handler(args);
            assert.notEqual(result.resultType, 'failure', result.textResultForLlm);
            return result;
        }
        const opened = await tool('manage_canvas', {
            action: 'open',
            canvasId: 'workspace:interactive/counter', instanceId: 'saved-instance', input: { count: 5 },
        });
        assert.equal(opened.success, true);
        const routes = [];
        registerCanvasExtensionRoutes(routes, { dataDir: root, processStore: store, runtime });
        server = http.createServer(createRouter({ routes, spaHtml: '<!doctype html><title>Canvas bridge</title><body></body>' }));
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${server.address().port}/`;
        registerExtensionCanvasIpc(() => url);
        main = new BrowserWindow({
            show: true,
            webPreferences: {
                preload: path.join(dist, 'preload.js'), webviewTag: true,
                sandbox: true, contextIsolation: true, nodeIntegration: false,
            },
        });
        registerBrowserEmbedder(main, url);
        await main.loadURL(url);
        async function mount(viewId) {
            const result = await main.webContents.executeJavaScript(`window.cocDesktop.extensionCanvas.open(
                ${JSON.stringify(viewId)}, 'workspace', ${JSON.stringify(opened.canvasId)})`);
            assert.equal(result.ok, true, result.message);
            const id = await main.webContents.executeJavaScript(`new Promise((resolve, reject) => {
                const guest = document.createElement('webview');
                guest.id = ${JSON.stringify(viewId)};
                guest.setAttribute('partition', ${JSON.stringify(result.partition)});
                guest.setAttribute('src', ${JSON.stringify(result.src)});
                guest.style.cssText = 'width:600px;height:400px';
                guest.addEventListener('dom-ready', () => resolve(guest.getWebContentsId()), { once: true });
                guest.addEventListener('did-fail-load', event => reject(new Error(event.errorDescription)), { once: true });
                document.body.appendChild(guest);
            })`);
            await main.webContents.executeJavaScript(`window.cocDesktop.extensionCanvas.adopt(${JSON.stringify(viewId)}, ${id})`);
            const guest = webContents.fromId(id);
            await until(async () => await guest.executeJavaScript('document.getElementById("count").textContent') === '5');
            return guest;
        }
        let guest = await mount('first-view');
        const result = await tool('invoke_canvas_action', { instanceId: opened.instanceId, actionName: 'increment' });
        assert.deepEqual(result, { success: true, result: 6 });
        await until(async () => await guest.executeJavaScript('document.getElementById("count").textContent') === '6');
        await guest.executeJavaScript('document.getElementById("external").click()');
        await until(() => external.length === 1);
        assert.deepEqual(external, ['https://example.test/extension']);
        assert.equal(guest.getURL(), opened.url);
        await main.webContents.executeJavaScript(`window.cocDesktop.extensionCanvas.close('first-view');
            document.getElementById('first-view').remove()`);
        await until(() => guest.isDestroyed());
        await hosts.dispose();
        hosts = registry();
        guest = await mount('restored-view');
        assert.notEqual(guest.getURL(), opened.url);
        assert.equal(canvasStore.listCanvases(scope.workspaceId).length, 1);
        assert.equal(JSON.parse(canvasStore.getCanvas(scope.workspaceId, opened.canvasId).content).instanceId, opened.instanceId);
        console.log('E2E::' + JSON.stringify({
            sdk: true, preload: true, savedReopen: true, agentActionSse: true, external: true, restoredAfterRestart: true,
        }));
    } finally {
        disposeExtensionCanvasIpc();
        if (main && !main.isDestroyed()) main.destroy();
        await hosts?.dispose();
        if (server) {
            server.closeAllConnections();
            await new Promise(resolve => server.close(resolve));
        }
        store?.close();
        await fs.rm(root, { recursive: true, force: true });
    }
}).then(() => app.exit(0), error => {
    console.error(error);
    app.exit(1);
});

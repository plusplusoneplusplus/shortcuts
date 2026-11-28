'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { buildSync } = require('esbuild');
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
const consoleErrors = [];
app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', event => {
        if (event.level === 'error') consoleErrors.push(event.message);
    });
    contents.on('preload-error', (_event, _path, error) => consoleErrors.push(error.message));
});
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
        const source = await fs.readFile(path.join(__dirname, '..', '..', '..', 'coc', 'test', 'fixtures', 'canvas-extensions', 'interactive', 'extension.mjs'), 'utf8');
        const entryPath = path.join(folder, 'extension.mjs');
        const helperPath = path.join(folder, 'page.mjs');
        await fs.writeFile(entryPath, "import { version } from './page.mjs';\n" + source.replace(
            "response.end('<!doctype html>",
            "response.end('<p id=\"version\">' + version + '</p><!doctype html>",
        ));
        await fs.writeFile(helperPath, "export const version = 'first';\n");
        const entrySource = await fs.readFile(entryPath, 'utf8');
        const config = () => ({ canvasExtensions: { enabled: true, singletonPerSession: false } });
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
        let refreshVisible = () => {};
        const runtime = {
            config, get hosts() { return hosts; }, canvasStore,
            notifier: createCanvasUpdateNotifier({ processStore: store,
                getWsServer: () => ({ broadcastProcessEvent: () => refreshVisible() }),
            }),
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
        const component = path.resolve(__dirname, '../../../coc/src/server/spa/client/react/features/canvas/CopilotExtensionCanvasView.tsx');
        const bundle = buildSync({
            stdin: { contents: `
                import React from 'react';
                import { createRoot } from 'react-dom/client';
                import { CopilotExtensionCanvasView, parseExtensionRuntimeReload } from ${JSON.stringify(component)};
                const root = createRoot(document.getElementById('react-root'));
                window.renderExtensionCanvases = records => root.render(records.map(record =>
                    <div key={record.id} data-canvas-id={record.id} style={{height: 320, width: 600}}>
                        <CopilotExtensionCanvasView workspaceId="workspace" canvasId={record.id} routingRef={null}
                            allowDesktopGuest runtimeReload={parseExtensionRuntimeReload(record.content)} />
                    </div>));
            `, resolveDir: path.resolve(__dirname, '../../../..'), loader: 'jsx' },
            bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
            define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        }).outputFiles[0].contents;
        const routes = [{ method: 'GET', pattern: /^\/api\/extension-view\.js$/, handler: (_req, res) => {
            res.writeHead(200, { 'Content-Type': 'text/javascript' });
            res.end(bundle);
        } }];
        registerCanvasExtensionRoutes(routes, { dataDir: root, processStore: store, runtime });
        server = http.createServer(createRouter({ routes, spaHtml: '<!doctype html><title>Canvas bridge</title><body><div id="react-root"></div><script src="/api/extension-view.js"></script></body>' }));
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
        async function mount(viewId, reload = false) {
            const result = await main.webContents.executeJavaScript(`window.cocDesktop.extensionCanvas.open(
                ${JSON.stringify(viewId)}, 'workspace', ${JSON.stringify(opened.canvasId)}, ${reload})`);
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
        async function close(viewId, guest) {
            await main.webContents.executeJavaScript(`window.cocDesktop.extensionCanvas.close(${JSON.stringify(viewId)});
                document.getElementById(${JSON.stringify(viewId)}).remove()`);
            await until(() => guest.isDestroyed());
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
        assert.equal(await guest.executeJavaScript('document.getElementById("version").textContent'), 'first');
        await fs.writeFile(helperPath, "export const version = 'second';\n");
        assert.equal(await fs.readFile(entryPath, 'utf8'), entrySource);
        assert.equal(await guest.executeJavaScript('document.getElementById("version").textContent'), 'first');
        await close('restored-view', guest);
        guest = await mount('unchanged-runtime');
        assert.equal(await guest.executeJavaScript('document.getElementById("version").textContent'), 'first');
        const staleGuestId = guest.id;
        await close('unchanged-runtime', guest);
        guest = await mount('reloaded-view', true);
        assert.notEqual(guest.id, staleGuestId);
        assert.equal(await guest.executeJavaScript('document.getElementById("version").textContent'), 'second');
        await close('reloaded-view', guest);
        await fs.writeFile(helperPath, 'export const version = ;\n');
        const failed = await main.webContents.executeJavaScript(`window.cocDesktop.extensionCanvas.open(
            'invalid-code', 'workspace', ${JSON.stringify(opened.canvasId)}, true)`);
        assert.equal(failed.ok, false);
        assert.ok(failed.message, 'Runtime failure must reach the renderer');
        await fs.writeFile(helperPath, "export const version = 'recovered';\n");
        guest = await mount('recovered-view', true);
        assert.equal(await guest.executeJavaScript('document.getElementById("version").textContent'), 'recovered');
        assert.equal(canvasStore.listCanvases(scope.workspaceId).length, 1);
        const saved = JSON.parse(canvasStore.getCanvas(scope.workspaceId, opened.canvasId).content);
        assert.equal(saved.instanceId, opened.instanceId);
        assert.deepEqual(saved.input, { count: 5 });
        await close('recovered-view', guest);
        const sibling = await tool('manage_canvas', {
            action: 'open', canvasId: 'workspace:interactive/counter', instanceId: 'second-instance', input: { count: 5 },
        });
        const visibleIds = [opened.canvasId, sibling.canvasId];
        let renderUpdates = Promise.resolve();
        let renderFailure;
        refreshVisible = () => {
            const records = visibleIds.map(id => canvasStore.getCanvas(scope.workspaceId, id));
            renderUpdates = renderUpdates.then(() => main.webContents.executeJavaScript(
                `window.renderExtensionCanvases(${JSON.stringify(records)})`)).catch(error => {
                renderFailure = error;
            });
        };
        refreshVisible();
        async function visibleGuests() {
            const ids = await main.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#react-root webview'))
                .map(guest => { try { return guest.getWebContentsId(); } catch { return null; } }).filter(Boolean)`);
            return ids.map(id => webContents.fromId(id)).filter(Boolean);
        }
        async function renderedVersion(version) {
            if (renderFailure) throw renderFailure;
            try {
                const guests = await visibleGuests();
                return guests.length === 2 && (await Promise.all(guests.map(value => value.executeJavaScript(
                    'document.getElementById("version")?.textContent')))).every(value => value === version);
            } catch { return false; }
        }
        await until(() => renderedVersion('recovered'));
        const beforeReload = (await visibleGuests()).map(value => value.id);
        await fs.writeFile(helperPath, "export const version = 'tool-reloaded';\n");
        assert.equal(await fs.readFile(entryPath, 'utf8'), entrySource);
        const reloaded = await tool('manage_canvas', { action: 'reload', instanceId: opened.instanceId });
        assert.deepEqual([...reloaded.refreshedCanvasIds].sort(), [...visibleIds].sort());
        await until(() => renderedVersion('tool-reloaded'));
        assert.ok((await visibleGuests()).every(value => !beforeReload.includes(value.id)));
        const markers = visibleIds.map(id => JSON.parse(canvasStore.getCanvas(scope.workspaceId, id).content).runtimeReload.id);
        assert.equal(markers[0], markers[1]);
        const settledGuests = (await visibleGuests()).map(value => value.id);
        // Ordinary opens publish revisions but keep the reload marker and current guests.
        await tool('manage_canvas', { action: 'open', canvasId: 'workspace:interactive/counter', instanceId: opened.instanceId });
        await renderUpdates;
        assert.deepEqual((await visibleGuests()).map(value => value.id), settledGuests);
        await fs.writeFile(helperPath, 'export const version = ;\n');
        const failure = await createCanvasExtensionTools({
            ...runtime, ...scope, processStore: store, dataDir: root,
        }).find(value => value.name === 'manage_canvas').handler({ action: 'reload', instanceId: opened.instanceId });
        assert.equal(failure.resultType, 'failure');
        for (const id of visibleIds) {
            assert.ok(JSON.parse(canvasStore.getCanvas(scope.workspaceId, id).content).runtimeReload.error);
        }
        const reloadError = JSON.parse(failure.textResultForLlm).error.message;
        await until(async () => await main.webContents.executeJavaScript(
            `(() => { const alerts = Array.from(document.querySelectorAll('#react-root [role="alert"]'));
                return alerts.length === 2 && alerts.every(value => value.textContent === ${JSON.stringify(reloadError)}); })()`));
        assert.equal((await visibleGuests()).length, 0);
        await fs.writeFile(helperPath, "export const version = 'tool-recovered';\n");
        await tool('manage_canvas', { action: 'reload', instanceId: opened.instanceId });
        await until(() => renderedVersion('tool-recovered'));
        assert.equal(canvasStore.listCanvases(scope.workspaceId).length, 2);
        for (const id of visibleIds) {
            const record = JSON.parse(canvasStore.getCanvas(scope.workspaceId, id).content);
            assert.deepEqual(record.input, { count: 5 });
            assert.equal(record.runtimeReload.error, undefined);
        }
        await renderUpdates;
        assert.equal(renderFailure, undefined);
        refreshVisible = () => {};
        assert.deepEqual(consoleErrors, [], `Renderer console/page errors: ${consoleErrors.join('\n')}`);
        console.log('E2E::' + JSON.stringify({
            sdk: true, preload: true, savedReopen: true, agentActionSse: true, external: true, restoredAfterRestart: true,
            importedCodeReload: true, freshGuest: true, invalidCodeRecovery: true, consoleErrors: 0,
            toolReload: true, multipleVisibleInstances: true, reloadMarkerNoLoop: true,
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

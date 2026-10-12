const { app, BrowserWindow, nativeImage } = require('electron');
const { buildSync } = require('esbuild');
const { createServer } = require('node:http');
const path = require('node:path');

app.setPath('userData', process.env.COC_BROWSER_E2E_USER_DATA);
app.setPath('sessionData', path.join(process.env.COC_BROWSER_E2E_USER_DATA, 'session'));
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require('../../dist/browser-view-host');
const cocRoot = path.resolve(__dirname, '../../../coc');
const serverCode = buildSync({
    entryPoints: [path.join(cocRoot, 'src/server/streaming/websocket.ts')],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
}).outputFiles[0].text;
const serverModule = { exports: {} };
new Function('require', 'module', 'exports', serverCode)(require, serverModule, serverModule.exports);
const { ProcessWebSocketServer } = serverModule.exports;
const renderer = buildSync({
    stdin: {
        resolveDir: cocRoot, loader: 'tsx',
        contents: `
            import React from 'react';
            import { createRoot } from 'react-dom/client';
            import { CocClient } from '@plusplusoneplusplus/coc-client';
            import { createBrowserSocketRelay } from './src/server/spa/client/react/shared/file-path/browser-control-relay';
            import { useUnifiedPanelState } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
            import { UnifiedBrowserTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
            import { BrowserWebviewLayer } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserWebviewLayer';
            let relay;
            const conn = new CocClient({baseUrl:location.origin}).events.connect({
                onOpen() { relay.onOpen(); },
                onMessage(message) { relay.onMessage(message); },
                onStatusChange(status) { if(status==='closed') relay?.onClose(); },
            });
            relay = createBrowserSocketRelay(conn);
            relay.update('fixture-workspace');
            function Fixture() {
                const [state] = useUnifiedPanelState('fixture-workspace');
                return <>
                    <div style={{position:'fixed',left:10,top:10,width:1400,height:600,display:'flex'}}>
                        {state.workspaceTabs.filter(tab=>tab.kind==='browser').map(tab=>
                            <UnifiedBrowserTab key={tab.id} tabId={tab.id} viewId={tab.resourceId}
                                sessionKey={tab.ownerRoutingRef || tab.ownerWorkspaceId} url={tab.browserUrl}
                                active visible nativeCovered={false} onNavigate={()=>{}} onPageState={()=>{}} />)}
                    </div>
                    <BrowserWebviewLayer/>
                </>;
            }
            createRoot(document.getElementById('root')).render(<Fixture/>);
        `,
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    loader: { '.css': 'empty' }, define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;
const server = createServer((request, response) => {
    if (request.url === '/renderer.js') {
        response.setHeader('content-type', 'application/javascript'); response.end(renderer);
    } else if (request.url.startsWith('/page')) {
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html><title>Relay fixture</title><h1>Local fixture</h1><label>Name <input></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Save</button><output></output>');
    } else {
        response.setHeader('content-type', 'text/html');
        response.end('<!doctype html><style>.flex{display:flex}.flex-1{flex:1}.flex-col{flex-direction:column}.min-h-0{min-height:0}.flex-shrink-0{flex-shrink:0}</style><div id="root"></div><script src="/renderer.js"></script>');
    }
});
const sockets = new ProcessWebSocketServer();
sockets.attach(server);
sockets.browserControl.setEnabledGetter(() => true);
let win;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
    await app.whenReady();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    registerBrowserViewIpc(path.join(process.env.COC_BROWSER_E2E_USER_DATA, 'coc'));
    win = new BrowserWindow({ width: 1500, height: 800, webPreferences: {
        preload: path.resolve(__dirname, '../../dist/preload.js'), sandbox: true, contextIsolation: true, webviewTag: true,
    } });
    registerBrowserEmbedder(win, origin);
    win.webContents.on('console-message', event => console.error('Renderer:', event.message));
    await win.loadURL(origin);
    let tabs;
    for (let attempt = 0; attempt < 200; attempt++) {
        try { tabs = await sockets.browserControl.execute('fixture-workspace', 'fixture-process', { action: 'tabs' }); break; }
        catch (error) {
            if (!error.message.includes('No CoC desktop')) throw error;
            await pause(25);
        }
    }
    if (!tabs) throw new Error('Fixture capability was not advertised');
    const execute = async (command, tab) => {
        console.error('Fixture action:', command.action);
        try { return await sockets.browserControl.execute('fixture-workspace', 'fixture-process', command, tab); }
        catch (error) {
            console.error('Fixture DOM:', await win.webContents.executeJavaScript('document.body.innerHTML'));
            throw error;
        }
    };
    const opened = await execute({ action: 'open', url: origin + '/page' });
    const snapshot = await execute({ action: 'snapshot' }, opened.tab);
    const field = snapshot.elements.find(element => element.name === 'Name');
    const button = snapshot.elements.find(element => element.name === 'Save');
    await execute({ action: 'type', ref: field.ref, text: 'Fixture value' }, opened.tab);
    await execute({ action: 'click', ref: button.ref }, opened.tab);
    const read = await execute({ action: 'read' }, opened.tab);
    const evaluated = await execute({ action: 'eval', js: '({saved:document.querySelector("output").textContent})' }, opened.tab);
    const screenshot = await execute({ action: 'screenshot' }, opened.tab);
    const size = nativeImage.createFromBuffer(Buffer.from(screenshot.image.data, 'base64')).getSize();
    const crop = await execute({ action: 'screenshot', ref: button.ref }, opened.tab);
    const cropSize = nativeImage.createFromBuffer(Buffer.from(crop.image.data, 'base64')).getSize();
    const listed = await execute({ action: 'tabs' });
    await execute({ action: 'eval', js: '(()=>{window.open("/page?popup","fixture-popup","width=500,height=400");return true})()' }, opened.tab);
    let popup;
    for (let attempt = 0; attempt < 200; attempt++) {
        popup = (await execute({ action: 'tabs' })).tabs.find(tab => tab.url.includes('popup'));
        if (popup) break;
        await pause(25);
    }
    if (!popup) throw new Error('Workspace popup missing from tabs');
    const popupSelection = await execute({ action: 'select', tab: popup.id });
    const popupRead = await execute({ action: 'read' }, popup.id);
    console.log('E2E::' + JSON.stringify({
        initialTabs: tabs.tabs.length, tabs: listed.tabs.length, selected: opened.tab === listed.tabs[0].id,
        read: read.text, value: evaluated.value, imageType: screenshot.image.mimeType, size, cropSize,
        popupSelected: popupSelection.tab === popup.id, popupRead: popupRead.text,
    }));
    win.destroy();
    await disposeBrowserViews();
    sockets.closeAll();
    await new Promise(resolve => server.close(resolve));
    app.exit(0);
})().catch(async error => {
    console.error(error);
    if (win && !win.isDestroyed()) win.destroy();
    await disposeBrowserViews().catch(() => {});
    sockets.closeAll();
    server.closeAllConnections();
    server.close();
    app.exit(1);
});

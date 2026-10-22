const { app, BrowserWindow, dialog, webContents } = require('electron');
const { buildSync } = require('esbuild');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

app.setPath('userData', process.env.COC_WEBVIEW_LAYER_DATA);
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require('../../dist/browser-view-host');
const { capturePage } = require('./webview-security-checks.cjs');
const cocRoot = path.resolve(__dirname, '../../../coc');
const renderer = buildSync({
    stdin: {
        resolveDir: cocRoot,
        loader: 'tsx',
        contents: `
            import React, { useState } from 'react';
            import { createRoot } from 'react-dom/client';
            import { BrowserWebviewLayer } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/BrowserWebviewLayer';
            import { UnifiedBrowserTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedBrowserTab';
            import { UnifiedHtmlPageTab } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/UnifiedHtmlPageTab';
            import { closeBrowserPanelView } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/unifiedPanelStore';
            import { setBrowserWebviewBackground } from './src/server/spa/client/react/features/repo-detail/unified-right-panel/browserWebviewLayerStore';
            const bridge = window.cocDesktop.browser;
            const ignore = () => {};
            bridge.onClosed(({viewId}) => closeBrowserPanelView(viewId));
            function Fixture() {
                const [mounted, setMounted] = useState(true);
                const [shown, setShown] = useState(true);
                const [expanded, setExpanded] = useState(false);
                const [overlay, setOverlay] = useState('');
                const [file, setFile] = useState(() => localStorage.getItem('fixture-file') || '');
                window.fixture = { setMounted, setShown, setExpanded, setOverlay, setBackground: setBrowserWebviewBackground,
                    setFile(path) { localStorage.setItem('fixture-file', path); setFile(path); },
                    close(id) { closeBrowserPanelView(id); bridge.close(id); setMounted(false); },
                };
                return <>
                    <input id="spa-input" style={{position:'fixed',left:0,top:0,width:80}} />
                    <div style={{position:'fixed',left:100,top:40,width:expanded ? 650 : 500,height:500,display:'flex'}}>
                        {mounted && (file ? <UnifiedHtmlPageTab tabId="file-tab" pageId="file" wsId="workspace-a"
                            filePath={file} active visible={shown} nativeCovered={!!overlay} onErrorChange={ignore} />
                            : <UnifiedBrowserTab tabId="tab" viewId="view" sessionKey="workspace-a"
                            url={location.origin + '/page'} active visible={shown} nativeCovered={!!overlay}
                            onNavigate={ignore} onPageState={ignore} />)}
                    </div>
                    {overlay && <div id="overlay" role={overlay === 'dialog' ? 'dialog' : 'menu'}
                        style={{position:'fixed',left:180,top:160,width:180,height:100,zIndex:50,background:'rgb(200,50,60)'}}
                        onClick={() => {window.overlayClicked = true;}}>{overlay}</div>}
                    <BrowserWebviewLayer />
                </>;
            }
            createRoot(document.getElementById('root')).render(<Fixture />);
        `,
    },
    bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    // The fixture serves the built SPA stylesheet separately.
    loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' },
}).outputFiles[0].text;

const server = createServer((req, res) => {
    if (req.url === '/renderer.js') {
        res.setHeader('content-type', 'application/javascript');
        res.end(renderer);
    } else if (req.url === '/style.css') {
        res.setHeader('content-type', 'text/css');
        res.end(readFileSync(path.join(cocRoot, 'src/server/spa/client/dist/bundle.css')));
    } else if (req.url.startsWith('/page')) {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><title>Live fixture</title><style>html,body{margin:0;background:rgb(20,170,90)}body{height:1800px}</style><input id="draft"><a href="/page?next">Next</a>');
    } else {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/renderer.js"></script>');
    }
});

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, diagnostic) {
    for (let i = 0; i < 200; i++) {
        const value = await check();
        if (value) return value;
        await pause(25);
    }
    throw new Error(`Timed out: ${label}${diagnostic ? '\n' + await diagnostic() : ''}`);
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function pixel(image, x, y) {
    const size = image.getSize();
    const index = (Math.floor(y) * size.width + Math.floor(x)) * 4;
    const bitmap = image.toBitmap({ scaleFactor: 1 });
    return [bitmap[index + 2], bitmap[index + 1], bitmap[index]];
}

app.whenReady().then(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    registerBrowserViewIpc(path.join(process.env.COC_WEBVIEW_LAYER_DATA, 'coc'));
    const win = new BrowserWindow({
        width: 900, height: 700, show: true,
        webPreferences: { preload: path.resolve(__dirname, '../../dist/preload.js'), sandbox: true, contextIsolation: true, webviewTag: true },
    });
    registerBrowserEmbedder(win, origin);
    win.webContents.on('console-message', event => console.error('Renderer:', event.message));
    const js = code => win.webContents.executeJavaScript(code);
    await win.loadURL(origin);
    const guestId = await until(() => js(`(() => {
        const view = document.querySelector('webview');
        try { return view && view.getWebContentsId(); } catch { return false; }
    })()`), 'guest attachment', () => js('document.body.innerText'));
    const guest = webContents.fromId(guestId);
    await until(() => guest.getTitle() === 'Live fixture' && !guest.isLoading(), 'page load');
    await until(() => js(`document.querySelector('[data-browser-view-id]').style.visibility === 'visible'`), 'visible layer');
    await guest.executeJavaScript(`document.getElementById('draft').value = 'unsent text'; history.pushState({}, '', '?history=kept'); scrollTo(0, 240);`);

    for (const action of ['setMounted(false)', 'setMounted(true)', 'setShown(false)', 'setShown(true)', 'setExpanded(true)', 'setExpanded(false)']) {
        await js(`window.fixture.${action}`);
        await pause(80);
    }
    assert(await js(`document.querySelector('webview').getWebContentsId()`) === guestId, 'Workspace/panel changes recreated the guest');
    assert(await guest.executeJavaScript(`document.getElementById('draft').value === 'unsent text' && scrollY === 240 && location.search === '?history=kept'`), 'Workspace/panel changes lost page state');
    console.log('E2E::' + JSON.stringify({ step: 'persistence', ok: true }));

    for (const overlay of ['+ menu', 'tab context menu', 'dialog', 'toast']) {
        await js(`window.fixture.setOverlay(${JSON.stringify(overlay)})`);
        await until(() => js(`!!document.getElementById('overlay')`), 'overlay mount');
        await pause(80);
        assert(await js(`document.querySelector('[data-browser-view-id]').style.visibility === 'visible'`), `${overlay} hid the guest`);
        const image = await capturePage(win.webContents);
        assert(pixel(image, 190, 230).join() === '200,50,60', `${overlay} did not paint over the guest: ${pixel(image, 190, 230)}`);
        assert(pixel(image, 450, 300).join() === '20,170,90', `${overlay} blanked the page`);
        await js('window.overlayClicked = false');
        win.webContents.sendInputEvent({ type: 'mouseDown', x: 190, y: 230, button: 'left', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x: 190, y: 230, button: 'left', clickCount: 1 });
        await until(() => js('window.overlayClicked'), 'overlay receives click');
        await js(`window.fixture.setOverlay('')`);
    }
    console.log('E2E::' + JSON.stringify({ step: 'overlays', ok: true }));

    const pageHeight = await js(`document.querySelector('[data-browser-view-id]').style.height`);
    await js(`document.querySelector('[aria-label="Browser options"]').click()`);
    await until(() => js(`!!document.querySelector('[role="menu"]')`), 'toolbar dropdown');
    const menu = await js(`(() => {const r=document.querySelector('[role="menu"]').getBoundingClientRect();return {x:r.left+8,y:r.top+8};})()`);
    await pause(80);
    const menuImage = await capturePage(win.webContents);
    assert(pixel(menuImage, menu.x, menu.y).join() !== '20,170,90', 'Toolbar menu is behind the page');
    assert(pixel(menuImage, 180, 300).join() === '20,170,90', 'Toolbar dropdown hid the page');
    assert(await js(`document.querySelector('[data-browser-view-id]').style.height`) === pageHeight, 'Dropdown resized the page');
    assert(await js(`document.querySelector('[data-testid="browser-title"]') === null`), 'Extra title row is visible');
    console.log('E2E::' + JSON.stringify({ step: 'toolbar', ok: true }));

    // Background control: the panel unmounts (another workspace is on screen) while a turn drives the tab.
    await js(`document.getElementById('spa-input').focus(); window.fixture.setMounted(false)`);
    await until(() => js(`document.querySelector('[data-browser-view-id]').style.visibility === 'hidden'`), 'hidden guest');
    await js(`window.fixture.setBackground('view', true)`);
    await until(() => js(`(() => { const s = document.querySelector('[data-browser-view-id]').style; return s.opacity === '0' && s.visibility === 'visible' && s.pointerEvents === 'none'; })()`), 'background layout');
    await pause(80);
    if (!guest.debugger.isAttached()) guest.debugger.attach('1.3');
    const cdp = (method, params = {}) => guest.debugger.sendCommand(method, params);
    await until(() => guest.executeJavaScript(`document.visibilityState === 'visible' && innerWidth > 0`), 'background guest stays visible to the page');
    const shot = await Promise.race([cdp('Page.captureScreenshot', { format: 'png' }), pause(10_000).then(() => null)]);
    assert(shot && typeof shot.data === 'string' && shot.data.length > 100, 'Background guest screenshot failed');
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    const box = await guest.executeJavaScript(`(() => { scrollTo(0, 0); document.getElementById('draft').value = ''; const r = document.getElementById('draft').getBoundingClientRect(); return { x: Math.round(r.left + 4), y: Math.round(r.top + 4) }; })()`);
    // Electron routes CDP keyboard input to the embedder's focused frame; background input goes to the guest itself.
    const { translateBackgroundInput } = require('../../dist/electron-background-input');
    const input = async (method, params) => {
        for (const step of translateBackgroundInput(method, params)) {
            if (step.kind === 'insertText') await guest.insertText(step.text);
            else if (step.kind === 'selectAll') guest.selectAll();
            else guest.sendInputEvent(step.event);
        }
        await pause(30);
    };
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
        await input('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    await until(() => guest.executeJavaScript(`document.activeElement.id === 'draft'`), 'background click focuses the page field');
    // The layer hands focus back to the SPA; background typing must still reach only the page.
    await until(() => js(`document.activeElement === document.getElementById('spa-input')`), 'focus returns to the SPA');
    await guest.executeJavaScript(`document.getElementById('draft').value = 'old'`);
    const selectAll = process.platform === 'darwin' ? { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: ['selectAll'] } : { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 };
    await input('Input.dispatchKeyEvent', { type: 'keyDown', ...selectAll });
    await input('Input.dispatchKeyEvent', { type: 'keyUp', ...selectAll });
    await input('Input.insertText', { text: 'typed unseen' });
    await input('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' });
    await input('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await until(() => guest.executeJavaScript(`document.getElementById('draft').value === 'typed unseen'`), 'background input',
        () => guest.executeJavaScript(`document.getElementById('draft').value`));
    await input('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 200, y: 200, deltaX: 0, deltaY: 600 });
    await until(() => guest.executeJavaScript(`scrollY > 0`), 'background wheel scrolls down');
    assert(await js(`document.getElementById('spa-input').value === ''`), 'Background input leaked into the SPA');
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: false });
    const backgroundImage = await capturePage(win.webContents);
    assert(pixel(backgroundImage, 450, 300).join() !== '20,170,90', 'Background guest became visible');
    assert(await js(`document.activeElement === document.getElementById('spa-input')`), 'Background typing moved focus off the SPA');
    win.webContents.sendInputEvent({ type: 'char', keyCode: 'x' });
    await until(() => js(`document.getElementById('spa-input').value === 'x'`), 'user typing still reaches the SPA');
    assert(await guest.executeJavaScript(`document.getElementById('draft').value === 'typed unseen'`), 'User typing reached the background page');
    await js(`window.fixture.setBackground('view', false)`);
    await until(() => js(`document.querySelector('[data-browser-view-id]').style.visibility === 'hidden'`), 'background layout released');
    await js(`window.fixture.setMounted(true)`);
    await until(() => js(`document.querySelector('[data-browser-view-id]').style.visibility === 'visible'`), 'guest shown again');
    assert(await guest.executeJavaScript(`document.getElementById('draft').value === 'typed unseen'`), 'Switching back lost background page state');
    console.log('E2E::' + JSON.stringify({ step: 'background', ok: true }));

    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    const cleared = await js(`window.cocDesktop.browser.clearData('electron')`);
    assert(cleared.ok, 'Browser data cleanup failed');
    await until(() => js(`!document.querySelector('webview')`), 'closed guest removed from layer');
    assert(guest.isDestroyed(), 'Closed guest survived');
    console.log('E2E::' + JSON.stringify({ step: 'close', ok: true }));

    const filePath = path.join(process.env.COC_WEBVIEW_LAYER_DATA, 'page.html');
    writeFileSync(filePath, '<!doctype html><title>Local fixture</title><style>html,body{margin:0;background:rgb(20,170,90)}body{height:1800px}</style><input id="draft">');
    await js(`window.fixture.setFile(${JSON.stringify(filePath)})`);
    const fileGuestId = await until(() => js(`(() => {
        const view = document.querySelector('webview');
        try { return view && view.getWebContentsId(); } catch { return false; }
    })()`), 'HTML guest attachment', () => js('document.body.innerText'));
    const fileGuest = webContents.fromId(fileGuestId);
    await until(() => fileGuest.getTitle() === 'Local fixture' && !fileGuest.isLoading(), 'HTML load');
    await fileGuest.executeJavaScript(`document.getElementById('draft').value = 'local draft'; location.hash = 'kept'; scrollTo(0, 240);`);
    await js(`window.fixture.setOverlay('+ menu')`);
    await until(() => js(`!!document.getElementById('overlay')`), 'HTML overlay');
    await pause(80);
    const fileImage = await capturePage(win.webContents);
    assert(pixel(fileImage, 190, 230).join() === '200,50,60', 'HTML menu did not paint above the page');
    assert(pixel(fileImage, 450, 300).join() === '20,170,90', 'HTML menu blanked the page');
    await js(`window.fixture.setOverlay(''); window.fixture.setMounted(false)`);
    await pause(80);
    await js('window.fixture.setMounted(true)');
    await until(() => js(`document.querySelector('[data-browser-view-id]').style.visibility === 'visible'`), 'HTML remount');
    assert(await js(`document.querySelector('webview').getWebContentsId()`) === fileGuestId, 'HTML remount recreated guest');
    assert(await fileGuest.executeJavaScript(`document.getElementById('draft').value === 'local draft' && scrollY === 240`), 'HTML remount lost state');
    assert((await js(`window.cocDesktop.browser.clearData('electron')`)).ok, 'Profile cleanup failed');
    assert(!fileGuest.isDestroyed(), 'Browser profile cleanup destroyed an HTML guest');
    await win.loadURL(origin);
    const reopenedId = await until(() => js(`(() => {
        const view = document.querySelector('webview');
        try { return view && view.getWebContentsId(); } catch { return false; }
    })()`), 'HTML restored after SPA reload', () => js('document.body.innerText'));
    assert(reopenedId !== fileGuestId && fileGuest.isDestroyed(), 'SPA reload retained an old HTML guest');
    const reopened = webContents.fromId(reopenedId);
    await until(() => reopened.getTitle() === 'Local fixture' && !reopened.isLoading(), 'HTML restored load');
    assert(await reopened.executeJavaScript(`document.getElementById('draft').value === '' && scrollY === 0 && location.hash === ''`), 'HTML reload retained page-local state');
    await js(`window.fixture.close('html-page:file')`);
    await until(() => js(`!document.querySelector('webview')`), 'HTML tab close');
    console.log('E2E::' + JSON.stringify({ step: 'html', ok: true }));
    await disposeBrowserViews();
    win.destroy();
    server.close();
    app.exit(0);
}).catch(error => {
    console.error(error);
    server.close();
    app.exit(1);
});

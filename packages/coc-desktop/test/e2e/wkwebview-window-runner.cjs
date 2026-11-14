'use strict';

// Real WKWebView helper over a real Electron window: the overlay panel follows the window
// (move, resize, fullscreen), hides with it (minimize, hide, tab switch) and background
// control never steals focus. Placement is read back from the helper's `view-state`.
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow, Menu } = require('electron');
const { WkWebViewBrowserHost } = require('../../dist/wkwebview-browser-host.js');

const userData = process.env.COC_BROWSER_E2E_USER_DATA;
app.setPath('userData', userData);

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const results = {};
const step = name => console.log('STEP ' + name);

async function until(check, label, timeout = 5000) {
    let last;
    for (const started = Date.now(); Date.now() - started < timeout; await delay(25)) {
        last = await check();
        if (last) return last;
    }
    throw new Error(`Timed out waiting for ${label}`);
}

function once(window, event, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`No ${event} event`)), timeout);
        window.once(event, () => { clearTimeout(timer); resolve(); });
    });
}

(async () => {
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><title>window</title><input id="field">');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await app.whenReady();
    Menu.setApplicationMenu(null);
    const window = new BrowserWindow({ x: 120, y: 120, width: 800, height: 600, show: true });
    await window.loadURL('data:text/html,<body style="margin:0;background:%23888"><input id="chrome" autofocus>');
    window.focus();
    const host = new WkWebViewBrowserHost(path.join(userData, 'coc', 'browser', 'wkwebview'));
    const availability = await host.availability();
    if (!availability.available) throw new Error('WKWebView unavailable: ' + JSON.stringify(availability));
    const sink = { state() {}, newTab() {}, download() {}, closeRequested() {}, openMenuRequested() {} };
    const url = `http://127.0.0.1:${server.address().port}/`;
    const view = await host.create({ ownerId: window.webContents.id, viewId: 'window', sessionKey: 'e2e', url }, sink);
    // The helper's id for this view; `process` is the host's helper connection.
    const viewState = () => host.process.request('view-state', { viewId: `${window.webContents.id}:window:1` });
    const slot = { x: 10, y: 20, width: 400, height: 300 };
    const expected = () => {
        const content = window.getContentBounds();
        return window.isFullScreen() ? content : { x: content.x + slot.x, y: content.y + slot.y, width: slot.width, height: slot.height };
    };
    const near = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 1);
    const placed = async label => until(async () => {
        const state = await viewState();
        return state.mode === 'shown' && state.visible && !state.transparent && near(state.frame, expected()) && state;
    }, label);
    const hidden = async label => until(async () => {
        const state = await viewState();
        return state.mode === 'hidden' && !state.visible && state;
    }, label);
    // Main never hands keyboard focus to the panel without an explicit focus request.
    const notStolen = async () => {
        const state = await viewState();
        if (state.key) throw new Error('Panel took keyboard focus: ' + JSON.stringify(state));
    };

    step('placed at the slot');
    await view.setBounds(slot);
    await view.waitForControlReady(new AbortController().signal);
    await placed('initial placement');
    await notStolen();
    results.placed = true;

    step('tracks move and resize');
    window.setPosition(220, 160);
    await placed('panel follows move');
    window.setSize(900, 700);
    slot.width = 600; slot.height = 500;
    await view.setBounds(slot);
    await placed('panel follows resize');
    results.tracksMoveResize = true;

    step('hides on tab switch');
    await view.setBounds(null);
    await hidden('unplaced view hides');
    await view.setBounds(slot);
    await placed('replaced view shows');
    results.hidesOnTabSwitch = true;

    step('hides on minimize and window hide');
    const minimized = once(window, 'minimize');
    window.minimize();
    await minimized;
    await hidden('minimized parent hides the panel');
    const restored = once(window, 'restore');
    window.restore();
    await restored;
    await placed('restored parent shows the panel');
    window.hide();
    await hidden('hidden parent hides the panel');
    window.show();
    await placed('shown parent shows the panel');
    results.hidesWithParent = true;

    step('background control never steals focus');
    window.focus();
    await view.setBounds(null);
    await view.setBackgroundControl(true);
    await until(async () => {
        const state = await viewState();
        return state.mode === 'background' && state.visible && state.transparent && state;
    }, 'background panel keeps rendering invisibly');
    const title = await view.control.evaluate('document.title', {});
    if (title.value !== 'window') throw new Error('Background evaluate failed: ' + JSON.stringify(title));
    await view.navigate(url + '?next');
    await until(async () => (await view.control.evaluate('location.search', {})).value === '?next', 'background navigation');
    await notStolen();
    if (BrowserWindow.getFocusedWindow() && BrowserWindow.getFocusedWindow() !== window) throw new Error('Another window took focus');
    await view.setBackgroundControl(false);
    await hidden('background off without a slot hides');
    await view.setBounds(slot);
    await placed('placed again after background control');
    await notStolen();
    results.backgroundNoFocusSteal = true;

    step('follows fullscreen');
    const entered = once(window, 'enter-full-screen', 10_000);
    window.setFullScreen(true);
    await entered;
    await placed('panel fills the fullscreen content');
    const left = once(window, 'leave-full-screen', 10_000);
    window.setFullScreen(false);
    await left;
    await placed('panel returns to the slot after fullscreen');
    results.followsFullscreen = true;

    step('explicit focus');
    await view.focus();
    results.explicitFocus = !!(await until(async () => (await viewState()).key, 'explicit focus makes the panel key').catch(() => false));

    console.log('E2E::' + JSON.stringify(results));
    await view.close();
    await host.dispose();
    server.close();
    app.exit(0);
})().catch(error => {
    console.error(error?.stack || error);
    console.log('PARTIAL::' + JSON.stringify(results));
    app.exit(1);
});

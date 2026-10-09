'use strict';
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const dist = path.join(__dirname, '..', '..', 'dist');
const { registerBrowserViewIpc, registerBrowserEmbedder, disposeBrowserViews } = require(path.join(dist, 'browser-view-host.js'));
const { fixtureScript } = require('./webview-fixture.cjs');
const { loadWebView2Binary } = require('@plusplusoneplusplus/coc-native');
const userData = process.env.COC_BROWSER_E2E_USER_DATA;
const engine = process.env.COC_BROWSER_E2E_ENGINE || 'electron';
const restart = process.argv.includes('--restart-check');
const afterClear = process.argv.includes('--after-clear');
const blankClearCheck = process.argv.includes('--blank-cookie-import-clear-check');
const blankImportCheck = process.argv.includes('--blank-cookie-import-check') || blankClearCheck;
const cookieImportCheck = process.argv.includes('--cookie-import-check');
const focusCheck = process.argv.includes('--focus-check');
const layoutCheck = process.argv.includes('--layout-check');
const zoomCheck = process.argv.includes('--zoom-check');
const execFileAsync = promisify(execFile);
// The profile (userData/coc/browser/electron) must sit inside Electron's userData:
// macOS sandboxes the network service to userData and the user temp dir, and a
// cookie DB anywhere else silently falls back to memory.
app.setPath('userData', userData);
const externalCalls = [];
shell.openExternal = async url => { externalCalls.push(url); };
let confirmation = 0;
dialog.showMessageBox = async () => ({ response: confirmation });
const emit = (step, value) => console.log('E2E::' + JSON.stringify({ step, ...value }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const commands = new Map();
const reports = new Map();
const importedRequests = new Map();
const importCookies = [
    { name: 'imported', value: 'auth-token', path: '/', secure: false, httpOnly: true, sameSite: 'lax' },
    { name: 'fixture_session', value: '"fixture\\segment"', path: '/', secure: false, httpOnly: true, sameSite: 'lax' },
    { name: 'fixture_auth_0', value: 'fixture-part-0==%2F+/', path: '/', secure: false, httpOnly: true, sameSite: 'lax' },
    { name: 'fixture_auth_1', value: 'fixture-part-1==', path: '/', secure: false, httpOnly: true, sameSite: 'lax' },
];
let helperProbe;
let server;
let base;

const { browserPageScript } = require('./browser-engine-page.cjs');
const script = `<script>${browserPageScript}</script>`;
function handle(req, res) {
    const url = new URL(req.url, base || 'http://localhost');
    if (url.pathname === '/command') {
        const key = url.searchParams.get('tab');
        res.end(commands.get(key) || '');
        commands.delete(key);
        return;
    }
    if (url.pathname === '/report') {
        let body = '';
        req.on('data', data => { body += data; });
        req.on('end', () => { reports.set(url.searchParams.get('tab'), JSON.parse(body)); res.end('ok'); });
        return;
    }
    if (url.pathname === '/cookie-auth') {
        const pairs = req.headers.cookie?.split('; ') ?? [];
        importedRequests.set(url.searchParams.get('tab'), pairs);
        if (!importCookies.every(({ name, value }) => pairs.includes(`${name}=${value}`))) {
            res.writeHead(302, { Location: base + '/login?tab=main' }); res.end(); return;
        }
    }
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/second?tab=main' }); res.end(); return; }
    if (url.pathname === '/download') { res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="fixture.zip"' }); res.end('fixture'); return; }
    if (url.pathname === '/slow') { res.setHeader('Content-Type', 'text/html'); res.write('<html><head><title>Slow</title></head>'); return; }
    const title = url.pathname === '/second' ? 'Second' : url.pathname === '/login' ? 'Login' : 'Home';
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><title>${title}</title></head><body><input id="input"><a href="/second?tab=main">Next</a><script>window.cookieAuthenticated=${url.pathname === "/cookie-auth"};</script>${script}
        ${url.pathname === '/login' ? '<script>window.opener.postMessage("authenticated","*");</script>' : ''}</body></html>`);
}
async function waitFor(predicate, description, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(40); }
    throw new Error(`Timed out waiting for ${description}; reports=${JSON.stringify([...reports])}; importedRequests=${JSON.stringify([...importedRequests])}`);
}
function command(key, value) { commands.set(key, value); }

app.whenReady().then(async () => {
    if (layoutCheck) Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Fixture', submenu: [{ label: 'Item' }] }]));
    const dataDir = path.join(userData, 'coc');
    const historyFile = path.join(dataDir, 'browser', 'history.json');
    const readHistory = () => fs.existsSync(historyFile) ? JSON.parse(fs.readFileSync(historyFile, 'utf8')) : undefined;
    const startupHistory = readHistory();
    registerBrowserViewIpc(dataDir);
    const portFile = path.join(userData, 'fixture-port');
    server = http.createServer(handle);
    const oldPort = fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, 'utf8')) : 0;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(oldPort, '127.0.0.1', resolve); });
    fs.writeFileSync(portFile, String(server.address().port));
    base = `http://127.0.0.1:${server.address().port}`;
    const windows = [];
    const makeWindow = async () => {
        const win = new BrowserWindow({ width: 900, height: 650, show: true, webPreferences: { preload: path.join(dist, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: true } });
        const spaUrl = 'data:text/html,' + encodeURIComponent(`<body><textarea id="composer" style="position:absolute;left:10px;top:10px;width:250px;height:40px"></textarea><input id="address" style="position:absolute;left:10px;top:70px"><script>
            window.states=[];window.newTabs=[];window.downloads=[];window.closedViews=[];
            document.addEventListener('pointerdown',e=>window.lastPointer={x:e.clientX,y:e.clientY,target:e.target.id});
            const b=window.cocDesktop.browser;
            b.onState(s=>window.states.push(s));b.onNewTab(e=>window.newTabs.push(e));
            b.onDownload(e=>window.downloads.push(e));b.onClosed(e=>window.closedViews.push(e));
        </script></body>`);
        registerBrowserEmbedder(win, spaUrl);
        await win.loadURL(spaUrl);
        await win.webContents.executeJavaScript(fixtureScript);
        windows.push(win);
        return win;
    };
    const main = await makeWindow();
    const spa = js => main.webContents.executeJavaScript(js);
    const call = (win, method, ...args) => win.webContents.executeJavaScript(`window.__browser.${method}(${args.map(value => JSON.stringify(value)).join(',')})`);
    const state = (win, id) => win.webContents.executeJavaScript(`window.states.filter(s=>s.viewId===${JSON.stringify(id)}).slice(-1)[0]`);
    // Main-process view of the Electron profile cookie jar, for persistence diagnostics.
    const jar = async () => engine !== 'electron' ? null : (await session.fromPath(path.join(dataDir, 'browser', 'electron')).cookies.get({}))
        .map(({ name, domain, session: sessionOnly, expirationDate }) => ({ name, domain, sessionOnly, expirationDate }));
    const settled = (win, id, predicate) => waitFor(async () => { const current = await state(win, id); return current && !current.loading && predicate(current) ? current : null; }, `${id} state`);
    const pref = await call(main, 'getPreferences');
    if (engine === 'webview2' && !pref.engines.find(e => e.engine === engine)?.available) throw new Error('Required real WebView2 capability is unavailable: ' + JSON.stringify(pref));
    await call(main, 'setDefaultEngine', engine);
    if (blankImportCheck) {
        const imported = await call(main, 'importCookies', null, 'localhost', JSON.stringify(importCookies.slice(0, 2)));
        const remaining = await call(main, 'importCookies', null, 'localhost', JSON.stringify(importCookies.slice(2)));
        emit('blank-import', { imported, remaining, states: await spa('window.states') });
        if (blankClearCheck) {
            confirmation = 1;
            emit('blank-clear', { result: await call(main, 'clearData', engine) });
        }
    }
    const initialUrl = blankImportCheck ? base.replace('127.0.0.1', 'localhost') + '/cookie-auth?tab=main' : base + '/?tab=main';
    const opened = await call(main, 'open', 'main', initialUrl, 'workspace-a');
    if (!opened.ok) throw new Error('Browser startup failed: ' + JSON.stringify(opened));
    const home = await settled(main, 'main', s => s.title === (blankClearCheck ? 'Login' : 'Home'));
    await call(main, 'setBounds', 'main', { x: 350, y: 70, width: 420, height: 320 });
    await waitFor(() => reports.get('main'), 'fixture page report');
    if (zoomCheck) {
        const ratio = async (key, baseline = 1, expected) => {
            reports.delete(key);
            return (await waitFor(() => {
                command(key, 'report');
                const report = reports.get(key);
                return report && (expected === undefined || Math.abs(report.pixelRatio / baseline - expected) < 0.005) ? report : null;
            }, key + ' zoom report')).pixelRatio / baseline;
        };
        const baseline = await ratio('main');
        const other = await makeWindow();
        await call(other, 'open', 'other', base + '/?tab=other', 'remote-workspace');
        await settled(other, 'other', s => s.title === 'Home');
        await call(other, 'hide', 'other');
        const otherBaseline = await ratio('other');
        main.webContents.setZoomFactor(1.25);
        const update = await call(main, 'setPageZoom', 150);
        const active = await ratio('main', baseline, 1.5);
        const inactive = await ratio('other', otherBaseline, 1.5);
        await call(main, 'setPageZoom', 100);
        const earlyResetActive = await ratio('main', baseline, 1);
        const earlyResetInactive = await ratio('other', otherBaseline, 1);
        await call(main, 'setPageZoom', 150);
        await call(main, 'open', 'new', base + '/?tab=new', 'workspace-b');
        await settled(main, 'new', s => s.title === 'Home');
        await call(main, 'hide', 'main');
        await call(main, 'setBounds', 'new', { x: 350, y: 70, width: 420, height: 320 });
        const created = await ratio('new', baseline, 1.5);
        await call(main, 'navigate', 'main', base.replace('127.0.0.1', 'localhost') + '/second?tab=main');
        await settled(main, 'main', s => s.title === 'Second');
        const navigated = await ratio('main', baseline, 1.5);
        await call(main, 'close', 'new');
        await call(main, 'open', 'new', base + '/?tab=new', 'workspace-b');
        await settled(main, 'new', s => s.title === 'Home');
        const restored = await ratio('new', baseline, 1.5);
        const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'desktop-browser.json'), 'utf8'));
        await call(main, 'hide', 'new');
        await call(main, 'setBounds', 'main', { x: 350, y: 70, width: 420, height: 320 });
        main.focus();
        const reset = await call(other, 'setPageZoom', 100);
        const resetActive = await ratio('main', baseline, 1);
        const resetInactive = await ratio('other', otherBaseline, 1);
        const resetNew = await ratio('new', baseline, 1);
        emit('zoom', {
            update, active, inactive, created, navigated, restored,
            saved: saved.pageZoomPercent, reset, earlyResetActive, earlyResetInactive, resetActive, resetInactive, resetNew, shell: main.webContents.getZoomFactor(),
        });
    } else if (blankImportCheck) {
        emit('blank-authenticated', { url: home.url, report: reports.get('main'), receivedCookies: importedRequests.get('main') });
    } else if (cookieImportCheck) {
        const original = base.replace('127.0.0.1', 'localhost') + '/cookie-auth?tab=main';
        await call(main, 'navigate', 'main', original);
        const redirected = await settled(main, 'main', s => s.title === 'Login' && s.url.startsWith(base));
        const imported = await call(main, 'importCookies', 'main', 'localhost', JSON.stringify(importCookies));
        const afterImport = await state(main, 'main');
        reports.delete('main');
        await call(main, 'navigate', 'main', original);
        const authenticated = await settled(main, 'main', s => s.title === 'Home' && s.url === original);
        const report = await waitFor(() => reports.get('main')?.authenticated && reports.get('main'), 'imported HttpOnly cookie authenticated original domain');
        emit('cookie-import', { redirected: redirected.url, imported, afterImport: afterImport.url, authenticated: authenticated.url, report, receivedCookies: importedRequests.get('main') });
    } else if (layoutCheck) {
        const handle = main.getNativeWindowHandle().readBigUInt64LE().toString();
        await spa(`document.getElementById('address').style.cssText='position:absolute;left:350px;top:30px;width:400px;height:26px';
            const slot=document.createElement('div');slot.id='browser-slot';slot.style.cssText='position:absolute;left:350px;top:70px;width:420px;height:320px';document.body.append(slot);`);
        const layouts = [];
        for (const [menu, zoom] of [[true, 1], [false, 1], [true, 1.25]]) {
            main.setMenuBarVisibility(menu);
            main.webContents.setZoomFactor(zoom);
            main.setSize(900, 650);
            await delay(150);
            const bounds = await spa(`(() => {const r=document.getElementById('browser-slot').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
            await call(main, 'setBounds', 'main', bounds);
            await delay(150);
            const { stdout } = await execFileAsync('powershell.exe', [
                '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'browser-window-geometry.ps1'),
                '-WindowHandle', handle,
            ], { windowsHide: true });
            const geometry = JSON.parse(stdout.trim());
            const scale = zoom * geometry.dpi / 96;
            const expected = {
                x: geometry.rendererX + Math.round(bounds.x * scale),
                y: geometry.rendererY + Math.round(bounds.y * scale),
                width: Math.round((bounds.x + bounds.width) * scale) - Math.round(bounds.x * scale),
                height: Math.round((bounds.y + bounds.height) * scale) - Math.round(bounds.y * scale),
            };
            if (geometry.browserX !== expected.x || geometry.browserY !== expected.y
                || geometry.width !== expected.width || geometry.height !== expected.height) {
                throw new Error(`Browser overlaps its toolbar or misses its placeholder: ${JSON.stringify({ menu, zoom, geometry, expected })}`);
            }
            layouts.push({ menu, zoom, aligned: true });
        }
        emit('layout', { layouts });
    } else if (focusCheck) {
        main.focus();
        const handle = main.getNativeWindowHandle();
        const hwnd = handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
        const nativeInput = (...args) => execFileAsync('powershell.exe', [
            '-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'browser-focus-input.ps1'),
            '-WindowHandle', hwnd, ...args,
        ], { windowsHide: true });
        const click = (x, y) => {
            main.webContents.focus();
            main.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
            main.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        };
        await call(main, 'focus', 'main');
        command('main', 'focus-input');
        await waitFor(() => reports.get('main')?.inputFocused, 'browser input focus');
        await nativeInput();
        await waitFor(() => reports.get('main')?.input === '/', 'browser native keyboard input');
        emit('browser-keyboard', { value: reports.get('main').input });
        command('main', 'report');
        await waitFor(() => reports.get('main')?.focused, 'browser native focus');
        click(30, 30);
        await waitFor(() => spa('document.activeElement.id === "composer"'), 'composer DOM focus');
        const keyboard = await nativeInput();
        await delay(150);
        emit('composer-click', {
            value: await spa('document.getElementById("composer").value'),
            active: await spa('document.activeElement.id'),
            focused: await spa('document.hasFocus()'),
            pointer: await spa('window.lastPointer'),
            nativeFocus: keyboard.stdout.trim(),
        });
        await call(main, 'setBounds', 'main', { x: 350, y: 70, width: 420, height: 320 });
        await call(main, 'setBounds', 'main', { x: 350, y: 70, width: 421, height: 320 });
        await nativeInput();
        await delay(150);
        reports.delete('main');
        command('main', 'report');
        await waitFor(() => reports.get('main')?.input !== undefined, 'browser input report');
        emit('composer-layout', {
            value: await spa('document.getElementById("composer").value'),
            browserInput: reports.get('main').input,
        });
        reports.delete('main');
        await call(main, 'focus', 'main');
        command('main', 'focus-input');
        await waitFor(() => reports.get('main')?.inputFocused, 'repeat browser input focus');
        click(30, 30);
        await waitFor(() => spa('document.activeElement.id === "composer" && document.hasFocus()'), 'repeat composer DOM focus');
        await nativeInput();
        await waitFor(() => spa('document.getElementById("composer").value === "///"'), 'repeat composer click');
        if (engine === 'webview2') {
            await spa('document.getElementById("address").focus()');
            reports.delete('main');
            await call(main, 'focus', 'main');
            command('main', 'focus-input');
            await waitFor(() => reports.get('main')?.inputFocused, 'programmatic browser input focus');
            await spa('document.getElementById("composer").focus()');
            await nativeInput();
            await waitFor(() => spa('document.getElementById("composer").value === "////"'), 'programmatic composer focus');
        }
        emit('composer-refocus', { value: await spa('document.getElementById("composer").value') });
    } else if (restart) {
        emit('restart', { engine: home.engine, history: home.canGoBack, report: reports.get('main'), preference: pref.defaultEngine, jar: await jar(), savedHistory: startupHistory });
        if (!afterClear) {
            const otherWindow = await makeWindow();
            await call(otherWindow, 'open', 'other', base + '/?tab=other', 'remote-workspace');
            await settled(otherWindow, 'other', s => s.title === 'Home');
            const otherEngine = engine === 'electron' ? 'webview2' : 'electron';
            const otherAvailable = pref.engines.find(value => value.engine === otherEngine)?.available;
            if (otherAvailable) {
                await call(main, 'open', 'preserved', base + '/?tab=preserved', 'workspace-b', otherEngine);
                await settled(main, 'preserved', s => s.title === 'Home');
                command('preserved', 'seed');
                await waitFor(() => reports.get('preserved')?.storage === 'stored', 'other engine data seeded');
            }
            confirmation = 1;
            const result = await call(main, 'clearData', engine);
            emit('clear', {
                result,
                jar: await jar(),
                firstWindowClosed: await spa('window.closedViews'),
                secondWindowClosed: await otherWindow.webContents.executeJavaScript('window.closedViews'),
                closedNavigation: await call(otherWindow, 'navigate', 'other', base + '/second'),
                ...(otherAvailable ? { preserved: await call(main, 'navigate', 'preserved', base + '/?tab=preserved') } : {}),
            });
        }
    } else {
        emit('open', { result: opened, home, report: reports.get('main') });
        main.focus();
        await call(main, 'focus', 'main');
        command('main', 'report');
        await waitFor(() => reports.get('main')?.focused, 'native keyboard focus');
        emit('focus', { focused: reports.get('main').focused });
        command('main', 'next');
        await settled(main, 'main', s => s.title === 'Second');
        // Host-initiated navigation creates history entries without Chromium's
        // no-user-activation script-navigation intervention.
        await call(main, 'navigate', 'main', base + '/?tab=main');
        await settled(main, 'main', s => s.title === 'Home');
        await call(main, 'navigate', 'main', base + '/second?tab=main');
        const second = await settled(main, 'main', s => s.title === 'Second');
        await call(main, 'nav', 'main', 'back');
        const back = await settled(main, 'main', s => s.title === 'Home');
        await call(main, 'nav', 'main', 'forward');
        const forward = await settled(main, 'main', s => s.title === 'Second');
        command('main', 'push');
        await settled(main, 'main', s => s.url.includes('inpage=1'));
        const inpageUrl = base + '/second?tab=main&inpage=1';
        await waitFor(() => readHistory()?.entries.find(e => e.url === inpageUrl)?.engines[engine]?.visitCount === 1, 'same-document history');
        await call(main, 'nav', 'main', 'reload');
        await waitFor(() => readHistory()?.entries.find(e => e.url === inpageUrl)?.engines[engine]?.visitCount === 2, 'reload history');
        command('main', 'title');
        await settled(main, 'main', s => s.title === 'Updated page');
        await waitFor(() => readHistory()?.entries.find(e => e.url === inpageUrl)?.engines[engine]?.title === 'Updated page', 'history title update');
        emit('history', { second, back, forward });
        command('main', 'seed');
        await waitFor(() => reports.get('main')?.storage === 'stored', 'site data seeded');
        emit('seeded', { report: reports.get('main'), jar: await jar() });
        await call(main, 'navigate', 'main', base + '/slow');
        await waitFor(async () => (await state(main, 'main'))?.loading, 'slow load starts');
        await call(main, 'nav', 'main', 'stop');
        await settled(main, 'main', s => !s.loading);
        await call(main, 'navigate', 'main', base + '/redirect');
        const redirect = await settled(main, 'main', s => s.title === 'Second');
        await call(main, 'navigate', 'main', 'http://127.0.0.1:1/failed');
        const failure = await settled(main, 'main', s => !!s.error);
        await call(main, 'navigate', 'main', base + '/?tab=main');
        const retried = await settled(main, 'main', s => s.title === 'Home' && !s.error);
        emit('navigation', { redirect, failure, retried });
        reports.delete('main');
        command('main', 'permission');
        await waitFor(() => reports.get('main')?.permission, 'permission denial');
        emit('permissions', { report: reports.get('main'), refused: await call(main, 'navigate', 'main', 'javascript:alert(1)') });
        command('main', 'popup');
        await waitFor(() => reports.get('main')?.popupMessage === 'authenticated', 'popup authentication');
        emit('popup', { report: reports.get('main'), popup: reports.get('popup') });
        const secondWindow = await makeWindow();
        await call(secondWindow, 'open', 'other', base + '/?tab=other', 'remote-workspace');
        await settled(secondWindow, 'other', s => s.title === 'Home');
        await waitFor(() => reports.get('other'), 'second workspace report');
        emit('sharing', { report: reports.get('other'), foreign: await call(secondWindow, 'navigate', 'main', base + '/second') });
        const otherEngine = engine === 'electron' ? 'webview2' : 'electron';
        const canMix = pref.engines.find(e => e.engine === otherEngine)?.available;
        if (canMix) {
            await call(main, 'setDefaultEngine', otherEngine);
            await call(main, 'open', 'mixed', base + '/?tab=mixed', 'workspace-b');
            const mixed = await settled(main, 'mixed', s => s.title === 'Home');
            await waitFor(() => reports.get('mixed'), 'isolated other-engine report');
            emit('mixed', { engine: mixed.engine, report: reports.get('mixed'), existing: await state(main, 'main') });
        }
        command('main', 'newtab');
        const newTab = await waitFor(() => spa('window.newTabs[0]'), 'new tab request');
        const related = await call(main, 'open', 'related', newTab.url, 'workspace-a', newTab.engine);
        await settled(main, 'related', s => s.title === 'Second');
        emit('related', { newTab, result: related });
        command('main', 'download');
        const download = await waitFor(() => spa('window.downloads[0]'), 'download handoff');
        emit('download', { download, externalCalls });
        confirmation = 0;
        const cancelled = await call(main, 'clearData', engine);
        emit('cancel', { result: cancelled, tab: await call(main, 'navigate', 'main', base + '/?tab=main') });
        await settled(main, 'main', s => s.title === 'Home');
        await call(main, 'hide', 'main');
        await call(main, 'setBounds', 'main', { x: 300, y: 100, width: 300, height: 240 });
        await call(main, 'open', 'main', base + '/?tab=ignored', 'workspace-a');
        emit('lifecycle', { tab: await state(main, 'main') });
        if (engine === 'webview2') {
            helperProbe = spawn(loadWebView2Binary(), [path.join(dataDir, 'browser', 'webview2')]);
            let output = '';
            helperProbe.stdout.on('data', data => { output += data; });
            await new Promise(resolve => helperProbe.once('exit', resolve));
            emit('profile-lock', { result: JSON.parse(output.trim()) });
        }
        await call(main, 'setDefaultEngine', engine);
        // Cross-window cleanup is checked after the persistence restart.
    }
    const before = restart ? null : await jar();
    await disposeBrowserViews();
    emit('saved-history', { base, history: readHistory() });
    if (!restart) emit('disposed', { before, after: await jar() });
    windows.forEach(win => win.destroy());
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    app.exit(0);
}).catch(async error => {
    console.error(error);
    helperProbe?.kill();
    try { await disposeBrowserViews(); } catch (cleanupError) { console.error(cleanupError); }
    server?.closeAllConnections();
    server?.close();
    app.exit(1);
});

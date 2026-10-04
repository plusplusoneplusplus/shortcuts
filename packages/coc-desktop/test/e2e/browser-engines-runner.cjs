'use strict';
const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const dist = path.join(__dirname, '..', '..', 'dist');
const { registerBrowserViewIpc, disposeBrowserViews } = require(path.join(dist, 'browser-view-host.js'));
const { loadWebView2Binary } = require('@plusplusoneplusplus/coc-native');
const userData = process.env.COC_BROWSER_E2E_USER_DATA;
const engine = process.env.COC_BROWSER_E2E_ENGINE || 'electron';
const restart = process.argv.includes('--restart-check');
const afterClear = process.argv.includes('--after-clear');
app.setPath('userData', path.join(userData, 'shell'));
const externalCalls = [];
shell.openExternal = async url => { externalCalls.push(url); };
let confirmation = 0;
dialog.showMessageBox = async () => ({ response: confirmation });
const emit = (step, value) => console.log('E2E::' + JSON.stringify({ step, ...value }));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const commands = new Map();
const reports = new Map();
let helperProbe;
let server;
let base;

const script = `<script>
const key = new URL(location.href).searchParams.get('tab') || 'main';
async function report(extra = {}) {
    fetch('/report?tab='+encodeURIComponent(key), {method:'POST', body: JSON.stringify({
        cookie:document.cookie, storage:localStorage.getItem('fixture'), bridge:typeof window.cocDesktop,
        require:typeof require, title:document.title, focused:document.hasFocus(), ...extra
    })});
}
window.addEventListener('message',event=>report({popupMessage:event.data}));
window.addEventListener('focus',()=>report({focusEvent:true}));
report();
setInterval(async()=>{
    const action = await (await fetch('/command?tab='+encodeURIComponent(key))).text();
    if (action==='next') location.href='/second?tab='+key;
    if (action==='push') { history.pushState({},'', '/second?tab='+key+'&inpage=1'); report(); }
    if (action==='seed') { localStorage.setItem('fixture','stored'); document.cookie='fixture=remembered; Path=/; Max-Age=3600'; report(); }
    if (action==='newtab') window.open('/second?tab=child','_blank');
    if (action==='popup') window.open('/login?tab=popup','auth','popup,width=420,height=520');
    if (action==='download') location.href='/download';
    if (action==='permission') navigator.geolocation.getCurrentPosition(()=>report({permission:'allowed'}),()=>report({permission:'denied'}));
    if (action==='unsafe') location.href='file:///blocked.html';
    if (action==='report') report();
},80);
</script>`;
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
    if (url.pathname === '/redirect') { res.writeHead(302, { Location: '/second?tab=main' }); res.end(); return; }
    if (url.pathname === '/download') { res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="fixture.zip"' }); res.end('fixture'); return; }
    if (url.pathname === '/slow') { res.setHeader('Content-Type', 'text/html'); res.write('<html><head><title>Slow</title></head>'); return; }
    const title = url.pathname === '/second' ? 'Second' : url.pathname === '/login' ? 'Login' : 'Home';
    res.setHeader('Content-Type', 'text/html');
    res.end(`<html><head><title>${title}</title></head><body><input id="input"><a href="/second?tab=main">Next</a>${script}
        ${url.pathname === '/login' ? '<script>window.opener.postMessage("authenticated","*");</script>' : ''}</body></html>`);
}
async function waitFor(predicate, description, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { const value = await predicate(); if (value) return value; await delay(40); }
    throw new Error(`Timed out waiting for ${description}; reports=${JSON.stringify([...reports])}`);
}
function command(key, value) { commands.set(key, value); }

app.whenReady().then(async () => {
    const dataDir = path.join(userData, 'coc');
    registerBrowserViewIpc(dataDir);
    const portFile = path.join(userData, 'fixture-port');
    server = http.createServer(handle);
    const oldPort = fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, 'utf8')) : 0;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(oldPort, '127.0.0.1', resolve); });
    fs.writeFileSync(portFile, String(server.address().port));
    base = `http://127.0.0.1:${server.address().port}`;
    const windows = [];
    const makeWindow = async () => {
        const win = new BrowserWindow({ width: 900, height: 650, show: true, webPreferences: { preload: path.join(dist, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
        await win.loadURL('data:text/html,' + encodeURIComponent(`<body><script>
            window.states=[];window.newTabs=[];window.downloads=[];window.closedViews=[];
            const b=window.cocDesktop.browser;
            b.onState(s=>window.states.push(s));b.onNewTab(e=>window.newTabs.push(e));
            b.onDownload(e=>window.downloads.push(e));b.onClosed(e=>window.closedViews.push(e));
        </script></body>`));
        windows.push(win);
        return win;
    };
    const main = await makeWindow();
    const spa = js => main.webContents.executeJavaScript(js);
    const call = (win, method, ...args) => win.webContents.executeJavaScript(`window.cocDesktop.browser.${method}(${args.map(value => JSON.stringify(value)).join(',')})`);
    const state = (win, id) => win.webContents.executeJavaScript(`window.states.filter(s=>s.viewId===${JSON.stringify(id)}).slice(-1)[0]`);
    const settled = (win, id, predicate) => waitFor(async () => { const current = await state(win, id); return current && !current.loading && predicate(current) ? current : null; }, `${id} state`);
    const pref = await call(main, 'getPreferences');
    if (engine === 'webview2' && !pref.engines.find(e => e.engine === engine)?.available) throw new Error('Required real WebView2 capability is unavailable: ' + JSON.stringify(pref));
    await call(main, 'setDefaultEngine', engine);
    const opened = await call(main, 'open', 'main', base + '/?tab=main', 'workspace-a');
    if (!opened.ok) throw new Error('Browser startup failed: ' + JSON.stringify(opened));
    const home = await settled(main, 'main', s => s.title === 'Home');
    await call(main, 'setBounds', 'main', { x: 350, y: 70, width: 420, height: 320 });
    await waitFor(() => reports.get('main'), 'fixture page report');
    if (restart) {
        emit('restart', { engine: home.engine, history: home.canGoBack, report: reports.get('main'), preference: pref.defaultEngine });
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
        emit('history', { second, back, forward });
        command('main', 'seed');
        await waitFor(() => reports.get('main')?.storage === 'stored', 'site data seeded');
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
    await disposeBrowserViews();
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

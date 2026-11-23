'use strict';
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const { once } = require('node:events');
const path = require('node:path');
const { BrowserHostManager } = require('../../dist/browser-host-manager');
// The same flow runs on WebView2 (Windows) and WKWebView (macOS).
const engine = process.env.COC_APPROVAL_ENGINE || 'webview2';
const BrowserHost = engine === 'wkwebview'
    ? require('../../dist/wkwebview-browser-host').WkWebViewBrowserHost
    : require('../../dist/webview2-browser-host').WebView2BrowserHost;

app.setPath('userData', process.env.COC_APPROVAL_TEST_DATA);
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false });
    let postPreserved = false;
    const server = createServer((req, res) => {
        if (req.url.startsWith('/start')) {
            res.writeHead(302, { location: `http://localhost:${server.address().port}/login` });
            res.end();
        } else if (req.url === '/login') {
            res.setHeader('content-type', 'text/html');
            res.end(`<!doctype html><form method="post" action="http://127.0.0.1:${server.address().port}/return">
                <input name="assertion" value="synthetic-value"></form><script>setTimeout(() => document.forms[0].submit(), 500)</script>`);
        } else if (req.url === '/return') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                postPreserved = req.method === 'POST' && body === 'assertion=synthetic-value';
                res.writeHead(302, { location: postPreserved ? '/destination' : '/start' });
                res.end();
            });
        } else {
            res.setHeader('content-type', 'text/html');
            res.end('<!doctype html><title>Approved destination</title><p>Redirect completed</p>');
            if (req.url === '/destination') server.emit('destination');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const host = new BrowserHost(path.join(process.env.COC_APPROVAL_TEST_DATA, 'profile'));
    let manager;
    let checks = 0;
    let pendingDecisions = 0;
    let premature = false;
    let completed = false;
    manager = new BrowserHostManager({
        history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
        hosts: { [engine]: host, electron: host },
        fileHost: { create: async () => { throw new Error('No file previews'); }, dispose: async () => {} },
        getDefault: () => engine, saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {},
        changed: () => {},
        send: (_owner, _channel, event) => {
            if (!event.checkId) return;
            checks++;
            pendingDecisions++;
            setTimeout(() => {
                premature ||= completed;
                pendingDecisions--;
                manager.decideNavigation(window.webContents.id, event.checkId, true);
            }, 200);
        },
    });
    try {
        const owner = window.webContents.id;
        manager.bindControlScope(owner, 'workspace', 'workspace');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(new Error('Approval fixture timed out')), 15000);
        try {
            // Scripted navigation can start after open returns a settled sign-in page.
            // Observe the actual destination request rather than a load-settle interval.
            const destination = once(server, 'destination', { signal: controller.signal });
            // Attach rejection handling before open, which can itself fail or be cancelled.
            void destination.catch(() => {});
            const opened = await manager.executeControl(owner, {
                id: 'open', processId: 'conversation', workspaceId: 'workspace',
                framesEnabled: true,
                command: { action: 'open', url: `http://127.0.0.1:${server.address().port}/start?fixture=%7B%22sample%22%3A%22synthetic%22%7D` },
            }, controller.signal);
            if (pendingDecisions) throw new Error('Open returned while navigation approval was pending.');
            await destination;
            const result = await manager.executeControl(owner, {
                id: 'destination', processId: 'conversation', workspaceId: 'workspace',
                selectedTab: opened.tab, framesEnabled: true, command: { action: 'select', tab: opened.tab },
            }, controller.signal);
            completed = true;
            if (!checks || premature || !postPreserved || result.title !== 'Approved destination' || !result.url.endsWith('/destination')) {
                throw new Error(`Unexpected readiness result: ${JSON.stringify({ checks, premature, result })}`);
            }
            const firstTurnChecks = checks;
            manager.finishControl(owner, 'conversation');
            completed = false;
            const next = await manager.executeControl(owner, {
                id: 'next', processId: 'replacement', workspaceId: 'workspace',
                selectedTab: result.tab, framesEnabled: true,
                command: { action: 'open', url: `http://localhost:${server.address().port}/destination` },
            }, controller.signal);
            if (next.title !== 'Approved destination' || checks !== firstTurnChecks + 1) {
                throw new Error('Replacement turn inherited navigation approval.');
            }
            console.log('E2E::' + JSON.stringify({ checks: firstTurnChecks, premature, title: result.title,
                redirected: true, postPreserved, approvalRevoked: true }));
        } finally { clearTimeout(timeout); controller.abort(); }
    } finally {
        await manager.dispose();
        window.destroy();
        server.close();
    }
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

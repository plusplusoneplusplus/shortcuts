'use strict';
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const path = require('node:path');
const { BrowserHostManager } = require('../../dist/browser-host-manager');
const { WebView2BrowserHost } = require('../../dist/webview2-browser-host');

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
                <input name="assertion" value="synthetic-value"></form><script>document.forms[0].submit()</script>`);
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
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const host = new WebView2BrowserHost(path.join(process.env.COC_APPROVAL_TEST_DATA, 'profile'));
    let manager;
    let checks = 0;
    let premature = false;
    let completed = false;
    manager = new BrowserHostManager({
        history: { recordVisit: async () => true, updateTitle: async () => true, flush: async () => {}, clearEngine: async () => true },
        hosts: { webview2: host, electron: host },
        fileHost: { create: async () => { throw new Error('No file previews'); }, dispose: async () => {} },
        getDefault: () => 'webview2', saveDefault: () => {}, getPageZoom: () => 100, savePageZoom: () => {},
        changed: () => {},
        send: (_owner, _channel, event) => {
            if (!event.checkId) return;
            checks++;
            setTimeout(() => {
                premature ||= completed;
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
            const result = await manager.executeControl(owner, {
                id: 'open', processId: 'conversation', workspaceId: 'workspace',
                framesEnabled: true,
                command: { action: 'open', url: `http://127.0.0.1:${server.address().port}/start?fixture=%7B%22sample%22%3A%22synthetic%22%7D` },
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
        } finally { clearTimeout(timeout); }
    } finally {
        await manager.dispose();
        window.destroy();
        server.close();
    }
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

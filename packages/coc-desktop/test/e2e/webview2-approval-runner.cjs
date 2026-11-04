'use strict';
const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const path = require('node:path');
const { BrowserHostManager } = require('../../dist/browser-host-manager');
const { WebView2BrowserHost } = require('../../dist/webview2-browser-host');

app.setPath('userData', process.env.COC_APPROVAL_TEST_DATA);
app.whenReady().then(async () => {
    const window = new BrowserWindow({ show: false });
    const server = createServer((req, res) => {
        if (req.url === '/start') {
            res.writeHead(302, { location: `http://localhost:${server.address().port}/destination` });
            res.end();
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
                command: { action: 'open', url: `http://127.0.0.1:${server.address().port}/start` },
            }, controller.signal);
            completed = true;
            if (!checks || premature || result.title !== 'Approved destination' || !result.url.endsWith('/destination')) {
                throw new Error(`Unexpected readiness result: ${JSON.stringify({ checks, premature, result })}`);
            }
            console.log('E2E::' + JSON.stringify({ checks, premature, title: result.title, redirected: true }));
        } finally { clearTimeout(timeout); }
    } finally {
        await manager.dispose();
        window.destroy();
        server.close();
    }
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });

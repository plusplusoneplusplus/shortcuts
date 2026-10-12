'use strict';

// Isolated shared-page-engine fixture; the server/SPA relay is tested separately.
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { ElectronBrowserCdp } = require('../../dist/electron-browser-cdp.js');
const { BrowserControlPage } = require('../../dist/browser-control-page.js');
let win;
let cdp;

app.setPath('userData', process.env.COC_BROWSER_E2E_USER_DATA);
app.setPath('sessionData', path.join(process.env.COC_BROWSER_E2E_USER_DATA, 'session'));
const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    if (request.url === '/frame') {
        response.end(`<label>Frame text <input></label><button onclick="parent.frameClicked=true">Frame action</button>`);
        return;
    }
    response.end(`<!doctype html><title>Control fixture</title>
        <style>body { margin:20px; } iframe { width:500px; height:100px; }</style>
        <label>Name <input id="name" value="replace me"></label><button id="save" onclick="document.querySelector('#out').textContent=document.querySelector('#name').value">Save</button>
        <label>Plan <select id="plan"><option value="a">A</option><option disabled value="skip">Skip</option><option value="b">B</option><option value="c">C</option></select></label>
        <label>Choices <select id="choices" multiple><option value="a" selected>A</option><option value="b">B</option><option value="c">C</option></select></label>
        <output id="out"></output><iframe src="/frame"></iframe><div id="shadow"></div>
        <script>
            window.events=[];
            for(const event of ['input','change','click']) document.addEventListener(event,e=>events.push({type:event,trusted:e.isTrusted}));
            const shadow=document.querySelector('#shadow').attachShadow({mode:'open'});
            shadow.innerHTML='<button>Shadow action</button>';
            shadow.querySelector('button').addEventListener('click',e=>{window.shadowClicked=e.isTrusted});
        </script>`);
});

(async () => {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await app.whenReady();
    win = new BrowserWindow({ width: 900, height: 700, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    const url = `http://127.0.0.1:${server.address().port}/`;
    await win.loadURL(url);
    cdp = new ElectronBrowserCdp(win.webContents);
    const page = new BrowserControlPage(cdp.send.bind(cdp));
    const before = await page.snapshot();
    const ref = name => {
        const entry = before.elements.find(element => element.name === name);
        if (!entry) throw new Error('Missing fixture element: ' + name + '\n' + JSON.stringify(before));
        return entry.ref;
    };
    await page.type(ref('Name'), 'Ada');
    await page.click(ref('Save'));
    await page.selectOption(ref('Plan'), 'c');
    await page.selectOption(ref('Choices'), 'b');
    await page.type(ref('Frame text'), 'Nested');
    await page.click(ref('Frame action'));
    await page.click(ref('Shadow action'));
    await page.wait('Ada');
    await page.wait('Shadow action');
    const report = await cdp.send('Runtime.evaluate', {
        expression: `({value:document.querySelector('#out').textContent,plan:document.querySelector('#plan').value,choices:Array.from(document.querySelector('#choices').selectedOptions,o=>o.value),frameText:document.querySelector('iframe').contentDocument.querySelector('input').value,frameClicked:window.frameClicked,shadowClicked:window.shadowClicked,events:window.events})`,
        returnByValue: true,
    });
    const repeated = await page.snapshot();
    await win.loadURL(url + '?navigated');
    const after = await page.snapshot();
    let stale;
    try { await page.click(ref('Save')); } catch (error) { stale = error.message; }
    console.log('E2E::' + JSON.stringify({ report: report.result.value, stable: repeated.elements.map(e => e.ref).join() === before.elements.map(e => e.ref).join(), reused: after.elements.some(e => before.elements.some(old => old.ref === e.ref)), stale }));
    cdp.dispose();
    win.destroy();
    await new Promise(resolve => server.close(resolve));
    app.exit(0);
})().catch(error => {
    console.error(error);
    cdp?.dispose();
    if (win && !win.isDestroyed()) win.destroy();
    server.closeAllConnections();
    server.close();
    app.exit(1);
});

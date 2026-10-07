'use strict';
const assert = require('node:assert/strict');
const { BrowserWindow, webContents } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function checkWebviewSecurity(main, base) {
    const renderer = source => main.webContents.executeJavaScript(source);
    let attachments = 0;
    const attached = () => attachments++;
    main.webContents.on('did-attach-webview', attached);
    const authorization = await renderer(`window.cocDesktop.browser.open('security-pending', ${JSON.stringify(base + '/second')}, 'workspace-security')`);
    assert.equal(authorization.embed, 'webview');
    const add = async (source, partition = authorization.partition, extra = '') => {
        await renderer(`{
            const node=document.createElement('webview');
            node.className='security-probe';
            node.style.cssText='width:200px;height:100px;position:absolute;top:400px';
            node.setAttribute('partition',${JSON.stringify(partition)});
            node.setAttribute('src',${JSON.stringify(source)});
            ${extra}
            document.body.append(node);
        }`);
        await sleep(150);
    };
    await add('file:///blocked.html');
    await add('data:text/html,blocked');
    await add(base + '/second?wrong-source=1');
    await add(base + '/second', 'unknown-token');
    assert.equal(attachments, 0, 'unauthorized guests must not attach');
    const preload = pathToFileURL(path.join(__dirname, '../../dist/preload.js')).href;
    await add(authorization.src, authorization.partition, `
        node.id='security-guest';
        node.setAttribute('preload',${JSON.stringify(preload)});
        node.setAttribute('nodeintegration','');
        node.setAttribute('disablewebsecurity','');
        node.setAttribute('webpreferences','sandbox=no,contextIsolation=no,webviewTag=yes,nodeIntegrationInWorker=yes,nodeIntegrationInSubFrames=yes,allowRunningInsecureContent=yes');
    `);
    for (let i = 0; i < 100 && attachments !== 1; i++) await sleep(25);
    assert.equal(attachments, 1);
    const guestId = await renderer(`document.getElementById('security-guest').getWebContentsId()`);
    const guest = webContents.fromId(guestId);
    for (let i = 0; i < 100 && guest.isLoading(); i++) await sleep(25);
    const isolated = await guest.executeJavaScript(`({
        bridge:typeof window.cocDesktop, require:typeof require, process:typeof process,
    })`);
    assert.deepEqual(isolated, { bridge: 'undefined', require: 'undefined', process: 'undefined' });
    assert.equal(guest.getLastWebPreferences().webviewTag, false);
    assert.equal(guest.getLastWebPreferences().webSecurity, true);
    assert.equal(guest.getLastWebPreferences().sandbox, true);
    // Policy is wired before adoption, including during first-page script execution.
    const initial = guest.getURL();
    await guest.executeJavaScript(`location.href='data:text/html,blocked'; 1`);
    await sleep(100);
    assert.equal(guest.getURL(), initial);
    await guest.executeJavaScript(`document.body.innerHTML += '<webview src="${base}/"></webview>'; 1`);
    await renderer(`{
        const frame=document.createElement('iframe'); frame.className='security-probe';
        frame.srcdoc=${JSON.stringify(`<webview partition="${authorization.partition}" src="${authorization.src}"></webview>`)};
        document.body.append(frame);
    }`);
    await sleep(150);
    assert.equal(attachments, 1, 'subframe or nested webviews must not attach');
    assert.equal((await renderer(`window.cocDesktop.browser.adopt('b1', ${guestId})`)).ok, false);
    assert.equal((await renderer(`window.cocDesktop.browser.adopt('security-pending', ${guestId})`)).ok, true);
    await add(authorization.src);
    assert.equal(attachments, 1, 'a consumed authorization cannot attach a second guest');
    const untrusted = new BrowserWindow({ show: false, webPreferences: { sandbox: true, webviewTag: true } });
    let untrustedAttachments = 0;
    untrusted.webContents.on('did-attach-webview', () => untrustedAttachments++);
    await untrusted.loadURL('data:text/html,' + encodeURIComponent(`<webview partition="${authorization.partition}" src="${authorization.src}"></webview>`));
    await sleep(150);
    assert.equal(untrustedAttachments, 0);
    untrusted.destroy();
    await renderer(`window.cocDesktop.browser.close('security-pending'); document.querySelectorAll('.security-probe').forEach(node=>node.remove());`);
    main.webContents.removeListener('did-attach-webview', attached);
    return { rejectedUnsafe: true, hardenedGuest: isolated, protectedBeforeAdopt: true, rejectedNestedAndSubframe: true, rejectedUntrusted: true, rejectedReplay: true };
}

async function checkDomCompositing(main, guest) {
    const renderer = source => main.webContents.executeJavaScript(source);
    await guest.executeJavaScript(`document.documentElement.style.background='rgb(0,0,255)';
        window.__liveTicks=0;window.__tickTimer=setInterval(()=>window.__liveTicks++,20);`);
    await renderer(`{
        const menu=document.createElement('button'); menu.id='overlay-menu';
        menu.style.cssText='position:absolute;left:420px;top:70px;width:120px;height:120px;background:rgb(255,0,0);border:0;z-index:10000';
        menu.onclick=()=>window.__menuClicked=true;document.body.append(menu);
    }`);
    await sleep(200);
    const firstTicks = await guest.executeJavaScript('window.__liveTicks');
    const image = await main.webContents.capturePage();
    const menuPixel = [...image.crop({ x: 460, y: 100, width: 1, height: 1 }).toBitmap()];
    const pagePixel = [...image.crop({ x: 650, y: 200, width: 1, height: 1 }).toBitmap()];
    assert.deepEqual(menuPixel, [0, 0, 255, 255]);
    assert.deepEqual(pagePixel, [255, 0, 0, 255]);
    main.webContents.sendInputEvent({ type: 'mouseDown', x: 460, y: 100, button: 'left', clickCount: 1 });
    main.webContents.sendInputEvent({ type: 'mouseUp', x: 460, y: 100, button: 'left', clickCount: 1 });
    await sleep(100);
    assert.equal(await renderer('window.__menuClicked'), true);
    const ticks = await guest.executeJavaScript('window.__liveTicks');
    assert(ticks > firstTicks);
    await renderer(`document.getElementById('overlay-menu').remove()`);
    await guest.executeJavaScript('clearInterval(window.__tickTimer);document.documentElement.style.background=""');
    return { menuPixel, pagePixel, clicked: true, pageStayedLive: true };
}

module.exports = { checkWebviewSecurity, checkDomCompositing };

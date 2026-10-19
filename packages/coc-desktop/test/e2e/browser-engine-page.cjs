'use strict';

/** Browser page used by the live desktop engine contracts. */
module.exports = { browserPageScript: `
const key = new URL(location.href).searchParams.get('tab') || 'main';
async function report(extra = {}) {
    fetch('/report?tab='+encodeURIComponent(key), {method:'POST', body: JSON.stringify({
        authenticated:window.cookieAuthenticated === true, cookie:document.cookie, storage:localStorage.getItem('fixture'), bridge:typeof window.cocDesktop,
        require:typeof require, title:document.title, focused:document.hasFocus(),
        pixelRatio:window.devicePixelRatio,
        viewportWidth:window.innerWidth,
        input:document.getElementById('input').value,
        inputFocused:document.activeElement === document.getElementById('input'), ...extra
    })});
}
window.addEventListener('message',event=>report({popupMessage:event.data}));
window.addEventListener('focus',()=>report({focusEvent:true}));
document.addEventListener('input',()=>report());
report();
setInterval(async()=>{
    const action = await (await fetch('/command?tab='+encodeURIComponent(key))).text();
    if (action==='next') location.href='/second?tab='+key;
    if (action==='push') { history.pushState({},'', '/second?tab='+key+'&inpage=1'); report(); }
    if (action==='title') { document.title='Updated page'; report(); }
    if (action==='seed') { localStorage.setItem('fixture','stored'); document.cookie='fixture=remembered; Path=/; Max-Age=3600'; report(); }
    if (action==='newtab') window.open('/second?tab=child','_blank');
    if (action==='popup') window.open('/login?tab=popup','auth','popup,width=420,height=520');
    if (action==='download') location.href='/download';
    if (action==='clickonce-navigation') location.href='https://fixture.test/App.application?value=a%2Fb+z&value=two&empty=';
    if (action==='clickonce-window') window.open('https://fixture.test/App.application?value=a%2Fb+z&value=two&empty=','_blank');
    if (action==='clickonce-popup') window.open('https://fixture.test/App.application?value=a%2Fb+z&value=two&empty=','deployment','popup,width=420,height=520');
    if (action==='clickonce-redirect') location.href='/application-redirect';
    if (action==='permission') navigator.geolocation.getCurrentPosition(()=>report({permission:'allowed'}),()=>report({permission:'denied'}));
    if (action==='unsafe') location.href='file:///blocked.html';
    if (action==='report') report();
    if (action==='focus-input') { document.getElementById('input').focus(); report(); }
},80);
` };

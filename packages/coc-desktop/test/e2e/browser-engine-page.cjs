'use strict';

/** Browser page used by the live desktop engine contracts. */
module.exports = { browserPageScript: `
const key = new URL(location.href).searchParams.get('tab') || 'main';
async function report(extra = {}) {
    fetch('/report?tab='+encodeURIComponent(key), {method:'POST', body: JSON.stringify({
        cookie:document.cookie, storage:localStorage.getItem('fixture'), bridge:typeof window.cocDesktop,
        require:typeof require, title:document.title, focused:document.hasFocus(),
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
    if (action==='seed') { localStorage.setItem('fixture','stored'); document.cookie='fixture=remembered; Path=/; Max-Age=3600'; report(); }
    if (action==='newtab') window.open('/second?tab=child','_blank');
    if (action==='popup') window.open('/login?tab=popup','auth','popup,width=420,height=520');
    if (action==='download') location.href='/download';
    if (action==='permission') navigator.geolocation.getCurrentPosition(()=>report({permission:'allowed'}),()=>report({permission:'denied'}));
    if (action==='unsafe') location.href='file:///blocked.html';
    if (action==='report') report();
    if (action==='focus-input') { document.getElementById('input').focus(); report(); }
},80);
` };

// Runs before Next/React. An old tab can request a JS chunk removed by a deployment; React's error
// boundary may not have loaded yet. Retry the document once, retaining the client's page/hash.
export const startupRecovery = `(function(){
  var key='one-core.chunk-retry', attempted=false;
  function fallback(){
    if(document.getElementById('one-startup-error'))return;
    var box=document.createElement('section');box.id='one-startup-error';box.setAttribute('role','alert');
    box.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:28px;background:#f4f5f7;color:#17191e;font:16px Arial,sans-serif;text-align:center';
    var title=document.createElement('h1');title.textContent='Votre espace n’a pas pu se charger.';title.style.fontSize='24px';box.appendChild(title);
    var text=document.createElement('p');text.textContent='Réessayez de charger la page. Vos données sont conservées.';box.appendChild(text);
    var link=document.createElement('a'),url=new URL(location.href);url.searchParams.set('_app_retry',String(Date.now()));link.href=url.href;link.textContent='Réessayer';link.style.cssText='padding:14px 22px;background:#d4af37;color:#17191e;border-radius:10px;text-decoration:none';box.appendChild(link);
    (document.body||document.documentElement).appendChild(box);
  }
  function recover(){
    if(attempted)return;attempted=true;
    var url=new URL(location.href),recent=url.searchParams.has('_app_retry');
    try{var last=Number(sessionStorage.getItem(key));recent=recent||(last>0&&Date.now()-last<60000)}catch(e){}
    if(recent||navigator.onLine===false){fallback();return}
    try{sessionStorage.setItem(key,String(Date.now()))}catch(e){}
    url.searchParams.set('_app_retry',String(Date.now()));location.replace(url.href);
  }
  function chunk(message){return /ChunkLoadError|Loading chunk .* failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message||'')}
  window.addEventListener('error',function(e){
    var target=e.target,src=target&&target.tagName==='SCRIPT'&&target.src;
    if(src){try{var url=new URL(src,location.href);if(url.origin===location.origin&&url.pathname.indexOf('/_next/static/')===0){recover();return}}catch(ignore){}}
    if(chunk(e.message||(e.error&&e.error.message)))recover();
  },true);
  window.addEventListener('unhandledrejection',function(e){if(chunk(e.reason&&(e.reason.message||String(e.reason))))recover()});
})()`;

// Runs before Next/React. An old tab can request a JS chunk removed by a deployment; React's error
// boundary may not have loaded yet. Retry the document once, retaining the client's page/hash. The fallback
// speaks the person's language (the one the app saved, else the page's), since the catalogs aren't loaded yet.
export const startupRecovery = `(function(){
  var key='one-core.chunk-retry', attempted=false;
  var words={fr:['Votre espace n’a pas pu se charger.','Réessayez de charger la page. Vos données sont conservées.','Réessayer'],en:['Your space could not load.','Try loading the page again. Your data is safe.','Try again'],ar:['تعذّر تحميل مساحتكم.','أعيدوا تحميل الصفحة. بياناتكم محفوظة.','إعادة المحاولة']};
  function language(){
    try{var saved=localStorage.getItem('the-one.locale');if(words[saved])return saved}catch(e){}
    try{var page=(document.documentElement.lang||'').slice(0,2);if(words[page])return page}catch(e){}
    return 'fr';
  }
  function fallback(){
    if(document.getElementById('one-startup-error'))return;
    var lang=language(),w=words[lang];
    var box=document.createElement('section');box.id='one-startup-error';box.setAttribute('role','alert');box.setAttribute('lang',lang);box.setAttribute('dir',lang==='ar'?'rtl':'ltr');
    box.style.cssText='position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:28px;background:#f4f5f7;color:#17191e;font:16px system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;text-align:center';
    var title=document.createElement('h1');title.textContent=w[0];title.style.fontSize='24px';box.appendChild(title);
    var text=document.createElement('p');text.textContent=w[1];box.appendChild(text);
    var link=document.createElement('a'),url=new URL(location.href);url.searchParams.set('_app_retry',String(Date.now()));link.href=url.href;link.textContent=w[2];link.style.cssText='padding:14px 22px;background:#d4af37;color:#17191e;border-radius:10px;text-decoration:none';box.appendChild(link);
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

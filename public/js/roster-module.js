(()=>{
 const button=document.querySelector('[data-view="roster"]');
 const frame=document.getElementById('roster-frame');
 let actor=null,accessSignature='';
 function allowed(){return currentUser?.role==='ADMIN'||currentUser?.permissions?.['roster.view']===true;}
 function clear(){frame.removeAttribute('src');actor=null;}
 function apply(){
  const signature=JSON.stringify([currentUser?.id,currentUser?.role,currentUser?.permissions?.['roster.view'],currentUser?.permissions?.['roster.manage']]);
  if(signature!==accessSignature){clear();accessSignature=signature;}
  if(button)button.style.display=allowed()?'':'none';if(!allowed())clear();
  else if(document.getElementById('roster')?.classList.contains('active'))window.prepareRoster?.();
 }
 window.prepareRoster=()=>{
  if(!allowed()||!token)return;
  if(actor!==currentUser.id||!frame.getAttribute('src')){actor=currentUser.id;frame.src='/escalas-5x2/index.html';}
 };
 document.getElementById('roster-reload').onclick=()=>{clear();window.prepareRoster();};
 window.addEventListener('controle:session-refreshed',apply);
 window.addEventListener('controle:app-ready',apply);
 new MutationObserver(()=>{if(document.getElementById('app').hidden)clear();}).observe(document.getElementById('app'),{attributes:true,attributeFilter:['hidden']});
 apply();
})();

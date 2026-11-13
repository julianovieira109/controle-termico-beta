(()=>{
 const button=document.querySelector('[data-view="roster"]');
 const host=document.getElementById('roster-host');
 let actor=null,accessSignature='',dispose=null,loading=false,generation=0,controller=null;
 function allowed(){return currentUser?.role==='ADMIN'||currentUser?.permissions?.['roster.view']===true;}
 function theme(){host.dataset.theme=document.body.classList.contains('theme-dark')?'dark':'light';}
 function clear(){generation++;controller?.abort();controller=null;dispose?.();dispose=null;actor=null;loading=false;host.replaceChildren();}
 function apply(){
  const signature=JSON.stringify([currentUser?.id,currentUser?.role,currentUser?.permissions,currentUser?.companyId,currentUser?.branchIds]);
  if(signature!==accessSignature){clear();accessSignature=signature;}
  if(button)button.style.display=allowed()?'':'none';
  if(!allowed())clear();else if(document.getElementById('roster')?.classList.contains('active'))window.prepareRoster();
 }
 window.prepareRoster=async()=>{
  if(!allowed()||!token||loading||actor===currentUser.id)return;
  loading=true;const attempt=++generation;controller=new AbortController();const signal=controller.signal;
  host.innerHTML='<div class="panel" role="status">Carregando planejamento de escalas…</div>';
  try{
   const response=await fetch('/escalas-5x2/manifest.json',{cache:'no-store',signal});
   if(!response.ok)throw Error('Não foi possível carregar o planejamento.');
   const manifest=await response.json();
   if(![manifest.entry,manifest.css].every(path=>typeof path==='string'&&/^\/escalas-5x2\/assets\/[a-zA-Z0-9_.-]+\.(js|css)$/.test(path)))throw Error('Arquivos do planejamento indisponíveis.');
   const module=await import(manifest.entry);
   if(attempt!==generation||!allowed()||signal.aborted)return;
   theme();host.replaceChildren();const cleanup=await module.mountRoster(host,manifest.css,signal);
   if(attempt!==generation||signal.aborted){cleanup();return;}
   dispose=cleanup;actor=currentUser.id;
  }catch(error){
   if(attempt!==generation||signal.aborted)return;
   host.replaceChildren();const panel=document.createElement('div');panel.className='panel';panel.setAttribute('role','alert');
   const message=document.createElement('p');message.textContent=error.message||'Falha ao carregar o planejamento.';
   const retry=document.createElement('button');retry.className='secondary';retry.textContent='Tentar novamente';retry.onclick=()=>window.prepareRoster();panel.append(message,retry);host.append(panel);
  }finally{if(attempt===generation)loading=false;}
 };
 window.addEventListener('escala:open-employees',()=>{if(allowed()&&token)navigate('employees');});
 window.addEventListener('controle:session-refreshed',apply);
 window.addEventListener('controle:app-ready',apply);
 new MutationObserver(()=>{if(document.getElementById('app').hidden)clear();}).observe(document.getElementById('app'),{attributes:true,attributeFilter:['hidden']});
 new MutationObserver(theme).observe(document.body,{attributes:true,attributeFilter:['class']});
 apply();
})();

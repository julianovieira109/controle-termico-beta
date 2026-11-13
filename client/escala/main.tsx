import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import Home from './Home';
import {apiFetch,readResponse,setUnitContext} from './bridge';
import './style.css';
import './integration.css';
type Unit={id:string;name?:string;trade_name?:string;company_id?:string};
type Options={companies:Unit[];branches:Unit[];canEdit:boolean};
function App(){
 const [options,setOptions]=useState<Options|null>(null),[company,setCompany]=useState(''),[branch,setBranch]=useState(''),[loaded,setLoaded]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false),[preview,setPreview]=useState<any>(null),[unitConfirmed,setUnitConfirmed]=useState(false),[partial,setPartial]=useState(false),[pending,setPending]=useState<any[]>([]),[hasMigrationPending,setHasMigrationPending]=useState(false);
 useEffect(()=>{fetch('/api/escalas-5x2/options',{headers:{Authorization:`Bearer ${sessionStorage.getItem('token')||''}`},cache:'no-store'}).then(readResponse<Options>).then(setOptions).catch(e=>setError(e.message));},[]);
 useEffect(()=>{
  if(!preview)return;const before=document.activeElement as HTMLElement|null;const panel=document.querySelector<HTMLElement>('.beta-preview');panel?.focus();
  const keys=(event:KeyboardEvent)=>{
   if(event.key==='Escape'&&!saving)setPreview(null);
   if(event.key==='Tab'&&panel){const nodes=Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]'));const first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  };
  document.addEventListener('keydown',keys);return()=>{document.removeEventListener('keydown',keys);before?.focus();};
 },[preview,saving]);
 useEffect(()=>{
  async function receive(event:Event){const file=(event as CustomEvent<File>).detail;if(!loaded||!options?.canEdit)return;
   setError('');setPreview(null);setUnitConfirmed(false);setPartial(false);
   if(file.size>3000000){setError('O backup deve ter até 3 MB.');return;}
   setSaving(true);
   try{const backup=JSON.parse(await file.text());const result=await readResponse(await apiFetch('/import-preview',{method:'POST',body:JSON.stringify({backup})}));setPreview(result);}
   catch(e){setError((e as Error).message);}finally{setSaving(false);}
  }
  window.addEventListener('escala:migrate-file',receive);return()=>window.removeEventListener('escala:migrate-file',receive);
 },[loaded,options]);
 async function load(){
  if(!options||!company||!branch)return;setError('');setPreview(null);setSaving(true);
  const c=options.companies.find(row=>row.id===company)!,b=options.branches.find(row=>row.id===branch)!;
  setUnitContext({companyId:company,branchId:branch,companyName:c.trade_name||c.name||'',branchName:b.name||'',canEdit:options.canEdit,officialVersion:'',onSaving:setSaving});
  try{const result=await readResponse(await apiFetch('/state'));setPending(result.pending||[]);setHasMigrationPending(Boolean(result.hasMigrationPending));setLoaded(`${company}/${branch}/${Date.now()}`);}
  catch(e){setLoaded('');setError((e as Error).message);}finally{setSaving(false);}
 }
 useEffect(()=>{
  const reload=()=>{if(loaded&&!saving)void load();};window.addEventListener('escala:reload-unit',reload);return()=>window.removeEventListener('escala:reload-unit',reload);
 },[loaded,saving,company,branch,options]);
 async function reviewPending(){
  if(saving)return;setError('');setSaving(true);setUnitConfirmed(false);setPartial(false);
  try{setPreview(await readResponse(await apiFetch('/pending-preview',{method:'POST',body:'{}'})));}
  catch(e){setError((e as Error).message);}finally{setSaving(false);}
 }
 async function commit(){
  if(!preview||!unitConfirmed||saving)return;setSaving(true);setError('');
  try{await readResponse(await apiFetch('/import-confirm',{method:'POST',body:JSON.stringify({previewId:preview.previewId,unitConfirmed:true,allowPartial:partial})}));setPreview(null);await load();}
  catch(e){setError((e as Error).message);}finally{setSaving(false);}
 }
 return <div className={`beta-roster ${options&&!options.canEdit?'beta-readonly':''}`}>
  <section className="beta-unit"><div><strong>Escala 5x2 · Planejamento</strong><p>Escalas e horários Senior preservados. Jornadas e folgas da 5x2 são somente planejamento e não alteram os relatórios oficiais, ponto, BH ou intervalos Senior.</p></div>
   <label>Empresa<select aria-label="Empresa da escala" value={company} disabled={saving} onChange={e=>{setCompany(e.target.value);setBranch('');setLoaded('');setPreview(null);}}><option value="">Selecione a empresa</option>{options?.companies.map(row=><option key={row.id} value={row.id}>{row.trade_name||row.name}</option>)}</select></label>
   <label>Filial<select aria-label="Filial da escala" value={branch} disabled={saving||!company} onChange={e=>{setBranch(e.target.value);setLoaded('');setPreview(null);}}><option value="">Selecione a filial</option>{options?.branches.filter(row=>row.company_id===company).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
   <button disabled={saving||!company||!branch} onClick={load}>{saving?'Aguarde…':'Carregar unidade'}</button>
   {options&&!options.canEdit&&<strong>Somente consulta — seu perfil não permite editar escalas.</strong>}
  </section>
  {error&&<div className="error" role="alert">{error} <a href="/" target="_top">Voltar ao sistema Beta</a></div>}
  {!options&&!error&&<p className="beta-initial">Carregando acessos do usuário…</p>}
  {loaded&&<>
   {pending.length>0&&<details className="beta-pending"><summary>{pending.length} pendência(s) de vínculo ou migração</summary><p>Os dados de origem ficam preservados para conferência. Nenhuma pessoa não localizada é cadastrada automaticamente. Regularize o cadastro no Beta e confira novamente as pendências de migração.</p><ul>{pending.map((item,index)=><li key={index}>{item.name||item.sourceName||item.id}: {item.reason||item.status}</li>)}</ul>{hasMigrationPending&&options?.canEdit&&<button disabled={saving} onClick={reviewPending}>Conferir pendências novamente</button>}</details>}
   <Home key={loaded}/>
  </>}
  {preview&&<div className="beta-preview-backdrop"><section className="beta-preview" role="dialog" aria-modal="true" aria-label="Conferir migração do backup" tabIndex={-1}>
   <h2>Conferir migração do planejamento</h2><p><strong>{preview.companyName} / {preview.branchName}</strong></p><p>{preview.summary.total} colaborador(es) no arquivo · {preview.summary.matched} correspondência(s) · {preview.summary.pending} pendência(s).</p>
   <p>Aplicar somente jornadas, folgas, exceções e revisões do planejamento. Nome, cargo, situação, datas de vínculo e horários oficiais vêm do Beta e permanecem preservados. Os registros sem correspondência ficam guardados como pendências.</p>
   <div className="beta-preview-table"><table><thead><tr><th>Matrícula</th><th>Nome no arquivo</th><th>Nome no Beta</th><th>Resultado</th></tr></thead><tbody>{preview.rows.map((row:any,index:number)=><tr key={index}><td>{row.sourceId}</td><td>{row.sourceName}</td><td>{row.targetName||'—'}</td><td>{row.reason||row.status}</td></tr>)}</tbody></table></div>
   <label><input type="checkbox" checked={unitConfirmed} onChange={e=>setUnitConfirmed(e.target.checked)}/> Conferi a empresa/filial e os vínculos deste arquivo.</label>
   {preview.summary.pending>0&&<label><input type="checkbox" checked={partial} onChange={e=>setPartial(e.target.checked)}/> Aplicar as correspondências e preservar os demais registros como pendências para conferência.</label>}
   <div><button disabled={saving} onClick={()=>setPreview(null)}>Cancelar</button><button className="primary" disabled={saving||!unitConfirmed||!preview.summary.matched||preview.summary.pending>0&&!partial} onClick={commit}>Confirmar migração do planejamento</button></div>
  </section></div>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

import {useMemo,useRef,useState} from 'react';
import {compareSchedules,comparisonCsv,comparisonHours} from '../lib/schedule-comparison';
import {simpleRoster,simpleRosterAlerts} from '../lib/simple-roster';
import {duration,journeyText,selectedJourney,isJourney} from '../lib/journeys';
import {businessToday,moveDay,validDay} from '../lib/business-date';
import {days,restRule,status,withWeeklyFolgas,type State} from '../lib/roster';
import {readOnly} from '../bridge';
type Simulation=ReturnType<typeof simpleRoster>&{source:State;hours:40|42|44;date:string};
export default function PlanningGuide({state,busy,save,onApplied}:{state:State;busy:boolean;save:(state:State,action:string)=>Promise<boolean>;onApplied?:(date:string)=>void}){
 const [hours,setHours]=useState<40|42|44>(40),[date,setDate]=useState(businessToday);
 const [draft,setDraft]=useState<Simulation|null>(null),[saving,setSaving]=useState(false),[generating,setGenerating]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[query,setQuery]=useState('');
 const [edit,setEdit]=useState<{id:string;off1:string;off2:string;start:string}|null>(null);
 const lock=useRef(false);
 const preview=draft&&draft.source===state&&draft.hours===hours&&draft.date===date?draft:null;
 const week=useMemo(()=>validDay(date)?Array.from({length:7},(_,i)=>moveDay(date,i)):[],[date]);
 const alerts=useMemo(()=>preview?simpleRosterAlerts(preview.state,preview.ids,date):[],[preview,date]);
 const rows=preview?.state.employees.filter(e=>preview.ids.includes(e.id)&&`${e.name} ${e.id} ${e.officialShift||e.shift} ${e.coordinatorName||''}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')))||[];
 const comparison=useMemo(()=>validDay(date)?compareSchedules(state.employees,date):[],[state,date]);
 function reset(){setEdit(null);setMessage('');setError('');}
 async function generate(){if(generating||busy||saving)return;reset();setGenerating(true);setDraft(null);await new Promise(resolve=>setTimeout(resolve,0));try{setDraft({...simpleRoster(state,hours,date),source:state,hours,date});}catch(e){setError((e as Error).message);}finally{setGenerating(false);}}
 async function saveDraft(openSchedule=false){if(!preview?.count||busy||saving||lock.current||readOnly())return;lock.current=true;setSaving(true);setError('');try{
  if(await save(preview.state,`Simulador simples 5x2: ${hours}h, vigência ${date}; ${preview.count} colaboradores; ${alerts.length} alertas para revisão. Somente rascunho no planejamento. ${alerts.join(' | ').slice(0,3000)}`)){setDraft(null);setEdit(null);setMessage('Rascunho salvo no planejamento 5x2.');if(openSchedule)onApplied?.(preview.date);}else setError('Não foi possível salvar. Confira o aviso e atualize a unidade se necessário.');
 }catch(e){setError((e as Error).message);}finally{lock.current=false;setSaving(false);}}
 function adjust(event:React.FormEvent){event.preventDefault();if(!edit||!preview)return;try{
  const employees=preview.state.employees.map(employee=>{if(employee.id!==edit.id)return employee;const journey=selectedJourney(employee,date);if(!journey)throw Error('Confira a jornada desta pessoa.');const changed={...journey,start:edit.start,effectiveDate:date};if(!isJourney(changed))throw Error('Informe uma entrada válida.');return withWeeklyFolgas({...employee,journeys:[...(employee.journeys||[]).filter(j=>j.effectiveDate!==date),changed]},edit.off1,edit.off2,date,true);});
  setDraft({...preview,state:{...preview.state,employees}});setEdit(null);setError('');
 }catch(e){setError((e as Error).message);}}
 function download(all=false){if(!preview&&!all)return;const csv=all?comparisonCsv(comparison,date):'\uFEFF'+[
  ['Status','Matrícula','Colaborador','Turno','Líder / coordenador','Carga semanal',...week,'Alertas'],
  ...rows.map(employee=>['RASCUNHO 5x2',employee.id,employee.name,employee.officialShift||employee.shift,employee.coordinatorName||'Sem vínculo informado',hours+'h',...week.map(day=>{const mark=status(employee,new Date(day+'T12:00:00'),preview!.state),journey=selectedJourney(employee,day);return mark==='T'?journey?journeyText(journey):'Horário pendente':mark==='F'?'Folga':mark==='A'?'Ausência':'Revisar';}),alerts.join(' | ')])
 ].map(row=>row.map(value=>{let text=String(value??'');if(/^[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}).join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`Sugestao_5x2_${all?'comparacao':hours+'h'}_${date}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="planning-guide simple-roster" aria-label="Simulador simples 5x2">
  <h2>Simular escala 5x2</h2><p>Escolha a jornada e gere uma sugestão para toda a equipe da unidade.</p>
  <div className="simple-roster-controls"><fieldset><legend>Jornada semanal</legend><div className="simple-roster-hours">{comparisonHours.map(value=><button key={value} type="button" aria-pressed={hours===value} disabled={busy||saving||generating} onClick={()=>{setHours(value);reset();}}><strong>{value}h</strong><small>5 dias de {duration(value*12)}</small></button>)}</div></fieldset>
   <label>A partir de<input aria-label="Início da sugestão" type="date" disabled={busy||saving||generating} value={date} onChange={e=>{setDate(e.target.value);reset();}}/></label>
   <button type="button" className="primary" disabled={busy||saving||generating||!validDay(date)} onClick={generate}>{generating?'Gerando…':'Gerar sugestão'}</button>
  </div>
  <p className="simple-roster-note">Somente planejamento 5x2. Ponto e controle térmico permanecem preservados.</p>
  {!validDay(date)&&<p role="alert">Informe uma data válida.</p>}
  {error&&<p role="alert" className="error">{error}</p>}{message&&<p role="status" className="importSuccess">{message}</p>}
  {preview&&<>
   <div className="simple-roster-result"><strong>{preview.count} colaboradores · {hours}h por semana</strong><span>{preview.excluded.length} para revisão individual · {alerts.length} {alerts.length===1?'aviso':'avisos'}</span></div>
   <p>Entrada e intervalo atuais mantidos. As folgas já planejadas são preservadas; o gerador sugere as que faltam. Você pode ajustar antes de salvar. Para gravar e abrir o calendário, use <strong>Lançar em Escalas e folgas</strong>; a regra vale a partir da data escolhida, nas visões de semana e mês.</p>
   <details className="simple-roster-details"><summary>Revisões e filtros</summary><label>Buscar na sugestão<input aria-label="Buscar na sugestão" placeholder="Nome, turno ou líder" value={query} onChange={e=>setQuery(e.target.value)}/></label>{preview.excluded.map(person=><p key={person.id}>{person.name}: {person.reason}</p>)}{alerts.map((alert,i)=><p key={i}>{alert}</p>)}<p>Os avisos não impedem guardar o rascunho. A busca filtra a visualização e o CSV; salvar inclui todos os elegíveis da unidade.</p></details>
   {edit&&<form className="simple-roster-edit" aria-label="Ajustar sugestão individual" onSubmit={adjust}><strong>{preview.state.employees.find(e=>e.id===edit.id)?.name}</strong><label>Entrada<input type="time" required value={edit.start} onChange={e=>setEdit({...edit,start:e.target.value})}/></label><label>Primeira folga<select required value={edit.off1} onChange={e=>setEdit({...edit,off1:e.target.value})}><option value="">Escolha</option>{days.map(day=><option key={day} disabled={edit.off2===day}>{day}</option>)}</select></label><label>Segunda folga<select required value={edit.off2} onChange={e=>setEdit({...edit,off2:e.target.value})}><option value="">Escolha</option>{days.map(day=><option key={day} disabled={edit.off1===day}>{day}</option>)}</select></label><button type="submit">Concluir ajuste</button><button type="button" onClick={()=>setEdit(null)}>Cancelar</button></form>}
   <p className="simple-roster-swipe">Deslize a tabela para ver os outros dias e ajustar a sugestão.</p>
   <div className="dataScroll"><table className="dataTable simple-roster-table"><thead><tr><th>Colaborador / turno / líder</th>{week.map(day=><th key={day}>{days[(new Date(day+'T12:00:00').getDay()+6)%7]}<small>{day.slice(8)}/{day.slice(5,7)}</small></th>)}<th/></tr></thead><tbody>{rows.map(employee=>{const original=state.employees.find(e=>e.id===employee.id)!;return <tr key={employee.id}><td><strong>{employee.name}</strong><small>{employee.officialShift||employee.shift} · {employee.coordinatorName||'Sem vínculo informado'}</small><small>Atual: {original.schedule||'Horário não informado'}</small></td>{week.map(day=>{const mark=status(employee,new Date(day+'T12:00:00'),preview.state),journey=selectedJourney(employee,day);return <td key={day} className={mark==='F'?'simple-roster-off':''}>{mark==='F'?'Folga':mark==='A'?'Ausência':mark==='T'&&journey?journeyText(journey):'Revisar'}</td>})}<td><button type="button" disabled={busy||saving||generating||Boolean(edit)} onClick={()=>{const rule=restRule(employee,date);setEdit({id:employee.id,off1:rule.off1,off2:rule.off2,start:selectedJourney(employee,date)?.start||''});setError('');}}>Ajustar</button></td></tr>})}</tbody></table></div>
   {!rows.length&&<p>Nenhum colaborador nesta visualização.</p>}
   <div className="operational-actions"><button type="button" disabled={!rows.length||saving||Boolean(edit)} onClick={()=>download()}>Baixar sugestão (CSV)</button>{readOnly()?<span>Seu perfil permite simular e baixar. Salvar exige permissão de edição.</span>:<><button type="button" disabled={!preview.count||busy||saving||Boolean(edit)} onClick={()=>saveDraft()}>{saving?'Salvando…':'Salvar rascunho'}</button>{onApplied&&<button type="button" className="primary" disabled={!preview.count||busy||saving||Boolean(edit)} onClick={()=>saveDraft(true)}>{saving?'Lançando…':'Lançar em Escalas e folgas'}</button>}</>}</div>
  </>}
  <details className="simple-roster-details"><summary>Comparar as três jornadas</summary><p>Mesma entrada e intervalo atuais, com a saída calculada para cada carga.</p><div className="dataScroll"><table className="dataTable"><thead><tr><th>Colaborador</th>{comparisonHours.map(value=><th key={value}>{value}h</th>)}</tr></thead><tbody>{comparison.map(row=><tr key={row.employee.id}><td>{row.employee.name}</td>{row.options.map(option=><td key={option.hours}>{option.text}</td>)}</tr>)}</tbody></table></div><button type="button" disabled={!comparison.length} onClick={()=>download(true)}>Baixar comparação (CSV)</button></details>
 </section>;
}

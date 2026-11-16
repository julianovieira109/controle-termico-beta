import {useEffect,useMemo,useRef,useState} from 'react';
import {compareSchedules,comparisonCsv,comparisonHours,applyComparisonHours} from '../lib/schedule-comparison';
import {duration} from '../lib/journeys';
import {businessToday,validDay} from '../lib/business-date';
import type {State} from '../lib/roster';
import {readOnly} from '../bridge';
export default function PlanningGuide({state,busy,save}:{state:State;busy:boolean;save:(state:State,action:string)=>Promise<boolean>}){
 const employees=state.employees;
 const [hours,setHours]=useState<40|42|44|undefined>(),[confirmed,setConfirmed]=useState(false),[saving,setSaving]=useState(false),[result,setResult]=useState('');
 const lock=useRef(false);
 const [date,setDate]=useState(businessToday),[shift,setShift]=useState(''),[coordinator,setCoordinator]=useState(''),[query,setQuery]=useState('');
 useEffect(()=>{setConfirmed(false);},[date,hours,state]);
 const bulk=useMemo(()=>hours&&validDay(date)?applyComparisonHours(state,hours,date):null,[state,hours,date]);
 async function applyAll(){
  if(!hours||!bulk?.count||!confirmed||busy||saving||lock.current||readOnly())return;
  lock.current=true;setSaving(true);setResult('');
  try{const current=applyComparisonHours(state,hours,date);
   if(await save(current.state,`Jornada ${hours}h para todos os elegíveis da unidade: ${current.count} colaboradores; vigência ${date}; ${current.excluded.length} pessoas preservadas para revisão individual. Entrada, intervalo, turno, liderança e folgas preservados. Somente planejamento 5x2.`)){
    setResult(`${hours}h por semana salvas no planejamento 5x2 de ${current.count} colaboradores. ${current.excluded.length} pessoas preservadas para revisão individual.`);setConfirmed(false);
   }else setResult('Não foi possível salvar. Confira o aviso do sistema e atualize a unidade se necessário.');
  }catch(error){setResult((error as Error).message);}finally{lock.current=false;setSaving(false);}
 }
 const comparison=useMemo(()=>validDay(date)?compareSchedules(employees,date):[],[employees,date]);
 const rows=comparison.filter(({employee:e})=>(!shift||(e.officialShift||e.shift)===shift)&&(!coordinator||(e.coordinatorId||'unassigned')===coordinator)&&`${e.id} ${e.name}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 const shifts=[...new Set(comparison.map(({employee:e})=>e.officialShift||e.shift))].sort();
 const coordinators=[...new Map(comparison.map(({employee:e})=>[e.coordinatorId||'unassigned',e.coordinatorName||'Sem vínculo informado'])).entries()];
 function download(){const url=URL.createObjectURL(new Blob([comparisonCsv(rows,date)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`Sugestoes_5x2_40h_42h_44h_${date}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="planning-guide" aria-label="Comparação de novos horários 5x2">
  <h2>Sugestões de novos horários: 40h, 42h e 44h</h2>
  <p>Compare as três alternativas para cada colaborador, mantendo a entrada e o intervalo do horário atual. Cada opção considera cinco dias de trabalho e duas folgas. Turno e líder/coordenador vinculado são mantidos como referência.</p>
  <p><strong>Esta comparação apenas sugere horários.</strong> Gerar e baixar não grava jornadas ou folgas. A aplicação confirmada abaixo salva somente no planejamento 5x2; ponto e controle térmico permanecem preservados.</p>
  <div className="operational-controls">
   <label>Data de referência<input aria-label="Data de referência das sugestões" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
   <label>Turno<select aria-label="Turno das sugestões" value={shift} onChange={e=>setShift(e.target.value)}><option value="">Todos os turnos</option>{shifts.map(value=><option key={value}>{value}</option>)}</select></label>
   <label>Líder / coordenador vinculado<select aria-label="Líder ou coordenador das sugestões" value={coordinator} onChange={e=>setCoordinator(e.target.value)}><option value="">Todos os vínculos</option>{coordinators.map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
   <label>Colaborador<input aria-label="Buscar colaborador nas sugestões" placeholder="Nome ou matrícula" value={query} onChange={e=>setQuery(e.target.value)}/></label>
  </div>
  {!validDay(date)&&<p role="alert">Informe uma data válida para gerar as sugestões.</p>}
  <div className="dataScroll"><table className="dataTable"><thead><tr><th>Colaborador</th><th>Turno</th><th>Líder / coordenador vinculado</th><th>Horário atual</th>{comparisonHours.map(hours=><th key={hours}>{hours}h por semana<small>5 dias de {duration(hours*12)}</small></th>)}</tr></thead><tbody>{rows.map(({employee,options})=><tr key={employee.id}><td><strong>{employee.name}</strong><small>Matrícula {employee.id} · Escala {employee.code||'não informada'}</small></td><td>{employee.officialShift||employee.shift}</td><td>{employee.coordinatorName||'Sem vínculo informado'}</td><td>{employee.schedule||'Horário não informado'}</td>{options.map(option=><td key={option.hours}>{option.text}</td>)}</tr>)}</tbody></table></div>
  {!rows.length&&validDay(date)&&<p>Nenhum colaborador com vínculo na data e nos filtros selecionados.</p>}
  <div className="operational-actions"><button type="button" disabled={!rows.length||!validDay(date)} onClick={download}>Baixar as três sugestões (CSV)</button><span>{rows.length} colaboradores · entrada / intervalo / saída em cada opção</span></div>
  <div className="operational-save-status" aria-label="Aplicar jornada para todos">
   <h3>Escolher uma jornada para todos</h3>
   <label>Carga semanal para toda a unidade<select aria-label="Jornada para todos" disabled={busy||saving||readOnly()} value={hours||''} onChange={e=>setHours(e.target.value?Number(e.target.value) as 40|42|44:undefined)}><option value="">Escolha a jornada</option>{comparisonHours.map(value=><option key={value} value={value}>{value}h por semana · 5 dias de {duration(value*12)}</option>)}</select></label>
   <p>A vigência será a data de referência acima. Aplica a todos os colaboradores elegíveis da empresa e filial carregadas, em todos os turnos, independentemente dos filtros da tabela. Cada pessoa mantém sua entrada e seu intervalo atuais. Folgas e jornadas de outras vigências são preservadas.</p>
   {bulk&&<><p><strong>{bulk.count} colaboradores receberão {hours}h por semana.</strong> {bulk.excluded.length} pessoas ficam preservadas para revisão individual.</p>{bulk.excluded.length>0&&<details><summary>Conferir pessoas que não receberão a jornada</summary>{bulk.excluded.map(person=><p key={person.id}>{person.name} · {person.id}: {person.reason}</p>)}</details>}</>}
   {readOnly()?<p>Seu perfil permite somente consultar o planejamento.</p>:<><label className="operational-confirm"><input type="checkbox" disabled={busy||saving||!bulk?.count} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Confirmo a jornada escolhida para todos os elegíveis da unidade, somente no planejamento 5x2.</label><button type="button" className="primary" disabled={busy||saving||!bulk?.count||!confirmed} onClick={applyAll}>{saving?'Salvando…':'Aplicar jornada para todos na 5x2'}</button></>}
   {result&&<p role="status">{result}</p>}
  </div>
  <p>Horários noturnos indicam quando a saída ocorre no dia seguinte. Horários incompletos, aprendizes e jornadas reduzidas ficam para revisão individual. As datas das duas folgas são organizadas separadamente em Escalas e folgas. Cálculo em horas de relógio, sem conversão noturna; confira cobertura da equipe e regras aplicáveis antes de adotar um horário.</p>
 </section>;
}

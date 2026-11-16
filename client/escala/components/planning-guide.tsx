import {useMemo,useState} from 'react';
import {compareSchedules,comparisonCsv,comparisonHours} from '../lib/schedule-comparison';
import {duration} from '../lib/journeys';
import {businessToday,validDay} from '../lib/business-date';
import type {Employee} from '../lib/roster';
export default function PlanningGuide({employees}:{employees:Employee[]}){
 const [date,setDate]=useState(businessToday),[shift,setShift]=useState(''),[coordinator,setCoordinator]=useState(''),[query,setQuery]=useState('');
 const comparison=useMemo(()=>validDay(date)?compareSchedules(employees,date):[],[employees,date]);
 const rows=comparison.filter(({employee:e})=>(!shift||(e.officialShift||e.shift)===shift)&&(!coordinator||(e.coordinatorId||'unassigned')===coordinator)&&`${e.id} ${e.name}`.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR')));
 const shifts=[...new Set(comparison.map(({employee:e})=>e.officialShift||e.shift))].sort();
 const coordinators=[...new Map(comparison.map(({employee:e})=>[e.coordinatorId||'unassigned',e.coordinatorName||'Sem vínculo informado'])).entries()];
 function download(){const url=URL.createObjectURL(new Blob([comparisonCsv(rows,date)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`Sugestoes_5x2_40h_42h_44h_${date}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return <section className="planning-guide" aria-label="Comparação de novos horários 5x2">
  <h2>Sugestões de novos horários: 40h, 42h e 44h</h2>
  <p>Compare as três alternativas para cada colaborador, mantendo a entrada e o intervalo do horário atual. Cada opção considera cinco dias de trabalho e duas folgas. Turno e líder/coordenador vinculado são mantidos como referência.</p>
  <p><strong>Esta comparação apenas sugere horários.</strong> Não grava jornadas ou folgas e não altera o ponto nem o controle térmico.</p>
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
  <p>Horários noturnos indicam quando a saída ocorre no dia seguinte. Horários incompletos, aprendizes e jornadas reduzidas ficam para revisão individual. As datas das duas folgas são organizadas separadamente em Escalas e folgas. Cálculo em horas de relógio, sem conversão noturna; confira cobertura da equipe e regras aplicáveis antes de adotar um horário.</p>
 </section>;
}

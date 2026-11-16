import {unitContext} from '../bridge';
import {jsPDF} from 'jspdf';
import {autoTable,type RowInput} from 'jspdf-autotable';
import {key,status,planned,primaryRestDay,type State,type Employee} from './roster';
import {groupRoster} from './roster-groups';
import {isLeader,leadershipLabel} from './leadership';
export type FolgaReportOptions={periodLabel:string;filterLabel:string;updatedAt?:string;referenceDate?:string};
export function folgaReportRows(state:State,employees:Employee[],dates:Date[],referenceDate=key(dates[0])){return groupRoster(employees,referenceDate).map(section=>({...section,groups:section.groups.map(group=>({...group,rows:group.employees.map(e=>{const primary:string[]=[],secondary:string[]=[],absences:string[]=[];for(const d of dates){const s=status(e,d,state);const label=d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});if(s==='F'){if(['Seg','Ter','Qua','Qui','Sex','Sab','Dom'][(d.getDay()+6)%7]===primaryRestDay(e,key(d)))primary.push(label);else secondary.push(label);}else if(s==='A')absences.push(label);}return {employee:e,primary,secondary,absences,total:primary.length+secondary.length};})}))}));}
export function createFolgaReport(state:State,employees:Employee[],dates:Date[],options:FolgaReportOptions){
 if(!dates.length||!employees.length)throw Error('Selecione um período e ao menos um colaborador para gerar o relatório.');
 const reference=options.referenceDate||key(dates[0]);
 const sections=folgaReportRows(state,employees,dates,reference);
 const allRows=sections.flatMap(s=>s.groups.flatMap(g=>g.rows));
 const total=allRows.reduce((a,r)=>a+r.total,0),absenceCount=allRows.reduce((a,r)=>a+r.absences.length,0);
 const pending=employees.filter(e=>!planned(e,reference)).length;
 const hasReview=employees.some(e=>dates.some(d=>status(e,d,state)==='REV'));
 const reviewCount=(members:Employee[],period:Date[])=>members.reduce((sum,e)=>sum+period.filter(d=>status(e,d,state)==='REV').length,0);
 const doc=new jsPDF({orientation:'landscape',unit:'pt',format:'a4',compress:true});
 const width=doc.internal.pageSize.getWidth(),height=doc.internal.pageSize.getHeight(),margin=32;
 const context=unitContext(),generated=new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
 const weekdays=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
 const dateLabel=(d:Date)=>`${weekdays[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
 doc.setProperties({title:'Escala 5x2 - Planejamento de folgas',subject:options.periodLabel,author:context.companyName||'Controle Térmico',creator:'Planejamento 5x2'});
 function heading(title:string,subtitle:string){
  doc.setFillColor(24,48,77);doc.rect(0,0,width,7,'F');
  doc.setTextColor(24,48,77);doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text(title,margin,34);
  doc.setFont('helvetica','normal');doc.setFontSize(10);doc.text(options.periodLabel,width-margin,33,{align:'right'});
  doc.setFontSize(9);doc.setTextColor(80,96,112);doc.text(doc.splitTextToSize(`${context.companyName} | ${context.branchName}`,width-2*margin),margin,51);
  doc.setFont('helvetica','bold');doc.setFontSize(10);doc.setTextColor(37,66,99);doc.text(subtitle,margin,76);
 }
 const tableStyles={font:'helvetica',fontSize:9,cellPadding:6,lineColor:[218,225,233] as [number,number,number],lineWidth:0.3,textColor:[38,57,80] as [number,number,number],valign:'middle' as const};
 const headStyles={fillColor:[37,66,99] as [number,number,number],textColor:255,fontStyle:'bold' as const,fontSize:9,cellPadding:7};
 heading('ESCALA 5x2 · PLANEJAMENTO DE FOLGAS','Visão geral do período');
 const metrics=[['COLABORADORES',String(employees.length)],['FOLGAS NO PERÍODO',String(total)],['REGISTROS DE AUSÊNCIA',String(absenceCount)]];
 const cardWidth=(width-2*margin-24)/3;
 metrics.forEach(([label,value],i)=>{const x=margin+i*(cardWidth+12);doc.setFillColor(242,246,250);doc.roundedRect(x,92,cardWidth,58,5,5,'F');doc.setTextColor(80,96,112);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text(label,x+12,110);doc.setFontSize(23);doc.setTextColor(24,48,77);doc.text(value,x+12,137);});
 autoTable(doc,{startY:168,margin:{left:margin,right:margin,top:92,bottom:62},theme:'grid',styles:tableStyles,headStyles,head:[['Turno / área','Colaboradores','Trabalho¹','Folgas¹','Ausências¹',...(hasReview?['Revisar¹']:[])]],body:sections.map(s=>{const rows=s.groups.flatMap(g=>g.rows);return [s.key,String(s.employees.length),String(s.employees.reduce((sum,e)=>sum+dates.filter(d=>status(e,d,state)==='T').length,0)),String(rows.reduce((sum,r)=>sum+r.total,0)),String(rows.reduce((sum,r)=>sum+r.absences.length,0)),...(hasReview?[String(reviewCount(s.employees,dates))]:[])];}),columnStyles:{0:{cellWidth:265},1:{halign:'center'},2:{halign:'center'},3:{halign:'center'},4:{halign:'center'}}});
 let cursor=(doc as any).lastAutoTable.finalY+23;
 doc.setFont('helvetica','bold');doc.setFontSize(10);doc.text('Distribuição diária da equipe',margin,cursor);
 // Monthly periods are split into readable weekly blocks rather than 31 narrow columns.
 for(let offset=0;offset<dates.length;offset+=7){
  const block=dates.slice(offset,offset+7);
  if(cursor+(hasReview?140:115)>height-67){doc.addPage();heading('ESCALA 5x2 · RESUMO','Distribuição diária da equipe');cursor=80;}
  autoTable(doc,{startY:cursor+9,margin:{left:margin,right:margin,top:92,bottom:62},theme:'grid',styles:{...tableStyles,halign:'center'},headStyles,head:[['Situação',...block.map(dateLabel)]],body:[['Trabalho',...block.map(d=>String(employees.filter(e=>status(e,d,state)==='T').length))],['Folga',...block.map(d=>String(employees.filter(e=>status(e,d,state)==='F').length))],['Ausência',...block.map(d=>String(employees.filter(e=>status(e,d,state)==='A').length))],...(hasReview?[['Revisar',...block.map(d=>String(reviewCount(employees,[d])))]]:[])],columnStyles:{0:{cellWidth:140,halign:'left'}}});cursor=(doc as any).lastAutoTable.finalY+10;
 }
 const scope=doc.splitTextToSize('Escopo: '+options.filterLabel,width-2*margin);
 if(cursor+34+scope.length*10+(pending?12:0)>height-59){doc.addPage();heading('ESCALA 5x2 · ESCOPO','Critérios da consulta');cursor=92;}
 doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(80,96,112);
 doc.text('¹ Totais de marcações no período; uma pessoa pode aparecer em vários dias.',margin,cursor+5);
 doc.text(scope,margin,cursor+19);
 if(pending)doc.text(`${pending} colaborador(es) com folgas a definir na referência dos grupos.`,margin,cursor+22+scope.length*10);
 for(const section of sections){
  // Preserve the full selected period in each roster table.
  for(let offset=0;offset<dates.length;offset+=dates.length){
   const block=dates;doc.addPage();const body:RowInput[]=[];
   const blockPeriod='';
   for(const group of section.groups){
    body.push([{content:`${group.coordinatorName||'Sem coordenador vinculado'} · ${group.label.replace('Grupo ','Folgas ')} · ${group.rows.length} pessoa(s)`,colSpan:block.length+3,styles:{fillColor:[233,239,246],textColor:[33,64,98],fontStyle:'bold',fontSize:8,halign:'left',cellPadding:5}}]);
    for(const r of group.rows){const e=r.employee;
     const days=block.map(d=>{const value=status(e,d,state);const primary=['Seg','Ter','Qua','Qui','Sex','Sab','Dom'][(d.getDay()+6)%7]===primaryRestDay(e,key(d));return {content:value==='REV'?'R':value,styles:{fillColor:(value==='F'?(primary?[254,226,227]:[224,235,252]):value==='A'?[255,242,204]:[255,255,255]) as [number,number,number],textColor:(value==='F'?(primary?[154,34,45]:[36,77,142]):[65,83,102]) as [number,number,number],fontStyle:value==='T'?'normal' as const:'bold' as const}};});
     const detail=isLeader(e)?leadershipLabel(e):'';
     const name=`${e.name}${detail?'\n'+detail:''}${!planned(e,reference)?'\nFolgas a definir':''}`;
     body.push([e.id,{content:name,styles:{fontStyle:isLeader(e)?'bold':'normal'}},...days,String(block.filter(d=>status(e,d,state)==='F').length)]);
    }
   }
   const nameWidth=block.length>7?190:280;
   const columns:Record<number,object>={0:{cellWidth:44},1:{cellWidth:nameWidth,halign:'left'},[block.length+2]:{cellWidth:42,fontStyle:'bold'}};
   const dayWidth=(width-2*margin-nameWidth-86)/block.length;block.forEach((_,i)=>columns[i+2]={cellWidth:dayWidth});
   autoTable(doc,{head:[['Matr.','Colaborador / liderança',...block.map(d=>dateLabel(d).replace(' ','\n')),'Folgas']],body,startY:88,margin:{left:margin,right:margin,top:88,bottom:58},theme:'grid',tableWidth:width-margin*2,styles:{...tableStyles,fontSize:block.length>7?6.8:8,cellPadding:block.length>7?2:4,overflow:'linebreak',halign:'center'},headStyles:{...headStyles,fontSize:block.length>7?5.7:8,cellPadding:block.length>7?2:5},columnStyles:columns,showHead:'everyPage',rowPageBreak:'avoid',willDrawPage:()=>heading('ESCALA 5x2 · EQUIPE',`${section.key} · ${section.employees.length} colaboradores${blockPeriod}`)});
  }
 }
 const pages=doc.getNumberOfPages();
 for(let page=1;page<=pages;page++){
  doc.setPage(page);doc.setDrawColor(210,220,231);doc.line(margin,height-43,width-margin,height-43);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(80,96,112);
  doc.text('T Trabalho  |  F Folga: principal em vermelho, segunda/extra em azul  |  A Ausência  |  R Revisar',margin,height-31);
  doc.text(`Página ${page} de ${pages}`,width-margin,height-31,{align:'right'});
  doc.text('Planejamento 5x2 · não altera ponto ou controle térmico.',margin,height-20);
  doc.text(`Emitido em ${generated}${options.updatedAt?' · Base salva em '+new Date(options.updatedAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):''}`,margin,height-10);
 }
 return {document:doc,filename:`Planejamento_Folgas_5x2_${key(dates[0])}_${key(dates[dates.length-1])}.pdf`,summary:{employees:employees.length,total,absenceCount,pages}};
}

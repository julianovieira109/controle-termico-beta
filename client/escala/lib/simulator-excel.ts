import {unitContext} from '../bridge';
import {displaySchedule} from './planning-reference';
import {journeyText,selectedJourney} from './journeys';
import {legalWeeklyLimit,type comparisonHours,compareSchedules} from './schedule-comparison';
import {status,type Employee,type State} from './roster';

const colors={navy:'18304D',blue:'254263',blueLight:'DCE8F4',green:'DDEFE3',greenText:'1F6B3A',amber:'FFF1CC',amberText:'8A5A00',purple:'E9E2F3',purpleText:'5B3D78',red:'FDE2E2',redText:'9D2935',gray:'F4F6F8',text:'263950',muted:'59697A',white:'FFFFFF',border:'D9E1E8'};

function argb(value:string){return 'FF'+value;}
function fill(cell:any,color:string){cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:argb(color)}};}
function font(cell:any,options:any={}){cell.font={name:'Aptos',size:10,color:{argb:argb(colors.text)},...options};}
function border(cell:any){cell.border={top:{style:'thin',color:{argb:argb(colors.border)}},bottom:{style:'thin',color:{argb:argb(colors.border)}},left:{style:'thin',color:{argb:argb(colors.border)}},right:{style:'thin',color:{argb:argb(colors.border)}}};}
function header(row:any){row.height=30;row.eachCell((cell:any)=>{fill(cell,colors.blue);font(cell,{bold:true,color:{argb:argb(colors.white)},size:10});cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};border(cell);});}
function stripe(row:any,index:number){row.height=28;row.eachCell((cell:any)=>{if(index%2===0)fill(cell,'FAFBFC');font(cell);cell.alignment={vertical:'middle',wrapText:true};border(cell);});}
function title(sheet:any,titleText:string,subtitle:string,lastCol:string){
 sheet.mergeCells('A1:'+lastCol+'2');const title=sheet.getCell('A1');title.value=titleText;fill(title,colors.navy);font(title,{bold:true,size:20,color:{argb:argb(colors.white)}});title.alignment={vertical:'middle',horizontal:'left'};sheet.getRow(1).height=28;sheet.getRow(2).height=12;
 sheet.mergeCells('A3:'+lastCol+'3');const sub=sheet.getCell('A3');sub.value=subtitle;fill(sub,colors.blueLight);font(sub,{bold:true,size:10,color:{argb:argb(colors.blue)}});sub.alignment={vertical:'middle',horizontal:'left'};sheet.getRow(3).height=23;
}
function metric(sheet:any,range:string,label:string,value:string,color:string){
 sheet.mergeCells(range);const start=range.split(':')[0];const cell=sheet.getCell(start);cell.value=label+'\n'+value;fill(cell,color);font(cell,{bold:true,size:12,color:{argb:argb(colors.navy)}});cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};border(cell);
}
function setup(sheet:any){sheet.views=[{state:'frozen',ySplit:5,xSplit:2,showGridLines:false}];sheet.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:0.3,right:0.3,top:0.5,bottom:0.5,header:0.2,footer:0.2}};}
function download(buffer:any,filename:string){const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function dateLabel(date:string){return date.split('-').reverse().join('/');}
function normalizeText(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();}
function reviewReason(row:ReturnType<typeof compareSchedules>[number]){const reasons:string[]=[];for(const option of row.options){if(option.allowed&&!option.journey)reasons.push(option.text);}if(!row.employee.coordinatorId)reasons.push('Líder / coordenador não vinculado.');return [...new Set(reasons)];}
async function workbookBase(){
 const ExcelJS=await import('exceljs');const workbook=new ExcelJS.Workbook();workbook.creator='Controle Térmico';workbook.company=unitContext().companyName||'Controle Térmico';workbook.created=new Date();workbook.modified=new Date();return workbook;
}
function summarySheet(workbook:any,employees:Employee[],date:string,reviewCount:number,titleText:string){
 const context=unitContext(),sheet=workbook.addWorksheet('Resumo',{properties:{tabColor:{argb:argb(colors.blue)}}});sheet.views=[{showGridLines:false}];title(sheet,titleText,(context.companyName||'Empresa')+' · '+(context.branchName||'Filial')+' · Referência '+dateLabel(date),'H');
 metric(sheet,'A5:B7','COLABORADORES',String(employees.length),colors.blueLight);
 metric(sheet,'C5:D7','REFERÊNCIA',dateLabel(date),colors.gray);
 metric(sheet,'E5:F7','LIMITE SEMANAL',legalWeeklyLimit(date)+'h',colors.green);
 metric(sheet,'G5:H7','REVISÕES',String(reviewCount),reviewCount?colors.amber:colors.green);
 sheet.mergeCells('A9:H9');sheet.getCell('A9').value='Distribuição por turno';fill(sheet.getCell('A9'),colors.navy);font(sheet.getCell('A9'),{bold:true,color:{argb:argb(colors.white)},size:11});
 const groups=new Map<string,Employee[]>();for(const employee of employees){const key=employee.officialShift||employee.shift||'Não definido';groups.set(key,[...(groups.get(key)||[]),employee]);}
 sheet.getRow(10).values=['Turno / área','Colaboradores','Com coordenador','Sem coordenador','','','',''];header(sheet.getRow(10));
 let row=11;for(const [name,members] of [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],'pt-BR'))){const r=sheet.getRow(row++);r.values=[name,members.length,members.filter(e=>e.coordinatorId).length,members.filter(e=>!e.coordinatorId).length];stripe(r,row);r.getCell(2).alignment={horizontal:'center'};r.getCell(3).alignment={horizontal:'center'};r.getCell(4).alignment={horizontal:'center'};}
 sheet.mergeCells('A'+(row+1)+':H'+(row+1));const note=sheet.getCell('A'+(row+1));note.value='Somente simulação. O Excel não altera cadastro, ponto, banco de horas, controle térmico ou dados oficiais da Senior.';fill(note,colors.gray);font(note,{italic:true,color:{argb:argb(colors.muted)}});note.alignment={wrapText:true,vertical:'middle'};sheet.getRow(row+1).height=30;
 sheet.mergeCells('A'+(row+3)+':H'+(row+3));const legal=sheet.getCell('A'+(row+3));legal.value='Referência normativa do simulador: EC 141/2026. Para a etapa de 42h, considerar também a cautelar do STF nas ADIs 8041 e 8042 e eventuais normas coletivas aplicáveis.';fill(legal,colors.amber);font(legal,{size:9,color:{argb:argb(colors.amberText)}});legal.alignment={wrapText:true,vertical:'middle'};sheet.getRow(row+3).height=34;
 sheet.columns=[{width:30},{width:18},{width:20},{width:20},{width:3},{width:18},{width:18},{width:18}];return sheet;
}
export async function exportComparisonExcel(rows:ReturnType<typeof compareSchedules>,date:string){
 if(!rows.length)throw Error('Não há colaboradores para gerar a comparação.');
 const workbook=await workbookBase();const employees=rows.map(row=>row.employee);const reviews=rows.filter(row=>reviewReason(row).length);summarySheet(workbook,employees,date,reviews.length,'SIMULADOR 5x2 · COMPARAÇÃO DE JORNADAS');
 const context=unitContext();const sheet=workbook.addWorksheet('Comparação',{properties:{tabColor:{argb:argb(colors.navy)}}});setup(sheet);title(sheet,'COMPARAÇÃO 5x2 · 40h / 42h / 44h',(context.companyName||'Empresa')+' · '+(context.branchName||'Filial')+' · '+dateLabel(date),'J');
 const headers=['Status','Matrícula','Colaborador','Turno','Líder / coordenador','Horário atual','40h','42h','44h','Observações'];sheet.getRow(5).values=headers;header(sheet.getRow(5));
 let r=6;for(const row of rows){const reasons=reviewReason(row),values=[reasons.length?'REVISAR':'OK',row.employee.id,row.employee.name,row.employee.officialShift||row.employee.shift,row.employee.coordinatorName||'Sem vínculo informado',displaySchedule(row.employee.schedule),...row.options.map(option=>option.journey?journeyText(option.journey):option.text),[...new Set(row.options.map(option=>option.legalNote).filter(Boolean))].join(' | ')];const excelRow=sheet.getRow(r);excelRow.values=values;stripe(excelRow,r);if(reasons.length){fill(excelRow.getCell(1),colors.amber);font(excelRow.getCell(1),{bold:true,color:{argb:argb(colors.amberText)}});}else{fill(excelRow.getCell(1),colors.green);font(excelRow.getCell(1),{bold:true,color:{argb:argb(colors.greenText)}});}fill(excelRow.getCell(7),colors.green);fill(excelRow.getCell(8),colors.blueLight);fill(excelRow.getCell(9),colors.purple);for(const c of [7,8,9])excelRow.getCell(c).alignment={vertical:'middle',horizontal:'center',wrapText:true};r++;}
 sheet.autoFilter={from:'A5',to:'J'+(r-1)};sheet.columns=[{width:12},{width:12},{width:34},{width:20},{width:30},{width:28},{width:24},{width:24},{width:24},{width:52}];
 sheet.getColumn(1).alignment={horizontal:'center'};sheet.getColumn(2).alignment={horizontal:'center'};
 const review=workbook.addWorksheet('Revisões',{properties:{tabColor:{argb:argb(colors.amber)}}});review.views=[{state:'frozen',ySplit:5,showGridLines:false}];title(review,'PONTOS PARA REVISÃO','Somente itens que exigem conferência individual','F');review.getRow(5).values=['Matrícula','Colaborador','Turno','Líder / coordenador','Horário atual','Motivo'];header(review.getRow(5));
 let rr=6;if(!reviews.length){review.mergeCells('A6:F8');const cell=review.getCell('A6');cell.value='Nenhuma revisão individual identificada nesta comparação.';fill(cell,colors.green);font(cell,{bold:true,color:{argb:argb(colors.greenText)},size:12});cell.alignment={vertical:'middle',horizontal:'center'};}else for(const row of reviews){const excelRow=review.getRow(rr++);excelRow.values=[row.employee.id,row.employee.name,row.employee.officialShift||row.employee.shift,row.employee.coordinatorName||'Sem vínculo informado',displaySchedule(row.employee.schedule),reviewReason(row).join(' | ')];stripe(excelRow,rr);fill(excelRow.getCell(6),colors.amber);}
 review.columns=[{width:12},{width:34},{width:20},{width:30},{width:28},{width:60}];review.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0};
 const buffer=await workbook.xlsx.writeBuffer();download(buffer,'Simulador_5x2_Comparacao_'+date+'.xlsx');
}
export async function exportSuggestionExcel(state:State,employees:Employee[],date:string,hours:40|42|44,week:string[],alerts:string[]){
 if(!employees.length)throw Error('Não há colaboradores nesta visualização.');
 const workbook=await workbookBase();summarySheet(workbook,employees,date,alerts.length,'SIMULADOR 5x2 · SUGESTÃO '+hours+'h');
 const context=unitContext();const sheet=workbook.addWorksheet('Sugestão '+hours+'h',{properties:{tabColor:{argb:argb(colors.blue)}}});setup(sheet);title(sheet,'SUGESTÃO 5x2 · '+hours+'h',(context.companyName||'Empresa')+' · '+(context.branchName||'Filial')+' · '+dateLabel(date),'O');
 const headers=['Matrícula','Colaborador','Turno','Líder / coordenador','Horário atual','Horário sugerido',...week.map(day=>day.split('-').reverse().slice(0,2).join('/')),'Situação'];sheet.getRow(5).values=headers;header(sheet.getRow(5));
 let r=6;for(const employee of employees){const suggested=selectedJourney(employee,date);const daily=week.map(day=>{const mark=status(employee,new Date(day+'T12:00:00'),state);return mark==='T'?'Trabalho':mark==='F'?'Folga':mark==='A'?'Ausência':'Revisar';});const row=sheet.getRow(r);row.values=[employee.id,employee.name,employee.officialShift||employee.shift,employee.coordinatorName||'Sem vínculo informado',displaySchedule(employee.schedule),suggested?journeyText(suggested):'Revisar',...daily,daily.includes('Revisar')?'REVISAR':'OK'];stripe(row,r);for(let c=7;c<7+week.length;c++){const cell=row.getCell(c);const value=String(cell.value||'');if(value==='Folga')fill(cell,colors.blueLight);else if(value==='Ausência')fill(cell,colors.red);else if(value==='Revisar')fill(cell,colors.amber);cell.alignment={horizontal:'center',vertical:'middle'};}const statusCell=row.getCell(headers.length);fill(statusCell,daily.includes('Revisar')?colors.amber:colors.green);font(statusCell,{bold:true,color:{argb:argb(daily.includes('Revisar')?colors.amberText:colors.greenText)}});statusCell.alignment={horizontal:'center'};r++;}
 sheet.autoFilter={from:'A5',to:'O'+(r-1)};sheet.columns=[{width:12},{width:34},{width:20},{width:30},{width:28},{width:28},...week.map(()=>({width:13})),{width:12}];
 const alertSheet=workbook.addWorksheet('Alertas',{properties:{tabColor:{argb:argb(colors.amber)}}});alertSheet.views=[{showGridLines:false}];title(alertSheet,'ALERTAS DA SIMULAÇÃO','Itens para conferência antes de qualquer decisão operacional','B');alertSheet.getRow(5).values=['#','Alerta'];header(alertSheet.getRow(5));if(!alerts.length){alertSheet.mergeCells('A6:B8');const cell=alertSheet.getCell('A6');cell.value='Nenhum alerta identificado nesta simulação.';fill(cell,colors.green);font(cell,{bold:true,color:{argb:argb(colors.greenText)}});cell.alignment={vertical:'middle',horizontal:'center'};}else alerts.forEach((alert,index)=>{const row=alertSheet.getRow(6+index);row.values=[index+1,alert];stripe(row,index);fill(row.getCell(2),colors.amber);});alertSheet.columns=[{width:8},{width:100}];
 const buffer=await workbook.xlsx.writeBuffer();download(buffer,'Simulador_5x2_'+hours+'h_'+date+'.xlsx');
}

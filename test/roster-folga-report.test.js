const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSync}=require('esbuild');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'roster-report-'));
let report;
try{
 const output=path.join(folder,'report.cjs');
 buildSync({entryPoints:[path.join(__dirname,'../client/escala/lib/folga-report.ts')],bundle:true,platform:'node',format:'cjs',outfile:output,logLevel:'silent'});
 report=require(output);
}finally{fs.rmSync(folder,{recursive:true,force:true});}
const employee=(id,extra={})=>({id,name:'Colaborador '+id,shift:'1º',code:'46',schedule:'06:00-10:00-11:00-15:00',active:true,included:true,off1:'Dom',off2:'Seg',role:'OPERADOR',note:'',...extra});
const dates=Array.from({length:7},(_,i)=>new Date(2026,10,16+i,12));
test('relatório executivo preserva folgas, ausências, revisões e estado de origem',async()=>{
 const state={employees:[employee('1',{leader:true,leadershipLevel:'Supervisor'}),employee('2',{shift:'3º'}),employee('3',{included:false})],overrides:[{id:'2',date:'2026-11-18',status:'A',reason:'Ausência planejada'}],history:[]};
 const before=structuredClone(state),result=report.createFolgaReport(state,state.employees,dates,{periodLabel:'Semana 16 a 22/11/2026',filterLabel:'Todos',referenceDate:'2026-11-16'});
 assert.equal(result.summary.employees,3);assert.equal(result.summary.total,4);assert.equal(result.summary.absenceCount,1);assert.ok(result.summary.pages>=3);
 const pdf=result.document.internal.pages.flat().join('\n');
 for(const text of ['Supervisor','Colaborador / lideran','Revisar','Folgas']){assert.ok(pdf.includes(text),text);}
 assert.ok(!pdf.includes('OPERADOR'));assert.ok(!pdf.includes('Não definida'));assert.deepEqual(state,before);
 const rows=report.folgaReportRows(state,state.employees,dates);
 assert.equal(rows.flatMap(s=>s.groups.flatMap(g=>g.rows)).find(r=>r.employee.id==='2').absences[0],'18/11');
});
test('relatório mensal mantém todas as datas e paginação e recusa seleção vazia',async()=>{
 const state={employees:[employee('1')],overrides:[],history:[]};
 const month=Array.from({length:30},(_,i)=>new Date(2026,10,i+1,12));
 const result=report.createFolgaReport(state,state.employees,month,{periodLabel:'Novembro 2026',filterLabel:'Todos'});
 assert.equal(result.summary.total,10);assert.ok(result.document.internal.pages.flat().join('\n').includes('30/11'));
 assert.throws(()=>report.createFolgaReport(state,[],month,{periodLabel:'',filterLabel:''}),/ao menos um/);
 assert.throws(()=>report.createFolgaReport(state,state.employees,[],{periodLabel:'',filterLabel:''}),/ao menos um/);
});

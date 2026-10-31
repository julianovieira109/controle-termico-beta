const test=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const jwt=require('jsonwebtoken');
const {once}=require('node:events');
const {validDate,validMonth}=require('../src/middleware/validate-filters');

test('datas reais, anos bissextos e meses válidos',()=>{
  for(const date of ['2024-02-29','2000-02-29','2026-04-30','0099-01-01'])assert.equal(validDate(date),true,date);
  for(const date of ['2026-02-29','1900-02-29','2026-04-31','2026-00-01','0000-01-01','2026-01-00','2026-02-30',[],null])assert.equal(validDate(date),false,String(date));
  for(const month of ['2026-01','2026-12'])assert.equal(validMonth(month),true);
  for(const month of ['2026-00','2026-13','2026-1','0000-01',['2026-01']])assert.equal(validMonth(month),false);
});

test('rotas recusam filtros inválidos antes de consultar o banco e preservam autenticação',async()=>{
  let queries=0;
  const poolPath=require.resolve('../src/db/pool');
  const original=require.cache[poolPath];
  require.cache[poolPath]={id:poolPath,filename:poolPath,loaded:true,exports:{query:async()=>{queries++;return {rows:[]};},connect:async()=>{throw new Error('Não deveria conectar');}}};
  const previousSecret=process.env.JWT_SECRET;
  process.env.JWT_SECRET='isolated-filter-validation-test';
  const app=express();
  for(const route of ['reports','dashboard','employees','calendar','admin','catalogs'])app.use('/api/'+route,require('../src/routes/'+route));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const token=jwt.sign({sub:'00000000-0000-4000-8000-000000000001',role:'ADMIN',isMasterAdmin:true},process.env.JWT_SECRET);
  const headers={Authorization:'Bearer '+token};
  try{
    const paths=[
      '/reports/point-days?month=2026-13','/reports/point-competence?month=2026-00',
      '/dashboard/alerts?month=2026-13','/dashboard/operations?month=2026-00',
      '/dashboard/competence-compare?monthA=2026-09&monthB=2026-13',
      '/dashboard/occurrences?month=2026-13','/dashboard/occurrences/journeys?month=2026-13',
      '/employees?terminationFrom=2026-02-30','/employees?terminationTo=2026-04-31',
      '/employees?terminationFrom=2026-05-01&terminationTo=2026-04-01',
      '/employees/not-a-uuid','/employees/not-a-uuid/history',
      '/calendar/holidays?year=abc','/calendar/days-off?year=0000',
      '/employees?companyId=invalid','/calendar/holidays?branchId=invalid',
      '/reports/point-days?month=2026-01&month=2026-02',
      '/catalogs/job-report-policies?companyId=invalid'
    ];
    for(const path of paths){
      const response=await fetch(base+'/api'+path,{headers});
      assert.equal(response.status,400,path);
      assert.ok((await response.json()).error,path);
    }
    for(const path of ['/admin/users/not-a-uuid','/calendar/holidays/not-a-uuid','/catalogs/job-report-policies/not-a-uuid/branches/not-a-uuid']){
      assert.equal((await fetch(base+'/api'+path,{method:'PUT',headers})).status,400,path);
    }
    assert.equal(queries,0,'filtros inválidos não chegam ao banco');
    assert.equal((await fetch(base+'/api/reports/point-days?month=2026-13')).status,401);
    const response=await fetch(base+'/api/reports/point-days?month=2026-02',{headers});
    assert.equal(response.status,200);assert.deepEqual(await response.json(),[]);
    assert.equal(queries,1,'mês válido continua consultando o banco');
  }finally{
    await new Promise(resolve=>server.close(resolve));
    if(original)require.cache[poolPath]=original;else delete require.cache[poolPath];
    if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;
  }
});

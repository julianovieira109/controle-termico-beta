const test=require('node:test');
const assert=require('node:assert/strict');
const {extractSeniorFooterTotalsFromPage}=require('../src/importers/senior-column-layout');

test('reconstrói o rodapé Senior quando rótulos e valores vêm fragmentados',()=>{
  const y=32.0267;
  const items=[
    {x:1.02,y,text:'Trabalho:'},{x:3.08,y,text:'112:51'},
    {x:4.72,y,text:'BH'},{x:5.50,y,text:'-'},{x:6.51,y,text:'039:05'},
    {x:8.43,y,text:'BH'},{x:9.21,y,text:'+'},{x:10.06,y,text:'016:24'},
    {x:11.85,y,text:'HE'},{x:12.58,y,text:'100%:'},{x:14.32,y,text:'000:00'},
    {x:16.24,y,text:'Faltas:'},{x:17.88,y,text:'007:00'},
    {x:19.53,y,text:'Ad Noturno'},{x:22.14,y,text:'000000'}
  ];
  assert.deepEqual(extractSeniorFooterTotalsFromPage(items),{
    W:'112:51',BM:'039:05',BP:'016:24',HE:'000:00',F:'007:00',
    sourceText:'Trabalho: 112:51 BH - 039:05 BH + 016:24 HE 100%: 000:00 Faltas: 007:00 Ad Noturno 000000'
  });
});

test('aceita rodapé já composto em um único Text',()=>{
  const items=[{x:1,y:40,text:'Trabalho:150:15 BH - 001:45 BH + 002:43 HE 100%: 000:00 Faltas: 000:00 Ad Noturno 000000 Viagens:'}];
  const footer=extractSeniorFooterTotalsFromPage(items);
  assert.equal(footer.W,'150:15');
  assert.equal(footer.BM,'001:45');
  assert.equal(footer.BP,'002:43');
  assert.equal(footer.HE,'000:00');
  assert.equal(footer.F,'000:00');
});

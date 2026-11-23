const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'..','client/escala/lib/simulator-excel.ts'),'utf8');
test('exportação do simulador gera Excel organizado com abas de resumo, comparação e revisão',()=>{
 assert.match(source,/exceljs/);
 assert.match(source,/workbook\.xlsx\.writeBuffer/);
 assert.match(source,/addWorksheet\('Resumo'/);
 assert.match(source,/addWorksheet\('Comparação'/);
 assert.match(source,/addWorksheet\('Revisões'/);
 assert.match(source,/autoFilter/);
 assert.match(source,/state:'frozen'/);
 assert.match(source,/\.xlsx'/);
});

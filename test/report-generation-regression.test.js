const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('status da ficha térmica permanece mutável durante a geração',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../public/js/calendar-reports.js'),'utf8');
  assert.match(source,/let\s+status=blankCopy/);
  assert.doesNotMatch(source,/const\s+status=blankCopy/);
});

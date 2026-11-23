const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('simulador 5x2 renderiza sem erro de runtime',()=>{
 const result=spawnSync(process.execPath,['tools/check-simulator-render.mjs'],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr||result.stdout);
 assert.match(result.stdout,/OK: simulador renderizou/);
});

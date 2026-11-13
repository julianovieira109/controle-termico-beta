import {build} from 'esbuild';
import {mkdir,rm,writeFile} from 'node:fs/promises';
await mkdir('src/generated',{recursive:true});
await build({entryPoints:['client/escala/rules.ts'],bundle:true,platform:'node',format:'cjs',target:'node20',outfile:'src/generated/roster-rules.cjs'});
await mkdir('public/escalas-5x2',{recursive:true});
await rm('public/escalas-5x2/assets',{recursive:true,force:true});
const result=await build({entryPoints:['client/escala/main.tsx'],bundle:true,splitting:true,format:'esm',minify:true,target:['chrome110','edge110'],outdir:'public/escalas-5x2/assets',entryNames:'app-[hash]',chunkNames:'chunk-[hash]',metafile:true,define:{'process.env.NODE_ENV':'"production"'},jsx:'automatic',legalComments:'eof'});
const outputs=Object.entries(result.metafile.outputs);
const entry=outputs.find(([,info])=>info.entryPoint==='client/escala/main.tsx');
if(!entry)throw Error('Entrada da escala não encontrada');
const css=entry[1].cssBundle;
await writeFile('public/escalas-5x2/index.html',`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Escala 5x2 · Controle Térmico Beta</title>${css?`<link rel="stylesheet" href="/${css.replace(/^public\//,'')}">`:''}</head><body><div id="root"></div><script type="module" src="/${entry[0].replace(/^public\//,'')}"></script></body></html>`);
console.log('Escala 5x2: regras do servidor e interface compiladas.');

await writeFile('public/escalas-5x2/manifest.json',JSON.stringify({entry:'/'+entry[0].replace(/^public\//,''),css:'/'+css.replace(/^public\//,'')}));

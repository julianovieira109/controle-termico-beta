import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {build} from 'esbuild';

const require=createRequire(import.meta.url);
const reactPath=require.resolve('react');
const reactDomServerPath=require.resolve('react-dom/server');
const root=process.cwd();
const entry=path.join(os.tmpdir(),'simulator-render-check.tsx');
const output=path.join(os.tmpdir(),'simulator-render-check.cjs');

fs.writeFileSync(entry,`
import React from ${JSON.stringify(reactPath)};
import {renderToStaticMarkup} from ${JSON.stringify(reactDomServerPath)};
import PlanningGuide from ${JSON.stringify(path.join(root,'client/escala/components/planning-guide.tsx'))};
import JourneyPlanner from ${JSON.stringify(path.join(root,'client/escala/components/journey-planner.tsx'))};
const state={employees:[
{id:'1',name:'TESTE 1',code:'46',schedule:'06:00-11:00-12:00-14:20',shift:'1º',included:true,off1:'Dom',off2:'Seg',note:'',active:true,role:'OPERADOR'},
{id:'2',name:'TESTE 2',code:'56',schedule:'22:00-00:00-01:00-06:00',shift:'3º',included:true,off1:'Sab',off2:'Dom',note:'',active:true,role:'OPERADOR'}
],overrides:[],history:[]};
const reloadOfficial=async()=>state;
const a=renderToStaticMarkup(<PlanningGuide state={state} busy={false} reloadOfficial={reloadOfficial}/>);
const b=renderToStaticMarkup(<JourneyPlanner state={state} busy={false}/>);
if(!a.includes('Simular escala 5x2'))throw Error('PlanningGuide não renderizou');
if(!b.includes('Carga semanal'))throw Error('JourneyPlanner não renderizou');
console.log('OK: simulador renderizou',a.length,b.length);
`);
await build({entryPoints:[entry],outfile:output,bundle:true,platform:'node',format:'cjs',target:'node22',jsx:'automatic',logLevel:'silent'});
await import('file://'+output+'?v='+Date.now());

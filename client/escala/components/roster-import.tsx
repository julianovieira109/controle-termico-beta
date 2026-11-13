import {useRef} from 'react';
import {requestBackupMigration,readOnly} from '../bridge';
import type {State} from '../lib/roster';
export default function RosterImport(_props:{state:State;busy:boolean;save:(state:State,action:string)=>Promise<boolean>}){
 const input=useRef<HTMLInputElement>(null);
 return <section className="beta-import"><h2>Importar planejamento 5x2</h2><p>Selecione o backup JSON do sistema anterior. O Beta irá conferir matrícula e nome na empresa/filial selecionada antes de mostrar a prévia. Nenhum cadastro, ponto ou BH oficial será substituído.</p><button disabled={readOnly()} onClick={()=>input.current?.click()}>Conferir arquivo JSON</button><input ref={input} hidden type="file" accept=".json,application/json" onChange={event=>{const file=event.target.files?.[0];if(file)requestBackupMigration(file);event.target.value='';}}/><p>Cadastros, admitidos, demitidos e PDFs oficiais continuam em <strong>Colaboradores / Importações</strong> no menu do Controle Térmico. Recarregue esta unidade depois de atualizar o cadastro.</p></section>;
}

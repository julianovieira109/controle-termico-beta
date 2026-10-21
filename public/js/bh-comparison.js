(function(){
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const hours=n=>n===null||n===undefined?'Sem informação':`${n<0?'-':''}${Math.floor(Math.abs(n)/60)}:${String(Math.abs(n)%60).padStart(2,'0')}`;
  const date=value=>String(value||'').slice(0,10).split('-').reverse().join('/');
  const type=value=>value==='ANALYTIC'?'BH Analítico':'BH Atual (Sintético)';
  let preview=null,options=null;
  const opt=(rows,label)=>`<option value="">${label}</option>`+rows.map(r=>`<option value="${esc(r.id)}">${esc(r.trade_name||r.name||`${r.full_name} (${r.registration||'-'})`)}</option>`).join('');
  function prepareBh(){
    $('bh-company').innerHTML=opt(companies,'Selecione a empresa');
    const fill=()=>{$('bh-branch').innerHTML=opt(branches.filter(b=>b.company_id===$('bh-company').value),'Selecione a filial');clearPreview();};
    $('bh-company').onchange=fill;$('bh-branch').onchange=clearPreview;
    if(companies.length===1)$('bh-company').value=companies[0].id;
    fill();if($('bh-branch').options.length===2)$('bh-branch').selectedIndex=1;
    return history();
  }
  function clearPreview(){preview=null;$('bh-preview').hidden=true;$('bh-scope-confirmed').checked=false;}
  async function history(){
    const params=new URLSearchParams();if($('bh-company').value)params.set('companyId',$('bh-company').value);if($('bh-branch').value)params.set('branchId',$('bh-branch').value);
    const result=await api('/api/reconciliation/bh/history?'+params);
    $('bh-history').innerHTML=result.rows.length?`<div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Modelo</th><th>Empresa / filial</th><th>Datas abrangidas</th><th>Registros</th><th>Confirmado</th></tr></thead><tbody>${result.rows.map(r=>`<tr><td>${esc(r.file_name)}</td><td>${type(r.report_type)}</td><td>${esc(r.company)} / ${esc(r.branch)}</td><td>${date(r.start)} a ${date(r.end)}</td><td>${r.records}</td><td>${date(r.confirmed_at)}</td></tr>`).join('')}</tbody></table></div>`:'Nenhum BH confirmado neste filtro.';
  }
  $('bh-file').onchange=clearPreview;
  $('bh-read').onclick=async()=>{
    const button=$('bh-read');button.disabled=true;clearPreview();$('bh-status').textContent='Lendo o Banco de Horas...';
    try{
      if(!$('bh-company').value||!$('bh-branch').value)throw Error('Selecione empresa e filial.');
      const file=$('bh-file').files[0];if(!file)throw Error('Selecione o PDF.');
      const body=new FormData();body.append('companyId',$('bh-company').value);body.append('branchId',$('bh-branch').value);body.append('file',file);
      const response=await fetch('/api/reconciliation/bh/preview',{method:'POST',headers:{Authorization:`Bearer ${token}`},body});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Falha ao ler o BH.');preview=result;
      $('bh-preview').hidden=false;
      $('bh-detection').textContent=`${type(preview.type)} · ${date(preview.start)} a ${date(preview.end)} · ${preview.records.length} registros de vínculo/banco · Empresa: ${preview.companyName}.`;
      $('bh-confirm').disabled=preview.errors.length>0||Boolean(preview.confirmedAt);
      $('bh-status').textContent=preview.errors.length?`Leitura bloqueada: ${preview.errors.slice(0,5).join(' ')}`:preview.confirmedAt?'Este arquivo já foi confirmado nesta empresa/filial. Não será duplicado.':'Leitura concluída. Confira as datas de cada registro, os saldos e a filial antes de confirmar. Os cortes gerenciais não limitam a leitura.';
      $('bh-records').innerHTML=preview.records.map(r=>`<tr><td>${esc(r.registration)}</td><td>${esc(r.name)}</td><td>${esc(r.bank)}</td><td>${date(r.periodStart)} a ${date(r.periodEnd)}</td><td>${hours(r.initial)}</td><td>${hours(r.final)}</td><td>${r.events}</td><td>${r.ledgerDifference===null||r.ledgerDifference===undefined?'Saldo na data':r.ledgerDifference===0?'Fechamento confere':`Diferença no fechamento: ${hours(r.ledgerDifference)}`}</td><td>${r.page}</td></tr>`).join('');
    }catch(e){$('bh-status').textContent=e.message;}finally{button.disabled=false;}
  };
  $('bh-confirm').onclick=async()=>{
    if(!preview)return;
    if($('bh-company').value!==preview.companyId||$('bh-branch').value!==preview.branchId){clearPreview();$('bh-status').textContent='Empresa/filial alterada. Leia o PDF novamente.';return;}
    if(!$('bh-scope-confirmed').checked){$('bh-status').textContent='Confirme a filial antes de continuar.';return;}
    if(!await confirmAction('Confirmar este BH na empresa/filial selecionada? Arquivos com cobertura sobreposta serão comparados pela confirmação mais recente, sem somar revisões. Nenhum ponto será alterado.','Confirmar Banco de Horas'))return;
    const button=$('bh-confirm');button.disabled=true;
    try{
      const r=await api('/api/reconciliation/bh/confirm',{method:'POST',body:JSON.stringify({id:preview.id,companyId:preview.companyId,branchId:preview.branchId,scopeConfirmed:true})});
      $('bh-status').textContent=r.alreadyConfirmed?'Arquivo já confirmado; nenhuma duplicação.':`BH confirmado: ${r.records} registros. Compare em Ocorrências → Comparar períodos.`;
      clearPreview();$('bh-file').value='';await history();
    }catch(e){$('bh-status').textContent=e.message;button.disabled=false;}
  };
  $('bh-history-refresh').onclick=()=>history().catch(e=>{$('bh-status').textContent=e.message;});
  window.prepareBhImport=prepareBh;
  function refillFilters(){
    const company=$('period-company').value,branch=$('period-branch').value;
    $('period-branch').innerHTML=opt(options.branches.filter(r=>!company||r.company_id===company),'Todas as filiais');
    if(options.branches.some(r=>r.id===branch&&(!company||r.company_id===company)))$('period-branch').value=branch;
    refillEmployees();
  }
  function refillEmployees(){
    $('period-employee').innerHTML=opt(options.employees.filter(r=>(!$('period-company').value||r.company_id===$('period-company').value)&&(!$('period-branch').value||r.branch_id===$('period-branch').value)),'Todos os colaboradores');
  }
  let monthlyBasis='closing';
  function isoWeek(value){
    const d=new Date(Date.UTC(value.getFullYear(),value.getMonth(),value.getDate()));
    d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));
    const year=d.getUTCFullYear(),week=Math.ceil(((d-Date.UTC(year,0,1))/86400000+1)/7);
    return `${year}-W${String(week).padStart(2,'0')}`;
  }
  function modes(){
    const mode=$('period-mode').value,yearly=mode==='year',weekly=mode==='week';
    const now=new Date(),year=now.getFullYear();
    const current=$('occurrences-month').value||`${year}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const previousDate=new Date(Number(current.slice(0,4)),Number(current.slice(5,7))-2,1),previous=`${previousDate.getFullYear()}-${String(previousDate.getMonth()+1).padStart(2,'0')}`;
    if(weekly){if(!$('period-basis').disabled)monthlyBasis=$('period-basis').value;$('period-basis').value='calendar';}
    else if($('period-basis').disabled)$('period-basis').value=monthlyBasis;
    $('period-basis').disabled=weekly;
    $('period-basis').querySelector('option[value="calendar"]').textContent=weekly?'Semana: segunda a domingo':'Mês/ano calendário';
    $('period-basis-note').textContent=weekly?'Semanal: segunda a domingo.':'A base define somente o recorte gerencial.';
    const lastWeek=new Date(now);lastWeek.setDate(lastWeek.getDate()-7);
    for(const [id,value] of [['period-a',weekly?isoWeek(lastWeek):yearly?String(year-1):previous],['period-b',weekly?isoWeek(now):yearly?String(year):current]]){
      $(id).type=weekly?'week':yearly?'number':'month';$(id).value=value;
      if(yearly){$(id).min='2000';$(id).max='2100';}else{$(id).removeAttribute('min');$(id).removeAttribute('max');}
    }
  }
  $('period-open').onclick=async()=>{
    $('period-body').hidden=!$('period-body').hidden;$('period-open').setAttribute('aria-expanded',String(!$('period-body').hidden));
    $('period-open').textContent=$('period-body').hidden?'Abrir comparação':'Fechar comparação';
    if($('period-body').hidden||options)return;
    try{options=await api('/api/reconciliation/options');$('period-company').innerHTML=opt(options.companies,'Todas as empresas');refillFilters();modes();}
    catch(e){options=null;$('period-status').textContent=e.message;}
  };
  $('period-company').onchange=()=>{if(options)refillFilters();};$('period-branch').onchange=()=>{if(options)refillEmployees();};$('period-mode').onchange=modes;
  function render(data){
    const fields=[['days','Dias de ponto',false,'hasPoint'],['employees','Colaboradores no ponto',false,'hasPoint'],['workMinutes','Horas trabalhadas',true,'hasPoint'],['pointPositive','BH+ no ponto',true,'hasPoint'],['pointNegative','BH− no ponto',true,'hasPoint'],['bhPositive','Créditos no BH (origem A)',true,'hasBh'],['bhNegative','Débitos no BH (origem A)',true,'hasBh'],['balance','Saldo na data final',true,'hasBalance'],['mismatchCount','Dias com diferença de BH',false,'comparedDays']];
    const val=(s,key,time,has)=>!s[has]?'Sem informação':time?hours(s[key]):String(s[key]);
    $('period-summary').innerHTML=`<div class="table-wrap"><table><thead><tr><th>Indicador</th><th>A: ${date(data.a.range.start)} a ${date(data.a.range.end)}</th><th>B: ${date(data.b.range.start)} a ${date(data.b.range.end)}</th><th>Variação B − A</th></tr></thead><tbody>${fields.map(([key,name,time,has])=>{const known=data.a[has]&&data.b[has]&&data.a[key]!==null&&data.b[key]!==null;const diff=known?data.b[key]-data.a[key]:null;return `<tr><td>${name}</td><td>${val(data.a,key,time,has)}</td><td>${val(data.b,key,time,has)}</td><td>${diff===null?'Sem comparação':time?hours(diff):`${diff>0?'+':''}${diff}`}</td></tr>`;}).join('')}</tbody></table></div>`;
    const assessment=s=>!s.hasPoint?'Sem informação de ponto':s.mismatchCount||s.balanceMismatches.length?'Precisa conferir':!s.hasBh||s.missingBhDays||s.unvalidatedDays?'Com avisos: cobertura incompleta':'BH conferido nos dias comparáveis';
    $('period-guidance').innerHTML=`<p><strong>A: ${assessment(data.a)} · B: ${assessment(data.b)}</strong></p><h4>Assistente de conferência</h4><p class="hint">${esc(data.note)}</p>${data.guidance.map(m=>`<p>${esc(m)}</p>`).join('')}`;
    $('period-detail').innerHTML=[['A',data.a],['B',data.b]].map(([label,s])=>{
      const monthLabels=[];for(let d=s.range.start.slice(0,7)+'-01';d<=s.range.end;d=new Date(Date.UTC(Number(d.slice(0,4)),Number(d.slice(5,7)),1)).toISOString().slice(0,10))monthLabels.push(d.slice(0,7));
      return `<h4>Período ${label}: cobertura e ocorrências</h4><p>${s.days} dias de ponto; ${s.comparedDays} dias comparados com BH, ${s.matchingDays} coincidentes. Totais refletem apenas os dados disponíveis, sem garantir cobertura integral. Cada categoria conta um dia uma vez; um dia pode aparecer em várias categorias.</p>
        <p>${s.occurrences.length?s.occurrences.map(r=>`${esc(r.type)}: ${r.count} dias`).join(' · '):s.hasPoint?'Nenhuma ocorrência classificada nos dados disponíveis.':'Sem informação de ocorrências.'}</p>
        ${data.mode==='year'?`<div class="table-wrap"><table><thead><tr><th>Mês calendário</th><th>Dias</th><th>Horas</th><th>Ocorrências (registros por categoria)</th></tr></thead><tbody>${monthLabels.map(month=>{const m=s.monthly.find(r=>r.month===month);return `<tr><td>${month}</td><td>${m?m.days:'Sem informação'}</td><td>${m?m.unknownWorkDays?'Sem informação':hours(m.workMinutes):'Sem informação'}</td><td>${m?m.occurrences:'Sem informação'}</td></tr>`;}).join('')}</tbody></table></div><p class="hint">Detalhe por mês calendário, limitado ao intervalo anual escolhido; o fechamento anual pode incluir dezembro do ano anterior.</p>`:''}
        <details><summary>Diferenças de BH por colaborador e data (${s.mismatchCount})</summary><div class="table-wrap"><table><thead><tr><th>Colaborador</th><th>Data</th><th>Ponto BH+</th><th>BH crédito</th><th>Ponto BH−</th><th>BH débito</th><th>Ocorrência</th><th>Fontes</th></tr></thead><tbody>${s.mismatches.map(r=>`<tr><td>${esc(r.name)} (${esc(r.registration)})</td><td>${date(r.date)}</td><td>${hours(r.pointPositive)}</td><td>${hours(r.bhPositive)}</td><td>${hours(r.pointNegative)}</td><td>${hours(r.bhNegative)}</td><td>${esc(r.occurrence||'—')}</td><td>${esc(r.pointFile||'Ponto')} / ${r.bhSources.map(x=>`${esc(x.file)}, pág. ${x.page}, banco ${esc(x.bank)}`).join('; ')}</td></tr>`).join('')||'<tr><td colspan="8">Nenhuma diferença nos dias comparáveis. Confira a cobertura acima.</td></tr>'}</tbody></table></div></details>
        <details><summary>Conferência de saldo (${s.balanceCompared} bancos comparados)</summary><p>Saldo não é somado entre meses. Exige Sintético e Analítico terminando em ${date(s.range.end)}.</p>${s.balanceMismatches.map(r=>`<p>${esc(r.name)} (${esc(r.registration)}): Analítico ${hours(r.analytic)}, Sintético ${hours(r.synthetic)}, diferença interna do Analítico ${hours(r.ledgerDifference)}. Fontes: ${esc(r.analyticFile)} / ${esc(r.syntheticFile)}.</p>`).join('')||'<p>Nenhuma diferença nos saldos comparáveis. Saldos sem cobertura não foram validados.</p>'}</details>
        <details><summary>Arquivos usados</summary>${s.sources.map(r=>`<p>${esc(r.file)} · ${type(r.type)} · ${date(r.start)} a ${date(r.end)}</p>`).join('')||'<p>Sem BH confirmado para este intervalo.</p>'}</details>`;
    }).join('');
  }
  $('period-run').onclick=async()=>{
    const button=$('period-run');button.disabled=true;button.textContent='Comparando...';button.setAttribute('aria-busy','true');$('period-status').textContent='Comparando dados confirmados...';
    try{
      const params=new URLSearchParams();for(const key of ['mode','basis','a','b','company','branch','employee']){const apiKey={company:'companyId',branch:'branchId',employee:'employeeId'}[key]||key;if($('period-'+key).value)params.set(apiKey,$('period-'+key).value);}
      const result=await api('/api/reconciliation/compare?'+params);render(result);$('period-status').textContent='Comparação concluída. Confira a cobertura de cada período antes de interpretar as variações.';
    }catch(e){$('period-status').textContent=e.message;$('period-summary').innerHTML='';$('period-guidance').innerHTML='';$('period-detail').innerHTML='';}finally{button.disabled=false;button.textContent='Comparar períodos';button.setAttribute('aria-busy','false');}
  };
})();

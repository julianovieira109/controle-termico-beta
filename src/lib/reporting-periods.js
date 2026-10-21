// Cuts used only when extracting managerial reports. Importers preserve source dates.
function periodRange(value,mode='month',basis='closing'){
  if(!['month','year','week'].includes(mode)||!['closing','calendar'].includes(basis)){
    throw new Error('Tipo de comparação inválido.');
  }
  const input=String(value??'');
  const pattern=mode==='month'?/^\d{4}-(0[1-9]|1[0-2])$/:mode==='week'?/^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/:/^\d{4}$/;
  if(!pattern.test(input)){
    throw new Error(mode==='week'?'Selecione uma semana ISO válida (AAAA-Wss).':'Selecione mês/ano válidos para os dois períodos.');
  }
  const year=Number(input.slice(0,4));
  if(year<2000||year>2100)throw new Error('Ano fora do intervalo permitido (2000 a 2100).');
  const iso=(y,m,d)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
  if(mode==='week'){
    // ISO week 1 contains January 4. The week belongs to its Thursday's year.
    const jan4=new Date(Date.UTC(year,0,4));
    const monday=Date.UTC(year,0,4)-(jan4.getUTCDay()+6)%7*86400000;
    const start=monday+(Number(input.slice(6))-1)*7*86400000;
    if(new Date(start+3*86400000).getUTCFullYear()!==year){
      throw new Error('A semana ISO informada não existe nesse ano.');
    }
    return {label:input,start:new Date(start).toISOString().slice(0,10),end:new Date(start+6*86400000).toISOString().slice(0,10)};
  }
  const month=mode==='year'?1:Number(input.slice(5,7));
  if(basis==='closing')return {label:input,start:iso(year,month-1,19),end:iso(year,mode==='year'?12:month,18)};
  return {label:input,start:iso(year,month,1),end:iso(year,mode==='year'?13:month+1,0)};
}

module.exports={periodRange};

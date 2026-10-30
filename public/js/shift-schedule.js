(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.ShiftSchedule=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function normalizeCode(value){
    const code=String(value??'').trim();
    return /^\d{1,4}$/.test(code)?code.replace(/^0+(?=\d)/,''):null;
  }

  function canPreserveSource(value){
    const source=String(value??'').replace(/\s+/g,' ').trim()
      .replace(/(\d{2}:\d{2})(\d{2})(?=PRE)/gi,'$1 $2');
    const anchors=[...source.matchAll(/\d{2}:\d{2}(?!\d)|\d{2}:?PRE/gi)];
    if(anchors.length!==4||!anchors.some(match=>/PRE$/i.test(match[0])))return false;
    let remainder=source;
    const values=anchors.map(match=>{
      remainder=remainder.replace(match[0],' ');
      const [hour,minute]=match[0].split(':');
      return {hour:Number.parseInt(hour,10),minute:/^\d{2}$/.test(minute||'')?Number(minute):null,raw:match[0]};
    });
    if(/[\d:]/.test(remainder)||values.some(item=>item.hour>23||(item.minute!==null&&item.minute>59)))return false;
    let days=0;
    for(let index=1;index<values.length;index++){
      const previous=values[index-1],current=values[index];
      if(current.hour===previous.hour){
        if(current.minute===null||previous.minute===null||current.minute===previous.minute)return false;
        if(current.minute<previous.minute)days++;
      }else if(current.hour<previous.hour)days++;
      if(days>1||current.hour+days*24-values[0].hour>=24)return false;
    }
    return true;
  }

  function validateDescription(value){
    const rawDescription=String(value??'').trim();
    const tokens=[...rawDescription.matchAll(/\d+:\d*/g)];
    const markings=tokens.map(match=>match[0]);
    const invalid=(code,reason)=>{
      const sourceOnlyAllowed=code==='INCOMPLETE_TIME'&&canPreserveSource(rawDescription);
      return {valid:false,description:rawDescription,normalizedDescription:null,schedule:null,rawDescription,markings,reason,code,
        type:sourceOnlyAllowed?'SOURCE_ONLY':null,hasMealBreak:null,sourceOnlyAllowed,canPreserveSource:sourceOnlyAllowed};
    };
    if(rawDescription.length>180)return invalid('DESCRIPTION_TOO_LONG','A descrição do turno deve ter no máximo 180 caracteres; o texto não será cortado automaticamente.');

    // PRE identifica a pré-assinalação da Senior, mas não informa minutos
    // ausentes. Nem "12PRE" nem "13:PRE" autorizam completar ":00".
    if(/\d{2}:\d{2}\d{2}PRE|\d{1,2}:\s*PRE|(?:^|[^\d:])\d{1,2}\s*PRE/i.test(rawDescription)){
      return invalid('INCOMPLETE_TIME','O PDF omite minutos em um horário com PRE. Confira a Senior e informe todos os horários completos (HH:MM).');
    }
    if(tokens.some(match=>!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(match[0])||rawDescription[match.index+match[0].length]===':')){
      return invalid('INVALID_TIME','Há um horário inválido ou incompleto. Use HH:MM, de 00:00 a 23:59.');
    }
    if(![2,4].includes(markings.length)){
      return invalid('TIME_COUNT','Informe exatamente 2 horários (entrada e saída) ou 4 horários (entrada, saída para refeição, retorno e saída final).');
    }
    const withoutClocks=rawDescription.replace(/\d+:\d*/g,' ');
    if(/(?:^|[-/])\s*\d{1,2}\s*(?:[-/]|$)/.test(withoutClocks)){
      return invalid('INCOMPLETE_TIME','Há um horário sem minutos. Confira a Senior e informe todos os horários completos (HH:MM).');
    }
    const values=markings.map(clock=>Number(clock.slice(0,2))*60+Number(clock.slice(3)));
    let offset=0;
    for(let index=1;index<values.length;index++){
      if(values[index]===values[index-1])return invalid('DUPLICATE_TIME','Horários consecutivos iguais precisam de conferência; nenhuma jornada de 24 horas será presumida.');
      if(values[index]<values[index-1])offset+=1440;
      if(values[index]+offset-values[0]>=1440)return invalid('AMBIGUOUS_ORDER','Confira a ordem dos horários: a jornada deve ter menos de 24 horas e no máximo uma virada de dia.');
    }
    const hasMealBreak=markings.length===4;
    const normalizedDescription=hasMealBreak
      ?`${markings[0]} às ${markings[1]} / ${markings[2]} às ${markings[3]}`
      :`${markings[0]} às ${markings[1]}`;
    return {valid:true,description:rawDescription,normalizedDescription,schedule:markings.join('-'),rawDescription,markings,reason:null,code:null,
      type:hasMealBreak?'SPLIT':'CONTINUOUS',hasMealBreak,sourceOnlyAllowed:false,canPreserveSource:false};
  }

  return {normalizeCode,validateDescription,canPreserveSource};
});

function clean(value){
  return String(value||"").replace(/\s+/g," ").trim();
}

function upper(value){
  return clean(value).toUpperCase();
}

function orderedItems(items){
  return (items||[])
    .map(item=>({x:Number(item.x||0),y:Number(item.y||0),text:clean(item.text)}))
    .filter(item=>item.text)
    .sort((a,b)=>a.x-b.x);
}

function isToken(item,pattern){
  return Boolean(item&&pattern.test(upper(item.text)));
}

function detectSeniorColumnAnchors(items){
  const list=orderedItems(items);
  const found={};

  for(let i=0;i<list.length;i++){
    const item=list[i];
    const text=upper(item.text);

    if(found.W==null&&/^TRABALHO:?$/.test(text))found.W=item.x;
    if(found.HE==null&&(/^HE\s*100%:?$/.test(text)||text==="HE"))found.HE=item.x;
    if(found.F==null&&/^FALTA(S)?:?$/.test(text))found.F=item.x;
    if(found.AN==null&&(/^AD\.?\s*NOT/.test(text)||/^AD\.?$/.test(text)))found.AN=item.x;
    if(found.V==null&&/^VIAGEM(NS)?:?$/.test(text))found.V=item.x;

    if(/^BH$/.test(text)){
      const next=list[i+1];
      const nextText=upper(next?.text);
      if(next&&Math.abs(next.x-item.x)<30){
        if(found.BM==null&&nextText==="-")found.BM=item.x;
        if(found.BP==null&&nextText==="+")found.BP=item.x;
      }
    }
    if(found.BM==null&&/^BH\s*-$/.test(text))found.BM=item.x;
    if(found.BP==null&&/^BH\s*\+$/.test(text))found.BP=item.x;
  }

  // Alguns PDFs quebram "HE 100%" e "Ad. Not" em tokens separados. O X do
  // primeiro token é a âncora da coluna, então as detecções acima continuam
  // válidas. Exigimos apenas as três colunas essenciais para confiar no BH.
  if(found.W==null||found.BM==null||found.BP==null)return null;
  return found;
}

function groupPdf2JsonRows(textItems,tolerance=0.10){
  const items=(textItems||[])
    .map(item=>({x:Number(item.x||0),y:Number(item.y||0),text:clean(item.text)}))
    .filter(item=>item.text)
    .sort((a,b)=>a.y-b.y||a.x-b.x);
  const rows=[];
  for(const item of items){
    const last=rows[rows.length-1];
    if(!last||Math.abs(item.y-last.y)>tolerance){
      rows.push({y:item.y,items:[item]});
    }else{
      last.items.push(item);
      last.y=(last.y*(last.items.length-1)+item.y)/last.items.length;
    }
  }
  for(const row of rows)row.items.sort((a,b)=>a.x-b.x);
  return rows;
}

function splitSeniorRowByAnchors(items,anchors){
  const list=orderedItems(items);
  if(!anchors||anchors.W==null||anchors.BM==null||anchors.BP==null)return null;
  const keys=["W","BM","BP","HE","F","AN","V"]
    .filter(key=>anchors[key]!=null)
    .sort((a,b)=>anchors[a]-anchors[b]);
  const cols={W:"",BM:"",BP:"",HE:"",F:"",AN:"",V:""};

  // O valor de Trabalho aparece à direita do rótulo "Trabalho". Mantemos uma
  // pequena margem para que o texto da ocorrência (BH 50%, DSR etc.) permaneça
  // no lado esquerdo e nunca seja confundido com uma coluna numérica.
  const firstX=anchors.W;
  const left=list.filter(item=>item.x<firstX-0.20).map(item=>item.text).join(" ").replace(/\s+/g," ").trim();

  const boundaries=[];
  for(let i=0;i<keys.length-1;i++)boundaries.push((anchors[keys[i]]+anchors[keys[i+1]])/2);
  for(const item of list.filter(item=>item.x>=firstX-0.20)){
    let index=0;
    while(index<boundaries.length&&item.x>=boundaries[index])index++;
    const key=keys[index]||keys[keys.length-1];
    cols[key]=`${cols[key]} ${item.text}`.trim();
  }

  const firstDuration=value=>(clean(value).match(/\b\d{1,3}:\d{2}\b/)||[])[0]||"";
  return {
    left,
    cols:{
      W:firstDuration(cols.W),
      BM:firstDuration(cols.BM),
      BP:firstDuration(cols.BP),
      HE:firstDuration(cols.HE),
      F:firstDuration(cols.F),
      AN:firstDuration(cols.AN),
      V:firstDuration(cols.V)
    }
  };
}

module.exports={detectSeniorColumnAnchors,groupPdf2JsonRows,splitSeniorRowByAnchors};

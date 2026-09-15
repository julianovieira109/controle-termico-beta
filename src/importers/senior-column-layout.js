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

function validAnchorOrder(found){
  if(found.W==null||found.BM==null||found.BP==null)return false;
  if(!(found.W<found.BM&&found.BM<found.BP))return false;
  const optional=["HE","F","AN","V"].filter(k=>found[k]!=null);
  let previous=found.BP;
  for(const key of optional){
    if(found[key]<=previous)return false;
    previous=found[key];
  }
  return true;
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

  // Fallback seguro para PDFs que separam o cabeçalho em fluxos/linhas e
  // omitem o sinal como item independente. Entre Trabalho e HE/Falta existem
  // exatamente duas colunas BH no layout oficial da Senior: BH- e BH+.
  if(found.W!=null&&(found.BM==null||found.BP==null)){
    const bhItems=list.filter(item=>/^BH$/.test(upper(item.text))&&item.x>found.W);
    if(bhItems.length>=2){
      if(found.BM==null)found.BM=bhItems[0].x;
      if(found.BP==null)found.BP=bhItems[1].x;
    }
  }

  return validAnchorOrder(found)?found:null;
}

function detectSeniorColumnAnchorsFromPage(items,{yTolerance=0.85}={}){
  const list=(items||[])
    .map(item=>({x:Number(item.x||0),y:Number(item.y||0),text:clean(item.text)}))
    .filter(item=>item.text);
  if(!list.length)return null;

  const workItems=list.filter(item=>/^TRABALHO:?$/i.test(item.text));

  // Beta.65: o PDFium pode entregar todo o cabeçalho num único Text,
  // embora os valores diários continuem posicionados nas colunas oficiais.
  // Nesse layout, a coordenada X do item composto marca o início de Trabalho;
  // os demais inícios mantêm distâncias fixas no relatório A4 da Senior.
  // A conciliação posterior com os totais do rodapé permanece obrigatória.
  const compositeHeader=list.find(item=>
    /^TRABALHO\s+BH\s*-\s+BH\s*\+\s+HE\s*100%\s+FALTA(?:S)?\s+AD\.?\s*NOT\s+VIAGEM(?:NS)?$/i.test(item.text)
  );
  if(compositeHeader){
    const base=compositeHeader.x;
    const found={
      W:base,
      BM:base+2.05,
      BP:base+4.00,
      HE:base+6.20,
      F:base+8.60,
      AN:base+10.70,
      V:base+13.60
    };
    const headerBand=list.filter(item=>Math.abs(item.y-compositeHeader.y)<=1.2);
    const words=headerBand.map(item=>upper(item.text));
    const hasMarkings=words.some(text=>/^MARCA/.test(text));
    const hasDate=words.some(text=>/^DATA$/.test(text));
    const hasSem=words.some(text=>/^SEM$/.test(text));
    const hasHor=words.some(text=>/^HOR$/.test(text));
    if(validAnchorOrder(found)&&(hasMarkings||(hasDate&&hasSem&&hasHor)))return found;
  }

  for(const work of workItems){
    // pdf2json pode colocar Data/Sem/Hor/Marcações e Trabalho/BH em grupos de
    // Y ligeiramente diferentes. Trabalhamos com uma faixa vertical estreita
    // em torno de "Trabalho" sem misturar linhas de dados.
    const band=list.filter(item=>Math.abs(item.y-work.y)<=yTolerance);
    const detected=detectSeniorColumnAnchors(band);
    if(!detected)continue;

    // Confirma que estamos no cabeçalho oficial, não em texto aleatório da
    // página. É suficiente haver "Marcações" ou o conjunto Data/Sem/Hor na
    // mesma faixa vertical expandida.
    const headerBand=list.filter(item=>Math.abs(item.y-work.y)<=Math.max(1.2,yTolerance));
    const words=headerBand.map(item=>upper(item.text));
    const hasMarkings=words.some(text=>/^MARCA/.test(text));
    const hasDate=words.some(text=>/^DATA$/.test(text));
    const hasSem=words.some(text=>/^SEM$/.test(text));
    const hasHor=words.some(text=>/^HOR$/.test(text));
    if(hasMarkings||(hasDate&&hasSem&&hasHor))return detected;
  }

  // Último fallback: alguns PDFs deslocam o bloco da esquerda mais de uma
  // unidade de Y. Ainda assim exigimos a sequência física Trabalho < BH- < BH+
  // e a presença de Marcações/Data/Sem/Hor em uma faixa próxima.
  for(const work of workItems){
    const band=list.filter(item=>Math.abs(item.y-work.y)<=1.8);
    const detected=detectSeniorColumnAnchors(band);
    if(!detected)continue;
    const words=band.map(item=>upper(item.text));
    if(words.some(text=>/^MARCA/.test(text))||words.some(text=>/^DATA$/.test(text)))return detected;
  }

  // Fallback Beta.61: alguns PDFs Senior entregam os tokens do mesmo
  // cabeçalho com coordenadas Y muito diferentes. Nesse caso, detectamos a
  // estrutura pela ordem horizontal, mas somente quando a página contém a
  // assinatura completa do cabeçalho Senior. A conciliação posterior com o
  // rodapé do colaborador continua obrigatória, portanto este fallback não
  // transforma uma leitura ambígua em importação válida.
  const headerWords=list.map(item=>upper(item.text));
  const hasHeaderSignature=
    headerWords.some(text=>/^TRABALHO:?$/.test(text)) &&
    headerWords.some(text=>/^MARCA/.test(text)) &&
    headerWords.some(text=>/^DATA$/.test(text)) &&
    headerWords.some(text=>/^SEM$/.test(text)) &&
    headerWords.some(text=>/^HOR$/.test(text));

  if(hasHeaderSignature){
    for(const work of workItems){
      const right=list
        .filter(item=>item.x>work.x)
        .sort((a,b)=>a.x-b.x);
      const bh=right.filter(item=>/^BH(?:\s*[+-])?$/.test(upper(item.text)));
      if(bh.length<2)continue;

      const found={W:work.x,BM:bh[0].x,BP:bh[1].x};
      const afterBp=right.filter(item=>item.x>found.BP);
      const firstX=(pattern)=>{
        const item=afterBp.find(candidate=>pattern.test(upper(candidate.text)));
        return item?item.x:null;
      };
      found.HE=firstX(/^HE(?:\s*100%)?:?$/);
      found.F=firstX(/^FALTA(S)?:?$/);
      found.AN=firstX(/^AD\.?\s*NOT|^AD\.?$/);
      found.V=firstX(/^VIAGEM(NS)?:?$/);

      // Remove opcionais que tenham sido encontrados fora da ordem esperada.
      let previous=found.BP;
      for(const key of ["HE","F","AN","V"]){
        if(found[key]==null)continue;
        if(found[key]<=previous){delete found[key];continue;}
        previous=found[key];
      }
      if(validAnchorOrder(found))return found;
    }
  }

  return null;
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

function reconstructSeniorDailyRows(items,anchors){
  const list=(items||[])
    .map(item=>({x:Number(item.x||0),y:Number(item.y||0),text:clean(item.text)}))
    .filter(item=>item.text);
  if(!anchors||anchors.W==null)return [];

  // O pdf2json nem sempre entrega a data como um item isolado. Em alguns
  // arquivos Senior, o mesmo Text pode chegar como "01/08 SAB 0005" ou com
  // outros campos da esquerda anexados. Por isso extraímos DD/MM de qualquer
  // item à esquerda de Trabalho, preservando X/Y para reconstruir a faixa da
  // jornada sem depender do agrupamento textual do PDF.
  const dates=list
    .filter(item=>item.x<anchors.W&&/^\s*\d{2}\/\d{2}(?:\s|$)/.test(item.text))
    .map(item=>({ ...item, text:(item.text.match(/\d{2}\/\d{2}/)||[])[0]||item.text }))
    .filter(item=>/^\d{2}\/\d{2}$/.test(item.text))
    .sort((a,b)=>a.y-b.y||a.x-b.x);
  if(!dates.length)return [];

  const unique=[];
  for(const item of dates){
    const last=unique[unique.length-1];
    if(last&&last.text===item.text&&Math.abs(last.y-item.y)<0.08)continue;
    unique.push(item);
  }

  return unique.map((date,index)=>{
    const prev=unique[index-1];
    const next=unique[index+1];
    const prevGap=prev?Math.max(0.18,date.y-prev.y):(next?Math.max(0.18,next.y-date.y):0.70);
    const nextGap=next?Math.max(0.18,next.y-date.y):(prev?Math.max(0.18,date.y-prev.y):0.70);
    const top=date.y-prevGap*0.48;
    const bottom=date.y+nextGap*0.48;
    const rowItems=list
      .filter(item=>item.y>=top&&item.y<bottom)
      .sort((a,b)=>a.x-b.x||a.y-b.y);
    const split=splitSeniorRowByAnchors(rowItems,anchors);
    return {date:date.text,y:date.y,items:rowItems,split};
  }).filter(row=>row.split&&/^\d{2}\/\d{2}\b/.test(row.split.left));
}

module.exports={
  detectSeniorColumnAnchors,
  detectSeniorColumnAnchorsFromPage,
  groupPdf2JsonRows,
  splitSeniorRowByAnchors,
  reconstructSeniorDailyRows
};

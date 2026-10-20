// PDF.js is bundled by the pinned pdf-parse dependency. Read coordinates
// without rendering drawings or retaining a second raw-text copy of all pages.
const PDFJS=require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
PDFJS.disableWorker=true;

async function readSeniorPdfPages(buffer,onPage){
  const document=await PDFJS.getDocument(buffer);
  try{
    for(let index=1;index<=document.numPages;index++){
      const page=await document.getPage(index);
      try{
        const content=await page.getTextContent({normalizeWhitespace:false,disableCombineTextItems:true});
        const height=page.getViewport(1).height;
        const Texts=content.items.filter(item=>String(item.str||'').trim()).map(item=>({
          // Same coordinate units as the existing Senior column processor:
          // PDF points / 16; original text stays attached to its X/Y position.
          x:item.transform[4]/16,
          y:(height-item.transform[5])/16,
          R:[{T:encodeURIComponent(item.str)}]
        }));
        await onPage({Texts});
      }finally{page.cleanup();}
    }
  }finally{await document.destroy();}
}

module.exports={readSeniorPdfPages};

const multer=require("multer");

function createPdfUpload(limitMb=8){
  const upload=multer({
    storage:multer.memoryStorage(),
    limits:{fileSize:limitMb*1024*1024},
    fileFilter:(_req,file,cb)=>{
      if(file.mimetype!=="application/pdf"){
        return cb(Object.assign(new Error("Envie um arquivo PDF."),{status:400}));
      }
      cb(null,true);
    }
  });
  return {
    single(field){
      const parse=upload.single(field);
      return (req,res,next)=>parse(req,res,error=>{
        if(error?.code==="LIMIT_FILE_SIZE"){
          return res.status(413).json({
            error:`O PDF ultrapassa o limite de ${limitMb} MB. Exporte um arquivo menor ou divida o relatório em arquivos menores.`,
            code:"LIMIT_FILE_SIZE",limitMb
          });
        }
        next(error);
      });
    }
  };
}

module.exports={createPdfUpload};

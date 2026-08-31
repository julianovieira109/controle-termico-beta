const crypto=require("crypto");

function backupDigest(data){
  return crypto.createHash("sha256")
    .update(JSON.stringify(data??{}),"utf8")
    .digest("hex");
}

function attachIntegrity(backup){
  return {
    ...backup,
    integrity:{
      algorithm:"sha256",
      digest:backupDigest(backup?.data)
    }
  };
}

function verifyIntegrity(backup){
  const integrity=backup?.integrity;
  if(!integrity){
    return {valid:true,legacy:true,reason:"Backup anterior à V1.0.22; não possui assinatura de integridade."};
  }
  if(integrity.algorithm!=="sha256"||typeof integrity.digest!=="string"){
    return {valid:false,legacy:false,reason:"Metadados de integridade inválidos."};
  }
  const expected=backupDigest(backup?.data);
  const received=integrity.digest.toLowerCase();
  const valid=expected.length===received.length && crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(received));
  return {valid,legacy:false,reason:valid?"Integridade confirmada.":"O conteúdo do backup foi alterado ou está corrompido."};
}

module.exports={backupDigest,attachIntegrity,verifyIntegrity};

const crypto=require("crypto");

const CODE_TTL_MINUTES=15;
const MAX_CODE_ATTEMPTS=5;
const REQUEST_COOLDOWN_SECONDS=60;

function emailRecoveryConfigured(){
  return Boolean(String(process.env.RESEND_API_KEY||"").trim()&&String(process.env.PASSWORD_RESET_FROM||"").trim());
}

function turnstileConfigured(){
  return Boolean(String(process.env.TURNSTILE_SITE_KEY||"").trim()&&String(process.env.TURNSTILE_SECRET_KEY||"").trim());
}

function generateEmailResetCode(){
  return String(crypto.randomInt(0,1000000)).padStart(6,"0");
}

function emailResetCodeHash(userId,code){
  const secret=String(process.env.PASSWORD_RESET_SECRET||process.env.JWT_SECRET||"");
  return crypto.createHmac("sha256",secret).update(`${userId}:${String(code||"").trim()}`).digest("hex");
}

function safeEqualHash(left,right){
  const a=Buffer.from(String(left||""),"hex");
  const b=Buffer.from(String(right||""),"hex");
  return a.length===b.length&&a.length>0&&crypto.timingSafeEqual(a,b);
}

function escapeHtml(value){
  return String(value||"").replace(/[&<>"']/g,character=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  })[character]);
}

async function validateTurnstile(token,remoteIp){
  if(!turnstileConfigured())return true;
  if(!String(token||"").trim())return false;

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        secret:process.env.TURNSTILE_SECRET_KEY,
        response:String(token).trim(),
        remoteip:remoteIp||undefined
      }),
      signal:controller.signal
    });
    if(!response.ok)return false;
    const result=await response.json();
    return result.success===true;
  }catch(error){
    console.error("Falha ao validar proteção antirrobô:",error.message);
    return false;
  }finally{clearTimeout(timeout);}
}

async function sendPasswordResetEmail({to,name,code}){
  if(!emailRecoveryConfigured())throw new Error("Envio automático de e-mail não configurado.");

  const displayName=escapeHtml(String(name||"Usuário").trim().split(/\s+/)[0]);
  const safeCode=escapeHtml(code);
  const html=`
    <div style="margin:0;padding:32px 16px;background:#f2f6fa;font-family:Arial,sans-serif;color:#1f2937">
      <div style="max-width:520px;margin:auto;background:#fff;border:1px solid #d9e0e7;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(15,23,42,.08)">
        <div style="height:6px;background:linear-gradient(90deg,#0e3554,#154c79)"></div>
        <div style="padding:30px">
          <div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#154c79">Controle Térmico</div>
          <h1 style="margin:12px 0 8px;font-size:25px;color:#1f2937">Recuperação de acesso</h1>
          <p style="margin:0 0 18px;line-height:1.55;color:#667085">Olá, ${displayName}. Use o código abaixo para criar uma nova senha.</p>
          <div style="margin:22px 0;padding:18px;border-radius:14px;background:#eef5fb;text-align:center">
            <span style="display:block;margin-bottom:8px;font-size:11px;font-weight:700;color:#667085">SEU CÓDIGO</span>
            <strong style="font-size:32px;letter-spacing:.2em;color:#0e3554">${safeCode}</strong>
          </div>
          <p style="margin:0;line-height:1.55;color:#667085">O código é válido por ${CODE_TTL_MINUTES} minutos e pode ser utilizado uma única vez.</p>
          <p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #e4e7ec;font-size:12px;line-height:1.5;color:#98a2b3">Se você não solicitou esta recuperação, ignore este e-mail. Sua senha atual continuará válida.</p>
        </div>
      </div>
    </div>`;
  const text=`Controle Térmico\n\nOlá, ${String(name||"Usuário").trim().split(/\s+/)[0]}.\nSeu código de recuperação é: ${code}\n\nEle é válido por ${CODE_TTL_MINUTES} minutos e pode ser usado uma única vez.\nSe você não fez esta solicitação, ignore este e-mail.`;

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try{
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",
      headers:{
        Authorization:`Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type":"application/json",
        "Idempotency-Key":crypto.randomUUID()
      },
      body:JSON.stringify({
        from:process.env.PASSWORD_RESET_FROM,
        to:[to],
        subject:"Código para recuperar sua senha",
        html,
        text
      }),
      signal:controller.signal
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(result.message||`Falha ${response.status} no serviço de e-mail.`);
    return result.id||null;
  }finally{clearTimeout(timeout);}
}

module.exports={
  CODE_TTL_MINUTES,
  MAX_CODE_ATTEMPTS,
  REQUEST_COOLDOWN_SECONDS,
  emailRecoveryConfigured,
  turnstileConfigured,
  generateEmailResetCode,
  emailResetCodeHash,
  safeEqualHash,
  validateTurnstile,
  sendPasswordResetEmail
};

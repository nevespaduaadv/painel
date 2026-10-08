#!/usr/bin/env node
/* Robô de marketing — cliente de linha de comando para o usuário 'robo' (papel robo: só pautas e pedidos).
   Credenciais por variáveis de ambiente (nunca no repo): ROBO_EMAIL, ROBO_SENHA. Projeto e chave pública fixos.
   Uso:
     node ferramentas/robo-marketing.mjs contexto            → JSON: pautas recentes (60d), pilares/formatos usados, pedidos pendentes, colaborador robô
     node ferramentas/robo-marketing.mjs criar <arquivo.json> → cria pautas (array de {titulo, descricao, formato, canais, pilar, objetivo, data_prevista, legenda, hashtags}) como ideia/ia
     node ferramentas/robo-marketing.mjs atender <pedido_id> "<resposta>" [pauta_id] → marca pedido como atendido
     node ferramentas/robo-marketing.mjs comentar <pauta_id> "<texto>"   → comentário do robô na pauta */
const URL_="https://ksdwzljfjfucjevdqxvx.supabase.co";
const KEY="sb_publishable_tt__gxUjGaujzylisID0KQ_qaeaU1-l";
const [cmd,...args]=process.argv.slice(2);
const {ROBO_EMAIL,ROBO_SENHA}=process.env;
if(!ROBO_EMAIL||!ROBO_SENHA){console.error("Defina ROBO_EMAIL e ROBO_SENHA");process.exit(2)}
async function login(){
  const r=await fetch(`${URL_}/auth/v1/token?grant_type=password`,{method:"POST",headers:{apikey:KEY,"Content-Type":"application/json"},body:JSON.stringify({email:ROBO_EMAIL,password:ROBO_SENHA})});
  const j=await r.json();if(!j.access_token){console.error("Login falhou:",j.error_description||j.msg||j);process.exit(1)}return j.access_token;
}
async function api(tok,path,{method="GET",body,prefer}={}){
  const r=await fetch(`${URL_}/rest/v1/${path}`,{method,headers:{apikey:KEY,Authorization:"Bearer "+tok,"Content-Type":"application/json",...(prefer?{Prefer:prefer}:{})},body:body?JSON.stringify(body):undefined});
  const t=await r.text();let j=null;try{j=t?JSON.parse(t):null}catch(_){j=t}
  if(!r.ok){console.error("Erro",r.status,path,j);process.exit(1)}return j;
}
const tok=await login();
if(cmd==="contexto"){
  const desde=new Date(Date.now()-60*864e5).toISOString().slice(0,10);
  const [pautas,pedidos,colab]=await Promise.all([
    api(tok,`pautas?select=id,titulo,formato,canais,pilar,objetivo,status,origem,data_prevista,descricao&or=(data_prevista.gte.${desde},data_prevista.is.null)&order=data_prevista.desc.nullslast&limit=200`),
    api(tok,`marketing_pedidos?select=*&status=eq.pendente&order=created_at`),
    api(tok,`colaboradores?select=id,nome,nucleo&nucleo=eq.marketing`)]);
  const conta=(k)=>Object.entries(pautas.reduce((a,p)=>{const v=p[k]||"—";a[v]=(a[v]||0)+1;return a},{})).sort((a,b)=>b[1]-a[1]);
  console.log(JSON.stringify({hoje:new Date().toISOString().slice(0,10),pautas,pilares:conta("pilar"),formatos:conta("formato"),status:conta("status"),pedidos,colaboradores_marketing:colab,robo_id:colab.find(c=>c.nome==="Robô de marketing")?.id||null},null,1));
}else if(cmd==="criar"){
  const fs=await import("node:fs");const itens=JSON.parse(fs.readFileSync(args[0],"utf8"));
  const colab=await api(tok,`colaboradores?select=id&nome=eq.Rob%C3%B4%20de%20marketing`);const roboId=colab[0]?.id||null;
  const rows=itens.map(p=>({titulo:p.titulo,descricao:p.descricao||null,formato:p.formato||"carrossel",canais:p.canais||["instagram"],pilar:p.pilar||null,objetivo:p.objetivo||null,data_prevista:p.data_prevista||null,hora_prevista:p.hora_prevista||null,legenda:p.legenda||null,hashtags:p.hashtags||null,responsavel_id:p.responsavel_id||roboId,status:"ideia",origem:"ia"}));
  const r=await api(tok,"pautas",{method:"POST",body:rows,prefer:"return=representation"});
  console.log(JSON.stringify(r.map(x=>({id:x.id,titulo:x.titulo})),null,1));
}else if(cmd==="atender"){
  const [id,resposta,pauta]=args;
  await api(tok,`marketing_pedidos?id=eq.${id}`,{method:"PATCH",body:{status:"atendido",resposta:resposta||null,atendido_em:new Date().toISOString(),...(pauta?{pauta_id:pauta}:{})}});
  console.log("ok");
}else if(cmd==="comentar"){
  const [pauta,texto]=args;await api(tok,"pautas_comentarios",{method:"POST",body:{pauta_id:pauta,tipo:"comentario",texto}});console.log("ok");
}else{console.error("comando desconhecido");process.exit(2)}

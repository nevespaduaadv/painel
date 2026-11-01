// Envia as abas mensais desta planilha ("Controle de clientes - Financeiro") para o sistema (Supabase) a cada 10 minutos
// e também logo depois de qualquer edição. No sistema, os fechamentos alimentam Comercial → Metas do mês (contratos e
// valor por semana — só Gestão de Passivos conta) e preenchem origem/data de fechamento dos clientes.
// Instalação (uma vez): Extensões › Apps Script › cole este arquivo › Salvar › escolha a função "instalar" › Executar › autorize.
// O TOKEN vem do editor SQL do Supabase: select public.configurar_planilha_financeiro();  (rodar de novo troca o token)

const URL = "https://ksdwzljfjfucjevdqxvx.supabase.co";
const CHAVE_PUBLICAVEL = "sb_publishable_tt__gxUjGaujzylisID0KQ_qaeaU1-l";
const TOKEN = "COLE_AQUI_O_TOKEN"; // nunca commitar com o valor real
const MESES = /^(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)/i;

function sincronizar() {
  const trava = LockService.getScriptLock();
  if (!trava.tryLock(30 * 1000)) return;
  try {
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const ano = (planilha.getName().match(/20\d{2}/) || [new Date().getFullYear()])[0];
    const abas = [];
    for (const aba of planilha.getSheets()) {
      if (!MESES.test(aba.getName())) continue;
      const valores = aba.getDataRange().getDisplayValues();
      if (valores.length < 2) continue;
      const [cabecalho, ...linhas] = valores;
      abas.push({ aba: aba.getName(), cabecalho, linhas: linhas.filter((l) => String(l[0] || "").trim() !== "") });
    }
    const resposta = UrlFetchApp.fetch(`${URL}/rest/v1/rpc/sincronizar_planilha_financeiro`, {
      method: "post",
      contentType: "application/json",
      headers: { apikey: CHAVE_PUBLICAVEL, Authorization: "Bearer " + CHAVE_PUBLICAVEL },
      payload: JSON.stringify({ token: TOKEN, ano: Number(ano), abas }),
      muteHttpExceptions: true,
    });
    if (resposta.getResponseCode() >= 300) throw new Error(`Sistema respondeu ${resposta.getResponseCode()}: ${resposta.getContentText()}`);
    console.log(resposta.getContentText());
  } finally {
    trava.releaseLock();
  }
}

// gatilhos: a cada 10 minutos + ao editar (com atraso de 1 minuto para agrupar edições)
function instalar() {
  for (const t of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(t);
  ScriptApp.newTrigger("sincronizar").timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger("aoEditar").forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
  sincronizar();
}
function aoEditar() {
  const props = PropertiesService.getScriptProperties();
  const ultimo = Number(props.getProperty("ultimaEdicao") || 0);
  props.setProperty("ultimaEdicao", String(Date.now()));
  if (Date.now() - ultimo < 60 * 1000) return; // já vai sincronizar pelo gatilho de tempo
  sincronizar();
}

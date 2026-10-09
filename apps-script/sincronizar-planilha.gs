// Envia a aba "Leads" desta planilha para o CRM de Leads (Supabase) a cada 5 minutos.
// Instalação (uma vez): Extensões › Apps Script › cole este arquivo › Salvar ›
// escolha a função "instalar" › Executar › autorize. Detalhes no README do CRM.

const CRM_URL = "https://ksdwzljfjfucjevdqxvx.supabase.co";
const CRM_CHAVE_PUBLICAVEL = "sb_publishable_tt__gxUjGaujzylisID0KQ_qaeaU1-l";
const TOKEN = "COLE_AQUI_O_TOKEN"; // valor combinado com o escritório (nunca commitar)
const ABA = "Leads";

function sincronizar() {
  const trava = LockService.getScriptLock();
  if (!trava.tryLock(30 * 1000)) return; // outra execução ainda está rodando
  try {
    const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA);
    if (!aba) throw new Error(`Aba "${ABA}" não encontrada.`);
    const [cabecalho, ...linhas] = aba.getDataRange().getDisplayValues();

    const resposta = UrlFetchApp.fetch(`${CRM_URL}/rest/v1/rpc/sincronizar_planilha`, {
      method: "post",
      contentType: "application/json",
      headers: { apikey: CRM_CHAVE_PUBLICAVEL },
      payload: JSON.stringify({ token: TOKEN, cabecalho, linhas }),
      muteHttpExceptions: true,
    });
    if (resposta.getResponseCode() >= 300) {
      throw new Error(`CRM respondeu ${resposta.getResponseCode()}: ${resposta.getContentText()}`);
    }
    console.log(resposta.getContentText());
  } finally {
    trava.releaseLock();
  }
}

// Cria (ou recria) o gatilho de 5 em 5 minutos e já faz a primeira sincronização.
function instalar() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === "sincronizar")
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("sincronizar").timeBased().everyMinutes(5).create();
  sincronizar();
}

// Menu "CRM › Sincronizar agora" na planilha.
function onOpen() {
  SpreadsheetApp.getUi().createMenu("CRM").addItem("Sincronizar agora", "sincronizar").addToUi();
}

/**
 * Módulo de Diagnóstico y Reparación — Temporal.
 * Creado por el Tech Lead para auditar y reparar el sistema.
 */

// URL del despliegue activo (mismo ID, actualizado en @47 con todos los fixes)
const DEPLOYMENT_URL_ACTIVO = 'https://script.google.com/macros/s/AKfycbzypWgD-bVk4Tbs3SZ0q6r66HHozAT9XZ2qPCSlqwT0q7H2REC7prPKR4DlvI0PObEEFw/exec';

/**
 * ★ EJECUTAR ESTA FUNCIÓN ★
 * Limpia la cola de mensajes pendientes de Telegram, resetea el webhook
 * y envía un mensaje de prueba. Soluciona el throttling por timeouts repetidos.
 */
function RESET_COMPLETO() {
  console.log('[RESET] Iniciando reset completo del bot...');
  const props    = PropertiesService.getScriptProperties();
  const botToken = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId   = props.getProperty('TELEGRAM_CHAT_ID');
  const secret   = props.getProperty('WEBHOOK_SECRET');
  const apiBase  = 'https://api.telegram.org/bot' + botToken;

  // 1. Eliminar webhook actual y limpiar cola de mensajes pendientes
  const deleteResp = UrlFetchApp.fetch(
    apiBase + '/deleteWebhook?drop_pending_updates=true',
    { muteHttpExceptions: true }
  );
  console.log('[RESET] deleteWebhook: ' + deleteResp.getContentText());
  Utilities.sleep(1000);

  // 2. Actualizar WEBAPP_URL
  props.setProperty('WEBAPP_URL', DEPLOYMENT_URL_ACTIVO);

  // 3. Registrar webhook limpio
  const finalUrl = secret
    ? DEPLOYMENT_URL_ACTIVO + '?secret=' + secret
    : DEPLOYMENT_URL_ACTIVO;

  const setResp = UrlFetchApp.fetch(
    apiBase + '/setWebhook?url=' + encodeURIComponent(finalUrl) + '&drop_pending_updates=true',
    { muteHttpExceptions: true }
  );
  const setResult = JSON.parse(setResp.getContentText());
  console.log('[RESET] setWebhook: ' + JSON.stringify(setResult));

  if (setResult.ok) {
    console.log('[RESET] ✅ Webhook re-registrado correctamente');
    // 4. Verificar info del webhook
    Utilities.sleep(500);
    const infoResp = UrlFetchApp.fetch(apiBase + '/getWebhookInfo', { muteHttpExceptions: true });
    const info = JSON.parse(infoResp.getContentText()).result || {};
    console.log('[RESET] URL activa    : ' + info.url);
    console.log('[RESET] Pending upd.  : ' + info.pending_update_count);
    console.log('[RESET] Último error  : ' + (info.last_error_message || 'ninguno'));

    // 5. Mensaje de confirmación al chat
    if (chatId) {
      sendTelegramMessage(chatId,
        '✅ <b>Bot reseteado correctamente</b>\n\n' +
        'Cola de mensajes limpiada.\n' +
        'Webhook re-registrado en despliegue @47.\n\n' +
        'Prueba enviando: <i>hice un gasto de 3mil en un terremoto</i>');
    }
  } else {
    console.error('[RESET] ❌ Error: ' + JSON.stringify(setResult));
  }
}

/**
 * Alias por compatibilidad — ahora llama a RESET_COMPLETO.
 */
function FIX_WEBHOOK_V43() {
  RESET_COMPLETO();
}

/**
 * Diagnóstico completo: propiedades, webhook info, test Gemini, test Sheet.
 * Ejecutar después de FIX_WEBHOOK_V43 para confirmar que todo está bien.
 */
function DIAGNOSTICO_COMPLETO() {
  console.log('═══════════════════════════════════════════════════');
  console.log('DIAGNÓSTICO — ' + new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' }));
  console.log('═══════════════════════════════════════════════════');

  const props = PropertiesService.getScriptProperties();

  // 1. Propiedades críticas
  console.log('\n--- [1] PROPIEDADES ---');
  const botToken   = props.getProperty('TELEGRAM_BOT_TOKEN');
  const chatId     = props.getProperty('TELEGRAM_CHAT_ID');
  const webhookUrl = props.getProperty('WEBAPP_URL');
  const secret     = props.getProperty('WEBHOOK_SECRET');
  const geminiKey  = props.getProperty('GEMINI_API_KEY');
  const sheetId    = props.getProperty('SHEET_ID');

  console.log('TELEGRAM_BOT_TOKEN : ' + (botToken  ? '✅ presente' : '❌ FALTA'));
  console.log('TELEGRAM_CHAT_ID   : ' + (chatId    ? '✅ ' + chatId : '❌ FALTA'));
  console.log('WEBAPP_URL         : ' + (webhookUrl || '❌ FALTA'));
  console.log('WEBHOOK_SECRET     : ' + (secret    ? '✅ presente' : '⚠️  no configurado'));
  console.log('GEMINI_API_KEY     : ' + (geminiKey ? '✅ presente' : '❌ FALTA'));
  console.log('SHEET_ID           : ' + (sheetId   ? '✅ ' + sheetId : '❌ FALTA'));

  // 2. Estado del webhook en Telegram
  console.log('\n--- [2] WEBHOOK INFO ---');
  try {
    const url  = 'https://api.telegram.org/bot' + botToken + '/getWebhookInfo';
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const wh   = JSON.parse(resp.getContentText()).result || {};
    console.log('URL activa         : ' + (wh.url || '(vacía — webhook no configurado)'));
    console.log('Pending updates    : ' + (wh.pending_update_count || 0));
    console.log('Último error       : ' + (wh.last_error_message || 'ninguno'));

    const expectedUrl = secret ? DEPLOYMENT_URL_V43 + '?secret=' + secret : DEPLOYMENT_URL_V43;
    if (!wh.url) {
      console.error('❌ Webhook vacío — el bot no puede recibir mensajes');
    } else if (wh.url !== expectedUrl) {
      console.warn('⚠️  Webhook apunta a URL diferente al despliegue @43');
      console.warn('   Actual   : ' + wh.url);
      console.warn('   Esperada : ' + expectedUrl);
    } else {
      console.log('✅ Webhook apunta al despliegue @43 correctamente');
    }
  } catch (e) {
    console.error('Error consultando webhook: ' + e.message);
  }

  // 3. Test Gemini con el mensaje problemático
  console.log('\n--- [3] TEST GEMINI ---');
  try {
    const testMsg = 'hice un gasto de 13mil en un mes de ps plus';
    console.log('Mensaje: "' + testMsg + '"');
    const resultado = parseMessageWithGemini(testMsg);
    const acciones  = resultado.acciones || [];
    console.log('Acciones detectadas: ' + acciones.length);
    acciones.forEach(function(a) {
      console.log('  → tipo=' + a.tipo + ' | subtipo=' + a.subtipo +
                  ' | monto=' + a.monto + ' | categoria=' + a.categoria +
                  ' | descripcion=' + a.descripcion);
    });
    if (acciones.length === 0) {
      console.error('❌ Gemini devolvió 0 acciones — problema de clasificación');
    }
  } catch (e) {
    console.error('Error Gemini: ' + e.message);
  }

  // 4. Test escritura en Sheet
  console.log('\n--- [4] TEST SHEET ---');
  try {
    const ss    = SpreadsheetApp.openById(sheetId);
    const hojas = ss.getSheets().map(function(s) { return s.getName(); });
    console.log('Hojas disponibles: ' + hojas.join(', '));
    const gastosSheet = ss.getSheetByName('Gastos');
    console.log('Hoja Gastos: ' + (gastosSheet ? '✅ existe. Filas: ' + gastosSheet.getLastRow() : '⚠️  no existe aún'));
  } catch (e) {
    console.error('Error accediendo Sheet: ' + e.message);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('FIN DIAGNÓSTICO');
  console.log('═══════════════════════════════════════════════════');
}

/**
 * Simula el flujo completo end-to-end y te avisa por Telegram si funcionó.
 */
function TEST_GASTO_END_TO_END() {
  const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  try {
    const accion = { tipo: 'FINANZAS', subtipo: 'GASTO', categoria: 'Personal',
                     descripcion: 'Suscripción PS Plus (1 mes) [TEST]', monto: 13000 };
    const res = registrarFinanzas(accion, new Date());
    console.log('Resultado: ' + JSON.stringify(res));
    if (chatId) {
      sendTelegramMessage(chatId, (res.ok ? '✅ TEST OK:\n' : '❌ TEST FALLÓ:\n') + res.mensaje);
    }
  } catch (e) {
    console.error('Error test end-to-end: ' + e.message);
    if (chatId) sendTelegramMessage(chatId, '❌ TEST ERROR: ' + e.message);
  }
}

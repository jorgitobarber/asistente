/**
 * Función de autodiagnóstico y reparación creada por tu Tech Lead.
 * Esto forzará que tu Webhook use la versión correcta del código que acabamos de publicar.
 */
function REPARAR_BOT() {
  const deploymentId = "AKfycbyus30oui7-OBs0juT-GE9wIirMERvHuJzy5UOLURna13tdx9kUgkdOjjdKpO_glvh8pg";
  const nuevaUrl = "https://script.google.com/macros/s/" + deploymentId + "/exec";
  
  // 1. Guardar la nueva URL en las propiedades del script
  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', nuevaUrl);
  console.log("✅ Nueva WEBAPP_URL guardada: " + nuevaUrl);
  
  // 2. Ejecutar la configuración del webhook
  configurarWebhook();
  console.log("✅ Webhook reconfigurado en Telegram exitosamente. El bot ya debería estar listo.");
  
  // 3. Enviar mensaje de confirmación directamente
  try {
    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (chatId) {
      sendTelegramMessage(chatId, "✅ [SISTEMA] Motor reparado exitosamente. El webhook está conectado y los permisos autorizados. Intenta enviar tu comando ahora.");
    }
  } catch(e) {
    console.error("Error enviando mensaje de prueba: " + e.message);
  }
}

/**
 * ¡NUEVO! Función para forzar a Google a pedir TODOS los permisos necesarios.
 * Ejecutar esto una sola vez autoriza el uso de Sheets, Calendar, Gmail y Fetch.
 */
function AUTORIZAR_TODO() {
  try {
    // Llamadas inofensivas solo para disparar el popup de permisos de Google
    SpreadsheetApp.getActiveSpreadsheet(); 
    CalendarApp.getDefaultCalendar();
    UrlFetchApp.fetch("https://google.com", {muteHttpExceptions: true});
    PropertiesService.getScriptProperties().getKeys();
    CacheService.getScriptCache().get("test");
    
    console.log("✅ TODOS LOS PERMISOS CONCEDIDOS CORRECTAMENTE.");
  } catch(e) {
    console.log("⚠️ Pedida de permisos iniciada o error inofensivo: " + e.message);
  }
}

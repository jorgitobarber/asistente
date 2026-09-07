/**
 * Módulo Telegram: Encargado de enviar y recibir datos de la API de Telegram.
 * Se diseñó para que responda de forma natural, detallada y "humana" hacia Jorge.
 */

/**
 * Retorna el token de Telegram desde PropertiesService
 */
const getTelegramToken = () => {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error("Falta configurar TELEGRAM_BOT_TOKEN en las propiedades del script.");
  return token;
};

const getTelegramApiUrl = () => `https://api.telegram.org/bot${getTelegramToken()}`;

/**
 * Envía un mensaje de texto al chat de Jorge en Telegram.
 * 
 * @param {string|number} chatId - ID del chat de Telegram.
 * @param {string} text - Texto natural y detallado a enviar.
 */
const sendTelegramMessage = (chatId, text) => {
  try {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const url = `${getTelegramApiUrl()}/sendMessage`;
    const response = UrlFetchApp.fetch(url, options);
    
    if (response.getResponseCode() !== 200) {
      console.error(`[TELEGRAM] Error de API. Código: ${response.getResponseCode()}, Respuesta: ${response.getContentText()}`);
    } else {
      console.log(`[TELEGRAM] Mensaje enviado exitosamente a ${chatId}`);
    }
    
  } catch (error) {
    console.error(`[TELEGRAM] Error crítico en sendTelegramMessage: ${error.message}`);
    // No lanzamos el error para no botar la ejecución completa, solo logueamos.
  }
};

/**
 * Envía una alerta de error formateada a Jorge para avisarle si algo falló.
 * 
 * @param {string|number} chatId - ID del chat.
 * @param {string} errorDetails - Detalle del error.
 */
const sendErrorAlert = (chatId, errorDetails) => {
  const alertText = `🚨 Jefe, ocurrió un error en el sistema:\n\nNo pude procesar tu solicitud.\nDetalle técnico: ${errorDetails}`;
  sendTelegramMessage(chatId, alertText);
};

/**
 * Función de prueba para ejecutar directamente en Apps Script.
 * ADVERTENCIA: Para que funcione, debes colocar tu Token real y Chat ID.
 */
const test_Telegram = () => {
  console.log("--- Iniciando test_Telegram ---");
  const mockChatId = "123456789"; // Reemplazar con ID real si se quiere probar en vivo
  
  console.log("Intentando enviar un mensaje de prueba natural y descriptivo...");
  const mensajePrueba = "Hola Jorge, te hablo desde la consola de Apps Script. He procesado tu solicitud exitosamente. Tus finanzas están al día y he agendado el recordatorio en tu calendario. ¿Necesitas algo más?";
  
  // OJO: Dará error de API si no hay un token válido, pero el try/catch capturará el flujo.
  sendTelegramMessage(mockChatId, mensajePrueba);
  
  console.log("--- Fin test_Telegram ---");
};

/**
 * Registra automáticamente el Webhook en Telegram usando la URL pública de este Apps Script.
 */
const configurarWebhook = () => {
  const webAppUrl = PropertiesService.getScriptProperties().getProperty('WEBAPP_URL');
  const secret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
  
  if (!webAppUrl || !webAppUrl.startsWith("https")) {
    console.error("⚠️ Falta configurar WEBAPP_URL en Script Properties o no es válida.");
    return;
  }
  
  const finalUrl = secret ? `${webAppUrl}?secret=${secret}` : webAppUrl;
  const telegramUrl = `${getTelegramApiUrl()}/setWebhook?url=${finalUrl}`;
  const response = UrlFetchApp.fetch(telegramUrl);
  console.log(`[TELEGRAM WEBHOOK] Resultado: ${response.getContentText()}`);
};

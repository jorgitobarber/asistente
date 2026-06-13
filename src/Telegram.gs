/**
 * Módulo Telegram: Encargado de enviar y recibir datos de la API de Telegram.
 * Se diseñó para que responda de forma natural, detallada y "humana" hacia Jorge.
 */

const TELEGRAM_BOT_TOKEN = "8644658336:AAE24l16yozHRUrsNlhw6v2GteXv9u3-5zE"; // Se reemplazará luego por PropertiesService
const TELEGRAM_API_URL = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

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
      text: text
    };
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    const url = `${TELEGRAM_API_URL}/sendMessage`;
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

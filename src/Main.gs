/**
 * Módulo Main: Punto de entrada principal para el Webhook de Telegram.
 * Controla el flujo completo: Idempotencia -> Gemini -> Enrutador (Finanzas/Agenda) -> Respuesta a Telegram.
 * Todo envuelto en un manejador de errores global.
 */

/**
 * Función requerida por Apps Script para manejar peticiones POST (Webhook).
 */
const doPost = (e) => {
  let chatId = null; // Lo declaramos arriba para poder usarlo en el catch
  
  try {
    // 1. Validar que la petición tenga datos
    if (!e || !e.postData || !e.postData.contents) {
      console.error("[MAIN] Petición POST vacía o inválida recibida.");
      return HtmlService.createHtmlOutput("OK"); // Respondemos OK a Telegram para que no reintente
    }

    const payload = JSON.parse(e.postData.contents);
    
    // Capturamos message normal o message editado
    const messageData = payload.message || payload.edited_message;
    
    if (!messageData) {
      console.log("[MAIN] Payload no contiene message. Ignorando.");
      return HtmlService.createHtmlOutput("OK");
    }

    chatId = messageData.chat.id;
    const updateId = payload.update_id;
    
    // Extraemos texto o ignoramos
    const userText = messageData.text || messageData.caption || "";

    if (!userText) {
      console.log("[MAIN] Mensaje sin texto, se ignora por ahora.");
      return HtmlService.createHtmlOutput("OK");
    }

    // 2. Control de Idempotencia (Evitar duplicados)
    if (!isNewTelegramMessage(updateId)) {
      // Es un duplicado, ignoramos silenciosamente
      return HtmlService.createHtmlOutput("OK");
    }

    console.log(`[MAIN] Procesando nuevo mensaje de ${chatId}: "${userText.substring(0, 50)}..."`);

    // 3. Procesamiento NLP con Gemini
    const geminiResult = parseMessageWithGemini(userText);
    const acciones = geminiResult.acciones || [];
    const respuestaParaJorge = geminiResult.respuesta_telegram || "Procesado correctamente jefe.";

    // 4. Enrutador de Acciones
    const fechaActual = new Date();
    
    for (const accion of acciones) {
      if (accion.tipo === "FINANZAS") {
        registrarFinanzas(accion, fechaActual);
      } else if (accion.tipo === "AGENDA") {
        procesarAgenda(accion);
      } else {
        console.warn(`[MAIN] Tipo de acción desconocida: ${accion.tipo}`);
      }
    }

    // 5. Responder a Jorge en Telegram (Confirmación natural)
    sendTelegramMessage(chatId, respuestaParaJorge);

    // Confirmar a la API de Telegram que todo fue bien
    return HtmlService.createHtmlOutput("OK");

  } catch (error) {
    console.error(`[MAIN] ERROR CRÍTICO: ${error.message}\nStack: ${error.stack}`);
    
    // Si logramos capturar el chatId antes del error, le avisamos a Jorge
    if (chatId) {
      sendErrorAlert(chatId, error.message);
    }
    
    // A pesar del error, respondemos 200 OK a Telegram para detener los reintentos en bucle.
    return HtmlService.createHtmlOutput("OK");
  }
};

/**
 * Función de prueba local (Simula lo que hace Telegram al llamar al Webhook)
 */
const test_Main = () => {
  console.log("--- Iniciando test_Main ---");
  const mockPostEvent = {
    postData: {
      contents: JSON.stringify({
        update_id: 999999,
        message: {
          chat: { id: "123456" },
          text: "Gasté 5 lucas en café para la barbería"
        }
      })
    }
  };
  
  // Ejecutamos la función como si fuéramos Telegram
  const response = doPost(mockPostEvent);
  console.log(`Respuesta HTTP al Webhook: ${response.getContent()}`);
  console.log("--- Fin test_Main ---");
};

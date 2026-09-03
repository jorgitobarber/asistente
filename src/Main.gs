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
    // 0. Validación de origen del Webhook
    const expectedSecret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (expectedSecret && (!e || !e.parameter || e.parameter.secret !== expectedSecret)) {
      console.warn("[MAIN] Petición ignorada: Token secreto inválido o ausente.");
      return HtmlService.createHtmlOutput("OK");
    }

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
    // Acciones que aún mandan su propio mensaje internamente (pendientes de migrar)
    const ACCIONES_LEGACY = new Set([
      'AGENDAR_CITA','CONFIRMAR_VISITA','INASISTENCIA','REAGENDAR_CITA',
      'VENTA_PRODUCTO','REABASTECER','REPORTE','CLIENTES', 'MARCAR_PAGADO'
    ]);
    
    let accionLegacyEjecutada = false;
    let mensajesConsolidados = [];

    for (const accion of acciones) {
      let res = null;
      
      if (ACCIONES_LEGACY.has(accion.tipo)) {
        accionLegacyEjecutada = true;
      }

      if (accion.tipo === "FINANZAS") {
        res = registrarFinanzas(accion, fechaActual);
      } else if (accion.tipo === "AGENDA") {
        res = procesarAgenda(accion);
      } else if (accion.tipo === "REPORTE") {
        if (accion.subtipo === "AGENDA") {
          res = generarReporteAgendaBajoDemanda(accion, chatId);
        } else {
          res = generarReporteBajoDemanda(accion, chatId);
        }
      } else if (accion.tipo === "TODO") {
        res = procesarToDo(accion);
      } else if (accion.tipo === "CLIENTES") {
        if (accion.subtipo === "CONTACTOS_CONFIRMADO") {
          res = procesarContactosConfirmados(chatId);
        }
      } else if (accion.tipo === "AGENDAR_CITA") {
        res = agendarCita(accion, chatId);
      } else if (accion.tipo === "CONFIRMAR_VISITA") {
        res = confirmarVisita(accion, chatId);
      } else if (accion.tipo === "MARCAR_PAGADO") {
        res = marcarVisitaPagada(accion, chatId);
      } else if (accion.tipo === "INASISTENCIA") {
        res = registrarInasistencia(accion, chatId);
      } else if (accion.tipo === "REAGENDAR_CITA") {
        res = reagendarCita(accion, chatId);
      } else if (accion.tipo === "VENTA_PRODUCTO") {
        res = registrarVentaProductoDirecta(accion, chatId);
      } else if (accion.tipo === "REABASTECER") {
        res = reabastecer(accion, chatId);
      } else if (accion.tipo === "RECORDATORIO") {
        res = agregarRecordatorio(accion, chatId);
      } else {
        console.warn(`[MAIN] Tipo de acción desconocida: ${accion.tipo}`);
        res = { ok: false, mensaje: `⚠️ Acción desconocida: ${accion.tipo}` };
      }
      
      if (res && res.mensaje) {
        mensajesConsolidados.push(res.mensaje);
      }
    }

    // 5. Responder a Jorge
    if (mensajesConsolidados.length > 0) {
      // Enviamos el consolidado de las acciones nuevas (TODO, RECORDATORIO, etc)
      sendTelegramMessage(chatId, mensajesConsolidados.join("\n\n"));
    } else if (!accionLegacyEjecutada) {
      // Fallback genérico de Gemini para flujos no cubiertos ni legacy
      sendTelegramMessage(chatId, respuestaParaJorge);
    }

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
    parameter: { secret: PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET') },
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

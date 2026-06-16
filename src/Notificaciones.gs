/**
 * Módulo Notificaciones: Maneja las rutinas automáticas (cron)
 * como el resumen matutino y los cierres financieros, además
 * de los reportes solicitados bajo demanda.
 */

/**
 * Función que se ejecutará todos los días a las 7:30 AM aprox
 */
const enviarResumenMatutino = () => {
  try {
    const hoy = new Date();
    const calendarios = [
      getCalendarId('CALENDAR_UNI_ID'),
      getCalendarId('CALENDAR_BARBERIA_ID'),
      getCalendarId('CALENDAR_COMPROMISOS_ID')
    ];
    
    let resumenEventos = "";
    calendarios.forEach(id => {
      const cal = id ? CalendarApp.getCalendarById(id) : null;
      if (cal) {
        const events = cal.getEventsForDay(hoy);
        events.forEach(e => {
          const start = e.getStartTime();
          const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
          resumenEventos += `- ${hora}: ${e.getTitle()}\n`;
        });
      }
    });

    if (resumenEventos === "") {
      resumenEventos = "No tienes eventos programados para hoy. ¡Día libre!";
    }

    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (!chatId) {
      console.error("Falta TELEGRAM_CHAT_ID en PropertiesService.");
      return;
    }

    const prompt = `Hoy es ${hoy.toLocaleDateString()}. Redacta un mensaje motivacional de buenos días para Jorge (estudiante de ingeniería y dueño de barbería). Aquí está su agenda del día:\n${resumenEventos}\n\nEscribe un mensaje final amigable, corto, útil y usando emojis.`;
    
    const respuestaGemini = _pedirTextoAGemini(prompt);
    sendTelegramMessage(chatId, respuestaGemini);
    
  } catch (error) {
    console.error(`[NOTIFICACIONES] Error matutino: ${error.message}`);
  }
};

/**
 * Función auxiliar para pedir texto libre a Gemini
 */
const _pedirTextoAGemini = (prompt) => {
  const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "text/plain" }
  };
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(`${GEMINI_API_URL}?key=${getGeminiApiKey()}`, options);
  if (response.getResponseCode() === 200) {
    const data = JSON.parse(response.getContentText());
    return data.candidates[0].content.parts[0].text;
  }
  return "Jefe, tuve un problema generando el resumen, pero que tengas un excelente día.";
};

/**
 * Cálculos financieros en un rango de fechas
 */
const _calcularFinanzasRango = (sheet, dateStart, dateEnd) => {
  if (!sheet) return { ingresos: 0, gastos: 0 };
  const data = sheet.getDataRange().getValues();
  let ingresos = 0, gastos = 0;
  
  // Normalizar horas al límite para comparar
  dateStart.setHours(0,0,0,0);
  dateEnd.setHours(23,59,59,999);
  
  for (let i = 1; i < data.length; i++) { // Salta la fila 1 (encabezados)
    const rowDateStr = data[i][0];
    let rowFecha;
    
    // Intentar parsear "DD/MM/YYYY"
    if (typeof rowDateStr === 'string' && rowDateStr.includes('/')) {
      const parts = rowDateStr.split(' ')[0].split(/[\/\-]/);
      if (parts[0].length === 2 && parts[2].length === 4) {
        rowFecha = new Date(`${parts[2]}-${parts[1]}-${parts[0]}T12:00:00`);
      } else {
        rowFecha = new Date(rowDateStr);
      }
    } else {
      rowFecha = new Date(rowDateStr);
    }
    
    if (isNaN(rowFecha.getTime())) continue;
    
    if (rowFecha >= dateStart && rowFecha <= dateEnd) {
      const tipo = data[i][1];
      const monto = parseFloat(data[i][2]) || 0;
      if (tipo === "INGRESO") ingresos += monto;
      if (tipo === "GASTO") gastos += monto;
    }
  }
  return { ingresos, gastos };
};

const _enviarCierreFinanciero = (tipo) => {
  try {
    const sheetId = getSheetId();
    const ss = SpreadsheetApp.openById(sheetId);
    const hoy = new Date();
    
    let dateStart = new Date();
    let dateEnd = new Date();
    
    if (tipo === "semanal") {
      dateStart.setDate(hoy.getDate() - 7);
    }

    const fb = _calcularFinanzasRango(ss.getSheetByName("Finanzas_Barberia"), dateStart, dateEnd);
    const fd = _calcularFinanzasRango(ss.getSheetByName("Finanzas_Decants"), dateStart, dateEnd);
    
    const ingresosTotal = fb.ingresos + fd.ingresos;
    const gastosTotal = fb.gastos + fd.gastos;
    const balance = ingresosTotal - gastosTotal;
    
    const prompt = `Eres el asistente de Jorge. Redacta su Cierre Financiero ${tipo.toUpperCase()}.
Sus Ingresos fueron: $${ingresosTotal}. Sus Gastos: $${gastosTotal}. Su Balance (Utilidad): $${balance}.
Escribe un reporte súper amigable, útil, corto y con emojis felicitándolo si es positivo o motivándolo si es negativo.`;

    const respuestaGemini = _pedirTextoAGemini(prompt);
    
    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (chatId) sendTelegramMessage(chatId, respuestaGemini);
  } catch(error) {
    console.error(`[NOTIFICACIONES] Error financiero: ${error.message}`);
  }
};

const enviarCierreDiario = () => _enviarCierreFinanciero("diario");
const enviarCierreSemanal = () => _enviarCierreFinanciero("semanal");

/**
 * Genera un reporte bajo demanda pedido por Telegram
 */
const generarReporteBajoDemanda = (accion, chatId) => {
  try {
    const sheetId = getSheetId();
    const ss = SpreadsheetApp.openById(sheetId);
    
    const dateStart = new Date(`${accion.fecha_inicio}T12:00:00`);
    const dateEnd = new Date(`${accion.fecha_fin}T12:00:00`);
    
    const fb = _calcularFinanzasRango(ss.getSheetByName("Finanzas_Barberia"), dateStart, dateEnd);
    const fd = _calcularFinanzasRango(ss.getSheetByName("Finanzas_Decants"), dateStart, dateEnd);
    
    const ingresosTotal = fb.ingresos + fd.ingresos;
    const gastosTotal = fb.gastos + fd.gastos;
    const balance = ingresosTotal - gastosTotal;
    
    const prompt = `Jorge te ha pedido un reporte financiero desde ${accion.fecha_inicio} hasta ${accion.fecha_fin}.
Ingresos: $${ingresosTotal}. Gastos: $${gastosTotal}. Balance: $${balance}.
Escribe una respuesta corta y amigable a Jorge dándole estos números, usando emojis.`;

    const respuestaGemini = _pedirTextoAGemini(prompt);
    sendTelegramMessage(chatId, respuestaGemini);

  } catch (error) {
    console.error(`[NOTIFICACIONES] Error reporte demanda: ${error.message}`);
    throw error;
  }
};

/**
 * Ejecutar esta función MANUALMENTE desde el editor de Apps Script UNA SOLA VEZ para instalar los Triggers
 */
const configurarTriggers = () => {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    ScriptApp.deleteTrigger(t);
  }
  
  ScriptApp.newTrigger('enviarResumenMatutino').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('enviarCierreDiario').timeBased().everyDays(1).atHour(22).create();
  ScriptApp.newTrigger('enviarCierreSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(22).create();
    
  console.log("¡Triggers instalados correctamente! El bot enviará notificaciones por sí solo.");
};

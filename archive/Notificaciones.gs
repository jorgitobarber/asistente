/**
 * Módulo Notificaciones: Maneja rutinas automáticas y reportes.
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
    if (data.candidates && data.candidates[0].content.parts[0].text) {
        return data.candidates[0].content.parts[0].text;
    }
  }
  return "Jefe, tuve un problema generando el texto, pero que tengas un excelente día.";
};

const _getEventsString = (calendarId, date, endDate) => {
  if (!calendarId) return "";
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return "";
  const events = endDate ? cal.getEvents(date, endDate) : cal.getEventsForDay(date);
  let str = "";
  events.forEach(e => {
    const start = e.getStartTime();
    const hora = `${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')}`;
    str += `- ${hora} (Día ${start.getDate()}): ${e.getTitle()}\n`;
  });
  return str;
};

const enviarResumenMatutino = () => {
  try {
    const hoy = new Date();
    const agendaUni = _getEventsString(getCalendarId('CALENDAR_UNI_ID'), hoy);
    const agendaBarberia = _getEventsString(getCalendarId('CALENDAR_BARBERIA_ID'), hoy);
    const agendaCompromisos = _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), hoy);
    
    let tareasPendientes = "";
    try {
      const sheet = _getToDoSheet();
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][3].toString().toLowerCase() === "pendiente") {
          tareasPendientes += `- [${data[i][1]}] ${data[i][2]}\n`;
        }
      }
    } catch(e) {}

    const prompt = `Hoy es ${hoy.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}. Eres el asistente de Jorge (estudiante y barbero).
Crea un resumen de buenos días organizado por estas categorías:
✂️ Clientes Barbería:
${agendaBarberia || "Sin clientes hoy 🙌"}
🎓 Universidad:
${agendaUni || "Sin eventos universitarios"}
📌 Compromisos:
${agendaCompromisos || "Sin compromisos personales"}
✅ Tareas Pendientes:
${tareasPendientes || "Sin tareas pendientes"}

Hazlo motivacional, amigable, relajado y con emojis.`;

    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (chatId) sendTelegramMessage(chatId, _pedirTextoAGemini(prompt));
    
  } catch (error) {
    console.error(`[NOTIFICACIONES] Error matutino: ${error.message}`);
  }
};

const _calcularFinanzasRango = (ss, dateStart, dateEnd) => {
  let ingresos = 0, gastos = 0, clientes = 0;
  
  dateStart.setHours(0,0,0,0);
  dateEnd.setHours(23,59,59,999);
  
  const parseRowDate = (rowDateStr) => {
    let rowFecha;
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
    return rowFecha;
  };

  const processSheet = (name, type) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      const rowFecha = parseRowDate(data[i][0]);
      if (isNaN(rowFecha.getTime())) continue;
      if (rowFecha >= dateStart && rowFecha <= dateEnd) {
        const monto = parseFloat(type === 'clientes' ? data[i][5] : data[i][3]) || 0;
        if (type === 'ingreso') ingresos += monto;
        if (type === 'gasto') gastos += monto;
        if (type === 'clientes') { ingresos += monto; clientes++; }
      }
    }
  };

  processSheet('Ingresos', 'ingreso');
  processSheet('Gastos', 'gasto');
  processSheet('Clientes_del_dia', 'clientes');
  
  return { ingresos, gastos, clientes, balance: ingresos - gastos };
};

const enviarCierreDiario = () => {
  try {
    const hoy = new Date();
    const manana = new Date(hoy);
    manana.setDate(manana.getDate() + 1);
    
    const enUnaSemana = new Date(hoy);
    enUnaSemana.setDate(enUnaSemana.getDate() + 7);

    const ss = SpreadsheetApp.openById(getSheetId());
    
    // 1. Barbería hoy vs reportados
    const agendaBarberiaHoy = _getEventsString(getCalendarId('CALENDAR_BARBERIA_ID'), hoy);
    let reportados = 0;
    try {
      const sheetC = ss.getSheetByName('Clientes_del_dia');
      if (sheetC) {
        const data = sheetC.getDataRange().getValues();
        const hoyStr = hoy.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
        for (let i=1; i<data.length; i++) {
          if (data[i][0] === hoyStr) reportados++;
        }
      }
    } catch(e) {}
    
    // Finanzas del día
    const finanzasDia = _calcularFinanzasRango(ss, new Date(hoy), new Date(hoy));
    
    // Preview de mañana
    let tareasPendientesManana = "";
    try {
      const sheet = _getToDoSheet();
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][3].toString().toLowerCase() === "pendiente") {
          tareasPendientesManana += `- [${data[i][1]}] ${data[i][2]}\n`;
        }
      }
    } catch(e) {}

    const agendaManana = 
      _getEventsString(getCalendarId('CALENDAR_BARBERIA_ID'), manana) +
      _getEventsString(getCalendarId('CALENDAR_UNI_ID'), manana) +
      _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), manana) +
      tareasPendientesManana;
      
    // Alerta de semana
    const agendaSemana = 
      _getEventsString(getCalendarId('CALENDAR_UNI_ID'), manana, enUnaSemana) +
      _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), manana, enUnaSemana);

    const prompt = `Redacta el mensaje de Cierre de las 10:30 PM para Jorge. Estructura:
Parte 1 - Barbería: Tenía agendado hoy:\n${agendaBarberiaHoy || "Nada"}\nY reportó ${reportados} clientes hoy. Pregúntale si faltó alguno o si todo ok.
Resumen hoy: Clientes: ${finanzasDia.clientes}, Ingresos: $${finanzasDia.ingresos}, Gastos: $${finanzasDia.gastos}, Balance: $${finanzasDia.balance}.
Parte 2 - Previa de mañana: ${agendaManana || "Día libre"}
Parte 3 - Alerta de la semana (próximos 7 días excluyendo barbería): ${agendaSemana || "Nada relevante"}
Hazlo súper conversacional y amigable.`;

    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (chatId) sendTelegramMessage(chatId, _pedirTextoAGemini(prompt));
  } catch(error) {
    console.error(`[NOTIFICACIONES] Error cierre diario: ${error.message}`);
  }
};

const generarReporteBajoDemanda = (accion, chatId) => {
  try {
    const ss = SpreadsheetApp.openById(getSheetId());
    
    let dateStart, dateEnd;
    
    if (accion.periodo === "DIA") {
      dateStart = new Date();
      dateEnd = new Date();
    } else if (accion.periodo === "SEMANA") {
      dateStart = new Date();
      dateStart.setDate(dateStart.getDate() - 7);
      dateEnd = new Date();
    } else if (accion.periodo === "MES") {
      dateStart = new Date();
      dateStart.setMonth(dateStart.getMonth() - 1);
      dateEnd = new Date();
    } else {
      dateStart = new Date(`${accion.fecha_inicio}T12:00:00`);
      dateEnd = new Date(`${accion.fecha_fin}T12:00:00`);
    }
    
    const fin = _calcularFinanzasRango(ss, dateStart, dateEnd);
    
    const prompt = `Jorge pidió un reporte financiero. Periodo analizado: ${dateStart.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })} al ${dateEnd.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' })}.
Clientes atendidos: ${fin.clientes}
Ingresos: $${fin.ingresos}
Gastos: $${fin.gastos}
Balance Neto: $${fin.balance}
Dale esta información en un formato ordenado, amigable y con emojis.`;

    sendTelegramMessage(chatId, _pedirTextoAGemini(prompt));

  } catch (error) {
    console.error(`[NOTIFICACIONES] Error reporte demanda: ${error.message}`);
    throw error;
  }
};

const generarReporteAgendaBajoDemanda = (accion, chatId) => {
  try {
    let dateStart = new Date();
    let dateEnd = new Date();
    let contexto = "hoy";
    
    if (accion.periodo === "MANANA") {
      dateStart.setDate(dateStart.getDate() + 1);
      dateEnd.setDate(dateEnd.getDate() + 1);
      contexto = "mañana";
    } else if (accion.periodo === "SEMANA") {
      dateEnd.setDate(dateEnd.getDate() + 7);
      contexto = "los próximos 7 días";
    }
    
    // Obtener los eventos
    const agendaBarberia = _getEventsString(getCalendarId('CALENDAR_BARBERIA_ID'), dateStart, (accion.periodo === "SEMANA" ? dateEnd : undefined)) || "Nada agendado";
    const agendaUni = _getEventsString(getCalendarId('CALENDAR_UNI_ID'), dateStart, (accion.periodo === "SEMANA" ? dateEnd : undefined)) || "Nada agendado";
    const agendaCompromisos = _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), dateStart, (accion.periodo === "SEMANA" ? dateEnd : undefined)) || "Nada agendado";

    // Si es hoy o mañana, sumamos las tareas To-Do
    let tareasPendientes = "";
    if (accion.periodo === "HOY" || accion.periodo === "MANANA") {
      try {
        const sheet = _getToDoSheet();
        const data = sheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
          if (data[i][3] && data[i][3].toString().toLowerCase() === "pendiente") {
            tareasPendientes += `- [${data[i][1]}] ${data[i][2]}\n`;
          }
        }
      } catch(e) {}
    }

    const prompt = `Jorge te preguntó qué tiene agendado para ${contexto}. 
Aquí está su información en bruto:
✂️ Barbería:
${agendaBarberia}
🎓 Universidad:
${agendaUni}
📌 Compromisos:
${agendaCompromisos}
✅ Tareas To-Do:
${tareasPendientes || "Sin tareas"}

Redacta un mensaje natural y amigable respondiéndole a tu jefe. Organiza la información para que sea fácil de leer, usa emojis. Si no hay nada, díselo directamente.`;

    sendTelegramMessage(chatId, _pedirTextoAGemini(prompt));

  } catch (error) {
    console.error(`[NOTIFICACIONES] Error reporte agenda: ${error.message}`);
    throw error;
  }
};

const configurarTriggers = () => {
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    ScriptApp.deleteTrigger(t);
  }
  
  ScriptApp.newTrigger('enviarResumenMatutino').timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  ScriptApp.newTrigger('enviarCierreDiario').timeBased().everyDays(1).atHour(22).nearMinute(30).create();
    
  console.log("¡Triggers instalados correctamente!");
};

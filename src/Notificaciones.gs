/**
 * Módulo Notificaciones — VERSIÓN CORREGIDA
 * Los triggers automáticos NO envían mensaje si la IA falla (evita spam).
 * Los reportes bajo demanda SÍ responden con datos crudos si la IA falla.
 */

const _getEventsString = (calendarId, date, endDate) => {
  if (!calendarId) return "";
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) return "";
  const events = endDate ? cal.getEvents(date, endDate) : cal.getEventsForDay(date);
  let str = "";
  events.forEach(e => {
    const start = e.getStartTime();
    const hora = start.getHours().toString().padStart(2, '0') + ':' + start.getMinutes().toString().padStart(2, '0');
    str += "- " + hora + " (Día " + start.getDate() + "): " + e.getTitle() + "\n";
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
          tareasPendientes += "- [" + data[i][1] + "] " + data[i][2] + "\n";
        }
      }
    } catch(e) {}

    const prompt = "Hoy es " + hoy.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) + ". Crea un resumen de buenos días para Jorge organizado así:\n✂️ Clientes Barbería:\n" + (agendaBarberia || "Sin clientes hoy 🙌") + "\n🎓 Universidad:\n" + (agendaUni || "Sin eventos universitarios") + "\n📌 Compromisos:\n" + (agendaCompromisos || "Sin compromisos personales") + "\n✅ Tareas Pendientes:\n" + (tareasPendientes || "Sin tareas pendientes") + "\n\nHazlo motivacional, amigable y con emojis.";

    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (!chatId) return;

    const texto = pedirTextoAGeminiSeguro(prompt, null);
    if (texto) {
      sendTelegramMessage(chatId, texto);
    } else {
      console.warn("[NOTIFICACIONES] Resumen matutino omitido: IA no disponible.");
    }
  } catch (error) {
    console.error("[NOTIFICACIONES] Error matutino: " + error.message);
  }
};

const _calcularFinanzasRango = (ss, dateStart, dateEnd) => {
  let ingresos = 0, gastos = 0, clientes = 0;
  dateStart.setHours(0,0,0,0);
  dateEnd.setHours(23,59,59,999);

  const parseRowDate = (v) => {
    if (typeof v === 'string' && v.includes('/')) {
      const p = v.split(' ')[0].split(/[\/\-]/);
      return p[0].length === 2 ? new Date(p[2] + '-' + p[1] + '-' + p[0] + 'T12:00:00') : new Date(v);
    }
    return new Date(v);
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
    const finanzasDia = _calcularFinanzasRango(ss, new Date(hoy), new Date(hoy));

    let reportados = 0;
    try {
      const sheetC = ss.getSheetByName('Clientes_del_dia');
      if (sheetC) {
        const data = sheetC.getDataRange().getValues();
        const hoyStr = hoy.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
        for (let i = 1; i < data.length; i++) {
          if (data[i][0] === hoyStr) reportados++;
        }
      }
    } catch(e) {}

    let tareasPendientes = "";
    try {
      const sheet = _getToDoSheet();
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][3].toString().toLowerCase() === "pendiente") {
          tareasPendientes += "- [" + data[i][1] + "] " + data[i][2] + "\n";
        }
      }
    } catch(e) {}

    const agendaManana = _getEventsString(getCalendarId('CALENDAR_BARBERIA_ID'), manana) + _getEventsString(getCalendarId('CALENDAR_UNI_ID'), manana) + _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), manana) + tareasPendientes;
    const agendaSemana = _getEventsString(getCalendarId('CALENDAR_UNI_ID'), manana, enUnaSemana) + _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), manana, enUnaSemana);

    const prompt = "Redacta el cierre de las 10:30 PM para Jorge.\nBarbería hoy: reportó " + reportados + " clientes. Ingresos: $" + finanzasDia.ingresos + ", Gastos: $" + finanzasDia.gastos + ", Balance: $" + finanzasDia.balance + ".\nMañana: " + (agendaManana || "Día libre") + "\nSemana (próx 7 días): " + (agendaSemana || "Nada relevante") + "\nHazlo conversacional y amigable.";

    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (!chatId) return;

    const texto = pedirTextoAGeminiSeguro(prompt, null);
    if (texto) {
      sendTelegramMessage(chatId, texto);
    } else {
      console.warn("[NOTIFICACIONES] Cierre diario omitido: IA no disponible.");
    }
  } catch(error) {
    console.error("[NOTIFICACIONES] Error cierre diario: " + error.message);
  }
};

const generarReporteBajoDemanda = (accion, chatId) => {
  try {
    const ss = SpreadsheetApp.openById(getSheetId());
    let dateStart, dateEnd;
    if (accion.periodo === "DIA") { dateStart = new Date(); dateEnd = new Date(); }
    else if (accion.periodo === "SEMANA") { dateStart = new Date(); dateStart.setDate(dateStart.getDate() - 7); dateEnd = new Date(); }
    else if (accion.periodo === "MES") { dateStart = new Date(); dateStart.setMonth(dateStart.getMonth() - 1); dateEnd = new Date(); }
    else { dateStart = new Date(accion.fecha_inicio + 'T12:00:00'); dateEnd = new Date(accion.fecha_fin + 'T12:00:00'); }

    const fin = _calcularFinanzasRango(ss, dateStart, dateEnd);
    const prompt = "Jorge pidió reporte financiero del " + dateStart.toLocaleDateString('es-CL') + " al " + dateEnd.toLocaleDateString('es-CL') + ". Clientes: " + fin.clientes + ", Ingresos: $" + fin.ingresos + ", Gastos: $" + fin.gastos + ", Balance: $" + fin.balance + ". Dáselo en formato ordenado y amigable con emojis.";

    const texto = pedirTextoAGeminiSeguro(prompt, null);
    if (texto) {
      sendTelegramMessage(chatId, texto);
    } else {
      sendTelegramMessage(chatId, "📊 Reporte financiero:\n\n👥 Clientes: " + fin.clientes + "\n💰 Ingresos: $" + fin.ingresos.toLocaleString('es-CL') + "\n💸 Gastos: $" + fin.gastos.toLocaleString('es-CL') + "\n📈 Balance: $" + fin.balance.toLocaleString('es-CL') + "\n\n(IA no disponible, datos sin formato)");
    }
  } catch (error) {
    console.error("[NOTIFICACIONES] Error reporte demanda: " + error.message);
    throw error;
  }
};

const generarReporteAgendaBajoDemanda = (accion, chatId) => {
  try {
    let dateStart = new Date();
    let dateEnd = new Date();
    let contexto = "hoy";
    if (accion.periodo === "MANANA") { dateStart.setDate(dateStart.getDate() + 1); dateEnd.setDate(dateEnd.getDate() + 1); contexto = "mañana"; }
    else if (accion.periodo === "SEMANA") { dateEnd.setDate(dateEnd.getDate() + 7); contexto = "los próximos 7 días"; }

    const usarRango = accion.periodo === "SEMANA";
    const agendaBarberia = _getEventsString(getCalendarId('CALENDAR_BARBERIA_ID'), dateStart, usarRango ? dateEnd : undefined) || "Nada agendado";
    const agendaUni = _getEventsString(getCalendarId('CALENDAR_UNI_ID'), dateStart, usarRango ? dateEnd : undefined) || "Nada agendado";
    const agendaCompromisos = _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), dateStart, usarRango ? dateEnd : undefined) || "Nada agendado";

    let tareas = "";
    try {
      const sheet = _getToDoSheet();
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][3] && data[i][3].toString().toLowerCase() === "pendiente") {
          tareas += "- [" + data[i][1] + "] " + data[i][2] + "\n";
        }
      }
    } catch(e) {}

    const prompt = "Jorge preguntó qué tiene para " + contexto + ".\n✂️ Barbería:\n" + agendaBarberia + "\n🎓 Universidad:\n" + agendaUni + "\n📌 Compromisos:\n" + agendaCompromisos + "\n✅ Tareas:\n" + (tareas || "Sin tareas") + "\nResponde de forma natural y amigable con emojis.";

    const texto = pedirTextoAGeminiSeguro(prompt, null);
    if (texto) {
      sendTelegramMessage(chatId, texto);
    } else {
      sendTelegramMessage(chatId, "📅 Tu agenda para " + contexto + ":\n\n✂️ Barbería:\n" + agendaBarberia + "\n\n🎓 Universidad:\n" + agendaUni + "\n\n📌 Compromisos:\n" + agendaCompromisos + "\n\n✅ Tareas:\n" + (tareas || "Sin tareas") + "\n\n(IA no disponible, datos sin formato)");
    }
  } catch (error) {
    console.error("[NOTIFICACIONES] Error reporte agenda: " + error.message);
    throw error;
  }
};

const configurarTriggers = () => {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('enviarResumenMatutino').timeBased().everyDays(1).atHour(7).nearMinute(30).create();
  ScriptApp.newTrigger('enviarCierreDiario').timeBased().everyDays(1).atHour(22).nearMinute(30).create();
  console.log("Triggers instalados correctamente.");
};

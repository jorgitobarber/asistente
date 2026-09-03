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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const _DIAS_ES  = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const _MESES_ES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

const _fechaTextoCorto = (d) =>
  `${_DIAS_ES[d.getDay()]} ${d.getDate()} ${_MESES_ES[d.getMonth()]}`;

const _barraProgreso = (pct, largo) => {
  const n = Math.round(Math.min(100, pct) / 100 * largo);
  return '█'.repeat(n) + '░'.repeat(Math.max(0, largo - n));
};

const _progresoSemanal = (ss) => {
  const hoy     = new Date();
  const diaSem  = hoy.getDay(); // 0=dom
  const diasLun = diaSem === 0 ? 6 : diaSem - 1;
  const lunes   = new Date(hoy);
  lunes.setDate(hoy.getDate() - diasLun);
  lunes.setHours(0, 0, 0, 0);

  const fin  = _calcularFinanzasRango(ss, lunes, new Date(hoy));
  const meta = parseInt(PropertiesService.getScriptProperties().getProperty('META_SEMANAL_BARBERIA') || '0');
  const pct  = meta > 0 ? Math.min(100, Math.round((fin.ingresos / meta) * 100)) : 0;

  return { ingresos: fin.ingresos, gastos: fin.gastos, clientes: fin.clientes, meta, pct };
};

// ─── Mensaje de la mañana (7:30 AM) ──────────────────────────────────────────

const enviarResumenMatutino = () => {
  try {
    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (!chatId) return;

    const hoy     = new Date();
    const ayer    = new Date(hoy); ayer.setDate(hoy.getDate() - 1);
    const ss      = SpreadsheetApp.openById(getSheetId());

    // ── Datos ───────────────────────────────────────────────────────
    const citasHoy       = obtenerCitasHoy();
    const finAyer        = _calcularFinanzasRango(ss, new Date(ayer), new Date(ayer));
    const semana         = _progresoSemanal(ss);
    const clima          = _obtenerClima(false);
    const agendaUni      = _getEventsString(getCalendarId('CALENDAR_UNI_ID'), hoy);
    const agendaComp     = _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), hoy);
    const inventarioBajo = obtenerResumenInventario();

    let clientesPendientes = '';
    try { clientesPendientes = obtenerResumenClientesPendientes(); } catch(e) {}

    let tareas = '';
    try {
      const shTodo = _getToDoSheet();
      const dataTodo = shTodo.getDataRange().getValues();
      for (let i = 1; i < dataTodo.length; i++) {
        if ((dataTodo[i][3] || '').toString().toLowerCase() === 'pendiente') {
          tareas += `• [${dataTodo[i][1]}] ${dataTodo[i][2]}\n`;
        }
      }
    } catch(e) {}

    // ── Construcción del mensaje ────────────────────────────────────
    let msg = `☀️ *Buenos días Jorge* — ${_fechaTextoCorto(hoy)}\n`;

    // Clientes hoy
    msg += `\n✂️ *CLIENTES HOY*\n`;
    if (citasHoy.length === 0) {
      msg += `Sin clientes registrados en el bot hoy.\n`;
    } else {
      let totalEst = 0;
      citasHoy.forEach(c => {
        const addStr = c.addOns ? ` + ${c.addOns}` : '';
        msg += `• ${c.hora} — ${c.nombre} (${c.servicio}${addStr})\n`;
      });
    }

    // Finanzas
    msg += `\n💰 *FINANZAS*\n`;
    if (finAyer.ingresos > 0 || finAyer.clientes > 0) {
      msg += `Ayer: $${finAyer.ingresos.toLocaleString('es-CL')} (${finAyer.clientes} clientes)\n`;
    } else {
      msg += `Ayer: sin registro\n`;
    }
    if (semana.meta > 0) {
      msg += `Semana: $${semana.ingresos.toLocaleString('es-CL')} de $${semana.meta.toLocaleString('es-CL')} (${semana.pct}%) ${_barraProgreso(semana.pct, 10)}\n`;
    } else {
      msg += `Semana: $${semana.ingresos.toLocaleString('es-CL')} (${semana.clientes} clientes)\n`;
    }

    // Clima
    if (clima) {
      msg += `\n🌤️ *CLIMA HOY*\n${clima}\n`;
    }

    // Universidad y compromisos (solo si hay algo)
    const hayUni  = agendaUni && agendaUni.trim();
    const hayComp = agendaComp && agendaComp.trim();
    if (hayUni || hayComp || tareas) {
      msg += `\n📅 *AGENDA*\n`;
      if (hayUni)  msg += agendaUni;
      if (hayComp) msg += agendaComp;
      if (tareas)  msg += tareas;
    }

    // Inventario bajo (solo si hay)
    if (inventarioBajo) {
      msg += `\n📦 *INVENTARIO*\n${inventarioBajo}`;
    }

    // Clientes a contactar (solo si hay)
    if (clientesPendientes && clientesPendientes.trim()) {
      msg += `\n📞 *CONTACTAR HOY*\n${clientesPendientes}`;
    }

    sendTelegramMessage(chatId, msg);
    console.log('[NOTIFICACIONES] Resumen matutino enviado.');
  } catch (error) {
    console.error('[NOTIFICACIONES] Error matutino: ' + error.message);
  }
};

// ─── Mensaje de cierre (10:30 PM) ─────────────────────────────────────────────

const enviarCierreDiario = () => {
  try {
    const chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (!chatId) return;

    const hoy    = new Date();
    const manana = new Date(hoy); manana.setDate(hoy.getDate() + 1);
    const ss     = SpreadsheetApp.openById(getSheetId());

    // ── Datos ───────────────────────────────────────────────────────
    const finHoy           = _calcularFinanzasRango(ss, new Date(hoy), new Date(hoy));
    const semana           = _progresoSemanal(ss);
    const pendientes       = obtenerCitasPendientesConfirmar();
    const climaManana      = _obtenerClima(true);

    const agendaManBarberia = _getEventsString(getCalendarId('CALENDAR_BARBERIA_ID'), manana);
    const agendaManUni      = _getEventsString(getCalendarId('CALENDAR_UNI_ID'), manana);
    const agendaManComp     = _getEventsString(getCalendarId('CALENDAR_COMPROMISOS_ID'), manana);

    let clientesPendientes = '';
    try { clientesPendientes = obtenerResumenClientesPendientes(); } catch(e) {}

    // Pagos pendientes de hoy (Historial_Visitas con estado_pago = PENDIENTE)
    let pagosPendientesHoy = [];
    try {
      const hoyStr = Utilities.formatDate(hoy, 'America/Santiago', 'yyyy-MM-dd');
      const shHist = ss.getSheetByName('Historial_Visitas');
      if (shHist) {
        const dataHist = shHist.getDataRange().getValues();
        for (let i = 1; i < dataHist.length; i++) {
          const fechaFila = dataHist[i][0] instanceof Date
            ? Utilities.formatDate(dataHist[i][0], 'America/Santiago', 'yyyy-MM-dd')
            : (dataHist[i][0] || '').toString().trim();
          const estadoPago = ((dataHist[i][7] || '') + '').toUpperCase() || 'PAGADO';
          if (fechaFila === hoyStr && estadoPago === 'PENDIENTE') {
            pagosPendientesHoy.push({
              nombre:  dataHist[i][2],
              servicio: dataHist[i][3],
              monto:   parseFloat(dataHist[i][6]) || 0
            });
          }
        }
      }
    } catch(e) { console.error('[NOTIFICACIONES] Error leyendo pagos pendientes: ' + e.message); }

    // ── Construcción del mensaje ────────────────────────────────────
    let msg = `🌙 *Cierre — ${_fechaTextoCorto(hoy)}*\n`;

    // Resumen de hoy
    msg += `\n✂️ *HOY EN LA BARBA*\n`;
    if (finHoy.clientes > 0) {
      msg += `${finHoy.clientes} clientes | $${finHoy.ingresos.toLocaleString('es-CL')} ingresos`;
      if (finHoy.gastos > 0) msg += ` | $${finHoy.gastos.toLocaleString('es-CL')} gastos`;
      msg += ` | Balance: +$${finHoy.balance.toLocaleString('es-CL')}\n`;
    } else {
      msg += `Sin clientes registrados hoy.\n`;
    }

    // Progreso semanal
    msg += `\n📊 *SEMANA*\n`;
    if (semana.meta > 0) {
      msg += `$${semana.ingresos.toLocaleString('es-CL')} de $${semana.meta.toLocaleString('es-CL')} (${semana.pct}%) ${_barraProgreso(semana.pct, 10)}\n`;
      if (semana.pct >= 100) msg += `✅ ¡Meta semanal cumplida!\n`;
    } else {
      msg += `$${semana.ingresos.toLocaleString('es-CL')} (${semana.clientes} clientes esta semana)\n`;
    }

    // Sin confirmar
    msg += `\n❓ *SIN CONFIRMAR*\n`;
    if (pendientes.length === 0) {
      msg += `Todos confirmados ✅\n`;
    } else {
      pendientes.forEach(c => {
        msg += `• ${c.hora} ${c.nombre} (${c.servicio}) → "vino ${c.nombre.split(' ')[0].toLowerCase()}" o "no vino"\n`;
      });
    }

    // Pagos pendientes de hoy
    if (pagosPendientesHoy.length > 0) {
      msg += `\n💸 *PAGOS PENDIENTES HOY*\n`;
      let totalPend = 0;
      pagosPendientesHoy.forEach(p => {
        msg += `• ${p.nombre} — ${p.servicio} — $${p.monto.toLocaleString('es-CL')}\n`;
        totalPend += p.monto;
      });
      msg += `  Total pendiente: *$${totalPend.toLocaleString('es-CL')}*\n`;
      msg += `  → Escribe "[nombre] ya pagó" para marcarlo como saldado.\n`;
    }

    // Mañana
    const hayManBarberia = agendaManBarberia && agendaManBarberia.trim();
    const hayManUni      = agendaManUni && agendaManUni.trim();
    const hayManComp     = agendaManComp && agendaManComp.trim();
    msg += `\n📅 *MAÑANA*\n`;
    if (!hayManBarberia && !hayManUni && !hayManComp) {
      msg += `Día libre 🎉\n`;
    } else {
      if (hayManBarberia) msg += agendaManBarberia;
      if (hayManUni)      msg += agendaManUni;
      if (hayManComp)     msg += agendaManComp;
    }

    // Clima mañana
    if (climaManana) {
      msg += `\n🌤️ *CLIMA MAÑANA*\n${climaManana}\n`;
    }

    // Clientes pendientes de contactar
    if (clientesPendientes && clientesPendientes.trim()) {
      msg += `\n📞 *PENDIENTES DE CONTACTAR*\n${clientesPendientes}`;
    }

    sendTelegramMessage(chatId, msg);
    console.log('[NOTIFICACIONES] Cierre diario enviado.');
  } catch (error) {
    console.error('[NOTIFICACIONES] Error cierre: ' + error.message);
  }
};


const _calcularFinanzasRango = (ss, dateStart, dateEnd) => {
  let ingresos = 0, gastos = 0, clientes = 0;

  // Usar strings YYYY-MM-DD para comparar sin problemas de timezone
  const startStr = Utilities.formatDate(dateStart, 'America/Santiago', 'yyyy-MM-dd');
  const endStr   = Utilities.formatDate(dateEnd,   'America/Santiago', 'yyyy-MM-dd');

  const normFecha = (v) => {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'yyyy-MM-dd');
    const str = v.toString().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    if (str.includes('/')) {
      const p = str.split(' ')[0].split('/');
      if (p.length === 3 && parseInt(p[2]) > 31) {
        return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
      }
    }
    const d = new Date(str);
    return !isNaN(d.getTime()) ? Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd') : '';
  };

  const enRango = (v) => { const f = normFecha(v); return f >= startStr && f <= endStr; };

  const processSheet = (name, colMonto, colCliente) => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (!enRango(data[i][0])) continue;
      ingresos += parseFloat(data[i][colMonto]) || 0;
      if (colCliente) clientes++;
    }
  };

  processSheet('Ingresos', 3, false);           // col 3 = monto
  processSheet('Historial_Visitas', 6, true);   // col 6 = monto, cuenta clientes

  // Gastos (restan al balance, se procesan aparte)
  const shGastos = ss.getSheetByName('Gastos');
  if (shGastos) {
    const dataG = shGastos.getDataRange().getValues();
    for (let i = 1; i < dataG.length; i++) {
      if (!enRango(dataG[i][0])) continue;
      gastos += parseFloat(dataG[i][3]) || 0;
    }
  }

  console.log(`[FINANZAS] Rango ${startStr} → ${endStr}: ingresos=$${ingresos}, gastos=$${gastos}, clientes=${clientes}`);
  return { ingresos, gastos, clientes, balance: ingresos - gastos };
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

/** Resúmenes personales deterministas. No dependen de Gemini ni de datos de clientes. */
const _getEventsString = (calendarId, fecha, fin) => {
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) throw new Error('Calendario inaccesible.');
  const inicio = fechaHoraChile(fechaChile(fecha), '00:00');
  const hasta = fin || fechaHoraChile(sumarDias(fechaChile(fecha), 1), '00:00');
  return cal.getEvents(inicio, hasta).map(ev => '• ' + fechaChile(ev.getStartTime()) + ' ' + (ev.isAllDayEvent() ? 'Todo el día' : horaChile(ev.getStartTime())) + ' · ' + escapeHtml(ev.getTitle())).join('\n');
};
const agendaPersonalTexto = (inicio, fin) => {
  const desde = fechaHoraChile(inicio, '00:00'), hasta = fechaHoraChile(sumarDias(fin, 1), '00:00');
  return [['Universidad', 'CALENDAR_UNI_ID'], ['Compromisos', 'CALENDAR_COMPROMISOS_ID']].map(([nombre, key]) => {
    try { return nombre + ':\n' + (_getEventsString(getCalendarId(key), desde, hasta) || 'Sin eventos.'); }
    catch (_) { return nombre + ': no pude consultar este calendario.'; }
  }).join('\n\n');
};
const generarReporteAgendaBajoDemanda = (a) => {
  const hoy = fechaChile();
  const r = a.periodo === 'SEMANA' ? { inicio: hoy, fin: sumarDias(hoy, 6) } : rangoReporte(a);
  return { ok: true, mensaje: '📅 Agenda personal\n' + agendaPersonalTexto(r.inicio, r.fin) + '\n\n' + listarTareas({ periodo: a.periodo === 'HOY' ? 'HOY' : a.periodo || 'TODAS' }).mensaje + '\n\nLas citas de Fresha no están incluidas.' };
};
const generarReporteBajoDemanda = (a) => reporteFinanzasPersonal(a);
const resumenPersonal = (noche) => {
  const hoy = fechaChile(), objetivo = noche ? sumarDias(hoy, 1) : hoy;
  let msg = noche ? '🌙 Cierre personal\n\n' : '☀️ Buenos días, Jorge\n\n';
  msg += (noche ? 'Mañana' : 'Hoy') + ' · ' + objetivo + '\n' + agendaPersonalTexto(objetivo, objetivo);
  try {
    const limite = sumarDias(objetivo, 7), todas = obtenerTareas();
    const relevantes = todas.filter(t => t.fecha && t.fecha <= limite);
    msg += '\n\n📝 Tareas con vencimiento próximo o atrasado\n';
    msg += relevantes.length ? relevantes.slice(0, 10).map(t => '• ' + escapeHtml(t.tarea) + ' · ' + t.fecha + (t.fecha < hoy ? ' (vencida)' : '')).join('\n') : 'Sin vencimientos próximos.';
    if (relevantes.length > 10) msg += '\nHay más pendientes; pide la lista de tareas.';
    const sinFecha = todas.filter(t => !t.fecha).length;
    if (sinFecha) msg += '\nAdemás tienes ' + sinFecha + ' tareas sin fecha.';
  } catch (_) { msg += '\nNo pude consultar tus tareas.'; }
  if (noche) {
    try {
      const f = resumirMovimientos(hoy, hoy);
      msg += '\n\n💸 Gastos registrados hoy\nPersonal: ' + dinero(f.PERSONAL.gastos) + '\nBarbería: ' + dinero(f.BARBERIA.gastos);
      if (f.SIN_CLASIFICAR.gastos) msg += '\nSin clasificar: ' + dinero(f.SIN_CLASIFICAR.gastos);
      if (f.omitidos) msg += '\n⚠️ Hay registros con fecha o monto inválido por revisar.';
    } catch (_) { msg += '\nNo pude consultar los gastos.'; }
  }
  if (PropertiesService.getScriptProperties().getProperty('MOSTRAR_CLIMA') === 'true') {
    const clima = _obtenerClima(noche);
    if (clima) msg += '\n\n' + escapeHtml(clima);
  }
  return msg;
};
const enviarResumenPersonal = (noche) => {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const props = PropertiesService.getScriptProperties(), owner = props.getProperty('TELEGRAM_CHAT_ID');
    if (!owner) return;
    const key = noche ? 'ULTIMO_CIERRE_PERSONAL' : 'ULTIMO_RESUMEN_PERSONAL';
    if (props.getProperty(key) === fechaChile()) return;
    if (sendTelegramMessage(owner, resumenPersonal(noche)).ok) props.setProperty(key, fechaChile());
  } finally { lock.releaseLock(); }
};
function enviarResumenMatutino() { enviarResumenPersonal(false); }
function enviarCierreDiario() { enviarResumenPersonal(true); }
/** Solo reemplaza nuestros tres triggers; respeta otros del proyecto. Ejecutar al desplegar. */
function configurarTriggers() {
  const nombres = ['enviarResumenMatutino', 'enviarCierreDiario', 'procesarRecordatorios'];
  ScriptApp.getProjectTriggers().filter(t => nombres.includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(nombres[0]).timeBased().inTimezone(ZONA_BOT).everyDays(1).atHour(7).nearMinute(30).create();
  ScriptApp.newTrigger(nombres[1]).timeBased().inTimezone(ZONA_BOT).everyDays(1).atHour(22).nearMinute(30).create();
  ScriptApp.newTrigger(nombres[2]).timeBased().everyMinutes(5).create();
  return 'Resúmenes 07:30 y 22:30 aproximados; recordatorios cada 5 minutos.';
}

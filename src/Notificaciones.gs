/** Resúmenes personales deterministas. No dependen de Gemini ni de datos de clientes. */
const _getEventsString_ = (calendarId, fecha, fin) => {
  const cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) throw new Error('Calendario inaccesible.');
  const inicio = fechaHoraChile_(fechaChile_(fecha), '00:00');
  const hasta = fin || fechaHoraChile_(sumarDias_(fechaChile_(fecha), 1), '00:00');
  return cal.getEvents(inicio, hasta).map(ev => '• ' + fechaChile_(ev.getStartTime()) + ' ' + (ev.isAllDayEvent() ? 'Todo el día' : horaChile_(ev.getStartTime())) + ' · ' + escapeHtml_(ev.getTitle())).join('\n');
};
const agendaPersonalTexto_ = (inicio, fin) => {
  const desde = fechaHoraChile_(inicio, '00:00'), hasta = fechaHoraChile_(sumarDias_(fin, 1), '00:00');
  return [['Universidad', 'CALENDAR_UNI_ID'], ['Compromisos', 'CALENDAR_COMPROMISOS_ID']].map(([nombre, key]) => {
    try { return nombre + ':\n' + (_getEventsString_(getCalendarId_(key), desde, hasta) || 'Sin eventos.'); }
    catch (_) { return nombre + ': no pude consultar este calendario.'; }
  }).join('\n\n');
};
const generarReporteAgendaBajoDemanda_ = (a) => {
  const hoy = fechaChile_();
  const r = a.periodo === 'SEMANA' ? { inicio: hoy, fin: sumarDias_(hoy, 6) } : rangoReporte_(a);
  return { ok: true, mensaje: '📅 Agenda personal\n' + agendaPersonalTexto_(r.inicio, r.fin) + '\n\n' + listarTareas_({ periodo: a.periodo === 'HOY' ? 'HOY' : a.periodo || 'TODAS' }).mensaje + '\n\nLas citas de Fresha no están incluidas.' };
};
const generarReporteBajoDemanda_ = (a) => reporteFinanzasPersonal_(a);
const resumenPersonal_ = (noche) => {
  const hoy = fechaChile_(), objetivo = noche ? sumarDias_(hoy, 1) : hoy;
  let msg = noche ? '🌙 Cierre personal\n\n' : '☀️ Buenos días, Jorge\n\n';
  msg += (noche ? 'Mañana' : 'Hoy') + ' · ' + objetivo + '\n' + agendaPersonalTexto_(objetivo, objetivo);
  try {
    const limite = sumarDias_(objetivo, 6), todas = obtenerTareas_();
    const relevantes = todas.filter(t => t.fecha && t.fecha <= limite);
    msg += '\n\n📝 Tareas con vencimiento próximo o atrasado\n';
    msg += relevantes.length ? relevantes.slice(0, 10).map(t => '• ' + escapeHtml_(t.tarea) + ' · ' + t.fecha + (t.fecha < hoy ? ' (vencida)' : '')).join('\n') : 'Sin vencimientos próximos.';
    if (relevantes.length > 10) msg += '\nHay más pendientes; pide la lista de tareas.';
    const sinFecha = todas.filter(t => !t.fecha).length;
    if (sinFecha) msg += '\nAdemás tienes ' + sinFecha + ' tareas sin fecha.';
  } catch (_) { msg += '\nNo pude consultar tus tareas.'; }
  if (noche) {
    try {
      const f = resumirMovimientos_(hoy, hoy);
      msg += '\n\n💸 Gastos registrados hoy\nPersonal: ' + dinero_(f.PERSONAL.gastos) + '\nBarbería: ' + dinero_(f.BARBERIA.gastos);
      if (f.SIN_CLASIFICAR.gastos) msg += '\nSin clasificar: ' + dinero_(f.SIN_CLASIFICAR.gastos);
      if (f.omitidos) msg += '\n⚠️ Hay registros con fecha o monto inválido por revisar.';
    } catch (_) { msg += '\nNo pude consultar los gastos.'; }
  }
  if (PropertiesService.getScriptProperties().getProperty('MOSTRAR_CLIMA') === 'true') {
    const clima = _obtenerClima_(noche);
    if (clima) msg += '\n\n' + escapeHtml_(clima);
  }
  const avisos = SpreadsheetApp.openById(getSheetId_()).getSheetByName('Recordatorios');
  if (avisos) {
    const errores = avisos.getDataRange().getValues().slice(1).filter(r => r[4] === 'error').length;
    if (errores) msg += '\n\n⚠️ Hay ' + errores + ' recordatorios que no se pudieron entregar. Pide la lista para reprogramarlos.';
  }
  return msg;
};
const enviarResumenPersonal_ = (noche) => {
  const props = PropertiesService.getScriptProperties();
  const pendiente = noche ? 'PENDIENTE_CIERRE_PERSONAL' : 'PENDIENTE_RESUMEN_PERSONAL';
  props.setProperty(pendiente, fechaChile_());
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const owner = props.getProperty('TELEGRAM_CHAT_ID');
    if (!owner) return;
    const key = noche ? 'ULTIMO_CIERRE_PERSONAL' : 'ULTIMO_RESUMEN_PERSONAL';
    if (props.getProperty(key) === fechaChile_()) { props.deleteProperty(pendiente); return; }
    if (sendTelegramMessage_(owner, resumenPersonal_(noche)).ok) { props.setProperty(key, fechaChile_()); props.deleteProperty(pendiente); }
  } finally { lock.releaseLock(); }
};
/** Se ejecuta dentro del bloqueo del mantenimiento, sin volver a adquirirlo. */
const reintentarResumenes_ = owner => {
  const props = PropertiesService.getScriptProperties();
  [false, true].forEach(noche => {
    const pendiente = noche ? 'PENDIENTE_CIERRE_PERSONAL' : 'PENDIENTE_RESUMEN_PERSONAL';
    const key = noche ? 'ULTIMO_CIERRE_PERSONAL' : 'ULTIMO_RESUMEN_PERSONAL';
    const f = props.getProperty(pendiente);
    if (!f) return;
    if (f !== fechaChile_() || props.getProperty(key) === f) { props.deleteProperty(pendiente); return; }
    if (sendTelegramMessage_(owner, resumenPersonal_(noche)).ok) { props.setProperty(key, f); props.deleteProperty(pendiente); }
  });
};
function enviarResumenMatutino_() { enviarResumenPersonal_(false); }
function enviarCierreDiario_() { enviarResumenPersonal_(true); }
/** Solo reemplaza nuestros tres triggers; respeta otros del proyecto. Ejecutar al desplegar. */
function configurarTriggers_() {
  const nombres = ['enviarResumenMatutino_', 'enviarCierreDiario_', 'procesarRecordatorios_'];
  const antiguos = ['enviarResumen' + 'Matutino', 'enviarCierre' + 'Diario', 'procesar' + 'Recordatorios'];
  ScriptApp.getProjectTriggers().filter(t => nombres.concat(antiguos).includes(t.getHandlerFunction())).forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger(nombres[0]).timeBased().inTimezone(ZONA_BOT).everyDays(1).atHour(7).nearMinute(30).create();
  ScriptApp.newTrigger(nombres[1]).timeBased().inTimezone(ZONA_BOT).everyDays(1).atHour(22).nearMinute(30).create();
  ScriptApp.newTrigger(nombres[2]).timeBased().everyMinutes(5).create();
  return 'Resúmenes 07:30 y 22:30 aproximados; recordatorios cada 5 minutos.';
}

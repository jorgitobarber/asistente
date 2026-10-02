/** Diagnóstico independiente de cada conexión, sin claves ni datos personales. */
function diagnosticoPersonal_() {
  const props = PropertiesService.getScriptProperties();
  const requeridas = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WEBHOOK_SECRET', 'GEMINI_API_KEY', 'SHEET_ID', 'CALENDAR_UNI_ID', 'CALENDAR_COMPROMISOS_ID', 'WEBAPP_URL'];
  const informe = { faltantes: requeridas.filter(k => !props.getProperty(k)), zona: Session.getScriptTimeZone(), triggers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()), hojas: [], calendarios: {}, telegram: {} };
  if (props.getProperty('SHEET_ID')) {
    try {
      const ss = SpreadsheetApp.openById(getSheetId_());
      esquemasPersonales_().forEach(h => {
        const s = ss.getSheetByName(h.nombre);
        const header = s && s.getLastRow() ? s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0] : [];
        informe.hojas.push({ nombre: h.nombre, existe: !!s, filas: s ? Math.max(0, s.getLastRow() - 1) : 0, esquemaValido: !header.some((v, i) => normalizarTexto_(v) !== normalizarTexto_(h.columnas[i])) });
      });
      const gastos = ss.getSheetByName('Gastos');
      informe.gastosAntiguosDesalineados = gastos ? gastos.getDataRange().getValues().slice(1).filter(esGastoAntiguo_).length : 0;
      const avisos = ss.getSheetByName('Recordatorios');
      informe.avisos = avisos ? avisos.getDataRange().getValues().slice(1).reduce((n, r) => { n[r[4]] = (n[r[4]] || 0) + 1; return n; }, {}) : {};
      const diario = ss.getSheetByName('Bot_Updates');
      informe.solicitudes = diario ? diario.getDataRange().getValues().slice(1).slice(-5).map(r => ({ estado: r[2], entregada: r[4] === 'si', intentos: Number(r[6] || 0) })) : [];
    } catch (_) { informe.errorHoja = 'No se pudo acceder a la hoja.'; }
  }
  ['UNIVERSIDAD', 'COMPROMISOS'].forEach(k => {
    try { informe.calendarios[k] = !!getCalendarTarget_(k); } catch (_) { informe.calendarios[k] = false; }
  });
  if (props.getProperty('TELEGRAM_BOT_TOKEN')) {
    try {
      const r = UrlFetchApp.fetch(getTelegramApiUrl_() + '/getWebhookInfo', { muteHttpExceptions: true });
      const body = JSON.parse(r.getContentText());
      const wh = body.result || {};
      const base = props.getProperty('WEBAPP_URL'), secret = props.getProperty('WEBHOOK_SECRET');
      const esperada = base && secret ? base + (base.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(secret) : '';
      informe.telegram = { conexionValida: r.getResponseCode() === 200 && body.ok === true, entradaConfigurada: !!wh.url, coincideConfiguracion: !!esperada && wh.url === esperada, pendientes: Number(wh.pending_update_count || 0), errorEntrega: !!wh.last_error_date };
    } catch (_) { informe.telegram = { conexionValida: false }; }
  }
  console.log(JSON.stringify(informe));
  return informe;
}
const esquemasPersonales_ = () => [
  { nombre: 'Gastos', columnas: COLUMNAS_GASTOS, id: 5 },
  { nombre: 'Ingresos', columnas: COLUMNAS_INGRESOS, id: 4 },
  { nombre: 'To_Do', columnas: ['fecha_creación','categoría','tarea','estado','fecha_completada','id','fecha_limite','actualizado_en'], id: 5 },
  { nombre: 'Recordatorios', columnas: ['fecha_creacion','fecha_aviso','hora_aviso','mensaje','estado','chat_id','id','enviado_en','intentos'], id: 6 }
];
const esGastoAntiguo_ = r => r[4] === '' && typeof r[3] === 'number' && Number.isFinite(r[3]) && r[3] > 0 && typeof r[2] === 'string' && !!r[2].trim();

/** Valida todo antes de escribir y respalda antes de reparar columnas o ampliar. */
function prepararDatosPersonales_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Bot ocupado.');
  try {
    const resultado = [], ss = SpreadsheetApp.openById(getSheetId_()), hojas = esquemasPersonales_();
    hojas.forEach(h => {
      const s = ss.getSheetByName(h.nombre);
      if (!s || !s.getLastRow()) return;
      const header = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
      if (header.some((v, i) => normalizarTexto_(v) !== normalizarTexto_(h.columnas[i]))) throw new Error('Esquema incompatible en ' + h.nombre + '. No se inició la preparación.');
    });
    hojas.forEach(h => {
      const existente = ss.getSheetByName(h.nombre);
      if (existente && existente.getLastRow() > 1 && !ss.getSheetByName('Respaldo_v3_' + h.nombre)) existente.copyTo(ss).setName('Respaldo_v3_' + h.nombre);
      const s = hojaConEsquema_(h.nombre, h.columnas), data = s.getDataRange().getValues();
      let asignados = 0, corregidos = 0;
      for (let i = 1; i < data.length; i++) {
        if (h.nombre === 'Gastos' && esGastoAntiguo_(data[i])) {
          s.getRange(i + 1, 3, 1, 3).setValues([['Otro', textoSeguroSheet_(data[i][2]), data[i][3]]]);
          corregidos++;
        }
        if (!data[i][h.id] && data[i].some(v => v !== '')) {
          s.getRange(i + 1, h.id + 1).setValue(Utilities.getUuid()); asignados++;
        }
      }
      resultado.push({ hoja: h.nombre, idsAsignados: asignados, filasCorregidas: corregidos });
    });
    return resultado;
  } finally { lock.releaseLock(); }
}

/** Instalación autorizada: copia completa y protección de entrada; conserva hojas de clientes. */
function instalarBot_() {
  const props = PropertiesService.getScriptProperties();
  ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GEMINI_API_KEY', 'SHEET_ID', 'CALENDAR_UNI_ID', 'CALENDAR_COMPROMISOS_ID'].forEach(k => { if (!props.getProperty(k)) throw new Error('Falta ' + k); });
  const getMe = UrlFetchApp.fetch(getTelegramApiUrl_() + '/getMe', { muteHttpExceptions: true });
  if (getMe.getResponseCode() !== 200 || !JSON.parse(getMe.getContentText()).ok) throw new Error('La clave de Telegram no funciona.');
  getCalendarTarget_('UNIVERSIDAD'); getCalendarTarget_('COMPROMISOS');
  const ss = SpreadsheetApp.openById(getSheetId_());
  if (!props.getProperty('RESPALDO_REPARACION_20261002')) {
    const respaldo = ss.copy('Respaldo completo bot 2026-10-02');
    props.setProperty('RESPALDO_REPARACION_20261002', respaldo.getId());
  }
  if (!props.getProperty('WEBHOOK_SECRET')) props.setProperty('WEBHOOK_SECRET', Utilities.getUuid() + Utilities.getUuid());
  if (!props.getProperty('TELEGRAM_USER_ID')) props.setProperty('TELEGRAM_USER_ID', props.getProperty('TELEGRAM_CHAT_ID'));
  if (!props.getProperty('GEMINI_MODEL')) props.setProperty('GEMINI_MODEL', 'gemini-2.5-flash');
  props.setProperty('WEBAPP_URL', 'https://script.google.com/macros/s/AKfycbzypWgD-bVk4Tbs3SZ0q6r66HHozAT9XZ2qPCSlqwT0q7H2REC7prPKR4DlvI0PObEEFw/exec');
  const datos = prepararDatosPersonales_();
  configurarTriggers_();
  const informe = { respaldoCompleto: true, datos, triggersConfigurados: true, webhookPendiente: true };
  console.log(JSON.stringify(informe));
  return informe;
}

/** Conecta la publicación conservando los mensajes pendientes de Telegram. */
function conectarBot_() {
  configurarWebhook_();
  return diagnosticoPersonal_();
}

/** Prueba real con registros identificados; el gasto de prueba queda anulado. */
function probarBot_() {
  const props = PropertiesService.getScriptProperties(), owner = props.getProperty('TELEGRAM_CHAT_ID');
  const marca = 'Prueba de funcionamiento ' + Utilities.getUuid();
  const interpretacion = parseMessageWithGemini_('Registra un gasto personal de 1 peso en transporte.');
  console.log('Interpretacion de prueba: ' + JSON.stringify(interpretacion));
  if (!interpretacion.acciones.some(a => a.tipo === 'FINANZAS' && a.subtipo === 'GASTO' && a.monto === 1 && a.ambito === 'PERSONAL')) throw new Error('La IA no interpretó la prueba correctamente.');
  const gasto = registrarFinanzas_({ subtipo: 'GASTO', monto: 1, descripcion: marca, ambito: 'PERSONAL', categoria: 'Otro' });
  if (!gasto.ok || !procesarFinanzas_({ subtipo: 'ANULAR', id: gasto.referencia.id, movimiento: 'GASTO' }).ok) throw new Error('Falló la prueba financiera.');
  const tarea = procesarToDo_({ subtipo: 'AGREGAR', tarea: marca });
  if (!tarea.ok || !procesarToDo_({ subtipo: 'COMPLETAR', id: tarea.referencia.id }).ok) throw new Error('Falló la prueba de tareas.');
  const cal = getCalendarTarget_('COMPROMISOS');
  const f = sumarDias_(fechaChile_(), 90), inicio = fechaHoraChile_(f, '12:00');
  const evento = cal.createEvent(marca, inicio, new Date(inicio.getTime() + 5 * 60000));
  const eliminado = procesarAgenda_({ subtipo: 'ELIMINAR', usar_ultimo: true }, { ultimo: { tipo: 'AGENDA', id: evento.getId(), calendario: 'COMPROMISOS' } });
  if (!eliminado.ok) throw new Error('Falló la prueba de calendario.');
  const avisoFecha = new Date(Date.now() + 2 * 60000);
  const aviso = agregarRecordatorio_({ fecha_aviso: fechaChile_(avisoFecha), hora_aviso: horaChile_(avisoFecha), mensaje: '✅ Prueba automática: el recordatorio del bot funciona.' }, owner);
  if (!aviso.ok) throw new Error('Falló la prueba de aviso.');
  const resumen = { inteligenciaArtificial: true, gastoRegistradoYAnulado: true, tareaCreadaYCompletada: true, calendarioCreadoYEliminado: true, recordatorioProgramado: true };
  console.log(JSON.stringify(resumen));
  if (!sendTelegramMessage_(owner, '✅ Reparación del bot: la inteligencia artificial, los gastos, las tareas y el calendario pasaron sus pruebas.\nEn unos minutos llegará un recordatorio de prueba. Puedes escribir /ayuda.').ok) throw new Error('No se confirmó el mensaje de prueba.');
  return resumen;
}

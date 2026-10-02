/** Avisos personales: vencimiento de Chile, bloqueo y entrega confirmada. */
const _getHojaRecordatorios_ = () => hojaConEsquema_('Recordatorios', ['fecha_creacion', 'fecha_aviso', 'hora_aviso', 'mensaje', 'estado', 'chat_id', 'id', 'enviado_en', 'intentos']);
const agregarRecordatorio_ = (a, chatId) => {
  if (a.subtipo && a.subtipo !== 'AGREGAR') return fallo_('Solo está disponible agregar recordatorios.');
  if (!fechaValida_(a.fecha_aviso)) return pedirDato_(a, '¿En qué fecha quieres el aviso?');
  if (!horaValida_(a.hora_aviso)) return pedirDato_(a, '¿A qué hora quieres el aviso?');
  if (typeof a.mensaje !== 'string' || !a.mensaje.trim() || a.mensaje.length > 1000) return pedirDato_(a, '¿Qué quieres que te recuerde? Usa un texto breve.');
  let objetivo;
  try { objetivo = fechaHoraChile_(a.fecha_aviso, a.hora_aviso); } catch (e) { return pedirDato_(a, e.message); }
  if (objetivo <= new Date()) return pedirDato_(a, 'Esa hora ya pasó. Indica una fecha y hora futuras.');
  const id = Utilities.getUuid();
  _getHojaRecordatorios_().appendRow([new Date(), a.fecha_aviso, a.hora_aviso, textoSeguroSheet_(a.mensaje), 'pendiente', String(chatId), id, '', 0]);
  return { ok: true, mensaje: '⏰ Aviso guardado: ' + escapeHtml_(a.mensaje) + '\n' + a.fecha_aviso + ' ' + a.hora_aviso + ' (Chile). Se revisan los avisos cada 5 minutos; no es una alarma exacta.\nID: ' + id, referencia: { tipo: 'RECORDATORIO', id } };
};
function procesarRecordatorios_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const owner = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (!owner) return;
    reintentarRespuestasPendientes_(owner);
    reintentarResumenes_(owner);
    const s = _getHojaRecordatorios_(), data = s.getDataRange().getValues(), ahora = new Date();
    let procesados = 0;
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (r[4] !== 'pendiente' || String(r[5]) !== owner) continue;
      let objetivo;
      try { objetivo = fechaHoraChile_(fechaRegistro_(r[1]), horaRegistro_(r[2])); } catch (_) { s.getRange(i + 1, 5).setValue('error'); console.warn('[RECORDATORIOS] Fecha inválida en fila ' + (i + 1)); continue; }
      if (objetivo > ahora) continue;
      if (procesados++ >= 20) break;
      const intentos = Number(r[8] || 0) + 1;
      s.getRange(i + 1, 9).setValue(intentos);
      if (sendTelegramMessage_(owner, '⏰ <b>Recordatorio</b>\n' + escapeHtml_(r[3])).ok) {
        s.getRange(i + 1, 5).setValue('enviado');
        s.getRange(i + 1, 8).setValue(ahora);
      } else if (intentos >= 8) s.getRange(i + 1, 5).setValue('error');
    }
  } finally { lock.releaseLock(); }
}

/** Bajo el mismo bloqueo: reintenta SOLO la respuesta, nunca las escrituras del mensaje. */
const reintentarRespuestasPendientes_ = (owner) => {
  const s = SpreadsheetApp.openById(getSheetId_()).getSheetByName('Bot_Updates');
  if (!s) return;
  const data = s.getDataRange().getValues();
  let intentados = 0;
  for (let i = 1; i < data.length && intentados < 5; i++) {
    if (data[i][4] === 'si' || data[i][4] === 'fallido') continue;
    if (data[i][7] instanceof Date && data[i][7] > new Date()) continue;
    if (!data[i][7] && Number(data[i][6] || 0) >= 8) { s.getRange(i + 1, 5).setValue('fallido'); continue; }
    let mensaje = data[i][3];
    if (data[i][2] === 'procesando') {
      mensaje = '⚠️ Una solicitud quedó interrumpida. Revisa los registros antes de repetirla. No la ejecutaré automáticamente otra vez.';
      s.getRange(i + 1, 3, 1, 2).setValues([['revisar', mensaje]]);
    }
    if (!mensaje) continue;
    intentados++;
    entregarRespuesta_(s, i + 1, owner);
  }
};

/** Gestión por ID o nombre inequívoco; nunca modifica avisos de otro chat. */
const procesarRecordatorio_ = (accion, chatId, contexto = {}) => {
  const a = { ...accion }, subtipo = a.subtipo || 'AGREGAR';
  if (subtipo === 'AGREGAR') return agregarRecordatorio_(a, chatId);
  if (!['LISTAR', 'MODIFICAR', 'CANCELAR'].includes(subtipo)) return fallo_('Operación de recordatorio desconocida.');
  const s = _getHojaRecordatorios_(), data = s.getDataRange().getValues();
  const activos = data.map((r, i) => ({ r, i })).filter(x => x.i > 0 && String(x.r[5]) === String(chatId) && ['pendiente', 'error'].includes(x.r[4]));
  if (subtipo === 'LISTAR') return { ok: true, mensaje: activos.length ? '⏰ Recordatorios\n' + activos.slice(0, 30).map(x => '• ' + escapeHtml_(x.r[3]) + ' · ' + fechaRegistro_(x.r[1]) + ' ' + horaRegistro_(x.r[2]) + (x.r[4] === 'error' ? ' · No se pudo entregar: cambia su fecha para reactivarlo.' : '') + '\nID: ' + x.r[6]).join('\n\n') : 'No tienes recordatorios pendientes.' };
  if (a.usar_ultimo) {
    if (!contexto.ultimo || contexto.ultimo.tipo !== 'RECORDATORIO') return fallo_('Indica el nombre o ID del recordatorio.');
    a.id = contexto.ultimo.id;
  }
  const encontrados = activos.filter(x => a.id ? x.r[6] === a.id : a.mensaje && normalizarTexto_(x.r[3]) === normalizarTexto_(a.mensaje));
  if (encontrados.length !== 1) return fallo_(encontrados.length ? 'Hay varios avisos con ese nombre. Usa el ID de la lista.' : 'No encontré ese recordatorio pendiente. Pide la lista y usa su ID.');
  const x = encontrados[0], r = x.r.slice();
  if (subtipo === 'CANCELAR') r[4] = 'cancelado';
  else {
    const fecha = a.fecha_aviso || fechaRegistro_(r[1]), hora = a.hora_aviso || horaRegistro_(r[2]);
    let objetivo;
    try { objetivo = fechaHoraChile_(fecha, hora); } catch (_) { return pedirDato_(a, 'Indica una fecha y hora válidas para el aviso.'); }
    if (objetivo <= new Date()) return pedirDato_(a, 'Indica una fecha y hora futuras para el aviso.');
    if (!a.fecha_aviso && !a.hora_aviso && a.nuevo_mensaje === undefined) return fallo_('Indica qué fecha, hora o texto quieres cambiar.');
    if (a.nuevo_mensaje !== undefined) {
      if (typeof a.nuevo_mensaje !== 'string' || !a.nuevo_mensaje.trim() || a.nuevo_mensaje.length > 1000) return fallo_('El nuevo texto debe tener entre 1 y 1000 caracteres.');
      r[3] = textoSeguroSheet_(a.nuevo_mensaje);
    }
    r[1] = fecha; r[2] = hora; r[4] = 'pendiente'; r[8] = 0;
  }
  s.getRange(x.i + 1, 1, 1, 9).setValues([r]);
  return { ok: true, mensaje: '✅ Recordatorio ' + (subtipo === 'CANCELAR' ? 'cancelado' : 'modificado') + ': ' + escapeHtml_(r[3]), referencia: { tipo: 'RECORDATORIO', id: r[6] } };
};

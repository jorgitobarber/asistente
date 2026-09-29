/** Avisos personales: vencimiento de Chile, bloqueo y entrega confirmada. */
const _getHojaRecordatorios = () => hojaConEsquema('Recordatorios', ['fecha_creacion', 'fecha_aviso', 'hora_aviso', 'mensaje', 'estado', 'chat_id', 'id', 'enviado_en', 'intentos']);
const agregarRecordatorio = (a, chatId) => {
  if (a.subtipo && a.subtipo !== 'AGREGAR') return fallo('Solo está disponible agregar recordatorios.');
  if (!fechaValida(a.fecha_aviso)) return pedirDato(a, '¿En qué fecha quieres el aviso?');
  if (!horaValida(a.hora_aviso)) return pedirDato(a, '¿A qué hora quieres el aviso?');
  if (typeof a.mensaje !== 'string' || !a.mensaje.trim() || a.mensaje.length > 1000) return pedirDato(a, '¿Qué quieres que te recuerde? Usa un texto breve.');
  let objetivo;
  try { objetivo = fechaHoraChile(a.fecha_aviso, a.hora_aviso); } catch (e) { return pedirDato(a, e.message); }
  if (objetivo <= new Date()) return pedirDato(a, 'Esa hora ya pasó. Indica una fecha y hora futuras.');
  const id = Utilities.getUuid();
  _getHojaRecordatorios().appendRow([new Date(), a.fecha_aviso, a.hora_aviso, textoSeguroSheet(a.mensaje), 'pendiente', String(chatId), id, '', 0]);
  return { ok: true, mensaje: '⏰ Aviso guardado: ' + escapeHtml(a.mensaje) + '\n' + a.fecha_aviso + ' ' + a.hora_aviso + ' (Chile). Se revisan los avisos cada 5 minutos; no es una alarma exacta.' };
};
function procesarRecordatorios() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    const owner = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
    if (!owner) return;
    reintentarRespuestasPendientes(owner);
    const s = _getHojaRecordatorios(), data = s.getDataRange().getValues(), ahora = new Date();
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (r[4] !== 'pendiente' || String(r[5]) !== owner) continue;
      let objetivo;
      try { objetivo = fechaHoraChile(fechaRegistro(r[1]), horaRegistro(r[2])); } catch (_) { console.warn('[RECORDATORIOS] Fecha inválida en fila ' + (i + 1)); continue; }
      if (objetivo > ahora) continue;
      const intentos = Number(r[8] || 0) + 1;
      s.getRange(i + 1, 9).setValue(intentos);
      if (sendTelegramMessage(owner, '⏰ <b>Recordatorio</b>\n' + escapeHtml(r[3])).ok) {
        s.getRange(i + 1, 5).setValue('enviado');
        s.getRange(i + 1, 8).setValue(ahora);
      }
    }
  } finally { lock.releaseLock(); }
}

/** Bajo el mismo bloqueo: reintenta SOLO la respuesta, nunca las escrituras del mensaje. */
const reintentarRespuestasPendientes = (owner) => {
  const s = SpreadsheetApp.openById(getSheetId()).getSheetByName('Bot_Updates');
  if (!s) return;
  const data = s.getDataRange().getValues();
  let intentados = 0;
  for (let i = 1; i < data.length && intentados < 5; i++) {
    if (data[i][4] === 'si') continue;
    let mensaje = data[i][3];
    if (data[i][2] === 'procesando') {
      mensaje = '⚠️ Una solicitud quedó interrumpida. Revisa los registros antes de repetirla. No la ejecutaré automáticamente otra vez.';
      s.getRange(i + 1, 3, 1, 2).setValues([['revisar', mensaje]]);
    }
    if (!mensaje) continue;
    intentados++;
    if (sendTelegramMessage(owner, mensaje).ok) s.getRange(i + 1, 5).setValue('si');
  }
};

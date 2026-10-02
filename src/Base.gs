/** Fechas de Chile, esquemas aditivos y contexto breve del asistente. */
const ZONA_BOT = 'America/Santiago';
const fechaChile_ = (d = new Date()) => Utilities.formatDate(d, ZONA_BOT, 'yyyy-MM-dd');
const horaChile_ = (d = new Date()) => Utilities.formatDate(d, ZONA_BOT, 'HH:mm');
const normalizarTexto_ = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const textoSeguroSheet_ = (s) => /^[=+\-@]/.test(String(s || '')) ? "'" + s : String(s || '');
const fechaValida_ = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const horaValida_ = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const fechaHoraChile_ = (f, h) => {
  if (!fechaValida_(f) || !horaValida_(h)) throw new Error('Fecha u hora inválida.');
  const d = Utilities.parseDate(f + ' ' + h, ZONA_BOT, 'yyyy-MM-dd HH:mm');
  if (fechaChile_(d) !== f || horaChile_(d) !== h) throw new Error('Esa hora no existe en Chile por el cambio de horario.');
  return d;
};
const sumarDias_ = (f, n) => {
  const d = new Date(f + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fechaRegistro_ = (v) => {
  if (v instanceof Date) return fechaChile_(v);
  const s = String(v || '').trim();
  if (fechaValida_(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s|$)/);
  if (!m) return '';
  const f = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return fechaValida_(f) ? f : '';
};
const horaRegistro_ = (v) => v instanceof Date ? horaChile_(v) : String(v || '').trim();
const fallo_ = (mensaje) => ({ ok: false, mensaje: '⚠️ ' + mensaje });
const pedirDato_ = (accion, mensaje) => ({ ok: false, mensaje: '❓ ' + mensaje, pendiente: accion });
const dinero_ = (n) => '$' + Number(n).toLocaleString('es-CL');

/** Conserva columnas y filas. Respalda antes de ampliar un esquema existente. */
const hojaConEsquema_ = (nombre, columnas) => {
  const ss = SpreadsheetApp.openById(getSheetId_());
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) { hoja = ss.insertSheet(nombre); hoja.appendRow(columnas); return hoja; }
  const n = hoja.getLastColumn();
  if (hoja.getLastRow() === 0) { hoja.appendRow(columnas); return hoja; }
  const cabecera = hoja.getRange(1, 1, 1, n).getValues()[0];
  for (let i = 0; i < n; i++) {
    if (normalizarTexto_(cabecera[i]) !== normalizarTexto_(columnas[i])) throw new Error('Esquema incompatible en ' + nombre + '. Requiere revisión.');
  }
  if (n < columnas.length) {
    const respaldo = 'Respaldo_v3_' + nombre;
    if (!ss.getSheetByName(respaldo)) hoja.copyTo(ss).setName(respaldo);
    if (hoja.getMaxColumns() < columnas.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), columnas.length - hoja.getMaxColumns());
    hoja.getRange(1, n + 1, 1, columnas.length - n).setValues([columnas.slice(n)]);
  }
  return hoja;
};
const leerContexto_ = (chatId) => {
  const s = SpreadsheetApp.openById(getSheetId_()).getSheetByName('Bot_Contexto');
  const row = s && s.getDataRange().getValues().slice(1).find(r => String(r[0]) === String(chatId));
  const raw = row ? row[2] : PropertiesService.getScriptProperties().getProperty('CONTEXTO_' + chatId);
  try {
    const c = JSON.parse(raw || '{}');
    if (Date.now() - c.actualizado < 30 * 60 * 1000) return c;
    // Las referencias expiran, pero una aclaración conserva su cola para no perder trabajo.
    return c.pendiente || c.en_curso ? { pendiente: c.pendiente, restantes: c.restantes || [], progreso: c.progreso || [], en_curso: c.en_curso } : {};
  } catch (_) { return {}; }
};
const guardarContexto_ = (chatId, contexto) => {
  const value = JSON.stringify({ ...contexto, actualizado: Date.now() });
  if (value.length > 40000) throw new Error('Contexto demasiado extenso. Divide la solicitud.');
  const s = hojaConEsquema_('Bot_Contexto', ['chat_id', 'actualizado', 'contexto']);
  const data = s.getDataRange().getValues();
  const i = data.findIndex((r, n) => n > 0 && String(r[0]) === String(chatId));
  const row = [String(chatId), new Date(), value];
  if (i > 0) s.getRange(i + 1, 1, 1, 3).setValues([row]);
  else s.appendRow(row);
  SpreadsheetApp.flush();
};
const rangoReporte_ = (a = {}) => {
  const hoy = fechaChile_();
  let inicio = hoy, fin = hoy;
  if (a.periodo === 'SEMANA') {
    const dia = new Date(hoy + 'T12:00:00Z').getUTCDay();
    inicio = sumarDias_(hoy, -(dia === 0 ? 6 : dia - 1));
  } else if (a.periodo === 'MES') inicio = hoy.slice(0, 7) + '-01';
  else if (a.periodo === 'MANANA') inicio = fin = sumarDias_(hoy, 1);
  else if (a.periodo && !['DIA', 'HOY', 'RANGO'].includes(a.periodo)) throw new Error('Período no reconocido.');
  if (a.fecha_inicio || a.fecha_fin) { inicio = a.fecha_inicio; fin = a.fecha_fin; }
  if (!fechaValida_(inicio) || !fechaValida_(fin) || inicio > fin) throw new Error('Rango de fechas inválido.');
  return { inicio, fin };
};
/** Prueba pura; no consulta ni modifica datos. */
function test_Base_() {
  if (fechaValida_('2026-02-30') || !fechaValida_('2028-02-29') || horaValida_('24:00')) throw new Error('Validación incorrecta');
  return 'Fechas válidas';
}

/** Fechas de Chile, esquemas aditivos y contexto breve del asistente. */
const ZONA_BOT = 'America/Santiago';
const fechaChile = (d = new Date()) => Utilities.formatDate(d, ZONA_BOT, 'yyyy-MM-dd');
const horaChile = (d = new Date()) => Utilities.formatDate(d, ZONA_BOT, 'HH:mm');
const normalizarTexto = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const textoSeguroSheet = (s) => /^[=+\-@]/.test(String(s || '')) ? "'" + s : String(s || '');
const fechaValida = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T12:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
const horaValida = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const fechaHoraChile = (f, h) => {
  if (!fechaValida(f) || !horaValida(h)) throw new Error('Fecha u hora inválida.');
  const d = Utilities.parseDate(f + ' ' + h, ZONA_BOT, 'yyyy-MM-dd HH:mm');
  if (fechaChile(d) !== f || horaChile(d) !== h) throw new Error('Esa hora no existe en Chile por el cambio de horario.');
  return d;
};
const sumarDias = (f, n) => {
  const d = new Date(f + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const fechaRegistro = (v) => {
  if (v instanceof Date) return fechaChile(v);
  const s = String(v || '').trim();
  if (fechaValida(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s|$)/);
  if (!m) return '';
  const f = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return fechaValida(f) ? f : '';
};
const horaRegistro = (v) => v instanceof Date ? horaChile(v) : String(v || '').trim();
const fallo = (mensaje) => ({ ok: false, mensaje: '⚠️ ' + mensaje });
const pedirDato = (accion, mensaje) => ({ ok: false, mensaje: '❓ ' + mensaje, pendiente: accion });
const dinero = (n) => '$' + Number(n).toLocaleString('es-CL');

/** Conserva columnas y filas. Respalda antes de ampliar un esquema existente. */
const hojaConEsquema = (nombre, columnas) => {
  const ss = SpreadsheetApp.openById(getSheetId());
  let hoja = ss.getSheetByName(nombre);
  if (!hoja) { hoja = ss.insertSheet(nombre); hoja.appendRow(columnas); return hoja; }
  const n = hoja.getLastColumn();
  if (hoja.getLastRow() === 0) { hoja.appendRow(columnas); return hoja; }
  const cabecera = hoja.getRange(1, 1, 1, n).getValues()[0];
  for (let i = 0; i < n; i++) {
    if (normalizarTexto(cabecera[i]) !== normalizarTexto(columnas[i])) throw new Error('Esquema incompatible en ' + nombre + '. Requiere revisión.');
  }
  if (n < columnas.length) {
    const respaldo = 'Respaldo_v3_' + nombre;
    if (!ss.getSheetByName(respaldo)) hoja.copyTo(ss).setName(respaldo);
    if (hoja.getMaxColumns() < columnas.length) hoja.insertColumnsAfter(hoja.getMaxColumns(), columnas.length - hoja.getMaxColumns());
    hoja.getRange(1, n + 1, 1, columnas.length - n).setValues([columnas.slice(n)]);
  }
  return hoja;
};
const leerContexto = (chatId) => {
  const raw = PropertiesService.getScriptProperties().getProperty('CONTEXTO_' + chatId);
  try {
    const c = JSON.parse(raw || '{}');
    return Date.now() - c.actualizado < 30 * 60 * 1000 ? c : {};
  } catch (_) { return {}; }
};
const guardarContexto = (chatId, contexto) => {
  const value = JSON.stringify({ ...contexto, actualizado: Date.now() });
  if (Utilities.newBlob(value).getBytes().length > 8000) throw new Error('Contexto demasiado extenso. Divide la solicitud.');
  PropertiesService.getScriptProperties().setProperty('CONTEXTO_' + chatId, value);
};
const rangoReporte = (a = {}) => {
  const hoy = fechaChile();
  let inicio = hoy, fin = hoy;
  if (a.periodo === 'SEMANA') {
    const dia = new Date(hoy + 'T12:00:00Z').getUTCDay();
    inicio = sumarDias(hoy, -(dia === 0 ? 6 : dia - 1));
  } else if (a.periodo === 'MES') inicio = hoy.slice(0, 7) + '-01';
  else if (a.periodo === 'MANANA') inicio = fin = sumarDias(hoy, 1);
  else if (a.periodo && !['DIA', 'HOY', 'RANGO'].includes(a.periodo)) throw new Error('Período no reconocido.');
  if (a.fecha_inicio || a.fecha_fin) { inicio = a.fecha_inicio; fin = a.fecha_fin; }
  if (!fechaValida(inicio) || !fechaValida(fin) || inicio > fin) throw new Error('Rango de fechas inválido.');
  return { inicio, fin };
};
/** Prueba pura; no consulta ni modifica datos. */
function test_Base() {
  if (fechaValida('2026-02-30') || !fechaValida('2028-02-29') || horaValida('24:00')) throw new Error('Validación incorrecta');
  return 'Fechas válidas';
}

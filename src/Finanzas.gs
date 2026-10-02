/** Finanzas personales: esquemas aditivos, correcciones por ID y anulación sin borrar. */
const CATEGORIAS_GASTO = ['Insumos', 'Alimentación', 'Transporte', 'Servicios', 'Educación', 'Equipamiento', 'Personal', 'Otro'];
const getSheetId_ = () => {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Falta SHEET_ID.');
  return id;
};
const _getOrCreateSheet_ = (ss, name, headers) => {
  let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.appendRow(headers); }
  return s;
};
const COLUMNAS_GASTOS = ['fecha', 'hora', 'categoría', 'descripción', 'monto', 'id', 'ambito', 'estado', 'creado_en', 'actualizado_en', 'origen'];
const COLUMNAS_INGRESOS = ['fecha', 'hora', 'descripción', 'monto', 'id', 'ambito', 'estado', 'creado_en', 'actualizado_en', 'origen'];
const _getHojaGastos_ = () => hojaConEsquema_('Gastos', COLUMNAS_GASTOS);
const hojaMovimiento_ = (tipo) => tipo === 'GASTO' ? _getHojaGastos_() : hojaConEsquema_('Ingresos', COLUMNAS_INGRESOS);
const indicesMovimiento_ = (tipo) => tipo === 'GASTO'
  ? { desc: 3, monto: 4, id: 5, ambito: 6, estado: 7, creado: 8, actualizado: 9, origen: 10 }
  : { desc: 2, monto: 3, id: 4, ambito: 5, estado: 6, creado: 7, actualizado: 8, origen: 9 };
const validarMovimiento_ = (a) => {
  if (typeof a.monto !== 'number' || !Number.isFinite(a.monto) || a.monto <= 0) return '¿Cuál es el monto? Debe ser un número mayor que cero.';
  if (typeof a.descripcion !== 'string' || !a.descripcion.trim() || a.descripcion.length > 300) return 'Indica una descripción breve del movimiento.';
  if (!['PERSONAL', 'BARBERIA'].includes(a.ambito)) return '¿Es personal o de la barbería?';
  if (a.fecha !== undefined && !fechaValida_(a.fecha)) return 'Indica una fecha válida (AAAA-MM-DD).';
  if (a.categoria && !CATEGORIAS_GASTO.includes(a.categoria)) return 'Indica una categoría válida: ' + CATEGORIAS_GASTO.join(', ') + '.';
  return '';
};
const registrarFinanzas_ = (a, ahora = new Date()) => {
  if (!['GASTO', 'INGRESO'].includes(a.subtipo)) return fallo_('Tipo de movimiento inválido.');
  const error = validarMovimiento_(a);
  if (error) return pedirDato_(a, error);
  const s = hojaMovimiento_(a.subtipo), id = Utilities.getUuid();
  const fila = a.subtipo === 'GASTO'
    ? [a.fecha || fechaChile_(ahora), horaChile_(ahora), a.categoria || 'Otro', textoSeguroSheet_(a.descripcion), a.monto]
    : [a.fecha || fechaChile_(ahora), horaChile_(ahora), textoSeguroSheet_(a.descripcion), a.monto];
  s.appendRow([...fila, id, a.ambito, 'ACTIVO', ahora, ahora, 'BOT_MANUAL']);
  return { ok: true, mensaje: '✅ ' + (a.subtipo === 'GASTO' ? 'Gasto' : 'Ingreso manual') + ' registrado: ' + dinero_(a.monto) + '\n' + escapeHtml_(a.descripcion) + ' · ' + a.ambito + ' · ' + fila[0], referencia: { tipo: 'FINANZAS', movimiento: a.subtipo, id } };
};
const procesarFinanzas_ = (a, contexto = {}) => {
  if (a.subtipo === 'LISTAR') return listarMovimientos_(a);
  if (['GASTO', 'INGRESO'].includes(a.subtipo)) return registrarFinanzas_(a);
  if (!['MODIFICAR', 'ANULAR'].includes(a.subtipo)) return fallo_('Operación financiera no reconocida.');
  const ref = a.usar_ultimo === true ? contexto.ultimo : { tipo: 'FINANZAS', id: a.id, movimiento: a.movimiento };
  if (!ref || ref.tipo !== 'FINANZAS' || !ref.id || !['GASTO', 'INGRESO'].includes(ref.movimiento)) return fallo_('Indica el ID y si es gasto o ingreso; no hay un movimiento reciente inequívoco.');
  if (a.movimiento && a.movimiento !== ref.movimiento) return fallo_('El movimiento reciente no es del tipo indicado. Consulta su ID antes de corregirlo.');
  const s = hojaMovimiento_(ref.movimiento), c = indicesMovimiento_(ref.movimiento), data = s.getDataRange().getValues();
  const i = data.findIndex((r, n) => n > 0 && r[c.id] === ref.id);
  if (i < 1) return fallo_('No encontré ese movimiento.');
  const fila = data[i].slice();
  if (fila[c.estado] === 'ANULADO') return fallo_('Ese movimiento ya está anulado.');
  if (a.subtipo === 'ANULAR') fila[c.estado] = 'ANULADO';
  else {
    const actual = { monto: fila[c.monto], descripcion: String(fila[c.desc]), ambito: fila[c.ambito], fecha: fechaRegistro_(fila[0]), categoria: ref.movimiento === 'GASTO' ? fila[2] : undefined };
    const campos = ['monto', 'descripcion', 'ambito', 'fecha'];
    if (ref.movimiento === 'GASTO') campos.push('categoria');
    let cambios = 0;
    campos.forEach(k => { if (Object.prototype.hasOwnProperty.call(a, k)) { actual[k] = a[k]; cambios++; } });
    if (!cambios) return fallo_('Indica qué dato quieres cambiar.');
    const error = validarMovimiento_(actual);
    if (error) return pedirDato_(a, error);
    fila[0] = actual.fecha; fila[c.desc] = textoSeguroSheet_(actual.descripcion); fila[c.monto] = actual.monto; fila[c.ambito] = actual.ambito;
    if (ref.movimiento === 'GASTO') fila[2] = actual.categoria;
  }
  fila[c.actualizado] = new Date();
  const auditoria = hojaConEsquema_('Finanzas_Cambios', ['fecha', 'id', 'movimiento', 'operacion', 'antes', 'despues', 'estado']);
  auditoria.appendRow([new Date(), ref.id, ref.movimiento, a.subtipo, JSON.stringify(data[i]), JSON.stringify(fila), 'preparado']);
  const filaAuditoria = auditoria.getLastRow();
  SpreadsheetApp.flush();
  s.getRange(i + 1, 1, 1, fila.length).setValues([fila]);
  auditoria.getRange(filaAuditoria, 7).setValue('confirmado');
  return { ok: true, mensaje: '✅ Movimiento ' + (a.subtipo === 'ANULAR' ? 'anulado (historial conservado).' : 'corregido: ' + dinero_(fila[c.monto]) + ' · ' + fila[c.ambito] + ' · ' + fechaRegistro_(fila[0])), referencia: ref };
};
/** Lectura compatible con registros antiguos; no inventa ámbito ni suma visitas de Fresha. */
const resumirMovimientos_ = (inicio, fin, ambito) => {
  const ss = SpreadsheetApp.openById(getSheetId_());
  const resultado = { PERSONAL: { gastos: 0, ingresos: 0 }, BARBERIA: { gastos: 0, ingresos: 0 }, SIN_CLASIFICAR: { gastos: 0, ingresos: 0 }, omitidos: 0, categorias: {} };
  ['GASTO', 'INGRESO'].forEach(tipo => {
    const s = ss.getSheetByName(tipo === 'GASTO' ? 'Gastos' : 'Ingresos');
    if (!s) return;
    const c = indicesMovimiento_(tipo), data = s.getDataRange().getValues();
    const esperadas = tipo === 'GASTO' ? COLUMNAS_GASTOS : COLUMNAS_INGRESOS;
    const base = tipo === 'GASTO' ? 5 : 4;
    if (data[0].length < base || data[0].slice(0, base).some((v, i) => normalizarTexto_(v) !== normalizarTexto_(esperadas[i]))) throw new Error('Esquema histórico incompatible.');
    data.slice(1).forEach(r => {
      if (r[c.estado] === 'ANULADO' || r.every(v => v === '')) return;
      const f = fechaRegistro_(r[0]), monto = Number(r[c.monto]);
      if (!f || !Number.isFinite(monto) || monto <= 0) { resultado.omitidos++; return; }
      if (f < inicio || f > fin) return;
      const grupo = ['PERSONAL', 'BARBERIA'].includes(r[c.ambito]) ? r[c.ambito] : 'SIN_CLASIFICAR';
      if (ambito && ambito !== 'TODOS' && grupo !== ambito) return;
      resultado[grupo][tipo === 'GASTO' ? 'gastos' : 'ingresos'] += monto;
      if (tipo === 'GASTO') resultado.categorias[r[2] || 'Otro'] = (resultado.categorias[r[2] || 'Otro'] || 0) + monto;
    });
  });
  return resultado;
};
const reporteFinanzasPersonal_ = (a = {}) => {
  if (a.ambito && !['PERSONAL', 'BARBERIA', 'TODOS', 'SIN_CLASIFICAR'].includes(a.ambito)) return fallo_('Ámbito no reconocido.');
  const r = rangoReporte_(a), datos = resumirMovimientos_(r.inicio, r.fin, a.ambito);
  let mensaje = '💰 Registros del ' + r.inicio + ' al ' + r.fin + '\n';
  ['PERSONAL', 'BARBERIA', 'SIN_CLASIFICAR'].forEach(k => {
    if (a.ambito && a.ambito !== 'TODOS' && a.ambito !== k) return;
    mensaje += '\n' + k + ': gastos ' + dinero_(datos[k].gastos) + ' · ingresos registrados ' + dinero_(datos[k].ingresos);
  });
  Object.keys(datos.categorias).forEach(k => { mensaje += '\n• ' + escapeHtml_(k) + ': ' + dinero_(datos.categorias[k]); });
  mensaje += '\n\nNo incluye las ventas de Fresha ni representa la utilidad del negocio. Los datos antiguos conservan su ámbito sin clasificar.';
  if (datos.omitidos) mensaje += '\n⚠️ Hay ' + datos.omitidos + ' filas con fecha o monto inválido que requieren revisión.';
  return { ok: true, mensaje };
};
/** Compatibilidad de lectura para herramientas históricas; ya no suma Historial_Visitas. */
const _calcularFinanzasRango_ = (ss, inicio, fin) => {
  const r = resumirMovimientos_(fechaChile_(inicio), fechaChile_(fin));
  const grupos = [r.PERSONAL, r.BARBERIA, r.SIN_CLASIFICAR];
  const ingresos = grupos.reduce((n, g) => n + g.ingresos, 0), gastos = grupos.reduce((n, g) => n + g.gastos, 0);
  return { ingresos, gastos, balance: ingresos - gastos, clientes: 0 };
};
const generarReporteGastos_ = (a) => reporteFinanzasPersonal_(a);
const anularUltimoGasto_ = () => fallo_('Usa Telegram para anular un movimiento por su referencia reciente.');

const listarMovimientos_ = (a = {}) => {
  const rango = rangoReporte_(a), ss = SpreadsheetApp.openById(getSheetId_()), items = [];
  if (a.ambito && !['PERSONAL', 'BARBERIA', 'TODOS', 'SIN_CLASIFICAR'].includes(a.ambito)) return fallo_('Ámbito no reconocido.');
  ['GASTO', 'INGRESO'].forEach(tipo => {
    if (a.movimiento && a.movimiento !== tipo) return;
    const s = ss.getSheetByName(tipo === 'GASTO' ? 'Gastos' : 'Ingresos');
    if (!s) return;
    const c = indicesMovimiento_(tipo);
    s.getDataRange().getValues().slice(1).forEach(r => {
      const f = fechaRegistro_(r[0]), ambito = r[c.ambito] || 'SIN_CLASIFICAR';
      if (!f || f < rango.inicio || f > rango.fin || r[c.estado] === 'ANULADO') return;
      if (a.ambito && a.ambito !== 'TODOS' && a.ambito !== ambito) return;
      items.push({ fecha: f, linea: tipo + ' · ' + f + ' · ' + dinero_(r[c.monto]) + ' · ' + escapeHtml_(r[c.desc]) + ' · ' + escapeHtml_(ambito) + '\nID: ' + (r[c.id] || '(histórico sin ID: ejecutar preparación)') });
    });
  });
  items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { ok: true, mensaje: items.length ? items.slice(0, 20).map(i => i.linea).join('\n\n') + (items.length > 20 ? '\nMostrando 20 de ' + items.length + '. Reduce el período.' : '') : 'No hay movimientos activos en ese período.' };
};

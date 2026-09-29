/** Finanzas personales: esquemas aditivos, correcciones por ID y anulación sin borrar. */
const CATEGORIAS_GASTO = ['Insumos', 'Alimentación', 'Transporte', 'Servicios', 'Educación', 'Equipamiento', 'Personal', 'Otro'];
const getSheetId = () => {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Falta SHEET_ID.');
  return id;
};
const _getOrCreateSheet = (ss, name, headers) => {
  let s = ss.getSheetByName(name);
  if (!s) { s = ss.insertSheet(name); s.appendRow(headers); }
  return s;
};
const COLUMNAS_GASTOS = ['fecha', 'hora', 'categoría', 'descripción', 'monto', 'id', 'ambito', 'estado', 'creado_en', 'actualizado_en', 'origen'];
const COLUMNAS_INGRESOS = ['fecha', 'hora', 'descripción', 'monto', 'id', 'ambito', 'estado', 'creado_en', 'actualizado_en', 'origen'];
const _getHojaGastos = () => hojaConEsquema('Gastos', COLUMNAS_GASTOS);
const hojaMovimiento = (tipo) => tipo === 'GASTO' ? _getHojaGastos() : hojaConEsquema('Ingresos', COLUMNAS_INGRESOS);
const indicesMovimiento = (tipo) => tipo === 'GASTO'
  ? { desc: 3, monto: 4, id: 5, ambito: 6, estado: 7, creado: 8, actualizado: 9, origen: 10 }
  : { desc: 2, monto: 3, id: 4, ambito: 5, estado: 6, creado: 7, actualizado: 8, origen: 9 };
const validarMovimiento = (a) => {
  if (typeof a.monto !== 'number' || !Number.isFinite(a.monto) || a.monto <= 0) return '¿Cuál es el monto? Debe ser un número mayor que cero.';
  if (typeof a.descripcion !== 'string' || !a.descripcion.trim() || a.descripcion.length > 300) return 'Indica una descripción breve del movimiento.';
  if (!['PERSONAL', 'BARBERIA'].includes(a.ambito)) return '¿Es personal o de la barbería?';
  if (a.fecha !== undefined && !fechaValida(a.fecha)) return 'Indica una fecha válida (AAAA-MM-DD).';
  if (a.categoria && !CATEGORIAS_GASTO.includes(a.categoria)) return 'Indica una categoría válida: ' + CATEGORIAS_GASTO.join(', ') + '.';
  return '';
};
const registrarFinanzas = (a, ahora = new Date()) => {
  if (!['GASTO', 'INGRESO'].includes(a.subtipo)) return fallo('Tipo de movimiento inválido.');
  const error = validarMovimiento(a);
  if (error) return pedirDato(a, error);
  const s = hojaMovimiento(a.subtipo), id = Utilities.getUuid();
  const fila = a.subtipo === 'GASTO'
    ? [a.fecha || fechaChile(ahora), horaChile(ahora), a.categoria || 'Otro', textoSeguroSheet(a.descripcion), a.monto]
    : [a.fecha || fechaChile(ahora), horaChile(ahora), textoSeguroSheet(a.descripcion), a.monto];
  s.appendRow([...fila, id, a.ambito, 'ACTIVO', ahora, ahora, 'BOT_MANUAL']);
  return { ok: true, mensaje: '✅ ' + (a.subtipo === 'GASTO' ? 'Gasto' : 'Ingreso manual') + ' registrado: ' + dinero(a.monto) + '\n' + escapeHtml(a.descripcion) + ' · ' + a.ambito + ' · ' + fila[0], referencia: { tipo: 'FINANZAS', movimiento: a.subtipo, id } };
};
const procesarFinanzas = (a, contexto = {}) => {
  if (a.subtipo === 'LISTAR') return listarMovimientos(a);
  if (['GASTO', 'INGRESO'].includes(a.subtipo)) return registrarFinanzas(a);
  if (!['MODIFICAR', 'ANULAR'].includes(a.subtipo)) return fallo('Operación financiera no reconocida.');
  const ref = a.usar_ultimo === true ? contexto.ultimo : { tipo: 'FINANZAS', id: a.id, movimiento: a.movimiento };
  if (!ref || ref.tipo !== 'FINANZAS' || !ref.id || !['GASTO', 'INGRESO'].includes(ref.movimiento)) return fallo('Indica el ID y si es gasto o ingreso; no hay un movimiento reciente inequívoco.');
  if (a.movimiento && a.movimiento !== ref.movimiento) return fallo('El movimiento reciente no es del tipo indicado. Consulta su ID antes de corregirlo.');
  const s = hojaMovimiento(ref.movimiento), c = indicesMovimiento(ref.movimiento), data = s.getDataRange().getValues();
  const i = data.findIndex((r, n) => n > 0 && r[c.id] === ref.id);
  if (i < 1) return fallo('No encontré ese movimiento.');
  const fila = data[i].slice();
  if (fila[c.estado] === 'ANULADO') return fallo('Ese movimiento ya está anulado.');
  if (a.subtipo === 'ANULAR') fila[c.estado] = 'ANULADO';
  else {
    const actual = { monto: fila[c.monto], descripcion: String(fila[c.desc]), ambito: fila[c.ambito], fecha: fechaRegistro(fila[0]), categoria: ref.movimiento === 'GASTO' ? fila[2] : undefined };
    const campos = ['monto', 'descripcion', 'ambito', 'fecha'];
    if (ref.movimiento === 'GASTO') campos.push('categoria');
    let cambios = 0;
    campos.forEach(k => { if (Object.prototype.hasOwnProperty.call(a, k)) { actual[k] = a[k]; cambios++; } });
    if (!cambios) return fallo('Indica qué dato quieres cambiar.');
    const error = validarMovimiento(actual);
    if (error) return pedirDato(a, error);
    fila[0] = actual.fecha; fila[c.desc] = textoSeguroSheet(actual.descripcion); fila[c.monto] = actual.monto; fila[c.ambito] = actual.ambito;
    if (ref.movimiento === 'GASTO') fila[2] = actual.categoria;
  }
  fila[c.actualizado] = new Date();
  s.getRange(i + 1, 1, 1, fila.length).setValues([fila]);
  return { ok: true, mensaje: '✅ Movimiento ' + (a.subtipo === 'ANULAR' ? 'anulado (historial conservado).' : 'corregido: ' + dinero(fila[c.monto]) + ' · ' + fila[c.ambito] + ' · ' + fechaRegistro(fila[0])), referencia: ref };
};
/** Lectura compatible con registros antiguos; no inventa ámbito ni suma visitas de Fresha. */
const resumirMovimientos = (inicio, fin, ambito) => {
  const ss = SpreadsheetApp.openById(getSheetId());
  const resultado = { PERSONAL: { gastos: 0, ingresos: 0 }, BARBERIA: { gastos: 0, ingresos: 0 }, SIN_CLASIFICAR: { gastos: 0, ingresos: 0 }, omitidos: 0, categorias: {} };
  ['GASTO', 'INGRESO'].forEach(tipo => {
    const s = ss.getSheetByName(tipo === 'GASTO' ? 'Gastos' : 'Ingresos');
    if (!s) return;
    const c = indicesMovimiento(tipo), data = s.getDataRange().getValues();
    const esperadas = tipo === 'GASTO' ? COLUMNAS_GASTOS : COLUMNAS_INGRESOS;
    const base = tipo === 'GASTO' ? 5 : 4;
    if (data[0].length < base || data[0].slice(0, base).some((v, i) => normalizarTexto(v) !== normalizarTexto(esperadas[i]))) throw new Error('Esquema histórico incompatible.');
    data.slice(1).forEach(r => {
      if (r[c.estado] === 'ANULADO' || r.every(v => v === '')) return;
      const f = fechaRegistro(r[0]), monto = Number(r[c.monto]);
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
const reporteFinanzasPersonal = (a = {}) => {
  if (a.ambito && !['PERSONAL', 'BARBERIA', 'TODOS', 'SIN_CLASIFICAR'].includes(a.ambito)) return fallo('Ámbito no reconocido.');
  const r = rangoReporte(a), datos = resumirMovimientos(r.inicio, r.fin, a.ambito);
  let mensaje = '💰 Registros del ' + r.inicio + ' al ' + r.fin + '\n';
  ['PERSONAL', 'BARBERIA', 'SIN_CLASIFICAR'].forEach(k => {
    if (a.ambito && a.ambito !== 'TODOS' && a.ambito !== k) return;
    mensaje += '\n' + k + ': gastos ' + dinero(datos[k].gastos) + ' · ingresos registrados ' + dinero(datos[k].ingresos);
  });
  Object.keys(datos.categorias).forEach(k => { mensaje += '\n• ' + escapeHtml(k) + ': ' + dinero(datos.categorias[k]); });
  mensaje += '\n\nNo incluye las ventas de Fresha ni representa la utilidad del negocio. Los datos antiguos conservan su ámbito sin clasificar.';
  if (datos.omitidos) mensaje += '\n⚠️ Hay ' + datos.omitidos + ' filas con fecha o monto inválido que requieren revisión.';
  return { ok: true, mensaje };
};
/** Compatibilidad de lectura para herramientas históricas; ya no suma Historial_Visitas. */
const _calcularFinanzasRango = (ss, inicio, fin) => {
  const r = resumirMovimientos(fechaChile(inicio), fechaChile(fin));
  const grupos = [r.PERSONAL, r.BARBERIA, r.SIN_CLASIFICAR];
  const ingresos = grupos.reduce((n, g) => n + g.ingresos, 0), gastos = grupos.reduce((n, g) => n + g.gastos, 0);
  return { ingresos, gastos, balance: ingresos - gastos, clientes: 0 };
};
const generarReporteGastos = (a) => reporteFinanzasPersonal(a);
const anularUltimoGasto = () => fallo('Usa Telegram para anular un movimiento por su referencia reciente.');

const listarMovimientos = (a = {}) => {
  const rango = rangoReporte(a), ss = SpreadsheetApp.openById(getSheetId()), items = [];
  if (a.ambito && !['PERSONAL', 'BARBERIA', 'TODOS', 'SIN_CLASIFICAR'].includes(a.ambito)) return fallo('Ámbito no reconocido.');
  ['GASTO', 'INGRESO'].forEach(tipo => {
    if (a.movimiento && a.movimiento !== tipo) return;
    const s = ss.getSheetByName(tipo === 'GASTO' ? 'Gastos' : 'Ingresos');
    if (!s) return;
    const c = indicesMovimiento(tipo);
    s.getDataRange().getValues().slice(1).forEach(r => {
      const f = fechaRegistro(r[0]), ambito = r[c.ambito] || 'SIN_CLASIFICAR';
      if (!f || f < rango.inicio || f > rango.fin || r[c.estado] === 'ANULADO') return;
      if (a.ambito && a.ambito !== 'TODOS' && a.ambito !== ambito) return;
      items.push({ fecha: f, linea: tipo + ' · ' + f + ' · ' + dinero(r[c.monto]) + ' · ' + escapeHtml(r[c.desc]) + ' · ' + escapeHtml(ambito) + '\nID: ' + (r[c.id] || '(histórico sin ID: ejecutar preparación)') });
    });
  });
  items.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { ok: true, mensaje: items.length ? items.slice(0, 20).map(i => i.linea).join('\n\n') + (items.length > 20 ? '\nMostrando 20 de ' + items.length + '. Reduce el período.' : '') : 'No hay movimientos activos en ese período.' };
};

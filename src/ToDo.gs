/** Tareas con vencimiento, identificador y estados; no borra el historial. */
const _getToDoSheet_ = () => hojaConEsquema_('To_Do', ['fecha_creación', 'categoría', 'tarea', 'estado', 'fecha_completada', 'id', 'fecha_limite', 'actualizado_en']);
const categoriasTarea = ['Personal', 'Universidad', 'Barberia'];
const buscarTarea_ = (data, a, contexto) => {
  let id = a.id;
  if (a.usar_ultimo === true) {
    if (!contexto.ultimo || contexto.ultimo.tipo !== 'TODO') return { error: 'No hay una tarea reciente inequívoca. Indica su nombre o ID.' };
    id = contexto.ultimo.id;
  }
  const nombre = normalizarTexto_(a.tarea);
  if (!id && !nombre) return { error: 'Indica el nombre o ID de la tarea.' };
  const candidatas = data.map((r, i) => ({ r, i })).filter(x => x.i > 0 && x.r[3] === 'pendiente');
  let halladas = id ? candidatas.filter(x => x.r[5] === id) : candidatas.filter(x => normalizarTexto_(x.r[2]) === nombre);
  if (!id && !halladas.length) halladas = candidatas.filter(x => nombre.split(/\s+/).every(p => normalizarTexto_(x.r[2]).includes(p)));
  if (!halladas.length) return { error: 'No encontré esa tarea pendiente.' };
  if (halladas.length > 1) return { error: 'Hay varias tareas coincidentes. Indica un nombre más específico o el ID mostrado en la lista.' };
  return halladas[0];
};
const obtenerTareas_ = (a = {}) => {
  const data = _getToDoSheet_().getDataRange().getValues();
  const hoy = fechaChile_(), manana = sumarDias_(hoy, 1), fin = sumarDias_(hoy, 6);
  return data.slice(1).filter(r => {
    if (r[3] !== 'pendiente') return false;
    if (a.categoria && a.categoria !== 'TODAS' && normalizarTexto_(r[1]) !== normalizarTexto_(a.categoria)) return false;
    const f = fechaRegistro_(r[6]);
    if (a.periodo === 'VENCIDAS') return f && f < hoy;
    if (a.periodo === 'HOY') return f === hoy;
    if (a.periodo === 'MANANA') return f === manana;
    if (a.periodo === 'SEMANA') return f && f >= hoy && f <= fin;
    return true;
  }).map(r => ({ categoria: r[1], tarea: r[2], id: r[5] || '', fecha: fechaRegistro_(r[6]) }))
    .sort((a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999'));
};
const listarTareas_ = (a = {}) => {
  if (a.periodo && !['TODAS', 'HOY', 'MANANA', 'SEMANA', 'VENCIDAS'].includes(a.periodo)) return fallo_('Período de tareas no reconocido.');
  const tareas = obtenerTareas_(a);
  if (!tareas.length) return { ok: true, mensaje: '✅ No hay tareas pendientes para ese filtro.' };
  const lineas = tareas.slice(0, 30).map(t => '• [' + escapeHtml_(t.categoria) + '] ' + escapeHtml_(t.tarea) + ' · ' + (t.fecha || 'sin vencimiento') + (t.id ? '\n  ID: ' + t.id : ''));
  return { ok: true, mensaje: '📝 Tareas pendientes\n' + lineas.join('\n') + (tareas.length > 30 ? '\nMostrando 30 de ' + tareas.length + '. Filtra por categoría o fecha.' : '') };
};
const procesarToDo_ = (a, contexto = {}) => {
  if (a.subtipo === 'LISTAR') return listarTareas_(a);
  if (!['AGREGAR', 'MODIFICAR', 'COMPLETAR', 'ELIMINAR'].includes(a.subtipo)) return fallo_('Operación de tareas no reconocida.');
  if (a.categoria && !categoriasTarea.includes(a.categoria)) return pedirDato_(a, '¿La tarea es Personal, Universidad o Barberia?');
  if (a.fecha_limite !== undefined && a.fecha_limite !== '' && !fechaValida_(a.fecha_limite)) return pedirDato_(a, 'Indica una fecha límite válida.');
  if (a.subtipo === 'AGREGAR' && (typeof a.tarea !== 'string' || !a.tarea.trim() || a.tarea.length > 300)) return pedirDato_(a, '¿Qué tarea quieres agregar? Usa una descripción breve.');
  const s = _getToDoSheet_(), ahora = new Date();
  if (a.subtipo === 'AGREGAR') {
    const id = Utilities.getUuid(), categoria = a.categoria || 'Personal';
    s.appendRow([ahora, categoria, textoSeguroSheet_(a.tarea), 'pendiente', '', id, a.fecha_limite || '', ahora]);
    return { ok: true, mensaje: '✅ Tarea guardada: ' + escapeHtml_(a.tarea) + ' · ' + (a.fecha_limite || 'sin vencimiento'), referencia: { tipo: 'TODO', id } };
  }
  const encontrada = buscarTarea_(s.getDataRange().getValues(), a, contexto);
  if (encontrada.error) return fallo_(encontrada.error);
  const fila = encontrada.r.slice();
  while (fila.length < 8) fila.push('');
  fila[5] = fila[5] || Utilities.getUuid(); fila[7] = ahora;
  if (a.subtipo === 'MODIFICAR') {
    if (a.nueva_tarea !== undefined) {
      if (typeof a.nueva_tarea !== 'string' || !a.nueva_tarea.trim() || a.nueva_tarea.length > 300) return fallo_('El nuevo nombre debe ser breve y no estar vacío.');
      fila[2] = textoSeguroSheet_(a.nueva_tarea);
    }
    if (a.categoria) fila[1] = a.categoria;
    if (a.fecha_limite !== undefined) fila[6] = a.fecha_limite || '';
    if (a.nueva_tarea === undefined && !a.categoria && a.fecha_limite === undefined) return fallo_('Indica qué dato de la tarea quieres cambiar.');
  } else {
    fila[3] = a.subtipo === 'COMPLETAR' ? 'completada' : 'eliminada';
    if (a.subtipo === 'COMPLETAR') fila[4] = ahora;
  }
  s.getRange(encontrada.i + 1, 1, 1, 8).setValues([fila]);
  return { ok: true, mensaje: '✅ Tarea ' + (a.subtipo === 'MODIFICAR' ? 'corregida' : fila[3]) + ': ' + escapeHtml_(fila[2]), referencia: { tipo: 'TODO', id: fila[5] } };
};

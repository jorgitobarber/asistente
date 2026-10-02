/** Agenda personal. Fresha es independiente y no participa en la disponibilidad. */
const getCalendarId_ = (key) => {
  const id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) throw new Error('Falta configurar ' + key + '.');
  return id;
};
const getCalendarTarget_ = (tipo) => {
  const claves = { UNIVERSIDAD: 'CALENDAR_UNI_ID', COMPROMISOS: 'CALENDAR_COMPROMISOS_ID' };
  if (!claves[tipo]) throw new Error('Solo se permiten calendarios personales o de universidad.');
  const cal = CalendarApp.getCalendarById(getCalendarId_(claves[tipo]));
  if (!cal) throw new Error('Calendario inaccesible.');
  return cal;
};
const _parseDateTime_ = (f, h) => fechaHoraChile_(f, h || '12:00');
const _verificarChoques_ = (inicio, fin, excluirId, excluirCalendario) => {
  const choques = [], vistos = new Set();
  ['CALENDAR_UNI_ID', 'CALENDAR_COMPROMISOS_ID'].forEach(key => {
    const id = getCalendarId_(key);
    if (vistos.has(id)) return;
    vistos.add(id);
    const cal = CalendarApp.getCalendarById(id);
    if (!cal) throw new Error('No pude comprobar ambos calendarios personales.');
    cal.getEvents(inicio, fin).forEach(ev => {
      if (ev.getId() === excluirId && id === excluirCalendario) return;
      choques.push(ev.getTitle());
    });
  });
  return choques;
};
const _buscarEventoUnico_ = (a, calendar) => {
  if (a.id_evento_calendar) {
    const ev = calendar.getEventById(a.id_evento_calendar);
    if (!ev) throw new Error('No encontré el evento indicado.');
    return ev;
  }
  const f = a.fecha_original || a.fecha_estimada;
  if (!fechaValida_(f) || !a.evento) throw new Error('Indica nombre y fecha del evento.');
  const inicio = fechaHoraChile_(f, '00:00'), fin = fechaHoraChile_(sumarDias_(f, 1), '00:00');
  let eventos = calendar.getEvents(inicio, fin).filter(ev => normalizarTexto_(ev.getTitle()).includes(normalizarTexto_(a.evento)));
  if (a.hora_original) eventos = eventos.filter(ev => horaChile_(ev.getStartTime()) === a.hora_original);
  if (eventos.length !== 1) throw new Error(eventos.length ? 'Hay varios eventos coincidentes. Indica nombre y hora exactos.' : 'No encontré ese evento.');
  return eventos[0];
};
const validarDuracion_ = (v) => v === undefined || (typeof v === 'number' && Number.isInteger(v) && v >= 5 && v <= 1440);
const revisarChoques_ = (inicio, fin, a, id, calId) => {
  const choques = _verificarChoques_(inicio, fin, id, calId);
  if (choques.length && a.ignorar_choques !== true) throw new Error('Hay un choque con: ' + choques.join(', ') + '. Repite la solicitud completa indicando «ignora el choque» si quieres continuar. Fresha no está conectado.');
};
const crearEvento_ = (a, cal) => {
  if (!a.evento || !fechaValida_(a.fecha_estimada) || (a.hora_estimada && !horaValida_(a.hora_estimada)) || !validarDuracion_(a.duracion_minutos)) throw new Error('Datos de evento inválidos.');
  let ev;
  if (!a.hora_estimada) {
    revisarChoques_(fechaHoraChile_(a.fecha_estimada, '00:00'), fechaHoraChile_(sumarDias_(a.fecha_estimada, 1), '00:00'), a);
    ev = cal.createAllDayEvent(a.evento, fechaHoraChile_(a.fecha_estimada, '12:00'));
  }
  else {
    const inicio = fechaHoraChile_(a.fecha_estimada, a.hora_estimada), fin = new Date(inicio.getTime() + (a.duracion_minutos || 60) * 60000);
    revisarChoques_(inicio, fin, a);
    ev = cal.createEvent(a.evento, inicio, fin);
  }
  return ev.getId();
};
const modificarEvento_ = (a, cal) => {
  const ev = _buscarEventoUnico_(a, cal);
  if (!a.nueva_fecha && !a.nueva_hora && !a.nuevo_evento && a.duracion_minutos === undefined) throw new Error('Indica qué dato quieres cambiar.');
  if (!validarDuracion_(a.duracion_minutos)) throw new Error('Duración inválida.');
  if (a.nuevo_evento !== undefined && (typeof a.nuevo_evento !== 'string' || !a.nuevo_evento.trim() || a.nuevo_evento.length > 300)) throw new Error('Título inválido.');
  if (a.nueva_fecha || a.nueva_hora || a.duracion_minutos !== undefined) {
    const f = a.nueva_fecha || fechaChile_(ev.getStartTime());
    if (ev.isAllDayEvent() && !a.nueva_hora) {
      const dias = Math.max(1, Math.round((ev.getEndTime() - ev.getStartTime()) / 86400000));
      if (a.duracion_minutos !== undefined) throw new Error('Para dar duración horaria a un evento de día completo, indica una hora.');
      revisarChoques_(fechaHoraChile_(f, '00:00'), fechaHoraChile_(sumarDias_(f, dias), '00:00'), a, ev.getId(), cal.getId());
      ev.setAllDayDates(fechaHoraChile_(f, '12:00'), fechaHoraChile_(sumarDias_(f, dias), '12:00'));
    } else {
      const inicio = fechaHoraChile_(f, a.nueva_hora || horaChile_(ev.getStartTime()));
      const duracion = a.duracion_minutos !== undefined ? a.duracion_minutos * 60000 : ev.isAllDayEvent() ? 3600000 : ev.getEndTime() - ev.getStartTime();
      const fin = new Date(inicio.getTime() + duracion);
      revisarChoques_(inicio, fin, a, ev.getId(), cal.getId());
      ev.setTime(inicio, fin);
    }
  }
  // El título cambia después de validar el horario; un choque no deja un título modificado.
  if (a.nuevo_evento) ev.setTitle(a.nuevo_evento);
  return ev.getId();
};
const eliminarEvento_ = (a, cal) => { const ev = _buscarEventoUnico_(a, cal); ev.deleteEvent(); };
const procesarAgenda_ = (accion, contexto = {}) => {
  const a = { ...accion };
  if (a.usar_ultimo === true) {
    if (!contexto.ultimo || contexto.ultimo.tipo !== 'AGENDA') return fallo_('No hay un evento reciente inequívoco. Indica nombre y fecha.');
    a.id_evento_calendar = contexto.ultimo.id; a.calendario = contexto.ultimo.calendario;
  }
  if (!['CREAR', 'MODIFICAR', 'ELIMINAR'].includes(a.subtipo)) return fallo_('Operación de agenda desconocida.');
  if (!['UNIVERSIDAD', 'COMPROMISOS'].includes(a.calendario)) return pedirDato_(a, '¿Es un evento de universidad o un compromiso personal?');
  if (a.subtipo === 'CREAR') {
    if (typeof a.evento !== 'string' || !a.evento.trim() || a.evento.length > 300) return pedirDato_(a, '¿Qué evento quieres crear?');
    if (!fechaValida_(a.fecha_estimada)) return pedirDato_(a, '¿En qué fecha es el evento?');
    if (a.hora_estimada && !horaValida_(a.hora_estimada)) return pedirDato_(a, 'Indica una hora válida.');
  }
  if (a.subtipo !== 'CREAR' && !a.id_evento_calendar) {
    if (!a.evento) return pedirDato_(a, '¿Cuál es el nombre del evento?');
    if (!fechaValida_(a.fecha_original || a.fecha_estimada)) return pedirDato_(a, '¿En qué fecha está el evento que quieres cambiar o eliminar?');
  }
  try {
    const cal = getCalendarTarget_(a.calendario);
    let id;
    if (a.subtipo === 'CREAR') id = crearEvento_(a, cal);
    else if (a.subtipo === 'MODIFICAR') id = modificarEvento_(a, cal);
    else eliminarEvento_(a, cal);
    const res = { ok: true, mensaje: '✅ Evento ' + ({ CREAR: 'creado', MODIFICAR: 'modificado', ELIMINAR: 'eliminado' })[a.subtipo] + ' en ' + a.calendario + '.' };
    if (id) res.referencia = { tipo: 'AGENDA', id, calendario: a.calendario };
    return res;
  } catch (error) { return fallo_(escapeHtml_(error.message)); }
};

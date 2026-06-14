/**
 * Módulo Agenda: Maneja la conexión con Google Calendar.
 * Permite crear, modificar y eliminar eventos para la universidad, la barbería y compromisos.
 */

const getCalendarId = (key) => {
  const id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) throw new Error(`Falta configurar ${key} en PropertiesService.`);
  return id;
};

/**
 * Retorna el calendario objetivo basado en la clasificación de Gemini
 */
const getCalendarTarget = (calendarioType) => {
  if (calendarioType === "UNIVERSIDAD") return CalendarApp.getCalendarById(getCalendarId('CALENDAR_UNI_ID'));
  if (calendarioType === "COMPROMISOS") return CalendarApp.getCalendarById(getCalendarId('CALENDAR_COMPROMISOS_ID'));
  return CalendarApp.getCalendarById(getCalendarId('CALENDAR_BARBERIA_ID')); // Default
};

/**
 * Verifica si hay eventos superpuestos en cualquiera de los 3 calendarios
 */
const _verificarChoques = (startTime, endTime) => {
  const keys = ['CALENDAR_UNI_ID', 'CALENDAR_BARBERIA_ID', 'CALENDAR_COMPROMISOS_ID'];
  const choques = [];
  
  for (const key of keys) {
    const calId = PropertiesService.getScriptProperties().getProperty(key);
    if (!calId) continue;
    
    const cal = CalendarApp.getCalendarById(calId);
    if (cal) {
      const events = cal.getEvents(startTime, endTime);
      for (const e of events) {
        choques.push(e.getTitle());
      }
    }
  }
  return choques;
};

/**
 * Parsea fecha y hora en un objeto Date
 */
const _parseDateTime = (fechaStr, horaStr) => {
  const [year, month, day] = fechaStr ? fechaStr.split("-") : [new Date().getFullYear(), new Date().getMonth() + 1, new Date().getDate()];
  const [hour, min] = horaStr ? horaStr.split(":") : [12, 0];
  return new Date(year, month - 1, day, hour, min);
};

/**
 * Busca un evento en el día especificado que coincida con el nombre
 */
const _buscarEventoUnico = (accion, calendar) => {
  const startOfDay = _parseDateTime(accion.fecha_estimada, "00:00");
  const endOfDay = new Date(startOfDay.getTime() + (24 * 60 * 60 * 1000));
  
  const events = calendar.getEvents(startOfDay, endOfDay, { search: accion.evento });
  
  if (events.length === 0) {
    throw new Error(`No se encontró el evento "${accion.evento}" el ${accion.fecha_estimada} en este calendario.`);
  }
  if (events.length > 1) {
    console.warn(`[AGENDA] Múltiples eventos encontrados para "${accion.evento}". Modificando/Eliminando el primero.`);
  }
  
  return events[0];
};

/**
 * Crea un evento nuevo
 */
const crearEvento = (accion, calendar) => {
  const startTime = _parseDateTime(accion.fecha_estimada, accion.hora_estimada);
  const endTime = new Date(startTime.getTime() + (60 * 60 * 1000)); // 1 hora
  
  if (!accion.ignorar_choques) {
    const choques = _verificarChoques(startTime, endTime);
    if (choques.length > 0) {
      throw new Error(`⚠️ ¡Cuidado Jefe! Tienes un choque de horario con: "${choques.join(", ")}". No lo he agendado por precaución. Si quieres que lo agende de todas formas, solo confírmamelo (ej: "dale nomás", "agéndalo igual").`);
    }
  }

  const event = calendar.createEvent(accion.evento, startTime, endTime);
  console.log(`[AGENDA] Creado: ${accion.evento} el ${startTime}`);
};

/**
 * Modifica un evento existente (nombre, fecha u hora)
 */
const modificarEvento = (accion, calendar) => {
  const event = _buscarEventoUnico(accion, calendar);
  
  if (accion.nuevo_evento) {
    event.setTitle(accion.nuevo_evento);
  }
  
  if (accion.nueva_fecha || accion.nueva_hora) {
    const newFecha = accion.nueva_fecha || accion.fecha_estimada;
    
    // Si no mandan hora nueva, mantenemos la que ya tenía el evento
    const oldStart = event.getStartTime();
    const fallbackHora = `${oldStart.getHours().toString().padStart(2, '0')}:${oldStart.getMinutes().toString().padStart(2, '0')}`;
    const newHora = accion.nueva_hora || fallbackHora;
    
    const newStartTime = _parseDateTime(newFecha, newHora);
    const newEndTime = new Date(newStartTime.getTime() + (60 * 60 * 1000));
    event.setTime(newStartTime, newEndTime);
  }
  
  console.log(`[AGENDA] Modificado: ahora es ${event.getTitle()} el ${event.getStartTime()}`);
};

/**
 * Elimina un evento existente
 */
const eliminarEvento = (accion, calendar) => {
  const event = _buscarEventoUnico(accion, calendar);
  const title = event.getTitle();
  event.deleteEvent();
  console.log(`[AGENDA] Eliminado: ${title}`);
};

/**
 * Enrutador principal de Agenda
 */
const procesarAgenda = (accion) => {
  try {
    const calendar = getCalendarTarget(accion.calendario);
    if (!calendar) throw new Error(`No se encontró calendario: ${accion.calendario}`);

    if (accion.subtipo === "MODIFICAR") {
      modificarEvento(accion, calendar);
    } else if (accion.subtipo === "ELIMINAR") {
      eliminarEvento(accion, calendar);
    } else {
      crearEvento(accion, calendar);
    }
  } catch (error) {
    console.error(`[AGENDA] Error en procesarAgenda: ${error.message}`);
    throw error;
  }
};

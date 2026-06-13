/**
 * Módulo Agenda: Maneja la conexión con Google Calendar.
 * Permite crear, modificar y eliminar eventos para la universidad, la barbería y compromisos.
 */

const CALENDAR_BARBERIA_ID = "2930d60cbc2cb37c06e4ec922a2a1bae92c161be822ba8c71a978840a0258566@group.calendar.google.com"; 
const CALENDAR_UNI_ID = "06dc73a8b7f520cf60faa91d99e1db50b6cd5658efd7bed27b526cedd19789fc@group.calendar.google.com";
const CALENDAR_COMPROMISOS_ID = "42365440fe91167a9448a51273a6448c2671608198d524fdac898e172de885c8@group.calendar.google.com";

/**
 * Retorna el calendario objetivo basado en la clasificación de Gemini
 */
const getCalendarTarget = (calendarioType) => {
  if (calendarioType === "UNIVERSIDAD") return CalendarApp.getCalendarById(CALENDAR_UNI_ID);
  if (calendarioType === "COMPROMISOS") return CalendarApp.getCalendarById(CALENDAR_COMPROMISOS_ID);
  return CalendarApp.getCalendarById(CALENDAR_BARBERIA_ID); // Default
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

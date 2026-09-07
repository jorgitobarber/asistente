/**
 * Módulo ToDo: Maneja la lista de tareas pendientes.
 * Conexión a Google Sheets, pestaña "To_Do".
 */

const getSheetIdForToDo = () => {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error("Falta configurar SHEET_ID en las propiedades del script.");
  return id;
};

/**
 * Obtiene o crea la hoja To_Do
 */
const _getToDoSheet = () => {
  const ss = SpreadsheetApp.openById(getSheetIdForToDo());
  let sheet = ss.getSheetByName("To_Do");
  if (!sheet) {
    sheet = ss.insertSheet("To_Do");
    sheet.appendRow(["fecha_creación", "categoría", "tarea", "estado", "fecha_completada"]);
  }
  return sheet;
};

/**
 * Agrega una nueva tarea a la lista
 */
const agregarTarea = (accion) => {
  const sheet = _getToDoSheet();
  const fechaActual = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
  const categoria = accion.categoria || "Personal";
  const tarea = accion.tarea;
  
  sheet.appendRow([fechaActual, categoria, tarea, "pendiente", ""]);
  console.log(`[TODO] Tarea agregada: ${tarea} (${categoria})`);
};

/**
 * Busca la fila de una tarea pendiente que coincida parcial o totalmente con el nombre
 */
const _buscarFilaTarea = (sheet, nombreTarea) => {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const tareaStr = data[i][2] ? data[i][2].toString().toLowerCase() : "";
    const estado = data[i][3] ? data[i][3].toString().toLowerCase() : "";
    
    if (estado === "pendiente" && tareaStr.includes(nombreTarea.toLowerCase())) {
      return i + 1; // +1 porque el array es 0-indexed pero las filas de sheet son 1-indexed
    }
  }
  return -1;
};

/**
 * Marca una tarea como completada
 */
const completarTarea = (accion) => {
  const sheet = _getToDoSheet();
  const fila = _buscarFilaTarea(sheet, accion.tarea);
  
  if (fila !== -1) {
    const fechaActual = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    sheet.getRange(fila, 4).setValue("completada");
    sheet.getRange(fila, 5).setValue(fechaActual);
    console.log(`[TODO] Tarea completada en fila ${fila}`);
  } else {
    throw new Error(`No se encontró ninguna tarea pendiente que coincida con "${accion.tarea}".`);
  }
};

/**
 * Elimina una tarea de la lista (borra la fila)
 */
const eliminarTarea = (accion) => {
  const sheet = _getToDoSheet();
  const fila = _buscarFilaTarea(sheet, accion.tarea);
  
  if (fila !== -1) {
    sheet.deleteRow(fila);
    console.log(`[TODO] Tarea eliminada en fila ${fila}`);
  } else {
    throw new Error(`No se encontró ninguna tarea pendiente que coincida con "${accion.tarea}".`);
  }
};

/**
 * Lista las tareas pendientes por categoría o todas
 */
const listarTareas = (accion, chatId) => {
  const sheet = _getToDoSheet();
  const data = sheet.getDataRange().getValues();
  let tareas = [];
  
  for (let i = 1; i < data.length; i++) {
    const categoria = data[i][1];
    const tareaStr = data[i][2];
    const estado = data[i][3] ? data[i][3].toString().toLowerCase() : "";
    
    if (estado === "pendiente") {
      if (accion.categoria && accion.categoria !== "TODAS") {
        if (categoria.toLowerCase() === accion.categoria.toLowerCase()) {
          tareas.push(`- ${tareaStr}`);
        }
      } else {
        tareas.push(`- [${categoria}] ${tareaStr}`);
      }
    }
  }
  
  let mensaje = "📝 *Tus Pendientes:*\n\n";
  if (tareas.length === 0) {
    mensaje += "¡No tienes tareas pendientes! Estás al día. 🙌";
  } else {
    mensaje += tareas.join("\n");
  }
  
  // Enviar directamente el mensaje a Telegram
  if (chatId && typeof sendTelegramMessage === 'function') {
    sendTelegramMessage(chatId, mensaje);
  }
};

/**
 * Enrutador principal de ToDo
 */
const procesarToDo = (accion, chatId) => {
  try {
    if (accion.subtipo === "AGREGAR") {
      agregarTarea(accion);
    } else if (accion.subtipo === "COMPLETAR") {
      completarTarea(accion);
    } else if (accion.subtipo === "ELIMINAR") {
      eliminarTarea(accion);
    } else if (accion.subtipo === "LISTAR") {
      listarTareas(accion, chatId);
    } else {
      console.warn(`[TODO] Subtipo desconocido: ${accion.subtipo}`);
    }
  } catch (error) {
    console.error(`[TODO] Error en procesarToDo: ${error.message}`);
    throw error;
  }
};

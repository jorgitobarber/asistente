function LIMPIAR_DATOS() {
  let log = "";
  try {
    const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
    
    // 1. Limpiar "Ingresos"
    const sheetIngresos = ss.getSheetByName('Ingresos');
    if (sheetIngresos) {
      const dataI = sheetIngresos.getDataRange().getValues();
      let borradosI = 0;
      for (let i = dataI.length - 1; i >= 1; i--) {
        const desc = dataI[i][2] || '';
        const monto = dataI[i][3] || 0;
        if (desc.toString().includes('Venta Cera') && (monto === 40000 || monto === 5000)) {
          sheetIngresos.deleteRow(i + 1);
          borradosI++;
          log += `Fila de Ingreso falsa eliminada: ${desc} $${monto}\n`;
        }
      }
      log += `Total ingresos falsos eliminados: ${borradosI}\n\n`;
    }

    // 2. Limpiar "Citas" y Calendar
    const sheetCitas = ss.getSheetByName('Citas');
    if (sheetCitas) {
      const dataC = sheetCitas.getDataRange().getValues();
      const hoyStr = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
      
      let borradosC = 0;
      for (let i = dataC.length - 1; i >= 1; i--) {
        const d = dataC[i][0];
        let fecha = '';
        if (d) {
          fecha = (d instanceof Date) ? d.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' }) : d.toString();
        }
        
        const nombre = (dataC[i][2] || '').toString().toLowerCase();
        
        if (nombre.includes('jorge heins') && fecha.includes(hoyStr)) {
          const eventId = dataC[i][8];
          if (eventId) {
            try {
              const calId = PropertiesService.getScriptProperties().getProperty('CALENDAR_BARBERIA_ID');
              if (calId) {
                const cal = CalendarApp.getCalendarById(calId);
                cal.getEventById(eventId).deleteEvent();
                log += `Evento huérfano de Calendar eliminado: ${eventId}\n`;
              }
            } catch(e) {
              log += `No se pudo eliminar evento de Calendar: ${e.message}\n`;
            }
          }
          
          sheetCitas.deleteRow(i + 1);
          borradosC++;
          log += `Fila de Cita eliminada para Jorge Heins.\n`;
        }
      }
      log += `Total citas eliminadas: ${borradosC}\n`;
    }
    
    return log || "No se encontró nada para limpiar.";
  } catch(e) {
    return "Error en limpieza: " + e.message;
  }
}

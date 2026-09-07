/**
 * Módulo Finanzas: Maneja la conexión con Google Sheets.
 * Se encarga de insertar los gastos, ingresos y clientes del día.
 */

const getPreciosBarberia = () => {
  const preciosStr = PropertiesService.getScriptProperties().getProperty('PRECIOS_BARBERIA');
  if (!preciosStr) throw new Error("Falta configurar PRECIOS_BARBERIA (JSON) en las propiedades del script.");
  return JSON.parse(preciosStr);
};

const getSheetId = () => {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error("Falta configurar SHEET_ID en las propiedades del script.");
  return id;
};

const _getOrCreateSheet = (ss, name, headers) => {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
};

const registrarFinanzas = (accion, fechaActual) => {
  try {
    const ss = SpreadsheetApp.openById(getSheetId());
    
    const fecha = fechaActual.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    const hora = fechaActual.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' });

    if (accion.subtipo === "GASTO") {
      const sheet = _getOrCreateSheet(ss, "Gastos", ["fecha", "hora", "descripción", "monto"]);
      sheet.appendRow([fecha, hora, accion.descripcion, accion.monto]);
      console.log(`[FINANZAS] Gasto registrado: $${accion.monto} - ${accion.descripcion}`);
    } 
    else if (accion.subtipo === "INGRESO") {
      const sheet = _getOrCreateSheet(ss, "Ingresos", ["fecha", "hora", "descripción", "monto"]);
      sheet.appendRow([fecha, hora, accion.descripcion, accion.monto]);
      console.log(`[FINANZAS] Ingreso registrado: $${accion.monto} - ${accion.descripcion}`);
    }
    else if (accion.subtipo === "CLIENTE_DIA") {
      const sheet = _getOrCreateSheet(ss, "Clientes_del_dia", ["fecha", "hora_cita", "reportado", "servicios", "productos", "total"]);
      
      let total = 0;
      const servicios = accion.servicios || [];
      const productos = accion.productos || [];
      const preciosBarberia = getPreciosBarberia();
      
      servicios.forEach(s => {
        if (preciosBarberia[s]) total += preciosBarberia[s];
      });
      productos.forEach(p => {
        if (preciosBarberia[p]) total += preciosBarberia[p];
      });
      
      sheet.appendRow([
        fecha,
        accion.hora_cita || hora,
        "sí",
        servicios.join(", "),
        productos.join(", "),
        total
      ]);
      console.log(`[FINANZAS] Cliente registrado: Hora ${accion.hora_cita || hora}, Total $${total}`);
    }

  } catch (error) {
    console.error(`[FINANZAS] Error en registrarFinanzas: ${error.message}`);
    throw error;
  }
};

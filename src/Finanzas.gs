/**
 * Módulo Finanzas: Maneja la conexión con Google Sheets.
 * Se encarga de insertar los gastos, ingresos y clientes del día.
 */



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

    let msg = "";

    if (accion.subtipo === "GASTO") {
      const sheet = _getOrCreateSheet(ss, "Gastos", ["fecha", "hora", "descripción", "monto"]);
      sheet.appendRow([fecha, hora, accion.descripcion, accion.monto]);
      console.log(`[FINANZAS] Gasto registrado: $${accion.monto} - ${accion.descripcion}`);
      msg = `💸 Gasto registrado:\n$${accion.monto.toLocaleString('es-CL')} — ${escapeHtml(accion.descripcion)}`;
    } 
    else if (accion.subtipo === "INGRESO") {
      const sheet = _getOrCreateSheet(ss, "Ingresos", ["fecha", "hora", "descripción", "monto"]);
      sheet.appendRow([fecha, hora, accion.descripcion, accion.monto]);
      console.log(`[FINANZAS] Ingreso registrado: $${accion.monto} - ${accion.descripcion}`);
      msg = `💰 Ingreso registrado:\n$${accion.monto.toLocaleString('es-CL')} — ${escapeHtml(accion.descripcion)}`;
    }
    return { ok: true, mensaje: msg };
  } catch (error) {
    console.error(`[FINANZAS] Error en registrarFinanzas: ${error.message}`);
    return { ok: false, mensaje: `❌ Error al registrar finanzas: ${escapeHtml(error.message)}` };
  }
};

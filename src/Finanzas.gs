/**
 * Módulo Finanzas: Maneja la conexión con Google Sheets.
 * Se encarga de insertar los gastos o ingresos correspondientes.
 */

const SHEET_ID = "1CYVY3Ev7Lfql8lvukJdHK5BccAAKy44V4qqQAHPeS_w"; // Se configurará luego

/**
 * Inserta un registro financiero en la pestaña correcta.
 * 
 * @param {object} accionFinanzas - Objeto parseado por Gemini (tipo, subtipo, monto, descripcion, negocio).
 * @param {Date} fechaActual - Fecha en la que ocurre el registro.
 */
const registrarFinanzas = (accionFinanzas, fechaActual) => {
  try {
    const sheetName = accionFinanzas.negocio === "DECANTS" ? "Finanzas_Decants" : "Finanzas_Barberia";
    
    // Abrimos el Spreadsheet (costo $0, nativo de GAS)
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      throw new Error(`No se encontró la pestaña: ${sheetName}. Verifica tu archivo Sheets.`);
    }

    // Formato de fila: [Fecha, Tipo (Gasto/Ingreso), Monto, Descripción]
    const rowData = [
      fechaActual.toLocaleString('es-CL'), // Fecha formateada para Chile (aproximado)
      accionFinanzas.subtipo,
      accionFinanzas.monto,
      accionFinanzas.descripcion
    ];

    sheet.appendRow(rowData);
    console.log(`[FINANZAS] Registro exitoso en ${sheetName}: $${accionFinanzas.monto} - ${accionFinanzas.descripcion}`);

  } catch (error) {
    console.error(`[FINANZAS] Error en registrarFinanzas: ${error.message}`);
    throw error; // Propagamos a Main.gs
  }
};

/**
 * Función de prueba local
 */
const test_Finanzas = () => {
  console.log("--- Iniciando test_Finanzas ---");
  const mockAccion = {
    tipo: "FINANZAS",
    subtipo: "GASTO",
    monto: 20000,
    descripcion: "Compra de navajas de prueba",
    negocio: "BARBERIA"
  };
  
  try {
    // Fallará si no hay un SHEET_ID real o permisos, pero el try/catch funcionará
    registrarFinanzas(mockAccion, new Date());
  } catch (e) {
    console.log("Prueba capturó error esperado (Falta ID de Sheet):", e.message);
  }
  console.log("--- Fin test_Finanzas ---");
};

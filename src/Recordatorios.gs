/**
 * Módulo Recordatorios: Maneja alertas y avisos puntuales programados por el usuario.
 * Requiere un gatillo (Trigger) basado en tiempo que ejecute `procesarRecordatorios`
 * cada 10-15 minutos.
 */

const _getHojaRecordatorios = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  let sheet = ss.getSheetByName('Recordatorios');
  if (!sheet) {
    sheet = ss.insertSheet('Recordatorios');
    sheet.appendRow(['fecha_creacion', 'fecha_aviso', 'hora_aviso', 'mensaje', 'estado', 'chat_id']);
    console.log('[RECORDATORIOS] Hoja creada con columnas base.');
  }
  return sheet;
};

/**
 * Registra un nuevo recordatorio en la hoja.
 */
const agregarRecordatorio = (accion, chatId) => {
  try {
    const sheet = _getHojaRecordatorios();
    const hoy = new Date();
    const fechaCreacion = hoy.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    
    // Asumimos que Gemini nos manda fecha_aviso (YYYY-MM-DD) y hora_aviso (HH:MM)
    if (!accion.fecha_aviso || !accion.hora_aviso || !accion.mensaje) {
      throw new Error("Faltan datos (fecha, hora o mensaje) para crear el recordatorio.");
    }
    
    sheet.appendRow([
      fechaCreacion, 
      accion.fecha_aviso, 
      accion.hora_aviso, 
      accion.mensaje, 
      'pendiente', 
      chatId
    ]);
    
    console.log(`[RECORDATORIOS] Añadido: ${accion.mensaje} para ${accion.fecha_aviso} ${accion.hora_aviso}`);
    // No mandamos mensaje aquí porque Main.gs lo mandará con el "respuesta_telegram" general.
  } catch (error) {
    console.error(`[RECORDATORIOS] Error en agregarRecordatorio: ${error.message}`);
    if (chatId) sendTelegramMessage(chatId, '❌ No pude programar el recordatorio.');
  }
};

/**
 * Función que debe ser ejecutada por el Trigger de Apps Script (ej. cada 15 min).
 * Revisa recordatorios pendientes cuya fecha/hora ya pasaron y los envía.
 */
const procesarRecordatorios = () => {
  try {
    const sheet = _getHojaRecordatorios();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return; // Solo encabezados
    
    const ahoraStr = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    // Parseamos 'ahora' manualmente para comparar
    const [datePart, timePart] = ahoraStr.split(/,?\s+/);
    const [day, month, year] = datePart.split('-');
    const ahora = new Date(`${year}-${month}-${day}T${timePart}`);

    let procesados = 0;

    for (let i = 1; i < data.length; i++) {
      const estado = (data[i][4] || '').toString().toLowerCase();
      if (estado !== 'pendiente') continue;

      const fechaAvisoStr = data[i][1].toString(); // YYYY-MM-DD
      const horaAvisoStr = data[i][2].toString(); // HH:MM
      const mensaje = data[i][3];
      const chatId = data[i][5];

      if (!fechaAvisoStr || !horaAvisoStr) continue;

      // Armamos la fecha objetivo
      const objetivo = new Date(`${fechaAvisoStr}T${horaAvisoStr}:00`);

      // Si la fecha actual ya superó o es igual a la fecha objetivo
      if (ahora >= objetivo) {
        // Mandamos el aviso
        const textoAviso = `⏰ *RECORDATORIO*\n\n${mensaje}`;
        try {
          if (chatId) {
            sendTelegramMessage(chatId, textoAviso);
            console.log(`[RECORDATORIOS] Enviado: "${mensaje}" a ${chatId}`);
          }
          // Marcar como enviado
          sheet.getRange(i + 1, 5).setValue('enviado');
          procesados++;
        } catch (e) {
          console.error(`[RECORDATORIOS] Falló envío Telegram en fila ${i+1}: ${e.message}`);
        }
      }
    }
    
    if (procesados > 0) {
      console.log(`[RECORDATORIOS] Se procesaron y enviaron ${procesados} recordatorios.`);
    }
  } catch (error) {
    console.error(`[RECORDATORIOS] Error general en procesarRecordatorios: ${error.message}`);
  }
};

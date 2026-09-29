/** Preparación manual para despliegue. El diagnóstico es de solo lectura y no muestra secretos. */
function diagnosticoPersonal() {
  const props = PropertiesService.getScriptProperties();
  const requeridas = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'WEBHOOK_SECRET', 'GEMINI_API_KEY', 'SHEET_ID', 'CALENDAR_UNI_ID', 'CALENDAR_COMPROMISOS_ID', 'WEBAPP_URL'];
  const informe = { faltantes: requeridas.filter(k => !props.getProperty(k)), zona: Session.getScriptTimeZone(), triggers: ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction()), hojas: [], calendarios: {} };
  if (props.getProperty('SHEET_ID')) {
    const ss = SpreadsheetApp.openById(getSheetId());
    ['Gastos', 'Ingresos', 'To_Do', 'Recordatorios'].forEach(n => {
      const s = ss.getSheetByName(n);
      informe.hojas.push({ nombre: n, existe: !!s, filas: s ? Math.max(0, s.getLastRow() - 1) : 0, columnas: s ? s.getLastColumn() : 0 });
    });
  }
  ['UNIVERSIDAD', 'COMPROMISOS'].forEach(k => {
    try { informe.calendarios[k] = !!getCalendarTarget(k); } catch (_) { informe.calendarios[k] = false; }
  });
  console.log(JSON.stringify(informe));
  return informe;
}

/** Ejecutar una vez en una copia de prueba y luego al desplegar. No clasifica ni borra datos. */
function prepararDatosPersonales() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Bot ocupado.');
  try {
    const resultado = [];
    const hojas = [
      { nombre: 'Gastos', columnas: COLUMNAS_GASTOS, id: 5 },
      { nombre: 'Ingresos', columnas: COLUMNAS_INGRESOS, id: 4 },
      { nombre: 'To_Do', columnas: ['fecha_creación','categoría','tarea','estado','fecha_completada','id','fecha_limite','actualizado_en'], id: 5 },
      { nombre: 'Recordatorios', columnas: ['fecha_creacion','fecha_aviso','hora_aviso','mensaje','estado','chat_id','id','enviado_en','intentos'], id: 6 }
    ];
    // Validación global antes de iniciar modificaciones para detectar esquemas viejos incompatibles.
    const ss = SpreadsheetApp.openById(getSheetId());
    hojas.forEach(h => {
      const s = ss.getSheetByName(h.nombre);
      if (!s || !s.getLastRow()) return;
      const header = s.getRange(1, 1, 1, s.getLastColumn()).getValues()[0];
      if (header.some((v, i) => normalizarTexto(v) !== normalizarTexto(h.columnas[i]))) throw new Error('Esquema incompatible en ' + h.nombre + '. No se inició la preparación.');
    });
    hojas.forEach(h => {
      const s = hojaConEsquema(h.nombre, h.columnas), data = s.getDataRange().getValues();
      let asignados = 0;
      for (let i = 1; i < data.length; i++) {
        if (!data[i][h.id] && data[i].some(v => v !== '')) {
          const respaldo = 'Respaldo_v3_' + h.nombre;
          if (!ss.getSheetByName(respaldo)) s.copyTo(ss).setName(respaldo);
          s.getRange(i + 1, h.id + 1).setValue(Utilities.getUuid()); asignados++;
        }
      }
      resultado.push({ hoja: h.nombre, idsAsignados: asignados });
    });
    return resultado;
  } finally { lock.releaseLock(); }
}

/** Entrada personal: serializa escrituras y conserva resultados para evitar repetir acciones. */
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('WEBHOOK_SECRET'), owner = props.getProperty('TELEGRAM_CHAT_ID');
  const ok = () => ContentService.createTextOutput('OK');
  if (!secret || !owner || !e || !e.parameter || e.parameter.secret !== secret) return ok();
  let payload;
  try { payload = JSON.parse(e.postData.contents); } catch (_) { return ok(); }
  const m = payload.message; // Los mensajes editados no se vuelven a ejecutar.
  const sender = props.getProperty('TELEGRAM_USER_ID') || owner;
  if (!m || !m.chat || !m.from || m.chat.type !== 'private' || String(m.chat.id) !== owner || String(m.from.id) !== sender) return ok();
  if (!Number.isSafeInteger(payload.update_id) || payload.update_id < 0) return ok();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Bot ocupado; actualización no procesada.');
  let diario, fila;
  try {
    diario = hojaConEsquema('Bot_Updates', ['update_id', 'fecha', 'estado', 'respuesta', 'enviado']);
    const datos = diario.getDataRange().getValues();
    const indice = datos.findIndex((r, i) => i > 0 && String(r[0]) === String(payload.update_id));
    if (indice > 0) {
      if (datos[indice][2] === 'procesando') {
        sendTelegramMessage(m.chat.id, '⚠️ La ejecución anterior quedó incompleta. Revisa los registros antes de repetirla.');
      } else if (datos[indice][4] !== 'si' && datos[indice][3]) {
        if (sendTelegramMessage(m.chat.id, datos[indice][3]).ok) diario.getRange(indice + 1, 5).setValue('si');
      }
      return ok();
    }
    diario.appendRow([String(payload.update_id), new Date(), 'procesando', '', 'no']);
    fila = diario.getLastRow();
    SpreadsheetApp.flush();
    let mensaje;
    const texto = m.text || m.caption || '';
    if (!texto) mensaje = 'Por ahora envíame texto. Puedes usar el dictado del teclado.';
    else if (texto.length > 4000) mensaje = 'Divide la solicitud en mensajes más cortos.';
    else if (/^\/(start|help|ayuda)(@\w+)?$/.test(texto.trim())) mensaje = ayudaPersonal();
    else {
      const contexto = leerContexto(m.chat.id);
      const interpretacion = parseMessageWithGemini(texto, contexto);
      mensaje = ejecutarAccionesPersonales(interpretacion.acciones, m.chat.id, contexto);
    }
    diario.getRange(fila, 3, 1, 3).setValues([['terminado', mensaje, 'no']]);
    SpreadsheetApp.flush();
    if (sendTelegramMessage(m.chat.id, mensaje).ok) diario.getRange(fila, 5).setValue('si');
    return ok();
  } catch (_) {
    console.error('[MAIN] Ejecución fallida; revisar Bot_Updates.');
    const mensaje = '⚠️ No pude completar la solicitud. Si incluía varias acciones, alguna puede haber quedado guardada. Revisa los registros antes de repetirla.';
    if (diario && fila) {
      diario.getRange(fila, 3, 1, 3).setValues([['revisar', mensaje, 'no']]);
      SpreadsheetApp.flush();
      if (sendTelegramMessage(m.chat.id, mensaje).ok) diario.getRange(fila, 5).setValue('si');
      return ok();
    }
    throw new Error('No se pudo abrir el registro de actualizaciones.');
  } finally { lock.releaseLock(); }
}
const ayudaPersonal = () => '👋 Puedo registrar gastos e ingresos manuales, gestionar tareas, agenda personal y recordatorios.\nEjemplos:\n• Gasté 5 mil en transporte personal.\n• Entregar informe el viernes.\n• Recuérdame mañana a las 18:00 llamar a mamá.\n• ¿Cuánto gasté este mes?\nLas citas, ventas y productos de clientes se gestionan en Fresha.';
const ejecutarAccionesPersonales = (acciones, chatId, contexto) => {
  if (!Array.isArray(acciones) || acciones.length === 0 || acciones.length > 6) return 'No identifiqué una acción válida. Dime qué quieres registrar o consultar.';
  let cola = acciones.slice();
  const mensajes = [];
  for (let i = 0; i < cola.length; i++) {
    let a = cola[i];
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Acción inválida');
    if (a.tipo === 'CANCELAR_PENDIENTE') {
      delete contexto.pendiente; delete contexto.restantes;
      mensajes.push('Solicitud pendiente descartada.'); continue;
    }
    if (a.tipo === 'RESOLVER_PENDIENTE') {
      if (!contexto.pendiente) { mensajes.push('No hay una solicitud pendiente reciente. Repítela completa.'); continue; }
      const permitidos = ['monto', 'ambito', 'categoria', 'descripcion', 'fecha', 'tarea', 'nueva_tarea', 'fecha_limite', 'fecha_aviso', 'hora_aviso', 'mensaje', 'fecha_estimada', 'hora_estimada', 'calendario', 'evento', 'nueva_fecha', 'nueva_hora', 'duracion_minutos'];
      const cambios = {};
      permitidos.forEach(k => { if (a.cambios && Object.prototype.hasOwnProperty.call(a.cambios, k)) cambios[k] = a.cambios[k]; });
      a = { ...contexto.pendiente, ...cambios };
      cola = [a, ...(contexto.restantes || [])]; i = 0;
      delete contexto.pendiente; delete contexto.restantes;
    } else if (contexto.pendiente) {
      mensajes.push('Tienes una solicitud pendiente. Responde la aclaración o escribe «cancela lo pendiente» antes de empezar otra.'); break;
    }
    const res = enrutarPersonal(a, chatId, contexto);
    if (!res || typeof res.ok !== 'boolean' || !res.mensaje) throw new Error('Contrato de respuesta inválido');
    mensajes.push(res.mensaje);
    if (res.referencia) contexto.ultimo = res.referencia;
    if (res.pendiente) {
      contexto.pendiente = res.pendiente; contexto.restantes = cola.slice(i + 1);
      if (contexto.restantes.length) mensajes.push('Las demás acciones quedan esperando esta aclaración.');
      break;
    }
    if (!res.ok && i < cola.length - 1) { mensajes.push('No ejecuté las acciones restantes.'); break; }
  }
  guardarContexto(chatId, contexto);
  return mensajes.join('\n\n');
};
const enrutarPersonal = (a, chatId, contexto) => {
  const retiradas = ['FRESHA', 'CLIENTES', 'AGENDAR_CITA', 'CONFIRMAR_VISITA', 'MARCAR_PAGADO', 'INASISTENCIA', 'REAGENDAR_CITA', 'CANCELAR_CITA', 'VENTA_PRODUCTO', 'REABASTECER', 'INVENTARIO'];
  if (retiradas.includes(a.tipo) || (a.tipo === 'AGENDA' && a.calendario === 'BARBERIA')) return { ok: true, mensaje: '📋 Gestiona las citas, ventas y productos de clientes en Fresha. No he modificado registros de barbería.' };
  if (a.tipo === 'FINANZAS') return procesarFinanzas(a, contexto);
  if (a.tipo === 'ANULAR_ULTIMO_GASTO') return procesarFinanzas({ tipo: 'FINANZAS', subtipo: 'ANULAR', movimiento: 'GASTO', usar_ultimo: true }, contexto);
  if (a.tipo === 'REPORTE_GASTOS' || (a.tipo === 'REPORTE' && a.subtipo !== 'AGENDA')) return reporteFinanzasPersonal(a);
  if (a.tipo === 'TODO') return procesarToDo(a, contexto);
  if (a.tipo === 'AGENDA') return procesarAgenda(a, contexto);
  if (a.tipo === 'RECORDATORIO') return agregarRecordatorio(a, chatId);
  if (a.tipo === 'REPORTE' && a.subtipo === 'AGENDA') return generarReporteAgendaBajoDemanda(a);
  if (a.tipo === 'ACLARAR') return fallo(escapeHtml(String(a.pregunta || 'Indica la acción y sus datos.').slice(0, 500)));
  return fallo('Esa función no está disponible. Escribe /ayuda.');
};

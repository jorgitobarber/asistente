/** Entrada personal: serializa escrituras y conserva resultados para evitar repetir acciones. */
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('WEBHOOK_SECRET'), owner = props.getProperty('TELEGRAM_CHAT_ID');
  const ok = () => HtmlService.createHtmlOutput('OK');
  if (!secret || !owner || !e || !e.parameter || e.parameter.secret !== secret) return ok();
  let payload;
  try { payload = JSON.parse(e.postData.contents); } catch (_) { return ok(); }
  const m = payload.message; // Los mensajes editados no se vuelven a ejecutar.
  const sender = props.getProperty('TELEGRAM_USER_ID') || owner;
  if (!m || !m.chat || !m.from || m.chat.type !== 'private' || String(m.chat.id) !== owner || String(m.from.id) !== sender) return ok();
  if (!Number.isSafeInteger(payload.update_id) || payload.update_id < 0) return ok();
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Bot ocupado; actualización no procesada.');
  let diario, fila, fase = 'entrada';
  try {
    diario = hojaConEsquema_('Bot_Updates', COLUMNAS_UPDATES);
    const datos = diario.getDataRange().getValues();
    const indice = datos.findIndex((r, i) => i > 0 && String(r[0]) === String(payload.update_id));
    if (indice > 0) {
      if (datos[indice][2] === 'procesando') {
        sendTelegramMessage_(m.chat.id, '⚠️ La ejecución anterior quedó incompleta. Revisa los registros antes de repetirla.');
      } else if (datos[indice][4] !== 'si' && datos[indice][3]) {
        entregarRespuesta_(diario, indice + 1, m.chat.id);
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
    else if (/^\/(start|help|ayuda)(@\w+)?$/.test(texto.trim())) mensaje = ayudaPersonal_();
    else if (/^\/(estado|pendiente)(@\w+)?$/.test(texto.trim())) mensaje = estadoSolicitudes_(m.chat.id);
    else if (/^\/cancelar(@\w+)?$/.test(texto.trim())) mensaje = ejecutarAccionesPersonales_([{ tipo: 'CANCELAR_PENDIENTE' }], m.chat.id, leerContexto_(m.chat.id));
    else {
      const contexto = leerContexto_(m.chat.id);
      fase = 'interpretacion';
      const interpretacion = parseMessageWithGemini_(texto, contexto);
      fase = 'ejecucion';
      mensaje = ejecutarAccionesPersonales_(interpretacion.acciones, m.chat.id, contexto);
    }
    diario.getRange(fila, 3, 1, 3).setValues([['terminado', mensaje, 'no']]);
    SpreadsheetApp.flush();
    entregarRespuesta_(diario, fila, m.chat.id);
    return ok();
  } catch (error) {
    console.error('[MAIN] Falla en ' + fase + ': ' + codigoErrorSeguro_(error));
    let mensaje = fase === 'interpretacion'
      ? '⚠️ No pude interpretar tu mensaje. No registré gastos, tareas ni eventos. ' + explicarErrorIA_(error) + ' Puedes volver a intentarlo.'
      : '⚠️ La solicitud se interrumpió. Escribe /estado para ver las acciones confirmadas antes de repetir alguna.';
    if (fase === 'ejecucion') {
      try { const c = leerContexto_(m.chat.id); if (c.progreso && c.progreso.length) mensaje += '\n\nConfirmado:\n' + c.progreso.join('\n'); } catch (_) {}
    }
    if (diario && fila) {
      diario.getRange(fila, 3, 1, 3).setValues([[fase === 'interpretacion' ? 'sin_cambios' : 'revisar', mensaje, 'no']]);
      SpreadsheetApp.flush();
      entregarRespuesta_(diario, fila, m.chat.id);
      return ok();
    }
    throw new Error('No se pudo abrir el registro de actualizaciones.');
  } finally { lock.releaseLock(); }
}
const ayudaPersonal_ = () => '👋 Puedo registrar gastos e ingresos manuales, gestionar tareas, agenda personal y recordatorios.\nEjemplos:\n• Gasté 5 mil en transporte personal.\n• Entregar informe el viernes.\n• Recuérdame mañana a las 18:00 llamar a mamá.\n• Lista mis recordatorios.\n• Cambia o cancela el recordatorio indicando su nombre o ID.\n• ¿Cuánto gasté este mes?\n/estado muestra el estado de las últimas solicitudes.\n/cancelar descarta una aclaración pendiente.\nLas citas, ventas y productos de clientes se gestionan en Fresha.';
const ejecutarAccionesPersonales_ = (acciones, chatId, contexto) => {
  if (!Array.isArray(acciones) || acciones.length === 0 || acciones.length > 6) return 'No identifiqué una acción válida. Dime qué quieres registrar o consultar.';
  let cola = acciones.slice();
  const mensajes = [];
  contexto.progreso = [];
  // Guardar el plan antes de ejecutar evita descubrir un fallo de almacenamiento después de escribir.
  contexto.plan = cola;
  guardarContexto_(chatId, contexto);
  for (let i = 0; i < cola.length; i++) {
    let a = cola[i];
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('Acción inválida');
    if (a.tipo === 'CANCELAR_PENDIENTE') {
      delete contexto.pendiente; delete contexto.restantes; delete contexto.plan;
      mensajes.push('Solicitud pendiente descartada.'); continue;
    }
    if (a.tipo === 'RESOLVER_PENDIENTE') {
      if (!contexto.pendiente) { mensajes.push('No hay una solicitud pendiente reciente. Repítela completa.'); continue; }
      const permitidos = ['monto', 'ambito', 'categoria', 'descripcion', 'fecha', 'tarea', 'nueva_tarea', 'fecha_limite', 'fecha_aviso', 'hora_aviso', 'mensaje', 'nuevo_mensaje', 'fecha_estimada', 'hora_estimada', 'calendario', 'evento', 'fecha_original', 'hora_original', 'nuevo_evento', 'nueva_fecha', 'nueva_hora', 'duracion_minutos'];
      const cambios = {};
      permitidos.forEach(k => { if (a.cambios && Object.prototype.hasOwnProperty.call(a.cambios, k)) cambios[k] = a.cambios[k]; });
      a = { ...contexto.pendiente, ...cambios };
      cola = [a, ...(contexto.restantes || [])]; i = 0;
      delete contexto.pendiente; delete contexto.restantes;
    } else if (contexto.pendiente) {
      mensajes.push('Tienes una solicitud pendiente. Responde la aclaración o escribe «cancela lo pendiente» antes de empezar otra.'); break;
    }
    contexto.en_curso = { tipo: a.tipo, subtipo: a.subtipo, id: a.id || '', descripcion: String(a.descripcion || a.tarea || a.evento || a.mensaje || '').slice(0, 300) };
    guardarContexto_(chatId, contexto);
    const res = enrutarPersonal_(a, chatId, contexto);
    if (!res || typeof res.ok !== 'boolean' || !res.mensaje) throw new Error('Contrato de respuesta inválido');
    mensajes.push(res.mensaje);
    if (res.referencia) contexto.ultimo = res.referencia;
    if (res.ok) contexto.progreso.push(res.mensaje.slice(0, 1200));
    delete contexto.en_curso;
    contexto.plan = cola.slice(i + 1);
    if (res.pendiente) {
      contexto.pendiente = res.pendiente; contexto.restantes = cola.slice(i + 1);
      guardarContexto_(chatId, contexto);
      if (contexto.restantes.length) mensajes.push('Las demás acciones quedan esperando esta aclaración.');
      break;
    }
    guardarContexto_(chatId, contexto);
    if (!res.ok && i < cola.length - 1) { mensajes.push('No ejecuté las acciones restantes.'); break; }
  }
  guardarContexto_(chatId, contexto);
  const respuesta = mensajes.join('\n\n');
  return respuesta.length <= 48000 ? respuesta : respuesta.slice(0, 47000) + '\n\nLa respuesta es muy larga. Consulta cada lista por separado para ver el resto.';
};
const enrutarPersonal_ = (a, chatId, contexto) => {
  const retiradas = ['FRESHA', 'CLIENTES', 'AGENDAR_CITA', 'CONFIRMAR_VISITA', 'MARCAR_PAGADO', 'INASISTENCIA', 'REAGENDAR_CITA', 'CANCELAR_CITA', 'VENTA_PRODUCTO', 'REABASTECER', 'INVENTARIO'];
  if (retiradas.includes(a.tipo) || (a.tipo === 'AGENDA' && a.calendario === 'BARBERIA')) return { ok: true, mensaje: '📋 Gestiona las citas, ventas y productos de clientes en Fresha. No he modificado registros de barbería.' };
  if (a.tipo === 'FINANZAS') return procesarFinanzas_(a, contexto);
  if (a.tipo === 'ANULAR_ULTIMO_GASTO') return procesarFinanzas_({ tipo: 'FINANZAS', subtipo: 'ANULAR', movimiento: 'GASTO', usar_ultimo: true }, contexto);
  if (a.tipo === 'REPORTE_GASTOS' || (a.tipo === 'REPORTE' && a.subtipo !== 'AGENDA')) return reporteFinanzasPersonal_(a);
  if (a.tipo === 'TODO') return procesarToDo_(a, contexto);
  if (a.tipo === 'AGENDA') return procesarAgenda_(a, contexto);
  if (a.tipo === 'RECORDATORIO') return procesarRecordatorio_(a, chatId, contexto);
  if (a.tipo === 'REPORTE' && a.subtipo === 'AGENDA') return generarReporteAgendaBajoDemanda_(a);
  if (a.tipo === 'ACLARAR') return fallo_(escapeHtml_(String(a.pregunta || 'Indica la acción y sus datos.').slice(0, 500)));
  return fallo_('Esa función no está disponible. Escribe /ayuda.');
};

const COLUMNAS_UPDATES = ['update_id', 'fecha', 'estado', 'respuesta', 'enviado', 'partes_enviadas', 'intentos', 'proximo_intento'];
const codigoErrorSeguro_ = e => /Gemini HTTP \d+/.test(e.message || '') ? e.message.match(/Gemini HTTP \d+/)[0] : (e.name || 'Error');
const explicarErrorIA_ = e => /429/.test(e.message || '') ? 'La inteligencia artificial alcanzó su límite de uso.' : /401|403/.test(e.message || '') ? 'La conexión con la inteligencia artificial necesita revisar sus permisos o su clave.' : /404/.test(e.message || '') ? 'El modelo de inteligencia artificial configurado no está disponible.' : 'La inteligencia artificial no respondió correctamente.';
const estadoSolicitudes_ = chatId => {
  const c = leerContexto_(chatId), s = SpreadsheetApp.openById(getSheetId_()).getSheetByName('Bot_Updates');
  let msg = c.pendiente ? '❓ Hay una aclaración pendiente. Puedes responderla o usar /cancelar.\n' : 'No hay aclaraciones pendientes.\n';
  if (c.en_curso) msg += '\n⚠️ Una acción quedó sin confirmación: ' + escapeHtml_(c.en_curso.tipo + ' ' + c.en_curso.descripcion) + '. Comprueba ese registro antes de repetirla.\n';
  if (s) msg += '\nÚltimas solicitudes:\n' + s.getDataRange().getValues().slice(1).filter(r => r[3] && !/^(No hay aclaraciones|❓ Hay una aclaración)/.test(r[3])).slice(-3).map(r => '• ' + escapeHtml_(r[2]) + ' · respuesta ' + (r[4] === 'si' ? 'entregada' : 'pendiente') + '\n' + String(r[3]).slice(0, 2000)).join('\n\n');
  return msg;
};

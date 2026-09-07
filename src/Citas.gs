/**
 * Módulo Citas: Gestiona el ciclo completo de citas de la barbería.
 *
 * Flujo:
 *   Jorge avisa al bot → AGENDAR_CITA  → queda en hoja Citas (estado: agendada)
 *   Durante el día    → CONFIRMAR_VISITA → estado: confirmada, va a Historial_Visitas
 *   Durante el día    → INASISTENCIA     → estado: inasistencia
 *   Cualquier momento → REAGENDAR_CITA  → actualiza fecha/hora en Citas
 */

// ─── Catálogo de precios ──────────────────────────────────────────────────────

const PRECIOS_CATALOG = {
  servicios: {
    'Corte':         { precio: 10000, aliases: ['corte', 'corte simple', 'corte de pelo', 'cortado'] },
    'Corte + Barba': { precio: 15000, aliases: ['corte y barba', 'corte con barba', 'corte barba', 'corte+barba'] },
  },
  addOns: {
    'Diseño': { precio: 1000, aliases: ['diseño', 'diseños', 'diseño de barba', 'con diseño'] },
  },
  productos: {
    'Cera':         { precio: 5000, aliases: ['cera', 'ceras', 'cera de pelo'] },
    'Texturizador': { precio: 5000, aliases: ['texturizador', 'polvos', 'polvos texturizadores', 'texturizadores'] },
  }
};

const getServiciosGemini = () => Object.keys(PRECIOS_CATALOG.servicios).join('|');
const getAddOnsGemini = () => Object.keys(PRECIOS_CATALOG.addOns).join('|');
const getProductosGemini = () => Object.keys(PRECIOS_CATALOG.productos).join('|');

// ─── Sheet helpers ────────────────────────────────────────────────────────────

const _getHojaCitas = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  let sheet = ss.getSheetByName('Citas');
  if (!sheet) {
    sheet = ss.insertSheet('Citas');
    sheet.appendRow(['fecha', 'hora', 'nombre_cliente', 'servicio', 'add_ons', 'estado', 'nueva_fecha', 'nueva_hora', 'id_evento_calendar']);
    console.log('[VISITAS] Hoja Citas creada.');
  }
  return sheet;
};

const _getHojaHistorial = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  let sheet = ss.getSheetByName('Historial_Visitas');
  if (!sheet) {
    sheet = ss.insertSheet('Historial_Visitas');
    sheet.appendRow(['fecha', 'hora', 'nombre_cliente', 'servicio', 'add_ons', 'productos', 'monto', 'estado_pago']);
    console.log('[VISITAS] Hoja Historial_Visitas creada con campo estado_pago.');
  }
  return sheet;
};

// ─── Normalización de servicios ───────────────────────────────────────────────

const _normalizarServicio = (input) => {
  if (!input) return '';
  const lower = input.toLowerCase().trim();
  for (const [nombre, data] of Object.entries(PRECIOS_CATALOG.servicios)) {
    if (data.aliases.some(a => lower.includes(a))) return nombre;
  }
  return input;
};

const _normalizarAddOns = (addOns) => {
  if (!addOns || !Array.isArray(addOns)) return [];
  return addOns.map(a => {
    const lower = (a || '').toLowerCase().trim();
    for (const [nombre, data] of Object.entries(PRECIOS_CATALOG.addOns)) {
      if (data.aliases.some(alias => lower.includes(alias))) return nombre;
    }
    return null;
  }).filter(Boolean);
};

const _normalizarProductos = (productos) => {
  if (!productos || !Array.isArray(productos)) return [];
  return productos.map(p => {
    const lower = (p || '').toLowerCase().trim();
    for (const [nombre, data] of Object.entries(PRECIOS_CATALOG.productos)) {
      if (data.aliases.some(alias => lower.includes(alias))) return nombre;
    }
    return null;
  }).filter(Boolean);
};

const _calcularMonto = (servicio, addOns, productos) => {
  let total = 0;
  if (servicio && PRECIOS_CATALOG.servicios[servicio]) {
    total += PRECIOS_CATALOG.servicios[servicio].precio;
  }
  (addOns || []).forEach(a => {
    if (PRECIOS_CATALOG.addOns[a]) total += PRECIOS_CATALOG.addOns[a].precio;
  });
  (productos || []).forEach(p => {
    if (PRECIOS_CATALOG.productos[p]) total += PRECIOS_CATALOG.productos[p].precio;
  });
  return total;
};

const _crearClienteNuevo = (nombre, telefono) => {
  try {
    const hoy = _hoyChile();
    _getClientesSheet().appendRow([nombre, telefono || '', '', hoy, '', '']);
    console.log(`[VISITAS] Cliente nuevo creado: ${nombre}`);
  } catch (e) {
    console.error(`[VISITAS] Error creando cliente nuevo: ${e.message}`);
  }
};

// ─── Agendar cita ─────────────────────────────────────────────────────────────

const agendarCita = (accion, chatId) => {
  try {
    const match = _buscarCliente(accion.nombre_cliente);

    if (match.ambiguo) {
      const opciones = match.candidatos
        .map((c, i) => `${i + 1}. ${escapeHtml(c.nombre)}${c.telefono ? ' (' + escapeHtml(c.telefono) + ')' : ' (sin tel)'}`)
        .join('\n');
      return {ok: false, mensaje: `⚠️ Hay varios clientes con ese nombre. ¿A cuál te refieres?\n\n${opciones}\n\nResponde con el nombre completo.`};
    }

    const nombreFinal  = match.encontrado ? match.nombre : accion.nombre_cliente;
    const servicioNorm = _normalizarServicio(accion.servicio);
    const addOnsNorm   = _normalizarAddOns(accion.add_ons);
    const fecha        = accion.fecha || _hoyChile();
    const hora         = accion.hora  || '';

    const dataCitas = _getHojaCitas().getDataRange().getValues();
    const existeCita = dataCitas.slice(1).some(r => 
      _normalizarFechaSheet(r[0]) === fecha && 
      _normalizar(r[2]) === _normalizar(nombreFinal) &&
      r[5] === 'agendada'
    );
    
    if (existeCita) {
      return {ok: false, mensaje: `⚠️ Ojo jefe, ya existe una cita agendada para <b>${escapeHtml(nombreFinal)}</b> el ${_formatearFechaLegible(fecha)}. No la crearé de nuevo para evitar duplicados.`};
    }

    const addOnStr     = addOnsNorm.length  ? ` + ${addOnsNorm.join(', ')}` : '';
    const monto        = _calcularMonto(servicioNorm, addOnsNorm, []);
    const esNuevo      = !match.encontrado ? '\n👤 <i>Cliente nuevo</i> — lo agregué a tu lista.' : '';

    // Validar Calendar antes de tocar nada en Sheets
    const calId = PropertiesService.getScriptProperties().getProperty('CALENDAR_BARBERIA_ID');
    if (!calId) {
      return {ok: false, mensaje: `❌ <b>Calendar no configurado:</b> Falta la variable CALENDAR_BARBERIA_ID. Cita abortada.`};
    }
    const calBarberia = CalendarApp.getCalendarById(calId);
    if (!calBarberia) {
      return {ok: false, mensaje: `❌ <b>Calendar inaccesible:</b> No pude acceder al calendario con ID ${calId}. Cita abortada.`};
    }

    let eventId = '';
    const titulo = `✂️ ${nombreFinal} — ${servicioNorm}${addOnStr}`;
    try {
      const accionCalendar = {
        evento: titulo,
        fecha_estimada: fecha,
        hora_estimada: hora || '09:00',
        ignorar_choques: true
      };
      eventId = crearEvento(accionCalendar, calBarberia) || '';
      console.log(`[VISITAS] Evento creado en Calendar: ${titulo} (ID: ${eventId})`);
    } catch (calErr) {
      console.error(`[VISITAS] ERROR DE CALENDAR: ${calErr.message}`);
      return {ok: false, mensaje: `❌ <b>Error agendando en Calendar:</b> ${escapeHtml(calErr.message)}.\nNo he registrado la cita en Sheets para evitar desincronización.`};
    }

    // Ahora sí escribimos en Sheets
    try {
      if (!match.encontrado) {
        _crearClienteNuevo(nombreFinal, accion.telefono || '');
      }

      _getHojaCitas().appendRow([
        fecha, hora, nombreFinal,
        servicioNorm,
        addOnsNorm.join(', '),
        'agendada',
        '', '', eventId
      ]);
    } catch (sheetErr) {
      console.error(`[VISITAS] Error al escribir en Sheets. Intentando borrar evento huérfano. Detalle: ${sheetErr.message}`);
      try {
        if (eventId) calBarberia.getEventById(eventId).deleteEvent();
      } catch (e) {
        console.error(`[VISITAS] No se pudo borrar el evento huérfano ${eventId}.`);
      }
      return {ok: false, mensaje: `❌ <b>Error crítico en Sheets:</b> ${escapeHtml(sheetErr.message)}.\nHe abortado el registro. (Se deshizo el evento en Calendar).`};
    }

    console.log(`[VISITAS] Cita agendada: ${nombreFinal} — ${fecha} ${hora}`);
    return {ok: true, mensaje: `✅ Agendado jefe!\n\n` +
      `👤 <b>${escapeHtml(nombreFinal)}</b>${esNuevo}\n` +
      `📅 ${_formatearFechaLegible(fecha)} a las ${hora}\n` +
      `✂️ ${escapeHtml(servicioNorm)}${escapeHtml(addOnStr)}\n` +
      `💰 Estimado: $${monto.toLocaleString('es-CL')}`};

  } catch (error) {
    console.error(`[VISITAS] Error en agendarCita: ${error.message}`);
    return {ok: false, mensaje: '❌ No pude agendar la cita. Intenta de nuevo.'};
  }
};

// ─── Confirmar visita ─────────────────────────────────────────────────────────

const confirmarVisita = (accion, chatId) => {
  try {
    const match = _buscarCliente(accion.nombre_cliente);

    if (match.ambiguo) {
      return {ok: false, mensaje: `⚠️ Hay varios "${escapeHtml(accion.nombre_cliente)}". ¿Cuál vino? Dime el nombre completo.`};
    }

    const nombre      = match.encontrado ? match.nombre : accion.nombre_cliente;
    const fechaVisita = accion.fecha || _hoyChile();
    const addOnsNorm  = _normalizarAddOns(accion.add_ons);
    const prodNorm    = _normalizarProductos(accion.productos);

    // Pre-validar stock ANTES de tocar nada
    const checkStock = prevalidarStockBatch(prodNorm);
    if (!checkStock.ok) {
      return {ok: false, mensaje: checkStock.mensajeError};
    }

    const sheetCitas  = _getHojaCitas();
    const dataCitas   = sheetCitas.getDataRange().getValues();
    let servicioBase  = accion.servicio || '';
    let horaVisita    = '';
    let citaActualizada = false;
    let filaCitaOriginal = -1;

    for (let i = 1; i < dataCitas.length; i++) {
      if (_normalizarFechaSheet(dataCitas[i][0]) === fechaVisita &&
          _normalizar(dataCitas[i][2]) === _normalizar(nombre) &&
          dataCitas[i][5] === 'agendada') {
        filaCitaOriginal = i + 1;
        if (!servicioBase) servicioBase = dataCitas[i][3];
        horaVisita     = dataCitas[i][1];
        break;
      }
    }

    const servicioNorm = _normalizarServicio(servicioBase);
    const monto        = _calcularMonto(servicioNorm, addOnsNorm, prodNorm);
    const estadoPago   = ((accion.estado_pago || 'PAGADO') + '').toUpperCase();

    // Ejecutar escrituras
    try {
      if (filaCitaOriginal > -1) {
        sheetCitas.getRange(filaCitaOriginal, 6).setValue('confirmada');
        citaActualizada = true;
      }

      _getHojaHistorial().appendRow([
        fechaVisita, horaVisita, nombre,
        servicioNorm,
        addOnsNorm.join(', '),
        prodNorm.join(', '),
        monto,
        estadoPago
      ]);
      console.log(`[VISITAS] Registrado en Historial_Visitas: ${nombre} — $${monto} — ${estadoPago}`);

      if (match.encontrado) _actualizarUltimaCita(nombre, fechaVisita, match.fila);

    } catch (sheetErr) {
      console.error(`[VISITAS] Error escribiendo historial/citas: ${sheetErr.message}`);
      return {ok: false, mensaje: `❌ <b>Error crítico guardando la visita:</b> ${escapeHtml(sheetErr.message)}.\nEl inventario no fue descontado. Por favor, revisa manualmente.`};
    }

    // Finalmente, descontar inventario. Ya está prevalidado, no debería fallar por stock.
    let alertasInventario = '';
    prodNorm.forEach(p => {
      try {
        const res = descontarProducto(p, 1);
        if (res.ok && res.alerta) alertasInventario += res.mensajeAlerta;
      } catch(e) {
        console.error(`[VISITAS] Error descontando ${p} luego de prevalidar: ${e.message}`);
      }
    });

    const addOnStr  = addOnsNorm.length ? ` + ${addOnsNorm.join(', ')}` : '';
    const prodStr   = prodNorm.length   ? `\n🧴 Productos: ${prodNorm.join(', ')}` : '';
    const notaExtra = !citaActualizada  ? '\n📝 No tenía cita previa registrada, lo anoté igual.' : '';
    const pagoStr   = estadoPago === 'PENDIENTE' ? '\n⚠️ <b>PAGO PENDIENTE</b> — aparecerá en el cierre de esta noche.' : '';

    console.log(`[VISITAS] Visita confirmada: ${nombre} — $${monto}`);
    return {ok: true, mensaje: `✅ Listo jefe! <b>${escapeHtml(nombre)}</b> confirmado.\n\n` +
      `✂️ ${escapeHtml(servicioNorm)}${escapeHtml(addOnStr)}${escapeHtml(prodStr)}\n` +
      `💰 $${monto.toLocaleString('es-CL')}${notaExtra}${escapeHtml(alertasInventario)}${pagoStr}\n` +
      `📅 Fecha registro: ${_formatearFechaLegible(fechaVisita)}`};

  } catch (error) {
    console.error(`[VISITAS] Error en confirmarVisita: ${error.message}`);
    return {ok: false, mensaje: '❌ No pude confirmar la visita.'};
  }
};

// ─── Marcar visita como pagada ────────────────────────────────────────────────

const marcarVisitaPagada = (accion, chatId) => {
  try {
    const sheet   = _getHojaHistorial();
    const data    = sheet.getDataRange().getValues();
    const busqueda = _normalizar(accion.nombre_cliente || '');

    if (!busqueda) {
      return {ok: false, mensaje: '⚠️ Dime el nombre del cliente cuyo pago quieres marcar.'};
    }

    let filaEncontrada  = -1;
    let montoEncontrado = 0;
    let fechaEncontrada = '';

    for (let i = data.length - 1; i >= 1; i--) {
      const nombreFila = _normalizar((data[i][2] || '').toString());
      const estadoPago = ((data[i][7] || '') + '').toUpperCase() || 'PAGADO';

      if (nombreFila === busqueda || nombreFila.includes(busqueda) || busqueda.includes(nombreFila)) {
        if (estadoPago === 'PENDIENTE') {
          filaEncontrada  = i + 1;
          montoEncontrado = parseFloat(data[i][6]) || 0;
          fechaEncontrada = _normalizarFechaSheet(data[i][0]);
          break;
        }
      }
    }

    if (filaEncontrada === -1) {
      return {ok: false, mensaje: `⚠️ No encontré pagos pendientes de <b>${escapeHtml(accion.nombre_cliente)}</b>.\nSi el nombre está bien escrito, ya está todo al día. ✅`};
    }

    sheet.getRange(filaEncontrada, 8).setValue('PAGADO');
    console.log(`[VISITAS] Pago marcado PAGADO: ${accion.nombre_cliente}, fila ${filaEncontrada}`);

    try {
      const accionIngreso = {
        tipo: 'FINANZAS',
        subtipo: 'INGRESO',
        monto: montoEncontrado,
        descripcion: `Pago pendiente saldado: ${accion.nombre_cliente} (${fechaEncontrada})`
      };
      registrarFinanzas(accionIngreso, new Date());
      console.log(`[VISITAS] Ingreso generado por pago pendiente de ${accion.nombre_cliente}`);
    } catch(e) {
      console.error(`[VISITAS] Error al generar ingreso por pago: ${e.message}`);
    }

    return {ok: true, mensaje: `✅ Listo jefe! El pago de <b>${escapeHtml(accion.nombre_cliente)}</b> quedó registrado como saldado.\n` +
      `💰 $${montoEncontrado.toLocaleString('es-CL')} — ${fechaEncontrada}`};

  } catch (error) {
    console.error(`[VISITAS] Error en marcarVisitaPagada: ${error.message}`);
    return {ok: false, mensaje: '❌ No pude marcar el pago. Intenta de nuevo.'};
  }
};

// ─── Registrar inasistencia ───────────────────────────────────────────────────

const registrarInasistencia = (accion, chatId) => {
  try {
    const match   = _buscarCliente(accion.nombre_cliente);
    const nombre  = match.encontrado ? match.nombre : accion.nombre_cliente;

    if (match.ambiguo) {
      return {ok: false, mensaje: `⚠️ Hay varios con ese nombre. ¿Cuál no vino? Dime el nombre completo.`};
    }

    const hoy       = _hoyChile();
    const sheetCitas = _getHojaCitas();
    const dataCitas  = sheetCitas.getDataRange().getValues();
    let actualizado  = false;

    for (let i = 1; i < dataCitas.length; i++) {
      if (_normalizarFechaSheet(dataCitas[i][0]) === hoy &&
          _normalizar(dataCitas[i][2]) === _normalizar(nombre) &&
          dataCitas[i][5] === 'agendada') {
        const eventId = dataCitas[i][8];
        sheetCitas.getRange(i + 1, 6).setValue('inasistencia');
        actualizado = true;

        try {
          const calBarberia = CalendarApp.getCalendarById(
            PropertiesService.getScriptProperties().getProperty('CALENDAR_BARBERIA_ID')
          );
          if (calBarberia && eventId) {
            const ev = calBarberia.getEventById(eventId);
            if (ev) {
              ev.deleteEvent();
              console.log(`[VISITAS] Evento borrado de Calendar por inasistencia: ${eventId}`);
            }
          }
        } catch (e) {
          console.warn(`[VISITAS] No se pudo borrar inasistencia de Calendar: ${e.message}`);
        }
        break;
      }
    }

    console.log(`[VISITAS] Inasistencia registrada: ${nombre}`);
    return {ok: true, mensaje: actualizado
      ? `📋 Anotado. <b>${escapeHtml(nombre)}</b> marcado como inasistencia hoy.`
      : `📋 Anotado. <b>${escapeHtml(nombre)}</b> no vino (no tenía cita registrada en el bot).`};

  } catch (error) {
    console.error(`[VISITAS] Error en registrarInasistencia: ${error.message}`);
    return {ok: false, mensaje: '❌ No pude registrar la inasistencia.'};
  }
};

// ─── Reagendar cita ───────────────────────────────────────────────────────────

const reagendarCita = (accion, chatId) => {
  try {
    const match  = _buscarCliente(accion.nombre_cliente);
    const nombre = match.encontrado ? match.nombre : accion.nombre_cliente;

    if (match.ambiguo) {
      return {ok: false, mensaje: `⚠️ Hay varios con ese nombre. ¿Cuál reagendó? Dime el nombre completo.`};
    }

    const sheetCitas = _getHojaCitas();
    const dataCitas  = sheetCitas.getDataRange().getValues();
    let actualizado  = false;

    for (let i = 1; i < dataCitas.length; i++) {
      if (_normalizar(dataCitas[i][2]) === _normalizar(nombre) &&
          dataCitas[i][5] === 'agendada') {

        const viejaFecha    = dataCitas[i][0];
        const viejaHora     = dataCitas[i][1];
        const viejoServicio = dataCitas[i][3];
        const viejosAddOns  = dataCitas[i][4];
        const viejoEventId  = dataCitas[i][8];

        sheetCitas.getRange(i + 1, 6).setValue('reagendada');
        sheetCitas.getRange(i + 1, 7).setValue(accion.nueva_fecha || '');
        sheetCitas.getRange(i + 1, 8).setValue(accion.nueva_hora  || '');

        let nuevoEventId = '';
        try {
          const calBarberia = CalendarApp.getCalendarById(
            PropertiesService.getScriptProperties().getProperty('CALENDAR_BARBERIA_ID')
          );
          if (calBarberia) {
            if (viejoEventId) {
              try {
                const evViejo = calBarberia.getEventById(viejoEventId);
                if (evViejo) {
                  evViejo.deleteEvent();
                  console.log(`[VISITAS] Evento Calendar viejo borrado por ID: ${viejoEventId}`);
                }
              } catch(e) {
                console.warn(`[VISITAS] No se pudo borrar evento viejo por ID: ${e.message}`);
              }
            } else if (viejaFecha && viejaHora) {
              const fechaVieja = _parseDateTime(viejaFecha, viejaHora);
              const eventos = calBarberia.getEvents(
                new Date(fechaVieja.getTime() - 5 * 60000),
                new Date(fechaVieja.getTime() + 5 * 60000)
              );
              eventos.forEach(ev => {
                if (_normalizar(ev.getTitle()).includes(_normalizar(nombre))) {
                  ev.deleteEvent();
                  console.log(`[VISITAS] Evento Calendar borrado (fallback): ${ev.getTitle()}`);
                }
              });
            }

            const addOnStr = viejosAddOns ? ` + ${viejosAddOns}` : '';
            nuevoEventId = crearEvento({
              evento: `✂️ ${nombre} — ${viejoServicio}${addOnStr}`,
              fecha_estimada: accion.nueva_fecha,
              hora_estimada:  accion.nueva_hora || '09:00',
              ignorar_choques: true
            }, calBarberia) || '';
          }
        } catch (calErr) {
          console.warn(`[VISITAS] No pude actualizar Calendar al reagendar: ${calErr.message}`);
          return {ok: false, mensaje: `❌ <b>Error reagendando en Calendar:</b> ${escapeHtml(calErr.message)}.\nCita no modificada en Sheets.`};
        }

        sheetCitas.appendRow([
          accion.nueva_fecha, accion.nueva_hora, nombre,
          viejoServicio,
          viejosAddOns,
          'agendada',
          '', '', nuevoEventId
        ]);

        actualizado = true;
        break;
      }
    }

    const fechaLegible = _formatearFechaLegible(accion.nueva_fecha);
    console.log(`[VISITAS] Reagendado: ${nombre} → ${accion.nueva_fecha} ${accion.nueva_hora}`);
    return {ok: true, mensaje: actualizado
      ? `✅ Reagendado jefe!\n\n👤 <b>${escapeHtml(nombre)}</b>\n📅 ${fechaLegible} a las ${accion.nueva_hora}\n📆 Actualicé tu calendario también.`
      : `📋 Reagendado.\n\n👤 <b>${escapeHtml(nombre)}</b>\n📅 ${fechaLegible} a las ${accion.nueva_hora}\n\n(No tenía cita previa registrada, creé la nueva igual.)`};

  } catch (error) {
    console.error(`[VISITAS] Error en reagendarCita: ${error.message}`);
    return {ok: false, mensaje: '❌ No pude reagendar la cita.'};
  }
};

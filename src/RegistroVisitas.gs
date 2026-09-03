/**
 * Módulo RegistroVisitas: Gestiona el ciclo completo de citas de la barbería.
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

// ─── Fecha helpers ────────────────────────────────────────────────────────────

/**
 * Retorna la fecha de hoy en formato YYYY-MM-DD (hora Chile).
 */
const _hoyChile = () => {
  const hoy = new Date();
  const enChile = new Date(hoy.toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const y = enChile.getFullYear();
  const m = String(enChile.getMonth() + 1).padStart(2, '0');
  const d = String(enChile.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Normaliza cualquier valor de fecha leído de Google Sheets a formato YYYY-MM-DD.
 * Google Sheets puede devolver la fecha como objeto Date o como string según el
 * formato de celda. Esta función garantiza siempre YYYY-MM-DD en zona horaria Santiago.
 */
const _normalizarFechaSheet = (valor) => {
  if (!valor) return '';
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Santiago', 'yyyy-MM-dd');
  }
  const str = valor.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  // Formato con barras (DD/MM/YYYY)
  if (str.includes('/')) {
    const partes = str.split(' ')[0].split('/');
    if (partes.length === 3 && parseInt(partes[2]) > 31) {
      return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
    }
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd');
  return str;
};

const _normalizarHoraSheet = (valor) => {
  if (!valor) return '';
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Santiago', 'HH:mm');
  }
  return valor.toString().trim();
};

/**
 * Formatea una fecha YYYY-MM-DD a un string legible en español.
 * Ej: "2026-09-05" → "Vie 05 Sep"
 */
const _formatearFechaLegible = (fechaISO) => {
  if (!fechaISO) return '';
  try {
    const [y, m, d] = fechaISO.split('-').map(Number);
    const fecha = new Date(y, m - 1, d);
    return fecha.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch (e) {
    return fechaISO;
  }
};

// ─── Normalización de servicios ───────────────────────────────────────────────

/**
 * Dado un string de servicio, retorna el nombre canónico.
 * Ej: "corte y barba" → "Corte + Barba"
 */
const _normalizarServicio = (input) => {
  if (!input) return '';
  const lower = input.toLowerCase().trim();
  for (const [nombre, data] of Object.entries(PRECIOS_CATALOG.servicios)) {
    if (data.aliases.some(a => lower.includes(a))) return nombre;
  }
  return input;
};

/**
 * Normaliza un array de add-ons al nombre canónico.
 */
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

/**
 * Normaliza un array de productos al nombre canónico.
 */
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

// ─── Cálculo de monto ─────────────────────────────────────────────────────────

/**
 * Calcula el monto total de una visita.
 * Todos los parámetros deben ser nombres canónicos.
 */
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

// ─── Agendar cita ─────────────────────────────────────────────────────────────

const agendarCita = (accion, chatId) => {
  try {
    const match = _buscarCliente(accion.nombre_cliente);

    if (match.ambiguo) {
      const opciones = match.candidatos
        .map((c, i) => `${i + 1}. ${c.nombre}${c.telefono ? ' (' + c.telefono + ')' : ' (sin tel)'}`)
        .join('\n');
      sendTelegramMessage(chatId,
        `⚠️ Hay varios clientes con ese nombre. ¿A cuál te refieres?\n\n${opciones}\n\nResponde con el nombre completo.`
      );
      return;
    }

    const nombreFinal  = match.encontrado ? match.nombre : accion.nombre_cliente;
    const servicioNorm = _normalizarServicio(accion.servicio);
    const addOnsNorm   = _normalizarAddOns(accion.add_ons);
    const fecha        = accion.fecha || _hoyChile();
    const hora         = accion.hora  || '';

    // Si es cliente nuevo, crearlo en la hoja Clientes
    if (!match.encontrado) {
      _crearClienteNuevo(nombreFinal, accion.telefono || '');
    }

    // Protección contra duplicados en el mismo día
    const dataCitas = _getHojaCitas().getDataRange().getValues();
    const existeCita = dataCitas.slice(1).some(r => 
      _normalizarFechaSheet(r[0]) === fecha && 
      _normalizar(r[2]) === _normalizar(nombreFinal) &&
      r[5] === 'agendada'
    );
    
    if (existeCita) {
      sendTelegramMessage(chatId, `⚠️ Ojo jefe, ya existe una cita agendada para ${nombreFinal} el ${_formatearFechaLegible(fecha)}. No la crearé de nuevo para evitar duplicados.`);
      return;
    }

    // Registrar en hoja Citas
    _getHojaCitas().appendRow([
      fecha, hora, nombreFinal,
      servicioNorm,
      addOnsNorm.join(', '),
      'agendada',
      '', '', '' // nueva_fecha, nueva_hora, id_evento_calendar
    ]);

    // Crear evento en Google Calendar (calendario Barbería → sincroniza al iPhone)
    const addOnStr     = addOnsNorm.length  ? ` + ${addOnsNorm.join(', ')}` : '';
    const monto        = _calcularMonto(servicioNorm, addOnsNorm, []);
    const esNuevo      = !match.encontrado ? '\n👤 *Cliente nuevo* — lo agregué a tu lista.' : '';

    try {
      const titulo = `✂️ ${nombreFinal} — ${servicioNorm}${addOnStr}`;
      const accionCalendar = {
        evento: titulo,
        fecha_estimada: fecha,
        hora_estimada: hora || '09:00',
        ignorar_choques: true // No bloquear si hay choque, solo registrar
      };
      const calBarberia = CalendarApp.getCalendarById(
        PropertiesService.getScriptProperties().getProperty('CALENDAR_BARBERIA_ID')
      );
      if (calBarberia) {
        crearEvento(accionCalendar, calBarberia);
        console.log(`[VISITAS] Evento creado en Calendar: ${titulo}`);
      } else {
        console.warn('[VISITAS] CALENDAR_BARBERIA_ID no configurado, saltando Calendar.');
      }
    } catch (calErr) {
      console.warn(`[VISITAS] No se pudo crear evento en Calendar: ${calErr.message}`);
      // No falla el flujo completo si el calendar falla
    }

    sendTelegramMessage(chatId,
      `✅ Agendado jefe!\n\n` +
      `👤 ${nombreFinal}${esNuevo}\n` +
      `📅 ${_formatearFechaLegible(fecha)} a las ${hora}\n` +
      `✂️ ${servicioNorm}${addOnStr}\n` +
      `💰 Estimado: $${monto.toLocaleString('es-CL')}`
    );
    console.log(`[VISITAS] Cita agendada: ${nombreFinal} — ${fecha} ${hora}`);

  } catch (error) {
    console.error(`[VISITAS] Error en agendarCita: ${error.message}`);
    sendTelegramMessage(chatId, '❌ No pude agendar la cita. Intenta de nuevo.');
  }
};

// ─── Confirmar visita ─────────────────────────────────────────────────────────

const confirmarVisita = (accion, chatId) => {
  try {
    const match = _buscarCliente(accion.nombre_cliente);

    if (match.ambiguo) {
      sendTelegramMessage(chatId, `⚠️ Hay varios "${accion.nombre_cliente}". ¿Cuál vino? Dime el nombre completo.`);
      return;
    }

    const nombre      = match.encontrado ? match.nombre : accion.nombre_cliente;
    const fechaVisita = accion.fecha || _hoyChile();
    const addOnsNorm  = _normalizarAddOns(accion.add_ons);
    const prodNorm    = _normalizarProductos(accion.productos);

    // Buscar y actualizar la cita de hoy en estado "agendada"
    const sheetCitas  = _getHojaCitas();
    const dataCitas   = sheetCitas.getDataRange().getValues();
    let servicioBase  = accion.servicio || '';
    let horaVisita    = '';
    let citaActualizada = false;

    for (let i = 1; i < dataCitas.length; i++) {
      if (_normalizarFechaSheet(dataCitas[i][0]) === fechaVisita &&
          _normalizar(dataCitas[i][2]) === _normalizar(nombre) &&
          dataCitas[i][5] === 'agendada') {
        sheetCitas.getRange(i + 1, 6).setValue('confirmada');
        if (!servicioBase) servicioBase = dataCitas[i][3];
        horaVisita     = dataCitas[i][1];
        citaActualizada = true;
        break;
      }
    }

    const servicioNorm = _normalizarServicio(servicioBase);
    const monto        = _calcularMonto(servicioNorm, addOnsNorm, prodNorm);

    // Registrar en Historial_Visitas
    const estadoPago = ((accion.estado_pago || 'PAGADO') + '').toUpperCase();
    _getHojaHistorial().appendRow([
      fechaVisita, horaVisita, nombre,
      servicioNorm,
      addOnsNorm.join(', '),
      prodNorm.join(', '),
      monto,
      estadoPago
    ]);
    console.log(`[VISITAS] Registrado en Historial_Visitas: ${nombre} — $${monto} — ${estadoPago}`);

    // Actualizar última_cita en Clientes
    if (match.encontrado) _actualizarUltimaCita(nombre, fechaVisita, match.fila);

    // Descontar del inventario los productos vendidos en esta visita
    let alertasInventario = '';
    prodNorm.forEach(p => {
      try {
        const res = descontarProducto(p, 1);
        if (res.alerta) alertasInventario += res.mensajeAlerta;
      } catch(e) {
        console.warn(`[VISITAS] No pude descontar inventario para ${p}: ${e.message}`);
      }
    });

    const addOnStr  = addOnsNorm.length ? ` + ${addOnsNorm.join(', ')}` : '';
    const prodStr   = prodNorm.length   ? `\n🧴 Productos: ${prodNorm.join(', ')}` : '';
    const notaExtra = !citaActualizada  ? '\n📝 No tenía cita previa registrada, lo anoté igual.' : '';
    const pagoStr   = estadoPago === 'PENDIENTE' ? '\n⚠️ *PAGO PENDIENTE* — aparecerá en el cierre de esta noche.' : '';

    sendTelegramMessage(chatId,
      `✅ Listo jefe! ${nombre} confirmado.\n\n` +
      `✂️ ${servicioNorm}${addOnStr}${prodStr}\n` +
      `💰 $${monto.toLocaleString('es-CL')}${notaExtra}${alertasInventario}${pagoStr}\n` +
      `📅 Fecha registro: ${_formatearFechaLegible(fechaVisita)}`
    );
    console.log(`[VISITAS] Visita confirmada: ${nombre} — $${monto}`);

  } catch (error) {
    console.error(`[VISITAS] Error en confirmarVisita: ${error.message}`);
    sendTelegramMessage(chatId, '❌ No pude confirmar la visita.');
  }
};

// ─── Marcar visita como pagada ────────────────────────────────────────────────

/**
 * Marca como PAGADO el cobro más reciente pendiente de un cliente.
 * Actualiza la fila existente en Historial_Visitas sin duplicar registros.
 * Se activa con mensajes tipo "Juan ya pagó" o "Juan saldó lo que debía".
 */
const marcarVisitaPagada = (accion, chatId) => {
  try {
    const sheet   = _getHojaHistorial();
    const data    = sheet.getDataRange().getValues();
    const busqueda = _normalizar(accion.nombre_cliente || '');

    if (!busqueda) {
      sendTelegramMessage(chatId, '⚠️ Dime el nombre del cliente cuyo pago quieres marcar.');
      return;
    }

    let filaEncontrada  = -1;
    let montoEncontrado = 0;
    let fechaEncontrada = '';

    // Recorremos de abajo hacia arriba → encontramos el más reciente con PENDIENTE
    for (let i = data.length - 1; i >= 1; i--) {
      const nombreFila = _normalizar((data[i][2] || '').toString());
      const estadoPago = ((data[i][7] || '') + '').toUpperCase() || 'PAGADO';

      if (nombreFila === busqueda || nombreFila.includes(busqueda) || busqueda.includes(nombreFila)) {
        if (estadoPago === 'PENDIENTE') {
          filaEncontrada  = i + 1; // 1-indexed para getRange
          montoEncontrado = parseFloat(data[i][6]) || 0;
          fechaEncontrada = _normalizarFechaSheet(data[i][0]);
          break;
        }
      }
    }

    if (filaEncontrada === -1) {
      sendTelegramMessage(chatId,
        `⚠️ No encontré pagos pendientes de *${accion.nombre_cliente}*.\n` +
        `Si el nombre está bien escrito, ya está todo al día. ✅`
      );
      return;
    }

    sheet.getRange(filaEncontrada, 8).setValue('PAGADO'); // Col 8 = estado_pago
    console.log(`[VISITAS] Pago marcado PAGADO: ${accion.nombre_cliente}, fila ${filaEncontrada}`);

    // Generar un INGRESO en la hoja de Finanzas para que el flujo de caja sume hoy
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

    sendTelegramMessage(chatId,
      `✅ Listo jefe! El pago de *${accion.nombre_cliente}* quedó registrado como saldado.\n` +
      `💰 $${montoEncontrado.toLocaleString('es-CL')} — ${fechaEncontrada}`
    );

  } catch (error) {
    console.error(`[VISITAS] Error en marcarVisitaPagada: ${error.message}`);
    sendTelegramMessage(chatId, '❌ No pude marcar el pago. Intenta de nuevo.');
  }
};

// ─── Registrar inasistencia ───────────────────────────────────────────────────

const registrarInasistencia = (accion, chatId) => {
  try {
    const match   = _buscarCliente(accion.nombre_cliente);
    const nombre  = match.encontrado ? match.nombre : accion.nombre_cliente;

    if (match.ambiguo) {
      sendTelegramMessage(chatId, `⚠️ Hay varios con ese nombre. ¿Cuál no vino? Dime el nombre completo.`);
      return;
    }

    const hoy       = _hoyChile();
    const sheetCitas = _getHojaCitas();
    const dataCitas  = sheetCitas.getDataRange().getValues();
    let actualizado  = false;

    for (let i = 1; i < dataCitas.length; i++) {
      if (_normalizarFechaSheet(dataCitas[i][0]) === hoy &&
          _normalizar(dataCitas[i][2]) === _normalizar(nombre) &&
          dataCitas[i][5] === 'agendada') {
        sheetCitas.getRange(i + 1, 6).setValue('inasistencia');
        actualizado = true;
        break;
      }
    }

    const msg = actualizado
      ? `📋 Anotado. ${nombre} marcado como inasistencia hoy.`
      : `📋 Anotado. ${nombre} no vino (no tenía cita registrada en el bot).`;

    sendTelegramMessage(chatId, msg);
    console.log(`[VISITAS] Inasistencia registrada: ${nombre}`);

  } catch (error) {
    console.error(`[VISITAS] Error en registrarInasistencia: ${error.message}`);
    sendTelegramMessage(chatId, '❌ No pude registrar la inasistencia.');
  }
};

// ─── Reagendar cita ───────────────────────────────────────────────────────────

const reagendarCita = (accion, chatId) => {
  try {
    const match  = _buscarCliente(accion.nombre_cliente);
    const nombre = match.encontrado ? match.nombre : accion.nombre_cliente;

    if (match.ambiguo) {
      sendTelegramMessage(chatId, `⚠️ Hay varios con ese nombre. ¿Cuál reagendó? Dime el nombre completo.`);
      return;
    }

    const sheetCitas = _getHojaCitas();
    const dataCitas  = sheetCitas.getDataRange().getValues();
    let actualizado  = false;

    // Marcar cita más próxima de este cliente como "reagendada" y crear la nueva
    for (let i = 1; i < dataCitas.length; i++) {
      if (_normalizar(dataCitas[i][2]) === _normalizar(nombre) &&
          dataCitas[i][5] === 'agendada') {

        // Guardar datos de la cita vieja antes de marcarla
        const viejaFecha   = dataCitas[i][0];
        const viejaHora    = dataCitas[i][1];
        const viejoServicio = dataCitas[i][3];
        const viejosAddOns  = dataCitas[i][4];

        sheetCitas.getRange(i + 1, 6).setValue('reagendada');
        sheetCitas.getRange(i + 1, 7).setValue(accion.nueva_fecha || '');
        sheetCitas.getRange(i + 1, 8).setValue(accion.nueva_hora  || '');

        // Crear nueva cita con la fecha nueva
        sheetCitas.appendRow([
          accion.nueva_fecha, accion.nueva_hora, nombre,
          viejoServicio,
          viejosAddOns,
          'agendada',
          '', '', ''
        ]);

        // Actualizar Google Calendar: borrar evento viejo, crear nuevo
        try {
          const calBarberia = CalendarApp.getCalendarById(
            PropertiesService.getScriptProperties().getProperty('CALENDAR_BARBERIA_ID')
          );
          if (calBarberia && viejaFecha && viejaHora) {
            const fechaVieja = _parseDateTime(viejaFecha, viejaHora);
            // Buscar eventos del cliente en ±5 min de la hora original
            const eventos = calBarberia.getEvents(
              new Date(fechaVieja.getTime() - 5 * 60000),
              new Date(fechaVieja.getTime() + 5 * 60000)
            );
            eventos.forEach(ev => {
              if (_normalizar(ev.getTitle()).includes(_normalizar(nombre))) {
                ev.deleteEvent();
                console.log(`[VISITAS] Evento Calendar borrado: ${ev.getTitle()}`);
              }
            });

            // Crear evento nuevo
            const addOnStr = viejosAddOns ? ` + ${viejosAddOns}` : '';
            crearEvento({
              evento: `✂️ ${nombre} — ${viejoServicio}${addOnStr}`,
              fecha_estimada: accion.nueva_fecha,
              hora_estimada:  accion.nueva_hora || '09:00',
              ignorar_choques: true
            }, calBarberia);
          }
        } catch (calErr) {
          console.warn(`[VISITAS] No pude actualizar Calendar al reagendar: ${calErr.message}`);
        }

        actualizado = true;
        break;
      }
    }

    const fechaLegible = _formatearFechaLegible(accion.nueva_fecha);
    const msg = actualizado
      ? `✅ Reagendado jefe!\n\n👤 ${nombre}\n📅 ${fechaLegible} a las ${accion.nueva_hora}\n📆 Actualicé tu calendario también.`
      : `📋 Reagendado.\n\n👤 ${nombre}\n📅 ${fechaLegible} a las ${accion.nueva_hora}\n\n(No tenía cita previa registrada, creé la nueva igual.)`;

    sendTelegramMessage(chatId, msg);
    console.log(`[VISITAS] Reagendado: ${nombre} → ${accion.nueva_fecha} ${accion.nueva_hora}`);

  } catch (error) {
    console.error(`[VISITAS] Error en reagendarCita: ${error.message}`);
    sendTelegramMessage(chatId, '❌ No pude reagendar la cita.');
  }
};

// ─── Funciones para resúmenes ─────────────────────────────────────────────────

/**
 * Retorna las citas de hoy (todas menos inasistencias).
 */
const obtenerCitasHoy = () => {
  try {
    const hoy  = _hoyChile();
    const data = _getHojaCitas().getDataRange().getValues();
    return data.slice(1)
      .filter(r => _normalizarFechaSheet(r[0]) === hoy && r[5] !== 'inasistencia')
      .map(r => ({ hora: _normalizarHoraSheet(r[1]), nombre: r[2], servicio: r[3], addOns: r[4], estado: r[5] }))
      .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  } catch (e) {
    console.error('[VISITAS] Error en obtenerCitasHoy: ' + e.message);
    return [];
  }
};

/**
 * Retorna las citas de hoy que aún no fueron confirmadas ni marcadas.
 * Se usa en el cierre nocturno para preguntar por pendientes.
 */
const obtenerCitasPendientesConfirmar = () => {
  try {
    const hoy  = _hoyChile();
    const data = _getHojaCitas().getDataRange().getValues();
    return data.slice(1)
      .filter(r => _normalizarFechaSheet(r[0]) === hoy && r[5] === 'agendada')
      .map(r => ({ hora: r[1], nombre: r[2], servicio: r[3] }));
  } catch (e) {
    console.error('[VISITAS] Error en obtenerCitasPendientesConfirmar: ' + e.message);
    return [];
  }
};

/**
 * Retorna un string formateado con las citas de hoy para el mensaje AM.
 */
const obtenerResumenCitasHoy = () => {
  try {
    const citas = obtenerCitasHoy();
    if (citas.length === 0) return 'Sin clientes agendados en el bot hoy.';

    let totalEstimado = 0;
    let texto = '';

    citas.forEach(c => {
      const addOnsArr = c.addOns ? c.addOns.split(', ').filter(Boolean) : [];
      const monto     = _calcularMonto(c.servicio, addOnsArr, []);
      totalEstimado  += monto;
      const check     = c.estado === 'confirmada' ? '✅' : '🕐';
      const addOnStr  = addOnsArr.length ? ` + ${addOnsArr.join(', ')}` : '';
      texto += `${check} ${c.hora} — ${c.nombre} (${c.servicio}${addOnStr})\n`;
    });

    texto += `\n💰 Estimado del día: $${totalEstimado.toLocaleString('es-CL')}`;
    return texto;
  } catch (e) {
    console.error('[VISITAS] Error en obtenerResumenCitasHoy: ' + e.message);
    return 'No pude cargar los clientes de hoy.';
  }
};

// ─── Helper: normalizar texto ────────────────────────────────────────────────

/**
 * Normaliza un string: minúsculas + sin tildes + sin espacios extra.
 * Ej: "Jonathan Henríquez" → "jonathan henriquez"
 */
const _normalizar = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita diacríticos (tildes, etc.)
    .replace(/\s+/g, ' ')
    .trim();
};

// ─── Helper: crear cliente nuevo ──────────────────────────────────────────────

const _crearClienteNuevo = (nombre, telefono) => {
  try {
    const hoy = _hoyChile();
    _getClientesSheet().appendRow([nombre, telefono || '', '', hoy, '', '']);
    console.log(`[VISITAS] Cliente nuevo creado: ${nombre}`);
  } catch (e) {
    console.error(`[VISITAS] Error creando cliente nuevo: ${e.message}`);
  }
};

// ─── Test ─────────────────────────────────────────────────────────────────────

/**
 * LIMPIEZA: Borra el cliente duplicado "jonathan henriquez" (el que no tiene teléfono)
 * y la cita de hoy de Jonathan Henriquez recién creada.
 * Ejecutar UNA sola vez desde el editor de GAS.
 */
const test_LimpiarRegistroPrueba = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  let borrados = 0;

  // 1. Borrar cliente duplicado en Clientes
  const sheetClientes = _getClientesSheet();
  const dataClientes  = sheetClientes.getDataRange().getValues();
  for (let i = dataClientes.length - 1; i >= 1; i--) {
    const nombre = _normalizar((dataClientes[i][0] || '').toString());
    const tel    = (dataClientes[i][1] || '').toString().trim();
    // El duplicado es el que se llama jonathan henriquez y NO tiene teléfono
    if (nombre === 'jonathan henriquez' && !tel) {
      sheetClientes.deleteRow(i + 1);
      console.log(`[LIMPIEZA] Fila ${i + 1} borrada de Clientes: ${dataClientes[i][0]}`);
      borrados++;
    }
  }

  // 2. Borrar cita de hoy de Jonathan Henriquez en Citas
  const sheetCitas = _getHojaCitas();
  const dataCitas  = sheetCitas.getDataRange().getValues();
  for (let i = dataCitas.length - 1; i >= 1; i--) {
    const nombre = _normalizar((dataCitas[i][2] || '').toString());
    if (nombre === 'jonathan henriquez') {
      sheetCitas.deleteRow(i + 1);
      console.log(`[LIMPIEZA] Fila ${i + 1} borrada de Citas: ${dataCitas[i][2]}`);
      borrados++;
    }
  }

  console.log(`[LIMPIEZA] Total filas borradas: ${borrados}`);
  console.log('[LIMPIEZA] Listo. Verifica en tu Sheets que quedó limpio.');
};

/**
 * TEST: Verifica que las hojas se crean correctamente y muestra citas de hoy.
 * Ejecutar en GAS Editor para inicializar las hojas Citas e Historial_Visitas.
 */
const test_HojasRegistro = () => {
  console.log('--- Verificando hojas de registro ---');
  _getHojaCitas();
  _getHojaHistorial();
  console.log('✅ Hojas Citas e Historial_Visitas listas.');
  console.log('Citas hoy:', JSON.stringify(obtenerCitasHoy()));
  console.log('Pendientes:', JSON.stringify(obtenerCitasPendientesConfirmar()));
  console.log('Resumen AM:\n' + obtenerResumenCitasHoy());
  console.log('--- Fin test ---');
};

/**
 * LIMPIEZA: Borra las citas erróneas del 3 de septiembre para
 * Nicolas Rivera y Elias Rivera, registradas antes de que el bot estuviera estable.
 * Ejecutar UNA VEZ desde el editor de GAS.
 */
const test_LimpiarCitasSept3 = () => {
  const BORRAR_NOMBRES = ['nicolas rivera', 'elias rivera'];
  const FECHA_OBJETIVO = '2026-09-03';
  let borrados = 0;

  // 1. Borrar en hoja Citas
  const sheetCitas = _getHojaCitas();
  const dataCitas  = sheetCitas.getDataRange().getValues();
  for (let i = dataCitas.length - 1; i >= 1; i--) {
    const fecha  = (dataCitas[i][0] || '').toString();
    const nombre = _normalizar(dataCitas[i][2] || '');
    if (fecha === FECHA_OBJETIVO && BORRAR_NOMBRES.includes(nombre)) {
      sheetCitas.deleteRow(i + 1);
      console.log(`[LIMPIEZA] Cita borrada: ${dataCitas[i][2]} el ${fecha}`);
      borrados++;
    }
  }

  console.log(`[LIMPIEZA] Total: ${borrados} filas borradas de Citas.`);
  console.log('[LIMPIEZA] Listo. Ahora puedes volver a agendar a estos clientes.');
};

/**
 * TEST: Muestra el estado de pagos en Historial_Visitas.
 * Ejecutar en GAS Editor para verificar que estado_pago se guarda correctamente.
 */
const test_EstadoPagos = () => {
  console.log('--- test_EstadoPagos ---');
  const sheet = _getHojaHistorial();
  const data  = sheet.getDataRange().getValues();
  console.log(`Total filas en Historial_Visitas: ${data.length - 1}`);
  const pendientes = data.slice(1).filter(r => ((r[7] || '') + '').toUpperCase() === 'PENDIENTE');
  const sin_estado = data.slice(1).filter(r => !r[7] || r[7] === '');
  console.log(`Pagos PENDIENTES: ${pendientes.length}`);
  pendientes.forEach(r => console.log(`  - ${r[2]} | ${r[3]} | $${r[6]} | ${_normalizarFechaSheet(r[0])}`));
  console.log(`Sin campo estado_pago (filas antiguas): ${sin_estado.length}`);
  console.log('--- Fin test ---');
};

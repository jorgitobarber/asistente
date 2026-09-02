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
    sheet.appendRow(['fecha', 'hora', 'nombre_cliente', 'servicio', 'add_ons', 'productos', 'monto']);
    console.log('[VISITAS] Hoja Historial_Visitas creada.');
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

    // Registrar en hoja Citas
    _getHojaCitas().appendRow([
      fecha, hora, nombreFinal,
      servicioNorm,
      addOnsNorm.join(', '),
      'agendada',
      '', '', '' // nueva_fecha, nueva_hora, id_evento_calendar
    ]);

    const esNuevo      = !match.encontrado ? '\n👤 *Cliente nuevo* — lo agregué a tu lista.' : '';
    const addOnStr     = addOnsNorm.length  ? ` + ${addOnsNorm.join(', ')}` : '';
    const monto        = _calcularMonto(servicioNorm, addOnsNorm, []);

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
    const hoy         = _hoyChile();
    const addOnsNorm  = _normalizarAddOns(accion.add_ons);
    const prodNorm    = _normalizarProductos(accion.productos);

    // Buscar y actualizar la cita de hoy en estado "agendada"
    const sheetCitas  = _getHojaCitas();
    const dataCitas   = sheetCitas.getDataRange().getValues();
    let servicioBase  = accion.servicio || '';
    let horaVisita    = '';
    let citaActualizada = false;

    for (let i = 1; i < dataCitas.length; i++) {
      if (dataCitas[i][0] === hoy &&
          dataCitas[i][2].toLowerCase() === nombre.toLowerCase() &&
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
    _getHojaHistorial().appendRow([
      hoy, horaVisita, nombre,
      servicioNorm,
      addOnsNorm.join(', '),
      prodNorm.join(', '),
      monto
    ]);

    // Actualizar última_cita en Clientes
    if (match.encontrado) _actualizarUltimaCita(nombre, hoy, match.fila);

    const addOnStr  = addOnsNorm.length ? ` + ${addOnsNorm.join(', ')}` : '';
    const prodStr   = prodNorm.length   ? `\n🧴 Productos: ${prodNorm.join(', ')}` : '';
    const notaExtra = !citaActualizada  ? '\n📝 No tenía cita previa registrada, lo anoté igual.' : '';

    sendTelegramMessage(chatId,
      `✅ Listo jefe! ${nombre} confirmado.\n\n` +
      `✂️ ${servicioNorm}${addOnStr}${prodStr}\n` +
      `💰 $${monto.toLocaleString('es-CL')}${notaExtra}`
    );
    console.log(`[VISITAS] Visita confirmada: ${nombre} — $${monto}`);

  } catch (error) {
    console.error(`[VISITAS] Error en confirmarVisita: ${error.message}`);
    sendTelegramMessage(chatId, '❌ No pude confirmar la visita.');
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
      if (dataCitas[i][0] === hoy &&
          dataCitas[i][2].toLowerCase() === nombre.toLowerCase() &&
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
      if (dataCitas[i][2].toLowerCase() === nombre.toLowerCase() &&
          dataCitas[i][5] === 'agendada') {
        sheetCitas.getRange(i + 1, 6).setValue('reagendada');
        sheetCitas.getRange(i + 1, 7).setValue(accion.nueva_fecha || '');
        sheetCitas.getRange(i + 1, 8).setValue(accion.nueva_hora  || '');

        // Crear nueva cita con la fecha nueva
        sheetCitas.appendRow([
          accion.nueva_fecha, accion.nueva_hora, nombre,
          dataCitas[i][3], // mismo servicio
          dataCitas[i][4], // mismos add_ons
          'agendada',
          '', '', ''
        ]);
        actualizado = true;
        break;
      }
    }

    const fechaLegible = _formatearFechaLegible(accion.nueva_fecha);
    const msg = actualizado
      ? `✅ Reagendado jefe!\n\n👤 ${nombre}\n📅 ${fechaLegible} a las ${accion.nueva_hora}`
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
      .filter(r => r[0] === hoy && r[5] !== 'inasistencia')
      .map(r => ({ hora: r[1], nombre: r[2], servicio: r[3], addOns: r[4], estado: r[5] }))
      .sort((a, b) => a.hora.localeCompare(b.hora));
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
      .filter(r => r[0] === hoy && r[5] === 'agendada')
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

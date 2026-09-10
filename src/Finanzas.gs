/**
 * Módulo Finanzas: Registro de gastos con categorías, ingresos manuales y reportes.
 *
 * Hoja Gastos:   [fecha, hora, categoría, descripción, monto]   ← 5 columnas (nuevo schema)
 * Hoja Ingresos: [fecha, hora, descripción, monto]              ← ingresos manuales
 *
 * Los ingresos de clientes de barbería van a Historial_Visitas (gestionado por Citas.gs).
 * Esta es la fuente de verdad del flujo de caja.
 */

// Categorías válidas — Gemini las asigna automáticamente al registrar un gasto
const CATEGORIAS_GASTO = [
  'Insumos',      // navajas, ceras, productos de trabajo
  'Alimentación', // comida, bebidas (monster, almuerzo)
  'Transporte',   // uber, micro, bencina
  'Servicios',    // luz, agua, internet, arriendo
  'Educación',    // libros, fotocopias, materiales universidad
  'Equipamiento', // tijeras, máquinas, muebles del local
  'Personal',     // ropa, entretenimiento
  'Otro'          // lo que no encaja en ninguna categoría anterior
];

const EMOJIS_CATEGORIA = {
  'Insumos': '🧴', 'Alimentación': '🍔', 'Transporte': '🚗',
  'Servicios': '💡', 'Educación': '📚', 'Equipamiento': '✂️',
  'Personal': '👕', 'Otro': '📦'
};

// ─── Helpers de Sheet ─────────────────────────────────────────────────────────

const getSheetId = () => {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Falta configurar SHEET_ID en las propiedades del script.');
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

const _getHojaGastos = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  return _getOrCreateSheet(ss, 'Gastos', ['fecha', 'hora', 'categoría', 'descripción', 'monto']);
};

// ─── Registro de gasto / ingreso ──────────────────────────────────────────────

/**
 * Registra un gasto (con categoría) o un ingreso manual.
 * Llamada desde Main.gs cuando accion.tipo === 'FINANZAS'.
 */
const registrarFinanzas = (accion, fechaActual) => {
  try {
    const ss    = SpreadsheetApp.openById(getSheetId());
    const fecha = fechaActual.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    const hora  = fechaActual.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' });
    let msg = '';

    if (accion.subtipo === 'GASTO') {
      const monto = parseFloat(accion.monto) || 0;
      if (monto <= 0) {
        return { ok: false, mensaje: '⚠️ El monto del gasto debe ser mayor a 0.' };
      }
      const categoria  = CATEGORIAS_GASTO.includes(accion.categoria) ? accion.categoria : 'Otro';
      const descripcion = (accion.descripcion || 'Sin descripción').toString().trim();

      _getHojaGastos().appendRow([fecha, hora, categoria, descripcion, monto]);
      console.log(`[FINANZAS] Gasto: ${categoria} | ${descripcion} | $${monto}`);

      const emoji = EMOJIS_CATEGORIA[categoria] || '📦';
      msg = `💸 Gasto registrado:\n<b>${escapeHtml(descripcion)}</b>\n${emoji} ${escapeHtml(categoria)} | $${monto.toLocaleString('es-CL')}`;

    } else if (accion.subtipo === 'INGRESO') {
      const monto = parseFloat(accion.monto) || 0;
      const sheetI = _getOrCreateSheet(ss, 'Ingresos', ['fecha', 'hora', 'descripción', 'monto']);
      sheetI.appendRow([fecha, hora, accion.descripcion, monto]);
      console.log(`[FINANZAS] Ingreso: $${monto} — ${accion.descripcion}`);
      msg = `💰 Ingreso registrado:\n$${monto.toLocaleString('es-CL')} — ${escapeHtml(accion.descripcion)}`;
    }

    return { ok: true, mensaje: msg };
  } catch (error) {
    console.error(`[FINANZAS] Error en registrarFinanzas: ${error.message}`);
    return { ok: false, mensaje: `❌ Error al registrar finanzas: ${escapeHtml(error.message)}` };
  }
};

// ─── Anular último gasto ───────────────────────────────────────────────────────

/**
 * Borra la última fila de la hoja Gastos.
 * Llamada cuando el usuario dice "ese gasto estuvo mal" o "borra el último gasto".
 */
const anularUltimoGasto = () => {
  try {
    const sheet   = _getHojaGastos();
    const lastRow = sheet.getLastRow();

    if (lastRow <= 1) {
      return { ok: false, mensaje: '⚠️ No hay gastos registrados para anular.' };
    }

    const data = sheet.getRange(lastRow, 1, 1, 5).getValues()[0];
    const desc  = String(data[3] || 'Sin descripción');
    const cat   = String(data[2] || 'Otro');
    const monto = parseFloat(data[4]) || 0;
    const emoji = EMOJIS_CATEGORIA[cat] || '📦';

    sheet.deleteRow(lastRow);
    console.log(`[FINANZAS] Último gasto anulado: ${desc} | $${monto}`);
    return {
      ok: true,
      mensaje: `↩️ Último gasto anulado:\n<b>${escapeHtml(desc)}</b>\n${emoji} ${escapeHtml(cat)} | $${monto.toLocaleString('es-CL')}`
    };
  } catch (error) {
    console.error(`[FINANZAS] Error en anularUltimoGasto: ${error.message}`);
    return { ok: false, mensaje: `❌ No pude anular el gasto: ${escapeHtml(error.message)}` };
  }
};

// ─── Cálculo central de finanzas (MOVIDO desde Notificaciones.gs) ─────────────

/**
 * Calcula ingresos, gastos y balance en un rango de fechas.
 * Fuentes:
 *   - Historial_Visitas → ingresos de barbería (solo PAGADO)
 *   - Ingresos          → ingresos manuales (ventas de producto, otros)
 *   - Gastos            → todos los gastos (nueva schema de 5 cols: monto en col[4])
 */
const _calcularFinanzasRango = (ss, dateStart, dateEnd) => {
  let ingresos = 0, gastos = 0, clientes = 0;

  const startStr = Utilities.formatDate(dateStart, 'America/Santiago', 'yyyy-MM-dd');
  const endStr   = Utilities.formatDate(dateEnd,   'America/Santiago', 'yyyy-MM-dd');

  const normFecha = (v) => {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'yyyy-MM-dd');
    const str = v.toString().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    if (str.includes('/')) {
      const p = str.split(' ')[0].split('/');
      if (p.length === 3 && parseInt(p[2]) > 31)
        return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    }
    const d = new Date(str);
    return !isNaN(d.getTime()) ? Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd') : '';
  };

  const enRango = (v) => { const f = normFecha(v); return f >= startStr && f <= endStr; };

  // 1. Ingresos de barbería (Historial_Visitas — solo visitas PAGADAS)
  const shHist = ss.getSheetByName('Historial_Visitas');
  if (shHist) {
    const dataH = shHist.getDataRange().getValues();
    for (let i = 1; i < dataH.length; i++) {
      if (!enRango(dataH[i][0])) continue;
      const estadoPago = ((dataH[i][7] || '') + '').toUpperCase();
      if (estadoPago === 'PENDIENTE') { clientes++; continue; }
      ingresos += parseFloat(dataH[i][6]) || 0;
      clientes++;
    }
  }

  // 2. Ingresos manuales (ventas de producto u otros — hoja Ingresos)
  const shIng = ss.getSheetByName('Ingresos');
  if (shIng) {
    const dataI = shIng.getDataRange().getValues();
    for (let i = 1; i < dataI.length; i++) {
      if (!enRango(dataI[i][0])) continue;
      ingresos += parseFloat(dataI[i][3]) || 0;
    }
  }

  // 3. Gastos (nueva schema: col[4] = monto)
  const shG = ss.getSheetByName('Gastos');
  if (shG) {
    const dataG = shG.getDataRange().getValues();
    for (let i = 1; i < dataG.length; i++) {
      if (!enRango(dataG[i][0])) continue;
      gastos += parseFloat(dataG[i][4]) || 0;
    }
  }

  console.log(`[FINANZAS] Rango ${startStr}→${endStr}: ingresos=$${ingresos}, gastos=$${gastos}, clientes=${clientes}`);
  return { ingresos, gastos, clientes, balance: ingresos - gastos };
};

// ─── Reporte por categoría ────────────────────────────────────────────────────

/**
 * Agrupa gastos por categoría en un rango de fechas.
 */
const _calcularGastosPorCategoria = (ss, dateStart, dateEnd) => {
  const startStr = Utilities.formatDate(dateStart, 'America/Santiago', 'yyyy-MM-dd');
  const endStr   = Utilities.formatDate(dateEnd,   'America/Santiago', 'yyyy-MM-dd');
  const porCategoria = {};
  let totalGastos = 0;

  const normFecha = (v) => {
    if (!v) return '';
    if (v instanceof Date) return Utilities.formatDate(v, 'America/Santiago', 'yyyy-MM-dd');
    const str = v.toString().trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const d = new Date(str);
    return !isNaN(d.getTime()) ? Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd') : '';
  };

  const sheet = ss.getSheetByName('Gastos');
  if (!sheet) return { porCategoria, totalGastos };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const f = normFecha(data[i][0]);
    if (f < startStr || f > endStr) continue;
    const cat   = (data[i][2] || 'Otro').toString();
    const monto = parseFloat(data[i][4]) || 0;
    porCategoria[cat] = (porCategoria[cat] || 0) + monto;
    totalGastos += monto;
  }

  return { porCategoria, totalGastos };
};

/**
 * Genera y envía reporte de gastos por categoría.
 * Llamado desde Main.gs cuando accion.tipo === 'REPORTE_GASTOS'.
 */
const generarReporteGastos = (accion, chatId) => {
  try {
    const ss  = SpreadsheetApp.openById(getSheetId());
    const hoy = new Date();
    let dateStart, dateEnd, labelPeriodo;

    if (accion.periodo === 'DIA') {
      dateStart = new Date(hoy); dateEnd = new Date(hoy);
      labelPeriodo = 'Hoy';
    } else if (accion.periodo === 'SEMANA') {
      dateStart = new Date(hoy); dateStart.setDate(hoy.getDate() - 7);
      dateEnd   = new Date(hoy);
      labelPeriodo = 'Últimos 7 días';
    } else { // MES (default)
      dateStart    = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      dateEnd      = new Date(hoy);
      labelPeriodo = hoy.toLocaleDateString('es-CL', { month: 'long', year: 'numeric', timeZone: 'America/Santiago' });
    }

    const fin                       = _calcularFinanzasRango(ss, dateStart, dateEnd);
    const { porCategoria, totalGastos } = _calcularGastosPorCategoria(ss, dateStart, dateEnd);

    let msg = `📊 <b>Reporte Financiero — ${escapeHtml(labelPeriodo)}</b>\n`;

    // Gastos por categoría
    if (totalGastos > 0) {
      msg += `\n💸 <b>GASTOS POR CATEGORÍA</b>\n`;
      Object.entries(porCategoria)
        .sort((a, b) => b[1] - a[1]) // Mayor gasto primero
        .forEach(([cat, monto]) => {
          const pct   = totalGastos > 0 ? Math.round((monto / totalGastos) * 100) : 0;
          const emoji = EMOJIS_CATEGORIA[cat] || '📦';
          msg += `${emoji} <b>${escapeHtml(cat)}</b>: $${monto.toLocaleString('es-CL')} (${pct}%)\n`;
        });
    } else {
      msg += `\n💸 Sin gastos registrados en este período.\n`;
    }

    // Resumen financiero
    msg += `\n💰 <b>RESUMEN</b>\n`;
    msg += `Ingresos:   $${fin.ingresos.toLocaleString('es-CL')}\n`;
    msg += `Gastos:     $${fin.gastos.toLocaleString('es-CL')}\n`;
    const signo  = fin.balance >= 0 ? '+' : '';
    const icono  = fin.balance >= 0 ? '✅' : '🔴';
    msg += `Balance:    <b>${signo}$${fin.balance.toLocaleString('es-CL')}</b> ${icono}\n`;
    if (fin.clientes > 0) msg += `Clientes:   ${fin.clientes}\n`;

    sendTelegramMessage(chatId, msg);
    console.log(`[FINANZAS] Reporte enviado — ${labelPeriodo}`);
    // Devolvemos ok:true con mensaje null porque ya enviamos directamente
    // (el mensaje puede ser largo, mejor enviarlo desde aquí que por el consolidado)
    return { ok: true, mensaje: null };

  } catch (error) {
    console.error(`[FINANZAS] Error en generarReporteGastos: ${error.message}`);
    return { ok: false, mensaje: `❌ No pude generar el reporte: ${escapeHtml(error.message)}` };
  }
};

// ─── Inicialización (correr una vez) ──────────────────────────────────────────

/**
 * Borra la hoja Gastos y la recrea con el nuevo schema de 5 columnas.
 * Ejecutar UNA VEZ manualmente desde el editor de GAS si venías usando
 * el schema viejo de 4 columnas [fecha, hora, descripción, monto].
 */
const resetearHojaGastos = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  const existing = ss.getSheetByName('Gastos');
  if (existing) {
    ss.deleteSheet(existing);
    console.log('[FINANZAS] Hoja Gastos eliminada.');
  }
  _getHojaGastos(); // Recrea con el nuevo schema
  console.log('[FINANZAS] ✅ Hoja Gastos recreada: [fecha, hora, categoría, descripción, monto]');
};

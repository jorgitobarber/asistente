/**
 * Módulo Inventario: Gestiona el stock de productos de la barbería.
 * Productos actuales: Cera y Texturizador Indian Collection.
 * Costo compra: $2.500 | Precio venta: $5.000 | Margen: $2.500 por unidad.
 */

const INVENTARIO_ALIASES = {
  'Cera':         ['cera', 'ceras', 'cera de pelo', 'cera indian', 'indian cera'],
  'Texturizador': ['texturizador', 'polvos', 'polvos texturizadores', 'texturizadores', 'polvo']
};

// ─── Sheet helper ──────────────────────────────────────────────────────────────

const _getHojaInventario = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  let sheet = ss.getSheetByName('Inventario');
  if (!sheet) {
    sheet = ss.insertSheet('Inventario');
    sheet.appendRow(['nombre', 'stock_actual', 'stock_minimo', 'costo_compra', 'precio_venta', 'unidad', 'marca']);
    sheet.appendRow(['Cera',         0, 2, 2500, 5000, 'pote', 'Indian Collection']);
    sheet.appendRow(['Texturizador', 0, 2, 2500, 5000, 'pote', 'Indian Collection']);
    console.log('[INVENTARIO] Hoja Inventario creada con productos iniciales.');
  }
  return sheet;
};

// ─── Normalización ─────────────────────────────────────────────────────────────

const _normalizarProductoInventario = (input) => {
  if (!input) return '';
  const lower = _normalizar(input);
  for (const [nombre, aliases] of Object.entries(INVENTARIO_ALIASES)) {
    if (aliases.some(a => lower === a || lower.includes(a) || a.includes(lower))) return nombre;
  }
  return '';
};

// ─── Buscar fila ────────────────────────────────────────────────────────────────

const _buscarFilaProducto = (nombreCanónico, data) => {
  for (let i = 1; i < data.length; i++) {
    if (_normalizar(data[i][0]) === _normalizar(nombreCanónico)) return i;
  }
  return -1;
};

// ─── Descontar producto (usado desde confirmarVisita y venta directa) ──────────

/**
 * Descuenta unidades del stock.
 * @returns { ok, alerta, mensajeAlerta }
 */
const descontarProducto = (nombreProducto, cantidad) => {
  try {
    const canon = _normalizarProductoInventario(nombreProducto);
    if (!canon) {
      console.warn(`[INVENTARIO] Producto no reconocido para descontar: ${nombreProducto}`);
      return { ok: false, alerta: false, mensajeAlerta: '' };
    }

    const sheet = _getHojaInventario();
    const data  = sheet.getDataRange().getValues();
    const fila  = _buscarFilaProducto(canon, data);

    if (fila < 0) {
      console.warn(`[INVENTARIO] No encontré fila para: ${canon}`);
      return { ok: false, alerta: false, mensajeAlerta: '' };
    }

    const stockActual = parseInt(data[fila][1]) || 0;
    const stockMinimo = parseInt(data[fila][2]) || 2;
    const nuevoStock  = Math.max(0, stockActual - (parseInt(cantidad) || 1));
    const unidad      = data[fila][5] || 'unidad';

    sheet.getRange(fila + 1, 2).setValue(nuevoStock);
    console.log(`[INVENTARIO] ${canon}: ${stockActual} → ${nuevoStock}`);

    const alerta = nuevoStock <= stockMinimo;
    const mensajeAlerta = alerta
      ? `\n\n⚠️ *Stock bajo de ${canon}:* quedan ${nuevoStock} ${unidad}${nuevoStock === 0 ? '. ¡AGOTADO! Considera comprar más.' : '. Considera reabastecerte.'}`
      : '';

    return { ok: true, alerta, mensajeAlerta };
  } catch (e) {
    console.error(`[INVENTARIO] Error en descontarProducto: ${e.message}`);
    return { ok: false, alerta: false, mensajeAlerta: '' };
  }
};

// ─── Reabastecer inventario ────────────────────────────────────────────────────

/**
 * Suma stock cuando Jorge compra productos.
 * Registra el gasto automáticamente en la hoja Gastos.
 */
const reabastecer = (accion, chatId) => {
  try {
    const canon = _normalizarProductoInventario(accion.producto);
    if (!canon) {
      sendTelegramMessage(chatId, '⚠️ No reconocí el producto. ¿Es Cera o Texturizador?');
      return;
    }

    const sheet = _getHojaInventario();
    const data  = sheet.getDataRange().getValues();
    const fila  = _buscarFilaProducto(canon, data);
    if (fila < 0) {
      sendTelegramMessage(chatId, `⚠️ No encontré ${canon} en el inventario.`);
      return;
    }

    const cantidad      = parseInt(accion.cantidad) || 1;
    const costoUnitario = parseInt(data[fila][3]) || 2500;
    const costoTotal    = accion.costo_total ? parseInt(accion.costo_total) : cantidad * costoUnitario;
    const stockActual   = parseInt(data[fila][1]) || 0;
    const nuevoStock    = stockActual + cantidad;
    const precioVenta   = parseInt(data[fila][4]) || 5000;
    const margenTotal   = (precioVenta - costoUnitario) * cantidad;

    sheet.getRange(fila + 1, 2).setValue(nuevoStock);

    // Registrar en Gastos
    const ss    = SpreadsheetApp.openById(getSheetId());
    const hoy   = new Date();
    const fecha = hoy.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    const hora  = hoy.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' });
    const sheetG = _getOrCreateSheet(ss, 'Gastos', ['fecha', 'hora', 'descripción', 'monto']);
    sheetG.appendRow([fecha, hora, `Reabastecimiento ${canon} x${cantidad} (${data[fila][6]})`, costoTotal]);

    console.log(`[INVENTARIO] Reabastecido ${canon}: +${cantidad} → stock ${nuevoStock}. Gasto: $${costoTotal}`);

    sendTelegramMessage(chatId,
      `✅ Inventario actualizado!\n\n` +
      `📦 ${canon} — ${data[fila][6]}\n` +
      `➕ +${cantidad} unidades → Stock total: *${nuevoStock}*\n` +
      `💸 Gasto: $${costoTotal.toLocaleString('es-CL')}\n` +
      `📈 Margen potencial si vendes todo: $${margenTotal.toLocaleString('es-CL')}`
    );
  } catch (e) {
    console.error(`[INVENTARIO] Error en reabastecer: ${e.message}`);
    sendTelegramMessage(chatId, '❌ No pude actualizar el inventario.');
  }
};

// ─── Venta directa de producto (sin servicio de barbería) ─────────────────────

/**
 * El cliente solo viene a comprar un producto, sin corte.
 */
const registrarVentaProductoDirecta = (accion, chatId) => {
  try {
    const canon = _normalizarProductoInventario(accion.producto);
    if (!canon) {
      sendTelegramMessage(chatId, '⚠️ No reconocí el producto. ¿Es Cera o Texturizador?');
      return;
    }

    const cantidad = parseInt(accion.cantidad) || 1;
    const sheet    = _getHojaInventario();
    const data     = sheet.getDataRange().getValues();
    const fila     = _buscarFilaProducto(canon, data);
    const precio   = fila >= 0 ? parseInt(data[fila][4]) : 5000;
    const total    = precio * cantidad;

    // Descontar inventario
    const { mensajeAlerta } = descontarProducto(canon, cantidad);

    // Registrar como ingreso
    const ss    = SpreadsheetApp.openById(getSheetId());
    const hoy   = new Date();
    const fecha = hoy.toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });
    const hora  = hoy.toLocaleTimeString('es-CL', { timeZone: 'America/Santiago' });
    const desc  = accion.nombre_cliente
      ? `Venta ${canon} x${cantidad} — ${accion.nombre_cliente}`
      : `Venta ${canon} x${cantidad}`;

    const sheetI = _getOrCreateSheet(ss, 'Ingresos', ['fecha', 'hora', 'descripción', 'monto']);
    sheetI.appendRow([fecha, hora, desc, total]);

    // Stock actual después del descuento
    const dataFresh  = _getHojaInventario().getDataRange().getValues();
    const filaFresh  = _buscarFilaProducto(canon, dataFresh);
    const nuevoStock = filaFresh >= 0 ? parseInt(dataFresh[filaFresh][1]) : '?';

    console.log(`[INVENTARIO] Venta directa: ${canon} x${cantidad} = $${total}`);

    sendTelegramMessage(chatId,
      `✅ Venta registrada!\n\n` +
      `📦 ${canon} x${cantidad}\n` +
      `💰 $${total.toLocaleString('es-CL')}\n` +
      `📊 Stock restante: ${nuevoStock}${mensajeAlerta}`
    );
  } catch (e) {
    console.error(`[INVENTARIO] Error en registrarVentaProductoDirecta: ${e.message}`);
    sendTelegramMessage(chatId, '❌ No pude registrar la venta del producto.');
  }
};

// ─── Resumen para mensaje matutino ────────────────────────────────────────────

/**
 * Retorna string con alertas de stock bajo (solo si hay algo bajo el mínimo).
 * Si todo está bien, retorna ''.
 */
const obtenerResumenInventario = () => {
  try {
    const data = _getHojaInventario().getDataRange().getValues();
    if (data.length <= 1) return '';

    let texto = '';
    let hayBajos = false;

    data.slice(1).forEach(r => {
      const stock  = parseInt(r[1]) || 0;
      const minimo = parseInt(r[2]) || 2;
      const bajo   = stock <= minimo;
      if (bajo) {
        hayBajos = true;
        const emoji = stock === 0 ? '🚨' : '⚠️';
        texto += `${emoji} ${r[0]}: ${stock} ${r[5] || 'unidades'}${stock === 0 ? ' — AGOTADO' : ' (bajo mínimo)'}\n`;
      }
    });

    return hayBajos ? texto : '';
  } catch (e) {
    console.error('[INVENTARIO] Error en obtenerResumenInventario: ' + e.message);
    return '';
  }
};

// ─── Test / Inicialización ─────────────────────────────────────────────────────

/**
 * TEST: Inicializa la hoja Inventario y muestra el estado actual.
 * Ejecutar UNA VEZ desde el editor de GAS.
 */
const test_InicializarInventario = () => {
  console.log('--- Inventario ---');
  const sheet = _getHojaInventario();
  const data  = sheet.getDataRange().getValues();
  console.log('Productos:', JSON.stringify(data.slice(1)));
  console.log('Alertas AM:\n' + (obtenerResumenInventario() || '(todo en orden)'));
  console.log('--- Fin ---');
};

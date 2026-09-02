/**
 * Módulo ClientesRecuperacion: Gestiona clientes que deberían volver
 * Calcula automáticamente quién tiene tiempo sin visitar según su historial
 * y arma mensajes sugeridos para recuperarlos por WhatsApp.
 */

/**
 * Obtiene o crea la hoja de Clientes
 */
const _getClientesSheet = () => {
  const ss = SpreadsheetApp.openById(getSheetId());
  let sheet = ss.getSheetByName("Clientes");
  if (!sheet) {
    sheet = ss.insertSheet("Clientes");
    sheet.appendRow(["nombre", "teléfono", "última_cita", "primera_cita", "promedio_días", "última_contactación"]);
  }
  return sheet;
};

/**
 * Parser de una línea CSV que respeta campos entre comillas.
 * Resuelve el problema de fechas con comas: "26 Jan 2026, 12:00am"
 */
const _parsearCSVLinea = (linea) => {
  const campos = [];
  let campo = '';
  let dentroComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const char = linea[i];
    if (char === '"') {
      dentroComillas = !dentroComillas;
    } else if (char === ',' && !dentroComillas) {
      campos.push(campo.trim());
      campo = '';
    } else {
      campo += char;
    }
  }
  campos.push(campo.trim());
  return campos;
};

/**
 * Convierte un string de fecha en formato "01 Jun 2026, 12:00am" a objeto Date
 */
const _parsearFecha = (fechaStr) => {
  if (!fechaStr || typeof fechaStr !== 'string') return null;

  const meses = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  const match = fechaStr.match(/(\d{2})\s+(\w{3})\s+(\d{4})/);
  if (!match) return null;

  const dia = match[1];
  const mes = meses[match[2]];
  const año = match[3];

  return new Date(`${año}-${mes}-${dia}T12:00:00`);
};

/**
 * Calcula la diferencia en días entre dos fechas
 */
const _calcularDías = (fechaAnterior, fechaActual) => {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((fechaActual - fechaAnterior) / msPerDay);
};

/**
 * Inicializa la hoja Clientes desde un CSV de datos de Fresha.
 * VERSIÓN BÁSICA: usa heurística simple para estimar el promedio de días.
 * Preferir usar inicializarClientesDesdeCSVProcesado() que tiene promedios reales.
 */
const inicializarClientesDesdeFresha = (datosCSV) => {
  try {
    const sheet = _getClientesSheet();
    const lineas = datosCSV.split('\n').filter(l => l.trim());

    // Nombres de clientes placeholder a ignorar
    const PLACEHOLDER_NAMES = ['Jane Doe', 'John Doe'];

    let cargados = 0;
    let saltados = 0;

    // Saltamos el header (fila 0)
    for (let i = 1; i < lineas.length; i++) {
      const campos = _parsearCSVLinea(lineas[i]);
      const nombre = campos[0] ? campos[0].trim() : '';

      if (!nombre) { saltados++; continue; }

      // Saltar placeholders
      if (PLACEHOLDER_NAMES.includes(nombre)) {
        console.log(`[CLIENTES] Saltando placeholder: ${nombre}`);
        saltados++;
        continue;
      }

      const teléfono = campos[3] ? campos[3].trim() : '';
      const primeraCita = campos[6] ? campos[6].trim() : '';
      const últimaCita = campos[7] ? campos[7].trim() : '';

      sheet.appendRow([nombre, teléfono, últimaCita, primeraCita, '', '']);
      cargados++;
    }

    console.log(`[CLIENTES] Inicialización completada: ${cargados} clientes cargados, ${saltados} saltados.`);
  } catch (error) {
    console.error(`[CLIENTES] Error en inicialización: ${error.message}`);
    throw error;
  }
};

/**
 * Calcula el promedio de días entre citas para un cliente.
 * Basado en su primera y última cita (heurística simple).
 */
const _calcularPromedioCliente = (primeraCita, últimaCita) => {
  const f1 = _parsearFecha(primeraCita);
  const f2 = _parsearFecha(últimaCita);

  if (!f1 || !f2) return null;

  const diasTotales = _calcularDías(f1, f2);

  if (diasTotales < 7) return 7;   // Muy reciente o visita única
  if (diasTotales < 30) return 14; // Habitual frecuente
  return 30;                        // Cliente estándar cada ~mes
};

/**
 * Obtiene la lista de clientes que deberían volver.
 * Excluye clientes contactados en los últimos DIAS_GRACIA días.
 * Retorna: [{nombre, teléfono, últimaCita, diasDesdeÚltimaCita, promedioDías, fila}, ...]
 */
const obtenerClientesPendientes = () => {
  const DIAS_GRACIA_CONTACTO = 14; // Si lo contactaste hace menos de 14 días, no aparece

  try {
    const sheet = _getClientesSheet();
    const data = sheet.getDataRange().getValues();
    const hoy = new Date();
    const pendientes = [];

    for (let i = 1; i < data.length; i++) {
      const nombre = data[i][0];
      const teléfono = data[i][1];
      const últimaCita = data[i][2];
      const primeraCita = data[i][3];
      const últimaContactación = data[i][5];

      if (!nombre || !últimaCita) continue;

      // Filtro: contactado recientemente → no molestar
      if (últimaContactación) {
        const fechaContacto = new Date(últimaContactación);
        if (!isNaN(fechaContacto.getTime())) {
          const diasDesdeContacto = _calcularDías(fechaContacto, hoy);
          if (diasDesdeContacto < DIAS_GRACIA_CONTACTO) continue;
        }
      }

      const fechaÚltimaCita = _parsearFecha(últimaCita);
      if (!fechaÚltimaCita) continue;

      const diasDesdeÚltimaCita = _calcularDías(fechaÚltimaCita, hoy);
      let promedioDías = data[i][4] ? parseInt(data[i][4]) : null;

      // Si no tiene promedio calculado, lo calculamos y lo guardamos
      if (!promedioDías) {
        promedioDías = _calcularPromedioCliente(primeraCita, últimaCita);
        if (promedioDías) {
          sheet.getRange(i + 1, 5).setValue(promedioDías);
        }
      }

      // Cliente vencido: lleva más días que su promedio sin venir
      if (promedioDías && diasDesdeÚltimaCita > promedioDías) {
        pendientes.push({
          nombre: nombre,
          teléfono: teléfono,
          últimaCita: últimaCita,
          diasDesdeÚltimaCita: diasDesdeÚltimaCita,
          promedioDías: promedioDías,
          fila: i + 1
        });
      }
    }

    // Ordenar por más días vencido primero
    pendientes.sort((a, b) => b.diasDesdeÚltimaCita - a.diasDesdeÚltimaCita);

    return pendientes;
  } catch (error) {
    console.error(`[CLIENTES] Error en obtenerClientesPendientes: ${error.message}`);
    return [];
  }
};

/**
 * Genera un mensaje sugerido para enviar a un cliente por WhatsApp.
 * Texto fijo (sin IA) para garantizar que no haya errores ni costo extra.
 */
const generarMensajeSugerido = (cliente) => {
  const nombre = cliente.nombre.split(' ')[0]; // Solo primer nombre
  return `¡Hola ${nombre}! 👋\n\nVimos que hace tiempo no vienes por la barbería. ¿Te gustaría agendar una cita? 💇‍♂️\n\nEstamos pendientes de ti.`;
};

/**
 * Obtiene un resumen formateado de clientes para el mensaje matutino.
 * Muestra máximo 5 clientes para no saturar el mensaje.
 */
const obtenerResumenClientesPendientes = () => {
  try {
    const pendientes = obtenerClientesPendientes();

    if (pendientes.length === 0) {
      return "✅ Todos tus clientes están al día — no hay nadie que recuperar ahora.";
    }

    let resumen = `⚠️ ${pendientes.length} cliente${pendientes.length !== 1 ? 's' : ''} que deberían volver:\n\n`;

    const mostrar = pendientes.slice(0, 5);
    mostrar.forEach((cliente, idx) => {
      resumen += `${idx + 1}. *${cliente.nombre}* (${cliente.diasDesdeÚltimaCita} días sin venir)\n`;
      resumen += `   📱 ${cliente.teléfono || 'Sin teléfono'}\n`;
      resumen += `   Mensaje sugerido: "${generarMensajeSugerido(cliente)}"\n\n`;
    });

    if (pendientes.length > 5) {
      resumen += `... y ${pendientes.length - 5} más.`;
    }

    return resumen;
  } catch (error) {
    console.error(`[CLIENTES] Error en obtenerResumenClientesPendientes: ${error.message}`);
    return "No pude traer la lista de clientes ahora.";
  }
};

/**
 * Marca que se contactó a un cliente hoy.
 * Escribe la fecha actual en columna última_contactación.
 */
const marcarClienteContactado = (nombreCliente) => {
  try {
    const sheet = _getClientesSheet();
    const data = sheet.getDataRange().getValues();
    const hoy = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago' });

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === nombreCliente) {
        sheet.getRange(i + 1, 6).setValue(hoy);
        console.log(`[CLIENTES] ${nombreCliente} marcado como contactado en ${hoy}`);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error(`[CLIENTES] Error en marcarClienteContactado: ${error.message}`);
    return false;
  }
};

/**
 * Procesa la confirmación de Jorge de que contactó a los clientes pendientes.
 * Marca todos los pendientes actuales como contactados hoy.
 */
const procesarContactosConfirmados = (chatId) => {
  try {
    const pendientes = obtenerClientesPendientes();

    if (pendientes.length === 0) {
      sendTelegramMessage(chatId, "✅ Genial jefe, pero no tenías clientes pendientes de recuperar hoy.");
      return;
    }

    let marcados = 0;
    pendientes.forEach(cliente => {
      if (marcarClienteContactado(cliente.nombre)) {
        marcados++;
      }
    });

    const mensajeConfirmacion = `✅ Perfecto jefe! Marqué a ${marcados} cliente${marcados !== 1 ? 's' : ''} como contactados hoy. Mañana no te los vuelvo a mostrar.`;
    sendTelegramMessage(chatId, mensajeConfirmacion);

    console.log(`[CLIENTES] ${marcados} clientes marcados como contactados`);
  } catch (error) {
    console.error(`[CLIENTES] Error en procesarContactosConfirmados: ${error.message}`);
    sendTelegramMessage(chatId, "❌ Ocurrió un error al guardar tu confirmación. Inténtalo de nuevo.");
  }
};

/**
 * Carga la hoja Clientes desde el CSV pre-procesado generado por scripts/procesar_clientes.js.
 * Este CSV ya tiene los promedios REALES calculados desde el historial de citas.
 *
 * Formato del CSV esperado (generado por el script local):
 *   nombre,telefono,primera_cita,ultima_cita,promedio_dias
 *
 * Limpia todos los datos existentes antes de cargar.
 */
const inicializarClientesDesdeCSVProcesado = (csvData) => {
  try {
    const sheet = _getClientesSheet();

    // Limpiar datos existentes (mantener el header en fila 1)
    const ultimaFila = sheet.getLastRow();
    if (ultimaFila > 1) {
      sheet.getRange(2, 1, ultimaFila - 1, 6).clearContent();
      console.log(`[CLIENTES] Limpiados ${ultimaFila - 1} registros existentes.`);
    }

    const lineas = csvData.split('\n').filter(l => l.trim());
    let cargados = 0;
    let saltados = 0;

    // Saltamos el header (fila 0)
    for (let i = 1; i < lineas.length; i++) {
      const campos = _parsearCSVLinea(lineas[i]);
      const nombre = campos[0] ? campos[0].trim() : '';

      if (!nombre) { saltados++; continue; }

      const telefono   = campos[1] ? campos[1].trim() : '';
      const primeraCita = campos[2] ? campos[2].trim() : '';
      const ultimaCita  = campos[3] ? campos[3].trim() : '';
      const promedioDias = campos[4] ? parseInt(campos[4].trim()) || '' : '';

      // Columnas del sheet: nombre, teléfono, última_cita, primera_cita, promedio_días, última_contactación
      sheet.appendRow([nombre, telefono, ultimaCita, primeraCita, promedioDias, '']);
      cargados++;
    }

    console.log(`[CLIENTES] Carga completada: ${cargados} clientes cargados, ${saltados} saltados.`);
    return cargados;
  } catch (error) {
    console.error(`[CLIENTES] Error en inicializarClientesDesdeCSVProcesado: ${error.message}`);
    throw error;
  }
};

/**
 * Busca un cliente en la hoja Clientes por nombre.
 * Soporta coincidencia exacta, parcial y devuelve ambigüedad si hay varios.
 *
 * Retorna:
 *   { encontrado, ambiguo, nombre, telefono, fila, candidatos }
 */
const _buscarCliente = (nombreBuscado) => {
  const SIN_RESULTADO = { encontrado: false, ambiguo: false, nombre: '', telefono: '', fila: -1, candidatos: [] };

  try {
    if (!nombreBuscado) return SIN_RESULTADO;

    const sheet   = _getClientesSheet();
    const data    = sheet.getDataRange().getValues();
    const busqueda = _normalizar(nombreBuscado);

    const exactos   = [];
    const parciales = [];

    for (let i = 1; i < data.length; i++) {
      const nombre = _normalizar((data[i][0] || '').toString());
      if (!nombre) continue;

      const entry = { fila: i + 1, nombre: data[i][0], telefono: data[i][1] };

      if (nombre === busqueda) {
        exactos.push(entry);
      } else if (nombre.includes(busqueda) || busqueda.includes(nombre)) {
        parciales.push(entry);
      }
    }

    // Priorizar coincidencias exactas
    const candidatos = exactos.length > 0 ? exactos : parciales;

    if (candidatos.length === 0) return SIN_RESULTADO;

    if (candidatos.length === 1) {
      return { encontrado: true, ambiguo: false, candidatos: [], ...candidatos[0] };
    }

    // Múltiples exactos: preferir el que tiene teléfono
    if (exactos.length > 1) {
      const conTel = exactos.filter(c => c.telefono);
      if (conTel.length === 1) {
        return { encontrado: true, ambiguo: false, candidatos: [], ...conTel[0] };
      }
    }

    // Ambigüedad real: reportar candidatos para que el bot pregunte
    return { encontrado: true, ambiguo: true, candidatos, nombre: '', telefono: '', fila: -1 };

  } catch (e) {
    console.error('[CLIENTES] Error en _buscarCliente: ' + e.message);
    return SIN_RESULTADO;
  }
};

/**
 * Actualiza la columna "última_cita" de un cliente en la hoja Clientes.
 * filaHint: número de fila conocido (para evitar re-buscar). Puede ser null.
 */
const _actualizarUltimaCita = (nombreCliente, fecha, filaHint) => {
  try {
    const sheet = _getClientesSheet();
    let fila = filaHint;

    if (!fila || fila < 1) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if ((data[i][0] || '').toString().toLowerCase().trim() === nombreCliente.toLowerCase().trim()) {
          fila = i + 1;
          break;
        }
      }
    }

    if (fila && fila > 1) {
      sheet.getRange(fila, 3).setValue(fecha); // Col 3 = última_cita
      console.log(`[CLIENTES] última_cita actualizada para ${nombreCliente}: ${fecha}`);
    } else {
      console.warn(`[CLIENTES] No se encontró fila para actualizar última_cita de ${nombreCliente}`);
    }
  } catch (e) {
    console.error('[CLIENTES] Error en _actualizarUltimaCita: ' + e.message);
  }
};

/**
 * TEST: Ver clientes pendientes en consola
 */
const test_VerPendientes = () => {
  console.log("--- Clientes pendientes ---");
  const pendientes = obtenerClientesPendientes();
  console.log(`Total: ${pendientes.length}`);
  console.log(JSON.stringify(pendientes, null, 2));
};

/**
 * TEST: Carga los clientes desde el CSV pre-procesado con promedios REALES.
 *
 * INSTRUCCIONES:
 *   1. Ejecuta `node scripts/procesar_clientes.js` en tu terminal local
 *   2. Abre el archivo generado: data/clientes_procesados.csv
 *   3. Copia TODO su contenido y pégalo entre los backticks de csvData
 *   4. Ejecuta esta función en el editor de GAS
 */
const test_CargarClientesProcesados = () => {
  console.log("--- Iniciando carga de clientes (con promedios reales) ---");

  // PEGA EL CONTENIDO DE data/clientes_procesados.csv AQUÍ:
  const csvData = `REEMPLAZAR_CON_CONTENIDO_DE_clientes_procesados.csv`;

  if (csvData.startsWith('REEMPLAZAR')) {
    console.error("[CLIENTES] Debes pegar el contenido del CSV antes de ejecutar.");
    return;
  }

  const total = inicializarClientesDesdeCSVProcesado(csvData);
  console.log(`--- Fin de carga: ${total} clientes cargados ---`);
};

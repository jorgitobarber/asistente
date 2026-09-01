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
 * Convierte un string de fecha en formato "01 Jun 2026, 12:00am" a objeto Date
 */
const _parsearFecha = (fechaStr) => {
  if (!fechaStr || typeof fechaStr !== 'string') return null;
  
  const meses = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
    'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };
  
  // Formato esperado: "01 Jun 2026, 12:00am"
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
 * Inicializa la hoja Clientes desde un CSV de datos de Fresha
 * Se llama UNA SOLA VEZ para cargar el historial inicial
 */
const inicializarClientesDesdeFresha = (datosCSV) => {
  try {
    const sheet = _getClientesSheet();
    const lineas = datosCSV.split('\n').filter(l => l.trim());
    
    // Saltamos el header
    for (let i = 1; i < lineas.length; i++) {
      const campos = lineas[i].split(',');
      const nombre = campos[0] ? campos[0].trim() : '';
      const teléfono = campos[3] ? campos[3].trim() : '';
      const últimaCita = campos[7] ? campos[7].trim() : '';
      const primeraCita = campos[6] ? campos[6].trim() : '';
      
      if (!nombre) continue;
      
      sheet.appendRow([nombre, teléfono, últimaCita, primeraCita, '', '']);
    }
    
    console.log(`[CLIENTES] Inicialización completada: ${lineas.length - 1} clientes cargados`);
  } catch (error) {
    console.error(`[CLIENTES] Error en inicialización: ${error.message}`);
    throw error;
  }
};

/**
 * Calcula el promedio de días entre citas para un cliente
 * Basado en su primera y última cita
 */
const _calcularPromedioCliente = (primeraCita, últimaCita) => {
  const f1 = _parsearFecha(primeraCita);
  const f2 = _parsearFecha(últimaCita);
  
  if (!f1 || !f2) return null;
  
  const diasTotales = _calcularDías(f1, f2);
  // Asumimos que si visitó al menos 2 veces, el promedio es días / (número de visitas - 1)
  // Por ahora usamos una heurística simple: si tiene historial de 2+ visitas, 
  // el promedio es approx 30 días (barbería típica).
  // Esto se puede refinar en el futuro si tenemos más datos.
  
  if (diasTotales < 7) return 7; // Muy reciente, muy nuevo
  if (diasTotales < 30) return 14; // Habitual frecuente
  return 30; // Cliente estándar cada ~mes
};

/**
 * Obtiene la lista de clientes que deberían volver
 * Retorna: [{nombre, teléfono, últimaCita, diasDesdeÚltimaCita, promedioDías}, ...]
 */
const obtenerClientesPendientes = () => {
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
      
      if (!nombre || !últimaCita) continue;
      
      const fechaÚltimaCita = _parsearFecha(últimaCita);
      if (!fechaÚltimaCita) continue;
      
      const diasDesdeÚltimaCita = _calcularDías(fechaÚltimaCita, hoy);
      let promedioDías = data[i][4] ? parseInt(data[i][4]) : null;
      
      // Si no tiene promedio calculado, lo calculamos
      if (!promedioDías) {
        promedioDías = _calcularPromedioCliente(primeraCita, últimaCita);
        if (promedioDías) {
          sheet.getRange(i + 1, 5).setValue(promedioDías);
        }
      }
      
      // Si está vencido (última cita fue hace más de su promedio)
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
    
    // Ordenar por más días vencido
    pendientes.sort((a, b) => b.diasDesdeÚltimaCita - a.diasDesdeÚltimaCita);
    
    return pendientes;
  } catch (error) {
    console.error(`[CLIENTES] Error en obtenerClientesPendientes: ${error.message}`);
    return [];
  }
};

/**
 * Genera un mensaje sugerido para enviar a un cliente por WhatsApp
 */
const generarMensajeSugerido = (cliente) => {
  const nombre = cliente.nombre.split(' ')[0]; // Solo primer nombre
  const mensaje = `¡Hola ${nombre}! 👋\n\nVimos que hace tiempo no vienes por la barbería. ¿Te gustaría agendar una cita? 💇‍♂️\n\nEstamos pendientes de ti.`;
  return mensaje;
};

/**
 * Obtiene un resumen formateado de clientes para enviar en el mensaje matutino
 * Retorna un string listo para incluir en Telegram
 */
const obtenerResumenClientesPendientes = () => {
  try {
    const pendientes = obtenerClientesPendientes();
    
    if (pendientes.length === 0) {
      return "✅ Todos tus clientes están al día — no hay nadie que recuperar ahora.";
    }
    
    let resumen = `⚠️ ${pendientes.length} cliente${pendientes.length !== 1 ? 's' : ''} que deberían volver:\n\n`;
    
    // Mostrar máximo 5 clientes para no saturar
    const mostrar = pendientes.slice(0, 5);
    mostrar.forEach((cliente, idx) => {
      resumen += `${idx + 1}. *${cliente.nombre}* (${cliente.diasDesdeÚltimaCita} días sin venir)\n`;
      resumen += `   Sugerencia: "${generarMensajeSugerido(cliente)}"\n\n`;
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
 * Marca que se contactó a un cliente (para no insistir tan seguido)
 * Se llama después de que confirmes que mandaste el mensaje
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
 * Función de prueba para cargar datos desde CSV
 * SOLO EJECUTAR UNA VEZ al inicio
 */
const test_CargarClientes = () => {
  console.log("--- Iniciando carga de clientes ---");
  
  // Este es un fragmento del CSV para prueba — en tu caso, cópiate TODA la data
  const csvData = `Cliente,Género,Edad,Número de teléfono móvil,Email,Añadido el,Primera cita,Última cita,Saldo de puntos de fidelidad,Nivel de fidelidad,Origen del cliente,Recomendado por,Notas_depuracion
Adrian Jofré,No especificado,,,,"26 Jan 2026, 12:00am","28 Jan 2026, 12:00am","01 Jun 2026, 12:00am",,,Sin cita,,
Agustín A. Venegas,No especificado,,56942539068,agustinsayayin@hotmail.com,"08 Dec 2025, 12:00am","22 Dec 2025, 12:00am","03 Aug 2026, 12:00am",,,Instagram,,
Benjamin Herrera,No especificado,,56966815477,benjafhb@gmail.com,"10 Dec 2025, 12:00am","20 Dec 2025, 12:00am","07 Aug 2026, 12:00am",,,Enlace Reservar,,`;
  
  inicializarClientesDesdeFresha(csvData);
  
  console.log("--- Fin de carga ---");
};

/**
 * Prueba para ver la lista de pendientes
 */
const test_VerPendientes = () => {
  console.log("--- Clientes pendientes ---");
  const pendientes = obtenerClientesPendientes();
  console.log(JSON.stringify(pendientes, null, 2));
};

/**
 * Procesa la confirmación de Jorge de que contactó a los clientes
 * Marca todos los pendientes como contactados hoy
 */
const procesarContactosConfirmados = (chatId) => {
  try {
    const pendientes = obtenerClientesPendientes();
    
    if (pendientes.length === 0) {
      sendTelegramMessage(chatId, "✅ Genial jefe, pero no tenías clientes pendientes de recuperar hoy.");
      return;
    }
    
    // Marcar cada uno como contactado
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
    sendTelegramMessage(chatId, "❌ Ocurrió un error al guardar tu confirmación. Intentalo de nuevo.");
  }
};

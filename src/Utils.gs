/**
 * Módulo Utils: Contiene utilidades transversales para el bot.
 * Principalmente maneja la Idempotencia (Cache) para evitar que el bot
 * procese mensajes duplicados si Telegram envía el mismo Webhook varias veces.
 */

const CACHE_EXPIRATION_SECONDS = 3600; // 1 hora de caché para cada ID

/**
 * Verifica si un update_id de Telegram ya fue procesado.
 * Si no existe, lo guarda en caché.
 * 
 * @param {string|number} updateId - El ID único del mensaje de Telegram.
 * @returns {boolean} - Retorna true si el ID es nuevo (y lo guarda). False si ya existe (duplicado).
 */
const isNewTelegramMessage = (updateId) => {
  try {
    if (!updateId) return false;
    
    const cache = CacheService.getScriptCache();
    const cacheKey = `telegram_update_${updateId}`;
    const exists = cache.get(cacheKey);
    
    if (exists) {
      console.log(`[UTILS] Mensaje duplicado detectado: ${updateId}. Ignorando.`);
      return false; 
    }
    
    // Si no existe, lo guardamos para evitar procesarlo en el futuro
    cache.put(cacheKey, 'processed', CACHE_EXPIRATION_SECONDS);
    console.log(`[UTILS] Nuevo mensaje registrado en caché: ${updateId}`);
    return true;
    
  } catch (error) {
    console.error(`[UTILS] Error en isNewTelegramMessage: ${error.message}`);
    // En caso de error de caché, dejamos pasar el mensaje para no bloquear el bot,
    // pero logueamos el error.
    return true; 
  }
};

/**
 * Función de prueba para ejecutar directamente en Apps Script.
 */
const test_Utils = () => {
  console.log("--- Iniciando test_Utils ---");
  const mockUpdateId = "test_id_12345";
  
  // Primera vez debería ser true (nuevo)
  const isNew1 = isNewTelegramMessage(mockUpdateId);
  console.log(`Prueba 1 (Debería ser true): ${isNew1}`);
  
  // Segunda vez debería ser false (ya existe en caché)
  const isNew2 = isNewTelegramMessage(mockUpdateId);
  console.log(`Prueba 2 (Debería ser false): ${isNew2}`);
  
  console.log("--- Fin test_Utils ---");
};

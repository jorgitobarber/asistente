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

// ─── Clima ────────────────────────────────────────────────────────────────────

const _descWeatherCode = (code) => {
  if (code === 0)          return '☀️ Soleado';
  if (code <= 3)           return '⛅ Nublado parcial';
  if (code <= 48)          return '☁️ Nublado/Neblina';
  if (code <= 67)          return '🌧️ Lluvia';
  if (code <= 77)          return '❄️ Nieve';
  if (code <= 82)          return '🌦️ Lluvias variables';
  if (code <= 86)          return '🌨️ Nevada';
  return '⛈️ Tormenta';
};

/**
 * Obtiene el clima del día usando Open-Meteo (gratuito, sin API key).
 * Configura CLIMA_LATITUD y CLIMA_LONGITUD en Script Properties para tu ciudad.
 * Default: Santiago de Chile (-33.45, -70.67).
 *
 * @param {boolean} manana - true para mañana, false para hoy
 * @returns {string} Descripción corta: "☀️ Soleado 15°-22°C"
 */
const _obtenerClima = (manana) => {
  try {
    const props = PropertiesService.getScriptProperties();
    const lat   = props.getProperty('CLIMA_LATITUD')  || '-33.45';
    const lon   = props.getProperty('CLIMA_LONGITUD') || '-70.67';

    const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
                 `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,weathercode` +
                 `&timezone=America/Santiago&forecast_days=2`;
    const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

    if (resp.getResponseCode() !== 200) return '';

    const data  = JSON.parse(resp.getContentText());
    const idx   = manana ? 1 : 0;
    const max   = Math.round(data.daily.temperature_2m_max[idx]);
    const min   = Math.round(data.daily.temperature_2m_min[idx]);
    const code  = data.daily.weathercode[idx];
    const precip = parseFloat(data.daily.precipitation_sum[idx] || 0);

    const desc   = _descWeatherCode(code);
    const lluvia = precip > 0.5 ? ` | ${precip.toFixed(1)}mm` : '';
    return `${desc} ${min}°-${max}°C${lluvia}`;
  } catch (e) {
    console.warn('[CLIMA] Error: ' + e.message);
    return '';
  }
};

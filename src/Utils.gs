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

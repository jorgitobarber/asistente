/** Envío con resultado explícito; nunca interpreta un HTTP fallido como entrega. */
const getTelegramToken = () => {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN.');
  return token;
};
const getTelegramApiUrl = () => 'https://api.telegram.org/bot' + getTelegramToken();
const escapeHtml = (t) => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlAPlano = (t) => String(t).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const sendTelegramMessage = (chatId, text, parseMode = 'HTML') => {
  try {
    const url = getTelegramApiUrl() + '/sendMessage';
    let contenido = String(text || '');
    if (!contenido) return { ok: false };
    // Los mensajes largos se separan en texto plano para no cortar etiquetas HTML.
    if (contenido.length > 3500) { contenido = htmlAPlano(contenido); parseMode = null; }
    const partes = [];
    while (contenido.length > 3500) {
      let corte = contenido.lastIndexOf('\n', 3500);
      if (corte < 1000) corte = 3500;
      if (/^[\uDC00-\uDFFF]$/.test(contenido[corte])) corte--;
      partes.push(contenido.slice(0, corte)); contenido = contenido.slice(corte);
    }
    partes.push(contenido);
    for (const parte of partes) {
      const enviar = (modo) => {
        const payload = { chat_id: chatId, text: modo || !parseMode ? parte : htmlAPlano(parte) };
        if (modo) payload.parse_mode = modo;
        const response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
        let body = {};
        try { body = JSON.parse(response.getContentText()); } catch (_) {}
        return { ok: response.getResponseCode() === 200 && body.ok === true, code: response.getResponseCode() };
      };
      let resultado = enviar(parseMode);
      // Un 429/500 no se reenvía inmediatamente: evita tormentas y posibles duplicados.
      if (!resultado.ok && resultado.code === 400 && parseMode) resultado = enviar(null);
      if (!resultado.ok) { console.warn('[TELEGRAM] Entrega no confirmada: HTTP ' + resultado.code); return { ok: false }; }
    }
    return { ok: true };
  } catch (_) { console.warn('[TELEGRAM] Entrega no confirmada.'); return { ok: false }; }
};
const sendErrorAlert = (chatId) => sendTelegramMessage(chatId, '⚠️ No pude completar la operación. Revisa los registros antes de repetirla.');
const configurarWebhook = () => {
  const props = PropertiesService.getScriptProperties(), base = props.getProperty('WEBAPP_URL'), secret = props.getProperty('WEBHOOK_SECRET');
  if (!base || !/^https:\/\//.test(base) || !secret || !props.getProperty('TELEGRAM_CHAT_ID')) throw new Error('Configura WEBAPP_URL, WEBHOOK_SECRET y TELEGRAM_CHAT_ID.');
  const url = base + (base.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(secret);
  const r = UrlFetchApp.fetch(getTelegramApiUrl() + '/setWebhook', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ url, allowed_updates: ['message'], drop_pending_updates: false }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200 || !JSON.parse(r.getContentText()).ok) throw new Error('No se pudo configurar el webhook.');
  return 'Webhook configurado sin descartar mensajes pendientes.';
};

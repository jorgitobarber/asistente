/** Envío con resultado explícito; nunca interpreta un HTTP fallido como entrega. */
const getTelegramToken_ = () => {
  const token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN.');
  return token;
};
const getTelegramApiUrl_ = () => 'https://api.telegram.org/bot' + getTelegramToken_();
const escapeHtml_ = (t) => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const htmlAPlano_ = (t) => String(t).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const sendTelegramMessage_ = (chatId, text, parseMode = 'HTML', progreso = {}) => {
  let entregadas = Number(progreso.desde || 0);
  try {
    const url = getTelegramApiUrl_() + '/sendMessage';
    let contenido = String(text || '');
    if (!contenido) return { ok: false };
    // Los mensajes largos se separan en texto plano para no cortar etiquetas HTML.
    if (contenido.length > 3500) { contenido = htmlAPlano_(contenido); parseMode = null; }
    const partes = [];
    while (contenido.length > 3500) {
      let corte = contenido.lastIndexOf('\n', 3500);
      if (corte < 1000) corte = 3500;
      if (/^[\uDC00-\uDFFF]$/.test(contenido[corte])) corte--;
      partes.push(contenido.slice(0, corte)); contenido = contenido.slice(corte);
    }
    partes.push(contenido);
    for (let i = entregadas; i < partes.length; i++) {
      const parte = partes[i];
      const enviar = (modo) => {
        const payload = { chat_id: chatId, text: modo || !parseMode ? parte : htmlAPlano_(parte) };
        if (modo) payload.parse_mode = modo;
        const response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true });
        let body = {};
        try { body = JSON.parse(response.getContentText()); } catch (_) {}
        return { ok: response.getResponseCode() === 200 && body.ok === true, code: response.getResponseCode(), retryAfter: Number(body.parameters && body.parameters.retry_after || 0) };
      };
      let resultado = enviar(parseMode);
      // Un 429/500 no se reenvía inmediatamente: evita tormentas y posibles duplicados.
      if (!resultado.ok && resultado.code === 400 && parseMode) resultado = enviar(null);
      if (!resultado.ok) { console.warn('[TELEGRAM] Entrega no confirmada: HTTP ' + resultado.code); return { ...resultado, partesEnviadas: entregadas }; }
      entregadas = i + 1;
      if (progreso.confirmar) progreso.confirmar(entregadas);
    }
    return { ok: true, partesEnviadas: entregadas };
  } catch (_) { console.warn('[TELEGRAM] Entrega no confirmada.'); return { ok: false, partesEnviadas: entregadas }; }
};

/** Persiste cada parte confirmada para no reenviarla si falla una parte posterior. */
const entregarRespuesta_ = (s, fila, owner) => {
  const r = s.getRange(fila, 1, 1, 8).getValues()[0];
  const intentos = Number(r[6] || 0) + 1;
  s.getRange(fila, 7).setValue(intentos);
  const result = sendTelegramMessage_(owner, r[3], 'HTML', {
    desde: Number(r[5] || 0),
    confirmar: n => { s.getRange(fila, 6).setValue(n); SpreadsheetApp.flush(); }
  });
  if (result.ok) s.getRange(fila, 5).setValue('si');
  else {
    s.getRange(fila, 5).setValue(intentos >= 8 ? 'fallido' : 'no');
    const segundos = Math.max(result.retryAfter || 0, Math.min(3600, 300 * Math.pow(2, intentos - 1)));
    s.getRange(fila, 8).setValue(new Date(Date.now() + segundos * 1000));
  }
  return result;
};
const sendErrorAlert_ = (chatId) => sendTelegramMessage_(chatId, '⚠️ No pude completar la operación. Revisa los registros antes de repetirla.');
const configurarWebhook_ = () => {
  const props = PropertiesService.getScriptProperties(), base = props.getProperty('WEBAPP_URL'), secret = props.getProperty('WEBHOOK_SECRET');
  if (!base || !/^https:\/\//.test(base) || !secret || !props.getProperty('TELEGRAM_CHAT_ID')) throw new Error('Configura WEBAPP_URL, WEBHOOK_SECRET y TELEGRAM_CHAT_ID.');
  const url = base + (base.includes('?') ? '&' : '?') + 'secret=' + encodeURIComponent(secret);
  const r = UrlFetchApp.fetch(getTelegramApiUrl_() + '/setWebhook', { method: 'post', contentType: 'application/json', payload: JSON.stringify({ url, allowed_updates: ['message'], drop_pending_updates: false }), muteHttpExceptions: true });
  if (r.getResponseCode() !== 200 || !JSON.parse(r.getContentText()).ok) throw new Error('No se pudo configurar el webhook.');
  return 'Webhook configurado sin descartar mensajes pendientes.';
};

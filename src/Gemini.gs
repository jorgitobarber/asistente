/**
 * Módulo Claude (reemplaza Gemini): Conexión con la API de Anthropic.
 * Mantiene los mismos nombres de funciones públicas para no romper el resto del proyecto.
 */

const getAnthropicApiKey = () => {
  const key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error("Falta configurar ANTHROPIC_API_KEY en las propiedades del script.");
  return key;
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-haiku-4-5";

const _callAnthropicWithRetry = (systemPrompt, userText, maxRetries = 3) => {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': getAnthropicApiKey(),
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }]
    }),
    muteHttpExceptions: true
  };

  let lastError = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = UrlFetchApp.fetch(ANTHROPIC_API_URL, options);
    const code = response.getResponseCode();

    if (code === 200) return response;

    const body = response.getContentText();

    if (code === 429) {
      throw new Error("Límite de quota de Anthropic alcanzado (429). Revisar billing en console.anthropic.com. Detalle: " + body.substring(0, 200));
    }

    if (code === 529 || code === 503) {
      lastError = "Error " + code + " en intento " + (attempt + 1);
      console.warn("[ANTHROPIC] " + lastError);
      if (attempt < maxRetries - 1) {
        Utilities.sleep(Math.pow(2, attempt) * 1500);
      }
      continue;
    }

    throw new Error("Error API Anthropic. Código: " + code + ", Detalle: " + body.substring(0, 300));
  }

  throw new Error("Error API Anthropic tras " + maxRetries + " intentos. Último: " + lastError);
};

const _parseJson = (rawText) => {
  let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first !== -1 && last !== -1) clean = clean.substring(first, last + 1);
  clean = clean.replace(/,\s*([\}\]])/g, '$1');
  try {
    return JSON.parse(clean);
  } catch (e) {
    const reEscaped = clean.replace(/("(?:[^"\\]|\\.)*")|(\n)/g, (m, s) => s ? s : '\\n');
    return JSON.parse(reEscaped);
  }
};

const parseMessageWithGemini = (text) => {
  const hoy = new Date();
  const fechaTexto = hoy.toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  const systemPrompt = `Eres el asistente personal de Jorge (Estudiante de Ingeniería y Dueño de Barbería).
Hoy es ${fechaTexto} (Hora de Chile). Utiliza esta fecha exacta como referencia obligatoria para calcular "hoy", "mañana", "próximo miércoles", etc.

Analiza su mensaje y extrae las acciones necesarias.

Debes devolver UNICAMENTE un JSON válido con esta estructura:
{
  "acciones": [
    { "tipo": "FINANZAS", "subtipo": "GASTO|INGRESO", "monto": 0, "descripcion": "string" },
    { "tipo": "FINANZAS", "subtipo": "CLIENTE_DIA", "servicios": ["Corte", "Corte + Barba", "Perfilado de cejas", "Diseño", "Cera", "Texturizador"], "productos": ["Cera", "Texturizador"], "hora_cita": "HH:MM" },
    { "tipo": "REPORTE", "subtipo": "FINANZAS", "periodo": "DIA|SEMANA|MES", "fecha_inicio": "YYYY-MM-DD", "fecha_fin": "YYYY-MM-DD" },
    { "tipo": "REPORTE", "subtipo": "AGENDA", "periodo": "HOY|MANANA|SEMANA" },
    { "tipo": "TODO", "subtipo": "AGREGAR|COMPLETAR|ELIMINAR|LISTAR", "categoria": "Personal|Universidad|Barberia", "tarea": "string", "periodo": "HOY|MANANA|SEMANA|TODAS" },
    { "tipo": "AGENDA", "subtipo": "CREAR|MODIFICAR|ELIMINAR", "calendario": "BARBERIA|UNIVERSIDAD|COMPROMISOS", "evento": "string", "fecha_estimada": "YYYY-MM-DD", "hora_estimada": "HH:MM", "fecha_original": "YYYY-MM-DD", "hora_original": "HH:MM", "nuevo_evento": "string", "nueva_fecha": "YYYY-MM-DD", "nueva_hora": "HH:MM", "ignorar_choques": true }
  ],
  "respuesta_telegram": "Respuesta natural y amigable confirmando lo que se hará, con emojis. Si la accion es REPORTE->AGENDA, pon solo un mensaje corto tipo 'Dejame revisar tu agenda jefe, un segundo...' porque luego se genera otro mensaje con el detalle."
}

Si no hay acciones, "acciones" debe ser un array vacío.

REGLAS CRITICAS DE JSON:
1. JSON estrictamente válido, sin comas al final.
2. Nunca uses comillas dobles dentro de valores de texto.
3. Sin saltos de línea dentro de strings.`;

  try {
    const response = _callAnthropicWithRetry(systemPrompt, text, 3);
    const data = JSON.parse(response.getContentText());
    const aiText = data.content[0].text;
    const result = _parseJson(aiText);
    console.log("[ANTHROPIC] OK. Acciones: " + (result.acciones ? result.acciones.length : 0));
    return result;
  } catch (error) {
    console.error("[ANTHROPIC] Error en parseMessageWithGemini: " + error.message);
    throw error;
  }
};

const pedirTextoAGeminiSeguro = (prompt, fallback) => {
  if (fallback === undefined) fallback = null;
  try {
    const response = _callAnthropicWithRetry("Eres el asistente personal de Jorge, dueño de barbería y estudiante universitario. Responde siempre en español, de forma amigable y con emojis.", prompt, 2);
    const data = JSON.parse(response.getContentText());
    if (data.content && data.content[0] && data.content[0].text) {
      return data.content[0].text;
    }
    return fallback;
  } catch (e) {
    console.error("[ANTHROPIC] pedirTextoAGeminiSeguro falló: " + e.message);
    return fallback;
  }
};

const test_Claude = () => {
  console.log("--- Iniciando test_Claude ---");
  try {
    const resultado = parseMessageWithGemini("Compré 20 lucas en navajas para la barbería y mañana tengo prueba de Cálculo a las 10am");
    console.log("Resultado:", JSON.stringify(resultado, null, 2));
  } catch (error) {
    console.log("Error:", error.message);
  }
  console.log("--- Fin test_Claude ---");
};

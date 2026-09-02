/**
 * Módulo Gemini: Conexión con la API de Google Gemini Flash.
 * API gratuita vía Google AI Studio (aistudio.google.com) — costo $0.
 * Mantiene los nombres de funciones públicas para no romper el resto del proyecto.
 */

const getGeminiApiKey = () => {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error("Falta configurar GEMINI_API_KEY en las propiedades del script. Obtener en aistudio.google.com");
  return key;
};

const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent";

/**
 * Llama a la API de Gemini con reintentos automáticos ante errores 503/429.
 */
const _callGeminiWithRetry = (systemInstruction, userText, maxRetries) => {
  if (maxRetries === undefined) maxRetries = 3;

  const payload = {
    contents: [{
      parts: [{ text: userText }]
    }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const url = GEMINI_API_URL + "?key=" + getGeminiApiKey();

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();

    if (code === 200) return response;

    if (code === 429 || code === 503) {
      console.warn("[GEMINI] Error " + code + " en intento " + (attempt + 1));
      if (attempt < maxRetries - 1) {
        Utilities.sleep(Math.pow(2, attempt) * 2000);
      }
      continue;
    }

    throw new Error("Error API Gemini. Código: " + code + ", Detalle: " + response.getContentText().substring(0, 300));
  }

  throw new Error("Error API Gemini tras " + maxRetries + " intentos.");
};

/**
 * Limpia y parsea el JSON devuelto por Gemini.
 */
const _parseGeminiJson = (rawText) => {
  let clean = rawText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const first = clean.indexOf('{');
  const last = clean.lastIndexOf('}');
  if (first !== -1 && last !== -1) clean = clean.substring(first, last + 1);
  clean = clean.replace(/,\s*([\}\]])/g, '$1');
  try {
    return JSON.parse(clean);
  } catch (e) {
    const reEscaped = clean.replace(/(\"(?:[^\"\\]|\\.)*\")|(\n)/g, (m, s) => s ? s : '\\n');
    return JSON.parse(reEscaped);
  }
};

/**
 * Procesa el mensaje de Jorge y devuelve un JSON con acciones estructuradas.
 * Esta es la función principal llamada desde Main.gs.
 */
const parseMessageWithGemini = (text) => {
  const hoy = new Date();
  const fechaTexto = hoy.toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  const systemInstruction = `Eres el asistente personal de Jorge (Estudiante de Ingeniería y Dueño de Barbería).
Hoy es ${fechaTexto} (Hora de Chile). Utiliza esta fecha exacta como referencia obligatoria para calcular "hoy", "mañana", "próximo miércoles", etc. Las fechas en las acciones SIEMPRE van en formato YYYY-MM-DD.

Analiza su mensaje y extrae las acciones necesarias.

SERVICIOS DE LA BARBERÍA (normaliza SIEMPRE al nombre canónico exacto):
- "Corte": corte, corte simple, corte de pelo, cortado (precio: $10.000, incluye perfilado de cejas)
- "Corte + Barba": corte y barba, corte con barba, corte barba, corte+barba (precio: $15.000)
- "Diseño": diseño, diseños, diseño de barba (add-on: $1.000, se suma al servicio base)
- "Cera": cera, ceras, cera de pelo (producto: $5.000)
- "Texturizador": texturizador, polvos, polvos texturizadores (producto: $5.000)

Debes devolver UNICAMENTE un JSON válido con esta estructura:
{
  "acciones": [
    { "tipo": "FINANZAS", "subtipo": "GASTO|INGRESO", "monto": 0, "descripcion": "string" },
    { "tipo": "FINANZAS", "subtipo": "CLIENTE_DIA", "servicios": ["Corte", "Corte + Barba"], "productos": ["Cera", "Texturizador"], "hora_cita": "HH:MM" },
    { "tipo": "REPORTE", "subtipo": "FINANZAS", "periodo": "DIA|SEMANA|MES", "fecha_inicio": "YYYY-MM-DD", "fecha_fin": "YYYY-MM-DD" },
    { "tipo": "REPORTE", "subtipo": "AGENDA", "periodo": "HOY|MANANA|SEMANA" },
    { "tipo": "TODO", "subtipo": "AGREGAR|COMPLETAR|ELIMINAR|LISTAR", "categoria": "Personal|Universidad|Barberia", "tarea": "string", "periodo": "HOY|MANANA|SEMANA|TODAS" },
    { "tipo": "AGENDA", "subtipo": "CREAR|MODIFICAR|ELIMINAR", "calendario": "BARBERIA|UNIVERSIDAD|COMPROMISOS", "evento": "string", "fecha_estimada": "YYYY-MM-DD", "hora_estimada": "HH:MM", "fecha_original": "YYYY-MM-DD", "hora_original": "HH:MM", "nuevo_evento": "string", "nueva_fecha": "YYYY-MM-DD", "nueva_hora": "HH:MM", "ignorar_choques": true },
    { "tipo": "CLIENTES", "subtipo": "CONTACTOS_CONFIRMADO" },
    { "tipo": "AGENDAR_CITA", "nombre_cliente": "string", "fecha": "YYYY-MM-DD", "hora": "HH:MM", "servicio": "Corte|Corte + Barba", "add_ons": ["Diseño"] },
    { "tipo": "CONFIRMAR_VISITA", "nombre_cliente": "string", "servicio": "Corte|Corte + Barba", "add_ons": ["Diseño"], "productos": ["Cera", "Texturizador"] },
    { "tipo": "INASISTENCIA", "nombre_cliente": "string" },
    { "tipo": "REAGENDAR_CITA", "nombre_cliente": "string", "nueva_fecha": "YYYY-MM-DD", "nueva_hora": "HH:MM" },
    { "tipo": "VENTA_PRODUCTO", "producto": "Cera|Texturizador", "cantidad": 1, "nombre_cliente": "string opcional" },
    { "tipo": "REABASTECER", "producto": "Cera|Texturizador", "cantidad": 1, "costo_total": 0 }
  ],
  "respuesta_telegram": "Respuesta natural y amigable confirmando lo que se hará, con emojis. Si la accion es REPORTE->AGENDA, pon solo un mensaje corto tipo 'Dejame revisar tu agenda jefe, un segundo...' porque luego se genera otro mensaje con el detalle."
}

Si no hay acciones, "acciones" debe ser un array vacío.

REGLAS CRITICAS DE JSON:
1. JSON estrictamente válido, sin comas al final.
2. Nunca uses comillas dobles dentro de valores de texto.
3. Sin saltos de línea dentro de strings.

DETECTAR ACCIONES DE BARBERÍA:
- "agendó Juan a las 5pm mañana, corte" → AGENDAR_CITA con fecha de mañana
- "ya vino Juan", "llegó Juan", "vino Juan" → CONFIRMAR_VISITA
- "Juan no vino", "Juan faltó", "Juan no llegó" → INASISTENCIA
- "Juan reagendó para el viernes a las 4" → REAGENDAR_CITA
- "contactos hecho", "ya les mandé" → CLIENTES/CONTACTOS_CONFIRMADO

DETECTAR VENTAS DE PRODUCTOS:
- "vendí una cera", "se llevó una cera" (sin corte) → VENTA_PRODUCTO, producto: "Cera", cantidad: 1
- "vendí 2 texturizadores" → VENTA_PRODUCTO, producto: "Texturizador", cantidad: 2
- "juan solo vino por polvos" → VENTA_PRODUCTO, producto: "Texturizador", cantidad: 1, nombre_cliente: "juan"

DETECTAR REABASTECIMIENTO:
- "compré 3 ceras", "compré ceras" → REABASTECER, producto: "Cera", cantidad: 3
- "compré 5 polvos, pagué 12500" → REABASTECER, producto: "Texturizador", cantidad: 5, costo_total: 12500
- "me llegó pedido de 4 ceras a 2500 cada una" → REABASTECER, producto: "Cera", cantidad: 4, costo_total: 10000

DETECTAR PRODUCTOS Y ADD-ONS EN CONFIRMAR_VISITA:
- "ya vino Juan, se llevó cera" → productos: ["Cera"]
- "vino Juan, corte con diseño" → servicio: "Corte", add_ons: ["Diseño"]
- "vino Juan, corte y barba, polvos" → servicio: "Corte + Barba", productos: ["Texturizador"]`;


  try {
    const response = _callGeminiWithRetry(systemInstruction, text, 3);
    const data = JSON.parse(response.getContentText());

    if (!data.candidates || !data.candidates[0]) {
      throw new Error("Gemini no devolvió candidatos: " + response.getContentText().substring(0, 200));
    }

    const aiText = data.candidates[0].content.parts[0].text;
    const result = _parseGeminiJson(aiText);
    console.log("[GEMINI] OK. Acciones: " + (result.acciones ? result.acciones.length : 0));
    return result;
  } catch (error) {
    console.error("[GEMINI] Error en parseMessageWithGemini: " + error.message);
    throw error;
  }
};

/**
 * Pide texto libre a Gemini (para resúmenes matutinos, cierres, reportes).
 * Devuelve el texto o el fallback si falla.
 */
const pedirTextoAGeminiSeguro = (prompt, fallback) => {
  if (fallback === undefined) fallback = null;

  const systemInstruction = "Eres el asistente personal de Jorge, dueño de barbería y estudiante universitario. Responde siempre en español, de forma amigable y con emojis.";

  const payload = {
    contents: [{
      parts: [{ text: prompt }]
    }],
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const url = GEMINI_API_URL + "?key=" + getGeminiApiKey();

  try {
    const response = UrlFetchApp.fetch(url, options);
    const code = response.getResponseCode();

    if (code !== 200) {
      console.error("[GEMINI] pedirTextoAGeminiSeguro error " + code);
      return fallback;
    }

    const data = JSON.parse(response.getContentText());
    if (data.candidates && data.candidates[0] && data.candidates[0].content) {
      return data.candidates[0].content.parts[0].text;
    }
    return fallback;
  } catch (e) {
    console.error("[GEMINI] pedirTextoAGeminiSeguro falló: " + e.message);
    return fallback;
  }
};

/**
 * TEST: Prueba la conexión con Gemini
 */
const test_Gemini = () => {
  console.log("--- Iniciando test_Gemini ---");
  try {
    const mensaje = "Compré 20 lucas en navajas para la barbería y mañana tengo prueba de Cálculo a las 10am";
    const resultado = parseMessageWithGemini(mensaje);
    console.log("Resultado JSON:", JSON.stringify(resultado, null, 2));
  } catch (error) {
    console.log("Error:", error.message);
  }
  console.log("--- Fin test_Gemini ---");
};

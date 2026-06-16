/**
 * Módulo Gemini: Conexión con la API de Google Gemini (Generative AI).
 * Se encarga de procesar el texto libre de Jorge y convertirlo en un JSON estructurado
 * que Apps Script pueda leer, y genera la respuesta natural para Telegram.
 */

/**
 * Retorna la API KEY de Gemini desde PropertiesService
 */
const getGeminiApiKey = () => {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error("Falta configurar GEMINI_API_KEY en las propiedades del script.");
  return key;
};
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";

/**
 * Llama a la API de Gemini para procesar el mensaje de Jorge.
 * 
 * @param {string} text - El mensaje de texto de Jorge.
 * @returns {object} - Un objeto JSON estructurado con las acciones y la respuesta.
 */
const parseMessageWithGemini = (text) => {
  try {
    // Inyectamos la fecha y hora actual para que Gemini sepa en qué día vive
    const hoy = new Date();
    const fechaTexto = hoy.toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    
    const systemInstruction = `
      Eres el asistente personal de Jorge (Estudiante de Ingeniería y Dueño de Barbería).
      Hoy es ${fechaTexto} (Hora de Chile). Utiliza esta fecha exacta como referencia obligatoria para calcular "hoy", "mañana", "próximo miércoles", etc.
      
      Analiza su mensaje y extrae las acciones necesarias.
      
      Debes devolver UNICAMENTE un JSON válido con esta estructura:
      {
        "acciones": [
          { "tipo": "FINANZAS", "subtipo": "GASTO|INGRESO", "monto": 0, "descripcion": "string", "negocio": "BARBERIA|DECANTS" },
          { 
            "tipo": "REPORTE", 
            "subtipo": "FINANZAS", 
            "fecha_inicio": "YYYY-MM-DD", 
            "fecha_fin": "YYYY-MM-DD" 
          },
          { 
            "tipo": "AGENDA", 
            "subtipo": "CREAR|MODIFICAR|ELIMINAR", 
            "calendario": "BARBERIA|UNIVERSIDAD|COMPROMISOS", 
            "evento": "string", 
            "fecha_estimada": "YYYY-MM-DD", 
            "hora_estimada": "HH:MM",
            "nuevo_evento": "string (solo para MODIFICAR si cambia el nombre)",
            "nueva_fecha": "YYYY-MM-DD (solo para MODIFICAR)",
            "nueva_hora": "HH:MM (solo para MODIFICAR)",
            "ignorar_choques": true/false // (true si el usuario indica de cualquier forma natural que quiere agendar a pesar de advertencias o choques, ej: 'dale', 'agéndalo igual', 'no importa')
          }
        ],
        "respuesta_telegram": "Una respuesta muy natural, amigable, de un asistente a su jefe, confirmando TODO lo que se hará, con detalles y emojis. No uses lenguaje de robot."
      }
      
      Si no hay acciones, "acciones" debe ser un array vacío.
    `;

    const payload = {
      contents: [{
        parts: [{ text: text }]
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

    let response;
    let responseCode;
    let retries = 3;
    let attempt = 0;

    while (attempt < retries) {
      response = UrlFetchApp.fetch(`${GEMINI_API_URL}?key=${getGeminiApiKey()}`, options);
      responseCode = response.getResponseCode();
      
      if (responseCode === 200) {
        break; // Éxito
      } else if (responseCode === 503) {
        attempt++;
        console.warn(`[GEMINI] Error 503 (Sobrecarga). Intento ${attempt} de ${retries}...`);
        if (attempt >= retries) {
          throw new Error(`Error API Gemini tras ${retries} intentos. Código: ${responseCode}, Detalle: ${response.getContentText()}`);
        }
        Utilities.sleep(2000 * attempt); // Espera 2s, 4s... antes de reintentar
      } else {
        throw new Error(`Error API Gemini. Código: ${responseCode}, Detalle: ${response.getContentText()}`);
      }
    }

    const data = JSON.parse(response.getContentText());
    if(!data.candidates) throw new Error("Gemini no devolvió texto: " + response.getContentText());
    
    const aiResponseText = data.candidates[0].content.parts[0].text;
    
    // Parseamos la respuesta, quitando el markdown de bloque de código que Gemini suele agregar
    const cleanJsonText = aiResponseText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const resultJson = JSON.parse(cleanJsonText);
    
    console.log(`[GEMINI] Procesado exitosamente. Acciones detectadas: ${resultJson.acciones.length}`);
    return resultJson;

  } catch (error) {
    console.error(`[GEMINI] Error en parseMessageWithGemini: ${error.message}`);
    throw error; // Lanzamos el error para que lo atrape Main.gs y avise por Telegram
  }
};

/**
 * Función de prueba local
 */
const test_Gemini = () => {
  console.log("--- Iniciando test_Gemini ---");
  // Esta prueba fallará por no tener API KEY, pero demostramos que el try/catch funciona
  try {
    const mensaje = "Compré 20 lucas en navajas para la barbería y mañana tengo prueba de Cálculo a las 10am";
    const resultado = parseMessageWithGemini(mensaje);
    console.log("Resultado JSON:", JSON.stringify(resultado, null, 2));
  } catch (error) {
    console.log("Prueba capturó error esperado (Falta API KEY):", error.message);
  }
  console.log("--- Fin test_Gemini ---");
};

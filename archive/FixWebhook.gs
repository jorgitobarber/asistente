/**
 * Función de autodiagnóstico y reparación creada por tu Tech Lead.
 * Esto forzará que tu Webhook use la versión correcta del código que acabamos de publicar.
 */
function REPARAR_BOT() {
  const deploymentId = "AKfycbxHJL7jBBPBF24bbSKn_UUaCCKVhE5Y9fCjvgfmWevvG6ULmAURz1BQnZpxFe0gKocK";
  const nuevaUrl = "https://script.google.com/macros/s/" + deploymentId + "/exec";
  
  // 1. Guardar la nueva URL en las propiedades del script
  PropertiesService.getScriptProperties().setProperty('WEBAPP_URL', nuevaUrl);
  console.log("✅ Nueva WEBAPP_URL guardada: " + nuevaUrl);
  
  // 2. Ejecutar la configuración del webhook
  configurarWebhook();
  console.log("✅ Webhook reconfigurado en Telegram exitosamente. El bot ya debería estar listo.");
}

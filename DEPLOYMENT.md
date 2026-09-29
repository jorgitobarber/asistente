# Publicación y recuperación — asistente personal

## Estado al 29-09-2026

- Rama de trabajo: codex/asistente-personal, basada en 2da9df5.
- Se actualizó la referencia de origin y no aparecieron cambios remotos distintos del punto de partida.
- Se consultaron despliegues. El ID referenciado por el diagnóstico antiguo apunta a versión 48. Eso NO confirma que Telegram use esa URL actualmente.
- Se descargó HEAD remoto a `.local-backup/remote-head/src`; sus 17 archivos coinciden con la base Git tras normalizar saltos de línea. El respaldo está excluido de Git.
- No se consultaron propiedades secretas, hojas reales ni triggers activos. No se envió ningún mensaje, ni se modificó el webhook, ni se hizo push/deploy a Google.
- Las pruebas locales usan simulaciones. Falta la validación de integración descrita abajo.

## Antes de publicar

1. Revisar el diff y ejecutar `node --test tests/bot.test.cjs`.
2. Guardar una copia completa del spreadsheet y los IDs de los calendarios. No pegar tokens ni enlaces con secretos en Git o chats.
3. Confirmar en el editor de Apps Script los triggers activos y Script Properties. Verificar TELEGRAM_CHAT_ID y TELEGRAM_USER_ID (si se usa) con el chat privado del dueño.
4. Consultar getWebhookInfo con el token de forma privada para identificar el despliegue efectivo. Registrar solo ID/versión, sin la URL con secreto. No ejecutar RESET_COMPLETO ni herramientas archivadas.
5. Crear una copia separada de Apps Script, hoja y calendarios para probar. Configurar un bot de prueba o probar funciones desde su editor. No redirigir el bot productivo a la copia.
6. Publicar código en la copia; ejecutar `diagnosticoPersonal()`, `prepararDatosPersonales()` y revisar respaldos/columnas. El diagnóstico no imprime secretos.
7. Verificar el modelo indicado en GEMINI_MODEL y sus límites en la cuenta. No se ha hecho una llamada real al modelo durante el desarrollo.
8. Probar: gasto sin ámbito y aclaración, corrección de monto, anulación, movimiento antiguo por ID, tareas similares, cambio de fecha, choque de agenda, evento de día completo, recordatorio y sus reintentos. Revisar que reportes y resúmenes omiten los clientes.

## Publicación en el proyecto real

Con la versión revisada y la comprobación de integración terminada:

1. Realizar un respaldo actualizado de código y spreadsheet.
2. Publicar el código con clasp push (esto modifica HEAD remoto; por sí solo no actualiza una versión desplegada).
3. Ejecutar `diagnosticoPersonal()` y `prepararDatosPersonales()` en el proyecto real, revisando resultados. Si falla un esquema, detener y revisar sin borrar hojas.
4. Revisar y reemplazar los tres triggers mediante `configurarTriggers()`. Los triggers usan HEAD, por lo que el cambio de código puede afectar automatizaciones antes de cambiar el webhook. Hacer la transición en una ventana controlada.
5. Crear una versión y actualizar el despliegue confirmado del webhook; conservar su URL. Configurar WEBAPP_URL y WEBHOOK_SECRET y ejecutar configurarWebhook solo si es necesario. No descartar la cola de Telegram.
6. Revisar `/ayuda`, un gasto controlado y un recordatorio. Anular el gasto de prueba conservando historial.
7. Comprobar horarios y envío del primer resumen. No afirmar que todo funciona solo porque el despliegue terminó.

## Recuperación

- Antes de revertir, preservar todos los movimientos V3 que llegaron después del respaldo.
- Volver el despliegue web a la versión anterior confirmada.
- Restaurar también HEAD y los triggers si se necesita revertir las automatizaciones: cambiar solo la versión web no revierte los triggers.
- El código V2 ignora estados ANULADO e incluye históricos financieros con otras reglas. No usarlo para balances sobre hojas V3 sin adaptar o restaurar una copia conciliada. No sobrescribir datos nuevos ciegamente con el respaldo.
- El diagnóstico antiguo contiene utilidades destructivas y cambios de webhook; no utilizarlas como recuperación genérica.

## GitHub

Repositorio existente: https://github.com/jorgitobarber/asistente

GitHub conserva código, documentación y pruebas. El editor usado antes no limita el trabajo actual. Un commit guarda un punto local; push sube una rama; un Pull Request permite revisar; merge incorpora los cambios. Ninguno de esos pasos publica por sí solo el bot de Apps Script.

Publicación de la rama cuando Jorge lo decida: `git push -u origin codex/asistente-personal`. Después abrir un Pull Request; no mezclar en main sin autorización. No subir CSV, respaldos, credenciales ni datos de clientes. La base ya incluye módulos históricos: evitar añadir exportaciones o datos personales nuevos.

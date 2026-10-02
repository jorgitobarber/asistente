# Publicación y recuperación del asistente personal

## Reparación del 02-10-2026

Proyecto: Motor Bot Jorge. Rama: codex/reparar-bot-funcional.

El diagnóstico confirmó que Telegram no tenía webhook. La publicación seguía en V2, aunque el asistente personal V3 ya estaba preparado localmente. Se descargaron HEAD y versión 48 en .local-backup/diagnostico-2026-10-02 antes de modificar el proyecto.

La instalación hizo una copia completa de finanzas mediante Spreadsheet.copy, guardó su ID únicamente en RESPALDO_REPARACION_20261002 y creó respaldos de hojas antes de ampliar esquemas. Conservó los gastos existentes, reparó filas antiguas desalineadas y asignó IDs estables. Conservó las hojas de clientes. Se instalaron tres activadores: enviarResumenMatutino_, enviarCierreDiario_ y procesarRecordatorios_.

La publicación conserva la dirección existente. TELEGRAM_USER_ID y un secreto de entrada quedaron configurados; el webhook se conectó sin descartar mensajes pendientes. Jorge confirmó que /ayuda volvió a responder. Las publicaciones web históricas también se actualizaron al código protegido, sin borrar sus IDs. La publicación sin entradas y el despliegue de desarrollo HEAD se conservaron.

La prueba real detectó que Gemini devolvía accion en lugar de tipo. Se agregó un ejemplo explícito y una adaptación acotada de accion a tipo; no altera montos ni datos de negocio. Si ambos campos se contradicen o falta el tipo, rechaza la respuesta antes de escribir. Se conserva JSON estándar y validación local. Ante fallos 503 repetidos de Gemini 3.8 se seleccionó Gemini 2.5 Flash, disponible en la misma cuenta, sin razonamiento para solicitudes breves. Se conservan los códigos de fallos de Google; /ayuda funciona sin IA.

## Procedimiento para próximas publicaciones

1. Ejecutar las pruebas locales: node --test tests/bot.test.cjs. En el entorno restringido se puede usar node --test --test-isolation=none tests/bot.test.cjs.
2. Respaldar código, configuración de publicaciones y spreadsheet completo. No subir credenciales, CSV, datos personales ni .local-backup a Git.
3. Revisar cambios remotos y preservar mejoras antes de sustituir módulos. Citas de origin/main 1a18293 está conservado en archive/v2-remota-1a18293; las citas y ventas de clientes se gestionan en Fresha según el alcance personal aprobado.
4. Cargar HEAD con clasp push. Los activadores usan HEAD: coordinar su preparación inmediatamente. Las funciones auxiliares terminan en guion bajo y no se exponen a google.script.run.
5. Para operar desde el editor, usar una envoltura temporal del propietario. Retirarla antes de crear una versión; jamás incluirla en una publicación pública. instalarBot_ respalda y prepara; conectarBot_ conecta; probarBot_ crea registros sintéticos identificables y revierte el efecto financiero; diagnosticoPersonal_ informa conexiones sin claves.
6. Crear una versión sin envolturas. Actualizar el despliegue existente, conservar su URL y comprobar getWebhookInfo. No usar RESET_COMPLETO ni drop_pending_updates:true.
7. Comprobar una solicitud real, interpretación, registro/anulación, tareas, calendarios y entrega automática de recordatorio. Una ejecución terminada no demuestra entrega: verificar confirmado en Telegram o estado enviado.

## Recuperación

Preservar los movimientos que llegaron después del respaldo. Revertir publicación, HEAD y activadores de forma coordinada; cambiar solo la versión web no revierte las tareas automáticas. El código V2 ignora estados ANULADO, por lo que no debe volver a calcular saldos sobre datos V3 sin adaptar o conciliar. No sobrescribir datos nuevos con el respaldo.

GitHub conserva código y revisión; push o merge no publica Apps Script. No mezclar main sin autorización. Diario y respaldos deben permanecer privados. El diario crece con el uso; requiere archivo si aumenta mucho el volumen. Los recordatorios se revisan cada cinco minutos y los resúmenes de 07:30/22:30 son aproximados. Los límites y disponibilidad de Google siguen siendo externos.

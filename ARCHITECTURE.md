# Asistente personal — V3

Diseño aprobado por Jorge el 29 de septiembre de 2026. Implementación local pendiente de validación en Google y publicación.

## Alcance

Telegram es la entrada para gastos personales y de barbería, ingresos manuales, tareas con vencimiento, agenda universitaria/personal y recordatorios. Fresha conserva clientes, reservas, visitas, ventas e inventario. Alimentación queda fuera de esta versión. Los balances completos y la depuración de clientes se realizan aparte con exportaciones.

## Flujo

1. `Main.gs` valida secreto obligatorio, chat privado y remitente autorizado.
2. Adquiere un bloqueo de script y consulta `Bot_Updates` por update_id.
3. Guarda la solicitud como procesando antes de ejecutar efectos externos.
4. Gemini interpreta el texto y un contexto de 30 minutos; los módulos validan los datos.
5. Ejecuta acciones secuenciales. Si falta un dato, guarda la acción pendiente y el resto de la cola. Un error detiene las acciones posteriores.
6. Guarda el resultado antes de enviarlo. Un duplicado puede reintentar la respuesta, pero nunca las operaciones.
7. El trigger de recordatorios reintenta hasta cinco respuestas pendientes por ejecución.

Si una ejecución se interrumpe entre escritura y confirmación, queda para revisión y no se vuelve a ejecutar automáticamente. No hay transacciones distribuidas entre Sheets, Calendar y Telegram; tampoco se garantiza entrega exactamente una vez si Telegram recibe un mensaje pero se pierde la respuesta HTTP. El bloqueo evita carreras entre webhook, recordatorios y resúmenes.

## Módulos activos

- `Base.gs`: fechas explícitas America/Santiago, validación, extensión segura de esquemas, contexto y rangos.
- `Main.gs`: autenticación, diario durable y enrutamiento personal.
- `Gemini.gs`: interpretación estructurada y reintentos limitados; no calcula balances ni redacta resúmenes.
- `Finanzas.gs`: movimientos positivos, ámbitos, correcciones por ID, anulaciones y reportes.
- `ToDo.gs`: tareas con IDs, fechas límite y estados; selección ambigua rechazada.
- `Agenda.gs`: únicamente Universidad y Compromisos; mantiene duración y comprueba choques al mover.
- `Recordatorios.gs`: avisos cada cinco minutos, fechas heredadas normalizadas y entrega confirmada.
- `Notificaciones.gs`: resúmenes sin IA, reportes personales y configuración selectiva de triggers.
- `Telegram.gs`: HTML escapado, división de mensajes largos y resultado explícito de envío.
- `Preparacion.gs`: diagnóstico de solo lectura y migración aditiva manual.
- `Utils.gs`: clima opcional.

`archive/v2-preservada/` conserva los módulos retirados, incluyendo herramientas de limpieza y reparación. Está fuera de `src`, por lo que clasp no los publica. No ejecutar esas herramientas sobre datos V3.

## Datos y compatibilidad

Se conservan las columnas iniciales de Gastos, Ingresos, To_Do y Recordatorios. Las nuevas columnas se añaden al final. Antes de ampliar una hoja existente se crea `Respaldo_v3_<nombre>`. Un esquema inesperado aborta; el esquema antiguo de Gastos con cuatro columnas necesita revisión manual, nunca borrado automático.

- Gastos: fecha, hora, categoría, descripción, monto, id, ambito, estado, creado_en, actualizado_en, origen.
- Ingresos: fecha, hora, descripción, monto, id, ambito, estado, creado_en, actualizado_en, origen.
- To_Do: fecha_creación, categoría, tarea, estado, fecha_completada, id, fecha_limite, actualizado_en.
- Recordatorios: fecha_creacion, fecha_aviso, hora_aviso, mensaje, estado, chat_id, id, enviado_en, intentos.
- Bot_Updates: update_id, fecha, estado, respuesta, enviado.

Los registros nuevos usan IDs y origen BOT_MANUAL; no se reclasifica el histórico. Ámbito desconocido se informa SIN_CLASIFICAR. Anular un movimiento conserva la fila con estado ANULADO. El reporte no incluye Historial_Visitas ni se presenta como utilidad del negocio. Los ingresos antiguos pueden contener ventas: se mantienen separados por su ámbito sin clasificar hasta revisión.

`prepararDatosPersonales()` asigna IDs faltantes al histórico, después de validar esquemas y respaldar. Es repetible y no cambia montos, nombres ni categorías. Las consultas históricas admiten objetos Date, YYYY-MM-DD y fechas día/mes/año con / o -.

## Contexto y correcciones

Script Properties conserva último ID y solicitud pendiente durante 30 minutos. El contexto se limita a 8 KB. Una respuesta corta completa los campos de la acción pendiente; no puede cambiar el tipo ni el ID. Las demás acciones esperan. Se puede cancelar toda la solicitud pendiente. Tras expirar, pedir nombre/ID/solicitud completa.

Las correcciones financieras fuera del contexto requieren ID y tipo GASTO/INGRESO; LISTAR muestra IDs. Las tareas aceptan ID o nombre inequívoco. Los eventos aceptan una referencia reciente o nombre/fecha/hora. No existe una confirmación implícita «dale nomás» para choques: se requiere repetir la solicitud completa autorizando ignorarlos.

## Configuración

Obligatorias: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (chat privado), WEBHOOK_SECRET, GEMINI_API_KEY, SHEET_ID, CALENDAR_UNI_ID, CALENDAR_COMPROMISOS_ID y WEBAPP_URL.

Opcionales: TELEGRAM_USER_ID (por defecto el ID del chat privado), GEMINI_MODEL (por defecto gemini-3.8-flash), MOSTRAR_CLIMA=true, CLIMA_LATITUD, CLIMA_LONGITUD. Las credenciales viven solo en Script Properties.

Resúmenes alrededor de 07:30 y 22:30 Chile; avisos cada 5 minutos, sin garantía de alarma exacta. `configurarTriggers()` reemplaza solo esos tres handlers. Los calendarios de Fresha no se consultan. La creación sin hora es de día completo; un evento con hora dura 60 minutos si no se indica otra duración.

## Pruebas y límites

Ejecutar `node --test tests/bot.test.cjs`. Pruebas con dobles de Sheets, Calendar, Telegram, Gemini, propiedades y bloqueo. No usan credenciales ni red. Validan lógica local, no permisos reales, cuotas, interpretación del modelo ni entrega en producción.

El diario de actualizaciones crece con el uso y se lee completo; adecuado inicialmente para un usuario, requiere política de archivo si aumenta el volumen. Los registros de respuesta contienen datos personales y deben permanecer privados en Sheets. Los respaldos son copias únicas previas a la migración; para despliegues posteriores hacer un respaldo completo adicional.

Ver `DEPLOYMENT.md` antes de publicar.

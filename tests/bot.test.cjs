const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const state = { sheets: {}, props: { SHEET_ID: 'test', WEBHOOK_SECRET: 'secret', TELEGRAM_CHAT_ID: '42', TELEGRAM_BOT_TOKEN: 'fake', GEMINI_API_KEY: 'fake', CALENDAR_UNI_ID: 'uni', CALENDAR_COMPROMISOS_ID: 'personal' }, fetches: [], calls: 0, actions: [], delivery: true, locked: false, triggers: [] };
  let uuid = 0;
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; state.sheets[name] = this; }
    appendRow(row) { this.rows.push([...row]); return this; }
    getLastRow() { return this.rows.length; }
    getLastColumn() { return Math.max(0, ...this.rows.map(r => r.length)); }
    getMaxColumns() { return 26; }
    getDataRange() { return this.getRange(1, 1, Math.max(1, this.rows.length), Math.max(1, this.getLastColumn())); }
    getRange(row, col, n = 1, m = 1) {
      return {
        getValues: () => Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => this.rows[row + i - 1]?.[col + j - 1] ?? '')),
        setValue: v => this.getRange(row, col).setValues([[v]]),
        setValues: values => { values.forEach((r, i) => r.forEach((v, j) => { this.rows[row + i - 1] ??= []; this.rows[row + i - 1][col + j - 1] = v; })); }
      };
    }
    copyTo() { const s = new Sheet('copy_' + this.name); s.rows = this.rows.map(r => [...r]); return s; }
    setName(name) { delete state.sheets[this.name]; this.name = name; state.sheets[name] = this; return this; }
    insertColumnsAfter() {}
  }
  const parts = (date, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  const format = (d, tz, pattern) => {
    const p = parts(d, tz);
    return pattern.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  };
  const parse = (str, tz) => {
    const [y, m, d, h, min] = str.match(/\d+/g).map(Number);
    const target = Date.UTC(y, m - 1, d, h, min);
    let stamp = target;
    for (let i = 0; i < 4; i++) {
      const p = parts(new Date(stamp), tz);
      stamp += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    }
    return new Date(stamp);
  };
  class Event {
    constructor(cal, title, start, end, all = false) { this.cal = cal; this.title = title; this.start = start; this.end = end; this.all = all; this.id = 'event-' + ++uuid; }
    getId() { return this.id; }
    getTitle() { return this.title; }
    getStartTime() { return this.start; }
    getEndTime() { return this.end; }
    isAllDayEvent() { return this.all; }
    setTime(s, e) { this.start = s; this.end = e; this.all = false; }
    setAllDayDates(s, e) { this.start = s; this.end = e; this.all = true; }
    setTitle(t) { this.title = t; }
    deleteEvent() { this.cal.events = this.cal.events.filter(e => e !== this); }
  }
  class Calendar {
    constructor(id) { this.id = id; this.events = []; }
    getId() { return this.id; }
    createEvent(t, s, e) { const ev = new Event(this, t, s, e); this.events.push(ev); return ev; }
    createAllDayEvent(t, s) { const ev = new Event(this, t, s, new Date(+s + 86400000), true); this.events.push(ev); return ev; }
    getEvents(s, e) { return this.events.filter(ev => ev.start < e && ev.end > s); }
    getEventById(id) { return this.events.find(e => e.id === id) || null; }
  }
  state.calendars = { uni: new Calendar('uni'), personal: new Calendar('personal') };
  const ss = { getSheetByName: n => state.sheets[n] || null, insertSheet: n => new Sheet(n) };
  const sandbox = {
    Date, console: { log() {}, warn() {}, error() {} },
    Session: { getScriptTimeZone: () => 'America/Santiago' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => state.props[k] ?? null, setProperty: (k, v) => { state.props[k] = v; }, deleteProperty: k => { delete state.props[k]; } }) },
    SpreadsheetApp: { openById: () => ss, flush() {} },
    Utilities: { formatDate: format, parseDate: parse, getUuid: () => 'id-' + ++uuid, newBlob: s => ({ getBytes: () => Buffer.from(s) }), sleep() {} },
    CalendarApp: { getCalendarById: id => state.calendars[id] || null },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (state.locked) return false; state.locked = true; return true; }, releaseLock: () => { state.locked = false; } }) },
    ContentService: { createTextOutput: text => ({ getContent: () => text }) },
    UrlFetchApp: { fetch: (url, options) => {
      state.fetches.push({ url, options });
      if (url.includes('generativelanguage')) { state.calls++; return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ acciones: state.actions }) }] } }] }) }; }
      return { getResponseCode: () => state.delivery ? 200 : 503, getContentText: () => JSON.stringify({ ok: state.delivery }) };
    } },
    ScriptApp: {
      getProjectTriggers: () => state.triggers,
      deleteTrigger: t => { state.triggers = state.triggers.filter(x => x !== t); },
      newTrigger: name => {
        const b = { timeBased: () => b, inTimezone: () => b, everyDays: () => b, atHour: () => b, nearMinute: () => b, everyMinutes: () => b, create: () => state.triggers.push({ getHandlerFunction: () => name }) };
        return b;
      }
    }
  };
  const ctx = vm.createContext(sandbox);
  const files = fs.readdirSync(path.join(__dirname, '../src')).filter(f => f.endsWith('.gs'));
  vm.runInContext(files.map(f => fs.readFileSync(path.join(__dirname, '../src', f), 'utf8')).join('\n'), ctx);
  const run = expression => vm.runInContext(expression, ctx);
  const post = (id, text = 'un gasto', extra = {}) => {
    ctx.input = { parameter: { secret: 'secret' }, postData: { contents: JSON.stringify({ update_id: id, message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text, ...extra } }) } };
    return run('doPost(input)');
  };
  return { state, run, post, Sheet, ctx };
}

test('todos los módulos compilan y las fechas inválidas se rechazan', () => {
  const { run } = setup();
  assert.equal(run("fechaValida('2026-02-30')"), false);
  assert.equal(run("fechaValida('2028-02-29')"), true);
  assert.equal(run("horaValida('24:00')"), false);
  assert.equal(run("fechaRegistro('29-09-2026')"), '2026-09-29');
  assert.equal(run("fechaRegistro('02/03/2026')"), '2026-03-02');
  assert.equal(run("fechaChile(fechaHoraChile('2026-07-01', '18:30'))"), '2026-07-01');
  assert.equal(run("horaChile(fechaHoraChile('2026-12-01', '18:30'))"), '18:30');
});
test('un chat ajeno, remitente ajeno o configuración incompleta no acceden a datos ni IA', () => {
  const { state, post } = setup();
  post(1, 'gasto', { chat: { id: 99, type: 'private' } });
  post(2, 'gasto', { from: { id: 99 } });
  delete state.props.WEBHOOK_SECRET; post(3);
  assert.equal(state.calls, 0); assert.equal(Object.keys(state.sheets).length, 0);
});
test('actualización repetida crea solo un gasto, aunque expire la caché', () => {
  const { state, post } = setup();
  state.actions = [{ tipo: 'FINANZAS', subtipo: 'GASTO', monto: 5000, descripcion: 'Uber', ambito: 'PERSONAL' }];
  post(10); post(10);
  assert.equal(state.sheets.Gastos.rows.length, 2); assert.equal(state.calls, 1);
  assert.equal(state.sheets.Bot_Updates.rows[1][4], 'si');
});
test('bloqueo ocupado no ejecuta operaciones ni reconoce la solicitud', () => {
  const { state, post } = setup(); state.locked = true;
  assert.throws(() => post(11), /ocupado/); assert.equal(state.calls, 0);
});
test('una ejecución interrumpida no se repite ciegamente', () => {
  const { state, post, run } = setup();
  run("hojaConEsquema('Bot_Updates', ['update_id','fecha','estado','respuesta','enviado']).appendRow(['12',new Date(),'procesando','','no'])");
  post(12); assert.equal(state.calls, 0); assert.equal(state.sheets.Gastos, undefined);
});
test('fallo de entrega conserva resultado; un reenvío no repite el gasto', () => {
  const { state, post } = setup();
  state.actions = [{ tipo: 'FINANZAS', subtipo: 'GASTO', monto: 5000, descripcion: 'Uber', ambito: 'PERSONAL' }];
  state.delivery = false; post(13);
  assert.equal(state.sheets.Bot_Updates.rows[1][4], 'no');
  state.delivery = true; post(13);
  assert.equal(state.sheets.Gastos.rows.length, 2); assert.equal(state.calls, 1);
  assert.equal(state.sheets.Bot_Updates.rows[1][4], 'si');
});
test('operaciones de Fresha y limpieza quedan fuera del enrutador', () => {
  const { state, run } = setup();
  for (const tipo of ['AGENDAR_CITA', 'CONFIRMAR_VISITA', 'VENTA_PRODUCTO', 'INVENTARIO', 'FRESHA']) assert.match(run(`enrutarPersonal({tipo:'${tipo}'}, '42', {}).mensaje`), /Fresha/);
  assert.equal(run("enrutarPersonal({tipo:'LIMPIAR_DATOS_AHORA'}, '42', {}).ok"), false);
  assert.equal(Object.keys(state.sheets).length, 0);
});
test('ámbito faltante guarda pendiente y reanuda una segunda acción una sola vez', () => {
  const { state, run } = setup();
  run("ejecutarAccionesPersonales([{tipo:'FINANZAS',subtipo:'GASTO',monto:2000,descripcion:'Café'},{tipo:'TODO',subtipo:'AGREGAR',tarea:'Estudiar'}], '42', {})");
  assert.equal(state.sheets.Gastos, undefined); assert.equal(state.sheets.To_Do, undefined);
  run("ejecutarAccionesPersonales([{tipo:'RESOLVER_PENDIENTE',cambios:{ambito:'PERSONAL'}}], '42', leerContexto('42'))");
  assert.equal(state.sheets.Gastos.rows.length, 2); assert.equal(state.sheets.To_Do.rows.length, 2);
  assert.equal(run("Boolean(leerContexto('42').pendiente)"), false);
});
test('corrección reciente modifica el gasto y anulación conserva su fila', () => {
  const { state, run } = setup();
  run("ejecutarAccionesPersonales([{tipo:'FINANZAS',subtipo:'GASTO',monto:5000,descripcion:'Uber',ambito:'PERSONAL'}], '42', {})");
  run("ejecutarAccionesPersonales([{tipo:'FINANZAS',subtipo:'MODIFICAR',usar_ultimo:true,monto:8000}], '42', leerContexto('42'))");
  assert.equal(state.sheets.Gastos.rows[1][4], 8000);
  run("ejecutarAccionesPersonales([{tipo:'FINANZAS',subtipo:'ANULAR',usar_ultimo:true}], '42', leerContexto('42'))");
  assert.equal(state.sheets.Gastos.rows.length, 2); assert.equal(state.sheets.Gastos.rows[1][7], 'ANULADO');
  assert.equal(run('resumirMovimientos(fechaChile(),fechaChile()).PERSONAL.gastos'), 0);
});
test('contexto expirado no permite corregir un movimiento accidental', () => {
  const { state, run } = setup();
  state.props.CONTEXTO_42 = JSON.stringify({ actualizado: Date.now() - 3600000, ultimo: { tipo: 'FINANZAS', id: 'id-1', movimiento: 'GASTO' } });
  assert.equal(run("procesarFinanzas({subtipo:'ANULAR',usar_ultimo:true}, leerContexto('42')).ok"), false);
});
test('migración aditiva conserva registros y hace respaldo, sin inventar ámbito', () => {
  const { state, Sheet, run } = setup();
  new Sheet('Gastos').appendRow(['fecha','hora','categoría','descripción','monto']).appendRow(['29/09/2026','12:00','Otro','Anterior',100]);
  run('_getHojaGastos()'); run('_getHojaGastos()');
  assert.equal(state.sheets.Gastos.rows[1][4], 100);
  assert.equal(state.sheets.Respaldo_v3_Gastos.rows[0].length, 5);
  assert.equal(run("resumirMovimientos('2026-09-29','2026-09-29').SIN_CLASIFICAR.gastos"), 100);
});
test('esquema desconocido bloquea escrituras antes de alterar datos', () => {
  const { state, Sheet, run } = setup(); new Sheet('Gastos').appendRow(['fecha','hora','descripción','monto']);
  assert.throws(() => run('_getHojaGastos()'), /Esquema/);
  assert.equal(state.sheets.Gastos.rows[0].length, 4);
});
test('se rechazan montos inválidos y se neutralizan fórmulas en descripciones', () => {
  const { run, state } = setup();
  for (const monto of ['-5', '0', 'Infinity', 'NaN', "'5000'"]) assert.equal(run(`registrarFinanzas({subtipo:'GASTO',monto:${monto},descripcion:'x',ambito:'PERSONAL'}).ok`), false);
  run("registrarFinanzas({subtipo:'GASTO',monto:100,descripcion:'=IMPORTXML(1)',ambito:'PERSONAL'})");
  assert.equal(state.sheets.Gastos.rows[1][3], "'=IMPORTXML(1)");
});
test('reporte no suma visitas ni presenta utilidad de barbería', () => {
  const { Sheet, run } = setup();
  new Sheet('Historial_Visitas').appendRow(['fecha','hora','cliente','servicio','extras','productos','monto','estado']).appendRow([new Date(),'','','','','',99999,'PAGADO']);
  const report = run("reporteFinanzasPersonal({periodo:'DIA'})");
  assert.doesNotMatch(report.mensaje, /99\.999/); assert.match(report.mensaje, /ni representa la utilidad/);
});
test('tareas similares requieren aclaración y completar conserva historial', () => {
  const { run, state } = setup();
  run("procesarToDo({subtipo:'AGREGAR',tarea:'Estudiar cálculo',fecha_limite:'2026-10-01'})");
  run("procesarToDo({subtipo:'AGREGAR',tarea:'Estudiar física'})");
  assert.equal(run("procesarToDo({subtipo:'COMPLETAR',tarea:'Estudiar'}).ok"), false);
  run("procesarToDo({subtipo:'COMPLETAR',tarea:'Estudiar cálculo'})");
  assert.equal(state.sheets.To_Do.rows[1][3], 'completada'); assert.equal(state.sheets.To_Do.rows.length, 3);
});
test('tareas permiten mover vencimiento y filtrar vencidas', () => {
  const { run } = setup();
  run("procesarToDo({subtipo:'AGREGAR',tarea:'Informe',fecha_limite:sumarDias(fechaChile(),-1)})");
  assert.equal(run("obtenerTareas({periodo:'VENCIDAS'}).length"), 1);
  run("procesarToDo({subtipo:'MODIFICAR',tarea:'Informe',fecha_limite:sumarDias(fechaChile(),1)})");
  assert.equal(run("obtenerTareas({periodo:'VENCIDAS'}).length"), 0);
  assert.equal(run("obtenerTareas({periodo:'MANANA'}).length"), 1);
});
test('un choque al mover evento no cambia título, hora ni duración', () => {
  const { run, state } = setup();
  run("procesarAgenda({subtipo:'CREAR',calendario:'UNIVERSIDAD',evento:'Clase',fecha_estimada:'2030-10-01',hora_estimada:'10:00',duracion_minutos:90})");
  run("procesarAgenda({subtipo:'CREAR',calendario:'COMPROMISOS',evento:'Dentista',fecha_estimada:'2030-10-01',hora_estimada:'12:00'})");
  const before = state.calendars.uni.events[0].getStartTime().getTime();
  assert.equal(run("procesarAgenda({subtipo:'MODIFICAR',calendario:'UNIVERSIDAD',evento:'Clase',fecha_original:'2030-10-01',nueva_hora:'12:00',nuevo_evento:'Otro'}).ok"), false);
  const ev = state.calendars.uni.events[0]; assert.equal(ev.getTitle(), 'Clase'); assert.equal(ev.getStartTime().getTime(), before);
  assert.equal(ev.getEndTime() - ev.getStartTime(), 90 * 60000);
});
test('mover evento a horario libre conserva duración y se excluye a sí mismo', () => {
  const { run, state } = setup();
  run("procesarAgenda({subtipo:'CREAR',calendario:'UNIVERSIDAD',evento:'Clase',fecha_estimada:'2030-10-01',hora_estimada:'10:00',duracion_minutos:90})");
  assert.equal(run("procesarAgenda({subtipo:'MODIFICAR',calendario:'UNIVERSIDAD',evento:'Clase',fecha_original:'2030-10-01',nueva_hora:'10:15'}).ok"), true);
  const ev = state.calendars.uni.events[0]; assert.equal(ev.end - ev.start, 90 * 60000);
});
test('recordatorio con hora pasada o inválida no se guarda', () => {
  const { run, state } = setup();
  assert.equal(run("agregarRecordatorio({fecha_aviso:'2000-01-01',hora_aviso:'12:00',mensaje:'Aviso'},'42').ok"), false);
  assert.equal(run("agregarRecordatorio({fecha_aviso:'2030-01-01',hora_aviso:'25:00',mensaje:'Aviso'},'42').ok"), false);
  assert.equal(state.sheets.Recordatorios, undefined);
});
test('recordatorio fallido permanece pendiente; confirma solo tras entrega', () => {
  const { run, state } = setup();
  run("_getHojaRecordatorios().appendRow([new Date(),'2020-01-01','12:00','Aviso','pendiente','42','r1','',0])");
  state.delivery = false; run('procesarRecordatorios()');
  assert.equal(state.sheets.Recordatorios.rows[1][4], 'pendiente');
  state.delivery = true; run('procesarRecordatorios()');
  assert.equal(state.sheets.Recordatorios.rows[1][4], 'enviado');
  const n = state.fetches.length; run('procesarRecordatorios()'); assert.equal(state.fetches.length, n);
});
test('recordatorios heredados con objetos Date funcionan; destinatario ajeno se ignora', () => {
  const { run, state } = setup();
  run("_getHojaRecordatorios().appendRow([new Date(),fechaHoraChile('2020-01-01','12:00'),fechaHoraChile('2020-01-01','12:00'),'Aviso','pendiente','42','r1','',0])");
  run("_getHojaRecordatorios().appendRow([new Date(),'2020-01-01','12:00','Ajeno','pendiente','99','r2','',0])");
  run('procesarRecordatorios()'); assert.equal(state.sheets.Recordatorios.rows[1][4], 'enviado'); assert.equal(state.sheets.Recordatorios.rows[2][4], 'pendiente');
});
test('resúmenes funcionan sin IA ni clientes y no se duplican el mismo día', () => {
  const { run, state } = setup(); run('enviarResumenMatutino()'); run('enviarResumenMatutino()');
  assert.equal(state.calls, 0); assert.equal(state.sheets.Clientes, undefined); assert.equal(state.fetches.length, 1);
});
test('configurar triggers conserva automatizaciones ajenas', () => {
  const { run, state } = setup(); state.triggers = ['otraTarea', 'procesarRecordatorios'].map(name => ({ getHandlerFunction: () => name }));
  run('configurarTriggers()'); run('configurarTriggers()');
  assert.deepEqual(state.triggers.map(t => t.getHandlerFunction()).sort(), ['otraTarea','enviarResumenMatutino','enviarCierreDiario','procesarRecordatorios'].sort());
});
test('Gemini JSON inválido no produce escrituras y no repara números silenciosamente', () => {
  const { run } = setup(); assert.throws(() => run("_parseGeminiJson('{\"acciones\":42}')"));
  assert.throws(() => run("_parseGeminiJson('{\"acciones\":[],}')"));
});

test('no se ejecutan mensajes editados ni secretos incorrectos', () => {
  const { state, ctx, run } = setup();
  ctx.input = { parameter: { secret: 'secret' }, postData: { contents: JSON.stringify({ update_id: 99, edited_message: { chat: { id: 42, type: 'private' }, from: { id: 42 }, text: 'gasto' } }) } };
  run('doPost(input)'); ctx.input.parameter.secret = 'incorrecto'; run('doPost(input)');
  assert.equal(state.calls, 0); assert.equal(Object.keys(state.sheets).length, 0);
});
test('cancelar pendiente evita ejecutar la cola diferida', () => {
  const { state, run } = setup();
  run("ejecutarAccionesPersonales([{tipo:'FINANZAS',subtipo:'GASTO',monto:500,descripcion:'Café'},{tipo:'TODO',subtipo:'AGREGAR',tarea:'No crear'}], '42', {})");
  run("ejecutarAccionesPersonales([{tipo:'CANCELAR_PENDIENTE'}], '42', leerContexto('42'))");
  run("ejecutarAccionesPersonales([{tipo:'RESOLVER_PENDIENTE',cambios:{ambito:'PERSONAL'}}], '42', leerContexto('42'))");
  assert.equal(state.sheets.Gastos, undefined); assert.equal(state.sheets.To_Do, undefined);
});
test('se detiene la cola tras una acción fallida y no anuncia éxito', () => {
  const { state, run } = setup();
  const msg = run("ejecutarAccionesPersonales([{tipo:'INVALIDA'},{tipo:'TODO',subtipo:'AGREGAR',tarea:'No crear'}], '42', {})");
  assert.match(msg, /No ejecuté/); assert.equal(state.sheets.To_Do, undefined);
});
test('datos históricos reciben IDs estables y la preparación es repetible', () => {
  const { Sheet, state, run } = setup();
  new Sheet('Gastos').appendRow(['fecha','hora','categoría','descripción','monto']).appendRow(['29/09/2026','12:00','Otro','Antiguo',500]);
  run('prepararDatosPersonales()');
  const id = state.sheets.Gastos.rows[1][5];
  run('prepararDatosPersonales()');
  assert.equal(state.sheets.Gastos.rows[1][5], id); assert.ok(id);
  assert.equal(state.sheets.Respaldo_v3_Gastos.rows[1].length, 5);
});
test('preparación valida todas las hojas antes de cambiar una', () => {
  const { Sheet, state, run } = setup();
  new Sheet('Gastos').appendRow(['fecha','hora','categoría','descripción','monto']);
  new Sheet('To_Do').appendRow(['otra_columna']);
  assert.throws(() => run('prepararDatosPersonales()'), /No se inició/);
  assert.equal(state.sheets.Gastos.rows[0].length, 5);
});
test('un fallo de Telegram se recupera automáticamente sin repetir la operación', () => {
  const { state, post, run } = setup();
  state.actions = [{ tipo: 'FINANZAS', subtipo: 'GASTO', monto: 5000, descripcion: 'Uber', ambito: 'PERSONAL' }];
  state.delivery = false; post(501);
  state.delivery = true; run('procesarRecordatorios()');
  assert.equal(state.calls, 1); assert.equal(state.sheets.Gastos.rows.length, 2);
  assert.equal(state.sheets.Bot_Updates.rows[1][4], 'si');
});
test('texto largo se divide sin cortar etiquetas ni perder texto literal', () => {
  const { run, ctx, state } = setup(); ctx.largo = '<b>Lista</b>\n' + 'Ejemplo &lt;dato&gt; &amp; texto\n'.repeat(300);
  assert.equal(run("sendTelegramMessage('42', largo).ok"), true);
  const payloads = state.fetches.map(f => JSON.parse(f.options.payload));
  assert.ok(payloads.length > 1); assert.ok(payloads.every(p => p.text.length <= 3500 && !p.parse_mode));
  assert.equal(payloads.map(p => p.text).join(''), 'Lista\n' + 'Ejemplo <dato> & texto\n'.repeat(300));
});
test('anular último gasto no puede anular un ingreso reciente', () => {
  const { state, run } = setup();
  run("ejecutarAccionesPersonales([{tipo:'FINANZAS',subtipo:'INGRESO',monto:5000,descripcion:'Regalo',ambito:'PERSONAL'}], '42', {})");
  assert.equal(run("enrutarPersonal({tipo:'ANULAR_ULTIMO_GASTO'}, '42', leerContexto('42')).ok"), false);
  assert.equal(state.sheets.Ingresos.rows[1][6], 'ACTIVO');
});
test('no se permite dejar un movimiento sin fecha mediante una corrección', () => {
  const { state, run } = setup();
  run("ejecutarAccionesPersonales([{tipo:'FINANZAS',subtipo:'GASTO',monto:5000,descripcion:'Uber',ambito:'PERSONAL'}], '42', {})");
  assert.equal(run("procesarFinanzas({subtipo:'MODIFICAR',usar_ultimo:true,fecha:''}, leerContexto('42')).ok"), false);
  assert.notEqual(state.sheets.Gastos.rows[1][0], '');
});
test('diagnóstico no expone credenciales ni modifica hojas', () => {
  const { run, state } = setup();
  const json = JSON.stringify(run('diagnosticoPersonal()'));
  assert.doesNotMatch(json, /fake|secret/); assert.equal(Object.keys(state.sheets).length, 0);
});

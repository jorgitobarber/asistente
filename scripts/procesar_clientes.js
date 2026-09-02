/**
 * procesar_clientes.js
 *
 * Lee los CSV exportados de Fresha y genera `data/clientes_procesados.csv`
 * con el promedio REAL de días entre visitas por cliente.
 *
 * Uso:
 *   node scripts/procesar_clientes.js
 *
 * Prerequisito: tener los archivos en la carpeta data/
 *   - report_client-list_*.csv
 *   - report_appointment-list_*.csv
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Estados que cuentan como visita real
const ESTADOS_VALIDOS = ['nueva', 'completadas'];

// Clientes placeholder a ignorar
const PLACEHOLDERS = ['john doe', 'jane doe'];

// ─── Utilidades CSV ──────────────────────────────────────────────────────────

/**
 * Parsea una línea CSV respetando campos entre comillas.
 * Maneja fechas con comas adentro: "26 Jan 2026, 12:00am"
 */
function parsearLinea(linea) {
  const campos = [];
  let campo = '';
  let dentroComillas = false;

  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"') {
      dentroComillas = !dentroComillas;
    } else if (ch === ',' && !dentroComillas) {
      campos.push(campo.trim());
      campo = '';
    } else {
      campo += ch;
    }
  }
  campos.push(campo.trim());
  return campos;
}

/**
 * Parsea "31 Aug 2026, 5:00pm" → Date
 * Ignora la hora, solo necesitamos el día.
 */
function parsearFecha(str) {
  if (!str) return null;
  const meses = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const m = str.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/);
  if (!m || meses[m[2]] === undefined) return null;
  return new Date(parseInt(m[3]), meses[m[2]], parseInt(m[1]));
}

/**
 * Detecta automáticamente el archivo CSV en data/ que contenga el patrón buscado.
 */
function encontrarArchivo(patron) {
  const archivos = fs.readdirSync(DATA_DIR);
  const encontrado = archivos.find(f => f.toLowerCase().includes(patron));
  if (!encontrado) throw new Error(`No se encontró archivo con patrón "${patron}" en data/`);
  return path.join(DATA_DIR, encontrado);
}

// ─── Leer archivos ───────────────────────────────────────────────────────────

const archivoCitas   = encontrarArchivo('appointment-list');
const archivoClientes = encontrarArchivo('client-list');

console.log(`📂 Citas:    ${path.basename(archivoCitas)}`);
console.log(`📂 Clientes: ${path.basename(archivoClientes)}`);

const lineasCitas    = fs.readFileSync(archivoCitas,    'utf8').split('\n').filter(l => l.trim());
const lineasClientes = fs.readFileSync(archivoClientes, 'utf8').split('\n').filter(l => l.trim());

// ─── Paso 1: Calcular fechas de visitas reales por cliente ───────────────────

// { nombre_lowercase: [Date, Date, ...] }
const visitasPorCliente = {};

for (let i = 1; i < lineasCitas.length; i++) {
  const c = parsearLinea(lineasCitas[i]);
  const nombre = (c[1] || '').trim();
  const estado = (c[4] || '').trim().toLowerCase();
  const fechaStr = (c[6] || '').trim(); // Fecha programada

  if (!nombre || !ESTADOS_VALIDOS.includes(estado)) continue;

  const fecha = parsearFecha(fechaStr);
  if (!fecha) continue;

  const key = nombre.toLowerCase();
  if (!visitasPorCliente[key]) visitasPorCliente[key] = [];
  visitasPorCliente[key].push(fecha);
}

/**
 * Calcula el promedio real de días entre visitas consecutivas.
 * Retorna null si no hay suficientes datos (menos de 2 visitas reales).
 */
function calcularPromedioReal(fechas) {
  if (!fechas || fechas.length < 2) return null;

  // Ordenar de más antigua a más reciente
  fechas.sort((a, b) => a - b);

  const diffs = [];
  for (let i = 1; i < fechas.length; i++) {
    const dias = Math.round((fechas[i] - fechas[i - 1]) / (1000 * 60 * 60 * 24));
    if (dias > 0) diffs.push(dias); // Ignorar duplicados del mismo día
  }

  if (diffs.length === 0) return null;
  return Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
}

// ─── Paso 2: Procesar lista de clientes ──────────────────────────────────────

const filasSalida = [];
let conPromedio = 0;
let sinPromedio = 0;
let saltados = 0;

// Columnas del CSV de clientes:
// 0=nombre, 1=género, 2=edad, 3=teléfono, 4=email, 5=añadido, 6=primera_cita, 7=última_cita
for (let i = 1; i < lineasClientes.length; i++) {
  const c = parsearLinea(lineasClientes[i]);
  const nombre    = (c[0] || '').trim();
  const telefono  = (c[3] || '').trim();
  const primeraCita = (c[6] || '').trim();
  const ultimaCita  = (c[7] || '').trim();

  if (!nombre) continue;

  if (PLACEHOLDERS.includes(nombre.toLowerCase())) {
    console.log(`  ⚠️  Saltando placeholder: "${nombre}"`);
    saltados++;
    continue;
  }

  // Buscar visitas en el CSV de citas (coincidencia exacta, luego insensible)
  const key = nombre.toLowerCase();
  const visitas = visitasPorCliente[key] || [];
  const promedio = calcularPromedioReal(visitas);

  if (promedio) conPromedio++;
  else sinPromedio++;

  // Escapar nombre para CSV
  const nombreCSV   = `"${nombre.replace(/"/g, '""')}"`;
  const telefonoCSV = `"${telefono}"`;
  const primeraCSV  = `"${primeraCita}"`;
  const ultimaCSV   = `"${ultimaCita}"`;
  const promedioCSV = promedio !== null ? promedio : '';

  filasSalida.push(`${nombreCSV},${telefonoCSV},${primeraCSV},${ultimaCSV},${promedioCSV}`);
}

// ─── Paso 3: Escribir archivo de salida ─────────────────────────────────────

const header = 'nombre,telefono,primera_cita,ultima_cita,promedio_dias';
const contenido = [header, ...filasSalida].join('\n');
const rutaSalida = path.join(DATA_DIR, 'clientes_procesados.csv');
fs.writeFileSync(rutaSalida, contenido, 'utf8');

// ─── Resumen ─────────────────────────────────────────────────────────────────

console.log('');
console.log('✅ Procesamiento completado');
console.log(`   Total clientes:       ${filasSalida.length}`);
console.log(`   Con promedio real:    ${conPromedio} (historial suficiente)`);
console.log(`   Sin promedio real:    ${sinPromedio} (solo 1 visita registrada)`);
console.log(`   Placeholders saltados: ${saltados}`);
console.log('');
console.log(`📄 Archivo generado: ${rutaSalida}`);
console.log('');
console.log('👉 Próximo paso:');
console.log('   1. Abre data/clientes_procesados.csv');
console.log('   2. Copia TODO su contenido');
console.log('   3. Pégalo en test_CargarClientesProcesados() en el editor de GAS');
console.log('   4. Ejecuta test_CargarClientesProcesados');

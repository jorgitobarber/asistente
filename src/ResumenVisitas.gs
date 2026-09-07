/**
 * Módulo ResumenVisitas: Helpers y generación de resúmenes de citas (matutino, nocturno, etc.)
 * Funciones extraídas de RegistroVisitas para mantener archivos por debajo de 500 líneas.
 */

// ─── Fecha helpers ────────────────────────────────────────────────────────────

const _hoyChile = () => {
  const hoy = new Date();
  const enChile = new Date(hoy.toLocaleString('en-US', { timeZone: 'America/Santiago' }));
  const y = enChile.getFullYear();
  const m = String(enChile.getMonth() + 1).padStart(2, '0');
  const d = String(enChile.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const _normalizarFechaSheet = (valor) => {
  if (!valor) return '';
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Santiago', 'yyyy-MM-dd');
  }
  const str = valor.toString().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  if (str.includes('/')) {
    const partes = str.split(' ')[0].split('/');
    if (partes.length === 3 && parseInt(partes[2]) > 31) {
      return `${partes[2]}-${partes[1].padStart(2, '0')}-${partes[0].padStart(2, '0')}`;
    }
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'America/Santiago', 'yyyy-MM-dd');
  return str;
};

const _normalizarHoraSheet = (valor) => {
  if (!valor) return '';
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Santiago', 'HH:mm');
  }
  return valor.toString().trim();
};

const _formatearFechaLegible = (fechaISO) => {
  if (!fechaISO) return '';
  try {
    const [y, m, d] = fechaISO.split('-').map(Number);
    const fecha = new Date(y, m - 1, d);
    return fecha.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' });
  } catch (e) {
    return fechaISO;
  }
};

const _normalizar = (str) => {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

// ─── Funciones para resúmenes ─────────────────────────────────────────────────

const obtenerCitasHoy = () => {
  try {
    const hoy  = _hoyChile();
    const data = _getHojaCitas().getDataRange().getValues();
    return data.slice(1)
      .filter(r => _normalizarFechaSheet(r[0]) === hoy && r[5] !== 'inasistencia')
      .map(r => ({ hora: _normalizarHoraSheet(r[1]), nombre: r[2], servicio: r[3], addOns: r[4], estado: r[5] }))
      .sort((a, b) => (a.hora || '').localeCompare(b.hora || ''));
  } catch (e) {
    console.error('[VISITAS] Error en obtenerCitasHoy: ' + e.message);
    return [];
  }
};

const obtenerCitasPendientesConfirmar = () => {
  try {
    const hoy  = _hoyChile();
    const data = _getHojaCitas().getDataRange().getValues();
    return data.slice(1)
      .filter(r => _normalizarFechaSheet(r[0]) === hoy && r[5] === 'agendada')
      .map(r => ({ hora: r[1], nombre: r[2], servicio: r[3] }));
  } catch (e) {
    console.error('[VISITAS] Error en obtenerCitasPendientesConfirmar: ' + e.message);
    return [];
  }
};

const obtenerResumenCitasHoy = () => {
  try {
    const citas = obtenerCitasHoy();
    if (citas.length === 0) return 'Sin clientes agendados en el bot hoy.';

    let totalEstimado = 0;
    let texto = '';

    citas.forEach(c => {
      const addOnsArr = c.addOns ? c.addOns.split(', ').filter(Boolean) : [];
      const monto     = _calcularMonto(c.servicio, addOnsArr, []);
      totalEstimado  += monto;
      const check     = c.estado === 'confirmada' ? '✅' : '🕐';
      const addOnStr  = addOnsArr.length ? ` + ${addOnsArr.join(', ')}` : '';
      texto += `${check} ${c.hora} — ${c.nombre} (${c.servicio}${addOnStr})\n`;
    });

    texto += `\n💰 Estimado del día: $${totalEstimado.toLocaleString('es-CL')}`;
    return texto;
  } catch (e) {
    console.error('[VISITAS] Error en obtenerResumenCitasHoy: ' + e.message);
    return 'No pude cargar los clientes de hoy.';
  }
};

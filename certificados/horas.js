/* Horas del equipo ASPM — lectura de los Excel de Bixpe en el navegador (desde el 2026-11-24).
 * Los archivos no salen del ordenador: aquí solo se sacan las horas de cada día y se calculan los totales.
 * Reglas (decididas por la coordinadora):
 *   - se cuenta solo entre las fechas «desde» y «hasta»;
 *   - por día, las horas extra de 15 minutos o menos no cuentan (se anulan); las de más de 15 cuentan enteras.
 * Formatos que entiende:
 *   A) Exportación estándar de Bixpe «Resumen horas trabajadas»: una columna por día, filas «Horas en jornada» y «Horas extras».
 *   B) Informe diario: una fila por fichaje con columnas Fecha, Teórico y Computable (o Trabajado).
 */
(function () {
  const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
  const MESES_LARGOS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const UMBRAL_MIN = 15;

  const txt = v => (v == null ? '' : String(v)).trim();
  const norm = s => txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const iso = (a, m, d) => a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

  // «8 h», «7 h 51 min», «41 min», «--» → minutos
  function minutosBixpe(v) {
    const t = txt(v);
    if (!t || /^-+$/.test(t)) return 0;
    if (typeof v === 'number') return Math.round(v * 1440);
    const h = /(\d+)\s*h/.exec(t), m = /(\d+)\s*min/.exec(t);
    if (!h && !m) return hhmm(t);
    return (h ? +h[1] : 0) * 60 + (m ? +m[1] : 0);
  }
  // número de Excel (fracción de día) o texto «8:00» / «-1:56» → minutos
  function hhmm(v) {
    if (typeof v === 'number') return Math.round(v * 1440);
    const t = txt(v).replace(',', '.');
    const r = /^(-|−)?\s*(\d+):(\d{2})/.exec(t);
    if (r) return (r[1] ? -1 : 1) * (+r[2] * 60 + +r[3]);
    const n = parseFloat(t);
    return isNaN(n) ? 0 : Math.round(n * 60);
  }
  function fecha(v) {
    if (v instanceof Date && !isNaN(v)) return iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
    if (typeof v === 'number' && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    const r = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(txt(v));
    if (r) return iso(+r[3], +r[2], +r[1]);
    const r2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v));
    return r2 ? r2[0] : null;
  }

  function leerA(filas) {
    let anyo = null, mesIni = null;
    for (const f of filas.slice(0, 10)) {
      if (norm(f[0]).startsWith('fecha de inicio')) {
        const r = /(\d{1,2})\s+([a-zñ]+)\s+(\d{4})/.exec(norm(f[1]));
        if (r) { anyo = +r[3]; mesIni = MESES_LARGOS[r[2]] || null; }
        else { const d = fecha(f[1]); if (d) { anyo = +d.slice(0, 4); mesIni = +d.slice(5, 7); } }
      }
    }
    const iCab = filas.findIndex(f => norm(f[0]) === 'empleado' && norm(f[1]) === 'estado');
    if (iCab < 0 || !anyo) return null;
    const cab = filas[iCab];
    const cols = [];
    cab.forEach((c, j) => {
      const r = /(\d{1,2})\s+([a-z]{3})/.exec(norm(c));
      if (j > 2 && r && MESES[r[2]]) {
        const m = MESES[r[2]];
        cols.push({ j, fecha: iso(m < mesIni ? anyo + 1 : anyo, m, +r[1]) });
      }
    });
    const empleadas = [];
    for (let i = iCab + 1; i < filas.length; i++) {
      if (norm(filas[i][1]) !== 'horas en jornada') continue;
      const ext = norm((filas[i + 1] || [])[1]) === 'horas extras' ? filas[i + 1] : [];
      empleadas.push(cols.map(c => ({ fecha: c.fecha, jornada: minutosBixpe(filas[i][c.j]), extra: minutosBixpe(ext[c.j]) })));
    }
    if (!empleadas.length) return null;
    return { formato: 'Exportación de Bixpe (resumen por días)', dias: empleadas[0], empleadas: empleadas.length };
  }

  function leerB(filas) {
    const iCab = filas.findIndex(f => f.some(c => norm(c) === 'fecha') && f.some(c => norm(c).startsWith('teorico')));
    if (iCab < 0) return null;
    const cab = filas[iCab].map(norm);
    const jF = cab.indexOf('fecha'), jT = cab.findIndex(c => c.startsWith('teorico'));
    const jC = cab.findIndex(c => c.startsWith('computable')), jW = cab.findIndex(c => c.startsWith('trabajado'));
    if (jC < 0 && jW < 0) return null;
    const porDia = {};
    for (let i = iCab + 1; i < filas.length; i++) {
      const d = fecha(filas[i][jF]);
      if (!d) continue;
      const x = porDia[d] || (porDia[d] = { comp: 0, teor: 0 });
      // Si «Computable» viene vacío (fórmula sin calcular), se usa «Trabajado»
      const comp = jC >= 0 && txt(filas[i][jC]) !== '' ? filas[i][jC] : filas[i][jW];
      x.comp += hhmm(comp); x.teor += hhmm(filas[i][jT]);
    }
    const dias = Object.keys(porDia).sort().map(d => {
      const { comp, teor } = porDia[d];
      const extra = Math.max(0, comp - teor);
      return { fecha: d, jornada: comp - extra, extra };
    });
    return dias.length ? { formato: 'Informe diario (teórico y computable)', dias, empleadas: 1 } : null;
  }

  // ArrayBuffer del .xlsx → { formato, dias: [{fecha, jornada, extra}] (minutos), empleadas }
  function leer(buffer) {
    if (!window.XLSX) throw new Error('No se ha cargado el lector de Excel');
    const libro = XLSX.read(buffer, { type: 'array', cellDates: false });
    for (const nombre of libro.SheetNames) {
      // Bixpe declara mal el tamaño de la hoja: se recalcula a partir de las celdas que hay
      const hoja = libro.Sheets[nombre], refs = Object.keys(hoja).filter(k => k[0] !== '!');
      if (refs.length) {
        const r = { s: { r: Infinity, c: Infinity }, e: { r: 0, c: 0 } };
        refs.forEach(k => { const a = XLSX.utils.decode_cell(k); r.s.r = Math.min(r.s.r, a.r); r.s.c = Math.min(r.s.c, a.c); r.e.r = Math.max(r.e.r, a.r); r.e.c = Math.max(r.e.c, a.c); });
        hoja['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: r.e });
      }
      const filas = XLSX.utils.sheet_to_json(libro.Sheets[nombre], { header: 1, raw: true, defval: '' });
      const r = leerA(filas) || leerB(filas);
      if (r) return r;
    }
    throw new Error('No reconozco este Excel: no es una exportación de Bixpe con horas por día.');
  }

  // Totales entre dos fechas (AAAA-MM-DD, incluidas), aplicando la regla de los 15 minutos
  function calcular(dias, desde, hasta) {
    const t = { jornada: 0, extras: 0, descartadas: 0, diasDescartados: 0, diasConDatos: 0, primero: null, ultimo: null };
    dias.filter(d => d.fecha >= desde && d.fecha <= hasta).forEach(d => {
      if (d.jornada || d.extra) { t.diasConDatos++; t.primero = t.primero || d.fecha; t.ultimo = d.fecha; }
      t.jornada += d.jornada;
      if (d.extra > UMBRAL_MIN) t.extras += d.extra;
      else if (d.extra > 0) { t.descartadas += d.extra; t.diasDescartados++; }
    });
    return t;
  }

  const fmt = min => Math.floor(min / 60) + ':' + String(min % 60).padStart(2, '0');

  window.HorasBixpe = { leer, calcular, fmt, UMBRAL_MIN };
})();

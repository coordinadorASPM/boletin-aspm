/* Horas del equipo ASPM — lectura de los Excel de Bixpe en el navegador (desde el 2026-11-24; reglas nuevas el 2026-11-26).
 * El Excel no sale del ordenador: aquí solo se saca, para cada día, lo trabajado, la diferencia con la jornada prevista y la
 * hora de fin (sin nombres). Eso va al script de Google, que aplica las reglas y escribe el informe:
 *   - margen diario de 15 min: si faltan 15 min o menos para la jornada prevista, el día cuenta completo;
 *   - extras en junta directiva (días de junta) y por actividades (fin a las 19:00 o más tarde): enteras;
 *   - extras por alargar la jornada: el resto, descontando siempre 15 min;
 *   - compensación: un día con más de 15 min de menos compensa lo que falta menos 15 min, contra extras anteriores.
 * Formatos que entiende:
 *   A) Bixpe «Resumen horas trabajadas»: una columna por día, filas «Horas en jornada» y «Horas extras»
 *      (no trae jornada prevista ni hora de fin: no hay margen por abajo ni compensación, y las extras van a «alargar»).
 *   C) Bixpe «Horas trabajadas»: una fila por día con Fecha, Hora fin, Total trabajado y Horas extras (+/−).
 *   B) Informe diario: una fila por fichaje con Fecha, Salida, Teórico y Computable (o Trabajado).
 * Misma lectura que en el script de Google (herramientas/certificados/3-apps-script.gs): si se cambia una, cambiar la otra.
 */
(function () {
  const MESES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
  const MESES_LARGOS = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  const UMBRAL_MIN = 15;

  const txt = v => (v == null ? '' : String(v)).trim();
  const norm = s => txt(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const iso = (a, m, d) => a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

  // «8 h», «7 h 51 min», «-58 min», «0 min.», «--» → minutos (con signo)
  function minutosBixpe(v) {
    const t = txt(v);
    if (!t || /^-+$/.test(t)) return 0;
    if (typeof v === 'number') return Math.round(v * 1440);
    const h = /(\d+)\s*h/.exec(t), m = /(\d+)\s*min/.exec(t);
    if (!h && !m) return hhmm(t);
    return (/^[-−]/.test(t) ? -1 : 1) * ((h ? +h[1] : 0) * 60 + (m ? +m[1] : 0));
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
  // hora del día «16:48» (o fracción de día) → minutos desde las 0:00; -1 si no hay
  function horaDia(v) {
    if (typeof v === 'number') return v > 0 && v < 1 ? Math.round(v * 1440) : -1;
    const r = /^(\d{1,2}):(\d{2})/.exec(txt(v));
    return r ? +r[1] * 60 + +r[2] : -1;
  }
  function fecha(v) {
    if (typeof v === 'number' && v > 30000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
    const r = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/.exec(txt(v));
    if (r) return iso(+r[3], +r[2], +r[1]);
    const r2 = /^(\d{4})-(\d{2})-(\d{2})/.exec(txt(v));
    return r2 ? r2[0] : null;
  }

  // Cada lector devuelve los días como { fecha, w (trabajado), e (extra con signo), fin (hora de fin o -1) }
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
    const cols = [];
    filas[iCab].forEach((c, j) => {
      const r = /(\d{1,2})\s+([a-z]{3})/.exec(norm(c));
      if (j > 2 && r && MESES[r[2]]) { const m = MESES[r[2]]; cols.push({ j, fecha: iso(m < mesIni ? anyo + 1 : anyo, m, +r[1]) }); }
    });
    const empleadas = [];
    for (let i = iCab + 1; i < filas.length; i++) {
      if (norm(filas[i][1]) !== 'horas en jornada') continue;
      const ext = norm((filas[i + 1] || [])[1]) === 'horas extras' ? filas[i + 1] : [];
      empleadas.push(cols.map(c => { const j = minutosBixpe(filas[i][c.j]), x = minutosBixpe(ext[c.j]); return { fecha: c.fecha, w: j + x, e: x, fin: -1 }; }));
    }
    return empleadas.length ? { formato: 'Bixpe «Resumen horas trabajadas» (sin jornada prevista)', dias: empleadas[0], empleadas: empleadas.length } : null;
  }

  function leerC(filas) {
    const iCab = filas.findIndex(f => f.some(c => norm(c) === 'fecha') && f.some(c => norm(c).startsWith('total trabajado')) && f.some(c => norm(c).startsWith('horas extras')));
    if (iCab < 0) return null;
    const cab = filas[iCab].map(norm);
    const jF = cab.indexOf('fecha'), jW = cab.findIndex(c => c.startsWith('total trabajado')), jE = cab.findIndex(c => c.startsWith('horas extras')), jH = cab.indexOf('hora fin');
    const dias = [];
    for (let i = iCab + 1; i < filas.length; i++) {
      const r = /(\d{1,2})\s+([a-z]+)\s+(\d{4})/.exec(norm(filas[i][jF]));
      if (!r || !MESES_LARGOS[r[2]]) continue;
      dias.push({ fecha: iso(+r[3], MESES_LARGOS[r[2]], +r[1]), w: minutosBixpe(filas[i][jW]), e: minutosBixpe(filas[i][jE]), fin: jH >= 0 ? horaDia(filas[i][jH]) : -1 });
    }
    return dias.length ? { formato: 'Bixpe «Horas trabajadas» (una fila por día)', dias, empleadas: 1 } : null;
  }

  function leerB(filas) {
    const iCab = filas.findIndex(f => f.some(c => norm(c) === 'fecha') && f.some(c => norm(c).startsWith('teorico')));
    if (iCab < 0) return null;
    const cab = filas[iCab].map(norm);
    const jF = cab.indexOf('fecha'), jT = cab.findIndex(c => c.startsWith('teorico')), jS = cab.indexOf('salida');
    const jC = cab.findIndex(c => c.startsWith('computable')), jW = cab.findIndex(c => c.startsWith('trabajado'));
    if (jC < 0 && jW < 0) return null;
    const porDia = {};
    for (let i = iCab + 1; i < filas.length; i++) {
      const d = fecha(filas[i][jF]);
      if (!d) continue;
      const x = porDia[d] || (porDia[d] = { comp: 0, teor: 0, fin: -1 });
      // Si «Computable» viene vacío (fórmula sin calcular), se usa «Trabajado»
      const comp = jC >= 0 && txt(filas[i][jC]) !== '' ? filas[i][jC] : filas[i][jW];
      x.comp += hhmm(comp); x.teor += hhmm(filas[i][jT]);
      if (jS >= 0) x.fin = Math.max(x.fin, horaDia(filas[i][jS]));
    }
    const dias = Object.keys(porDia).sort().map(d => ({ fecha: d, w: porDia[d].comp, e: porDia[d].comp - porDia[d].teor, fin: porDia[d].fin }));
    return dias.length ? { formato: 'Informe diario (teórico y computable)', dias, empleadas: 1 } : null;
  }

  // ArrayBuffer del .xlsx → { formato, dias, empleadas }
  function leer(buffer) {
    if (!window.XLSX) throw new Error('No se ha cargado el lector de Excel');
    const libro = XLSX.read(buffer, { type: 'array', cellDates: false });
    for (const nombre of libro.SheetNames) {
      // Bixpe declara mal el tamaño de la hoja: se recalcula a partir de las celdas que hay
      const hoja = libro.Sheets[nombre], refs = Object.keys(hoja).filter(k => k[0] !== '!');
      if (refs.length) {
        const e = { r: 0, c: 0 };
        refs.forEach(k => { const a = XLSX.utils.decode_cell(k); e.r = Math.max(e.r, a.r); e.c = Math.max(e.c, a.c); });
        hoja['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e });
      }
      // Texto tal como se ve (igual que lo lee el script de Google), salvo números de fecha/hora sin formato
      const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' });
      const r = leerA(filas) || leerC(filas) || leerB(filas);
      if (r) return r;
    }
    throw new Error('No reconozco este Excel: no es una exportación de Bixpe con horas por día.');
  }

  // Días con horas entre dos fechas (para enseñar qué se ha leído)
  function resumen(dias, desde, hasta) {
    const con = dias.filter(d => d.fecha >= desde && d.fecha <= hasta && d.w > 0);
    return { dias: con.length, primero: con.length ? con[0].fecha : null, ultimo: con.length ? con[con.length - 1].fecha : null };
  }

  const fmt = min => (min < 0 ? '-' : '') + Math.floor(Math.abs(min) / 60) + ':' + String(Math.abs(min) % 60).padStart(2, '0');

  window.HorasBixpe = { leer, resumen, fmt, UMBRAL_MIN };
})();

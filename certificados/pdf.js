/* Certificados de donación ASPM — generación del PDF (réplica de la plantilla n.º 20).
   No contiene datos personales: los nombres de las firmantes vienen de Ajustes (base de datos privada). */
(function () {
  'use strict';

  const CABECERA = [
    'ASOCIACIÓN SÍNDROME PHELAN-MCDERMID',
    'Isla de Fuerteventura, 6 - 28669 Boadilla del Monte (Madrid)',
    'Email: info@22q13.org.es',
    'web: http://www.22q13.org.es',
    'CIF G86683166 - Nº Registro Asociaciones 602630 Grupo 1º / Sección 1ª'
  ];

  const AVISO_LEGAL =
    'PROTECCIÓN DE DATOS: De conformidad con el Reglamento (UE) 2016/679 (RGPD) y la Ley Orgánica 3/2018, de 5 de diciembre, ' +
    'de Protección de Datos Personales y garantía de los derechos digitales, le informamos de que la responsable del tratamiento ' +
    'de sus datos es la Asociación Síndrome Phelan-McDermid (CIF G86683166), con domicilio en Calle Isla de Fuerteventura nº 6, ' +
    '28669 Boadilla del Monte (Madrid). Sus datos se tratan para gestionar su donación y emitir este certificado, y para cumplir ' +
    'las obligaciones fiscales derivadas de la Ley 49/2002, por lo que se comunicarán a la Agencia Estatal de Administración ' +
    'Tributaria (modelo 182). Se conservarán durante los plazos legalmente exigidos. Puede ejercer sus derechos de acceso, ' +
    'rectificación, supresión, oposición, limitación del tratamiento y portabilidad escribiendo a info@22q13.org.es o a la ' +
    'dirección postal indicada, adjuntando copia de un documento que acredite su identidad, e indicando «PROTECCIÓN DE DATOS». ' +
    'También puede presentar una reclamación ante la Agencia Española de Protección de Datos (www.aepd.es).';

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

  /* ---------- Importe en letra ---------- */
  const UNI = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
    'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós',
    'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const DEC = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const CEN = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
    'ochocientos', 'novecientos'];

  function hasta999(n) {
    if (n === 0) return '';
    if (n === 100) return 'cien';
    const c = Math.floor(n / 100), r = n % 100;
    let s = CEN[c];
    if (r) {
      const t = r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNI[r % 10] : '');
      s = (s ? s + ' ' : '') + t;
    }
    return s;
  }
  // "uno" delante de un sustantivo se apocopa: un euro, veintiún euros, treinta y un mil
  const apocopar = s => s.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

  function enteroEnLetra(n) {
    if (n === 0) return 'cero';
    const mill = Math.floor(n / 1e6), mil = Math.floor((n % 1e6) / 1000), resto = n % 1000;
    const p = [];
    if (mill) p.push(mill === 1 ? 'un millón' : apocopar(enteroEnLetra(mill)) + ' millones');
    if (mil) p.push(mil === 1 ? 'mil' : apocopar(hasta999(mil)) + ' mil');
    if (resto) p.push(hasta999(resto));
    return p.join(' ');
  }

  function importeEnLetra(importe) {
    const cent = Math.round(Number(importe) * 100);
    const e = Math.floor(cent / 100), c = cent % 100;
    let s;
    if (e === 1) s = 'un euro';
    else if (e >= 1e6 && e % 1e6 === 0) s = enteroEnLetra(e) + ' de euros';
    else s = apocopar(enteroEnLetra(e)) + ' euros';
    if (c) s += ' con ' + (c === 1 ? 'un céntimo' : apocopar(hasta999(c)) + ' céntimos');
    return s;
  }

  function importeNum(importe) {
    const [e, c] = Number(importe).toFixed(2).split('.');
    return e.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + c;
  }

  function fechaLarga(iso) {
    const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return d + ' de ' + MESES[m - 1] + ' de ' + a;
  }

  /* ---------- Textos del certificado ---------- */
  function certificante(c, aj) {
    const esSec = c.firma_secretaria;
    return {
      nombre: ((esSec ? aj.secretaria_nombre : aj.presidenta_nombre) || '[NOMBRE PENDIENTE EN AJUSTES]').toUpperCase(),
      dni: (esSec ? aj.secretaria_dni : aj.presidenta_dni) || '[DNI PENDIENTE EN AJUSTES]',
      cargo: esSec ? 'Secretaria' : 'Presidenta'
    };
  }

  function textos(c, aj) {
    const q = certificante(c, aj);
    const imp = importeNum(c.importe) + ' € (' + importeEnLetra(c.importe) + ')';
    const donacion = c.tipo === 'especie' ? 'una donación en especie valorada en ' + imp : 'una donación de ' + imp;
    return {
      encabezado: [
        { t: 'Dña. ' + q.nombre + ',', b: true },
        { t: ' con DNI ' + q.dni + ', en calidad de ' + q.cargo + ' de la Asociación Síndrome Phelan-McDermid, ' +
             'con CIF G86683166, incluida entre las reguladas en el Art. 16 del Capítulo 1 del Título III de la Ley 49/2002' }
      ],
      cuerpo: [
        'Que ha recibido de ' + c.donante + ' con NIF: ' + c.nif + ', y domicilio en ' + c.domicilio + ' ' + donacion + '.',
        'Dicha donación ha sido recibida el ' + fechaLarga(c.fecha_donacion) + '.',
        'Y, agradeciéndole su generosidad, para que así conste, firmo el presente documento en ' +
          (aj.lugar || 'Boadilla del Monte') + ', a ' + fechaLarga(c.fecha_emision) + '.',
        'La siguiente donación, es de carácter irrevocable, sin perjuicio de lo establecido en las normas imperativas ' +
          'civiles que regulan la revocación de donaciones.'
      ]
    };
  }

  /* ---------- Maquetación ---------- */
  function limpiarWinAnsi(font, s) {
    let out = '';
    for (const ch of String(s)) {
      try { font.encodeText(ch); out += ch; } catch (e) { out += '?'; }
    }
    return out;
  }

  // Parte un párrafo (lista de trozos con o sin negrita) en líneas justificadas
  function lineas(trozos, fuentes, size, ancho) {
    const palabras = [];
    trozos.forEach(tr => {
      const f = tr.b ? fuentes.b : fuentes.r;
      const txt = limpiarWinAnsi(f, tr.t);
      txt.split(/(\s+)/).forEach(w => {
        if (w === '') return;
        if (/^\s+$/.test(w)) { if (palabras.length) palabras[palabras.length - 1].esp = true; return; }
        palabras.push({ w, f, ancho: f.widthOfTextAtSize(w, size), esp: false });
      });
    });
    const espacio = fuentes.r.widthOfTextAtSize(' ', size);
    const res = [];
    let act = [], anchoAct = 0;
    palabras.forEach(p => {
      const extra = act.length && act[act.length - 1].esp ? espacio : 0;
      if (act.length && anchoAct + extra + p.ancho > ancho) {
        res.push({ ps: act, ancho: anchoAct });
        act = []; anchoAct = 0;
      }
      anchoAct += (act.length && act[act.length - 1].esp ? espacio : 0) + p.ancho;
      act.push(p);
    });
    if (act.length) res.push({ ps: act, ancho: anchoAct, ultima: true });
    return { res, espacio };
  }

  function dibujarParrafo(page, trozos, fuentes, o) {
    const { res, espacio } = lineas(trozos, fuentes, o.size, o.ancho);
    let y = o.y;
    res.forEach(l => {
      const huecos = l.ps.filter((p, i) => i < l.ps.length - 1 && p.esp).length;
      const extra = !l.ultima && o.justificar && huecos ? (o.ancho - l.ancho) / huecos : 0;
      let x = o.x;
      l.ps.forEach((p, i) => {
        page.drawText(p.w, { x, y, size: o.size, font: p.f, color: o.color });
        x += p.ancho + (p.esp && i < l.ps.length - 1 ? espacio + extra : 0);
      });
      y -= o.interlineado;
    });
    return y;
  }

  function fechaHora(ts) {
    const d = new Date(ts);
    const dd = String(d.getDate()).padStart(2, '0'), mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '/' + mm + '/' + d.getFullYear() + ' a las ' +
      String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /**
   * c: certificado · aj: ajustes · firmas: { presidenta: Uint8Array|null, secretaria: Uint8Array|null }
   * logo: Uint8Array (PNG) · borrador: true añade la marca de agua
   * paraFirmar: versión limpia para firmar con certificado digital (sin marca de agua ni «Pendiente de firma»)
   */
  async function generar({ c, aj, firmas, logo, borrador, paraFirmar }) {
    const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle('Certificado de donación' + (c.numero ? ' n.º ' + c.numero : ''));
    if (c.id) doc.setKeywords([marca(c.id)]);
    doc.setAuthor('Asociación Síndrome Phelan-McDermid');
    doc.setCreator('Herramienta de certificados ASPM');
    const page = doc.addPage([595.28, 841.89]);
    const W = page.getWidth(), H = page.getHeight();
    const f = {
      r: await doc.embedFont(StandardFonts.Helvetica),
      b: await doc.embedFont(StandardFonts.HelveticaBold),
      bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique)
    };
    const tinta = rgb(0.08, 0.08, 0.08), gris = rgb(0.35, 0.35, 0.35);

    // Cabecera
    let y = H - 48;
    CABECERA.forEach((t, i) => {
      page.drawText(t, { x: 48, y, size: i === 0 ? 8 : 7, font: f.bi, color: tinta });
      y -= i === 0 ? 10 : 9;
    });
    if (logo) {
      const img = await doc.embedPng(logo);
      const w = 168, h = w * img.height / img.width;
      page.drawImage(img, { x: W - 40 - w, y: H - 34 - h, width: w, height: h });
    }

    // Cuerpo
    const X = 85, ANCHO = W - 2 * X, SIZE = 11, IL = 17;
    const tx = textos(c, aj);
    y = H - 205;
    y = dibujarParrafo(page, tx.encabezado, f, { x: X, y, size: SIZE, ancho: ANCHO, interlineado: IL, justificar: true, color: tinta });

    y -= 22;
    const tCert = 'CERTIFICA';
    page.drawText(tCert, { x: (W - f.b.widthOfTextAtSize(tCert, 16)) / 2, y, size: 16, font: f.b, color: tinta });
    y -= 34;

    tx.cuerpo.forEach(p => {
      y = dibujarParrafo(page, [{ t: p }], f, { x: X, y, size: SIZE, ancho: ANCHO, interlineado: IL, justificar: true, color: tinta });
      y -= 9;
    });

    // Firmas (secretaria a la izquierda, presidenta a la derecha, como en la plantilla)
    const bloques = [];
    if (c.firma_secretaria) bloques.push({ rol: 'secretaria', nombre: aj.secretaria_firma || ('Dña. ' + (aj.secretaria_nombre || '')), cargo: 'Secretaria', cuando: c.firmado_secretaria });
    if (c.firma_presidenta) bloques.push({ rol: 'presidenta', nombre: aj.presidenta_firma || ('Dña. ' + (aj.presidenta_nombre || '')), cargo: 'Presidenta', cuando: c.firmado_presidenta });
    const yNombre = Math.min(y - 95, 330);
    const columnas = [93, 312];
    for (let i = 0; i < bloques.length; i++) {
      const bq = bloques[i], x = columnas[i];
      const bytes = firmas && firmas[bq.rol];
      if (bq.cuando && bytes) {
        const img = await doc.embedPng(bytes);
        const maxW = 160, maxH = 62;
        const k = Math.min(maxW / img.width, maxH / img.height);
        page.drawImage(img, { x, y: yNombre + 16, width: img.width * k, height: img.height * k });
      }
      page.drawText(limpiarWinAnsi(f.r, bq.nombre), { x, y: yNombre, size: SIZE, font: f.r, color: tinta });
      page.drawText(bq.cargo, { x, y: yNombre - 15, size: SIZE, font: f.r, color: tinta });
      if (bq.cuando) {
        page.drawText('Firmado electrónicamente el ' + fechaHora(bq.cuando), { x, y: yNombre - 29, size: 6.5, font: f.r, color: gris });
      } else if (!paraFirmar) {
        page.drawText('Pendiente de firma', { x, y: yNombre - 29, size: 6.5, font: f.r, color: gris });
      }
    }

    // Pie legal
    const aviso = (aj.aviso_legal && aj.aviso_legal.trim()) || AVISO_LEGAL;
    const { res } = lineas([{ t: aviso }], f, 6.2, W - 96);
    let yPie = 40 + res.length * 7.6;
    dibujarParrafo(page, [{ t: aviso }], f, { x: 48, y: yPie, size: 6.2, ancho: W - 96, interlineado: 7.6, justificar: true, color: tinta });
    page.drawText('1', { x: W / 2 - 2, y: 22, size: 8, font: f.r, color: tinta });

    if (borrador && !paraFirmar) {
      page.drawText('BORRADOR · PENDIENTE DE FIRMA', {
        x: 110, y: 260, size: 38, font: f.b, color: rgb(0.1, 0.41, 0.18), opacity: 0.1, rotate: degrees(40)
      });
    }
    // Sin flujos de objetos: el PDF queda legible por dentro y los programas de firma lo amplían sin rehacerlo
    return doc.save({ useObjectStreams: !paraFirmar });
  }

  /* ---------- PDF firmados con certificado digital ---------- */
  // Marca interna que identifica el certificado dentro del PDF (va en las palabras clave)
  const marca = id => 'aspm-cert-' + id;

  // ¿Este PDF es el de ese certificado? Busca la marca tal cual o en UTF-16 (como la escribe pdf-lib)
  function llevaMarca(bytes, id) {
    const m = marca(id);
    const txt = latin1(bytes).toLowerCase();
    const hex = Array.from(m, ch => '00' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    return txt.includes(m) || txt.includes(hex);
  }

  // Número de firmas digitales que contiene (cada una lleva su /ByteRange)
  function contarFirmas(bytes) {
    return (latin1(bytes).match(/\/ByteRange\s*\[/g) || []).length;
  }

  function esPdf(bytes) {
    return latin1(bytes.subarray(0, 1024)).includes('%PDF-');
  }

  function latin1(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return s;
  }

  window.CertPDF = { generar, textos, importeEnLetra, importeNum, fechaLarga, AVISO_LEGAL, llevaMarca, contarFirmas, esPdf };
})();

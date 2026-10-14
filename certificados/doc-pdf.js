/* Herramienta de firmas ASPM — PDF de las actas y hoja de firmas de los documentos subidos.
   No contiene datos personales: los nombres de las firmantes vienen de Ajustes (base de datos privada). */
(function () {
  'use strict';

  const A4 = [595.28, 841.89];
  const marca = id => 'aspm-doc-' + id;

  /* ---------- Del HTML del acta a bloques de texto ---------- */
  // Solo entiende lo que deja el editor: h2, h3, p, ul/ol/li, b/strong, i/em, br
  function bloques(html) {
    const raiz = new DOMParser().parseFromString('<div>' + (html || '') + '</div>', 'text/html').body.firstChild;
    const out = [];
    const runs = (nodo, b, i, acc) => {
      nodo.childNodes.forEach(n => {
        if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' '); if (t) acc.push({ t, b, i }); return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName;
        if (tag === 'BR') { acc.push({ br: true }); return; }
        if (tag === 'UL' || tag === 'OL') return;  // las listas anidadas se tratan aparte
        runs(n, b || tag === 'B' || tag === 'STRONG', i || tag === 'I' || tag === 'EM', acc);
      });
      return acc;
    };
    const recorrer = (nodo, nivel) => {
      nodo.childNodes.forEach(n => {
        if (n.nodeType === 3) { if (n.nodeValue.trim()) out.push({ tipo: 'p', runs: [{ t: n.nodeValue.trim(), b: false, i: false }] }); return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName;
        if (tag === 'H1' || tag === 'H2' || tag === 'H3') out.push({ tipo: tag === 'H3' ? 'h3' : 'h2', runs: runs(n, true, false, []) });
        else if (tag === 'UL' || tag === 'OL') {
          let k = 0;
          n.childNodes.forEach(li => {
            if (li.nodeType !== 1 || li.tagName !== 'LI') return;
            k++;
            out.push({ tipo: 'li', marca: tag === 'OL' ? k + '.' : '•', nivel: nivel + 1, runs: runs(li, false, false, []) });
            li.querySelectorAll(':scope > ul, :scope > ol').forEach(sub => recorrer({ childNodes: [sub] }, nivel + 1));
          });
        } else if (tag === 'B' || tag === 'STRONG' || tag === 'I' || tag === 'EM' || tag === 'SPAN') {
          out.push({ tipo: 'p', runs: runs({ childNodes: [n] }, false, false, []) });
        } else out.push({ tipo: 'p', runs: runs(n, false, false, []) });
      });
    };
    recorrer(raiz, 0);
    // Fuera los párrafos vacíos
    return out.filter(bq => bq.runs.some(r => r.t && r.t.trim()));
  }

  /* ---------- Maquetación con negrita y cursiva ---------- */
  function partir(runs, F, size, ancho) {
    const lim = window.CertPDF.limpiarWinAnsi;
    const palabras = [];
    runs.forEach(r => {
      if (r.br) { palabras.push({ br: true }); return; }
      const f = r.b && r.i ? F.bi : r.b ? F.b : r.i ? F.i : F.r;
      lim(f, r.t).split(/(\s+)/).forEach(w => {
        if (w === '') return;
        if (/^\s+$/.test(w)) { const u = palabras[palabras.length - 1]; if (u && !u.br) u.esp = true; return; }
        palabras.push({ w, f, ancho: f.widthOfTextAtSize(w, size), esp: false });
      });
    });
    const espacio = F.r.widthOfTextAtSize(' ', size);
    const res = [];
    let act = [], anchoAct = 0;
    const cerrar = ultima => { res.push({ ps: act, ancho: anchoAct, ultima }); act = []; anchoAct = 0; };
    palabras.forEach(p => {
      if (p.br) { cerrar(true); return; }
      const extra = act.length && act[act.length - 1].esp ? espacio : 0;
      if (act.length && anchoAct + extra + p.ancho > ancho) cerrar(false);
      anchoAct += (act.length && act[act.length - 1].esp ? espacio : 0) + p.ancho;
      act.push(p);
    });
    if (act.length) cerrar(true);
    return { res, espacio };
  }

  async function fuentes(doc) {
    const { StandardFonts } = window.PDFLib;
    return {
      r: await doc.embedFont(StandardFonts.Helvetica),
      b: await doc.embedFont(StandardFonts.HelveticaBold),
      i: await doc.embedFont(StandardFonts.HelveticaOblique),
      bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique)
    };
  }

  // Bloque de firmas (secretaria a la izquierda, presidenta a la derecha). Devuelve la altura usada.
  async function dibujarFirmas(doc, page, F, y, d, aj, firmas, paraFirmar, acta) {
    const { rgb } = window.PDFLib;
    const tinta = rgb(0.08, 0.08, 0.08), gris = rgb(0.35, 0.35, 0.35);
    const lim = window.CertPDF.limpiarWinAnsi;
    const bq = [];
    if (d.firma_secretaria) bq.push({ rol: 'secretaria', titulo: acta ? 'La Secretaria' : 'Secretaria', nombre: aj.secretaria_firma || ('Dña. ' + (aj.secretaria_nombre || '')), cuando: d.firmado_secretaria });
    if (d.firma_presidenta) bq.push({ rol: 'presidenta', titulo: acta ? 'La Presidenta' : 'Presidenta', nombre: aj.presidenta_firma || ('Dña. ' + (aj.presidenta_nombre || '')), cuando: d.firmado_presidenta });
    if (acta) bq.reverse();   // en las actas, como en las de la asociación: presidenta a la izquierda y secretaria a la derecha
    const cols = [93, 330];
    for (let k = 0; k < bq.length; k++) {
      const b = bq[k], x = cols[k];
      page.drawText(b.titulo, { x, y, size: 10.5, font: F.b, color: tinta });
      const bytes = firmas && firmas[b.rol];
      if (b.cuando && bytes) {
        const img = await doc.embedPng(bytes);
        const s = Math.min(160 / img.width, 58 / img.height);
        page.drawImage(img, { x, y: y - 76, width: img.width * s, height: img.height * s });
      }
      page.drawText(lim(F.r, b.nombre), { x, y: y - 92, size: 10.5, font: F.r, color: tinta });
      if (b.cuando) page.drawText('Firmado electrónicamente el ' + window.CertPDF.fechaHora(b.cuando), { x, y: y - 105, size: 6.5, font: F.r, color: gris });
      else if (!paraFirmar) page.drawText('Pendiente de firma', { x, y: y - 105, size: 6.5, font: F.r, color: gris });
    }
    return 115;
  }

  function cabecera(page, F, logoImg) {
    const { rgb } = window.PDFLib;
    const H = page.getHeight(), W = page.getWidth();
    let y = H - 48;
    window.CertPDF.CABECERA.forEach((t, k) => {
      page.drawText(t, { x: 48, y, size: k === 0 ? 8 : 7, font: F.bi, color: rgb(0.08, 0.08, 0.08) });
      y -= k === 0 ? 10 : 9;
    });
    if (logoImg) {
      const w = 150, h = w * logoImg.height / logoImg.width;
      page.drawImage(logoImg, { x: W - 40 - w, y: H - 34 - h, width: w, height: h });
    }
  }

  function numerar(doc, F) {
    const { rgb } = window.PDFLib;
    const pags = doc.getPages(), n = pags.length;
    pags.forEach((p, k) => {
      const t = (k + 1) + ' / ' + n;
      p.drawText(t, { x: p.getWidth() / 2 - F.r.widthOfTextAtSize(t, 8) / 2, y: 26, size: 8, font: F.r, color: rgb(0.35, 0.35, 0.35) });
    });
  }

  function marcaBorrador(doc, F, texto) {
    const { rgb, degrees } = window.PDFLib;
    doc.getPages().forEach(p => p.drawText(texto, { x: 95, y: 250, size: 36, font: F.b, color: rgb(0.1, 0.41, 0.18), opacity: 0.1, rotate: degrees(40) }));
  }

  /**
   * Acta: d (fila de documentos) · aj: ajustes · firmas: { presidenta, secretaria } (PNG o null) · logo: PNG
   * borrador: añade la marca de agua · paraFirmar: versión limpia para firmar con certificado digital
   */
  async function acta({ d, aj, firmas, logo, borrador, paraFirmar }) {
    const { PDFDocument, rgb } = window.PDFLib;
    const doc = await PDFDocument.create();
    doc.setTitle(d.titulo || 'Acta');
    if (d.id) doc.setKeywords([marca(d.id)]);
    doc.setAuthor('Asociación Síndrome Phelan-McDermid');
    doc.setCreator('Herramienta de firmas ASPM');
    const F = await fuentes(doc);
    const logoImg = logo ? await doc.embedPng(logo) : null;
    const tinta = rgb(0.08, 0.08, 0.08);
    const [W, H] = A4, X = 70, ANCHO = W - 2 * X, ABAJO = 60;

    let page = doc.addPage(A4);
    cabecera(page, F, logoImg);
    let y = H - 150;
    const nueva = () => { page = doc.addPage(A4); y = H - 60; };

    const estilo = { h2: { size: 13, il: 18, antes: 10, despues: 6 }, h3: { size: 11.5, il: 16, antes: 8, despues: 4 },
                     p: { size: 10.5, il: 15, antes: 0, despues: 7 }, li: { size: 10.5, il: 15, antes: 0, despues: 3 } };
    bloques(d.contenido).forEach((bq, k, todos) => {
      const e = estilo[bq.tipo];
      const sangria = bq.tipo === 'li' ? 16 * bq.nivel : 0;
      const { res, espacio } = partir(bq.runs, F, e.size, ANCHO - sangria);
      if (k && e.antes) y -= e.antes;
      // Un título no se queda solo al final de la página
      const necesita = bq.tipo.startsWith('h') ? e.il * (res.length + 2) : e.il;
      if (y - necesita < ABAJO) nueva();
      if (bq.tipo === 'li') page.drawText(bq.marca, { x: X + sangria - 12, y, size: e.size, font: F.r, color: tinta });
      res.forEach(l => {
        if (y < ABAJO) nueva();
        const huecos = l.ps.filter((p, j) => j < l.ps.length - 1 && p.esp).length;
        const extra = !l.ultima && bq.tipo !== 'h2' && bq.tipo !== 'h3' && huecos ? (ANCHO - sangria - l.ancho) / huecos : 0;
        let x = X + sangria;
        l.ps.forEach((p, j) => {
          page.drawText(p.w, { x, y, size: e.size, font: p.f, color: tinta });
          x += p.ancho + (p.esp && j < l.ps.length - 1 ? espacio + extra : 0);
        });
        y -= e.il;
      });
      if (!res.length) y -= e.il;
      y -= e.despues;
      if (k === todos.length - 1) y -= 10;
    });

    // Fórmula de cierre y firmas al final, sin partirlas entre páginas
    if (y - 165 < ABAJO) nueva();
    const cierre = 'Para que conste y surta los efectos que en Derecho procedan, suscribe la presente Acta en ' + (aj.lugar || 'Boadilla del Monte') + '.';
    partir([{ t: cierre }], F, 10.5, ANCHO).res.forEach(l => {
      let x = X;
      l.ps.forEach(p => { page.drawText(p.w, { x, y, size: 10.5, font: p.f, color: tinta }); x += p.ancho + (p.esp ? F.r.widthOfTextAtSize(' ', 10.5) : 0); });
      y -= 15;
    });
    await dibujarFirmas(doc, page, F, y - 22, d, aj, firmas, paraFirmar, true);

    numerar(doc, F);
    if (borrador && !paraFirmar) marcaBorrador(doc, F, d.estado === 'revision' ? 'BORRADOR · EN REVISIÓN' : 'BORRADOR · PENDIENTE DE FIRMA');
    return doc.save({ useObjectStreams: !paraFirmar });
  }

  /**
   * Documento subido: el PDF original + una hoja de firmas al final (solo si se firma con la imagen guardada).
   */
  async function conHojaDeFirmas({ original, d, aj, firmas, logo, borrador }) {
    const { PDFDocument, rgb } = window.PDFLib;
    const doc = await PDFDocument.load(original, { ignoreEncryption: true });
    if (d.id) doc.setKeywords([marca(d.id)]);
    const F = await fuentes(doc);
    const logoImg = logo ? await doc.embedPng(logo) : null;
    const page = doc.addPage(A4);
    const [W, H] = A4;
    cabecera(page, F, logoImg);
    const tinta = rgb(0.08, 0.08, 0.08), lim = window.CertPDF.limpiarWinAnsi;
    let y = H - 170;
    const t = 'HOJA DE FIRMAS';
    page.drawText(t, { x: (W - F.b.widthOfTextAtSize(t, 15)) / 2, y, size: 15, font: F.b, color: tinta });
    y -= 34;
    const { res } = partir([{ t: 'Documento: ', b: true }, { t: d.titulo }], F, 10.5, W - 170);
    res.forEach(l => {
      let x = 85;
      l.ps.forEach(p => { page.drawText(p.w, { x, y, size: 10.5, font: p.f, color: tinta }); x += p.ancho + (p.esp ? F.r.widthOfTextAtSize(' ', 10.5) : 0); });
      y -= 15;
    });
    page.drawText(lim(F.r, 'Fecha del documento: ' + window.CertPDF.fechaLarga(d.fecha) + ' · ' + (doc.getPageCount() - 1) + ' página(s) más esta hoja.'), { x: 85, y, size: 10.5, font: F.r, color: tinta });
    y -= 22;
    page.drawText('Las firmantes dan su conformidad al documento que precede a esta hoja.', { x: 85, y, size: 10.5, font: F.r, color: tinta });
    await dibujarFirmas(doc, page, F, y - 50, d, aj, firmas, false, false);
    if (borrador) marcaBorrador(doc, F, 'PENDIENTE DE FIRMA');
    return doc.save({ useObjectStreams: false });
  }

  // ¿Este PDF es el de ese documento? Por la marca interna, o porque empieza igual que el PDF de partida
  // (AutoFirma y Acrobat añaden la firma al final sin tocar lo anterior)
  function esDelDocumento(bytes, id, referencia) {
    const m = marca(id), txt = window.CertPDF.latin1(bytes).toLowerCase();
    const hex = Array.from(m, ch => '00' + ch.charCodeAt(0).toString(16).padStart(2, '0')).join('');
    if (txt.includes(m) || txt.includes(hex)) return true;
    if (!referencia || bytes.length <= referencia.length) return false;
    const n = Math.min(referencia.length, 65536);
    for (let k = 0; k < n; k++) if (bytes[k] !== referencia[k]) return false;
    return true;
  }

  window.DocPDF = { acta, conHojaDeFirmas, esDelDocumento, bloques };
})();

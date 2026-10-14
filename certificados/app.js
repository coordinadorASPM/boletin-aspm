/* Certificados de donación ASPM — lógica de la herramienta.
   Este archivo es público: no contiene datos. Todo lo que muestra sale de Supabase y
   solo lo devuelve a las cuentas autorizadas (seguridad por filas en la base de datos). */
(function () {
  'use strict';

  const SB_URL = 'https://wvghcsshumbqhoecsjep.supabase.co';
  const SB_KEY = 'sb_publishable_KROMQrcTW7pyPSVpqOpyiw_Rd6hK2YT'; // clave pública (publishable)
  const INACTIVIDAD_MIN = 30;
  const PARTIDAS = ['7201001 DONACION', '7201007 ACC.SOL.'];

  const URL_WEB = 'https://coordinadoraspm.github.io/boletin-aspm/certificados/';
  // Si se llega desde el enlace del correo de recuperación, hay que pedir contraseña nueva
  // (se mira antes de crear el cliente, que limpia el enlace al leerlo)
  let RECUPERANDO = /type=recovery/.test(location.hash);

  // La sesión vive solo en esta pestaña: al cerrarla hay que volver a entrar
  const sb =window.supabase.createClient(SB_URL, SB_KEY, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true }
  });

  const ROL = {
    coordinadora: 'Coordinación',
    trabajadora_social: 'Trabajadora social',
    presidenta: 'Presidenta',
    secretaria: 'Secretaria'
  };
  const ESTADO = {
    pendiente: 'Pendiente de firma',
    firmado: 'Firmado · falta archivar',
    archivado: 'Firmado y archivado',
    anulado: 'Anulado'
  };

  // Documentos y actas
  const ESTADO_DOC = {
    revision: 'En revisión',
    pendiente: 'Pendiente de firma',
    firmado: 'Firmado · falta archivar',
    archivado: 'Firmado y archivado',
    anulado: 'Anulado'
  };
  const REVISORAS = ['coordinadora', 'secretaria', 'presidenta'];   // orden de revisión del acta
  const ROL_ART = { coordinadora: 'la coordinadora', secretaria: 'la secretaria', presidenta: 'la presidenta' };

  const S = { yo: null, perfiles: [], ajustes: {}, certs: [], docs: [], vista: 'pendientes', detalle: null, logo: null, busca: '', buscaDoc: '', editor: null };
  const $ = (sel, raiz) => (raiz || document).querySelector(sel);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const gestiona = () => S.yo && (S.yo.rol === 'coordinadora' || S.yo.rol === 'trabajadora_social');
  const firmante = () => S.yo && (S.yo.rol === 'presidenta' || S.yo.rol === 'secretaria');
  const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const fechaCorta = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
  const euros = n => window.CertPDF.importeNum(n) + ' €';

  /* =================== Acceso =================== */
  async function arrancar() {
    if (/error_code=|error=/.test(location.hash) && /type=recovery|otp_expired|access_denied/.test(location.hash)) {
      history.replaceState(null, '', location.pathname);
      return mostrarOlvido('El enlace ha caducado o ya se usó. Pide uno nuevo.');
    }
    const { data } = await sb.auth.getSession();
    if (data.session) await entrar();
    else if (location.hash === '#olvido') mostrarOlvido();
    else mostrarAcceso();
  }

  function mostrarOlvido(err) {
    $('#app').hidden = true; $('#acceso').hidden = true; $('#olvido').hidden = false;
    $('#okOlvido').hidden = true;
    $('#errOlvido').hidden = !err; $('#errOlvido').textContent = err || '';
    $('#emailOlvido').value = $('#email').value;
    $('#emailOlvido').focus();
  }
  $('#btnOlvido').onclick = () => mostrarOlvido();
  $('#btnVolverAcceso').onclick = () => { history.replaceState(null, '', location.pathname); mostrarAcceso(); };
  $('#formOlvido').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('#btnEnviarOlvido');
    btn.disabled = true; btn.textContent = 'Enviando…';
    const { error } = await sb.auth.resetPasswordForEmail($('#emailOlvido').value.trim(), { redirectTo: URL_WEB });
    btn.disabled = false; btn.textContent = 'Enviar enlace';
    if (error && /rate|seconds|limit/i.test(error.message)) {
      $('#errOlvido').textContent = 'Has pedido demasiados enlaces seguidos. Espera unos minutos y vuelve a probar.';
      $('#errOlvido').hidden = false; return;
    }
    // Mismo mensaje exista o no la cuenta, para no revelar qué correos tienen acceso
    $('#errOlvido').hidden = true;
    $('#okOlvido').textContent = 'Si ese correo tiene acceso, en unos minutos te llegará un enlace para poner una contraseña nueva.';
    $('#okOlvido').hidden = false;
  });

  function mostrarAcceso(msg) {
    $('#app').hidden = true; $('#app').innerHTML = '';
    $('#olvido').hidden = true;
    $('#acceso').hidden = false;
    const e = $('#errAcceso');
    e.hidden = !msg; e.textContent = msg || '';
    $('#email').focus();
  }

  $('#formAcceso').addEventListener('submit', async ev => {
    ev.preventDefault();
    const btn = $('#btnEntrar');
    btn.disabled = true; btn.textContent = 'Entrando…';
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#clave').value });
    btn.disabled = false; btn.textContent = 'Entrar';
    $('#clave').value = '';
    if (error) return mostrarAcceso('Correo o contraseña incorrectos.');
    await entrar();
  });

  async function entrar() {
    const { data: u } = await sb.auth.getUser();
    if (!u || !u.user) return mostrarAcceso();
    const { data: p } = await sb.from('perfiles').select('*').eq('id', u.user.id).maybeSingle();
    if (!p) {
      await sb.auth.signOut();
      return mostrarAcceso('Esta cuenta no tiene acceso a la herramienta.');
    }
    S.yo = p;
    $('#acceso').hidden = true; $('#olvido').hidden = true;
    $('#app').hidden = false;
    vigilarInactividad();
    if (p.debe_cambiar_clave || RECUPERANDO) return pedirClaveNueva();
    await continuarEntrada();
  }

  // Primera entrada con la contraseña provisional: hay que elegir una propia antes de ver nada
  function pedirClaveNueva() {
    $('#app').innerHTML = `<main class="acceso"><form class="tarjeta-acceso" id="formNueva" autocomplete="off">
      <div class="logo"><img src="../img/logo.png" alt="Asociación Síndrome Phelan-McDermid"></div>
      <h1>Elige tu contraseña</h1>
      <p class="sub">${RECUPERANDO ? 'Pon tu contraseña nueva' : 'Sustituye la contraseña provisional por una tuya'} (mínimo 10 caracteres).</p>
      <div class="error" id="errNueva" role="alert" hidden></div>
      <input type="text" autocomplete="username" value="${esc(S.yo.email)}" hidden readonly>
      <div class="campo"><label for="n1">Nueva contraseña</label><input type="password" id="n1" autocomplete="new-password" minlength="10" required></div>
      <div class="campo"><label for="n2">Repítela</label><input type="password" id="n2" autocomplete="new-password" minlength="10" required></div>
      <button class="btn primario grande" style="width:100%" type="submit" id="btnNueva">Guardar y entrar</button>
      <p class="nota-seg"><button class="btn sutil" type="button" id="btnSalirNueva">Salir</button></p>
    </form></main>`;
    $('#btnSalirNueva').onclick = () => salir();
    $('#n1').focus();
    $('#formNueva').onsubmit = async ev => {
      ev.preventDefault();
      const a = $('#n1').value, b = $('#n2').value, err = $('#errNueva');
      const fallo = m => { err.textContent = m; err.hidden = false; };
      if (a.length < 10) return fallo('La contraseña debe tener al menos 10 caracteres.');
      if (a !== b) return fallo('Las dos contraseñas no coinciden.');
      if (/^(\d)\1*$|^(0?123456789?0?|12345678|password|contraseña)/i.test(a)) return fallo('Esa contraseña es demasiado fácil. Elige otra.');
      $('#btnNueva').disabled = true;
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) { $('#btnNueva').disabled = false; return fallo('No se ha podido guardar: ' + error.message); }
      await sb.rpc('clave_cambiada');
      S.yo.debe_cambiar_clave = false;
      RECUPERANDO = false;
      history.replaceState(null, '', location.pathname);
      aviso('Contraseña guardada.');
      await continuarEntrada();
    };
  }

  async function continuarEntrada() {
    await cargarTodo();
    const m = /#c=([0-9a-f-]{36})/.exec(location.hash);
    const md = /#d=([0-9a-f-]{36})/.exec(location.hash);
    if (m) abrir(m[1]); else if (md) abrirDoc(md[1]); else { S.vista = 'pendientes'; pintar(); }
  }

  async function salir(msg) {
    await sb.auth.signOut();
    S.yo = null; S.certs = []; S.docs = []; S.perfiles = []; S.ajustes = {}; S.editor = null;
    history.replaceState(null, '', location.pathname);
    mostrarAcceso(msg);
  }

  let temporizador;
  function vigilarInactividad() {
    const reiniciar = () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(async () => {
        // Si había un acta a medio corregir, se guarda antes de cerrar la sesión
        if (S.editor && S.editor.sucio) { try { await S.editor.guardar(); } catch (e) {} }
        salir('Sesión cerrada por inactividad.' + (S.editor ? ' Tus cambios en el acta se han guardado.' : ''));
      }, INACTIVIDAD_MIN * 60000);
    };
    ['click', 'keydown', 'pointermove', 'scroll'].forEach(e => document.addEventListener(e, reiniciar, { passive: true }));
    reiniciar();
  }

  sb.auth.onAuthStateChange(ev => {
    if (ev === 'PASSWORD_RECOVERY') RECUPERANDO = true;
    if (ev === 'SIGNED_OUT' && S.yo) { S.yo = null; mostrarAcceso(); }
  });

  /* =================== Datos =================== */
  async function cargarTodo() {
    const [p, a, c, d] = await Promise.all([
      sb.from('perfiles').select('id,email,rol,firma_path,debe_cambiar_clave'),
      sb.from('ajustes').select('*').eq('id', 1).maybeSingle(),
      sb.from('certificados').select('*').order('creado', { ascending: false }),
      sb.from('documentos').select('*').order('creado', { ascending: false })
    ]);
    S.perfiles = p.data || [];
    S.ajustes = a.data || {};
    S.certs = c.data || [];
    S.docs = d.data || [];
    S.yo = S.perfiles.find(x => x.id === S.yo.id) || S.yo;
  }

  // Orden de firma: primero la secretaria; la presidenta, cuando la secretaria ya ha firmado
  const esperaSecretaria = c => c.firma_secretaria && !c.firmado_secretaria;
  function faltaMiFirma(c) {
    if (c.estado !== 'pendiente' || !firmante()) return false;
    return S.yo.rol === 'secretaria' ? esperaSecretaria(c)
                                     : c.firma_presidenta && !c.firmado_presidenta && !esperaSecretaria(c);
  }
  // Documentos: me toca revisar el acta o firmar (mismo orden de firma que los certificados)
  const faltaMiDoc = d => (d.estado === 'revision' && d.revisa === S.yo.rol) || faltaMiFirma(d);

  async function logo() {
    if (!S.logo) S.logo = new Uint8Array(await (await fetch('../img/logo.png')).arrayBuffer());
    return S.logo;
  }

  async function bytesFirma(path) {
    if (!path) return null;
    const { data, error } = await sb.storage.from('firmas').download(path);
    if (error) throw new Error('No se ha podido leer una firma');
    return new Uint8Array(await data.arrayBuffer());
  }

  // PDF guardado con firma digital (almacén privado «certificados»)
  async function bytesPdfFirmado(path) {
    const { data, error } = await sb.storage.from('certificados').download(path);
    if (error) throw new Error('No se ha podido leer el PDF firmado');
    return new Uint8Array(await data.arrayBuffer());
  }

  // Si ya hay firma digital, el PDF es el guardado (no se puede rehacer sin romper la firma).
  // paraFirmar: versión limpia para descargar y firmar con certificado digital.
  async function pdfDe(c, paraFirmar) {
    if (c.pdf_path) return bytesPdfFirmado(c.pdf_path);
    const completo = c.estado === 'firmado' || c.estado === 'archivado';
    const [lg, fp, fs] = await Promise.all([
      logo(),
      c.firmado_presidenta ? bytesFirma(c.firma_presidenta_path) : null,
      c.firmado_secretaria ? bytesFirma(c.firma_secretaria_path) : null
    ]);
    return window.CertPDF.generar({ c, aj: S.ajustes, firmas: { presidenta: fp, secretaria: fs }, logo: lg, borrador: !completo, paraFirmar });
  }

  const firmasHechas = c => (c.firmado_presidenta ? 1 : 0) + (c.firmado_secretaria ? 1 : 0);
  const nombrePdf = (c, pre) => (pre || '') + (c.numero ? c.numero + '.' : '') + 'Certificado donación ' + c.donante.replace(/[\\/:*?"<>|]/g, ' ') + '.pdf';
  function descargarBytes(bytes, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    a.download = nombre; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  // Lo que había cuando la firmante descargó el PDF: si cambia antes de subirlo, hay que volver a descargarlo
  const claveBase = id => 'aspm-base-' + id;
  function guardarBase(c) { try { sessionStorage.setItem(claveBase(c.id), JSON.stringify({ path: c.pdf_path || null, previas: firmasHechas(c) })); } catch (e) {} }
  function leerBase(c) {
    try { const b = JSON.parse(sessionStorage.getItem(claveBase(c.id))); if (b) return b; } catch (e) {}
    return { path: c.pdf_path || null, previas: firmasHechas(c) };
  }

  function aBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function google(accion, extra) {
    const url = S.ajustes.apps_script_url;
    if (!url) throw new Error('Falta conectar Google (Ajustes → URL del script de Google).');
    const { data } = await sb.auth.getSession();
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ accion, token: data.session.access_token }, extra || {}))
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Error en el script de Google');
    return j;
  }

  /* =================== Pintado general =================== */
  function pintar() {
    if (S.vista !== 'doc') S.editor = null;
    const pendMiasCert = S.certs.filter(faltaMiFirma).length;
    const docsMios = S.docs.filter(faltaMiDoc).length;
    const pendMias = pendMiasCert + docsMios;
    const pendTodas = S.certs.filter(c => c.estado === 'pendiente').length + S.docs.filter(d => d.estado === 'revision' || d.estado === 'pendiente').length;
    const sinArchivar = S.certs.filter(c => c.estado === 'firmado').length + S.docs.filter(d => d.tipo === 'acta' && d.estado === 'firmado').length;
    document.title = (pendMias ? '(' + pendMias + ') ' : '') + 'Certificados y firmas ASPM';

    const tabs = [['pendientes', firmante() ? 'Pendientes' : 'En curso', firmante() ? pendMias : pendTodas]];
    if (gestiona()) tabs.push(['nuevo', 'Nuevo certificado', 0]);
    tabs.push(['todos', 'Certificados', 0], ['documentos', 'Documentos y actas', firmante() ? 0 : docsMios], ['perfil', 'Mi perfil', 0]);
    if (gestiona()) tabs.push(['ajustes', 'Ajustes', 0]);

    const actual = { detalle: 'todos', editar: 'todos', doc: 'documentos', nuevodoc: 'documentos', nuevaacta: 'documentos' }[S.vista] || S.vista;
    $('#app').innerHTML = `
      <header class="top"><div class="wrap">
        <span class="logo"><img src="../img/logo.png" alt="Asociación Síndrome Phelan-McDermid"></span>
        <div class="titulo"><h1>Certificados y firmas</h1><p>Certificados de donación, documentos para firmar y actas de la junta</p></div>
        <div class="quien">${S.yo.rol === 'coordinadora' ? '<a class="btn" href="../">Menú</a>' : ''}<span class="chip">${esc(ROL[S.yo.rol])} · ${esc(S.yo.email)}</span>
          <button class="btn sutil" type="button" id="btnSalir">Salir</button></div>
      </div></header>
      <nav class="vistas" aria-label="Secciones"><div class="wrap">
        ${tabs.map(([k, t, n]) => `<button class="vista" type="button" data-v="${k}" ${actual === k ? 'aria-current="page"' : ''}>${esc(t)}${n ? `<span class="n">${n}</span>` : ''}</button>`).join('')}
      </div></nav>
      <main class="contenido wrap" id="cont"></main>`;
    $('#btnSalir').onclick = async () => { if (await puedoSalir()) salir(); };
    document.querySelectorAll('.vista').forEach(b => b.onclick = async () => {
      if (!await puedoSalir()) return;
      S.vista = b.dataset.v; history.replaceState(null, '', location.pathname); pintar();
    });

    const cont = $('#cont');
    const avisos = [];
    const enDetalle = S.vista === 'pendientes' || S.vista === 'detalle' || S.vista === 'doc';
    if (firmante() && pendMias && !enDetalle) avisos.push(`<div class="aviso ambar">Tienes ${pendMias} documento${pendMias > 1 ? 's' : ''} pendiente${pendMias > 1 ? 's' : ''} de firmar o revisar. <button class="btn" data-ir="pendientes" type="button">Ver</button></div>`);
    if (gestiona() && docsMios && !enDetalle) avisos.push(`<div class="aviso ambar">Tienes ${docsMios} acta${docsMios > 1 ? 's' : ''} pendiente${docsMios > 1 ? 's' : ''} de revisar. <button class="btn" data-ir="pendientes" type="button">Ver</button></div>`);
    if (gestiona() && !S.ajustes.apps_script_url) avisos.push(`<div class="aviso rojo">Falta conectar Google: sin eso no se envían los correos ni se archiva en Drive. <button class="btn" data-ir="ajustes" type="button">Ir a Ajustes</button></div>`);
    if (gestiona() && sinArchivar) avisos.push(`<div class="aviso rojo">${sinArchivar} documento${sinArchivar > 1 ? 's' : ''} firmado${sinArchivar > 1 ? 's' : ''} sin archivar en Drive. Ábrelo y pulsa «Archivar ahora».</div>`);
    cont.innerHTML = avisos.join('');
    cont.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => { S.vista = b.dataset.ir; pintar(); });

    const zona = document.createElement('div');
    cont.appendChild(zona);
    ({ pendientes: vPendientes, nuevo: vFormulario, editar: vFormulario, todos: vTodos, perfil: vPerfil, ajustes: vAjustes, detalle: vDetalle,
       documentos: vDocumentos, nuevodoc: vNuevoDoc, nuevaacta: vNuevaActa, doc: vDoc }[S.vista] || vPendientes)(zona);
  }

  // Si hay un acta con cambios sin guardar, pregunta antes de irse
  async function puedoSalir() {
    if (!S.editor || !S.editor.sucio) return true;
    return confirmar('Cambios sin guardar', 'Has corregido el acta y no has guardado. Si sales ahora, se perderán esos cambios.');
  }
  window.addEventListener('beforeunload', e => { if (S.editor && S.editor.sucio) { e.preventDefault(); e.returnValue = ''; } });

  function filaCert(c) {
    return `<button class="fila" type="button" data-id="${c.id}">
      <span class="num">${c.numero ? 'N.º ' + c.numero : '—'}</span>
      <span><span class="don">${esc(c.donante)}</span><br><span class="meta">${c.tipo === 'especie' ? 'En especie' : 'Económica'} · donación del ${fechaCorta(c.fecha_donacion)} · creado el ${fechaCorta(c.creado)}</span></span>
      <span class="imp">${euros(c.importe)}<br><span class="estado ${c.estado}">${ESTADO[c.estado]}</span></span>
    </button>`;
  }
  function enlazarFilas(el) { el.querySelectorAll('.fila').forEach(b => b.onclick = () => b.dataset.doc ? abrirDoc(b.dataset.doc) : abrir(b.dataset.id)); }

  /* =================== Vistas =================== */
  function vPendientes(el) {
    const certs = firmante() ? S.certs.filter(faltaMiFirma) : S.certs.filter(c => c.estado === 'pendiente' || c.estado === 'firmado');
    const docs = firmante() ? S.docs.filter(faltaMiDoc) : S.docs.filter(d => ['revision', 'pendiente'].includes(d.estado) || (d.tipo === 'acta' && d.estado === 'firmado'));
    el.innerHTML = `<section class="panel">
      <h2>${firmante() ? 'Documentos y actas pendientes' : 'Documentos y actas en curso'}</h2>
      <p class="sub">${firmante() ? 'Actas que te toca revisar y documentos que esperan tu firma.' : 'Actas en revisión y documentos que esperan alguna firma o el archivo en Drive.'}</p>
      <div class="lista">${docs.map(filaDoc).join('') || `<div class="vacio">${firmante() ? 'No tienes nada pendiente.' : 'No hay documentos ni actas en curso.'}</div>`}</div>
    </section>
    <section class="panel">
      <h2>${firmante() ? 'Certificados pendientes de mi firma' : 'Certificados en curso'}</h2>
      <p class="sub">${firmante() ? 'Certificados que esperan tu firma. Ábrelos para revisarlos y firmar.' : 'Certificados que aún esperan alguna firma o el archivo en Drive.'}</p>
      <div class="lista">${certs.map(filaCert).join('') || `<div class="vacio">${firmante() ? 'No tienes certificados pendientes de firmar.' : 'No hay certificados en curso.'}</div>`}</div>
    </section>`;
    enlazarFilas(el);
  }

  function vTodos(el) {
    el.innerHTML = `<section class="panel"><h2>Todos los certificados</h2>
      <p class="sub">${S.certs.length} en total.</p>
      <input class="buscador" type="text" id="busca" placeholder="Buscar por donante, NIF o número" value="${esc(S.busca)}" aria-label="Buscar">
      <div class="lista" id="listaTodos"></div></section>`;
    const pintarLista = () => {
      const q = S.busca.toLowerCase();
      const l = S.certs.filter(c => !q || [c.donante, c.nif, c.numero].join(' ').toLowerCase().includes(q));
      $('#listaTodos').innerHTML = l.map(filaCert).join('') || '<div class="vacio">Sin resultados.</div>';
      enlazarFilas($('#listaTodos'));
    };
    $('#busca').oninput = e => { S.busca = e.target.value; pintarLista(); };
    pintarLista();
  }

  /* ---------- Nuevo / editar ---------- */
  function vFormulario(el) {
    const ed = S.vista === 'editar' ? S.certs.find(c => c.id === S.detalle) : null;
    const v = ed || { tipo: 'dineraria', ejercicio: new Date().getFullYear(), fecha_emision: hoyISO(), fecha_donacion: '', cuenta: 'BBVA', partida: PARTIDAS[0], firma_presidenta: true, firma_secretaria: true };
    el.innerHTML = `<form class="panel" id="formCert" novalidate>
      <h2>${ed ? 'Corregir certificado' : 'Nuevo certificado de donación'}</h2>
      <p class="sub">${ed ? 'Solo se puede corregir mientras nadie lo haya firmado.' : 'Rellena los datos. Al crearlo, se avisará por correo a quien tenga que firmar.'}</p>
      <div class="error" id="errForm" hidden></div>

      <h3>Donante</h3>
      <div class="rejilla">
        <div class="campo ancho"><label for="f_donante">Nombre o razón social *</label><input type="text" id="f_donante" required value="${esc(v.donante)}"></div>
        <div class="campo"><label for="f_nif">NIF / CIF *</label><input type="text" id="f_nif" required value="${esc(v.nif)}" autocomplete="off"><span class="ayuda" id="nifAyuda"></span></div>
        <div class="campo"><label for="f_domicilio">Domicilio *</label><input type="text" id="f_domicilio" required value="${esc(v.domicilio)}"></div>
      </div>
      <div class="campo"><span class="et">Tipo de donante *</span>
        <div class="opciones">
          <label class="opcion"><input type="radio" name="tipo_donante" value="PF" ${v.tipo_donante === 'PF' ? 'checked' : ''}><span><b>Persona física (PF)</b><span>Particular, con DNI o NIE</span></span></label>
          <label class="opcion"><input type="radio" name="tipo_donante" value="PJ" ${v.tipo_donante === 'PJ' ? 'checked' : ''}><span><b>Persona jurídica (PJ)</b><span>Empresa, fundación, asociación… con CIF</span></span></label>
        </div><span class="ayuda" id="tdAyuda"></span></div>

      <h3>Donación</h3>
      <div class="campo"><span class="et">Tipo de donación *</span>
        <div class="opciones">
          <label class="opcion"><input type="radio" name="tipo" value="dineraria" ${v.tipo !== 'especie' ? 'checked' : ''}><span><b>Económica</b><span>«una donación de XXXX €»</span></span></label>
          <label class="opcion"><input type="radio" name="tipo" value="especie" ${v.tipo === 'especie' ? 'checked' : ''}><span><b>En especie</b><span>«una donación en especie valorada en XXXX €»</span></span></label>
        </div></div>
      <div class="rejilla">
        <div class="campo"><label for="f_importe" id="lblImporte">Importe (€) *</label><input type="number" id="f_importe" min="0.01" step="0.01" inputmode="decimal" required value="${v.importe || ''}"><div class="letra" id="enLetra"></div></div>
        <div class="campo"><label for="f_fdon">Fecha de la donación *</label><input type="date" id="f_fdon" required value="${esc(v.fecha_donacion)}"></div>
        <div class="campo"><label for="f_femi">Fecha del certificado *</label><input type="date" id="f_femi" required value="${esc(v.fecha_emision)}"><span class="ayuda">La que aparece en «firmo el presente documento…».</span></div>
      </div>

      <h3>Quién firma</h3>
      <p class="sub" style="margin:-4px 0 10px;font-size:13.5px;color:var(--muted)">Si firman las dos, primero la secretaria y después la presidenta, que recibe el aviso cuando la secretaria ya ha firmado.</p>
      <div class="opciones">
        <label class="opcion"><input type="checkbox" id="f_fsec" ${v.firma_secretaria ? 'checked' : ''}><span><b>1. Secretaria</b><span>Certifica y firma primero</span></span></label>
        <label class="opcion"><input type="checkbox" id="f_fpre" ${v.firma_presidenta ? 'checked' : ''}><span><b>2. Presidenta</b><span>Firma después</span></span></label>
      </div>

      <details class="plegable" ${ed ? 'open' : ''} style="margin-top:18px"><summary>Datos para la hoja de ingresos (opcional)</summary>
      <div class="rejilla">
        <div class="campo"><label for="f_cuenta">Cuenta de ingreso</label><input type="text" id="f_cuenta" value="${esc(v.cuenta)}"></div>
        <div class="campo"><label for="f_partida">Partida</label><input type="text" id="f_partida" list="partidas" value="${esc(v.partida)}"><datalist id="partidas">${PARTIDAS.map(p => `<option value="${esc(p)}">`).join('')}</datalist></div>
        <div class="campo"><label for="f_proyecto">Proyecto</label><input type="text" id="f_proyecto" value="${esc(v.proyecto)}"></div>
        <div class="campo"><label for="f_obs">Observaciones</label><input type="text" id="f_obs" value="${esc(v.observaciones)}"></div>
      </div></details>

      <h3>Así quedará el texto</h3>
      <div class="vista-previa" id="previa"></div>

      <div class="acciones">
        <button class="btn primario grande" type="submit" id="btnGuardar">${ed ? 'Guardar cambios' : 'Crear y enviar a firmar'}</button>
        <button class="btn" type="button" id="btnVerPdf">Ver borrador en PDF</button>
        ${ed ? '<button class="btn sutil" type="button" id="btnVolver">Cancelar</button>' : ''}
      </div>
    </form>`;

    const f = $('#formCert');
    const leer = () => ({
      donante: $('#f_donante').value.trim(), nif: $('#f_nif').value.trim().toUpperCase().replace(/\s+/g, ''),
      domicilio: $('#f_domicilio').value.trim(), tipo: f.tipo.value, tipo_donante: f.tipo_donante.value || null,
      importe: parseFloat($('#f_importe').value), fecha_donacion: $('#f_fdon').value,
      ejercicio: parseInt($('#f_fdon').value.slice(0, 4), 10) || null, fecha_emision: $('#f_femi').value,
      firma_secretaria: $('#f_fsec').checked, firma_presidenta: $('#f_fpre').checked,
      cuenta: $('#f_cuenta').value.trim() || null, partida: $('#f_partida').value.trim() || null,
      proyecto: $('#f_proyecto').value.trim() || null, observaciones: $('#f_obs').value.trim() || null
    });
    const actualizar = () => {
      const d = leer();
      $('#lblImporte').textContent = d.tipo === 'especie' ? 'Valoración (€) *' : 'Importe (€) *';
      $('#enLetra').textContent = d.importe > 0 ? window.CertPDF.importeEnLetra(d.importe) : '';
      $('#nifAyuda').textContent = d.nif && !nifValido(d.nif) ? 'Revisa el formato: no parece un NIF/CIF español válido.' : '';
      const ph = { donante: d.donante || '[donante]', nif: d.nif || '[NIF]', domicilio: d.domicilio || '[domicilio]',
        importe: d.importe > 0 ? d.importe : 0, fecha_donacion: d.fecha_donacion || hoyISO(), fecha_emision: d.fecha_emision || hoyISO(),
        ejercicio: d.ejercicio || '[ejercicio]', tipo: d.tipo, firma_secretaria: d.firma_secretaria || !d.firma_presidenta, firma_presidenta: d.firma_presidenta };
      const t = window.CertPDF.textos(ph, S.ajustes);
      $('#previa').innerHTML = `<p>${t.encabezado.map(x => x.b ? '<b>' + esc(x.t) + '</b>' : esc(x.t)).join('')}</p><p class="cert">CERTIFICA</p>${t.cuerpo.map(p => '<p>' + esc(p) + '</p>').join('')}`;
    };
    $('#f_fdon').addEventListener('change', actualizar);
    f.addEventListener('input', actualizar);
    // PF/PJ: se propone según el NIF (DNI/NIE → PF; CIF → PJ). Se puede cambiar a mano.
    let tdManual = !!v.tipo_donante;
    f.querySelectorAll('[name=tipo_donante]').forEach(r => r.addEventListener('change', () => { tdManual = true; $('#tdAyuda').textContent = ''; }));
    $('#f_nif').addEventListener('input', () => {
      if (tdManual) return;
      const td = tipoPorNif($('#f_nif').value.trim().toUpperCase().replace(/\s+/g, ''));
      f.querySelectorAll('[name=tipo_donante]').forEach(r => { r.checked = r.value === td; });
      $('#tdAyuda').textContent = td ? 'Marcado según el NIF. Cámbialo si no es correcto.' : '';
    });
    actualizar();
    if (ed) $('#btnVolver').onclick = () => abrir(ed.id);

    $('#btnVerPdf').onclick = async () => {
      const d = leer();
      const err = validar(d);
      if (err) return mostrarError(err);
      verPdfNuevaPestana(await pdfDe(Object.assign({ estado: 'pendiente' }, d)));
    };

    f.addEventListener('submit', async ev => {
      ev.preventDefault();
      const d = leer();
      const err = validar(d);
      if (err) return mostrarError(err);
      const btn = $('#btnGuardar');
      btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        let id;
        if (ed) {
          const { error } = await sb.from('certificados').update(d).eq('id', ed.id);
          if (error) throw error;
          id = ed.id;
        } else {
          const { data, error } = await sb.from('certificados').insert(d).select('id').single();
          if (error) throw error;
          id = data.id;
          try {
            const r = await google('avisar', { id });
            aviso(r.enviados ? 'Certificado creado. Aviso enviado a ' + (d.firma_presidenta ? 'la presidenta' : 'la secretaria') + '.' : 'Certificado creado, pero no se ha enviado ningún aviso.');
          } catch (e) {
            aviso('Certificado creado, pero no se ha podido enviar el correo: ' + e.message);
          }
        }
        await cargarTodo();
        abrir(id);
        if (ed) aviso('Cambios guardados.');
      } catch (e) {
        btn.disabled = false; btn.textContent = ed ? 'Guardar cambios' : 'Crear y enviar a firmar';
        mostrarError(e.message);
      }
    });
    function mostrarError(m) { const e = $('#errForm'); e.textContent = m; e.hidden = false; e.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  function validar(d) {
    if (!d.donante || !d.nif || !d.domicilio) return 'Faltan datos del donante (nombre, NIF y domicilio).';
    if (!d.tipo_donante) return 'Indica si el donante es persona física (PF) o jurídica (PJ).';
    if (!(d.importe > 0)) return 'El importe tiene que ser mayor que 0.';
    if (!d.fecha_donacion) return 'Falta la fecha de la donación.';
    if (!d.fecha_emision) return 'Falta la fecha del certificado.';
    if (!d.firma_secretaria && !d.firma_presidenta) return 'Marca al menos una firmante.';
    return '';
  }

  // DNI (8 cifras + letra) o NIE (X/Y/Z…) → persona física; CIF (empieza por letra de entidad) → persona jurídica
  function tipoPorNif(n) {
    if (/^\d{7,8}-?[A-Z]$/.test(n) || /^[XYZKLM]\d{7}-?[A-Z]$/.test(n)) return 'PF';
    if (/^[ABCDEFGHJNPQRSUVW]-?\d{7}[0-9A-J]?/.test(n)) return 'PJ';
    return '';
  }

  function nifValido(n) {
    const letras = 'TRWAGMYFPDXBNJZSQVHLCKE';
    if (/^\d{8}[A-Z]$/.test(n)) return letras[parseInt(n.slice(0, 8), 10) % 23] === n[8];
    if (/^[XYZ]\d{7}[A-Z]$/.test(n)) return letras[parseInt('XYZ'.indexOf(n[0]) + n.slice(1, 8), 10) % 23] === n[8];
    return /^[ABCDEFGHJNPQRSUVW]-?\d{7}[0-9A-J]$/.test(n);
  }

  /* ---------- Detalle ---------- */
  function abrir(id) {
    S.detalle = id; S.vista = 'detalle';
    history.replaceState(null, '', '#c=' + id);
    pintar();
    window.scrollTo(0, 0);
  }

  function vDetalle(el) {
    const c = S.certs.find(x => x.id === S.detalle);
    if (!c) { el.innerHTML = '<div class="panel vacio">Este certificado no existe o no tienes acceso.</div>'; return; }
    const filasFirma = [];
    if (c.firma_secretaria) filasFirma.push(['Secretaria', c.firmado_secretaria, 'Pendiente de firma (firma primero)']);
    if (c.firma_presidenta) filasFirma.push(['Presidenta', c.firmado_presidenta, esperaSecretaria(c) ? 'Firmará cuando lo haya firmado la secretaria' : 'Pendiente de firma']);
    const puedoFirmar = faltaMiFirma(c);
    const completo = c.estado === 'firmado' || c.estado === 'archivado';
    const sinFirmas = !c.firmado_presidenta && !c.firmado_secretaria;

    el.innerHTML = `<div class="acciones" style="margin:0 0 14px"><button class="btn sutil" type="button" id="btnAtras">← Volver</button></div>
    <div class="detalle">
      <section class="panel">
        <h2>${c.numero ? 'Certificado n.º ' + c.numero : 'Certificado de donación'}</h2>
        <p class="sub"><span class="estado ${c.estado}">${ESTADO[c.estado]}</span></p>
        <dl class="datos">
          <dt>Donante</dt><dd>${esc(c.donante)}</dd>
          <dt>NIF / CIF</dt><dd>${esc(c.nif)}${c.tipo_donante ? ' · ' + (c.tipo_donante === 'PF' ? 'persona física (PF)' : 'persona jurídica (PJ)') : ''}</dd>
          <dt>Domicilio</dt><dd>${esc(c.domicilio)}</dd>
          <dt>${c.tipo === 'especie' ? 'Valoración' : 'Importe'}</dt><dd><b>${euros(c.importe)}</b> · ${c.tipo === 'especie' ? 'en especie' : 'económica'}</dd>
          <dt>Fecha donación</dt><dd>${fechaCorta(c.fecha_donacion)}</dd>
          <dt>Fecha certificado</dt><dd>${fechaCorta(c.fecha_emision)}</dd>
          ${c.partida ? `<dt>Partida</dt><dd>${esc(c.partida)}</dd>` : ''}
          ${c.proyecto ? `<dt>Proyecto</dt><dd>${esc(c.proyecto)}</dd>` : ''}
          ${c.observaciones ? `<dt>Observaciones</dt><dd>${esc(c.observaciones)}</dd>` : ''}
          ${c.drive_url ? `<dt>Drive</dt><dd><a href="${esc(c.drive_url)}" target="_blank" rel="noopener">Abrir el PDF archivado</a></dd>` : ''}
        </dl>
        <div class="firmantes">${filasFirma.map(([cargo, cuando, falta]) => `<div class="firmante ${cuando ? 'hecho' : 'falta'}"><span class="ico">${cuando ? '✓' : '…'}</span><span><b>${cargo}</b><small>${cuando ? 'Firmado el ' + new Date(cuando).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : (c.estado === 'pendiente' ? falta : 'Sin firmar')}</small></span></div>`).join('')}</div>
        ${S.yo.rol === 'presidenta' && c.estado === 'pendiente' && c.firma_presidenta && !c.firmado_presidenta && esperaSecretaria(c)
          ? '<div class="aviso info" style="margin-top:14px">Primero lo firma la secretaria. Te llegará un aviso por correo cuando lo haya hecho.</div>' : ''}

        ${puedoFirmar ? `<div class="firmar-caja">
          <h3 style="margin-top:0">Firmar con certificado digital</h3>
          <ol class="pasos">
            <li><button class="btn primario" type="button" id="btnBajarFirmar">Descargar PDF para firmar</button></li>
            <li>Fírmalo en tu ordenador con tu certificado digital (AutoFirma o Adobe Acrobat) y guárdalo.</li>
            <li><label class="btn primario" for="pdfFirmado">Subir PDF firmado</label><input type="file" id="pdfFirmado" accept="application/pdf,.pdf" hidden></li>
          </ol>
          ${c.pdf_path ? '<p class="nota">Este certificado ya lleva una firma digital: descarga el PDF y añade la tuya encima.</p>'
            : S.yo.firma_path
              ? `<details class="plegable"><summary>O firmar con tu firma guardada (imagen)</summary><p>Se añadirá tu firma guardada y la fecha y hora de hoy.</p><button class="btn" type="button" id="btnFirmar">Firmar con un clic</button></details>`
              : ''}
        </div>` : ''}

        <div class="acciones">
          ${completo ? '<button class="btn primario" type="button" id="btnDescargar">Descargar PDF firmado</button>' : ''}
          ${gestiona() && c.estado === 'firmado' ? '<button class="btn primario" type="button" id="btnArchivar">Archivar ahora en Drive y en la hoja</button>' : ''}
          ${gestiona() && c.estado === 'pendiente' ? '<button class="btn" type="button" id="btnReavisar">Reenviar aviso por correo</button>' : ''}
          ${gestiona() && c.estado === 'pendiente' && sinFirmas ? '<button class="btn" type="button" id="btnEditar">Corregir datos</button><button class="btn no" type="button" id="btnAnular">Anular</button>' : ''}
        </div>
      </section>
      <section class="panel"><h2 style="margin-bottom:12px">${completo ? 'Certificado firmado' : c.pdf_path ? 'PDF con firma digital (falta otra firma)' : 'Vista previa (borrador)'}</h2><iframe class="visor" id="visor" title="Vista previa del certificado"></iframe></section>
    </div>`;

    $('#btnAtras').onclick = () => { S.vista = firmante() ? 'pendientes' : 'todos'; history.replaceState(null, '', location.pathname); pintar(); };
    el.querySelectorAll('[data-ir]').forEach(b => b.onclick = () => { S.vista = b.dataset.ir; pintar(); });
    pdfDe(c).then(b => { $('#visor') && ($('#visor').src = URL.createObjectURL(new Blob([b], { type: 'application/pdf' })) + '#view=FitH'); })
      .catch(e => aviso('No se ha podido generar la vista previa: ' + e.message));

    const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = () => fn(b); };
    on('#btnFirmar', async b => {
      if (!await confirmar('Firmar certificado', `Vas a firmar como ${ROL[S.yo.rol].toLowerCase()} el certificado de ${c.donante} por ${euros(c.importe)}.`)) return;
      b.disabled = true; b.textContent = 'Firmando…';
      const { data, error } = await sb.rpc('firmar', { p_id: c.id });
      if (error) { b.disabled = false; b.textContent = 'Firmar con un clic'; return aviso(error.message); }
      await trasFirmar(data);
    });
    async function trasFirmar(data) {
      await cargarTodo();
      if (data.estado === 'firmado') {
        aviso('Firmado. Ya están todas las firmas: archivando en Drive…');
        await archivar(data.id, true);
      } else {
        // Le toca a la siguiente firmante: se le avisa ahora
        try {
          const r = await google('avisar', { id: data.id });
          aviso('Firmado. ' + (r.enviados ? 'Se ha avisado por correo a la presidenta para que firme.' : 'Falta la otra firma.'));
        } catch (e) {
          aviso('Firmado, pero no se ha podido avisar a la presidenta: ' + e.message + ' La coordinación puede reenviar el aviso.');
        }
      }
      abrir(c.id);
    }

    on('#btnBajarFirmar', async b => {
      b.disabled = true;
      try {
        await cargarTodo();
        const actual = S.certs.find(x => x.id === c.id) || c;
        const bytes = await pdfDe(actual, true);
        guardarBase(actual);
        descargarBytes(bytes, nombrePdf(actual, 'Para firmar - '));
        aviso('Descargado. Fírmalo con tu certificado digital y súbelo con «Subir PDF firmado».');
      } catch (e) { aviso('No se ha podido descargar: ' + e.message); }
      b.disabled = false;
    });

    const entradaPdf = $('#pdfFirmado');
    if (entradaPdf) entradaPdf.onchange = async () => {
      const file = entradaPdf.files[0];
      entradaPdf.value = '';
      if (!file) return;
      const etiqueta = $('label[for="pdfFirmado"]');
      try {
        if (file.size > 15 * 1024 * 1024) throw new Error('El archivo pesa más de 15 MB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!window.CertPDF.esPdf(bytes)) throw new Error('Ese archivo no es un PDF.');
        const antes = c.pdf_path ? window.CertPDF.contarFirmas(await bytesPdfFirmado(c.pdf_path)) : 0;
        if (window.CertPDF.contarFirmas(bytes) <= antes) {
          throw new Error('Ese PDF no lleva tu firma digital. Fírmalo con tu certificado (AutoFirma o Acrobat), guárdalo y súbelo de nuevo.');
        }
        if (!window.CertPDF.llevaMarca(bytes, c.id) &&
            !await confirmar('¿Es el PDF correcto?', `No reconozco este archivo como el certificado de ${c.donante} por ${euros(c.importe)}. Súbelo solo si estás segura de que es el de este certificado.`)) return;
        etiqueta.textContent = 'Subiendo…';
        const base = leerBase(c);
        const ruta = c.id + '/' + Date.now() + '-' + S.yo.rol + '.pdf';
        const up = await sb.storage.from('certificados').upload(ruta, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
        if (up.error) throw up.error;
        const { data, error } = await sb.rpc('firmar_pdf', { p_id: c.id, p_path: ruta, p_base: base.path, p_previas: base.previas });
        if (error) throw error;
        try { sessionStorage.removeItem(claveBase(c.id)); } catch (e) {}
        await trasFirmar(data);
      } catch (e) {
        etiqueta.textContent = 'Subir PDF firmado';
        aviso(e.message);
      }
    };
    on('#btnArchivar', async b => { b.disabled = true; b.textContent = 'Archivando…'; await archivar(c.id); await cargarTodo(); abrir(c.id); });
    on('#btnDescargar', async () => descargarBytes(await pdfDe(c), nombrePdf(c)));
    on('#btnReavisar', async b => {
      b.disabled = true;
      try { const r = await google('avisar', { id: c.id }); aviso(r.enviados ? 'Aviso reenviado a ' + (esperaSecretaria(c) ? 'la secretaria' : 'la presidenta') + '.' : 'No había nadie a quien avisar.'); }
      catch (e) { aviso(e.message); }
      b.disabled = false;
    });
    on('#btnEditar', () => { S.vista = 'editar'; pintar(); });
    on('#btnAnular', async () => {
      if (!await confirmar('Anular certificado', 'Quedará marcado como anulado y no se podrá firmar. No consume número.')) return;
      const { error } = await sb.rpc('anular', { p_id: c.id });
      if (error) return aviso(error.message);
      await cargarTodo(); abrir(c.id); aviso('Certificado anulado.');
    });
  }

  async function archivar(id, silencioso) {
    try {
      await cargarTodo();
      const c = S.certs.find(x => x.id === id);
      const bytes = await pdfDe(c);
      const r = await google('archivar', { id, pdf: aBase64(new Uint8Array(bytes)) });
      aviso('Archivado en Drive como n.º ' + r.numero + ' y añadido a la hoja de ingresos.');
    } catch (e) {
      aviso((silencioso ? 'Firmado, pero no se ha podido archivar: ' : 'No se ha podido archivar: ') + e.message + ' La coordinación puede reintentarlo.');
    }
  }

  function verPdfNuevaPestana(bytes) {
    const w = window.open();
    if (w) w.location = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }

  /* =================== Documentos para firmar y actas de la junta =================== */
  const quienFirma = d => [d.firma_secretaria && 'secretaria', d.firma_presidenta && 'presidenta'].filter(Boolean).join(' y ');
  function estadoDoc(d) {
    if (d.estado === 'revision') return 'En revisión · ' + ROL[d.revisa].toLowerCase();
    if (d.tipo !== 'acta' && d.estado === 'firmado') return 'Firmado';   // los documentos no se archivan en Drive: se descargan
    return ESTADO_DOC[d.estado];
  }
  function filaDoc(d) {
    const mio = S.yo && faltaMiDoc(d);
    return `<button class="fila" type="button" data-doc="${d.id}">
      <span class="num">${d.tipo === 'acta' ? 'Acta' : 'Doc.'}</span>
      <span><span class="don">${esc(d.titulo)}</span><br><span class="meta">${d.tipo === 'acta' ? 'Reunión del ' : 'Fecha: '}${fechaCorta(d.fecha)} · firma${d.firma_secretaria && d.firma_presidenta ? 'n' : ''} ${quienFirma(d)}</span></span>
      <span class="imp"><span class="estado ${d.estado}">${esc(estadoDoc(d))}</span>${mio ? '<br><span class="meta" style="color:var(--warn);font-weight:700">Te toca</span>' : ''}</span>
    </button>`;
  }

  function abrirDoc(id) {
    S.docDetalle = id; S.vista = 'doc'; S.editor = null;
    history.replaceState(null, '', '#d=' + id);
    pintar();
    window.scrollTo(0, 0);
  }

  function vDocumentos(el) {
    el.innerHTML = `<section class="panel"><h2>Documentos y actas</h2>
      <p class="sub">Documentos subidos para que los firmen la secretaria, la presidenta o las dos, y actas de la junta directiva
        (revisión: coordinadora → secretaria → presidenta; firma: secretaria → presidenta).</p>
      ${gestiona() ? `<div class="acciones" style="margin:0 0 16px">
        <button class="btn primario" type="button" id="btnNuevoDoc">Subir documento para firmar</button>
        <button class="btn primario" type="button" id="btnNuevaActa">Nueva acta</button></div>` : ''}
      <input class="buscador" type="text" id="buscaDoc" placeholder="Buscar por título" value="${esc(S.buscaDoc)}" aria-label="Buscar">
      <div class="lista" id="listaDocs"></div></section>`;
    const pintarLista = () => {
      const q = S.buscaDoc.toLowerCase();
      const l = S.docs.filter(d => !q || d.titulo.toLowerCase().includes(q));
      $('#listaDocs').innerHTML = l.map(filaDoc).join('') || `<div class="vacio">${S.docs.length ? 'Sin resultados.' : 'Todavía no hay documentos ni actas.'}</div>`;
      enlazarFilas($('#listaDocs'));
    };
    $('#buscaDoc').oninput = e => { S.buscaDoc = e.target.value; pintarLista(); };
    pintarLista();
    if (gestiona()) {
      $('#btnNuevoDoc').onclick = () => { S.vista = 'nuevodoc'; pintar(); };
      $('#btnNuevaActa').onclick = () => { S.vista = 'nuevaacta'; pintar(); };
    }
  }

  const opcionesFirma = (sec, pre) => `
    <h3>Quién firma</h3>
    <p class="sub" style="margin:-4px 0 10px;font-size:13.5px;color:var(--muted)">Si firman las dos, primero la secretaria y después la presidenta, que recibe el aviso cuando la secretaria ya ha firmado.</p>
    <div class="opciones">
      <label class="opcion"><input type="checkbox" id="f_fsec" ${sec ? 'checked' : ''}><span><b>1. Secretaria</b><span>Firma primero</span></span></label>
      <label class="opcion"><input type="checkbox" id="f_fpre" ${pre ? 'checked' : ''}><span><b>2. Presidenta</b><span>Firma después</span></span></label>
    </div>`;

  /* ---------- Subir un documento para firmar ---------- */
  function vNuevoDoc(el) {
    el.innerHTML = `<form class="panel" id="formDoc" novalidate>
      <h2>Subir documento para firmar</h2>
      <p class="sub">Sube el PDF y marca quién tiene que firmarlo. Se avisará por correo a quien le toque.</p>
      <div class="error" id="errDoc" hidden></div>
      <div class="rejilla">
        <div class="campo ancho"><label for="d_titulo">Título del documento *</label><input type="text" id="d_titulo" required placeholder="Por ejemplo: Convenio de colaboración con …"></div>
        <div class="campo"><label for="d_fecha">Fecha del documento *</label><input type="date" id="d_fecha" required value="${hoyISO()}"><span class="ayuda">Sirve para ordenarlo y para el nombre del archivo en Drive.</span></div>
        <div class="campo"><label for="d_archivo">Archivo PDF *</label><input type="file" id="d_archivo" accept="application/pdf,.pdf,.doc,.docx"><span class="ayuda">Máximo 15 MB. Si es un Word, guárdalo antes como PDF (Archivo → Guardar como → PDF).</span></div>
        <div class="campo ancho"><label for="d_nota">Nota para las firmantes (opcional)</label><input type="text" id="d_nota" placeholder="Por ejemplo: hay que entregarlo antes del viernes"></div>
      </div>
      ${opcionesFirma(true, true)}
      <div class="acciones">
        <button class="btn primario grande" type="submit" id="btnSubirDoc">Subir y enviar a firmar</button>
        <button class="btn sutil" type="button" id="btnCancelarDoc">Cancelar</button>
      </div>
    </form>`;
    const err = m => { const e = $('#errDoc'); e.textContent = m; e.hidden = false; e.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    $('#btnCancelarDoc').onclick = () => { S.vista = 'documentos'; pintar(); };
    $('#formDoc').onsubmit = async ev => {
      ev.preventDefault();
      const titulo = $('#d_titulo').value.trim(), fecha = $('#d_fecha').value, file = $('#d_archivo').files[0];
      const sec = $('#f_fsec').checked, pre = $('#f_fpre').checked;
      if (!titulo) return err('Falta el título.');
      if (!fecha) return err('Falta la fecha del documento.');
      if (!file) return err('Elige el archivo PDF.');
      if (/\.docx?$/i.test(file.name)) return err('Es un Word: ábrelo y guárdalo como PDF (Archivo → Guardar como → PDF). Después súbelo aquí.');
      if (file.size > 15 * 1024 * 1024) return err('El archivo pesa más de 15 MB.');
      if (!sec && !pre) return err('Marca al menos una firmante.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!window.CertPDF.esPdf(bytes)) return err('Ese archivo no es un PDF.');
      const btn = $('#btnSubirDoc');
      btn.disabled = true; btn.textContent = 'Subiendo…';
      try {
        const id = crypto.randomUUID();
        const ruta = id + '/original-' + Date.now() + '.pdf';
        const up = await sb.storage.from('documentos').upload(ruta, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
        if (up.error) throw up.error;
        const { error } = await sb.from('documentos').insert({ id, tipo: 'documento', titulo, fecha, original_path: ruta,
          firma_secretaria: sec, firma_presidenta: pre, nota: $('#d_nota').value.trim() || null });
        if (error) throw error;
        try {
          const r = await google('doc_avisar', { id });
          aviso(r.enviados ? 'Documento subido. Aviso enviado a ' + ROL_ART[r.rol] + '.' : 'Documento subido, pero no se ha enviado ningún aviso.');
        } catch (e) { aviso('Documento subido, pero no se ha podido enviar el correo: ' + e.message); }
        await cargarTodo();
        abrirDoc(id);
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Subir y enviar a firmar';
        err(e.message);
      }
    };
  }

  /* ---------- Nueva acta ---------- */
  function vNuevaActa(el) {
    el.innerHTML = `<form class="panel" id="formActa" novalidate>
      <h2>Nueva acta de la junta</h2>
      <p class="sub">Pega o escribe el texto, o impórtalo desde un Word. Al crearla, empieza la revisión: primero tú, después la secretaria y por último la presidenta. Con el último OK pasa a firma.</p>
      <div class="error" id="errActa" hidden></div>
      <div class="rejilla">
        <div class="campo"><label for="a_titulo">Título *</label><input type="text" id="a_titulo" required value="ASPM Acta reunión junta directiva"><span class="ayuda">Se completa con el mes y el año al poner la fecha. En Drive se guarda como «AAAAMMDD título.pdf».</span></div>
        <div class="campo"><label for="a_fecha">Fecha de la reunión *</label><input type="date" id="a_fecha" required></div>
      </div>
      <h3>Texto del acta</h3>
      ${editorHtml('')}
      ${opcionesFirma(true, true)}
      <div class="acciones">
        <button class="btn primario grande" type="submit" id="btnCrearActa">Crear y empezar la revisión</button>
        <button class="btn sutil" type="button" id="btnCancelarActa">Cancelar</button>
      </div>
    </form>`;
    const ed = activarEditor(el);
    // Título como el de las actas de la asociación: «ASPM Acta reunión junta directiva Julio 2026»
    let tituloManual = false;
    $('#a_titulo').addEventListener('input', () => { tituloManual = true; });
    $('#a_fecha').addEventListener('change', () => {
      const f = $('#a_fecha').value;
      if (tituloManual || !f) return;
      const mes = window.CertPDF.fechaLarga(f).split(' de ')[1];
      $('#a_titulo').value = 'ASPM Acta reunión junta directiva ' + mes[0].toUpperCase() + mes.slice(1) + ' ' + f.slice(0, 4);
    });
    const err = m => { const e = $('#errActa'); e.textContent = m; e.hidden = false; e.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
    $('#btnCancelarActa').onclick = () => { S.vista = 'documentos'; pintar(); };
    $('#formActa').onsubmit = async ev => {
      ev.preventDefault();
      const titulo = $('#a_titulo').value.trim(), fecha = $('#a_fecha').value, contenido = ed.html();
      const sec = $('#f_fsec').checked, pre = $('#f_fpre').checked;
      if (!titulo) return err('Falta el título.');
      if (!fecha) return err('Falta la fecha de la reunión.');
      if (!ed.texto()) return err('El acta está vacía.');
      if (!sec && !pre) return err('Marca al menos una firmante.');
      const btn = $('#btnCrearActa');
      btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const id = crypto.randomUUID();
        const { error } = await sb.from('documentos').insert({ id, tipo: 'acta', titulo, fecha, contenido, firma_secretaria: sec, firma_presidenta: pre });
        if (error) throw error;
        if (S.yo.rol !== 'coordinadora') { try { await google('doc_avisar', { id }); } catch (e) {} }
        await cargarTodo();
        abrirDoc(id);
        aviso(S.yo.rol === 'coordinadora' ? 'Acta creada. Te toca revisarla a ti primero.' : 'Acta creada. Se ha avisado a la coordinadora para que la revise.');
      } catch (e) {
        btn.disabled = false; btn.textContent = 'Crear y empezar la revisión';
        err(e.message);
      }
    };
  }

  /* ---------- Editor del acta ---------- */
  function editorHtml(html) {
    const b = (cmd, txt, tit) => `<button class="btn" type="button" data-cmd="${cmd}" title="${tit}">${txt}</button>`;
    return `<div class="editor">
      <div class="barra" role="toolbar" aria-label="Formato">
        ${b('bold', '<b>N</b>', 'Negrita')}${b('italic', '<i>C</i>', 'Cursiva')}
        ${b('h2', 'Título', 'Título de apartado')}${b('h3', 'Subtítulo', 'Subtítulo')}${b('p', 'Texto', 'Párrafo normal')}
        ${b('ul', '• Lista', 'Lista con puntos')}${b('ol', '1. Lista', 'Lista numerada')}
        ${b('undo', '↶', 'Deshacer')}${b('redo', '↷', 'Rehacer')}
        <label class="btn" title="Sustituye el texto por el de un archivo Word">Importar Word<input type="file" id="edWord" accept=".docx" hidden></label>
      </div>
      <div class="hoja" id="ed" contenteditable="true" spellcheck="true" lang="es">${sanear(html) || '<p><br></p>'}</div>
    </div>`;
  }

  function activarEditor(raiz, alCambiar) {
    const ed = $('#ed', raiz);
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}
    const cambio = () => alCambiar && alCambiar();
    raiz.querySelectorAll('[data-cmd]').forEach(b => {
      b.addEventListener('mousedown', e => e.preventDefault());   // no perder la selección
      b.onclick = () => {
        ed.focus();
        const c = b.dataset.cmd;
        if (c === 'ul') document.execCommand('insertUnorderedList');
        else if (c === 'ol') document.execCommand('insertOrderedList');
        else if (c === 'h2' || c === 'h3' || c === 'p') document.execCommand('formatBlock', false, '<' + c + '>');
        else document.execCommand(c);
        cambio();
      };
    });
    ed.addEventListener('input', cambio);
    // Al pegar, solo se queda el formato básico (títulos, negrita, cursiva, listas)
    ed.addEventListener('paste', e => {
      const html = e.clipboardData.getData('text/html');
      const txt = e.clipboardData.getData('text/plain');
      e.preventDefault();
      const limpio = html ? sanear(html) : txt.split(/\r?\n/).map(l => '<p>' + esc(l) + '</p>').join('');
      document.execCommand('insertHTML', false, limpio);
      cambio();
    });
    const word = $('#edWord', raiz);
    if (word) word.onchange = async () => {
      const file = word.files[0]; word.value = '';
      if (!file) return;
      try {
        if (ed.textContent.trim() && !await confirmar('Importar Word', 'Se sustituirá el texto que hay ahora por el del archivo.')) return;
        await cargarScript('https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js');
        const r = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        ed.innerHTML = sanear(r.value) || '<p><br></p>';
        cambio();
        aviso('Texto importado. Revisa el formato antes de seguir.');
      } catch (e) { aviso('No se ha podido importar: ' + e.message); }
    };
    return { el: ed, html: () => sanear(ed.innerHTML), texto: () => ed.textContent.trim() };
  }

  function cargarScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector('script[src="' + src + '"]')) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('no se ha podido cargar el lector de Word'));
      document.head.appendChild(s);
    });
  }

  // Deja solo las etiquetas que entiende el PDF: h2, h3, p, ul, ol, li, b, i, br
  function sanear(html) {
    if (!html) return '';
    const raiz = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html').body.firstChild;
    const MAPA = { P: 'p', DIV: 'p', TR: 'p', BLOCKQUOTE: 'p', H1: 'h2', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3',
                   UL: 'ul', OL: 'ol', LI: 'li', B: 'b', STRONG: 'b', I: 'i', EM: 'i' };
    const limpio = n => {
      if (n.nodeType === 3) return esc(n.nodeValue);
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|HEAD|TITLE|META|LINK|IFRAME|OBJECT|svg|IMG)$/i.test(n.tagName)) return '';
      if (n.tagName === 'BR') return '<br>';
      const dentro = Array.from(n.childNodes).map(limpio).join('');
      const st = (n.getAttribute('style') || '').toLowerCase();
      let t = MAPA[n.tagName];
      if (t === 'b' && /font-weight:\s*(normal|[1-5]00)/.test(st)) t = null;   // Google Docs envuelve todo en <b style="font-weight:normal">
      if (!t) {
        let r = dentro;
        if (/font-weight:\s*(bold|[6-9]00)/.test(st)) r = '<b>' + r + '</b>';
        if (/font-style:\s*italic/.test(st)) r = '<i>' + r + '</i>';
        if (n.tagName === 'TD' || n.tagName === 'TH') r += ' ';
        return r;
      }
      if ((t === 'p' || t === 'h2' || t === 'h3' || t === 'li') && !dentro.replace(/<br>|&nbsp;|\s/g, '')) return '';
      return '<' + t + '>' + dentro + '</' + t + '>';
    };
    return Array.from(raiz.childNodes).map(limpio).join('').replace(/ /g, ' ');
  }

  /* ---------- Comparar versiones (qué ha cambiado cada revisora) ---------- */
  function lcs(a, b) {
    const n = a.length, m = b.length, t = new Uint32Array((n + 1) * (m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      t[i * (m + 1) + j] = a[i] === b[j] ? t[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(t[(i + 1) * (m + 1) + j], t[i * (m + 1) + j + 1]);
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push(['=', a[i]]); i++; j++; }
      else if (t[(i + 1) * (m + 1) + j] >= t[i * (m + 1) + j + 1]) ops.push(['-', a[i++]]);
      else ops.push(['+', b[j++]]);
    }
    while (i < n) ops.push(['-', a[i++]]);
    while (j < m) ops.push(['+', b[j++]]);
    return ops;
  }
  const parrafos = html => window.DocPDF.bloques(html).map(b => (b.tipo === 'li' ? b.marca + ' ' : '') + b.runs.map(r => r.br ? ' ' : r.t).join('').replace(/\s+/g, ' ').trim());
  function diffPalabras(a, b) {
    const ta = a.split(/(\s+)/).filter(Boolean), tb = b.split(/(\s+)/).filter(Boolean);
    // Agrupa las palabras seguidas con el mismo cambio (los espacios entre ellas van con el grupo)
    const ops = lcs(ta, tb), grupos = [];
    ops.forEach(([o, w], k) => {
      if (o === '=' && /^\s+$/.test(w) && k > 0 && k < ops.length - 1 && ops[k - 1][0] !== '=' && ops[k + 1][0] === ops[k - 1][0]) o = ops[k - 1][0];
      const u = grupos[grupos.length - 1];
      if (u && u[0] === o) u[1] += w; else grupos.push([o, w]);
    });
    return grupos.map(([o, w]) => o === '=' ? esc(w) : o === '-' ? '<del>' + esc(w) + '</del>' : '<ins>' + esc(w) + '</ins>').join('');
  }
  // Devuelve { html, cambios }: el texto nuevo con lo quitado tachado y lo añadido resaltado
  function comparar(viejo, nuevo) {
    const ops = lcs(parrafos(viejo), parrafos(nuevo));
    const out = [];
    let cambios = 0, quitados = [], puestos = [];
    const vaciar = () => {
      const k = Math.min(quitados.length, puestos.length);
      for (let i = 0; i < k; i++) out.push('<p class="cambio">' + diffPalabras(quitados[i], puestos[i]) + '</p>');
      quitados.slice(k).forEach(p => out.push('<p class="cambio"><del>' + esc(p) + '</del></p>'));
      puestos.slice(k).forEach(p => out.push('<p class="cambio"><ins>' + esc(p) + '</ins></p>'));
      cambios += Math.max(quitados.length, puestos.length);
      quitados = []; puestos = [];
    };
    ops.forEach(([o, p]) => {
      if (o === '-') quitados.push(p);
      else if (o === '+') puestos.push(p);
      else { vaciar(); out.push('<p>' + esc(p) + '</p>'); }
    });
    vaciar();
    return { html: out.join(''), cambios };
  }

  /* ---------- PDF del documento o del acta ---------- */
  async function bajarDoc(path) {
    const { data, error } = await sb.storage.from('documentos').download(path);
    if (error) throw new Error('No se ha podido leer el PDF');
    return new Uint8Array(await data.arrayBuffer());
  }
  // Si ya hay firma digital, el PDF es el guardado. paraFirmar: versión limpia para firmar con certificado digital.
  async function pdfDoc(d, paraFirmar) {
    if (d.pdf_path) return bajarDoc(d.pdf_path);
    const completo = d.estado === 'firmado' || d.estado === 'archivado';
    const [lg, fp, fs] = await Promise.all([
      logo(),
      d.firmado_presidenta ? bytesFirma(d.firma_presidenta_path) : null,
      d.firmado_secretaria ? bytesFirma(d.firma_secretaria_path) : null
    ]);
    const firmas = { presidenta: fp, secretaria: fs };
    if (d.tipo === 'acta') return window.DocPDF.acta({ d, aj: S.ajustes, firmas, logo: lg, borrador: !completo, paraFirmar });
    const original = await bajarDoc(d.original_path);
    if (paraFirmar && !fp && !fs) return original;   // nadie ha firmado con imagen: se firma el original tal cual
    return window.DocPDF.conHojaDeFirmas({ original, d, aj: S.ajustes, firmas, logo: lg, borrador: !completo && !paraFirmar });
  }
  const nombreDoc = (d, pre, ext) => (pre || '') + String(d.fecha).replace(/-/g, '') + ' ' + d.titulo.replace(/[\\/:*?"<>|]/g, ' ') + (ext || '.pdf');

  function descargarWord(d, html) {
    const cuerpo = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${esc(d.titulo)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:11pt;line-height:1.4}h2{font-size:13pt}h3{font-size:11.5pt}</style></head><body>${html}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿', cuerpo], { type: 'application/msword' }));
    a.download = nombreDoc(d, '', '.doc'); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------- Detalle de un documento o acta ---------- */
  function vDoc(el) {
    const d = S.docs.find(x => x.id === S.docDetalle);
    if (!d) { el.innerHTML = '<div class="panel vacio">Este documento no existe o no tienes acceso.</div>'; return; }
    const esActa = d.tipo === 'acta';
    const reviso = d.estado === 'revision' && d.revisa === S.yo.rol;
    const puedoFirmar = faltaMiFirma(d);
    const completo = d.estado === 'firmado' || d.estado === 'archivado';
    const sinFirmas = !d.firmado_presidenta && !d.firmado_secretaria;
    const filasFirma = [];
    if (d.firma_secretaria) filasFirma.push(['Secretaria', d.firmado_secretaria, d.estado === 'revision' ? 'Firmará cuando termine la revisión' : 'Pendiente de firma (firma primero)']);
    if (d.firma_presidenta) filasFirma.push(['Presidenta', d.firmado_presidenta, d.estado === 'revision' ? 'Firmará cuando termine la revisión' : esperaSecretaria(d) ? 'Firmará cuando lo haya firmado la secretaria' : 'Pendiente de firma']);
    const siguiente = { coordinadora: 'la secretaria', secretaria: 'la presidenta', presidenta: null }[d.revisa];

    el.innerHTML = `<div class="acciones" style="margin:0 0 14px"><button class="btn sutil" type="button" id="btnAtras">← Volver</button></div>
    <div class="${reviso ? 'apilado' : 'detalle'}">
      <section class="panel">
        <h2>${esc(d.titulo)}</h2>
        <p class="sub"><span class="estado ${d.estado}">${esc(estadoDoc(d))}</span></p>
        <dl class="datos">
          <dt>Tipo</dt><dd>${esActa ? 'Acta de la junta' : 'Documento para firmar'}</dd>
          <dt>${esActa ? 'Reunión' : 'Fecha'}</dt><dd>${fechaCorta(d.fecha)}</dd>
          ${d.nota ? `<dt>Nota</dt><dd>${esc(d.nota)}</dd>` : ''}
          ${d.drive_url ? `<dt>Drive</dt><dd><a href="${esc(d.drive_url)}" target="_blank" rel="noopener">Abrir el PDF archivado</a></dd>` : ''}
        </dl>
        ${esActa ? `<h3>Revisión</h3><div class="firmantes" id="pasosRev">${REVISORAS.map(r => {
          const hecho = d.estado !== 'revision' && d.estado !== 'anulado' || REVISORAS.indexOf(r) < REVISORAS.indexOf(d.revisa);
          const ahora = d.estado === 'revision' && d.revisa === r;
          return `<div class="firmante ${hecho ? 'hecho' : 'falta'}" data-rev="${r}"><span class="ico">${hecho ? '✓' : ahora ? '✎' : '…'}</span><span><b>${ROL[r]}</b><small>${hecho ? 'Revisada' : ahora ? 'Revisando ahora' : 'Espera su turno'}</small></span></div>`;
        }).join('')}</div>` : ''}
        <h3>Firmas</h3>
        <div class="firmantes">${filasFirma.map(([cargo, cuando, falta]) => `<div class="firmante ${cuando ? 'hecho' : 'falta'}"><span class="ico">${cuando ? '✓' : '…'}</span><span><b>${cargo}</b><small>${cuando ? 'Firmado el ' + new Date(cuando).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : (['revision', 'pendiente'].includes(d.estado) ? falta : 'Sin firmar')}</small></span></div>`).join('')}</div>
        ${S.yo.rol === 'presidenta' && d.estado === 'pendiente' && d.firma_presidenta && !d.firmado_presidenta && esperaSecretaria(d)
          ? '<div class="aviso info" style="margin-top:14px">Primero lo firma la secretaria. Te llegará un aviso por correo cuando lo haya hecho.</div>' : ''}

        ${puedoFirmar ? `<div class="firmar-caja">
          <h3 style="margin-top:0">Firmar con certificado digital</h3>
          <ol class="pasos">
            <li><button class="btn primario" type="button" id="btnBajarFirmar">Descargar PDF para firmar</button></li>
            <li>Fírmalo en tu ordenador con tu certificado digital (AutoFirma o Adobe Acrobat) y guárdalo.</li>
            <li><label class="btn primario" for="pdfFirmado">Subir PDF firmado</label><input type="file" id="pdfFirmado" accept="application/pdf,.pdf" hidden></li>
          </ol>
          ${d.pdf_path ? '<p class="nota">Este documento ya lleva una firma digital: descarga el PDF y añade la tuya encima.</p>'
            : S.yo.firma_path
              ? `<details class="plegable"><summary>O firmar con tu firma guardada (imagen)</summary><p>${esActa ? 'Se añadirá tu firma guardada al pie del acta' : 'Se añadirá al final una hoja de firmas con tu firma guardada'}, con la fecha y hora de hoy.</p><button class="btn" type="button" id="btnFirmar">Firmar con un clic</button></details>`
              : ''}
        </div>` : ''}

        <div class="acciones">
          ${completo ? '<button class="btn primario" type="button" id="btnDescargar">Descargar PDF firmado</button>' : !reviso ? '<button class="btn" type="button" id="btnDescargar">Descargar PDF</button>' : ''}
          ${esActa && !reviso ? '<button class="btn" type="button" id="btnWord">Descargar en Word</button>' : ''}
          ${gestiona() && esActa && d.estado === 'firmado' ? '<button class="btn primario" type="button" id="btnArchivar">Archivar ahora en Drive</button>' : ''}
          ${gestiona() && (d.estado === 'pendiente' || (d.estado === 'revision' && d.revisa !== S.yo.rol)) ? '<button class="btn" type="button" id="btnReavisar">Reenviar aviso por correo</button>' : ''}
          ${gestiona() && ['revision', 'pendiente'].includes(d.estado) && sinFirmas ? '<button class="btn no" type="button" id="btnAnular">Anular</button>' : ''}
        </div>
      </section>
      ${reviso ? `<section class="panel">
          <h2>Te toca revisar el acta</h2>
          <p class="sub">Corrige directamente sobre el texto${d.revisa === 'coordinadora' ? '' : ', que ya lleva los cambios de quien la revisó antes'}. Puedes guardar e ir volviendo. Cuando esté bien, pulsa «Dar el OK»: ${siguiente ? 'pasará a ' + siguiente + ', que revisará sobre tu versión' : 'el acta pasará a firma (primero la secretaria y después la presidenta)'}.</p>
          <details class="plegable" id="cambiosPrevios" hidden><summary>Ver qué cambió en la revisión anterior</summary><div class="diff" id="diffPrevio"></div></details>
          ${editorHtml(d.contenido)}
          <div class="acciones">
            <button class="btn" type="button" id="btnGuardarActa">Guardar cambios</button>
            <button class="btn primario grande" type="button" id="btnOk">${siguiente ? 'Dar el OK y pasar a ' + siguiente : 'Dar el OK y pasar a firma'}</button>
            <button class="btn sutil" type="button" id="btnPrevia">Ver cómo queda en PDF</button>
            <span class="meta" id="estadoGuardado" style="color:var(--muted);font-size:13px"></span>
          </div>
        </section>`
      : `<section class="panel"><h2 style="margin-bottom:12px">${completo ? 'Documento firmado' : d.pdf_path ? 'PDF con firma digital (falta otra firma)' : d.estado === 'revision' ? 'Borrador en revisión' : 'Vista previa'}</h2><iframe class="visor" id="visor" title="Vista previa del documento"></iframe></section>`}
      ${esActa ? `<section class="panel" id="historial"><h2>Historial de la revisión</h2><p class="sub">Cada versión, tal como la dejó cada persona al dar el OK.</p><div class="lista" id="listaVersiones"><div class="vacio">Cargando…</div></div><div class="diff" id="diffVer" hidden></div></section>` : ''}
    </div>`;

    $('#btnAtras').onclick = async () => { if (!await puedoSalir()) return; S.vista = firmante() ? 'pendientes' : 'documentos'; history.replaceState(null, '', location.pathname); pintar(); };
    if (!reviso) pdfDoc(d).then(b => { $('#visor') && ($('#visor').src = URL.createObjectURL(new Blob([b], { type: 'application/pdf' })) + '#view=FitH'); })
      .catch(e => aviso('No se ha podido generar la vista previa: ' + e.message));

    // Historial de versiones del acta
    if (esActa) sb.from('documentos_versiones').select('id,rol,contenido,creado').eq('documento_id', d.id).order('creado').then(({ data }) => {
      const vs = data || [];
      const lista = $('#listaVersiones');
      if (!lista) return;
      const nombre = { borrador: 'Borrador inicial', coordinadora: 'Revisión de la coordinadora', secretaria: 'Revisión de la secretaria', presidenta: 'Revisión de la presidenta' };
      lista.innerHTML = vs.map((v, k) => {
        const c = k ? comparar(vs[k - 1].contenido, v.contenido).cambios : null;
        return `<div class="firmante hecho" style="flex-wrap:wrap"><span class="ico">${k + 1}</span><span style="flex:1 1 200px"><b>${nombre[v.rol] || v.rol}</b><small>${new Date(v.creado).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}${k ? ' · ' + (c ? c + ' párrafo' + (c > 1 ? 's' : '') + ' cambiado' + (c > 1 ? 's' : '') : 'sin cambios') : ''}</small></span>
          ${k ? `<button class="btn" type="button" data-ver="${k}">Ver cambios</button>` : ''}</div>`;
      }).join('') || '<div class="vacio">Sin versiones.</div>';
      lista.querySelectorAll('[data-ver]').forEach(b => b.onclick = () => {
        const k = +b.dataset.ver, r = comparar(vs[k - 1].contenido, vs[k].contenido), caja = $('#diffVer');
        caja.hidden = false;
        caja.innerHTML = `<h3 style="margin-top:14px">${nombre[vs[k].rol]}: cambios respecto a la versión anterior</h3>${r.cambios ? r.html : '<p>No cambió nada.</p>'}`;
        caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      // Para quien revisa: qué cambió la anterior
      if (reviso && vs.length >= 2) {
        const r = comparar(vs[vs.length - 2].contenido, vs[vs.length - 1].contenido);
        $('#cambiosPrevios').hidden = false;
        $('#diffPrevio').innerHTML = r.cambios ? r.html : '<p>La revisión anterior no cambió nada.</p>';
      }
    });

    // Revisión: editor
    if (reviso) {
      const marcar = t => { const e = $('#estadoGuardado'); if (e) e.textContent = t; };
      const ed = activarEditor(el, () => { S.editor.sucio = true; marcar('Cambios sin guardar'); });
      S.editor = {
        sucio: false,
        guardar: async () => {
          const { error } = await sb.rpc('doc_guardar', { p_id: d.id, p_contenido: ed.html() });
          if (error) throw error;
          S.editor.sucio = false; d.contenido = ed.html();
          marcar('Guardado a las ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }));
        }
      };
      $('#btnGuardarActa').onclick = async () => {
        if (!ed.texto()) return aviso('El acta no puede quedar vacía.');
        try { await S.editor.guardar(); aviso('Cambios guardados.'); } catch (e) { aviso('No se ha podido guardar: ' + e.message); }
      };
      $('#btnPrevia').onclick = async () => verPdfNuevaPestana(await window.DocPDF.acta({ d: Object.assign({}, d, { contenido: ed.html() }), aj: S.ajustes, firmas: {}, logo: await logo(), borrador: true }));
      $('#btnOk').onclick = async b => {
        if (!ed.texto()) return aviso('El acta no puede quedar vacía.');
        if (!await confirmar('Dar el OK al acta', siguiente ? `Pasará a ${siguiente}, que la revisará sobre tu versión. Tú ya no podrás cambiarla.` : 'Termina la revisión y el acta pasa a firma: primero la secretaria y después la presidenta. Ya nadie podrá cambiar el texto.')) return;
        const btn = $('#btnOk'); btn.disabled = true;
        const { data, error } = await sb.rpc('doc_aprobar', { p_id: d.id, p_contenido: ed.html() });
        if (error) { btn.disabled = false; return aviso(error.message); }
        S.editor = null;
        try {
          const r = await google('doc_avisar', { id: d.id });
          aviso(data.estado === 'revision' ? 'Hecho. ' + (r.enviados ? 'Se ha avisado a ' + ROL_ART[data.revisa] + ' para que la revise.' : '')
                                           : 'Revisión terminada. ' + (r.enviados ? 'Se ha avisado a ' + ROL_ART[r.rol] + ' para que firme.' : ''));
        } catch (e) { aviso('OK guardado, pero no se ha podido enviar el aviso: ' + e.message + ' Puedes reenviarlo desde aquí.'); }
        await cargarTodo(); abrirDoc(d.id);
      };
    }

    const on = (sel, fn) => { const b = $(sel); if (b) b.onclick = () => fn(b); };
    on('#btnDescargar', async () => descargarBytes(await pdfDoc(d), nombreDoc(d)));
    on('#btnWord', () => descargarWord(d, d.contenido));
    on('#btnFirmar', async b => {
      if (!await confirmar('Firmar', `Vas a firmar como ${ROL[S.yo.rol].toLowerCase()} «${d.titulo}».`)) return;
      b.disabled = true; b.textContent = 'Firmando…';
      const { data, error } = await sb.rpc('doc_firmar', { p_id: d.id });
      if (error) { b.disabled = false; b.textContent = 'Firmar con un clic'; return aviso(error.message); }
      await trasFirmarDoc(data);
    });
    on('#btnBajarFirmar', async b => {
      b.disabled = true;
      try {
        await cargarTodo();
        const actual = S.docs.find(x => x.id === d.id) || d;
        const bytes = await pdfDoc(actual, true);
        guardarBase(actual);
        descargarBytes(bytes, nombreDoc(actual, 'Para firmar - '));
        aviso('Descargado. Fírmalo con tu certificado digital y súbelo con «Subir PDF firmado».');
      } catch (e) { aviso('No se ha podido descargar: ' + e.message); }
      b.disabled = false;
    });
    const entradaPdf = $('#pdfFirmado');
    if (entradaPdf) entradaPdf.onchange = async () => {
      const file = entradaPdf.files[0];
      entradaPdf.value = '';
      if (!file) return;
      const etiqueta = $('label[for="pdfFirmado"]');
      try {
        if (file.size > 15 * 1024 * 1024) throw new Error('El archivo pesa más de 15 MB.');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!window.CertPDF.esPdf(bytes)) throw new Error('Ese archivo no es un PDF.');
        const previo = d.pdf_path ? await bajarDoc(d.pdf_path)
          : (d.tipo === 'documento' && sinFirmas ? await bajarDoc(d.original_path) : null);
        if (window.CertPDF.contarFirmas(bytes) <= (previo ? window.CertPDF.contarFirmas(previo) : 0)) {
          throw new Error('Ese PDF no lleva tu firma digital. Fírmalo con tu certificado (AutoFirma o Acrobat), guárdalo y súbelo de nuevo.');
        }
        if (!window.DocPDF.esDelDocumento(bytes, d.id, previo) &&
            !await confirmar('¿Es el PDF correcto?', `No reconozco este archivo como «${d.titulo}». Súbelo solo si estás segura de que es el de este documento.`)) return;
        etiqueta.textContent = 'Subiendo…';
        const base = leerBase(d);
        const ruta = d.id + '/firmado-' + Date.now() + '-' + S.yo.rol + '.pdf';
        const up = await sb.storage.from('documentos').upload(ruta, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' });
        if (up.error) throw up.error;
        const { data, error } = await sb.rpc('doc_firmar_pdf', { p_id: d.id, p_path: ruta, p_base: base.path, p_previas: base.previas });
        if (error) throw error;
        try { sessionStorage.removeItem(claveBase(d.id)); } catch (e) {}
        await trasFirmarDoc(data);
      } catch (e) {
        etiqueta.textContent = 'Subir PDF firmado';
        aviso(e.message);
      }
    };
    async function trasFirmarDoc(data) {
      await cargarTodo();
      if (data.estado === 'firmado' && data.tipo === 'acta') {
        aviso('Firmado. Ya están todas las firmas: archivando en Drive…');
        await archivarDoc(data.id, true);
      } else if (data.estado === 'firmado') {
        // Los documentos no se archivan en Drive: se avisa a coordinación para que descargue el PDF
        try { await google('doc_avisar', { id: data.id }); } catch (e) {}
        aviso('Firmado. Ya están todas las firmas: la coordinación puede descargar el PDF firmado.');
      } else {
        try {
          const r = await google('doc_avisar', { id: data.id });
          aviso('Firmado. ' + (r.enviados ? 'Se ha avisado por correo a ' + ROL_ART[r.rol] + ' para que firme.' : 'Falta la otra firma.'));
        } catch (e) {
          aviso('Firmado, pero no se ha podido avisar a la siguiente firmante: ' + e.message + ' La coordinación puede reenviar el aviso.');
        }
      }
      abrirDoc(d.id);
    }
    on('#btnArchivar', async b => { b.disabled = true; b.textContent = 'Archivando…'; await archivarDoc(d.id); await cargarTodo(); abrirDoc(d.id); });
    on('#btnReavisar', async b => {
      b.disabled = true;
      try { const r = await google('doc_avisar', { id: d.id }); aviso(r.enviados ? 'Aviso reenviado a ' + ROL_ART[r.rol] + '.' : 'No había nadie a quien avisar.'); }
      catch (e) { aviso(e.message); }
      b.disabled = false;
    });
    on('#btnAnular', async () => {
      if (!await confirmar('Anular', 'Quedará marcado como anulado y ya no se podrá revisar ni firmar.')) return;
      const { error } = await sb.rpc('doc_anular', { p_id: d.id });
      if (error) return aviso(error.message);
      await cargarTodo(); abrirDoc(d.id); aviso('Anulado.');
    });
  }

  async function archivarDoc(id, silencioso) {
    try {
      await cargarTodo();
      const d = S.docs.find(x => x.id === id);
      const bytes = await pdfDoc(d);
      await google('doc_archivar', { id, pdf: aBase64(new Uint8Array(bytes)) });
      aviso('Archivado en Drive (Actas Junta Directiva › ' + String(d.fecha).slice(0, 4) + ').');
    } catch (e) {
      aviso((silencioso ? 'Firmado, pero no se ha podido archivar: ' : 'No se ha podido archivar: ') + e.message + ' La coordinación puede reintentarlo.');
    }
  }

  /* ---------- Mi perfil ---------- */
  function vPerfil(el) {
    el.innerHTML = `
      ${firmante() ? `<section class="panel"><h2>Mi firma</h2>
        <p class="sub">Se guarda en privado y solo se usa cuando pulsas «Firmar con un clic». Si la cambias, los certificados ya firmados conservan la anterior.</p>
        <div class="rejilla">
          <div><h3 style="margin-top:0">Firma guardada</h3><div class="firma-actual" id="firmaActual">${S.yo.firma_path ? 'Cargando…' : '<span class="meta" style="color:var(--muted)">Todavía no hay firma guardada.</span>'}</div></div>
          <div><h3 style="margin-top:0">Nueva firma</h3>
            <div class="pestanas-firma"><button class="btn primario" type="button" id="modoDibujar">Dibujar</button><button class="btn" type="button" id="modoSubir">Subir imagen</button></div>
            <div id="zonaDibujar"><div class="lienzo-caja"><canvas id="lienzo"></canvas><div class="guia"></div></div>
              <p class="ayuda" style="font-size:12.5px;color:var(--muted);margin:6px 0 0">Firma con el ratón o el dedo sobre el recuadro.</p></div>
            <div id="zonaSubir" hidden><input type="file" id="archivoFirma" accept="image/png,image/jpeg">
              <p class="ayuda" style="font-size:12.5px;color:var(--muted)">Foto o escaneo de tu firma sobre papel blanco. El fondo blanco se quita solo.</p>
              <div class="firma-actual" id="previaSubida" hidden></div></div>
            <div class="acciones"><button class="btn primario" type="button" id="btnGuardarFirma">Guardar esta firma</button><button class="btn sutil" type="button" id="btnBorrarLienzo">Borrar</button></div>
          </div>
        </div></section>` : ''}
      <section class="panel"><h2>Cambiar contraseña</h2>
        <p class="sub">Mínimo 10 caracteres. Úsala solo para esta herramienta.</p>
        <form id="formClave" class="rejilla" autocomplete="off">
          <input type="text" autocomplete="username" value="${esc(S.yo.email)}" hidden readonly>
          <div class="campo"><label for="c1">Nueva contraseña</label><input type="password" id="c1" autocomplete="new-password" minlength="10" required></div>
          <div class="campo"><label for="c2">Repítela</label><input type="password" id="c2" autocomplete="new-password" minlength="10" required></div>
          <div class="ancho"><button class="btn primario" type="submit">Cambiar contraseña</button></div>
        </form></section>`;

    $('#formClave').onsubmit = async ev => {
      ev.preventDefault();
      const a = $('#c1').value, b = $('#c2').value;
      if (a.length < 10) return aviso('La contraseña debe tener al menos 10 caracteres.');
      if (a !== b) return aviso('Las dos contraseñas no coinciden.');
      const { error } = await sb.auth.updateUser({ password: a });
      if (!error) await sb.rpc('clave_cambiada');
      $('#c1').value = $('#c2').value = '';
      aviso(error ? 'No se ha podido cambiar: ' + error.message : 'Contraseña cambiada.');
    };
    if (!firmante()) return;

    if (S.yo.firma_path) bytesFirma(S.yo.firma_path).then(b => {
      $('#firmaActual').innerHTML = `<img alt="Tu firma guardada" src="${URL.createObjectURL(new Blob([b], { type: 'image/png' }))}">`;
    }).catch(() => { $('#firmaActual').textContent = 'No se ha podido cargar.'; });

    // Dibujo
    const cv = $('#lienzo'), ctx = cv.getContext('2d');
    const ajustar = () => { const r = cv.getBoundingClientRect(); cv.width = r.width * 2; cv.height = r.height * 2; ctx.scale(2, 2); ctx.lineWidth = 2.4; ctx.lineCap = ctx.lineJoin = 'round'; ctx.strokeStyle = '#14215c'; };
    ajustar();
    let dibujando = false, hayTrazo = false, subida = null;
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.addEventListener('pointerdown', e => { dibujando = true; hayTrazo = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
    cv.addEventListener('pointermove', e => { if (!dibujando) return; ctx.lineTo(...pos(e)); ctx.stroke(); });
    ['pointerup', 'pointercancel'].forEach(t => cv.addEventListener(t, () => { dibujando = false; }));
    $('#btnBorrarLienzo').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); hayTrazo = false; subida = null; $('#previaSubida').hidden = true; $('#archivoFirma').value = ''; };

    const modo = m => {
      $('#zonaDibujar').hidden = m !== 'dibujar'; $('#zonaSubir').hidden = m !== 'subir';
      $('#modoDibujar').className = 'btn' + (m === 'dibujar' ? ' primario' : '');
      $('#modoSubir').className = 'btn' + (m === 'subir' ? ' primario' : '');
    };
    $('#modoDibujar').onclick = () => modo('dibujar');
    $('#modoSubir').onclick = () => modo('subir');

    $('#archivoFirma').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      const esc2 = Math.min(1, 1200 / img.width);
      const c2 = document.createElement('canvas'); c2.width = img.width * esc2; c2.height = img.height * esc2;
      const x2 = c2.getContext('2d'); x2.drawImage(img, 0, 0, c2.width, c2.height);
      const d = x2.getImageData(0, 0, c2.width, c2.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const lum = 0.299 * d.data[i] + 0.587 * d.data[i + 1] + 0.114 * d.data[i + 2];
        if (lum > 200) d.data[i + 3] = 0; else if (lum > 150) d.data[i + 3] = Math.round((200 - lum) / 50 * 255);
      }
      x2.putImageData(d, 0, 0);
      subida = recortar(c2);
      $('#previaSubida').hidden = false;
      $('#previaSubida').innerHTML = `<img alt="Vista previa" src="${subida.toDataURL('image/png')}">`;
    };

    $('#btnGuardarFirma').onclick = async ev => {
      const origen = !$('#zonaSubir').hidden ? subida : (hayTrazo ? recortar(cv) : null);
      if (!origen) return aviso(!$('#zonaSubir').hidden ? 'Elige primero una imagen.' : 'Dibuja primero tu firma.');
      ev.target.disabled = true;
      try {
        const blob = await new Promise(r => origen.toBlob(r, 'image/png'));
        const ruta = S.yo.id + '/' + Date.now() + '.png';
        const up = await sb.storage.from('firmas').upload(ruta, blob, { contentType: 'image/png' });
        if (up.error) throw up.error;
        const { error } = await sb.from('perfiles').update({ firma_path: ruta }).eq('id', S.yo.id);
        if (error) throw error;
        await cargarTodo();
        aviso('Firma guardada.');
        pintar();
      } catch (e) { aviso('No se ha podido guardar: ' + e.message); ev.target.disabled = false; }
    };
  }

  function recortar(canvas) {
    const x = canvas.getContext('2d'), { width: w, height: h } = canvas;
    const d = x.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (d[(y * w + i) * 4 + 3] > 20) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 <= x0 || y1 <= y0) return null;
    const m = 8, out = document.createElement('canvas');
    out.width = x1 - x0 + 2 * m; out.height = y1 - y0 + 2 * m;
    out.getContext('2d').drawImage(canvas, x0 - m, y0 - m, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  /* ---------- Ajustes ---------- */
  function vAjustes(el) {
    const a = S.ajustes;
    const campo = (id, et, val, ayuda, tipo) => `<div class="campo"><label for="${id}">${et}</label><input type="${tipo || 'text'}" id="${id}" value="${esc(val)}">${ayuda ? `<span class="ayuda">${ayuda}</span>` : ''}</div>`;
    el.innerHTML = `<form class="panel" id="formAj">
      <h2>Ajustes del certificado</h2>
      <p class="sub">Se guardan en la base de datos privada y solo los ven las cuentas autorizadas.</p>
      <h3>Secretaria</h3><div class="rejilla">
        ${campo('a_sn', 'Nombre completo', a.secretaria_nombre, 'En la cabecera sale en mayúsculas con «Dña.» delante.')}
        ${campo('a_sd', 'DNI', a.secretaria_dni)}
        ${campo('a_sf', 'Nombre bajo la firma', a.secretaria_firma, 'Tal cual, p. ej. «Dña. …»')}
      </div>
      <h3>Presidenta</h3><div class="rejilla">
        ${campo('a_pn', 'Nombre completo', a.presidenta_nombre)}
        ${campo('a_pd', 'DNI', a.presidenta_dni, 'Solo se usa si un certificado lo firma únicamente la presidenta.')}
        ${campo('a_pf', 'Nombre bajo la firma', a.presidenta_firma)}
      </div>
      <h3>Certificado</h3><div class="rejilla">
        ${campo('a_lu', 'Lugar de firma', a.lugar || 'Boadilla del Monte')}
        <div class="campo ancho"><label for="a_av">Pie legal (protección de datos)</label><textarea id="a_av" rows="6">${esc(a.aviso_legal || window.CertPDF.AVISO_LEGAL)}</textarea><span class="ayuda">Texto actualizado al RGPD y a la LO 3/2018. Puedes ajustarlo.</span></div>
      </div>
      <h3>Conexión con Google (correos, Drive y hoja de ingresos)</h3>
      <div class="campo"><label for="a_gs">URL del script de Google</label><input type="url" id="a_gs" value="${esc(a.apps_script_url)}" placeholder="https://script.google.com/macros/s/…/exec"></div>
      <div class="acciones"><button class="btn primario" type="submit">Guardar ajustes</button><button class="btn" type="button" id="btnProbar">Probar conexión con Google</button></div>
      <h3>Cuentas con acceso (${S.perfiles.length} de 4)</h3>
      <div class="lista">${S.perfiles.map(p => `<div class="firmante hecho" style="flex-wrap:wrap"><span class="ico">✓</span><span style="flex:1 1 200px"><b>${esc(ROL[p.rol])}</b><small>${esc(p.email)}${(p.rol === 'presidenta' || p.rol === 'secretaria') ? (p.firma_path ? ' · firma guardada' : ' · sin firma todavía') : ''}${p.debe_cambiar_clave ? ' · aún con contraseña provisional' : ''}</small></span>
        ${S.yo.rol === 'coordinadora' ? `<button class="btn" type="button" data-clave="${esc(p.email)}">Poner contraseña provisional</button>` : ''}</div>`).join('')}</div>
      <p class="sub" style="margin-top:10px">${S.yo.rol === 'coordinadora' ? 'Si alguien olvida su contraseña, ponle una provisional y díselo en persona o por teléfono: al entrar tendrá que cambiarla. ' : ''}Para dar de alta o de baja cuentas, ver las instrucciones.</p>
    </form>`;
    el.querySelectorAll('[data-clave]').forEach(b => b.onclick = async () => {
      const email = b.dataset.clave;
      const clave = await pedirTexto('Contraseña provisional', 'Para ' + email + '. Mínimo 8 caracteres. Al entrar tendrá que cambiarla por una suya.');
      if (!clave) return;
      if (clave.length < 8) return aviso('La contraseña provisional debe tener al menos 8 caracteres.');
      const { error } = await sb.rpc('restablecer_clave', { p_email: email, p_clave: clave });
      if (error) return aviso(/restablecer_clave/.test(error.message) ? 'Falta activar esta función en Supabase (ver instrucciones).' : error.message);
      await cargarTodo(); pintar(); aviso('Contraseña provisional puesta para ' + email + '.');
    });
    $('#formAj').onsubmit = async ev => {
      ev.preventDefault();
      const d = {
        secretaria_nombre: $('#a_sn').value.trim() || null, secretaria_dni: $('#a_sd').value.trim() || null, secretaria_firma: $('#a_sf').value.trim() || null,
        presidenta_nombre: $('#a_pn').value.trim() || null, presidenta_dni: $('#a_pd').value.trim() || null, presidenta_firma: $('#a_pf').value.trim() || null,
        lugar: $('#a_lu').value.trim() || null, aviso_legal: $('#a_av').value.trim() || null, apps_script_url: $('#a_gs').value.trim() || null
      };
      const { error } = await sb.from('ajustes').update(d).eq('id', 1);
      if (error) return aviso('No se han podido guardar: ' + error.message);
      await cargarTodo(); aviso('Ajustes guardados.'); pintar();
    };
    $('#btnProbar').onclick = async () => {
      try { const r = await google('prueba'); aviso('Conexión correcta. Los correos saldrán desde ' + r.cuenta + '.'); }
      catch (e) { aviso('No conecta: ' + e.message); }
    };
  }

  /* =================== Utilidades de interfaz =================== */
  let tAviso;
  function aviso(msg) {
    let t = $('.toast');
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(tAviso); tAviso = setTimeout(() => { t.hidden = true; }, 6000);
  }

  function confirmar(titulo, texto) {
    return new Promise(res => {
      const d = $('#dlg');
      $('#dlgT').textContent = titulo; $('#dlgP').textContent = texto;
      const fin = v => { d.close(); res(v); };
      $('#dlgSi').onclick = () => fin(true);
      $('#dlgNo').onclick = () => fin(false);
      d.oncancel = () => res(false);
      d.showModal();
    });
  }

  function pedirTexto(titulo, texto) {
    return new Promise(res => {
      const d = $('#dlg');
      $('#dlgT').textContent = titulo;
      $('#dlgP').innerHTML = esc(texto) + '<input type="text" id="dlgIn" autocomplete="off" style="margin-top:12px">';
      const fin = v => { d.close(); res(v); };
      $('#dlgSi').onclick = () => fin($('#dlgIn').value);
      $('#dlgNo').onclick = () => fin(null);
      d.oncancel = () => res(null);
      d.showModal();
      $('#dlgIn').focus();
    });
  }

  window.addEventListener('hashchange', () => {
    if (location.hash === '#olvido' && !S.yo) return mostrarOlvido();
    const m = /#c=([0-9a-f-]{36})/.exec(location.hash);
    if (m && S.yo && S.detalle !== m[1]) abrir(m[1]);
    const md = /#d=([0-9a-f-]{36})/.exec(location.hash);
    if (md && S.yo && S.docDetalle !== md[1]) abrirDoc(md[1]);
  });

  arrancar();
})();

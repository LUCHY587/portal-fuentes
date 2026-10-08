// Cobranza Fuentes · Portal de inquilinos y propietarios
import {
  sb, DOMINIO_USUARIOS, LOGO_URL, money, r2, pad5, esc, isoHoy, ymHoy, ymDe, ymSumar, periodo, fecha,
  estadoContrato, contratoActivo, montoEn, comisionDe, deuda, deudaCargos, divisionLineas, division, vtoDe,
  toast, abrirModal, cerrarModal, copiar, mensajeError, rutaArchivo, verArchivo, ETIQUETA_ARCHIVO, ARCHIVOS_OK,
  pdfRecibo, pdfLiquidacion, alternarTema, temaActual,
} from "./comun.js";

const $ = (s) => document.querySelector(s);
const S = { cfg: null, contratos: [], yo: [], aj: [], pg: [], ov: [], cargos: [], envios: [], archivos: [], liqs: [], avisos: [], rol: null, anteriores: false, esStaff: false };
const MAX_MB = 10;

/* ---------- sesión ---------- */
function pantallaLogin(msg) {
  $("#app").innerHTML = `<div class="login"><form class="card" id="f-login">
    <div class="brand"><img class="logo logo-grande" src="${LOGO_URL}" alt="Logo de Inmobiliaria M.M. Fuentes"><b>M.M. Fuentes</b><span>Portal de inquilinos y propietarios</span></div>
    <p class="muted" style="margin:0">Consultá cuánto pagar, enviá tus comprobantes y descargá recibos y liquidaciones.</p>
    <label>DNI<input type="text" inputmode="numeric" id="lg-dni" name="dni" required autocomplete="username" placeholder="Sin puntos"></label>
    <label>Clave<input type="password" id="lg-clave" name="clave" required autocomplete="current-password"></label>
    ${msg ? `<div class="error" role="alert">${esc(msg)}</div>` : ""}
    <button class="btn primary" type="submit">Ingresar</button>
    <p class="muted" style="margin:0;font-size:14.5px">¿No tenés clave o la olvidaste? Pedila a la inmobiliaria por WhatsApp.</p>
  </form></div>`;
}
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return pantallaLogin();
  $("#app").innerHTML = `<div class="cargando">Cargando tu información…</div>`;
  try { await cargar(session.user.id); } catch (e) { $("#app").innerHTML = `<div class="login"><div class="card"><b>No pudimos cargar tus datos</b><p>${esc(mensajeError(e))}</p><button class="btn" data-a="salir">Salir</button></div></div>`; return; }
  if (!S.contratos.length && !S.esStaff) { $("#app").innerHTML = `<div class="login"><div class="card"><b>Tu usuario todavía no tiene contratos asociados</b><p class="muted">Consultá con la inmobiliaria.</p><button class="btn" data-a="salir">Salir</button></div></div>`; return; }
  if (!S.contratos.length && S.esStaff) { location.href = "gestion.html"; return; }
  const roles = [...new Set(S.contratos.map((c) => c.rol))];
  S.rol = S.rol && roles.includes(S.rol) ? S.rol : roles[0];
  render();
}
async function cargar(uid) {
  const q = (t, f = (x) => x) => f(sb.from(t).select("*")).then((r) => { if (r.error) throw r.error; return r.data; });
  // generar los renglones del mes de mis contratos como inquilino (cuotas y conceptos fijos)
  const mios = await sb.rpc("portal_contratos").then((r) => r.data || []);
  await Promise.all(mios.filter((c) => c.rol === "inquilino").map((c) => sb.rpc("generar_cargos", { p_contrato: c.id })));
  const [cfg, contratos, yo, aj, pg, ov, envios, archivos, liqs, avisos, staff] = await Promise.all([
    sb.from("config").select("*").eq("id", 1).single().then((r) => { if (r.error) throw r.error; return r.data; }),
    sb.rpc("portal_contratos").then((r) => { if (r.error) throw r.error; return r.data; }),
    q("personas", (x) => x.eq("user_id", uid)), q("ajustes"), q("pagos", (x) => x.order("fecha", { ascending: false })), q("punitorio_override"),
    q("envios", (x) => x.order("created_at", { ascending: false })), q("archivos", (x) => x.order("created_at", { ascending: false })),
    q("liquidaciones", (x) => x.order("nro", { ascending: false })), q("notificaciones", (x) => x.order("created_at", { ascending: false }).limit(60)),
    sb.from("staff").select("user_id").eq("user_id", uid).maybeSingle().then((r) => r.data),
  ]);
  const cargos = await q("cargos", (x) => x.eq("anulado", false).gt("saldo", 0));
  Object.assign(S, { cfg, contratos, yo, aj, pg, ov, envios, archivos, liqs, avisos, cargos, esStaff: !!staff });
}
const ajDe = (c) => S.aj.filter((a) => a.contrato_id === c.id);
const pgDe = (c) => S.pg.filter((p) => p.contrato_id === c.id);
const ovDe = (c) => Object.fromEntries(S.ov.filter((o) => o.contrato_id === c.id).map((o) => [o.periodo, +o.monto]));
const deudaDe = (c) => deudaCargos(c, S.cargos.filter((g) => g.contrato_id === c.id), S.cfg, ovDe(c));
const lineasDe = (x) => { let puesto = false; return x.cargos.map((g) => { const pu = !puesto && g.tipo === "alquiler" ? x.punitorio : 0; if (g.tipo === "alquiler") puesto = true; return { descripcion: g.descripcion, monto: +g.saldo, parcial: +g.saldo < +g.monto - 0.009, punitorio: pu, admin: g.admin, propietario: g.propietario }; }); };
const contratoKey = (c) => ({ ...c, monto_base: +c.monto_base });

/* ---------- render ---------- */
function render() {
  const roles = [...new Set(S.contratos.map((c) => c.rol))];
  const nombre = (S.yo[0] && S.yo[0].nombre || "").split(",").pop().trim();
  const sinLeer = S.avisos.filter((a) => !a.leida).length;
  const lista = S.contratos.filter((c) => c.rol === S.rol).map(contratoKey)
    .filter((c) => S.anteriores || contratoActivo(c) || (c.rol === "inquilino" && deudaDe(c).length) || (c.rol === "propietario" && ymDe(c.fin) >= ymSumar(ymHoy(), -3)));
  const ocultos = S.contratos.filter((c) => c.rol === S.rol).length - lista.length;
  $("#app").innerHTML = `<header class="phead"><div class="brand brand-fila"><img class="logo logo-chico" src="${LOGO_URL}" alt=""><div><b>M.M. Fuentes</b><span>Hola${nombre ? ", " + esc(nombre) : ""}</span></div></div>
    <div class="row"><button class="btn small" data-a="avisos">Avisos ${sinLeer ? `<span class="badge">${sinLeer}</span>` : ""}</button><button class="btn small" data-a="clave">Cambiar clave</button><button class="btn small" data-a="tema" title="Cambiar entre modo claro y oscuro">${temaActual() === "dark" ? "Modo claro" : "Modo oscuro"}</button><button class="btn small ghost" data-a="salir">Salir</button></div></header>
  <main class="pmain">
    ${S.esStaff ? `<div class="banner">Estás usando una cuenta del equipo. <a href="gestion.html">Ir al sistema de gestión</a></div>` : ""}
    ${roles.length > 1 ? `<div class="seg">${roles.map((r) => `<button data-rol="${r}" aria-pressed="${S.rol === r}">${r === "inquilino" ? "Como inquilino" : "Como propietario"}</button>`).join("")}</div>` : ""}
    ${lista.map((c) => (c.rol === "inquilino" ? tarjetaInquilino(c) : tarjetaPropietario(c))).join("") || `<div class="panel empty">No tenés contratos vigentes.</div>`}
    ${ocultos ? `<button class="btn ghost" data-a="anteriores">${S.anteriores ? "Ocultar contratos anteriores" : `Ver contratos anteriores (${ocultos})`}</button>` : ""}
    ${S.rol === "propietario" ? seccionLiquidaciones() : ""}
    <p class="muted pie">${esc(S.cfg.nombre)} · ${esc(S.cfg.domicilio)}${S.cfg.telefono ? " · " + esc(S.cfg.telefono) : ""}</p>
  </main>`;
}

function cuentaBancaria(titulo, monto, datos) {
  const fila = (l, v) => v ? `<div class="dato"><span class="muted">${l}</span><span class="mono">${esc(v)}</span><button class="btn small ghost" data-copiar="${esc(v)}">Copiar</button></div>` : "";
  const falta = !datos.cbu && !datos.alias;
  return `<div class="transfer"><div class="ph"><b>${titulo}</b><span class="mono monto">${money(monto)}</span></div>
    ${falta ? `<div class="muted">La inmobiliaria todavía no cargó estos datos bancarios. Consultalos antes de transferir.</div>` :
    fila("Titular", datos.titular) + fila("Banco", datos.banco) + fila("CBU/CVU", datos.cbu) + fila("Alias", datos.alias)}
    <button class="btn small ghost" data-copiar="${money(monto).replace(/[^\d,]/g, "")}">Copiar importe</button></div>`;
}

function tarjetaInquilino(c) {
  const d = deudaDe(c), pagos = pgDe(c).filter((p) => !p.anulado), envios = S.envios.filter((e) => e.contrato_id === c.id);
  const actual = d[0];
  const enRevision = (p) => envios.find((e) => e.periodo === p && e.tipo === "pago" && e.estado === "pendiente");
  const rechazo = actual && envios.find((e) => e.periodo === actual.p && e.tipo === "pago" && e.estado === "rechazado" && !envios.some((x) => x.periodo === actual.p && x.tipo === "pago" && x.estado === "pendiente" && x.created_at > e.created_at));
  let pagar;
  if (!actual) {
    const prox = ymSumar(ymHoy(), 1);
    pagar = `<div class="estado ok"><b>Estás al día.</b> ${prox <= ymDe(c.fin) && montoEn(c, ajDe(c), prox) > 0 ? `El alquiler de ${periodo(prox)} es de ${money(montoEn(c, ajDe(c), prox))} y se paga del 1 al ${c.dia_vto || S.cfg.dia_vto}.` : ""}</div>`;
  } else {
    const ev = enRevision(actual.p);
    const lin = lineasDe(actual), div = divisionLineas(c, S.cfg, lin);
    const limiteSinPunitorio = fecha(ymSumar(actual.p, 0) + "-" + String(Math.min(28, (+c.dia_vto || +S.cfg.dia_vto) + (+S.cfg.dias_gracia || 0))).padStart(2, "0"));
    pagar = `<div class="apagar"><div class="ph"><div><span class="muted">A pagar</span><h3>${periodo(actual.p)}</h3></div>${ev ? `<span class="chip warn">Comprobante en revisión</span>` : actual.vencido && !actual.enTolerancia ? `<span class="chip bad">Vencido</span>` : `<span class="chip">Vence el ${fecha(actual.vto)}</span>`}</div>
      <table><tbody>${lin.map((l) => `<tr><td>${l.parcial ? "Saldo s/ " : ""}${esc(l.descripcion)}</td><td class="num">${money(l.monto)}</td></tr>`).join("")}
      ${actual.punitorio ? `<tr><td>Punitorio (${actual.dias} días × ${S.cfg.interes_diario}%)${actual.bonificado ? " · ajustado por la inmobiliaria" : ""}</td><td class="num">${money(actual.punitorio)}</td></tr>` : actual.bonificado ? `<tr><td>Punitorio bonificado</td><td class="num">${money(0)}</td></tr>` : ""}
      <tr class="tot"><td>Total</td><td class="num">${money(div.total)}</td></tr></tbody></table>
      ${!actual.vencido ? `<p class="muted nota">Se paga del 1 al ${c.dia_vto || S.cfg.dia_vto}. Hasta el ${limiteSinPunitorio} no se cobra punitorio.</p>` : actual.enTolerancia ? `<p class="muted nota">Estás dentro de la tolerancia: si pagás hasta el ${limiteSinPunitorio} no se cobra punitorio.</p>` : `<p class="muted nota">El punitorio es el ${S.cfg.interes_diario}% diario desde el día ${(+c.dia_vto || +S.cfg.dia_vto) + 1}. La inmobiliaria puede ajustarlo.</p>`}
      ${d.length > 1 ? `<p class="nota"><b>Además adeudás:</b> ${d.slice(1).map((x) => `${periodo(x.p)} (${money(x.saldo + x.punitorio)})`).join(", ")}.</p>` : ""}
      ${rechazo ? `<div class="banner">Tu envío anterior fue rechazado: ${esc(rechazo.motivo_rechazo)}</div>` : ""}
      ${ev ? `<p class="nota">Enviaste los comprobantes el ${fecha(ev.created_at)}. Cuando la inmobiliaria los confirme, te llega el recibo.</p>` :
        c.forma_pago === "dividida" ? `<p class="nota">Hacé dos transferencias:</p>
          ${cuentaBancaria("1 · Al propietario", div.propietario, { titular: c.prop_titular, banco: c.prop_banco, cbu: c.prop_cbu, alias: c.prop_alias })}
          ${cuentaBancaria("2 · A la inmobiliaria (honorarios y gastos)", div.inmobiliaria, S.cfg)}
          <button class="btn primary grande" data-enviar="${c.id}">Ya transferí: enviar comprobantes</button>` :
        `<p class="nota">Este alquiler se paga en la inmobiliaria.</p>`}
    </div>`;
  }
  const recibos = pagos.slice(0, 12);
  const misEnvios = envios.slice(0, 8);
  return `<section class="panel contrato"><div class="ph"><div><h2 class="dir">${esc(c.direccion)}</h2><div class="muted">Propietario: ${esc(c.propietario_nombre)} · Contrato hasta ${fecha(c.fin)}</div></div></div>
    ${pagar}
    <div class="row"><button class="btn" data-servicios="${c.id}">Enviar boletas de servicios pagados</button></div>
    <details><summary>Recibos (${pagos.length})</summary>${recibos.length ? `<div class="tw"><table><tbody>${recibos.map((p) => `<tr><td>${periodo(p.periodo)}<div class="muted">Recibo ${pad5(p.recibo_nro)} · ${fecha(p.fecha)}</div></td><td class="num">${money(p.total)}</td><td class="num"><button class="btn small" data-recibo="${p.id}">PDF</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">Todavía no hay recibos.</p>`}</details>
    <details><summary>Mis envíos (${envios.length})</summary>${misEnvios.length ? `<div class="tw"><table><tbody>${misEnvios.map((e) => `<tr><td>${e.tipo === "pago" ? "Pago" : "Servicios"} · ${periodo(e.periodo)}<div class="muted">${fecha(e.created_at)}${e.motivo_rechazo ? " · " + esc(e.motivo_rechazo) : ""}</div></td><td>${e.estado === "pendiente" ? `<span class="chip warn">En revisión</span>` : e.estado === "aprobado" ? `<span class="chip ok">Confirmado</span>` : `<span class="chip bad">Rechazado</span>`}</td><td class="files">${S.archivos.filter((a) => a.envio_id === e.id).map((a) => `<button class="file" data-archivo="${esc(a.path)}">${esc(a.servicio || ETIQUETA_ARCHIVO[a.categoria])}</button>`).join("")}</td></tr>`).join("")}</tbody></table></div>` : `<p class="muted">No enviaste nada todavía.</p>`}</details>
  </section>`;
}

function tarjetaPropietario(c) {
  const pagos = pgDe(c).filter((p) => !p.anulado);
  const d = deudaDe(c); const cur = ymHoy();
  const pagoMes = pagos.find((p) => p.periodo === cur);
  const estadoMes = pagoMes ? `<span class="chip ok">Cobrado</span>` : d.some((x) => x.p === cur) ? (d.find((x) => x.p === cur).vencido ? `<span class="chip bad">Pendiente, vencido</span>` : `<span class="chip warn">Pendiente</span>`) : `<span class="chip">—</span>`;
  const periodos = [...new Set([...pagos.map((p) => p.periodo), ...S.archivos.filter((a) => a.contrato_id === c.id && a.periodo).map((a) => a.periodo)])].sort().reverse().slice(0, 12);
  return `<section class="panel contrato"><div class="ph"><div><h2 class="dir">${esc(c.direccion)}</h2><div class="muted">Inquilino: ${esc(c.inquilino_nombre)} · Contrato hasta ${fecha(c.fin)}</div></div></div>
    <dl class="dl"><div><dt>Alquiler ${periodo(cur)}</dt><dd class="mono">${money(montoEn(c, ajDe(c), cur))}</dd></div><div><dt>Estado del mes</dt><dd>${estadoMes}</dd></div><div><dt>Forma de pago</dt><dd>${c.forma_pago === "dividida" ? "El inquilino te transfiere directo" : "Cobra la inmobiliaria"}</dd></div></dl>
    ${d.filter((x) => x.vencido && !x.enTolerancia).length ? `<div class="banner">Hay ${d.filter((x) => x.vencido && !x.enTolerancia).length} período(s) vencido(s) sin pagar. La inmobiliaria está haciendo el seguimiento.</div>` : ""}
    <div class="tw"><table><thead><tr><th>Período</th><th class="num">Cobrado</th><th class="num">Te corresponde</th><th>Documentos</th></tr></thead><tbody>
    ${periodos.map((per) => { const ps = pagos.filter((p) => p.periodo === per); const docs = S.archivos.filter((a) => a.contrato_id === c.id && a.periodo === per);
      const liqs = [...new Set(ps.map((p) => p.liquidacion_id).filter(Boolean))].map((id) => S.liqs.find((l) => l.id === id)).filter(Boolean);
      return `<tr><td>${periodo(per)}${ps[0] ? `<div class="muted">${fecha(ps[0].fecha)}</div>` : ""}</td><td class="num">${ps.length ? money(ps.reduce((s, p) => s + +p.total, 0)) : "—"}</td><td class="num">${ps.length ? money(ps.reduce((s, p) => s + +p.neto_propietario, 0)) : "—"}</td>
      <td class="files">${liqs.map((l) => `<button class="file" data-liq="${l.id}">Liquidación ${pad5(l.nro)}</button>`).join("")}${docs.map((a) => `<button class="file" data-archivo="${esc(a.path)}">${esc(a.categoria === "boleta" ? (a.servicio || "Boleta") : ETIQUETA_ARCHIVO[a.categoria])}</button>`).join("")}${!liqs.length && !docs.length ? `<span class="muted">${ps.length ? "Pendiente de liquidar" : "—"}</span>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="4"><div class="empty">Todavía no hay cobros registrados.</div></td></tr>`}
    </tbody></table></div></section>`;
}

function seccionLiquidaciones() {
  const ls = S.liqs.filter((l) => !l.anulada).slice(0, 24);
  if (!ls.length) return "";
  return `<section class="panel"><h2>Mis liquidaciones</h2><div class="tw"><table><tbody>${ls.map((l) => { const comp = S.archivos.filter((a) => a.liquidacion_id === l.id);
    return `<tr><td>N° ${pad5(l.nro)}<div class="muted">${fecha(l.fecha)} · ${l.modalidad === "directa" ? "Transferencia directa del inquilino" : esc(l.medio || "")}</div></td><td class="num">${money(l.neto)}</td><td class="files"><button class="file" data-liq="${l.id}">PDF</button>${comp.map((a) => `<button class="file" data-archivo="${esc(a.path)}">Comprobante</button>`).join("")}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}

/* ---------- formularios de envío ---------- */
function modalEnvioPago(cid) {
  const c = contratoKey(S.contratos.find((x) => x.id === +cid && x.rol === "inquilino")); const d = deudaDe(c);
  const pend = d.filter((x) => !S.envios.some((e) => e.contrato_id === c.id && e.periodo === x.p && e.tipo === "pago" && e.estado === "pendiente"));
  if (!pend.length) { toast("No hay períodos pendientes para informar."); return; }
  const x = pend[0], div = divisionLineas(c, S.cfg, lineasDe(x));
  abrirModal(`<div class="mh"><div><h2>Enviar comprobantes</h2><div class="muted">${esc(c.direccion)}</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form class="form" id="f-pago" data-id="${c.id}">
    <label class="full">Período que pagaste<select id="ep-periodo" name="periodo">${pend.map((y) => `<option value="${y.p}">${periodo(y.p)}</option>`).join("")}</select></label>
    <label>Transferiste al propietario<input type="number" step="0.01" id="ep-prop" name="monto_propietario" value="${div.propietario}" required></label>
    <label>Transferiste a la inmobiliaria<input type="number" step="0.01" id="ep-inmo" name="monto_inmobiliaria" value="${div.inmobiliaria}" required></label>
    <label class="full">Comprobante de la transferencia al propietario<input type="file" id="ep-f1" name="f1" accept="${ARCHIVOS_OK}" required></label>
    <label class="full">Comprobante de la transferencia a la inmobiliaria<input type="file" id="ep-f2" name="f2" accept="${ARCHIVOS_OK}" required></label>
    <label class="full">Boletas de servicios pagados (opcional, podés elegir varias)<input type="file" id="ep-bol" name="boletas" accept="${ARCHIVOS_OK}" multiple></label>
    <label class="full">¿Qué servicios pagaste? (opcional)<input type="text" id="ep-serv" name="servicio" placeholder="Ej.: Luz, gas, ABL"></label>
    <label class="full">Observaciones (opcional)<textarea id="ep-obs" name="observaciones" rows="2"></textarea></label>
    <p class="full muted" style="margin:0">Fotos o PDF de hasta ${MAX_MB} MB cada uno.</p>
    <div class="full row"><button class="btn primary grande" type="submit">Enviar a la inmobiliaria</button></div>
    <div class="full" id="ep-progreso" aria-live="polite"></div>
  </form>`);
}
function modalEnvioServicios(cid) {
  const c = S.contratos.find((x) => x.id === +cid && x.rol === "inquilino"); const cur = ymHoy();
  const pers = [cur, ymSumar(cur, -1), ymSumar(cur, -2)];
  abrirModal(`<div class="mh"><div><h2>Boletas de servicios</h2><div class="muted">${esc(c.direccion)}</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form class="form" id="f-servicios" data-id="${c.id}">
    <label>Mes<select id="es-periodo" name="periodo">${pers.map((p) => `<option value="${p}">${periodo(p)}</option>`).join("")}</select></label>
    <label>¿Qué servicios?<input type="text" id="es-serv" name="servicio" placeholder="Ej.: Luz, gas, ABL" required></label>
    <label class="full">Boletas o comprobantes (podés elegir varios)<input type="file" id="es-bol" name="boletas" accept="${ARCHIVOS_OK}" multiple required></label>
    <label class="full">Observaciones (opcional)<textarea id="es-obs" name="observaciones" rows="2"></textarea></label>
    <div class="full row"><button class="btn primary grande" type="submit">Enviar</button></div>
    <div class="full" id="es-progreso" aria-live="polite"></div>
  </form>`);
}
async function subir(cid, per, envioId, categoria, file, servicio) {
  if (file.size > MAX_MB * 1048576) throw new Error(`"${file.name}" pesa más de ${MAX_MB} MB.`);
  const path = rutaArchivo(cid, per, file.name);
  const { error: e1 } = await sb.from("archivos").insert({ contrato_id: cid, periodo: per, envio_id: envioId, categoria, servicio: servicio || null, path, nombre: file.name, mime: file.type, tamano: file.size, subido_por: (await sb.auth.getUser()).data.user.id });
  if (e1) throw e1;
  const { error: e2 } = await sb.storage.from("documentos").upload(path, file, { contentType: file.type || undefined });
  if (e2) throw e2;
}
async function enviar(f, tipo) {
  const cid = +f.dataset.id, v = Object.fromEntries(new FormData(f).entries());
  const archivos = [];
  if (tipo === "pago") { archivos.push(["comp_propietario", f.f1.files[0]], ["comp_inmobiliaria", f.f2.files[0]]); }
  for (const b of f.boletas.files) archivos.push(["boleta", b]);
  for (const [, a] of archivos) if (a && a.size > MAX_MB * 1048576) { toast(`"${a.name}" pesa más de ${MAX_MB} MB. Achicá la foto o subí un PDF.`, "bad"); return; }
  const prog = f.querySelector("[aria-live]"); const boton = f.querySelector("[type=submit]"); boton.disabled = true;
  const uid = (await sb.auth.getUser()).data.user.id;
  const { data: env, error } = await sb.from("envios").insert({ contrato_id: cid, periodo: v.periodo, tipo, creado_por: uid,
    monto_propietario: tipo === "pago" ? r2(v.monto_propietario) : null, monto_inmobiliaria: tipo === "pago" ? r2(v.monto_inmobiliaria) : null,
    observaciones: (v.observaciones || "").trim() || null }).select().single();
  if (error) { toast(mensajeError(error), "bad"); boton.disabled = false; return; }
  let fallas = 0;
  for (let i = 0; i < archivos.length; i++) {
    const [cat, file] = archivos[i]; prog.textContent = `Subiendo archivo ${i + 1} de ${archivos.length}…`;
    try { await subir(cid, v.periodo, env.id, cat, file, cat === "boleta" ? (v.servicio || "").trim() : null); } catch (e) { fallas++; console.error(e); }
  }
  cerrarModal();
  toast(fallas ? `Se envió, pero ${fallas} archivo(s) no se pudieron subir. Avisale a la inmobiliaria.` : tipo === "pago" ? "Listo. Te avisamos cuando la inmobiliaria confirme el pago." : "Listo. Enviamos las boletas a la inmobiliaria.", fallas ? "bad" : "");
  await iniciar();
}

/* ---------- eventos ---------- */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button,a"); if (!el) return; const d = el.dataset;
  try {
    if (d.a === "tema") { alternarTema(); el.textContent = temaActual() === "dark" ? "Modo claro" : "Modo oscuro"; return; }
    if (d.a === "salir") { await sb.auth.signOut(); location.reload(); return; }
    if (d.a === "anteriores") { S.anteriores = !S.anteriores; render(); return; }
    if (d.rol) { S.rol = d.rol; render(); return; }
    if (d.copiar !== undefined) { copiar(d.copiar); return; }
    if (d.enviar) { modalEnvioPago(d.enviar); return; }
    if (d.servicios) { modalEnvioServicios(d.servicios); return; }
    if (d.archivo) { await verArchivo(d.archivo); return; }
    if (d.recibo) { const p = S.pg.find((x) => x.id === +d.recibo); const c = S.contratos.find((x) => x.id === p.contrato_id); const r = pdfRecibo(S.cfg, { direccion: c.direccion, inquilino: c.inquilino_nombre, carpeta: c.carpeta, propietario: c.propietario_nombre }, p); r.doc.save(r.nombre); return; }
    if (d.liq) { const l = S.liqs.find((x) => x.id === +d.liq); const yo = S.yo.find((p) => p.id === l.propietario_id) || S.yo[0] || {}; const r = pdfLiquidacion(S.cfg, l, yo); r.doc.save(r.nombre); return; }
    if (d.a === "avisos") {
      abrirModal(`<div class="mh"><h2>Avisos</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div>${S.avisos.length ? S.avisos.map((a) => `<div class="aviso ${a.leida ? "" : "nuevo"}"><b>${esc(a.titulo)}</b><div>${esc(a.texto || "")}</div><div class="muted">${fecha(a.created_at)}</div></div>`).join("") : `<p class="muted">No tenés avisos.</p>`}`);
      const ids = S.avisos.filter((a) => !a.leida).map((a) => a.id);
      if (ids.length) { await sb.from("notificaciones").update({ leida: true }).in("id", ids); S.avisos.forEach((a) => (a.leida = true)); }
      return;
    }
    if (d.a === "clave") {
      abrirModal(`<div class="mh"><h2>Cambiar clave</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div><form class="form" id="f-clave"><label class="full">Clave nueva (mínimo 8 caracteres)<input type="password" id="cl-1" name="c1" minlength="8" required autocomplete="new-password"></label><label class="full">Repetila<input type="password" id="cl-2" name="c2" minlength="8" required autocomplete="new-password"></label><div class="full row"><button class="btn primary" type="submit">Guardar</button></div></form>`);
      return;
    }
  } catch (e) { toast(mensajeError(e), "bad"); }
});
document.addEventListener("change", (ev) => {
  if (ev.target.id === "ep-periodo") {
    const f = ev.target.form; const c = contratoKey(S.contratos.find((x) => x.id === +f.dataset.id && x.rol === "inquilino"));
    const x = deudaDe(c).find((y) => y.p === ev.target.value); if (!x) return;
    const div = divisionLineas(c, S.cfg, lineasDe(x)); f.monto_propietario.value = div.propietario; f.monto_inmobiliaria.value = div.inmobiliaria;
  }
});
document.addEventListener("submit", async (ev) => {
  ev.preventDefault(); const f = ev.target; const v = Object.fromEntries(new FormData(f).entries());
  try {
    if (f.id === "f-login") {
      const dni = String(v.dni).replace(/\D/g, "");
      const { error } = await sb.auth.signInWithPassword({ email: `${dni}@${DOMINIO_USUARIOS}`, password: v.clave });
      if (error) return pantallaLogin("DNI o clave incorrectos.");
      return iniciar();
    }
    if (f.id === "f-pago") return await enviar(f, "pago");
    if (f.id === "f-servicios") return await enviar(f, "servicios");
    if (f.id === "f-clave") {
      if (v.c1 !== v.c2) { toast("Las claves no coinciden", "bad"); return; }
      const { error } = await sb.auth.updateUser({ password: v.c1 }); if (error) throw error;
      cerrarModal(); toast("Clave actualizada");
    }
  } catch (e) { toast(mensajeError(e), "bad"); }
});
iniciar();

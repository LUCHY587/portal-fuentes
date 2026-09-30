// Cobranza Fuentes · Sistema de gestión de la inmobiliaria
import {
  sb, money, r2, pad5, esc, isoHoy, ymHoy, ymDe, ymSumar, periodo, fecha, diasEntre, MEDIOS,
  estadoContrato, ESTADOS, contratoActivo, ajustesValidos, montoEn, comisionDe, deuda, division, proximoAjuste,
  toast, abrirModal, cerrarModal, copiar, mensajeError, wa, rutaArchivo, verArchivo, ETIQUETA_ARCHIVO, ARCHIVOS_OK,
  pdfRecibo, pdfLiquidacion,
} from "./comun.js";

const $ = (s) => document.querySelector(s);
const PORTAL_URL = new URL("./", location.href).href;

const S = {
  cfg: null, yo: null, contratos: new Map(), personas: new Map(), aj: new Map(), pg: new Map(), ov: new Map(),
  liqs: [], envios: [], archEnvio: new Map(), caja: [], staff: [],
  view: "inicio", filtro: "vigentes", orden: "direccion", q: "", limite: 150, cajaMes: ymHoy(), cajaDia: isoHoy(),
  tipoPersona: "inquilino", cargado: false,
};
try { S.orden = localStorage.getItem("orden") || S.orden; } catch {}

/* ================= carga de datos ================= */
async function traerTodo(tabla, armar = (q) => q) {
  const out = []; let desde = 0;
  for (;;) {
    const { data, error } = await armar(sb.from(tabla).select("*")).range(desde, desde + 999);
    if (error) throw error;
    out.push(...data); if (data.length < 1000) break; desde += 1000;
  }
  return out;
}
const agrupar = (filas, campo) => { const m = new Map(); for (const f of filas) { if (!m.has(f[campo])) m.set(f[campo], []); m.get(f[campo]).push(f); } return m; };

async function cargarTodo() {
  const [cfg, per, con, aj, ov, pg, liq, st] = await Promise.all([
    sb.from("config").select("*").eq("id", 1).single().then((r) => { if (r.error) throw r.error; return r.data; }),
    traerTodo("personas"), traerTodo("contratos"), traerTodo("ajustes"), traerTodo("punitorio_override"),
    traerTodo("pagos"), traerTodo("liquidaciones", (q) => q.order("nro", { ascending: false })), traerTodo("staff"),
  ]);
  S.cfg = cfg; S.personas = new Map(per.map((p) => [p.id, p]));
  S.contratos = new Map(con.map((c) => [c.id, c]));
  S.aj = agrupar(aj, "contrato_id"); S.pg = agrupar(pg, "contrato_id");
  S.ov = new Map(); for (const o of ov) { if (!S.ov.has(o.contrato_id)) S.ov.set(o.contrato_id, {}); S.ov.get(o.contrato_id)[o.periodo] = +o.monto; }
  S.liqs = liq; S.staff = st;
  await Promise.all([cargarEnvios(), cargarCaja()]);
  S.cargado = true;
}
async function cargarEnvios() {
  const desde = new Date(Date.now() - 120 * 864e5).toISOString();
  const { data, error } = await sb.from("envios").select("*").or(`estado.eq.pendiente,created_at.gte.${desde}`).order("created_at", { ascending: false }).limit(1000);
  if (error) throw error;
  S.envios = data;
  const ids = data.filter((e) => e.estado === "pendiente").map((e) => e.id);
  S.archEnvio = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: a } = await sb.from("archivos").select("*").in("envio_id", ids.slice(i, i + 200));
    for (const f of a || []) { if (!S.archEnvio.has(f.envio_id)) S.archEnvio.set(f.envio_id, []); S.archEnvio.get(f.envio_id).push(f); }
  }
}
async function cargarCaja() {
  const [y, m] = S.cajaMes.split("-").map(Number);
  const fin = ymSumar(S.cajaMes, 1) + "-01";
  const { data } = await sb.from("caja_movimientos").select("*").gte("fecha", S.cajaMes + "-01").lt("fecha", fin).order("fecha");
  S.caja = data || [];
}
async function recargar(msg) {
  try { await cargarTodo(); render(); if (msg) toast(msg); } catch (e) { toast(mensajeError(e), "bad"); }
}

/* ================= helpers de dominio ================= */
const P = (id) => S.personas.get(id) || { nombre: "(sin nombre)" };
const ajDe = (c) => S.aj.get(c.id) || [];
const pgDe = (c) => S.pg.get(c.id) || [];
const ovDe = (c) => S.ov.get(c.id) || {};
const deudaDe = (c) => deuda(c, ajDe(c), pgDe(c), S.cfg, ovDe(c));
const montoHoy = (c) => montoEn(c, ajDe(c), ymHoy());
const inq = (c) => P(c.inquilino_id).nombre, prop = (c) => P(c.propietario_id).nombre;
const chipEstado = (c) => { const [k, l] = ESTADOS[estadoContrato(c)]; return `<span class="chip ${k}">${l}</span>`; };
const pendientesRevisar = () => S.envios.filter((e) => e.estado === "pendiente");
const puedeAdmin = () => S.yo && S.yo.rol === "admin";
async function rpc(fn, args, ok) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) { toast(mensajeError(error), "bad"); return null; }
  if (ok) toast(ok);
  return data ?? true;
}

/* ================= navegación ================= */
const VISTAS = [["inicio", "Inicio"], ["revisar", "Pagos a revisar"], ["contratos", "Contratos"], ["cobrar", "Cobrar en oficina"], ["morosos", "Morosos"],
  ["ajustes", "Ajustes de precio"], ["liquidaciones", "Liquidaciones"], ["caja", "Caja"], ["personas", "Inquilinos y propietarios"], ["config", "Configuración"]];
function renderNav() {
  const cs = [...S.contratos.values()];
  const n = { revisar: pendientesRevisar().length,
    morosos: S.cargado ? cs.filter((c) => deudaDe(c).some((d) => d.vencido && !d.enTolerancia)).length : 0,
    ajustes: S.cargado ? cs.filter((c) => contratoActivo(c) && (proximoAjuste(c, ajDe(c), S.cfg) || "9") <= ymHoy()).length : 0 };
  $("#nav").innerHTML = VISTAS.map(([k, l]) => `<button data-vista="${k}" ${S.view === k ? 'aria-current="page"' : ""}><span>${l}</span>${n[k] ? `<span class="n">${n[k]}</span>` : ""}</button>`).join("");
  $("#quien").textContent = S.yo ? S.yo.nombre : "";
}
function render() {
  renderNav();
  if (!S.cargado) { $("#main").innerHTML = `<div class="cargando">Cargando contratos…</div>`; return; }
  const v = { inicio: vInicio, revisar: vRevisar, contratos: vContratos, cobrar: vCobrar, morosos: vMorosos, ajustes: vAjustes,
    liquidaciones: vLiquidaciones, caja: vCaja, personas: vPersonas, config: vConfig }[S.view] || vInicio;
  $("#main").innerHTML = v();
}

/* ================= vistas ================= */
function vInicio() {
  const cur = ymHoy(), hoy = isoHoy(), cs = [...S.contratos.values()];
  const act = cs.filter((c) => contratoActivo(c) && c.inicio <= hoy);
  const aCobrar = act.reduce((s, c) => s + montoEn(c, ajDe(c), cur), 0);
  let mes = 0, dia = 0; for (const lst of S.pg.values()) for (const p of lst) if (!p.anulado) { if (ymDe(p.fecha) === cur) mes += +p.total; if (p.fecha === hoy) dia += +p.total; }
  const mor = cs.map((c) => ({ c, d: deudaDe(c).filter((x) => x.vencido && !x.enTolerancia) })).filter((x) => x.d.length)
    .map((x) => ({ ...x, tot: x.d.reduce((s, d) => s + d.saldo, 0) })).sort((a, b) => b.tot - a.tot);
  const rev = pendientesRevisar();
  const aj = act.map((c) => ({ c, p: proximoAjuste(c, ajDe(c), S.cfg) })).filter((x) => x.p && x.p <= ymSumar(cur, 1)).sort((a, b) => (a.p < b.p ? -1 : 1));
  const venc = cs.filter((c) => estadoContrato(c) === "porvencer").sort((a, b) => (a.fin < b.fin ? -1 : 1));
  const liq = pendientesLiquidar(); const liqTot = liq.reduce((s, g) => s + g.neto, 0);
  const fila = (html) => `<div class="tw"><table><tbody>${html}</tbody></table></div>`;
  return `<div class="head"><div><h1>${periodo(cur)}</h1><p>${act.length} contratos vigentes · ${cs.length} en la base</p></div>
  <div class="row"><button class="btn primary" data-vista="cobrar">Cobrar en oficina</button></div></div>
  ${cur < S.cfg.inicio_cobranza ? `<div class="banner">El control de cobros empieza en ${periodo(S.cfg.inicio_cobranza)}. Los meses anteriores se gestionaron en SPOT.</div>` : ""}
  <div class="kpis">
    <div class="kpi ${rev.length ? "alert" : ""}"><span class="l">Pagos a revisar</span><span class="v">${rev.length}</span><span class="s">enviados desde el portal</span></div>
    <div class="kpi"><span class="l">Cobrado este mes</span><span class="v">${money(mes)}</span><span class="s">de ${money(aCobrar)} · hoy ${money(dia)}</span></div>
    <div class="kpi ${mor.length ? "alert" : ""}"><span class="l">Deuda vencida</span><span class="v">${money(mor.reduce((s, x) => s + x.tot, 0))}</span><span class="s">${mor.length} inquilinos (pasada la tolerancia)</span></div>
    <div class="kpi"><span class="l">A liquidar a propietarios</span><span class="v">${money(liqTot)}</span><span class="s">${liq.length} propietarios</span></div>
  </div>
  <div class="grid2">
    <section class="panel"><div class="ph"><h2>Pagos a revisar</h2><button class="btn ghost small" data-vista="revisar">Ver todos</button></div>
      ${rev.length ? fila(rev.slice(0, 6).map((e) => { const c = S.contratos.get(e.contrato_id); return `<tr class="click" data-vista="revisar"><td>${esc(inq(c))}<div class="muted">${esc(c.direccion)}</div></td><td><span class="chip ${e.tipo === "pago" ? "warn" : "acc"}">${e.tipo === "pago" ? "Pago" : "Servicios"}</span></td><td class="num">${periodo(e.periodo)}</td></tr>`; }).join("")) : `<div class="empty">No hay nada pendiente de revisión.</div>`}</section>
    <section class="panel"><div class="ph"><h2>Morosos</h2><button class="btn ghost small" data-vista="morosos">Ver todos</button></div>
      ${mor.length ? fila(mor.slice(0, 6).map((x) => `<tr class="click" data-ficha="${x.c.id}"><td>${esc(inq(x.c))}<div class="muted">${esc(x.c.direccion)}</div></td><td><span class="chip bad">${x.d.length} ${x.d.length > 1 ? "meses" : "mes"}</span></td><td class="num">${money(x.tot)}</td></tr>`).join("")) : `<div class="empty">No hay deudas vencidas.</div>`}</section>
    <section class="panel"><div class="ph"><h2>Ajustes de precio próximos</h2><button class="btn ghost small" data-vista="ajustes">Ver todos</button></div>
      ${aj.length ? fila(aj.slice(0, 6).map((x) => `<tr class="click" data-ficha="${x.c.id}"><td>${esc(x.c.direccion)}<div class="muted">${esc(inq(x.c))}</div></td><td><span class="chip ${x.p <= cur ? "warn" : "acc"}">${periodo(x.p)}</span></td><td class="mono">${esc(x.c.indice)}</td></tr>`).join("")) : `<div class="empty">No hay ajustes este mes ni el próximo.</div>`}</section>
    <section class="panel"><div class="ph"><h2>Vencen en 90 días</h2><button class="btn ghost small" data-vista="contratos" data-filtro="porvencer">Ver todos</button></div>
      ${venc.length ? fila(venc.slice(0, 6).map((c) => `<tr class="click" data-ficha="${c.id}"><td>${esc(c.direccion)}<div class="muted">${esc(inq(c))}</div></td><td class="num">${fecha(c.fin)}</td></tr>`).join("")) : `<div class="empty">Ningún contrato vence en los próximos 90 días.</div>`}</section>
  </div>`;
}

function vRevisar() {
  const pend = pendientesRevisar().slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  const hist = S.envios.filter((e) => e.estado !== "pendiente").slice(0, 40);
  return `<div class="head"><div><h1>Pagos a revisar</h1><p>Comprobantes y boletas que enviaron los inquilinos desde el portal. Revisá en el banco y aprobá: el recibo sale solo.</p></div>
  <button class="btn" data-a="refrescar">Actualizar</button></div>
  ${pend.length ? pend.map(tarjetaEnvio).join("") : `<div class="panel empty">No hay envíos pendientes.</div>`}
  <h2>Revisados en los últimos meses</h2>
  <div class="tw"><table><thead><tr><th>Enviado</th><th>Inquilino</th><th>Dirección</th><th>Período</th><th>Tipo</th><th>Estado</th></tr></thead><tbody>
  ${hist.map((e) => { const c = S.contratos.get(e.contrato_id) || {}; return `<tr class="click" data-ficha="${c.id}"><td class="num">${fecha(e.created_at)}</td><td>${esc(inq(c))}</td><td>${esc(c.direccion)}</td><td>${periodo(e.periodo)}</td><td>${e.tipo === "pago" ? "Pago" : "Servicios"}</td><td>${e.estado === "aprobado" ? `<span class="chip ok">Aprobado</span>` : `<span class="chip bad" title="${esc(e.motivo_rechazo)}">Rechazado</span>`}</td></tr>`; }).join("") || `<tr><td colspan="6"><div class="empty">Sin historial.</div></td></tr>`}
  </tbody></table></div>`;
}
function tarjetaEnvio(e) {
  const c = S.contratos.get(e.contrato_id); if (!c) return "";
  const d = deudaDe(c).find((x) => x.p === e.periodo);
  const alq = d ? d.saldo : montoEn(c, ajDe(c), e.periodo), pun = d ? d.punitorio : 0;
  const esp = division(c, S.cfg, alq, pun);
  const arch = S.archEnvio.get(e.id) || [];
  const declarado = r2((+e.monto_propietario || 0) + (+e.monto_inmobiliaria || 0));
  return `<section class="panel"><div class="ph"><div><b>${esc(inq(c))}</b> · ${esc(c.direccion)}<div class="muted">${e.tipo === "pago" ? "Pago" : "Boletas de servicios"} de ${periodo(e.periodo)} · enviado el ${fecha(e.created_at)} ${new Date(e.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</div></div>
    <span class="chip ${c.forma_pago === "dividida" ? "acc" : ""}">${c.forma_pago === "dividida" ? "Transferencia dividida" : "Paga en la inmobiliaria"}</span></div>
    ${e.tipo === "pago" ? `<div class="tw"><table><thead><tr><th></th><th class="num">Declaró</th><th class="num">Esperado</th></tr></thead><tbody>
      <tr><td>Al propietario</td><td class="num">${money(e.monto_propietario)}</td><td class="num">${money(esp.propietario)}</td></tr>
      <tr><td>A la inmobiliaria (honorarios ${comisionDe(c, S.cfg)}%)</td><td class="num">${money(e.monto_inmobiliaria)}</td><td class="num">${money(esp.inmobiliaria)}</td></tr>
      <tr><td><b>Total</b>${pun ? ` <span class="muted">(incluye punitorio sugerido ${money(pun)}${d && d.bonificado ? ", bonificado" : ""})</span>` : ""}</td><td class="num"><b>${money(declarado)}</b></td><td class="num"><b>${money(esp.total)}</b></td></tr>
    </tbody></table></div>${Math.abs(declarado - esp.total) > 1 ? `<div class="banner">Lo declarado no coincide con lo esperado. Revisalo antes de aprobar.</div>` : ""}` : ""}
    ${e.observaciones ? `<div><span class="muted">Observaciones del inquilino:</span> ${esc(e.observaciones)}</div>` : ""}
    <div class="files">${arch.map((a) => `<button class="file" data-archivo="${esc(a.path)}">📄 ${esc(ETIQUETA_ARCHIVO[a.categoria])}${a.servicio ? " · " + esc(a.servicio) : ""}</button>`).join("") || `<span class="muted">Sin archivos adjuntos.</span>`}</div>
    <div class="row">${e.tipo === "pago" ? `<button class="btn primary" data-aprobar="${e.id}">Aprobar y enviar recibo</button>` : `<button class="btn primary" data-servicios="${e.id}">Marcar revisado y avisar al propietario</button>`}
    <button class="btn danger" data-rechazar="${e.id}">Rechazar</button> <button class="btn ghost" data-ficha="${c.id}">Ver ficha</button></div></section>`;
}

function filtrarContratos() {
  const q = S.q.trim().toLowerCase();
  const cmp = S.orden === "vencimiento" ? (a, b) => a.fin.localeCompare(b.fin) || a.direccion.localeCompare(b.direccion, "es", { numeric: true })
    : S.orden === "reciente" ? (a, b) => b.inicio.localeCompare(a.inicio)
    : (a, b) => a.direccion.localeCompare(b.direccion, "es", { numeric: true, sensitivity: "base" });
  return [...S.contratos.values()].filter((c) => {
    const e = estadoContrato(c);
    if (S.filtro === "vigentes" && !["vigente", "porvencer", "futuro"].includes(e)) return false;
    if (S.filtro === "porvencer" && e !== "porvencer") return false;
    if (S.filtro === "vencidos" && !["vencido", "rescindido"].includes(e)) return false;
    return !q || [c.carpeta, c.direccion, inq(c), prop(c), P(c.inquilino_id).telefono, P(c.inquilino_id).dni].join(" ").toLowerCase().includes(q);
  }).sort(cmp);
}
function vContratos() {
  const list = filtrarContratos(), shown = list.slice(0, S.limite);
  const f = (k, l) => `<button data-filtro="${k}" aria-pressed="${S.filtro === k}">${l}</button>`;
  const o = (k, l) => `<button data-orden="${k}" aria-pressed="${S.orden === k}">${l}</button>`;
  return `<div class="head"><div><h1>Contratos</h1><p>${list.length} resultados</p></div><button class="btn primary" data-a="nuevo-contrato">Nuevo contrato</button></div>
  <div class="row"><input type="search" id="q" class="search" placeholder="Buscar por dirección, inquilino, propietario, DNI o carpeta" value="${esc(S.q)}">
  <div class="seg">${f("vigentes", "Vigentes")}${f("porvencer", "Por vencer")}${f("vencidos", "Vencidos y rescindidos")}${f("todos", "Todos")}</div></div>
  <div class="row"><span class="muted">Ordenar por</span><div class="seg">${o("direccion", "Dirección (A–Z)")}${o("vencimiento", "Vencimiento (más próximo primero)")}${o("reciente", "Más recientes")}</div></div>
  <div class="tw"><table><thead><tr><th>Carpeta</th><th>Dirección</th><th>Inquilino</th><th>Propietario</th><th>Pago</th><th>Vence</th><th class="num">Alquiler actual</th><th>Estado</th></tr></thead><tbody>
  ${shown.map((c) => `<tr class="click" data-ficha="${c.id}"><td class="mono">${c.carpeta || "—"}</td><td>${esc(c.direccion)}</td><td>${esc(inq(c))}</td><td>${esc(prop(c))}</td><td>${c.forma_pago === "dividida" ? `<span class="chip acc">Dividida</span>` : `<span class="chip">Oficina</span>`}</td><td class="num">${fecha(c.fin)}</td><td class="num">${money(montoHoy(c))}</td><td>${chipEstado(c)}</td></tr>`).join("") || `<tr><td colspan="8"><div class="empty">No hay contratos con ese filtro.</div></td></tr>`}
  </tbody></table></div>${list.length > shown.length ? `<div class="row"><button class="btn" data-a="mas">Mostrar más</button></div>` : ""}`;
}

function vCobrar() {
  const q = S.q.trim().toLowerCase();
  const act = [...S.contratos.values()].filter((c) => contratoActivo(c) || deudaDe(c).length);
  const list = (q ? act.filter((c) => [c.carpeta, c.direccion, inq(c), prop(c)].join(" ").toLowerCase().includes(q)) : act)
    .map((c) => ({ c, d: deudaDe(c) })).sort((a, b) => b.d.length - a.d.length || a.c.direccion.localeCompare(b.c.direccion, "es", { numeric: true })).slice(0, 80);
  return `<div class="head"><div><h1>Cobrar en oficina</h1><p>Para pagos en efectivo o transferencias recibidas por la inmobiliaria.</p></div></div>
  <input type="search" id="q" class="search" placeholder="Inquilino, dirección o carpeta" value="${esc(S.q)}" autofocus>
  <div class="tw"><table><thead><tr><th>Inquilino</th><th>Dirección</th><th>Pendiente</th><th class="num">Saldo</th><th></th></tr></thead><tbody>
  ${list.map(({ c, d }) => `<tr><td>${esc(inq(c))}</td><td>${esc(c.direccion)}</td><td>${d.length ? d.map((x) => `<span class="chip ${x.vencido && !x.enTolerancia ? "bad" : "warn"}">${periodo(x.p)}</span>`).join(" ") : `<span class="chip ok">Al día</span>`}</td><td class="num">${money(d.reduce((s, x) => s + x.saldo, 0))}</td><td class="num"><button class="btn small primary" data-cobrar="${c.id}">Cobrar</button> <button class="btn small" data-ficha="${c.id}">Ficha</button></td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">Sin resultados.</div></td></tr>`}
  </tbody></table></div>`;
}

function vMorosos() {
  const mor = [...S.contratos.values()].map((c) => ({ c, d: deudaDe(c).filter((x) => x.vencido) })).filter((x) => x.d.length)
    .map((x) => ({ ...x, tot: x.d.reduce((s, d) => s + d.saldo, 0), dias: Math.max(...x.d.map((d) => d.dias)) })).sort((a, b) => b.dias - a.dias || b.tot - a.tot);
  return `<div class="head"><div><h1>Morosos</h1><p>${mor.length} inquilinos con períodos vencidos · ${money(mor.reduce((s, x) => s + x.tot, 0))}. Los que están dentro de los ${S.cfg.dias_gracia} días de tolerancia figuran en amarillo.</p></div></div>
  <div class="tw"><table><thead><tr><th>Inquilino</th><th>Dirección</th><th>Celular</th><th>Períodos</th><th class="num">Días</th><th class="num">Deuda</th><th class="num">Punitorio sugerido</th><th></th></tr></thead><tbody>
  ${mor.map((x) => `<tr><td>${esc(inq(x.c))}</td><td>${esc(x.c.direccion)}</td><td class="mono">${esc(P(x.c.inquilino_id).telefono || "—")}</td><td>${x.d.map((d) => `<span class="chip ${d.enTolerancia ? "warn" : "bad"}">${periodo(d.p)}</span>`).join(" ")}</td><td class="num">${x.dias}</td><td class="num">${money(x.tot)}</td><td class="num">${money(x.d.reduce((s, d) => s + d.punitorio, 0))}</td>
  <td class="num"><button class="btn small" data-recordar="${x.c.id}">Copiar aviso</button> <button class="btn small primary" data-cobrar="${x.c.id}">Cobrar</button></td></tr>`).join("") || `<tr><td colspan="8"><div class="empty">No hay inquilinos con deuda vencida.</div></td></tr>`}
  </tbody></table></div>`;
}

function vAjustes() {
  const cur = ymHoy();
  const act = [...S.contratos.values()].filter(contratoActivo).map((c) => ({ c, p: proximoAjuste(c, ajDe(c), S.cfg) })).filter((x) => x.p).sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0));
  const revisar = [...S.contratos.values()].filter((c) => contratoActivo(c) && c.ajuste_revisar).length;
  const tabla = (arr) => `<div class="tw"><table><thead><tr><th>Dirección</th><th>Inquilino</th><th>Índice</th><th>Cada</th><th>Ajusta desde</th><th class="num">Alquiler actual</th><th></th></tr></thead><tbody>
  ${arr.map((x) => `<tr><td>${esc(x.c.direccion)}</td><td>${esc(inq(x.c))}</td><td class="mono">${esc(x.c.indice)}</td><td>${x.c.ajuste_meses} meses ${x.c.ajuste_revisar ? `<span class="chip warn">Revisar</span>` : ""}</td><td><span class="chip ${x.p <= cur ? "warn" : "acc"}">${periodo(x.p)}</span></td><td class="num">${money(montoEn(x.c, ajDe(x.c), ymSumar(x.p, -1)))}</td><td class="num"><button class="btn small primary" data-ajustar="${x.c.id}">Aplicar ajuste</button></td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">Nada en este rango.</div></td></tr>`}</tbody></table></div>`;
  return `<div class="head"><div><h1>Ajustes de precio</h1><p>Cargá el porcentaje del índice (de tu Calculadora) y se calcula el nuevo alquiler. El inquilino lo ve actualizado en el portal.</p></div></div>
  ${revisar ? `<div class="banner">${revisar} contratos vigentes tienen la periodicidad sin confirmar (se cargó 12 meses para ICL y Casa Propia, 3 para IPC). Confirmala en "Datos del contrato".</div>` : ""}
  <h2>Este mes y el próximo</h2>${tabla(act.filter((x) => x.p <= ymSumar(cur, 1)))}<h2>Próximos 3 meses</h2>${tabla(act.filter((x) => x.p > ymSumar(cur, 1) && x.p <= ymSumar(cur, 4)))}`;
}

function pendientesLiquidar() {
  const by = new Map();
  for (const c of S.contratos.values()) for (const p of pgDe(c)) {
    if (p.anulado || p.liquidacion_id || p.modalidad !== "inmobiliaria") continue;
    if (!by.has(c.propietario_id)) by.set(c.propietario_id, { pid: c.propietario_id, items: [] });
    by.get(c.propietario_id).items.push({ c, p });
  }
  return [...by.values()].map((g) => { const com = r2(g.items.reduce((s, i) => s + +i.p.honorarios, 0)), neto = r2(g.items.reduce((s, i) => s + +i.p.neto_propietario, 0)); return { ...g, bruto: r2(neto + com), com, neto }; }).sort((a, b) => b.neto - a.neto);
}
function vLiquidaciones() {
  const pend = pendientesLiquidar();
  return `<div class="head"><div><h1>Liquidaciones</h1><p>Lo cobrado en la oficina se liquida acá. Los pagos con transferencia dividida se liquidan solos al aprobarlos.</p></div></div>
  <h2>Pendientes de liquidar</h2>
  <div class="tw"><table><thead><tr><th>Propietario</th><th class="num">Cobros</th><th class="num">Cobrado</th><th class="num">Honorarios</th><th class="num">A pagar</th><th></th></tr></thead><tbody>
  ${pend.map((g) => `<tr><td>${esc(P(g.pid).nombre)}</td><td class="num">${g.items.length}</td><td class="num">${money(g.bruto)}</td><td class="num">${money(g.com)}</td><td class="num"><b>${money(g.neto)}</b></td><td class="num"><button class="btn small primary" data-liquidar="${g.pid}">Liquidar</button></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No hay cobros pendientes de liquidar.</div></td></tr>`}
  </tbody></table></div>
  <h2>Historial</h2>
  <div class="tw"><table><thead><tr><th>N°</th><th>Fecha</th><th>Propietario</th><th>Tipo</th><th class="num">Cobrado</th><th class="num">Honorarios</th><th class="num">Neto</th><th></th></tr></thead><tbody>
  ${S.liqs.slice(0, 120).map((l) => `<tr><td class="mono">${pad5(l.nro)}</td><td class="num">${fecha(l.fecha)}</td><td>${esc(P(l.propietario_id).nombre)} ${l.anulada ? `<span class="chip bad">Anulada</span>` : ""}</td><td>${l.modalidad === "directa" ? `<span class="chip acc">Directa</span>` : "Oficina"}</td><td class="num">${money(l.bruto)}</td><td class="num">${money(l.comision)}</td><td class="num">${money(l.neto)}</td>
  <td class="num"><button class="btn small" data-liqpdf="${l.id}">PDF</button> ${l.modalidad === "inmobiliaria" && !l.anulada ? `<button class="btn small" data-liqcomp="${l.id}">Comprobante</button> <button class="btn small danger" data-liqanular="${l.id}">Anular</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8"><div class="empty">Todavía no hay liquidaciones.</div></td></tr>`}
  </tbody></table></div>`;
}

function movsCaja() {
  const ym = S.cajaMes, out = [];
  for (const c of S.contratos.values()) for (const p of pgDe(c)) {
    if (p.anulado || ymDe(p.fecha) !== ym) continue;
    if (p.modalidad === "dividida") out.push({ fecha: p.fecha, tipo: "ingreso", concepto: `Honorarios · Recibo ${pad5(p.recibo_nro)} · ${inq(c)} · ${periodo(p.periodo)}`, monto: +p.honorarios, medio: "Transferencia" });
    else out.push({ fecha: p.fecha, tipo: "ingreso", concepto: `Recibo ${pad5(p.recibo_nro)} · ${inq(c)} · ${periodo(p.periodo)}`, monto: +p.total, medio: p.medio });
  }
  for (const l of S.liqs) if (!l.anulada && l.modalidad === "inmobiliaria" && ymDe(l.fecha) === ym) out.push({ fecha: l.fecha, tipo: "egreso", concepto: `Liquidación ${pad5(l.nro)} · ${P(l.propietario_id).nombre}`, monto: +l.neto, medio: l.medio || "Transferencia" });
  for (const m of S.caja) if (!m.anulado) out.push({ ...m, monto: +m.monto, manual: true });
  return out.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
}
function vCaja() {
  const movs = movsCaja(), dia = S.cajaDia;
  const porDia = {}; for (const m of movs) { const d = porDia[m.fecha] || (porDia[m.fecha] = { i: 0, e: 0 }); m.tipo === "ingreso" ? (d.i += m.monto) : (d.e += m.monto); }
  const dias = Object.keys(porDia).sort(), max = Math.max(1, ...dias.map((d) => porDia[d].i));
  const tI = movs.filter((m) => m.tipo === "ingreso").reduce((s, m) => s + m.monto, 0), tE = movs.filter((m) => m.tipo === "egreso").reduce((s, m) => s + m.monto, 0);
  const delDia = movs.filter((m) => m.fecha === dia); const medios = {};
  for (const m of delDia) medios[m.medio] = (medios[m.medio] || 0) + (m.tipo === "ingreso" ? m.monto : -m.monto);
  return `<div class="head"><div><h1>Caja</h1><p>Solo lo que entra y sale de la inmobiliaria: en los pagos divididos cuentan únicamente los honorarios.</p></div>
  <div class="row"><input type="month" id="caja-mes" value="${S.cajaMes}" style="width:auto"><button class="btn primary" data-a="mov-nuevo">Nuevo movimiento</button></div></div>
  <div class="kpis"><div class="kpi"><span class="l">Ingresos</span><span class="v">${money(tI)}</span></div><div class="kpi"><span class="l">Egresos</span><span class="v">${money(tE)}</span></div><div class="kpi"><span class="l">Saldo</span><span class="v">${money(tI - tE)}</span></div><div class="kpi"><span class="l">Días con movimiento</span><span class="v">${dias.length}</span></div></div>
  <div class="grid2"><section class="panel"><h2>Ingreso por día</h2><div class="tw"><table><thead><tr><th>Día</th><th style="width:40%"></th><th class="num">Ingresos</th><th class="num">Egresos</th></tr></thead><tbody>
  ${dias.map((d) => `<tr class="click" data-dia="${d}" ${d === dia ? 'style="background:var(--accent-soft)"' : ""}><td class="num">${fecha(d)}</td><td><div class="bar" style="width:${Math.round(porDia[d].i / max * 100)}%"></div></td><td class="num">${money(porDia[d].i)}</td><td class="num">${money(porDia[d].e)}</td></tr>`).join("") || `<tr><td colspan="4"><div class="empty">Sin movimientos en ${periodo(S.cajaMes)}.</div></td></tr>`}
  </tbody></table></div></section>
  <section class="panel"><div class="ph"><h2>Detalle del ${fecha(dia)}</h2><input type="date" id="caja-dia" value="${dia}" style="width:auto"></div>
  ${Object.keys(medios).length ? `<div class="row">${Object.entries(medios).map(([k, v]) => `<span class="chip acc">${esc(k)}: ${money(v)}</span>`).join("")}</div>` : ""}
  <div class="tw"><table><tbody>${delDia.map((m) => `<tr><td>${esc(m.concepto)}<div class="muted">${esc(m.medio)}</div></td><td class="num" style="color:var(--${m.tipo === "ingreso" ? "ok" : "bad"})">${m.tipo === "ingreso" ? "+" : "−"} ${money(m.monto)}</td><td class="num">${m.manual ? `<button class="btn small danger" data-movanular="${m.id}">Anular</button>` : ""}</td></tr>`).join("") || `<tr><td><div class="empty">Sin movimientos este día.</div></td></tr>`}</tbody></table></div>
  </section></div>`;
}

function vPersonas() {
  const q = S.q.trim().toLowerCase();
  const cuenta = new Map(); for (const c of S.contratos.values()) if (contratoActivo(c)) for (const id of [c.inquilino_id, c.propietario_id]) cuenta.set(id, (cuenta.get(id) || 0) + 1);
  const list = [...S.personas.values()].filter((p) => p.tipo === S.tipoPersona && (!q || [p.nombre, p.dni, p.telefono, p.email].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => (cuenta.get(b.id) || 0) - (cuenta.get(a.id) || 0) || a.nombre.localeCompare(b.nombre, "es"));
  const t = (k, l) => `<button data-tipo="${k}" aria-pressed="${S.tipoPersona === k}">${l}</button>`;
  const conAcceso = list.filter((p) => p.user_id).length;
  return `<div class="head"><div><h1>Inquilinos y propietarios</h1><p>Cargá DNI, email y datos bancarios, y creá el acceso al portal. ${conAcceso} de ${list.length} con acceso.</p></div><button class="btn primary" data-a="nueva-persona">Nueva persona</button></div>
  <div class="row"><input type="search" id="q" class="search" placeholder="Nombre, DNI, celular o email" value="${esc(S.q)}"><div class="seg">${t("inquilino", "Inquilinos")}${t("propietario", "Propietarios")}</div></div>
  <div class="tw"><table><thead><tr><th>Nombre</th><th>DNI</th><th>Celular</th><th>Email</th>${S.tipoPersona === "propietario" ? "<th>CBU / alias</th>" : ""}<th class="num">Contratos vigentes</th><th>Portal</th></tr></thead><tbody>
  ${list.slice(0, S.limite).map((p) => `<tr class="click" data-persona="${p.id}"><td>${esc(p.nombre)}</td><td class="mono">${esc(p.dni || "—")}</td><td class="mono">${esc(p.telefono || "—")}</td><td>${esc(p.email || "—")}</td>${S.tipoPersona === "propietario" ? `<td class="mono">${esc(p.alias || p.cbu || "—")}</td>` : ""}<td class="num">${cuenta.get(p.id) || 0}</td><td>${p.user_id ? `<span class="chip ok">Con acceso</span>` : p.dni ? `<span class="chip">Sin acceso</span>` : `<span class="chip warn">Falta DNI</span>`}</td></tr>`).join("") || `<tr><td colspan="7"><div class="empty">Sin resultados.</div></td></tr>`}
  </tbody></table></div>${list.length > S.limite ? `<div class="row"><button class="btn" data-a="mas">Mostrar más</button></div>` : ""}`;
}

function vConfig() {
  const c = S.cfg, dis = puedeAdmin() ? "" : "disabled";
  const campo = (k, l, tipo = "text", extra = "") => `<label>${l}<input type="${tipo}" id="cfg-${k}" name="${k}" value="${esc(c[k])}" ${extra} ${dis}></label>`;
  return `<div class="head"><div><h1>Configuración</h1><p>${puedeAdmin() ? "Datos que aparecen en recibos, liquidaciones y en el portal." : "Solo un administrador puede cambiar la configuración."}</p></div></div>
  <form class="panel form" id="f-config">
    <label class="full">Nombre de la inmobiliaria<input type="text" id="cfg-nombre" name="nombre" value="${esc(c.nombre)}" ${dis}></label>
    ${campo("domicilio", "Domicilio")}${campo("telefono", "Teléfono")}${campo("cuit", "CUIT")}${campo("email", "Email de contacto", "email")}
    <h2 class="full">Cuenta de la inmobiliaria (para que los inquilinos transfieran los honorarios)</h2>
    ${campo("banco", "Banco")}${campo("titular", "Titular")}${campo("cbu", "CBU / CVU")}${campo("alias", "Alias")}
    <h2 class="full">Reglas de cobro</h2>
    ${campo("comision", "Honorarios de administración por defecto (%)", "number", 'step="0.01"')}${campo("dia_vto", "Se paga hasta el día", "number", 'min="1" max="28"')}
    ${campo("dias_gracia", "Días de tolerancia sin punitorio", "number", 'min="0" max="31"')}${campo("interes_diario", "Punitorio diario (%) desde el día siguiente al vencimiento", "number", 'step="0.01"')}
    <label class="full">Controlar cobros desde el período<input type="month" id="cfg-inicio" name="inicio_cobranza" value="${esc(c.inicio_cobranza)}" ${dis}><span class="muted">Los meses anteriores no se cuentan como deuda.</span></label>
    ${puedeAdmin() ? `<div class="full row"><button class="btn primary" type="submit">Guardar configuración</button></div>` : ""}
  </form>
  <section class="panel"><div class="ph"><h2>Numeración</h2>${puedeAdmin() ? `<button class="btn small" data-a="numeracion">Cambiar</button>` : ""}</div><div id="numeracion" class="muted">Consultando…</div></section>
  <section class="panel"><div class="ph"><h2>Equipo</h2>${puedeAdmin() ? `<button class="btn small primary" data-a="nuevo-staff">Sumar persona</button>` : ""}</div>
  <div class="tw"><table><tbody>${S.staff.map((s) => `<tr><td>${esc(s.nombre)}<div class="muted">${esc(s.email || "")}</div></td><td>${s.rol === "admin" ? "Administrador" : "Operador"}</td><td>${s.activo ? `<span class="chip ok">Activo</span>` : `<span class="chip">Inactivo</span>`}</td><td class="num">${puedeAdmin() && s.user_id !== S.yo.user_id ? `<button class="btn small" data-staffclave="${s.user_id}">Nueva clave</button> <button class="btn small" data-staffactivo="${s.user_id}">${s.activo ? "Desactivar" : "Activar"}</button>` : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
}

/* ================= ficha de contrato ================= */
let fichaTab = "cuenta";
async function abrirFicha(id) {
  const c = S.contratos.get(+id); if (!c) return;
  const d = deudaDe(c), pagos = pgDe(c).slice().sort((a, b) => b.recibo_nro - a.recibo_nro), aj = ajustesValidos(ajDe(c)), pa = proximoAjuste(c, aj, S.cfg);
  const pi = P(c.inquilino_id), pp = P(c.propietario_id);
  const tab = (k, l) => `<button data-fichatab="${k}" data-id="${c.id}" aria-selected="${fichaTab === k}">${l}</button>`;
  let cuerpo = "";
  if (fichaTab === "cuenta") {
    cuerpo = `<h2>Períodos pendientes</h2>${d.length ? `<div class="tw"><table><thead><tr><th>Período</th><th>Vence</th><th class="num">Saldo</th><th class="num">Punitorio</th><th></th></tr></thead><tbody>${d.map((x) => `<tr><td>${periodo(x.p)}</td><td class="num">${fecha(x.vto)}</td><td class="num">${money(x.saldo)}</td><td class="num">${x.bonificado ? `${money(x.punitorio)} <span class="chip ok">Bonificado</span>` : x.punitorio ? money(x.punitorio) : x.enTolerancia ? `<span class="chip warn">En tolerancia</span>` : "—"}</td>
      <td class="num">${x.bonificado ? `<button class="btn small" data-desbonificar="${c.id}|${x.p}">Quitar bonificación</button>` : x.punitorio ? `<button class="btn small" data-bonificar="${c.id}|${x.p}">Bonificar punitorio</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Al día.</div>`}
      <h2>Cobros</h2>${pagos.length ? `<div class="tw"><table><thead><tr><th>Recibo</th><th>Fecha</th><th>Período</th><th>Forma</th><th class="num">Total</th><th></th></tr></thead><tbody>${pagos.map((p) => `<tr><td class="mono">${pad5(p.recibo_nro)}</td><td class="num">${fecha(p.fecha)}</td><td>${periodo(p.periodo)}</td><td>${p.modalidad === "dividida" ? "Dividida" : esc(p.medio)}</td><td class="num">${money(p.total)}</td><td class="num">${p.anulado ? `<span class="chip bad">Anulado</span>` : `${p.liquidacion_id ? `<span class="chip ok">Liquidado</span>` : ""} <button class="btn small" data-recibo="${p.id}">Recibo</button> <button class="btn small danger" data-anularpago="${p.id}">Anular</button>`}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">Sin cobros registrados.</div>`}
      <h2>Documentos</h2><div id="docs-ficha" class="files"><span class="muted">Cargando…</span></div>`;
  } else if (fichaTab === "ajustes") {
    cuerpo = `<div class="row"><span>Ajusta por <b>${esc(c.indice)}</b> cada <b>${c.ajuste_meses} meses</b>.</span>${c.ajuste_revisar ? `<span class="chip warn">Periodicidad sin confirmar</span>` : ""}${pa ? `<span class="chip acc">Próximo: ${periodo(pa)}</span> <button class="btn small primary" data-ajustar="${c.id}">Aplicar ajuste</button>` : ""}</div>
    <div class="tw"><table><thead><tr><th>Desde</th><th class="num">Anterior</th><th class="num">%</th><th class="num">Nuevo alquiler</th><th>Cargado</th><th></th></tr></thead><tbody>
    <tr><td>Monto base${c.origen === "SPOT" ? " (importado de SPOT)" : ""}</td><td></td><td></td><td class="num">${money(c.monto_base)}</td><td></td><td></td></tr>
    ${aj.map((a) => `<tr><td>${periodo(a.desde)}</td><td class="num">${money(a.monto_anterior)}</td><td class="num">${a.pct != null ? (+a.pct).toFixed(2) + "%" : "—"}</td><td class="num">${money(a.monto)}</td><td class="num">${fecha(a.created_at)}</td><td class="num"><button class="btn small danger" data-anularajuste="${a.id}">Anular</button></td></tr>`).join("")}</tbody></table></div>`;
  } else cuerpo = formContrato(c);
  abrirModal(`<div class="mh"><div><h2>${esc(c.direccion)}</h2><div class="row muted">${c.carpeta ? `Carpeta ${c.carpeta} ·` : ""} ${fecha(c.inicio)} al ${fecha(c.fin)} ${chipEstado(c)}</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <dl class="dl">
    <div><dt>Inquilino</dt><dd><button class="link" data-persona="${pi.id}">${esc(pi.nombre)}</button> ${pi.user_id ? `<span class="chip ok">Portal</span>` : ""}</dd></div><div><dt>Celular</dt><dd class="mono">${esc(pi.telefono || "—")}</dd></div><div><dt>Alquiler ${periodo(ymHoy())}</dt><dd class="mono">${money(montoHoy(c))}</dd></div>
    <div><dt>Propietario</dt><dd><button class="link" data-persona="${pp.id}">${esc(pp.nombre)}</button> ${pp.user_id ? `<span class="chip ok">Portal</span>` : ""}</dd></div><div><dt>Celular</dt><dd class="mono">${esc(pp.telefono || "—")}</dd></div><div><dt>Depósito</dt><dd class="mono">${money(c.deposito)}</dd></div>
    <div><dt>Forma de pago</dt><dd>${c.forma_pago === "dividida" ? "Transferencia dividida" : "En la inmobiliaria"}</dd></div><div><dt>Honorarios</dt><dd>${comisionDe(c, S.cfg)}%</dd></div><div><dt>Índice</dt><dd>${esc(c.indice)} cada ${c.ajuste_meses} meses</dd></div>
  </dl>
  <div class="row"><button class="btn primary" data-cobrar="${c.id}">Cobrar en oficina</button>${wa(pi.telefono) ? `<a class="btn" href="${wa(pi.telefono)}" target="_blank" rel="noopener">WhatsApp inquilino</a>` : ""}${wa(pp.telefono) ? `<a class="btn" href="${wa(pp.telefono)}" target="_blank" rel="noopener">WhatsApp propietario</a>` : ""}</div>
  <div class="tabs" role="tablist">${tab("cuenta", "Estado de cuenta")}${tab("ajustes", "Ajustes de precio")}${tab("datos", "Datos del contrato")}</div>${cuerpo}`, true);
  if (fichaTab === "cuenta") {
    const { data } = await sb.from("archivos").select("*").eq("contrato_id", c.id).order("created_at", { ascending: false }).limit(60);
    const el = document.getElementById("docs-ficha");
    if (el) el.innerHTML = (data || []).map((a) => `<button class="file" data-archivo="${esc(a.path)}">📄 ${esc(ETIQUETA_ARCHIVO[a.categoria])}${a.servicio ? " · " + esc(a.servicio) : ""} · ${periodo(a.periodo)}</button>`).join("") || `<span class="muted">Sin documentos.</span>`;
  }
}
function opcionesPersonas(tipo) {
  return [...S.personas.values()].filter((p) => p.tipo === tipo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((p) => `<option value="${esc(p.nombre)}${p.dni ? " · DNI " + esc(p.dni) : ""}" data-id="${p.id}"></option>`).join("");
}
function formContrato(c) {
  const nuevo = !c; c = c || { indice: "IPC", ajuste_meses: 3, forma_pago: "inmobiliaria" };
  const nom = (id) => (id ? P(id).nombre + (P(id).dni ? " · DNI " + P(id).dni : "") : "");
  return `<form class="form" id="f-contrato" data-id="${nuevo ? "" : c.id}">
    <label>Carpeta<input type="number" id="fc-carpeta" name="carpeta" value="${esc(c.carpeta || "")}"></label>
    <label>Dirección<input type="text" id="fc-direccion" name="direccion" value="${esc(c.direccion || "")}" required></label>
    <label>Inquilino<input type="text" id="fc-inq" name="inquilino" list="dl-inq" value="${esc(nom(c.inquilino_id))}" required placeholder="Elegí de la lista o escribí un nombre nuevo"></label>
    <label>Propietario<input type="text" id="fc-prop" name="propietario" list="dl-prop" value="${esc(nom(c.propietario_id))}" required></label>
    <datalist id="dl-inq">${opcionesPersonas("inquilino")}</datalist><datalist id="dl-prop">${opcionesPersonas("propietario")}</datalist>
    <label>Inicio<input type="date" id="fc-inicio" name="inicio" value="${esc(c.inicio || "")}" required></label>
    <label>Fin<input type="date" id="fc-fin" name="fin" value="${esc(c.fin || "")}" required></label>
    <label>${nuevo ? "Alquiler inicial" : "Alquiler base"}<input type="number" step="0.01" id="fc-monto" name="monto_base" value="${esc(c.monto_base || "")}" required></label>
    <label>Depósito<input type="number" step="0.01" id="fc-deposito" name="deposito" value="${esc(c.deposito || "")}"></label>
    <label>Índice<select id="fc-indice" name="indice">${["ICL", "IPC", "Casa Propia", "CAC", "UVA", "RIPTE", "Fijo"].map((i) => `<option ${c.indice === i ? "selected" : ""}>${i}</option>`).join("")}</select></label>
    <label>Ajusta cada (meses)<input type="number" min="1" max="36" id="fc-ajuste" name="ajuste_meses" value="${esc(c.ajuste_meses)}"></label>
    <label>Forma de pago<select id="fc-forma" name="forma_pago"><option value="inmobiliaria" ${c.forma_pago === "inmobiliaria" ? "selected" : ""}>Paga en la inmobiliaria</option><option value="dividida" ${c.forma_pago === "dividida" ? "selected" : ""}>Transferencia dividida (propietario + honorarios)</option></select></label>
    <label>Honorarios (%)<input type="number" step="0.01" id="fc-comision" name="comision" value="${esc(c.comision ?? "")}" placeholder="${S.cfg.comision} (por defecto)"></label>
    <label>Se paga hasta el día<input type="number" min="1" max="28" id="fc-diavto" name="dia_vto" value="${esc(c.dia_vto || "")}" placeholder="${S.cfg.dia_vto}"></label>
    <label class="full">Notas<textarea id="fc-notas" name="notas" rows="2">${esc(c.notas || "")}</textarea></label>
    <div class="full row"><button class="btn primary" type="submit">${nuevo ? "Crear contrato" : "Guardar cambios"}</button>${!nuevo && !c.rescindido ? `<button class="btn danger" type="button" data-rescindir="${c.id}">Rescindir</button>` : ""}${!nuevo && c.rescindido ? `<button class="btn" type="button" data-reactivar="${c.id}">Quitar rescisión</button>` : ""}</div>
  </form>`;
}
function idPersonaDesdeTexto(txt, tipo) {
  const t = txt.trim(); if (!t) return null;
  for (const p of S.personas.values()) if (p.tipo === tipo && (p.nombre + (p.dni ? " · DNI " + p.dni : "")) === t) return p.id;
  for (const p of S.personas.values()) if (p.tipo === tipo && p.nombre.toLowerCase() === t.toLowerCase()) return p.id;
  return null;
}

/* ================= modales de operaciones ================= */
function modalCobro(id) {
  const c = S.contratos.get(+id); const d = deudaDe(c); const cur = ymHoy();
  const opts = d.map((x) => x.p); for (const p of [cur, ymSumar(cur, 1)]) if (!opts.includes(p) && p <= ymDe(c.fin) && p >= ymDe(c.inicio)) opts.push(p);
  abrirModal(`<div class="mh"><div><h2>Cobrar en oficina</h2><div class="muted">${esc(inq(c))} · ${esc(c.direccion)}</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form class="form" id="f-cobro" data-id="${c.id}">
    <label>Período<select id="co-periodo" name="periodo">${opts.map((p) => { const x = d.find((y) => y.p === p); return `<option value="${p}">${periodo(p)}${x ? " · debe " + money(x.saldo) : ""}</option>`; }).join("")}</select></label>
    <label>Fecha de cobro<input type="date" id="co-fecha" name="fecha" value="${isoHoy()}" required></label>
    <label>Alquiler<input type="number" step="0.01" id="co-alquiler" name="alquiler" required></label>
    <label>Punitorio <span id="co-punit-ayuda"></span><input type="number" step="0.01" id="co-punitorio" name="punitorio" value="0"></label>
    ${bloqueConceptos("co")}
    <label>Medio de pago<select id="co-medio" name="medio">${MEDIOS.map((m) => `<option>${m}</option>`).join("")}</select></label>
    <label>Observaciones<input type="text" id="co-obs" name="obs"></label>
    <div class="full resumen" id="co-resumen"></div>
    <div class="full row"><button class="btn primary" type="submit" id="co-ok">Registrar y enviar recibo</button><button class="btn" type="button" data-cerrar>Cancelar</button></div>
  </form>`, true);
  cobroPeriodo();
}
function cobroPeriodo() {
  const f = $("#f-cobro"); if (!f) return; const c = S.contratos.get(+f.dataset.id);
  const x = deudaDe(c).find((y) => y.p === f.periodo.value);
  f.alquiler.value = x ? x.saldo : montoEn(c, ajDe(c), f.periodo.value);
  f.punitorio.value = x ? x.punitorio : 0;
  $("#co-punit-ayuda").textContent = x && x.punitorioSugerido ? `(sugerido ${money(x.punitorioSugerido)} por ${x.dias} días; 0 para bonificar)` : x && x.enTolerancia ? "(en tolerancia)" : "";
  cobroTotal();
}
function cobroTotal() { const f = $("#f-cobro"); if (f) $("#co-resumen").innerHTML = resumenCobro(f, S.contratos.get(+f.dataset.id)); }

/* ---------- conceptos adicionales (municipal, agua, expensas…) ---------- */
const CONCEPTOS_SUG = ["Municipal (ABL)", "Agua", "Expensas", "Luz", "Gas", "Seguro", "Reparación", "Gastos de contrato"];
function bloqueConceptos(pref) {
  return `<div class="full conceptos" id="${pref}-conceptos">
    <div class="ph"><h2>Conceptos adicionales</h2><button type="button" class="btn small" data-addconcepto="${pref}">+ Agregar concepto</button></div>
    <div class="filas"></div>
    <datalist id="dl-conceptos">${CONCEPTOS_SUG.map((c) => `<option value="${c}"></option>`).join("")}</datalist>
    <label class="check"><input type="checkbox" id="${pref}-admalq" name="admin_alquiler" checked> Cobrar administración sobre el alquiler</label>
  </div>`;
}
function filaConcepto() {
  return `<div class="concepto-fila">
    <input type="text" list="dl-conceptos" data-c="concepto" placeholder="Concepto (ej.: Expensas)" aria-label="Concepto" required>
    <input type="number" step="0.01" min="0.01" data-c="monto" placeholder="Importe" aria-label="Importe" required>
    <select data-c="inquilino" aria-label="Efecto para el inquilino"><option value="1">Inquilino: suma</option><option value="-1">Inquilino: resta</option></select>
    <select data-c="propietario" aria-label="Efecto para el propietario"><option value="1">Propietario: suma</option><option value="-1">Propietario: resta</option><option value="0">Propietario: no afecta</option></select>
    <label class="check"><input type="checkbox" data-c="admin"> Aplica administración</label>
    <button type="button" class="x" data-quitarconcepto aria-label="Quitar concepto">×</button></div>`;
}
function leerConceptos(f) {
  return [...f.querySelectorAll(".concepto-fila")].map((r) => ({
    concepto: r.querySelector('[data-c="concepto"]').value.trim(), monto: r2(r.querySelector('[data-c="monto"]').value),
    inquilino: +r.querySelector('[data-c="inquilino"]').value, propietario: +r.querySelector('[data-c="propietario"]').value,
    admin: r.querySelector('[data-c="admin"]').checked })).filter((k) => k.concepto && k.monto > 0);
}
function calcularCobro(f, c) {
  const pct = comisionDe(c, S.cfg), alq = +f.alquiler.value || 0, pun = +f.punitorio.value || 0, admAlq = f.admin_alquiler ? f.admin_alquiler.checked : true;
  let total = alq + pun, neto = alq + pun, hon = admAlq ? r2(alq * pct / 100) : 0;
  for (const k of leerConceptos(f)) { total += k.inquilino * k.monto; neto += k.propietario * k.monto; if (k.admin) hon += r2(k.monto * pct / 100); }
  return { total: r2(total), hon: r2(hon), neto: r2(neto - hon), pct };
}
function resumenCobro(f, c) {
  const x = calcularCobro(f, c);
  return `<div class="total-line"><span>Total a cobrar al inquilino</span><span class="mono">${money(x.total)}</span></div>
    <div class="linea"><span>Honorarios de administración (${x.pct}%)</span><span class="mono">${money(x.hon)}</span></div>
    <div class="linea"><span>Le corresponde al propietario</span><span class="mono">${money(x.neto)}</span></div>`;
}

function modalAprobar(eid) {
  const e = S.envios.find((x) => x.id === +eid); const c = S.contratos.get(e.contrato_id);
  const d = deudaDe(c).find((x) => x.p === e.periodo);
  const alq = d ? d.saldo : montoEn(c, ajDe(c), e.periodo);
  // punitorio que efectivamente transfirió: lo que mandó al propietario por encima de su parte del alquiler
  const parteProp = division(c, S.cfg, alq, 0).propietario;
  const pagado = Math.max(0, r2((+e.monto_propietario || 0) - parteProp));
  const pun = c.forma_pago === "dividida" ? pagado : (d ? d.punitorio : 0);
  abrirModal(`<div class="mh"><div><h2>Aprobar pago</h2><div class="muted">${esc(inq(c))} · ${esc(c.direccion)} · ${periodo(e.periodo)}</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form class="form" id="f-aprobar" data-id="${e.id}">
    <label>Alquiler<input type="number" step="0.01" id="ap-alquiler" name="alquiler" value="${alq}" required></label>
    <label>Punitorio ${d && d.punitorioSugerido ? `(sugerido ${money(d.punitorioSugerido)}; 0 = bonificado)` : ""}<input type="number" step="0.01" id="ap-punitorio" name="punitorio" value="${pun}"></label>
    <label>Fecha del pago<input type="date" id="ap-fecha" name="fecha" value="${ymDe(e.created_at) ? e.created_at.slice(0, 10) : isoHoy()}"></label>
    <label>Observaciones para el recibo<input type="text" id="ap-obs" name="obs" value="${esc(e.observaciones || "")}"></label>
    ${bloqueConceptos("ap")}
    <div class="full resumen" id="ap-resumen"></div>
    <p class="full muted" style="margin:0">Al aprobar se genera el recibo${c.forma_pago === "dividida" ? ", la liquidación del propietario" : ""} y se avisa al inquilino y al propietario.</p>
    <div class="full row"><button class="btn primary" type="submit" id="ap-ok">Aprobar</button><button class="btn" type="button" data-cerrar>Cancelar</button></div>
  </form>`, true);
  aprobarTotal();
}
function aprobarTotal() { const f = $("#f-aprobar"); if (!f) return; const e = S.envios.find((x) => x.id === +f.dataset.id); $("#ap-resumen").innerHTML = resumenCobro(f, S.contratos.get(e.contrato_id)); }

function modalRechazar(eid) {
  abrirModal(`<div class="mh"><h2>Rechazar envío</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form class="form" id="f-rechazar" data-id="${eid}"><label class="full">Motivo (lo ve el inquilino)<textarea id="re-motivo" name="motivo" rows="3" required autofocus placeholder="Ej.: No vemos acreditada la transferencia de honorarios."></textarea></label>
  <div class="full row"><button class="btn danger" type="submit">Rechazar y avisar</button><button class="btn" type="button" data-cerrar>Cancelar</button></div></form>`);
}

function modalRecibo(pid) {
  let p = null, c = null; for (const [cid, l] of S.pg) { const f = l.find((x) => x.id === +pid); if (f) { p = f; c = S.contratos.get(cid); break; } }
  if (!p) return;
  const i = P(c.inquilino_id);
  abrirModal(`<div class="mh"><h2>Recibo ${pad5(p.recibo_nro)}</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <div class="recibo"><div class="rt"><div><b>${esc(S.cfg.nombre)}</b><div class="muted">${esc(S.cfg.domicilio)}</div></div><div class="num"><b>N° ${pad5(p.recibo_nro)}</b><div class="muted">${fecha(p.fecha)}</div></div></div>
  <p>Recibimos de <b>${esc(i.nombre)}</b> la suma de <b>${money(p.total)}</b> en concepto de alquiler del período <b>${periodo(p.periodo)}</b> de <b>${esc(c.direccion)}</b>.</p>
  <div class="tw"><table><tbody><tr><td>Alquiler</td><td class="num">${money(p.alquiler)}</td></tr>${+p.punitorio ? `<tr><td>Punitorios</td><td class="num">${money(p.punitorio)}</td></tr>` : ""}${filasConceptos(p)}<tr><td><b>Total</b> · ${esc(p.medio)}</td><td class="num"><b>${money(p.total)}</b></td></tr></tbody></table></div>
  ${p.anulado ? `<span class="chip bad">Anulado</span>` : ""}</div>
  <div class="row"><button class="btn primary" data-recibopdf="${p.id}">Descargar PDF</button><button class="btn" data-recibotxt="${p.id}">Copiar para WhatsApp</button>${wa(i.telefono) ? `<a class="btn" href="${wa(i.telefono)}" target="_blank" rel="noopener">WhatsApp del inquilino</a>` : ""}</div>
  <p class="muted" style="margin:0">El inquilino también puede descargarlo desde el portal${i.user_id ? "" : " (todavía no tiene acceso)"}.</p>`);
}
function filasConceptos(p) {
  const cs = Array.isArray(p.conceptos) ? p.conceptos : [];
  if (!cs.length) return +p.otros ? `<tr><td>${esc(p.otros_detalle || "Otros")}</td><td class="num">${money(p.otros)}</td></tr>` : "";
  return cs.map((k) => `<tr><td>${esc(k.concepto)}${k.inquilino < 0 ? ' <span class="muted">(se descuenta)</span>' : ""}</td><td class="num">${k.inquilino < 0 ? "− " : ""}${money(k.monto)}</td></tr>`).join("");
}
function buscarPago(pid) { for (const [cid, l] of S.pg) { const f = l.find((x) => x.id === +pid); if (f) return { p: f, c: S.contratos.get(cid) }; } return {}; }

function modalAjuste(id) {
  const c = S.contratos.get(+id); const p = proximoAjuste(c, ajDe(c), S.cfg) || ymHoy(); const ant = montoEn(c, ajDe(c), ymSumar(p, -1));
  abrirModal(`<div class="mh"><div><h2>Aplicar ajuste</h2><div class="muted">${esc(c.direccion)} · ${esc(c.indice)} cada ${c.ajuste_meses} meses</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form class="form" id="f-ajuste" data-id="${c.id}" data-ant="${ant}">
    <label>Rige desde<input type="month" id="aj-desde" name="desde" value="${p}" required></label>
    <label>Alquiler anterior<input type="text" value="${money(ant)}" disabled id="aj-ant"></label>
    <label>Variación del índice (%)<input type="number" step="0.0001" id="aj-pct" name="pct" autofocus></label>
    <label>Nuevo alquiler<input type="number" step="0.01" id="aj-monto" name="monto" required></label>
    <div class="full row"><button class="btn primary" type="submit">Guardar ajuste</button><button class="btn" type="button" data-cerrar>Cancelar</button></div>
  </form>`);
}

function modalLiquidar(pid) {
  const g = pendientesLiquidar().find((x) => x.pid === +pid); if (!g) return;
  abrirModal(`<div class="mh"><div><h2>Liquidar a ${esc(P(g.pid).nombre)}</h2><div class="muted">${esc(P(g.pid).alias || P(g.pid).cbu || "Sin datos bancarios cargados")}</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form id="f-liq" data-pid="${g.pid}" class="form">
  <div class="full tw"><table><thead><tr><th></th><th>Propiedad</th><th>Período</th><th>Recibo</th><th class="num">Cobrado</th><th class="num">Honorarios</th><th class="num">Neto</th></tr></thead><tbody>
  ${g.items.map((i) => `<tr><td><input type="checkbox" id="lq-${i.p.id}" data-pago="${i.p.id}" checked></td><td>${esc(i.c.direccion)}</td><td>${periodo(i.p.periodo)}</td><td class="mono">${pad5(i.p.recibo_nro)}</td><td class="num">${money(+i.p.neto_propietario + +i.p.honorarios)}</td><td class="num">${money(i.p.honorarios)}</td><td class="num">${money(i.p.neto_propietario)}</td></tr>`).join("")}</tbody></table></div>
  <label>Otras deducciones<input type="number" step="0.01" id="lq-ded" name="ded" value="0"></label>
  <label>Detalle<input type="text" id="lq-det" name="det" placeholder="Ej.: Reparación de canilla"></label>
  <label>Fecha<input type="date" id="lq-fecha" name="fecha" value="${isoHoy()}"></label>
  <label>Medio<select id="lq-medio" name="medio">${MEDIOS.map((m) => `<option ${m === "Transferencia" ? "selected" : ""}>${m}</option>`).join("")}</select></label>
  <label class="full">Comprobante de la transferencia (opcional, también se puede subir después)<input type="file" id="lq-comp" accept="${ARCHIVOS_OK}"></label>
  <div class="full total-line"><span>Neto a pagar</span><span class="mono" id="lq-total"></span></div>
  <div class="full row"><button class="btn primary" type="submit" id="lq-ok">Confirmar liquidación</button><button class="btn" type="button" data-cerrar>Cancelar</button></div></form>`, true);
  liqTotal();
}
function liqSel() { const f = $("#f-liq"); return [...f.querySelectorAll("[data-pago]")].filter((x) => x.checked).map((x) => +x.dataset.pago); }
function liqTotal() {
  const f = $("#f-liq"); if (!f) return; const ids = liqSel(); let n = 0;
  for (const l of S.pg.values()) for (const p of l) if (ids.includes(p.id)) n += +p.neto_propietario;
  $("#lq-total").textContent = money(n - (+f.ded.value || 0));
}
async function subirComprobanteLiquidacion(liq, file) {
  const cid = (liq.items && liq.items[0] && liq.items[0].contrato_id); if (!cid) return;
  const path = rutaArchivo(cid, "liq-" + liq.id, file.name);
  const up = await sb.storage.from("documentos").upload(path, file, { contentType: file.type || undefined });
  if (up.error) throw up.error;
  const { error } = await sb.from("archivos").insert({ contrato_id: cid, periodo: ymDe(liq.fecha), liquidacion_id: liq.id, categoria: "comp_liquidacion", path, nombre: file.name, mime: file.type, tamano: file.size });
  if (error) throw error;
}

function modalPersona(id) {
  const p = id ? S.personas.get(+id) : { tipo: S.tipoPersona };
  const contratos = id ? [...S.contratos.values()].filter((c) => c.inquilino_id === p.id || c.propietario_id === p.id) : [];
  abrirModal(`<div class="mh"><div><h2>${id ? esc(p.nombre) : "Nueva persona"}</h2><div class="muted">${p.tipo === "inquilino" ? "Inquilino" : "Propietario"}${id ? ` · ${contratos.length} contratos` : ""}</div></div><button class="x" data-cerrar aria-label="Cerrar">×</button></div>
  <form class="form" id="f-persona" data-id="${id || ""}">
    ${id ? "" : `<label>Tipo<select id="pe-tipo" name="tipo"><option value="inquilino" ${p.tipo === "inquilino" ? "selected" : ""}>Inquilino</option><option value="propietario" ${p.tipo === "propietario" ? "selected" : ""}>Propietario</option></select></label>`}
    <label class="${id ? "full" : ""}">Nombre (Apellido, Nombre)<input type="text" id="pe-nombre" name="nombre" value="${esc(p.nombre || "")}" required></label>
    <label>DNI (es el usuario del portal)<input type="text" inputmode="numeric" id="pe-dni" name="dni" value="${esc(p.dni || "")}"></label>
    <label>Celular<input type="tel" id="pe-tel" name="telefono" value="${esc(p.telefono || "")}"></label>
    <label class="full">Email (para recibos y avisos)<input type="email" id="pe-email" name="email" value="${esc(p.email || "")}"></label>
    ${p.tipo === "propietario" ? `<label>Banco<input type="text" id="pe-banco" name="banco" value="${esc(p.banco || "")}"></label><label>Titular de la cuenta<input type="text" id="pe-titular" name="titular" value="${esc(p.titular || "")}"></label>
    <label>CBU / CVU<input type="text" id="pe-cbu" name="cbu" value="${esc(p.cbu || "")}"></label><label>Alias<input type="text" id="pe-alias" name="alias" value="${esc(p.alias || "")}"></label>` : ""}
    <label class="full">Notas<textarea id="pe-notas" name="notas" rows="2">${esc(p.notas || "")}</textarea></label>
    <div class="full row"><button class="btn primary" type="submit">Guardar</button></div>
  </form>
  ${id ? `<section class="panel"><div class="ph"><h2>Acceso al portal</h2>${p.user_id ? `<span class="chip ok">Con acceso</span>` : `<span class="chip">Sin acceso</span>`}</div>
    <p class="muted" style="margin:0">Usuario: DNI. La clave se genera acá y se la pasás por WhatsApp. Después puede cambiarla desde el portal.</p>
    <div class="row"><button class="btn primary" data-acceso="${p.id}" ${p.dni ? "" : "disabled"}>${p.user_id ? "Generar nueva clave" : "Crear acceso"}</button>${p.user_id ? `<button class="btn danger" data-quitaracceso="${p.id}">Quitar acceso</button>` : ""}${p.dni ? "" : `<span class="muted">Cargá el DNI y guardá para poder crear el acceso.</span>`}</div>
    <div id="acceso-resultado"></div></section>
  <h2>Contratos</h2><div class="tw"><table><tbody>${contratos.map((c) => `<tr class="click" data-ficha="${c.id}"><td>${esc(c.direccion)}</td><td class="num">${fecha(c.inicio)} – ${fecha(c.fin)}</td><td>${chipEstado(c)}</td></tr>`).join("")}</tbody></table></div>` : ""}`, true);
}

/* ================= eventos ================= */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button,[data-vista],[data-ficha],[data-dia],[data-persona],a"); if (!el) return;
  const d = el.dataset;
  const confirmar = (texto) => { if (d.confirmado === "1") return true; d.confirmado = "1"; el.dataset.txt = el.textContent; el.textContent = texto || "¿Confirmar?"; setTimeout(() => { if (el.isConnected) { d.confirmado = ""; el.textContent = el.dataset.txt; } }, 4000); return false; };
  try {
    if (d.vista) { S.view = d.vista; if (d.filtro) S.filtro = d.filtro; S.q = ""; S.limite = 150; cerrarModal(); render(); scrollTo(0, 0); if (S.view === "config") mostrarNumeracion(); return; }
    if (d.filtro) { S.filtro = d.filtro; S.limite = 150; render(); return; }
    if (d.orden) { S.orden = d.orden; try { localStorage.setItem("orden", d.orden); } catch {} render(); return; }
    if (d.tipo) { S.tipoPersona = d.tipo; S.limite = 150; render(); return; }
    if (d.a === "mas") { S.limite += 150; render(); return; }
    if (d.a === "refrescar") { await cargarEnvios(); render(); toast("Actualizado"); return; }
    if (d.a === "salir") { await sb.auth.signOut(); location.reload(); return; }
    if (d.a === "nuevo-contrato") { abrirModal(`<div class="mh"><h2>Nuevo contrato</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div>${formContrato(null)}`, true); return; }
    if (d.a === "nueva-persona") { modalPersona(null); return; }
    if (d.a === "mov-nuevo") { abrirModal(`<div class="mh"><h2>Nuevo movimiento de caja</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div><form class="form" id="f-mov"><label>Tipo<select id="mv-tipo" name="tipo"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></label><label>Fecha<input type="date" id="mv-fecha" name="fecha" value="${S.cajaDia}" required></label><label class="full">Concepto<input type="text" id="mv-concepto" name="concepto" required autofocus></label><label>Monto<input type="number" step="0.01" id="mv-monto" name="monto" required></label><label>Medio<select id="mv-medio" name="medio">${MEDIOS.map((m) => `<option>${m}</option>`).join("")}</select></label><div class="full row"><button class="btn primary" type="submit">Guardar</button></div></form>`); return; }
    if (d.a === "numeracion") { const n = await rpc("ver_numeracion", {}); abrirModal(`<div class="mh"><h2>Numeración</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div><form class="form" id="f-num"><label>Próximo recibo<input type="number" min="1" id="nu-rec" name="rec" value="${n?.recibo || 1}"></label><label>Próxima liquidación<input type="number" min="1" id="nu-liq" name="liq" value="${n?.liquidacion || 1}"></label><p class="full muted" style="margin:0">Usalo para continuar la numeración que venían usando en SPOT. No pongas un número ya usado.</p><div class="full row"><button class="btn primary" type="submit">Guardar</button></div></form>`); return; }
    if (d.a === "nuevo-staff") { abrirModal(`<div class="mh"><h2>Sumar persona al equipo</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div><form class="form" id="f-staff"><label>Nombre<input type="text" id="st-nombre" name="nombre" required></label><label>Email (será su usuario)<input type="email" id="st-email" name="email" required></label><label>Rol<select id="st-rol" name="rol"><option value="operador">Operador (cobra, aprueba, liquida)</option><option value="admin">Administrador (además configura y gestiona el equipo)</option></select></label><div class="full row"><button class="btn primary" type="submit">Crear usuario</button></div><div class="full" id="st-res"></div></form>`); return; }
    if (d.ficha) { fichaTab = "cuenta"; await abrirFicha(d.ficha); return; }
    if (d.fichatab) { fichaTab = d.fichatab; await abrirFicha(d.id); return; }
    if (d.persona) { modalPersona(d.persona); return; }
    if (d.cobrar) { modalCobro(d.cobrar); return; }
    if (d.addconcepto) { const box = $(`#${d.addconcepto}-conceptos .filas`); box.insertAdjacentHTML("beforeend", filaConcepto()); box.lastElementChild.querySelector("input").focus(); cobroTotal(); aprobarTotal(); return; }
    if (d.quitarconcepto !== undefined) { el.closest(".concepto-fila").remove(); cobroTotal(); aprobarTotal(); return; }
    if (d.aprobar) { modalAprobar(d.aprobar); return; }
    if (d.rechazar) { modalRechazar(d.rechazar); return; }
    if (d.servicios) { if (await rpc("revisar_servicios", { p_envio: +d.servicios }, "Revisado. Le avisamos al propietario.")) await recargar(); return; }
    if (d.archivo) { await verArchivo(d.archivo); return; }
    if (d.recibo) { modalRecibo(d.recibo); return; }
    if (d.recibopdf) { const { p, c } = buscarPago(d.recibopdf); const r = pdfRecibo(S.cfg, { direccion: c.direccion, inquilino: inq(c), carpeta: c.carpeta }, p); r.doc.save(r.nombre); return; }
    if (d.recibotxt) { const { p, c } = buscarPago(d.recibotxt); copiar(`${S.cfg.nombre}\nRECIBO N° ${pad5(p.recibo_nro)} · ${fecha(p.fecha)}\nRecibimos de ${inq(c)} ${money(p.total)} por el alquiler de ${periodo(p.periodo)} de ${c.direccion}.\nTambién podés descargarlo en ${PORTAL_URL}`); return; }
    if (d.anularpago) { if (!confirmar("¿Anular el cobro?")) return; if (await rpc("anular_pago", { p_pago: +d.anularpago }, "Cobro anulado")) { cerrarModal(); await recargar(); } return; }
    if (d.ajustar) { modalAjuste(d.ajustar); return; }
    if (d.anularajuste) { if (!confirmar()) return; const { error } = await sb.from("ajustes").update({ anulado: true }).eq("id", +d.anularajuste); if (error) throw error; toast("Ajuste anulado"); cerrarModal(); await recargar(); return; }
    if (d.bonificar || d.desbonificar) {
      const [cid, per] = (d.bonificar || d.desbonificar).split("|");
      const q = d.bonificar ? sb.from("punitorio_override").upsert({ contrato_id: +cid, periodo: per, monto: 0, motivo: "Bonificado" }) : sb.from("punitorio_override").delete().eq("contrato_id", +cid).eq("periodo", per);
      const { error } = await q; if (error) throw error; toast(d.bonificar ? "Punitorio bonificado. El inquilino ya lo ve en el portal." : "Bonificación quitada"); await cargarTodo(); await abrirFicha(cid); render(); return;
    }
    if (d.liquidar) { modalLiquidar(d.liquidar); return; }
    if (d.liqpdf) { const l = S.liqs.find((x) => x.id === +d.liqpdf); const r = pdfLiquidacion(S.cfg, l, P(l.propietario_id).nombre); r.doc.save(r.nombre); return; }
    if (d.liqcomp) { const inp = document.createElement("input"); inp.type = "file"; inp.accept = ARCHIVOS_OK; inp.onchange = async () => { try { await subirComprobanteLiquidacion(S.liqs.find((x) => x.id === +d.liqcomp), inp.files[0]); toast("Comprobante subido. El propietario ya lo ve en el portal."); } catch (e) { toast(mensajeError(e), "bad"); } }; inp.click(); return; }
    if (d.liqanular) { if (!confirmar()) return; if (await rpc("anular_liquidacion", { p_liq: +d.liqanular }, "Liquidación anulada")) await recargar(); return; }
    if (d.dia) { S.cajaDia = d.dia; render(); return; }
    if (d.movanular) { if (!confirmar()) return; const { error } = await sb.from("caja_movimientos").update({ anulado: true }).eq("id", +d.movanular); if (error) throw error; await cargarCaja(); render(); return; }
    if (d.recordar) { const c = S.contratos.get(+d.recordar); const dd = deudaDe(c).filter((x) => x.vencido); copiar(`Hola ${inq(c).split(",").pop().trim()}, te escribimos de ${S.cfg.nombre}. Figura pendiente el alquiler de ${c.direccion} de ${dd.map((x) => periodo(x.p)).join(", ")}, por ${money(dd.reduce((s, x) => s + x.saldo, 0))}. Podés ver el detalle y enviar el comprobante en ${PORTAL_URL}. ¡Gracias!`); return; }
    if (d.rescindir) { if (!confirmar("¿Rescindir desde el mes que viene?")) return; const { error } = await sb.from("contratos").update({ rescindido: true, rescision_desde: ymSumar(ymHoy(), 1) }).eq("id", +d.rescindir); if (error) throw error; cerrarModal(); await recargar("Contrato rescindido"); return; }
    if (d.reactivar) { const { error } = await sb.from("contratos").update({ rescindido: false, rescision_desde: null }).eq("id", +d.reactivar); if (error) throw error; cerrarModal(); await recargar("Rescisión quitada"); return; }
    if (d.acceso) {
      el.disabled = true; el.textContent = "Generando…";
      const { data, error } = await sb.functions.invoke("accesos", { body: { accion: "crear_acceso", persona_id: +d.acceso } });
      if (error || data?.error) { toast(data?.error || mensajeError(error), "bad"); el.disabled = false; el.textContent = "Reintentar"; return; }
      const p = S.personas.get(+d.acceso);
      const msg = `Hola ${p.nombre.split(",").pop().trim()}, te damos acceso al portal de ${S.cfg.nombre} para ver ${p.tipo === "inquilino" ? "cuánto pagar, enviar comprobantes y descargar tus recibos" : "tus liquidaciones y comprobantes"}.\nEntrá en ${PORTAL_URL}\nUsuario: ${data.usuario}\nClave: ${data.clave}\nTe recomendamos cambiar la clave al ingresar.`;
      $("#acceso-resultado").innerHTML = `<div class="recibo"><div>Usuario: <b class="mono">${esc(data.usuario)}</b> · Clave: <b class="mono">${esc(data.clave)}</b></div><div class="muted">La clave no se vuelve a mostrar. Si se pierde, generá una nueva.</div><div class="row"><button class="btn primary" id="copiar-acceso">Copiar mensaje</button>${wa(p.telefono) ? `<a class="btn" href="${wa(p.telefono)}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ""}</div></div>`;
      $("#copiar-acceso").onclick = () => copiar(msg); el.textContent = "Generar nueva clave"; el.disabled = false;
      cargarTodo().then(render); return;
    }
    if (d.quitaracceso) { if (!confirmar("¿Quitar acceso?")) return; const { data, error } = await sb.functions.invoke("accesos", { body: { accion: "quitar_acceso", persona_id: +d.quitaracceso } }); if (error || data?.error) throw new Error(data?.error || error.message); cerrarModal(); await recargar("Acceso quitado"); return; }
    if (d.staffclave) { if (!confirmar("¿Generar nueva clave?")) return; const { data, error } = await sb.functions.invoke("accesos", { body: { accion: "clave_staff", user_id: d.staffclave } }); if (error || data?.error) throw new Error(data?.error || error.message); abrirModal(`<div class="mh"><h2>Nueva clave</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div><p>Clave: <b class="mono">${esc(data.clave)}</b></p><p class="muted">Pasásela a la persona. No se vuelve a mostrar.</p>`); return; }
    if (d.staffactivo) { const s = S.staff.find((x) => x.user_id === d.staffactivo); const { error } = await sb.from("staff").update({ activo: !s.activo }).eq("user_id", s.user_id); if (error) throw error; await recargar(); return; }
  } catch (e) { toast(mensajeError(e), "bad"); }
});

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "q") { S.q = t.value; S.limite = 150; const pos = t.selectionStart; render(); const n = $("#q"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
  if (t.closest("#f-cobro")) { t.id === "co-periodo" ? cobroPeriodo() : cobroTotal(); return; }
  if (t.closest("#f-aprobar")) { aprobarTotal(); return; }
  if (t.closest("#f-liq")) { liqTotal(); return; }
  if (t.id === "aj-pct") { const f = $("#f-ajuste"); f.monto.value = t.value === "" ? "" : r2(+f.dataset.ant * (1 + +t.value / 100)); return; }
  if (t.id === "aj-monto") { const f = $("#f-ajuste"); const a = +f.dataset.ant; if (a) f.pct.value = Math.round((+t.value / a - 1) * 10000) / 100; return; }
});
document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.id === "co-periodo") cobroPeriodo();
  if (t.id === "caja-mes" && t.value) { S.cajaMes = t.value; S.cajaDia = t.value === ymHoy() ? isoHoy() : t.value + "-01"; await cargarCaja(); render(); }
  if (t.id === "caja-dia" && t.value) { S.cajaDia = t.value; if (ymDe(t.value) !== S.cajaMes) { S.cajaMes = ymDe(t.value); await cargarCaja(); } render(); }
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault(); const f = ev.target; const v = Object.fromEntries(new FormData(f).entries());
  const boton = f.querySelector("[type=submit]"); const bloquear = (x) => { if (boton) { boton.disabled = x; } };
  bloquear(true);
  try {
    if (f.id === "f-login") return await login(v);
    if (f.id === "f-cobro") {
      const pg = await rpc("registrar_pago", { p_contrato: +f.dataset.id, p_periodo: v.periodo, p_fecha: v.fecha, p_alquiler: +v.alquiler || 0, p_punitorio: +v.punitorio || 0, p_conceptos: leerConceptos(f), p_admin_alquiler: f.admin_alquiler.checked, p_medio: v.medio, p_obs: v.obs }, "Cobro registrado");
      if (pg) { await cargarTodo(); render(); modalRecibo(pg.id); }
      return;
    }
    if (f.id === "f-aprobar") {
      const pg = await rpc("aprobar_envio", { p_envio: +f.dataset.id, p_alquiler: +v.alquiler || 0, p_punitorio: +v.punitorio || 0, p_conceptos: leerConceptos(f), p_admin_alquiler: f.admin_alquiler.checked, p_obs: v.obs, p_fecha: v.fecha || null }, "Aprobado. Se generó el recibo y avisamos al inquilino y al propietario.");
      if (pg) { cerrarModal(); await recargar(); }
      return;
    }
    if (f.id === "f-rechazar") { if (await rpc("rechazar_envio", { p_envio: +f.dataset.id, p_motivo: v.motivo }, "Rechazado. Le avisamos al inquilino.")) { cerrarModal(); await recargar(); } return; }
    if (f.id === "f-ajuste") {
      const c = S.contratos.get(+f.dataset.id); const monto = r2(v.monto); if (!(monto > 0)) { toast("Cargá el nuevo alquiler", "bad"); return; }
      const { error } = await sb.from("ajustes").insert({ contrato_id: c.id, desde: v.desde, monto_anterior: r2(f.dataset.ant), monto, pct: v.pct === "" ? null : +v.pct });
      if (error) throw error;
      if (c.ajuste_revisar) await sb.from("contratos").update({ ajuste_revisar: false }).eq("id", c.id);
      cerrarModal(); await recargar("Ajuste guardado: " + money(monto)); return;
    }
    if (f.id === "f-contrato") {
      const inqId = idPersonaDesdeTexto(v.inquilino, "inquilino"), propId = idPersonaDesdeTexto(v.propietario, "propietario");
      const crear = async (nombre, tipo) => { const { data, error } = await sb.from("personas").insert({ nombre: nombre.trim(), tipo }).select().single(); if (error) throw error; return data.id; };
      const data = { carpeta: +v.carpeta || 0, direccion: v.direccion.trim(), inicio: v.inicio, fin: v.fin, monto_base: r2(v.monto_base), deposito: r2(v.deposito),
        indice: v.indice, ajuste_meses: +v.ajuste_meses || 12, ajuste_revisar: false, forma_pago: v.forma_pago, comision: v.comision === "" ? null : +v.comision,
        dia_vto: v.dia_vto ? +v.dia_vto : null, notas: v.notas.trim() || null,
        inquilino_id: inqId || (await crear(v.inquilino, "inquilino")), propietario_id: propId || (await crear(v.propietario, "propietario")) };
      if (data.fin < data.inicio) { toast("La fecha de fin es anterior al inicio", "bad"); return; }
      const q = f.dataset.id ? sb.from("contratos").update(data).eq("id", +f.dataset.id) : sb.from("contratos").insert(data);
      const { error } = await q; if (error) throw error;
      if (!f.dataset.id) cerrarModal(); await recargar(f.dataset.id ? "Cambios guardados" : "Contrato creado");
      if (f.dataset.id) await abrirFicha(f.dataset.id);
      return;
    }
    if (f.id === "f-persona") {
      const data = { nombre: v.nombre.trim(), dni: (v.dni || "").replace(/\D/g, "") || null, telefono: (v.telefono || "").trim() || null, email: (v.email || "").trim() || null, notas: (v.notas || "").trim() || null };
      for (const k of ["banco", "titular", "cbu", "alias"]) if (k in v) data[k] = v[k].trim() || null;
      let id = f.dataset.id;
      if (id) { const { error } = await sb.from("personas").update(data).eq("id", +id); if (error) throw error; }
      else { const { data: n, error } = await sb.from("personas").insert({ ...data, tipo: v.tipo }).select().single(); if (error) throw error; id = n.id; }
      await cargarTodo(); render(); modalPersona(id); toast("Datos guardados"); return;
    }
    if (f.id === "f-liq") {
      const ids = liqSel(); if (!ids.length) { toast("Elegí al menos un cobro", "bad"); return; }
      const lq = await rpc("crear_liquidacion", { p_propietario: +f.dataset.pid, p_pagos: ids, p_deducciones: +v.ded || 0, p_detalle: v.det, p_fecha: v.fecha, p_medio: v.medio }, "Liquidación registrada");
      if (lq) { const file = $("#lq-comp").files[0]; if (file) { try { await subirComprobanteLiquidacion(lq, file); } catch (e) { toast("La liquidación se guardó, pero no se pudo subir el comprobante: " + mensajeError(e), "bad"); } } cerrarModal(); await recargar(); }
      return;
    }
    if (f.id === "f-mov") { const { error } = await sb.from("caja_movimientos").insert({ tipo: v.tipo, fecha: v.fecha, concepto: v.concepto.trim(), monto: r2(v.monto), medio: v.medio }); if (error) throw error; cerrarModal(); S.cajaDia = v.fecha; S.cajaMes = ymDe(v.fecha); await cargarCaja(); render(); toast("Movimiento guardado"); return; }
    if (f.id === "f-config") {
      const num = ["comision", "dia_vto", "dias_gracia", "interes_diario"]; const data = {};
      for (const [k, val] of Object.entries(v)) data[k] = num.includes(k) ? +val || 0 : String(val).trim();
      const { error } = await sb.from("config").update(data).eq("id", 1); if (error) throw error; await recargar("Configuración guardada"); return;
    }
    if (f.id === "f-num") { if (await rpc("fijar_numeracion", { p_proximo_recibo: +v.rec, p_proxima_liquidacion: +v.liq }, "Numeración actualizada")) { cerrarModal(); mostrarNumeracion(); } return; }
    if (f.id === "f-staff") {
      const { data, error } = await sb.functions.invoke("accesos", { body: { accion: "crear_staff", ...v } });
      if (error || data?.error) throw new Error(data?.error || error.message);
      $("#st-res").innerHTML = `<div class="recibo">Usuario: <b>${esc(data.email)}</b> · Clave: <b class="mono">${esc(data.clave)}</b><div class="muted">Entra en ${esc(location.href)}. La clave no se vuelve a mostrar.</div></div>`;
      cargarTodo().then(render); return;
    }
  } catch (e) { toast(mensajeError(e), "bad"); }
  finally { bloquear(false); }
});

async function mostrarNumeracion() { const n = await rpc("ver_numeracion", {}); const el = $("#numeracion"); if (el && n) el.textContent = `Próximo recibo: N° ${pad5(n.recibo)} · Próxima liquidación: N° ${pad5(n.liquidacion)}`; }

/* ================= sesión ================= */
function pantallaLogin(msg) {
  document.body.innerHTML = `<div class="login"><form class="card" id="f-login"><div class="brand"><b>M.M. Fuentes</b><span>Sistema de gestión</span></div>
  <label>Email<input type="email" id="lg-email" name="email" required autocomplete="username"></label>
  <label>Clave<input type="password" id="lg-clave" name="clave" required autocomplete="current-password"></label>
  ${msg ? `<div class="error">${esc(msg)}</div>` : ""}<button class="btn primary" type="submit">Ingresar</button>
  <a class="muted" href="./">¿Sos inquilino o propietario? Entrá al portal</a></form></div><div id="modal"></div>`;
}
async function login(v) {
  const { error } = await sb.auth.signInWithPassword({ email: v.email.trim(), password: v.clave });
  if (error) { pantallaLogin("Email o clave incorrectos."); return; }
  location.reload();
}
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return pantallaLogin();
  const { data: yo } = await sb.from("staff").select("*").eq("user_id", session.user.id).maybeSingle();
  if (!yo || !yo.activo) { await sb.auth.signOut(); return pantallaLogin("Esta cuenta no pertenece al equipo de la inmobiliaria."); }
  S.yo = yo; render();
  try { await cargarTodo(); } catch (e) { $("#main").innerHTML = `<div class="panel"><h1>No se pudieron cargar los datos</h1><p>${esc(mensajeError(e))}</p></div>`; return; }
  render();
  // Avisos en vivo de nuevos envíos del portal (y control cada 2 minutos por si se corta la conexión)
  sb.channel("envios").on("postgres_changes", { event: "INSERT", schema: "public", table: "envios" }, async () => { await cargarEnvios(); render(); toast("Llegó un nuevo envío del portal"); }).subscribe();
  setInterval(async () => { const antes = pendientesRevisar().length; await cargarEnvios().catch(() => {}); if (pendientesRevisar().length !== antes) render(); }, 120000);
}
iniciar();

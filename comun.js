// Cobranza Fuentes · funciones compartidas entre el sistema de gestión y el portal
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "cobranza-fuentes" },
});
export const DOMINIO_USUARIOS = "clientes.inmobiliariammfuentes.com";

/* ---------- formato ---------- */
export const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
export const MEDIOS = ["Efectivo","Transferencia","Depósito","Cheque","Otro"];
const fmtARS = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2 });
export const money = (n) => fmtARS.format(Math.round((+n || 0) * 100) / 100);
export const r2 = (n) => Math.round((+n || 0) * 100) / 100;
export const pad = (n) => String(n).padStart(2, "0");
export const pad5 = (n) => String(n || 0).padStart(5, "0");
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const isoHoy = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
export const ymHoy = () => isoHoy().slice(0, 7);
export const ymDe = (iso) => String(iso || "").slice(0, 7);
export function ymSumar(p, n) { let [y, m] = p.split("-").map(Number); m += n; y += Math.floor((m - 1) / 12); m = (((m - 1) % 12) + 12) % 12 + 1; return y + "-" + pad(m); }
export function ymDif(a, b) { const [ya, ma] = a.split("-").map(Number), [yb, mb] = b.split("-").map(Number); return (yb - ya) * 12 + (mb - ma); }
export const periodo = (p) => { if (!p) return ""; const [y, m] = p.split("-"); return MESES[+m - 1] + " " + y; };
export const fecha = (iso) => { if (!iso) return ""; const [y, m, d] = String(iso).slice(0, 10).split("-"); return d + "/" + m + "/" + y; };
export const diasEntre = (a, b) => Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / 864e5);

/* ---------- reglas de negocio ----------
   c: contrato  ·  aj: ajustes del contrato  ·  pg: pagos del contrato  ·  ov: {periodo: monto} punitorios bonificados  */
export function estadoContrato(c) {
  const t = isoHoy();
  if (c.rescindido) return "rescindido";
  if (c.fin < t) return "vencido";
  if (c.inicio > t) return "futuro";
  if (diasEntre(t, c.fin) <= 90) return "porvencer";
  return "vigente";
}
export const ESTADOS = { vigente: ["ok", "Vigente"], porvencer: ["warn", "Por vencer"], vencido: ["", "Vencido"], rescindido: ["bad", "Rescindido"], futuro: ["acc", "Inicia pronto"] };
export const contratoActivo = (c) => ["vigente", "porvencer", "futuro"].includes(estadoContrato(c));

export function ajustesValidos(aj) { return (aj || []).filter((a) => !a.anulado).sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0)); }
export function montoEn(c, aj, p) { let m = +c.monto_base || 0; for (const a of ajustesValidos(aj)) if (a.desde <= p) m = +a.monto; return m; }
export const comisionDe = (c, cfg) => (c.comision != null && c.comision !== "" ? +c.comision : +cfg.comision);
export const vtoDe = (c, cfg, p) => p + "-" + pad(Math.min(+(c.dia_vto || cfg.dia_vto) || 10, 28));

// Punitorio sugerido: se cuenta desde el día siguiente al vencimiento, solo si pasaron más días que la tolerancia
export function punitorioSugerido(saldo, dias, cfg) {
  const i = +cfg.interes_diario || 0, g = +cfg.dias_gracia || 0;
  return dias > g && i > 0 ? r2(saldo * i / 100 * dias) : 0;
}

export function deuda(c, aj, pg, cfg, ov, hoy = isoHoy()) {
  const ini = [cfg.inicio_cobranza, ymDe(c.inicio)].sort().pop();
  let fin = [ymDe(hoy), ymDe(c.fin)].sort()[0];
  if (c.rescindido) { if (!c.rescision_desde) return []; fin = [fin, ymSumar(c.rescision_desde, -1)].sort()[0]; }
  const out = [];
  if (!ini || ini > fin) return out;
  const pagado = {};
  for (const p of pg || []) if (!p.anulado) pagado[p.periodo] = (pagado[p.periodo] || 0) + (+p.alquiler || 0);
  for (let p = ini; p <= fin; p = ymSumar(p, 1)) {
    const monto = montoEn(c, aj, p), saldo = r2(monto - (pagado[p] || 0));
    if (saldo <= 0.5) continue;
    const vto = vtoDe(c, cfg, p), dias = Math.max(0, diasEntre(vto, hoy));
    const sugerido = punitorioSugerido(saldo, dias, cfg);
    const bonif = ov && Object.prototype.hasOwnProperty.call(ov, p);
    out.push({ p, monto, saldo, vto, vencido: hoy > vto, dias, enTolerancia: hoy > vto && dias <= (+cfg.dias_gracia || 0),
               punitorio: bonif ? +ov[p] : sugerido, punitorioSugerido: sugerido, bonificado: bonif });
  }
  return out;
}

// Deuda a partir de los renglones pendientes de la planilla (cargos)
export function deudaCargos(c, cargos, cfg, ov, hoy = isoHoy()) {
  const por = new Map();
  for (const g of cargos || []) { if (g.anulado || +g.saldo <= 0.005) continue; if (!por.has(g.periodo)) por.set(g.periodo, []); por.get(g.periodo).push(g); }
  return [...por.keys()].sort().map((p) => {
    const gs = por.get(p).slice().sort((a, b) => (a.tipo === "alquiler" ? 0 : 1) - (b.tipo === "alquiler" ? 0 : 1) || a.id - b.id);
    const saldo = r2(gs.reduce((s, g) => s + +g.saldo, 0)), alqSaldo = r2(gs.filter((g) => g.tipo === "alquiler").reduce((s, g) => s + +g.saldo, 0));
    const vto = vtoDe(c, cfg, p), dias = Math.max(0, diasEntre(vto, hoy));
    const sugerido = punitorioSugerido(alqSaldo, dias, cfg);
    const bonif = !!ov && Object.prototype.hasOwnProperty.call(ov, p);
    return { p, monto: saldo, saldo, alqSaldo, vto, vencido: hoy > vto, dias, enTolerancia: hoy > vto && dias <= (+cfg.dias_gracia || 0),
             punitorio: bonif ? +ov[p] : sugerido, punitorioSugerido: sugerido, bonificado: bonif, cargos: gs };
  });
}
// División de renglones: cuánto va al propietario y cuánto a la inmobiliaria. lineas: [{monto, punitorio, admin, propietario}]
export function divisionLineas(c, cfg, lineas) {
  const pct = comisionDe(c, cfg); let total = 0, prop = 0, hon = 0;
  for (const l of lineas) { const m = +l.monto || 0, pu = +l.punitorio || 0, h = l.admin ? r2(m * pct / 100) : 0, sg = l.propietario == null ? 1 : +l.propietario;
    total += m + pu; hon += h; prop += sg * (m + pu) - h; }
  return { total: r2(total), propietario: r2(prop), inmobiliaria: r2(total - prop), honorarios: r2(hon), pct };
}

// División del pago cuando el inquilino transfiere por separado al propietario y a la inmobiliaria
export function division(c, cfg, alquiler, punitorio) {
  const hon = r2(alquiler * comisionDe(c, cfg) / 100);
  return { inmobiliaria: hon, propietario: r2(alquiler - hon + (+punitorio || 0)), total: r2(alquiler + (+punitorio || 0)) };
}

export function proximoAjuste(c, aj, cfg) {
  const paso = +c.ajuste_meses || 12, ini = ymDe(c.inicio), cur = ymHoy();
  if (!ini || cur < ini) return null;
  const hechos = ajustesValidos(aj).map((a) => a.desde);
  let k = Math.max(1, Math.ceil(ymDif(ini, cur) / paso)), cand = ymSumar(ini, k * paso);
  while (cand < cfg.inicio_cobranza) cand = ymSumar(cand, paso);
  while (cand <= ymSumar(cur, 1) && hechos.includes(cand)) cand = ymSumar(cand, paso);
  const prev = ymSumar(cand, -paso);
  if (prev > ini && prev >= cfg.inicio_cobranza && !hechos.includes(prev)) cand = prev;
  return cand > ymDe(c.fin) ? null : cand;
}

/* ---------- interfaz ---------- */
export function toast(msg, tipo) {
  document.querySelectorAll(".toast").forEach((x) => x.remove());
  const t = document.createElement("div");
  t.className = "toast" + (tipo ? " " + tipo : ""); t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), 3800);
}
export function abrirModal(html, ancho) {
  const root = document.getElementById("modal");
  root.innerHTML = `<div class="overlay" data-cerrar-fondo><div class="modal ${ancho ? "ancho" : ""}" role="dialog" aria-modal="true">${html}</div></div>`;
  const f = root.querySelector("[autofocus]"); if (f) f.focus();
}
export function cerrarModal() { document.getElementById("modal").innerHTML = ""; }
document.addEventListener("click", (e) => {
  const fondo = e.target.closest("[data-cerrar-fondo]");
  if (fondo && e.target === fondo) cerrarModal();
  if (e.target.closest("[data-cerrar]")) cerrarModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarModal(); });

export async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast("Copiado"); }
  catch { abrirModal(`<div class="mh"><h2>Copiá el texto</h2><button class="x" data-cerrar aria-label="Cerrar">×</button></div><textarea rows="6" id="copia">${esc(txt)}</textarea>`); document.getElementById("copia").select(); }
}
export function mensajeError(e) {
  const m = (e && (e.message || e.error_description || e.error)) || String(e || "Error");
  if (/row-level security|permission denied/i.test(m)) return "No tenés permiso para hacer esto.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Revisá internet y probá de nuevo.";
  return m;
}
export function wa(tel) { const d = String(tel || "").replace(/\D/g, ""); return d ? "https://wa.me/549" + d.replace(/^(54)?9?0?/, "") : null; }

/* ---------- archivos ---------- */
export function rutaArchivo(contratoId, carpeta, nombre) {
  const ext = (String(nombre).match(/\.([a-z0-9]{1,5})$/i) || [, "bin"])[1].toLowerCase();
  const id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  return `c/${contratoId}/${carpeta}/${id}.${ext}`;
}
export async function verArchivo(path) {
  const { data, error } = await sb.storage.from("documentos").createSignedUrl(path, 600);
  if (error) { toast("No se pudo abrir el archivo: " + mensajeError(error), "bad"); return; }
  window.open(data.signedUrl, "_blank", "noopener");
}
export const ETIQUETA_ARCHIVO = {
  comp_propietario: "Transferencia al propietario", comp_inmobiliaria: "Transferencia a la inmobiliaria",
  comp_total: "Comprobante de pago", boleta: "Boleta de servicio", comp_liquidacion: "Transferencia de la liquidación", otro: "Documento",
};
export const ARCHIVOS_OK = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

/* ---------- PDF (recibo y liquidación) ---------- */
function pdfBase(cfg, titulo, nro, fechaIso) {
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
  doc.setFillColor(122, 31, 46); doc.rect(0, 0, 210, 28, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("times", "bold"); doc.setFontSize(18); doc.text(cfg.nombre, 15, 13);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9);
  doc.text([cfg.domicilio, [cfg.telefono, cfg.cuit ? "CUIT " + cfg.cuit : ""].filter(Boolean).join(" · ")].filter(Boolean), 15, 19);
  doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text(`${titulo} N° ${pad5(nro)}`, 195, 13, { align: "right" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(fecha(fechaIso), 195, 20, { align: "right" });
  doc.setTextColor(36, 26, 28); return doc;
}
function fila(doc, y, a, b, neg) {
  doc.setFont("helvetica", neg ? "bold" : "normal"); doc.text(String(a), 15, y); doc.text(String(b), 195, y, { align: "right" });
  doc.setDrawColor(230, 218, 220); doc.line(15, y + 2.5, 195, y + 2.5); return y + 8;
}
const limpio = (s) => String(s || "").replace(/[^\wÁÉÍÓÚÑáéíóúñü ,.-]/g, "").trim();

export function pdfRecibo(cfg, info, p) {
  // info: {direccion, inquilino, carpeta}
  const doc = pdfBase(cfg, "RECIBO", p.recibo_nro, p.fecha); doc.setFontSize(11);
  const txt = doc.splitTextToSize(`Recibimos de ${info.inquilino} la suma de ${money(p.total)} en concepto de alquiler del período ${periodo(p.periodo)} de la propiedad ubicada en ${info.direccion}.`, 180);
  doc.text(txt, 15, 42); let y = 42 + txt.length * 6 + 8; doc.setFontSize(10);
  const det = Array.isArray(p.detalle) && p.detalle.length ? p.detalle : null;
  if (det) {
    for (const k of det) {
      if (y > 260) { doc.addPage(); y = 20; }
      y = fila(doc, y, doc.splitTextToSize(k.concepto + (k.inquilino < 0 ? " (se descuenta)" : ""), 140)[0], (k.inquilino < 0 ? "− " : "") + money(k.monto));
      if (+k.punitorio) y = fila(doc, y, "   Punitorios", money(k.punitorio));
    }
  } else {
    y = fila(doc, y, "Alquiler " + periodo(p.periodo), money(p.alquiler));
    if (+p.punitorio) y = fila(doc, y, "Punitorios", money(p.punitorio));
    const cs = Array.isArray(p.conceptos) ? p.conceptos : [];
    if (cs.length) for (const k of cs) y = fila(doc, y, k.concepto + (k.inquilino < 0 ? " (se descuenta)" : ""), (k.inquilino < 0 ? "− " : "") + money(k.monto));
    else if (+p.otros) y = fila(doc, y, p.otros_detalle || "Otros conceptos", money(p.otros));
  }
  y = fila(doc, y, "TOTAL", money(p.total), true);
  doc.setFont("helvetica", "normal");
  doc.text("Medio de pago: " + p.medio + (p.modalidad === "dividida" ? " (dividida: propietario e inmobiliaria)" : ""), 15, y + 2);
  if (p.modalidad === "dividida") doc.text(`Transferido al propietario: ${money(p.neto_propietario)} · a la inmobiliaria: ${money(p.honorarios)}`, 15, y + 8);
  if (p.obs) doc.text(doc.splitTextToSize("Observaciones: " + p.obs, 180), 15, y + 14);
  if (info.carpeta) doc.text("Carpeta " + info.carpeta, 15, y + 26);
  if (p.anulado) { doc.setTextColor(163, 38, 44); doc.setFontSize(40); doc.text("ANULADO", 105, 150, { align: "center", angle: 20 }); }
  doc.setTextColor(111, 95, 98); doc.setFontSize(8); doc.text(`${cfg.nombre} · Documento generado electrónicamente`, 105, 288, { align: "center" });
  return { doc, nombre: `Recibo ${pad5(p.recibo_nro)} - ${limpio(info.inquilino)}.pdf` };
}

export function pdfLiquidacion(cfg, l, propietario) {
  const doc = pdfBase(cfg, "LIQUIDACIÓN", l.nro, l.fecha); doc.setFontSize(11);
  doc.text("Propietario: " + propietario, 15, 40); let y = 52; doc.setFontSize(9);
  doc.setFont("helvetica", "bold"); doc.text("Detalle", 15, y); doc.text("Cobrado", 140, y, { align: "right" });
  doc.text("Administración", 168, y, { align: "right" }); doc.text("Total", 195, y, { align: "right" }); y += 7; doc.setFont("helvetica", "normal");
  for (const i of l.items || []) {
    if (y > 268) { doc.addPage(); y = 20; }
    const linea = (txt, cob, com, neto) => {
      doc.text(doc.splitTextToSize(txt, 100)[0], 15, y);
      if (cob != null) doc.text(money(cob), 140, y, { align: "right" });
      if (com != null) doc.text("− " + money(com), 168, y, { align: "right" });
      doc.text(money(neto), 195, y, { align: "right" }); doc.setDrawColor(230, 218, 220); doc.line(15, y + 2.5, 195, y + 2.5); y += 7;
    };
    if (i.tipo === "adelanto" || i.tipo === "particular") linea(i.descripcion, null, null, i.neto);
    else if (i.descripcion) linea(`${i.direccion} · ${i.descripcion}${i.recibo ? " · Rec. " + pad5(i.recibo) : ""}`, i.cobrado, i.comision, i.neto ?? i.cobrado - i.comision);
    else linea(`${i.direccion} · ${periodo(i.periodo)} · Rec. ${pad5(i.recibo)}`, i.cobrado, i.comision, i.cobrado - i.comision);
  }
  y += 4; doc.setFontSize(10);
  y = fila(doc, y, "Total cobrado", money(l.bruto)); y = fila(doc, y, "Honorarios de administración", "− " + money(l.comision));
  if (+l.deducciones) y = fila(doc, y, "Adelantos y descuentos" + (l.deducciones_detalle ? " (" + l.deducciones_detalle + ")" : ""), "− " + money(l.deducciones));
  y = fila(doc, y, l.modalidad === "directa" ? "NETO TRANSFERIDO POR EL INQUILINO" : "NETO A PAGAR", money(l.neto), true);
  doc.setFont("helvetica", "normal"); doc.text("Forma de pago: " + (l.medio || ""), 15, y + 2);
  if (l.anulada) { doc.setTextColor(163, 38, 44); doc.setFontSize(40); doc.text("ANULADA", 105, 150, { align: "center", angle: 20 }); }
  doc.setTextColor(111, 95, 98); doc.setFontSize(8); doc.text(`${cfg.nombre} · Documento generado electrónicamente`, 105, 288, { align: "center" });
  return { doc, nombre: `Liquidacion ${pad5(l.nro)} - ${limpio(propietario)}.pdf` };
}

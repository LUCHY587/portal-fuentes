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

/* ---------- PDF (recibo y liquidación, con el formato de SPOT) ---------- */
const UNI = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE", "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE",
  "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIÚN", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO",
  "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const DEC = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CEN = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];
function letras999(n) {
  if (n === 100) return "CIEN";
  const c = Math.floor(n / 100), r = n % 100; let t = CEN[c];
  if (r) t += (t ? " " : "") + (r < 30 ? UNI[r] : DEC[Math.floor(r / 10)] + (r % 10 ? " Y " + UNI[r % 10] : ""));
  return t;
}
export function numeroALetras(valor) {
  const v = Math.abs(r2(valor)), ent = Math.floor(v), cent = Math.round((v - ent) * 100);
  let t;
  if (ent === 0) t = "CERO";
  else {
    const mill = Math.floor(ent / 1e6), miles = Math.floor((ent % 1e6) / 1000), resto = ent % 1000, p = [];
    if (mill) p.push(mill === 1 ? "UN MILLÓN" : letras999(mill) + " MILLONES");
    if (miles) p.push(miles === 1 ? "MIL" : letras999(miles) + " MIL");
    if (resto) p.push(letras999(resto));
    t = p.join(" ");
  }
  return t + (ent === 1e6 * Math.floor(ent / 1e6) && ent >= 1e6 ? " DE PESOS" : " PESOS") + (cent ? ` CON ${String(cent).padStart(2, "0")}/100` : "");
}

const pm = (n) => money(n).replace(/ /g, " ");                 // importe con espacio común (jsPDF)
const neg = (n) => (r2(n) ? "-" + pm(Math.abs(n)) : pm(0));          // importe que resta
const pad8 = (n) => String(n || 0).padStart(8, "0");
const L = 15, R = 195;
const GRIS = [190, 190, 190], LINEA = [60, 60, 60];

function logo(doc, x, y) {                                           // isotipo de la inmobiliaria
  doc.setFillColor(104, 92, 98);
  doc.lines([[0, -11], [7.2, -4.4], [6.4, 4.4], [0, 11]], x + 3.4, y + 26, [1, 1], "F", true);
  doc.setFillColor(255, 255, 255); doc.rect(x + 7.2, y + 18, 6.6, 8, "F"); doc.circle(x + 10.5, y + 18, 3.3, "F");
  doc.setDrawColor(237, 28, 36); doc.setLineCap("butt"); doc.setLineJoin("miter"); doc.setLineWidth(3.4);
  doc.lines([[18, -17], [15, 17]], x + 0.5, y + 18.5, [1, 1], "S", false);
  doc.line(x + 6.5, y + 6.5, x + 19, y + 17.5);
  doc.setLineWidth(0.2); doc.setLineCap("square"); doc.setDrawColor(...LINEA);
}

function encabezado(doc, cfg, y, titulo, filas, copia) {
  doc.setDrawColor(...LINEA); doc.setLineWidth(0.25); doc.setTextColor(0, 0, 0);
  doc.rect(L, y, R - L, 6); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
  doc.text("DOCUMENTO NO VÁLIDO COMO COMPROBANTE ELECTRÓNICO", 105, y + 4.1, { align: "center" });
  const y1 = y + 6, h = 46; doc.rect(L, y1, R - L, h);
  logo(doc, L + 3, y1 + 3.2);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text(cfg.nombre || "", L + 2, y1 + 31.5);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8);
  const datos = [cfg.email, cfg.whatsapp ? "Whatsapp " + cfg.whatsapp : "", cfg.telefono ? "Tel. " + cfg.telefono : "", cfg.cuit ? "CUIT " + cfg.cuit : ""].filter(Boolean);
  datos.slice(0, 4).forEach((t, k) => doc.text(t, L + 2, y1 + 35.5 + k * 3.4));
  doc.rect(98, y1, 14, 13); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("X", 105, y1 + 7.2, { align: "center" });
  doc.setFontSize(6.5); doc.text(copia, 105, y1 + 11.3, { align: "center" }); doc.line(105, y1 + 13, 105, y1 + h);
  doc.setFont("helvetica", "normal"); doc.setFontSize(17); doc.text(titulo[0], 140, y1 + 10);
  if (titulo[1]) doc.text(titulo[1], 140, y1 + 18);
  let yy = y1 + h - 4 - (filas.length - 1) * 6;
  for (const [k, v, b] of filas) {
    doc.setFontSize(11); doc.setFont("helvetica", b ? "bold" : "normal"); doc.text(k + " ", 140, yy);
    const w = doc.getTextWidth(k + " "); doc.setFont("helvetica", "bold"); doc.text(String(v), 140 + w, yy); yy += 6;
  }
  return y1 + h;
}
function encabezadoCorto(doc, y, filas) {                          // duplicado: solo una línea de datos
  doc.setDrawColor(...LINEA); doc.setLineWidth(0.25); doc.rect(L, y, R - L, 8); doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.text("DUPLICADO", L + 2, y + 5.3);
  let x = R - 2; doc.setFontSize(10);
  for (const [k, v] of [...filas].reverse()) {
    doc.setFont("helvetica", "bold"); doc.text(String(v), x, y + 5.5, { align: "right" }); x -= doc.getTextWidth(String(v)) + 1.2;
    doc.setFont("helvetica", "normal"); doc.text(k, x, y + 5.5, { align: "right" }); x -= doc.getTextWidth(k) + 7;
  }
  return y + 8;
}
function etiqueta(doc, x, y, k, v, align) {
  doc.setFontSize(9.5); doc.setFont("helvetica", "normal");
  const wk = doc.getTextWidth(k + " "); doc.setFont("helvetica", "bold"); const wv = doc.getTextWidth(String(v || ""));
  const x0 = align === "right" ? x - wk - wv : x;
  doc.setFont("helvetica", "normal"); doc.text(k + " ", x0, y); doc.setFont("helvetica", "bold"); doc.text(String(v || ""), x0 + wk, y);
}
function cabeceraTabla(doc, y, cols) {
  doc.setFillColor(...GRIS); doc.setDrawColor(...LINEA); doc.rect(L, y, R - L, 7, "FD");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(50, 50, 50);
  for (const c of cols) doc.text(c.t, c.a === "right" ? c.x : c.x, y + 4.8, c.a === "right" ? { align: "right" } : undefined);
  doc.setTextColor(0, 0, 0); return y + 7;
}
function firma(doc, cfg, y) {
  doc.setDrawColor(170, 170, 170); doc.setLineDashPattern([0.6, 0.6], 0); doc.line(135, y, R, y); doc.setLineDashPattern([], 0);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.text(cfg.nombre || "", 165, y + 4.5, { align: "center" }); doc.setDrawColor(...LINEA);
}
function sello(doc, txt) { doc.setTextColor(190, 30, 40); doc.setFont("helvetica", "bold"); doc.setFontSize(42); doc.text(txt, 105, 150, { align: "center", angle: 20 }); doc.setTextColor(0, 0, 0); }
const limpio = (s) => String(s || "").replace(/[^\wÁÉÍÓÚÑáéíóúñü ,.-]/g, "").trim();

/* Recibo: original y duplicado en la misma hoja (si entran), como SPOT */
export function pdfRecibo(cfg, info, p) {
  // info: {direccion, inquilino, carpeta, propietario, propietario_doc}
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
  let lineas = Array.isArray(p.detalle) && p.detalle.length ? p.detalle : null;
  if (!lineas) {
    lineas = [{ concepto: "Alquiler " + periodo(p.periodo), monto: p.alquiler, punitorio: p.punitorio, inquilino: 1 }];
    const cs = Array.isArray(p.conceptos) ? p.conceptos : [];
    if (cs.length) lineas.push(...cs.map((k) => ({ ...k, punitorio: 0 })));
    else if (+p.otros) lineas.push({ concepto: p.otros_detalle || "Otros conceptos", monto: p.otros, punitorio: 0, inquilino: 1 });
  }
  const aAbonar = lineas.reduce((s, k) => s + (k.inquilino < 0 ? -1 : 1) * ((k.saldo != null ? +k.saldo : +k.monto) + (+k.punitorio || 0)), 0);
  const saldoDeudor = Math.max(0, r2(aAbonar - p.total));
  const cols = [{ t: "Fecha", x: L + 2 }, { t: "Descripción", x: 40 }, { t: "Monto", x: 140, a: "right" }, { t: "Punit", x: 163, a: "right" }, { t: "Total", x: R - 2, a: "right" }];
  const datos = [["Fecha:", fecha(p.fecha), true], ["Recibo:", p.recibo_nro], ["Carpeta:", info.carpeta || "-"]];
  const soloAlquiler = lineas.every((k) => /alquiler/i.test(k.concepto || ""));

  const copia = (doc, y, original) => {
    y = original ? encabezado(doc, cfg, y, ["RECIBO", String(p.recibo_nro)], datos, "ORIGINAL") : encabezadoCorto(doc, y, datos.map(([k, v]) => [k, v]));
    doc.rect(L, y, R - L, 5); doc.setFont("helvetica", "normal"); doc.setFontSize(7.5);
    doc.text("RECIBO POR CUENTA Y ORDEN DE TERCEROS", 105, y + 3.5, { align: "center" }); y += 5;
    const hp = info.propietario_doc ? 17 : 12.5; doc.rect(L, y, R - L, hp);
    etiqueta(doc, L + 4, y + 5, "Propietario:", info.propietario || "");
    etiqueta(doc, R - 4, y + 5, "Inquilino:", info.inquilino || "", "right");
    if (info.propietario_doc) etiqueta(doc, L + 4, y + 9.7, "CUIT/DNI:", info.propietario_doc);
    etiqueta(doc, L + 4, y + hp - 2.6, "Dirección:", doc.splitTextToSize(info.direccion || "", 150)[0]);
    y += hp + 2; y = cabeceraTabla(doc, y, cols) + 1.5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    for (const k of lineas) {
      const resta = k.inquilino < 0, desc = doc.splitTextToSize((k.concepto || "") + (resta ? " (descuento)" : ""), 72);
      const alto = desc.length * 3.7 + 2.6;
      if (y + alto > 282) { doc.addPage(); y = cabeceraTabla(doc, 12, cols) + 1.5; doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); }
      doc.text(fecha(k.fecha || p.fecha), L + 1, y + 3); doc.text(desc, 40, y + 3);
      doc.text(resta ? neg(k.monto) : pm(k.monto), 140, y + 3, { align: "right" });
      doc.text(pm(k.punitorio || 0), 163, y + 3, { align: "right" });
      const tot = (+k.monto || 0) + (+k.punitorio || 0); doc.text(resta ? neg(tot) : pm(tot), R - 2, y + 3, { align: "right" });
      y += alto;
    }
    y += 2; doc.line(L, y, R, y); y += 6;
    const tot = (lbl, v, b, gris) => { doc.setFont("helvetica", b ? "bold" : "normal"); doc.setFontSize(10); doc.setTextColor(...(gris ? [120, 130, 140] : [0, 0, 0]));
      doc.text(lbl, 150, y, { align: "right" }); doc.text(v, 156, y); doc.setTextColor(0, 0, 0); y += 6; };
    tot("Monto a Abonar", pm(aAbonar), false, true); tot("TOTAL ABONADO", pm(p.total), true); tot("Saldo Deudor", pm(saldoDeudor));
    y -= 2; doc.line(L, y, R, y); y += 4;
    doc.setFont("helvetica", "normal"); doc.setFontSize(7);
    const leyenda = `POR MANDATO DEL LOCADOR RECIBÍ DEL LOCATARIO LA SUMA DE ${numeroALetras(p.total)} POR ${soloAlquiler ? "EL ALQUILER" : "EL ALQUILER Y LOS CONCEPTOS DETALLADOS"} DE UNA PROPIEDAD QUE OCUPA EN LA CALLE ${String(info.direccion || "").toUpperCase()}.`;
    const ly = doc.splitTextToSize(leyenda, R - L - 4); doc.text(ly, L + 2, y); y += ly.length * 3 + 1;
    const nota = ["Medio de pago: " + (p.medio || "") + (p.modalidad === "dividida" ? ` (transferido al propietario ${pm(p.neto_propietario)} y a la inmobiliaria ${pm(p.honorarios)})` : ""), p.obs ? "Observaciones: " + p.obs : ""].filter(Boolean).join(" · ");
    const ln = doc.splitTextToSize(nota, R - L - 4); doc.setTextColor(90, 90, 90); doc.text(ln, L + 2, y); doc.setTextColor(0, 0, 0); y += ln.length * 3 + (original ? 6 : 1);
    if (original) { firma(doc, cfg, y); y += 6; }
    return y;
  };

  const fin1 = copia(doc, 8, true), altoDup = copia(new jsPDF({ unit: "mm", format: "a4" }), 0, false);
  if (doc.getNumberOfPages() === 1 && fin1 + 6 + altoDup <= 292) {
    doc.setDrawColor(120, 120, 120); doc.setLineDashPattern([1.5, 1], 0); doc.line(L, fin1 + 2, R, fin1 + 2); doc.setLineDashPattern([], 0);
    copia(doc, fin1 + 5, false);
  } else { doc.addPage(); copia(doc, 12, false); }
  if (p.anulado) { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); sello(doc, "ANULADO"); } }
  return { doc, nombre: `Recibo ${p.recibo_nro} - ${limpio(info.inquilino)}.pdf` };
}

/* Liquidación al propietario agrupada por contrato, como SPOT */
export function pdfLiquidacion(cfg, l, prop) {
  const pr = typeof prop === "object" && prop ? prop : { nombre: prop };
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cols = [{ t: "Fecha", x: L + 2 }, { t: "Descripción", x: 36 }, { t: "Monto", x: 120, a: "right" }, { t: "Punitorios", x: 142, a: "right" },
    { t: "Administración", x: 167, a: "right" }, { t: "Total", x: R - 2, a: "right" }];
  let y = encabezado(doc, cfg, 10, ["LIQUIDACIÓN"], [["Fecha:", fecha(l.fecha), true], ["Liquidación:", pad8(l.nro), false]], "ORIGINAL");
  const docu = [pr.dni ? "CUIT/DNI: " + pr.dni : "", pr.cbu ? "CBU: " + pr.cbu : "", pr.alias ? "Alias: " + pr.alias : ""].filter(Boolean).join("     ");
  const hc = docu ? 12 : 7.5; doc.rect(L, y, R - L, hc); etiqueta(doc, L + 4, y + 5, "Cliente:", pr.nombre || "");
  if (docu) { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text(docu, L + 4, y + 9.8); }
  y += hc + 2; y = cabeceraTabla(doc, y, cols);

  // agrupar renglones por contrato
  const grupos = new Map(), otros = [];
  for (const i of l.items || []) {
    if (i.tipo === "adelanto" || i.tipo === "particular") { otros.push(i); continue; }
    const k = i.contrato_id || i.direccion || "-";
    if (!grupos.has(k)) grupos.set(k, { titulo: [i.carpeta ? "Carpeta: " + i.carpeta : "", i.direccion || "", i.inquilino ? "Inquilino: " + i.inquilino : ""].filter(Boolean).join(" - "), items: [] });
    grupos.get(k).items.push(i);
  }
  const T = { monto: 0, pun: 0, adm: 0, total: 0 };
  const salto = (alto) => { if (y + alto > 282) { doc.addPage(); y = cabeceraTabla(doc, 12, cols); } };
  const subrayado = (txt, yy) => { doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.text(txt, L + 1, yy); doc.setLineWidth(0.15); doc.line(L + 1, yy + 0.7, L + 1 + doc.getTextWidth(txt), yy + 0.7); doc.setLineWidth(0.25); };
  const renglon = (f, d, m, pu, ad, to) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const desc = doc.splitTextToSize(d, 58), alto = desc.length * 3.5 + 2.8; salto(alto);
    doc.text(f, L + 1, y + 3.4); doc.text(desc, 36, y + 3.4); doc.setFontSize(7.6);
    if (m != null) doc.text(m, 120, y + 3.4, { align: "right" }); if (pu != null) doc.text(pu, 142, y + 3.4, { align: "right" });
    if (ad != null) doc.text(ad, 167, y + 3.4, { align: "right" }); doc.text(to, R - 2, y + 3.4, { align: "right" });
    doc.setDrawColor(225, 225, 225); doc.line(L, y + alto, R, y + alto); doc.setDrawColor(...LINEA); y += alto;
  };
  for (const g of grupos.values()) {
    salto(7); y += 1; const t = doc.splitTextToSize(g.titulo, R - L - 4); subrayado(t[0], y + 3.8); y += 6;
    let sub = 0;
    for (const i of g.items) {
      const legado = !i.descripcion, monto = legado ? +i.cobrado || 0 : +i.monto || 0, pun = legado ? 0 : +i.punitorio || 0;
      const adm = +i.comision || 0, total = i.neto != null ? +i.neto : monto + pun - adm;
      const desc = (legado ? "Alquiler " + periodo(i.periodo) : i.descripcion) + (i.recibo ? "  (Rec. " + i.recibo + ")" : "");
      renglon(fecha(i.fecha || l.fecha), desc, monto < 0 ? neg(monto) : pm(monto), pm(pun), neg(adm), total < 0 ? neg(total) : pm(total));
      T.monto += monto; T.pun += pun; T.adm += adm; T.total += total; sub += total;
    }
    salto(6); subrayado("Subtotal: " + (sub < 0 ? neg(sub) : pm(sub)), y + 4); y += 6.5;
  }
  if (otros.length) {
    salto(7); y += 1; subrayado("Otros conceptos", y + 3.8); y += 6;
    for (const i of otros) { const n = +i.neto || 0; renglon(fecha(i.fecha || l.fecha), i.descripcion || "", null, null, null, n < 0 ? neg(n) : pm(n)); T.total += n; }
  }
  salto(9); y += 1; doc.setFillColor(232, 233, 238); doc.rect(L, y, R - L, 8, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text("LIQUIDACIÓN FINAL:", 62, y + 5.3, { align: "center" }); doc.setFontSize(7.8);
  doc.text(T.monto < 0 ? neg(T.monto) : pm(T.monto), 120, y + 5.3, { align: "right" }); doc.text(pm(T.pun), 142, y + 5.3, { align: "right" });
  doc.text(neg(T.adm), 167, y + 5.3, { align: "right" }); doc.text(pm(l.neto), R - 2, y + 5.3, { align: "right" }); y += 13;
  salto(30); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
  const ley = l.modalidad === "directa"
    ? `EL LOCATARIO TRANSFIRIÓ DIRECTAMENTE AL PROPIETARIO LA SUMA DE ${numeroALetras(l.neto)} CORRESPONDIENTE A LA LIQUIDACIÓN DE REFERENCIA.`
    : `RECIBO LA SUMA DE ${numeroALetras(l.neto)} POR LA LIQUIDACIÓN DE REFERENCIA.`;
  const ly = doc.splitTextToSize(ley, R - L); doc.text(ly, L, y); y += ly.length * 3.6 + 6;
  doc.setTextColor(120, 130, 140); doc.setFontSize(9);
  const notas = doc.splitTextToSize("Notas: " + ["Forma de pago: " + (l.medio || ""), l.deducciones_detalle ? "Descuentos: " + l.deducciones_detalle : ""].filter(Boolean).join(" · "), 112);
  doc.text(notas, L, y + 4.5); doc.setTextColor(0, 0, 0); firma(doc, cfg, y);
  if (l.anulada) { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); sello(doc, "ANULADA"); } }
  return { doc, nombre: `Liquidacion ${pad8(l.nro)} - ${limpio(pr.nombre)}.pdf` };
}

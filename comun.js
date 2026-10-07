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

const LOGO = "data:image/png;base64,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";
const LOGO_PROP = 1.2587;                                          // ancho / alto
function logo(doc, x, y) {                                           // logo de la inmobiliaria
  const h = 23.5, w = Math.min(h * LOGO_PROP, 40); doc.addImage(LOGO, "PNG", x, y, w, w / LOGO_PROP);
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

/* Recibo: página 1 original, página 2 copia */
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
    y = encabezado(doc, cfg, y, ["RECIBO", String(p.recibo_nro)], datos, original ? "ORIGINAL" : "COPIA");
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
    const ln = doc.splitTextToSize(nota, R - L - 4); doc.setTextColor(90, 90, 90); doc.text(ln, L + 2, y); doc.setTextColor(0, 0, 0); y += ln.length * 3 + 10;
    firma(doc, cfg, y); y += 6;
    return y;
  };

  copia(doc, 10, true);                                               // página 1: original
  doc.addPage(); copia(doc, 10, false);                               // página 2: copia
  if (p.anulado) { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); sello(doc, "ANULADO"); } }
  return { doc, nombre: `Recibo ${p.recibo_nro} - ${limpio(info.inquilino)}.pdf` };
}

/* Encabezado compacto (media hoja) */
function encabezadoMedio(doc, cfg, y, titulo, filas, copia) {
  doc.setDrawColor(...LINEA); doc.setLineWidth(0.25); doc.setTextColor(0, 0, 0);
  doc.rect(L, y, R - L, 4.5); doc.setFont("helvetica", "normal"); doc.setFontSize(6.5);
  doc.text("DOCUMENTO NO VÁLIDO COMO COMPROBANTE ELECTRÓNICO", 105, y + 3.2, { align: "center" });
  const y1 = y + 4.5, h = 27; doc.rect(L, y1, R - L, h);
  const lh = 15, lw = Math.min(lh * LOGO_PROP, 24); doc.addImage(LOGO, "PNG", L + 2.5, y1 + 2, lw, lw / LOGO_PROP);
  const tx = L + 4 + lw + 2;
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.text(cfg.nombre || "", tx, y1 + 6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(7.3);
  const datos = [cfg.email, cfg.whatsapp ? "Whatsapp " + cfg.whatsapp : "", cfg.telefono ? "Tel. " + cfg.telefono : "", cfg.cuit ? "CUIT " + cfg.cuit : ""].filter(Boolean);
  datos.slice(0, 4).forEach((t, k) => doc.text(t, tx, y1 + 10 + k * 3.1));
  doc.rect(98, y1, 14, 11); doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.text("X", 105, y1 + 6, { align: "center" });
  doc.setFontSize(6); doc.text(copia, 105, y1 + 9.6, { align: "center" }); doc.line(105, y1 + 11, 105, y1 + h);
  doc.setFont("helvetica", "normal"); doc.setFontSize(15); doc.text(titulo, 128, y1 + 8);
  let yy = y1 + h - 3.5 - (filas.length - 1) * 5;
  for (const [k, v, b] of filas) {
    doc.setFontSize(9.5); doc.setFont("helvetica", b ? "bold" : "normal"); doc.text(k + " ", 128, yy);
    const w = doc.getTextWidth(k + " "); doc.setFont("helvetica", "bold"); doc.text(String(v), 128 + w, yy); yy += 5;
  }
  return y1 + h;
}

/* Liquidación al propietario: media hoja A4; original en la página 1 y copia en la página 2. */
export function pdfLiquidacion(cfg, l, prop) {
  const pr = typeof prop === "object" && prop ? prop : { nombre: prop };
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
  const cols = [{ t: "Fecha", x: L + 2 }, { t: "Descripción", x: 36 }, { t: "Monto", x: 120, a: "right" }, { t: "Punitorios", x: 142, a: "right" },
    { t: "Administración", x: 167, a: "right" }, { t: "Total", x: R - 2, a: "right" }];
  const grupos = new Map(), otros = [];
  for (const i of l.items || []) {
    if (i.tipo === "adelanto" || i.tipo === "particular") { otros.push(i); continue; }
    const k = i.contrato_id || i.direccion || "-";
    if (!grupos.has(k)) grupos.set(k, { titulo: [i.carpeta ? "Carpeta: " + i.carpeta : "", i.direccion || "", i.inquilino ? "Inquilino: " + i.inquilino : ""].filter(Boolean).join(" - "), items: [] });
    grupos.get(k).items.push(i);
  }
  const cab = (d, y) => {                                            // cabecera de tabla compacta
    d.setFillColor(...GRIS); d.setDrawColor(...LINEA); d.rect(L, y, R - L, 5.5, "FD");
    d.setFont("helvetica", "bold"); d.setFontSize(7.8); d.setTextColor(50, 50, 50);
    for (const c of cols) d.text(c.t, c.x, y + 3.8, c.a === "right" ? { align: "right" } : undefined);
    d.setTextColor(0, 0, 0); return y + 5.5;
  };

  // dibuja una liquidación (original o copia) desde y0; devuelve dónde termina
  const hoja = (d, y0, copia, paginar) => {
    let y = encabezadoMedio(d, cfg, y0, "LIQUIDACIÓN", [["Fecha:", fecha(l.fecha), true], ["Liquidación:", pad8(l.nro), false]], copia ? "COPIA" : "ORIGINAL");
    const docu = [pr.dni ? "CUIT/DNI: " + pr.dni : "", pr.cbu ? "CBU: " + pr.cbu : "", pr.alias ? "Alias: " + pr.alias : ""].filter(Boolean).join("     ");
    d.rect(L, y, R - L, 6.5); etiqueta(d, L + 3, y + 4.5, "Cliente:", pr.nombre || "");
    if (docu) { d.setFont("helvetica", "normal"); d.setFontSize(8); d.text(docu, R - 3, y + 4.4, { align: "right" }); }
    y += 7.5; y = cab(d, y);
    const salto = (alto) => { if (paginar && y + alto > 280) { d.addPage(); y = cab(d, 12); } };
    const sub = (txt, yy) => { d.setFont("helvetica", "normal"); d.setFontSize(7.8); d.text(txt, L + 1, yy); d.setLineWidth(0.15); d.line(L + 1, yy + 0.6, L + 1 + d.getTextWidth(txt), yy + 0.6); d.setLineWidth(0.25); };
    const renglon = (f, ds, m, pu, ad, to) => {
      d.setFont("helvetica", "normal"); d.setFontSize(7.6);
      const desc = d.splitTextToSize(ds, 60), alto = desc.length * 3.1 + 1.8; salto(alto);
      d.text(f, L + 1, y + 2.9); d.text(desc, 36, y + 2.9); d.setFontSize(7.3);
      if (m != null) d.text(m, 120, y + 2.9, { align: "right" }); if (pu != null) d.text(pu, 142, y + 2.9, { align: "right" });
      if (ad != null) d.text(ad, 167, y + 2.9, { align: "right" }); d.text(to, R - 2, y + 2.9, { align: "right" });
      y += alto;
    };
    const T = { monto: 0, pun: 0, adm: 0 };
    for (const g of grupos.values()) {
      salto(5); sub(d.splitTextToSize(g.titulo, R - L - 4)[0], y + 3.4); y += 4.6;
      let st = 0;
      for (const i of g.items) {
        const legado = !i.descripcion, monto = legado ? +i.cobrado || 0 : +i.monto || 0, pun = legado ? 0 : +i.punitorio || 0;
        const adm = +i.comision || 0, total = i.neto != null ? +i.neto : monto + pun - adm;
        const ds = (legado ? "Alquiler " + periodo(i.periodo) : i.descripcion);
        renglon(fecha(i.fecha || l.fecha), ds, monto < 0 ? neg(monto) : pm(monto), pm(pun), neg(adm), total < 0 ? neg(total) : pm(total));
        T.monto += monto; T.pun += pun; T.adm += adm; st += total;
      }
      if (grupos.size > 1) { salto(4.5); sub("Subtotal: " + (st < 0 ? neg(st) : pm(st)), y + 3.2); y += 4.5; }
    }
    if (otros.length) {
      salto(5); sub("Otros conceptos", y + 3.4); y += 4.6;
      for (const i of otros) { const n = +i.neto || 0; renglon(fecha(i.fecha || l.fecha), i.descripcion || "", null, null, null, n < 0 ? neg(n) : pm(n)); }
    }
    salto(7); y += 0.8; d.setFillColor(232, 233, 238); d.rect(L, y, R - L, 6, "F");
    d.setFont("helvetica", "bold"); d.setFontSize(8); d.text("LIQUIDACIÓN FINAL:", 62, y + 4.1, { align: "center" }); d.setFontSize(7.5);
    d.text(T.monto < 0 ? neg(T.monto) : pm(T.monto), 120, y + 4.1, { align: "right" }); d.text(pm(T.pun), 142, y + 4.1, { align: "right" });
    d.text(neg(T.adm), 167, y + 4.1, { align: "right" }); d.text(pm(l.neto), R - 2, y + 4.1, { align: "right" }); y += 9.5;
    salto(22); d.setFont("helvetica", "normal"); d.setFontSize(7.5);
    const ley = l.modalidad === "directa"
      ? `EL LOCATARIO TRANSFIRIÓ DIRECTAMENTE AL PROPIETARIO LA SUMA DE ${numeroALetras(l.neto)} CORRESPONDIENTE A LA LIQUIDACIÓN DE REFERENCIA.`
      : `RECIBO LA SUMA DE ${numeroALetras(l.neto)} POR LA LIQUIDACIÓN DE REFERENCIA.`;
    const ly = d.splitTextToSize(ley, R - L); d.text(ly, L, y); y += ly.length * 3.1 + 1;
    d.setTextColor(120, 130, 140); d.setFontSize(7.5);
    const notas = d.splitTextToSize("Notas: " + ["Forma de pago: " + (l.medio || ""), l.deducciones_detalle ? "Descuentos: " + l.deducciones_detalle : ""].filter(Boolean).join(" · "), 105);
    d.text(notas, L, y + 9); d.setTextColor(0, 0, 0);
    // un solo renglón de firma: en el original, la inmobiliaria; en la copia, el propietario (retiro en efectivo)
    const yf = y + 8; d.setDrawColor(150, 150, 150); d.setLineDashPattern([0.6, 0.6], 0); d.line(130, yf, R, yf); d.setLineDashPattern([], 0); d.setDrawColor(...LINEA);
    d.setFont("helvetica", "normal"); d.setFontSize(8.5); d.text(copia ? (pr.nombre || "") : (cfg.nombre || ""), 162.5, yf + 3.8, { align: "center" });
    if (copia) { d.setFontSize(6.5); d.setTextColor(110, 110, 110); d.text("Firma del propietario (retiro en efectivo)", 162.5, yf + 7, { align: "center" }); d.setTextColor(0, 0, 0); }
    return yf + (copia ? 8 : 5);
  };

  const MITAD = 148.5, alto = hoja(new jsPDF({ unit: "mm", format: "a4" }), 0, true, false);
  if (alto <= MITAD - 12) {
    hoja(doc, 6, false, false); doc.addPage(); hoja(doc, 6, true, false);       // media hoja: original pág. 1, copia pág. 2
    if (l.anulada) for (const pg of [1, 2]) { doc.setPage(pg); doc.setTextColor(190, 30, 40); doc.setFont("helvetica", "bold"); doc.setFontSize(34);
      doc.text("ANULADA", 105, 85, { align: "center", angle: 15 }); doc.setTextColor(0, 0, 0); }
  } else {
    hoja(doc, 10, false, true); doc.addPage(); hoja(doc, 10, true, true);
    if (l.anulada) { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); sello(doc, "ANULADA"); } }
  }
  return { doc, nombre: `Liquidacion ${pad8(l.nro)} - ${limpio(pr.nombre)}.pdf` };
}

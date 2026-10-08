// Cobranza Fuentes · Página pública de un comprobante (se abre con el link que manda la inmobiliaria)
import { sb, money, esc, fecha, periodo, pdfRecibo, pdfLiquidacion } from "./comun.js";

const $ = (s) => document.querySelector(s);
const token = new URLSearchParams(location.search).get("c") || "";

function marco(cfg, cuerpo) {
  const contacto = [cfg.whatsapp ? "WhatsApp " + cfg.whatsapp : "", cfg.telefono ? "Tel. " + cfg.telefono : "", cfg.email].filter(Boolean).join(" · ");
  return `<header class="cp-h"><div class="brand"><b>${esc(cfg.nombre || "M.M. Fuentes")}</b><span>${esc(contacto)}</span></div></header>${cuerpo}
  <p class="cp-pie muted">Este link es personal: guardalo y podés volver a abrir el comprobante cuando quieras, sin descargar nada.
  ¿Sos inquilino o propietario? También tenés todos tus comprobantes en el <a href="./">portal de clientes</a>.</p>`;
}
const fila = (a, b, cls = "") => `<tr class="${cls}"><td>${a}</td><td class="num">${b}</td></tr>`;

function vistaRecibo(d) {
  const p = d.pago, i = d.info;
  const lineas = Array.isArray(p.detalle) && p.detalle.length ? p.detalle
    : [{ concepto: "Alquiler " + periodo(p.periodo), monto: p.alquiler, punitorio: p.punitorio, inquilino: 1 }];
  return `<section class="panel cp-doc">
    <div class="cp-tit"><div><span class="muted">Recibo</span><h1>N° ${esc(p.recibo_nro)}</h1></div>
      <div class="cp-total"><span class="muted">Total abonado</span><b>${money(p.total)}</b></div></div>
    ${p.anulado ? `<div class="banner" style="background:var(--bad-soft);color:var(--bad)">Este recibo fue anulado.</div>` : ""}
    <dl class="dl">
      <div><dt>Fecha</dt><dd>${fecha(p.fecha)}</dd></div>
      <div><dt>Inquilino</dt><dd>${esc(i.inquilino || "")}</dd></div>
      <div><dt>Propiedad</dt><dd>${esc(i.direccion || "")}</dd></div>
      <div><dt>Propietario</dt><dd>${esc(i.propietario || "")}</dd></div>
      <div><dt>Carpeta</dt><dd>${esc(i.carpeta || "—")}</dd></div>
      <div><dt>Forma de pago</dt><dd>${esc(p.medio || "")}</dd></div>
    </dl>
    <div class="tw"><table><thead><tr><th>Concepto</th><th class="num">Importe</th></tr></thead><tbody>
      ${lineas.map((k) => fila(esc(k.concepto) + (k.inquilino < 0 ? ' <span class="muted">(descuento)</span>' : ""), (k.inquilino < 0 ? "- " : "") + money(k.monto))
        + (+k.punitorio ? fila('<span class="muted">Punitorios</span>', money(k.punitorio)) : "")).join("")}
      ${fila("<b>Total</b>", `<b>${money(p.total)}</b>`)}
    </tbody></table></div>
    ${p.obs ? `<p class="muted">Observaciones: ${esc(p.obs)}</p>` : ""}
    <div class="row cp-btns"><button class="btn primary" id="cp-pdf">Descargar PDF</button><button class="btn" id="cp-ver">Ver para imprimir</button></div>
  </section>`;
}
function vistaLiq(d) {
  const l = d.liq;
  return `<section class="panel cp-doc">
    <div class="cp-tit"><div><span class="muted">Liquidación</span><h1>N° ${esc(l.nro)}</h1></div>
      <div class="cp-total"><span class="muted">${l.modalidad === "directa" ? "Transferido por el inquilino" : "Neto liquidado"}</span><b>${money(l.neto)}</b></div></div>
    ${l.anulada ? `<div class="banner" style="background:var(--bad-soft);color:var(--bad)">Esta liquidación fue anulada.</div>` : ""}
    <dl class="dl">
      <div><dt>Fecha</dt><dd>${fecha(l.fecha)}</dd></div>
      <div><dt>Propietario</dt><dd>${esc(d.prop?.nombre || "")}</dd></div>
      <div><dt>Forma de pago</dt><dd>${esc(l.medio || "")}</dd></div>
    </dl>
    <div class="tw"><table><thead><tr><th>Detalle</th><th class="num">Importe</th></tr></thead><tbody>
      ${(l.items || []).map((i) => i.tipo === "adelanto" || i.tipo === "particular"
        ? fila(esc(i.descripcion || ""), money(i.neto))
        : fila(`${esc(i.descripcion || "Alquiler " + periodo(i.periodo))}<div class="muted">${esc(i.direccion || "")}${i.inquilino ? " · " + esc(i.inquilino) : ""}${+i.comision ? " · Administración -" + money(i.comision) : ""}</div>`, money(i.neto ?? (i.cobrado - i.comision)))).join("")}
      ${fila("<b>Total</b>", `<b>${money(l.neto)}</b>`)}
    </tbody></table></div>
    <div class="row cp-btns"><button class="btn primary" id="cp-pdf">Descargar PDF</button><button class="btn" id="cp-ver">Ver para imprimir</button></div>
  </section>`;
}

async function iniciar() {
  if (token.length < 20) { $("#app").innerHTML = `<div class="panel cp-doc"><h1>Link incompleto</h1><p>Revisá que el link esté copiado completo o pedile uno nuevo a la inmobiliaria.</p></div>`; return; }
  const { data, error } = await sb.rpc("ver_comprobante", { p_token: token });
  if (error || !data) { $("#app").innerHTML = `<div class="panel cp-doc"><h1>No encontramos el comprobante</h1><p>El link puede estar incompleto. Pedile uno nuevo a la inmobiliaria.</p></div>`; return; }
  const cfg = data.cfg || {};
  document.title = (data.tipo === "recibo" ? "Recibo " + data.pago.recibo_nro : "Liquidación " + data.liq.nro) + " · " + (cfg.nombre || "M.M. Fuentes");
  $("#app").innerHTML = marco(cfg, data.tipo === "recibo" ? vistaRecibo(data) : vistaLiq(data));
  const generar = () => data.tipo === "recibo" ? pdfRecibo(cfg, data.info, data.pago) : pdfLiquidacion(cfg, data.liq, data.prop || {});
  $("#cp-pdf").addEventListener("click", () => { const r = generar(); r.doc.save(r.nombre); });
  $("#cp-ver").addEventListener("click", () => { const r = generar(); window.open(r.doc.output("bloburl"), "_blank"); });
}
iniciar();

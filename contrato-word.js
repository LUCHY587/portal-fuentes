// Cobranza Fuentes · Leer un contrato de Word (.doc o .docx) y detectar sus datos
// Todo se procesa en la computadora del usuario: el archivo no se manda a ningún servicio externo.

/* ---------- 1. Sacar el texto del archivo ---------- */
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const ch1252 = (x) => (x < 0x80 ? String.fromCharCode(x) : x < 0xa0 ? CP1252[x - 0x80] : String.fromCharCode(x));

// Word 97-2003 (.doc): el texto está guardado como corridas de caracteres legibles (8 bits o UTF-16)
function textoDoc(bytes) {
  const legible = (x) => (x >= 0x20 && x !== 0x7f) || x === 13 || x === 9 || x === 11;
  const corridas8 = [], corridas16 = [];
  let cur = "";
  for (let i = 0; i < bytes.length; i++) {
    const x = bytes[i];
    if (legible(x)) cur += ch1252(x);
    else { if (cur.length >= 30 && /[a-záéíóúñ]{3}\s/i.test(cur)) corridas8.push(cur); cur = ""; }
  }
  if (cur.length >= 30) corridas8.push(cur);
  cur = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const x = bytes[i] | (bytes[i + 1] << 8);
    if ((x >= 0x20 && x < 0xd800 && x !== 0xfffd) || x === 13 || x === 9) cur += String.fromCharCode(x);
    else { if (cur.length >= 30 && /[a-záéíóúñ]{3} [a-záéíóúñ]/i.test(cur)) corridas16.push(cur); cur = ""; }
  }
  const t8 = corridas8.join(" "), t16 = corridas16.join(" ");
  return t16.length > t8.length ? t16 + " " + t8 : t8 + " " + t16;
}

// Word moderno (.docx): es un .zip; se descomprime word/document.xml con lo que trae el navegador
async function textoDocx(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("El archivo .docx parece dañado");
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n; k++) {
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
    const loc = dv.getUint32(p + 42, true);
    const nombre = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + ln));
    if (nombre === "word/document.xml") {
      const inicio = loc + 30 + dv.getUint16(loc + 26, true) + dv.getUint16(loc + 28, true);
      const datos = u8.subarray(inicio, inicio + tam);
      let xml;
      if (metodo === 0) xml = new TextDecoder().decode(datos);
      else xml = await new Response(new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
      return xml.replace(/<w:tab\/>/g, " ").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    }
    p += 46 + ln + le + lc;
  }
  throw new Error("No se encontró el texto dentro del .docx");
}

export async function leerTextoWord(file) {
  const buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
  const esZip = u8[0] === 0x50 && u8[1] === 0x4b;
  const t = esZip ? await textoDocx(buf) : textoDoc(u8);
  return t.replace(/HYPERLINK\s+"mailto:([^"]+)"/g, " $1 ").replace(/HYPERLINK\s+"[^"]*"/g, " ")
    .replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").replace(/[\r\n\t\v\f]+/g, " ").replace(/\s{2,}/g, " ").trim();
}

/* ---------- 2. Detectar los datos ---------- */
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const p2 = (n) => String(n).padStart(2, "0");
function fechaDe(s) {
  if (!s) return null;
  let m = sinTildes(s).match(/(\d{1,2})\s*(?:de|del)?\s+(?:mes\s+(?:de\s+)?)?([a-z]+)\s+(?:de|del)\s+(?:ano\s+)?(\d{4})/i);
  if (m && MESES[m[2].toLowerCase()]) return `${m[3]}-${p2(MESES[m[2].toLowerCase()])}-${p2(m[1])}`;
  m = s.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? `${m[3]}-${p2(m[2])}-${p2(m[1])}` : null;
}
const importe = (s) => { if (!s) return null; const n = +String(s).replace(/[^\d,]/g, "").replace(",", "."); return n > 0 ? n : null; };
const titulo = (s) => s.toLowerCase().replace(/(^|[\s'-])([a-záéíóúñü])/g, (a, b, c) => b + c.toUpperCase());
// "DANIEL ANIBAL GARCIA" -> "Garcia, Daniel Anibal" (el apellido es la última palabra; se puede corregir)
function apellidoNombre(n) {
  const w = n.trim().replace(/\s+/g, " ").split(" ");
  if (w.length < 2) return titulo(n.trim());
  return titulo(w[w.length - 1]) + ", " + titulo(w.slice(0, -1).join(" "));
}
const soloDigitos = (s) => String(s || "").replace(/\D/g, "");

function personas(txt) {
  const re = /(?:el|la|los|las)\s+(?:Sr(?:a|es|as)?\.?|Señor(?:a)?|Sres\.?)\s+([A-ZÁÉÍÓÚÑÜ][A-ZÁÉÍÓÚÑÜ .'-]{3,80}?)\s*,?\s*(?:titular\s+del\s+)?D\.?\s*N\.?\s*I\.?\s*(?:N\s*[º°o]?\.?|Nro\.?|número)?\s*:?\s*([\d.\s]{7,12})/g;
  const out = []; let m;
  while ((m = re.exec(txt))) {
    const resto = txt.slice(m.index, m.index + 700);
    const cuit = (resto.match(/CUI[TL](?:\/CUI[TL])?\s*(?:N\s*[º°o]?)?\s*:?\s*(\d{2}-?\d{7,8}-?\d)/i) || [])[1] || "";
    const email = (resto.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/) || [])[0] || "";
    const tel = (resto.match(/(?:tel[ée]fono|celular|cel\.?|whatsapp)\s*(?:N\s*[º°o]?)?\s*:?\s*([\d\s()-]{8,16})/i) || [])[1] || "";
    out.push({ pos: m.index, nombre: apellidoNombre(m[1]), dni: soloDigitos(m[2]), cuit, email, telefono: soloDigitos(tel) });
  }
  return out;
}

export function detectarDatos(txt) {
  const T = txt, U = sinTildes(txt).toUpperCase(), d = { notas: [] };
  // partes: el locador aparece primero; el locatario después de la palabra LOCATARI…
  const ps = personas(T);
  const iLoc = U.search(/LOCATARI/);
  const locador = ps.find((p) => p.pos < iLoc) || ps[0];
  const locatario = ps.find((p) => p.pos > iLoc && p !== locador) || ps.find((p) => p !== locador);
  if (locador) d.propietario = locador;
  if (locatario) d.inquilino = locatario;

  // inmueble
  let m = T.match(/ubicad[oa]\s+en\s+(?:la\s+)?(?:calle\s+|avenida\s+|av\.\s*)?(.{3,90}?),?\s+(?:de|en)\s+(?:la\s+(?:localidad|ciudad)\s+de\s+)?[A-ZÁÉÍÓÚ][a-záéíóú]+\s+(?:Pdo|Partido|Pcia|Provincia|\()/i)
    || T.match(/ubicad[oa]\s+en\s+(?:la\s+)?(?:calle\s+)?(.{3,80}?),/i);
  if (m) d.direccion = m[1].replace(/N\s*[º°]\s*/gi, "N ").replace(/["']/g, " ").replace(/\b(\d+)\s*(?:°|º)\s*piso/gi, "$1 Piso").replace(/\s{2,}/g, " ").trim();

  // plazo
  m = T.match(/a\s+partir\s+del?\s+d[ií]a\s+(.{6,40}?\d{4})/i) || T.match(/(?:comenzar[áa]|inicia(?:r[áa])?|desde)\s+el\s+d[ií]a\s+(.{6,40}?\d{4})/i);
  d.inicio = m ? fechaDe(m[1]) : null;
  m = T.match(/vencer[áa][^.]{0,40}?d[ií]a\s+(.{6,40}?\d{4})/i) || T.match(/(?:finalizar[áa]|hasta)\s+el\s+d[ií]a\s+(.{6,40}?\d{4})/i);
  d.fin = m ? fechaDe(m[1]) : null;

  // precio, actualización e índice (cláusula DEL PRECIO o parecida)
  const iPrecio = U.search(/DEL PRECIO|PRECIO DEL ALQUILER|DEL CANON|PRECIO:/);
  const precio = iPrecio >= 0 ? T.slice(iPrecio, iPrecio + 1800) : T;
  const Up = sinTildes(precio).toUpperCase();
  m = precio.match(/\(\s*\$\s*([\d.\s]+(?:,\d{1,2})?)/) || precio.match(/\$\s*([\d.]{5,}(?:,\d{1,2})?)/);
  d.monto_base = m ? importe(m[1]) : null;
  d.ajuste_meses = /CUATRIMESTRAL/.test(Up) ? 4 : /TRIMESTRAL/.test(Up) ? 3 : /SEMESTRAL/.test(Up) ? 6 : /BIMESTRAL/.test(Up) ? 2
    : /ANUAL/.test(Up) ? 12 : /MENSUALMENTE|MES A MES/.test(Up) ? 1 : (m = Up.match(/CADA\s+(\d{1,2})\s+MESES/)) ? +m[1] : null;
  d.indice = /\bICL\b|CONTRATOS DE LOCACION/.test(Up) ? "ICL" : /CASA PROPIA/.test(Up) ? "Casa Propia" : /\bIPC\b|PRECIOS AL CONSUMIDOR/.test(Up) ? "IPC"
    : /\bCAC\b|CAMARA ARGENTINA DE LA CONSTRUCCION/.test(Up) ? "CAC" : /\bUVA\b/.test(Up) ? "UVA" : /RIPTE/.test(Up) ? "RIPTE" : /\bCER\b/.test(Up) ? "CER" : null;
  if (!d.ajuste_meses && /SIN AJUSTE|PRECIO FIJO|MONTO FIJO/.test(Up)) { d.indice = "Fijo"; d.ajuste_meses = 36; }

  // vencimiento mensual y punitorio pactado
  m = T.match(/del\s*1\s*[º°o]?\s*al\s*(\d{1,2})\s*[º°o]?\s*d[ií]a/i);
  d.dia_vto = m ? +m[1] : null;
  m = T.match(/multa\s+diaria\s+del?\s+[^(%]{0,40}\(?\s*([\d.,]+)\s*%/i);
  if (m) d.notas.push(`Multa diaria pactada en el contrato: ${m[1]}%`);

  // depósito en garantía
  const iDep = U.search(/DEPOSITO EN GARANTIA|DEL DEPOSITO|GARANTIA EN EFECTIVO/);
  if (iDep >= 0) {
    const dep = T.slice(iDep, iDep + 700);
    if (/D[OÓ]LAR|U\$S|USD/i.test(dep.slice(0, 300)) && !/PESOS/i.test(dep.slice(0, 300))) d.notas.push("Depósito en dólares: revisalo");
    else { m = dep.match(/\(\s*\$\s*([\d.\s]+(?:,\d{1,2})?)/) || dep.match(/\$\s*([\d.]{4,}(?:,\d{1,2})?)/); d.deposito = m ? importe(m[1]) : null; }
  }

  d.renovacion = /CONTRATO\s+DE\s+RENOVACION/.test(U);
  m = U.match(/(?:EXPENSAS Y SERVICIOS|SERVICIOS E IMPUESTOS|IMPUESTOS Y SERVICIOS)[^:]*:(.{0,500})/);
  if (m) {
    const srv = [["LUZ", "Luz"], ["GAS", "Gas"], ["AGUA|AYSA", "Agua"], ["TASA|ABL|MUNICIPAL", "Tasa municipal"], ["EXPENSAS", "Expensas"], ["ARBA|INMOBILIARIO", "Impuesto inmobiliario"]]
      .filter(([r]) => new RegExp("\\b(" + r + ")").test(m[1])).map(([, l]) => l);
    if (srv.length) d.notas.push("A cargo del inquilino según contrato: " + srv.join(", "));
  }
  return d;
}

// Para comparar direcciones escritas distinto ("Defensa N°845 1 Piso Dto 6" ≈ "Defensa 845 1 Dto 6")
export function claveDireccion(s) {
  return sinTildes(String(s || "")).toLowerCase().replace(/\b(n|nro|numero|piso|dto|depto|dpto|departamento|uf|calle|av|avenida)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).join(" ");
}

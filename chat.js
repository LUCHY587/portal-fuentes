// Cobranza Fuentes · Chat interno del equipo (mensajes, imágenes, emojis y foto de perfil)
import { sb, esc, toast, mensajeError } from "./comun.js";

const EMOJIS = ["😀", "😂", "😊", "😍", "😉", "😎", "🤔", "😅", "😢", "😡", "🙏", "👍", "👎", "👏", "🙌", "💪", "👌", "✌️", "🤝", "👋",
  "❤️", "🔥", "✅", "❌", "⚠️", "❗", "❓", "💰", "💵", "🏠", "🔑", "📄", "📎", "📅", "⏰", "📞", "📧", "🎉", "☕", "🚗"];
const C = { yo: null, staff: [], msgs: [], abierto: false, urls: new Map(), adjunto: null, visto: 0, cargado: false };
const $c = (s) => document.querySelector(s);

/* ---------- utilidades ---------- */
const persona = (uid) => C.staff.find((s) => s.user_id === uid) || { nombre: "Usuario", user_id: uid };
const iniciales = (n) => String(n || "?").split(/[\s,]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("");
const colorDe = (uid) => { let h = 0; for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) % 360; return `hsl(${h} 45% 42%)`; };
const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
function diaTexto(iso) {
  const d = new Date(iso), hoy = new Date(), ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return "Hoy";
  if (d.toDateString() === ayer.toDateString()) return "Ayer";
  return d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
}
const textoHtml = (t) => esc(t).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, "<br>");

async function firmar(paths) {                                          // links temporales para ver imágenes privadas
  const faltan = [...new Set(paths.filter((p) => p && !C.urls.has(p)))];
  for (let i = 0; i < faltan.length; i += 100) {
    const { data } = await sb.storage.from("documentos").createSignedUrls(faltan.slice(i, i + 100), 60 * 60 * 6);
    for (const x of data || []) if (x.signedUrl) C.urls.set(x.path, x.signedUrl);
  }
}
function avatar(uid, tam = 34) {
  const p = persona(uid), url = p.avatar_path && C.urls.get(p.avatar_path);
  return url ? `<img class="av" src="${esc(url)}" alt="" width="${tam}" height="${tam}" style="width:${tam}px;height:${tam}px">`
    : `<span class="av" style="width:${tam}px;height:${tam}px;background:${colorDe(uid)};font-size:${Math.round(tam * 0.4)}px">${esc(iniciales(p.nombre))}</span>`;
}
// achica la imagen antes de subirla (y la recorta cuadrada para la foto de perfil)
function achicar(file, max, cuadrada) {
  return new Promise((res) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return res(file);
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      let { width: w, height: h } = img, sx = 0, sy = 0, sw = w, sh = h;
      if (cuadrada) { const m = Math.min(w, h); sx = (w - m) / 2; sy = (h - m) / 2; sw = sh = m; w = h = Math.min(m, max); }
      else if (Math.max(w, h) > max) { const k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, w, h); URL.revokeObjectURL(url);
      cv.toBlob((b) => res(b ? new File([b], "imagen.jpg", { type: "image/jpeg" }) : file), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(file); };
    img.src = url;
  });
}
async function subir(file, carpeta) {
  const ext = file.type === "image/jpeg" ? "jpg" : (file.type.split("/")[1] || "img").replace("jpeg", "jpg");
  const path = `chat/${carpeta}/${C.yo.user_id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const { error } = await sb.storage.from("documentos").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}

/* ---------- pantalla ---------- */
function armar() {
  const panel = document.createElement("aside");
  panel.id = "chat"; panel.className = "chat"; panel.hidden = true; panel.setAttribute("aria-label", "Chat del equipo");
  panel.innerHTML = `<div class="chat-h"><button class="chat-yo" id="chat-foto" title="Cambiar mi foto de perfil"></button>
      <div class="chat-tit"><b>Chat del equipo</b><span class="muted" id="chat-sub"></span></div>
      <button class="x" id="chat-cerrar" aria-label="Cerrar chat">×</button>
      <input type="file" id="chat-foto-in" accept="image/*" hidden></div>
    <div class="chat-msgs" id="chat-msgs" aria-live="polite"><div class="muted chat-vacio">Cargando…</div></div>
    <form class="chat-f" id="chat-form">
      <div class="chat-prev" id="chat-prev" hidden></div>
      <div class="chat-emojis" id="chat-emojis" hidden>${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join("")}</div>
      <div class="chat-fila">
        <button type="button" class="chat-ic" id="chat-emo" title="Emojis" aria-label="Emojis">😊</button>
        <label class="chat-ic" title="Adjuntar imagen" aria-label="Adjuntar imagen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg><input type="file" id="chat-img" accept="image/*" hidden></label>
        <textarea id="chat-txt" rows="1" placeholder="Escribí un mensaje…" aria-label="Mensaje"></textarea>
        <button type="submit" class="btn primary chat-env" id="chat-env" aria-label="Enviar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg></button>
      </div>
    </form>`;
  document.body.appendChild(panel);
  const fab = document.createElement("button");
  fab.id = "chat-fab"; fab.className = "chat-fab"; fab.setAttribute("aria-label", "Abrir chat del equipo");
  fab.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Chat</span><span class="n" id="chat-n" hidden></span>`;
  document.body.appendChild(fab);
  eventos();
}
function pintarCabecera() {
  $c("#chat-foto").innerHTML = avatar(C.yo.user_id, 38);
  $c("#chat-sub").textContent = C.staff.filter((s) => s.activo).map((s) => s.nombre.split(/[\s,]+/)[0]).join(", ");
}
function pintar(bajar = true) {
  const box = $c("#chat-msgs"); if (!box) return;
  if (!C.msgs.length) { box.innerHTML = `<div class="muted chat-vacio">Todavía no hay mensajes. ¡Escribí el primero!</div>`; return; }
  let html = "", dia = "", ant = null;
  for (const m of C.msgs) {
    const d = diaTexto(m.created_at); if (d !== dia) { html += `<div class="chat-dia"><span>${esc(d)}</span></div>`; dia = d; ant = null; }
    const seguido = ant && ant.user_id === m.user_id && new Date(m.created_at) - new Date(ant.created_at) < 5 * 60000;
    const mio = m.user_id === C.yo.user_id, url = m.imagen_path && C.urls.get(m.imagen_path);
    html += `<div class="chat-m ${mio ? "mio" : ""} ${seguido ? "seguido" : ""}" data-id="${m.id}">
      <div class="chat-av">${seguido ? "" : avatar(m.user_id)}</div>
      <div class="chat-cuerpo">${seguido ? "" : `<div class="chat-quien"><b>${esc(persona(m.user_id).nombre)}</b><span class="muted">${hora(m.created_at)}</span></div>`}
        ${m.imagen_path ? (url ? `<a href="${esc(url)}" target="_blank" rel="noopener" class="chat-img"><img src="${esc(url)}" alt="Imagen enviada por ${esc(persona(m.user_id).nombre)}" loading="lazy"></a>` : `<div class="muted">Imagen</div>`) : ""}
        ${m.texto ? `<div class="chat-t">${textoHtml(m.texto)}</div>` : ""}
        ${mio ? `<button class="chat-borrar" data-chatborrar="${m.id}" title="Eliminar mensaje" aria-label="Eliminar mensaje">×</button>` : ""}
      </div></div>`;
    ant = m;
  }
  const cerca = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  box.innerHTML = html;
  if (bajar || cerca) box.scrollTop = box.scrollHeight;
}
function contador() {
  const n = C.abierto ? 0 : C.msgs.filter((m) => m.id > C.visto && m.user_id !== C.yo.user_id).length;
  const el = $c("#chat-n"); if (!el) return; el.hidden = !n; el.textContent = n > 99 ? "99+" : n;
}
function marcarVisto() {
  if (!C.msgs.length) return; C.visto = C.msgs[C.msgs.length - 1].id;
  try { localStorage.setItem("chatVisto-" + C.yo.user_id, String(C.visto)); } catch {}
  contador();
}
function abrir(si) {
  C.abierto = si; $c("#chat").hidden = !si; document.body.classList.toggle("chat-abierto", si);
  $c("#chat-fab").setAttribute("aria-expanded", si);
  try { localStorage.setItem("chatAbierto", si ? "1" : ""); } catch {}
  if (si) { pintar(true); marcarVisto(); setTimeout(() => $c("#chat-txt")?.focus(), 50); } else contador();
}
function mostrarAdjunto() {
  const p = $c("#chat-prev");
  if (!C.adjunto) { p.hidden = true; p.innerHTML = ""; return; }
  p.hidden = false;
  p.innerHTML = `<img src="${URL.createObjectURL(C.adjunto)}" alt="Imagen a enviar"><span>${esc(C.adjunto.name || "Imagen")}</span><button type="button" class="x" id="chat-quitar" aria-label="Quitar imagen">×</button>`;
}
function insertarEnCursor(t) {
  const ta = $c("#chat-txt"), a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
  ta.value = ta.value.slice(0, a) + t + ta.value.slice(b); ta.focus(); ta.setSelectionRange(a + t.length, a + t.length); crecer();
}
function crecer() { const ta = $c("#chat-txt"); ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; }

/* ---------- datos ---------- */
async function cargarStaff() {
  const { data } = await sb.from("staff").select("user_id,nombre,activo,avatar_path");
  C.staff = data || [];
  await firmar(C.staff.map((s) => s.avatar_path));
}
async function cargarMensajes() {
  const { data, error } = await sb.from("chat_mensajes").select("*").order("id", { ascending: false }).limit(200);
  if (error) throw error;
  C.msgs = (data || []).reverse();
  await firmar(C.msgs.map((m) => m.imagen_path));
}
async function enviar() {
  const ta = $c("#chat-txt"), texto = ta.value.trim();
  if (!texto && !C.adjunto) return;
  const btn = $c("#chat-env"); btn.disabled = true;
  try {
    let imagen_path = null;
    if (C.adjunto) imagen_path = await subir(await achicar(C.adjunto, 1600, false), "img");
    const { data, error } = await sb.from("chat_mensajes").insert({ texto: texto || null, imagen_path }).select().single();
    if (error) throw error;
    ta.value = ""; crecer(); C.adjunto = null; mostrarAdjunto(); $c("#chat-emojis").hidden = true;
    await agregar(data);
  } catch (e) { toast("No se pudo enviar: " + mensajeError(e), "bad"); }
  finally { btn.disabled = false; ta.focus(); }
}
async function agregar(m) {
  if (C.msgs.some((x) => x.id === m.id)) return;
  if (m.imagen_path) await firmar([m.imagen_path]);
  if (!C.staff.some((s) => s.user_id === m.user_id)) await cargarStaff();
  C.msgs.push(m); C.msgs.sort((a, b) => a.id - b.id);
  pintar(m.user_id === C.yo.user_id);
  if (C.abierto) marcarVisto();
  else { contador(); if (m.user_id !== C.yo.user_id) toast(`💬 ${persona(m.user_id).nombre.split(/[\s,]+/)[0]}: ${m.texto ? m.texto.slice(0, 80) : "envió una imagen"}`); }
}
async function cambiarFoto(file) {
  try {
    const path = await subir(await achicar(file, 320, true), "avatars");
    const { error } = await sb.rpc("set_mi_avatar", { p_path: path }); if (error) throw error;
    await cargarStaff(); pintarCabecera(); pintar(false); toast("Foto de perfil actualizada");
  } catch (e) { toast("No se pudo cambiar la foto: " + mensajeError(e), "bad"); }
}

/* ---------- eventos ---------- */
function eventos() {
  $c("#chat-fab").addEventListener("click", () => abrir(!C.abierto));
  $c("#chat-cerrar").addEventListener("click", () => abrir(false));
  $c("#chat-foto").addEventListener("click", () => $c("#chat-foto-in").click());
  $c("#chat-foto-in").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) cambiarFoto(f); });
  $c("#chat-img").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) { C.adjunto = f; mostrarAdjunto(); } });
  $c("#chat-emo").addEventListener("click", () => { const p = $c("#chat-emojis"); p.hidden = !p.hidden; });
  const form = $c("#chat-form");
  form.addEventListener("submit", (e) => { e.preventDefault(); e.stopPropagation(); enviar(); });
  form.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.emoji) { insertarEnCursor(b.dataset.emoji); return; }
    if (b.id === "chat-quitar") { C.adjunto = null; mostrarAdjunto(); }
  });
  const ta = $c("#chat-txt");
  ta.addEventListener("input", (e) => { e.stopPropagation(); crecer(); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); enviar(); } });
  ta.addEventListener("paste", (e) => {                               // pegar una captura con Ctrl+V
    const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/"));
    if (f) { e.preventDefault(); C.adjunto = f; mostrarAdjunto(); }
  });
  $c("#chat-msgs").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-chatborrar]"); if (!b) return;
    if (b.dataset.ok !== "1") { b.dataset.ok = "1"; b.textContent = "¿Eliminar?"; b.classList.add("confirmar"); setTimeout(() => { if (b.isConnected) { b.dataset.ok = ""; b.textContent = "×"; b.classList.remove("confirmar"); } }, 3000); return; }
    const id = +b.dataset.chatborrar, { error } = await sb.from("chat_mensajes").delete().eq("id", id);
    if (error) { toast(mensajeError(error), "bad"); return; }
    C.msgs = C.msgs.filter((m) => m.id !== id); pintar(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && C.abierto && !document.querySelector("#modal")?.innerHTML) abrir(false); });
}

/* ---------- inicio ---------- */
export async function iniciarChat(yo) {
  if (C.cargado) return; C.cargado = true; C.yo = yo;
  try { C.visto = +localStorage.getItem("chatVisto-" + yo.user_id) || 0; } catch {}
  armar();
  try { await Promise.all([cargarStaff(), cargarMensajes()]); }
  catch (e) { $c("#chat-msgs").innerHTML = `<div class="muted chat-vacio">El chat todavía no está activado (${esc(mensajeError(e))}).</div>`; return; }
  pintarCabecera(); pintar(true); contador();
  let abierto = false; try { abierto = localStorage.getItem("chatAbierto") === "1"; } catch {}
  if (abierto && innerWidth > 1100) abrir(true);
  sb.channel("chat").on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_mensajes" }, (p) => agregar(p.new))
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_mensajes" }, (p) => { C.msgs = C.msgs.filter((m) => m.id !== p.old.id); pintar(false); contador(); })
    .subscribe();
  // por si se corta la conexión en vivo: revisar cada minuto
  setInterval(async () => { const ult = C.msgs.length ? C.msgs[C.msgs.length - 1].id : 0;
    const { data } = await sb.from("chat_mensajes").select("*").gt("id", ult).order("id"); for (const m of data || []) await agregar(m); }, 60000);
}

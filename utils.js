export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));
}

export function money(value = 0) {
  return new Intl.NumberFormat("es-AR", {style:"currency", currency:"ARS", minimumFractionDigits:0, maximumFractionDigits:0}).format(Math.round(Number(value) || 0));
}

export function dateTime(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat("es-AR", {dateStyle:"short", timeStyle:"short"}).format(date) : "—";
}

export function dateOnly(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat("es-AR", {dateStyle:"short"}).format(date) : "—";
}

export function timeOnly(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat("es-AR", {hour:"2-digit", minute:"2-digit"}).format(date) : "—";
}

export function localDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone:"America/Argentina/Buenos_Aires", year:"numeric", month:"2-digit", day:"2-digit"}).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function toast(message, type = "") {
  const region = $("#toast-region");
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  region.append(node);
  setTimeout(() => node.remove(), 3600);
}

export function setBusy(button, busy, label = "Guardando…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

export function openModal({title, content, wide = false, onClose} = {}) {
  const root = $("#modal-root");
  root.innerHTML = `<div class="modal-backdrop" role="presentation"><section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-head"><h2 id="modal-title">${escapeHtml(title)}</h2><button type="button" class="icon-btn modal-close" aria-label="Cerrar">×</button></header><div class="modal-body">${content || ""}</div></section></div>`;
  document.body.style.overflow = "hidden";
  const escape = event => { if (event.key === "Escape") close(); };
  const close = () => {
    root.innerHTML = "";
    document.body.style.overflow = "";
    document.removeEventListener("keydown", escape);
    onClose?.();
  };
  $(".modal-close", root).addEventListener("click", close);
  $(".modal-backdrop", root).addEventListener("click", event => { if (event.target.classList.contains("modal-backdrop")) close(); });
  document.addEventListener("keydown", escape);
  setTimeout(() => $("input:not([type=hidden]),select,button", $(".modal", root))?.focus(), 0);
  return {root, close};
}

export function confirmDialog(message, title = "Confirmar") {
  return new Promise(resolve => {
    let settled = false;
    const finish = answer => { if (!settled) { settled = true; resolve(answer); } };
    const modal = openModal({title, content:`<p>${escapeHtml(message)}</p><div class="modal-actions"><button class="btn btn-ghost" data-answer="no">Cancelar</button><button class="btn btn-danger" data-answer="yes">Confirmar</button></div>`, onClose:() => finish(false)});
    $$('[data-answer]', modal.root).forEach(button => button.addEventListener("click", () => {
      const answer = button.dataset.answer === "yes";
      finish(answer);
      modal.close();
    }));
  });
}

export function updateConnectionStatus(status = navigator.onLine ? "online" : "offline") {
  const labels = {online:"Online", offline:"Sin conexión", syncing:"Sincronizando…"};
  $$('[data-connection-status]').forEach(node => {
    node.textContent = labels[status] || labels.online;
    node.classList.toggle("offline", status === "offline");
    node.classList.toggle("syncing", status === "syncing");
  });
}

export function downloadCsv(filename, rows) {
  if (!rows.length) return toast("No hay datos para exportar", "error");
  const headers = [...new Set(rows.flatMap(Object.keys))];
  const cell = value => `"${String(value ?? "").replaceAll('"','""')}"`;
  const csv = "\uFEFF" + [headers.map(cell).join(","), ...rows.map(row => headers.map(key => cell(row[key])).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function imageOrPlaceholder(url, abbreviation = "FM") {
  if (url) return escapeHtml(url);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="20" fill="#e7efe9"/><text x="60" y="70" text-anchor="middle" font-family="Arial" font-size="30" font-weight="700" fill="#315b43">${escapeHtml(abbreviation.slice(0,4))}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function formDataObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isEditable = target => target?.matches?.("input:not(.key-capture), textarea, select, [contenteditable=true]");

export const SELLER_ACTION_SHORTCUTS = [
  {id:"paymentCredit", label:"Pago credito", paymentMethod:"credit"},
  {id:"paymentDebit", label:"Pago debito", paymentMethod:"debit"},
  {id:"paymentAlias", label:"Pago alias", paymentMethod:"alias"},
  {id:"paymentCash", label:"Pago eft", paymentMethod:"cash"},
  {id:"generateTicket", label:"Genera ticket", action:"ticket"}
];

export function keyIdentity(item = {}) {
  return {
    key:item.key ?? item.buttonKey ?? item.discountKey ?? "",
    code:item.code ?? item.buttonCode ?? item.discountCode ?? "",
    location:Number(item.location ?? item.buttonLocation ?? item.discountLocation ?? 0),
    label:item.keyLabel ?? item.buttonLabel ?? item.discountKeyLabel ?? ""
  };
}

export function keyMatchesEvent(item, event) {
  const identity = keyIdentity(item);
  if (!identity.key && !identity.code) return false;
  const sameLocation = Number(identity.location || 0) === Number(event.location || 0);
  return sameLocation && ((identity.code && identity.code === event.code) || (identity.key && identity.key === event.key));
}

export function sameShortcut(a, b) {
  const first = keyIdentity(a), second = keyIdentity(b);
  if ((!first.key && !first.code) || (!second.key && !second.code)) return false;
  if (Number(first.location || 0) !== Number(second.location || 0)) return false;
  return Boolean((first.code && second.code && first.code === second.code) || (first.key && second.key && first.key === second.key));
}

export function readableKey({key, code, location}) {
  const place = location === 3 ? "teclado numérico" : location === 1 ? "izquierda" : location === 2 ? "derecha" : "";
  return [code || key, key && key !== code ? `/ ${key}` : "", place ? `(${place})` : ""].filter(Boolean).join(" ");
}

export function recordNextKey({onRecorded, onCancel}) {
  const handler = event => {
    event.preventDefault(); event.stopPropagation();
    window.removeEventListener("keydown", handler, true);
    if (event.key === "Escape") { onCancel?.(); return; }
    onRecorded({buttonKey:event.key, buttonCode:event.code, buttonLocation:event.location, buttonLabel:readableKey(event)});
  };
  window.addEventListener("keydown", handler, true);
  return () => { window.removeEventListener("keydown", handler, true); onCancel?.(); };
}

export class SellerKeyboard {
  constructor({capture, getProducts, getDiscounts, getActionShortcuts, onProduct, onDiscount, onShortcut, onContinue, onBackspace, onAdd, onSubtract, onFocusChange}) {
    Object.assign(this, {capture, getProducts, getDiscounts, getActionShortcuts, onProduct, onDiscount, onShortcut, onContinue, onBackspace, onAdd, onSubtract, onFocusChange});
    this.enabled = false;
    this.handleKey = this.handleKey.bind(this);
    this.handleBlur = this.handleBlur.bind(this);
    this.handlePointer = this.handlePointer.bind(this);
    this.capture?.addEventListener("keydown", this.handleKey);
    this.capture?.addEventListener("blur", this.handleBlur);
    document.addEventListener("pointerup", this.handlePointer);
  }
  activate() {
    this.enabled = true;
    this.capture?.focus({preventScroll:true});
    this.onFocusChange?.(true);
  }
  pause() { this.enabled = false; this.capture?.blur(); this.onFocusChange?.(false); }
  handleBlur() {
    if (!this.enabled) return;
    this.onFocusChange?.(false);
    this.refocusWhenAvailable();
  }
  refocusWhenAvailable() {
    setTimeout(() => {
      if (!this.enabled) return;
      if (document.querySelector(".modal-backdrop") || isEditable(document.activeElement)) return this.refocusWhenAvailable();
      this.activate();
    }, 120);
  }
  handlePointer(event) {
    if (this.enabled && !isEditable(event.target) && !document.querySelector(".modal-backdrop")) this.refocus();
  }
  handleKey(event) {
    if (!this.enabled || isEditable(event.target) && event.target !== this.capture || document.querySelector(".modal-backdrop")) return;
    const action = event.code === "NumpadEnter" || event.key === "Enter" ? this.onContinue
      : event.key === "Backspace" ? this.onBackspace
      : event.code === "NumpadAdd" || event.key === "+" ? this.onAdd
      : event.code === "NumpadSubtract" || event.key === "-" ? this.onSubtract : null;
    if (action) { event.preventDefault(); action(); return this.refocus(); }
    const shortcut = this.getActionShortcuts?.().find(item => keyMatchesEvent(item, event));
    if (shortcut) { event.preventDefault(); this.onShortcut?.(shortcut); return this.refocus(); }
    const discount = this.getDiscounts?.().find(item => keyMatchesEvent(item, event));
    if (discount) { event.preventDefault(); this.onDiscount?.(discount); return this.refocus(); }
    const product = this.getProducts().find(item => keyMatchesEvent(item, event));
    if (product) { event.preventDefault(); this.onProduct(product.id); return this.refocus(); }
  }
  refocus() { setTimeout(() => this.enabled && this.capture?.focus({preventScroll:true}), 0); }
  destroy() { this.enabled=false;this.capture?.removeEventListener("keydown", this.handleKey); this.capture?.removeEventListener("blur", this.handleBlur); document.removeEventListener("pointerup", this.handlePointer); }
}

export class AdminKeyboardNavigation {
  constructor(root) {
    this.root = root;
    this.handleKey = this.handleKey.bind(this);
    this.root.addEventListener("keydown", this.handleKey);
  }
  targets() {
    return [...this.root.querySelectorAll(".side-nav button:not(:disabled), #admin-content .card, #admin-content tbody tr, #admin-content .stock-alert, #admin-content .rank-list li, #admin-content details, #admin-content summary, #admin-content button:not(:disabled), #admin-content .sale-card")]
      .filter(node => node.offsetParent !== null && !node.closest(".modal-backdrop"));
  }
  refresh() {
    this.targets().forEach(node => {
      node.classList.add("admin-key-target");
      if (!["BUTTON","A","INPUT","SELECT","TEXTAREA","SUMMARY"].includes(node.tagName)) node.tabIndex = 0;
    });
  }
  handleKey(event) {
    if (isEditable(event.target) || document.querySelector(".modal-backdrop")) return;
    if (!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(event.key)) return;
    const targets = this.targets();
    if (!targets.length) return;
    const current = targets.findIndex(node => node === document.activeElement || node.contains(document.activeElement));
    if (event.key === " ") {
      if (current >= 0) {
        event.preventDefault();
        const target = targets[current];
        const clickable = target.matches("button,summary") ? target : target.querySelector("button:not(:disabled),summary");
        (clickable || target).click();
      }
      return;
    }
    event.preventDefault();
    const direction = ["ArrowDown","ArrowRight"].includes(event.key) ? 1 : -1;
    const next = current < 0 ? 0 : (current + direction + targets.length) % targets.length;
    targets[next].focus({preventScroll:false});
  }
  destroy() { this.root?.removeEventListener("keydown", this.handleKey); }
}

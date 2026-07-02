const isEditable = target => target?.matches?.("input:not(.key-capture), textarea, select, [contenteditable=true]");

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
  constructor({capture, getProducts, onProduct, onContinue, onBackspace, onAdd, onSubtract, onFocusChange}) {
    Object.assign(this, {capture, getProducts, onProduct, onContinue, onBackspace, onAdd, onSubtract, onFocusChange});
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
    const byCode = this.getProducts().find(product => product.buttonCode && product.buttonCode === event.code);
    const product = byCode || this.getProducts().find(item => item.buttonKey && item.buttonKey === event.key);
    if (product) { event.preventDefault(); this.onProduct(product.id); return this.refocus(); }
  }
  refocus() { setTimeout(() => this.enabled && this.capture?.focus({preventScroll:true}), 0); }
  destroy() { this.enabled=false;this.capture?.removeEventListener("keydown", this.handleKey); this.capture?.removeEventListener("blur", this.handleBlur); document.removeEventListener("pointerup", this.handlePointer); }
}

import {listAllowedLocations, listActiveDiscounts, listVisibleProductCategories, subscribeLocationStock, createSale, updateSaleTransaction, deleteSaleTransaction, listSellerDailyLocationSales, getKeyboardShortcuts} from "./firebase-service.js";
import {$, $$, escapeHtml, money, dateTime, timeOnly, toast, openModal, confirmDialog, setBusy, imageOrPlaceholder, startOfToday, updateConnectionStatus, panelSwitcherHtml, setupPanelSwitcher} from "./utils.js";
import {SellerKeyboard, SELLER_ACTION_SHORTCUTS} from "./keyboard.js";
import {calculateDiscountSummary, saleDiscountList, storedDiscountTotal} from "./discounts.js";
import {savePendingSale, getPendingSales, markPendingSaleSynced, markPendingSaleError, deletePendingSale} from "./offline-sales.js";
import {PAYMENT_OPTIONS, SINGLE_PAYMENT_METHODS, normalizePayment, salePaymentParts, paymentAllocationSummary, completeRemainingPayment} from "./payments.js";
import {isLocationActiveNow} from "./locations.js";
import {groupByCategory} from "./categories.js";

let state = null;
const PAYMENT_METHODS = PAYMENT_OPTIONS;

export function destroySeller() {
  if (state?.onlineHandler) window.removeEventListener("online", state.onlineHandler);
  if (state?.offlineHandler) window.removeEventListener("offline", state.offlineHandler);
  state?.unsubStock?.(); state?.keyboard?.destroy();
  state = null;
}

export async function renderSeller(root, profile, onLogout, panelOptions = {}) {
  if (state?.profile?.id === profile.id) return;
  destroySeller();
  state = {root, profile, onLogout, panelOptions, locations:[], discounts:[], productCategories:[], shortcuts:{sellerActions:{}}, appliedDiscounts:[], stock:[], sales:[], pendingSales:[], payments:[], stockWarningsAccepted:new Set(), stockWarningOpen:false, locationId:"", cart:new Map(), lastProductId:null, paymentMethod:null, editSale:null, view:"new", unsubStock:null, keyboard:null, keyboardActive:true, saving:false, syncingPending:false, onlineHandler:null, offlineHandler:null};
  root.innerHTML = `<div class="center-screen"><div><div class="brand-mark">FM</div><p>Cargando punto de venta…</p></div></div>`;
  try {
    const [allLocations, allDiscounts, productCategories, shortcuts] = await Promise.all([listAllowedLocations(profile.allowedLocationIds || []), listActiveDiscounts(), listVisibleProductCategories(), getKeyboardShortcuts()]);
    state.locations = allLocations.filter(location => isLocationActiveNow(location));
    state.discounts = allDiscounts;
    state.productCategories = productCategories;
    state.shortcuts = shortcuts || {sellerActions:{}};
    if (!state.locations.length) throw new Error("No tenés ubicaciones asignadas para vender. Asignate una ubicación desde el panel administrador.");
    state.locationId = localStorage.getItem(`flor-mia-location-${profile.id}`);
    if (!state.locations.some(location => location.id === state.locationId)) state.locationId = state.locations[0].id;
    renderShell(); setupConnectionListeners(); subscribeStock();
    await Promise.all([refreshSales(), refreshPendingSales()]);
    if (navigator.onLine) syncPendingSales();
  } catch (error) {
    if (panelOptions.canAccessAdmin) {
      renderShell(false);
      $("#seller-content",root).innerHTML = `<section class="card seller-blocked"><h2>No se puede abrir el punto de venta</h2><p>${escapeHtml(error.message)}</p><button class="btn btn-primary" id="seller-back-admin">Ver Panel Administrador</button></section>`;
      $("#seller-back-admin",root).onclick=()=>panelOptions.onPanelChange?.("admin");
    } else {
      root.innerHTML = `<div class="center-screen"><div class="card"><h2>No se puede abrir el punto de venta</h2><p>${escapeHtml(error.message)}</p><button class="btn btn-ghost" id="seller-fail-logout">Cerrar sesión</button></div></div>`;
      $("#seller-fail-logout",root).onclick=onLogout;
    }
  }
}

function location() { return state.locations.find(item => item.id === state.locationId); }

function renderShell(renderInitial = true) {
  state.root.innerHTML = `<div class="seller-shell"><header class="app-header seller-header"><button id="open-drawer" class="icon-btn" aria-label="Abrir menú">☰</button><div class="seller-title"><strong>Flor Mia</strong><small id="seller-location-name"></small><small class="connection ${navigator.onLine ? "" : "offline"}" data-connection-status>${navigator.onLine ? "Online" : "Sin conexión"}</small></div><button id="pending-sales-chip" class="pending-sales-chip" type="button">Pendientes: <b data-pending-count>0</b></button><div class="header-spacer"></div>${panelSwitcherHtml(state.profile,state.panelOptions,"seller")}</header><div id="drawer-root"></div><main id="seller-content" class="seller-main"></main></div>`;
  $("#open-drawer",state.root).onclick=openDrawer;
  $("#pending-sales-chip",state.root).onclick=async()=>{state.view="pending";await refreshPendingSales();renderView();};
  setupPanelSwitcher(state.root,state.panelOptions,"seller");
  updateLocationTitle(); updateConnectionStatus(); updatePendingUi(); if(renderInitial)renderView();
}

function updateLocationTitle() { const node=$("#seller-location-name",state.root); if(node)node.textContent=location()?.name||""; }

function setupConnectionListeners() {
  state.onlineHandler = async () => {
    if (!state) return;
    updateConnectionStatus("online");
    if (state.view === "new") renderNewSale();
    await syncPendingSales();
  };
  state.offlineHandler = () => {
    if (!state) return;
    updateConnectionStatus("offline");
    if (state.view === "new") renderNewSale();
    if (state.view === "pending") renderPendingSales();
  };
  window.addEventListener("online", state.onlineHandler);
  window.addEventListener("offline", state.offlineHandler);
}

function openDrawer() {
  const root=$("#drawer-root",state.root);root.innerHTML=`<div class="drawer-backdrop"></div><aside class="drawer"><button class="icon-btn" id="close-drawer" aria-label="Cerrar">×</button><div class="brand">Flor Mia</div><button data-drawer="new">＋ Nueva venta</button><button data-drawer="sales">▤ Mis ventas de hoy</button><button data-drawer="pending">↻ Ventas pendientes (${state.pendingSales.length})</button><button data-drawer="stock">▦ Stock disponible</button><button data-drawer="priceList">＄ Lista de Precio</button><button data-drawer="location">⌖ Cambiar ubicación</button><button data-drawer="help">? Ayuda rápida</button><button data-drawer="connection">● ${navigator.onLine?"Online":"Sin conexión"}</button><button data-drawer="logout">↪ Cerrar sesión</button></aside>`;
  const close=()=>root.innerHTML="";$("#close-drawer",root).onclick=close;$(".drawer-backdrop",root).onclick=close;
  $$('[data-drawer]',root).forEach(button=>button.onclick=async()=>{const action=button.dataset.drawer;close();if(action==="new"){state.view="new";renderView();}if(action==="sales"){state.view="sales";await refreshSales();renderView();}if(action==="pending"){state.view="pending";await refreshPendingSales();renderView();}if(action==="stock"){state.view="stock";renderView();}if(action==="priceList"){state.view="priceList";renderView();}if(action==="location")chooseLocation();if(action==="help")sellerHelp();if(action==="connection")toast(navigator.onLine?"Tenés conexión a internet":"No hay conexión a internet",navigator.onLine?"success":"error");if(action==="logout")state.onLogout();});
}

function sellerHelp(){openModal({title:"Cómo vender",onClose:resumeKeyboard,content:`<ol class="help-steps"><li>Elegí la ubicación correcta.</li><li>Tocá productos o usá la botonera, que ya queda activa.</li><li>Revisá cantidades y descuento.</li><li>Presioná Continuar para registrar.</li></ol><p class="muted">Sin internet, la venta queda pendiente en este dispositivo. Al volver la conexión se sincroniza; también podés hacerlo desde Ventas pendientes.</p>`});}

function chooseLocation() {
  const modal=openModal({title:"Elegir ubicación",onClose:resumeKeyboard,content:`<div class="sale-list">${state.locations.map(item=>`<button class="sale-card" data-location="${item.id}"><strong>${escapeHtml(item.name)}</strong>${item.id===state.locationId?`<span class="badge ok">Actual</span>`:""}</button>`).join("")}</div>`});
  $$('[data-location]',modal.root).forEach(button=>button.onclick=()=>{if(state.cart.size&&!confirm("El carrito actual se vaciará al cambiar de ubicación. ¿Continuar?"))return;state.locationId=button.dataset.location;localStorage.setItem(`flor-mia-location-${state.profile.id}`,state.locationId);state.cart.clear();state.appliedDiscounts=[];state.paymentMethod=null;state.payments=[];state.stockWarningsAccepted.clear();state.editSale=null;state.view="new";updateLocationTitle();subscribeStock();modal.close();renderView();});
}

function subscribeStock() {
  state.unsubStock?.(); state.stock=[];
  state.unsubStock=subscribeLocationStock(state.locationId,items=>{state.stock=items.filter(item=>item.active&&item.deleted!==true);reconcileCart();if(["new","stock","priceList"].includes(state.view))renderView();},error=>toast(`No se pudo actualizar el stock: ${error.message}`,"error"));
}

function reconcileCart(){for(const [id,item] of state.cart){const stock=state.stock.find(s=>s.id===id);if(stock){const originalQty=state.editSale?.items?.find(old=>old.productId===id)?.qty||0;item.stock=Number(stock.currentStock)+Number(originalQty);item.thumbUrl=stock.thumbUrl||item.thumbUrl;}}}

function renderView() {
  if(state.view==="new")return renderNewSale();
  state.keyboard?.destroy();state.keyboard=null;
  if(state.view==="stock")return renderStockAvailable();
  if(state.view==="priceList")return renderPriceList();
  state.view==="pending"?renderPendingSales():renderSales();
}

function renderNewSale() {
  const content=$("#seller-content",state.root);if(!content)return;
  const productGroups=groupByCategory(state.stock,state.productCategories,{getCategoryId:item=>item.categoryId,getCategoryName:item=>item.categoryName});
  const productsHtml=productGroups.length?productGroups.map(group=>`<section class="seller-product-category"><h3>${escapeHtml(group.name)}</h3><div class="product-carousel" aria-label="${escapeHtml(group.name)}">${group.items.map(product=>`<button class="product-tile" data-product="${product.id}"><span class="key-badge">${escapeHtml(product.buttonKey||"")}</span><img loading="lazy" src="${imageOrPlaceholder(product.thumbUrl,product.abbreviation)}" alt=""><strong>${escapeHtml(product.abbreviation)}</strong><small>${escapeHtml(product.productName||"")}</small><small>Stock ${product.currentStock}</small></button>`).join("")}</div></section>`).join(""):`<div class="empty">No hay productos disponibles</div>`;
  content.innerHTML=`${!navigator.onLine?`<div class="seller-notice offline">Sin conexión. Las ventas nuevas se guardarán en este dispositivo y quedarán pendientes de sincronizar.</div>`:""}${state.editSale?`<div class="seller-notice">Editando ${escapeHtml(state.editSale.saleCode)} <button id="cancel-edit" class="btn btn-ghost btn-small">Cancelar edición</button></div>`:""}<input id="key-capture" class="key-capture" aria-hidden="true" inputmode="none" autocomplete="off">
  <section class="product-categories" aria-label="Productos">${productsHtml}</section>
  <section class="card cart-card"><header class="cart-head"><h2>Venta actual</h2><div class="cart-head-actions"><div class="key-status compact"><small id="key-hint">${state.keyboardActive?"Botonera activa":"Botonera desactivada"}</small><button id="activate-keyboard" class="btn ${state.keyboardActive?"btn-secondary":"btn-primary"} btn-small">${state.keyboardActive?"Desactivar":"Activar"}</button></div><button type="button" id="clear-cart" class="btn btn-ghost btn-small" ${state.cart.size?"":"disabled"}>Vaciar carrito</button></div></header><div id="cart-lines"></div><div class="totals"><button type="button" id="choose-discount" class="btn btn-secondary btn-small">Agregar descuento</button><div id="applied-discounts" class="applied-discounts"></div><div class="total-line"><span>Subtotal</span><strong id="sale-subtotal"></strong></div><div class="total-line discount-line"><span>Total descuentos</span><strong id="sale-discount"></strong></div><div class="total-line"><span>Productos</span><strong id="sale-items"></strong></div><div class="total-line grand"><span>Total final</span><strong id="sale-total"></strong></div><div class="payment-section"><strong>Forma de pago *</strong><div class="payment-grid">${PAYMENT_METHODS.map(method=>`<button type="button" class="payment-option ${state.paymentMethod?.value===method.value?"selected":""}" data-payment="${method.value}" aria-pressed="${state.paymentMethod?.value===method.value}">${method.label}</button>`).join("")}</div>${state.paymentMethod?.value==="multiple"?`<p class="multiple-payment-selected">${state.payments.map(payment=>`${escapeHtml(payment.label)}: ${money(payment.amount)}`).join(" · ")}</p>`:""}</div></div></section>
  <footer class="seller-actions"><button id="ticket-button" class="btn btn-secondary">Tiquet</button><button id="continue-sale" class="btn btn-primary">${state.editSale?"Guardar cambios":"Continuar"}</button></footer>`;
  renderCartLines();
  $$('[data-product]',content).forEach(button=>button.onclick=()=>addProduct(button.dataset.product,true));
  $("#clear-cart",content).onclick=async()=>{if(await confirmDialog("¿Querés vaciar el carrito?")){state.cart.clear();state.appliedDiscounts=[];state.paymentMethod=null;state.payments=[];state.stockWarningsAccepted.clear();state.lastProductId=null;renderNewSale();}};
  $$('[data-payment]',content).forEach(button=>button.onclick=async()=>{const method=PAYMENT_METHODS.find(item=>item.value===button.dataset.payment);if(method?.value==="multiple")return multiplePaymentModal();state.paymentMethod=method||null;state.payments=[];renderNewSale();});
  $("#choose-discount",content).onclick=discountModal;
  $("#ticket-button",state.root).onclick=ticketAction;
  $("#continue-sale",state.root).onclick=saveSale;$("#cancel-edit",content)?.addEventListener("click",cancelEdit);
  setupKeyboard();
}

function multiplePaymentModal(){
  const total=discountSummary().total;
  const previous=new Map(state.payments.map(payment=>[payment.method,payment.amount]));
  const modal=openModal({title:"+2 pagos",onClose:resumeKeyboard,content:`<form id="multiple-payment-form"><div class="multiple-payment-total"><span>Total de la venta</span><strong>${money(total)}</strong></div><div class="multiple-payment-rows">${SINGLE_PAYMENT_METHODS.map(method=>{const option=PAYMENT_METHODS.find(item=>item.value===method);return `<label class="multiple-payment-row"><span>${escapeHtml(option.label)}</span><div><input name="${method}" type="number" min="0" step="1" inputmode="numeric" value="${previous.get(method)||""}" placeholder="0"><button type="button" class="btn btn-ghost btn-small" data-complete-payment="${method}">Completar restante</button></div></label>`;}).join("")}</div><div class="multiple-payment-status"><div><span>Total cargado</span><strong id="payments-loaded">${money(0)}</strong></div><p id="payments-difference"></p></div><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button id="confirm-multiple-payment" class="btn btn-primary">Confirmar</button></div></form>`});
  const form=$("#multiple-payment-form",modal.root),confirm=$("#confirm-multiple-payment",modal.root);
  const values=()=>SINGLE_PAYMENT_METHODS.map(method=>{const input=$(`input[name="${method}"]`,form);const raw=input.value.trim();const amount=raw===""?0:Number(raw);return {method,label:PAYMENT_METHODS.find(item=>item.value===method).label,amount,raw};});
  const update=()=>{
    const entries=values(),summary=paymentAllocationSummary(entries,total);
    $("#payments-loaded",form).textContent=summary.invalid?"Monto inválido":money(summary.loaded);
    const differenceNode=$("#payments-difference",form);differenceNode.className=summary.difference===0&&!summary.invalid&&summary.positiveCount>=2?"ok":"error";
    differenceNode.textContent=summary.invalid?"Ingresá montos enteros mayores o iguales a cero.":summary.difference>0?`Falta cargar ${money(summary.difference)}`:summary.difference<0?`Te pasaste por ${money(Math.abs(summary.difference))}`:summary.positiveCount<2?"Usá al menos 2 formas de pago.":"La suma coincide con el total.";
    confirm.disabled=summary.invalid||summary.difference!==0||summary.positiveCount<2;
    $$('[data-complete-payment]',form).forEach(button=>button.disabled=summary.invalid||summary.difference<=0);
    return entries;
  };
  $$('input[type="number"]',form).forEach(input=>input.addEventListener("input",update));
  $$('[data-complete-payment]',form).forEach(button=>button.onclick=()=>{const completed=completeRemainingPayment(values(),button.dataset.completePayment,total);const entry=completed.find(item=>item.method===button.dataset.completePayment);if(!entry)return;const input=$(`input[name="${button.dataset.completePayment}"]`,form);input.value=String(entry.amount);update();});
  $(".modal-cancel",form).onclick=modal.close;
  form.onsubmit=event=>{event.preventDefault();try{const payment=normalizePayment("multiple","+2 pagos",update(),total);state.paymentMethod=PAYMENT_METHODS.find(method=>method.value==="multiple");state.payments=payment.payments;modal.close();renderNewSale();}catch(error){toast(error.message,"error");}};
  update();
}

function renderCartLines() {
  const root=$("#cart-lines",state.root);if(!root)return;
  const items=[...state.cart.values()];root.innerHTML=items.length?items.map(item=>`<div class="cart-row"><img src="${imageOrPlaceholder(item.thumbUrl,item.abbreviation)}" alt=""><div class="cart-product"><strong>${escapeHtml(item.abbreviation||item.name)}</strong><small>${money(item.price)} c/u · disp. ${item.stock}</small></div><div class="qty-control"><button type="button" data-minus="${item.id}" aria-label="Restar">−</button><span>${item.qty}</span><button type="button" data-plus="${item.id}" aria-label="Sumar">+</button></div><div class="line-total">${money(item.qty*item.price)}</div></div>`).join(""):`<div class="cart-empty">Tocá un producto o usá la botonera para comenzar</div>`;
  const clearButton=$("#clear-cart",state.root);if(clearButton)clearButton.disabled=!items.length;
  $$('[data-minus]',root).forEach(button=>button.onclick=()=>changeQty(button.dataset.minus,-1));$$('[data-plus]',root).forEach(button=>button.onclick=()=>changeQty(button.dataset.plus,1));updateTotals();
}

function subtotal(){return [...state.cart.values()].reduce((sum,item)=>sum+item.qty*item.price,0);}
function saleLimit(product){return Number(product.currentStock||0)+Number(state.editSale?.items?.find(item=>item.productId===product.id)?.qty||0);}
function discountSummary(){return calculateDiscountSummary(state.appliedDiscounts,subtotal());}
function updateTotals(){
  const sub=subtotal(),summary=discountSummary(),qty=[...state.cart.values()].reduce((sum,item)=>sum+item.qty,0);
  if(state.paymentMethod?.value==="multiple"&&state.payments.reduce((sum,payment)=>sum+Number(payment.amount||0),0)!==summary.total){state.paymentMethod=null;state.payments=[];toast("El total cambió. Volvé a cargar +2 pagos.","error");}
  const list=$("#applied-discounts",state.root);
  if(list){list.innerHTML=summary.discounts.map((discount,index)=>`<div class="applied-discount"><span>${escapeHtml(discount.name)}</span><strong>− ${money(discount.amountApplied)}</strong><button type="button" class="btn btn-ghost btn-small" data-remove-discount="${index}" aria-label="Quitar ${escapeHtml(discount.name)}">Quitar</button></div>`).join("");$$('[data-remove-discount]',list).forEach(button=>button.onclick=()=>{state.appliedDiscounts.splice(Number(button.dataset.removeDiscount),1);renderNewSale();});}
  $("#sale-subtotal",state.root).textContent=money(sub);$("#sale-discount",state.root).textContent=summary.discountTotal?`− ${money(summary.discountTotal)}`:"—";$("#sale-items",state.root).textContent=qty;$("#sale-total",state.root).textContent=money(summary.total);
}

function confirmStockWarning(product) {
  if(state.stockWarningsAccepted.has(product.id))return Promise.resolve(true);
  if(state.stockWarningOpen)return Promise.resolve(false);
  state.stockWarningOpen=true;state.keyboard?.pause();
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;state.stockWarningOpen=false;resolve(value);};
    const modal=openModal({title:"Stock cargado agotado",onClose:()=>{finish(false);resumeKeyboard();},content:`<p><strong>${escapeHtml(product.productName||product.name)}</strong></p><p>El stock cargado no alcanza. Si todavía hay producto físico, podés seguir vendiendo. El administrador ajustará el stock.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancel-stock-warning">Cancelar</button><button type="button" class="btn btn-warning" id="continue-stock-warning">Continuar</button></div>`});
    $("#cancel-stock-warning",modal.root).onclick=()=>{finish(false);modal.close();};
    $("#continue-stock-warning",modal.root).onclick=()=>{state.stockWarningsAccepted.add(product.id);finish(true);modal.close();};
  });
}

async function ensureCartStockWarnings(){for(const item of state.cart.values()){const product=state.stock.find(stock=>stock.id===item.productId);if(product&&Number(item.qty)>saleLimit(product)&&!await confirmStockWarning(product))return false;}return true;}

async function addProduct(id, feedback=false) {
  const product=state.stock.find(item=>item.id===id);if(!product)return;
  const existing=state.cart.get(id);const qty=(existing?.qty||0)+1;
  const available=saleLimit(product);
  if(qty>available&&!await confirmStockWarning(product))return;
  if(existing){existing.qty=qty;existing.stock=available;existing.thumbUrl=product.thumbUrl||existing.thumbUrl;}
  else{
    const original=state.editSale?.items?.find(item=>item.productId===id);
    const price=Number(original?.unitPrice??product.price);
    state.cart.set(id,{id,productId:id,name:original?.name||product.productName,abbreviation:original?.abbreviation||product.abbreviation,price,unitPrice:price,qty,stock:available,thumbUrl:product.thumbUrl});
  }
  state.lastProductId=id;
  renderCartLines();if(feedback){const tile=$(`[data-product="${id}"]`,state.root);tile?.classList.add("pulse");setTimeout(()=>tile?.classList.remove("pulse"),160);navigator.vibrate?.(30);}
}

async function changeQty(id,delta){const item=state.cart.get(id);if(!item)return;const next=item.qty+delta;if(delta>0&&next>item.stock){const product=state.stock.find(stock=>stock.id===id)||item;if(!await confirmStockWarning(product))return;}if(next<=0)state.cart.delete(id);else item.qty=next;if(!state.cart.size)state.appliedDiscounts=[];state.lastProductId=id;renderCartLines();}
function removeLast(){if(state.lastProductId)changeQty(state.lastProductId,-1);}

function updateKeyboardStateUi(){const hint=$("#key-hint",state.root);const button=$("#activate-keyboard",state.root);if(hint)hint.textContent=state.keyboardActive?"Botonera activa":"Botonera desactivada";if(button){button.textContent=state.keyboardActive?"Desactivar":"Activar";button.className=`btn btn-small ${state.keyboardActive?"btn-secondary":"btn-primary"}`;}}

function sellerActionShortcuts(){
  const saved=state.shortcuts?.sellerActions||{};
  return SELLER_ACTION_SHORTCUTS.map(action=>({...action,...(saved[action.id]||{})})).filter(action=>action.key||action.code);
}

function selectPayment(value, feedback=false){
  const method=PAYMENT_METHODS.find(item=>item.value===value);
  if(!method)return;
  state.paymentMethod=method;
  state.payments=[];
  renderNewSale();
  if(feedback)toast(`${method.label} seleccionado`,"success");
}

function ticketAction(){toast("El botón Tiquet quedó preparado para la futura integración fiscal.");}

function runSellerShortcut(shortcut){
  if(shortcut.paymentMethod)return selectPayment(shortcut.paymentMethod,true);
  if(shortcut.action==="ticket")return ticketAction();
}

function applyDiscount(discount, feedback=false){
  if(subtotal()<=0)return toast("Agregá productos antes del descuento","error");
  const value=Number(discount.value);
  const entry={id:discount.id,discountId:discount.id,name:discount.name,type:discount.type,value,source:"preset"};
  try{
    calculateDiscountSummary([...state.appliedDiscounts,entry],subtotal());
    state.appliedDiscounts.push(entry);
    renderNewSale();
    if(feedback)toast(`Descuento aplicado: ${discount.name}`,"success");
  }catch(error){toast(error.message,"error");}
}

function setupKeyboard(){
  state.keyboard?.destroy();
  const capture=$("#key-capture",state.root);
  state.keyboard=new SellerKeyboard({capture,getProducts:()=>state.stock,getDiscounts:()=>state.discounts,getActionShortcuts:sellerActionShortcuts,onProduct:id=>addProduct(id,true),onDiscount:discount=>applyDiscount(discount,true),onShortcut:runSellerShortcut,onContinue:saveSale,onBackspace:removeLast,onAdd:()=>state.lastProductId&&changeQty(state.lastProductId,1),onSubtract:removeLast,onFocusChange:updateKeyboardStateUi});
  $("#activate-keyboard",state.root).onclick=()=>{state.keyboardActive=!state.keyboardActive;state.keyboardActive?state.keyboard.activate():state.keyboard.pause();updateKeyboardStateUi();};
  state.keyboardActive?state.keyboard.activate():state.keyboard.pause();
}

function resumeKeyboard(){if(state?.view==="new"&&state.keyboardActive)setTimeout(()=>state?.keyboard?.activate(),0);}

function discountModal(){const modal=openModal({title:"Agregar descuento",content:`<form id="discount-form"><label>Descuentos guardados<select id="saved-discount"><option value="">Manual</option>${state.discounts.map(item=>`<option value="${item.id}">${escapeHtml(item.name)} · ${item.type==="percent"?`${item.value}%`:money(item.value)}</option>`).join("")}</select></label><label>Tipo<select name="type" id="discount-type"><option value="fixed">Monto fijo</option><option value="percent">Porcentaje</option></select></label><label>Valor entero<input name="value" id="discount-value" type="number" min="0" step="1" inputmode="numeric" required></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Agregar</button></div></form>`});$(".modal-cancel",modal.root).onclick=modal.close;$("#saved-discount",modal.root).onchange=event=>{const saved=state.discounts.find(d=>d.id===event.target.value);if(saved){$("#discount-type",modal.root).value=saved.type;$("#discount-value",modal.root).value=saved.value;}};$("#discount-form",modal.root).onsubmit=event=>{event.preventDefault();if(subtotal()<=0)return toast("Agregá productos antes del descuento","error");const saved=state.discounts.find(d=>d.id===$("#saved-discount",modal.root).value);const type=$("#discount-type",modal.root).value,value=Number($("#discount-value",modal.root).value);const entry={id:saved?.id||"manual",discountId:saved?.id||"manual",name:saved?.name||"Descuento manual",type,value,source:saved?"preset":"manual"};try{calculateDiscountSummary([entry],subtotal());state.appliedDiscounts.push(entry);modal.close();renderNewSale();}catch(error){toast(error.message,"error");}};}

function clearCurrentSale() {
  state.cart.clear();
  state.appliedDiscounts=[];
  state.paymentMethod=null;
  state.payments=[];
  state.stockWarningsAccepted.clear();
  state.lastProductId=null;
  state.editSale=null;
}

function newOfflineId() {
  const random = crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `local_${random.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

async function queueOfflineSale(payload, currentLocation) {
  const summary = calculateDiscountSummary(payload.discounts, subtotal());
  const localId = newOfflineId();
  const pending = await savePendingSale({
    localId,
    localCode:`PEND-${Date.now().toString().slice(-8)}`,
    status:"pending",
    createdLocallyAt:new Date().toISOString(),
    lastSyncAttemptAt:null,
    syncError:"",
    retryCount:0,
    locationId:currentLocation.id,
    locationName:currentLocation.name,
    locationPrefix:currentLocation.codePrefix || "LOC",
    sellerId:state.profile.id,
    sellerName:state.profile.name,
    items:payload.items.map(item => ({productId:item.productId || item.id, name:item.name, abbreviation:item.abbreviation || "", unitPrice:Number(item.unitPrice ?? item.price), qty:Number(item.qty)})),
    discounts:payload.discounts,
    total:summary.total,
    paymentMethod:payload.paymentMethod,
    paymentMethodLabel:payload.paymentMethodLabel,
    payments:payload.payments
  });
  clearCurrentSale();
  await refreshPendingSales();
  state.view="new";
  renderNewSale();
  toast("Venta guardada sin conexión. Se sincronizará cuando vuelva internet.","success");
  return pending;
}

async function saveSale() {
  if(state.saving)return;
  if(!state.cart.size)return toast("La venta está vacía","error");
  if(!state.paymentMethod)return toast("Elegí una forma de pago antes de registrar la venta.","error");
  const currentLocation=location();
  if(!currentLocation?.id||!isLocationActiveNow(currentLocation))return toast("La ubicación seleccionada no está activa","error");
  if(!state.profile?.id)return toast("La sesión del vendedor no es válida","error");
  if(!navigator.onLine&&state.editSale)return toast("Necesitás conexión para editar una venta ya registrada.","error");
  if(!await ensureCartStockWarnings())return;
  const payload={seller:state.profile,items:[...state.cart.values()],discounts:state.appliedDiscounts,paymentMethod:state.paymentMethod.value,paymentMethodLabel:state.paymentMethod.label,payments:state.payments};
  state.saving=true;
  updateConnectionStatus(navigator.onLine?"syncing":"offline");
  const button=$("#continue-sale",state.root);
  setBusy(button,true,state.editSale?"Guardando…":navigator.onLine?"Registrando…":"Guardando pendiente…");
  try {
    if(!navigator.onLine){await queueOfflineSale(payload,currentLocation);return;}
    const result=state.editSale?await updateSaleTransaction({...payload,saleId:state.editSale.id}):await createSale({...payload,location:currentLocation});
    clearCurrentSale();
    await refreshSales();
    showReceipt(result);
  } catch(error) {
    const message=error.code==="permission-denied"||error.message?.includes("permission")?"Firebase rechazó la venta. Revisá que el vendedor esté activo y asignado a esta ubicación.":error.message;
    toast(message,"error");
    setBusy(button,false);
  } finally {
    state.saving=false;
    updateConnectionStatus();
  }
}

function paymentDetailsHtml(sale){const parts=salePaymentParts(sale);return parts.length>1?`<div class="payment-breakdown">${parts.map(part=>`<div><span>${escapeHtml(part.label)}</span><strong>${money(part.amount)}</strong></div>`).join("")}</div>`:"";}

function showReceipt(result){const modal=openModal({title:"Venta registrada",content:`<div class="receipt"><div class="brand-mark">FM</div><p class="muted">${escapeHtml(location()?.name||"")}</p><strong>${escapeHtml(result.saleCode)}</strong><div class="receipt-total">${money(result.total)}</div><p>${escapeHtml(result.paymentMethodLabel||"Sin forma de pago")} · ${timeOnly(result.createdAt)}</p>${paymentDetailsHtml(result)}<button class="btn btn-primary btn-block" id="receipt-close">Nueva venta</button></div>`,onClose:()=>{state.view="new";renderView();}});$("#receipt-close",modal.root).onclick=()=>{modal.close();state.view="new";renderView();};}

async function refreshPendingSales() {
  try {
    const allSales = await getPendingSales();
    if (!state) return;
    state.pendingSales = allSales.filter(sale => sale.sellerId === state.profile.id && sale.status !== "synced");
    updatePendingUi();
  } catch (error) {
    if (state) toast(`No se pudieron leer las ventas pendientes: ${error.message}`,"error");
  }
}

function updatePendingUi() {
  if (!state) return;
  $$('[data-pending-count]',state.root).forEach(node => node.textContent=String(state.pendingSales.length));
  const chip=$("#pending-sales-chip",state.root);
  if(chip){chip.classList.toggle("has-pending",state.pendingSales.length>0);chip.disabled=state.syncingPending;}
  $$('[data-sync-pending]',state.root).forEach(button=>{button.disabled=state.syncingPending||!navigator.onLine||!state.pendingSales.length;});
}

function pendingStatus(sale) {
  return sale.status === "sync_error"
    ? {label:"Error al sincronizar",className:"danger"}
    : {label:"Pendiente de sincronizar",className:"warning"};
}

function renderPendingSales() {
  const content=$("#seller-content",state.root);if(!content)return;
  const cards=state.pendingSales.map(sale=>{const status=pendingStatus(sale);return `<article class="card pending-sale-card"><div class="row"><strong>${escapeHtml(sale.localCode||sale.localId)}</strong><span class="badge ${status.className}">${status.label}</span></div><div class="row"><span>${dateTime(sale.createdLocallyAt)}</span><strong>${money(sale.total)}</strong></div><small>${escapeHtml(sale.locationName)} · ${sale.totalItems} productos · ${escapeHtml(sale.paymentMethodLabel)}</small>${sale.syncError?`<p class="pending-error">${escapeHtml(sale.syncError)}</p>`:""}</article>`;}).join("");
  content.innerHTML=`<div class="page-head"><div><h1>Ventas pendientes</h1><p class="muted">Guardadas sólo en este dispositivo hasta que se sincronicen.</p></div><button id="pending-back-new" class="btn btn-primary">Nueva venta</button></div><section class="card pending-summary"><div><span>Ventas pendientes</span><strong data-pending-count>${state.pendingSales.length}</strong></div><button class="btn btn-secondary" data-sync-pending>${state.syncingPending?"Sincronizando…":"Sincronizar pendientes"}</button></section>${!navigator.onLine?`<div class="seller-notice offline">Sin conexión. Podés revisar las ventas; la sincronización se habilitará cuando vuelva internet.</div>`:""}<div class="sale-list">${cards||`<div class="empty">No hay ventas pendientes</div>`}</div>`;
  $("#pending-back-new",content).onclick=()=>{state.view="new";renderView();};
  $("[data-sync-pending]",content)?.addEventListener("click",()=>syncPendingSales({manual:true}));
  updatePendingUi();
}

async function syncPendingSales({manual=false}={}) {
  if(!state||state.syncingPending)return;
  if(!navigator.onLine){if(manual)toast("No hay conexión para sincronizar.","error");return;}
  await refreshPendingSales();
  if(!state)return;
  const session=state;
  const queue=[...session.pendingSales];
  if(!queue.length){if(manual)toast("No hay ventas pendientes.","success");return;}
  session.syncingPending=true;updateConnectionStatus("syncing");updatePendingUi();
  if(session.view==="pending")renderPendingSales();
  let synced=0,failed=0;
  try{
    for(const sale of queue){
      if(state!==session||!navigator.onLine)break;
      try{
        const result=await createSale({
          location:{id:sale.locationId,name:sale.locationName,codePrefix:sale.locationPrefix},
          seller:session.profile,
          items:sale.items,
          discounts:sale.discounts,
          paymentMethod:sale.paymentMethod,
          paymentMethodLabel:sale.paymentMethodLabel,
          payments:sale.payments,
          offlineSale:{localId:sale.localId,createdLocallyAt:sale.createdLocallyAt}
        });
        await markPendingSaleSynced(sale.localId,result.id);
        await deletePendingSale(sale.localId);
        synced++;
      }catch(error){
        const message=String(error.message||"No se pudo sincronizar.");
        try{await markPendingSaleError(sale.localId,message);}catch(_){/* Se reintentará porque la venta local no se eliminó. */}
        failed++;
      }
    }
  }finally{
    if(state!==session)return;
    session.syncingPending=false;
    await refreshPendingSales();
    if(synced)await refreshSales();
    updateConnectionStatus();
    if(session.view==="pending")renderPendingSales();
    if(synced)toast(`${synced} venta${synced===1?"":"s"} sincronizada${synced===1?"":"s"}.`,"success");
    if(failed)toast("No se pudo sincronizar una venta. Revisá el error; el stock no fue modificado.","error");
  }
}

async function refreshSales(){try{state.sales=await listSellerDailyLocationSales(state.profile.id,state.locationId,startOfToday());}catch(error){toast(`No se pudieron cargar las ventas: ${error.message}`,"error");}}

function renderSales(){
  const content=$("#seller-content",state.root);const sales=state.sales;const active=sales.filter(sale=>sale.status==="active");const total=active.reduce((sum,sale)=>sum+Number(sale.total||0),0);const items=active.reduce((sum,sale)=>sum+Number(sale.totalItems||0),0);
  content.innerHTML=`<div class="page-head"><div><h1>Mis ventas de hoy</h1><p class="muted">${escapeHtml(location()?.name||"")}</p></div><button id="back-new" class="btn btn-primary">Nueva venta</button></div><section class="card seller-sales-summary"><span>Monto vendido hoy</span><strong>${money(total)}</strong><small>${active.length} ventas activas · ${items} productos vendidos</small></section><div class="sale-list">${sales.map(sale=>`<button class="sale-card" data-sale="${sale.id}"><div class="row"><strong>${escapeHtml(sale.saleCode)}</strong><span class="badge ${sale.status==="active"?"ok":"danger"}">${sale.status==="active"?"Activa":"Anulada"}</span></div><div class="row"><span>${dateTime(sale.createdAt)}</span><strong>${money(sale.total)}</strong></div><small>${sale.totalItems} productos · ${escapeHtml(sale.paymentMethodLabel||"Sin forma de pago")}</small></button>`).join("")||`<div class="empty">No hay ventas hoy en esta ubicación</div>`}</div>`;
  $("#back-new",content).onclick=()=>{state.view="new";renderView();};$$('[data-sale]',content).forEach(button=>button.onclick=()=>saleDetail(state.sales.find(s=>s.id===button.dataset.sale)));
}

function renderStockAvailable(){
  const content=$("#seller-content",state.root);if(!content)return;
  const status=item=>Number(item.currentStock)<=Number(item.redAlertQty)?{className:"danger",label:"Alerta roja"}:Number(item.currentStock)<=Number(item.yellowAlertQty)?{className:"warning",label:"Alerta amarilla"}:{className:"ok",label:"Stock normal"};
  content.innerHTML=`<div class="page-head"><div><h1>Stock disponible</h1><p class="muted">${escapeHtml(location()?.name||"")}</p></div><button id="stock-back-new" class="btn btn-primary">Nueva venta</button></div><div class="stock-view-grid">${state.stock.map(item=>{const alert=status(item);return `<article class="card stock-view-card"><img loading="lazy" src="${imageOrPlaceholder(item.thumbUrl,item.abbreviation)}" alt=""><div><strong>${escapeHtml(item.productName)}</strong><small>${escapeHtml(item.abbreviation)} · ${money(item.price)}</small><span class="badge ${alert.className}">${alert.label}</span></div><b>${Number(item.currentStock)} u.</b></article>`;}).join("")||`<div class="empty">No hay productos habilitados en esta ubicación</div>`}</div>`;
  $("#stock-back-new",content).onclick=()=>{state.view="new";renderView();};
}

function renderPriceList(){
  const content=$("#seller-content",state.root);if(!content)return;
  const available=state.stock.filter(item=>item.active!==false&&item.deleted!==true&&item.productDeleted!==true&&Number(item.currentStock)>0);
  const productGroups=groupByCategory(available,state.productCategories,{getCategoryId:item=>item.categoryId,getCategoryName:item=>item.categoryName});
  const sections=productGroups.map(group=>`<section class="price-category"><h2>${escapeHtml(group.name)}</h2><div class="price-items">${group.items.sort((a,b)=>(a.productName||"").localeCompare(b.productName||"")).map(item=>`<article class="price-item"><div><strong>${escapeHtml(item.abbreviation||item.productName)}</strong><small>${escapeHtml(item.productName)}</small></div><div class="price-value"><strong>${money(item.price)}</strong><small>${Number(item.currentStock)} u.</small></div></article>`).join("")}</div></section>`).join("");
  content.innerHTML=`<div class="page-head"><div><h1>Lista de Precio</h1><p class="muted">${escapeHtml(location()?.name||"")}</p></div><button id="price-back-new" class="btn btn-primary">Nueva venta</button></div>${sections||`<div class="empty">No hay productos con stock disponible en esta ubicación</div>`}`;
  $("#price-back-new",content).onclick=()=>{state.view="new";renderView();};
}

function saleDetail(sale){const discounts=saleDiscountList(sale),discountTotal=storedDiscountTotal(sale),subtotal=Number(sale.totalBeforeDiscounts??sale.subtotal??sale.total);const modal=openModal({title:sale.saleCode,content:`<p>${dateTime(sale.createdAt)}<br>${escapeHtml(sale.locationName)} · ${escapeHtml(sale.paymentMethodLabel||"Sin forma de pago")}</p>${paymentDetailsHtml(sale)}${sale.items.map(item=>`<div class="total-line"><span>${item.qty} × ${escapeHtml(item.name)}</span><strong>${money(item.subtotal)}</strong></div>`).join("")}<div class="total-line"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>${discounts.map(discount=>`<div class="total-line discount-line"><span>${escapeHtml(discount.name||"Descuento")}</span><strong>− ${money(discount.amountApplied||0)}</strong></div>`).join("")}${discounts.length?`<div class="total-line discount-line"><span>Total descuentos</span><strong>− ${money(discountTotal)}</strong></div>`:""}<div class="total-line grand"><span>Total</span><strong>${money(sale.total)}</strong></div>${sale.status==="active"?`<div class="modal-actions"><button id="delete-sale" class="btn btn-danger">Anular</button><button id="edit-sale" class="btn btn-secondary">Editar</button></div>`:'<p class="badge danger">Venta anulada</p>'}`});$("#edit-sale",modal.root)?.addEventListener("click",()=>{modal.close();startEdit(sale);});$("#delete-sale",modal.root)?.addEventListener("click",async()=>{if(!await confirmDialog("¿Querés anular esta venta? Se devolverán las unidades al stock."))return;try{await deleteSaleTransaction({saleId:sale.id,user:state.profile});modal.close();await refreshSales();renderSales();toast("Venta anulada y stock devuelto","success");}catch(error){toast(error.message,"error");}});}

function startEdit(sale){const saleLocation=state.locations.find(item=>item.id===sale.locationId);if(!saleLocation)return toast("La ubicación de esta venta ya no está disponible","error");state.locationId=sale.locationId;localStorage.setItem(`flor-mia-location-${state.profile.id}`,state.locationId);state.editSale=sale;state.cart.clear();sale.items.forEach(item=>state.cart.set(item.productId,{id:item.productId,productId:item.productId,name:item.name,abbreviation:item.abbreviation,price:Number(item.unitPrice),unitPrice:Number(item.unitPrice),qty:Number(item.qty),stock:Number(item.qty),thumbUrl:""}));state.appliedDiscounts=saleDiscountList(sale).map(discount=>({id:discount.discountId||discount.id||"manual",discountId:discount.discountId||discount.id||"manual",name:discount.name,type:discount.type,value:Number(discount.value),source:discount.source||((discount.discountId||discount.id)==="manual"?"manual":"preset")}));state.paymentMethod=PAYMENT_METHODS.find(method=>method.value===sale.paymentMethod)||null;state.payments=sale.paymentMethod==="multiple"?salePaymentParts(sale):[];state.stockWarningsAccepted.clear();state.view="new";updateLocationTitle();subscribeStock();renderView();}
function cancelEdit(){state.editSale=null;state.cart.clear();state.appliedDiscounts=[];state.paymentMethod=null;state.payments=[];state.stockWarningsAccepted.clear();state.lastProductId=null;renderNewSale();}

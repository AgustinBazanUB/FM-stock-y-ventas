import {listAllowedLocations, listActiveDiscounts, subscribeLocationStock, createSale, updateSaleTransaction, deleteSaleTransaction, listSellerSales} from "./firebase-service.js";
import {$, $$, escapeHtml, money, dateTime, timeOnly, toast, openModal, confirmDialog, setBusy, imageOrPlaceholder, clamp, startOfToday, updateConnectionStatus} from "./utils.js";
import {SellerKeyboard} from "./keyboard.js";

let state = null;

export function destroySeller() {
  state?.unsubStock?.(); state?.keyboard?.destroy();
  state = null;
}

export async function renderSeller(root, profile, onLogout) {
  if (state?.profile?.id === profile.id) return;
  destroySeller();
  state = {root, profile, onLogout, locations:[], discounts:[], stock:[], sales:[], locationId:"", cart:new Map(), lastProductId:null, discount:null, editSale:null, view:"new", unsubStock:null, keyboard:null, keyboardActive:true, saving:false, salesFilter:"today", salesLimit:100};
  root.innerHTML = `<div class="center-screen"><div><div class="brand-mark">FM</div><p>Cargando punto de venta…</p></div></div>`;
  try {
    const [allLocations, allDiscounts] = await Promise.all([listAllowedLocations(profile.allowedLocationIds || []), listActiveDiscounts()]);
    state.locations = allLocations.filter(location => location.active);
    state.discounts = allDiscounts;
    if (!state.locations.length) throw new Error("No tenés ubicaciones activas asignadas");
    state.locationId = localStorage.getItem(`flor-mia-location-${profile.id}`);
    if (!state.locations.some(location => location.id === state.locationId)) state.locationId = state.locations[0].id;
    renderShell(); subscribeStock(); await refreshSales();
  } catch (error) {
    root.innerHTML = `<div class="center-screen"><div class="card"><h2>No se puede abrir el punto de venta</h2><p>${escapeHtml(error.message)}</p><button class="btn btn-ghost" id="seller-fail-logout">Cerrar sesión</button></div></div>`;
    $("#seller-fail-logout",root).onclick=onLogout;
  }
}

function location() { return state.locations.find(item => item.id === state.locationId); }

function renderShell() {
  state.root.innerHTML = `<div class="seller-shell"><header class="app-header seller-header"><button id="open-drawer" class="icon-btn" aria-label="Abrir menú">☰</button><div class="seller-title"><strong>Flor Mia</strong><small id="seller-location-name"></small><small class="connection ${navigator.onLine ? "" : "offline"}" data-connection-status>${navigator.onLine ? "Online" : "Sin conexión"}</small></div></header><div id="drawer-root"></div><main id="seller-content" class="seller-main"></main></div>`;
  $("#open-drawer",state.root).onclick=openDrawer;
  updateLocationTitle(); updateConnectionStatus(); renderView();
}

function updateLocationTitle() { const node=$("#seller-location-name",state.root); if(node)node.textContent=location()?.name||""; }

function openDrawer() {
  const root=$("#drawer-root",state.root);root.innerHTML=`<div class="drawer-backdrop"></div><aside class="drawer"><button class="icon-btn" id="close-drawer" aria-label="Cerrar">×</button><div class="brand">Flor Mia</div><button data-drawer="new">＋ Nueva venta</button><button data-drawer="sales">▤ Ventas totales</button><button data-drawer="location">⌖ Cambiar ubicación</button><button data-drawer="help">? Ayuda rápida</button><button data-drawer="connection">● ${navigator.onLine?"Online":"Sin conexión"}</button><button data-drawer="logout">↪ Cerrar sesión</button></aside>`;
  const close=()=>root.innerHTML="";$("#close-drawer",root).onclick=close;$(".drawer-backdrop",root).onclick=close;
  $$('[data-drawer]',root).forEach(button=>button.onclick=async()=>{const action=button.dataset.drawer;close();if(action==="new"){state.view="new";renderView();}if(action==="sales"){state.view="sales";await refreshSales();renderView();}if(action==="location")chooseLocation();if(action==="help")sellerHelp();if(action==="connection")toast(navigator.onLine?"Tenés conexión a internet":"No hay conexión a internet",navigator.onLine?"success":"error");if(action==="logout")state.onLogout();});
}

function sellerHelp(){openModal({title:"Cómo vender",onClose:resumeKeyboard,content:`<ol class="help-steps"><li>Elegí la ubicación correcta.</li><li>Tocá productos o usá la botonera, que ya queda activa.</li><li>Revisá cantidades y descuento.</li><li>Presioná Continuar para registrar.</li></ol><p class="muted">Desde Ventas totales podés editar o anular una venta propia. La app ajusta el stock automáticamente.</p>`});}

function chooseLocation() {
  const modal=openModal({title:"Elegir ubicación",onClose:resumeKeyboard,content:`<div class="sale-list">${state.locations.map(item=>`<button class="sale-card" data-location="${item.id}"><strong>${escapeHtml(item.name)}</strong>${item.id===state.locationId?`<span class="badge ok">Actual</span>`:""}</button>`).join("")}</div>`});
  $$('[data-location]',modal.root).forEach(button=>button.onclick=()=>{if(state.cart.size&&!confirm("El carrito actual se vaciará al cambiar de ubicación. ¿Continuar?"))return;state.locationId=button.dataset.location;localStorage.setItem(`flor-mia-location-${state.profile.id}`,state.locationId);state.cart.clear();state.discount=null;state.editSale=null;state.view="new";updateLocationTitle();subscribeStock();modal.close();renderView();});
}

function subscribeStock() {
  state.unsubStock?.(); state.stock=[];
  state.unsubStock=subscribeLocationStock(state.locationId,items=>{state.stock=items.filter(item=>item.active&&item.deleted!==true);reconcileCart();if(state.view==="new")renderView();},error=>toast(`No se pudo actualizar el stock: ${error.message}`,"error"));
}

function reconcileCart(){for(const [id,item] of state.cart){const stock=state.stock.find(s=>s.id===id);if(stock){const originalQty=state.editSale?.items?.find(old=>old.productId===id)?.qty||0;item.stock=Number(stock.currentStock)+Number(originalQty);item.thumbUrl=stock.thumbUrl||item.thumbUrl;}}}

function renderView() { if(state.view==="sales"){state.keyboard?.destroy();state.keyboard=null;renderSales();}else renderNewSale(); }

function renderNewSale() {
  const content=$("#seller-content",state.root);if(!content)return;
  content.innerHTML=`${!navigator.onLine?`<div class="seller-notice offline">Sin conexión. Podés armar la venta, pero necesitás internet para registrarla y descontar stock.</div>`:""}${state.editSale?`<div class="seller-notice">Editando ${escapeHtml(state.editSale.saleCode)} <button id="cancel-edit" class="btn btn-ghost btn-small">Cancelar edición</button></div>`:""}<input id="key-capture" class="key-capture" aria-hidden="true" inputmode="none" autocomplete="off"><div class="key-status"><button id="activate-keyboard" class="btn ${state.keyboardActive?"btn-primary":"btn-secondary"}">${state.keyboardActive?"Botonera activa":"Activar botonera"}</button><small id="key-hint">${state.keyboardActive?"Lista para recibir teclas":"Tocá para usar la botonera Bluetooth"}</small></div>
  <section class="product-grid" aria-label="Productos">${state.stock.map(product=>`<button class="product-tile" data-product="${product.id}" ${saleLimit(product)<=0?"disabled":""}><span class="key-badge">${escapeHtml(product.buttonKey||"")}</span><img loading="lazy" src="${imageOrPlaceholder(product.thumbUrl,product.abbreviation)}" alt=""><strong>${escapeHtml(product.abbreviation)}</strong><small>Stock ${product.currentStock}</small></button>`).join("")||`<div class="empty">No hay productos disponibles</div>`}</section>
  <section class="card cart-card"><header class="cart-head"><h2>Venta actual</h2><button id="clear-cart" class="btn btn-ghost btn-small" ${state.cart.size?"":"disabled"}>Vaciar carrito</button></header><div id="cart-lines"></div><div class="totals"><button id="choose-discount" class="btn btn-secondary btn-small">${state.discount?"Cambiar descuento":"Aplicar descuento"}</button>${state.discount?` <button id="remove-discount" class="btn btn-ghost btn-small">Quitar</button>`:""}<div class="total-line"><span>Subtotal</span><strong id="sale-subtotal"></strong></div><div class="total-line discount-line"><span>${escapeHtml(state.discount?.name||"Descuento")}</span><strong id="sale-discount"></strong></div><div class="total-line"><span>Productos</span><strong id="sale-items"></strong></div><div class="total-line grand"><span>Total</span><strong id="sale-total"></strong></div></div></section></main>
  <footer class="seller-actions"><button id="ticket-button" class="btn btn-secondary">Tiquet</button><button id="continue-sale" class="btn btn-primary">${state.editSale?"Guardar cambios":"Continuar"}</button></footer>`;
  renderCartLines();
  $$('[data-product]',content).forEach(button=>button.onclick=()=>addProduct(button.dataset.product,true));
  $("#clear-cart",content).onclick=async()=>{if(await confirmDialog("¿Vaciar todos los productos de la venta?")){state.cart.clear();state.discount=null;state.lastProductId=null;renderNewSale();}};
  $("#choose-discount",content).onclick=discountModal;$("#remove-discount",content)?.addEventListener("click",()=>{state.discount=null;renderNewSale();});
  $("#ticket-button",state.root).onclick=()=>toast("El botón Tiquet quedó preparado para la futura integración fiscal.");
  $("#continue-sale",state.root).onclick=saveSale;$("#cancel-edit",content)?.addEventListener("click",cancelEdit);
  setupKeyboard();
}

function renderCartLines() {
  const root=$("#cart-lines",state.root);if(!root)return;
  const items=[...state.cart.values()];root.innerHTML=items.length?items.map(item=>`<div class="cart-row"><img src="${imageOrPlaceholder(item.thumbUrl,item.abbreviation)}" alt=""><div class="cart-product"><strong>${escapeHtml(item.abbreviation||item.name)}</strong><small>${money(item.price)} c/u · disp. ${item.stock}</small></div><div class="qty-control"><button data-minus="${item.id}" aria-label="Restar">−</button><span>${item.qty}</span><button data-plus="${item.id}" aria-label="Sumar">+</button></div><div class="line-total">${money(item.qty*item.price)}</div></div>`).join(""):`<div class="cart-empty">Tocá un producto o usá la botonera para comenzar</div>`;
  $$('[data-minus]',root).forEach(button=>button.onclick=()=>changeQty(button.dataset.minus,-1));$$('[data-plus]',root).forEach(button=>button.onclick=()=>changeQty(button.dataset.plus,1));updateTotals();
}

function subtotal(){return [...state.cart.values()].reduce((sum,item)=>sum+item.qty*item.price,0);}
function saleLimit(product){return Number(product.currentStock||0)+Number(state.editSale?.items?.find(item=>item.productId===product.id)?.qty||0);}
function discountAmount(){if(!state.discount)return 0;const amount=state.discount.type==="percent"?Math.round(subtotal()*Number(state.discount.value)/100):Number(state.discount.value);return clamp(amount,0,subtotal());}
function updateTotals(){const sub=subtotal(),disc=discountAmount(),qty=[...state.cart.values()].reduce((sum,item)=>sum+item.qty,0);$("#sale-subtotal",state.root).textContent=money(sub);$("#sale-discount",state.root).textContent=disc?`− ${money(disc)}`:"—";$("#sale-items",state.root).textContent=qty;$("#sale-total",state.root).textContent=money(sub-disc);}

function addProduct(id, feedback=false) {
  const product=state.stock.find(item=>item.id===id);if(!product)return;
  const existing=state.cart.get(id);const qty=(existing?.qty||0)+1;
  const available=saleLimit(product);
  if(qty>available)return toast(`No hay más stock de ${product.productName}`,"error");
  if(existing){existing.qty=qty;existing.stock=available;existing.thumbUrl=product.thumbUrl||existing.thumbUrl;}
  else{
    const original=state.editSale?.items?.find(item=>item.productId===id);
    const price=Number(original?.unitPrice??product.price);
    state.cart.set(id,{id,productId:id,name:original?.name||product.productName,abbreviation:original?.abbreviation||product.abbreviation,price,unitPrice:price,qty,stock:available,thumbUrl:product.thumbUrl});
  }
  state.lastProductId=id;
  renderCartLines();if(feedback){const tile=$(`[data-product="${id}"]`,state.root);tile?.classList.add("pulse");setTimeout(()=>tile?.classList.remove("pulse"),160);navigator.vibrate?.(30);}
}

function changeQty(id,delta){const item=state.cart.get(id);if(!item)return;const next=item.qty+delta;if(next>item.stock)return toast("No hay stock suficiente","error");if(next<=0)state.cart.delete(id);else item.qty=next;state.lastProductId=id;renderCartLines();}
function removeLast(){if(state.lastProductId)changeQty(state.lastProductId,-1);}

function setupKeyboard(){state.keyboard?.destroy();const capture=$("#key-capture",state.root);state.keyboard=new SellerKeyboard({capture,getProducts:()=>state.stock,onProduct:id=>addProduct(id,true),onContinue:saveSale,onBackspace:removeLast,onAdd:()=>state.lastProductId&&changeQty(state.lastProductId,1),onSubtract:removeLast,onFocusChange:focused=>{const hint=$("#key-hint",state.root);const button=$("#activate-keyboard",state.root);if(hint)hint.textContent=focused?"Lista para recibir teclas":"Botonera pausada mientras completás otro campo";if(button){button.textContent=focused?"Botonera activa":"Reactivar botonera";button.className=`btn ${focused?"btn-primary":"btn-secondary"}`;}}});$("#activate-keyboard",state.root).onclick=()=>{state.keyboardActive=true;state.keyboard.activate();};if(state.keyboardActive)state.keyboard.activate();}

function resumeKeyboard(){if(state?.view==="new"&&state.keyboardActive)setTimeout(()=>state?.keyboard?.activate(),0);}

function discountModal(){const modal=openModal({title:"Aplicar descuento",content:`<form id="discount-form"><label>Descuentos guardados<select id="saved-discount"><option value="">Manual</option>${state.discounts.map(item=>`<option value="${item.id}">${escapeHtml(item.name)} · ${item.type==="percent"?`${item.value}%`:money(item.value)}</option>`).join("")}</select></label><label>Tipo<select name="type" id="discount-type"><option value="fixed">Monto fijo</option><option value="percent">Porcentaje</option></select></label><label>Valor entero<input name="value" id="discount-value" type="number" min="0" step="1" inputmode="numeric" required></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Aplicar</button></div></form>`});$(".modal-cancel",modal.root).onclick=modal.close;$("#saved-discount",modal.root).onchange=event=>{const saved=state.discounts.find(d=>d.id===event.target.value);if(saved){$("#discount-type",modal.root).value=saved.type;$("#discount-value",modal.root).value=saved.value;}};$("#discount-form",modal.root).onsubmit=event=>{event.preventDefault();if(subtotal()<=0)return toast("Agregá productos antes del descuento","error");const saved=state.discounts.find(d=>d.id===$("#saved-discount",modal.root).value);const type=$("#discount-type",modal.root).value,value=Number($("#discount-value",modal.root).value);const amount=type==="percent"?Math.round(subtotal()*value/100):value;if(!Number.isInteger(value))return toast("El descuento debe ser un número entero","error");if(type==="percent"&&value>100||amount>subtotal())return toast("El descuento no puede superar el subtotal","error");state.discount={id:saved?.id||"manual",name:saved?.name||"Descuento manual",type,value};modal.close();renderNewSale();};}

async function saveSale(){if(state.saving)return;if(!state.cart.size)return toast("La venta está vacía","error");if(!navigator.onLine)return toast("Necesitás conexión para registrar la venta","error");state.saving=true;updateConnectionStatus("syncing");const button=$("#continue-sale",state.root);setBusy(button,true,state.editSale?"Guardando…":"Registrando…");try{const payload={seller:state.profile,items:[...state.cart.values()],discount:state.discount};const result=state.editSale?await updateSaleTransaction({...payload,saleId:state.editSale.id}):await createSale({...payload,location:location()});state.cart.clear();state.discount=null;state.lastProductId=null;state.editSale=null;await refreshSales();showReceipt(result);}catch(error){toast(error.message,"error");setBusy(button,false);}finally{state.saving=false;updateConnectionStatus();}}

function showReceipt(result){const modal=openModal({title:"Venta registrada",content:`<div class="receipt"><div class="brand-mark">FM</div><p class="muted">${escapeHtml(location()?.name||"")}</p><strong>${escapeHtml(result.saleCode)}</strong><div class="receipt-total">${money(result.total)}</div><p>${timeOnly(result.createdAt)}</p><button class="btn btn-primary btn-block" id="receipt-close">Nueva venta</button></div>`,onClose:()=>{state.view="new";renderView();}});$("#receipt-close",modal.root).onclick=()=>{modal.close();state.view="new";renderView();};}

async function refreshSales(){try{state.sales=await listSellerSales(state.profile.id,state.salesLimit);}catch(error){toast(`No se pudieron cargar las ventas: ${error.message}`,"error");}}

function filteredSales(){let result=state.sales;if(state.salesFilter==="today"){const start=startOfToday();result=result.filter(sale=>sale.createdAt?.toDate?.()>=start);}if(state.salesFilter==="location")result=result.filter(sale=>sale.locationId===state.locationId);return result;}

function renderSales(){const content=$("#seller-content",state.root);const sales=filteredSales();content.innerHTML=`<div class="page-head"><h1>Mis ventas</h1><button id="back-new" class="btn btn-primary">Nueva venta</button></div><div class="toolbar"><select id="sales-filter"><option value="today" ${state.salesFilter==="today"?"selected":""}>Hoy</option><option value="location" ${state.salesFilter==="location"?"selected":""}>Ubicación actual</option><option value="all" ${state.salesFilter==="all"?"selected":""}>Todas las propias</option></select></div><div class="sale-list">${sales.map(sale=>`<button class="sale-card" data-sale="${sale.id}"><div class="row"><strong>${escapeHtml(sale.saleCode)}</strong><span class="badge ${sale.status==="active"?"ok":"danger"}">${sale.status==="active"?"Activa":"Anulada"}</span></div><div class="row"><span>${dateTime(sale.createdAt)} · ${escapeHtml(sale.locationName)}</span><strong>${money(sale.total)}</strong></div><small>${sale.totalItems} productos</small></button>`).join("")||`<div class="empty">No hay ventas para este filtro</div>`}</div>${state.sales.length>=state.salesLimit?`<button id="load-more-own-sales" class="btn btn-secondary btn-block">Cargar más ventas</button>`:""}`;$("#back-new",content).onclick=()=>{state.view="new";renderView();};$("#sales-filter",content).onchange=event=>{state.salesFilter=event.target.value;renderSales();};$$('[data-sale]',content).forEach(button=>button.onclick=()=>saleDetail(state.sales.find(s=>s.id===button.dataset.sale)));$("#load-more-own-sales",content)?.addEventListener("click",async event=>{state.salesLimit+=100;setBusy(event.currentTarget,true,"Cargando…");await refreshSales();renderSales();});}

function saleDetail(sale){const modal=openModal({title:sale.saleCode,content:`<p>${dateTime(sale.createdAt)}<br>${escapeHtml(sale.locationName)}</p>${sale.items.map(item=>`<div class="total-line"><span>${item.qty} × ${escapeHtml(item.name)}</span><strong>${money(item.subtotal)}</strong></div>`).join("")}<div class="total-line grand"><span>Total</span><strong>${money(sale.total)}</strong></div>${sale.status==="active"?`<div class="modal-actions"><button id="delete-sale" class="btn btn-danger">Anular</button><button id="edit-sale" class="btn btn-secondary">Editar</button></div>`:'<p class="badge danger">Venta anulada</p>'}`});$("#edit-sale",modal.root)?.addEventListener("click",()=>{modal.close();startEdit(sale);});$("#delete-sale",modal.root)?.addEventListener("click",async()=>{if(!await confirmDialog("¿Querés anular esta venta? Se devolverán las unidades al stock."))return;try{await deleteSaleTransaction({saleId:sale.id,user:state.profile});modal.close();await refreshSales();renderSales();toast("Venta anulada y stock devuelto","success");}catch(error){toast(error.message,"error");}});}

function startEdit(sale){const saleLocation=state.locations.find(item=>item.id===sale.locationId);if(!saleLocation)return toast("La ubicación de esta venta ya no está disponible","error");state.locationId=sale.locationId;localStorage.setItem(`flor-mia-location-${state.profile.id}`,state.locationId);state.editSale=sale;state.cart.clear();sale.items.forEach(item=>state.cart.set(item.productId,{id:item.productId,productId:item.productId,name:item.name,abbreviation:item.abbreviation,price:Number(item.unitPrice),unitPrice:Number(item.unitPrice),qty:Number(item.qty),stock:Number(item.qty),thumbUrl:""}));state.discount=sale.discount?{id:sale.discount.discountId,name:sale.discount.name,type:sale.discount.type,value:sale.discount.value}:null;state.view="new";updateLocationTitle();subscribeStock();renderView();}
function cancelEdit(){state.editSale=null;state.cart.clear();state.discount=null;state.lastProductId=null;renderNewSale();}

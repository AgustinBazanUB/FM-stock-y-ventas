import {
  listUsers, listProducts, listProductCategories, listLocations, listDiscounts, listLocationStock, saveLocation, saveProduct, saveProductCategory, saveDiscount,
  saveUser, createSellerAccount, syncSellerAssignments, configureStock, addStock, subscribeLocationStock,
  subscribeLocationSales, deleteSaleTransaction, restoreSaleTransaction, listSellerSales, reauthenticateAdmin, deleteLocationLogical,
  restoreLocation, deleteProductLogical, restoreProduct, deleteDiscountLogical, restoreDiscount,
  deleteLocationStock, deleteSellerLogical, listSalesByDateRange, pauseLocation
} from "./firebase-service.js";
import {$, $$, escapeHtml, money, dateTime, dateOnly, timeOnly, toast, openModal, confirmDialog, setBusy, formDataObject, imageOrPlaceholder, downloadCsv} from "./utils.js";
import {recordNextKey} from "./keyboard.js";
import {listProductImages} from "./image-catalog.js";
import {saleDiscountList, storedDiscountTotal} from "./discounts.js";
import {PAYMENT_LABELS as SALE_PAYMENT_LABELS, salePaymentParts, paymentsBreakdownText} from "./payments.js";
import {currentMetricsValue, buildMetricsDateRange, applyMetricsFilters, calculateMetrics, metricLocations, metricSellersForLocations} from "./metrics.js?v=17";
import {addDays, isLocationActiveNow, localDatePart, localDateTimeToDate, locationActivity, toLocalDateTimeInput} from "./locations.js";
import {categoryPayload, groupByCategory, UNCATEGORIZED_ID, UNCATEGORIZED_NAME, visibleCategories} from "./categories.js";

let state = null;
const PAYMENT_LABELS = {...SALE_PAYMENT_LABELS,unknown:"Sin forma de pago"};

export function destroyAdmin() {
  state?.unsubStock?.(); state?.unsubSales?.();
  state = null;
}

export async function renderAdmin(root, profile, onLogout) {
  if (state?.profile?.id === profile.id) return;
  destroyAdmin();
  state = {root, profile, onLogout, section:"summary", users:[], products:[], productCategories:[], productImages:[], locations:[], discounts:[], stock:[], sales:[], selectedLocationId:"", salesLimit:200, unsubStock:null, unsubSales:null, metrics:{filters:{period:"month",dateValue:currentMetricsValue("month"),locationIds:[],sellerIds:[],productId:"",discountId:""},sales:[],loaded:false,loading:false,error:"",requestId:0}};
  root.innerHTML = shell(profile);
  $("#admin-logout", root).addEventListener("click", onLogout);
  $$("[data-section]", root).forEach(button => button.addEventListener("click", () => switchSection(button.dataset.section)));
  try {
    [state.users, state.products, state.productCategories, state.locations, state.discounts, state.productImages] = await Promise.all([listUsers(), listProducts(), listProductCategories(), listLocations(), listDiscounts(), listProductImages()]);
    state.selectedLocationId = activeLocations()[0]?.id || "";
    renderLocationSelector();
    subscribeSelected();
    renderSection();
  } catch (error) {
    toast(`No se pudieron cargar los datos: ${error.message}`, "error");
    $("#admin-content", root).innerHTML = `<div class="empty">No se pudieron cargar los datos. Revisá internet y las reglas de Firebase.</div>`;
  }
}

function shell(profile) {
  return `<header class="app-header"><div class="logo">Flor Mia</div><select id="admin-location" aria-label="Ubicación activa"><option>Cargando…</option></select><div class="header-spacer"></div><div class="connection ${navigator.onLine ? "" : "offline"}" data-connection-status>${navigator.onLine ? "Online" : "Sin conexión"}</div><div class="user-chip"><strong>${escapeHtml(profile.name)}</strong>Administrador</div><button id="admin-logout" class="btn btn-ghost btn-small">Salir</button></header>
  <div class="admin-layout"><nav class="side-nav" aria-label="Administración">
    <button data-section="summary" class="active">Resumen</button><button data-section="metrics">Métricas</button><button data-section="locations">Ubicaciones</button><button data-section="products">Productos</button><button data-section="stock">Cargar Stock</button><button data-section="sellers">Vendedores</button><button data-section="discounts">Descuentos</button><button data-section="sales">Ventas</button><button data-section="deletedItems">Items Eliminados</button><button data-section="exports">Exportar</button><button data-section="help">Ayuda</button>
  </nav><main id="admin-content" class="page"><div class="empty">Cargando información…</div></main></div>`;
}

function renderLocationSelector() {
  const select = $("#admin-location", state.root);
  const selected=state.locations.find(location=>location.id===state.selectedLocationId&&location.deleted!==true);
  const locations=activeLocations();
  const options=selected&&!locations.some(location=>location.id===selected.id)?[selected,...locations]:locations;
  select.innerHTML = options.length ? options.map(location => `<option value="${location.id}" ${location.id === state.selectedLocationId ? "selected" : ""}>${escapeHtml(location.name)}${isLocationActiveNow(location)?"":" · inactiva"}</option>`).join("") : `<option value="">Sin ubicaciones</option>`;
  select.onchange = () => { state.selectedLocationId = select.value; state.salesLimit=200; subscribeSelected(); renderSection(); };
}

function subscribeSelected() {
  state.unsubStock?.(); state.unsubSales?.(); state.stock = []; state.sales = [];
  if (!state.selectedLocationId) return;
  state.unsubStock = subscribeLocationStock(state.selectedLocationId, stock => { state.stock = stock.filter(item=>item.deleted!==true); renderSection(); }, error => toast(`Stock: ${error.message}`, "error"));
  state.unsubSales = subscribeLocationSales(state.selectedLocationId, sales => { state.sales = sales; renderSection(); }, error => toast(`Ventas: ${error.message}`, "error"), state.salesLimit);
}

function switchSection(section) {
  state.section = section;
  $$("[data-section]", state.root).forEach(button => button.classList.toggle("active", button.dataset.section === section));
  renderSection();
}

function renderSection() {
  if (!state) return;
  const renderers = {summary:renderSummary, metrics:renderMetrics, locations:renderLocations, products:renderProducts, stock:renderStock, sellers:renderSellers, discounts:renderDiscounts, sales:renderSales, deletedItems:renderDeletedItems, exports:renderExports, help:renderHelp};
  renderers[state.section]?.();
}

const activeLocations=()=>state.locations.filter(item=>isLocationActiveNow(item)&&item.deleted!==true);
const visibleLocations=()=>state.locations.filter(item=>item.deleted!==true);
const deletedLocations=()=>state.locations.filter(item=>item.deleted===true);
const activeProducts=()=>state.products.filter(item=>item.active===true&&item.deleted!==true);
const deletedProducts=()=>state.products.filter(item=>item.deleted===true);
const activeDiscounts=()=>state.discounts.filter(item=>item.active===true&&item.deleted!==true);
const deletedDiscounts=()=>state.discounts.filter(item=>item.deleted===true);
const activeSellers=()=>state.users.filter(item=>item.role==="seller"&&item.active===true&&item.deleted!==true);

function ensureSelectedLocation(){const active=activeLocations();if(!active.some(item=>item.id===state.selectedLocationId))state.selectedLocationId=active[0]?.id||"";renderLocationSelector();subscribeSelected();}

function renderHelp() {
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Guía rápida</h1></div><div class="cards help-cards"><section class="card"><h3>Preparación</h3><ol class="help-steps"><li>Creá una ubicación.</li><li>Cargá productos con precios enteros.</li><li>Elegí su imagen del catálogo.</li><li>Agregalos al stock de la ubicación.</li><li>Creá vendedores y asignales ubicaciones.</li></ol></section><section class="card"><h3>Uso diario</h3><ol class="help-steps"><li>Ingresá mercadería desde Stock.</li><li>El vendedor registra cada venta y elige su forma de pago.</li><li>Revisá alertas, pagos y ventas en Resumen.</li><li>Descargá respaldos desde Exportar.</li></ol></section><section class="card"><h3>Imágenes</h3><p>Las imágenes están incluidas en la carpeta de la web y aparecen como opciones al editar un producto. Firestore guarda únicamente la ruta seleccionada.</p></section><section class="card"><h3>Correcciones</h3><p>Las ventas se pueden editar o anular. Al anularlas, el stock vuelve automáticamente. Los precios y descuentos siempre se guardan sin decimales.</p></section><section class="card"><h3>Items Eliminados</h3><p>Ubicaciones, productos, descuentos y ventas anuladas están agrupados en una sola sección. Las restauraciones conservan el historial.</p></section></div>`;
}

function alertHtml() {
  const location = currentLocation();
  const red = state.stock.filter(item => item.active && Number(item.currentStock) <= Number(item.redAlertQty));
  const yellow = state.stock.filter(item => item.active && Number(item.currentStock) <= Number(item.yellowAlertQty) && Number(item.currentStock) > Number(item.redAlertQty));
  const row = (items, type, title) => items.length ? `<section class="alert-row ${type}"><strong>${title}</strong>${items.map(item => `<article class="stock-alert"><img class="thumb" loading="lazy" src="${imageOrPlaceholder(item.thumbUrl,item.abbreviation)}" alt=""><div><strong>${escapeHtml(item.abbreviation)}</strong><small>${escapeHtml(item.productName)}</small><small>Stock: ${item.currentStock} · ${escapeHtml(location?.name || "")}</small></div></article>`).join("")}</section>` : "";
  return `<div class="alerts">${row(red,"red","Rojo")}${row(yellow,"yellow","Amarillo")}</div>`;
}

function currentLocation() { return state.locations.find(location => location.id === state.selectedLocationId); }

function locationDateRange(location) {
  const activity = locationActivity(location);
  return `${dateTime(activity.startAt)} – ${dateTime(activity.endAt)}`;
}

function locationStatusBadge(location) {
  const activity = locationActivity(location);
  const detail = activity.reason === "paused" ? ` hasta ${dateTime(activity.manualInactiveUntil)}` : "";
  return `<span class="badge ${activity.className}">${escapeHtml(activity.label)}${escapeHtml(detail)}</span>`;
}

function locationPeriodChanged(location, startDateTime, endDateTime) {
  return String(location.startDateTime || toLocalDateTimeInput(location.scheduleStartAt || location.startDate, "start")) !== String(startDateTime || "")
    || String(location.endDateTime || toLocalDateTimeInput(location.scheduleEndAt || location.endDate, "end")) !== String(endDateTime || "");
}

function locationSchedulePayload(location, data, source = "form") {
  const startDateTime = data.startDateTime || "";
  const endDateTime = data.endDateTime || "";
  const startAt = localDateTimeToDate(startDateTime);
  const endAt = localDateTimeToDate(endDateTime);
  if(startAt&&endAt&&endAt<startAt)throw new Error("La fecha final no puede ser anterior a la inicial");
  const hasSchedule = Boolean(startDateTime || endDateTime);
  const payload = {
    startDate:localDatePart(startDateTime),
    endDate:localDatePart(endDateTime),
    startDateTime,
    endDateTime,
    scheduleStartAt:startAt || null,
    scheduleEndAt:endAt || null,
    autoActivityManaged:hasSchedule
  };
  const periods = Array.isArray(location.activePeriods)?location.activePeriods:[];
  const periodAlreadySaved = periods.some(period => period?.startDateTime === startDateTime && period?.endDateTime === endDateTime);
  if(hasSchedule && (locationPeriodChanged(location,startDateTime,endDateTime) || !periodAlreadySaved)){
    const period = {startAt:startAt || null,endAt:endAt || null,startDateTime,endDateTime,source,createdAt:new Date()};
    payload.activePeriods=[...periods,period];
  }
  return payload;
}

function categoryOptions(selectedId="") {
  return `<option value="">${UNCATEGORIZED_NAME}</option>${visibleCategories(state.productCategories).map(category=>`<option value="${category.id}" ${category.id===selectedId?"selected":""}>${escapeHtml(category.name)}</option>`).join("")}`;
}

function productStatusBadge(product) {
  return `<span class="badge ${product.active===true?"ok":""}">${product.active===true?"Activo":"Inactivo"}</span>`;
}

function productTable(products) {
  return `<div class="table-wrap"><table class="responsive"><thead><tr><th></th><th>Producto</th><th>Abrev.</th><th>Precio</th><th>Botonera</th><th>Estado</th><th></th></tr></thead><tbody>${products.map(product=>`<tr><td data-label="Imagen"><img class="thumb" loading="lazy" src="${imageOrPlaceholder(product.thumbUrl,product.abbreviation)}" alt=""></td><td data-label="Producto">${escapeHtml(product.name)}</td><td data-label="Abrev.">${escapeHtml(product.abbreviation)}</td><td data-label="Precio">${money(product.defaultPrice)}</td><td data-label="Botonera">${escapeHtml(product.buttonLabel||"—")}</td><td data-label="Estado">${productStatusBadge(product)}</td><td data-label="Acciones"><div class="table-actions"><button class="btn btn-secondary btn-small" data-edit-product="${product.id}">Editar</button><button class="btn btn-danger btn-small" data-delete-product="${product.id}">Eliminar producto</button></div></td></tr>`).join("")||`<tr><td colspan="7"><div class="empty">No hay productos en esta categoría</div></td></tr>`}</tbody></table></div>`;
}

function metrics() {
  const active = state.sales.filter(sale => sale.status === "active");
  const total = active.reduce((sum,sale) => sum + Number(sale.total || 0),0);
  const items = active.reduce((sum,sale) => sum + Number(sale.totalItems || 0),0);
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const today = active.filter(sale => sale.createdAt?.toDate?.() >= todayStart);
  const todayTotal = today.reduce((sum,sale) => sum + Number(sale.total || 0),0);
  const products = new Map(); const sellers = new Map(); const hours = new Map(); const payments = new Map();
  active.forEach(sale => {
    sale.items?.forEach(item => products.set(item.name, (products.get(item.name)||0) + Number(item.qty)));
    sellers.set(sale.sellerName, (sellers.get(sale.sellerName)||0) + Number(sale.total||0));
    const date = sale.createdAt?.toDate?.(); const hour = date ? `${String(date.getHours()).padStart(2,"0")}:00` : "Pendiente";
    hours.set(hour,(hours.get(hour)||0)+Number(sale.total||0));
    const parts=salePaymentParts(sale);
    if(parts.length){parts.forEach(part=>{const payment=payments.get(part.method)||{key:part.method,label:part.label,total:0,count:0};payment.total+=part.amount;payment.count+=1;payments.set(part.method,payment);});}
    else{const payment=payments.get("unknown")||{key:"unknown",label:PAYMENT_LABELS.unknown,total:0,count:0};payment.total+=Number(sale.total||0);payment.count+=1;payments.set("unknown",payment);}
  });
  const sorted = map => [...map].sort((a,b) => b[1]-a[1]);
  const paymentRows=["credit","debit","alias","cash","unknown"].map(key=>payments.get(key)||{key,label:PAYMENT_LABELS[key],total:0,count:0}).filter(row=>row.key!=="unknown"||row.count>0);
  return {active,total,items,ticket:active.length ? total/active.length : 0,todayTotal,todayCount:today.length, products:sorted(products), sellers:sorted(sellers), hours:[...hours].sort(),paymentRows};
}

function renderSummary() {
  const content = $("#admin-content", state.root); const m = metrics();
  content.innerHTML = `<div class="page-head"><h1>Resumen · ${escapeHtml(currentLocation()?.name || "Sin ubicación")}</h1></div>${alertHtml()}
  <div class="cards"><div class="card metric"><strong>${money(m.todayTotal)}</strong><span>Total de hoy (${m.todayCount} ventas)</span></div><div class="card metric"><strong>${money(m.total)}</strong><span>Total de la ubicación/evento</span></div><div class="card metric"><strong>${m.active.length}</strong><span>Ventas</span></div><div class="card metric"><strong>${m.items}</strong><span>Productos vendidos</span></div><div class="card metric"><strong>${money(m.ticket)}</strong><span>Ticket promedio</span></div></div>
  <section class="card payment-summary" style="margin-top:13px"><h3>Ventas por forma de pago</h3><div class="cards">${m.paymentRows.map(row=>`<div class="payment-metric"><span>${escapeHtml(row.label)}</span><strong>${money(row.total)}</strong><small>${row.count} ${row.count===1?"venta":"ventas"}</small></div>`).join("")}</div></section>
  <div class="cards" style="margin-top:13px"><section class="card"><h3>Productos más vendidos</h3>${rankList(m.products, value => `${value} u.`)}</section><section class="card"><h3>Ventas por vendedor</h3>${rankList(m.sellers, money)}</section><section class="card"><h3>Ventas por hora</h3>${rankList(m.hours, money)}</section><section class="card"><h3>Stock restante</h3>${rankList(state.stock.map(item => [item.abbreviation || item.productName,Number(item.currentStock)]).sort((a,b)=>a[1]-b[1]), value => `${value} u.`)}</section></div>`;
}

function rankList(rows, formatter) {
  return rows.length ? `<ol class="rank-list">${rows.slice(0,10).map(([name,value]) => `<li><span>${escapeHtml(name || "Sin nombre")}</span><strong>${formatter(value)}</strong></li>`).join("")}</ol>` : `<div class="empty">Todavía no hay datos</div>`;
}

function metricsDateInput(period,value=currentMetricsValue(period)){
  const type=period==="day"?"date":period==="year"?"number":"month";
  const limits=period==="year"?'min="2000" max="2200" step="1"':'';
  return `<input id="metrics-date-value" type="${type}" ${limits} value="${escapeHtml(value)}" required>`;
}

function metricOptions(items,{emptyLabel,getName=item=>item.name}={}){
  return `<option value="">${escapeHtml(emptyLabel||"Todos")}</option>${[...items].sort((a,b)=>String(getName(a)||"").localeCompare(String(getName(b)||""))).map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(getName(item)||"Sin nombre")}${item.deleted===true?" · eliminada/o":item.active===false?" · inactiva/o":""}</option>`).join("")}`;
}

function metricMultiPicker({id,label,allLabel,items,selectedIds=[],emptyText="No hay opciones disponibles.",itemLabel=item=>item.name}){
  const selected=new Set(selectedIds),allSelected=!selected.size,summary=allSelected?allLabel:selected.size===1?itemLabel(items.find(item=>selected.has(item.id))||{}):`${selected.size} seleccionados`;
  return `<div class="metrics-multi-field"><span class="metrics-field-label">${escapeHtml(label)}</span><details class="metrics-picker" id="${id}"><summary><span id="${id}-summary">${escapeHtml(summary)}</span><small>${allSelected?"Todas":"Selección múltiple"}</small></summary><div class="metrics-picker-menu"><label class="metrics-picker-option all"><input id="${id}-all" type="checkbox" ${allSelected?"checked":""} ${items.length?"":"disabled"}> <span>${escapeHtml(allLabel)}</span></label>${items.map(item=>`<label class="metrics-picker-option"><input type="checkbox" data-metric-option="${id}" value="${escapeHtml(item.id)}" ${selected.has(item.id)?"checked":""}> <span>${escapeHtml(itemLabel(item))}${item.active===false?' <small class="badge">Inactiva</small>':""}</span></label>`).join("")||`<p class="metrics-picker-empty">${escapeHtml(emptyText)}</p>`}</div></details></div>`;
}

function metricPickerValue(root,id){
  if($(`#${id}-all`,root)?.checked)return [];
  return $$(`[data-metric-option="${id}"]:checked`,root).map(input=>input.value);
}

function bindMetricPicker(root,id,items,onChange,itemLabel=item=>item.name){
  const all=$(`#${id}-all`,root),options=$$(`[data-metric-option="${id}"]`,root),summary=$(`#${id}-summary`,root),hint=$(`#${id} summary small`,root);if(!all)return;
  const update=()=>{const values=all.checked?[]:options.filter(input=>input.checked).map(input=>input.value);if(!values.length&&!all.checked)all.checked=true;const selected=all.checked?[]:values;summary.textContent=!selected.length?all.parentElement.textContent.trim():selected.length===1?itemLabel(items.find(item=>item.id===selected[0])||{}):`${selected.length} seleccionados`;if(hint)hint.textContent=selected.length?"Selección múltiple":"Todas";onChange?.(selected);};
  all.onchange=()=>{if(all.checked)options.forEach(input=>input.checked=false);update();};
  options.forEach(input=>input.onchange=()=>{if(input.checked)all.checked=false;if(!options.some(option=>option.checked))all.checked=true;update();});
}

function lineChart(points){
  if(!points.some(point=>point.total>0||point.sales>0))return `<div class="metrics-chart-empty">No hay ventas activas para graficar.</div>`;
  const width=820,height=270,left=72,right=22,top=22,bottom=52,max=Math.max(...points.map(point=>point.total),1),plotWidth=width-left-right,plotHeight=height-top-bottom;
  const coords=points.map((point,index)=>({x:left+(points.length===1?plotWidth/2:index*plotWidth/(points.length-1)),y:top+plotHeight-(point.total/max)*plotHeight,...point}));
  const labelStep=Math.max(1,Math.ceil(points.length/8));
  const grids=Array.from({length:5},(_,index)=>{const value=max*(4-index)/4,y=top+plotHeight*index/4;return `<line x1="${left}" y1="${y}" x2="${width-right}" y2="${y}"/><text x="${left-8}" y="${y+4}" text-anchor="end">${escapeHtml(money(value))}</text>`;}).join("");
  return `<div class="metrics-chart-scroll"><svg class="metrics-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolución de ventas"><g class="chart-grid">${grids}</g><polyline class="chart-line" points="${coords.map(point=>`${point.x},${point.y}`).join(" ")}"/>${coords.map(point=>`<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"><title>${escapeHtml(point.label)}: ${escapeHtml(money(point.total))} · ${point.sales} ventas</title></circle>`).join("")}${coords.filter((_,index)=>index%labelStep===0||index===coords.length-1).map(point=>`<text class="chart-axis-label" x="${point.x}" y="${height-18}" text-anchor="middle">${escapeHtml(point.label)}</text>`).join("")}</svg></div>`;
}

function columnChart(rows){
  const data=rows.slice(0,10);if(!data.length||!data.some(row=>row.total>0))return `<div class="metrics-chart-empty">No hay montos por ubicación para comparar.</div>`;
  const width=820,height=300,left=65,right=20,top=22,bottom=82,max=Math.max(...data.map(row=>row.total),1),plotWidth=width-left-right,plotHeight=height-top-bottom,slot=plotWidth/data.length,barWidth=Math.min(54,slot*.62);
  return `<div class="metrics-chart-scroll"><svg class="metrics-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Monto vendido por ubicación"><line class="chart-base" x1="${left}" y1="${top+plotHeight}" x2="${width-right}" y2="${top+plotHeight}"/>${data.map((row,index)=>{const barHeight=row.total/max*plotHeight,x=left+index*slot+(slot-barWidth)/2,y=top+plotHeight-barHeight,label=String(row.name).length>17?`${String(row.name).slice(0,16)}…`:row.name;return `<rect class="chart-column" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5"><title>${escapeHtml(row.name)}: ${escapeHtml(money(row.total))}</title></rect><text class="chart-column-value" x="${x+barWidth/2}" y="${Math.max(14,y-6)}" text-anchor="middle">${escapeHtml(money(row.total))}</text><text class="chart-axis-label" x="${x+barWidth/2}" y="${top+plotHeight+20}" text-anchor="end" transform="rotate(-28 ${x+barWidth/2} ${top+plotHeight+20})">${escapeHtml(label)}</text>`;}).join("")}</svg></div>`;
}

function productUnitsChart(rows){
  const data=rows.slice(0,10);if(!data.length||!data.some(row=>row.items>0))return `<div class="metrics-chart-empty">No hay productos vendidos para graficar.</div>`;
  const width=820,height=300,left=65,right=20,top=22,bottom=82,max=Math.max(...data.map(row=>row.items),1),plotWidth=width-left-right,plotHeight=height-top-bottom,slot=plotWidth/data.length,barWidth=Math.min(54,slot*.62);
  return `<div class="metrics-chart-scroll"><svg class="metrics-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Productos más vendidos"><line class="chart-base" x1="${left}" y1="${top+plotHeight}" x2="${width-right}" y2="${top+plotHeight}"/>${data.map((row,index)=>{const barHeight=row.items/max*plotHeight,x=left+index*slot+(slot-barWidth)/2,y=top+plotHeight-barHeight,label=String(row.name).length>17?`${String(row.name).slice(0,16)}…`:row.name;return `<rect class="chart-column" x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5"><title>${escapeHtml(row.name)}: ${row.items} u. · ${escapeHtml(money(row.total))}</title></rect><text class="chart-column-value" x="${x+barWidth/2}" y="${Math.max(14,y-6)}" text-anchor="middle">${row.items} u.</text><text class="chart-axis-label" x="${x+barWidth/2}" y="${top+plotHeight+20}" text-anchor="end" transform="rotate(-28 ${x+barWidth/2} ${top+plotHeight+20})">${escapeHtml(label)}</text>`;}).join("")}</svg></div>`;
}

function pieChart(rows){
  let data=rows.filter(row=>row.total>0);if(!data.length)return `<div class="metrics-chart-empty">No hay formas de pago para graficar.</div>`;
  if(data.length>5){const rest=data.slice(5).reduce((sum,row)=>sum+row.total,0);data=[...data.slice(0,5),{name:"Otros",total:rest}];}
  const total=data.reduce((sum,row)=>sum+row.total,0),colors=["#315b43","#c89437","#2463a6","#b93838","#7b5aa6","#779488"];let current=0;
  const stops=data.map((row,index)=>{const start=current;current+=row.total/total*100;return `${colors[index]} ${start}% ${current}%`;}).join(",");
  return `<div class="metrics-pie-layout"><div class="metrics-pie" style="background:conic-gradient(${stops})" role="img" aria-label="Distribución por forma de pago"></div><div class="metrics-legend">${data.map((row,index)=>`<div><i style="background:${colors[index]}"></i><span>${escapeHtml(row.name)}</span><strong>${(row.total/total*100).toFixed(1)}%</strong><small>${money(row.total)}</small></div>`).join("")}</div></div>`;
}

function metricsTable(title,headers,rows,renderRow){
  return `<section class="card metrics-table-card"><h3>${escapeHtml(title)}</h3>${rows.length?`<div class="table-wrap"><table class="responsive"><thead><tr>${headers.map(header=>`<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map(renderRow).join("")}</tbody></table></div>`:`<div class="empty">No hay ventas para los filtros seleccionados.</div>`}</section>`;
}

function metricsFilterContext(filters){
  const locations=metricLocations(state.locations),visibleIds=new Set(locations.map(item=>item.id));
  const requestedLocations=Array.isArray(filters.locationIds)?filters.locationIds:filters.locationId?[filters.locationId]:[];
  const locationSelection=requestedLocations.filter(id=>visibleIds.has(id)),locationIds=locationSelection.length?locationSelection:locations.map(item=>item.id);
  const sellers=metricSellersForLocations(locations,state.users,state.metrics.sales,locationIds),sellerIdSet=new Set(sellers.map(item=>item.id));
  const requestedSellers=Array.isArray(filters.sellerIds)?filters.sellerIds:filters.sellerId?[filters.sellerId]:[];
  const sellerSelection=requestedSellers.filter(id=>sellerIdSet.has(id)),sellerIds=sellerSelection.length?sellerSelection:sellers.map(item=>item.id);
  return {locations,locationSelection,locationIds,locationNames:locations.filter(item=>locationIds.includes(item.id)).map(item=>item.name),sellers,sellerSelection,sellerIds,sellerNames:sellers.filter(item=>sellerIds.includes(item.id)).map(item=>item.name)};
}

function metricsFilterDetails(filters,context){
  const product=state.products.find(item=>item.id===filters.productId),discount=state.discounts.find(item=>item.id===filters.discountId);
  return {...filters,locationIds:context.locationIds,locationNames:context.locationNames,sellerIds:context.sellerIds,sellerNames:context.sellerNames,productName:product?.name||"",discountName:discount?.name||""};
}

function hideUnavailableMetricRows(metrics){
  const visible=(rows,items)=>rows.filter(row=>{const entity=items.find(item=>item.id===row.key||(row.key===row.name&&item.name===row.name));return !entity||(entity.active===true&&entity.deleted!==true);});
  return {...metrics,
    byProduct:visible(metrics.byProduct,state.products),
    byDiscount:visible(metrics.byDiscount,state.discounts)
  };
}

function metricsResultsHtml(metrics,filters){
  const productCard=filters.productId?`<div class="card metric"><strong>${money(metrics.selectedProductAmount)}</strong><span>Monto del producto filtrado (${metrics.selectedProductUnits} u.)</span></div>`:"";
  const tables=`<div class="metrics-tables">${metricsTable("Detalle por ubicación",["Ubicación","Total","Ventas","Productos","Ticket promedio"],metrics.byLocation,row=>`<tr><td data-label="Ubicación">${escapeHtml(row.name)}</td><td data-label="Total">${money(row.total)}</td><td data-label="Ventas">${row.sales}</td><td data-label="Productos">${row.items}</td><td data-label="Ticket promedio">${money(row.ticket)}</td></tr>`)}${metricsTable("Detalle por vendedor",["Vendedor","Total","Ventas","Productos","Ticket promedio"],metrics.bySeller,row=>`<tr><td data-label="Vendedor">${escapeHtml(row.name)}</td><td data-label="Total">${money(row.total)}</td><td data-label="Ventas">${row.sales}</td><td data-label="Productos">${row.items}</td><td data-label="Ticket promedio">${money(row.ticket)}</td></tr>`)}${metricsTable("Ranking de productos",["Producto","Unidades","Monto vendido","Ventas"],metrics.byProduct,row=>`<tr><td data-label="Producto">${escapeHtml(row.name)}</td><td data-label="Unidades">${row.items}</td><td data-label="Monto vendido">${money(row.total)}</td><td data-label="Ventas">${row.sales}</td></tr>`)}${metricsTable("Descuentos aplicados",["Descuento","Veces usado","Total descontado","Ventas asociadas"],metrics.byDiscount,row=>`<tr><td data-label="Descuento">${escapeHtml(row.name)}</td><td data-label="Veces usado">${row.sales}</td><td data-label="Total descontado">${money(row.total)}</td><td data-label="Ventas asociadas">${money(row.salesTotal||0)}</td></tr>`)}</div>`;
  return `${metrics.active.length||metrics.cancelled.length?"":`<div class="empty metrics-no-results">No hay ventas para los filtros seleccionados.</div>`}<div class="cards metrics-cards"><div class="card metric"><strong>${money(metrics.total)}</strong><span>Monto total vendido</span></div><div class="card metric"><strong>${metrics.salesCount}</strong><span>Ventas activas</span></div><div class="card metric"><strong>${money(metrics.ticket)}</strong><span>Ticket promedio</span></div><div class="card metric"><strong>${metrics.totalItems}</strong><span>Productos vendidos</span></div><div class="card metric"><strong>${money(metrics.discountTotal)}</strong><span>Descontado (${metrics.discountedSales} ventas)</span></div><div class="card metric"><strong>${metrics.cancelled.length}</strong><span>Ventas anuladas · ${money(metrics.cancelledTotal)}</span></div>${productCard}</div><div class="metrics-charts"><section class="card metrics-chart-wide"><h3>Evolución de ventas</h3><p class="muted">Monto vendido en el tiempo.</p>${lineChart(metrics.timeline)}</section><section class="card"><h3>Productos más vendidos</h3><p class="muted">Unidades vendidas según los filtros seleccionados.</p>${productUnitsChart(metrics.byProduct)}</section><section class="card"><h3>Formas de pago</h3><p class="muted">Distribución por montos cobrados.</p>${pieChart(metrics.byPayment)}</section></div>${tables}`;
}

async function loadMetricsSales(){
  if(!state)return;
  let range;try{range=buildMetricsDateRange(state.metrics.filters.period,state.metrics.filters.dateValue);}catch(error){state.metrics.error=error.message;renderMetrics();return;}
  const metricsState=state.metrics,requestId=++metricsState.requestId;metricsState.loading=true;metricsState.error="";renderMetrics();
  try{const sales=await listSalesByDateRange(range.start,range.end);if(state?.metrics.requestId===requestId){metricsState.sales=sales;metricsState.loaded=true;}}
  catch(error){if(state?.metrics.requestId===requestId){metricsState.sales=[];metricsState.loaded=true;metricsState.error=`No se pudieron cargar las métricas: ${error.message}`;}}
  finally{if(state?.metrics.requestId===requestId){metricsState.loading=false;if(state.section==="metrics")renderMetrics();}}
}

function renderMetrics(){
  const root=$("#admin-content",state.root),filters=state.metrics.filters;
  const context=metricsFilterContext(filters);filters.locationIds=context.locationSelection;filters.sellerIds=context.sellerSelection;delete filters.locationId;delete filters.sellerId;
  const range=buildMetricsDateRange(filters.period,filters.dateValue),details=metricsFilterDetails(filters,context),filtered=applyMetricsFilters(state.metrics.sales,details,range),metrics=hideUnavailableMetricRows(calculateMetrics(filtered,range,details));
  const products=state.products.filter(item=>item.active===true&&item.deleted!==true),discounts=state.discounts.filter(item=>item.active===true&&item.deleted!==true);
  const locationPicker=metricMultiPicker({id:"metrics-location",label:"Ubicaciones",allLabel:"Todas las ubicaciones",items:context.locations,selectedIds:context.locationSelection,emptyText:"No hay ubicaciones disponibles."});
  const sellerPicker=metricMultiPicker({id:"metrics-seller",label:"Vendedores",allLabel:"Todos los vendedores",items:context.sellers,selectedIds:context.sellerSelection,emptyText:"No hay vendedores asignados a las ubicaciones seleccionadas."});
  root.innerHTML=`<div class="page-head"><div><h1>Métricas</h1><p class="muted">Historial y análisis de ventas por fecha, ubicaciones, vendedores, producto y descuento.</p></div></div><section class="card metrics-filter-card"><div class="metrics-filters"><label>Período<select id="metrics-period"><option value="day" ${filters.period==="day"?"selected":""}>Día</option><option value="month" ${filters.period==="month"?"selected":""}>Mes</option><option value="year" ${filters.period==="year"?"selected":""}>Año</option></select></label><label>Fecha<span id="metrics-date-control">${metricsDateInput(filters.period,filters.dateValue)}</span></label>${locationPicker}<div id="metrics-seller-container">${sellerPicker}</div><label>Producto<select id="metrics-product">${metricOptions(products,{emptyLabel:"Todos los productos"})}</select></label><label>Descuento<select id="metrics-discount"><option value="">Todos los descuentos</option><option value="__none">Sin descuento</option>${[...discounts].sort((a,b)=>String(a.name||"").localeCompare(String(b.name||""))).map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name||"Sin nombre")}</option>`).join("")}</select></label></div><div class="metrics-filter-actions"><button id="metrics-clear" class="btn btn-ghost">Limpiar filtros</button><button id="metrics-apply" class="btn btn-primary">Aplicar filtros</button></div></section>${state.metrics.error?`<div class="seller-notice offline">${escapeHtml(state.metrics.error)}</div>`:""}${state.metrics.loading?`<div class="card empty">Cargando métricas…</div>`:metricsResultsHtml(metrics,details)}`;
  $("#metrics-product",root).value=filters.productId;$("#metrics-discount",root).value=filters.discountId;
  const bindSellerPicker=sellers=>bindMetricPicker(root,"metrics-seller",sellers);
  bindSellerPicker(context.sellers);
  bindMetricPicker(root,"metrics-location",context.locations,locationSelection=>{const locationIds=locationSelection.length?locationSelection:context.locations.map(item=>item.id),sellers=metricSellersForLocations(context.locations,state.users,state.metrics.sales,locationIds),previous=metricPickerValue(root,"metrics-seller"),valid=previous.filter(id=>sellers.some(seller=>seller.id===id));$("#metrics-seller-container",root).innerHTML=metricMultiPicker({id:"metrics-seller",label:"Vendedores",allLabel:"Todos los vendedores",items:sellers,selectedIds:valid,emptyText:"No hay vendedores asignados a las ubicaciones seleccionadas."});bindSellerPicker(sellers);});
  $("#metrics-period",root).onchange=event=>{$("#metrics-date-control",root).innerHTML=metricsDateInput(event.target.value,currentMetricsValue(event.target.value));};
  $("#metrics-apply",root).onclick=()=>{const period=$("#metrics-period",root).value,dateValue=$("#metrics-date-value",root).value;try{buildMetricsDateRange(period,dateValue);state.metrics.filters={period,dateValue,locationIds:metricPickerValue(root,"metrics-location"),sellerIds:metricPickerValue(root,"metrics-seller"),productId:$("#metrics-product",root).value,discountId:$("#metrics-discount",root).value};state.metrics.loaded=false;loadMetricsSales();}catch(error){toast(error.message,"error");}};
  $("#metrics-clear",root).onclick=()=>{state.metrics.filters={period:"month",dateValue:currentMetricsValue("month"),locationIds:[],sellerIds:[],productId:"",discountId:""};state.metrics.loaded=false;loadMetricsSales();};
  if(!state.metrics.loaded&&!state.metrics.loading)queueMicrotask(loadMetricsSales);
}

function renderLocations() {
  const sellers = activeSellers();
  const locations = visibleLocations();
  $("#admin-content", state.root).innerHTML = `<div class="page-head"><h1>Ubicaciones y eventos</h1><div class="actions"><button class="btn btn-primary" id="new-location">+ Nueva ubicación</button></div></div>
  <div class="table-wrap"><table class="responsive"><thead><tr><th>Nombre</th><th>Código</th><th>Fechas activas</th><th>Vendedores</th><th>Estado</th><th></th></tr></thead><tbody>${locations.map(location => {const activity=locationActivity(location),canPause=activity.active,canReactivate=!activity.active;return `<tr><td data-label="Nombre">${escapeHtml(location.name)}</td><td data-label="Código">${escapeHtml(location.codePrefix)}</td><td data-label="Fechas activas">${escapeHtml(locationDateRange(location))}</td><td data-label="Vendedores">${(location.assignedSellerIds||[]).map(id=>escapeHtml(sellers.find(s=>s.id===id)?.name||"?")).join(", ")||"—"}</td><td data-label="Estado">${locationStatusBadge(location)}</td><td data-label="Acciones"><div class="table-actions"><button class="btn btn-secondary btn-small" data-edit-location="${location.id}">Editar</button>${canPause?`<button class="btn btn-ghost btn-small" data-pause-location="${location.id}">Pausar</button>`:""}${canReactivate?`<button class="btn btn-primary btn-small" data-reactivate-location="${location.id}">Reactivar ubicación</button>`:""}<button class="btn btn-ghost btn-small" data-sales-location="${location.id}">Ventas</button><button class="btn btn-danger btn-small" data-delete-location="${location.id}">Eliminar ubicación</button></div></td></tr>`;}).join("") || `<tr><td colspan="6"><div class="empty">Creá la primera ubicación para empezar</div></td></tr>`}</tbody></table></div>`;
  $("#new-location").onclick = () => locationForm();
  $$('[data-edit-location]').forEach(button => button.onclick = () => locationForm(state.locations.find(item => item.id === button.dataset.editLocation)));
  $$('[data-pause-location]').forEach(button => button.onclick = () => pauseLocationForm(locations.find(item => item.id === button.dataset.pauseLocation)));
  $$('[data-reactivate-location]').forEach(button => button.onclick = () => reactivateLocationForm(locations.find(item => item.id === button.dataset.reactivateLocation)));
  $$('[data-sales-location]').forEach(button => button.onclick = () => { state.selectedLocationId=button.dataset.salesLocation; state.salesLimit=200; renderLocationSelector(); subscribeSelected(); switchSection("sales"); });
  $$('[data-delete-location]').forEach(button=>button.onclick=()=>deleteLocationForm(locations.find(item=>item.id===button.dataset.deleteLocation)));
}

function pauseLocationForm(location){
  const modal=openModal({title:"Pausar ubicación",content:`<p><strong>${escapeHtml(location.name)}</strong> quedará inactiva aunque sus fechas correspondan al día actual.</p><form id="pause-location-form"><label>Días inactiva<input name="days" type="number" min="1" step="1" inputmode="numeric" required value="1"><span class="form-hint">Al cumplirse ese plazo, se volverá a activar automáticamente si todavía está dentro de sus fechas.</span></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-secondary">Pausar ubicación</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;
  $("#pause-location-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;const data=formDataObject(event.currentTarget);const days=Number(data.days);if(!Number.isInteger(days)||days<1)return toast("Ingresá una cantidad de días válida","error");setBusy(button,true,"Pausando…");try{await pauseLocation(location.id,{days,user:state.profile});state.locations=await listLocations();ensureSelectedLocation();modal.close();renderLocations();toast("Ubicación pausada","success");}catch(error){toast(error.message,"error");setBusy(button,false);}};
}

function reactivateLocationForm(location){
  const nowInput=toLocalDateTimeInput(new Date());
  const defaultEnd=toLocalDateTimeInput(addDays(new Date(),1),"end");
  const modal=openModal({title:"Reactivar ubicación",content:`<p>Definí las nuevas fechas activas de <strong>${escapeHtml(location.name)}</strong>. Este período quedará guardado para futuras métricas.</p><form id="reactivate-location-form"><div class="form-grid"><label>Inicio<input name="startDateTime" type="datetime-local" required value="${escapeHtml(nowInput)}"></label><label>Fin<input name="endDateTime" type="datetime-local" required value="${escapeHtml(defaultEnd)}"></label></div><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Reactivar ubicación</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;
  $("#reactivate-location-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;setBusy(button,true,"Reactivando…");try{const data=formDataObject(event.currentTarget);const schedule=locationSchedulePayload(location,data,"reactivation");await saveLocation(location.id,{...schedule,active:true,manualInactiveUntil:null,manualInactiveUntilDateTime:"",manualInactiveDays:null,reactivatedAt:new Date(),reactivatedBy:state.profile.id,reactivatedByName:state.profile.name||"Administrador"});state.locations=await listLocations();ensureSelectedLocation();modal.close();renderLocations();toast("Ubicación reactivada","success");}catch(error){toast(error.message,"error");setBusy(button,false);}};
}

function deleteLocationForm(location){
  const modal=openModal({title:"Eliminar ubicación",content:`<p>Para eliminar <strong>${escapeHtml(location.name)}</strong>, confirmá tus credenciales. Sus ventas y stock se conservarán.</p><form id="delete-location-form"><label>Email del administrador<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button type="submit" class="btn btn-danger">Eliminar ubicación</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;
  $("#delete-location-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;const data=formDataObject(event.currentTarget);setBusy(button,true,"Verificando…");try{await reauthenticateAdmin(data.email,data.password);setBusy(button,true,"Eliminando…");await deleteLocationLogical(location.id,state.profile);state.locations=await listLocations();ensureSelectedLocation();modal.close();renderLocations();toast("Ubicación eliminada","success");}catch(error){const authMessage=error.code?.startsWith?.("auth/")?"Email o contraseña incorrectos":error.message;toast(authMessage,"error");setBusy(button,false);}};
}

function renderDeletedLocations(){const rows=deletedLocations();$("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Ubicaciones eliminadas</h1></div><div class="table-wrap"><table class="responsive"><thead><tr><th>Nombre</th><th>Código</th><th>Fechas</th><th>Eliminada</th><th></th></tr></thead><tbody>${rows.map(item=>`<tr><td data-label="Nombre">${escapeHtml(item.name)}</td><td data-label="Código">${escapeHtml(item.codePrefix)}</td><td data-label="Fechas">${escapeHtml(item.startDate||"—")} – ${escapeHtml(item.endDate||"—")}</td><td data-label="Eliminada">${dateTime(item.deletedAt)}</td><td data-label="Acciones"><button class="btn btn-primary btn-small" data-restore-location="${item.id}">Restaurar</button></td></tr>`).join("")||`<tr><td colspan="5"><div class="empty">No hay ubicaciones eliminadas</div></td></tr>`}</tbody></table></div>`;$$('[data-restore-location]').forEach(button=>button.onclick=async()=>{const item=rows.find(row=>row.id===button.dataset.restoreLocation);if(!await confirmDialog(`¿Restaurar ${item.name}?`))return;setBusy(button,true,"Restaurando…");try{await restoreLocation(item.id,state.profile);state.locations=await listLocations();ensureSelectedLocation();renderDeletedLocations();toast("Ubicación restaurada","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});}

function locationForm(location = {}) {
  const sellers = activeSellers();
  const startValue = toLocalDateTimeInput(location.scheduleStartAt || location.startDateTime || location.startDate, "start");
  const endValue = toLocalDateTimeInput(location.scheduleEndAt || location.endDateTime || location.endDate, "end");
  const enabledByAdmin = location.active !== false || (location.manualInactiveUntil && locationActivity(location).reason !== "paused");
  const modal = openModal({title:location.id ? "Editar ubicación" : "Nueva ubicación", content:`<form id="location-form"><div class="form-grid"><label>Nombre<input name="name" required value="${escapeHtml(location.name||"")}"></label><label>Código corto<input name="codePrefix" required maxlength="8" value="${escapeHtml(location.codePrefix||"")}" placeholder="FCOL"></label><label>Inicio activo<input name="startDateTime" type="datetime-local" value="${escapeHtml(startValue)}"><span class="form-hint">Si la fecha actual queda dentro del rango, se activa sola.</span></label><label>Fin activo<input name="endDateTime" type="datetime-local" value="${escapeHtml(endValue)}"><span class="form-hint">Cuando pasa esta fecha, queda inactiva automáticamente.</span></label><label class="span-2">Vendedores asignados<div class="check-list">${sellers.map(seller=>`<label><input type="checkbox" name="seller" value="${seller.id}" ${(location.assignedSellerIds||[]).includes(seller.id)?"checked":""}> ${escapeHtml(seller.name)}</label>`).join("")||"No hay vendedores creados"}</div></label><label class="span-2"><span><input id="location-active" style="width:auto;min-height:auto" type="checkbox" name="active" ${enabledByAdmin?"checked":""}> Ubicación habilitada</span><span class="form-hint">Si la destildás, indicá cuántos días quedará inactiva.</span></label><label class="span-2" id="manual-inactive-days-wrap" hidden>Días inactiva<input name="manualInactiveDays" type="number" min="1" step="1" inputmode="numeric" value="1"></label></div><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;
  const activeCheckbox=$("#location-active",modal.root),daysWrap=$("#manual-inactive-days-wrap",modal.root);
  const toggleDays=()=>{daysWrap.hidden=activeCheckbox.checked;};
  activeCheckbox.onchange=toggleDays;toggleDays();
  $("#location-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;setBusy(button,true);try{
    const data=formDataObject(event.currentTarget);
    const assignedSellerIds=$$('input[name=seller]:checked',event.currentTarget).map(input=>input.value);
    const schedule=locationSchedulePayload(location,data);
    const enabled=Boolean(data.active);
    const manualDays=Number(data.manualInactiveDays||0);
    const manualInactiveUntil=!enabled?addDays(new Date(),manualDays):null;
    if(!enabled&&(!Number.isInteger(manualDays)||manualDays<1))throw new Error("Indicá cuántos días quedará inactiva la ubicación");
    const id=await saveLocation(location.id,{name:data.name.trim(),codePrefix:data.codePrefix.trim().toUpperCase(),...schedule,active:enabled,manualInactiveUntil,manualInactiveUntilDateTime:manualInactiveUntil?toLocalDateTimeInput(manualInactiveUntil):"",manualInactiveDays:manualInactiveUntil?manualDays:null,manualInactiveAt:manualInactiveUntil?new Date():null,assignedSellerIds});
    for(const seller of sellers){const ids=new Set(seller.allowedLocationIds||[]);assignedSellerIds.includes(seller.id)?ids.add(id):ids.delete(id);await saveUser(seller.id,{allowedLocationIds:[...ids]});seller.allowedLocationIds=[...ids];}
    state.locations=await listLocations();state.selectedLocationId ||= id;renderLocationSelector();subscribeSelected();modal.close();renderLocations();toast("Ubicación guardada","success");
  }catch(error){toast(error.message,"error");setBusy(button,false);}};
}

function renderProducts() {
  const products=state.products.filter(item=>item.deleted!==true);
  const groups=groupByCategory(products,state.productCategories,{includeEmpty:true});
  $("#admin-content", state.root).innerHTML=`<div class="page-head"><div><h1>Productos</h1><p class="muted">Organizá productos por categorías. Los productos viejos sin categoría aparecen en “${UNCATEGORIZED_NAME}”.</p></div><div class="actions"><button class="btn btn-secondary" id="new-category">+ Crear categoría</button><button class="btn btn-primary" id="new-product">+ Nuevo producto</button></div></div><div class="category-groups">${groups.map(group=>{const active=group.items.filter(item=>item.active===true).length,inactive=group.items.length-active;return `<details class="card category-group" ${group.items.length?"open":""}><summary><span>${escapeHtml(group.name)}</span><small>${group.items.length} productos · ${active} activos${inactive?` · ${inactive} inactivos`:""}</small><button type="button" class="btn btn-primary btn-small" data-new-product-category="${group.id}">+ Producto</button>${group.id!==UNCATEGORIZED_ID?`<button type="button" class="btn btn-ghost btn-small" data-edit-category="${group.id}">Editar categoría</button>`:""}</summary>${productTable(group.items)}</details>`;}).join("")}</div>`;
  $("#new-category").onclick=()=>categoryForm();
  $("#new-product").onclick=()=>productForm();
  $$('[data-new-product-category]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();productForm({},button.dataset.newProductCategory===UNCATEGORIZED_ID?"":button.dataset.newProductCategory);});
  $$('[data-edit-category]').forEach(button=>button.onclick=event=>{event.preventDefault();event.stopPropagation();categoryForm(state.productCategories.find(item=>item.id===button.dataset.editCategory));});
  $$('[data-edit-product]').forEach(button=>button.onclick=()=>productForm(products.find(item=>item.id===button.dataset.editProduct)));
  $$('[data-delete-product]').forEach(button=>button.onclick=async()=>{const product=products.find(item=>item.id===button.dataset.deleteProduct);if(!await confirmDialog("¿Querés eliminar este producto?"))return;setBusy(button,true,"Eliminando…");try{await deleteProductLogical(product.id,state.profile);state.products=await listProducts();renderProducts();toast("Producto eliminado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
}

function categoryForm(category={}) {
  const modal=openModal({title:category.id?"Editar categoría":"Crear categoría",content:`<form id="category-form"><label>Nombre de categoría<input name="name" required value="${escapeHtml(category.name||"")}"></label><label>Descripción<textarea name="description">${escapeHtml(category.description||"")}</textarea></label><label>Orden<input name="sortOrder" type="number" step="1" inputmode="numeric" value="${Number(category.sortOrder||0)}"><span class="form-hint">Menor número aparece primero.</span></label><label><span><input style="width:auto;min-height:auto" type="checkbox" name="active" ${category.active!==false?"checked":""}> Categoría activa</span></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Guardar categoría</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;
  $("#category-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;const data=formDataObject(event.currentTarget);if(!data.name.trim())return toast("Ingresá el nombre de la categoría","error");setBusy(button,true);try{await saveProductCategory(category.id,{name:data.name,description:data.description,sortOrder:data.sortOrder,active:Boolean(data.active),deleted:false});state.productCategories=await listProductCategories();modal.close();renderProducts();toast("Categoría guardada","success");}catch(error){toast(error.message,"error");setBusy(button,false);}};
}

function renderDeletedProducts(){const products=deletedProducts();$("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Productos eliminados</h1></div><div class="table-wrap"><table class="responsive"><thead><tr><th></th><th>Producto</th><th>Abrev.</th><th>Precio</th><th>Eliminado</th><th></th></tr></thead><tbody>${products.map(item=>`<tr><td data-label="Imagen"><img class="thumb" loading="lazy" src="${imageOrPlaceholder(item.thumbUrl,item.abbreviation)}" alt=""></td><td data-label="Producto">${escapeHtml(item.name)}</td><td data-label="Abrev.">${escapeHtml(item.abbreviation)}</td><td data-label="Precio">${money(item.defaultPrice)}</td><td data-label="Eliminado">${dateTime(item.deletedAt)}</td><td data-label="Acciones"><button class="btn btn-primary btn-small" data-restore-product="${item.id}">Restaurar producto</button></td></tr>`).join("")||`<tr><td colspan="6"><div class="empty">No hay productos eliminados</div></td></tr>`}</tbody></table></div>`;$$('[data-restore-product]').forEach(button=>button.onclick=async()=>{const item=products.find(row=>row.id===button.dataset.restoreProduct);if(!await confirmDialog(`¿Restaurar ${item.name}?`))return;setBusy(button,true,"Restaurando…");try{await restoreProduct(item.id,state.profile);state.products=await listProducts();renderDeletedProducts();toast("Producto restaurado. Volvé a agregarlo al stock de cada ubicación.","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});}

function productForm(product={}, defaultCategoryId="") {
  let recorded={buttonKey:product.buttonKey||"",buttonCode:product.buttonCode||"",buttonLocation:product.buttonLocation??0,buttonLabel:product.buttonLabel||""};
  let stopRecording=null;
  const currentCatalogImage=state.productImages.find(item=>item.imageUrl===product.imageUrl);
  const legacyImage=product.imageUrl&&!currentCatalogImage?`<label class="image-choice"><input type="radio" name="imageId" value="__current" checked><span class="image-choice-card"><img src="${imageOrPlaceholder(product.thumbUrl||product.imageUrl)}" alt=""><small>Imagen actual</small></span></label>`:"";
  const catalogChoices=state.productImages.map(item=>`<label class="image-choice"><input type="radio" name="imageId" value="${escapeHtml(item.id)}" ${currentCatalogImage?.id===item.id?"checked":""}><span class="image-choice-card"><img src="${imageOrPlaceholder(item.thumbUrl)}" alt=""><small>${escapeHtml(item.name)}</small></span></label>`).join("");
  const selectedCategoryId=product.categoryId||defaultCategoryId||"";
  const modal=openModal({title:product.id?"Editar producto":"Nuevo producto",onClose:()=>stopRecording?.(),content:`<form id="product-form"><div class="form-grid"><label>Nombre<input name="name" required value="${escapeHtml(product.name||"")}"></label><label>Abreviación<input name="abbreviation" required maxlength="8" value="${escapeHtml(product.abbreviation||"")}"></label><label class="span-2">Categoría<select name="categoryId">${categoryOptions(selectedCategoryId)}</select><span class="form-hint">Si no elegís una, queda en “${UNCATEGORIZED_NAME}”.</span></label><label class="span-2">Descripción<textarea name="description">${escapeHtml(product.description||"")}</textarea></label><label>Precio por defecto<input name="defaultPrice" type="number" min="0" step="1" inputmode="numeric" required value="${Math.round(Number(product.defaultPrice||0))}"><span class="form-hint">Sólo números enteros, sin coma ni decimales.</span></label><fieldset class="span-2 image-picker-field"><legend>Imagen del catálogo</legend><div class="image-picker"><label class="image-choice"><input type="radio" name="imageId" value="" ${!product.imageUrl?"checked":""}><span class="image-choice-card no-image"><strong>FM</strong><small>Sin imagen</small></span></label>${legacyImage}${catalogChoices}</div><p class="form-hint">Las imágenes están guardadas dentro de la web; Firestore sólo conserva la ruta elegida.</p></fieldset><div class="span-2 card"><strong>Botonera</strong><p id="recorded-key" class="muted">${recorded.buttonLabel?`Tecla guardada: ${escapeHtml(recorded.buttonLabel)}`:"Sin tecla asignada"}</p><button type="button" class="btn btn-secondary" id="record-key">Grabar tecla</button> <button type="button" class="btn btn-ghost" id="clear-key">Quitar tecla</button></div><label class="span-2"><span><input style="width:auto;min-height:auto" type="checkbox" name="active" ${product.active!==false?"checked":""}> Producto activo</span></label></div><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;
  const imageHint=$(".image-picker-field .form-hint",modal.root);if(imageHint)imageHint.textContent="Imágenes locales recomendadas: WebP o JPG, vertical/cuadrada, hasta 1080×1920 y preferentemente menos de 500 KB. Firestore sólo guarda la ruta.";
  $("#clear-key",modal.root).onclick=()=>{recorded={buttonKey:"",buttonCode:"",buttonLocation:0,buttonLabel:""};$("#recorded-key",modal.root).textContent="Sin tecla asignada";};
  $("#record-key",modal.root).onclick=event=>{const button=event.currentTarget;button.disabled=true;button.textContent="Esperando una tecla…";$("#recorded-key",modal.root).textContent="Presioná la tecla de la botonera que querés asignar a este producto";stopRecording=recordNextKey({onRecorded:key=>{stopRecording=null;recorded=key;button.disabled=false;button.textContent="Grabar tecla";$("#recorded-key",modal.root).textContent=`Tecla guardada: ${key.buttonLabel}`;},onCancel:()=>{stopRecording=null;button.disabled=false;button.textContent="Grabar tecla";const label=$("#recorded-key",modal.root);if(label)label.textContent=recorded.buttonLabel?`Tecla guardada: ${recorded.buttonLabel}`:"Sin tecla asignada";}});};
  $("#product-form",modal.root).onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const button=event.submitter||$('button[type="submit"]',form);
    const data=formDataObject(form);
    setBusy(button,true);
    try{
      const abbreviation=data.abbreviation.trim().toUpperCase();
      if(abbreviation.length>8)throw new Error("La abreviación admite hasta 8 caracteres");
      if(!Number.isInteger(Number(data.defaultPrice)))throw new Error("El precio debe ser un número entero");
      const selectedImage=data.imageId==="__current"?{imageUrl:product.imageUrl||"",thumbUrl:product.thumbUrl||""}:state.productImages.find(item=>item.id===data.imageId);
      const category=categoryPayload(data.categoryId,state.productCategories);
      await saveProduct(product.id,{name:data.name.trim(),abbreviation,description:data.description.trim(),defaultPrice:Number(data.defaultPrice),...category,active:Boolean(data.active),deleted:false,...recorded,imageUrl:selectedImage?.imageUrl||"",thumbUrl:selectedImage?.thumbUrl||""});
      state.products=await listProducts();modal.close();renderProducts();toast("Producto guardado","success");
    }catch(error){toast(error.message,"error");setBusy(button,false);}
  };
}

function renderStock() {
  const configured=new Map(state.stock.map(item=>[item.id,item]));
  const products=state.products.filter(product=>product.deleted!==true&&(product.active===true||configured.has(product.id))).map(product=>({...product,stockItem:configured.get(product.id)}));
  const groups=groupByCategory(products,state.productCategories,{includeEmpty:true});
  const stockTable=items=>`<div class="table-wrap"><table class="responsive"><thead><tr><th>Producto</th><th>Precio</th><th>Inicial</th><th>Actual</th><th>Alertas</th><th>Tecla</th><th>Estado</th><th></th></tr></thead><tbody>${items.map(product=>{const item=product.stockItem,exists=Boolean(item);return `<tr><td data-label="Producto">${escapeHtml(product.name||item?.productName)}${product.active===false?` <span class="badge">Producto inactivo</span>`:""}</td><td data-label="Precio">${exists?money(item.price):"—"}</td><td data-label="Inicial">${exists?item.initialStock:"—"}</td><td data-label="Actual">${exists?`<strong>${item.currentStock}</strong>`:"Sin cargar"}</td><td data-label="Alertas">${exists?`<span class="badge warning">${item.yellowAlertQty}</span> <span class="badge danger">${item.redAlertQty}</span>`:"—"}</td><td data-label="Tecla">${escapeHtml(item?.buttonLabel||product.buttonLabel||"—")}</td><td data-label="Estado">${exists?`<span class="badge ${item.active?"ok":""}">${item.active?"Activo":"Inactivo"}</span>`:`<span class="badge">Sin stock</span>`}</td><td data-label="Acciones"><div class="table-actions"><button class="btn btn-secondary btn-small" data-config-stock-product="${product.id}">${exists?"Configurar":"Cargar stock"}</button>${exists?`<button class="btn btn-primary btn-small" data-add-stock="${product.id}">Mercadería</button><button class="btn btn-danger btn-small" data-delete-stock="${product.id}">Eliminar stock</button>`:""}</div></td></tr>`;}).join("")||`<tr><td colspan="8"><div class="empty">No hay productos en esta categoría</div></td></tr>`}</tbody></table></div>`;
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Cargar Stock · ${escapeHtml(currentLocation()?.name||"Sin ubicación")}</h1><div class="actions"><button class="btn btn-primary" id="configure-product" ${currentLocation()?"":"disabled"}>+ Agregar/configurar producto</button></div></div>${alertHtml()}<div class="category-groups">${groups.map(group=>`<details class="card category-group" ${group.items.length?"open":""}><summary><span>${escapeHtml(group.name)}</span><small>${group.items.length} productos</small></summary>${stockTable(group.items)}</details>`).join("")}</div>`;
  $("#configure-product").onclick=()=>stockForm();
  $$('[data-config-stock-product]').forEach(button=>button.onclick=()=>stockForm(configured.get(button.dataset.configStockProduct)||null,button.dataset.configStockProduct));
  $$('[data-add-stock]').forEach(button=>button.onclick=()=>stockAddForm(configured.get(button.dataset.addStock)));
  $$('[data-delete-stock]').forEach(button=>button.onclick=async()=>{const item=configured.get(button.dataset.deleteStock);if(!await confirmDialog("¿Querés eliminar este stock? Si volvés a cargar este producto en la ubicación, empezará desde stock inicial 0."))return;setBusy(button,true,"Eliminando…");try{await deleteLocationStock({locationId:state.selectedLocationId,productId:item.id,user:state.profile});toast("Stock eliminado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
}

function stockForm(stockItem=null, defaultProductId="") {
  const product=stockItem?state.products.find(p=>p.id===stockItem.id):state.products.find(p=>p.id===defaultProductId);
  const products=stockItem&&product&&!activeProducts().some(p=>p.id===product.id)?[product,...activeProducts()]:activeProducts();
  if(!products.length)return toast("Primero creá un producto activo","error");
  const selectedProduct=product||products[0];
  const modal=openModal({title:stockItem?"Configurar stock":"Agregar producto a la ubicación",content:`<form id="stock-form"><label>Producto<select name="productId" id="stock-product-select" ${stockItem?"disabled":""}>${products.map(p=>`<option value="${p.id}" ${p.id===selectedProduct?.id?"selected":""}>${escapeHtml(p.name)} · ${escapeHtml(groupByCategory([p],state.productCategories)[0]?.name||UNCATEGORIZED_NAME)}</option>`).join("")}</select></label><div class="form-grid"><label>Stock inicial<input name="initialStock" type="number" min="0" step="1" required value="${Number(stockItem?.initialStock||0)}">${stockItem?`<span class="form-hint">Si lo corregís, el stock actual se ajustará por la misma diferencia.</span>`:""}</label><label>Precio en esta ubicación<input id="stock-price-input" name="price" type="number" min="0" step="1" inputmode="numeric" required value="${Math.round(Number(stockItem?.price??selectedProduct?.defaultPrice??0))}"></label><label>Alerta amarilla<input name="yellowAlertQty" type="number" min="0" step="1" required value="${Number(stockItem?.yellowAlertQty||0)}"></label><label>Alerta roja<input name="redAlertQty" type="number" min="0" step="1" required value="${Number(stockItem?.redAlertQty||0)}"></label><label class="span-2"><span><input style="width:auto;min-height:auto" type="checkbox" name="active" ${stockItem?.active!==false?"checked":""}> Disponible para vender</span></label></div><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;
  $("#stock-product-select",modal.root)?.addEventListener("change",event=>{if(stockItem)return;const selected=state.products.find(p=>p.id===event.target.value);const price=$("#stock-price-input",modal.root);if(price)price.value=Math.round(Number(selected?.defaultPrice||0));});
  $("#stock-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;setBusy(button,true);try{
    const data=formDataObject(event.currentTarget);const selected=stockItem?product:state.products.find(p=>p.id===data.productId);if(!selected)throw new Error("Elegí un producto");
    const initialStock=Number(data.initialStock),price=Number(data.price),yellowAlertQty=Number(data.yellowAlertQty),redAlertQty=Number(data.redAlertQty);
    if(!Number.isInteger(initialStock)||initialStock<0)throw new Error("El stock inicial debe ser un número entero mayor o igual a cero");
    if(!Number.isInteger(price)||price<0)throw new Error("El precio debe ser un número entero mayor o igual a cero");
    if(!Number.isInteger(yellowAlertQty)||yellowAlertQty<0||!Number.isInteger(redAlertQty)||redAlertQty<0)throw new Error("Las alertas deben ser números enteros mayores o iguales a cero");
    if(!stockItem&&state.stock.some(item=>item.id===selected.id))throw new Error("Ese producto ya está cargado");if(yellowAlertQty<redAlertQty)throw new Error("La alerta amarilla debe ser mayor o igual a la roja");
    const candidateCode=selected.buttonCode,candidateKey=selected.buttonKey;if(Boolean(data.active)&&state.stock.some(item=>item.id!==selected.id&&item.active&&((candidateCode&&item.buttonCode===candidateCode)||(candidateKey&&item.buttonKey===candidateKey))))throw new Error("Esa tecla ya está asignada a otro producto activo en la ubicación");
    await configureStock({locationId:state.selectedLocationId,product:selected,values:{initialStock,price,yellowAlertQty,redAlertQty,active:Boolean(data.active),buttonKey:selected.buttonKey,buttonCode:selected.buttonCode,buttonLabel:selected.buttonLabel},user:state.profile});modal.close();toast("Stock configurado","success");
  }catch(error){toast(error.message,"error");setBusy(button,false);}};
}

function stockAddForm(item) {
  let qty=1;const modal=openModal({title:"Agregar mercadería",content:`<p><strong>${escapeHtml(item.productName)}</strong><br><span class="muted">Stock actual: ${item.currentStock}</span></p><form id="add-stock-form"><label>Cantidad<div class="qty-control"><button type="button" id="qty-minus">−</button><input id="stock-qty" name="qty" type="number" min="1" step="1" value="1"><button type="button" id="qty-plus">+</button></div></label><label>Motivo<input name="reason" value="Ingreso de mercadería"></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Confirmar</button></div></form>`});
  const input=$("#stock-qty",modal.root);$("#qty-minus",modal.root).onclick=()=>input.value=Math.max(1,Number(input.value)-1);$("#qty-plus",modal.root).onclick=()=>input.value=Number(input.value)+1;$(".modal-cancel",modal.root).onclick=modal.close;$("#add-stock-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;setBusy(button,true);try{const data=formDataObject(event.currentTarget);qty=Number(data.qty);if(qty<=0)throw new Error("Ingresá una cantidad mayor a cero");await addStock({locationId:state.selectedLocationId,productId:item.id,qty,reason:data.reason,user:state.profile});modal.close();toast("Mercadería agregada","success");}catch(error){toast(error.message,"error");setBusy(button,false);}};
}

function renderSellers() {
  const sellers=activeSellers();
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Vendedores</h1><div class="actions"><button class="btn btn-primary" id="new-seller">+ Nuevo vendedor</button></div></div><div class="table-wrap"><table class="responsive"><thead><tr><th>Nombre</th><th>Email</th><th>Ubicaciones</th><th>Estado</th><th></th></tr></thead><tbody>${sellers.map(seller=>`<tr><td data-label="Nombre">${escapeHtml(seller.name)}</td><td data-label="Email">${escapeHtml(seller.email)}</td><td data-label="Ubicaciones">${(seller.allowedLocationIds||[]).map(id=>{const location=visibleLocations().find(l=>l.id===id);return escapeHtml(location?`${location.name}${isLocationActiveNow(location)?"":" (inactiva)"}`:"?");}).join(", ")||"—"}</td><td data-label="Estado"><span class="badge ok">Activo</span></td><td data-label="Acciones"><div class="table-actions"><button class="btn btn-secondary btn-small" data-edit-seller="${seller.id}">Editar</button><button class="btn btn-ghost btn-small" data-view-seller="${seller.id}">Ventas</button><button class="btn btn-danger btn-small" data-delete-seller="${seller.id}">Eliminar vendedor</button></div></td></tr>`).join("")||`<tr><td colspan="5"><div class="empty">No hay vendedores activos</div></td></tr>`}</tbody></table></div>`;
  $("#new-seller").onclick=()=>sellerForm();$$('[data-edit-seller]').forEach(button=>button.onclick=()=>sellerForm(sellers.find(item=>item.id===button.dataset.editSeller)));$$('[data-view-seller]').forEach(button=>button.onclick=()=>sellerSales(button.dataset.viewSeller));$$('[data-delete-seller]').forEach(button=>button.onclick=async()=>{const seller=sellers.find(item=>item.id===button.dataset.deleteSeller);if(!await confirmDialog("¿Querés eliminar este vendedor?"))return;setBusy(button,true,"Eliminando…");try{await deleteSellerLogical(seller.id,state.profile);[state.users,state.locations]=await Promise.all([listUsers(),listLocations()]);renderSellers();toast("Vendedor eliminado y accesos retirados","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
}

function sellerForm(seller={}) {
  const locations=visibleLocations();
  const modal=openModal({title:seller.id?"Editar vendedor":"Nuevo vendedor",content:`<form id="seller-form"><label>Nombre<input name="name" required value="${escapeHtml(seller.name||"")}"></label><label>Email<input name="email" type="email" required value="${escapeHtml(seller.email||"")}" ${seller.id?"disabled":""}></label>${seller.id?"":`<label>Contraseña temporal<input name="password" type="password" minlength="6" required><span class="form-hint">El vendedor la usará para su primer ingreso.</span></label>`}<label>Ubicaciones<div class="check-list">${locations.map(location=>`<label><input type="checkbox" name="location" value="${location.id}" ${(seller.allowedLocationIds||[]).includes(location.id)?"checked":""}> ${escapeHtml(location.name)}${isLocationActiveNow(location)?"":" · inactiva"}</label>`).join("")||"Primero creá una ubicación"}</div></label><label><span><input style="width:auto;min-height:auto" type="checkbox" name="active" ${seller.active!==false?"checked":""}> Usuario activo</span></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`});
  $(".modal-cancel",modal.root).onclick=modal.close;$("#seller-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;setBusy(button,true);try{const data=formDataObject(event.currentTarget);const allowedLocationIds=$$('input[name=location]:checked',event.currentTarget).map(input=>input.value);let id=seller.id;if(id){await saveUser(id,{name:data.name.trim(),active:Boolean(data.active),allowedLocationIds});}else{id=await createSellerAccount({name:data.name.trim(),email:data.email.trim(),password:data.password,active:Boolean(data.active),allowedLocationIds});}await syncSellerAssignments(id,allowedLocationIds);[state.users,state.locations]=await Promise.all([listUsers(),listLocations()]);renderLocationSelector();modal.close();renderSellers();toast("Vendedor guardado","success");}catch(error){const message=error.code==="auth/email-already-in-use"?"Ese email ya está registrado":error.message;toast(message,"error");setBusy(button,false);}};
}

function sellerMetricsHtml(sales){const active=sales.filter(sale=>sale.status==="active");const total=active.reduce((sum,sale)=>sum+Number(sale.total||0),0);const items=active.reduce((sum,sale)=>sum+Number(sale.totalItems||0),0);return `<div class="cards"><div class="card metric"><strong>${money(total)}</strong><span>Total vendido</span></div><div class="card metric"><strong>${active.length}</strong><span>Ventas activas</span></div><div class="card metric"><strong>${items}</strong><span>Productos vendidos</span></div><div class="card metric"><strong>${money(active.length?total/active.length:0)}</strong><span>Ticket promedio</span></div></div>`;}

async function sellerSales(sellerId){
  const seller=state.users.find(u=>u.id===sellerId);
  try{
    const sales=await listSellerSales(sellerId,500);
    const modal=openModal({title:`Ventas · ${seller.name}`,wide:true,content:`${sellerMetricsHtml(sales)}<div style="height:13px"></div>${salesTable(sales)}`});
    $$('[data-sale-detail]',modal.root).forEach(button=>button.onclick=()=>saleDetail(sales.find(s=>s.id===button.dataset.saleDetail)));
    $$('[data-delete-sale]',modal.root).forEach(button=>button.onclick=async()=>{
      const sale=sales.find(s=>s.id===button.dataset.deleteSale);
      if(!await confirmDialog("¿Querés anular esta venta? Se devolverán las unidades al stock."))return;
      try{await deleteSaleTransaction({saleId:sale.id,user:state.profile});toast("Venta anulada y stock devuelto","success");await sellerSales(sellerId);}catch(error){toast(error.message,"error");}
    });
  }catch(error){toast(error.message,"error");}
}

function renderDiscounts() {
  const discounts=activeDiscounts();
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Descuentos</h1><div class="actions"><button class="btn btn-primary" id="new-discount">+ Nuevo descuento</button></div></div><div class="table-wrap"><table class="responsive"><thead><tr><th>Nombre</th><th>Tipo</th><th>Valor</th><th>Estado</th><th></th></tr></thead><tbody>${discounts.map(item=>`<tr><td data-label="Nombre">${escapeHtml(item.name)}</td><td data-label="Tipo">${item.type==="percent"?"Porcentaje":"Monto fijo"}</td><td data-label="Valor">${item.type==="percent"?`${item.value}%`:money(item.value)}</td><td data-label="Estado"><span class="badge ok">Activo</span></td><td data-label="Acciones"><div class="table-actions"><button class="btn btn-secondary btn-small" data-edit-discount="${item.id}">Editar</button><button class="btn btn-danger btn-small" data-delete-discount="${item.id}">Eliminar descuento</button></div></td></tr>`).join("")||`<tr><td colspan="5"><div class="empty">No hay descuentos activos</div></td></tr>`}</tbody></table></div>`;
  $("#new-discount").onclick=()=>discountForm();$$('[data-edit-discount]').forEach(button=>button.onclick=()=>discountForm(discounts.find(item=>item.id===button.dataset.editDiscount)));$$('[data-delete-discount]').forEach(button=>button.onclick=async()=>{const item=discounts.find(row=>row.id===button.dataset.deleteDiscount);if(!await confirmDialog("¿Querés eliminar este descuento?"))return;setBusy(button,true,"Eliminando…");try{await deleteDiscountLogical(item.id,state.profile);state.discounts=await listDiscounts();renderDiscounts();toast("Descuento eliminado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
}

function renderDeletedDiscounts(){const discounts=deletedDiscounts();$("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Descuentos eliminados</h1></div><div class="table-wrap"><table class="responsive"><thead><tr><th>Nombre</th><th>Tipo</th><th>Valor</th><th>Eliminado</th><th></th></tr></thead><tbody>${discounts.map(item=>`<tr><td data-label="Nombre">${escapeHtml(item.name)}</td><td data-label="Tipo">${item.type==="percent"?"Porcentaje":"Monto fijo"}</td><td data-label="Valor">${item.type==="percent"?`${item.value}%`:money(item.value)}</td><td data-label="Eliminado">${dateTime(item.deletedAt)}</td><td data-label="Acciones"><button class="btn btn-primary btn-small" data-restore-discount="${item.id}">Restaurar descuento</button></td></tr>`).join("")||`<tr><td colspan="5"><div class="empty">No hay descuentos eliminados</div></td></tr>`}</tbody></table></div>`;$$('[data-restore-discount]').forEach(button=>button.onclick=async()=>{const item=discounts.find(row=>row.id===button.dataset.restoreDiscount);if(!await confirmDialog(`¿Restaurar ${item.name}?`))return;setBusy(button,true,"Restaurando…");try{await restoreDiscount(item.id,state.profile);state.discounts=await listDiscounts();renderDeletedDiscounts();toast("Descuento restaurado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});}

function discountForm(item={}){const modal=openModal({title:item.id?"Editar descuento":"Nuevo descuento",content:`<form id="discount-form"><label>Nombre<input name="name" required value="${escapeHtml(item.name||"")}"></label><label>Tipo<select name="type"><option value="fixed" ${item.type!=="percent"?"selected":""}>Monto fijo</option><option value="percent" ${item.type==="percent"?"selected":""}>Porcentaje</option></select></label><label>Valor entero<input name="value" type="number" min="0" step="1" inputmode="numeric" required value="${Math.round(Number(item.value||0))}"></label><label><span><input style="width:auto;min-height:auto" type="checkbox" name="active" ${item.active!==false?"checked":""}> Descuento activo</span></label><div class="modal-actions"><button type="button" class="btn btn-ghost modal-cancel">Cancelar</button><button class="btn btn-primary">Guardar</button></div></form>`});$(".modal-cancel",modal.root).onclick=modal.close;$("#discount-form",modal.root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;setBusy(button,true);try{const data=formDataObject(event.currentTarget);if(!Number.isInteger(Number(data.value)))throw new Error("El descuento debe ser un número entero");if(data.type==="percent"&&Number(data.value)>100)throw new Error("El porcentaje no puede superar 100");await saveDiscount(item.id,{name:data.name.trim(),type:data.type,value:Number(data.value),active:Boolean(data.active)});state.discounts=await listDiscounts();modal.close();renderDiscounts();toast("Descuento guardado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}};}

function salesTable(sales) {return `<div class="table-wrap"><table class="responsive"><thead><tr><th>Código</th><th>Fecha</th><th>Vendedor</th><th>Productos</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>${sales.map(sale=>`<tr><td data-label="Código">${escapeHtml(sale.saleCode)}</td><td data-label="Fecha">${dateTime(sale.createdAt)}</td><td data-label="Vendedor">${escapeHtml(sale.sellerName)}</td><td data-label="Productos">${sale.totalItems}</td><td data-label="Total"><strong>${money(sale.total)}</strong></td><td data-label="Estado"><span class="badge ${sale.status==="active"?"ok":"danger"}">${sale.status==="active"?"Activa":"Anulada"}</span></td><td data-label="Acciones"><button class="btn btn-ghost btn-small" data-sale-detail="${sale.id}">Ver</button>${sale.status==="active"?`<button class="btn btn-danger btn-small" data-delete-sale="${sale.id}">Anular</button>`:""}</td></tr>`).join("")||`<tr><td colspan="7"><div class="empty">No hay ventas</div></td></tr>`}</tbody></table></div>`;}

function renderSales(){
  const activeSales=state.sales.filter(sale=>sale.status==="active");
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Ventas · ${escapeHtml(currentLocation()?.name||"Sin ubicación")}</h1><div class="actions"><span class="badge info">Tiempo real</span></div></div>${salesTable(activeSales)}${state.sales.length>=state.salesLimit?`<div class="actions" style="margin-top:12px"><button id="load-more-sales" class="btn btn-secondary">Cargar más ventas</button></div>`:""}`;
  $$('[data-sale-detail]').forEach(button=>button.onclick=()=>saleDetail(activeSales.find(s=>s.id===button.dataset.saleDetail)));
  $$('[data-delete-sale]').forEach(button=>button.onclick=async()=>{const sale=activeSales.find(s=>s.id===button.dataset.deleteSale);if(await confirmDialog("¿Querés anular esta venta? Se devolverán las unidades al stock.")){setBusy(button,true,"Anulando…");try{await deleteSaleTransaction({saleId:sale.id,user:state.profile});toast("Venta anulada y stock devuelto","success");}catch(error){toast(error.message,"error");setBusy(button,false);}}});
  $("#load-more-sales",state.root)?.addEventListener("click",event=>{state.salesLimit+=200;setBusy(event.currentTarget,true,"Cargando…");subscribeSelected();});
}

function renderCancelledSales(){
  const cancelled=state.sales.filter(sale=>["cancelled","deleted"].includes(sale.status));
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><div><h1>Ventas anuladas · ${escapeHtml(currentLocation()?.name||"Sin ubicación")}</h1><p class="muted">Restaurar una venta vuelve a descontar sus productos del stock.</p></div><div class="actions"><span class="badge danger">${cancelled.length} anuladas</span></div></div><div class="table-wrap"><table class="responsive"><thead><tr><th>Código</th><th>Fecha</th><th>Vendedor</th><th>Productos</th><th>Total</th><th>Anulada</th><th></th></tr></thead><tbody>${cancelled.map(sale=>`<tr><td data-label="Código">${escapeHtml(sale.saleCode)}</td><td data-label="Fecha">${dateTime(sale.createdAt)}</td><td data-label="Vendedor">${escapeHtml(sale.sellerName)}</td><td data-label="Productos">${sale.totalItems}</td><td data-label="Total"><strong>${money(sale.total)}</strong></td><td data-label="Anulada">${dateTime(sale.cancelledAt||sale.deletedAt)}</td><td data-label="Acciones"><div class="table-actions"><button class="btn btn-ghost btn-small" data-cancelled-detail="${sale.id}">Ver</button><button class="btn btn-primary btn-small" data-restore-sale="${sale.id}">Restaurar venta</button></div></td></tr>`).join("")||`<tr><td colspan="7"><div class="empty">No hay ventas anuladas en esta ubicación</div></td></tr>`}</tbody></table></div>${state.sales.length>=state.salesLimit?`<div class="actions" style="margin-top:12px"><button id="load-more-cancelled-sales" class="btn btn-secondary">Cargar más ventas</button></div>`:""}`;
  $$('[data-cancelled-detail]').forEach(button=>button.onclick=()=>saleDetail(cancelled.find(sale=>sale.id===button.dataset.cancelledDetail)));
  $$('[data-restore-sale]').forEach(button=>button.onclick=async()=>{const sale=cancelled.find(item=>item.id===button.dataset.restoreSale);if(!await confirmDialog("¿Querés restaurar esta venta? Se volverán a descontar las unidades del stock."))return;setBusy(button,true,"Restaurando…");try{await restoreSaleTransaction({saleId:sale.id,user:state.profile});toast("Venta restaurada y stock actualizado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
  $("#load-more-cancelled-sales",state.root)?.addEventListener("click",event=>{state.salesLimit+=200;setBusy(event.currentTarget,true,"Cargando…");subscribeSelected();});
}

function renderDeletedItems(){
  const locations=deletedLocations(),products=deletedProducts(),discounts=deletedDiscounts(),cancelled=state.sales.filter(sale=>["cancelled","deleted"].includes(sale.status));
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><div><h1>Items Eliminados</h1><p class="muted">Elementos recuperables e historial anulado de ${escapeHtml(currentLocation()?.name||"la ubicación seleccionada")}.</p></div></div><div class="deleted-groups">
  <details class="card" open><summary>Ubicaciones eliminadas <span class="badge">${locations.length}</span></summary><div class="table-wrap"><table class="responsive"><thead><tr><th>Nombre</th><th>Código</th><th>Eliminada</th><th></th></tr></thead><tbody>${locations.map(item=>`<tr><td data-label="Nombre">${escapeHtml(item.name)}</td><td data-label="Código">${escapeHtml(item.codePrefix)}</td><td data-label="Eliminada">${dateTime(item.deletedAt)}</td><td data-label="Acciones"><button class="btn btn-primary btn-small" data-items-restore-location="${item.id}">Restaurar</button></td></tr>`).join("")||`<tr><td colspan="4"><div class="empty">No hay ubicaciones eliminadas</div></td></tr>`}</tbody></table></div></details>
  <details class="card"><summary>Productos eliminados <span class="badge">${products.length}</span></summary><div class="table-wrap"><table class="responsive"><thead><tr><th>Producto</th><th>Abrev.</th><th>Precio</th><th>Eliminado</th><th></th></tr></thead><tbody>${products.map(item=>`<tr><td data-label="Producto">${escapeHtml(item.name)}</td><td data-label="Abrev.">${escapeHtml(item.abbreviation)}</td><td data-label="Precio">${money(item.defaultPrice)}</td><td data-label="Eliminado">${dateTime(item.deletedAt)}</td><td data-label="Acciones"><button class="btn btn-primary btn-small" data-items-restore-product="${item.id}">Restaurar producto</button></td></tr>`).join("")||`<tr><td colspan="5"><div class="empty">No hay productos eliminados</div></td></tr>`}</tbody></table></div></details>
  <details class="card"><summary>Descuentos eliminados <span class="badge">${discounts.length}</span></summary><div class="table-wrap"><table class="responsive"><thead><tr><th>Nombre</th><th>Tipo</th><th>Valor</th><th>Eliminado</th><th></th></tr></thead><tbody>${discounts.map(item=>`<tr><td data-label="Nombre">${escapeHtml(item.name)}</td><td data-label="Tipo">${item.type==="percent"?"Porcentaje":"Monto fijo"}</td><td data-label="Valor">${item.type==="percent"?`${item.value}%`:money(item.value)}</td><td data-label="Eliminado">${dateTime(item.deletedAt)}</td><td data-label="Acciones"><button class="btn btn-primary btn-small" data-items-restore-discount="${item.id}">Restaurar descuento</button></td></tr>`).join("")||`<tr><td colspan="5"><div class="empty">No hay descuentos eliminados</div></td></tr>`}</tbody></table></div></details>
  <details class="card"><summary>Ventas anuladas <span class="badge danger">${cancelled.length}</span></summary><p class="muted">Las restauraciones descuentan nuevamente las unidades; el stock puede quedar negativo.</p><div class="table-wrap"><table class="responsive"><thead><tr><th>Código</th><th>Fecha</th><th>Vendedor</th><th>Total</th><th>Anulada</th><th></th></tr></thead><tbody>${cancelled.map(sale=>`<tr><td data-label="Código">${escapeHtml(sale.saleCode)}</td><td data-label="Fecha">${dateTime(sale.createdAt)}</td><td data-label="Vendedor">${escapeHtml(sale.sellerName)}</td><td data-label="Total">${money(sale.total)}</td><td data-label="Anulada">${dateTime(sale.cancelledAt||sale.deletedAt)}</td><td data-label="Acciones"><div class="table-actions"><button class="btn btn-ghost btn-small" data-items-sale-detail="${sale.id}">Ver</button><button class="btn btn-primary btn-small" data-items-restore-sale="${sale.id}">Restaurar venta</button></div></td></tr>`).join("")||`<tr><td colspan="6"><div class="empty">No hay ventas anuladas</div></td></tr>`}</tbody></table></div></details></div>`;
  $$('[data-items-restore-location]').forEach(button=>button.onclick=async()=>{const item=locations.find(row=>row.id===button.dataset.itemsRestoreLocation);if(!await confirmDialog(`¿Restaurar ${item.name}?`))return;setBusy(button,true,"Restaurando…");try{await restoreLocation(item.id,state.profile);state.locations=await listLocations();ensureSelectedLocation();renderDeletedItems();toast("Ubicación restaurada","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
  $$('[data-items-restore-product]').forEach(button=>button.onclick=async()=>{const item=products.find(row=>row.id===button.dataset.itemsRestoreProduct);if(!await confirmDialog(`¿Restaurar ${item.name}?`))return;setBusy(button,true,"Restaurando…");try{await restoreProduct(item.id,state.profile);state.products=await listProducts();renderDeletedItems();toast("Producto restaurado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
  $$('[data-items-restore-discount]').forEach(button=>button.onclick=async()=>{const item=discounts.find(row=>row.id===button.dataset.itemsRestoreDiscount);if(!await confirmDialog(`¿Restaurar ${item.name}?`))return;setBusy(button,true,"Restaurando…");try{await restoreDiscount(item.id,state.profile);state.discounts=await listDiscounts();renderDeletedItems();toast("Descuento restaurado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
  $$('[data-items-sale-detail]').forEach(button=>button.onclick=()=>saleDetail(cancelled.find(sale=>sale.id===button.dataset.itemsSaleDetail)));
  $$('[data-items-restore-sale]').forEach(button=>button.onclick=async()=>{const sale=cancelled.find(item=>item.id===button.dataset.itemsRestoreSale);if(!await confirmDialog("¿Querés restaurar esta venta? Se volverán a descontar las unidades del stock."))return;setBusy(button,true,"Restaurando…");try{await restoreSaleTransaction({saleId:sale.id,user:state.profile});toast("Venta restaurada y stock actualizado","success");}catch(error){toast(error.message,"error");setBusy(button,false);}});
}

function adminPaymentDetailsHtml(sale){const parts=salePaymentParts(sale);return parts.length>1?`<div class="payment-breakdown">${parts.map(part=>`<div><span>${escapeHtml(part.label)}</span><strong>${money(part.amount)}</strong></div>`).join("")}</div>`:"";}
function saleDetail(sale){const discounts=saleDiscountList(sale),discountTotal=storedDiscountTotal(sale),subtotal=Number(sale.totalBeforeDiscounts??sale.subtotal??sale.total);openModal({title:sale.saleCode,content:`<p><strong>${escapeHtml(sale.locationName)}</strong><br>${dateTime(sale.createdAt)} · ${escapeHtml(sale.sellerName)}<br>${escapeHtml(sale.paymentMethodLabel||"Sin forma de pago")}</p>${adminPaymentDetailsHtml(sale)}<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Unitario</th><th>Subtotal</th></tr></thead><tbody>${sale.items.map(item=>`<tr><td>${escapeHtml(item.name)}</td><td>${item.qty}</td><td>${money(item.unitPrice)}</td><td>${money(item.subtotal)}</td></tr>`).join("")}</tbody></table></div><div class="totals"><div class="total-line"><span>Subtotal</span><strong>${money(subtotal)}</strong></div>${discounts.map(discount=>`<div class="total-line discount-line"><span>${escapeHtml(discount.name||"Descuento")}</span><strong>− ${money(discount.amountApplied||0)}</strong></div>`).join("")}${discounts.length?`<div class="total-line discount-line"><span>Total descuentos</span><strong>− ${money(discountTotal)}</strong></div>`:""}<div class="total-line grand"><span>Total</span><strong>${money(sale.total)}</strong></div></div>`});}

function renderExports(){
  $("#admin-content",state.root).innerHTML=`<div class="page-head"><h1>Exportar CSV</h1></div><div class="cards"><section class="card"><h3>Ventas de la ubicación</h3><p class="muted">Filtrá opcionalmente las últimas ${state.sales.length} ventas cargadas de ${escapeHtml(currentLocation()?.name||"")}.</p><label>Fecha<input id="export-date" type="date"></label><label>Vendedor<select id="export-seller"><option value="">Todos</option>${state.users.filter(user=>user.role==="seller").map(user=>`<option value="${user.id}">${escapeHtml(user.name)}</option>`).join("")}</select></label><button id="export-sales" class="btn btn-primary">Descargar ventas</button></section><section class="card"><h3>Stock actual</h3><p class="muted">Estado de todos los productos de la ubicación seleccionada.</p><button id="export-stock" class="btn btn-secondary">Descargar stock</button></section></div>`;
  $("#export-sales").onclick=()=>{
    const date=$("#export-date").value,sellerId=$("#export-seller").value;
    const filtered=state.sales.filter(sale=>(!sellerId||sale.sellerId===sellerId)&&(!date||sale.createdAt?.toDate?.().toLocaleDateString("en-CA")===date));
    downloadCsv(`ventas-${currentLocation()?.codePrefix||"ubicacion"}.csv`,filtered.map(sale=>({codigo:sale.saleCode,fecha:dateOnly(sale.createdAt),hora:timeOnly(sale.createdAt),ubicacion:sale.locationName,vendedor:sale.sellerName,forma_pago:sale.paymentMethodLabel||"Sin forma de pago",desglose_pagos:paymentsBreakdownText(sale),productos:sale.items?.map(i=>i.name).join(" | "),cantidades:sale.items?.map(i=>i.qty).join(" | "),subtotal:sale.totalBeforeDiscounts??sale.subtotal,descuento:storedDiscountTotal(sale),total:sale.total,estado:sale.status})));
  };
  $("#export-stock").onclick=()=>downloadCsv(`stock-${currentLocation()?.codePrefix||"ubicacion"}.csv`,state.stock.map(item=>({ubicacion:currentLocation()?.name,producto:item.productName,abreviacion:item.abbreviation,precio:item.price,stock_inicial:item.initialStock,stock_actual:item.currentStock,alerta_amarilla:item.yellowAlertQty,alerta_roja:item.redAlertQty,activo:item.active?"si":"no"})));
}

from pathlib import Path
import re

ADMIN = Path("admin.js")
STYLES = Path("styles.css")

admin = ADMIN.read_text(encoding="utf-8")
styles = STYLES.read_text(encoding="utf-8")

replacement = r'''function saleCreatedAtDate(sale) {
  const value=sale?.createdAt;
  if(!value)return null;
  try{
    const date=typeof value?.toDate==="function"?value.toDate():value instanceof Date?new Date(value.getTime()):new Date(value);
    return date instanceof Date&&!Number.isNaN(date.valueOf())?date:null;
  }catch(_){return null;}
}

function metrics() {
  const active = state.sales.filter(sale => sale.status === "active");
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const tomorrowStart = new Date(todayStart); tomorrowStart.setDate(tomorrowStart.getDate()+1);
  const today = active.filter(sale => {const date=saleCreatedAtDate(sale);return date&&date>=todayStart&&date<tomorrowStart;});
  const total = active.reduce((sum,sale) => sum + Number(sale.total || 0),0);
  const todayTotal = today.reduce((sum,sale) => sum + Number(sale.total || 0),0);
  const items = today.reduce((sum,sale) => sum + Number(sale.totalItems || 0),0);
  const products = new Map(); const sellers = new Map(); const hours = new Map(); const payments = new Map();
  today.forEach(sale => {
    sale.items?.forEach(item => products.set(item.name, (products.get(item.name)||0) + Number(item.qty)));
    sellers.set(sale.sellerName, (sellers.get(sale.sellerName)||0) + Number(sale.total||0));
    const date = saleCreatedAtDate(sale); const hour = date ? `${String(date.getHours()).padStart(2,"0")}:00` : "Pendiente";
    hours.set(hour,(hours.get(hour)||0)+Number(sale.total||0));
    const parts=salePaymentParts(sale);
    if(parts.length){parts.forEach(part=>{const payment=payments.get(part.method)||{key:part.method,label:part.label,total:0,count:0};payment.total+=part.amount;payment.count+=1;payments.set(part.method,payment);});}
    else{const payment=payments.get("unknown")||{key:"unknown",label:PAYMENT_LABELS.unknown,total:0,count:0};payment.total+=Number(sale.total||0);payment.count+=1;payments.set("unknown",payment);}
  });
  const sorted = map => [...map].sort((a,b) => b[1]-a[1]);
  const paymentRows=["credit","debit","alias","cash","unknown"].map(key=>payments.get(key)||{key,label:PAYMENT_LABELS[key],total:0,count:0}).filter(row=>row.key!=="unknown"||row.count>0);
  return {active,today,total,items,ticket:today.length ? todayTotal/today.length : 0,todayTotal,todayCount:today.length, products:sorted(products), sellers:sorted(sellers), hours:[...hours].sort(),paymentRows};
}

function stockRemainingList() {
  const rows=state.stock.filter(item=>item.active===true).map(item=>({name:item.abbreviation||item.productName||"Sin nombre",productName:item.productName||"",value:Number(item.currentStock||0)})).sort((a,b)=>a.value-b.value||String(a.name).localeCompare(String(b.name)));
  if(!rows.length)return `<div class="empty">No hay productos habilitados en esta ubicación</div>`;
  const listId="stock-remaining-list",hasMore=rows.length>6;
  const button=hasMore?`<button type="button" id="stock-remaining-toggle" class="btn btn-ghost stock-remaining-toggle" aria-controls="${listId}" aria-expanded="false">Ver todo el stock</button>`:"";
  const rowHtml=(row,index)=>`<li class="${row.value<0?"negative":row.value===0?"zero":"positive"}" ${index>=6?"data-stock-extra hidden":""}><span><strong>${escapeHtml(row.name)}</strong>${row.productName&&row.productName!==row.name?`<small>${escapeHtml(row.productName)}</small>`:""}</span><b>${row.value} u.</b></li>`;
  return `${button}<ol id="${listId}" class="stock-remaining-list">${rows.map(rowHtml).join("")}</ol>`;
}

function bindStockRemainingToggle(root) {
  const button=$("#stock-remaining-toggle",root);if(!button)return;
  const list=$(`#${button.getAttribute("aria-controls")}`,root);if(!list)return;
  const extraRows=$$("[data-stock-extra]",list);
  button.onclick=()=>{
    const expanded=button.getAttribute("aria-expanded")==="true",nextExpanded=!expanded;
    extraRows.forEach(row=>row.hidden=!nextExpanded);
    button.setAttribute("aria-expanded",String(nextExpanded));
    button.textContent=nextExpanded?"Minimizar":"Ver todo el stock";
    list.classList.toggle("is-expanded",nextExpanded);
    if(!nextExpanded)requestAnimationFrame(()=>{const rect=button.getBoundingClientRect();if(rect.top<0||rect.bottom>window.innerHeight)button.scrollIntoView({behavior:"smooth",block:"nearest"});});
  };
}

function renderSummary() {
  const content = $("#admin-content", state.root); const m = metrics();
  content.innerHTML = `<div class="page-head"><h1>Resumen · ${escapeHtml(currentLocation()?.name || "Sin ubicación")}</h1></div>${alertHtml()}
  <div class="cards"><div class="card metric"><strong>${money(m.todayTotal)}</strong><span>Total de hoy (${m.todayCount} ventas)</span></div><div class="card metric"><strong>${money(m.total)}</strong><span>Total de la ubicación/evento</span></div><div class="card metric"><strong>${m.todayCount}</strong><span>Ventas</span></div><div class="card metric"><strong>${m.items}</strong><span>Productos vendidos</span></div><div class="card metric"><strong>${money(m.ticket)}</strong><span>Ticket promedio</span></div></div>
  <section class="card payment-summary" style="margin-top:13px"><h3>Ventas por forma de pago</h3><div class="cards">${m.paymentRows.map(row=>`<div class="payment-metric"><span>${escapeHtml(row.label)}</span><strong>${money(row.total)}</strong><small>${row.count} ${row.count===1?"venta":"ventas"}</small></div>`).join("")}</div></section>
  <div class="cards" style="margin-top:13px"><section class="card"><h3>Productos más vendidos</h3>${rankList(m.products, value => `${value} u.`)}</section><section class="card"><h3>Ventas por vendedor</h3>${rankList(m.sellers, money)}</section><section class="card"><h3>Ventas por hora</h3>${rankList(m.hours, money)}</section><section class="card stock-remaining-card"><h3>Stock restante <span class="badge">${state.stock.filter(item=>item.active===true).length} productos</span></h3>${stockRemainingList()}</section></div>`;
  bindStockRemainingToggle(content);
}

function rankList'''

if "function saleCreatedAtDate(sale)" not in admin:
    pattern = re.compile(r'function metrics\(\) \{.*?\n\}\n\nfunction stockRemainingList\(\) \{.*?\n\}\n\nfunction renderSummary\(\) \{.*?\n\}\n\nfunction rankList', re.S)
    admin, count = pattern.subn(replacement, admin, count=1)
    if count != 1:
        raise SystemExit(f"No se pudo reemplazar el bloque de Resumen: {count} coincidencias")
elif not all(marker in admin for marker in ("tomorrowStart.setDate", "bindStockRemainingToggle(content)", "stock-remaining-toggle")):
    raise SystemExit("El bloque de Resumen parece estar aplicado parcialmente")

stock_css = r'''.stock-remaining-card h3{display:flex;justify-content:space-between;gap:10px}.stock-remaining-toggle{width:100%;min-height:44px;margin:0 0 8px;justify-content:center}.stock-remaining-list{list-style:none;margin:0;padding:0;min-width:0}.stock-remaining-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}.stock-remaining-list li[hidden]{display:none!important}.stock-remaining-list li>span{min-width:0}.stock-remaining-list strong,.stock-remaining-list small{display:block;overflow-wrap:anywhere;word-break:normal}.stock-remaining-list small{color:var(--muted);font-size:.75rem}.stock-remaining-list b{white-space:nowrap;align-self:center}.stock-remaining-list .negative b{color:var(--red)}.stock-remaining-list .zero b{color:var(--yellow)}'''
if ".stock-remaining-toggle{" not in styles:
    start=styles.find(".stock-remaining-card h3{")
    end=styles.find(".metrics-filter-card",start)
    if start<0 or end<0:
        raise SystemExit(f"No se encontraron los límites seguros de estilos: start={start}, end={end}")
    styles=styles[:start]+stock_css+styles[end:]
if "Resumen diario y stock único v23" not in styles:
    styles = styles.replace('/* Flor Mia responsive v22 */', '/* Flor Mia responsive v22 */\n/* Resumen diario y stock único v23 */', 1)

ADMIN.write_text(admin, encoding="utf-8", newline="\n")
STYLES.write_text(styles, encoding="utf-8", newline="\n")

for name in ("index.html", "app.js", "service-worker.js"):
    path=Path(name);text=path.read_text(encoding="utf-8")
    text=text.replace('flor-mia-shell-v22','flor-mia-shell-v23').replace('?v=22','?v=23')
    path.write_text(text,encoding="utf-8",newline="\n")

required={
    "admin.js":["function saleCreatedAtDate", "tomorrowStart.setDate", "date>=todayStart&&date<tomorrowStart", "bindStockRemainingToggle(content)", "aria-expanded=\"false\"", "Minimizar"],
    "styles.css":["Resumen diario y stock único v23", ".stock-remaining-toggle", "min-height:44px", ".stock-remaining-list li[hidden]"],
    "index.html":["/styles.css?v=23", "/app.js?v=23"],
    "app.js":["./admin.js?v=23", "./seller.js?v=23"],
    "service-worker.js":["flor-mia-shell-v23", "/styles.css?v=23", "/app.js?v=23", "/admin.js?v=23", "/seller.js?v=23"],
}
for name,needles in required.items():
    text=Path(name).read_text(encoding="utf-8")
    for needle in needles:
        if needle not in text:raise SystemExit(f"Falta {needle!r} en {name}")
if "stock-remaining-details" in admin or "<details class=\"stock-remaining-details\"" in admin:
    raise SystemExit("La implementación anterior con details sigue presente")
print("Parche v23 aplicado o ya presente correctamente")

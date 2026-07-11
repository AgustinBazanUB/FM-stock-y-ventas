from pathlib import Path
import re


def rw(name, fn):
    p=Path(name); s=p.read_text(encoding='utf-8'); n=fn(s)
    if n==s: raise SystemExit(f'Sin cambios en {name}')
    p.write_text(n,encoding='utf-8')

def sub1(s,pat,repl,label,flags=0):
    n,c=re.subn(pat,repl,s,count=1,flags=flags)
    if c!=1: raise SystemExit(f'{label}: {c} coincidencias')
    return n

admin_header='''<header class="app-header admin-header">
    <div class="logo">Flor Mia</div>
    <div class="admin-location-context"><span class="admin-header-label">Ubicación actual</span><strong id="admin-current-location-name" class="admin-current-location-name">Cargando…</strong><select id="admin-location" aria-label="Cambiar ubicación activa"><option>Cargando…</option></select></div>
    <div class="admin-quick-actions" aria-label="Accesos rápidos"><button type="button" class="btn btn-ghost btn-small admin-quick-link active" data-section="summary" aria-current="page">Resumen</button><button type="button" class="btn btn-ghost btn-small admin-quick-link" data-section="stock">Cargar Stock</button></div>
    <div class="connection ${navigator.onLine ? "" : "offline"}" data-connection-status>${navigator.onLine ? "Online" : "Sin conexión"}</div>${panelSwitcherHtml(profile, panelOptions, "admin")}<button id="admin-logout" class="btn btn-ghost btn-small">Salir</button>
  </header>'''

def patch_admin(s):
    s=sub1(s,r'<header class="app-header"><div class="logo">Flor Mia</div><select id="admin-location"[\s\S]*?</header>',admin_header,'header admin')
    loc='''function renderLocationSelector() {
  const select = $("#admin-location", state.root);
  const selected=state.locations.find(location=>location.id===state.selectedLocationId&&location.deleted!==true);
  const locations=activeLocations();
  const options=selected&&!locations.some(location=>location.id===selected.id)?[selected,...locations]:locations;
  select.innerHTML = options.length ? options.map(location => `<option value="${location.id}" ${location.id === state.selectedLocationId ? "selected" : ""}>${escapeHtml(location.name)}${isLocationActiveNow(location)?"":" · inactiva"}</option>`).join("") : `<option value="">Sin ubicaciones</option>`;
  const current=options.find(location=>location.id===state.selectedLocationId)||selected;
  const currentName=current?.name||"Sin ubicación";
  const nameNode=$("#admin-current-location-name",state.root);if(nameNode){nameNode.textContent=currentName;nameNode.title=currentName;}select.title=currentName;
  select.onchange = () => { state.selectedLocationId = select.value; state.salesLimit=200; renderLocationSelector(); subscribeSelected(); renderSection(); };
}

function subscribeSelected'''
    s=sub1(s,r'function renderLocationSelector\(\) \{[\s\S]*?\n\}\n\nfunction subscribeSelected',loc,'selector admin')
    sw='''function switchSection(section) {
  state.section = section;
  $$('[data-section]', state.root).forEach(button => {const active=button.dataset.section===section;button.classList.toggle('active',active);if(button.classList.contains('admin-quick-link')){if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}});
  renderSection();
}

function renderSection'''
    s=sub1(s,r'function switchSection\(section\) \{[\s\S]*?\n\}\n\nfunction renderSection',sw,'switch admin')
    helper='''function stockRemainingList() {
  const rows=state.stock.filter(item=>item.active===true).map(item=>({name:item.abbreviation||item.productName||"Sin nombre",productName:item.productName||"",value:Number(item.currentStock||0)})).sort((a,b)=>a.value-b.value||String(a.name).localeCompare(String(b.name)));
  if(!rows.length)return `<div class="empty">No hay productos habilitados en esta ubicación</div>`;
  const rowHtml=row=>`<li class="${row.value<0?"negative":row.value===0?"zero":"positive"}"><span><strong>${escapeHtml(row.name)}</strong>${row.productName&&row.productName!==row.name?`<small>${escapeHtml(row.productName)}</small>`:""}</span><b>${row.value} u.</b></li>`;
  const preview=rows.slice(0,Math.min(6,rows.length)),previewHtml=`<ol class="stock-remaining-list stock-remaining-preview">${preview.map(rowHtml).join("")}</ol>`;
  if(rows.length<=preview.length)return previewHtml;
  return `${previewHtml}<details class="stock-remaining-details"><summary aria-label="Mostrar u ocultar todo el stock"><span class="stock-open-label">Ver todo el stock</span><span class="stock-close-label">Ocultar lista completa</span><small>${rows.length} productos</small></summary><div class="stock-remaining-scroll"><ol class="stock-remaining-list">${rows.map(rowHtml).join("")}</ol></div></details>`;
}

'''
    s=s.replace('function renderSummary() {',helper+'function renderSummary() {',1)
    old='<section class="card"><h3>Stock restante</h3>${rankList(state.stock.map(item => [item.abbreviation || item.productName,Number(item.currentStock)]).sort((a,b)=>a[1]-b[1]), value => `${value} u.`)}</section>'
    new='<section class="card stock-remaining-card"><h3>Stock restante <span class="badge">${state.stock.filter(item=>item.active===true).length} productos</span></h3>${stockRemainingList()}</section>'
    if old not in s: raise SystemExit('stock card no encontrada')
    return s.replace(old,new,1)

seller_header='''<header class="app-header seller-header"><button id="open-drawer" class="icon-btn" aria-label="Abrir menú">☰</button><div class="seller-title"><strong>Flor Mia</strong><small id="seller-location-name"></small></div><div class="seller-header-status"><small class="connection ${navigator.onLine ? "" : "offline"}" data-connection-status>${navigator.onLine ? "Online" : "Sin conexión"}</small><button id="pending-sales-chip" class="pending-sales-chip" type="button">Pendientes: <b data-pending-count>0</b></button></div><div class="seller-header-panel">${panelSwitcherHtml(state.profile,state.panelOptions,"seller")}</div></header>'''

def patch_seller(s):
    s=sub1(s,r'<header class="app-header seller-header"><button id="open-drawer"[\s\S]*?</header>',seller_header,'header seller')
    old='<section class="card cart-card"><header class="cart-head"><h2>Venta actual</h2><div class="cart-head-actions"><div class="key-status compact"><small id="key-hint">${state.keyboardActive?"Botonera activa":"Botonera desactivada"}</small><button id="activate-keyboard" class="btn ${state.keyboardActive?"btn-secondary":"btn-primary"} btn-small">${state.keyboardActive?"Desactivar":"Activar"}</button></div><button type="button" id="clear-cart" class="btn btn-ghost btn-small" ${state.cart.size?"":"disabled"}>Vaciar carrito</button></div></header>'
    new='<section class="card cart-card"><header class="cart-head"><div class="cart-title-row"><h2>Venta actual</h2><button type="button" id="clear-cart" class="btn btn-ghost btn-small" ${state.cart.size?"":"disabled"}>Vaciar carrito</button></div><div class="key-status compact"><small id="key-hint">${state.keyboardActive?"Botonera activa":"Botonera desactivada"}</small><button id="activate-keyboard" class="btn ${state.keyboardActive?"btn-secondary":"btn-primary"} btn-small">${state.keyboardActive?"Desactivar":"Activar"}</button></div></header>'
    if old not in s: raise SystemExit('cart head no encontrado')
    s=s.replace(old,new,1)
    warn='''function confirmStockWarning(product) {
  if(state.stockWarningsAccepted.has(product.id))return Promise.resolve(true);if(state.stockWarningOpen)return Promise.resolve(false);
  state.stockWarningOpen=true;state.keyboard?.pause();
  return new Promise(resolve=>{let settled=false,onKeyDown=null;const cleanup=()=>{if(onKeyDown)window.removeEventListener("keydown",onKeyDown,true);};const finish=value=>{if(settled)return;settled=true;cleanup();state.stockWarningOpen=false;resolve(value);};
    const modal=openModal({title:"Stock cargado agotado",onClose:()=>{finish(false);resumeKeyboard();},content:`<p><strong>${escapeHtml(product.productName||product.name)}</strong></p><p>El stock cargado no alcanza. Si todavía hay producto físico, podés seguir vendiendo. El administrador ajustará el stock.</p><div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancel-stock-warning">Cancelar</button><button type="button" class="btn btn-warning" id="continue-stock-warning">Continuar</button></div>`});
    const continueButton=$("#continue-stock-warning",modal.root);$("#cancel-stock-warning",modal.root).onclick=()=>{finish(false);modal.close();};continueButton.onclick=()=>{state.stockWarningsAccepted.add(product.id);finish(true);modal.close();};
    onKeyDown=event=>{const target=event.target,editing=target?.matches?.("input,select,textarea,[contenteditable='true']")||target?.isContentEditable;if(event.key!=="Enter"||event.repeat||editing)return;event.preventDefault();event.stopPropagation();event.stopImmediatePropagation?.();if(!settled&&!continueButton.disabled)continueButton.click();};window.addEventListener("keydown",onKeyDown,true);requestAnimationFrame(()=>continueButton.focus());
  });
}

async function ensureCartStockWarnings'''
    return sub1(s,r'function confirmStockWarning\(product\) \{[\s\S]*?\n\}\n\nasync function ensureCartStockWarnings',warn,'warning enter')

rw('admin.js',patch_admin);rw('seller.js',patch_seller)

css='''
/* Flor Mia responsive v22 */
html,body{max-width:100%;overflow-x:hidden}body{min-height:100dvh}.app-header>*{min-width:0}
.admin-header{height:auto;min-height:66px;display:grid;grid-template-columns:auto minmax(290px,430px) auto minmax(70px,1fr) auto auto;align-items:center;gap:10px 14px}.admin-location-context{min-width:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(170px,230px);grid-template-rows:auto auto;column-gap:9px;align-items:center}.admin-header-label{grid-column:1;grid-row:1;color:var(--muted);font-size:.7rem;font-weight:700}.admin-current-location-name{grid-column:1;grid-row:2;min-width:0;line-height:1.2;overflow-wrap:anywhere}.admin-location-context select{grid-column:2;grid-row:1/3;min-width:0;max-width:100%;min-height:44px}.admin-quick-actions{display:flex;gap:7px;flex-wrap:wrap}.admin-quick-link{min-height:44px}.admin-quick-link.active{background:var(--green-soft);border-color:var(--green);color:var(--green)}#admin-logout{min-height:44px}
.stock-remaining-card h3{display:flex;justify-content:space-between;gap:10px}.stock-remaining-list{list-style:none;margin:0;padding:0}.stock-remaining-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;padding:9px 0;border-bottom:1px solid var(--line)}.stock-remaining-list strong,.stock-remaining-list small{display:block;overflow-wrap:anywhere}.stock-remaining-list small{color:var(--muted);font-size:.75rem}.stock-remaining-list b{white-space:nowrap}.stock-remaining-list .negative b{color:var(--red)}.stock-remaining-list .zero b{color:var(--yellow)}.stock-remaining-details{margin-top:10px}.stock-remaining-details>summary{min-height:44px;display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-weight:750;color:var(--green);background:#f8faf8;cursor:pointer}.stock-remaining-details>summary small{margin-left:auto;color:var(--muted)}.stock-close-label{display:none}.stock-remaining-details[open] .stock-open-label{display:none}.stock-remaining-details[open] .stock-close-label{display:inline}.stock-remaining-scroll{max-height:min(60dvh,520px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;margin-top:8px}
.metrics-filter-card{height:auto;max-height:none;overflow:visible}.metrics-filters>*{min-width:0;max-width:100%}.metrics-picker-menu{-webkit-overflow-scrolling:touch;overscroll-behavior:contain}.metrics-chart-scroll{max-width:100%}
.seller-shell{min-height:100dvh;padding-bottom:0}.seller-header{height:auto;min-height:66px;display:grid;grid-template-columns:auto minmax(160px,1fr) auto auto;align-items:center;gap:9px 13px;padding-top:max(9px,env(safe-area-inset-top));padding-right:max(12px,env(safe-area-inset-right));padding-left:max(12px,env(safe-area-inset-left))}.seller-header .icon-btn{position:static}.seller-header .seller-title{text-align:left;min-width:0}.seller-header .seller-title strong,.seller-header .seller-title small{display:block}#seller-location-name{white-space:normal;overflow-wrap:anywhere}.seller-header-status{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap}.pending-sales-chip{position:static;min-height:44px;max-width:none;white-space:nowrap}.seller-main{width:100%;min-width:0}.cart-card{width:100%;max-width:100%}.cart-head{display:grid;gap:9px}.cart-title-row{display:flex;align-items:center;justify-content:space-between;gap:10px}.cart-title-row .btn,.cart-head .key-status.compact .btn{min-height:44px}.cart-head .key-status.compact{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto}.cart-head .key-status.compact small{white-space:normal;overflow-wrap:anywhere}#cart-lines{max-height:clamp(130px,28dvh,320px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.cart-row>*{min-width:0}.payment-option{min-height:44px}.seller-actions{position:sticky;bottom:0;width:100%;margin-top:10px;border:1px solid var(--line);border-radius:14px 14px 0 0;padding:10px max(12px,env(safe-area-inset-right)) max(10px,env(safe-area-inset-bottom)) max(12px,env(safe-area-inset-left))}
@media(max-width:780px){.admin-header{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"logo panel logout" "location location location" "quick quick quick" "connection connection connection";gap:8px 10px}.admin-header .logo{grid-area:logo}.admin-header>.panel-switcher{grid-area:panel;justify-self:end}#admin-logout{grid-area:logout}.admin-location-context{grid-area:location;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto auto;gap:3px}.admin-header-label{grid-row:1}.admin-current-location-name{grid-row:2}.admin-location-context select{grid-column:1;grid-row:3;width:100%}.admin-quick-actions{grid-area:quick}.admin-quick-link{flex:1 1 145px}.admin-header>.connection{grid-area:connection}.side-nav{position:static!important;top:auto!important}.metrics-filters{grid-template-columns:minmax(0,1fr);gap:12px}.metrics-filters>label,.metrics-multi-field,#metrics-seller-container,.metrics-filters input,.metrics-filters select{width:100%;min-width:0}.metrics-picker[open] .metrics-picker-menu{position:static;max-height:min(42dvh,320px);margin-top:6px;box-shadow:none}.metrics-filter-actions{display:grid;grid-template-columns:1fr}.metrics-filter-actions .btn{width:100%}.seller-header{grid-template-columns:auto minmax(0,1fr);grid-template-areas:"menu title" "status status" "panel panel"}.seller-header #open-drawer{grid-area:menu}.seller-title{grid-area:title}.seller-header-status{grid-area:status;display:grid;grid-template-columns:1fr auto}.seller-header-panel{grid-area:panel}.seller-header-panel .panel-switcher,.seller-header-panel .panel-chip,.seller-header-panel .panel-chip-static{width:100%}.cart-row{grid-template-columns:38px minmax(0,1fr) auto}.line-total{grid-column:2/-1}.seller-actions{grid-template-columns:1fr 1.5fr}}
@media(max-width:360px){.admin-header{grid-template-columns:auto 1fr;grid-template-areas:"logo logout" "panel panel" "location location" "quick quick" "connection connection"}.admin-quick-link{flex-basis:100%}.seller-header-status{grid-template-columns:1fr}.pending-sales-chip{width:100%}.cart-row{grid-template-columns:36px minmax(0,1fr)}.cart-row img{grid-row:1/4}.cart-product{grid-column:2}.cart-row .qty-control{grid-column:2}.cart-row .line-total{grid-column:2}.payment-grid{grid-template-columns:1fr}.payment-option[data-payment="multiple"]{grid-column:1}.seller-actions{grid-template-columns:1fr}}
'''
p=Path('styles.css');s=p.read_text(encoding='utf-8')
if '/* Flor Mia responsive v22 */' in s: raise SystemExit('CSS v22 ya aplicado')
p.write_text(s.rstrip()+css+'\n',encoding='utf-8')

rw('index.html',lambda s:s.replace('/styles.css?v=21','/styles.css?v=22').replace('/app.js?v=21','/app.js?v=22'))
rw('app.js',lambda s:s.replace('./admin.js?v=21','./admin.js?v=22').replace('./seller.js?v=21','./seller.js?v=22'))
rw('service-worker.js',lambda s:s.replace('flor-mia-shell-v21','flor-mia-shell-v22').replace('/styles.css?v=21','/styles.css?v=22').replace('/app.js?v=21','/app.js?v=22').replace('/admin.js?v=21','/admin.js?v=22').replace('/seller.js?v=21','/seller.js?v=22'))
print('Parche v22 aplicado')

import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('admin.js','utf8');
const start=source.indexOf('function saleCreatedAtDate');
const end=source.indexOf('function renderSummary');
assert.ok(start>=0&&end>start,'No se encontró el bloque de funciones del Resumen');

const labels={credit:'Crédito',debit:'Débito',alias:'Alias',cash:'Efectivo',unknown:'Sin forma de pago'};
const state={sales:[],stock:[]};
const context={
  state,
  PAYMENT_LABELS:labels,
  escapeHtml:value=>String(value).replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':'&quot;'}[char])),
  salePaymentParts:sale=>Array.isArray(sale.payments)&&sale.payments.length
    ? sale.payments.map(part=>({method:part.method,label:labels[part.method]||part.label||part.method,amount:Number(part.amount||0)}))
    : sale.paymentMethod
      ? [{method:sale.paymentMethod,label:labels[sale.paymentMethod]||sale.paymentMethodLabel||sale.paymentMethod,amount:Number(sale.total||0)}]
      : [],
  console,
  Date,
  Map,
  Number,
  String,
  Math,
  requestAnimationFrame:callback=>callback(),
  window:{innerHeight:800},
  $:()=>null,
  $$:()=>[],
};
vm.createContext(context);
vm.runInContext(`${source.slice(start,end)}\nthis.api={saleCreatedAtDate,metrics,stockRemainingList,bindStockRemainingToggle};`,context);
const {metrics,stockRemainingList,bindStockRemainingToggle}=context.api;

const now=new Date();
const localAt=(offset,hour,minute=0,second=0,millisecond=0)=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset,hour,minute,second,millisecond);
const timestamp=date=>({toDate:()=>new Date(date.getTime())});
const sale=({status='active',date,total,totalItems,items,sellerName,paymentMethod,payments})=>({status,createdAt:date===null?null:timestamp(date),total,totalItems,items,sellerName,paymentMethod,payments});

state.sales=[
  sale({date:localAt(-1,10),total:100,totalItems:1,items:[{name:'A',qty:1}],sellerName:'Ana',paymentMethod:'cash'}),
  sale({date:localAt(-1,16),total:200,totalItems:2,items:[{name:'B',qty:2}],sellerName:'Beto',paymentMethod:'debit'}),
  sale({date:localAt(0,9),total:300,totalItems:2,items:[{name:'A',qty:2}],sellerName:'Ana',paymentMethod:'cash'}),
  sale({date:localAt(0,14),total:400,totalItems:3,items:[{name:'B',qty:1},{name:'C',qty:2}],sellerName:'Beto',paymentMethod:'credit'}),
  sale({date:localAt(0,18),total:500,totalItems:4,items:[{name:'A',qty:1},{name:'C',qty:3}],sellerName:'Ana',payments:[{method:'credit',amount:200},{method:'alias',amount:300}]}),
  sale({status:'cancelled',date:localAt(0,20),total:999,totalItems:9,items:[{name:'Anulado',qty:9}],sellerName:'Ana',paymentMethod:'cash'}),
];
let result=metrics();
assert.equal(result.todayTotal,1200,'Total de hoy');
assert.equal(result.total,1500,'Total acumulado de ubicación');
assert.equal(result.todayCount,3,'Cantidad de ventas de hoy');
assert.equal(result.items,9,'Unidades de hoy');
assert.equal(result.ticket,400,'Ticket promedio diario');
assert.deepEqual(Array.from(result.products),[['A',3],['C',5],['B',1]].sort((a,b)=>b[1]-a[1]),'Ranking diario de productos');
assert.deepEqual(Array.from(result.sellers),[['Ana',800],['Beto',400]],'Ventas diarias por vendedor');
assert.deepEqual(Array.from(result.hours),[['09:00',300],['14:00',400],['18:00',500]],'Ventas diarias por hora');
const payments=Object.fromEntries(Array.from(result.paymentRows).map(row=>[row.key,row]));
assert.equal(payments.cash.total,300);assert.equal(payments.cash.count,1);
assert.equal(payments.credit.total,600);assert.equal(payments.credit.count,2);
assert.equal(payments.alias.total,300);assert.equal(payments.alias.count,1);
assert.equal(payments.debit.total,0);assert.equal(payments.debit.count,0);
assert.ok(!result.products.some(([name])=>name==='Anulado'),'La venta anulada no debe aparecer');

state.sales=[
  sale({date:localAt(0,0,0,0,0),total:10,totalItems:1,items:[],sellerName:'A',paymentMethod:'cash'}),
  sale({date:localAt(0,23,59,59,999),total:20,totalItems:1,items:[],sellerName:'A',paymentMethod:'cash'}),
  sale({date:localAt(1,0,0,0,0),total:30,totalItems:1,items:[],sellerName:'A',paymentMethod:'cash'}),
  sale({date:null,total:40,totalItems:1,items:[],sellerName:'A',paymentMethod:'cash'}),
  {...sale({date:localAt(0,12),total:50,totalItems:1,items:[],sellerName:'A',paymentMethod:'cash'}),createdAt:'fecha-inválida'},
];
result=metrics();
assert.equal(result.todayCount,2,'Límites locales del día');
assert.equal(result.todayTotal,30,'Solo 00:00 y 23:59:59 pertenecen a hoy');
assert.equal(result.total,150,'El acumulado conserva ventas activas aun sin fecha válida');
assert.deepEqual(Array.from(result.hours),[['00:00',10],['23:00',20]],'No clasifica fechas inválidas como hoy');

const count=(text,pattern)=>(text.match(pattern)||[]).length;
const stockItems=n=>Array.from({length:n},(_,index)=>({active:true,abbreviation:`P${index+1}`,productName:`Producto largo número ${index+1}`,currentStock:index-2}));
for(const [size,buttonCount,hiddenCount] of [[0,0,0],[4,0,0],[6,0,0],[7,1,1],[25,1,19]]){
  state.stock=stockItems(size);
  const html=stockRemainingList();
  assert.equal(count(html,/<li /g),size,`Una fila por producto con ${size}`);
  assert.equal(count(html,/id="stock-remaining-list"/g),size?1:0,`Una única lista con ${size}`);
  assert.equal(count(html,/id="stock-remaining-toggle"/g),buttonCount,`Un único botón cuando corresponde con ${size}`);
  assert.equal(count(html,/data-stock-extra hidden/g),hiddenCount,`Filas ocultas correctas con ${size}`);
  assert.equal(count(html,/<details/g),0,'No utiliza details');
  for(let index=1;index<=size;index++)assert.equal(count(html,new RegExp(`>P${index}<`,'g')),1,`P${index} aparece una sola vez`);
}

const attrs=new Map([['aria-controls','stock-remaining-list'],['aria-expanded','false']]);
const extraRows=Array.from({length:19},()=>({hidden:true}));
const list={classList:{toggle(){}}};
let scrollCalls=0;
const button={
  textContent:'Ver todo el stock',onclick:null,
  getAttribute:name=>attrs.get(name),setAttribute:(name,value)=>attrs.set(name,value),
  getBoundingClientRect:()=>({top:10,bottom:54}),scrollIntoView:()=>{scrollCalls++;},
};
context.$=(selector)=>selector==='#stock-remaining-toggle'?button:selector==='#stock-remaining-list'?list:null;
context.$$=selector=>selector==='[data-stock-extra]'?extraRows:[];
for(let i=0;i<10;i++)bindStockRemainingToggle({});
for(let cycle=0;cycle<10;cycle++){
  button.onclick();
  assert.equal(attrs.get('aria-expanded'),'true');assert.equal(button.textContent,'Minimizar');assert.ok(extraRows.every(row=>!row.hidden));
  button.onclick();
  assert.equal(attrs.get('aria-expanded'),'false');assert.equal(button.textContent,'Ver todo el stock');assert.ok(extraRows.every(row=>row.hidden));
}
assert.equal(scrollCalls,0,'No desplaza si el botón ya está visible');

const css=fs.readFileSync('styles.css','utf8');
assert.match(css,/\.stock-remaining-toggle\{[^}]*min-height:44px/,'Botón táctil de 44 px');
assert.match(css,/\.stock-remaining-list li\[hidden\]/,'Filas adicionales ocultables');
assert.doesNotMatch(css,/\.stock-remaining-details|\.stock-remaining-scroll/,'Se eliminaron estilos de lista duplicada');
assert.doesNotMatch(source,/stock-remaining-details|<details class="stock-remaining-details"/,'Se eliminó la implementación duplicada');

for(const name of ['index.html','app.js','service-worker.js']){
  const text=fs.readFileSync(name,'utf8');
  assert.doesNotMatch(text,/\?v=22|flor-mia-shell-v22/,`${name} no mezcla v22`);
}
console.log('OK: cálculos diarios, límites de fecha, pagos múltiples, stock único, 10 ciclos y cache v23');

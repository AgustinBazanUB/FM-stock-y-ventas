import {saleDiscountList, storedDiscountTotal} from "./discounts.js";
import {salePaymentParts} from "./payments.js";

const CANCELLED_STATUSES = new Set(["cancelled","canceled","deleted","anulada","anulado","cancelada","cancelado"]);
const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const pad = value => String(value).padStart(2,"0");
export const currentMetricsValue = (period, date=new Date()) => period === "day" ? `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}` : period === "year" ? String(date.getFullYear()) : `${date.getFullYear()}-${pad(date.getMonth()+1)}`;

export function buildMetricsDateRange(period, value) {
  const type=["day","month","year"].includes(period)?period:"month";
  const parts=String(value||currentMetricsValue(type)).split("-").map(Number);
  const year=parts[0],month=type==="year"?1:parts[1],day=type==="day"?parts[2]:1;
  if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12||!Number.isInteger(day)||day<1||day>31)throw new Error("Seleccioná una fecha válida.");
  const start=new Date(year,month-1,day,0,0,0,0);
  if(start.getFullYear()!==year||start.getMonth()!==month-1||start.getDate()!==day)throw new Error("Seleccioná una fecha válida.");
  const end=type==="day"?new Date(year,month-1,day+1):type==="month"?new Date(year,month,1):new Date(year+1,0,1);
  return {period:type,value:String(value||currentMetricsValue(type)),start,end};
}

export function saleDate(sale) {
  for(const value of [sale?.createdAt,sale?.date,sale?.createdLocallyAt,sale?.updatedAt]){
    const date=value?.toDate?value.toDate():value?new Date(value):null;
    if(date&&!Number.isNaN(date.valueOf()))return date;
  }
  return null;
}

export function isActiveSale(sale) {
  return !CANCELLED_STATUSES.has(String(sale?.status||"active").toLowerCase());
}

const itemMatches=(item,id,name)=>!id||item?.productId===id||(!item?.productId&&name&&item?.name===name);
const discountMatches=(sale,id,name)=>saleDiscountList(sale).some(discount=>(discount.discountId||discount.id)===id||(!(discount.discountId||discount.id)&&name&&discount.name===name));

export function applyMetricsFilters(sales, filters, range) {
  return (Array.isArray(sales)?sales:[]).filter(sale=>{
    const date=saleDate(sale);
    if(!date||date<range.start||date>=range.end)return false;
    if(filters.locationId&&sale.locationId!==filters.locationId&&sale.locationName!==filters.locationName)return false;
    if(filters.sellerId&&sale.sellerId!==filters.sellerId&&sale.sellerName!==filters.sellerName)return false;
    if(filters.productId&&!(sale.items||[]).some(item=>itemMatches(item,filters.productId,filters.productName)))return false;
    const discountTotal=storedDiscountTotal(sale);
    if(filters.discountId==="__none"&&discountTotal>0)return false;
    if(filters.discountId&&filters.discountId!=="__none"&&!discountMatches(sale,filters.discountId,filters.discountName))return false;
    return true;
  });
}

function row(map,key,name){if(!map.has(key))map.set(key,{key,name,total:0,sales:0,items:0});return map.get(key);}
function sorted(map,field="total"){return [...map.values()].sort((a,b)=>b[field]-a[field]||String(a.name).localeCompare(String(b.name)));}

function buildTimeline(active, range) {
  let points=[];
  if(range.period==="day")points=Array.from({length:24},(_,index)=>({key:index,label:`${pad(index)} h`,total:0,sales:0}));
  else if(range.period==="month"){const days=new Date(range.start.getFullYear(),range.start.getMonth()+1,0).getDate();points=Array.from({length:days},(_,index)=>({key:index+1,label:String(index+1),total:0,sales:0}));}
  else points=MONTHS.map((label,index)=>({key:index,label,total:0,sales:0}));
  active.forEach(sale=>{const date=saleDate(sale);const key=range.period==="day"?date.getHours():range.period==="month"?date.getDate():date.getMonth();const point=points.find(item=>item.key===key);if(point){point.total+=Number(sale.total||0);point.sales++;}});
  return points;
}

export function calculateMetrics(sales, range, filters={}) {
  const active=sales.filter(isActiveSale),cancelled=sales.filter(sale=>!isActiveSale(sale));
  const total=active.reduce((sum,sale)=>sum+Number(sale.total||0),0);
  const totalItems=active.reduce((sum,sale)=>sum+(sale.items||[]).reduce((itemSum,item)=>itemSum+Number(item.qty||0),0),0);
  const byLocation=new Map(),bySeller=new Map(),byProduct=new Map(),byDiscount=new Map(),byPayment=new Map();
  let discountTotal=0,discountedSales=0,selectedProductAmount=0,selectedProductUnits=0;
  active.forEach(sale=>{
    const saleTotal=Number(sale.total||0),items=sale.items||[];
    const location=row(byLocation,sale.locationId||sale.locationName||"unknown",sale.locationName||"Ubicación desconocida");location.total+=saleTotal;location.sales++;location.items+=items.reduce((sum,item)=>sum+Number(item.qty||0),0);
    const seller=row(bySeller,sale.sellerId||sale.sellerName||"unknown",sale.sellerName||"Vendedor desconocido");seller.total+=saleTotal;seller.sales++;seller.items+=items.reduce((sum,item)=>sum+Number(item.qty||0),0);
    const productsInSale=new Set();
    items.forEach(item=>{const key=item.productId||item.name||"unknown",name=item.name||item.abbreviation||"Producto sin nombre",qty=Number(item.qty||0),amount=Number(item.subtotal??Number(item.unitPrice||0)*qty);const product=row(byProduct,key,name);product.items+=qty;product.total+=amount;if(!productsInSale.has(key)){product.sales++;productsInSale.add(key);}if(filters.productId&&itemMatches(item,filters.productId,filters.productName)){selectedProductAmount+=amount;selectedProductUnits+=qty;}});
    salePaymentParts(sale).forEach(part=>{const payment=row(byPayment,part.method,part.label||"Sin forma de pago");payment.total+=Number(part.amount||0);payment.sales++;});
    const saleDiscountTotal=storedDiscountTotal(sale);discountTotal+=saleDiscountTotal;if(saleDiscountTotal>0)discountedSales++;
    const discounts=saleDiscountList(sale);discounts.forEach((discount,index)=>{const key=discount.discountId||discount.id||discount.name||`legacy-${index}`,name=discount.name||"Descuento",amount=Number(discount.amountApplied??(discounts.length===1?saleDiscountTotal:0));const entry=row(byDiscount,key,name);entry.sales++;entry.total+=amount;entry.salesTotal=Number(entry.salesTotal||0)+saleTotal;});
  });
  const withAverage=rows=>rows.map(entry=>({...entry,ticket:entry.sales?entry.total/entry.sales:0}));
  return {
    active,cancelled,total,salesCount:active.length,ticket:active.length?total/active.length:0,totalItems,
    discountTotal,discountedSales,cancelledTotal:cancelled.reduce((sum,sale)=>sum+Number(sale.total||0),0),
    selectedProductAmount,selectedProductUnits,timeline:buildTimeline(active,range),
    byLocation:withAverage(sorted(byLocation)),bySeller:withAverage(sorted(bySeller)),byProduct:sorted(byProduct,"items"),
    byDiscount:sorted(byDiscount),byPayment:sorted(byPayment)
  };
}

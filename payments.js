export const SINGLE_PAYMENT_METHODS = ["credit","debit","alias","cash"];
export const PAYMENT_LABELS = {
  credit:"Pago Credito",
  debit:"Pago debito",
  alias:"Pago Alias",
  cash:"Pago eft",
  multiple:"+2 pagos"
};
export const PAYMENT_OPTIONS = [
  ...SINGLE_PAYMENT_METHODS.map(value => ({value,label:PAYMENT_LABELS[value]})),
  {value:"multiple",label:PAYMENT_LABELS.multiple}
];

function wholeAmount(value, label, {emptyAsZero=false}={}) {
  if (emptyAsZero && (value === "" || value == null)) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) throw new Error(`${label} debe ser un monto entero mayor o igual a cero.`);
  return number;
}

export function paymentAllocationSummary(payments, total) {
  const saleTotal=wholeAmount(total,"El total de la venta");
  const entries=Array.isArray(payments)?payments:[];
  const invalid=entries.some(entry=>!Number.isFinite(Number(entry?.amount))||!Number.isInteger(Number(entry?.amount))||Number(entry?.amount)<0);
  const loaded=invalid?0:entries.reduce((sum,entry)=>sum+Number(entry.amount||0),0);
  return {invalid,loaded,difference:saleTotal-loaded,positiveCount:entries.filter(entry=>Number(entry?.amount)>0).length,total:saleTotal};
}

export function completeRemainingPayment(payments, method, total) {
  const summary=paymentAllocationSummary(payments,total);
  if(summary.invalid||summary.difference<=0)return payments;
  return payments.map(entry=>entry.method===method?{...entry,amount:Number(entry.amount||0)+summary.difference}:entry);
}

export function normalizePayment(paymentMethod, paymentMethodLabel, payments, total) {
  const saleTotal = wholeAmount(total,"El total de la venta");
  if (SINGLE_PAYMENT_METHODS.includes(paymentMethod)) {
    return {paymentMethod,paymentMethodLabel:PAYMENT_LABELS[paymentMethod]};
  }
  if (paymentMethod !== "multiple" || paymentMethodLabel !== PAYMENT_LABELS.multiple) throw new Error("Elegí una forma de pago antes de registrar la venta.");
  if (!Array.isArray(payments)) throw new Error("Cargá el desglose de +2 pagos.");
  const seen = new Set();
  const cleaned = payments.map(entry => {
    const method=String(entry?.method||"");
    if (!SINGLE_PAYMENT_METHODS.includes(method)) throw new Error("Una forma de pago del desglose no es válida.");
    if (seen.has(method)) throw new Error("No repitas formas de pago en el desglose.");
    seen.add(method);
    const amount=wholeAmount(entry?.amount,`El monto de ${PAYMENT_LABELS[method]}`,{emptyAsZero:true});
    return {method,label:PAYMENT_LABELS[method],amount};
  }).filter(entry=>entry.amount>0);
  if (cleaned.length < 2) throw new Error("Usá al menos 2 formas de pago con monto mayor a cero.");
  const summary=paymentAllocationSummary(cleaned,saleTotal);
  if (summary.loaded < saleTotal) throw new Error(`Falta cargar $${saleTotal-summary.loaded}.`);
  if (summary.loaded > saleTotal) throw new Error(`Te pasaste por $${summary.loaded-saleTotal}.`);
  return {paymentMethod:"multiple",paymentMethodLabel:PAYMENT_LABELS.multiple,payments:cleaned};
}

export function salePaymentParts(sale) {
  if (sale?.paymentMethod === "multiple" && Array.isArray(sale.payments)) {
    return sale.payments.filter(entry=>SINGLE_PAYMENT_METHODS.includes(entry?.method)&&Number(entry?.amount)>0).map(entry=>({method:entry.method,label:PAYMENT_LABELS[entry.method],amount:Number(entry.amount)}));
  }
  if (SINGLE_PAYMENT_METHODS.includes(sale?.paymentMethod)) return [{method:sale.paymentMethod,label:PAYMENT_LABELS[sale.paymentMethod],amount:Number(sale.total||0)}];
  return [];
}

export function paymentsBreakdownText(sale) {
  return salePaymentParts(sale).map(entry=>`${entry.label}: ${entry.amount}`).join(" | ");
}

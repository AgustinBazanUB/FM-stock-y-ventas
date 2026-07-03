function wholeDiscountValue(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) throw new Error("El descuento debe ser un número entero mayor o igual a cero");
  return number;
}

export function calculateDiscountSummary(discounts, subtotal) {
  const totalBeforeDiscounts = Number(subtotal);
  if (!Number.isFinite(totalBeforeDiscounts) || totalBeforeDiscounts < 0) throw new Error("El subtotal no es válido");
  let remainingTotal = totalBeforeDiscounts;
  const cleaned = (Array.isArray(discounts) ? discounts : []).filter(Boolean).map(discount => {
    if (!["fixed","percent"].includes(discount.type)) throw new Error("El tipo de descuento no es válido");
    const value = wholeDiscountValue(discount.value);
    if (discount.type === "percent" && value > 100) throw new Error("El porcentaje no puede superar 100");
    const discountId = String(discount.discountId || discount.id || "manual").trim() || "manual";
    const source = discount.source === "preset" || discountId !== "manual" ? "preset" : "manual";
    const name = String(discount.name || (source === "manual" ? "Descuento manual" : "Descuento")).trim() || "Descuento manual";
    const amountApplied = discount.type === "percent" ? Math.round(remainingTotal * value / 100) : value;
    remainingTotal = Math.max(0,remainingTotal-amountApplied);
    return {discountId,name,type:discount.type,value,amountApplied,source};
  });
  const discountTotal = totalBeforeDiscounts-remainingTotal;
  return {discounts:cleaned,discountTotal,totalBeforeDiscounts,total:remainingTotal};
}

export function saleDiscountList(sale) {
  if (Array.isArray(sale?.discounts)) return sale.discounts.filter(Boolean);
  return sale?.discount ? [sale.discount] : [];
}

export function storedDiscountTotal(sale) {
  const stored = Number(sale?.discountTotal);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return saleDiscountList(sale).reduce((sum,discount) => sum + Math.max(0,Number(discount.amountApplied || 0)),0);
}

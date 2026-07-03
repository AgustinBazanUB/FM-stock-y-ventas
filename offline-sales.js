import {normalizePayment} from "./payments.js";

const DB_NAME = "flor_mia_offline_db";
const DB_VERSION = 1;
const STORE_NAME = "pending_sales";

let dbPromise = null;

export function openOfflineDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("Este navegador no permite guardar ventas sin conexión."));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, {keyPath:"localId"});
      if (!store.indexNames.contains("sellerId")) store.createIndex("sellerId", "sellerId", {unique:false});
      if (!store.indexNames.contains("status")) store.createIndex("status", "status", {unique:false});
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error("No se pudo abrir el almacenamiento de ventas pendientes."));
    request.onblocked = () => reject(new Error("Cerrá otras pestañas de Flor Mia para actualizar el almacenamiento local."));
  }).catch(error => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

async function storeRequest(mode, createRequest) {
  const db = await openOfflineDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request;
    try { request = createRequest(store); }
    catch (error) { reject(error); return; }
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error || request?.error || new Error("Falló el almacenamiento local."));
    transaction.onabort = () => reject(transaction.error || new Error("Se canceló el almacenamiento local."));
  });
}

function requiredText(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Falta ${label} en la venta pendiente.`);
  return text;
}

function wholeNumber(value, label, minimum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < minimum) throw new Error(`${label} debe ser un número entero válido.`);
  return number;
}

function normalizePendingSale(sale) {
  if (!sale || typeof sale !== "object") throw new Error("La venta pendiente no es válida.");
  const paymentMethod = requiredText(sale.paymentMethod, "la forma de pago");
  const items = Array.isArray(sale.items) ? sale.items.map(item => {
    const unitPrice = wholeNumber(item.unitPrice, `El precio de ${item.name || "un producto"}`);
    const qty = wholeNumber(item.qty, `La cantidad de ${item.name || "un producto"}`, 1);
    return {
      productId:requiredText(item.productId, "el producto"),
      name:requiredText(item.name, "el nombre del producto"),
      abbreviation:String(item.abbreviation || "").trim(),
      unitPrice,
      qty,
      subtotal:unitPrice * qty
    };
  }) : [];
  if (!items.length) throw new Error("La venta pendiente está vacía.");
  const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const total = wholeNumber(sale.total, "El total");
  if (total > subtotal) throw new Error("El total de la venta pendiente no es válido.");
  const payment = normalizePayment(paymentMethod,sale.paymentMethodLabel,sale.payments,total);
  const discounts = Array.isArray(sale.discounts) ? sale.discounts.map(discount => ({
    discountId:String(discount.discountId || discount.id || "manual"),
    name:requiredText(discount.name || "Descuento", "el nombre del descuento"),
    type:["fixed","percent"].includes(discount.type) ? discount.type : "fixed",
    value:wholeNumber(discount.value, "El valor del descuento"),
    source:discount.source === "preset" ? "preset" : "manual"
  })) : [];
  const createdLocallyAt = new Date(sale.createdLocallyAt || Date.now());
  if (Number.isNaN(createdLocallyAt.valueOf())) throw new Error("La fecha local de la venta no es válida.");
  return {
    localId:requiredText(sale.localId, "el identificador local"),
    localCode:requiredText(sale.localCode || sale.localId, "el código local"),
    status:["pending","sync_error","synced"].includes(sale.status) ? sale.status : "pending",
    createdLocallyAt:createdLocallyAt.toISOString(),
    lastSyncAttemptAt:sale.lastSyncAttemptAt || null,
    syncError:String(sale.syncError || ""),
    retryCount:wholeNumber(sale.retryCount || 0, "Los reintentos"),
    remoteSaleId:String(sale.remoteSaleId || ""),
    locationId:requiredText(sale.locationId, "la ubicación"),
    locationName:requiredText(sale.locationName, "el nombre de la ubicación"),
    locationPrefix:requiredText(sale.locationPrefix || "LOC", "el código de la ubicación"),
    sellerId:requiredText(sale.sellerId, "el vendedor"),
    sellerName:requiredText(sale.sellerName, "el nombre del vendedor"),
    items,
    discounts,
    discountTotal:subtotal - total,
    subtotal,
    totalItems:items.reduce((sum, item) => sum + item.qty, 0),
    total,
    ...payment,
    clientStatus:"offline_pending"
  };
}

export async function savePendingSale(sale) {
  const normalized = normalizePendingSale(sale);
  await storeRequest("readwrite", store => store.put(normalized));
  return normalized;
}

export async function getPendingSales() {
  const sales = await storeRequest("readonly", store => store.getAll());
  return (sales || []).sort((a, b) => String(a.createdLocallyAt).localeCompare(String(b.createdLocallyAt)));
}

function updatePendingSale(localId, update) {
  return storeRequest("readwrite", store => {
    const request = store.get(localId);
    request.onsuccess = () => {
      if (!request.result) return;
      store.put({...request.result, ...update(request.result)});
    };
    return request;
  });
}

export function markPendingSaleSynced(localId, remoteSaleId) {
  return updatePendingSale(localId, () => ({status:"synced", remoteSaleId:String(remoteSaleId || ""), syncError:"", lastSyncAttemptAt:new Date().toISOString()}));
}

export function markPendingSaleError(localId, errorMessage) {
  return updatePendingSale(localId, sale => ({status:"sync_error", syncError:String(errorMessage || "No se pudo sincronizar."), retryCount:Number(sale.retryCount || 0) + 1, lastSyncAttemptAt:new Date().toISOString()}));
}

export function deletePendingSale(localId) {
  return storeRequest("readwrite", store => store.delete(localId));
}

export async function countPendingSales() {
  return (await getPendingSales()).filter(sale => sale.status !== "synced").length;
}

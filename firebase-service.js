import {initializeApp, getApps, deleteApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, EmailAuthProvider, reauthenticateWithCredential} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, addDoc, updateDoc, query, where, orderBy,
  limit, onSnapshot, runTransaction, serverTimestamp, Timestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import {localDateKey} from "./utils.js";
import {calculateDiscountSummary} from "./discounts.js";
import {normalizePayment} from "./payments.js";
import {addDays, isLocationActiveNow, toLocalDateTimeInput} from "./locations.js";

const config = window.FLOR_MIA_FIREBASE_CONFIG;
if (!config) throw new Error("Falta la configuración de Firebase");

export const firebaseApp = initializeApp(config);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

export const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const logout = () => signOut(auth);
export const observeAuth = callback => onAuthStateChanged(auth, callback);

export async function reauthenticateAdmin(email, password) {
  const user = auth.currentUser;
  if (!user) throw new Error("La sesión del administrador ya no está activa");
  if (String(user.email || "").toLowerCase() !== String(email || "").trim().toLowerCase()) throw new Error("El email no corresponde al administrador conectado");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? {id:snap.id, ...snap.data()} : null;
}

const docsToArray = snap => snap.docs.map(item => ({id:item.id, ...item.data()}));
const userCanAdmin = user => user?.role === "admin" || user?.canAccessAdmin === true || user?.isAdmin === true || (Array.isArray(user?.roles) && user.roles.includes("admin"));
const nonNegativeNumber = (value, label) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} debe ser un número válido mayor o igual a cero`);
  return number;
};
const wholeQuantity = (value, label) => {
  const number = nonNegativeNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label} debe ser un número entero`);
  return number;
};
export const listUsers = async () => docsToArray(await getDocs(collection(db, "users")));
export const listProducts = async () => docsToArray(await getDocs(query(collection(db, "products"), orderBy("name"))));
export const listProductCategories = async () => docsToArray(await getDocs(collection(db, "productCategories"))).sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)||String(a.name||"").localeCompare(String(b.name||"")));
export const listVisibleProductCategories = async () => docsToArray(await getDocs(query(collection(db, "productCategories"), where("active","==",true), where("deleted","==",false)))).sort((a,b)=>Number(a.sortOrder||0)-Number(b.sortOrder||0)||String(a.name||"").localeCompare(String(b.name||"")));
export const listLocations = async () => docsToArray(await getDocs(query(collection(db, "locations"), orderBy("name"))));
export const listDiscounts = async () => docsToArray(await getDocs(query(collection(db, "discounts"), orderBy("name"))));

export async function getKeyboardShortcuts() {
  try {
    const snap = await getDoc(doc(db, "settings", "keyboardShortcuts"));
    return snap.exists() ? snap.data() : {sellerActions:{}};
  } catch (error) {
    if (error.code === "permission-denied") return {sellerActions:{}};
    throw error;
  }
}

export async function saveKeyboardShortcuts(data, user) {
  await setDoc(doc(db, "settings", "keyboardShortcuts"), {
    ...data,
    updatedAt:serverTimestamp(),
    updatedBy:user.id,
    updatedByName:user.name || "Administrador"
  }, {merge:true});
}

export async function listAllowedLocations(ids = []) {
  const snapshots = await Promise.all(ids.map(id => getDoc(doc(db, "locations", id))));
  return snapshots.filter(snap => snap.exists()).map(snap => ({id:snap.id, ...snap.data()})).filter(location => location.deleted !== true).sort((a,b) => a.name.localeCompare(b.name));
}

export const listActiveDiscounts = async () => docsToArray(await getDocs(query(collection(db, "discounts"), where("active","==",true), orderBy("name")))).filter(item => item.deleted !== true);

export async function listLocationStock(locationId) {
  if (!locationId) return [];
  return docsToArray(await getDocs(query(collection(db, "locationStock", locationId, "items"), orderBy("productName"))));
}

export async function saveLocation(id, data) {
  const target = id ? doc(db, "locations", id) : doc(collection(db, "locations"));
  await setDoc(target, {...data, updatedAt:serverTimestamp(), ...(id ? {} : {createdAt:serverTimestamp()})}, {merge:true});
  return target.id;
}

export async function pauseLocation(locationId, {days, user}) {
  const qty = wholeQuantity(days, "Los días inactiva");
  if (qty < 1) throw new Error("Los días inactiva deben ser mayores a cero");
  const until = addDays(new Date(), qty);
  await updateDoc(doc(db,"locations",locationId), {
    active:false,
    manualInactiveUntil:until,
    manualInactiveUntilDateTime:toLocalDateTimeInput(until),
    manualInactiveDays:qty,
    manualInactiveAt:serverTimestamp(),
    manualInactiveBy:user.id,
    manualInactiveByName:user.name || "Administrador",
    updatedAt:serverTimestamp()
  });
}

export async function saveProduct(id, data) {
  const target = id ? doc(db, "products", id) : doc(collection(db, "products"));
  const normalized = Object.hasOwn(data,"defaultPrice") ? {...data,defaultPrice:wholeQuantity(data.defaultPrice,"El precio")} : data;
  if (!id) {
    await setDoc(target, {...normalized, updatedAt:serverTimestamp(), createdAt:serverTimestamp()}, {merge:true});
    return target.id;
  }
  const locations = await listLocations();
  const stocksByLocation = await Promise.all(locations.map(location => listLocationStock(location.id)));
  if (normalized.active !== false && (normalized.buttonCode || normalized.buttonKey)) {
    for (let index=0;index<locations.length;index+=1) {
      if (!isLocationActiveNow(locations[index]) || locations[index].deleted === true) continue;
      const duplicate = stocksByLocation[index].find(item => item.id !== id && item.active && item.deleted !== true
        && ((normalized.buttonCode && item.buttonCode === normalized.buttonCode) || (normalized.buttonKey && item.buttonKey === normalized.buttonKey)));
      if (duplicate) throw new Error(`La tecla ya está asignada a ${duplicate.productName} en ${locations[index].name}`);
    }
  }
  const batch = writeBatch(db);
  batch.set(target, {...normalized, updatedAt:serverTimestamp()}, {merge:true});
  stocksByLocation.forEach((items,index) => {
    if (!items.some(item => item.id === id)) return;
    const propagated = {
      ...(Object.hasOwn(normalized,"name") ? {productName:normalized.name} : {}),
      ...(Object.hasOwn(normalized,"abbreviation") ? {abbreviation:normalized.abbreviation} : {}),
      ...(Object.hasOwn(normalized,"imageUrl") ? {imageUrl:normalized.imageUrl} : {}),
      ...(Object.hasOwn(normalized,"thumbUrl") ? {thumbUrl:normalized.thumbUrl} : {}),
      ...(Object.hasOwn(normalized,"categoryId") ? {categoryId:normalized.categoryId || ""} : {}),
      ...(Object.hasOwn(normalized,"categoryName") ? {categoryName:normalized.categoryName || ""} : {}),
      ...(Object.hasOwn(normalized,"buttonKey") ? {buttonKey:normalized.buttonKey} : {}),
      ...(Object.hasOwn(normalized,"buttonCode") ? {buttonCode:normalized.buttonCode} : {}),
      ...(Object.hasOwn(normalized,"buttonLabel") ? {buttonLabel:normalized.buttonLabel} : {}),
      ...(normalized.active === false ? {active:false} : {}),
      updatedAt:serverTimestamp()
    };
    batch.set(doc(db,"locationStock",locations[index].id,"items",id), propagated, {merge:true});
  });
  await batch.commit();
  return target.id;
}

export async function saveProductCategory(id, data) {
  const target = id ? doc(db, "productCategories", id) : doc(collection(db, "productCategories"));
  const sortOrder = Number.isFinite(Number(data.sortOrder)) ? Number(data.sortOrder) : 0;
  await setDoc(target, {
    name:String(data.name || "").trim(),
    description:String(data.description || "").trim(),
    sortOrder,
    active:data.active !== false,
    deleted:data.deleted === true,
    updatedAt:serverTimestamp(),
    ...(id ? {} : {createdAt:serverTimestamp()})
  }, {merge:true});
  return target.id;
}

export async function saveDiscount(id, data) {
  const target = id ? doc(db, "discounts", id) : doc(collection(db, "discounts"));
  const normalized = Object.hasOwn(data,"value") ? {...data,value:wholeQuantity(data.value,"El descuento")} : data;
  await setDoc(target, {...normalized, updatedAt:serverTimestamp(), ...(id ? {} : {createdAt:serverTimestamp()})}, {merge:true});
  return target.id;
}

export async function saveUser(id, data) {
  await setDoc(doc(db, "users", id), {...data, updatedAt:serverTimestamp()}, {merge:true});
}

const deletionFields = user => ({active:false, deleted:true, deletedAt:serverTimestamp(), deletedBy:user.id, deletedByName:user.name || "Administrador", updatedAt:serverTimestamp()});
const restorationFields = user => ({active:true, deleted:false, deletedAt:null, restoredAt:serverTimestamp(), restoredBy:user.id, restoredByName:user.name || "Administrador", updatedAt:serverTimestamp()});

export async function deleteLocationLogical(locationId, user) {
  await updateDoc(doc(db,"locations",locationId), deletionFields(user));
}

export async function restoreLocation(locationId, user) {
  await updateDoc(doc(db,"locations",locationId), restorationFields(user));
}

export async function deleteProductLogical(productId, user) {
  const locations = await listLocations();
  const stockRefs = locations.map(location => doc(db,"locationStock",location.id,"items",productId));
  const stockSnaps = await Promise.all(stockRefs.map(stockRef => getDoc(stockRef)));
  const batch = writeBatch(db);
  batch.update(doc(db,"products",productId), deletionFields(user));
  stockSnaps.forEach((snap,index) => { if (snap.exists()) batch.update(stockRefs[index], {active:false, productDeleted:true, updatedAt:serverTimestamp()}); });
  await batch.commit();
}

export async function restoreProduct(productId, user) {
  await updateDoc(doc(db,"products",productId), restorationFields(user));
}

export async function deleteDiscountLogical(discountId, user) {
  await updateDoc(doc(db,"discounts",discountId), deletionFields(user));
}

export async function restoreDiscount(discountId, user) {
  await updateDoc(doc(db,"discounts",discountId), restorationFields(user));
}

export async function deleteSellerLogical(sellerId, user) {
  const locations = await listLocations();
  const batch = writeBatch(db);
  locations.forEach(location => {
    const assignedSellerIds = (location.assignedSellerIds || []).filter(id => id !== sellerId);
    if (assignedSellerIds.length !== (location.assignedSellerIds || []).length) batch.update(doc(db,"locations",location.id), {assignedSellerIds, updatedAt:serverTimestamp()});
  });
  batch.update(doc(db,"users",sellerId), {...deletionFields(user), allowedLocationIds:[]});
  await batch.commit();
}

export async function createSellerAccount({name, email, password, active, allowedLocationIds, canAccessAdmin = false}) {
  const secondaryName = `seller-${Date.now()}`;
  const secondaryApp = initializeApp(config, secondaryName);
  try {
    const credential = await createUserWithEmailAndPassword(getAuth(secondaryApp), email, password);
    await setDoc(doc(db, "users", credential.user.uid), {
      name, email, role:"seller", active, allowedLocationIds, canAccessAdmin:Boolean(canAccessAdmin), isAdmin:Boolean(canAccessAdmin),
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    return credential.user.uid;
  } finally {
    await deleteApp(secondaryApp).catch(() => {});
  }
}

export async function syncSellerAssignments(sellerId, locationIds) {
  const locations = await listLocations();
  const batch = writeBatch(db);
  locations.forEach(location => {
    const ids = new Set(location.assignedSellerIds || []);
    locationIds.includes(location.id) ? ids.add(sellerId) : ids.delete(sellerId);
    batch.update(doc(db, "locations", location.id), {assignedSellerIds:[...ids], updatedAt:serverTimestamp()});
  });
  await batch.commit();
}

export async function configureStock({locationId, product, values, user}) {
  const stockRef = doc(db, "locationStock", locationId, "items", product.id);
  const movementRef = doc(collection(db, "stockMovements"));
  const initial = wholeQuantity(values.initialStock || 0, "El stock inicial");
  const price = wholeQuantity(values.price || 0, "El precio");
  const yellowAlertQty = wholeQuantity(values.yellowAlertQty || 0, "La alerta amarilla");
  const redAlertQty = wholeQuantity(values.redAlertQty || 0, "La alerta roja");
  if (yellowAlertQty < redAlertQty) throw new Error("La alerta amarilla debe ser mayor o igual a la roja");
  await runTransaction(db, async transaction => {
    const existing = await transaction.get(stockRef);
    const wasDeleted = existing.exists() && existing.data().deleted === true;
    const previousInitial = existing.exists() && !wasDeleted ? Number(existing.data().initialStock || 0) : 0;
    const oldStock = existing.exists() && !wasDeleted ? Number(existing.data().currentStock || 0) : 0;
    const initialDifference = initial - previousInitial;
    const currentStock = existing.exists() && !wasDeleted ? oldStock + initialDifference : initial;
    transaction.set(stockRef, {
      productId:product.id, productName:product.name, abbreviation:product.abbreviation,
      categoryId:product.categoryId || "", categoryName:product.categoryName || "",
      imageUrl:product.imageUrl || "", thumbUrl:product.thumbUrl || "",
      price, initialStock:initial,
      currentStock, yellowAlertQty, redAlertQty,
      active:Boolean(values.active), buttonKey:values.buttonKey || product.buttonKey || "", buttonCode:values.buttonCode || product.buttonCode || "",
      buttonLabel:values.buttonLabel || product.buttonLabel || "", deleted:false, deletedAt:null, productDeleted:false, updatedAt:serverTimestamp()
    }, {merge:true});
    if (((!existing.exists() || wasDeleted) && initial > 0) || (existing.exists() && !wasDeleted && initialDifference !== 0)) transaction.set(movementRef, {
      locationId, productId:product.id, type:existing.exists()&&!wasDeleted?"initial_adjustment":"initial", qty:existing.exists()&&!wasDeleted?initialDifference:initial,
      previousStock:oldStock, newStock:currentStock, reason:existing.exists()&&!wasDeleted?"Corrección de stock inicial":"Stock inicial",
      userId:user.id, userName:user.name, saleId:"", createdAt:serverTimestamp()
    });
  });
}

export async function deleteLocationStock({locationId, productId, user}) {
  const stockRef = doc(db,"locationStock",locationId,"items",productId);
  const movementRef = doc(collection(db,"stockMovements"));
  await runTransaction(db, async transaction => {
    const snap = await transaction.get(stockRef);
    if (!snap.exists() || snap.data().deleted === true) throw new Error("El stock ya no existe en esta ubicación");
    const previousStock = Number(snap.data().currentStock || 0);
    transaction.update(stockRef, {currentStock:0, active:false, deleted:true, deletedAt:serverTimestamp(), deletedBy:user.id, deletedByName:user.name, updatedAt:serverTimestamp()});
    transaction.set(movementRef, {locationId, productId, type:"stock_delete", qty:-previousStock, previousStock, newStock:0, reason:"Stock eliminado por administrador", userId:user.id, userName:user.name, saleId:"", createdAt:serverTimestamp()});
  });
}

export async function addStock({locationId, productId, qty, reason, user}) {
  const stockRef = doc(db, "locationStock", locationId, "items", productId);
  const movementRef = doc(collection(db, "stockMovements"));
  const quantity = wholeQuantity(qty, "La cantidad");
  if (quantity <= 0) throw new Error("La cantidad debe ser mayor a cero");
  await runTransaction(db, async transaction => {
    const snap = await transaction.get(stockRef);
    if (!snap.exists() || snap.data().deleted === true) throw new Error("El producto no está cargado en esta ubicación");
    const previousStock = Number(snap.data().currentStock || 0);
    const newStock = previousStock + quantity;
    transaction.update(stockRef, {currentStock:newStock, updatedAt:serverTimestamp()});
    transaction.set(movementRef, {locationId, productId, type:"add", qty:quantity, previousStock, newStock,
      reason:reason || "Ingreso de mercadería", userId:user.id, userName:user.name, saleId:"", createdAt:serverTimestamp()});
  });
}

function cleanSaleItems(items) {
  return items.reduce((result, item) => {
    const qty = wholeQuantity(item.qty, `La cantidad de ${item.name || item.productName || "un producto"}`);
    if (!qty) return result;
    const unitPrice = wholeQuantity(item.unitPrice ?? item.price ?? 0, `El precio de ${item.name || item.productName || "un producto"}`);
    result.push({
      productId:item.productId || item.id, name:item.name || item.productName, abbreviation:item.abbreviation || "",
      unitPrice, qty, subtotal:unitPrice * qty
    });
    return result;
  }, []);
}

export async function createSale({location, seller, items, discounts, discount, paymentMethod, paymentMethodLabel, payments, offlineSale = null}) {
  const saleItems = cleanSaleItems(items);
  if (!saleItems.length) throw new Error("La venta está vacía");
  const subtotal = saleItems.reduce((sum, item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(Array.isArray(discounts)?discounts:(discount?[discount]:[]),subtotal);
  const total = discountSummary.total;
  if (total < 0) throw new Error("El total no puede ser negativo");
  const payment = normalizePayment(paymentMethod,paymentMethodLabel,payments,total);
  const dateKey = localDateKey();
  const prefix = String(location.codePrefix || "LOC").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0,8);
  const offlineLocalId = offlineSale?.localId ? String(offlineSale.localId).trim() : "";
  if (offlineLocalId && !/^local_[A-Za-z0-9_-]+$/.test(offlineLocalId)) throw new Error("El identificador de la venta offline no es válido");
  const createdLocallyAt = offlineLocalId ? new Date(offlineSale.createdLocallyAt) : null;
  if (createdLocallyAt && Number.isNaN(createdLocallyAt.valueOf())) throw new Error("La fecha local de la venta offline no es válida");
  const counterRef = doc(db, "counters", `${prefix}_${dateKey}`);
  const saleRef = offlineLocalId
    ? doc(db, "sales", `offline_${seller.id}_${offlineLocalId}`.replaceAll("/", "_"))
    : doc(collection(db, "sales"));
  const stockRefs = saleItems.map(item => doc(db, "locationStock", location.id, "items", item.productId));
  const movementRefs = saleItems.map(() => doc(collection(db, "stockMovements")));
  return runTransaction(db, async transaction => {
    if (offlineLocalId) {
      const existingSale = await transaction.get(saleRef);
      if (existingSale.exists()) {
        const data = existingSale.data();
        if (data.offlineLocalId !== offlineLocalId || data.sellerId !== seller.id) throw new Error("El identificador offline ya está en uso");
        return {id:saleRef.id, saleCode:data.saleCode, total:data.total, paymentMethod:data.paymentMethod, paymentMethodLabel:data.paymentMethodLabel, payments:data.payments||[], createdAt:data.createdAt};
      }
    }
    const counterSnap = await transaction.get(counterRef);
    const stockSnaps = [];
    for (const stockRef of stockRefs) stockSnaps.push(await transaction.get(stockRef));
    const next = Number(counterSnap.data()?.lastNumber || 0) + 1;
    const saleCode = `FM-${prefix}-${dateKey}-${String(next).padStart(4,"0")}`;
    transaction.set(counterRef, {locationId:location.id, date:dateKey, lastNumber:next}, {merge:true});
    stockSnaps.forEach((snap, index) => {
      const item = saleItems[index];
      if (!snap.exists() || snap.data().active === false || snap.data().deleted === true) throw new Error(`${item.name} no está habilitado en esta ubicación`);
      const previousStock = Number(snap.data().currentStock || 0);
      const newStock = previousStock - item.qty;
      transaction.update(stockRefs[index], {currentStock:newStock, updatedAt:serverTimestamp()});
      transaction.set(movementRefs[index], {locationId:location.id, productId:item.productId, type:"sale", qty:-item.qty,
        previousStock, newStock, reason:`Venta ${saleCode}`, userId:seller.id, userName:seller.name, saleId:saleRef.id, createdAt:serverTimestamp()});
    });
    transaction.set(saleRef, {saleCode, locationId:location.id, locationName:location.name, locationPrefix:prefix,
      sellerId:seller.id, sellerName:seller.name, items:saleItems, discounts:discountSummary.discounts, discount:null,
      discountTotal:discountSummary.discountTotal, totalBeforeDiscounts:discountSummary.totalBeforeDiscounts, ...payment, subtotal,
      totalItems:saleItems.reduce((sum,item) => sum + item.qty, 0), total, status:"active",
      ...(offlineLocalId ? {offlineLocalId, createdOffline:true, createdLocallyAt:createdLocallyAt.toISOString(), syncedAt:serverTimestamp()} : {}),
      createdAt:serverTimestamp(), updatedAt:serverTimestamp(), deletedAt:null});
    return {id:saleRef.id, saleCode, total, ...payment, createdAt:new Date()};
  });
}

export async function updateSaleTransaction({saleId, seller, items, discounts, discount, paymentMethod, paymentMethodLabel, payments}) {
  const saleRef = doc(db, "sales", saleId);
  const newItems = cleanSaleItems(items);
  if (!newItems.length) throw new Error("La venta está vacía");
  const subtotal = newItems.reduce((sum,item) => sum + item.subtotal, 0);
  const discountSummary = calculateDiscountSummary(Array.isArray(discounts)?discounts:(discount?[discount]:[]),subtotal);
  const total = discountSummary.total;
  const payment = normalizePayment(paymentMethod,paymentMethodLabel,payments,total);
  return runTransaction(db, async transaction => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) throw new Error("La venta ya no existe");
    const sale = saleSnap.data();
    if (sale.status !== "active") throw new Error("La venta está anulada");
    if (!userCanAdmin(seller) && sale.sellerId !== seller.id) throw new Error("No podés editar esta venta");
    const oldQty = new Map((sale.items || []).map(item => [item.productId, Number(item.qty)]));
    const newQty = new Map(newItems.map(item => [item.productId, Number(item.qty)]));
    const productIds = [...new Set([...oldQty.keys(), ...newQty.keys()])];
    const stockRefs = productIds.map(id => doc(db, "locationStock", sale.locationId, "items", id));
    const stockSnaps = [];
    for (const stockRef of stockRefs) stockSnaps.push(await transaction.get(stockRef));
    productIds.forEach((productId, index) => {
      const difference = (oldQty.get(productId) || 0) - (newQty.get(productId) || 0);
      if (!difference) return;
      const snap = stockSnaps[index];
      if (!snap.exists()) throw new Error("Falta el registro de stock de un producto");
      const previousStock = Number(snap.data().currentStock || 0);
      const newStock = previousStock + difference;
      transaction.update(stockRefs[index], {currentStock:newStock, updatedAt:serverTimestamp()});
      transaction.set(doc(collection(db, "stockMovements")), {locationId:sale.locationId, productId, type:"sale_edit", qty:difference,
        previousStock, newStock, reason:`Edición ${sale.saleCode}`, userId:seller.id, userName:seller.name, saleId, createdAt:serverTimestamp()});
    });
    transaction.update(saleRef, {items:newItems, discounts:discountSummary.discounts, discount:null,
      discountTotal:discountSummary.discountTotal, totalBeforeDiscounts:discountSummary.totalBeforeDiscounts,
      ...payment, subtotal, totalItems:newItems.reduce((sum,item) => sum + item.qty,0), total, updatedAt:serverTimestamp()});
    return {id:saleId, saleCode:sale.saleCode, total, ...payment, createdAt:new Date()};
  });
}

export async function deleteSaleTransaction({saleId, user}) {
  const saleRef = doc(db, "sales", saleId);
  await runTransaction(db, async transaction => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) throw new Error("La venta ya no existe");
    const sale = saleSnap.data();
    if (sale.status !== "active") throw new Error("La venta ya está anulada");
    if (!userCanAdmin(user) && sale.sellerId !== user.id) throw new Error("No podés anular esta venta");
    const stockRefs = sale.items.map(item => doc(db, "locationStock", sale.locationId, "items", item.productId));
    const stockSnaps = [];
    for (const stockRef of stockRefs) stockSnaps.push(await transaction.get(stockRef));
    sale.items.forEach((item,index) => {
      if (!stockSnaps[index].exists()) throw new Error(`Falta el stock de ${item.name}`);
      const previousStock = Number(stockSnaps[index].data()?.currentStock || 0);
      const newStock = previousStock + Number(item.qty);
      transaction.update(stockRefs[index], {currentStock:newStock, updatedAt:serverTimestamp()});
      transaction.set(doc(collection(db, "stockMovements")), {locationId:sale.locationId, productId:item.productId, type:"sale_cancel", qty:Number(item.qty),
        previousStock, newStock, reason:`Anulación ${sale.saleCode}`, userId:user.id, userName:user.name, saleId, createdAt:serverTimestamp()});
    });
    transaction.update(saleRef, {status:"cancelled", cancelledAt:serverTimestamp(), cancelledBy:user.id, cancelledByName:user.name, cancelReason:"Anulada manualmente", updatedAt:serverTimestamp()});
  });
}

export async function restoreSaleTransaction({saleId, user}) {
  if (!userCanAdmin(user)) throw new Error("Sólo un administrador puede restaurar ventas");
  const saleRef = doc(db,"sales",saleId);
  await runTransaction(db, async transaction => {
    const saleSnap = await transaction.get(saleRef);
    if (!saleSnap.exists()) throw new Error("La venta ya no existe");
    const sale = saleSnap.data();
    if (!["cancelled","deleted"].includes(sale.status)) throw new Error("La venta no está anulada");
    const locationRef = doc(db,"locations",sale.locationId);
    const locationSnap = await transaction.get(locationRef);
    if (!locationSnap.exists() || !isLocationActiveNow(locationSnap.data()) || locationSnap.data().deleted === true) throw new Error("La ubicación de la venta no está activa");
    const stockRefs = sale.items.map(item => doc(db,"locationStock",sale.locationId,"items",item.productId));
    const stockSnaps = [];
    for (const stockRef of stockRefs) stockSnaps.push(await transaction.get(stockRef));
    stockSnaps.forEach((snap,index) => {
      const item = sale.items[index];
      if (!snap.exists() || snap.data().active !== true || snap.data().deleted === true) throw new Error(`${item.name} no está disponible en esta ubicación`);
    });
    const movementRefs = sale.items.map(() => doc(collection(db,"stockMovements")));
    sale.items.forEach((item,index) => {
      const previousStock = Number(stockSnaps[index].data().currentStock || 0);
      const newStock = previousStock - Number(item.qty);
      transaction.update(stockRefs[index], {currentStock:newStock, updatedAt:serverTimestamp()});
      transaction.set(movementRefs[index], {locationId:sale.locationId, productId:item.productId, type:"sale_restore", qty:-Number(item.qty),
        previousStock, newStock, reason:`Restauración ${sale.saleCode}`, userId:user.id, userName:user.name, saleId, createdAt:serverTimestamp()});
    });
    transaction.update(saleRef, {status:"active", restoredAt:serverTimestamp(), restoredBy:user.id, restoredByName:user.name, updatedAt:serverTimestamp()});
  });
}

export function subscribeLocationStock(locationId, callback, onError) {
  return onSnapshot(query(collection(db, "locationStock", locationId, "items"), orderBy("productName")), snap => callback(docsToArray(snap)), onError);
}

export function subscribeLocationSales(locationId, callback, onError, max = 200) {
  return onSnapshot(query(collection(db, "sales"), where("locationId","==",locationId), orderBy("createdAt","desc"), limit(max)), snap => callback(docsToArray(snap)), onError);
}

export async function listSellerSales(sellerId, max = 100) {
  return docsToArray(await getDocs(query(collection(db, "sales"), where("sellerId","==",sellerId), orderBy("createdAt","desc"), limit(max))));
}

export async function listSellerDailyLocationSales(sellerId, locationId, dayStart) {
  return docsToArray(await getDocs(query(
    collection(db, "sales"),
    where("locationId","==",locationId),
    where("sellerId","==",sellerId),
    where("createdAt",">=",Timestamp.fromDate(dayStart)),
    orderBy("createdAt","desc")
  )));
}

export async function listSalesByDateRange(start, end) {
  return docsToArray(await getDocs(query(
    collection(db,"sales"),
    where("createdAt",">=",Timestamp.fromDate(start)),
    where("createdAt","<",Timestamp.fromDate(end)),
    orderBy("createdAt","asc")
  )));
}

export async function listSalesByLocation(locationId, max = 500) {
  return docsToArray(await getDocs(query(collection(db, "sales"), where("locationId","==",locationId), orderBy("createdAt","desc"), limit(max))));
}

export {serverTimestamp, Timestamp};

/*
 * Datos de ejemplo. Usa credenciales de aplicación de Google configuradas fuera
 * del repositorio. Ver README.md antes de ejecutarlo.
 */
const {applicationDefault, initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");

initializeApp({credential:applicationDefault(), projectId:"fm-stock-y-venta"});
const db = getFirestore();

const products = [
  ["Aceite 500cc Arbosana","ARB5"],["Aceite 500cc Arbequina","ARQ5"],["Aceite 500cc Blend","BLE5"],
  ["Aceite 500cc Coratina","COR5"],["Botellón 2L Blend","B2BL"],["Botellón 2L Coratina","B2CO"],
  ["Botellón 5L","BOT5"],["Aceitunas 500g","ACE5"],["Almendras 200g","ALM2"],
  ["Almendras 500g","ALM5"],["Almendras 1kg","ALM1"],["Pistachos 150g","PIS1"],
  ["Pistachos 400g","PIS4"],["Vino Malbec","VMAL"],["Vino Cabernet","VCAB"]
];
const locations = [["Local","LOCAL"],["Feria Ganadera 16 al 26 de julio","FGAN"],["Feria Colegiales 2 y 3 de julio","FCOL"]];
const discounts = [["Promo 2 botellas 500cc","fixed",0],["Promo 2 kilos de almendras","fixed",0],["Descuento feria","percent",10]];

async function seed() {
  const batch = db.batch();
  products.forEach(([name,abbreviation]) => batch.set(db.collection("products").doc(), {
    name, abbreviation, description:"", imageUrl:"", thumbUrl:"", active:true, defaultPrice:0,
    buttonKey:"", buttonCode:"", buttonLocation:0, buttonLabel:"",
    createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()
  }));
  locations.forEach(([name,codePrefix]) => batch.set(db.collection("locations").doc(), {
    name, codePrefix, startDate:"", endDate:"", active:true, assignedSellerIds:[],
    createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()
  }));
  discounts.forEach(([name,type,value]) => batch.set(db.collection("discounts").doc(), {
    name, type, value, active:true, createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()
  }));
  await batch.commit();
  console.log("Datos de ejemplo creados. Revisalos desde el panel administrador.");
}

seed().catch(error => { console.error(error); process.exitCode = 1; });

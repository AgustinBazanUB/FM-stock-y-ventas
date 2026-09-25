import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";
import {isLocationActiveNow} from "../locations.js";

// Execute the real transfer function with an in-memory Firestore boundary.
// No Firebase connection or real inventory is used by this regression test.
const service = readFileSync(new URL("../firebase-service.js", import.meta.url), "utf8");
const start = service.indexOf("export async function transferLocationStock(");
const end = service.indexOf("\nfunction cleanSaleItems", start);
assert.ok(start >= 0 && end > start, "La función de transferencia debe existir");
const implementation = service.slice(start, end).replace(/^export /, "");
const stockPath = (location, product) => `locationStock/${location}/items/${product}`;
const user = {id:"admin", name:"Administrador"};

function fixture({destinationActive = true, failCommit = false} = {}) {
  const records = new Map([
    ["locations/origin", {name:"Origen", active:false}],
    ["locations/destination", {name:"Destino", active:destinationActive}],
    [stockPath("origin", "existing"), {productName:"Aceite", currentStock:5, initialStock:10, active:true}],
    [stockPath("origin", "new"), {productName:"Sal", currentStock:3, price:600, active:true}],
    [stockPath("origin", "zero"), {productName:"Pasta", currentStock:0, active:true}],
    [stockPath("origin", "deleted"), {productName:"Eliminado", currentStock:0, deleted:true}],
    [stockPath("destination", "existing"), {productName:"Aceite", currentStock:7, initialStock:7, price:1200, active:true}]
  ]);
  let sequence = 0;
  const context = {
    db:{path:""},
    collection:(_, ...parts) => ({path:parts.join("/")}),
    doc:(parent, ...parts) => {
      const path = parts.length ? parts.join("/") : `${parent.path}/transfer-${++sequence}`;
      return {path, id:path.split("/").at(-1)};
    },
    listLocationStock:async location => [...records].filter(([path]) => path.startsWith(`locationStock/${location}/items/`)).map(([path, data]) => ({...structuredClone(data), id:path.split("/").at(-1)})),
    isLocationActiveNow,
    serverTimestamp:() => "server-time",
    runTransaction:async (_, callback) => {
      const writes = [];
      await callback({
        get:async ref => {
          assert.equal(writes.length, 0, "Las lecturas deben preceder a las escrituras");
          const data = records.get(ref.path);
          return {id:ref.id, exists:() => Boolean(data), data:() => structuredClone(data)};
        },
        update:(ref, data) => writes.push({ref, data, merge:true}),
        set:(ref, data, options) => writes.push({ref, data, merge:Boolean(options?.merge)})
      });
      if (failCommit) throw new Error("Fallo simulado al confirmar");
      for (const {ref, data, merge} of writes) records.set(ref.path, {...(merge ? records.get(ref.path) : {}), ...structuredClone(data)});
    }
  };
  const transfer = runInNewContext(`${implementation}\ntransferLocationStock`, context);
  return {records, transfer:overrides => transfer({sourceLocationId:"origin", targetLocationId:"destination", user, ...overrides})};
}

const success = fixture();
const result = await success.transfer();
assert.equal(result.productCount, 3);
assert.equal(result.totalQty, 8);
assert.equal(success.records.get(stockPath("destination", "existing")).currentStock, 12);
assert.equal(success.records.get(stockPath("destination", "existing")).price, 1200, "Conserva el precio del destino");
assert.equal(success.records.get(stockPath("destination", "existing")).initialStock, 7, "Conserva el stock inicial del destino");
assert.equal(success.records.get(stockPath("destination", "new")).currentStock, 3);
assert.equal(success.records.get(stockPath("destination", "zero")).currentStock, 0, "También crea productos con cero unidades");
assert.equal(success.records.has(stockPath("destination", "deleted")), false);
for (const product of ["existing", "new", "zero"]) assert.equal(success.records.get(stockPath("origin", product)).currentStock, 0);
assert.equal(success.records.get(stockPath("origin", "existing")).initialStock, 10, "Conserva el registro del origen");
const movement = [...success.records].find(([path]) => path.startsWith("stockMovements/"))[1];
assert.equal(movement.destinationLocationId, "destination", "Registra el identificador real del destino sin variables indefinidas");
assert.equal(movement.sourceLocationId, "origin");
assert.equal(movement.items.length, 3);
await success.transfer();
assert.equal(success.records.get(stockPath("destination", "existing")).currentStock, 12, "Repetir la transferencia no duplica cantidades");

for (const options of [{destinationActive:false}, {failCommit:true}]) {
  const scenario = fixture(options);
  const before = structuredClone([...scenario.records]);
  await assert.rejects(scenario.transfer(), options.failCommit ? /Fallo simulado/ : /dejó de estar activa/);
  assert.deepEqual([...scenario.records], before, "Un error no debe modificar cantidades ni registrar una transferencia parcial");
}
const sameLocation = fixture();
await assert.rejects(sameLocation.transfer({targetLocationId:"origin"}), /distinta del origen/);
console.log("Transferencia de stock: suma, productos nuevos y en cero, auditoría, repetición y rechazo sin cambios OK");

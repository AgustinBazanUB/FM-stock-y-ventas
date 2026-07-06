import assert from "node:assert/strict";
import {applyMetricsFilters,buildMetricsDateRange,calculateMetrics,metricLocations,metricSellersForLocations} from "../metrics.js";

const locations=[
  {id:"a",name:"Ubicación A",active:true,deleted:false,assignedSellerIds:["juan"]},
  {id:"b",name:"Ubicación B",active:true,deleted:false,assignedSellerIds:["pedro"]},
  {id:"c",name:"Ubicación C",active:false,deleted:true,assignedSellerIds:["martin"]},
  {id:"d",name:"Ubicación D",active:false,deleted:false,assignedSellerIds:["dora"]}
];
const users=[
  {id:"juan",name:"Juan",role:"seller",active:true,deleted:false,allowedLocationIds:["a"]},
  {id:"pedro",name:"Pedro",role:"seller",active:true,deleted:false,allowedLocationIds:["b"]},
  {id:"laura",name:"Laura",role:"seller",active:true,deleted:false,allowedLocationIds:["b"]},
  {id:"martin",name:"Martín",role:"seller",active:true,deleted:false,allowedLocationIds:["c"]},
  {id:"dora",name:"Dora",role:"seller",active:false,deleted:false,allowedLocationIds:["d"]}
];
const sale=(id,locationId,sellerId,total,productId="p1")=>({id,createdAt:"2026-07-10T12:00:00-03:00",status:"active",locationId,locationName:`Ubicación ${locationId.toUpperCase()}`,sellerId,sellerName:users.find(user=>user.id===sellerId)?.name,items:[{productId,name:productId,qty:1,subtotal:total}],total});
const sales=[sale("sa","a","juan",100),sale("sb1","b","pedro",200,"p2"),sale("sb2","b","laura",300),sale("sc","c","martin",400),sale("sd","d","dora",50)];
const range=buildMetricsDateRange("month","2026-07");
const visible=metricLocations(locations);
const ids=list=>list.map(item=>item.id).sort();
const filtered=(locationIds,sellerIds,extra={})=>applyMetricsFilters(sales,{locationIds,locationNames:visible.filter(item=>locationIds.includes(item.id)).map(item=>item.name),sellerIds,sellerNames:users.filter(item=>sellerIds.includes(item.id)).map(item=>item.name),...extra},range);

assert.deepEqual(ids(visible),["a","b","d"],"Todas debe excluir solo ubicaciones eliminadas");
const allSellers=metricSellersForLocations(visible,users,sales,ids(visible));
assert.deepEqual(ids(allSellers),["dora","juan","laura","pedro"],"Todas debe usar vendedores de ubicaciones visibles");
assert.equal(calculateMetrics(filtered(ids(visible),ids(allSellers)),range).total,650,"Todas debe sumar A, B y D");

const sellersA=metricSellersForLocations(visible,users,sales,["a"]);
assert.deepEqual(ids(sellersA),["juan"],"Una ubicación debe limitar sus vendedores");
assert.equal(calculateMetrics(filtered(["a"],ids(sellersA)),range).total,100,"Una ubicación debe limitar las métricas");

const sellersAB=metricSellersForLocations(visible,users,sales,["a","b"]);
assert.deepEqual(ids(sellersAB),["juan","laura","pedro"],"Varias ubicaciones deben unir vendedores");
assert.equal(calculateMetrics(filtered(["a","b"],ids(sellersAB)),range).total,600,"Varias ubicaciones deben sumar solo las seleccionadas");

assert.ok(!visible.some(item=>item.id==="c"),"Una ubicación eliminada no debe estar disponible");
assert.ok(!ids(allSellers).includes("martin"),"Un vendedor de una ubicación eliminada no debe aparecer");
assert.ok(visible.some(item=>item.id==="d"&&item.active===false),"Una ubicación inactiva no eliminada debe estar disponible");
assert.equal(calculateMetrics(filtered(["d"],["dora"]),range).total,50,"Debe poder consultarse el historial de una ubicación inactiva");

const sellerSelection=["juan"].filter(id=>ids(metricSellersForLocations(visible,users,sales,["b"])).includes(id));
assert.deepEqual(sellerSelection,[],"Cambiar de ubicación debe quitar vendedores inválidos");

const combined=filtered(["a","b"],["pedro"],{productId:"p2",productName:"p2"});
assert.deepEqual(combined.map(item=>item.id),["sb1"],"Los filtros combinados deben aplicarse al mismo conjunto de ventas");
assert.equal(calculateMetrics(combined,range,{productId:"p2",productName:"p2"}).total,200,"Gráficos y tarjetas deben usar el conjunto combinado");

console.log("Métricas: 7 escenarios de filtros OK");
